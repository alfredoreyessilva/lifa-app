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

## Pendientes abiertos

Solo lo que **falta**. Lo que ya se cerró está en `docs/CHANGELOG.md` con su
verificación.

- **`PUT /manage/teams/:id` no es atómico (2026-09-18).** Son tres escrituras
  sueltas: `UPDATE teams`, `UPDATE organizations` y `syncTeamLinksToMatches()`
  (una consulta por partido). Cualquier error después de la primera deja el
  equipo **guardado** y a la persona viendo "Error interno del servidor" — el
  mensaje miente a medias. Es exactamente lo que confundió en el bug del país
  vacío (ver el CHANGELOG). No es una fuga activa: hoy no se conoce ningún error
  entre el paso 1 y el 3. Lo que queda vivo es el **modo de falla**, que es caro
  de diagnosticar cuando vuelve a aparecer.

  Los dos caminos, con su costo:

  1. **Una sola sentencia con CTEs**, el patrón que este proyecto ya eligió
     (`POST /organizations/:id/transfer-owner`). Los pasos 1 y 2 se juntan sin
     problema; el 3 obliga a convertir el bucle en un `UPDATE matches … FROM`.
  2. **Exponer una transacción de verdad** — `db.transaction(async (tx) => …)`.
     La maquinaria ya existe: `initSchema()` saca **un** cliente del pool y hace
     `BEGIN`/`SAVEPOINT`/`COMMIT` sobre él, atravesando el mismo endpoint
     `-pooler` de Neon, y funciona. Lo que falta es exponerla: `db` solo exporta
     `prepare` y `exec`. Matiz que corrige la lectura fácil de la regla de
     CLAUDE.md: un pooler en modo transacción **sí** soporta transacciones
     mientras vivan en **una sola conexión**; lo que no soporta es repartirlas
     entre varias, que es justo lo que hace `db.prepare` (una conexión por
     consulta). Mientras la transacción vive, el pooler fija esa conexión, así
     que tiene que ser corta.

  La opción 2 es la preferida: sirve para cualquier otra ruta con el mismo
  problema y no obliga a reescribir el bucle de partidos en SQL. Va como cambio
  aparte, porque toca `db.js`, del que cuelga todo.

