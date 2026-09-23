# CFBAMX — Calendarios de Fútbol Americano México

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

## Qué cambió y cuándo

El histórico del proyecto —lo que se construyó, lo que se cerró y el
post-mortem de los bugs que salieron en el camino— vive en
[`docs/CHANGELOG.md`](docs/CHANGELOG.md).

Las reglas de trabajo (nunca probar contra producción, los libros de dinero son
append-only, se resuelve al leer y no se migra) están en
[`CLAUDE.md`](CLAUDE.md).

## Qué tan avanzado está cada parte

Vive en [`docs/ESTADO.md`](docs/ESTADO.md): cada producto con su **nivel**
(definido · construido · verificado · en producción · en uso), la evidencia que
lo prueba y los pendientes que lo detienen. Hasta el 2026-09-22 esta sección era
una tabla de porcentajes puestos a ojo; se cambió porque medía cuánto se
construyó y no si sirve.

## Pendientes abiertos

Viven en [`docs/PENDIENTES.md`](docs/PENDIENTES.md), con un ID fijo (`PD-01`,
`PD-02`…) y una prioridad (P0 · P1 · P2). Es el **único** lugar de lo que falta:
cuando una sección de este README dice "ver Pendientes abiertos", el detalle
está ahí. El commit que cierra un pendiente borra su renglón y deja la entrada
en `docs/CHANGELOG.md`.

## Cadencia del cron

Un solo endpoint —`POST /api/notifications/trigger`, con `x-cron-secret`— y
**dos cadencias**. Se puede llamar con la frecuencia que sea: el endpoint se
encarga de que cada mitad corra a su ritmo.

| Bloque | Cuándo corre | Qué hace |
|---|---|---|
| Partidos | **cada** llamada | Push de "próximo" / "en vivo", y los avisos a la bandeja de la liga de marcador faltante y partido no iniciado |
| Cobranza | **una vez al día** | `runBillingReminders` (liga→equipo), `runPlayerBillingReminders` (equipo→jugadores) y `runMonthlyChargeGeneration` |

**Por qué no podían compartir cadencia.** Los avisos de partido leen una ventana
de una hora (`match_date BETWEEN NOW() - 3h AND NOW() + 1h`): con un cron diario,
casi ningún partido cae dentro y el aviso no se manda nunca. La cobranza es lo
contrario — con una corrida al día sobra, y más que eso es barrer los dos libros
completos decenas de veces sin nada nuevo que encontrar. Antes de separarlas una
de las dos mitades estaba mal servida y, como la frecuencia del cron no se
conocía, no había forma de saber cuál.

**El candado diario es de la base, no del código** (`utils/cronSchedule.js`),
mismo criterio que `idx_club_ledger_auto_cycle`: la corrida reclama el día
insertando su fila en `cron_runs`, que tiene `UNIQUE (phase, ran_on)` y
`ON CONFLICT DO NOTHING`. Quien no gane la reclamación se salta esas fases. Seis
llamadas simultáneas dejan exactamente una corriendo; con un `SELECT` y un `if`
en JS habría ventana de carrera de verdad, y del otro lado de esa ventana está
la generación de dinero.

Tres detalles de esa mecánica:

- `ran_on` usa `HOY_MX`, no `CURRENT_DATE`. Con Neon en UTC el día se cortaría a
  las 18:00 hora de México — el mismo desfase que documenta `utils/sqlDates.js`.
- Una corrida que reclamó y **murió sin terminar** (`finished_at IS NULL` y
  `started_at` de hace más de 15 min) la retoma la siguiente llamada. Sin eso,
  un reinicio a media corrida dejaría el día bloqueado hasta la medianoche.
- Si la tarea diaria lanza, la reclamación **se suelta**, para que el cron
  reintente hoy mismo y no mañana.

**`?force=1`** vuelve a correr las fases diarias aunque ya hayan corrido hoy. Va
detrás del mismo `CRON_SECRET` y sirve para probar y para recuperar a mano.

**El candado no sustituye a la vía perezosa del panel.** Acota que el cron corra
*de más*; no puede hacer nada si el cron se muere del todo. Por eso
`runMonthlyChargeGeneration` se sigue llamando también desde
`GET /teams/:id/overview` — ver "La mensualidad se genera sola".

### Quién lo dispara

`.github/workflows/cron.yml`, cada 15 minutos. Vive en el repositorio y no en
el panel de un proveedor de fuera porque eso era exactamente el problema: nadie
sabía cuál era ni si seguía corriendo. Aquí queda versionado, se ve en el
historial y **falla ruidosamente** — si el backend no responde, si el HTTP no es
200, o si `partidos_error` no viene `null`, el paso sale con error y GitHub
manda correo.

La única excepción es que falten sus dos secretos (`CRON_TARGET_URL` y
`CRON_SECRET`, ya creados el 2026-09-19): ahí avisa y se sale sin error, para
no mandar un correo cada 15 minutos mientras se configura. Los secretos los
limpia de espacios y saltos de línea antes de usarlos — pegarlos arrastra un
`
` con una facilidad pasmosa, y eso tumbó la primera corrida real. `workflow_dispatch` lo dispara a mano desde la pestaña Actions, con
un input `force`.

El secreto se acepta en **dos formatos**, `x-cron-secret: <secreto>` y
`Authorization: Bearer <secreto>`. Es el mismo secreto: varios schedulers
mandan solo el segundo (Vercel Cron entre ellos), y aceptar los dos es lo que
deja cambiar de proveedor sin tocar el backend.

### ¿Sigue vivo? ¿Cada cuánto corre? — pestaña Cron del panel admin

`GET /api/admin/cron` y la pestaña **Cron** de `/admin` contestan las dos
preguntas con lo que la propia app registró. Cada llamada al endpoint incrementa
un contador en `cron_runs` (fila `phase='trigger'`, una por día, con `calls` y
`last_call_at`). Una fila por día y no una por llamada: con el cron cada 15
minutos serían ~35 mil filas al año para responder lo mismo.

**La cadencia no se configura, se mide.** 96 llamadas en un día completo son 15
minutos entre una y otra. Por eso el umbral de "atrasado" tampoco es fijo: sale
del ritmo observado, `max(2 × cadencia, 90 min)`, con un techo duro de 36 h para
"sin señal". Así el panel sirve igual con un cron de 15 minutos que con uno
diario — que era justamente el dato que no se tenía.

| Estado | Cuándo |
|---|---|
| 🟢 Corriendo | el silencio cabe en la tolerancia |
| 🟡 Atrasado | pasó de la tolerancia, pero menos de 36 h |
| 🔴 Sin señal | más de 36 h sin llamar, o nunca |

La cadencia se estima con el último día **completo**, nunca con el de hoy: hoy
va a la mitad y daría siempre una frecuencia inventada. La bitácora se poda a
120 días, desde el bloque diario.

### Las dos mitades ya no se tumban entre sí

La fase de partidos vive en su propia función (`faseDePartidos()`) con su
try/catch, y su error sube a la respuesta como `partidos_error`. Antes estaba
todo en línea en el mismo handler, y la **primera** instrucción era
`ensureVapid()`, que lanza si faltan las variables VAPID: una configuración de
push incompleta —o cualquier error en los avisos de partido— devolvía 500 y la
cobranza y la generación de mensualidades no corrían. Dos cosas que no tienen
nada que ver entre sí.

### Qué devuelve

Es el único rastro que deja este handler, así que trae todo lo que pasó:

```json
{
  "ok": true,
  "llamadas_hoy": 37,
  "partidos_error": null,
  "cobranza": {
    "corrio": true,
    "motivo": null,
    "resultado": {
      "billing_reminders":        { "dueSoon": 0, "overdue": 2 },
      "player_billing_reminders": { "dueSoon": 1, "overdue": 0 },
      "monthly_charges_created":  23,
      "monthly_charges_error":    null,
      "bitacora_podada":          0
    }
  },
  "monthly_charges_created": 23,
  "monthly_charges_error": null
}
```

`corrio: false` con `motivo: "ya corrió hoy"` es lo normal en toda llamada que no
sea la primera del día. Las dos claves de la raíz se conservan porque eran lo
único que esta respuesta decía antes y del otro lado hay un servicio que no
podemos inspeccionar; valen `null` —no `0`— cuando el bloque diario no corrió.

## Respaldos

Hasta el 2026-09-23 **no había ninguno propio**. Lo único era la restauración a
un punto en el tiempo de Neon, que en el plan gratuito cubre **6 horas**: un
borrado malo que se notara al día siguiente ya no tenía vuelta. El plan
gratuito permite además **un solo** snapshot manual y ningún respaldo
programado.

Lo que hay que proteger es poco pero no se repone: las predicciones del
concurso de ONEFA (1,663 el 2026-09-23) y su calendario. El riesgo realista no
es que Neon pierda la base, sino un error propio: en una semana este proyecto
encontró dos `ON DELETE CASCADE` que borraban de más con un solo clic.

Por eso son **dos capas**, y cada una cubre lo que la otra no:

| Capa | Qué hace | Cuándo | Dónde queda | Protege de |
|-|-|-|-|-|
| Ramas de Neon | Crea `respaldo-AAAA-MM-DD` desde `production` y conserva las 4 más recientes | Lunes 06:00 (México), `.github/workflows/respaldo.yml` | Dentro de Neon | Un error propio que se note hasta ~4 semanas después |
| Archivo | `pg_dump`, verificado y **restaurado de prueba** | Cada 4 semanas, lunes 10:00, en la computadora de Alfredo | `Documentos\cfbamx-respaldos` | Perder la cuenta o el proyecto de Neon |

### Las ramas semanales

Una rama de Neon es una copia instantánea (copy-on-write): no copia datos y no
sale de Neon, así que **ningún dato personal pasa por GitHub**. Nace sin
compute, así que no gasta horas de cómputo mientras nadie la consulte.

- **Los logs de GitHub Actions de un repo público son públicos.** El workflow
  nunca imprime una respuesta completa de la API, solo campos elegidos con
  `jq`: la respuesta de crear una rama puede traer cadenas de conexión con
  contraseña.
- **La llave de API es de proyecto** ("project-scoped"): puede crear y borrar
  ramas, pero **no puede borrar el proyecto**. Una llave personal o de
  organización guardada en GitHub sería mucho más poder del que esto necesita.
- **Nada caduca solo.** Neon permite ponerle fecha de expiración a una rama, y
  no se usa a propósito: GitHub apaga los workflows programados tras 60 días
  sin actividad en el repo, y con expiración, un workflow apagado terminaría
  borrando todos los respaldos. Aquí una rama vieja solo se borra **después**
  de que la nueva existe, nunca por debajo de 4, y solo si se llama
  exactamente `respaldo-AAAA-MM-DD` y cuelga de `production`.
- Si faltan los secretos, **falla** (a diferencia de `cron.yml`, que avisa y
  sale sin error): corre una vez por semana, así que el correo de GitHub no es
  ruido.

Cuenta contra los límites del plan gratuito: 10 ramas por proyecto (con
`production`, `desarrollo-local` y 4 respaldos quedan 4 para ramas de prueba) y
512 MB de almacenamiento. El resumen de cada corrida dice cuántas ramas hay y
cuánto pesa producción.

### El archivo cada 4 semanas

`backend/scripts/respaldo-local.mjs`. Es de **solo lectura** contra
producción: `pg_dump` con `default_transaction_read_only`, sin importar
`config/db.js` (que correría las migraciones).

- **Cuenta y respalda el mismo instante.** Los conteos de filas y `pg_dump`
  comparten un snapshot (`pg_export_snapshot()` + `--snapshot`), así que
  cuadran exactos aunque producción reciba escrituras en medio.
- **`--probar` lo restaura de verdad**: crea una base temporal en la rama
  `desarrollo-local`, le hace `pg_restore`, compara tabla por tabla contra
  producción y la borra al final, aunque algo falle en medio. Un respaldo que
  nunca se restauró no está probado. La tarea programada siempre corre con
  `--probar`.
- **`verify-full`, no `require`.** `libpq` en Windows no encuentra los
  certificados raíz del sistema; en vez de bajar a `require`, que cifra pero no
  comprueba con quién habla, el script le pasa las raíces que trae Node.
- **Se niega a escribir dentro del repo**, que es público: el archivo lleva
  correos, contraseñas cifradas y, el día que haya padrón, CURP de menores. Y
  escribe a un `.parcial` que solo se renombra si todo salió bien.
- **`pg_dump` tiene que ser 18 o mayor**, igual que Neon. Se usan los
  binarios oficiales de EDB (el zip, no el instalador) con solo `pg_dump`,
  `pg_restore`, `psql` y sus DLL, en `%LOCALAPPDATA%\Programs\pgsql18`: sin
  servicio y sin permisos de administrador.

La tarea es **CFBAMX - respaldo de produccion** en el Programador de tareas, con
"ejecutar en cuanto sea posible" si la computadora estaba apagada a esa hora.
**No manda correo si falla**: lo que pasó queda en
`Documentos\cfbamx-respaldos\bitacora.txt`, que hay que mirar en la revisión
semanal.

### Cómo se restaura

- **Recuperar filas sueltas**, que es lo más probable (un borrado malo): a la
  rama de respaldo se le agrega un compute desde la consola de Neon, o se
  restaura el archivo en una base aparte (`pg_restore --no-owner
  --no-privileges --dbname <base> archivo.dump`), y se copian solo las filas
  perdidas. El script ya hace exactamente eso en cada `--probar`.
- **Regresar producción entera a un respaldo**: Neon permite restaurar una
  rama a partir de otra. **No se ha ensayado aquí**; antes de hacerlo sobre
  `production` hay que probarlo sobre una rama de prueba.

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
                              público verificado (liga y equipo tienen su propio flujo) +
                              listar/quitar administradores de cualquier organización
        upload.js             Subida de imágenes a Cloudinary
        invites.js           Invitaciones de un solo uso: entregar un equipo a otro usuario
                              (reemplaza al representante), o sumar un administrador más a una
                              liga/equipo (org_admin, agrega sin reemplazar a nadie)
        admin.js             Endpoints exclusivos para role = 'admin' (incluye aprobar ligas)
        notifications.js     Suscripción push + endpoint /trigger del cron
                              (dos cadencias en un endpoint — ver "Cadencia del cron")
        players.js           Roster por equipo+rama: alta manual, plantilla de Excel (logos vía
                              exceljs), foto/CURP por jugador, stats de partido, PASE DE LISTA
                              (leer, marcar y el acumulado) y tarjeta pública
        billing.js            Cobranza liga → equipos (ver sección "Cobranza")
        playerBilling.js     Cuotas equipo → jugadores + estado de cuenta público del papá
                              (sin sesión, token en la URL) — ver "Cuotas del club"
        predictions.js       Votar quién gana, resumen por partido y ranking del
                              calendario — ver "Predicciones y quinielas"
        pools.js             Quinielas privadas por código de invitación — misma sección
        board.js             "Mi cartelera": junta en una lista los partidos que le
                              interesan al usuario (pidió aviso del partido, pidió aviso
                              de un equipo, o predijo). No tiene tabla propia — es una
                              vista derivada de push_subscriptions + predictions, y es
                              historial: el partido se queda ahí después de jugarse
        broadcasts.js        Un medio verificado se suma solo a un partido y pone su
                              link — ver "Transmisiones"
        products.js          Inventario por organización — ver "Tiendas y bot de WhatsApp"
        bot.js               Webhook de WhatsApp: responde a clientes de una tienda con
                              su inventario, vía Claude — misma sección. CONSTRUIDO PERO
                              NO CONECTADO (faltan las credenciales)
        track.js             Un solo POST público, sin sesión, con lista CERRADA de tres
                              eventos (home_view, sponsor_impression, sponsor_click).
                              Es el medidor de patrocinadores; alimenta las métricas de
                              /admin. El visitor_id es un id al azar de localStorage,
                              no un dato personal
      utils/                 Validaciones, manejo de errores async, zonas horarias,
                              Cloudinary (compartido por upload.js y playerBilling.js),
                              billingReminders.js (los dos libros de cobranza),
                              matchScope.js (de dónde sale la conferencia/grupo de
                              un partido: se deriva de sus equipos, no se captura.
                              Exporta el SQL que comparten las tres consultas
                              públicas y el árbol del panel),
                              matchPhase.js (de dónde sale la FASE de un partido:
                              phase_id, o derivada de week_label),
                              standings.js (catálogo de desempates + motor de
                              ordenamiento; función pura, se prueba sin Postgres),
                              branchStandings.js (arma las tablas de una rama y
                              resuelve sus campeones),
                              rosterVisibility.js (qué sale de un roster en
                              público y quién lo decidió: los dos interruptores
                              de la categoría y el veto del equipo sobre la
                              foto. Puro, sin `db`, y con su versión de SQL
                              para las consultas que lo aplican sobre muchas
                              filas — ver "Roster público y pase de lista"),
                              attendance.js (el pase de lista: los dos estados,
                              quién aparece en la lista de un partido y cómo se
                              cuenta el acumulado. También puro; su consulta es
                              la MISMA para el público y para el pase de lista,
                              y lo único que cambia son las columnas que salen)
      seed.js                Datos de ejemplo para desarrollo local
    scripts/                 Scripts de diagnóstico y limpieza de un solo uso.
                              Los de SOLO LECTURA usan `pg` directo y sin
                              migraciones, seguros contra producción:
                              diagnose-failed-leagues.mjs,
                              find-orphan-roster-players.mjs y
                              report-legacy-club-padron.mjs. Los que ESCRIBEN
                              simulan por defecto y solo actúan con --confirm:
                              delete-orphan-roster-players.mjs (jugadores dados
                              de alta sin rama) y cleanup-legacy-club-padron.mjs
                              (tira las tablas viejas del padrón del club).
                              backfill-team-conferences.mjs le pone a cada equipo
                              la conferencia que ya tenía repetida en sus partidos;
                              simula por defecto y escribe con --apply, solo en
                              branch_teams (nunca en matches ni predictions).
                              verify-standings.mjs revisa la tabla de posiciones
                              (estructura + la tabla ya calculada de una rama);
                              es de SOLO LECTURA, no escribe ni una fila.
    tests/
      unit/                  Pruebas puras, corren en el CI sin base de datos:
                              validation, timezones, standings, orgRoles,
                              prodGuard, rosterVisibility y attendance. Las
                              cuatro últimas cuidan algo que se rompe en
                              silencio: el reglamento de desempates, quién puede
                              qué, si la cara de un menor sale en una página
                              abierta, y que "sin pasar lista" no se convierta
                              en "faltó".
      (resto)                Recorridos de punta a punta de cobranza (NO corren en
                              el CI: necesitan un backend vivo apuntado a una rama
                              de Neon). Ver backend/tests/README.md
      server.js              Arranque de Express: CORS, rate limiting, rutas, manejo de errores
  frontend/
    index.html               <head> con Google Identity Services (login con Google) —
                              ya no tiene el script de Travelpayouts Drive, ver "Monetización"
    src/
      pages/
        Home, LeaguePage, CalendarPage, MatchPage, Login, Register,
        RegisterLeague, RegisterOrganizationPage, RegisterTeamPage, Dashboard,
        Notifications, AdminPanel, InviteClaim
        TeamPanel.jsx            Panel de trabajo del equipo: una página, seis
                                 secciones (ver "Cuotas del club")
        PlayerStatementPage.jsx  /cuenta/:token — estado de cuenta del jugador,
                                 público y sin sesión
        PublicRosterPage.jsx     /partidos/:matchId/equipos/:teamId/roster — el
                                 roster recortado, público y sin sesión, y
                                 encima de la MISMA lista el pase de lista para
                                 quien tenga el permiso `asistencia`. No son dos
                                 pantallas: lo que cambia es si se puede marcar
      components/
        FlightSearchWidget.jsx   Botón "✈️ Vuelo" en MatchPage — despliega el
                                 widget de búsqueda de Aviasales (ver "Monetización")
        StandingsTable.jsx       Una tabla de posiciones. Solo pinta: el orden y
                                 los desempates ya vienen resueltos del backend
        StandingsView.jsx        Campeones + pestañas por nivel + las tablas.
                                 La usan la página pública y la vista previa del panel
        CompetitionModelModal.jsx  El panel de "⚙ competencia" de una rama:
                                 Fases · Formato · Títulos · Vista previa
                                 (ver "Tabla de posiciones y modelo de competencia")
        (resto de components/), context/, api/
      utils/
        offlineQueue.js       La REGLA de la cola sin señal: qué se fusiona,
                              cuándo se reintenta, qué se enseña. Pura — la
                              cubre el CI (ver "Capturar sin señal")
        offlineDb.js          IndexedDB: el partido preparado y la cola
        offlineOutbox.js      La cola viva: persiste, reintenta sola y sube al
                              volver la señal, esté abierta o no la pantalla
        serviceWorker.js      Registro al arrancar + la descarga explícita que
                              dispara "Preparar partido"
        matchServices.js      Hotel (buildHotelSearchUrl) y Vuelos (iataForCity,
                               IATA_BY_CITY) — accesos comerciales por partido
        matchScope.js         Lado del navegador de la herencia de conferencia:
                               la etiqueta del partido (matchScopeLabel, la misma
                               en panel/calendario/página de partido), el filtro
                               por conferencia y el aviso de "a este equipo le
                               falta asignarla". No decide nada — el backend
                               resuelve por su cuenta
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

La cadena termina en `?sslmode=verify-full`, y eso **no** es cosmético: `pg`
parsea `DATABASE_URL` y con lo que saca de ahí **pisa** el objeto `ssl` que
`config/db.js` le pasa a mano (`Object.assign` en `connection-parameters.js`),
así que el nivel real de verificación TLS lo decide la URL, no el código. Ese
objeto solo manda cuando la cadena viene **sin** `sslmode`, y por eso dice
`rejectUnauthorized: true`: es el único caso en que evita conectar sin validar.

```powershell
npm run seed     # opcional: crea datos de ejemplo (ligas, categorías, partidos)
npm run dev      # http://localhost:4000
```

#### Tu `DATABASE_URL` en local apunta a una rama, no a producción

Desde el 2026-09-19 el local trabaja contra la rama de Neon
**`desarrollo-local`**, no contra la base real. Es lo que exige la regla 1 de
`CLAUDE.md`, y desde esa fecha hay un candado que lo hace cumplir: si
`DATABASE_URL` apunta al host de `PROD_DATABASE_HOST`, **`npm run dev` se niega
a arrancar** (ver "Seguridad" para lo que el candado no cubre).

Una rama de Neon es una copia instantánea y copy-on-write: trae los datos
reales del momento en que se creó, pero lo que escribas ahí **no sube a
producción** y lo que pase en producción después **no baja a la rama**. Cuando
quieras datos frescos, se borra y se crea otra — son segundos y no cuesta nada.

```powershell
# Recrearla (el CLI no está instalado; se usa por npx)
npx -y neonctl@latest branches delete desarrollo-local `
  --project-id empty-feather-77325991 --org-id org-twilight-lab-25712139

npx -y neonctl@latest branches create --name desarrollo-local `
  --project-id empty-feather-77325991 --org-id org-twilight-lab-25712139
```

Del JSON que devuelve, la cadena que va en `DATABASE_URL` se arma con el
**`pooler_host`** (no el `host` pelón: así el local se comporta como producción,
que también va por el pooler en modo transacción) y terminada en
`?sslmode=verify-full`:

```
postgresql://<role>:<password>@<pooler_host>/<database>?sslmode=verify-full
```

`--org-id` no es opcional aunque solo haya una organización: sin él el CLI abre
un prompt interactivo que cuelga en una terminal no interactiva.

**Para ver producción de verdad** —leer, no escribir— está la salida de
emergencia del candado, que caduca sola el mismo día:

```powershell
$env:ALLOW_PROD_DB="2026-09-19"; npm run dev
```

> **Por qué existe todo lo de arriba.** Los dos sustos que lo provocaron, de
> vuelta en la época en que la `DATABASE_URL` local apuntaba a la base real:
>
> 1. **Levantar un segundo backend interrumpe el servicio.** Si ya hay uno
>    corriendo en el 4000 y arrancas otro, el segundo falla por `EADDRINUSE`
>    — pero antes de morir alcanza a correr `initSchema()` contra la base, y
>    eso tumba las consultas del que sí está sirviendo. Se ve como una tanda
>    de **500 en todos los endpoints** durante unos segundos, sin ninguna
>    causa aparente. Se cura solo al recargar; el error no es de la app.
> 2. **Todo lo que se probaba en local escribía en producción.** Registrar una
>    liga, invitar administradores o dar de alta jugadores desde
>    `localhost:5173` creaba filas reales, y la única defensa era acordarse. Por
>    eso ahora la defensa es el candado y la rama, no la memoria.

### 2. Frontend

En otra terminal:

```powershell
cd frontend
npm install
npm run dev      # http://localhost:5173
```

### 3. Pruebas de cobranza (opcional)

Dos recorridos de punta a punta en `backend/tests/`. **Nunca contra producción**
— se corren apuntando a una rama de Neon. Instrucciones en
`backend/tests/README.md`.

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
7. También puede invitar a alguien más a administrar esa misma liga o equipo con el mismo acceso (botón "+ Invitar administrador" en el panel), sin quitarle el acceso a nadie — a diferencia del punto anterior, aquí no hay reemplazo, puede haber varios administradores a la vez.

**Admin (rol `admin`):**

- Acceso a `/admin` con endpoints propios en `admin.js` (fuera del alcance de un representante normal).
- Pestaña "Ligas": aprueba ligas pendientes (aparecen primero en la lista, marcadas), o las elimina.

## Monetización (afiliados de viaje)

La plataforma monetiza mediante comisión de afiliado en dos accesos de `MatchPage`: 🏨 Hotel y ✈️ Vuelo. Ninguno de los dos vende nada directamente — ambos mandan al usuario a un tercero (Booking.com, Aviasales) que sí procesa la reserva y el pago; CFBAMX solo cobra comisión cuando esa reserva se completa.

Todo corre a través de una sola cuenta de **Travelpayouts** (red de afiliados de viaje), sin necesidad de tener una empresa constituida — basta con RFC persona física con actividad empresarial para poder facturar la comisión más adelante.

### Hotel — link limpio, sin comisión activa por ahora

- `buildHotelSearchUrl()` en `matchServices.js` arma un link normal a `booking.com/searchresults.html` con la ciudad de la sede y la fecha del partido — sin ningún ID de afiliado hardcodeado.
- **Travelpayouts Drive se quitó de `frontend/index.html`** (septiembre 2026): era el script que detectaba ese link en el navegador del usuario y le agregaba el marcador de afiliado automáticamente. Se quitó porque también insertaba contenido/ofertas por su cuenta (anuncios, en la práctica) y Brave Shields lo bloqueaba de cualquier forma. **Efecto: el botón Hotel hoy no genera ninguna comisión** — el link sigue funcionando normal para el usuario, solo que sin marcador de afiliado.
- La variable de entorno `VITE_HOTEL_AFFILIATE_ID` sigue en el código como alternativa: si se configura con un ID de afiliado **directo** de Booking.com (sin pasar por Travelpayouts ni por ningún script de terceros), `buildHotelSearchUrl()` le agrega el parámetro `aid` directo a la URL. Antes debía quedar vacío para no chocar con Drive; ahora que Drive no existe, ya se puede configurar sin conflicto. **Pendiente**: conseguir ese ID (ver "Pendientes abiertos").

### Vuelo — widget embebido de Aviasales

