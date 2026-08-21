const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const colors = require("colors");

const CONFIG_DIR = path.join(__dirname, "config", "centinela");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const EMPRESAS_PATH = path.join(CONFIG_DIR, "empresas.json");

let configCache = null;
let empresasCache = null;

function cargarConfigCentinela() {
  if (!configCache) {
    if (!fs.existsSync(CONFIG_PATH)) {
      throw new Error(`No existe ${CONFIG_PATH}`);
    }
    configCache = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  }
  if (!empresasCache) {
    if (!fs.existsSync(EMPRESAS_PATH)) {
      throw new Error(`No existe ${EMPRESAS_PATH}`);
    }
    empresasCache = JSON.parse(fs.readFileSync(EMPRESAS_PATH, "utf-8"));
  }
  return { config: configCache, empresas: empresasCache };
}

function validarEmpresa(empresaKey) {
  const { empresas } = cargarConfigCentinela();
  const cfg = empresas[empresaKey];

  if (!cfg) {
    return { ok: false, error: `Empresa "${empresaKey}" no está en empresas.json` };
  }
  if (!cfg.activo) {
    return { ok: false, error: "radicador inactivo (activo: false)" };
  }
  if (!cfg.empresa) {
    return { ok: false, error: "Falta campo empresa" };
  }
  if (!cfg.codigoPin) {
    return { ok: false, error: "Falta codigoPin" };
  }
  if (cfg.agente !== 0 && cfg.agente !== 1) {
    return { ok: false, error: "agente debe ser 0 o 1" };
  }
  if (cfg.agente === 1) {
    if (!cfg.userAgente) {
      return { ok: false, error: "Falta userAgente (agente=1)" };
    }
    if (!cfg.passAgente) {
      return { ok: false, error: "Falta passAgente (agente=1)" };
    }
  }

  return { ok: true, cfg };
}

function resolverRutaAreasBuscaTitulos(config, registro) {
  const configurada = config.buscaTitulosAreasPath;
  if (configurada) {
    const absoluta = path.isAbsolute(configurada)
      ? configurada
      : path.join(__dirname, configurada);
    if (!fs.existsSync(absoluta)) {
      throw new Error(`No existe buscaTitulosAreasPath: ${absoluta}`);
    }
    return absoluta;
  }

  // Fallback: areas/<archivoAreas>.json del propio monitoreo
  const nombre = registro.archivoAreas || "Totas";
  const fallback = path.join(__dirname, "areas", `${nombre}.json`);
  if (!fs.existsSync(fallback)) {
    throw new Error(
      `No hay buscaTitulosAreasPath en config y no existe ${fallback}`
    );
  }
  return fallback;
}

function resolverScriptRadicador(config) {
  const centinelaRoot = config.centinelaV4Path;
  const solicitado = config.radicadorScript || "radicadorBot.js";
  const botPath = path.join(centinelaRoot, "radicadorBot.js");
  const launcherPath = path.join(centinelaRoot, "radicadorBuscadorTitulos.js");

  if (!fs.existsSync(botPath)) {
    throw new Error(`No existe el radicador: ${botPath}`);
  }

  // radicadorBot.js requiere radicadorConfig inicializado; el launcher con parámetros es radicadorBuscadorTitulos.js
  if (
    solicitado === "radicadorBot.js" ||
    path.basename(solicitado) === "radicadorBot.js"
  ) {
    if (!fs.existsSync(launcherPath)) {
      throw new Error(`No existe el launcher: ${launcherPath}`);
    }
    return { scriptPath: launcherPath, scriptFinal: "radicadorBot.js" };
  }

  const scriptPath = path.join(centinelaRoot, solicitado);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`No existe el radicador: ${scriptPath}`);
  }
  return { scriptPath, scriptFinal: path.basename(scriptPath) };
}

function spawnRadicador({ config, cfg, nombreArea, areasSourcePath }) {
  const { scriptPath, scriptFinal } = resolverScriptRadicador(config);

  const spawnArgs = [
    cfg.empresa,
    cfg.codigoPin,
    nombreArea,
    String(cfg.agente),
    cfg.agente === 1 ? cfg.userAgente : "-",
    cfg.agente === 1 ? cfg.passAgente : "-",
    areasSourcePath,
  ];

  const ventanaVisible = config.ventanaVisible !== false;
  const spawnOptions = {
    cwd: config.centinelaV4Path,
    detached: true,
    stdio: ventanaVisible ? "inherit" : "ignore",
    windowsHide: !ventanaVisible,
  };

  // CREATE_NEW_CONSOLE: abre ventana de consola en Windows sin depender de cmd "start".
  if (ventanaVisible && process.platform === "win32") {
    spawnOptions.creationFlags = 0x00000010;
  }

  const child = spawn(process.execPath, [scriptPath, ...spawnArgs], spawnOptions);
  child.unref();

  return { pid: child.pid, nombreArea, visible: ventanaVisible, scriptFinal };
}

async function lanzarRadicadorLiberacion({ empresa, registro }) {
  try {
    const validacion = validarEmpresa(empresa);
    if (!validacion.ok) {
      console.log(
        colors.yellow(`  Radicador omitido: ${validacion.error}`)
      );
      return { ok: false, error: validacion.error, omitido: true };
    }

    const { config } = cargarConfigCentinela();
    const nombreArea = registro.NombreArea;
    if (!nombreArea) {
      throw new Error("El registro no tiene NombreArea");
    }

    const areasSourcePath = resolverRutaAreasBuscaTitulos(config, registro);
    const { pid, visible, scriptFinal } = spawnRadicador({
      config,
      cfg: validacion.cfg,
      nombreArea,
      areasSourcePath,
    });

    console.log(
      colors.green(
        `  RADICADOR: ${empresa} / ${nombreArea} desde ${areasSourcePath} → ${scriptFinal} ${
          visible ? "en ventana visible" : "en segundo plano"
        } (PID ${pid})`
      )
    );

    return {
      ok: true,
      nombreArea,
      areasSourcePath,
      pid,
    };
  } catch (error) {
    console.log(colors.red(`  Error lanzando radicador: ${error.message}`));
    return { ok: false, error: error.message };
  }
}

function obtenerPausaTrasLiberacionMs() {
  try {
    const { config } = cargarConfigCentinela();
    return Number(config.pausaTrasLiberacionMs) || 5000;
  } catch (_) {
    return 5000;
  }
}

module.exports = {
  cargarConfigCentinela,
  validarEmpresa,
  lanzarRadicadorLiberacion,
  obtenerPausaTrasLiberacionMs,
};
