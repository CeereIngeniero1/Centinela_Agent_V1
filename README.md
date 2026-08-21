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
├── areas/                      # Listas de áreas por empresa
│   ├── Collective.json         # Una empresa (array de áreas)
│   ├── MAX.json
│   ├── Operadora.json
│   └── Totas.json              # Multi-empresa (objeto por empresa)
├── base de datos/              # Resultados generados (no se versiona)
├── .bat/                       # Lanzadores Windows
├── buscaTitulos.js             # Búsqueda de títulos (STA)
├── visorGeografico.js          # Monitor de celdas (una empresa o Totas)
├── visorGeograficoGeneral.js   # Atajo: lee Totas.json en ciclo infinito
├── cargarAreas.js              # Carga formato simple o multi-empresa
├── unirAreas.js                # Une varios JSON de empresa en Totas.json
├── evaluarCelda.js             # Reglas de liberación / reapertura
├── centinelaRadicador.js       # Radicador automático Centinela V4
├── correo.js                   # Envío de alertas SMTP
├── config/centinela/           # Config radicador por empresa
│   ├── config.json
│   ├── empresas.json           # (local, no versionar)
│   └── empresas.example.json
└── .env.example                # Plantilla de variables SMTP
```

---

## Formato de áreas

### Una empresa (`areas/Collective.json`)

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

### Varias empresas (`areas/Totas.json`)

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

Genera `areas/Totas.json`. Con otro nombre de salida:

```bash
node unirAreas.js --out Totas Collective MAX Operadora
```

---

## Scripts disponibles

| Comando | Qué hace |
|--------|----------|
| `npm start` | Busca títulos con `Collective` (pasada única) |
| `npm run visor` | Visor geográfico solo Collective |
| `npm run visor:general` | Visor multi-empresa con `Totas.json` (ciclo infinito) |
| `npm run unir-areas` | Ayuda del unificador (pasa empresas como args) |

También puedes pasar la empresa/archivo por argumento:

```bash
node buscaTitulos.js Collective
node visorGeografico.js MAX
node visorGeograficoGeneral.js Totas
```

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

### 2. Visor geográfico (`visorGeografico.js` / `visorGeograficoGeneral.js`)

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

## Integración Centinela V4 (radicador automático)

Al detectar **liberación** (status → `A`), además del correo:

1. Lanza `radicadorBot.js` (vía `radicadorBuscadorTitulos.js`) con empresa, pin, **NombreArea** y la ruta a `areas/Totas.json`
2. Centinela lee esa área directamente desde Totas (no se crea JSON en `Centinela_V4/areas`)
3. El visor pausa unos segundos en esa área antes de continuar

### Configuración

Copia la plantilla y complétala:

```bash
copy config\centinela\empresas.example.json config\centinela\empresas.json
```

Edita [`config/centinela/empresas.json`](config/centinela/empresas.json) por cada empresa monitoreada:

| Campo | Descripción |
|-------|-------------|
| `activo` | `true` para habilitar el radicador automático |
| `empresa` | Clave en `InformacionEmpresas.json` de Centinela V4 |
| `codigoPin` | Clave en `Pines.json` de Centinela V4 |
| `agente` | `0` = login empresa · `1` = login agente |
| `userAgente` / `passAgente` | Credenciales agente (si `agente=1`; si `0` usa `-`) |

Rutas globales en [`config/centinela/config.json`](config/centinela/config.json):

- `centinelaV4Path`: ruta a Centinela V4 (default `C:\Centinela_V4`)
- `buscaTitulosAreasPath`: ruta al JSON de áreas (default `C:\BuscaTitulos\areas\Totas.json`)
- `radicadorScript`: script a lanzar (`radicadorBot.js`)
- `ventanaVisible`: abrir consola del radicador
- `pausaTrasLiberacionMs`: pausa tras lanzar el radicador

Equivalente manual:

```bash
node radicadorBuscadorTitulos.js CARNEOLA Co KAQ-11171PRUEBA 1 43987 "Sagitario_2026**" "C:\BuscaTitulos\areas\Totas.json"
```

Centinela busca en Totas la clave `CARNEOLA` y el `NombreArea` `KAQ-11171PRUEBA`, y radica solo esa área.

Ejemplo Collective con agente:

```json
{
  "Collective": {
    "activo": true,
    "empresa": "Collective",
    "codigoPin": "Co",
    "agente": 1,
    "userAgente": "43987",
    "passAgente": "tu_clave"
  }
}
```

> `config/centinela/empresas.json` está en `.gitignore` — no subas credenciales al repositorio.

El estado del radicador queda en cada JSON de celda: `alertas.liberacion.radicadorLanzado`, `radicadorFecha`, `radicadorError`.

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
