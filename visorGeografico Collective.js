const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const colors = require("colors");
const { procesarAlertasYCorreo, describirEstadoCelda } = require("./evaluarCelda");
const { cargarAreas } = require("./cargarAreas");
const { obtenerPausaTrasLiberacionMs } = require("./centinelaRadicador");

// node "visorGeografico Collective.js" [archivo]
//   (sin argumento) → areas/Collective/Collective.json
//   508750          → areas/Collective/508750.json
const EMPRESA = "Collective";
const ENTRADA_AREAS = `${EMPRESA}/${process.argv[2] || EMPRESA}`;

let Areas;
let EMPRESAS;
let RUTA_AREAS;
let ARCHIVO_AREAS;
try {
  const cargado = cargarAreas(ENTRADA_AREAS);
  Areas = cargado.areas;
  EMPRESAS = cargado.empresas;
  RUTA_AREAS = cargado.ruta;
  ARCHIVO_AREAS = cargado.nombre;
  if (cargado.modo === "multi") {
    console.log(
      colors.cyan(
        `Archivo multi-empresa: ${RUTA_AREAS} (${EMPRESAS.length} empresas, ${Areas.length} áreas)`
      )
    );
    for (const empresa of EMPRESAS) {
      const n = Areas.filter((a) => a.empresa === empresa).length;
      console.log(colors.gray(`  · ${empresa}: ${n} área(s)`));
    }
  } else {
    console.log(
      colors.cyan(
        `Archivo de áreas: ${RUTA_AREAS} → empresa ${EMPRESAS[0]} (${Areas.length} áreas)`
      )
    );
  }
} catch (error) {
  console.error(colors.red(error.message));
  process.exit(1);
}

const BASE_VALIDACION_DIR = path.join(
  __dirname,
  "base de datos",
  "validacion por celda"
);

const LOGIN_URL = "https://annamineria.anm.gov.co/sigm/externalLogin";
const VISOR_URL_FRAGMENT = "Html5Viewer";
const SELECTOR_ICONO_MAPA = 'img[src*="mapviewer-circle-btn.png"]';
const SELECTOR_BTN_VISOR = "#btn_mapviewer";

const TIMEOUT_NUEVA_PESTANA_MS = 120000;
const TIMEOUT_CARGA_VISOR_MS = 300000;
const INTERVALO_INTENTO_CLICK_MS = 5000;
const INTERVALO_LOG_MS = 15000;
const XPATH_BTN_HERRAMIENTAS =
  '//li[contains(@class,"toolbar-tab")]//button[normalize-space()="Herramientas"]';
const TIMEOUT_CONSULTA_MS = 120000;
const XPATHS_BTN_CONSULTA = [
  '//button[contains(@class,"toolbar-item")][contains(translate(@title,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"consultas simple")]',
  '//button[contains(@class,"toolbar-item")]//p[normalize-space()="Consulta"]/ancestor::button[1]',
  '//button[contains(@class,"toolbar-item")]//img[contains(@src,"query-24.png")]/ancestor::button[1]',
];
const SELECTOR_IMG_CONSULTA = 'img[src*="query-24.png"]';
const TIMEOUT_CONFIG_CONSULTA_MS = 60000;
const VALOR_CAPA_CELDA = "10.0";
const VALOR_FILTRO_CELDA = "CELL_KEY_ID";
const VALOR_OPERADOR_IGUAL = "0";
const SELECTOR_INPUT_CELDA = 'input.ui-autocomplete-input[title="autocomplete"]';
const XPATH_BTN_BUSCAR =
  '//button[contains(@class,"jimu-btn")][contains(normalize-space(.),"Buscar")]';
const TIMEOUT_BUSQUEDA_CELDA_MS = 30000;
const ESPERA_ENTRE_AREAS_MS = 3000;
const ESPERA_ENTRE_CICLOS_MS =
  Number(process.env.ESPERA_ENTRE_CICLOS_MS) || 60000;
const MAX_REINTENTOS_BUSQUEDA = 2;

function guardarJson(ruta, datos) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify(datos, null, 2), "utf-8");
}

function rutaSalidaArea(empresa, nombreArea) {
  return path.join(
    BASE_VALIDACION_DIR,
    empresa,
    nombreArea,
    `${nombreArea}.json`
  );
}

