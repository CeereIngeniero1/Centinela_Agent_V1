const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const colors = require("colors");

const ARCHIVO_AREAS = process.argv[2] || "Collective";
const SEARCH_URL =
  "https://annamineria.anm.gov.co/sigm/externalLogin#/staSearchTitleApplications?lang=es";
const ESPERA_ENTRE_BUSQUEDAS_MS = 3000;
const ESPERA_RESULTADOS_MS = 10000;
const MAX_REINTENTOS = 2;
const BASE_DATOS_DIR = path.join(__dirname, "base de datos");

const areasPath = path.join(__dirname, "areas", `${ARCHIVO_AREAS}.json`);
if (!fs.existsSync(areasPath)) {
  console.error(
    colors.red(`No se encontró el archivo de áreas: ${areasPath}`)
  );
  process.exit(1);
}

const Areas = JSON.parse(fs.readFileSync(areasPath, "utf-8"));
console.log(
  colors.cyan(`Áreas cargadas: ${ARCHIVO_AREAS}.json (${Areas.length} áreas)`)
);

function guardarJson(ruta, datos) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify(datos, null, 2), "utf-8");
}

function generarNombreArchivoConFecha(fecha = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = fecha.getFullYear();
  const mm = pad(fecha.getMonth() + 1);
  const dd = pad(fecha.getDate());
  const hh = pad(fecha.getHours());
  const min = pad(fecha.getMinutes());
  const ss = pad(fecha.getSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}.json`;
}

async function navegarAFormularioBusqueda(page) {
  await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  const tabBusqueda = await page.$('a[href="#tab-r4"]');
  if (!tabBusqueda) {
    throw new Error('No se encontró la pestaña de búsqueda (a[href="#tab-r4"])');
  }
  await tabBusqueda.click();
  await page.waitForTimeout(1000);

  await page.waitForSelector("#publicSearchOptionsId", { timeout: 15000 });
  await page.select("#publicSearchOptionsId", "staSearchTitleApplications");
  await page.waitForTimeout(500);

  await page.waitForSelector("#sta_link", { timeout: 10000 });
  await page.click("#sta_link");

  await page.waitForSelector('[data-ng-model="searchObject.tenureNumberId"]', {
    timeout: 30000,
  });
}

async function escribirExpediente(page, expediente) {
  await page.evaluate((valor) => {
    const input = document.querySelector(
      '[data-ng-model="searchObject.tenureNumberId"]'
    );
    if (!input) throw new Error("No se encontró el campo de expediente");

    input.value = valor;
    input.dispatchEvent(new Event("input", { bubbles: true }));

    if (typeof angular !== "undefined") {
      const el = angular.element(input);
      el.triggerHandler("input");
      el.triggerHandler("change");
      const scope = el.scope();
      if (scope && scope.searchObject) {
        scope.searchObject.tenureNumberId = valor;
        scope.$applyAsync();
      }
    }
  }, expediente);
}

async function esperarBotonBuscarHabilitado(page) {
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-ng-click="search()"]');
      return btn && !btn.disabled;
    },
    { timeout: 10000 }
  );
}

async function clicBuscar(page) {
  const botones = await page.$x(
    '//button[@data-ng-click="search()"]//span[contains(normalize-space(.),"Buscar")]/ancestor::button[1]'
  );
  if (botones.length > 0) {
    await botones[0].click();
    return;
  }

  await page.evaluate(() => {
    const btn = document.querySelector('[data-ng-click="search()"]');
    if (btn && !btn.disabled) btn.click();
  });
}

async function extraerResultados(page) {
  await page.waitForFunction(
    () => {
      const filas = document.querySelectorAll(
        'tr[data-ng-repeat*="searchTitleApplicationsResults"]'
      );
      const sinResultados = Array.from(
        document.querySelectorAll("span.strong.ng-binding")
      ).some((el) =>
        el.textContent.trim().includes("No se encontraron resultados")
      );
      return filas.length > 0 || sinResultados;
    },
    { timeout: ESPERA_RESULTADOS_MS }
  );

  return page.evaluate(() => {
    const sinResultados = Array.from(
      document.querySelectorAll("span.strong.ng-binding")
    ).some((el) =>
      el.textContent.trim().includes("No se encontraron resultados")
    );

    const filas = document.querySelectorAll(
      'tr[data-ng-repeat*="searchTitleApplicationsResults"]'
    );

    const resultados = Array.from(filas).map((fila) => {
      const celdas = fila.querySelectorAll("td");
      const texto = (idx) => (celdas[idx] ? celdas[idx].innerText.trim() : "");

      return {
        expediente: texto(0),
        estado: texto(1),
        tipo: texto(2),
        fecha: texto(3),
        titular: texto(4),
        departamento: texto(5),
        municipios: texto(6),
        nit: texto(8),
      };
    });

    return {
      sinResultados,
      mensaje: sinResultados ? "No se encontraron resultados" : null,
      resultados,
    };
  });
}

async function buscarArea(page, area) {
  let ultimoError = null;

  for (let intento = 1; intento <= MAX_REINTENTOS; intento++) {
    try {
      await escribirExpediente(page, area.NombreArea);
      await esperarBotonBuscarHabilitado(page);
      await clicBuscar(page);
      return await extraerResultados(page);
    } catch (error) {
      ultimoError = error;
      console.log(
        colors.yellow(
          `  Reintento ${intento}/${MAX_REINTENTOS} para ${area.NombreArea}: ${error.message}`
        )
      );
      await page.waitForTimeout(1500);
    }
  }

  throw ultimoError;
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

  const fechaEjecucion = new Date();
  const salidaDir = path.join(BASE_DATOS_DIR, ARCHIVO_AREAS);
  const archivoSalida = path.join(
    salidaDir,
    generarNombreArchivoConFecha(fechaEjecucion)
  );
  const resumen = {
    archivoAreas: ARCHIVO_AREAS,
    fechaEjecucion: fechaEjecucion.toISOString(),
    totalAreas: Areas.length,
    areasSinResultados: [],
    areas: [],
  };

  try {
    console.log(colors.cyan("Navegando al formulario de búsqueda externa..."));
    await navegarAFormularioBusqueda(page);

    for (let i = 0; i < Areas.length; i++) {
      const area = Areas[i];
      console.log(
        colors.white(
          `\n[${i + 1}/${Areas.length}] Buscando: ${area.NombreArea}`
        )
      );

      const registroArea = {
        NombreArea: area.NombreArea,
        Referencia: area.Referencia,
        fechaConsulta: new Date().toISOString(),
        sinResultados: false,
        mensaje: null,
        totalResultados: 0,
        resultados: [],
        error: null,
      };

      try {
        const busqueda = await buscarArea(page, area);
        registroArea.sinResultados = busqueda.sinResultados;
        registroArea.mensaje = busqueda.mensaje;
        registroArea.resultados = busqueda.resultados;
        registroArea.totalResultados = busqueda.resultados.length;

        if (busqueda.sinResultados) {
          resumen.areasSinResultados.push(area.NombreArea);
          console.log(
            colors.yellow(
              `  No se encontraron resultados para el área: ${area.NombreArea}`
            )
          );
        } else if (busqueda.resultados.length > 0) {
          console.log(
            colors.green(
              `  ${busqueda.resultados.length} resultado(s) encontrado(s)`
            )
          );
        }
      } catch (error) {
        registroArea.error = error.message;
        console.log(colors.red(`  Error: ${error.message}`));
      }

      resumen.areas.push(registroArea);

      if (i < Areas.length - 1) {
        await page.waitForTimeout(ESPERA_ENTRE_BUSQUEDAS_MS);
      }
    }

    guardarJson(archivoSalida, resumen);
    console.log(
      colors.cyan(`\nResultados guardados en: ${archivoSalida}`)
    );
    if (resumen.areasSinResultados.length > 0) {
      console.log(
        colors.yellow(
          `Áreas sin resultados (${resumen.areasSinResultados.length}): ${resumen.areasSinResultados.join(", ")}`
        )
      );
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(colors.red(`Error fatal: ${error.message}`));
  process.exit(1);
});
