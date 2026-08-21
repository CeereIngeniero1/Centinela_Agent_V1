const colors = require("colors");
const { correo } = require("./correo");
const { lanzarRadicadorLiberacion } = require("./centinelaRadicador");

const MESES = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function parseFechaReapertura(texto) {
  if (!texto || typeof texto !== "string") {
    return null;
  }

  const limpio = texto.trim();
  if (!limpio) {
    return null;
  }

  const match = limpio.match(
    /^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i
  );
  if (!match) {
    const fecha = new Date(limpio);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  const mes = MESES[match[1].toLowerCase()];
  if (mes === undefined) {
    return null;
  }

  let horas = Number(match[4]);
  const minutos = Number(match[5]);
  const meridiano = match[6].toUpperCase();

  if (meridiano === "PM" && horas < 12) {
    horas += 12;
  }
  if (meridiano === "AM" && horas === 12) {
    horas = 0;
  }

  return new Date(Number(match[3]), mes, Number(match[2]), horas, minutos, 0, 0);
}

function inicioDelDia(fecha = new Date()) {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
}

function esFechaFutura(fecha) {
  if (!fecha) {
    return false;
  }
  return fecha.getTime() > inicioDelDia().getTime();
}

function crearEstadoAlertasBase(anterior, registro) {
  const statusAnterior =
    anterior?.atributos?.CELL_STATUS_CODE ||
    anterior?.alertas?.liberacion?.statusActual ||
    null;
  const statusActual = registro.atributos?.CELL_STATUS_CODE || null;
  const fechaAnterior =
    anterior?.atributos?.CELL_REOPENING_DATE ||
    anterior?.alertas?.reapertura?.fechaActual ||
    "";
  const fechaActual = registro.atributos?.CELL_REOPENING_DATE || "";

  return {
    liberacion: {
      enviado: Boolean(anterior?.alertas?.liberacion?.enviado),
      fechaEnvio: anterior?.alertas?.liberacion?.fechaEnvio || null,
      statusAnterior,
      statusActual,
      errorEnvio: null,
      radicadorLanzado: Boolean(anterior?.alertas?.liberacion?.radicadorLanzado),
      radicadorFecha: anterior?.alertas?.liberacion?.radicadorFecha || null,
      radicadorError: null,
    },
    reapertura: {
      enviado: Boolean(anterior?.alertas?.reapertura?.enviado),
      fechaEnvio: anterior?.alertas?.reapertura?.fechaEnvio || null,
      fechaAnterior,
      fechaActual,
      errorEnvio: null,
    },
  };
}

function describirEstadoCelda(atributos) {
  const codigo = atributos?.CELL_STATUS_CODE;
  if (!codigo) {
    return { mensaje: "Estado: desconocido (sin CELL_STATUS_CODE)", libre: null };
  }
  if (codigo === "A") {
    return { mensaje: "Estado: LIBRE (A)", libre: true };
  }
  return { mensaje: `Estado: NO LIBRE (${codigo})`, libre: false };
}

function evaluarCambiosCelda(anterior, registro) {
  const statusAnterior = anterior?.atributos?.CELL_STATUS_CODE || null;
  const statusActual = registro.atributos?.CELL_STATUS_CODE || null;
  const fechaAnteriorTexto = anterior?.atributos?.CELL_REOPENING_DATE || "";
  const fechaActualTexto = registro.atributos?.CELL_REOPENING_DATE || "";

  const fechaAnterior = parseFechaReapertura(fechaAnteriorTexto);
  const fechaActual = parseFechaReapertura(fechaActualTexto);

  const liberacion =
    Boolean(anterior) &&
    statusAnterior !== "A" &&
    statusActual === "A";

  const reapertura = esFechaFutura(fechaActual);

  return {
    liberacion,
    reapertura,
    detalle: {
      statusAnterior,
      statusActual,
      fechaAnterior: fechaAnteriorTexto,
      fechaActual: fechaActualTexto,
    },
  };
}

async function procesarAlertasYCorreo({ anterior, registro, empresa }) {
  if (registro.sinResultados || registro.error) {
    registro.alertas = crearEstadoAlertasBase(anterior, registro);
    return registro.alertas;
  }

  const alertas = crearEstadoAlertasBase(anterior, registro);
  const cambios = evaluarCambiosCelda(anterior, registro);

  if (cambios.liberacion && !alertas.liberacion.radicadorLanzado) {
    const resultado = await lanzarRadicadorLiberacion({ empresa, registro });
    if (resultado.ok) {
      alertas.liberacion.radicadorLanzado = true;
      alertas.liberacion.radicadorFecha = new Date().toISOString();
    } else if (!resultado.omitido) {
      alertas.liberacion.radicadorError = resultado.error;
    }
  } else if (cambios.liberacion && alertas.liberacion.radicadorLanzado) {
    console.log(
      colors.yellow("  Radicador ya lanzado previamente, omitiendo")
    );
  }

  if (cambios.liberacion && !alertas.liberacion.enviado) {
    try {
      await correo(1, registro.NombreArea, registro.Referencia, { empresa });
      alertas.liberacion.enviado = true;
      alertas.liberacion.fechaEnvio = new Date().toISOString();
      console.log(
        colors.green("  ALERTA: Posible área liberada → correo enviado")
      );
    } catch (error) {
      alertas.liberacion.errorEnvio = error.message;
      console.log(colors.red(`  Error enviando correo liberación: ${error.message}`));
    }
  } else if (cambios.liberacion && alertas.liberacion.enviado) {
    console.log(
      colors.yellow("  Alerta liberación ya enviada previamente, omitiendo correo")
    );
  }

  if (cambios.reapertura && !alertas.reapertura.enviado) {
    try {
      await correo(3, registro.NombreArea, registro.Referencia, { empresa });
      alertas.reapertura.enviado = true;
      alertas.reapertura.fechaEnvio = new Date().toISOString();
      console.log(
        colors.green("  ALERTA: Reapertura detectada → correo enviado")
      );
    } catch (error) {
      alertas.reapertura.errorEnvio = error.message;
      console.log(colors.red(`  Error enviando correo reapertura: ${error.message}`));
    }
  } else if (cambios.reapertura && alertas.reapertura.enviado) {
    console.log(
      colors.yellow("  Alerta reapertura ya enviada previamente, omitiendo correo")
    );
  }

  registro.alertas = alertas;
  return alertas;
}

module.exports = {
  parseFechaReapertura,
  esFechaFutura,
  describirEstadoCelda,
  evaluarCambiosCelda,
  procesarAlertasYCorreo,
};