function obtenerFrames(visorPage) {
  return [visorPage.mainFrame(), ...visorPage.frames()];
}

async function esperarPestanaVisor(browser, timeoutMs) {
  const inicio = Date.now();
  let ultimoLog = inicio;

  while (Date.now() - inicio < timeoutMs) {
    const pages = await browser.pages();
    const visorPage = pages.find((p) => p.url().includes(VISOR_URL_FRAGMENT));

    if (visorPage) {
      return visorPage;
    }

    const ahora = Date.now();
    if (ahora - ultimoLog >= INTERVALO_LOG_MS) {
      const segundos = Math.round((ahora - inicio) / 1000);
      console.log(
        colors.yellow(`  Aún esperando nueva pestaña del visor... (${segundos}s)`)
      );
      ultimoLog = ahora;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `No se abrió la pestaña del visor en ${timeoutMs / 1000}s`
  );
}

async function elementoClickeable(elemento) {
  return elemento.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.pointerEvents !== "none" &&
      !el.disabled
    );
  });
}

async function intentarClicPorXPath(visorPage, xpath) {
  const elementos = await visorPage.$x(xpath);
  if (elementos.length === 0) {
    return false;
  }

  const elemento = elementos[0];
  if (!(await elementoClickeable(elemento))) {
    return false;
  }

  await elemento.click();
  return true;
}

async function intentarClicHerramientas(visorPage) {
  return intentarClicPorXPath(visorPage, XPATH_BTN_HERRAMIENTAS);
}

async function clickearElemento(page, frame, elemento) {
  await frame.evaluate((el) => {
    el.scrollIntoView({ block: "center", inline: "center" });
  }, elemento);

  if (!(await elementoClickeable(elemento))) {
    return false;
  }

  try {
    await elemento.click({ delay: 50 });
    return true;
  } catch (_) {
    const box = await elemento.boundingBox();
    if (!box) {
      return false;
    }

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return true;
  }
}

async function intentarClicConsultaEnFrame(page, frame) {
  for (const xpath of XPATHS_BTN_CONSULTA) {
    const elementos = await frame.$x(xpath);
    if (elementos.length === 0) {
      continue;
    }

    if (await clickearElemento(page, frame, elementos[0])) {
      return true;
    }
  }

  const imgConsulta = await frame.$(SELECTOR_IMG_CONSULTA);
  if (imgConsulta) {
    const boton = await frame.evaluateHandle((img) => {
      let nodo = img;
      while (nodo && nodo.tagName !== "BUTTON") {
        nodo = nodo.parentElement;
      }
      return nodo;
    }, imgConsulta);

    const elemento = boton.asElement();
    if (elemento && (await clickearElemento(page, frame, elemento))) {
      return true;
    }
  }

  return frame.evaluate(() => {
    const botones = document.querySelectorAll("button.toolbar-item.tool, button.toolbar-item");
    for (const btn of botones) {
      const title = (btn.getAttribute("title") || "").toLowerCase();
      const texto = btn.textContent.replace(/\s+/g, " ").trim().toLowerCase();
      const tieneIcono = btn.querySelector('img[src*="query-24.png"]');

      if (
        !title.includes("consultas simple") &&
        texto !== "consulta" &&
        !tieneIcono
      ) {
        continue;
      }

      const rect = btn.getBoundingClientRect();
      const style = window.getComputedStyle(btn);
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        !btn.disabled
      ) {
        btn.scrollIntoView({ block: "center", inline: "center" });
        btn.click();
        return true;
      }
    }
    return false;
  });
}

async function intentarClicConsulta(visorPage) {
  const frames = [visorPage.mainFrame(), ...visorPage.frames()];

  for (const frame of frames) {
    try {
      if (await intentarClicConsultaEnFrame(visorPage, frame)) {
        return true;
      }
    } catch (_) {
      // Probar el siguiente frame.
    }
  }

  return false;
}

