const fs = require("fs");
const path = require("path");

const CONFIG_DIR = path.join(__dirname, "config", "centinela");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const EMPRESAS_PATH = path.join(CONFIG_DIR, "empresas.json");
const ARCHIVO_AREA_A_RADICAR = "areaARadicar.json";
const CENTINELA_V4_PATH_DEFAULT = "C:\\Centinela_V4";

let configCache = null;
let empresasCache = null;

function leerJsonOpcional(ruta) {
  if (!fs.existsSync(ruta)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(ruta, "utf-8"));
}

function cargarConfigCentinela() {
  if (!configCache) {
    configCache = leerJsonOpcional(CONFIG_PATH);
  }
  if (!empresasCache) {
    empresasCache = leerJsonOpcional(EMPRESAS_PATH);
  }
  return { config: configCache, empresas: empresasCache };
}

/**
 * Centinela lee <centinelaV4Path>/areas/<Empresa>/areaARadicar.json.
 * <Empresa> es el campo `empresa` de config/centinela/empresas.json, o la
 * misma empresa de BuscaTitulos si no está mapeada.
 */
function rutaAreaARadicar(empresa) {
  const { config, empresas } = cargarConfigCentinela();
  const centinelaRoot = config.centinelaV4Path || CENTINELA_V4_PATH_DEFAULT;
  const empresaCentinela = empresas[empresa]?.empresa || empresa;

  const carpetaEmpresa = path.join(centinelaRoot, "areas", empresaCentinela);
  if (!fs.existsSync(carpetaEmpresa)) {
    throw new Error(
      `No existe la carpeta de la empresa en Centinela: ${carpetaEmpresa}`
    );
  }
  return path.join(carpetaEmpresa, ARCHIVO_AREA_A_RADICAR);
}

function areaTieneDatos(area) {
  if (!area) return false;
  const referencia = String(area.Referencia || "").trim();
  const celdas = Array.isArray(area.Celdas) ? area.Celdas : [];
  return (
    referencia.length > 0 &&
    celdas.some((c) => String(c || "").trim().length > 0)
  );
}

/**
 * Agrega el área a areaARadicar.json de su empresa en Centinela.
 * Descarta la plantilla vacía y reemplaza una entrada previa con el mismo NombreArea.
 */
function encolarAreaARadicar(registro) {
  const destino = rutaAreaARadicar(registro.empresa);
  const entrada = {
    NombreArea: registro.NombreArea,
    Referencia: registro.Referencia,
    Celdas: registro.Celdas?.length ? registro.Celdas : [registro.Referencia],
  };

  let actuales = [];
  if (fs.existsSync(destino)) {
    try {
      const raw = JSON.parse(fs.readFileSync(destino, "utf-8"));
      if (Array.isArray(raw)) {
        actuales = raw;
      }
    } catch (_) {
      actuales = [];
    }
  }

  const areas = actuales.filter(
    (a) => areaTieneDatos(a) && a.NombreArea !== entrada.NombreArea
  );
  areas.push(entrada);

  fs.writeFileSync(destino, JSON.stringify(areas, null, 2), "utf-8");
  return destino;
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
  rutaAreaARadicar,
  encolarAreaARadicar,
  obtenerPausaTrasLiberacionMs,
};