- El botón "✈️ Vuelo" (`FlightSearchWidget.jsx`) despliega, dentro de la misma tarjeta del partido, el widget "Flights Search Form" de Aviasales (vía Travelpayouts) — el usuario busca y compara sin salir de la página; solo sale del sitio al momento de reservar.
- El **destino** viene pre-cargado según la ciudad de la sede, resuelta a código IATA con el diccionario `IATA_BY_CITY` (`matchServices.js` — cubre las ciudades mexicanas con aeropuerto más comunes para sedes de ligas; si una sede real no aparece ahí, el botón de Vuelo no se muestra — nunca se manda un destino adivinado).
- El **origen** no se pide — Aviasales lo detecta por la IP del usuario.
- La **fecha** no se puede pre-cargar (este tipo de widget no lo soporta); se le muestra al usuario la fecha del partido como texto de referencia arriba del formulario, para que la ajuste ahí mismo.
- El código base del widget (`AVIASALES_WIDGET_BASE_SRC` en `FlightSearchWidget.jsx`) incluye el marcador de afiliado (`shmarker`) y el diseño configurado en Travelpayouts (Tools → Search Forms). Si se vuelve a generar el widget desde su panel con otro diseño, hay que actualizar esa constante con el código nuevo completo.
- A diferencia de Booking, Aviasales no requirió aprobación manual — quedó activo automáticamente al registrarse en Travelpayouts.

### Pendiente del lado de la cuenta (no de código)

- Conseguir un ID de afiliado directo de Booking.com y configurarlo en `VITE_HOTEL_AFFILIATE_ID` (ver "Hotel" arriba y "Pendientes abiertos") — es lo único que falta para que el botón Hotel vuelva a generar comisión, ahora que ya no depende de Travelpayouts Drive ni de su aprobación de programa.
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
| `POST` | `/entries/:id/void` | liga — cancela un cargo/pago (2 escrituras); rechaza un pago reportado (1 escritura, sin ajuste) |
| `POST` | `/entries/:id/confirm` | liga — confirma un pago que reportó el equipo |
| `PATCH` | `/leagues/:leagueId/settings` | liga — prende/apaga los recordatorios automáticos |
| `GET` | `/teams/:id/leagues` | equipo — las ligas con las que tiene cuenta, cada una con su saldo |
| `GET` | `/teams/:id/statement` | equipo (o la liga) — su estado de cuenta con una liga (`?league_id=`) |
| `POST` | `/teams/:id/report-payment` | equipo — reporta un pago con comprobante (nace `pending`); `league_id` en el cuerpo |
| `POST` | `/teams/:id/withdraw-payment` | equipo — retira su propio reporte antes de que se lo confirmen; `league_id` en el cuerpo |

Permisos: los endpoints de liga usan `leagueOwnerRequired`; los del equipo usan
`teamOwnerRequired` (deja pasar al rep del equipo **y** a la liga). Un equipo nunca
puede ver la cuenta de otro, y solo puede retirar lo que reportó él mismo
(`created_by_side = 'team'`), no lo que capturó la liga. Nada de cobranza aparece
en el sitio público.

### Un equipo puede deberle a varias ligas

**Construido el 2026-09-21.** El README venía prometiendo desde el 2026-09-20
que "un equipo puede participar en torneos de varias ligas a la vez". Para el
calendario y la tabla ya era cierto; para el dinero no, y esta sección es lo que
lo hizo cierto.

**Qué estaba clavado.** El libro nunca fue el problema:
`team_ledger_entries` guarda `(league_id, team_id)` desde que existe, así que
siempre supo distinguir ligas. Lo que estaba clavado era todo lo que lo rodeaba,
y siempre por la misma columna, `teams.league_id`:

- `teamInLeague()` validaba con `WHERE id = ? AND league_id = ?`.
- El panorama de la liga y las dos rutas de cargos listaban equipos con
  `WHERE league_id = ?`.
- El equipo tenía **un solo** estado de cuenta, sin forma de decir de cuál liga.

**Qué contesta ahora "¿a qué ligas le puede deber este equipo?".** La membresía,
`league_teams` — la tabla que ya decía "este equipo es de la casa de esta liga"
— **unida a las ligas que ya tienen movimientos suyos**:

```sql
WHERE l.id IN (SELECT league_id FROM league_teams        WHERE team_id = ?)
   OR l.id IN (SELECT league_id FROM team_ledger_entries WHERE team_id = ?)
```

La segunda mitad no es un detalle: sin ella, **una liga podría hacer desaparecer
una deuda sacando al equipo de su roster**. El saldo se sigue calculando sumando
el libro (regla 5), así que el dinero no se iría a ningún lado — pero el equipo
dejaría de verlo, que para el caso es igual de malo. Un equipo al que ya se le
cobró sigue viendo esa cuenta aunque ya no juegue ahí, hasta que quede en cero.

> **`league_teams` no se llenaba sola, y ese era el bloqueador real.**
> `POST /manage/leagues/:leagueId/teams` escribía `teams.league_id` y nada más:
> la fila de `league_teams` solo aparecía en el **siguiente arranque** del
> servidor, por el backfill de `initSchema()`. Mientras la cobranza validaba con
> la columna vieja eso no se notaba; al cambiar de tabla, un equipo recién
> creado habría dejado de ser cobrable hasta el próximo deploy. Por eso ese
> endpoint ahora inserta también en `league_teams`, y es el cambio que convierte
> a esa tabla en la fuente de verdad en vez de una copia que se repara sola.

**Cómo se pide la liga, sin romper nada al desplegar.** Ninguna URL cambió, a
propósito: renombrar rutas tiene ventana de incompatibilidad (ver "Fase B") y
aquí no hacía falta pagarla. Las tres rutas del equipo aceptan la liga como
parámetro opcional —`?league_id=` al leer, `league_id` en el cuerpo al
escribir— y cuando no viene:

- **una sola liga** → se usa esa, que es lo que hacía antes y cubre a todos los
  equipos que existen hoy;
- **varias** → `400` pidiendo cuál, en vez de adivinar y cobrarle a la
  equivocada;
- **ninguna** → el estado de cuenta vacío de siempre.

Así un cliente viejo durante los ~80 segundos del despliegue sigue funcionando
igual, y el único caso que no cubre —un equipo con dos ligas y la pestaña sin
recargar— todavía no existe.

**Dos reglas que se volvieron por liga, no por equipo.** Las dos eran correctas
mientras un equipo tenía una sola liga y las dos se vuelven bugs en cuanto tiene
dos:

1. **"Un pendiente a la vez"** ahora es uno **por liga**. Tener un pago en
   revisión con la liga A no puede impedir reportarle a la B: la razón de esa
   regla es no llenarle a **una** liga la bandeja de duplicados, y esa bandeja
   es de cada quien.
2. **Retirar un pago** filtra por liga. Antes `withdraw-payment` buscaba
   *cualquier* pendiente del equipo (`WHERE team_id = ?`, sin liga), así que con
   dos ligas habría retirado el de la otra — el equipo le retira a la A y el
   pago que desaparece es el de la B. Era un bug latente, sin fuga hoy porque
   nadie tiene dos ligas todavía.

**En pantalla.** Con una sola liga, la sección se ve **exactamente igual que
antes**: no se le agrega un selector a quien no tiene nada que elegir. Con
varias, arriba aparece una fila de pestañas —una por liga, con su saldo— y todo
lo de abajo (saldo, vencimiento, movimientos, reportar pago) es de la liga
seleccionada.

### Conciliación — el equipo reporta, la liga confirma

Ya no solo escribe la liga. Los **cargos** siguen siendo suyos, pero un **pago**
lo puede registrar ella (nace `confirmed`) o reportarlo el equipo con su
comprobante (nace `pending`). Es el mismo mecanismo que un papá con su club, un
nivel arriba, y resuelve el mismo problema: dejar de perseguir capturas de
pantalla en WhatsApp para capturarlas a mano.

- `POST /billing/teams/:id/report-payment` (`teamOwnerRequired`) — el equipo
  reporta. El comprobante sube por el `POST /api/upload` de siempre, porque aquí
  sí hay sesión (el papá no tiene cuenta y por eso necesitó su propio endpoint).
- `POST /billing/entries/:id/confirm` — la liga confirma; ahí sí mueve el saldo.
- `POST /billing/teams/:id/withdraw-payment` — el equipo retira su propio
  reporte. Existe porque solo se permite **un pendiente a la vez** (para no
  llenarle la bandeja a la liga de duplicados), y sin poder retirarlo quien
  tecleó 500 en vez de 5000 se quedaba atorado esperando un rechazo ajeno. Lo
  mismo se agregó del lado del papá
  (`POST /player-billing/statement/:shareToken/withdraw-payment`).
- Rechazar dispara `billing_payment_rejected` a la bandeja del equipo con el
  motivo — si no, se queda creyendo que ya quedó.

Los cuatro estados de un pago, que es donde está todo el cuidado:

| status | ¿suma al saldo? | ¿lleva ajuste de reversa? |
|---|---|---|
| `pending` | no | — |
| `rejected` | no | **no** |
| `withdrawn` | no | **no** |
| `confirmed` / `settled` | sí | — |
| `void` (un confirmado que se canceló) | **sí** | **sí** |

Ese último renglón es el que engaña: un pago cancelado sigue sumando `+amount`
porque su cancelación ya metió un `adjustment` de signo contrario; excluirlo
restaría el monto dos veces.

**Por eso `rejected` y `withdrawn` necesitan estado propio y no pueden compartir
`void`.** La primera versión les ponía `void` y el saldo se inflaba por el monto
completo: dejaban de contar como `pending`, empezaban a sumar como pago, y nadie
había creado el ajuste que los revirtiera (correctamente, porque nunca se
abonaron). El recorrido de punta a punta lo cazó — a Carlos le rechazaban un
pago de 1,500 y su adeudo pasaba de 1,500 a cero.

Retirar, además, solo alcanza a lo que reportó uno mismo (`created_by_side`), no
a lo que capturó el cobrador.

En el frontend: bandeja "pagos por confirmar" arriba de todo en
`BillingLeaguePanel` (es lo único de la pantalla que pide una acción hoy), y
botón "Ya pagué — reportar pago" en la sección "Con la liga" del panel del
equipo. `ReportPaymentForm` se generalizó para servir a los dos niveles: recibe
`uploadProof` y `submitPayment` como funciones, en vez de existir dos
formularios casi idénticos que se desincronizan en cuanto se toca uno.

### Recordatorios

`utils/billingReminders.js` (`runBillingReminders`) se ejecuta en el bloque
**diario** de `POST /api/notifications/trigger` — el mismo cron externo que ya
manda los avisos de partidos, sin configuración nueva. Una vez al día lo llamen
las veces que lo llamen; ver "Cadencia del cron". Solo corre para ligas con
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

Cobro en línea (pasarela — ver Fase 2 de "Roadmap de negocio" más abajo);
facturación/CFDI; pago de la liga a árbitros; desglose por jugador; suspender a
un equipo por adeudo.

~~El equipo reportando pagos con comprobante para que la liga confirme/rechace~~
— **hecho**, ver "Conciliación" aquí abajo.

~~Pendiente: una pasada de estilo a `BillingLeaguePanel`~~ — **hecho**. La pantalla
adoptó las piezas que nacieron para el panel del equipo y borró su copia de cada
una: `.data-table` (en vez de la clase `billing-table`, que no existía en ninguna
hoja de estilo), `LedgerEntryList` (en vez de un `LedgerList` interno que pintaba
lo mismo con otros estilos), `utils/money.js` (en vez de `money`/`fmtDate`/
`balanceColor`/`balanceText` repetidos ahí) y `ConfirmDialog` en lugar del
`window.confirm` del navegador, que no podía decir qué movimiento se estaba
cancelando ni pedir el motivo. Se le agregó además la tira de KPIs (por cobrar,
vencido, % al corriente), derivada de las filas que el overview ya devolvía, sin
pedirle nada nuevo al backend.

