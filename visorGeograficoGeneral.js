/**
 * Visor geográfico multi-empresa.
 * Lee por defecto areas/Totas.json (objeto agrupado por empresa)
 * y busca todas las áreas sabiendo a qué empresa pertenece cada una.
 *
 * Uso:
 *   node visorGeograficoGeneral.js
 *   node visorGeograficoGeneral.js Totas
 */
if (!process.argv[2]) {
  process.argv[2] = "Totas";
}

require("./visorGeografico");
