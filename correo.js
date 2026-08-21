const path = require("path");
const nodemailer = require("nodemailer");
const os = require("os");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const SMTP_HOST = process.env.SMTP_HOST || "mail.ceere.net";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || "correomineria2@ceere.net";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_TO = process.env.SMTP_TO || "Soporte2ceere@gmail.com";

function obtenerMensajeTipo(tipo, area, empresa, equipoActual) {
  switch (tipo) {
    case 1:
      return {
        msg: `¡¡¡Posible Area Liberada!!! ${equipoActual} ${area} ${empresa}`,
        color: "#0eff16ff",
        texto: "POSIBLE AREA LIBERADA",
      };
    case 3:
      return {
        msg: `¡¡¡Area Con fecha de Reapertura!!! ${equipoActual} ${area} ${empresa}`,
        color: "#427345ff",
        texto: "AREA CON REAPERTURA",
      };
    default:
      throw new Error(`Tipo de correo no soportado: ${tipo}`);
  }
}

function crearTransporter() {
  if (!SMTP_PASS) {
    throw new Error(
      "Falta SMTP_PASS. Copia .env.example a .env y define la contraseña SMTP."
    );
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    secureConnection: false,
    port: SMTP_PORT,
    tls: {
      ciphers: "SSLv3",
    },
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

async function enviarCorreo(tipo, area, celda, empresa, equipoActual) {
  const { msg, color, texto } = obtenerMensajeTipo(
    tipo,
    area,
    empresa,
    equipoActual
  );
  const transporter = crearTransporter();

  const mailOptions = {
    from: `${msg} "Ceere" <${SMTP_USER}>`,
    to: SMTP_TO,
    subject: `LA AREA ES-> ${area}`,
    text: `LA AREA ES-> ${area} ${celda}`,
    html: `
      <html>
        <head>
          <style>
            .container {
              font-family: Arial, sans-serif;
              max-width: 600px;
              margin: auto;
              padding: 20px;
              border: 1px solid #ddd;
              border-radius: 5px;
              background-color: #f9f9f9;
            }
            .header {
              background-color: ${color};
              color: white;
              padding: 10px;
              text-align: center;
              border-radius: 5px 5px 0 0;
            }
            .content { margin: 20px 0; }
            .footer {
              text-align: center;
              padding: 10px;
              font-size: 12px;
              color: #777;
              border-top: 1px solid #ddd;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h3>${texto}</h3></div>
            <div class="content">
              <p><strong>Detalles:</strong></p>
              <ul>
                <li><strong>Empresa:</strong><br>${empresa}</li>
                <li><strong>Area:</strong><br>${area}</li>
                <li><strong>Celda:</strong><br>${celda}</li>
                <li><strong>Equipo Actual:</strong><br>${equipoActual}</li>
              </ul>
            </div>
            <div class="footer">
              <p>Creado por Ceere Software - © 2024 Todos los derechos reservados</p>
            </div>
          </div>
        </body>
      </html>
    `,
  };

  const info = await transporter.sendMail(mailOptions);
  return info.response;
}

async function correo(tipo, area, celda, options = {}) {
  const empresa = options.empresa || "Collective";
  const equipoActual = options.equipoActual || process.env.EQUIPO_ACTUAL || os.hostname();
  return enviarCorreo(tipo, area, celda, empresa, equipoActual);
}

module.exports = { correo, enviarCorreo };
