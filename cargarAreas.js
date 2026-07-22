const fs = require("fs");
const path = require("path");

/**
 * Carga áreas desde:
 * - Array clásico: [{ NombreArea, Referencia, Celdas }]
 * - Objeto multi-empresa: { Collective: [...], MAX: [...] }
 *
 * Devuelve lista plana con campo `empresa` en cada área.
 */
function cargarAreas(archivoAreas, options = {}) {
  const areasDir = options.areasDir || path.join(__dirname, "areas");
  const areasPath = path.join(areasDir, `${archivoAreas}.json`);

  if (!fs.existsSync(areasPath)) {
    throw new Error(`No se encontró el archivo de áreas: ${areasPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(areasPath, "utf-8"));
  return normalizarAreas(raw, archivoAreas, areasPath);
}

function normalizarAreas(raw, archivoAreas, areasPath) {
  if (Array.isArray(raw)) {
    const areas = raw.map((area) => ({
      ...area,
      empresa: archivoAreas,
    }));
    return {
      modo: "simple",
      archivo: archivoAreas,
      ruta: areasPath,
      empresas: [archivoAreas],
      areas,
    };
  }

  if (raw && typeof raw === "object") {
    const empresas = Object.keys(raw);
    const areas = [];

    for (const empresa of empresas) {
      const lista = raw[empresa];
      if (!Array.isArray(lista)) {
        throw new Error(
          `En ${archivoAreas}.json la empresa "${empresa}" debe ser un array de áreas`
        );
      }
      for (const area of lista) {
        areas.push({
          ...area,
          empresa,
        });
      }
    }

    return {
      modo: "multi",
      archivo: archivoAreas,
      ruta: areasPath,
      empresas,
      areas,
    };
  }

  throw new Error(
    `${archivoAreas}.json debe ser un array de áreas o un objeto { Empresa: [áreas] }`
  );
}

module.exports = { cargarAreas, normalizarAreas };
