const fs = require("fs");
const path = require("path");
const colors = require("colors");

/**
 * Une varios JSON de empresa (arrays) en un solo archivo multi-empresa.
 *
 * Uso:
 *   node unirAreas.js Collective MAX Operadora
 *   node unirAreas.js --out Totas Collective MAX Operadora
 *
 * Genera areas/Totas.json con forma:
 * {
 *   "Collective": [ ... ],
 *   "MAX": [ ... ],
 *   "Operadora": [ ... ]
 * }
 */
const AREAS_DIR = path.join(__dirname, "areas");

function parseArgs(argv) {
  const args = argv.slice(2);
  let salida = "Totas";
  const empresas = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" || args[i] === "-o") {
      salida = args[++i];
      continue;
    }
    empresas.push(args[i]);
  }

  return { salida, empresas };
}

function leerAreasEmpresa(nombreEmpresa) {
  const ruta = path.join(AREAS_DIR, `${nombreEmpresa}.json`);
  if (!fs.existsSync(ruta)) {
    throw new Error(`No existe: ${ruta}`);
  }

  const datos = JSON.parse(fs.readFileSync(ruta, "utf-8"));
  if (!Array.isArray(datos)) {
    throw new Error(
      `${nombreEmpresa}.json debe ser un array de áreas (formato simple por empresa)`
    );
  }
  return datos;
}

function main() {
  const { salida, empresas } = parseArgs(process.argv);

  if (empresas.length === 0) {
    console.error(
      colors.red(
        "Uso: node unirAreas.js [--out Totas] Collective MAX Operadora"
      )
    );
    process.exit(1);
  }

  const resultado = {};
  let total = 0;

  for (const empresa of empresas) {
    const areas = leerAreasEmpresa(empresa);
    resultado[empresa] = areas;
    total += areas.length;
    console.log(
      colors.cyan(`  ${empresa}: ${areas.length} área(s)`)
    );
  }

  const rutaSalida = path.join(AREAS_DIR, `${salida}.json`);
  fs.writeFileSync(rutaSalida, JSON.stringify(resultado, null, 2), "utf-8");

  console.log(
    colors.green(
      `\nUnidas ${empresas.length} empresa(s), ${total} áreas → ${rutaSalida}`
    )
  );
}

main();