async function esperarCargaVisor(visorPage, timeoutMs) {
  console.log(
    colors.cyan(
      `Esperando carga del visor: intentando clic en "Herramientas" cada ${INTERVALO_INTENTO_CLICK_MS / 1000}s...`
    )
  );

  const inicio = Date.now();
  let ultimoLog = inicio;
  let intentos = 0;

  while (Date.now() - inicio < timeoutMs) {
    intentos += 1;

    try {
      const clicOk = await intentarClicHerramientas(visorPage);
      if (clicOk) {
        console.log(
          colors.green(
            `  Visor cargado: clic en "Herramientas" exitoso (intento ${intentos}).`
          )
        );
        return;
      }
    } catch (_) {
      // El visor aún no está listo para recibir clics.
    }

    const ahora = Date.now();
    if (ahora - ultimoLog >= INTERVALO_LOG_MS) {
      const segundos = Math.round((ahora - inicio) / 1000);
      console.log(
        colors.yellow(
          `  Visor aún cargando... (${segundos}s, ${intentos} intento(s))`
        )
      );
      ultimoLog = ahora;
    }

    await new Promise((resolve) => setTimeout(resolve, INTERVALO_INTENTO_CLICK_MS));
  }

  throw new Error(
    `El visor no respondió al clic en "Herramientas" tras ${timeoutMs / 1000}s`
  );
}

async function abrirConsulta(visorPage, timeoutMs) {
  await visorPage.waitForTimeout(2000);

  console.log(
    colors.cyan(
      `Abriendo "Consulta": intentando clic cada ${INTERVALO_INTENTO_CLICK_MS / 1000}s...`
    )
  );

  const inicio = Date.now();
  let ultimoLog = inicio;
  let intentos = 0;

  while (Date.now() - inicio < timeoutMs) {
    intentos += 1;

    try {
      await intentarClicHerramientas(visorPage);
      const clicOk = await intentarClicConsulta(visorPage);
      if (clicOk) {
        console.log(
          colors.green(`  Clic en "Consulta" exitoso (intento ${intentos}).`)
        );
        return;
      }
    } catch (error) {
      console.log(colors.gray(`  Intento ${intentos} falló: ${error.message}`));
    }

    const ahora = Date.now();
    if (ahora - ultimoLog >= INTERVALO_LOG_MS) {
      const segundos = Math.round((ahora - inicio) / 1000);
      console.log(
        colors.yellow(
          `  Esperando botón "Consulta"... (${segundos}s, ${intentos} intento(s))`
        )
      );
      ultimoLog = ahora;
    }

    await new Promise((resolve) => setTimeout(resolve, INTERVALO_INTENTO_CLICK_MS));
  }

  throw new Error(
    `No se pudo hacer clic en "Consulta" tras ${timeoutMs / 1000}s`
  );
}

async function seleccionarCapaCeldaEnFrame(frame) {
  return frame.evaluate((valorCelda) => {
    const selects = document.querySelectorAll("select");
    for (const select of selects) {
      const grupoCapas = select.querySelector('optgroup[label="Capas:"]');
      const opcionCelda = select.querySelector(`option[value="${valorCelda}"]`);
      if (!grupoCapas || !opcionCelda) {
        continue;
      }

      select.value = valorCelda;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return select.value === valorCelda;
    }
    return false;
  }, VALOR_CAPA_CELDA);
}

async function seleccionarFiltroEnFrame(frame, valorFiltro) {
  return frame.evaluate((valor) => {
    const select = document.querySelector('select[title="Seleccionar filtro"]');
    if (!select) {
      return false;
    }

    const opcion = select.querySelector(`option[value="${valor}"]`);
    if (!opcion) {
      return false;
    }

    select.value = valor;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return select.value === valor;
  }, valorFiltro);
}

async function seleccionarOperadorEnFrame(frame, valorOperador) {
  return frame.evaluate((valor) => {
    const select = document.querySelector('select[title="Seleccionar operador"]');
    if (!select) {
      return false;
    }

    const opcion = select.querySelector(`option[value="${valor}"]`);
    if (!opcion) {
      return false;
    }

    select.value = valor;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return select.value === valor;
  }, valorOperador);
}