La forma de este libro **sí** se reusó en **equipo → jugador** (ver "Cuotas del
club" más abajo), pero en una tabla hermana (`club_ledger_entries`), no en esta:
aquí `league_id`/`team_id` son `NOT NULL`, los índices están afinados para
liga→equipo y `billingReminders.js` barre esta tabla completa. Lo que se reusó
fue el modelo — append-only, cancelación por reversa, saldo calculado — no las
filas. El préstamo terminó yendo en las dos direcciones: la conciliación nació
aquí y se reusó allá, y las piezas de interfaz (`.data-table`, `ConfirmDialog`,
`LedgerEntryList`, `utils/money.js`) nacieron allá y se adoptaron aquí. Hoy los
dos libros tienen las dos cosas — son los dos puntos tachados de arriba.

## Cuotas del club (equipo → jugadores)

El otro lado de la cobranza: la liga le cobra al equipo (sección anterior) y el
equipo le cobra a sus jugadores. Reemplaza el flujo real de un club amateur —
Excel del tesorero + capturas de SPEI sueltas en el grupo de WhatsApp — sin
pedirle cuenta a nadie de la familia.

### Modelo

Tabla **hermana** de `team_ledger_entries`, no la misma: allá `league_id` y
`team_id` son `NOT NULL`, sus índices están afinados para liga→equipo y
`billingReminders.js` la barre completa. La nota del README sobre "reusar el
modelo" siempre se refirió a la FORMA del libro, no a compartir filas.

- **`club_ledger_entries`** (`config/db.js`) — mismo libro append-only: un
  movimiento no se edita ni se borra; cancelar es `status='void'` en el original
  **más** una fila `adjustment` que revierte el monto (idempotente vía
  `reverses_entry_id`). El saldo nunca se guarda, se suma. Cuelga de
  `club_members` (`member_id`), no de `players`.
- **`club_members`** — **el padrón del club**, y la pieza que hace que todo esto
  funcione sin liga. Una fila por persona en un equipo, con **identidad propia**:
  su nombre (`display_name`, un solo campo y lo único obligatorio) y, opcionales,
  `birth_date` / `curp` / `photo_url` / `position` / `jersey_number`. Más su
  relación comercial con este club: su cuota (`monthly_amount`), su categoría
  interna (`group_label`), a quién se le cobra (`tutor_name` / `tutor_phone` /
  `tutor_email`), su situación (`activo` / `beca` / `baja`), el token de su estado
  de cuenta público (`share_token`) y cuándo se le recordó por última vez
  (`last_reminded_at`).
  > Las tablas anteriores, `team_player_accounts` y `player_ledger_entries`, ya
  > no las crea ni las usa nadie. Se tiran con
  > `scripts/cleanup-legacy-club-padron.mjs` (simula por defecto).
- **`teams.brand_color`** y **`teams.player_billing_reminders_enabled`** —
  color de acento del panel (solo UI) e interruptor de recordatorios, equivalente
  a `leagues.billing_reminders_enabled`.

### El padrón del club NO es el roster de torneo

Esto se corrigió después de la primera versión y es la decisión más importante de
toda la sección. La V1 creaba las cuentas a partir de `player_team_memberships`
(el roster por rama). Eso ataba la contabilidad a que **la liga** inscribiera al
equipo en una rama, con dos consecuencias inaceptables: un equipo independiente
no podía cobrarle a nadie **nunca**, y uno con liga se quedaba esperando a que lo
inscribieran para poder registrar una mensualidad que ya estaba cobrando por
fuera. Se inhabilitaban funciones de un equipo por algo que no depende de él.

Son dos poblaciones distintas y ninguna manda sobre la otra:

| | Roster de torneo | Padrón del club |
|---|---|---|
| Tablas | `players` + `player_team_memberships` | `club_members` |
| Qué es | Quién puede jugar en qué rama de qué torneo | Quién entrena aquí y a quién le cobra el club |
| Quién lo arma | La liga, al inscribir al equipo | El club, siempre |
| Para qué sirve | Elegibilidad | Cobranza (y más adelante, asistencia a entrenamientos) |
| Sin liga | No existe | Existe igual |
| Agrupación | Rama y categoría de la liga | `group_label`, texto libre del club ("U17", "Femenil") |
| Nombre | `first_name` + `last_name`, los dos obligatorios | **Un solo `display_name`** |
| Ficha pública | Sí (`/jugador/:id`) | **Nunca** |

**Desde septiembre 2026 no comparten ni tabla.** Antes las dos vivían en
`players`, y aunque las filas ya eran independientes (importar copiaba, no
enlazaba), compartir tabla traía tres problemas concretos:

1. Nada en la fila decía a qué mundo pertenecía. La separación existía solo
   porque ninguna consulta los cruzaba — un acuerdo tácito, no una regla.
2. `GET /players/:id/card` es **público** y servía cualquier fila de `players`,
   así que los clientes del padrón —nombre, fecha de nacimiento, CURP y foto, en
   buena parte menores de edad— eran consultables adivinando un id.
3. `players.first_name`/`last_name` son `NOT NULL`, lo que le imponía al club una
   formalidad que no tiene: cuando registra a alguien puede conocerlo nada más
   por su apodo, y el tesorero tenía que inventarle un apellido para guardarlo.

Por eso el padrón tiene ahora su propia tabla y su propia forma. Lo obligatorio
de una persona aquí es **un solo campo**: `display_name`. "Juan Pérez", "El
Güero" y "Sofía (hija de Marta)" son todos nombres válidos. Fecha de nacimiento,
CURP y foto son opcionales de verdad.

**No se sincronizan.** Dar de alta a alguien en uno no lo da de alta en el otro,
y editar uno no toca al otro — ahora por construcción, no por convención:
`club_members` no tiene ninguna columna que apunte a `players`.

Lo único que los cruza es un botón opcional, **"Importar de un roster de
torneo"**: copia los nombres una vez para que un club que ya subió 40 jugadores
por la plantilla de Excel no los tenga que volver a teclear. **Copia texto, no
enlaza filas** — si la liga después da de baja a alguien de su roster, el club lo
sigue teniendo y cobrándole sin enterarse, y al revés también. Salta a quien ya
esté en el padrón (por CURP, si no por nombre completo), así que se puede correr
dos veces sin duplicar.

### Dos diferencias de fondo con el libro de la liga

**1. El papá escribe.** Reporta su pago con comprobante desde un link público,
sin cuenta y sin sesión — la mayoría de los jugadores no tiene usuario
(`players.user_id` es nullable y sigue sin existir un flujo para reclamarlo).
Ese pago nace en `status='pending'` y **no baja el saldo** hasta que el club lo
confirma. De ahí el `created_by_side='player'`.

Ojo con el orden de los `CASE` en `BALANCE_SUM_SQL`: `'pending'` se descarta
antes del caso general de `payment`, y ese caso general **no** filtra por status
a propósito. Un pago cancelado sigue sumando `+amount` porque su cancelación ya
metió un `adjustment` de signo contrario — si además se excluyera, el monto se
restaría dos veces. Por la misma razón, **rechazar un pago pendiente no genera
ajuste**: nunca entró al saldo, así que no hay nada que revertir.

**2. El aviso al papá lo dispara un humano.** El panel arma el mensaje de
WhatsApp (`wa.me/...`, sin API y sin costo) con nombre, monto, vencimiento y el
link del estado de cuenta; el tesorero lo manda y puede editarlo antes. La
plataforma solo registra cuándo (`last_reminded_at`), y la tabla muestra
"recordado hace 3 días".

### Endpoints — `routes/playerBilling.js` (`/api/player-billing`)

Todos los privados van con `teamOwnerRequired`, que ya existía y ya deja pasar
tanto a la organización del equipo como a la de su liga.

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/teams/:id/overview` | KPIs, padrón con saldo, pagos por confirmar, flujo mensual, lotes repetibles |
| POST | `/teams/:id/members` | Alta en el padrón del club (una fila en `club_members`: persona y ficha juntas) |
| PATCH | `/teams/:id/members/:memberId` | Edita persona **y** ficha de cobranza en una llamada |
| DELETE | `/teams/:id/members/:memberId` | Baja si ya tiene movimientos; borrado real solo si nunca tuvo (misma URL que el PATCH: lo distingue el método) |
| POST | `/teams/:id/members/import-roster` | Copia (una vez) de un roster de torneo |
| GET | `/teams/:id/members/:memberId/entries` | Libro de un miembro del padrón |
| POST | `/teams/:id/charges` | Cargos en bloque, monto por jugador — lo esporádico (uniforme, viaje, arbitraje) |
| POST | `/teams/:id/members/:memberId/payments` | Pago capturado por el club (nace confirmado) |
| POST | `/entries/:entryId/confirm` | Confirmar un pago reportado por el papá |
| POST | `/entries/:entryId/void` | Cancelar / rechazar |
| POST | `/teams/:id/members/:memberId/rotate-token` | Regenerar el link (si se filtró) |
| PATCH | `/teams/:id/settings` | Recordatorios y cobro automático (parcial: solo toca las claves que le llegan) |
| **GET** | **`/statement/:shareToken`** | **Público, sin sesión** |
| **POST** | **`/statement/:shareToken/report-payment`** | **Público** — un pendiente a la vez por jugador |
| **POST** | **`/statement/:shareToken/upload-proof`** | **Público** — subida del comprobante |

En los tres públicos el token **es** la credencial. La respuesta del estado de
cuenta se arma campo por campo en vez de devolver la fila: de ahí nunca debe
salir el teléfono del tutor, el id interno del jugador, ni rastro de ningún otro
jugador. Van con su propio limitador (`publicStatementLimiter` /
`reportPaymentLimiter` en `middleware/rateLimit.js`).

> **Nombres en la API.** El padrón son `members` y su id es `member_id`; el
> nombre es un solo `display_name`. `first_name` / `last_name` ya no existen
> en este router — ver "Fase B" más abajo. Lo que sigue diciendo "player" es el
> prefijo `/api/player-billing`, y ahí está dicho por qué.

El comprobante no puede pasar por `POST /api/upload` porque ese exige sesión; la
configuración de Cloudinary se sacó a **`utils/cloudinary.js`** en cuanto hubo un
segundo llamador, y el comprobante va a `lifa-app/comprobantes` sin el recorte
cuadrado de los logos (una captura de SPEI es alta y angosta, y a 800x800 el
monto queda ilegible). **Nota de privacidad**: la URL de Cloudinary es pública
para quien la tenga — mismo trato que `proof_url` en la cobranza liga→equipo.

### La mensualidad se genera sola (y por qué no se "repite")

La V1 tenía un botón **"Repetir el mes pasado"**: se elegía el lote de
septiembre y se volvía a crear con la fecha de octubre. Se retiró, y no por
sus dos bugs —que los tenía— sino porque el modelo estaba mal de origen: **si
una cuota ya está configurada como mensual, que alguien tenga que acordarse de
apretar un botón el día correcto de cada mes no es una función, es una tarea
pendiente que la plataforma le deja al tesorero.**

Ahora el club configura **una sola fecha** —el día en que se paga, típicamente
el 1 o el 15— y el cargo nace solo, cinco días antes, para cada miembro
`activo` con `monthly_amount > 0`, por el monto de su propia ficha.

**No existe el concepto de "vencimiento" aparte de la fecha de pago.** Es
deliberado y viene de cómo se cobra de verdad en un club: hay una fecha de
pago, del día siguiente en adelante *se debe*, y lo que no se pagó se acumula
con el mes que entra. Dos fechas para lo mismo ("se genera el 1 pero vence el
10") era precisión que nadie usaba.

Lo esporádico —uniforme, viaje, arbitraje, multa— se sigue cobrando a mano con
**Generar cargo**, que es justamente lo que no tiene fecha fija. Por eso el
formulario manual ya no ofrece la categoría `mensualidad`: el backend la sigue
aceptando porque el ciclo la escribe, pero ofrecerla en los dos lados era
invitar al doble cobro.

#### La idempotencia es de la base, no del código

Esto se llama desde **dos** lugares:

1. El cron, al final de `POST /api/notifications/trigger`.
2. **La carga del panel** (`GET /teams/:id/overview`), de forma perezosa.

Lo segundo no es redundancia por gusto: **el cron es externo al repositorio**.
No está en `.github/workflows/`, no hay `render.yaml`, no hay `node-cron`, y su
frecuencia no está documentada en ningún archivo del proyecto — vive en el
panel de un proveedor de fuera. Colgar de ahí la generación de dinero significa
que si ese cron se cae, el club **deja de facturar en silencio**. La vía
perezosa es lo que garantiza que el cargo exista aunque el cron lleve semanas
muerto.

Que se pueda llamar dos veces obliga a que llamarla dos veces sea inofensivo, y
eso **no se confía al código**: lo garantiza un índice único parcial.

- `club_ledger_entries.auto_cycle_key` — `'mensualidad:OCT-2026'` en lo que
  generó el ciclo, **NULL en todo lo que capturó un humano**.
- `idx_club_ledger_auto_cycle` — `UNIQUE (team_id, member_id, auto_cycle_key)
  WHERE auto_cycle_key IS NOT NULL`, más `ON CONFLICT DO NOTHING`.

Dos decisiones de la forma de ese índice que parecen detalle y no lo son:

1. **El predicado es inmutable.** Se filtra por `auto_cycle_key IS NOT NULL`, no
   por `status`. Así una fila nunca sale del índice, y **cancelar una
   mensualidad automática impide que se regenere**. Si se filtrara por status,
   el cargo cancelado saldría del índice y la siguiente corrida lo reviviría:
   el tesorero cancela octubre, abre el panel al día siguiente y reaparece. Para
   dinero, el humano le gana al robot.
2. **La columna nace NULL en toda la tabla**, así que el índice se crea sobre
   cero filas y **no puede fallar por duplicados históricos**. Importa porque
   `run()` de `initSchema()` se traga el error de cualquier migración que falle
   (ver el `SAVEPOINT` en `config/db.js`): un índice que fallara ahí no
   aparecería en ningún log. Por si acaso, el generador **se niega a insertar**
   si el índice no existe, y `scripts/report-mensualidades-duplicadas.mjs` lo
   reporta.

Además hay una **guarda blanda** en el `WHERE`: el ciclo no cobra un mes que un
humano ya cobró a mano. Esa sí es heurística —compara por el mes de la fecha de
pago— y no puede ser un índice, porque un cargo manual no tiene identidad de
periodo confiable (`period_label` es texto libre y opcional).

#### Cuánto hacia atrás genera

Una corrida evalúa **mes−1, mes y mes+1**, y ese rango está codificado en la
forma de la consulta (`generate_series(-1, 1)`), no en una condición que se
pueda relajar por accidente: es **estructuralmente imposible** que una corrida
produzca una avalancha de meses.

- Recupera hasta un mes de cron caído. Si el cron murió en noviembre y alguien
  abre el panel en diciembre, se generan **noviembre y diciembre**. Si solo se
  generara diciembre, el club perdería un mes de ingreso sin enterarse, que es
  justo lo que esto vino a evitar.
- Si el cron estuvo muerto **más de dos meses** y nadie abrió el panel, ese mes
  se pierde y hay que capturarlo a mano. Es una pérdida acotada y preferible a
  la alternativa.
- `teams.monthly_charge_started_on` se sella al encender el interruptor y nunca
  se genera un periodo cuya fecha de pago sea anterior. Sin eso, un club que
  lleva un año en la app y lo enciende hoy recibiría doce meses de cargos
  inventados. Se vuelve a sellar en cada transición apagado → encendido.
- El día de cobro se limita a **1–28** (`CHECK`), lo que elimina de raíz el caso
  borde de febrero. "El último día del mes" no existe en esta versión.

#### Cambiar la cuota NO reescribe lo ya cobrado

Regla explícita, porque es la tentación obvia: `club_members.monthly_amount` es
**la configuración**; cada cargo guarda **su propio `amount`**. Si Juan pagaba
$1,000 en septiembre y en octubre sube a $1,200, septiembre se queda en $1,000
para siempre. El libro es append-only y un cargo pasado no se edita ni se
recalcula.

### Recordatorios

`utils/billingReminders.js` ahora exporta **dos** funciones, llamadas ambas en
el bloque **diario** de `POST /api/notifications/trigger` (ver "Cadencia del
cron"): la de siempre (liga→equipo) y `runPlayerBillingReminders`. Misma
cadencia (por vencer una vez a ≤3 días; vencido cada 3 días, hasta 4 veces) y
mismas banderas por fila.

La diferencia: el aviso va **agregado, uno por equipo y por corrida**
("3 jugadores tienen cuotas vencidas — $2,400 en total"), no uno por movimiento.
Un equipo de 40 jugadores generaría 40 avisos idénticos y volvería inservible la
bandeja; y quien lo lee es el tesorero, que necesita saber a quién perseguir
hoy, no el detalle fila por fila (ese ya está en el panel).

**El aviso nunca le llega al papá**: `notifications` tiene
`CHECK (recipient_type IN ('league','team'))` y los jugadores no tienen cuenta.
Tipos nuevos: `player_payment_reported`, `player_billing_due_soon`,
`player_billing_overdue`.

### Frontend — el panel de trabajo

`/panel/equipo/:id` pasó de 256 líneas de editor de perfil a un workspace. Una
sola página (`pages/TeamPanel.jsx`) resuelve el equipo y el permiso una vez y
monta la sección que pide la ruta, en vez de seis páginas repitiendo lo mismo.
`components/TeamWorkspace.jsx` pone el encabezado y la navegación.

| Ruta | Sección |
|---|---|
| `/panel/equipo/:id` | Resumen — KPIs, gráfica de cobranza, actividad reciente |
| `/panel/equipo/:id/finanzas` | **Cuotas** — bandeja de conciliación, tabla de jugadores, WhatsApp |
| `/panel/equipo/:id/jugadores` | **Padrón del club** (alta/baja) + rosters de torneo, separados |
| `/panel/equipo/:id/estado-de-cuenta` | Con la liga (solo lectura; conserva su URL de siempre) |
| `/panel/equipo/:id/perfil` | Perfil público + color del club |
| `/panel/equipo/:id/administradores` | `OrgAdminsPanel` |
| `/cuenta/:shareToken` | **Público, fuera de `ProtectedRoute`** — lo abre el papá |

`Dashboard.jsx` quedó en 22 líneas: ya solo sirve "Mi panel". `TeamStatementPanel.jsx`
se retiró — su contenido vive en `components/TeamLeagueStatementSection.jsx`.

La sección **Jugadores** muestra los dos padrones, uno debajo del otro y con los
nombres bien puestos, para que nadie los confunda: arriba el padrón del club (con
alta, edición y baja) y abajo los rosters de torneo. Los rosters de torneo
siguen usando el `BranchRosterModal` de siempre, con su plantilla de Excel — el
backend de roster no se tocó; solo se agregó
`GET /api/players/teams/:id/branches` para poder listarlos, porque hasta ahora la
única puerta de entrada al roster era el panel de la LIGA aunque
`branchTeamOwnerRequired` ya le diera acceso al equipo.

### Pasada de estilo (lo que hacía falta para que se vea de herramienta de paga)

`styles.css` se detenía en color y tipografía. Se agregaron tokens de espaciado,
radio y sombra, una rampa de grises neutros y un azul informativo — los dos
acentos que había (`--flag` amarillo, `--field` verde) ya estaban ocupados
semánticamente por debe / a favor. El acento del workspace (`--accent`) lo pone
cada club con su `brand_color`, y `utils/color.js` calcula la luminancia para
decidir si el texto encima va negro o blanco.

Ese acento se aplica a `:root` con el hook `useAccentColor`, no al contenedor
del panel: los modales se montan con `createPortal` en `document.body` (ver
`Modal.jsx`), o sea fuera del árbol del workspace, así que puesto en el
contenedor los botones del modal salían amarillos aunque el club tuviera otro
color. Se restaura al desmontar. Por lo mismo, los formularios compartidos
(`ChargeForm`, `PaymentForm`, `RepeatChargeModal`, `BranchRosterModal`) usan
`btn-accent` en vez de `btn-flag`: así siguen al acento que esté activo, y en la
liga —que no tiene color propio— se siguen viendo amarillos como siempre.

Piezas nuevas con nombre, en vez de `style={{}}` repetido: `.data-table`
(encabezado pegajoso, cebra, dinero a la derecha con `tabular-nums`),
`.stat-strip`, `.ledger-row`, `.pending-tray`, `.empty-teach`, `.ws-*`. La clase
`billing-table` que no existía en ningún lado quedó reemplazada por `.data-table`,
que `BillingLeaguePanel` también puede adoptar.

Componentes compartidos nuevos: **`ConfirmDialog.jsx`** (adiós `window.confirm`
sobre movimientos contables — ahora muestra qué se cancela y pide el motivo, que
queda asentado en el libro), **`LedgerEntryList.jsx`** (la misma lista de
movimientos que estaba copiada dos veces en línea, ahora sirve a los tres
libros), **`MonthlyFlowChart.jsx`** (SVG a mano, sin librería, mismo criterio que
`UserGrowthChart` en `AdminPanel.jsx`) y **`utils/money.js`** (el formateo de
pesos que estaba duplicado en cuatro archivos).

### Fase B — renombrar la superficie (HECHA)

**Qué era.** La fase A separó los datos —el padrón pasó a `club_members` y su
libro a `club_ledger_entries`, sin ninguna columna que apunte a `players`— pero
dejó intacto el contrato de la API a propósito: seguía respondiendo `player_id`,
`first_name` y `last_name`, estos dos partiendo el `display_name` por el primer
espacio. Así las dos suites e2e, que asumían ese contrato, pudieron hacer de
juez del refactor sin que hubiera que editarlas: **46 aserciones y 0 fallas
antes, 46 y 0 después**. La fase B era quitar esa compatibilidad, y sí exigía
editar las pruebas — por eso fue después y aparte.

**Qué quedó.** El nombre de un miembro del club es **un solo campo**,
`display_name`, de punta a punta: un club puede registrar a alguien como "El
Güero", o como "Chispa" a secas, que es lo que `players.last_name NOT NULL`
hacía imposible. El padrón dejó de llamarse "players" en la API.

| Antes | Ahora |
|---|---|
| `GET /teams/:id/players/:playerId/entries` | `GET /teams/:id/members/:memberId/entries` |
| `POST /teams/:id/players/:playerId/payments` | `POST /teams/:id/members/:memberId/payments` |
| `PATCH /teams/:id/accounts/:playerId` | `PATCH /teams/:id/members/:memberId` |
| `POST /teams/:id/accounts/:playerId/rotate-token` | `POST /teams/:id/members/:memberId/rotate-token` |
| `DELETE /teams/:id/members/:playerId` | `DELETE /teams/:id/members/:memberId` |
| `player_id` en las respuestas | `member_id` |
| `items: [{ player_id, amount }]` | `items: [{ member_id, amount }]` |
| `player_ids` al repetir un lote | `member_ids` |
| `{ players: [...] }` en el overview | `{ members: [...] }` |
| `{ player, account }` al dar de alta | `{ member }` |
| `{ account }` al editar | `{ member }` |
| `{ player: {...} }` en el estado de cuenta público | `{ member: {...} }` |
| `player_count` en `recent_batches` | `member_count` |

Editar y dar de baja quedaron en **la misma URL**, separadas por el método
(PATCH y DELETE), que es lo que siempre debieron ser: un solo recurso. Del
backend se fueron `nameCompatSql`, `splitDisplayName` y `memberAsPlayer`, y con
ellas el `split_part` que partía el nombre.

**Dos bugs de la fase A que salieron al hacerlo.** Ninguno lo cubrían las
suites, y los dos estaban en producción:

1. **El libro de un miembro leía la tabla equivocada.**
   `GET /teams/:id/players/:playerId/entries` hacía
   `SELECT ... FROM players WHERE id = ?` con un id de `club_members`. Son
   padrones distintos y sus ids no tienen nada que ver, así que el modal de
   movimientos salía con el nombre de **otra persona** —un jugador de roster de
   torneo cuyo id coincidiera— o vacío. Ahora lee `club_members`.
2. **Repetir un lote de cargos estaba roto al 100%.** La consulta hace
   `SELECT * FROM club_ledger_entries`, cuya columna es `member_id`, pero el
   código leía `r.player_id`. El `Map` quedaba con una sola clave `undefined` y
   el endpoint respondía **400 "Ningún jugador válido para repetir el cargo"
   siempre**, con lote válido y jugadores en plantel. El renombre lo arregló
   solo.

**Lo que NO se cambió, a propósito.** Todo esto sigue diciendo "player" porque
cambiarlo cuesta más que el renombre y no estaba en el alcance:

- **El prefijo `/api/player-billing`** y el archivo `routes/playerBilling.js`.
  Cambiar el prefijo movería los 18 endpoints del router de un golpe, incluidos
  los tres públicos del papá, en vez de los 5 que movió esta fase. Es la misma
  clase de cambio, más grande — ver la nota de despliegue de abajo.
- **`created_by_side = 'player'`** — es un valor del `CHECK` de
  `club_ledger_entries`. Vale la regla 6 de `CLAUDE.md`: se cambia en esquema,
  backend y frontend a la vez, o en ninguno. Se eligió ninguno.
- **`player_billing_reminders_enabled`** (columna de `teams`) y los tipos de
  notificación `player_payment_reported` / `player_billing_due_soon` /
  `player_billing_overdue`: son columnas y valores guardados, no superficie.
- **El alias `player_count` dentro de `utils/billingReminders.js`**, que no
  viaja por la API del padrón: solo arma el texto de un aviso.
- Todo lo del **roster de torneo** (`players`, `player_team_memberships`,
  `ptm.player_id`, `BranchRosterModal`, `MatchStatsModal`, `PlayerShareButton`,
  `PlayerCardPage`). Es el otro padrón y no se toca.

> ### Nota de despliegue: esta fase tuvo ventana de incompatibilidad
>
> **Se desplegó el 2026-09-17 aceptando la ventana** (salida 1 de las de abajo),
> porque no había usuarios a los que rompiera. Queda escrito porque el próximo
> renombre de superficie —empezando por el prefijo `/api/player-billing`— va a
> tener exactamente la misma, y esa vez puede no dar lo mismo.
>
> El frontend es un bundle
> estático en Vercel y el backend un proceso en Render: dos despliegues
> independientes que el mismo push a `main` dispara, pero que **no terminan al
> mismo tiempo** (Render, en plan gratuito, tarda más y además arranca en frío).
>
> Un renombre de ruta no se negocia: el backend nuevo sirve
> `/members/:memberId/entries` y **deja de servir** `/players/:playerId/entries`.
> No hay solapamiento. Durante la ventana entre un deploy y el otro, uno de los
> dos lados pide una ruta que el otro ya no conoce, y la respuesta es 404:
>
> - Si Vercel termina primero, el bundle nuevo pide `/members/…` al backend viejo.
> - Si Render termina primero, el bundle viejo pide `/players/…` al backend nuevo.
>
> Y lo que más alarga la ventana no es el deploy: **quien tenga la pestaña
> abierta sigue con el bundle viejo hasta que recargue.**
>
> Solo revienta la cobranza del club (el resto de la app no toca este router),
> son 404 y no escrituras malas —no se corrompe nada— y se arregla recargando.
> Pero es real y conviene que sea una decisión, no una sorpresa. Tres salidas:
>
> 1. **Desplegar y avisar.** Subirlo en horario de poco uso y pedir a los
>    tesoreros que recarguen. Es lo más barato y lo que corresponde al tamaño
>    de uso de hoy. **Es la que se usó.**
> 2. **Compatibilidad por un ciclo**, que es la técnica que usó la fase A:
>    registrar las rutas viejas como alias de las nuevas, devolver `member_id`
>    **y** `player_id`, aceptar `items` con cualquiera de los dos. Se despliega
>    eso, se deja correr unos días, y en un segundo despliegue se quitan los
>    alias. Ventana cero, al precio de volver a meter —y luego volver a sacar—
>    la compatibilidad que esta fase quitó.
> 3. **Desplegar backend y frontend juntos a mano**, sin esperar a que el push
>    los dispare por su cuenta. Reduce la ventana a minutos, pero no la cierra
>    para las pestañas ya abiertas.
>
> Esto **no** es privativo del prefijo `/api/player-billing`: aplica a todo
> renombre de superficie, incluidos los cinco endpoints que esta fase ya movió.

**Cómo se verificó.** Rama nueva en Neon (`fase-b-test`), backend en el 4100
contra ella, nunca contra producción:

- Las dos suites e2e, **antes y después**: 46 y 0 de partida; **47 y 0** al
  final. La de más es una aserción nueva de que un nombre de una sola palabra se
  guarda tal cual. La suite de liga no toca el padrón y quedó igual (21).
- Las unitarias: 81 frontend, 54 backend.
- Un smoke test de contrato (18 comprobaciones) que verifica que **cada clave
  que lee el frontend existe en la respuesta**. Hizo falta porque el build de
  Vite no puede ver esto: un `data.players` que ya no existe compila igual y
  revienta en el navegador. Cazó tres roturas de este refactor —
  `TeamOverviewSection` destructurando `data.players`, `RepeatPlayerChargeModal`
  leyendo `player_count`, y un `setModal({ player: p })` que se leía como
  `modal.member`.
- **En el navegador**, contra la rama: Resumen, Finanzas, Jugadores, el modal de
  movimientos, la ficha, el estado de cuenta público del papá, el alta de
  "Chispa" (una sola palabra) y repetir un lote — que es como se confirmó que el
  bug 2 estaba muerto y ahora revive los cargos del mes.

> **QA visual pendiente, preexistente.** El modal de la ficha tiene scroll
> horizontal: las rejillas de "Categoría / Número / Posición" y de "Cuota /
> Situación" desbordan (554px y 562px contra 407px disponibles). No es de esta
> fase —esas dos rejillas no se tocaron, y la fase quitó una tercera— pero ahí
> está.

### Fuera de esta versión

Pasarela de pago en línea — el esquema ya tiene las columnas (`provider`,
`provider_payment_id`, `fee_amount`) para que un pago de pasarela entre como un
movimiento más, pero no se construyó: en México estas cuotas ya son
transferencias SPEI, y resolver la **conciliación** valía más hoy que cobrar con
tarjeta. También fuera: CFDI/facturación, cuenta propia para el papá,
recordatorio automático por WhatsApp/correo (hoy el disparo es humano, con el
mensaje ya armado), inscripciones en línea, convocatorias, y el bloque de
"oportunidades para el club" (proveedores) — ese último no se construye hasta
que haya oferta real registrada, porque con espacios vacíos se lee como
publicidad y abarata justo la pantalla que se quería ver seria.

## Roles y fronteras de información

**Decidido el 2026-09-19 y construido el 2026-09-20.** Los cinco pasos están
hechos y el modelo corre de punta a punta; lo que quedó abierto —y lo que
deliberadamente no se construyó— está en "Cómo está hoy, y qué falta" al final
de esta sección. Lo de aquí en adelante es el modelo completo, y se deja
escrito porque sigue siendo el porqué de cada guarda, no un plan pendiente.

Lo que resuelve: "administrar una organización" era una sola cosa —se podía
todo o no se podía nada— y eso dejó de alcanzar el día que hubo dos libros de
dinero y un padrón con CURP de menores. Son dos preguntas distintas y se
responden por separado: **qué información pertenece a quién**, y **qué puede
hacer cada persona dentro de una organización**.

### Las tres fronteras

Cada dato pertenece a exactamente un dominio, y el dominio decide quién lo ve.

| Dominio | Qué incluye | Quién lo ve |
|---|---|---|
| **Torneo** | Calendario, partidos, marcadores, posiciones, transmisiones y el roster (`players` + `player_team_memberships`) | Liga y equipo. En público el roster va **recortado** — ver "Qué se publica de un roster" |
| **Cuenta equipo ↔ liga** | `team_ledger_entries`: lo que la liga le cobra al equipo y lo que el equipo reporta | Los dos, cada quien su lado. Es compartida por definición |
| **Club privado** | `club_members` (CURP, nacimiento, foto, tutor, `share_token`) y `club_ledger_entries` | **Solo el equipo. La liga nunca, en ningún estado** |

La regla de una línea: **la liga ve competencia y lo que el equipo le debe; no
ve gente ni dinero de adentro del club.**

Por qué el roster sí y el padrón no, si los dos guardan fecha de nacimiento y
CURP de menores: no es el dato, es el propósito. La liga necesita la edad para
validar que un jugador puede competir en su categoría, y el equipo se la
entrega **al inscribirse en la rama** — esa inscripción *es* el consentimiento,
y por eso no hace falta un paso aparte de "compartir roster". Nada de eso pide
saber cuánto paga de mensualidad, quién es su tutor, ni cuál es el link de su
estado de cuenta.

> Extiende la tabla "El padrón del club NO es el roster de torneo" de la
> sección anterior: ahí se separaron las dos poblaciones, aquí se dice quién
> puede mirar cada una.

### Qué se publica de un roster, y qué no

Decidido el 2026-09-19. Es la regla 7 de `CLAUDE.md`, y aquí está su porqué.

El roster es el único dato de una persona que este proyecto publica, así que
tiene tres niveles y no dos:

| Nivel | Qué se ve | Quién |
|---|---|---|
| **Público** | Nombre, número y posición. La foto **solo** si la liga la permitió en esa categoría **y** el equipo no la vetó en ese roster | Cualquiera |
| **Completo** | Todo lo anterior más `curp` y `birth_date` | La liga, y el equipo que lo tiene o lo tuvo en su roster |
| **Nunca** | El padrón del club (`club_members`) | Nadie fuera del equipo — la liga tampoco |

Nombre, número y posición es lo que trae un programa de mano impreso: alcanza
para seguir una competencia y no sirve para nada más. La transparencia que pide
un torneo se cubre entera con eso.

**La foto nace apagada.** Es el dato más expuesto de los cuatro por mucho — el
nombre y el número identifican a alguien dentro de una cancha, una cara lo
identifica en la calle — y no se queda en la página: `playerShareCard.js` la
mete en una **imagen generada para compartir en redes**. El default es la
decisión real, porque es lo que va a quedar en la mayoría de los equipos.

**Corregido el 2026-09-20**, al construirlo: aquí decía que el interruptor era
uno solo y lo prendía el equipo. Son **dos**, y la asimetría entre ellos es lo
que hace que el modelo funcione. La liga la permite o no **en la categoría**
(`categories.roster_photos`), y encima de ese techo el equipo puede **apagar**
la suya en ese roster (`branch_teams.show_photos`, una fila por rama + equipo)
pero nunca encenderla. El consentimiento de las familias lo tiene el club, así
que el veto es suyo; el techo es de la liga, para que pueda publicar un
programa de mano sin perseguir a veinte equipos. Ver "Roster público y pase de
lista".

**La edad se filtra igual, y no tiene arreglo.** Un roster de "Infantil 2012"
dice el año de nacimiento de todos aunque `birth_date` no salga. Es inseparable
de competir por edades; se anota para no prometer lo que no se cumple.

**El equipo anterior no pierde el acceso.** Un roster es el registro histórico
del equipo que lo armó, y un equipo tiene derecho a consultar el suyo de hace
veinte años. La tarjeta de un jugador es un dato dentro de ese registro, no una
entidad con vida propia que haya que ir borrando de los archivos ajenos.

**La tarjeta es de una temporada, no de una carrera.** Se crea una vez por cada
temporada que la persona juega y describe **esa** participación. Por eso la
tarjeta pública **no** lleva el historial de equipos: acumular logros en un solo
lugar es otra función —que el jugador "recolecte" su tarjeta y pase a su
**tarjeta histórica**, en su propia cuenta— y esa no existe, no está diseñada y
no se diseñó aquí. Que alguien cambie de equipo se nota porque deja de aparecer
en un roster y aparece en otro; en el fútbol americano de México no hay
coordinación entre instituciones que verifique perfiles en internet, así que
publicar la trayectoria no resuelve nada y sí expone de más.

> **El interruptor de la foto se construyó el 2026-09-20** y con él nació el
> techo de la categoría, que esta tabla todavía no contaba: la foto sale solo
> si `categories.roster_photos` **y** `COALESCE(branch_teams.show_photos, TRUE)`
> están de acuerdo. Ver "Roster público y pase de lista", que es donde vive el
> modelo completo. Lo que falta de esta línea es **sacar la trayectoria** de
> `GET /players/:id/card`. Ojo con las
> **estadísticas acumuladas** de esa misma tarjeta: hoy suman todos los
> partidos de todas las temporadas, que es comportamiento de tarjeta histórica
> y no de tarjeta de temporada. Se resuelve cuando se diseñe "recolectar
> tarjeta", no antes.

### Administrarse solo y participar son dos preguntas distintas

**Corregido el 2026-09-20.** Este modelo tenía las dos pegadas y de ahí salían
casi todas sus contradicciones. Hay que leerlas por separado o nada cuadra:

| La pregunta | Dónde vive | Quién la contesta |
|---|---|---|
| **¿El equipo se administra solo?** | `organization_members` de la organización del equipo | La liga, **una sola vez**, al entregarle el perfil. De ahí en adelante, sus dueños |
| **¿El equipo participa en esta liga?** | `branch_teams` (una fila por rama) | La liga, cuantas veces quiera, sin que eso toque nada de lo anterior |

Una liga se registra, **crea sus equipos para poder subir el calendario**, y
después le entrega ese perfil a cada equipo para que use la herramienta. Al
entregarlo **se sale de la administración de ese equipo**: no queda como
administrador, no lo puede volver a tomar. Lo que no cambia es que el equipo
sigue jugando su torneo exactamente igual.

Al revés también: una liga que saca a un equipo de su torneo no le está
quitando su padrón, ni su perfil, ni su cuenta. El equipo deja de aparecer en
la lista de equipos de esa liga y **sigue apareciendo donde está mencionado en
el calendario**, porque un partido que ya se jugó no se deshace.

De ahí sale lo que viene después: **un equipo puede participar en torneos de
varias ligas a la vez**, y ninguna de ellas ve su información privada ni tiene
poder sobre su acceso. Con las dos preguntas separadas eso ya no necesita nada
especial — es lo que queda cuando se dejan de confundir.

> **"Revocado" era un mal nombre y una función equivocada**, y ya no existe.
> Era el mismo botón contestando las dos preguntas: le quitaba al equipo su
> administración *y* dejaba a la liga volver a repartirla. Ahí vivía la puerta
> trasera de este modelo —revocar, invitar de nuevo, reclamarlo uno mismo, y el
> padrón del club quedaba del lado de la liga— y no había forma de cerrarla sin
> separar los conceptos, porque el ciclo de vida se contradecía a sí mismo:
> exigía que la liga no pudiera invitar a un equipo entregado *y* que pudiera
> volver a entregar uno revocado. Lo único que quedó es cancelar un link que
> **todavía nadie reclamó**, que no le quita el acceso a nadie porque nadie lo
> tiene.

### El ciclo de vida de un equipo

Son dos estados, no tres, y solo se avanza:

| Estado | La liga puede | El equipo puede |
|---|---|---|
| **Registrado, sin entregar** | Perfil, roster, calendario y cobranza liga→equipo. Entregarlo, y cancelar esa entrega mientras nadie la reclame. **Eliminarlo** | Nada todavía: su organización existe, pero está vacía |
| **Entregado** | Roster de sus ramas, cuenta liga↔equipo y calendario. **No** padrón, **no** cuotas, **no** invitar, **no** volver a entregarlo, **no** eliminarlo | Todo lo suyo, incluido repartir su propio acceso |

#### Quién puede eliminar un equipo, y por qué ese candado y no otro

**Decidido el 2026-09-21.** El candado no es "¿ya tiene movimientos?" sino
**"¿lo administra alguien más?"**. Es la misma pregunta que ya contesta
`orgTieneMiembros()` — la del renglón de arriba —, no una nueva.

La razón es de daño, no de contabilidad. Mientras el equipo es solo de la liga,
borrarlo destruye su cuenta liga↔equipo, pero **esa cuenta es de la liga**: el
único historial que se pierde es el suyo, y nadie más tiene nada ahí que
perder. Es su equipo, su libro y su decisión. En cuanto hay otra persona
administrando, lo que cuelga del equipo dejó de ser de la liga — el padrón del
club, las cuotas de las familias, el acceso de sus dueños — y entonces ninguna
liga puede borrarlo, tenga o no movimientos.

Por eso el candado por movimientos habría sido peor: le prohibiría a la liga
deshacer un equipo que ella misma creó por error y al que ya le cargó algo, que
es justo el caso donde solo se daña a sí misma.

**El candado no se puede deshacer desde la app.** Una organización que ya tiene
miembros no puede volver a quedar vacía:
`DELETE /organizations/:id/members/:userId` rechaza quitar al último miembro
(400) y rechaza quitar a un `owner` sin ceder antes el puesto (409). Así que
"entregado" es de ida, y el candado también — sin guardar ningún estado nuevo.

> **La única puerta que queda abierta es `DELETE /admin/users/:id`.**
> `organization_members.user_id` es `ON DELETE CASCADE`, así que borrar una
> cuenta desde `/admin` vacía su organización por detrás, saltándose los dos
> candados de arriba — y el equipo vuelve a ser borrable por su liga. Solo el
> admin de la plataforma puede provocarlo. No se cerró con código porque borrar
> una cuenta ya es de por sí una operación de último recurso; queda escrito para
> que no se descubra tarde.

**Eliminar no es sacar de un torneo.** Son botones distintos, y cuál hace qué
está en "Sacar a un equipo: dos botones que no hacen lo mismo".

Su participación en los torneos de la liga no es una columna de esta tabla: no
depende del estado, y se mueve por su cuenta.

Tres consecuencias que no son obvias:

- **Las cuotas del club nacen apagadas.** Mientras el equipo no se administre
  solo, `/api/player-billing` responde 409 en vez de dejar capturar un padrón.
  No es una limitación que sobre: es lo que garantiza que la liga nunca llegue
  a ver uno, porque antes de la entrega no existe ninguno. El efecto de lado es
  bueno — el club se da de alta solo, que es justo el enganche de esta función.
- **Entregado es entregado.** Una vez reclamado el equipo, la liga no puede
  invitar a nadie más ni volver a generar la entrega: solo sus dueños reparten
  su acceso. Es lo que cierra la puerta trasera, y ahora sí cierra, porque ya no
  hay un "revocado" que la vuelva a abrir por el otro lado.
- **La entrega no crea la organización del equipo, la puebla.** Ya existe: una
  migración de `db.js` le crea una org `team-<id>` a todo equipo que no la
  tenga, en cada arranque. Lo que le falta a un equipo sin entregar no es la
  organización, son los miembros. Desde el paso 4 reclamar la entrega da de alta
  al representante como `owner`, y esa fila es **lo único** que responde "¿se
  administra solo?" — una sola pregunta, en `orgTieneMiembros()`, para que no
  haya dos respuestas distintas conviviendo.

### Sacar a un equipo: dos botones que no hacen lo mismo

**Escrito el 2026-09-21**, porque los dos existían desde antes y nada decía en
qué se diferencian. Sacar a un equipo de algo son **tres** acciones distintas, y
confundirlas es lo que hacía parecer que la plataforma decidía cosas que no le
tocan:

| Acción | Qué fila borra | Qué se ve |
|---|---|---|
| **Sacar de la liga** — `DELETE /leagues/:leagueId/roster/:teamId` | `league_teams` | Desaparece del directorio de Equipos de la liga. **No toca la tabla de posiciones** |
| **Sacar del torneo** — `DELETE /manage/branches/:branchId/teams/:teamId` | `branch_teams` | Desaparece de la tabla de posiciones de esa rama, y sus partidos dejan de contarle a nadie |
| **Eliminar el equipo** — `DELETE /manage/teams/:id` | `teams` | Deja de existir. Solo mientras nadie más lo administre (arriba) |

Las dos primeras **no borran la fila de `teams`**, y de ahí sale todo lo demás:
el logo, el nombre y los datos del equipo siguen vivos, así que **los partidos
que ya jugó se siguen viendo igual** — con su escudo, en el calendario de
siempre, sin que nada indique que se fue. Un partido que ya se jugó no se
deshace. La primera además ni siquiera lo saca de las ramas donde esté inscrito:
son decisiones separadas, y la liga las toma por separado.

#### Sacarlo del torneo también le borra el récord a los demás

No es un efecto colateral, es la regla, y está en `computeStandings()`
(`utils/standings.js`):

```js
const usable = matches.filter((m) =>
  countsForStandings(m) && teamIds.has(m.home_team_id) && teamIds.has(m.away_team_id));
```

Un partido solo cuenta **si los dos equipos están en la tabla**. Saca a uno de
la rama y sus partidos dejan de existir para el récord de todo el mundo: quien
le ganó pierde esa victoria, quien le perdió se quita esa derrota. Es la misma
regla que evita que un amistoso contra un invitado de fuera ensucie récords
ajenos, y `teams` sale de `branch_teams` (`utils/branchStandings.js`).

#### Y eso es justo el interruptor que la liga necesita

Cuando un equipo abandona a media temporada, cada liga lo resuelve distinto, y
esto es de la regla 10 de `CLAUDE.md`: la plataforma no decide, registra. Las
dos políticas reales ya son expresables sin construir nada:

| Lo que decide la liga | Qué hace | Resultado |
|---|---|---|
| "Se queda en la tabla y sus partidos se dan por perdidos" | No lo saca de la rama, y captura esos marcadores | Sigue en la tabla con su récord. Los demás conservan lo que le ganaron |
| "Se sale de la tabla, como si no hubiera jugado" | Lo saca de la rama | Desaparece, y sus partidos no le cuentan a nadie |

Se resuelve al leer (regla 4): no se reescribe ninguna fila y la tabla se
recalcula sola. Y se decide **rama por rama**, que es la granularidad correcta —
una liga puede querer sacarlo de una categoría y dejarlo en otra.

> **No existe "perdido por default".** `countsForStandings()` exige marcador
> capturado de verdad, así que la primera política se ejerce tecleando el
> marcador (`0-20`, o lo que la liga decida) y el partido queda idéntico a uno
> jugado. Se pierde la distinción entre "perdió 0-20" y "no se presentó". Es
> chico, nadie lo ha pedido, y está anotado aquí y no en "Pendientes abiertos"
> porque no bloquea nada.

### Los roles

Una liga y un equipo no necesitan los mismos roles, así que no comparten
catálogo. Los dos tienen dueño y administrador; de ahí para abajo, cada uno
tiene los suyos.

**Liga**

| Rol | Valor | Alcance |
|---|---|---|
| **Dueño** | `owner` | Todo. Invita y quita a cualquiera, incluidos otros dueños. Entrega equipos. Varios a la vez |
| **Administrador** | `admin` | Todo lo operativo: estructura, equipos, partidos, sedes, transmisiones y cobranza. No invita ni quita dueños |
| **Tesorero de liga** | `treasurer` | Solo cobranza liga→equipos: cargos, confirmar y rechazar pagos, ajustes y configuración. Nada de estructura, partidos ni rosters |
| **Editor de partidos (Visor)** | `editor` | Solo partidos que ya existen, en toda la liga: marcador, estado, fecha, hora, sede y links. No los crea ni los borra. Nada de rosters ni de dinero |

**Equipo**

| Rol | Valor | Alcance |
|---|---|---|
| **Dueño** | `owner` | Todo, incluidas las dos cuentas y el padrón. Invita a cualquiera, incluidos otros dueños. Varios a la vez |
| **Administrador** | `admin` | Todo menos invitar o quitar dueños |
| **Tesorero** | `treasurer` | Padrón del club, cuotas, y la cuenta con la liga. Nada de perfil ni de roster |
| **Editor de roster** | `roster_editor` | Roster de torneo: alta, baja, plantilla de Excel, foto, número y posición. Nada de padrón ni de dinero |
| **Coach** | `coach` | El equipo en solo lectura: perfil, calendario y roster. Sin padrón ni contabilidad. Sin más funciones por ahora, a propósito |

**Medio, tienda, clínica y marca** se quedan con `owner` y `admin`: no manejan
dinero ni datos de menores en la plataforma, y no hay para qué inventarles
roles que nadie pidió.

El `CHECK` de `organization_members.role` pasa a la unión de los seis valores,
pero **cuáles son válidos depende del tipo de organización**, y eso se valida
al invitar, no en el esquema: un `coach` no significa nada en una liga, y un
visor no significa nada en un equipo.

Dos decisiones sobre los valores guardados:

- **El visor reusa `'editor'`**, que ya estaba en el `CHECK` desde que se creó
  `organization_members` y que **ninguna fila usa** — nunca hubo endpoint ni
  pantalla que lo produjera. Por eso no lleva migración de datos ni ventana de
  incompatibilidad al desplegar, que es justo el costo que sí tiene renombrar
  `/api/player-billing` (ver "Pendientes abiertos"). En pantalla nunca se lee
  "editor" a secas: es **"Editor de partidos (Visor)"**, porque *visor* es como
  se le dice en la cancha a quien toma los marcadores y le da validez al
  partido. Hacia allá es donde va a crecer ese rol.
- **Varios dueños a la vez, todos iguales**, en cualquier tipo de organización.
  El caso que lo pidió es el equipo que lleva una familia: describirlo como un
  dueño y dos administradores dice algo que no es. La única regla es que no
  puede quedar en cero, y esa ya existe en
  `DELETE /organizations/:id/members/:userId`. Con eso se va `transfer-owner`:
  sin dueño principal no hay puesto que ceder — se invita a otro dueño y quien
  quiera se retira.

### Cómo está hoy, y qué falta

**Los cinco pasos, hechos (2026-09-20).** El modelo entero corre: el backend
decide por permiso y el frontend esconde lo que cada rol no puede. Lo que
queda abierto no son pasos de este plan sino las dos cosas de la siguiente
sección. Lo que corre hoy:

- El esquema acepta los seis roles y el catálogo (`utils/orgRoles.js`) dice
  cuáles valen para cada tipo de organización, cómo se leen en pantalla y qué
  puede cada uno.
- **La liga no entra al dominio del club**, en ningún estado del equipo.
- **La invitación lleva rol** y el claim lo escribe. Reclamar un equipo da de
  alta a su representante como dueño de la organización del equipo.
- **Los seis roles hacen algo distinto.** Las guardas de `ownership.js` se
  piden por permiso (`guardaDeLiga('cobranza_liga')`, `guardaDePartido('marcadores')`,
  `guardaDeEquipo('estructura', 'ver')`…) y la lista de roles sale del catálogo,
  nunca escrita a mano en una ruta.
- **La entrega de un equipo es de una sola vía**, y ya no se confunde con su
  participación en los torneos de la liga.
- **El frontend esconde lo que cada rol no puede hacer**, preguntándole al
  backend (`my_permissions` en `/auth/me`) en vez de repetir la tabla de
  permisos. Esconde **acciones**, no información: un coach conserva la pestaña
  de Perfil y la ve sin poder editarla.

Lo que sigue abierto, y **no** es parte de estos cinco pasos:

- **`teams.league_id` todavía significa dos cosas**: "esta liga lo administra"
  y "este equipo sale en la lista de esta liga". Por eso una liga que ya entregó
  un equipo sigue pasando por `teamOwnerRequired` para su perfil y su roster —
  lo único que perdió es el padrón, las cuotas y el poder de repartir su acceso.
  Separarlo es un cambio de modelo de datos con su propia sección, abajo. Sigue
  abierto: es `PD-07` en `docs/PENDIENTES.md`.
- ~~`DELETE /manage/teams/:id` es un `DELETE FROM teams` pelón~~ — **cerrado el
  2026-09-21**: un equipo solo se elimina mientras nadie más lo administre, y el
  diálogo dice lo que se lleva. Ver "Quién puede eliminar un equipo, y por qué
  ese candado y no otro".
- ~~**El visor no tiene pantalla propia**~~ — **cerrado el 2026-09-20**: pasa
  lista encima del roster público y captura por jugada en
  `/partidos/:matchId/estadisticas`. Ver "Roster público y pase de lista" y
  "Estadísticas por jugada". La hoja de visoría sigue sin diseñarse, a
  propósito: se arma con lo que la captura ya esté produciendo.

### Lo que falta para que un equipo viva en varias ligas

**Decidido el 2026-09-20, sin construir.** Es la consecuencia directa de separar
"¿se administra solo?" de "¿participa en esta liga?", y lo que queda por hacer
es solo la segunda mitad.

Lo que ya está de ese lado, y no hay que construir:

- `branch_teams` ya es muchos-a-muchos: nada impide que un equipo esté inscrito
  en ramas de dos ligas.
- `team_ledger_entries` ya está indexado por el **par** `(league_id, team_id)`:
  un equipo ya puede llevar cuenta separada con cada liga.
- Los partidos cuelgan de rama → categoría → liga, así que un equipo aparece en
  el calendario donde participa sin depender de a quién "pertenece".
- `POST /manage/teams` ya registra un equipo con su organización y su dueño
  desde el minuto cero — el flujo de "nace independiente" existe; el de liga no
  lo usa.

Lo que falta:

1. ~~**Una tabla de participación por liga**, muchos-a-muchos, que reemplace a
   `teams.league_id` como "este equipo sale en la lista de esta liga"~~ —
   **hecha**: es `league_teams`, y desde el 2026-09-22 ya no hay ninguna
   lectura pública ni de panel que use la columna vieja para contestar eso (ver
   "Jubilar `teams.league_id`"). `branch_teams` **no** alcanzaba, y ese fue el
   argumento: al 2026-09-20, **59 de los 100 equipos con liga no tenían ni una
   inscripción en una rama**. Aparecer en la liga y estar inscrito en una rama
   son dos cosas, y si se colapsan, 59 equipos desaparecen.
2. **Que `teams.league_id` deje de dar permisos.** Hoy es lo que hace que una
   liga administre el perfil y el roster de un equipo que ya entregó.
3. **Que "dar de baja" termine la participación** en vez de borrar el equipo, y
   que el equipo huérfano decida por su cuenta si aparece en el home
   (`teams.show_on_platform`, que ya existe y ya es autoservicio).

Tres cosas que hay que **decidir antes de escribir código**: cómo se inscribe un
equipo a una liga nueva (¿lo invita la liga, lo solicita el equipo, las dos?);
si la liga sigue editando el roster de torneo de un equipo entregado —el roster
es dominio "Torneo" y se comparte, a diferencia del padrón—; y qué pasa con el
perfil del equipo, que hoy la liga edita.

El terreno vuelve a estar limpio, que es la razón de hacerlo ahora y no después:
**0 equipos inscritos en más de una liga** y **0 equipos inscritos en una liga
distinta a su `teams.league_id`**. No hay datos contradictorios que migrar; solo
hay que pasar los 100 `league_id` a la tabla nueva.


El orden para construirlo no es arbitrario: cada paso deja el anterior
verificable.

1. ~~Migración aditiva del `CHECK` en `db.js`, y el catálogo de roles por tipo
   de organización~~ — **hecho el 2026-09-20**. El catálogo quedó en
   `utils/orgRoles.js` y **no** en `utils/orgMembers.js` como decía este plan:
   ese importa `db`, así que nada de ahí se puede probar sin Postgres, y la
   gracia era justamente que entrara al CI. `db.js` **importa** la lista de
   roles en vez de repetirla, así que la base no puede aceptar un rol que el
   código no conozca (regla 6). Trae 24 pruebas nuevas —148 → 172— y la
   migración se verificó contra la base real dentro de una transacción con
   `ROLLBACK`: acepta los seis valores, rechaza uno inventado y no movió
   ninguna de las 19 filas.
2. ~~Partir `teamOwnerRequired`~~ — **hecho el 2026-09-20**. No se partió en
   dos mitades sino que se **agregó** `teamClubRequired` y `teamOwnerRequired`
   quedó intacta: la liga no perdió nada de lo que sí le toca. `playerBilling.js`
   entero pasó a la guarda nueva (12 rutas), y `assertEntryAccess` —que dejaba
   entrar a la liga por otros dos caminos, membresía en su organización y
   `owner_user_id` de la liga— también. Las dos suites e2e dieron **40/0 y 21/0
   antes y después**, idénticas; pero ninguna cubre este cambio, porque las dos
   usan un equipo independiente cuyo dueño es el propio actor y nunca hay una
   liga intentando entrar. Se verificó aparte, con un recorrido de 13
   comprobaciones sobre los tres estados (sin entregar → 409, entregado y
   preguntando la liga → 403, entregado y preguntando el equipo → 200), más que
   la liga no puede cancelar un movimiento del libro del club.
3. ~~`allowedRoles` en `routes/billing.js` y `routes/playerBilling.js`~~ —
   **hecho el 2026-09-20**, y más ancho de lo que decía este plan, porque al
   construir el 4 primero salió que el agujero no estaba en esos dos archivos
   sino en `isOrgMember()`: su lista por defecto incluía `'editor'`, así que
   un visor invitado con el paso 4 pasaba **todas** las guardas de
   `ownership.js`, los dos libros incluidos. Era inofensivo mientras no hubiera
   forma de crear un `editor` y dejó de serlo el día que la invitación llevó
   rol. El default bajó a `['owner', 'admin']` —el suelo— y las guardas se
   volvieron **fábricas por permiso**: `guardaDeLiga`, `guardaDePartido` y
   `guardaDeEquipo` reciben el dominio que la ruta toca y le preguntan al
   catálogo quiénes son esos roles. Un partido se guarda ahora con dos permisos
   distintos —`marcadores` para editarlo, `partidos` para borrarlo—, que es la
   única forma de que el visor exista sin poder desaparecer un resultado.
   No movió el acceso de nadie: al 2026-09-20 no había una sola fila con rol
   distinto de `owner` o `admin`, y los dos tienen todos los permisos salvo
   `duenos`.
4. ~~Invitación con rol, y la entrega que puebla la organización~~ —
   **hecho el 2026-09-20**, antes que el 3 y por eso mismo fue el que destapó
   lo de arriba.
   `invites.role` nace NULL y una invitación vieja vale lo que valía —'admin'
   las de organización, 'owner' las de equipo—, así que no hay ventana de
   incompatibilidad al desplegar ni backfill que correr. El rol se valida
   contra el **tipo** de organización (`esRolValido`), que es la validación
   que un `CHECK` no puede hacer, e invitar a otro **dueño** exige el permiso
   `duenos`: un admin que pudiera nombrar dueños se ascendería solo.
   Reclamar un equipo escribe `owner_user_id` y da de alta al representante
   como `owner` de la organización **en una sola sentencia con CTE** —a la
   mitad quedaría un equipo con dueño y sin miembros, que es justo el estado
   que este paso vino a eliminar— y con eso se retiró el respaldo por
   `owner_user_id` de `teamClubRequired`, que ahora es la única guarda del
   archivo sin respaldo: ahí un segundo camino no sería una red, sería una
   segunda puerta al padrón.
   Tres cosas que no estaban en el plan y salieron al construirlo:
   **la entrega es de una sola vía** —construir el espejo de la entrega
   ("revocar vacía la organización") fue lo que dejó ver que "revocado" era el
   concepto equivocado, y terminó borrándolo en vez de arreglándolo—,
   **"una invitación vigente a la vez" se volvió un error** con roles
   —generar el link del tesorero mataba en silencio el del coach que se mandó
   hace diez minutos, así que ahora es una vigente *por rol*— y la regla del
   rol por defecto vive en `utils/orgRoles.js` y no en la ruta, por lo mismo
   que el catálogo: un link repartido por WhatsApp hace tres días no se puede
   volver a probar a mano, y solo lo puro entra al CI.

**Cómo se verificaron los pasos 3 y 4** (van juntos, se hicieron juntos): 5
pruebas unitarias nuevas (91 → 96); 22 comprobaciones de SQL contra la base real
dentro de una transacción con `ROLLBACK` —el CHECK acepta los seis valores y
rechaza uno inventado, `invites.role` quedó NULL en las 7 filas que ya había, y
no se movió ningún miembro de otra organización—; las dos suites de cobranza en
**40/0 y 21/0**, idénticas a las del paso 2; y una **suite e2e nueva**,
`tests/invites-roles.e2e.mjs`, con **59 comprobaciones** sobre las rutas vivas.
Esa última es lo único que podía atrapar que un 403 le tocara a quien no era, y
cubre las dos mitades: que el tesorero del club sí vea el padrón y el coach no,
que el visor edite el marcador y no pueda borrar el partido, que ningún rol de
liga alcance el padrón, y que entregar un equipo no lo saque de sus torneos.
Las dos de cobranza no cubren nada de esto —usan un equipo independiente cuyo
dueño es el propio actor, así que nunca hay una liga entregando nada— y por eso
hizo falta la tercera.
5. ~~Frontend: selector de rol al invitar, las etiquetas nuevas, y esconder lo
   que cada rol no puede hacer~~ — **hecho el 2026-09-20**.

   **El frontend no tiene la tabla de permisos, y ese es el punto.** `/auth/me`
   manda, por cada liga y equipo, `my_role`, `my_role_label` y
   `my_permissions` ya resueltos; el frontend solo pregunta
   `puede(entidad, 'cuotas_club')` desde `utils/permisos.js`. La tabla vive en
   un solo lado (regla 6) y un rol nuevo no obliga a tocar el frontend. Las
   etiquetas viajan resueltas por lo mismo: `treasurer` se lee "Tesorero de
   liga" en una liga y "Tesorero" en un equipo, y `editor` nunca se lee
   "editor" a secas.

   **Esconder no es proteger, y está escrito en el archivo** para que nadie lo
   confunda después: quien decide es la guarda del backend, que vuelve a
   preguntar en cada petición. Un permiso de más enseña un botón que va a dar
   403; uno de menos esconde algo que sí se podía. `puede()` falla cerrado.

   **Se esconden acciones, no información.** Un coach conserva su pestaña de
   Perfil —la ve, no la edita— y su Resumen dice qué es lo suyo, en vez de
   quedarse vacío. El rol existe para mirar el equipo; esconderle el equipo lo
   dejaba sin nada. El editor de roster entra a la misma pestaña "Padrón" que
   el tesorero y ve **solo** los rosters de torneo: ni siquiera se le pide el
   padrón del club al backend, porque pedirlo sería pintar un 403 en rojo por
   algo que no es un error.

   **Dos defectos que este paso destapó** —los dos porque el selector hace
   posible, por primera vez, que haya más de un dueño—:

   - `transfer-owner` degradaba a **todos** los dueños para promover a uno.
     Ahora solo se mueve quien cede, y ceder lo decide quien tiene el permiso
     `duenos` y no "el owner que la consulta devuelva primero".
   - El botón "Quitar rep." de la liga ahora contesta 409 siempre. Se cambió
     por lo que de verdad se puede hacer: **entregar** (mientras nadie lo haya
     reclamado) y **cancelar esa entrega**. Un equipo ya entregado se lee
     "👤 se administra solo" y no ofrece ninguna acción sobre su acceso.

   **Verificado en el navegador** (regla de CLAUDE.md), con los seis roles
   repartidos en una liga y un equipo de prueba contra la rama de Neon:

   | Quién | Qué vio |
   |---|---|
   | Coach | Resumen y Perfil. Perfil sin botón de editar. Cero errores en consola |
   | Editor de roster | Resumen y Padrón —solo rosters de torneo— y Perfil |
   | Tesorero del club | Resumen, Finanzas, Padrón, Con la liga, Perfil. Sin "Administradores" |
   | Dueño del equipo | Las seis pestañas |
   | Visor de liga | Solo "Ver mi página": ni cobranza, ni editar liga, ni + Torneo |
   | Admin de liga | El rol "Dueño" aparece deshabilitado con "solo un dueño puede repartirlo" |

   También se revisó el link de invitación **sin sesión**: dice "Te invitaron a
   Liga QA como **Tesorero de liga**" antes de pedir cuenta, que es lo único
   que esa página pública existe para contestar. Y el 409 de una entrega
   repetida se lee como explicación —"ya se administra solo… su participación
   en tus torneos no cambia"— en vez de como error rojo.

   **La ventana de despliegue se cerró a mano.** El backend (Render) y el
   frontend (Vercel) salen del mismo push y Vercel termina primero, así que
   durante unos minutos el frontend nuevo le habla al backend viejo. Dos
   detalles lo cubren: `puede()` distingue "no vino `my_permissions`" —backend
   viejo, se ve lo de siempre— de "vino y no trae el permiso" —se esconde—, en
   vez de dejar a todo el mundo con el panel sin pestañas; y el selector de rol
   se cae a "Administrador" si `GET /organizations/:id/roles` todavía no
   existe, que es justo lo que ese backend sabe entregar. Al revés (backend
   nuevo, frontend viejo) ya funcionaba: el cuerpo sin `role` entrega 'admin'.

   **Lo que este paso NO tocó**, y se nota en pantalla: el panel del visor
   sigue siendo el de la liga con casi todo apagado. No se le construyó una
   pantalla propia a propósito — su trabajo real (pasar lista, capturar,
   la hoja de visoría) es otra cosa y no está diseñada. Ver "Pendientes
   abiertos".


`DELETE /manage/teams/:id` era independiente de los cinco pasos, y se cerró el
2026-09-21 con un candado distinto al que este plan anotaba: no "409 si hay
movimientos", sino "409 si alguien más lo administra". El porqué está en "Quién
puede eliminar un equipo, y por qué ese candado y no otro".

> La contradicción que este plan tenía anotada aquí —"Entregado es entregado"
> contra "Revocado"— **se disolvió el 2026-09-20**, y no arreglándola sino
> quitando el concepto equivocado. No eran dos reglas que no cuadraban: era un
> botón contestando dos preguntas distintas. Ver "Administrarse solo y
> participar son dos preguntas distintas", arriba.

> Vale la pena dejar escrito que el terreno estaba limpio: al 2026-09-19 los
> dos libros tenían **cero movimientos**, ningún equipo había sido entregado y
> no existía ni un `editor`. No hay datos que migrar, y esa es justo la razón
> para hacerlo ahora y no después.

### Jubilar `teams.league_id` — lo que se fue el 2026-09-22

**Construido.** Los pasos anteriores le quitaron a esa columna los dos usos que
movían dinero o repartían acceso; el último fue la cobranza (2026-09-21). Lo
que quedaba eran **diez lecturas en `leagues.js`** y su `ON DELETE CASCADE`.
Las lecturas eran limpieza; el `CASCADE` era la trampa, y es con lo que
conviene empezar a leer esto.

#### Borrar una liga ya no borra sus equipos

Era esta línea, desde el primer día del esquema:

```sql
league_id INTEGER REFERENCES leagues(id) ON DELETE CASCADE
```

Lo que la vuelve grave no es que borre un equipo, sino **lo que cuelga de un
equipo**: hay **13 tablas** apuntando a `teams(id)` con `ON DELETE CASCADE`, y
entre ellas están las dos que la regla 5 de `CLAUDE.md` declara inborrables
—`team_ledger_entries` y `club_ledger_entries`— más `club_members`, que es el
padrón del club. O sea que `DELETE /admin/leagues/:id` —un botón que dice
"borrar liga"— se llevaba por delante el padrón y los dos libros de dinero de
cada uno de sus equipos, **incluidos los que ya son independientes y juegan en
otras ligas**. Es el mismo daño que se le quitó a `DELETE /manage/teams/:id` el
2026-09-21, un piso más arriba y sin ninguna pregunta previa.

Ahora es `ON DELETE SET NULL`: **la liga se borra, sus equipos sobreviven y
quedan independientes**, que es exactamente lo que ya significa `league_id`
NULL desde "Equipos independientes". No hizo falta nada más para que el estado
resultante fuera coherente, y esa es la señal de que el modelo nuevo ya estaba
bien: las dos guardas que leen la columna (`guardaDeEquipo` y
`teamLeagueOwnerRequired`) ya sabían tratar un equipo sin liga, porque un
equipo puede nacer sin ella. La membresía sí desaparece con la liga, y debe:
`league_teams.league_id` sigue siendo `ON DELETE CASCADE`, que ahí es lo
correcto — la participación en una liga que ya no existe no significa nada.

**Pero hay una segunda arista, y esta columna no la tapa.** Se vio al verificar
el borrado contra los datos reales, no leyendo el código: con `SET NULL` el
equipo sobrevive y conserva su organización, su padrón y su libro de cuotas
—esos dos cuelgan solo de `teams`—, y aun así **sus movimientos del libro
liga↔equipo desaparecen igual**. No por el equipo: `team_ledger_entries` tiene
su propia llave a la liga, y también es `ON DELETE CASCADE`.

```sql
team_ledger_entries.league_id → leagues(id) ON DELETE CASCADE
```

Medido en la rama de pruebas, sobre una liga con 5 movimientos: antes del
cambio sobrevivían 0 de 5 y 0 de 1 equipos; después, 1 de 1 equipos y **0 de 5
movimientos**. O sea que `DELETE /admin/leagues/:id` —que sigue siendo un
`DELETE FROM leagues` pelón, sin una sola pregunta previa, igual que el borrado
de equipos antes del 2026-09-21— **todavía borra la cuenta liga↔equipo que la
regla 5 declara inborrable**. Lo que dejó de llevarse es el equipo entero, que
era el daño irreversible y el que alcanzaba a equipos de otras ligas.

Esa arista queda **abierta a propósito** y anotada en "Pendientes abiertos": no
es sustituir una consulta, es decidir si una liga con movimientos se puede
borrar (y entonces el esquema debe decir `RESTRICT`, y el endpoint contestar
409 con un motivo, como ya hace el de equipos) o si el borrado debe conservar
el libro sin su liga. Se deja escrito aquí para que no se lea este cambio como
si hubiera cerrado más de lo que cerró.

> La migración va con guarda (`confdeltype = 'c'`): si la restricción ya es
> `SET NULL`, no se toca. Sin eso, cada arranque tomaría un `ACCESS EXCLUSIVE`
> sobre `teams` para dejarla igual. La definición dentro del `CREATE TABLE` se
> deja como estaba, por la regla 8 — una base nueva nace con `CASCADE` y el
> `ALTER` del final la corrige en el mismo arranque.

#### Las diez lecturas, y qué contesta cada una ahora

Todas se mudaron a `league_teams`, que es la tabla que desde el 2026-09-21
contesta "¿este equipo es de esta liga?":

| Dónde | Qué leía la columna |
|---|---|
| `GET /matches/:matchId` (×2) | respaldo por nombre cuando el partido no tiene `home_team_id`/`away_team_id` |
| `GET /all-teams` | "independiente" era `league_id IS NULL` |
| `GET /:slug` | la lista de equipos de la página pública de la liga |
| `GET /categories/:categoryId/share-meta` | el logo de un equipo, buscado por nombre |
| `GET /categories/:categoryId/matches` (×2) | los logos de los dos equipos, buscados por nombre |
| `GET /:leagueId/tree` | la lista de equipos del panel de estructura |
| `GET /:leagueId/roster` y `GET /tournaments/:tournamentId/teams` | `home_league_name` |

Tres de esas filas no son un reemplazo mecánico, y vale la pena el porqué:

- **"Independiente" pasó de "no tiene columna" a "no es miembro de ninguna
  liga"** (`NOT EXISTS` sobre `league_teams`). Es la misma pregunta escrita en
  la tabla que la contesta, y la única que sigue siendo cierta cuando un equipo
  está en dos ligas.

- **`home_league_name` se quitó en vez de traducirse.** Bajo el modelo nuevo un
  equipo no tiene *una* liga de casa, así que el campo o se vuelve una lista o
  miente. Se revisó antes de decidir: **no lo pinta nadie** —ni el frontend ni
  las funciones serverless—, así que traducirlo habría sido construir una
  respuesta plural para un campo muerto. Si alguna pantalla lo llega a
  necesitar, nace plural. Queda el tercer `home_league_name`, el de
  `GET /manage/teams/search`, que está fuera de este paso.

- **Los logos del calendario ahora se buscan por `id` y solo después por
  nombre.** `GET /categories/:categoryId/matches` unía los equipos *solo* por
  nombre, y encima acotado a la liga de la categoría: un equipo **invitado**
  desde otra liga (`tournament_teams`) nunca iba a encontrar ahí su logo,
  aunque el partido sí tuviera su `home_team_id`. Ahora es
  `COALESCE(m.home_team_id, <respaldo por nombre>)`, igual que
  `GET /matches/:matchId`, y el respaldo se acota a los miembros de la liga.
  De paso, el `LIMIT 1` del respaldo le quita casi todo el trabajo al filtro
  anti-duplicados que viene después (dos equipos con el mismo nombre en la
  misma liga abrían cada partido en dos filas) — el filtro se queda, porque
  sigue siendo la red de un dato que ya existe.

**El respaldo por nombre hoy no resuelve ni un partido**, y se midió antes de
tocarlo: de 185 partidos publicados, **uno** no tiene `home_team_id` y **uno**
no tiene `away_team_id`, y ninguno de los dos encuentra equipo por nombre — ni
por la columna vieja ni por la tabla nueva. Es andamio de cuando `home_team_id`
no existía. Se conserva igual: el día que entre un calendario por Excel sin
enlazar, es lo único que pone los logos.

#### El relleno que sostenía la tabla nueva llevaba días muerto

Esto salió al revisar los datos, no estaba anotado en ninguna parte, y es lo
más importante de este paso: **`league_teams` se estaba quedando sin filas**.

`initSchema()` traía, desde que la tabla existe, un relleno que corría en cada
arranque:

```sql
INSERT INTO league_teams (league_id, team_id)
SELECT league_id, id FROM teams
ON CONFLICT (league_id, team_id) DO NOTHING
```

Sin `WHERE league_id IS NOT NULL`. En cuanto existió el **primer equipo
independiente** —el día que `teams.league_id` se volvió opcional— esa
instrucción empezó a reventar con `null value in column "league_id" … violates
not-null constraint`, y como cada migración corre dentro de su propio
`SAVEPOINT`, **fallaba entera y en silencio**: sin error en los logs, sin
detener el arranque, y sin insertar tampoco las filas que sí eran válidas.

En la rama de pruebas eso dejó **44 equipos con `league_id` y sin membresía**.
Casi todos son basura de las suites e2e, pero el mecanismo es real y el efecto
es exactamente el que este paso no puede permitirse: mover las lecturas
públicas a `league_teams` mientras el relleno está roto es hacer desaparecer de
su liga a todo equipo al que le falte la fila.

**En producción no alcanzó a hacer daño, y se comprobó antes de desplegar**
(censo de solo lectura, 2026-09-22): **0 equipos con liga y sin membresía**. Las
cuatro ligas públicas cuadran por las dos vías —ONEFA 33/33, LFA 10/10, AFC 7/7,
OFASE 6/6— y las privadas también (NFL 32/32, LEXFA 2/2, IFAF 1/1). 92 equipos,
91 membresías, y el que falta es el único independiente, GRIZZLIES, que no debe
tener ninguna.

El porqué de la diferencia vale la pena: el relleno murió el día que se registró
GRIZZLIES, y **después de eso no se creó ningún equipo de liga en producción**.
En la rama de pruebas sí —decenas, de las suites e2e—, y por eso allá el hueco
se ve y aquí no. Producción se salvó por el orden de los hechos, no porque el
relleno funcionara.

**Y el hueco ya no se puede reabrir**, que es lo que permite quitar el relleno
sin dejar nada suelto. Solo hay dos formas de crear un equipo, y ninguna lo
produce: `POST /manage/leagues/:leagueId/teams` escribe la membresía en el
mismo momento (desde el 2026-09-21), y `POST /manage/teams` nace con
`league_id = NULL` explícito, o sea independiente. Ninguna ruta del backend
hace `UPDATE` de `teams.league_id`: se escribe al crear el equipo y nunca más.

**El relleno se quitó del arranque; no se arregló ahí.** Este proyecto ya había
aprendido esto mismo una vez, y lo tiene escrito unas líneas más arriba en el
propio `db.js`: la migración que traducía `status = 'approved'` a
`is_public = TRUE` se quitó de `initSchema()` porque *"dejarla como un UPDATE
que corre en cada arranque volvía a publicar cualquier liga que alguien hubiera
ocultado manualmente después"*. Aquí es idéntico: arreglar el `INSERT` y
dejarlo corriendo le habría devuelto la membresía, en el siguiente despliegue,
a **todo equipo que una liga hubiera sacado de su roster a propósito** — y
"Sacar de la liga" (`DELETE /leagues/:leagueId/roster/:teamId`) es un botón que
ya existe. Habría convertido un relleno muerto en un bug vivo.

La reparación de una sola vez vive en `scripts/backfill-league-teams.mjs`, que
simula por defecto y solo escribe con `--apply` (regla 3). Lo que nazca de aquí
en adelante ya no la necesita: `POST /manage/leagues/:leagueId/teams` inserta
la membresía en el mismo momento desde el 2026-09-21.

#### Lo que todavía lee la columna, y por qué no se fue aquí

`teams.league_id` sigue existiendo y sigue escribiéndose. Lo que queda no es
una lista de descuidos; son dos cosas distintas:

1. **Los permisos** (`middleware/ownership.js`): `guardaDeEquipo` y
   `teamLeagueOwnerRequired` deciden con ella quién administra un equipo. Es el
   punto 2 de "Lo que falta para que un equipo viva en varias ligas" y es un
   cambio de modelo con su propia discusión —no es sustituir una consulta—,
   porque moverlo es decidir si una liga que ya entregó un equipo conserva o no
   su roster de torneo.
2. **Cuatro archivos más con el mismo respaldo por nombre** que tenía
   `leagues.js`: `board.js`, `manage.js` (el importador de Excel y la ficha de
   un equipo), `notifications.js` y `admin.js`. El README decía que "lo que
   queda es `leagues.js`" y **no era cierto** — se censó al hacer este paso. No
   se tocaron para no mezclar dos cosas en un cambio: de esos solo `board.js`
   es público, y todos se arreglan con el mismo patrón de arriba.

## Tabla de posiciones y modelo de competencia

Lo que resuelve: hasta ahora la app sabía **qué partidos se juegan**, pero no
**cómo se compite**. No había forma de decir que una liga corona campeón por
conferencia y otra tiene un solo campeón general, ni de calcular una tabla,
porque faltaba lo más básico: saber qué juegos cuentan.

### Hay un estándar de estructura, y la jerarquía ya cabía en él

Antes de inventar nada se revisó cómo lo modelan los proveedores de datos
deportivos (Sportradar, SportMonks) y el estándar abierto de la IPTC
(SportsML-G2, el que usan las agencias de noticias). Los tres convergen en:

```
Competition → Season → Stage/Phase → Group → Round → Match
```

Y SportsML resolvió explícitamente, en su versión 2.1, el mismo problema que
esta sección: **las posiciones cuelgan de cualquier nivel del árbol**
(torneo, división, fase, ronda), no de uno solo, porque los formatos reales
no caben en un nivel.

La jerarquía de la app ya coincidía casi exacto — incluso `branches`
(Varonil/Femenil) es lo que SportsML llama el *gender divider*, el nivel donde
cuelgan las posiciones generales:

| Estándar | Esta app |
|---|---|
| Competition | `leagues` |
| Season | `tournaments` (tiene `year`) |
| *(sin equivalente)* | `categories` (Juvenil/Mayor) |
| Division | `branches` ← **la unidad de competencia**: los partidos cuelgan de aquí |
| Group | `conferences` → `groups` |
| Stage/Phase | `phases` ← **esto es lo que faltaba** |
| Round | `matches.week_label` |

Lo que **no** está estandarizado es "¿dónde se corona campeón?", y no por
descuido: esas APIs son feeds de lectura, describen lo que pasó. Para una app
de gestión eso es **configuración**, y se modela declarando un título por cada
nivel donde exista uno.

### Las tres piezas nuevas

La fase resuelta es también, desde este cambio, lo que decide los **puntos de
la quiniela** (2 por acierto en fase final): antes eso se leía de `week_label`
con la lista de etiquetas escrita a mano. Se verificó renglón por renglón
contra el concurso en curso (mismo resultado exacto), y ahora una liga que
llame "Liguilla" a su fase final también reparte los 2 puntos, cosa que antes
no pasaba porque su etiqueta no estaba en la lista.

**1. `phases` — qué se está jugando, y con qué sistema.** Cuelga de la rama.
Sin esto no hay tabla posible: sumaría playoffs y amistosos junto con la
temporada regular.

Cada fase declara su **sistema de competencia** por su nombre real, que es un
concepto que **no le pertenece a ningún deporte** — el mismo todos-contra-todos
lo usa la LFA, la Champions y un torneo de ajedrez:

| `type` | Qué es |
|---|---|
| `round_robin` | Todos contra todos — cada uno enfrenta a los demás una vez |
| `double_round_robin` | Todos contra todos, ida y vuelta |
| `groups` | Fase de grupos — todos contra todos dentro de cada grupo |
| `swiss` | Sistema suizo — nadie queda eliminado, cada ronda empareja registros parecidos |
| `single_elimination` | Eliminación directa — el que pierde queda fuera |
| `double_elimination` | Eliminación doble — hacen falta dos derrotas |
| `series` | Serie — el cruce se decide al mejor de varios juegos |
| `exhibition` | Amistoso o pretemporada |

Que una fase **cuente para la tabla** es una pregunta aparte
(`counts_for_standings`), y a propósito: no se deduce del sistema. Hay ligas
donde el repechaje suma a la tabla general y otras donde no. La primera
versión de esto los tenía mezclados en un solo campo (`regular` describía las
dos cosas a la vez), lo que obligaba al formato a mentir para decir si contaba.

Ese dato **ya existía**, pero como texto libre dentro de `week_label`
(`'PLAYOFF'`, `'SEMIFINAL'`, `'FINAL'`, `'SCRIMMAGE'`), con la lista repetida
a mano en `utils/scoring.js` y en `MatchForm.jsx`. Servía para pintar una
etiqueta; no alcanza para calcular. `matches.phase_id` es **nullable para
siempre**: si está en NULL, la fase se deriva de `week_label`. Mismo patrón
que `matchScope.js` — se resuelve **al leer**, nadie migra nada, y las ligas
que ya tienen temporada capturada tienen su tabla bien desde el primer día.
Vive en `backend/src/utils/matchPhase.js`.

**2. `titles` — a qué nivel se corona campeón.** Dos columnas bastan:

```
titles(branch_id, name, scope, decided_by, phase_id)
  scope       ∈ branch | conference | group
  decided_by  ∈ standings | match
```

Los tres formatos que había que representar, sin un solo caso especial:

- **NFL** → 3 filas: `(group, standings)` campeón de división · `(conference, match)` final de conferencia · `(branch, match)` Super Bowl.
- **ONEFA Liga Mayor** → 2 filas `(conference, match)`, una por conferencia, y **ninguna con `scope='branch'`**. Esa ausencia *es* la representación de "no hay juegos interconferencia": no hay campeón general porque nadie declaró ese título, y la tabla general tampoco se dibuja.
- **LFA** → 1 fila: `(branch, match)`.

El campeón **no se guarda**: se deriva al leer (primer lugar de la tabla, o
ganador del último partido terminado de esa fase dentro de ese alcance).
`title_overrides` guarda solo la excepción — "el campeón es este otro aunque
los números digan otra cosa" (sorteo, sanción, título compartido) — igual que
`matches.conference_override_id`.

**3. Configuración de la tabla, por rama.** `standings_levels` (en qué niveles
se publica tabla), `tiebreakers` (la lista ordenada de criterios),
`tiebreaker_mode` y el sistema de puntos opcional.

### Los desempates: cada criterio es un par (métrica, universo)

Revisando los reglamentos reales (NFL, FIFA, UEFA, FIBA) resulta que todos se
escriben con las mismas piezas. Cada criterio es una **métrica** (ganados, %
de ganados, puntos, diferencia, anotados, recibidos) medida sobre un
**universo**:

| Universo | Qué partidos |
|---|---|
| `all` | todos los del equipo en la rama |
| `head_to_head` | solo los jugados **entre los equipos empatados** |
| `scope` | solo dentro de su grupo/conferencia |
| `common` | rivales que **todos** los empatados enfrentaron |

Con esos dos ejes se arma cualquier reglamento sin escribir código nuevo, y la
diferencia de fondo entre ligas — la que en México se dice "diferencia
particular vs general" — es solo **en qué posición de la lista va el
head-to-head**.

**Por eso la lista es configurable por rama, y por eso los preconfigurados se
nombran por lo que hacen y no por un deporte.** ONEFA y la NFL juegan el mismo
deporte y ordenan distinto: ONEFA por **juegos ganados**, la NFL por
**porcentaje**. Llamarle "el de americano" a cualquiera de los dos sería falso
además de inútil para quien lo configura. Los cuatro puntos de partida son:

| Preconfigurado | Orden |
|---|---|
| **Por juegos ganados** (default) | ganados → entre sí → diferencia de puntos → anotados |
| **Por porcentaje de ganados** | % ganados → entre sí → dentro del grupo → rivales en común → diferencia → anotados |
| **Por puntos de tabla** | puntos (3-1-0) → entre sí (pts, dif, anotados) → diferencia → anotados |
| **Entre sí, hasta agotarlo** | ganados → entre sí (ganados, dif, anotados) → diferencia → anotados |

El criterio que hace posible ese orden es `h2h_wins` ("entre sí — juegos
ganados"): si los empatados no se enfrentaron, no separa a nadie y deja pasar
al siguiente, que es exactamente lo que pide el reglamento.

El default es **por juegos ganados** porque es el orden de las ligas de esta
app —es literalmente el reglamento de ONEFA: ganados, luego el juego entre
ellos, y si no se enfrentaron, diferencia de puntos— y porque "ganó más
juegos" se entiende sin explicación. Una liga cuyos equipos no jueguen el
mismo número de partidos cambia a porcentaje en un clic: con 3-1 contra 2-0,
por ganados va arriba el de 3-1 y por porcentaje el de 2-0. Hay una prueba
que fija esa diferencia, y dos más que fijan el reglamento de ONEFA en sus
dos casos (los empatados **se enfrentaron** / **no se enfrentaron**).

**El empate de tres o más es donde casi toda implementación casera falla.**
Ordenar tres empatados de corrido no da lo que dice el reglamento. Los
reglamentos que se molestan en especificarlo (FIBA y FIFA lo escriben con
todas sus letras) coinciden: se arma una sub-clasificación solo entre los
empatados y, en cuanto uno se separa, se **reinicia desde el primer criterio**
con los que quedan — porque al salir un equipo, el universo "entre sí" ya son otros
partidos. NFL lo hace al revés (elimina primero y sigue de largo), así que hay
dos modos: `restart` y `sequential`. No es cosmético: dan órdenes distintos
sobre los mismos partidos, y hay una prueba que lo demuestra con el mismo
juego de datos.

### Dos criterios de "rivales en común", y por qué no es un parámetro

El umbral de muestra mínima **no es una propiedad del criterio, sino del
empate que resuelve**. En el reglamento del que se tomó (NFL) el mismo
criterio va de las dos formas: entre equipos de la misma división, que
comparten casi todo el calendario, **sin mínimo**; entre equipos de divisiones
distintas, que pueden compartir dos rivales, **mínimo cuatro**, para no decidir
un campeonato sobre ruido.

Por eso van como **dos criterios** en el catálogo (`common_win_pct` y
`common_win_pct_min4`) y no como un número configurable: la lista de desempates sigue siendo un arreglo de nombres —
simple de guardar, de mandar y de reordenar en pantalla — y la elección queda
escrita y auditable en vez de deducida por el código a espaldas de quien
configura. Hay dos pruebas con los **mismos partidos** donde cada variante da
un ganador distinto; ese par es la demostración de que el umbral tenía que ser
una decisión y no un número nuestro.

### Un reglamento por nivel de tabla

Una competencia con estructura no usa el mismo reglamento para todas sus
tablas. El caso que lo obliga: en la NFL el empate **dentro de una división** y
el empate por un **wild card** no se resuelven igual — no cambia solo el
umbral, cambia el orden completo:

| | División | Wild card |
|---|---|---|
| 1 | entre sí | entre sí (si aplica) |
| 2 | récord de división | **récord de conferencia** |
| 3 | rivales en común | rivales en común (mínimo 4) |

Con una sola lista por rama, una de las dos tablas sale mal por construcción.
`branches.tiebreakers_by_level` es un mapa opcional `{ nivel: { tiebreakers[],
multi_team_mode } }`; el nivel que no aparezca hereda el reglamento de la rama.

Es **opcional a propósito**: las ligas de una sola tabla —la enorme mayoría—
no se enteran de que existe, porque el selector de nivel solo aparece cuando la
rama publica más de una. Y al separar un nivel, arranca con una **copia** del
heredado en vez de una lista vacía, para que se edite desde donde ya estaba.

### Clasificación: quién avanza (otra cosa que el desempate)

`phase_qualifications` responde "grupos de 4, pasa el primero de cada uno", el
wild card de NFL, o los mejores terceros del Mundial:

```
phase_qualifications(phase_id, from_scope, top_n, plus_best_n, of_rank, target_phase_id)
```

`top_n` sale de **cada** tabla del alcance; `plus_best_n` compara entre sí a
los que quedaron en el **mismo lugar** de tablas distintas. Esa segunda parte
compara equipos que quizá nunca jugaron entre sí, así que no puede usar "entre
sí" y aplica criterios generales — que es exactamente por qué FIFA cambia de
reglamento al rankear terceros lugares. En el panel se configura por fase
(`top_n` + alcance); `computeQualification()` implementa además la parte de
`plus_best_n`, con pruebas, pero esa mitad todavía no tiene control en la UI.

### El candado de migración: de sesión a transacción

Hallazgo que salió probando esto, y que no tiene que ver con posiciones:
`initSchema()` protegía las migraciones con `pg_advisory_lock()`, que vive en
la **sesión**. Eso es incompatible con el endpoint que usa la app: la cadena de
conexión apunta al **pooler** de Neon (PgBouncer en modo transacción), donde
"sesión" no significa una conexión propia — el pooler reparte conexiones de
servidor entre clientes al terminar cada transacción.

No es teórico: se encontró una conexión **ociosa, atendiendo consultas normales
de la app, con el candado de migración puesto**. La siguiente migración se
habría quedado esperando para siempre, y con ella el arranque del servidor —
un despliegue que nunca termina de levantar, sin error que lo explique.

Ahora usa `pg_advisory_xact_lock()`, que se suelta solo al terminar la
transacción pase lo que pase (commit, rollback, o que se caiga el proceso), y
el pooler mantiene la misma conexión de servidor mientras dura. Para no perder
la tolerancia a fallos de antes —una migración que ya se había aplicado no
detiene el arranque— cada instrucción va en su propio `SAVEPOINT`; sin eso,
dentro de una transacción la primera que fallara abortaría todas las
siguientes. Las tres instrucciones del savepoint viajan en **un solo mensaje**:
son ~150 migraciones y separarlas le sumaba medio minuto a cada arranque en
frío. Medido contra la base real: 9s, igual que antes del cambio, y corriéndolo
dos veces seguidas no queda ningún candado colgado.

### Dónde vive

```
backend/src/utils/standings.js        El catálogo de criterios, los reglamentos
                                      preconfigurados y el motor de ordenamiento.
                                      Función PURA, sin base de datos: por eso se
                                      puede probar caso por caso con node --test.
backend/src/utils/matchPhase.js       De dónde sale la fase de un partido
                                      (phase_id, o derivada de week_label).
backend/src/utils/branchStandings.js  Junta la base con el motor: arma todas las
                                      tablas de una rama y resuelve los campeones.
backend/tests/unit/standings.test.mjs 16 pruebas, casi todas del reglamento de
                                      desempates (que es donde está el riesgo).
backend/scripts/verify-standings.mjs  Verificación de SOLO LECTURA contra la base
                                      real: revisa estructura e imprime la tabla ya
                                      calculada, para comparar con lo que la liga
                                      tiene a mano. No escribe nada.
frontend/src/components/
  StandingsTable.jsx                  Una tabla.
  StandingsView.jsx                   Campeones + pestañas por nivel + tablas.
  CompetitionModelModal.jsx           El panel: Fases · Formato · Títulos · Vista previa.
```

### Endpoints

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/api/leagues/branches/:branchId/standings` | Público. Tabla de una rama (solo si la liga está publicada) |
| GET | `/api/manage/branches/:branchId/standings` | La misma, con la configuración, para el panel |
| GET | `/api/manage/standings-catalog` | Criterios, reglamentos preconfigurados y tipos de fase |
| PUT | `/api/manage/branches/:branchId/standings-config` | Niveles, desempates, modo, sistema de puntos y el reglamento por nivel |
| GET POST | `/api/manage/branches/:branchId/phases` | Fases de la rama. El GET devuelve `{ phases, week_labels }`: las jornadas con partidos sin fase, para poder adoptarlas |
| PUT DELETE | `/api/manage/phases/:phaseId` | Editar/borrar fase |
| PUT DELETE | `/api/manage/phases/:phaseId/qualification` | Quién clasifica desde esa fase |
| GET POST | `/api/manage/branches/:branchId/titles` | Títulos de la rama |
| PUT DELETE | `/api/manage/titles/:titleId` | Editar/borrar título |
| PUT DELETE | `/api/manage/titles/:titleId/winner` | Campeón a mano (la excepción) |

La tabla pública va como endpoint **aparte** y no dentro del payload del
torneo a propósito: solo hace falta cuando alguien abre esa pestaña, y
calcularla en cada carga del calendario le costaría a todos los visitantes un
trabajo que casi ninguno pidió.

### Decisiones que parecen detalles y no lo son

- **Un partido "finalizado" sin marcador no cuenta.** El atajo obvio
  (`Number.isFinite(Number(x))`) no sirve: `Number(null)` es `0`, así que un
  partido sin capturar entraría a la tabla como un 0-0 inventado, regalándole
  un empate a los dos equipos. Lo encontró una prueba.
- **Un juego contra alguien que no está en la tabla se ignora.** Un amistoso
  contra un invitado de fuera no puede alterar el récord dentro de la
  competencia. Mismo criterio que ya usaba `matchScope.js`.
- **Un equipo sin partidos queda arriba del que ya perdió.** Los dos van a 0%,
  y en diferencia de puntos el que no jugó está en 0 contra el −10 del que
  perdió. Es la aplicación literal del reglamento, no un caso especial: quien
  no ha jugado tampoco ha perdido.
- **Un empate que el reglamento no resolvió se marca en la tabla** en vez de
  quedarse con el orden que salió. Y un título cuyo primer lugar sigue
  empatado **no corona a nadie**: sería inventar un campeón a partir del orden
  de un array.
- **Borrar una fase no borra sus partidos**: quedan con `phase_id` en NULL y
  su fase vuelve a derivarse de `week_label`.
- **Los tres valores del sistema de puntos van juntos o no van.** Dejar
  `points_win` puesto y `points_draw` en NULL daría una tabla sumada con un
  reglamento a medias.

### Verificado contra la base real (2026-09-16)

Se probó con los datos de **LFA 2025** (temporada cerrada, sin quiniela activa)
y se leyó **ONEFA 2026** sin escribirle nada. Todo lo que escribieron las
pruebas se deshizo; la base quedó igual.

- Migraciones aplicadas y `scripts/verify-standings.mjs` en verde.
- Tabla de LFA correcta: 8 equipos, 8 juegos cada uno. Los 3 partidos de
  postemporada quedaron fuera **sin que nadie capturara una fase** — salieron
  de `week_label`, que era justo la promesa del diseño.
- Desempates verificados a mano: OSOS 2º sobre CAUDILLOS (les ganó 35-21 en la
  J7) y DINOS 5º sobre RAPTORS (44-43 en la J4). Detalle fino que salió bien:
  **la semifinal OSOS-CAUDILLOS no se usó para desempatar**, porque un partido
  que no cuenta para la tabla tampoco cuenta para el "entre sí".
- Campeón derivado del partido de la final (MEXICAS), override manual, y la
  adopción de jornadas: 3 partidos asignados de un golpe.
- ONEFA: sus dos conferencias producen dos tablas (14 Grandes con 14 equipos,
  Nacional con 18) y la columna "en conferencia" se separa del récord general.
- **El ranking de predicciones en curso no se movió**: 36 participantes, 433
  puntos, cero diferencias entre el SQL viejo y el nuevo.
- Navegador (Playwright): pestaña pública de Posiciones, modal ⚙ competencia
  con sus cuatro secciones, alta de fase con adopción, alta de título, y el
  campeón apareciendo en la página pública. En teléfono la tabla **cabe sin
  deslizar** (se ocultan escudo, PF y PC; DIF ya resume a esas dos).
- Tras corregir el reglamento de ONEFA: sus tablas ordenan por **juegos
  ganados**, y como los empatados en 2-0 no se enfrentaron, el criterio "entre
  sí" se salta solo y decide la diferencia de puntos — la regla tal cual.
- Migraciones corridas **dos veces seguidas** sin dejar candados colgados, y el
  arranque sigue en 9s (ver "El candado de migración").
- Reglamento por nivel, con la NFL configurada de verdad: tabla de división y
  de conferencia con procedimientos propios y la general heredando el base.

Lo que encontró salir del código y probar de verdad — ninguno lo podía
atrapar una prueba unitaria, porque en todos el dato de prueba lo inventaba el
mismo código que se estaba probando:

**Contra la base real:**

1. **El estado era `'finished'`, no `'final'`.** La primera versión comparaba
   contra un valor inventado, así que la tabla habría salido **toda en ceros**.
   Peor: la regla real de "ya terminó" ni siquiera es esa comparación — un
   partido en `'scheduled'` también terminó si su categoría tiene auto-status y
   ya pasó la ventana. Ahora la tabla usa `MATCH_IS_FINAL_SQL` de
   `utils/scoring.js`, la misma que los rankings de predicciones, y el motor
   recibe `is_final` ya resuelto en vez de mirar `status`.
2. **Crear una fase no servía de nada sin reasignar los partidos a mano.** Con
   133 partidos en ONEFA eso no era aceptable. Al crear una fase se pueden
   adoptar las jornadas que ya existen (`adopt_week_labels`), y eso solo toca
   los partidos que no tienen fase propia.
3. **El candado de migración estaba filtrado en una conexión ociosa.** Salió al
   colgarse un script de prueba; es lo más grave de la lista porque habría
   colgado el siguiente arranque del servidor. Tiene sección propia más abajo.

**En el navegador:**

4. **El formulario de fase seguía mandando `'regular'`** después de renombrar
   los sistemas de competencia — un valor que ya no existe. Crear una fase sin
   tocar el selector habría fallado. Lo destapó crear una de verdad, no leer el
   código.
5. **Aplicar un preconfigurado dentro de un nivel no surtía efecto.**
   `setCriterios` y `setModo` se llaman en el mismo evento y ambos partían del
   mismo objeto de estado viejo, así que el segundo pisaba al primero y el
   cambio se perdía en silencio. Pasan a la forma funcional de `setState`.

### Lo que queda abierto

- **Configurar ONEFA**: su temporada está en curso y su estructura (2
  conferencias, la Nacional con grupos) todavía no tiene fases ni títulos
  declarados. Se verificó que sus tablas salen bien; declarar sus títulos es
  decisión de la liga, no de esta entrega.
- `computeQualification` reparte los lugares extra comparando entre tablas del
  mismo nivel, pero el orden de esa comparación usa criterios generales fijos
  (% de ganados → diferencia → anotados) y todavía no es configurable como sí
  lo es el desempate normal.

## Predicciones y quinielas

La función con más uso medible de la app, y la única que trae gente que no
administra nada: el aficionado entra al calendario, vota quién gana y vuelve a
ver dónde quedó. Al verificarla contra la base (2026-09-16) el concurso en curso
tenía **36 participantes y 433 puntos**.

### El voto es definitivo

`predictions` guarda una fila por usuario y partido, y **no hay ruta para
editarla ni borrarla** — a propósito, como una quiniela de papel. Un segundo
voto en el mismo partido responde `409`, no sobrescribe.

Votar después de que el partido arrancó se rechaza comparando `match_date`
contra la hora del servidor, **no contra el `status`** — que alguien puede
olvidar mover, y entonces se estaría votando un partido que ya va en el tercer
cuarto.

### Los puntos viven en un solo lugar

Todo el criterio está en `utils/scoring.js` y lo comparten **los tres rankings**
(el del calendario, el de una quiniela y "mis estadísticas"). Con tres copias,
tarde o temprano una reparte puntos que otra no:

- 1 punto por acierto; **2 si el partido es de fase final**.
- Los amistosos/scrimmage no cuentan para nada.
- Un partido **no reparte puntos hasta que terminó** (`MATCH_IS_FINAL_SQL`). El
  marcador parcial que va subiendo el organizador mientras el juego sigue en
  vivo todavía no califica a nadie.
- El % de aciertos se calcula solo sobre lo ya calificado y **no interviene en
  el orden** — el orden es por puntos.

Desde el modelo de competencia (sección anterior), los 2 puntos de fase final
salen de la **fase resuelta** y no de la etiqueta de jornada escrita a mano. Eso
arregló un caso real: una liga que le llama "Liguilla" a su fase final antes no
repartía los 2 puntos, porque esa etiqueta no estaba en una lista hardcodeada.

### Dos alcances: el calendario y tu grupo

| | Ranking del calendario | Quiniela (`pools`) |
|---|---|---|
| Quién aparece | Cualquiera que haya votado ≥1 partido que cuente | Solo los miembros |
| Quién lo ve | Público, sin sesión | Solo los miembros (403 si no) |
| Cómo se entra | Votando | Con el código de la quiniela |
| Mínimo para salir | 1 predicción | Ninguno — se ve a todos desde el arranque |

El código de una quiniela (`join_code`, 12 hex) **sirve las veces que haga
falta**, a diferencia de las invitaciones de equipo, que son de un solo uso: una
quiniela se comparte en un grupo de WhatsApp y se une quien quiera, cuando
quiera. Reusarlo siendo ya miembro no reinicia tu `joined_at`.

Cuentan **todas** tus predicciones en esos partidos, aunque las hayas hecho
antes de unirte. No hay forma de emparejar el punto de partida más que crear la
quiniela antes de que arranque la temporada — limitación conocida, no descuido.

### Endpoints

| Método | Ruta | Para qué |
|---|---|---|
| POST | `/api/predictions` | Votar. Una vez por partido, definitivo |
| GET | `/api/predictions/summary?matchIds=` | Conteo por partido; con sesión, además tu voto |
| GET | `/api/predictions/my-stats` | Total, calificadas, aciertos y % |
| GET | `/api/predictions/ranking?matchIds=` | Ranking del calendario. **Público** |
| POST | `/api/pools` | Crear quiniela (quien la crea queda de primer miembro) |
| GET | `/api/pools/mine` | Mis quinielas, con cuántos miembros tiene cada una |
| GET | `/api/pools/:code` | Vista previa **pública**, antes de pedir sesión |
| POST | `/api/pools/:code/join` | Unirse |
| GET | `/api/pools/:code/ranking?matchIds=` | Ranking interno. Solo miembros |
| GET | `/api/board` | "Mi cartelera" — ver abajo |

El ranking siempre recibe **el calendario completo** que se está viendo, nunca
un recorte filtrado: si no, cada filtro de pantalla produciría una tabla
distinta y ninguna sería "el ranking".

### Frontend

- `PredictionWidget.jsx` — en `MatchCard` (cada tarjeta del calendario) y en
  `MatchPage`. Si ya votaste enseña el porcentaje en vez de los botones.
- `CalendarRanking.jsx` y `PoolRanking.jsx` — dentro de `CalendarViewer`.
- `PredictionStats.jsx` y `MiCartelera.jsx` — en `/panel` (`Dashboard.jsx`).
- `PoolJoinPage.jsx` — `/quiniela/:code`, público, para abrir el link recibido.

**"Mi cartelera"** (`routes/board.js`) junta en una sola lista los partidos que
te interesan por cualquiera de tres razones: pediste aviso de ese partido,
pediste aviso de un equipo completo (se expande a todos sus partidos de esa
liga), o predijiste. Un partido que cae en varias razones aparece **una sola
vez**, con banderas que dicen por qué está ahí. No tiene tabla propia —se deriva
de `push_subscriptions` + `predictions`— y es historial: el partido se queda en
la lista después de jugarse.

### Fuera de esta versión

Editar o borrar un voto; premios o dinero de por medio (hoy no hay nada que
cobrar ni repartir, y meterlo cambiaría el marco legal de la función);
desempates finos del ranking (rachas, sorpresas). Sobre este último, el
comentario de `predictions.js` es explícito: eso lo resuelve quien organice un
concurso leyendo la tabla — aquí solo se rompe el empate con los datos que ya
hay, para dar un orden estable.

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

- ~~El modal y los endpoints de roster **por equipo sin rama**~~ — **borrados
  (septiembre 2026)**, y no eran código muerto como decía este README: el panel
  de la liga tenía un botón "Roster" vivo por equipo que abría `TeamRosterModal`.
  El problema de fondo era el alta: `player_team_memberships.branch_id` es
  nullable (se agregó por `ALTER`, sin `NOT NULL`), así que ese `POST` daba de
  alta al jugador con `branch_id = NULL`, y **las cuatro** consultas del modelo
  actual filtran por `ptm.branch_id` — el jugador no aparecía en el roster de
  ninguna rama, ni en la plantilla de Excel, ni en el conteo de "tus planteles".
  El `GET` obsoleto sí lo mostraba (no filtra por rama), lo que completaba el
  engaño: quien lo daba de alta lo veía ahí y suponía que había quedado bien.
  Se borró el botón en vez de repuntarlo porque **el camino correcto ya existía
  en la misma pantalla**: en el árbol Torneo → Categoría → Rama, cada equipo
  inscrito en una rama tiene un chip "roster" que abre `BranchRosterModal` de esa
  rama. La liga no perdió nada; solo dejó de haber una entrada que producía
  jugadores huérfanos. Se fueron con él `TeamRosterModal.jsx`, los tres endpoints
  obsoletos de `players.js` (`GET`/`POST /teams/:id/roster` y
  `POST /:playerId/move-to-team/:id`, este último sí sin usar) y sus tres
  funciones en `api/client.js`.
  **Las membresías huérfanas que ya existan siguen ahí**: no se pueden crear
  nuevas, pero las viejas siguen invisibles. Dos scripts para eso:
  `find-orphan-roster-players.mjs` las lista (solo lectura) y
  `delete-orphan-roster-players.mjs` las borra — **simula por defecto**, sin
  `--confirm` no escribe nada. El borrado no es un `DELETE` de una línea a
  propósito: otras tablas apuntan a `players(id)` con `ON DELETE CASCADE`, así
  que la fila del jugador se borra **solo** si no queda referenciada en ningún
  otro lado — otra membresía con rama, estadísticas de partido, o haber
  reclamado su perfil (`players.user_id`). Si tiene aunque sea una, se borra nada
  más la membresía rota y el jugador se queda. **Ya se corrió (2026-09-17)**:
  encontró una sola membresía huérfana (ZHAMIS TOLEDO, equipo BULLDOGS), sin
  ninguna otra referencia, así que se fue con todo y su fila en `players`. Ver
  `docs/CHANGELOG.md`.
- ~~No hay endpoint para **quitar** a un jugador del roster~~ — **hecho
  (septiembre 2026)**: `DELETE /api/players/branches/:branchId/teams/:teamId/roster/:playerId`,
  con botón "Quitar" en `BranchRosterModal`. Tiene dos comportamientos porque
  confundirlos ensucia el historial del jugador: por default **da de baja**
  (cierra la membresía, y el paso por el equipo se sigue viendo en su
  trayectoria, `GET /players/:id/card`), y con `?hard=true` **borra sin dejar
  rastro**, para el alta mal capturada — ese es el caso que la casilla "Fue un
  error de captura" prende en el diálogo. En el modo `hard`, si al jugador no le
  queda ninguna otra referencia se borra también su fila en `players`, para no
  dejar otro jugador huérfano invisible; y **solo** si está limpio en las tablas
  que lo referencian con `ON DELETE CASCADE` y no ha reclamado su perfil — mismo
  criterio que `scripts/delete-orphan-roster-players.mjs`. Ya **no** se revisa el
  padrón ni el libro de cuotas de ningún club: desde la separación esas tablas no
  cuelgan de `players`, así que esto no puede tocar la cobranza de nadie. Siempre
  acotado a este equipo + esta rama: si está dado de alta en otra rama, ahí se
  queda.
- La deduplicación al re-subir solo compara contra el roster **de esa misma rama** — un jugador puede quedar duplicado a propósito si se da de alta por separado en otra rama o equipo (mismo comportamiento que el alta manual, que siempre crea un jugador nuevo).
- Credencial digital de jugador con QR (ver "Roadmap de producto" más abajo): el roster ya existe con este nivel de detalle, la credencial/QR todavía no.

## Roster público y pase de lista

**Decidido y construido el 2026-09-20.** Es lo que le da pantalla propia al
visor, que era el pendiente que dejó abierto el modelo de roles. Las dos
mitades corren: el **roster público** —primera superficie pública donde se ve
quién juega, porque hasta ese día las públicas eran liga, torneo, calendario,
partido y la tarjeta del jugador— y el **pase de lista** encima de esa misma
lista. Su verificación está en `docs/CHANGELOG.md`.

Esta sección es la primera mitad. La segunda —el mismo patrón aplicado a la
captura de lo que pasa en el campo— está en "Estadísticas por jugada".

### Un botón, dos funciones

La liga publica sus rosters. En la vista pública del partido, cada equipo
ofrece **Roster**: quien llega de fuera ve a los participantes de ese equipo en
esa rama; quien tiene el permiso `asistencia` ve la misma lista **con el pase
de lista al lado**. No son dos pantallas ni dos botones: es la misma lista, y
lo que cambia es si se puede marcar.

Que el roster se abra **desde el partido** es lo que hace que el mismo botón
sirva para las dos cosas. La asistencia es a un partido; un roster suelto, sin
partido en contexto, no tiene a qué marcarle nada.

### Qué se publica, y quién lo decide

Lo que manda es la regla 7 de `CLAUDE.md`, y esta pantalla es justo la que esa
regla describe: **nombre, número y posición**. `curp` y `birth_date` no salen
nunca, y el endpoint nombra sus columnas una por una en vez de `SELECT *`, como
ya hace `GET /players/:id/card`.

**La decisión se toma al crear la categoría**, no después y no en un ajuste
escondido. Ahí se pregunta si los rosters de esa categoría son **públicos o
privados** y, si son públicos, **con foto o sin foto**. Es el lugar correcto
porque una categoría *es* un corte de edad y de nivel: quien la está creando
sabe en ese momento si está armando la Infantil o la Mayor, y es justo cuando
la pregunta significa algo. Preguntarlo por equipo obligaría a acertarle
veinte veces a la misma decisión.

Dos columnas nuevas en `categories`, las dos **apagadas por default**:

| Columna | Qué decide |
|---|---|
| `roster_public` | Si el roster de esa categoría sale en público |
| `roster_photos` | Si además puede salir la foto |

**El equipo puede bajar el techo, nunca subirlo.** La categoría fija hasta
dónde se permite; `branch_teams.show_photos` deja que un equipo apague la suya
aunque la categoría la permita. La foto se publica solo si las dos están de
acuerdo:

```sql
categories.roster_photos AND COALESCE(branch_teams.show_photos, TRUE)
```

Nulo significa "sigue a la categoría", y por eso un equipo que nunca tocó nada
no bloquea a su liga. Lo que **no** existe es la operación contraria: ningún
equipo puede encender lo que su categoría dejó apagado. Así la regla 7 se
sostiene —el equipo conserva el veto sobre las caras de sus jugadores— sin que
la liga tenga que perseguir a veinte equipos para publicar un programa de mano.

> **Esto corrige la regla 7, no la contradice.** Decía que la foto la habilita
> el equipo, y sigue siendo cierto: lo que se agrega encima es un techo de la
> liga, que solo puede quitar permiso, nunca darlo.

### La nota que va en esa pantalla

La pregunta se acompaña de una recomendación nuestra, no de una prohibición.
La liga decide; nosotros decimos lo que sabemos:

> **Recomendación de CFBAMX.** Si esta categoría es de menores de edad, te
> sugerimos dejar el roster privado. Publicar el nombre, el número y la cara de
> un menor en una página abierta no le aporta nada a la competencia y sí lo
> expone fuera de la cancha. Lo que el proceso de competencia sí necesita
> —quién está inscrito, quién asistió, quién es elegible— la liga y el equipo
> ya lo ven sin que nada de eso sea público.

Va como recomendación y no como candado por la regla 10: la liga conoce su
torneo y sus familias, y una plataforma que decide por ella se equivoca en
cuanto aparece el caso que no previó. Lo que sí hacemos es que el default
—apagado— sea el que no lastima a nadie si la pregunta se contesta a las
prisas.

**La asistencia NO es pública**, ni marcada ni sumada, encienda la categoría lo
que encienda. Son faltas de gente que en buena parte es menor de edad, y
publicarlas es exactamente lo que la regla 7 existe para no hacer.

### El pase de lista

Dos estados y nada más: **presente** y **ausente**. Y un tercero que no se
guarda porque es la ausencia de fila: **sin pasar lista**.

> **"Sin pasar lista" no es "faltó", y de esa diferencia cuelga todo.** Si el
> visor no llegó, nadie faltó. Guardar solo dos estados obligaría a inventar
> uno de los dos para los partidos que nadie capturó, y la liga acabaría
> castigando a quien no debía. Por eso la fila **no existe** hasta que alguien
> pasa lista, y el acumulado reporta las tres cifras por separado.

Nada de "justificado" ni de "no uniformado": un justificado no es un hecho que
el visor observe en la cancha, es una decisión que alguien toma, y esa decisión
es de la liga.

### Lo que la plataforma no hace

**Registramos la actividad; la regla es de la liga.** Nadie aquí calcula si un
jugador es elegible para playoffs, ni bloquea una alineación, ni pinta a nadie
en rojo. Se entrega el conteo —presentes, ausentes, sin marcar— y la liga
aplica el criterio que tenga, que además cambia de liga en liga y de temporada
en temporada. Una plataforma que ejerce la regla se equivoca en cuanto la liga
la cambia, y encima se vuelve responsable de una decisión que no le toca.

### Modelo

Tabla propia, `match_attendance`:

```sql
CREATE TABLE IF NOT EXISTS match_attendance (
  id                SERIAL PRIMARY KEY,
  match_id          INTEGER NOT NULL REFERENCES matches(id)  ON DELETE CASCADE,
  player_id         INTEGER NOT NULL REFERENCES players(id)  ON DELETE CASCADE,
  team_id           INTEGER NOT NULL REFERENCES teams(id)    ON DELETE CASCADE,
  status            TEXT NOT NULL CHECK (status IN ('present','absent')),
  marked_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  marked_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(match_id, player_id)
)
```

**Por qué no es una columna de `player_match_stats`**, que ya está indexada por
el mismo par (jugador, partido):

- Ahí la ausencia de fila significa "nadie capturó estadísticas". Meter la
  asistencia obligaría a crear filas de puros ceros para decir "vino", y
  entonces "0 yardas" dejaría de distinguirse de "no jugó".
- Son dos actos distintos, capturados por gente distinta y en momentos
  distintos: el pase de lista es antes del partido y siempre ocurre; las
  estadísticas son después y casi nunca.
- La asistencia necesita saber **quién la marcó y cuándo**, porque de ella
  cuelga una decisión. `player_match_stats` no guarda ninguna de las dos cosas.

**El acumulado no se guarda, se suma** (regla 4). No hay ningún
`games_attended` en ninguna tabla: presentes, ausentes y sin marcar salen de
contar filas contra los partidos de esa rama en los que jugó ese equipo. Un
pase de lista corregido corrige el acumulado solo.

**Corregir es sobrescribir**, no un libro append-only: `UNIQUE(match_id,
player_id)` con `ON CONFLICT DO UPDATE`, y `marked_by_user_id` / `marked_at` se
quedan con quien lo dejó así. No es dinero y no lleva la maquinaria de la regla
5. Si algún día una liga disputa una asistencia esto no alcanza y habrá que
agregarle historial — queda escrito para no descubrirlo en ese momento.

**Quién aparece en la lista**: el roster de ese equipo en esa rama **vigente a
la fecha del partido**, no el de hoy. Un jugador dado de baja en octubre sí
estaba en el partido de septiembre, y su fila de asistencia se queda donde
está. La fecha se compara en hora de México, como el resto de las altas y bajas
del roster — y no es cosmético: `matches.match_date` guarda un ISO en UTC, así
que un partido de las 6 pm se cuenta al día siguiente si se corta en UTC (ver
`fechaDelPartidoMx` en `utils/sqlDates.js`).

> **Solo se filtra por `end_date`, y la asimetría es deliberada** (decidido al
> construirlo, 2026-09-20). Las dos fechas de `player_team_memberships` no
> significan lo mismo:
>
> - `end_date` es un **acto**: alguien entró a la pantalla y dio de baja a esa
>   persona ese día. Es un hecho sobre la temporada, y se respeta.
> - `start_date` es **cuándo se capturó la fila**. Nace con `DEFAULT` la fecha
>   de hoy y ninguna pantalla la pregunta nunca. Filtrar por ella sería tratar
>   "el día que lo tecleamos" como "el día que llegó al equipo".
>
> Y no es teórico: aquí el roster se captura tarde, con el torneo empezado. Con
> el filtro de arriba, una liga que sube su roster en noviembre vería la lista
> **vacía** en todos los partidos anteriores y no podría pasar lista en ninguno
> — justo la lectura ("no hay jugadores") que esta sección existe para no
> producir. Dejar de más a alguien que llegó después cuesta un renglón marcado
> "sin pasar lista", que no es "faltó". Los dos errores no cuestan lo mismo.
>
> El día que `start_date` sea un dato que alguien declare, y no el reloj del
> servidor, el filtro se aprieta sin migrar nada (regla 4).

**Y aparece siempre quien ya tenga fila de asistencia en ese partido**, pase lo
que pase con su membresía. Sin eso, dar de baja a alguien borraría de la
pantalla una marca que sigue existiendo en la base: el dato quedaría vivo e
invisible, que es la peor de las dos opciones.

**Un partido sin equipos vinculados no se puede pasar lista.**
`matches.home_team_id` y `away_team_id` son nullable: un partido creado por
nombre y nunca sincronizado no sabe de qué equipo habla. Ahí la pantalla tiene
que decir que falta conectar los equipos —el botón "Conectar equipos con sus
partidos" del panel de la liga— y no ofrecer una lista vacía que se lea como
"no hay jugadores".

### Quién marca y quién ve

Un permiso nuevo, `asistencia`, en el catálogo de `utils/orgRoles.js`:

| Tipo | Rol | `asistencia` |
|---|---|---|
| Liga | `owner` | ✅ |
| Liga | `admin` | ✅ |
| Liga | `editor` (visor) | ✅ |
| Liga | `treasurer` | ❌ |
| Equipo | todos | ❌ escribir · ✅ leer lo suyo, vía `ver` |

**No hace falta un "actuar como visor".** El emprendedor que registró la liga a
veces pasa lista él mismo, y no tiene por qué crear una segunda cuenta ni
cambiarse de rol para eso: su rol de dueño **ya trae** el permiso. Un rol no es
un disfraz que uno se pone; es lo que uno puede. Es también por qué el permiso
se llama `asistencia` y no "ser visor".

Del lado del equipo, leer la asistencia de los suyos cae en `ver`, la línea
base — **incluido el coach**, que es justo quien necesita saber a quién le
falta antes de que sea tarde. No cae en los dos dominios que `ver` nunca
arrastra (`cuotas_club` y `cobranza_liga`): la asistencia es del dominio
torneo, como el roster. Un equipo ve **lo suyo** y nunca el pase de lista del
rival.

### Endpoints

| Método | Ruta | Quién |
|---|---|---|
| `GET` | `/api/leagues/matches/:matchId/teams/:teamId/roster` | **Público** — recortado por la regla 7 |
| `PUT` | `/api/players/branches/:branchId/teams/:teamId/photos` | **Solo el equipo.** Su veto sobre la foto |
| `GET` | `/api/players/matches/:matchId/attendance` | Permiso `asistencia` de la liga, o `ver` del equipo (solo su lado) |
| `PUT` | `/api/players/matches/:matchId/attendance` | Permiso `asistencia` |
| `GET` | `/api/players/branches/:branchId/teams/:teamId/attendance` | El acumulado. Liga y equipo |

**Los dos primeros cuelgan del PARTIDO y no de la rama**, aunque un roster viva
a nivel rama: es lo que hace que el mismo botón sirva para las dos cosas, y es
lo que permite contestar la pregunta correcta —quién estaba en el roster **ese
día**—. El pase de lista vive en `players.js`, junto al roster por rama y a
`/matches/:id/stats`, que ya estaba ahí.

**El público no vive bajo un prefijo `/public`**, como decía el plan: esta app
no tiene tal prefijo. Su superficie pública son los endpoints de
`routes/leagues.js` sin `authRequired`, y el vecino natural de este es
`/leagues/branches/:branchId/standings`, que ya filtra por `l.is_public` igual.
Responde **404 y no 403** a un roster privado, por la misma razón que la
tarjeta del jugador: desde afuera no se debe poder distinguir "existe pero no
te lo muestro" de "no existe".

**El roster público muestra quién está hoy** (`end_date IS NULL`). La otra
pregunta —quién estaba vigente **a la fecha del partido**— la necesita el pase
de lista y llega con él, no antes: hoy no hay nada que la consuma.

**El veto del equipo es la única guarda que deja fuera a la liga**
(`branchTeamPhotoRequired`, en `middleware/ownership.js`). La categoría ya es
el techo y esa sí la administra la liga; si además pudiera tocar `show_photos`
tendría las dos llaves y el veto no existiría. Del lado del equipo el permiso
es `roster`: quien da de alta al jugador y le sube la foto es quien decide si
esa foto sale.

**El estado de publicación viaja con el roster privado**, no en un endpoint
aparte: `GET /players/branches/:b/teams/:t/roster` responde además
`visibility` —los tres valores crudos más la conclusión ya resuelta— porque es
la misma pantalla la que lo pinta, y ahí es donde alguien está a punto de subir
una foto. `GET /leagues/matches/:matchId` trae `roster_public` por lo mismo:
con un booleano se decide si el partido ofrece el botón, y pedirlo aparte
obligaría a cargar la pantalla dos veces.

**La regla vive en `utils/rosterVisibility.js`**, puro y sin `db`, por la misma
razón que `orgRoles.js`: es lo que decide si la cara de un menor sale en una
página abierta, así que tiene que poder probarse sin Postgres. Lo usan las tres
rutas y, en su versión de SQL (`fotoSePublicaSql`), la tarjeta del jugador.

**El `PUT` recibe la lista completa de un equipo, no un jugador a la vez.** Un
pase de lista se hace de un jalón y con la cancha enfrente; mandar cuarenta
llamadas sueltas deja la mitad capturada cuando se cae el internet del campo,
que es justo donde esto se va a usar. Recibir la lista entera lo vuelve además
idempotente de nacimiento, que es lo que pide la cola de envío de "Capturar sin
señal" — el pase de lista ocurre en la cancha y tiene que funcionar sin datos. Va como **una sola sentencia** con
`INSERT … ON CONFLICT`, por la regla de que una transacción no se reparte entre
varias llamadas.

### Antes de darlo por hecho

Las dos cosas que este proyecto ya aprendió a la mala aplican enteras aquí:

- Suite e2e contra una rama de Neon, con datos que **no** invente el mismo
  código que se está probando: un roster con bajas a media temporada, un
  partido sin equipos vinculados y un pase de lista corregido dos veces.
- La pantalla, abierta en el navegador con los tres papeles —público, visor y
  coach— antes de decir que quedó.

**Lo segundo se hizo entero; lo primero, no.** Las dos mitades se verificaron
en el navegador contra la rama de Neon, con un roster real de ONEFA sembrado
con sus casos feos —una baja a media temporada, un jugador sin número, y los
dos equipos del mismo partido en distinto estado, uno publicando fotos y el
otro con el veto puesto— y con los tres papeles: público sin sesión, visor y
coach. El detalle está en el CHANGELOG.

Lo que **no** hay es suite e2e propia. Las 34 pruebas nuevas cubren las dos
reglas puras (`utils/rosterVisibility.js` y `utils/attendance.js`) y no las
rutas, como todo `routes/`. Las rutas se probaron a mano contra la rama de Neon
—los cinco casos del `PUT`, las cuatro fronteras de permiso— y eso está
anotado, pero no corre solo. Es el candidato natural a cuarta suite e2e.

**La rama `desarrollo-local` de Neon se quedó con esos datos a propósito**: la
categoría COLEGIAL UNIVERSITARIO publica su roster con foto, el equipo 21 la
deja pasar, el 17 la veta, y hay dos pases de lista capturados en los partidos
603 y 619. Es el punto de partida de "Estadísticas por jugada", que se captura
desde la misma pantalla.

Para volver a abrir el pase de lista desde el navegador hace falta un usuario
con el permiso, y en esa rama se hace con una línea —el rol `editor` de una liga
es el visor:

```sql
INSERT INTO organization_members (organization_id, user_id, role)
SELECT organization_id, <tu_user_id>, 'editor' FROM leagues WHERE slug = 'onefa';
```

## Estadísticas por jugada

**Decidido y construido el 2026-09-20.** Es el mismo patrón que el pase de
lista y el tercer botón de la vista pública del partido: **Estadísticas** le
muestra el box score a cualquiera, y a quien tiene el permiso `estadisticas` le
abre el panel de captura. Lo que cambia es el modelo, y aquí sí había estándar
que no valía la pena reinventar.

Corre completo: las tres tablas, el permiso, los seis endpoints, la derivación
del down, el box score en cascada, el panel del visor en
`/partidos/:matchId/estadisticas` y su despachador en la cola sin señal.
Verificado de punta a punta contra Postgres (`backend/tests/plays.e2e.mjs`, 68
comprobaciones) y con el modo avión prendido contra la compilación real.

### Lo que ya existe afuera, y qué se toma de cada cosa

Se buscó antes de diseñar. Hay cuatro referencias y **ninguna se adopta
entera** — cada una aporta una cosa distinta:

| Referencia | Qué es | Qué se toma |
|---|---|---|
| **NCAA Football Statisticians' Manual** | El reglamento de **cómo se acredita** cada estadística. No es un formato de datos | Las reglas de acreditación, tal cual |
| **SportsML 3.1** (IPTC) | Vocabulario XML abierto con el diccionario de estadísticas de fútbol americano | Los **nombres** de los campos |
| **StatCrew / Genius Sports XML** | El formato de intercambio de facto del fútbol colegial de EE. UU. | La forma del archivo, si algún día hay que exportar |
| **nflfastR / nflverse** | Diccionario abierto de play-by-play, documentado y consultable | Qué columnas tiene una jugada en la práctica |

**El manual de la NCAA es el que de verdad importa aquí**, porque ONEFA juega
con reglas NCAA: las reglas de acreditación no hay que inventarlas ni
discutirlas, ya están escritas. Dos ejemplos de lo que resuelve y que nadie
adivinaría solo:

- Un pase tirado a propósito al suelo (*intentional grounding*) **no** cuenta
  como intento de pase. Se le acredita al pasador un **acarreo** con la pérdida
  hasta el punto de la falta.
- La yarda perdida en una captura se **parte entre los dos taqueadores**, y si
  el número es impar el reparto lo decide el estadístico oficial.

Escribirlo aquí es lo que evita que alguien "arregle" esa aritmética más
adelante creyendo que es un bug.

De **SportsML** se toman los nombres y nada más: `passes-attempts`,
`passes-completions`, `rushes-attempts`, `rushes-yards`, `receptions-total`,
`field-goals-made`, `extra-points-made`, `touchdowns-passing`… Adoptar su XML
completo sería absurdo —son cientos de atributos, la mayoría para prensa
deportiva profesional— pero nombrar nuestras columnas como él las nombra hace
que exportar algún día sea un mapeo y no una traducción.

### La jugada es el átomo

Se captura **jugada por jugada**, y el box score se deriva de ahí. No es la
opción barata y se eligió a propósito:

- **Es lo que de verdad pasa en el campo.** El visor ya lleva la jugada en
  papel; el panel sustituye ese papel, no le agrega trabajo nuevo.
- **Es lo único que responde "quién anotó"**, que es justo lo que la hoja de
  visoría necesita y lo que las 16 columnas de contadores de hoy nunca van a
  poder contestar.
- **Todo lo demás se deriva.** Yardas, intentos, porcentajes, líderes: nada de
  eso se guarda, se suma. Es la regla 4 aplicada a estadísticas.

Dos tablas. La jugada, y quién participó en ella:

```sql
CREATE TABLE IF NOT EXISTS match_capture_sessions (
  id                 SERIAL PRIMARY KEY,
  match_id           INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  capture_level      TEXT NOT NULL,   -- scoring · offense · full
  claimed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  claimed_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at        TIMESTAMP,
  is_authoritative   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS match_plays (
  id                SERIAL PRIMARY KEY,
  match_id          INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  session_id        INTEGER NOT NULL REFERENCES match_capture_sessions(id) ON DELETE CASCADE,
  client_play_id    TEXT NOT NULL,           -- UUID que nace en el celular
  sequence          INTEGER NOT NULL,        -- orden de captura, NO identidad
  drive_number      INTEGER NOT NULL,        -- la serie: agrupa, no hace falta tabla
  period            TEXT NOT NULL,           -- '1'..'4', 'OT1'…
  clock             TEXT,                    -- solo en la 1a jugada de la serie
  offense_team_id   INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  down              INTEGER,                 -- se DERIVA; solo se guarda si se corrigió
  distance          INTEGER,                 -- idem
  yard_line         INTEGER,                 -- solo en la 1a jugada de la serie
  play_type         TEXT NOT NULL,           -- rush · pass · kickoff · punt ·
                                             -- field_goal · extra_point ·
                                             -- two_point · penalty · kneel · spike
  yards_gained      INTEGER NOT NULL,        -- cero es un valor, no un hueco
  points            INTEGER NOT NULL DEFAULT 0,
  scoring_team_id   INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  notes             TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(match_id, client_play_id)
);

CREATE TABLE IF NOT EXISTS play_participants (
  id        SERIAL PRIMARY KEY,
  play_id   INTEGER NOT NULL REFERENCES match_plays(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role      TEXT NOT NULL,   -- passer · rusher · receiver · tackler · assist ·
                             -- sack · interceptor · fumbler · recoverer ·
                             -- kicker · punter · returner
  yards     INTEGER,
  UNIQUE(play_id, player_id, role)
);
```

**La identidad es `client_play_id`, no `(match_id, sequence)`**, porque esto se
captura sin señal y `sequence` la asigna el dispositivo: dos dispositivos
empiezan los dos en 1. El porqué completo, y todo lo demás que el modo sin
señal impone, está en "Capturar sin señal".

**`yards_gained` quedó `NOT NULL`, y el borrador de arriba lo tenía nulable.**
Se cambió al construirlo, por lo que dice la jugada mínima tres párrafos más
abajo: *cero es un valor, no un hueco*. Un NULL ahí se suma como cero al
derivar el box score, y entonces "no se capturó" y "no avanzó" dejan de
distinguirse — que es justo la confusión que esa regla existe para impedir. El
validador ya lo exigía; esto es lo que la base no puede dejar pasar por su
cuenta. Los tres `CHECK` (nivel, tipo de jugada y papel) se construyen desde
las listas de `utils/plays.js`, como los roles y los estados de asistencia:
regla 6, la base no puede aceptar un valor que el código no conozca.

**Por qué `play_participants` aparte y no doce columnas de jugador en la
jugada.** Un pase completo con captura tiene pasador, receptor y dos
taqueadores; un acarreo tiene uno. Doce columnas nulables obligan a leer todas
para saber cuáles vienen llenas, y cada estadística nueva es una columna más. En
una tabla de participantes, "intentos de pase de fulano" es contar filas con
`role = 'passer'` — que es exactamente la forma que tienen los nombres de
SportsML.

### Qué tan fina es la jugada mínima

**Decidido el 2026-09-20**, y no por lo que es barato sino por cómo se lleva
esto de verdad. Lo que se fue a ver antes de decidir:

- En la **NCAA** el play-by-play completo **no lo hace una persona**: es una
  cuadrilla de tres —quien identifica al jugador, quien narra la jugada y quien
  la teclea—. Pedirle eso a un visor solo es pedirle el trabajo de tres.
- Las guías para **preparatoria** recomiendan lo contrario de lo que suena
  profesional: *"para la mayoría de los programas, capturar resultado por
  jugada es demasiado fino; lleva los totales de cada jugador **por serie**"*, y
  ofrecen una hoja de **11 columnas que una sola persona puede manejar**.
- La **estadística defensiva es la que rompe la captura en vivo**. La
  recomendación de todos lados es la misma: primero taqueos y capturas, los
  balones sueltos entre series.
- **SnapStat**, hecho por un papá que capturó más de cien partidos, tomó la
  decisión que más dice: el **reloj se captura 10–15 veces por partido, no
  120** — nada más en los cambios de posesión.

La conclusión que sale de ahí es una sola: **lo que cuesta capturar no son las
jugadas, son los campos que obligan a mirar a otro lado.** Quién llevó el balón
y cuántas yardas ganó lo ve la misma persona que está siguiendo la jugada. Quién
taqueó hay que buscarlo en el montón, y el reloj hay que voltear a verlo.

### La jugada mínima: qué hizo el balón

Una jugada es **válida** con tres cosas, y nada más:

1. `play_type` — pase, acarreo, patada, despeje, gol de campo, punto extra…
2. **Al menos un participante con el balón**: `passer` + `receiver` en un pase
   completo, `rusher` en un acarreo, `kicker`, `returner`.
3. `yards_gained` — cero es un valor, no un hueco (un pase incompleto es cero).

Si la jugada anotó, además `points` y `scoring_team_id`. Eso es todo.

**Lo que NO entra en el mínimo, con su razón:**

| Campo | Por qué queda fuera |
|---|---|
| Taqueadores y asistencias | Es el campo que exige una segunda persona. La NCAA le pone un observador dedicado; las guías de preparatoria dicen que se agregue después |
| Reloj | Se captura **por serie**, no por jugada: de 120 capturas a 10–15 |
| Down y distancia | **Se derivan** (ver abajo) |
| Penalizaciones | Se agregan encima de la jugada que ya existe, cuando haya con quién |

Todo esto se agrega **sobre la misma fila** cuando la liga pueda. No hay
migración entre un nivel y otro: una jugada simplemente tiene más
participantes.

### El down no se captura, se deriva

Dentro de una serie, si se sabe dónde empezó y cuántas yardas ganó cada jugada,
**se sabe en qué down va**: 1 y 10 desde la 25, ganó 4 → 2 y 6; ganó 6 → 1 y 10
otra vez. Es la regla 4 aplicada a la captura.

Lo que rompe la cadena son las penalizaciones y los cambios de posesión que no
se anotaron. Por eso la pantalla **muestra el down derivado y deja corregirlo**:
el visor no captura el down, lo desmiente cuando se desvía. Se captura la
posición al **inicio de la serie** y el resto sale solo.

Es la diferencia entre teclear cuatro campos por jugada y confirmar uno.

Tres cosas que se cerraron al construirlo, porque se van a volver a preguntar:

- **`yard_line` son las yardas que faltan para la zona de anotación rival**
  (0–100), no la numeración pintada en el campo. Se eligió así porque hace que
  "1 y gol" salga solo: lo que falta por ganar nunca puede ser más que lo que
  falta para anotar, y `min(10, yard_line)` es toda la regla.
- **Una corrección rearranca la cadena.** No solo arregla esa jugada: el visor
  vio el campo y este código no, así que a partir de ahí se deriva desde lo que
  él dijo. Es también cómo se sale de una cadena rota sin empezar otra serie.
- **El quinto down no se inventa.** Cuando la cadena se rompe, la jugada sale
  con el down en blanco y marcada `cadena_rota`. Poner un "5º y 3" sería un
  dato falso donde un hueco es la verdad, y el hueco es lo que hace que alguien
  corrija.

### La serie es la unidad que abarata todo

`match_plays` gana `drive_number`. No es un capricho de modelo: es lo que hace
posible todo lo de arriba, porque los tres campos caros son **por serie y no
por jugada**:

- quién tiene el balón,
- el reloj,
- la posición de arranque.

Los tres se capturan una vez por serie —diez o quince veces por partido— y se
quedan en la primera jugada de esa serie; en las demás van en nulo. No hace
falta una tabla de series: una serie **es** un grupo de jugadas con el mismo
`drive_number`, y se resuelve al leer.

### Tres niveles, una sola bitácora

El visor elige al empezar qué va a capturar, y **la sesión lo declara**:

| Nivel | Qué captura | Cuánto cuesta | Qué produce |
|---|---|---|---|
| `scoring` | Solo las jugadas que anotaron | ~8 capturas · cualquiera | **Quién anotó**. No produce box score |
| `offense` | Todas las jugadas, mitad ofensiva | ~120 capturas · una persona que sabe de futbol | Box score de ataque completo |
| `full` | Lo anterior más taqueos y capturas | ~120 capturas · dos personas | Box score completo |

Los tres **escriben las mismas filas**. Una liga que arranca en `scoring` y en
dos temporadas llega a `full` no migra nada: sus jugadas viejas se quedan como
están y las nuevas traen más participantes. Eso es lo que compra la tabla
`play_participants`, y es la razón de que exista.

> **El nivel no es una preferencia, es un dato del que depende cómo se lee ese
> partido.** Si un partido capturado en `scoring` alimentara el box score
> derivado, ese box score diría que el equipo entero corrió 80 yardas en el
> partido —las de los touchdowns— y nada más. Sería un número **falso y con
> cara de verdadero**, que es la peor clase. Por eso el nivel se declara al
> empezar y viaja con la sesión.

### Dos formas de capturar, una sola forma de leer

Capturar jugada por jugada **no puede ser obligatorio**. Una liga chica, o un
visor que ese día no alcanzó, tienen que poder subir nada más los totales. Pero
si el mismo número se puede escribir en dos lugares, hay dos verdades — y eso
es lo que este proyecto no hace.

La salida es la que la regla 4 ya usa para la fase de un partido (`phase_id` o
`week_label`): **el dato se resuelve al leer, en cascada, y hay un solo ganador
por partido.**

1. ¿Ese partido tiene una sesión buena (`is_authoritative`) con nivel
   `offense` o `full`? El box score **se deriva de sus jugadas**.
2. ¿No la tiene —porque no se capturó, o porque se capturó en nivel
   `scoring`—? Se lee `player_match_stats`, la tabla de 16 contadores que ya
   existe, que pasa a ser la **captura por totales**.

El nivel `scoring` es el caso que obliga a que el paso 1 pregunte por el nivel
y no solo por "¿hay jugadas?": un partido con ocho jugadas de anotación **sí**
tiene jugadas, y derivar de ahí daría un box score falso con cara de
verdadero. Sus jugadas sirven para "quién anotó" y para nada más.

Nunca se mezclan, nunca se suman entre sí, y nadie copia lo derivado dentro de
la otra tabla. Un partido capturado por jugada y otro capturado por totales
conviven en la misma temporada sin que la liga tenga que saberlo: la tabla de
líderes los lee igual.

**Corregir una acreditación derivada** —la liga revisa el video y el
touchdown era del otro— se hace corrigiendo **la jugada**, no el total. Si
alguna vez hace falta forzar un total contra lo que dicen las jugadas, va en
una columna `*_override` **nueva**, nunca sobrescribiendo: regla 4, y el dato
viejo es el respaldo.

**El marcador del partido no cambia de dueño en esta versión.**
`matches.home_score` / `away_score` se siguen capturando a mano con el permiso
`marcadores`, que ya funciona. La suma de `points` de las jugadas es una
**segunda lectura** que el panel puede contrastar para avisar "esto no cuadra",
no un reemplazo. Cambiar de dónde sale el marcador publicado es otro cambio,
con su propia ventana de riesgo, y no tiene por qué viajar con este.

### Quién captura y quién ve

Un permiso nuevo, `estadisticas`, con el mismo reparto que `asistencia`:
`owner`, `admin` y `editor` (visor) de la liga lo traen; el tesorero no. El
equipo no captura, y lee lo suyo por `ver`. Vale igual lo de la sección
anterior: el dueño de la liga ya lo trae, así que el emprendedor que captura él
mismo no necesita otra cuenta ni cambiarse de rol.

El box score **sí es público** —a diferencia de la asistencia—: es el resultado
deportivo, que es justo lo que un torneo publica. Lo que no sale nunca es de
quién es cada dato personal detrás del jugador, que ya está cubierto por la
regla 7.

### Las tres decisiones que quedaban, y cómo se cerraron

Ninguna sigue abierta. Se dejan escritas con su porqué, porque las tres se van
a volver a preguntar.

- ~~Capturar sin internet~~ — **resuelto el 2026-09-20, y es requisito**: ver
  "Capturar sin señal", que además cambió la identidad de una jugada.
- ~~Qué tan fina es la captura mínima~~ — **decidido el 2026-09-20**: ver
  "Qué tan fina es la jugada mínima", arriba.
- ~~Si `player_match_stats` se renombra a los nombres de SportsML~~ —
  **decidido el 2026-09-20: no se renombra.** Se queda como está.

  No compra nada que no se pueda hacer igual de bien el día que haga falta. Lo
  único que ese renombre habilitaría es exportar a un formato estándar, y eso
  se resuelve con una tabla de equivalencias de veinte líneas
  (`pass_yards` → `passes-yards-gross`) escrita **el día que alguien de verdad
  pida esa exportación**, que hoy no ha pasado.

  Lo que sí cuesta es real: son 20 referencias en tres archivos
  (`config/db.js`, `routes/players.js`, `MatchStatsModal.jsx`), es un valor
  guardado, así que va con migración, y por la regla 6 se mueve en los tres
  lados o en ninguno — con la misma ventana de incompatibilidad al desplegar
  que tiene anotada el renombre de `/api/player-billing`.

  Y hay una razón de fondo para no preocuparse: **los nombres de SportsML
  importan en la salida derivada, no en las columnas**. El box score que sale
  de las jugadas se calcula al leer, así que se puede nombrar como se quiera,
  cuando se quiera, sin tocar una sola fila. Ahí es donde se usa el
  vocabulario, y ahí es gratis.

  **Y así quedó.** La tabla de equivalencias de veinte líneas está escrita
  (`EQUIVALENCIAS_SPORTSML`, en `utils/plays.js`) y es lo que las **dos** ramas
  de la cascada usan para salir: el box score se lee igual venga de las jugadas
  o de los totales tecleados. Costó lo que se dijo que costaría, no tocó una
  sola columna y no hubo ventana de incompatibilidad al desplegar. El día que
  alguien pida la exportación a StatCrew, el mapeo ya existe.

### La pantalla, y por qué se ve así

`MatchStatsPage.jsx`, en `/partidos/:matchId/estadisticas`. Se diseñó para **un
pulgar y con el partido enfrente**, que es la única restricción que de verdad
manda aquí: son ciento veinte capturas seguidas, así que un toque de más por
jugada son dos minutos perdidos y la vista en el celular en vez de en el campo.

- **Se escoge por número, no por nombre.** Es lo que el visor tiene a la vista
  en la espalda del jugador, y una rejilla de números cabe entera en la
  pantalla mientras que una lista de nombres obliga a buscar. El nombre va en
  el `title` para quien quiera confirmarlo.
- **El down derivado va grande y arriba**, porque se lee de reojo entre jugada
  y jugada sin dejar de ver el campo. No se captura: se muestra.
- **El reloj, la posición y de quién es el balón se preguntan una vez por
  serie**, en una franja que solo aparece cuando la serie está vacía. Es la
  decisión que abarata todo lo demás.
- **La defensa vive detrás de un `<details>` y solo en nivel `full`.** Es el
  campo que exige una segunda persona buscando en el montón.
- **El botón de guardar dice QUÉ falta** cuando está deshabilitado, en vez de
  quedarse gris. Sin señal no hay a quién preguntarle, y un botón mudo en la
  cancha es una captura perdida.
- **Las jugadas que todavía no suben se marcan** en la bitácora. No es una
  advertencia —están a salvo en la cola— pero el visor tiene derecho a ver
  cuáles viven nada más en su teléfono.

**La regla del down vive en los dos lados**, y es a propósito:
`frontend/src/utils/plays.js` es una copia de la derivación del backend. No es
descuido ni pereza — la pantalla tiene que poder decir "2º y 6" en una cancha
sin internet, donde no hay a quién preguntarle, y no hay forma de compartir un
módulo entre los dos paquetes. Es el mismo trato que ya tienen `matchScope.js`
y las zonas horarias: en vez de fingir que se comparte, hay una prueba que las
**cruza** (`frontend/tests/unit/plays.test.mjs`) y falla si se separan. Lo que
NO se copió es la acreditación —que una captura es un acarreo, que se parte
entre dos taqueadores—: eso vive una sola vez, en el backend, porque el box
score se lee de allá.

### La cola: aquí las capturas se ACUMULAN, al revés que el pase de lista

Es la diferencia más importante de `offlineQueue.js` y la más fácil de romper.
Un pase de lista es el estado **completo** de un equipo: dos capturas de lo
mismo son la misma y gana la última. Dos capturas de jugadas **no son la misma
cosa** — son la jugada 7 y la jugada 8. Fusionarlas reemplazando convertiría un
partido entero en su última jugada, y **en silencio**.

Así que el pendiente de jugadas se une por `client_play_id`. Eso además hace
que corregir algo que todavía no sube sea nada más volver a capturarlo. Tres
tipos conviven en la misma cola:

| Tipo | Llave | Qué hace |
|---|---|---|
| `plays` | por partido | El lote. **Acumula** |
| `play-edit` | por jugada | Corrige una que YA subió. Gana la última |
| `play-delete` | por jugada | Borra una que YA subió |

Corregir o borrar algo que **todavía está en el lote** no encola nada: se
edita o se saca del lote, porque del otro lado nunca existió. Sacarla necesitó
un `reemplazar()` aparte de `encolar()` — con la fusión, un lote recortado se
volvería a unir con el anterior y la jugada regresaría sin que nada fallara.

### Endpoints — `routes/plays.js` (`/api/plays`)

| Método | Ruta | Quién |
|---|---|---|
| `GET` | `/matches/:matchId/box-score` | **Cualquiera, sin cuenta** |
| `GET` | `/matches/:matchId/capture` | `estadisticas` |
| `POST` | `/matches/:matchId/sessions` | `estadisticas` |
| `PUT` | `/matches/:matchId/sessions/:sessionId/authoritative` | `estadisticas` |
| `POST` | `/matches/:matchId/plays` | `estadisticas` |
| `PUT` · `DELETE` | `/matches/:matchId/plays/:clientPlayId` | `estadisticas` |

Cuatro cosas que se decidieron escribiéndolos:

- **El lote hace `ON CONFLICT DO NOTHING`, no `DO UPDATE`**, y la diferencia
  importa más de lo que parece. Reenviar tiene que ser gratis, pero *pisar* no:
  una jugada que la liga ya corrigió —revisó el video y el touchdown era del
  otro— no puede volver a quedar como estaba porque el teléfono del visor
  recuperó la señal tres horas tarde. Corregir tiene su propio endpoint.
- **Un lote es todo o nada.** Una jugada mal armada rompe la petición entera en
  vez de guardar las buenas: media captura subida es peor que ninguna, porque
  nadie sabe cuál mitad falta. El duplicado es la única excepción —el mismo
  `client_play_id` dos veces gana el último—, porque eso lo produce la cola de
  verdad y ya sabemos resolverlo.
- **Un lote sin sesión no se rechaza: se le abre una.** Es la contraparte de
  "un partido, un capturista": quien capturó sin haber reclamado sube igual, en
  su propia sesión, que nace **no autoritativa** si ya había otra. Nunca se
  descarta lo capturado, y quién tenía razón lo decide una persona.
- **El panel devuelve las jugadas de TODAS las sesiones**, no solo de la buena.
  Es lo que permite que alguien compare las dos y elija; enseñar solo la
  ganadora haría invisible el dato que sigue existiendo.

### Antes de darlo por hecho

El backend se corrió de punta a punta contra una rama de Neon el 2026-09-20
(`backend/tests/plays.e2e.mjs`, 68 comprobaciones en verde). Lo que esa suite
cubre y una prueba unitaria no podía:

- ✅ **Reenviar el mismo lote es gratis**: seis jugadas subidas dos veces dejan
  seis filas y once participantes, no doce y veintidós. Es la promesa entera
  del modo sin señal y vive en un `ON CONFLICT` de Postgres.
- ✅ **La cascada entrega un solo box score**, y las dos ramas salen con las
  mismas llaves. Un partido en `scoring` **no** deriva, aunque tenga jugadas.
- ✅ **Tomar el control no borra nada**: las jugadas del primer capturista
  siguen ahí y el panel muestra las dos sesiones.
- ✅ **Las reglas de la NCAA sobreviven el viaje por la base**, no solo dentro
  de la función pura: tres intentos de pase y no cuatro, la captura como
  acarreo de −8, y media captura para cada taqueador.

Y con el **modo avión prendido**, contra la compilación real (`vite preview`,
no el servidor de desarrollo — es la única forma de probar el cache-first
sobre `/assets/`):

- ✅ Preparar el partido con señal, apagarla, capturar dos jugadas, **recargar
  la página**, capturar más, volver a encender y comprobar que subió todo **una
  sola vez**. En la base: 0 duplicadas y 0 participantes huérfanos.
- ✅ El down se derivó **sin señal**: 1º y 10 desde la 60, ganó 5 → 2º y 5,
  ganó 3 → 3º y 2. Es la copia del frontend haciendo exactamente su trabajo.
- ✅ Recargar sin señal **no devolvió la pantalla al estado preparado**: las dos
  jugadas de la cola siguieron ahí y siguieron marcadas como pendientes. Era el
  bug número 3 del pase de lista y aquí no se repitió, porque la unión con la
  cola se puso desde el principio.
- ✅ El aviso del navegador al salir con capturas pendientes se disparó.

### Tres bugs, y dónde apareció cada uno

**1. El `PUT` de corrección dejaba la jugada sin participantes** — lo encontró
la suite de punta a punta. Borraba sus participantes y los volvía a insertar
**en la misma sentencia**; los CTE de Postgres comparten un snapshot, así que
el `INSERT` veía las filas viejas todavía presentes, su `ON CONFLICT` no
insertaba nada, y después el `DELETE` se las llevaba. No fallaba, no avisaba y
el 200 se veía igual de bien. Ahora los dos CTE que escriben tocan la misma
tabla pero nunca la misma fila —el `DELETE` se queda con quien ya no viene, el
`INSERT` con quien sí—, que es exactamente el patrón que el `PUT` del pase de
lista ya tenía escrito y que aquí no se había seguido.

**2. `Number(null)` es 0, y aquí eso miente** — lo encontró capturar una
jugada de verdad en el navegador. El down, la distancia y la yarda son
opcionales y llegan vacíos casi siempre. Pasarlos por `Number()` sin filtrar
convertía "no se capturó" en **yarda 0** —la línea de gol— y en "0 por ganar",
así que la pantalla anunciaba **"1º y gol" con la jugada capturada en media
cancha**. Es la misma familia que el `yards_gained NOT NULL` de arriba: un
hueco que se vuelve un número con cara de verdadero. Ahora un campo opcional
vacío se queda vacío, y un cero que alguien **sí** capturó se respeta — la
yarda 0 existe y "4º y 0" también.

**3. "Down desconocido — algo no se capturó" en una serie recién abierta** —
también del navegador. No saber el down todavía y haberlo perdido son cosas
distintas: una serie vacía no sabe nada porque nadie ha capturado nada, y eso
es normal. Gritarle una falsa alarma en amarillo al visor que acaba de abrir la
pantalla es exactamente el momento en que menos sirve. Ahora la serie vacía
dice "Empieza la serie" y el aviso se guarda para cuando la cadena de verdad se
rompe, que es cuando sí pide que alguien corrija.

**Lo que NO está verificado**, dicho de frente:

- **Un teléfono de verdad.** Se probó con Chromium y el modo offline de
  Playwright, que apaga la red pero no mata la pestaña, no se queda sin batería
  y no tiene al administrador de memoria de Android decidiendo cerrar la app a
  media captura. Es la misma limitación que ya tenía el pase de lista.
- **Un partido completo capturado por una persona.** Ciento veinte jugadas
  seguidas, con el partido enfrente y sin poder pedir repetición, es donde se
  va a ver si la jugada mínima es de verdad mínima. Ningún endpoint ni ninguna
  pantalla abierta en el escritorio contesta eso: lo contesta un visor en una
  cancha, y todavía no ha pasado.

## Capturar sin señal

**Decidido y construido el 2026-09-20.** Es requisito, no mejora. Muchas
canchas no tienen señal, y una captura que exige conexión por jugada
sencillamente no se usa: se vuelve al papel en el segundo partido. Gobierna las
dos pantallas del visor —el pase de lista y la captura por jugada— así que se
diseña una vez y sirve para las dos.

**La capa está construida y tiene sus dos consumidores**: el pase de lista y la
captura por jugada. Los tres apartados que colgaban de la segunda —la llave de
una jugada, el orden por `sequence` y la sesión de captura— también están
construidos y verificados. La verificación está en `docs/CHANGELOG.md`.

Que la segunda pantalla entrara poniendo **tres despachadores y nada más** es
la prueba de que la capa quedó en el lugar correcto: la persistencia, el
backoff, el contador y el aviso al salir ya funcionaban. Lo único que sí hubo
que cambiar fue la regla de fusión, porque las jugadas se **acumulan** donde el
pase de lista se reemplaza — el porqué está en "Estadísticas por jugada".

### Lo que había, y lo que se construyó

Lo que había el 2026-09-20 por la mañana, y por qué no alcanzaba:

- `public/sw.js` existía **pero solo hacía push**: sin manejador `fetch`, sin
  cachear nada.
- Se registraba dentro de `SubscribeButton.jsx`, o sea **solo si alguien se
  suscribió a las notificaciones**. Un visor que nunca tocó ese botón no tenía
  service worker, y por lo tanto no tenía nada sin señal.
- No había `manifest.json`: la app no se instalaba en el teléfono.
- El token dura **7 días** (`middleware/auth.js`), así que una jornada completa
  sin señal no lo tumba. Eso ya estaba resuelto.

Lo que ahora corre:

| Pieza | Dónde |
|---|---|
| El service worker cachea la app y **se registra al arrancar** | `public/sw.js` · `utils/serviceWorker.js` |
| La capa local en **IndexedDB**: el partido preparado y la cola | `utils/offlineDb.js` |
| La **regla** de la cola: qué se fusiona, cuándo se reintenta | `utils/offlineQueue.js` (pura, la cubre el CI) |
| La cola viva: reintenta sola, sobrevive a recargar y sube al volver la señal | `utils/offlineOutbox.js` |
| `manifest.webmanifest`, para instalarla | `public/` |

**El service worker nunca cachea `/api/`**, y eso es una decisión y no un olvido:
una respuesta de API servida desde el cache HTTP se ve idéntica a una recién
traída. Los datos van a IndexedDB, donde la pantalla sabe **de cuándo son** y lo
dice — que es la diferencia entre pasar lista contra un roster de hace tres
semanas sin enterarse, y saber que eso es lo que estás haciendo.

**El `PUT` idempotente ya estaba**: nació así con el pase de lista, porque recibe
la lista completa. Subir el mismo lote dos veces deja exactamente el mismo
estado, así que la cola puede reintentar sin pensarlo.

### Se prepara con señal, se captura sin ella

Una descarga **explícita y previa**, no un cache oportunista. El visor abre el
partido con señal —en su casa, en el estacionamiento— y presiona **Preparar
partido**: eso baja el partido, los dos rosters vigentes a esa fecha y la
pantalla misma.

> **Por qué explícita.** El cache oportunista —"se guarda lo que hayas
> visitado"— falla exactamente cuando importa: el visor que nunca abrió esa
> pantalla con señal llega a la cancha sin nada, y ahí ya no hay forma de
> avisarle. Una descarga que se pide se puede verificar **antes** de salir, y
> la pantalla puede decir "listo, este partido ya se captura sin señal". La
> diferencia entre las dos es quién se entera del problema y cuándo.

### La llave de una jugada la pone el cliente — construido

`UNIQUE(match_id, sequence)`, como estaba escrito en "Estadísticas por jugada",
**no sobrevive al modo sin señal**: `sequence` la asigna el dispositivo, y dos
dispositivos empiezan los dos en 1. La identidad se mueve a una llave que nace
en el celular, junto con la jugada:

| Campo | Qué es |
|---|---|
| `client_play_id` | Un UUID (`crypto.randomUUID()`) generado al capturar la jugada, offline |
| `UNIQUE(match_id, client_play_id)` | La identidad real. El envío hace `ON CONFLICT DO NOTHING` |
| `sequence` | Se queda, pero como **orden de captura**, ya no como identidad |

**Este proyecto ya usa ese patrón**: `auto_cycle_key` en la mensualidad del
club, que hace que generar el mismo ciclo dos veces no cobre dos veces. Aquí
compra lo mismo: subir el mismo lote dos veces es gratis, que es justo lo que
pasa cuando el internet del campo va y viene.

### El orden sale de `sequence`, nunca de `created_at` — construido

El `created_at` de una jugada capturada sin señal es **el momento en que se
subió**, no el momento en que pasó: un partido entero puede llegar con el mismo
segundo. El orden sale de `sequence` dentro de su sesión de captura.

Queda escrito porque ordenar por fecha es lo primero que alguien va a intentar,
el resultado se ve razonable en un partido capturado en vivo, y el partido
capturado sin señal sale revuelto sin que nada falle.

### Un partido, un capturista a la vez — construido

Una **sesión de captura** —`match_capture_sessions`, la tabla que también
carga el nivel— reclama el partido. Un segundo dispositivo ve "Fulano está
capturando este partido desde las 10:32 — ¿tomar el control?", y tomarlo es
explícito y queda registrado con quién y cuándo.

Sin eso, dos visores capturando el mismo partido producen dos medias listas que
**nadie puede volver a unir**: no hay forma automática de saber si dos jugadas
parecidas son la misma capturada dos veces o dos jugadas distintas.

Y la contraparte, que importa más: **nunca se descarta lo capturado**. Si
alguien capturó sin haber reclamado el partido, sus jugadas suben igual, en su
propia sesión, y el panel muestra las dos para que **una persona** elija cuál
es la buena — que es lo único que hace `is_authoritative`. La
plataforma no adivina cuál era la buena — es la regla 10 otra vez, y la misma
idea de la regla 4 de que un dato mal capturado se corrige y no se borra.

### El riesgo que no se puede tapar

Mientras las jugadas viven solo en el celular del visor, viven **en un solo
lugar**: si borra los datos del navegador o pierde el teléfono, se perdieron.
Es el mismo riesgo que tiene la hoja de papel que esto sustituye —no uno
nuevo— pero la pantalla tiene que decirlo en voz alta en vez de dejarlo
implícito:

- un contador visible de **"47 jugadas sin subir"**, siempre a la vista;
- un aviso al intentar salir con jugadas pendientes;
- y el envío en cuanto vuelva la señal, sin que nadie tenga que acordarse.

Lo que convierte esto en una pérdida no es que el dato viva en el teléfono, es
que nadie se entere de que todavía vive ahí.

### Lo que se construyó, en orden — y lo que queda

1. ✅ **El service worker cachea la aplicación y se registra al arrancar**, no
   dentro del botón de notificaciones.
2. ✅ **La capa local en IndexedDB**: el partido preparado, los rosters y la
   cola de lo capturado. No fue dependencia nueva — es API del navegador.
   `localStorage` no servía: es chico, es síncrono y ya carga el token.
3. ✅ **La cola de envío**, que reintenta sola y sobrevive a recargar la página
   y a volver a entrar.
4. ✅ **Los dos endpoints idempotentes**: el `PUT` de asistencia ya nacía
   idempotente porque recibe la lista completa. El lote de jugadas con
   `client_play_id` se construyó el 2026-09-20 y la suite comprueba que
   reenviarlo no duplique nada.
5. ✅ **`manifest.webmanifest`** para que se pueda instalar.

### Tres cosas que solo se vieron corriéndolo

Las tres se encontraron con el modo avión prendido, ninguna leyendo el código, y
las tres dejaban la pantalla inservible justo en la cancha. Quedan escritas
porque la captura por jugada va a pasar por el mismo camino:

1. **`Vary` hacía que el cache no encontrara lo que él mismo guardó.** Vite emite
   sus scripts con `crossorigin`, el navegador los pide con cabecera `Origin` y
   el servidor contesta `Vary: Origin`. El service worker los había guardado sin
   `Origin` (desde `cache.add`), y `caches.match` respeta `Vary`: la navegación
   salía del cache, el JavaScript no, y la app abría **en blanco**. Se busca con
   `{ ignoreVary: true }`, que aquí no pierde nada — son archivos del mismo
   origen y con hash en el nombre.
2. **Los chunks de `lazy()` no están en el DOM.** La lista de lo que hay que
   guardar se sacaba de `script[src]`, que ve el script principal pero **no** lo
   que se cargó con `import()` — y cada página de esta app es justo eso
   (`App.jsx` las carga con `lazy()`). El visor preparaba el partido, llegaba a
   la cancha, y ahí la app arrancaba y se moría pidiendo un chunk que nadie
   guardó. Ahora la lista sale de `performance.getEntriesByType('resource')`,
   que sí lista todo lo que de verdad se descargó.
3. **Recargar sin señal devolvía la pantalla al estado preparado.** La captura
   seguía a salvo en la cola —no se perdía nada— pero el visor la veía
   desaparecer y volvía a marcar sobre una base vieja. Lo que está en la cola
   manda sobre lo que trajo el servidor, hasta que suba.

### Y un bug viejo que solo ahora tenía consecuencias

**Quedarse sin señal cerraba la sesión.** `AuthContext` borraba el token ante
**cualquier** fallo de `/auth/me`, incluido "no llegué al servidor". El visor
abría la app en una cancha sin internet y la app lo sacaba — justo donde más
falta le hacía estar dentro.

Ahora `api/client.js` marca el error (`err.offline`) para distinguir "el
servidor dijo que no" de "no llegué al servidor", y la sesión solo se cierra con
lo primero. La última respuesta de `/auth/me` se guarda para poder abrir sin
señal sabiendo quién eres; el token dura 7 días, así que una jornada entera no
lo tumba.

### Antes de darlo por hecho

Esto no se puede verificar leyendo el código ni con una prueba unitaria, y es
justo la clase de cosa que se rompe en la cancha y no en el escritorio:

- ✅ **Con el modo avión prendido, de punta a punta**: preparar el partido con
  señal, apagarla, pasar lista, **recargar la página**, marcar más, volver a
  encender la señal y comprobar que subió todo, una sola vez. Corrido el
  2026-09-20 contra la compilación real (`vite preview`, no el servidor de
  desarrollo — es la única forma de probar el cache-first sobre `/assets/`,
  porque en `dev` esos archivos no existen). Ahí salieron las tres cosas de
  arriba.
- ✅ **El mismo lote enviado dos veces**: el `PUT` del pase de lista se probó
  reenviando la misma lista y deja el mismo estado, sin filas de más.
- ✅ **Dos dispositivos sobre el mismo partido**: cubierto por `plays.e2e.mjs`
  el 2026-09-20 — el segundo capturista recibe 409, tomar el control queda
  registrado y las jugadas del primero siguen ahí. Para el pase de lista no
  aplica: el `PUT` manda la lista completa y gana el último, que es el
  comportamiento que se quiere ahí.

**Lo que este montaje NO prueba**, dicho de frente: un teléfono de verdad. Se
probó con Chromium y el modo offline de Playwright, que apaga la red pero no
mata la pestaña, no se queda sin batería y no tiene el administrador de memoria
de Android decidiendo cerrar la app a media captura. Eso es exactamente lo que
`manifest.webmanifest` existe para mitigar, y no está verificado en hardware.

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

- ~~El badge "✓ Verificado" solo se ve hoy en el panel del propio equipo, no en
  su ficha pública~~ — **ya no aplica**: `TeamCard` muestra la palomita (con
  `title`/`aria-label` que le dan el significado, porque la tarjeta es chica y
  va en cuadrícula) y `TeamInfoPanel` la pastilla completa "✓ Verificado".
- ~~No existe flujo de traspaso de dueño para un equipo independiente~~ —
  **resuelto a medias el 2026-09-20**. Con el modelo de roles construido hay
  **varios dueños a la vez**: quien registra el equipo puede invitar a un
  segundo dueño desde el principio (la invitación con rol `owner` pide el
  permiso `duenos`, que solo un dueño tiene), y perder una cuenta deja de ser
  fatal. Lo que sigue sin existir es el **rescate**: si el único dueño ya
  perdió acceso, no hay un flujo para reclamar ese equipo. La salida existe
  pero es de dos pasos y no está en ninguna pantalla: un administrador de la
  plataforma invita a la persona como `admin` —a `owner` no puede, ese permiso
  es solo de un dueño— y después le cede el puesto con `transfer-owner`, que
  sí lo deja pasar por encima de `duenos`.

## Transmisiones — un medio se suma a un partido

El único caso **ya construido** de una organización colaborando en el contenido
de otra, que es justo el punto 2 de "Roadmap — en construcción". Con una
diferencia que conviene tener clara: aquí el medio **se autoasigna**; la liga no
le da permiso, se entera después.

### Modelo

`match_broadcasts` — una fila por (partido, medio) con su link. La pareja es
única, así que volver a mandar el mismo par **edita la URL** en vez de duplicar.

Para sumarse, la organización tiene que ser `type = 'media'` **y** estar
verificada (`is_verified`). La decisión de fondo está escrita en el código y
conviene no revertirla por descuido: **la verificación certifica quién es el
medio, no que tenga derechos sobre ese partido.** Es identidad, no licencia.

### El aviso a la liga sale una sola vez

Cuando un medio se suma por primera vez, a la bandeja de la liga le llega un
`broadcast_added` (in-app, sin push). **Editar el link después no vuelve a
avisar** — si no, cada corrección de una URL sería un aviso nuevo y la bandeja
se volvería inservible.

La liga se entera, pero no aprueba: el medio ya quedó puesto.

### Endpoints — `routes/broadcasts.js` (`/api/broadcasts`)

| Método | Ruta | Quién |
|---|---|---|
| GET | `/match/:matchId` | **Público** — quién transmite este partido |
| GET | `/organization/:organizationId` | El medio — qué está transmitiendo, para su panel |
| POST | `/` | El medio — se suma a un partido (o edita su link) |
| DELETE | `/:id` | El medio — se quita |

El `GET` público va **sin sesión** a propósito: la ficha de un partido tiene que
poder decir quién lo transmite sin pedirle cuenta a nadie, igual que la tarjeta
del jugador.

### Frontend

`MatchBroadcasters.jsx` (quién transmite, para cualquiera) y
`MediaBroadcastControl.jsx` (el control para sumarse o quitarse, si administras
ese medio), los dos dentro de `MatchPage`.

## Tiendas y bot de WhatsApp

Una organización de tipo tienda carga su inventario, y un bot atiende por
WhatsApp a quien le escriba: contesta precios, tallas y existencias leyendo ese
inventario, con Claude. Es **el único producto de pago de la plataforma que
cobra por sí mismo** — de hecho es lo único que hace el plan `pro`.

> **Estado: construido, no conectado (septiembre 2026).** Lo que falta son
> credenciales, no código: el número de WhatsApp Business
> (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`) y la llave con saldo de
> Anthropic (`ANTHROPIC_API_KEY`). Mientras no estén, el webhook **nunca se
> ejecuta** y el inventario funciona solo como catálogo público.

### Inventario — dos listados, y por qué

`products` cuelga de una organización, y hay dos formas de leerlo:

- **Público** (`GET /products/organization/:id`) — filtra `is_active` **y**
  `show_on_platform`.
- **De gestión** (`.../manage`) — trae todo, incluido lo inactivo.

`show_on_platform` es la tienda diciendo *"esto sí es del nicho y quiero que se
vea en CFBAMX"*: una tienda deportiva vende mucho que no es americano.

**El bot NO filtra por `show_on_platform`, a propósito.** Atiende a cualquier
cliente que le escriba a ese número, sea o no del nicho, así que necesita ver
todo lo que la tienda vende (`is_active`). Filtrarlo ahí haría que el bot negara
productos que la tienda sí tiene enfrente.

### El bot

Un solo webhook para **todas** las tiendas: Meta manda en
`value.metadata.phone_number_id` qué número recibió el mensaje, y de ahí sale la
organización (`organizations.whatsapp_phone_number_id`). Así funciona la Cloud
API — no hay una URL de webhook por tienda.

- **Claude Haiku 4.5**, respuestas de 2 a 4 líneas, en español.
- El inventario se le pasa como **texto plano**, no JSON crudo — para que lo lea
  como lo leería un vendedor.
- Instrucción explícita de **no inventar precios ni existencias**, y de decirlo
  cuando no tenga el dato.
- `bot_messages` guarda el historial por (tienda, número del cliente); se le
  pasan los **10 últimos turnos** para que recuerde el mismo hilo.
- Solo mensajes de texto. Audio, imagen y los avisos de *delivered/read*
  responden 200 y se ignoran.
- El webhook responde 200 rápido pase lo que pase: si Meta no lo recibe,
  reintenta el mismo mensaje y el cliente recibiría respuestas duplicadas.
- Si falla la llamada a Claude, contesta "en un momento te atendemos" en vez de
  dejar al cliente sin nada.

**El cobro es el interruptor.** Si la organización no tiene `plan = 'pro'`
vigente, el bot **no contesta y se queda callado** — sin mensaje automático, a
propósito, para no meterle al cliente final un aviso interno de facturación. Hoy
el plan lo activa un admin a mano desde `/admin` (`PUT /organizations/:id/plan`)
después de un pago fuera de la plataforma; automatizar eso es la Fase 2 del
roadmap de negocio.

### Dos cosas de `bot_messages`

**La tabla faltaba.** `bot.js` se escribió asumiéndola y nunca se creó en
`db.js`. No se había notado porque el bot no está conectado, pero el día que lo
estuviera el `SELECT` habría tronado con *relation "bot_messages" does not
exist*, el webhook no habría respondido 200 y Meta habría reintentado el mismo
mensaje en ciclo — con 500 en Sentry sin relación obvia con la causa. Se agregó
el 2026-09-17.

**Guarda datos personales de terceros.** Ahí quedan el teléfono y la
conversación completa de **clientes de la tienda**: gente que no tiene cuenta en
la plataforma y que nunca aceptó nada nuestro. Además no hay borrado por
antigüedad, así que la tabla crece sin límite. Qué se guarda y por cuánto tiempo
tienen que estar cubiertos en el Aviso de Privacidad **antes** de conectar el
bot.

### Endpoints — `routes/products.js` y `routes/bot.js`

| Método | Ruta | Quién |
|---|---|---|
| GET | `/api/products/organization/:id` | **Público** — solo activo y del nicho |
| GET | `/api/products/organization/:id/manage` | La tienda — todo su inventario |
| POST | `/api/products/organization/:id` | La tienda — alta |
| PUT DELETE | `/api/products/:id` | La tienda — edita o borra |
| GET | `/api/bot/webhook` | **Meta** — verificación del webhook, una sola vez |
| POST | `/api/bot/webhook` | **Meta** — mensaje entrante |

### Pendiente

- Conseguir el número de WhatsApp Business y cargar la cuenta de Anthropic — es
  lo único que separa al bot de funcionar.
- Borrado por antigüedad de `bot_messages`.
- Cubrir el bot en el Aviso de Privacidad (ver "Pendientes abiertos").
- Checkout self-serve que reemplace la activación manual del plan (Fase 2 del
  roadmap de negocio).

## Seguridad — decisiones ya tomadas

- **CORS con whitelist**: solo los orígenes listados en `ALLOWED_ORIGINS` pueden llamar a la API desde un navegador. En local, `localhost:5173` siempre está permitido.
- **JWT_SECRET obligatorio**: el servidor no arranca si falta esta variable (antes tenía un valor por defecto inseguro escrito en el código — ya no).
- **Rate limiting en login/registro**: máximo 20 intentos cada 15 minutos por IP (`middleware/rateLimit.js`), para frenar fuerza bruta de contraseñas.
- **`xlsx` (SheetJS) instalado desde `cdn.sheetjs.com`, no desde el registro de npm — en backend y frontend**: la versión publicada en npm tiene una vulnerabilidad alta (prototype pollution / ReDoS) sin parche ahí; SheetJS solo publica la versión corregida en su propio CDN. Se usa exactamente igual (mismo nombre, misma API) — solo cambia de dónde se instala.
- El backend corre detrás del proxy de Render, por eso `server.js` tiene `app.set('trust proxy', 1)` — necesario para que el rate limiting identifique bien la IP de cada visitante.
- **Candado (advisory lock) en las migraciones de `db.js`**: si algún día corren varias instancias del servidor a la vez, la segunda espera a que la primera termine de migrar el esquema, en vez de correr las mismas instrucciones al mismo tiempo.
- **`npm run dev` no arranca contra producción (2026-09-19)**: la regla 1 de `CLAUDE.md` dejó de ser un párrafo y es un candado en `config/db.js`. Tres cosas que vale la pena saber antes de tocarlo:
  - **Se dispara por evidencia positiva de arranque local** (`npm_lifecycle_event === 'dev'` o `NODE_ENV=development` a mano), nunca por *ausencia* de `NODE_ENV`. Render corre `npm start` y no hay `render.yaml` en el repo que garantice que define `NODE_ENV`; un candado que se disparara "cuando no dice production" tumbaría la API real el día que Render cambiara ese default.
  - **El host de producción no está en el código** porque el repositorio es público: sale de `PROD_DATABASE_HOST`, que vive en el `.env`. Sin esa variable no hay candado, y el backend lo avisa fuerte en cada arranque en vez de callarse.
  - **La salida de emergencia es `ALLOW_PROD_DB` con la fecha de hoy**, no un `1`: `$env:ALLOW_PROD_DB="2026-09-19"; npm run dev`. Un `1` olvidado en el `.env` dejaría el candado muerto para siempre; una fecha caduca sola.

  **Lo que no cubre, a propósito**: `npm start` en local y los scripts de `backend/scripts/`, que usan `pg` directo por la regla 3 y simulan por default. Cubre el accidente real, que es `npm run dev` — y de paso el de la regla 2, porque un segundo backend contra producción ahora muere antes de correr `initSchema()`.

### Vulnerabilidades de `npm audit` — evaluadas y aceptadas conscientemente

Estas dos siguen apareciendo en `npm audit` del frontend. No es que se nos olvidó, ya se revisaron y no aplican a como está construido este proyecto hoy:

- **`esbuild`/`vite`** (`GHSA-67mh-4wv8-2f99`): permitiría a un sitio malicioso leer respuestas del servidor de desarrollo local. Solo afecta mientras `npm run dev` está corriendo en tu máquina — no afecta producción. Arreglarlo requiere saltar a `vite@8` (cambio mayor, rompe cosas).
- **`react-router`** (`GHSA-wrjc-x8rr-h8h6`, `GHSA-337j-9hxr-rhxg`): open redirect e inyección en hidratación SSR. Ambas fallas requieren el modo "Data/Framework" de React Router (`createBrowserRouter` + `RouterProvider`) o renderizado del lado del servidor. Este proyecto usa `<BrowserRouter>` (modo declarativo, en `main.jsx`) — no tiene ese código, así que no está expuesto.

## Limitaciones aceptadas

Decisiones que dejan algo sin resolver **a propósito**, con su razón. No son
pendientes: esos viven en `docs/PENDIENTES.md`. Los cuatro que antes se
anotaban aquí se mudaron allá: Render y Neon gratuitos (`PD-03`), invitaciones
que no caducan (`PD-08`), el secreto de Cloudinary (`PD-21`) y los archivos que
concentran demasiado (`PD-28`, con los tamaños medidos otra vez).

- No hay ninguna capa de caché todavía; cada visita al calendario consulta Postgres directo.
- El pool de conexiones de Postgres (`config/db.js`) ya no usa los valores de
  fábrica de `pg`: `max` 10 (configurable con `PG_POOL_MAX`),
  `connectionTimeoutMillis` 10s — el default era esperar para siempre, que con
  Neon durmiéndose dejaba peticiones colgadas sin respuesta — e
  `idleTimeoutMillis` 30s. Se le agregó también un manejador `pool.on('error')`
  que faltaba: un error en una conexión **ociosa** (justo lo que pasa cuando
  Neon corta del otro lado al dormirse) se emitía sin escucha y eso tiraba el
  proceso entero de Node.
- JWT guardado en `localStorage` (no en cookie `httpOnly`): trade-off aceptado por simplicidad de configuración entre dominios distintos (Vercel + Render).

## Roadmap — en construcción

El modelo de "varias organizaciones por cuenta" ya está en marcha (ver `docs/CHANGELOG.md`). Lo que falta para completarlo:

1. ~~Agregar los tipos Equipo independiente, Empresa/Marca y Medio de comunicación a "Registrar Organización"~~ — **hecho**: los cuatro tipos ya se registran (Equipo independiente desde `/registrar-equipo`, ver sección "Equipos independientes"; Medio/Tienda/Clínica/Marca desde `/registrar-organizacion`).
2. Más adelante: permisos de colaboración entre organizaciones — por ejemplo, que un Medio con permiso pueda actualizar directamente el link de transmisión de un partido registrado por una Liga, sin pasar por su dueño original.

## Roadmap de negocio — operar sin intervención constante (actualizado 2026-09-14)

Objetivo: que la plataforma genere flujo de cobro real sin que cada venta dependa de una acción manual del dueño. Progreso por fase:

**Fase 0 — Cerrar lo que ya estaba a medias**
- ✅ Payout de Travelpayouts a PayPal configurado.
- ⏳ Aprobación de Booking.com: sin acción de código, solo esperar a que crezca el tráfico y volver a pedir revisión (ver "Pendientes abiertos" arriba).

**Fase 1 — Fundación de confiabilidad**
- ✅ Páginas legales (`/terminos`, `/privacidad`) escritas y **publicadas**: los cuatro datos de `frontend/src/config/legal.js` se llenaron el 2026-09-19, así que `/terminos` volvió a existir y el Aviso de Privacidad quedó completo.
- ✅ Monitoreo de errores (Sentry) en frontend y backend, verificado en producción.
- ✅ CI en GitHub Actions (pruebas unitarias + build + chequeo de sintaxis en cada push).
- ⏳ Pendiente: subir Render y Neon a un plan de pago. Hoy el servicio se "duerme" y tarda ~40 s en despertar (`PD-03`).
- ✅ Respaldo propio de producción (2026-09-23): ramas semanales en Neon y un archivo cada 4 semanas, restaurado de prueba. Ver "Respaldos".
- ⏳ Pendiente: rotar `CLOUDINARY_API_SECRET` (`PD-21`).

**Fase 2 — Automatizar el cobro (el bloqueador real de fondo)**
No iniciado. Hoy `PUT /organizations/:id/plan` (`admin.js`) requiere que el admin active el plan "pro" a mano después de un pago fuera de la plataforma (transferencia/PayPal). Lo único que ese plan **hace** hoy es prender el bot de WhatsApp de una tienda — ver "Tiendas y bot de WhatsApp". Reemplazar por checkout self-serve + webhook (Conekta o Stripe — Conekta tiene ventaja en México por soportar OXXO/SPEI) que actualice `plan`/`plan_expires_at` solo, con downgrade automático si el pago falla. Después, evaluar extender el mismo mecanismo a `billing.js`: cobro en línea liga→equipo, y eventualmente equipo→jugador (para que los equipos cobren a sus propios jugadores).

**Fase 3 — Red de seguridad técnica**
En marcha. **Hecho**: las pruebas unitarias corren solas en cada push, con
`node --test` (los números al día están en `docs/ESTADO.md`). Las **cinco**
suites de punta a punta (`backend/tests/*.e2e.mjs`) se corren a mano contra una
rama de Neon y **no** están en el CI, porque necesitan Postgres vivo.

Lo que falta de esta fase:
- **Pruebas de lo que toca la base de datos** — todo `routes/` empieza
  consultando Postgres, así que cubrirlo necesita levantar una base de prueba
  en el CI (un servicio de Postgres en el workflow, o Neon con una rama
  efímera por corrida). Es el paso grande que queda, y donde entraría auth.
- **Monitoreo de uptime y alertas** — hoy Sentry avisa de errores, pero nadie
  avisa si el servicio simplemente no responde (`PD-12`).
- **Que el CI bloquee el deploy** si algo falla: hoy Render y Vercel despliegan
  sin esperar el resultado del CI. Esto no es código, es configuración en
  Render/Vercel (y, del lado de GitHub, un required status check sobre los
  jobs `frontend-build` y `backend-syntax-check`) (`PD-11`).

**Fase 4 — Automatizar el ciclo de vida del cliente**
No iniciado, salvo el rechazo de solicitud de publicación (ya hecho, ver `docs/CHANGELOG.md`). Falta: onboarding automático por correo para organizaciones nuevas — `RESEND_API_KEY`/`EMAIL_FROM` ya están configurados para los códigos de verificación, así que no hace falta cuenta nueva, solo construir los correos. Los tipos de organización pendientes ya se habilitaron (los cuatro se registran).

**Fase 5 — Crecimiento sin esfuerzo manual**
No iniciado. Página de precios pública para el plan "pro", analítica de conversión (hoy `track.js` solo cuenta vistas/clicks de sponsors), SEO/contenido más allá del sitemap actual.

## Roadmap de producto — herramientas para ligas y equipos

> **De esta lista ya están construidos**: Cobranza liga→equipo, cuotas del club
> equipo→jugador con su padrón propio, y la conciliación (quien paga reporta con
> comprobante, quien cobra confirma) en los dos libros. Lo demás sigue siendo
> estrategia, no compromiso de calendario.
>
> Nota de procedencia: esta sección viene de una sesión de planeación con Claude
> (8–14 sep 2026) sobre qué le da a CFBAMX valor real para ligas y equipos —
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
- ~~Tabla de posiciones automática (PG-PP-PE, desempates configurables)~~ — **hecho y verificado contra datos reales (septiembre 2026)**, ver "Tabla de posiciones y modelo de competencia".
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
- Dominio propio sin marca CFBAMX; tienda oficial de la liga (`products.js`/bot de WhatsApp ya existen para tiendas tipo `store` —ver "Tiendas y bot de WhatsApp"—, falta adaptarlo a mercancía de liga); módulo de disciplina (expulsión → suspensión automática); credenciales físicas impresas; seguro de jugadores vía aseguradora aliada.

**Para equipos**
- ~~**Cobro de cuotas a jugadores** (equipo → jugador)~~ — **hecho**, y resultó ser gratuito y no de pago: es lo que engancha al club (su historial de cobranza vive en la plataforma y no se va con el tesorero que sale cada año). Ver sección "Cuotas del club" más arriba. Lo monetizable de encima sigue pendiente: pasarela con comisión, y los servicios alrededor (uniformes, seguro, viajes).
- Video/film del partido con recorte de jugadas (Hudl más barato).
- Tienda del equipo (uniformes, fan gear); scouting de rivales de la misma liga; vitrina de reclutamiento para universidades/LFA.

### Orden sugerido (revisar contra lo ya avanzado)

Orden original propuesto: 1) tabla de posiciones + generador de calendario, 2) roster + credencial QR, 3) inscripciones/pagos en línea, 4) estadísticas por jugador, 5) patrocinadores self-serve. **En la práctica se adelantó Cobranza (liga→equipo) antes que el resto** porque resolvía el dolor más agudo hoy (cobranza semanal por WhatsApp) — orden válido, esto es una guía, no una secuencia obligatoria.

### Estrategia de entrada (sin construir todavía)

Todo lo operativo gratis el primer año; ofrecer migrar la temporada pasada desde su Excel; priorizar flag/tochito infantil-juvenil (menos herramientas legado que reemplazar, crecimiento fuerte de cara a LA 2028); conseguir una liga ancla bien montada y visible para que las demás sigan. El módulo de pagos (Cobranza → cobro en línea) es el punto de no retorno: en cuanto una liga cobra por la plataforma, no se va.
