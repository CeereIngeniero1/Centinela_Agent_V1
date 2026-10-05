# Centinela Agent V1

Automatización en Node.js + Puppeteer para monitorear títulos y celdas mineras en el [SIGM de la ANM](https://annamineria.anm.gov.co/sigm/externalLogin).

El agente abre Microsoft Edge, consulta el portal público y guarda resultados en JSON. En el visor geográfico también detecta posibles liberaciones o reaperturas y envía alertas por correo.

---

## Requisitos

- Windows
- [Node.js](https://nodejs.org/) 16 o superior
- Microsoft Edge instalado en:
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- Acceso a internet hacia `annamineria.anm.gov.co`
- (Opcional) Cuenta SMTP para alertas por correo

---

## Instalación

```bash
git clone https://github.com/CeereIngeniero1/Centinela_Agent_V1.git
cd Centinela_Agent_V1
npm install
```

Configura el correo (solo si vas a usar el visor con alertas):

```bash
copy .env.example .env
```

Edita `.env` y define al menos:

```env
SMTP_HOST=mail.ceere.net
SMTP_PORT=465
SMTP_USER=tu_usuario@dominio.com
SMTP_PASS=tu_contraseña
SMTP_TO=destino1@correo.com, destino2@correo.com
EQUIPO_ACTUAL=NombreDelPC
```

> En Windows puedes definir esas variables en el sistema o exportarlas en la terminal antes de ejecutar. El proyecto lee `process.env` (no carga `.env` automáticamente).

---

## Estructura del proyecto

```
├── areas/                      # Una subcarpeta por empresa
│   ├── Collective/
│   │   ├── Collective.json     # Archivo por defecto de la empresa
│   │   └── 508750.json         # Otros archivos opcionales
│   ├── CARNEOLA/CARNEOLA.json
│   ├── MAX/MAX.json
│   ├── Operadora/Operadora.json
│   └── Totas/Totas.json        # Multi-empresa (objeto por empresa)
├── base de datos/              # Resultados generados (no se versiona)
├── .bat/                       # Lanzadores Windows
├── buscaTitulos.js             # Búsqueda de títulos (STA)
├── visorGeografico.js          # Visor único: monitor de celdas de cualquier JSON de áreas
├── cargarAreas.js              # Localiza el JSON y deduce la empresa
├── unirAreas.js                # Une varios JSON de empresa en Totas.json
├── evaluarCelda.js             # Reglas de liberación / reapertura
├── centinelaRadicador.js       # Envía áreas liberadas a areaARadicar.json de Centinela V4
├── correo.js                   # Envío de alertas SMTP
├── config/centinela/           # Ruta de Centinela y nombres de empresa
│   ├── config.json
│   ├── empresas.json           # (local, no versionar)
│   └── empresas.example.json
└── .env.example                # Plantilla de variables SMTP
```

---

## Formato de áreas

Solo hay que indicar qué JSON consultar; la empresa se deduce sola:

- **Lista de áreas** dentro de `areas/<Empresa>/`: la empresa es el nombre de la carpeta. El JSON no necesita indicar la empresa.
- **Objeto multi-empresa** (`areas/Totas/Totas.json`): la empresa es cada clave del objeto.

Un JSON tipo lista suelto en `areas/` (fuera de una carpeta de empresa) da error, porque no hay forma de saber de qué empresa es.

### Una empresa (`areas/Collective/Collective.json`)

```json
[
  {
    "NombreArea": "508750",
    "Referencia": "18N05A25M10T",
    "Celdas": ["18N05A25M10T, 18N05A25M10U"]
  }
]
```

- `NombreArea`: expediente / nombre lógico del área
- `Referencia`: `CELL_KEY_ID` que se busca en el visor
- `Celdas`: listado auxiliar (la consulta usa `Referencia`)

### Varias empresas (`areas/Totas/Totas.json`)

```json
{
  "Collective": [ { "NombreArea": "...", "Referencia": "...", "Celdas": [] } ],
  "MAX": [ ... ],
  "Operadora": [ ... ]
}
```

Cada área se guarda y alerta bajo su empresa:

`base de datos/validacion por celda/<empresa>/<NombreArea>/<NombreArea>.json`

---

## Cómo unir empresas

Si tienes un JSON por empresa y quieres un solo archivo multi-empresa:

```bash
node unirAreas.js Collective MAX Operadora
```

Lee `areas/<Empresa>/<Empresa>.json` de cada una y genera `areas/Totas/Totas.json`. Con otro nombre de salida:

```bash
node unirAreas.js --out Totas Collective MAX Operadora
```

---

## Scripts disponibles

| Comando | Qué hace |
|--------|----------|
| `npm start` | Busca títulos con `Collective` (pasada única) |
| `npm run visor` | Visor geográfico solo Collective |
| `npm run visor:general` | Visor con `Totas.json` (todas las empresas, ciclo infinito) |
| `npm run unir-areas` | Ayuda del unificador (pasa empresas como args) |

Ambos scripts reciben solo el JSON a consultar (sin `.json`). Sin argumento, el visor usa `Totas`:

```bash
node visorGeografico.js                      # areas/Totas/Totas.json
node visorGeografico.js CARNEOLA             # areas/CARNEOLA/CARNEOLA.json → empresa CARNEOLA
node visorGeografico.js 508750               # busca 508750.json en todas las carpetas de empresa
node visorGeografico.js Collective/508750    # si el mismo nombre existe en varias empresas
node visorGeografico.js "C:\ruta\areas.json" # ruta completa
node buscaTitulos.js Collective              # areas/Collective/Collective.json
```

Si un nombre existe en varias carpetas, el visor se detiene y lista las opciones (`Empresa/archivo`).

Lanzadores `.bat`:

- `.bat\Collective.bat` → búsqueda de títulos
- `.bat\VisorGeografico.bat` → visor Collective
- `.bat\VisorGeograficoGeneral.bat` → visor Totas (todas las empresas)

---

## Pipelines

### 1. Búsqueda de títulos (`buscaTitulos.js`)

1. Abre la búsqueda pública STA del SIGM
2. Consulta cada `NombreArea` como expediente
3. Guarda un snapshot con fecha en `base de datos/<empresa>/`

Ejecución: **una sola pasada**.

### 2. Visor geográfico (`visorGeografico.js`)

1. Abre el Visor Geográfico (Html5Viewer)
2. Consulta la capa **Celda** filtrando por `CELL_KEY_ID` = `Referencia`
3. Compara con el JSON anterior de esa área
4. Si detecta liberación o reapertura, envía correo
5. Al terminar todas las áreas, **espera y reinicia el ciclo** (modo infinito)

Detener: **Ctrl+C**

Espera entre ciclos (segundos):

```bash
set ESPERA_ENTRE_CICLOS_MS=60000
npm run visor:general
```

---

## Alertas por correo

| Tipo | Condición | Asunto / mensaje |
|------|-----------|------------------|
| Liberación (1) | Status pasa a `A` (desde otro distinto de `A`) | Posible área liberada |
| Reapertura (3) | `CELL_REOPENING_DATE` es una fecha futura | Área con fecha de reapertura |

Las alertas son idempotentes: si ya se envió (`alertas.*.enviado`), no se reenvía.

---

## Integración Centinela V4 (área a radicar)

Cuando un área **se libera** (status pasa a `A` desde otro distinto) y además **no tiene reopen o la reopen es posterior a la fecha y hora actual**, el visor la escribe en:

`C:\Centinela_V4\areas\<Empresa>\areaARadicar.json`

El visor de Centinela de esa empresa (p. ej. `CARNEOLAVisor.js`), que está esperando en el PIN, toma el área y la radica. El visor de BuscaTitulos pausa unos segundos y continúa.

- Si la carpeta de la empresa no existe en Centinela, no se crea: se muestra `Error escribiendo areaARadicar.json` en consola.
- Si una reopen ya pasó, se registra la liberación pero no se envía a radicar.
- Cada área se envía una sola vez (`alertas.liberacion.areaARadicarEscrito` en su JSON de celda).

### Configuración

[`config/centinela/config.json`](config/centinela/config.json):

- `centinelaV4Path`: ruta a Centinela V4 (default `C:\Centinela_V4`)
- `pausaTrasLiberacionMs`: pausa tras enviar un área a radicar (default 5000)

[`config/centinela/empresas.json`](config/centinela/empresas.example.json) es opcional y solo traduce nombres: si la empresa se llama distinto en BuscaTitulos y en las carpetas de Centinela, pon el nombre de Centinela en `empresa`. Si no está, se usa el mismo nombre.

```json
{
  "CARNEOLA": { "empresa": "CARNEOLA" }
}
```

---

## Resultados

- Títulos: `base de datos/<empresa>/<fecha>.json`
- Celdas: `base de datos/validacion por celda/<empresa>/<área>/<área>.json`

Cada JSON de celda incluye atributos del visor (`CELL_STATUS_CODE`, `CELL_REOPENING_DATE`, etc.) y el estado de alertas.

---

## Solución de problemas

| Problema | Qué revisar |
|----------|-------------|
| No encuentra Edge | Ruta hardcodeada en los scripts; ajústala si Edge está en otra carpeta |
| Timeout del visor | El portal puede tardar; el script reintenta hasta varios minutos |
| No envía correo | Define `SMTP_PASS` en el entorno; sin eso falla a propósito |
| Área no encontrada | Verifica `Referencia` / `CELL_KEY_ID` en el JSON de áreas |
| Selectores rotos | El SIGM cambió de UI; hay que actualizar XPath/selectores en el script |

---

## Seguridad

- **No subas** `.env` ni contraseñas al repositorio
- Usa `.env.example` solo como plantilla
- El directorio `base de datos/` no se versiona (datos locales de ejecución)

---

## Licencia

ISC — Ceere Software
