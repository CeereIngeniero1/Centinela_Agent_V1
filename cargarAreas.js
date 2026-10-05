const fs = require("fs");
const path = require("path");

const AREAS_DIR = path.join(__dirname, "areas");

/** Ruta areas/<carpeta>/<archivo>.json; falla si no existe. */
function resolverRutaAreas(carpeta, archivo = carpeta, options = {}) {
  const areasDir = options.areasDir || AREAS_DIR;
  const ruta = path.join(areasDir, carpeta, `${archivo}.json`);
  if (!fs.existsSync(ruta)) {
    throw new Error(`No se encontró el archivo de áreas: ${ruta}`);
  }
  return ruta;
}

function conExtensionJson(texto) {
  return texto.toLowerCase().endsWith(".json") ? texto : `${texto}.json`;
}

/**
 * Localiza un JSON de áreas a partir de lo que escriba el usuario:
 * - Nombre: "KAQ-11171" → busca areas/<cualquier empresa>/KAQ-11171.json
 * - Empresa/archivo: "CARNEOLA/KAQ-11171" → areas/CARNEOLA/KAQ-11171.json
 * - Ruta absoluta o relativa a un .json
 */
function localizarArchivoAreas(entrada, options = {}) {
  const areasDir = options.areasDir || AREAS_DIR;
  const texto = String(entrada || "").trim();
  if (!texto) {
    throw new Error("Indica el JSON de áreas a consultar");
  }

  const tieneRuta = /[\\/]/.test(texto) || path.isAbsolute(texto);
  if (tieneRuta) {
    const archivo = conExtensionJson(texto);
    const candidatas = path.isAbsolute(archivo)
      ? [archivo]
      : [path.join(areasDir, archivo), path.resolve(archivo)];
    const ruta = candidatas.find((c) => fs.existsSync(c));
    if (!ruta) {
      throw new Error(`No se encontró el archivo de áreas: ${candidatas[0]}`);
    }
    return ruta;
  }

  const nombreArchivo = conExtensionJson(texto);
  const coincidencias = fs
    .readdirSync(areasDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(areasDir, d.name, nombreArchivo))
    .filter((ruta) => fs.existsSync(ruta));

  if (coincidencias.length === 1) {
    return coincidencias[0];
  }
  if (coincidencias.length > 1) {
    const opciones = coincidencias
      .map((r) => path.relative(areasDir, r).replace(/\\/g, "/").replace(/\.json$/i, ""))
      .join(", ");
    throw new Error(
      `"${texto}" existe en varias empresas. Indica cuál: ${opciones}`
    );
  }
  if (fs.existsSync(path.join(areasDir, nombreArchivo))) {
    throw new Error(
      `${nombreArchivo} está suelto en ${areasDir}. Muévelo a areas/<Empresa>/${nombreArchivo} para saber de qué empresa es`
    );
  }
  throw new Error(
    `No se encontró ${nombreArchivo} en ninguna carpeta de empresa dentro de ${areasDir}`
  );
}

/** Empresa = nombre de la carpeta, si el archivo está en areas/<Empresa>/. */
function empresaDeCarpeta(ruta, areasDir = AREAS_DIR) {
  const carpeta = path.dirname(path.resolve(ruta));
  if (path.dirname(carpeta) !== path.resolve(areasDir)) {
    return null;
  }
  return path.basename(carpeta);
}

/**
 * Carga un JSON de áreas y asigna `empresa` a cada área:
 * - Array [{ NombreArea, Referencia, Celdas }]: empresa = carpeta areas/<Empresa>/
 * - Objeto { Collective: [...], MAX: [...] }: empresa = cada clave
 */
function cargarAreas(entrada, options = {}) {
  const areasDir = options.areasDir || AREAS_DIR;
  const ruta = localizarArchivoAreas(entrada, { areasDir });
  const raw = JSON.parse(fs.readFileSync(ruta, "utf-8"));
  const nombre = path.basename(ruta, path.extname(ruta));

  if (Array.isArray(raw)) {
    const empresa = empresaDeCarpeta(ruta, areasDir);
    if (!empresa) {
      throw new Error(
        `No se puede saber la empresa de ${ruta}. Muévelo a areas/<Empresa>/ o usa el formato { "Empresa": [áreas] }`
      );
    }
    return {
      modo: "simple",
      nombre,
      ruta,
      empresas: [empresa],
      areas: raw.map((area) => ({ ...area, empresa })),
    };
  }

  if (raw && typeof raw === "object") {
    const empresas = Object.keys(raw);
    const areas = [];
    for (const empresa of empresas) {
      const lista = raw[empresa];
      if (!Array.isArray(lista)) {
        throw new Error(
          `En ${ruta} la empresa "${empresa}" debe ser un array de áreas`
        );
      }
      for (const area of lista) {
        areas.push({ ...area, empresa });
      }
    }
    return { modo: "multi", nombre, ruta, empresas, areas };
  }

  throw new Error(
    `${ruta} debe ser un array de áreas o un objeto { Empresa: [áreas] }`
  );
}

module.exports = {
  AREAS_DIR,
  resolverRutaAreas,
  localizarArchivoAreas,
  cargarAreas,
};
