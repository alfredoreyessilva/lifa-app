# Calendarios de Fútbol Americano México (LIFA App)

App full-stack para publicar calendarios, resultados y transmisiones de ligas de fútbol americano en México. Cada usuario puede administrar varias organizaciones desde una sola cuenta (ligas, equipos, y más adelante empresas/medios); los equipos pueden entregarse como perfil independiente a su propio representante.

## Stack real

|Parte|Tecnología|
|-|-|
|Backend|Node.js + Express|
|Base de datos|PostgreSQL, hosteado en [Neon](https://neon.tech) (plan gratuito)|
|Frontend|React + Vite|
|Imágenes (logos, fotos)|Cloudinary (plan gratuito)|
|Deploy backend|Render (plan gratuito)|
|Deploy frontend|Vercel (plan gratuito)|
|Notificaciones push|Web Push (VAPID), sin servicio de terceros|

> Nota: versiones antiguas de este README mencionaban SQLite — eso ya no aplica, el proyecto usa Postgres desde hace tiempo.

## Cambios recientes importantes (septiembre 2026)

- **Monitoreo de errores (Sentry)**: integrado en frontend (`frontend/src/main.jsx` + `ErrorBoundary.jsx`, variable `VITE_SENTRY_DSN`) y backend (`backend/src/instrument.js`, importado antes que nada más en `server.js`; `Sentry.setupExpressErrorHandler(app)` justo antes del manejador de errores propio; variable `SENTRY_DSN`). Verificado en producción (Render + Vercel) forzando un error real y confirmando que llegó a Sentry.
- **Páginas legales**: Términos de Servicio (`/terminos`) y Aviso de Privacidad (`/privacidad`) — `frontend/src/pages/TermsOfService.jsx` y `PrivacyPolicy.jsx`, enlazadas desde el footer. **Ojo**: tienen placeholders (`[Razón social...]`, `[correo de contacto...]`, `[domicilio...]`) sin rellenar todavía — hacerlo antes de depender de ellas para cobros reales (ver "Roadmap de negocio" más abajo).
- **CI en GitHub Actions** (`.github/workflows/ci.yml`): en cada push/PR a `main` corre el build del frontend (`npm run build`) y un chequeo de sintaxis de todo `backend/src` (`node --check`, no hay tests reales todavía). No bloquea el deploy de Render/Vercel si falla — son procesos independientes, esto solo te avisa.
- **Cobranza liga → equipos ("estado de cuenta") — V1**: la liga registra desde `/panel/liga/:id/cobranza` lo que cobra cada semana a sus equipos (renta de campo, arbitraje, transmisión, inscripción, multas), lleva un **libro append-only** por equipo y ve el panorama de adeudos. El monto es **por equipo** (tabla con casilla por equipo + botón que lo calcula como cuota × # de partidos de ese equipo en la jornada). El representante del equipo ve su estado de cuenta **de solo lectura** en `/panel/equipo/:id/estado-de-cuenta` y recibe recordatorios (cargo nuevo / por vencer / vencido / pago registrado) en su bandeja. En esta V1 **solo la liga escribe** — no hay flujo de "el equipo reporta un pago". Detalle completo en la sección "Cobranza" más abajo.
- **Roster por plantilla de Excel**: además del alta manual jugador por jugador que ya existía, ahora se puede descargar (desde el modal de roster de un equipo dentro de una rama) una plantilla `.xlsx` con el logo de la liga, el logo del equipo y el contexto (Liga/Torneo/Categoría/Rama/Equipo) ya incrustados, llenarla y volver a subirla — solo agrega a los jugadores que todavía no estén en esa rama, nunca borra a nadie. Se agregó CURP a `players` y un botón de foto por jugador (Cloudinary). Detalle completo en la sección "Roster de jugadores" más abajo.
- **Equipos independientes (sin liga)**: un equipo ya se puede registrar directo desde `/registrar-equipo` sin pertenecer a ninguna liga de la plataforma (`teams.league_id` ahora es opcional). Usa el mismo mecanismo de verificación de identidad que cualquier otra organización (`organizations.is_verified`, admin desde `/admin`) — antes esa pestaña excluía a todos los equipos. Aparecer en el home es decisión propia del equipo (`show_on_platform`, interruptor sin aprobación de nadie, se prende/apaga desde su panel) y no limita ninguna otra función; un equipo de liga sigue apareciendo exactamente igual que antes, sin cambios. Detalle completo en la sección "Equipos independientes" más abajo.

## Cambios recientes importantes (agosto 2026)

- **Monetización de afiliados de viaje activada**: la plataforma ya genera comisión real sobre los botones de Hotel y Vuelo en `MatchPage`. Ver la sección "Monetización" más abajo para el detalle completo de cómo funciona y qué falta.
- **Travelpayouts Drive instalado** (`frontend/index.html`, `<script>` al inicio del `<head>`): convierte automáticamente los links salientes a marcas de viaje soportadas (ej. Booking.com) en links de afiliado, sin tocar el código de React que genera esos links.
- **Función de Vuelos construida** (antes solo era un comentario de "a futuro" en el código): nuevo componente `frontend/src/components/FlightSearchWidget.jsx` y utilidades nuevas en `matchServices.js` (`IATA_BY_CITY`, `iataForCity`). Al hacer clic en "✈️ Vuelo" en la tarjeta de un partido, se despliega un formulario de búsqueda de Aviasales embebido (vía Travelpayouts), con el destino ya puesto según la ciudad de la sede — el origen lo detecta Aviasales por la IP del usuario, y las fechas las ajusta el usuario a mano (el widget no acepta fecha por default; se le muestra la fecha del partido como referencia).
- El botón de Hotel (`buildHotelSearchUrl`) no cambió de código — sigue generando un link limpio a `booking.com/searchresults.html`; ahora es Drive quien le agrega el marcador de afiliado en el navegador del usuario.
- `buildFlightSearchUrl` y `ORIGIN_CITY_OPTIONS` en `matchServices.js` quedaron sin uso (eran de un primer approach con link directo + selector de ciudad de origen, reemplazado por el widget embebido). Se dejaron en el archivo por si se necesitan de referencia; no afectan nada en producción.

## Cambios recientes importantes (julio 2026)

- **Nuevo modelo de "Mi panel" — varias organizaciones por cuenta**: al crear una cuenta o iniciar sesión, ya no se entra directo al panel de una liga. `/panel` ahora muestra los logos de todas las ligas y equipos que administras (sin abrir ninguno automáticamente), cada uno con su propia URL (`/panel/liga/:id`, `/panel/equipo/:id`). Un clic abre su panel de trabajo; un segundo clic sobre el mismo logo lo cierra. Esto sienta la base para agregar más tipos de organización (empresa, medio) sin rediseñar de nuevo la navegación.
- **Pantalla "Registrar Organización"**: nuevo botón en el TopBar y nueva ruta (`/panel/registrar-organizacion`) desde donde se registran organizaciones nuevas. Por ahora solo tiene la opción "Registrar liga"; los demás tipos se agregan aquí más adelante.
- **Botón de notificaciones en el TopBar**: ícono nuevo (balón amarillo), con su propia página `/notificaciones` — todavía sin contenido conectado, es solo el punto de entrada.
- **Ligas nuevas quedan pendientes de aprobación**: al registrarse, una liga queda con `status = 'pending'` y no aparece en el sitio público hasta que un admin la aprueba desde `/admin` (pestaña "Ligas", botón "Aprobar"). El dueño puede seguir configurando su liga con normalidad mientras está pendiente.
- **Rediseño de la página pública de liga**: portada, logo, nombre, descripción, botones de "Compartir"/"Notificarme", pestañas (Categorías/Equipos/Sedes) y su contenido ahora viven dentro de un solo panel negro continuo. La foto de portada se muestra completa (sin recortar), en vez de forzarla a una altura fija.
- Arreglada la deformación de logos en las tarjetas de equipo cuando el nombre es largo (ya no se fuerza una altura fija a la tarjeta).
- `node_modules/` se sacó del control de versiones de Git.
- Endurecimiento de seguridad: CORS con whitelist, `JWT_SECRET` obligatorio (sin valor por defecto), rate limiting en login/registro, y reemplazo de la dependencia `xlsx` vulnerable (backend **y** frontend). Detalle completo en la sección "Seguridad" más abajo.
- Las migraciones de `db.js` usan un candado (advisory lock) para no chocar si algún día corren varias instancias del servidor a la vez.
- Se agregó `backend/.env.example` con los nombres de todas las variables de entorno necesarias (sin valores reales).

## En progreso — no terminado todavía

- **Aprobación de Booking.com dentro de Travelpayouts**: el proyecto ya está verificado y Drive corriendo, pero el programa de Booking.com específicamente fue rechazado por tráfico insuficiente. No requiere ningún cambio de código — hay que esperar a que el tráfico del sitio crezca (~3 meses desde el último rechazo) y volver a solicitar revisión.
- ~~Configurar método de pago (payout) en Travelpayouts~~ — **hecho**: ya está configurado el payout a PayPal.
- **Botón de "Rechazar" una liga pendiente**: hoy en `/admin` solo existe "Aprobar" y "Eliminar" (que borra todo permanentemente). Falta el endpoint y el botón correspondiente, y el aviso de "tu liga fue rechazada" en el panel del dueño.
- **Contenido real de "Notificaciones"**: la página y el botón ya existen, pero todavía no muestra nada — falta decidir y construir qué información va ahí.
- **Más tipos de organización**: "Registrar Organización" solo ofrece Liga por ahora. Equipo (fuera del flujo de invitación de una liga), Empresa/Marca y Medio de comunicación quedan pendientes.
- Detalle cosmético menor: `LeagueWorkPanel` y `TeamOnlyPanel` traen su propio `<div className="container">` interno, que ahora queda anidado dentro del `container` de "Mi panel" — funciona bien, pero puede limpiarse más adelante.

## Estructura

```
lifa-app/
  backend/
    src/
      config/db.js          Conexión a Postgres + creación/migración del esquema al arrancar
      middleware/
        auth.js              JWT: firmar y verificar tokens (authRequired)
        ownership.js         Verifica que el usuario sea dueño de la liga/equipo que intenta editar
        rateLimit.js         Límite de intentos en login/registro (fuerza bruta)
      routes/
        auth.js              Registro, login, /me (incluye las ligas y equipos que administra el usuario)
        leagues.js           Lectura pública: ligas, categorías, calendario, partidos
        manage.js            CRUD protegido: ligas, categorías, grupos, equipos (con o sin
                              liga, ver "Equipos independientes"), partidos, sedes
        organizations.js     Medio/Tienda/Clínica/Marca (registro genérico) + directorio
                              público verificado — liga y equipo tienen su propio flujo
        upload.js             Subida de imágenes a Cloudinary
        invites.js           Invitaciones de un solo uso para entregar un equipo a otro usuario
        admin.js             Endpoints exclusivos para role = 'admin' (incluye aprobar ligas)
        notifications.js     Suscripción push + endpoint /trigger para el cronjob externo
        players.js           Roster por equipo+rama: alta manual, plantilla de Excel (logos vía
                              exceljs), foto/CURP por jugador, stats de partido y tarjeta pública
        billing.js            Cobranza liga → equipos (ver sección "Cobranza")
      utils/                 Validaciones, manejo de errores async, zonas horarias
      seed.js                Datos de ejemplo para desarrollo local
      server.js              Arranque de Express: CORS, rate limiting, rutas, manejo de errores
  frontend/
    index.html               <head> con script de Travelpayouts Drive (ver "Monetización")
    src/
      pages/
        Home, LeaguePage, CalendarPage, MatchPage, Login, Register,
        RegisterLeague, RegisterOrganizationPage, RegisterTeamPage, Dashboard,
        Notifications, AdminPanel, InviteClaim
      components/
        FlightSearchWidget.jsx   Botón "✈️ Vuelo" en MatchPage — despliega el
                                 widget de búsqueda de Aviasales (ver "Monetización")
        (resto de components/), context/, api/
      utils/
        matchServices.js      Hotel (buildHotelSearchUrl) y Vuelos (iataForCity,
                               IATA_BY_CITY) — accesos comerciales por partido
```

## Cómo correrlo en local

### 1. Backend

```powershell
cd backend
npm install
```

Copia `backend/.env.example` a `backend/.env` y rellena los valores reales (pide los que no tengas a quien administre las cuentas de Neon/Cloudinary/VAPID):

```powershell
Copy-Item .env.example .env
```

El `.env.example` trae comentarios explicando cada variable, incluyendo cómo generar `JWT_SECRET`.

```powershell
npm run seed     # opcional: crea datos de ejemplo (ligas, categorías, partidos)
npm run dev      # http://localhost:4000
```

### 2. Frontend

En otra terminal:

```powershell
cd frontend
npm install
npm run dev      # http://localhost:5173
```

## Flujo de la app

**Público (sin cuenta):**

1. Inicio → grid de logos de ligas.
2. Click en liga → página de la liga: portada, logo, nombre, descripción y pestañas (Categorías/Equipos/Sedes), todo dentro de un mismo panel.
3. Click en categoría → calendario de partidos. Cada tarjeta de partido es un solo link hacia `/partidos/:id` (`MatchPage.jsx`), donde están todos los links de transmisión, todos los de boletos, la sede, la jornada, el botón de "avisarme de este partido" y compartir.

**Cualquier usuario con cuenta:**

1. `/crear-cuenta` → crea su cuenta.
2. Cae en `/panel` ("Mi panel"): si no administra ninguna organización todavía, lo ve vacío salvo la barra de logos (vacía) y el botón "Registrar Organización" en el TopBar.
3. Desde "Registrar Organización" (`/panel/registrar-organizacion`) registra su primera liga. Queda como **pendiente de aprobación** — no aparece en el inicio hasta que un admin la apruebe desde `/admin`.
4. De ahí en adelante, cada liga o equipo que administra (propio o entregado por invitación) aparece como un logo en "Mi panel". Un clic abre su panel de trabajo específico; otro clic sobre el mismo logo lo cierra.
5. Dentro del panel de una liga: agrega categorías, grupos, equipos, sedes y partidos; define fecha, sede, jornada, link de transmisión, estado (programado/en vivo/finalizado) y marcador — todo esto funciona con normalidad aunque la liga siga pendiente de aprobación. También puede importar partidos en bloque desde un Excel (`manage.js`, endpoint `/import`).
6. Puede generar una invitación (`invites.js`) para entregar un equipo específico a otra persona, que lo administra desde su propia cuenta — ese equipo aparece como su propio logo en el panel personal de quien lo recibe, no en el de quien registró la liga original.

**Admin (rol `admin`):**

- Acceso a `/admin` con endpoints propios en `admin.js` (fuera del alcance de un representante normal).
- Pestaña "Ligas": aprueba ligas pendientes (aparecen primero en la lista, marcadas), o las elimina.

## Monetización (afiliados de viaje)

La plataforma monetiza mediante comisión de afiliado en dos accesos de `MatchPage`: 🏨 Hotel y ✈️ Vuelo. Ninguno de los dos vende nada directamente — ambos mandan al usuario a un tercero (Booking.com, Aviasales) que sí procesa la reserva y el pago; LIFA solo cobra comisión cuando esa reserva se completa.

Todo corre a través de una sola cuenta de **Travelpayouts** (red de afiliados de viaje), sin necesidad de tener una empresa constituida — basta con RFC persona física con actividad empresarial para poder facturar la comisión más adelante.

### Hotel — Drive + link limpio

- `buildHotelSearchUrl()` en `matchServices.js` arma un link normal a `booking.com/searchresults.html` con la ciudad de la sede y la fecha del partido — sin ningún ID de afiliado hardcodeado.
- El script de **Travelpayouts Drive** (pegado en `frontend/index.html`, dentro del `<head>`) detecta ese link en el navegador del usuario y le agrega el marcador de afiliado automáticamente, sin que el código de React sepa nada de esto.
- **Requisito para que genere comisión**: estar aprobado en el programa de Booking.com dentro de Travelpayouts (Programs → Booking.com). A diferencia de otras marcas de la red, Booking.com pasa por revisión manual de su parte (puede tardar varios días) — mientras tanto el botón funciona igual, solo que sin comisión.
- La variable de entorno `VITE_HOTEL_AFFILIATE_ID` existe en el código como alternativa (afiliado directo con Booking, sin pasar por Travelpayouts), pero **debe quedar sin configurar** mientras se use Drive — ambos sistemas escriben el mismo parámetro (`aid`) en la URL y competirían entre sí.

### Vuelo — widget embebido de Aviasales

- El botón "✈️ Vuelo" (`FlightSearchWidget.jsx`) despliega, dentro de la misma tarjeta del partido, el widget "Flights Search Form" de Aviasales (vía Travelpayouts) — el usuario busca y compara sin salir de la página; solo sale del sitio al momento de reservar.
- El **destino** viene pre-cargado según la ciudad de la sede, resuelta a código IATA con el diccionario `IATA_BY_CITY` (`matchServices.js` — cubre las ciudades mexicanas con aeropuerto más comunes para sedes de ligas; si una sede real no aparece ahí, el botón de Vuelo no se muestra — nunca se manda un destino adivinado).
- El **origen** no se pide — Aviasales lo detecta por la IP del usuario.
- La **fecha** no se puede pre-cargar (este tipo de widget no lo soporta); se le muestra al usuario la fecha del partido como texto de referencia arriba del formulario, para que la ajuste ahí mismo.
- El código base del widget (`AVIASALES_WIDGET_BASE_SRC` en `FlightSearchWidget.jsx`) incluye el marcador de afiliado (`shmarker`) y el diseño configurado en Travelpayouts (Tools → Search Forms). Si se vuelve a generar el widget desde su panel con otro diseño, hay que actualizar esa constante con el código nuevo completo.
- A diferencia de Booking, Aviasales no requirió aprobación manual — quedó activo automáticamente al registrarse en Travelpayouts.

### Pendiente del lado de la cuenta (no de código)

- Aprobación de Booking.com dentro de Travelpayouts (ver "En progreso") — esperando a que crezca el tráfico, sin acción inmediata.
- ~~Configurar método de pago (payout)~~ — hecho, ya está configurado a PayPal.

## Cobranza (estado de cuenta liga → equipos)

Primer sistema de la plataforma que mueve dinero. La liga cobra cada semana a sus
equipos (campo, arbitraje, transmisión, inscripción, multas) y aquí lleva ese
registro en vez de un Excel + WhatsApp.

### Modelo — libro append-only

Todo vive en una tabla, `team_ledger_entries` (`config/db.js`), una fila por
movimiento. **Un movimiento nunca se edita ni se borra.** El saldo de un equipo
**no se guarda** — se calcula sumando sus movimientos (`computeBalance` en
`routes/billing.js`). Saldo negativo = el equipo le debe a la liga.

- `kind = 'charge'` — un cargo. `status`: `open` → `settled` (cuando el equipo ya
  no debe nada) o `void` (cancelado).
- `kind = 'payment'` — un pago que la liga registra que recibió. En la V1 nace
  `confirmed` (no hay flujo de "pendiente de aprobar").
- `kind = 'adjustment'` — corrección. Al **cancelar** un cargo o pago se marca el
  original `status = 'void'` (solo para que deje de mandar recordatorios) y se
  inserta un `adjustment` con `direction` `credit`/`debit` y `reverses_entry_id`
  apuntando al original. Así el libro conserva las tres filas y el saldo cuadra.
- `batch_id` agrupa los cargos creados en un mismo alta — es lo que permite el
  botón "repetir jornada anterior". Los cargos de un lote comparten
  categoría/concepto/vencimiento pero **cada equipo puede tener su propio monto**
  (un equipo con 3 categorías juega más partidos y paga más que uno con 1).

### El monto es por equipo

El alta de cargos (`ChargeForm`) tiene una **tabla con un renglón por equipo y su
casilla de monto**. Un "monto base" rellena la columna de un jalón; luego se ajusta
lo que haga falta. El botón **"Calcular por # de partidos"** llena la columna
automáticamente: eliges torneo y/o jornada y una cuota por partido, y el sistema
pone `cuota × (partidos de ese equipo en el filtro)` — usa
`GET /leagues/:leagueId/match-counts`, que cuenta por `team_id` o por nombre contra
`matches` (no-borrador) de las categorías filtradas. Equipos sin partidos quedan en
$0 y se omiten. El cuerpo del POST es `{ items: [{team_id, amount}], category,
concept, due_date, week_label?, note? }`. "Repetir" reusa el monto de cada equipo
del lote original.

### Endpoints — `routes/billing.js` (`/api/billing`)

| Método | Ruta | Quién |
|-|-|-|
| `GET` | `/leagues/:leagueId/overview` | liga — tabla de equipos con saldo, vencido, próximo vencimiento, lotes recientes, torneos y jornadas |
| `GET` | `/leagues/:leagueId/match-counts` | liga — partidos por equipo (filtros `tournament_id`, `week_label`) para la calculadora de montos |
| `GET` | `/leagues/:leagueId/teams/:teamId/entries` | liga — libro de un equipo |
| `POST` | `/leagues/:leagueId/charges` | liga — crea 1..N cargos con monto por equipo (`items`), un `batch_id`, notifica a cada equipo |
| `POST` | `/leagues/:leagueId/charges/repeat` | liga — repite un `batch_id` con nueva fecha, respetando el monto de cada equipo |
| `POST` | `/leagues/:leagueId/teams/:teamId/payments` | liga — registra un pago recibido |
| `POST` | `/entries/:id/void` | liga — cancela un cargo/pago (2 escrituras) |
| `PATCH` | `/leagues/:leagueId/settings` | liga — prende/apaga los recordatorios automáticos |
| `GET` | `/teams/:id/statement` | equipo (o la liga) — estado de cuenta de solo lectura |

Permisos: los endpoints de liga usan `leagueOwnerRequired`; el estado de cuenta usa
`teamOwnerRequired` (deja pasar al rep del equipo **y** a la liga). Un equipo nunca
puede ver la cuenta de otro. Nada de cobranza aparece en el sitio público.

### Recordatorios

`utils/billingReminders.js` (`runBillingReminders`) se ejecuta al final de
`POST /api/notifications/trigger` — el mismo cron externo que ya manda los avisos de
partidos, sin configuración nueva. Solo corre para ligas con
`billing_reminders_enabled = TRUE`. Cadencia fija: "por vencer" una vez cuando
faltan ≤3 días; "vencido" cada 3 días, hasta 4 veces. Todo va a la bandeja in-app
del equipo (tabla `notifications`, tipos `billing_charge_new` / `billing_due_soon` /
`billing_overdue` / `billing_payment_recorded`), sin push ni correo.

### Frontend

- `pages/BillingLeaguePanel.jsx` — `/panel/liga/:id/cobranza` (link "💵 Cobranza"
  en el encabezado de los dos paneles de liga: el clásico `/panel/liga/:id` y el de
  estructura `/panel/liga/:id/estructura`, que es al que llega el logo bar).
  Registrar cobro (`ChargeForm`, con tabla de monto por equipo + calculadora por
  partidos), repetir jornada (`RepeatChargeModal`), registrar pago (`PaymentForm`),
  ver movimientos, cancelar.
- `pages/TeamStatementPanel.jsx` — `/panel/equipo/:id/estado-de-cuenta`, solo
  lectura. El saldo también se asoma en el encabezado del panel del equipo.
- `Dashboard.jsx` — "Mi cartelera" y "% de aciertos" solo se muestran en "Mi panel"
  (`/panel`), no al entrar a una liga o equipo.

### Fuera de la V1

El equipo reportando pagos con comprobante para que la liga confirme/rechace; cobro
en línea (pasarela — ver Fase 2 de "Roadmap de negocio" más abajo); facturación/CFDI;
pago de la liga a árbitros; desglose por jugador; suspender a un equipo por adeudo.
Pendiente también, sin dueño todavía: una pasada de estilo a `BillingLeaguePanel`
(hoy la tabla es funcional pero simple, sin tarjeta de fondo).

`team_ledger_entries` ya quedó modelada como un libro genérico "entre dos partes"
(`created_by_side IN ('league','team')`, `kind`/`direction` sin acoplar a quién le
cobra a quién) a propósito, para poder reusarla casi igual en **equipo → jugador**
(cuotas de jugador) sin rehacer el esquema — ver "Roadmap de producto" más abajo.

## Roster de jugadores (plantilla de Excel)

Reemplaza el flujo real de la liga ("le mando el Excel al equipo por WhatsApp y
luego lo capturo a mano") por una plantilla que se genera y se vuelve a subir
dentro de la plataforma, sin quitar el alta manual que ya existía.

### Modelo

El roster vive en **equipo + rama, dentro de un torneo** (`player_team_memberships`,
`config/db.js`): `branch_id` dice en qué rama/categoría juega el jugador, y
`tournament_id` se guarda explícito (se deriva de `branches.category_id →
categories.tournament_id`, pero se duplica en la fila porque el roster "vive
dentro de un torneo"). Un jugador que cambia de equipo o rama no se borra: se
cierra su membresía (`end_date`) y se abre una nueva — el historial completo
queda en la tabla. `players` tiene ahora una columna **`curp`** (opcional), que
sirve como clave para no duplicar a un jugador al re-subir la plantilla.

Requisito previo: el equipo debe estar **inscrito en la rama** (`branch_teams`,
inscripción explícita, no se infiere de que ya tenga partidos programados) — lo
exige el middleware `branchTeamOwnerRequired` (`middleware/ownership.js`), que
deja pasar tanto al dueño/miembro de la liga como al dueño/miembro del equipo.

### Dos formas de armar el roster (conviven, `routes/players.js`)

1. **Alta manual, jugador por jugador** — `POST /api/players/branches/:branchId/teams/:teamId/roster`, formulario en `BranchRosterModal.jsx`. Existía desde antes; ahora también acepta CURP.
2. **Plantilla de Excel**:
   - `GET .../roster/template` — genera el `.xlsx` con **exceljs** (nueva dependencia del backend). Es la única librería del proyecto que puede *escribir* imágenes dentro de un Excel — `xlsx`/SheetJS, que ya se usa para leer los Excel de partidos en `manage.js`, no puede. Incrusta el logo real de la liga y del equipo (bajados de Cloudinary) más un membrete con Liga/Torneo/Categoría/Rama/Equipo. Columnas: Nombre\*, Apellido\*, Fecha de nacimiento, Posición, Número, CURP, Foto (URL).
   - `POST .../roster/import` — sube la plantilla llena. Ubica la fila de encabezados aunque el membrete esté arriba, y **solo agrega a los jugadores que no estén ya** en el roster activo de esa rama (compara por CURP si vino, si no por nombre+apellido) — nunca borra a nadie. Responde `{ imported, skipped, skippedRows, warnings, warningRows }`, mismo formato que el import de partidos.
   - `PATCH .../roster/:playerId` — edita foto, CURP, fecha de nacimiento, posición o número de un jugador ya en el roster.

### Foto del jugador

La plantilla trae una columna "Foto (URL)" — un link, no un archivo. Además,
cada jugador en `BranchRosterModal.jsx` tiene un botón "+ Foto" que sube la
imagen por `POST /api/upload` (Cloudinary, el mismo endpoint que los logos) y la
guarda con el `PATCH` de arriba.

**Limitación conocida, a propósito**: si el equipo pega una foto directo en una
celda del Excel (en vez de escribir una URL), esa imagen **no se importa**. En
formato `.xlsx` las imágenes "flotan" sobre la hoja sin quedar amarradas a una
fila, así que no hay forma confiable de saber a qué jugador pertenece cada una
al leer el archivo de vuelta — por eso la foto se resuelve con URL + botón de
subida, nunca leyendo imágenes pegadas en el Excel.

### Frontend

`components/BranchRosterModal.jsx` (se abre desde la fila de un equipo inscrito
en una rama, dentro de `pages/LeagueStructurePanel.jsx`): sección "Descargar
plantilla / Subir plantilla llena" con el resumen de la importación, campo CURP
en el alta manual, botón de foto por jugador. `api/client.js`:
`downloadBranchRosterTemplate`, `importBranchRoster`, `updateBranchRosterPlayer`.

### Fuera de esta versión / pendiente

- El modal y los endpoints de roster **por equipo sin rama** (`TeamRosterModal.jsx`, `GET`/`POST /api/players/teams/:id/roster`) son la versión de antes de la corrección "roster por rama" — se dejaron sin tocar, ya marcados como obsoletos en el propio código y sin ninguna pantalla que los use.
- No hay endpoint para **quitar** a un jugador del roster (solo "mover", que cierra la membresía vieja y abre una nueva en otro lado) — pendiente desde antes de esta plantilla, no resuelto aquí.
- La deduplicación al re-subir solo compara contra el roster **de esa misma rama** — un jugador puede quedar duplicado a propósito si se da de alta por separado en otra rama o equipo (mismo comportamiento que el alta manual, que siempre crea un jugador nuevo).
- Credencial digital de jugador con QR (ver "Roadmap de producto" más abajo): el roster ya existe con este nivel de detalle, la credencial/QR todavía no.

## Equipos independientes (sin liga)

Hasta ahora un equipo solo podía existir colgado de una liga (`teams.league_id
NOT NULL`, lo creaba la liga desde su panel o lo reclamaba un representante por
invitación). Ahora un equipo se puede registrar directo, sin pertenecer a
ninguna liga de la plataforma — mismo mecanismo de verificación que cualquier
otra organización, y sin que le falte ninguna función por no tener liga.

### Modelo

- `teams.league_id` es ahora **opcional** (`config/db.js`, `ALTER TABLE teams
  ALTER COLUMN league_id DROP NOT NULL`). Un equipo de liga no cambia en nada;
  solo un equipo nuevo sin liga nace con `league_id = NULL`.
- Al registrarse, se crea de una vez su fila en `organizations` (`type =
  'team'`) y su membresía en `organization_members` (`role = 'owner'`) — antes
  esto solo pasaba para equipos de liga, y hasta el próximo arranque del
  servidor (el backfill de `initSchema`). País y descripción viven en esa
  organización, no en `teams` (misma idea que "organizations es la capa de
  identidad común" ya documentada en `config/db.js`).
- `teams.show_on_platform` (booleano, nace en `FALSE`): si el equipo aparece en
  la sección "Equipos" del home. Es **autoservicio, sin aprobación de nadie**
  — distinto al mecanismo de `leagues.is_public`/`publish_requested`, que sí
  pasa por un admin. Solo aplica a un equipo sin liga: uno que ya es miembro
  del roster de una liga pública sigue apareciendo igual que siempre,
  sin que este campo le afecte (`GET /leagues/all-teams`, `routes/leagues.js`).

### Endpoints nuevos/cambiados

| Método | Ruta | Qué hace |
|-|-|-|
| `POST` | `/manage/teams` | Registra un equipo sin liga — crea `teams` + `organizations` + `organization_members` de un jalón. Owner = quien lo registra, de inmediato (a diferencia de un equipo de liga, que nace sin representante hasta que alguien reclama una invitación). |
| `PUT` | `/manage/teams/:id` | Ahora también acepta `country_id`/`description` (se guardan en la organización del equipo) y `show_on_platform`. |
| `GET` | `/admin/organizations` | Ya incluye a los equipos **independientes** (antes excluía `type = 'team'` por completo) — verificables con el mismo botón `is_verified` que medio/tienda/clínica/marca. Un equipo de liga sigue sin aparecer aquí (se administra desde el panel de su liga). |
| `GET` | `/leagues/all-teams` | Suma, además del roster de ligas públicas, a los equipos independientes con `show_on_platform = TRUE`. |
| `GET` | `/billing/teams/:id/statement` | Un equipo sin liga no tiene relación de cobranza con nadie — regresa un estado de cuenta vacío en vez de tronar. |

### Frontend

- `pages/RegisterTeamPage.jsx` — `/registrar-equipo`, enlazado desde
  "Registrar Organización" y desde la barra de logos del panel
  (`OrgLogoBar.jsx`). Reusa `TeamForm.jsx` en modo `independent` (nuevo prop):
  ahí, y solo ahí, se muestran país/descripción y el interruptor de aparecer
  en el home — un equipo de liga no ve estos campos.
- `pages/Dashboard.jsx` (`TeamOnlyPanel`) — para un equipo sin liga, muestra
  el badge "✓ Verificado" (si aplica) en vez del nombre de la liga, el mismo
  patrón de banner que ya usan las ligas para pedir aparecer en público
  (aquí es un solo botón, sin solicitud/aprobación), y ya no pide su estado
  de cuenta (no aplica sin liga).

### Bugs corregidos por volver `league_id` opcional

Necesarios para que un equipo sin liga no rompiera nada que asumía que
siempre había una:

- `middleware/ownership.js` (`teamOwnerRequired`, `teamLeagueOwnerRequired`):
  buscaban la liga del equipo sin validar que existiera — con `league_id`
  NULL, `league.organization_id` tronaba. Ahora, sin liga, la máxima
  autoridad sobre el equipo es su propio dueño (o un admin).
- `routes/auth.js` (`GET /auth/me`): el `JOIN` con `leagues` era `INNER JOIN`
  — un equipo sin liga simplemente desaparecía de "Mi panel" de su propio
  dueño. Ahora es `LEFT JOIN` (y trae `country_id`/`description`/`is_verified`
  desde su organización).

### Pendiente / fuera de esta versión

- El badge "✓ Verificado" solo se ve hoy en el panel del propio equipo, no en
  su ficha pública (`TeamCard`/`TeamInfoPanel`).
- No existe flujo de traspaso de dueño para un equipo independiente (sí existe
  para uno de liga, vía invitación — `routes/invites.js`) — si el que lo
  registró pierde acceso a su cuenta, hoy no hay forma de reclamarlo.

## Seguridad — decisiones ya tomadas

- **CORS con whitelist**: solo los orígenes listados en `ALLOWED_ORIGINS` pueden llamar a la API desde un navegador. En local, `localhost:5173` siempre está permitido.
- **JWT_SECRET obligatorio**: el servidor no arranca si falta esta variable (antes tenía un valor por defecto inseguro escrito en el código — ya no).
- **Rate limiting en login/registro**: máximo 20 intentos cada 15 minutos por IP (`middleware/rateLimit.js`), para frenar fuerza bruta de contraseñas.
- **`xlsx` (SheetJS) instalado desde `cdn.sheetjs.com`, no desde el registro de npm — en backend y frontend**: la versión publicada en npm tiene una vulnerabilidad alta (prototype pollution / ReDoS) sin parche ahí; SheetJS solo publica la versión corregida en su propio CDN. Se usa exactamente igual (mismo nombre, misma API) — solo cambia de dónde se instala.
- El backend corre detrás del proxy de Render, por eso `server.js` tiene `app.set('trust proxy', 1)` — necesario para que el rate limiting identifique bien la IP de cada visitante.
- **Candado (advisory lock) en las migraciones de `db.js`**: si algún día corren varias instancias del servidor a la vez, la segunda espera a que la primera termine de migrar el esquema, en vez de correr las mismas instrucciones al mismo tiempo.

### Vulnerabilidades de `npm audit` — evaluadas y aceptadas conscientemente

Estas dos siguen apareciendo en `npm audit` del frontend. No es que se nos olvidó, ya se revisaron y no aplican a como está construido este proyecto hoy:

- **`esbuild`/`vite`** (`GHSA-67mh-4wv8-2f99`): permitiría a un sitio malicioso leer respuestas del servidor de desarrollo local. Solo afecta mientras `npm run dev` está corriendo en tu máquina — no afecta producción. Arreglarlo requiere saltar a `vite@8` (cambio mayor, rompe cosas).
- **`react-router`** (`GHSA-wrjc-x8rr-h8h6`, `GHSA-337j-9hxr-rhxg`): open redirect e inyección en hidratación SSR. Ambas fallas requieren el modo "Data/Framework" de React Router (`createBrowserRouter` + `RouterProvider`) o renderizado del lado del servidor. Este proyecto usa `<BrowserRouter>` (modo declarativo, en `main.jsx`) — no tiene ese código, así que no está expuesto.

## Pendientes conocidos (deuda técnica, sin urgencia)

- Rotar `CLOUDINARY_API_SECRET` (ver sección "En progreso" arriba para el resto de pendientes funcionales).
- **El verdadero límite hoy es la infraestructura gratuita, no el código**: Render (plan gratuito) corre una sola instancia y se "duerme" tras ~15 min sin tráfico; Neon (plan gratuito) tiene un comportamiento similar. Se resuelve pasando a un plan de pago barato en ambos — decisión pendiente, no técnica.
- No hay ninguna capa de caché todavía; cada visita al calendario consulta Postgres directo.
- El tamaño del pool de conexiones de Postgres (`config/db.js`) usa el valor por defecto de la librería `pg` — revisar si el tráfico crece mucho.
- JWT guardado en `localStorage` (no en cookie `httpOnly`): trade-off aceptado por simplicidad de configuración entre dominios distintos (Vercel + Render).

## Roadmap — en construcción

El modelo de "varias organizaciones por cuenta" ya está en marcha (ver "Cambios recientes" arriba). Lo que falta para completarlo:

1. ~~Agregar los tipos Equipo independiente, Empresa/Marca y Medio de comunicación a "Registrar Organización"~~ — **hecho**: los cuatro tipos ya se registran (Equipo independiente desde `/registrar-equipo`, ver sección "Equipos independientes"; Medio/Tienda/Clínica/Marca desde `/registrar-organizacion`).
2. Más adelante: permisos de colaboración entre organizaciones — por ejemplo, que un Medio con permiso pueda actualizar directamente el link de transmisión de un partido registrado por una Liga, sin pasar por su dueño original.

## Roadmap de negocio — operar sin intervención constante (actualizado 2026-09-14)

Objetivo: que la plataforma genere flujo de cobro real sin que cada venta dependa de una acción manual del dueño. Progreso por fase:

**Fase 0 — Cerrar lo que ya estaba a medias**
- ✅ Payout de Travelpayouts a PayPal configurado.
- ⏳ Aprobación de Booking.com: sin acción de código, solo esperar a que crezca el tráfico y volver a pedir revisión (ver "En progreso" arriba).

**Fase 1 — Fundación de confiabilidad**
- ✅ Páginas legales (`/terminos`, `/privacidad`) — placeholders de datos reales (razón social, domicilio, correo) sin llenar todavía.
- ✅ Monitoreo de errores (Sentry) en frontend y backend, verificado en producción.
- ✅ CI en GitHub Actions (build + chequeo de sintaxis en cada push).
- ⏳ Pendiente: subir Render y Neon a un plan de pago (hoy se "duerme" en free tier — ver "Pendientes conocidos").
- ⏳ Pendiente: rotar `CLOUDINARY_API_SECRET`.

**Fase 2 — Automatizar el cobro (el bloqueador real de fondo)**
No iniciado. Hoy `PUT /organizations/:id/plan` (`admin.js`) requiere que el admin active el plan "pro" a mano después de un pago fuera de la plataforma (transferencia/PayPal). Reemplazar por checkout self-serve + webhook (Conekta o Stripe — Conekta tiene ventaja en México por soportar OXXO/SPEI) que actualice `plan`/`plan_expires_at` solo, con downgrade automático si el pago falla. Después, evaluar extender el mismo mecanismo a `billing.js`: cobro en línea liga→equipo, y eventualmente equipo→jugador (para que los equipos cobren a sus propios jugadores).

**Fase 3 — Red de seguridad técnica**
No iniciado. Tests automatizados (hoy cero — empezar por auth y billing), monitoreo de uptime/alertas, y que el CI llegue a bloquear el deploy si algo falla (hoy Render/Vercel despliegan sin esperar al resultado del CI).

**Fase 4 — Automatizar el ciclo de vida del cliente**
No iniciado. Botón de "Rechazar" liga pendiente (hoy solo existe Aprobar/Eliminar permanente), onboarding automático por correo (Resend) para organizaciones nuevas, habilitar los tipos de organización pendientes en "Registrar Organización".

**Fase 5 — Crecimiento sin esfuerzo manual**
No iniciado. Página de precios pública para el plan "pro", analítica de conversión (hoy `track.js` solo cuenta vistas/clicks de sponsors), SEO/contenido más allá del sitemap actual.

## Roadmap de producto — herramientas para ligas y equipos (plan de sesión, sin construir salvo Cobranza)

> Nota de procedencia: esta sección viene de una sesión de planeación con Claude
> (8–14 sep 2026) sobre qué le da a LIFA App valor real para ligas y equipos —
> el objetivo declarado del proyecto es ser "la casa del fútbol americano en
> México". Es **estrategia de producto, no un compromiso de calendario** — a
> diferencia de "Roadmap de negocio" (arriba), que es infraestructura/operación
> y ya tiene fases en marcha. De esta lista, lo único construido hoy es
> **Cobranza (liga → equipo) V1** — ver sección "Cobranza" arriba.

Principio: **gratis** = quitarle a la liga/equipo el dolor operativo diario (que
abandonen WhatsApp + Excel + Facebook). **De pago** = algo que le genera o le
ahorra dinero real. Una liga se queda cuando (a) su historial vive en la
plataforma, (b) su afición está ahí, (c) cobra por ahí — por eso Cobranza se
adelantó al resto: es lo que hace que el admin de la liga vuelva cada semana.

### Gratuitas — para enganchar

**Para ligas**
- Tabla de posiciones automática (PG-PP-PE, desempates configurables) — hoy se arma a mano.
- Generador de rol de juegos (round-robin por conferencias, respeta sedes compartidas y byes).
- Credencial digital de jugador con QR — el registro de roster (alta manual, traspasos, plantilla de Excel con logos/CURP/foto) **ya existe**, ver sección "Roster de jugadores" más arriba; falta la parte de credencial/QR para resolver disputas de elegibilidad en la cancha.
- Asignación de cuerpo arbitral (quién pita qué partido, disponibilidad, tarifa) — no existe.
- Aviso de cambios de partido a quien lo sigue — ya existe vía `notifications.js`/web push.

**Para equipos**
- Convocatoria y confirmación de asistencia a partido/práctica (sustituye otro grupo de WhatsApp).
- Lista de juego (game-day roster) exportable.
- Página de equipo para reclutar ("únete a los X") — el perfil de equipo y la tarjeta de jugador compartible ya existen.

### De pago — una vez que dependen de la plataforma

**Para ligas**
- **Inscripciones y pagos en línea** — el siguiente paso natural de Cobranza; ver Fase 2 de "Roadmap de negocio".
- Estadísticas avanzadas / "Liga Pro": la captura por partido y jugador ya existe (`player_match_stats`, `MatchStatsModal.jsx`) — falta la capa agregada (líderes de liga, histórico multi-temporada, tablero para prensa).
- Módulo de patrocinadores self-serve (ya hay tracking de impresiones/clics en `track.js`, falta el checkout).
- Transmisión monetizada (PPV o pase de temporada).
- Dominio propio sin marca LIFA; tienda oficial de la liga (`products.js`/bot de WhatsApp ya existen para tiendas tipo `store`, falta adaptarlo a mercancía de liga); módulo de disciplina (expulsión → suspensión automática); credenciales físicas impresas; seguro de jugadores vía aseguradora aliada.

**Para equipos**
- **Cobro de cuotas a jugadores** (equipo → jugador) — mismo modelo de `team_ledger_entries`, ver nota en "Fuera de la V1" de Cobranza.
- Video/film del partido con recorte de jugadas (Hudl más barato).
- Tienda del equipo (uniformes, fan gear); scouting de rivales de la misma liga; vitrina de reclutamiento para universidades/LFA.

### Orden sugerido (revisar contra lo ya avanzado)

Orden original propuesto: 1) tabla de posiciones + generador de calendario, 2) roster + credencial QR, 3) inscripciones/pagos en línea, 4) estadísticas por jugador, 5) patrocinadores self-serve. **En la práctica se adelantó Cobranza (liga→equipo) antes que el resto** porque resolvía el dolor más agudo hoy (cobranza semanal por WhatsApp) — orden válido, esto es una guía, no una secuencia obligatoria.

### Estrategia de entrada (sin construir todavía)

Todo lo operativo gratis el primer año; ofrecer migrar la temporada pasada desde su Excel; priorizar flag/tochito infantil-juvenil (menos herramientas legado que reemplazar, crecimiento fuerte de cara a LA 2028); conseguir una liga ancla bien montada y visible para que las demás sigan. El módulo de pagos (Cobranza → cobro en línea) es el punto de no retorno: en cuanto una liga cobra por la plataforma, no se va.