- **El pie del estado de cuenta público es ilegible (2026-09-18).** El párrafo
  "¿Algo no cuadra? Escríbele a tu club…" de `PlayerStatementPage.jsx` usa
  `--ws-ink-faint` (#6b7378) y cae **fuera** de la tarjeta negra, directo sobre
  el verde de la cancha: da **1.16:1** de contraste, donde AA para texto chico
  exige 4.5:1. En la práctica no se ve. Es el mismo problema que arregló el
  commit `eadac84` para las tarjetas sobre la cancha, pero este párrafo quedó
  fuera. No se tocó aquí porque la solución es una decisión de diseño —meterlo
  en la superficie oscura, o darle un color que aguante el verde— y no quería
  resolverla a ojo.

- **Nadie sabe cada cuánto corre el cron, y ahora de él depende el dinero.**
  `POST /api/notifications/trigger` lo llama un servicio **externo al
  repositorio**: no está en `.github/workflows/`, no hay `render.yaml`, no hay
  `node-cron`, y su frecuencia no está escrita en ningún archivo del proyecto —
  vive en el panel de un proveedor de fuera. Hasta ahora eso solo atrasaba
  avisos; desde el cobro automático, también la generación de cargos. La vía
  perezosa del panel lo cubre (por eso se construyó así), pero **hay que entrar
  a ese panel, confirmar que sigue corriendo, y anotar aquí cada cuánto.**

- **Falta decidir el prorrateo de quien entra a media quincena.** Hoy el ciclo
  le cobra el mes completo a quien esté `activo` al generar, y solo se salta los
  periodos cuya fecha de pago es anterior a su `joined_date`. Si un club espera
  cobrar medio mes a quien entró el día 20, eso no está resuelto. Se puede
  agregar después sin tocar la idempotencia, porque `auto_cycle_key` no depende
  del monto.

- **Dos decisiones de producto sobre qué le concede un club a su liga.** Las dos
  salen de que `teamOwnerRequired` deja pasar también a los administradores de
  la organización de la LIGA, y ninguna es técnica:

  1. **Borrar un equipo arrasa con su contabilidad.**
     `DELETE /api/manage/teams/:id` es un `DELETE FROM teams` pelón, y el
     esquema encadena `teams → club_members → club_ledger_entries`. El panel de
     la liga ya tiene ese botón (`LeagueStructurePanel.jsx`, 🗑 "Eliminar
     equipo"), así que una liga "limpiando equipos viejos" borra la cobranza
     privada de ese club con sus familias — y el diálogo no menciona nada de
     eso. Lo mínimo sería responder 409 si hay movimientos; lo correcto,
     dar de baja en vez de borrar.
  2. **El padrón con CURP y fechas de nacimiento de menores lo ve la liga.**
     Un administrador de liga puede pedir el `overview` de cualquiera de sus
     equipos y recibir CURP, fecha de nacimiento, foto y contacto del tutor de
     todo el padrón, más el libro completo. Es justo lo que se separó de
     `players` para proteger (regla 7 de CLAUDE.md), y el README dice que el
     padrón lo arma el club, siempre.

- **El nombre del proyecto ya está decidido: CFBAMX.** El texto visible al
  usuario, los comentarios y los nombres de paquete ya dicen CFBAMX. Lo que
  sigue diciendo `lifa` es infraestructura heredada que no se renombró a
  propósito, porque cambiarla rompe cosas en producción: la carpeta del repo
  (`lifa-app/`), el servicio de Render (`lifa-backend-p0hq.onrender.com`), las
  llaves de `localStorage` (`lifa_token` — cambiarla desloguea a todos los
  usuarios ya registrados) y las carpetas de Cloudinary (`lifa-app/logos`,
  `lifa-app/comprobantes`). Cada una se puede migrar por separado cuando
  convenga; ninguna es urgente. La razón social ya se eligió: opera José Alfredo
  Reyes Silva como persona física, y CFBAMX es el nombre comercial (ver
  `frontend/src/config/legal.js`).
- **La zona horaria solo se corrigió en el libro del CLUB.** `CURRENT_DATE` se
  evalúa en UTC (Neon), seis horas adelante de México: un cargo que vence hoy
  se marcaba vencido desde las 18:00 del mismo día. Se cambió por
  `utils/sqlDates.js` (`HOY_MX`) en `routes/playerBilling.js` y en
  `runPlayerBillingReminders`, pero **`runBillingReminders` (liga → equipo)
  sigue usando `CURRENT_DATE`** en `utils/billingReminders.js:71,100`. Es el
  mismo bug y la misma sustitución de una línea; se dejó fuera para no meter el
  libro de la liga en un cambio del panel del club, y porque toca correr las
  dos suites e2e antes y después.
- **Falta UI para rotar el link del estado de cuenta.** El endpoint
  (`POST /teams/:id/members/:memberId/rotate-token`) y el método del cliente
  (`api.rotateMemberShareToken`) existen, pero **ningún componente los llama**:
  hoy no hay forma de revocar un `share_token` filtrado sin entrar a la base.
  Junto con eso, "Copiar link" solo aparece cuando el miembro NO tiene
  teléfono, así que un club que sí capturó los teléfonos nunca puede copiarlo.
- **No hay auditoría del padrón.** Se sabe cuál es la cuota de alguien, no
  quién se la cambió ni cuándo. El patrón a imitar ya existe: el trío
  `created_by_user_id` / `voided_by_user_id` / `reverses_entry_id` del libro.
- **El botón "Recordar" puede quedar bloqueado por el navegador.** Hay dos
  `await` antes del `window.open` (`TeamFinancesSection.jsx`), y Safari —y casi
  siempre Firefox— bloquean una ventana que no cuelga síncronamente del clic.
  El tesorero ve "recordado hoy" y no se abrió nada: peor que no marcar, porque
  la plataforma registra un recordatorio que nunca se mandó.
- **No hay archivo `LICENSE`.** El repositorio no declara nada sobre qué se
  puede hacer con este código. Es decisión de negocio, no técnica: o el repo es
  privado, o lleva una licencia propietaria explícita. Hoy no es ninguna de las
  dos cosas por omisión, no por elección.
- **Los roles de organización no se distinguen, y ya hay dinero de por medio.**
  `organization_members.role` acepta `owner` / `admin` / `editor`, pero
  `utils/orgMembers.js` los da por equivalentes: `isOrgMember()` acepta los tres
  por defecto y **ninguna ruta le pasa una lista más corta**. Consecuencia real:
  a quien invitas como "editor" para que te ayude a capturar partidos le queda
  abierta también la cobranza — puede registrar cargos, confirmar pagos y
  cancelar movimientos contables, en los dos libros.
  El mecanismo para cerrarlo **ya existe y está escrito para esto**: el
  parámetro `allowedRoles` de `isOrgMember()`, que hoy nadie usa. Faltaría
  pasárselo en `routes/billing.js`, `routes/playerBilling.js` y en las acciones
  destructivas (borrar la organización, quitar administradores), y decidir qué
  puede hacer un `editor`. No es refactor: es elegir la lista en cada punto.
  > Esto estaba anotado en el README dentro del bullet de "Invitar
  > administrador", y al partir el histórico se fue a `docs/CHANGELOG.md`, donde
  > se lee como nota de algo pasado y no como limitación vigente. Por eso está
  > aquí ahora.
- **La advertencia de no apuntar a producción es solo texto, no un mecanismo.**
  La `DATABASE_URL` local apunta hoy a la base real, así que cualquier prueba
  desde `localhost:5173` escribe filas de verdad — está advertido en "Cómo
  correrlo en local" y es la regla 1 de `CLAUDE.md`, pero nada lo impide.
  Conviene que sea código: que el servidor **se niegue a arrancar** en modo
  desarrollo contra el host de producción salvo que se le pase una variable
  explícita. Son unas diez líneas en `config/db.js` y eliminan la categoría
  entera de accidente, incluido el de levantar un segundo backend por error.
- **Renombrar `/api/player-billing`** — es lo único que quedó de la fase B (ya
  hecha; ver "Cuotas del club"). El prefijo y el archivo `routes/playerBilling.js`
  siguen diciendo "player" donde quieren decir "miembro del club". Se dejó fuera
  porque mueve los 18 endpoints del router de un golpe —incluidos los tres
  públicos del papá— en vez de los 5 que movió la fase, y **toda esta clase de
  cambio tiene ventana de incompatibilidad al desplegar**: eso está explicado,
  con sus salidas, en la nota de "Fase B". Junto con el prefijo van
  `created_by_side = 'player'` y los tipos de notificación `player_*`, que son
  valores guardados y piden migración.
- **Scroll horizontal en el modal de la ficha del padrón** — las rejillas de
  "Categoría / Número / Posición" y "Cuota / Situación" desbordan el ancho del
  modal. Es preexistente y está medido en "Fase B".
- **Reactivar comisión de Hotel sin Drive**: desde que se quitó Travelpayouts Drive (ver "Monetización"), el botón 🏨 Hotel no genera comisión. Ya no depende de la aprobación de Booking.com dentro de Travelpayouts (ese flujo se fue junto con Drive) — la alternativa ya integrada en el código es configurar `VITE_HOTEL_AFFILIATE_ID` con un ID de afiliado directo de Booking.com. Falta conseguir/confirmar ese ID y configurarlo en Vercel.
- **Configurar la competencia de ONEFA** — es captura, no código: su temporada
  está en curso y todavía no tiene fases ni títulos declarados, así que su
  página pública no muestra tabla. Se hace desde Estructura → rama →
  **⚙ competencia**. Ver "Lo que queda abierto" al final de "Tabla de
  posiciones y modelo de competencia", donde está también lo único de código
  que quedó suelto de esa línea.
- **QA visual de `TournamentMatchesPanel`** — es la única de las tres pantallas
  con `.dashboard-panel` que sigue sin verificarse en navegador: llegar a ella
  pide categoría, rama y partidos. `Dashboard` y `LeagueStructurePanel` ya se
  revisaron (2026-09-17).
- **"Notificaciones" ya muestra contenido real** (cobranza en los dos libros, avisos de partidos, aprobaciones) — lo que falta es que el jugador/tutor tenga bandeja propia. Hoy no puede: `notifications` tiene `CHECK (recipient_type IN ('league','team'))` y los jugadores no tienen cuenta. Por eso los recordatorios de cuotas llegan **agregados a la bandeja del equipo** y el aviso al papá lo dispara el tesorero por WhatsApp.
- **Permisos de colaboración entre organizaciones** — ver punto 2 de "Roadmap —
  en construcción". Los cuatro tipos de organización **ya se registran** (eso
  era el punto 1 y quedó hecho); lo que sigue pendiente es que una organización
  pueda darle permiso a otra. Nota: el caso de **transmisiones** ya está
  construido y sirve de precedente, pero resuelve el problema por el otro lado —
  el medio se autoasigna, la liga no le concede nada (ver "Transmisiones").
- **Conectar el bot de WhatsApp** — es lo único que separa al bot de funcionar,
  y no es código: falta el número de WhatsApp Business
  (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`) y cargar la cuenta de
  Anthropic para tener `ANTHROPIC_API_KEY` con saldo. Ver "Tiendas y bot de
  WhatsApp". **Antes de conectarlo** hay que cubrir en el Aviso de Privacidad
  qué guarda `bot_messages` (teléfono y conversación de clientes de la tienda,
  que no tienen cuenta en la plataforma) y por cuánto tiempo — hoy esa tabla no
  tiene borrado por antigüedad y crece sin límite.

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
        notifications.js     Suscripción push + endpoint /trigger para el cronjob externo
        players.js           Roster por equipo+rama: alta manual, plantilla de Excel (logos vía
                              exceljs), foto/CURP por jugador, stats de partido y tarjeta pública
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
                              resuelve sus campeones)
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
                              validation, timezones y standings — esta última es
                              sobre todo el reglamento de desempates, que es
                              donde se falla sin que nadie lo note.
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

> **Cuidado si tu `DATABASE_URL` apunta a la base de producción** (hoy es el
> caso). Dos avisos que costaron un susto:
>
> 1. **Levantar un segundo backend interrumpe el servicio.** Si ya hay uno
>    corriendo en el 4000 y arrancas otro, el segundo falla por `EADDRINUSE`
>    — pero antes de morir alcanza a correr `initSchema()` contra la base, y
>    eso tumba las consultas del que sí está sirviendo. Se ve como una tanda
>    de **500 en todos los endpoints** durante unos segundos, sin ninguna
>    causa aparente. Se cura solo al recargar; el error no es de la app.
> 2. **Todo lo que pruebes en local escribe en producción.** Registrar una
>    liga, invitar administradores o dar de alta jugadores desde
>    `localhost:5173` crea filas reales. Para cualquier prueba que escriba,
>    usa una rama de Neon (Branches → New branch, copia instantánea) y apunta
>    `DATABASE_URL` ahí — es lo mismo que exige `backend/tests/README.md` para
>    las suites de punta a punta.

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
| `GET` | `/teams/:id/statement` | equipo (o la liga) — su estado de cuenta |
| `POST` | `/teams/:id/report-payment` | equipo — reporta un pago con comprobante (nace `pending`) |
| `POST` | `/teams/:id/withdraw-payment` | equipo — retira su propio reporte antes de que se lo confirmen |

Permisos: los endpoints de liga usan `leagueOwnerRequired`; los del equipo usan
`teamOwnerRequired` (deja pasar al rep del equipo **y** a la liga). Un equipo nunca
puede ver la cuenta de otro, y solo puede retirar lo que reportó él mismo
(`created_by_side = 'team'`), no lo que capturó la liga. Nada de cobranza aparece
en el sitio público.

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
filas. Dos cosas que allá sí existen y aquí siguen pendientes: **el pagador
reporta su pago con comprobante** y el cobrador lo confirma, y una pasada de
estilo al panel (`BillingLeaguePanel` ya puede adoptar `.data-table`,
`ConfirmDialog` y `LedgerEntryList`, que nacieron para el panel del equipo).

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

`utils/billingReminders.js` ahora exporta **dos** funciones, llamadas ambas al
final de `POST /api/notifications/trigger`: la de siempre (liga→equipo) y
`runPlayerBillingReminders`. Misma cadencia (por vencer una vez a ≤3 días;
vencido cada 3 días, hasta 4 veces) y mismas banderas por fila.

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
- No existe flujo de traspaso de dueño para un equipo independiente (sí existe
  para uno de liga, vía invitación — `routes/invites.js`) — si el que lo
  registró pierde acceso a su cuenta, hoy no hay forma de reclamarlo.

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

### Vulnerabilidades de `npm audit` — evaluadas y aceptadas conscientemente

Estas dos siguen apareciendo en `npm audit` del frontend. No es que se nos olvidó, ya se revisaron y no aplican a como está construido este proyecto hoy:

- **`esbuild`/`vite`** (`GHSA-67mh-4wv8-2f99`): permitiría a un sitio malicioso leer respuestas del servidor de desarrollo local. Solo afecta mientras `npm run dev` está corriendo en tu máquina — no afecta producción. Arreglarlo requiere saltar a `vite@8` (cambio mayor, rompe cosas).
- **`react-router`** (`GHSA-wrjc-x8rr-h8h6`, `GHSA-337j-9hxr-rhxg`): open redirect e inyección en hidratación SSR. Ambas fallas requieren el modo "Data/Framework" de React Router (`createBrowserRouter` + `RouterProvider`) o renderizado del lado del servidor. Este proyecto usa `<BrowserRouter>` (modo declarativo, en `main.jsx`) — no tiene ese código, así que no está expuesto.

## Pendientes conocidos (deuda técnica, sin urgencia)

- Rotar `CLOUDINARY_API_SECRET` (ver "Pendientes abiertos" arriba para el resto de pendientes funcionales).
- **El verdadero límite hoy es la infraestructura gratuita, no el código**: Render (plan gratuito) corre una sola instancia y se "duerme" tras ~15 min sin tráfico; Neon (plan gratuito) tiene un comportamiento similar. Se resuelve pasando a un plan de pago barato en ambos — decisión pendiente, no técnica.
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
- **Cinco archivos concentran demasiado.** Hoy funcionan y no hay razón para
  tocarlos, pero es donde va a doler cuando toque:

  | Archivo | Líneas | Qué concentra |
  |---|---|---|
  | `frontend/src/styles.css` | 3,800 | **Todos** los estilos de la app, en un solo archivo |
  | `backend/src/routes/manage.js` | 2,294 | El CRUD entero de liga, torneo, categoría, rama, equipo, sede y partido |
  | `backend/src/config/db.js` | 1,706 | Las 38 tablas más ~150 migraciones |
  | `frontend/src/pages/LeagueStructurePanel.jsx` | 1,119 | El árbol completo del panel de liga |
  | `frontend/src/pages/AdminPanel.jsx` | 977 | Las cuatro pestañas de `/admin` |

  El de `db.js` es el que tiene techo real: el arranque ya tarda 9s corriendo
  todas las migraciones, y crece con cada una. El día que eso estorbe, la salida
  es congelar las migraciones viejas en un esquema base y dejar en `db.js` solo
  las nuevas — pero todavía no estorba, y partirlo antes de tiempo costaría la
  tolerancia a fallos que hoy da el `SAVEPOINT` por instrucción.
- **Las invitaciones no caducan.** El esquema de `invites` no tiene `expires_at`
  y el único freno es `used_at`. Un link que nunca se usó sigue sirviendo
  indefinidamente, hasta que alguien genere otro para esa misma organización
  (generar uno nuevo invalida el anterior, porque `routes/invites.js` borra las
  no usadas antes de crear la siguiente). Trade-off aceptable hoy —el link se
  manda por WhatsApp y se usa en el momento—, pero si algún día se reenvía un
  chat viejo, ese link todavía funciona. Salió de la QA de "Invitar
  administrador"; el detalle está en `docs/CHANGELOG.md`.

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
- ⏳ Pendiente: subir Render y Neon a un plan de pago (hoy se "duerme" en free tier — ver "Pendientes conocidos").
- ⏳ Pendiente: rotar `CLOUDINARY_API_SECRET`.

**Fase 2 — Automatizar el cobro (el bloqueador real de fondo)**
No iniciado. Hoy `PUT /organizations/:id/plan` (`admin.js`) requiere que el admin active el plan "pro" a mano después de un pago fuera de la plataforma (transferencia/PayPal). Lo único que ese plan **hace** hoy es prender el bot de WhatsApp de una tienda — ver "Tiendas y bot de WhatsApp". Reemplazar por checkout self-serve + webhook (Conekta o Stripe — Conekta tiene ventaja en México por soportar OXXO/SPEI) que actualice `plan`/`plan_expires_at` solo, con downgrade automático si el pago falla. Después, evaluar extender el mismo mecanismo a `billing.js`: cobro en línea liga→equipo, y eventualmente equipo→jugador (para que los equipos cobren a sus propios jugadores).

**Fase 3 — Red de seguridad técnica**
En marcha. **Hecho (2026-09-16)**: 135 pruebas unitarias que corren solas en cada
push (54 en `backend/tests/unit/` y 81 en `frontend/tests/unit/`, con
`node --test`) — ver `docs/CHANGELOG.md`. Las 18 más nuevas son de
`matchScope.js`, la herencia de conferencia. Siguen existiendo los dos recorridos de punta a punta de
cobranza (`backend/tests/billing-*.e2e.mjs`), que se corren a mano contra una
rama de Neon y **no** están en el CI porque necesitan Postgres vivo.

Lo que falta de esta fase:
- **Pruebas de lo que toca la base de datos** — todo `routes/` empieza
  consultando Postgres, así que cubrirlo necesita levantar una base de prueba
  en el CI (un servicio de Postgres en el workflow, o Neon con una rama
  efímera por corrida). Es el paso grande que queda, y donde entraría auth.
- **Monitoreo de uptime y alertas** — hoy Sentry avisa de errores, pero nadie
  avisa si el servicio simplemente no responde.
- **Que el CI bloquee el deploy** si algo falla: hoy Render y Vercel despliegan
  sin esperar el resultado del CI. Esto no es código, es configuración en
  Render/Vercel (y, del lado de GitHub, un required status check sobre los
  jobs `frontend-build` y `backend-syntax-check`).

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