async function configurarConsultaCelda(visorPage, timeoutMs) {
  console.log(
    colors.cyan(
      'Configurando consulta: Capa "Celda" → "CELL_KEY_ID" → operador "="...'
    )
  );

  await visorPage.waitForTimeout(1500);

  const inicio = Date.now();
  let ultimoLog = inicio;
  let intentos = 0;
  let capaSeleccionada = false;
  let filtroSeleccionado = false;

  while (Date.now() - inicio < timeoutMs) {
    intentos += 1;
    const frames = [visorPage.mainFrame(), ...visorPage.frames()];

    for (const frame of frames) {
      try {
        if (!capaSeleccionada) {
          capaSeleccionada = await seleccionarCapaCeldaEnFrame(frame);
          if (capaSeleccionada) {
            console.log(colors.green('  Capa "Celda" seleccionada.'));
            await visorPage.waitForTimeout(1500);
          }
        }

        if (capaSeleccionada && !filtroSeleccionado) {
          filtroSeleccionado = await seleccionarFiltroEnFrame(
            frame,
            VALOR_FILTRO_CELDA
          );
          if (filtroSeleccionado) {
            console.log(colors.green('  Filtro "CELL_KEY_ID" seleccionado.'));
            await visorPage.waitForTimeout(500);
          }
        }

        if (capaSeleccionada && filtroSeleccionado) {
          const operadorOk = await seleccionarOperadorEnFrame(
            frame,
            VALOR_OPERADOR_IGUAL
          );
          if (operadorOk) {
            console.log(colors.green('  Operador "=" seleccionado.'));
            return;
          }
        }
      } catch (_) {
        // Probar el siguiente frame.
      }
    }

    const ahora = Date.now();
    if (ahora - ultimoLog >= INTERVALO_LOG_MS) {
      const segundos = Math.round((ahora - inicio) / 1000);
      console.log(
        colors.yellow(
          `  Configurando consulta... (${segundos}s, capa=${capaSeleccionada}, filtro=${filtroSeleccionado})`
        )
      );
      ultimoLog = ahora;
    }

    await new Promise((resolve) => setTimeout(resolve, INTERVALO_INTENTO_CLICK_MS));
  }

  throw new Error(
    `No se pudo configurar la consulta Celda/CELL_KEY_ID/= tras ${timeoutMs / 1000}s`
  );
}

async function prepararConsultaCelda(visorPage) {
  await abrirConsulta(visorPage, TIMEOUT_CONSULTA_MS);
  await configurarConsultaCelda(visorPage, TIMEOUT_CONFIG_CONSULTA_MS);
}

