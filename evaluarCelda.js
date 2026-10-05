const colors = require("colors");
const { correo } = require("./correo");
const { encolarAreaARadicar } = require("./centinelaRadicador");

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
      areaARadicarEscrito: Boolean(
        anterior?.alertas?.liberacion?.areaARadicarEscrito
      ),
      areaARadicarFecha: anterior?.alertas?.liberacion?.areaARadicarFecha || null,
      areaARadicarError: null,
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

/** Se encola si no hay reopen, o si la reopen es posterior a la fecha y hora actual. */
function cumpleReopenParaEncolar(textoFecha) {
  const limpio = String(textoFecha || "").trim();
  if (!limpio) {
    return { ok: true, motivo: "sin reopen" };
  }
  const fecha = parseFechaReapertura(limpio);
  if (!fecha) {
    return { ok: true, motivo: "sin reopen válida" };
  }
  if (fecha.getTime() > Date.now()) {
    return { ok: true, motivo: `reopen futura (${limpio})` };
  }
  return { ok: false, motivo: `reopen no futura (${limpio})` };
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

  const reopen = cumpleReopenParaEncolar(registro.atributos?.CELL_REOPENING_DATE);

  if (cambios.liberacion && alertas.liberacion.areaARadicarEscrito) {
    console.log(
      colors.yellow("  Área ya enviada a areaARadicar.json, omitiendo")
    );
  } else if (cambios.liberacion && !reopen.ok) {
    console.log(
      colors.yellow(`  Liberación detectada, pero ${reopen.motivo} → no se envía a radicar`)
    );
  } else if (cambios.liberacion) {
    try {
      const destino = encolarAreaARadicar({ ...registro, empresa });
      alertas.liberacion.areaARadicarEscrito = true;
      alertas.liberacion.areaARadicarFecha = new Date().toISOString();
      console.log(
        colors.green(
          `  AREA A RADICAR: ${registro.NombreArea} → ${destino} (${reopen.motivo})`
        )
      );
    } catch (error) {
      alertas.liberacion.areaARadicarError = error.message;
      console.log(
        colors.red(`  Error escribiendo areaARadicar.json: ${error.message}`)
      );
    }
  }

  // Un correo de liberación que falló se reintenta en los ciclos siguientes mientras siga libre
  const correoLiberacionPendiente =
    !cambios.liberacion &&
    !alertas.liberacion.enviado &&
    Boolean(anterior?.alertas?.liberacion?.errorEnvio) &&
    registro.atributos?.CELL_STATUS_CODE === "A";

  if ((cambios.liberacion || correoLiberacionPendiente) && !alertas.liberacion.enviado) {
    if (correoLiberacionPendiente) {
      console.log(colors.cyan("  Reintentando correo de liberación pendiente..."));
    }
    try {
      await correo(1, registro.NombreArea, registro.Referencia, { empresa });
      alertas.liberacion.enviado = true;
      alertas.liberacion.fechaEnvio = new Date().toISOString();
      console.log(
        colors.green("  ALERTA: Posible área liberada → correo enviado")
      );
    } catch (error) {
      alertas.liberacion.errorEnvio = error.message;
      console.log(
        colors.red(
          `  Error enviando correo liberación (se reintentará en el próximo ciclo): ${error.message}`
        )
      );
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
  cumpleReopenParaEncolar,
  describirEstadoCelda,
  evaluarCambiosCelda,
  procesarAlertasYCorreo,
};