async function escribirReferenciaEnFrame(frame, referencia) {
  const input = await frame.$(SELECTOR_INPUT_CELDA);
  if (!input) {
    return false;
  }

  await input.click({ clickCount: 3 });
  await input.evaluate((el) => {
    el.value = "";
  });
  await input.type(referencia, { delay: 20 });
  await input.evaluate((el, valor) => {
    el.value = valor;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, referencia);
  return true;
}

async function clicBuscarEnFrame(frame) {
  const botones = await frame.$x(XPATH_BTN_BUSCAR);
  if (botones.length === 0) {
    return false;
  }

  for (const boton of botones) {
    if (await elementoClickeable(boton)) {
      await boton.click();
      return true;
    }
  }
  return false;
}

async function esperarFeatureLabelEnFrame(frame, referencia, timeoutMs) {
  const xpath = `//div[contains(@class,"feature-label")][normalize-space()="${referencia}"]`;
  const inicio = Date.now();

  while (Date.now() - inicio < timeoutMs) {
    const elementos = await frame.$x(xpath);
    if (elementos.length > 0) {
      return elementos[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}

async function extraerAtributosEnFrame(frame) {
  return frame.evaluate(() => {
    const atributos = {};
    const items = document.querySelectorAll("ul.attribute-list li.attribute-item");

    for (const item of items) {
      const etiqueta = item.querySelector(".attribute-label");
      const valor = item.querySelector(
        ".attribute-details span.bound-visible-inline"
      );
      if (!etiqueta) {
        continue;
      }
      atributos[etiqueta.textContent.trim()] = valor
        ? valor.textContent.trim()
        : null;
    }

    return atributos;
  });
}

async function buscarCeldaEnVisor(visorPage, area) {
  const referencia = area.Referencia;
  let ultimoError = null;

  for (let intento = 1; intento <= MAX_REINTENTOS_BUSQUEDA; intento++) {
    try {
      console.log(colors.cyan("  Abriendo Consulta y configurando filtros..."));
      await prepararConsultaCelda(visorPage);

      let inputEscrito = false;
      let buscarClickeado = false;

      for (const frame of obtenerFrames(visorPage)) {
        if (!inputEscrito) {
          inputEscrito = await escribirReferenciaEnFrame(frame, referencia);
        }
        if (inputEscrito && !buscarClickeado) {
          buscarClickeado = await clicBuscarEnFrame(frame);
        }
      }

      if (!inputEscrito) {
        throw new Error("No se encontró el campo de autocompletar");
      }
      if (!buscarClickeado) {
        throw new Error('No se encontró el botón "Buscar"');
      }

      await visorPage.waitForTimeout(1500);

      let featureLabel = null;
      for (const frame of obtenerFrames(visorPage)) {
        featureLabel = await esperarFeatureLabelEnFrame(
          frame,
          referencia,
          TIMEOUT_BUSQUEDA_CELDA_MS
        );
        if (featureLabel) {
          await clickearElemento(visorPage, frame, featureLabel);
          break;
        }
      }

      if (!featureLabel) {
        throw new Error(`No apareció el resultado para ${referencia}`);
      }

      await visorPage.waitForTimeout(1000);

      let atributos = {};
      for (const frame of obtenerFrames(visorPage)) {
        const datos = await extraerAtributosEnFrame(frame);
        if (Object.keys(datos).length > 0) {
          atributos = datos;
          break;
        }
      }

      if (Object.keys(atributos).length === 0) {
        throw new Error("No se pudieron extraer los atributos de la celda");
      }

      return {
        sinResultados: false,
        atributos,
        error: null,
      };
    } catch (error) {
      ultimoError = error;
      console.log(
        colors.yellow(
          `  Reintento ${intento}/${MAX_REINTENTOS_BUSQUEDA} para ${area.NombreArea}: ${error.message}`
        )
      );
      await visorPage.waitForTimeout(1500);
    }
  }

  return {
    sinResultados: true,
    atributos: {},
    error: ultimoError ? ultimoError.message : "Error desconocido",
  };
}

async function procesarAreas(visorPage) {
  console.log(
    colors.cyan(
      `\nProcesando ${Areas.length} área(s) desde ${RUTA_AREAS}...`
    )
  );

  for (let i = 0; i < Areas.length; i++) {
    const area = Areas[i];
    const { empresa } = area;
    console.log(
      colors.white(
        `\n[${i + 1}/${Areas.length}] [${empresa}] ${area.NombreArea} → ${area.Referencia}`
      )
    );

    const registro = {
      archivoAreas: ARCHIVO_AREAS,
      empresa,
      NombreArea: area.NombreArea,
      Referencia: area.Referencia,
      Celdas: area.Celdas || [],
      fechaConsulta: new Date().toISOString(),
      sinResultados: false,
      atributos: {},
      error: null,
    };

    const resultado = await buscarCeldaEnVisor(visorPage, area);
    registro.sinResultados = resultado.sinResultados;
    registro.atributos = resultado.atributos;
    registro.error = resultado.error;

    const archivoSalida = rutaSalidaArea(empresa, area.NombreArea);
    const anterior = fs.existsSync(archivoSalida)
      ? JSON.parse(fs.readFileSync(archivoSalida, "utf-8"))
      : null;

    const yaEnviada = Boolean(anterior?.alertas?.liberacion?.areaARadicarEscrito);

    await procesarAlertasYCorreo({
      anterior,
      registro,
      empresa,
    });

    if (registro.alertas?.liberacion?.areaARadicarEscrito && !yaEnviada) {
      const pausaMs = obtenerPausaTrasLiberacionMs();
      console.log(
        colors.cyan(`  Área enviada a radicar: pausa ${pausaMs / 1000}s...`)
      );
      await visorPage.waitForTimeout(pausaMs);
    }

    guardarJson(archivoSalida, registro);

    if (resultado.error) {
      console.log(colors.red(`  Error: ${resultado.error}`));
    } else {
      const estado = describirEstadoCelda(resultado.atributos);
      if (estado.libre === true) {
        console.log(colors.green(`  ${estado.mensaje}`));
      } else if (estado.libre === false) {
        console.log(colors.yellow(`  ${estado.mensaje}`));
      } else {
        console.log(colors.gray(`  ${estado.mensaje}`));
      }
      console.log(
        colors.green(
          `  ${Object.keys(resultado.atributos).length} atributo(s) guardados en: ${archivoSalida}`
        )
      );
    }

    if (i < Areas.length - 1) {
      await visorPage.waitForTimeout(ESPERA_ENTRE_AREAS_MS);
    }
  }
}

async function abrirVisorGeografico(browser, page) {
  console.log(colors.cyan(`Navegando a ${LOGIN_URL}...`));
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  console.log(colors.cyan("Buscando icono del visor geográfico..."));
  await page.waitForSelector(SELECTOR_ICONO_MAPA, { timeout: 15000 });

  const iconoMapa = await page.$(SELECTOR_ICONO_MAPA);
  if (!iconoMapa) {
    throw new Error(`No se encontró el icono (${SELECTOR_ICONO_MAPA})`);
  }

  await iconoMapa.click();
  console.log(colors.green("Clic en icono del mapa."));
  await page.waitForTimeout(1000);

  console.log(colors.cyan('Esperando botón "Visor Geográfico"...'));
  await page.waitForSelector(SELECTOR_BTN_VISOR, { timeout: 15000 });

  const btnVisor = await page.$(SELECTOR_BTN_VISOR);
  if (!btnVisor) {
    throw new Error(`No se encontró el botón (${SELECTOR_BTN_VISOR})`);
  }

  console.log(colors.cyan("Abriendo visor en nueva pestaña..."));
  await btnVisor.click();
  console.log(colors.green('Clic en "Visor Geográfico".'));

  const visorPage = await esperarPestanaVisor(browser, TIMEOUT_NUEVA_PESTANA_MS);
  await visorPage.bringToFront();
  console.log(colors.green(`Pestaña del visor detectada: ${visorPage.url()}`));

  visorPage.setDefaultTimeout(TIMEOUT_CARGA_VISOR_MS);
  await esperarCargaVisor(visorPage, TIMEOUT_CARGA_VISOR_MS);

  return visorPage;
}

function esperarConCancelacion(ms, shouldStop) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const interval = setInterval(() => {
      if (shouldStop() || Date.now() - inicio >= ms) {
        clearInterval(interval);
        resolve();
      }
    }, 500);
  });
}

async function ejecutarCiclos(visorPage, browser) {
  let detener = false;

  const solicitarDetencion = () => {
    if (!detener) {
      detener = true;
      console.log(
        colors.yellow(
          "\nDetención solicitada por el usuario. Cerrando al terminar la espera..."
        )
      );
    }
  };

  process.on("SIGINT", solicitarDetencion);
  process.on("SIGTERM", solicitarDetencion);

  console.log(
    colors.cyan(
      `Modo infinito: al terminar las ${Areas.length} áreas reinicia el ciclo. Solo se detiene con Ctrl+C.`
    )
  );

  let ciclo = 0;

  while (!detener) {
    ciclo += 1;
    console.log(
      colors.magenta(
        `\n════════ Ciclo ${ciclo} — ${new Date().toLocaleString("es-CO")} ════════`
      )
    );

    try {
      await procesarAreas(visorPage);
      console.log(
        colors.green(
          `\nCiclo ${ciclo} completado (${Areas.length} áreas).`
        )
      );
    } catch (error) {
      console.log(colors.red(`Error en ciclo ${ciclo}: ${error.message}`));
    }

    if (detener) {
      break;
    }

    const esperaSeg = ESPERA_ENTRE_CICLOS_MS / 1000;
    console.log(
      colors.cyan(
        `\n→ Reiniciando desde el área 1 en ${esperaSeg}s (ciclo ${ciclo + 1}). Ctrl+C para parar.`
      )
    );
    await esperarConCancelacion(ESPERA_ENTRE_CICLOS_MS, () => detener);
  }

  console.log(colors.cyan("Cerrando navegador..."));
  await browser.close();
  console.log(
    colors.green(
      `Validación detenida por el usuario tras ${ciclo} ciclo(s). Resultados en: ${BASE_VALIDACION_DIR}`
    )
  );
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath:
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized", "--window-size=1920,1080"],
    devtools: false,
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  try {
    const visorPage = await abrirVisorGeografico(browser, page);
    await ejecutarCiclos(visorPage, browser);
  } catch (error) {
    await browser.close();
    throw error;
  }
}

main().catch((error) => {
  console.error(colors.red(`Error fatal: ${error.message}`));
  process.exit(1);
});
