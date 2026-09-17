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

- **El candado de migración se filtraba con el pooler de Neon (2026-09-16)**: `initSchema()` usaba `pg_advisory_lock()`, que vive en la **sesión**, y la app se conecta al endpoint **pooler** (PgBouncer en modo transacción), donde una "sesión" no es una conexión propia. Se encontró en la base una conexión **ociosa y atendiendo consultas normales con el candado puesto**: la siguiente migración se habría quedado esperando para siempre, colgando el arranque del servidor sin ningún error que lo explicara. Ahora es `pg_advisory_xact_lock()`, que se suelta solo al cerrar la transacción pase lo que pase, con un `SAVEPOINT` por migración para no perder la tolerancia a fallos de antes. Verificado contra la base: dos corridas seguidas, cero candados colgados, y el arranque sigue tardando lo mismo (9s). Ver "El candado de migración" en la sección de posiciones.

- **Tabla de posiciones y modelo de competencia (2026-09-16)**: la app ya sabía qué partidos se juegan, pero no **cómo se compite** — no había forma de decir que una liga corona campeón por conferencia y otra tiene un solo campeón general. Se agregaron tres piezas: **`phases`** (qué se está jugando, que es lo que permite que la tabla cuente la temporada regular y deje fuera playoffs y amistosos), **`titles`** (a qué nivel se corona campeón) y la configuración de la tabla por rama (niveles publicados + reglamento de desempates). Con `scope` + `decided_by` caben sin casos especiales la NFL (campeón de división, de conferencia y Super Bowl), ONEFA (dos campeones de conferencia y **ningún** campeón general — esa ausencia es justo cómo se representa que no hay juegos interconferencia) y LFA (un solo campeón). La jerarquía quedó alineada con el modelo estándar de la industria (Sportradar/SportMonks/IPTC SportsML), que ya era casi la que había. Ver la sección **"Tabla de posiciones y modelo de competencia"**.
  La fase y el campeón se resuelven **al leer**, no se migra nada: un partido sin `phase_id` deduce su fase de `week_label` como siempre, y el campeón sale de la tabla o del partido decisivo (`title_overrides` guarda solo la excepción). Los desempates son **configurables por rama** porque no existe un orden universal — **ni siquiera dentro de un mismo deporte**: ONEFA ordena por juegos ganados y la NFL por porcentaje, ambas de americano. Cada criterio es un par (métrica, universo), y lo que separa a un reglamento de otro es en qué posición va el "entre sí" y qué se hace cuando empatan tres o más. Por lo mismo, ni los sistemas de competencia ni los preconfigurados de desempate se nombran por un deporte: un sistema de competencia (todos contra todos, eliminación directa, sistema suizo) no le pertenece a ninguno.
  **Verificado contra la base real** con LFA 2025 y leyendo ONEFA 2026 (ver "Verificado contra la base real" en esa sección). De ahí salieron dos bugs que las pruebas unitarias no podían encontrar: el estado de un partido terminado es `'finished'`, no `'final'` —la tabla habría salido toda en ceros— y crear una fase no servía de nada si había que reasignarle los partidos a mano. También se unificó `utils/scoring.js`: los puntos de la quiniela ahora salen de la fase resuelta y no de la etiqueta de jornada, con el ranking del concurso en curso comprobado renglón por renglón (36 participantes, 433 puntos, cero diferencias).

- **La conferencia se dice una vez por equipo, no una vez por partido (2026-09-16)**: hasta ahora, al capturar cada juego había que elegirle rama, conferencia y grupo en el formulario. Eso era dato **derivado capturado como dato primario**: el hecho estable es "este equipo juega en esta conferencia", y a qué conferencia pertenece un partido es consecuencia de qué equipos lo juegan. En ONEFA eran ~130 selecciones de dropdown que no tenían por qué existir. Ahora la conferencia/grupo se registra en **`branch_teams`** (la tabla que ya decía qué equipos están inscritos en cada rama) y el partido la hereda. Queda separado por temporada **sin trabajo extra**: una rama cuelga de categoría → torneo, y el torneo tiene año, así que mover un equipo de conferencia el año que entra no reescribe a qué conferencia perteneció el pasado.
  La resolución vive en **un solo lugar**, `backend/src/utils/matchScope.js`, que exporta el fragmento de SQL que usan las tres consultas públicas más el árbol del panel. El orden es: override explícito del partido → la conferencia de los equipos → la del grupo asignado a mano → `matches.conference_id`. Ese último es lo que se capturó a mano antes de este cambio: **se conserva íntegro en la base** y pasa a ser el respaldo para el partido que no tenga de dónde derivar. Como la derivación resuelve **al leer** y no reescribe filas, un partido mal capturado se corrige solo.
  Tres decisiones que no son obvias y que conviene no revertir sin pensarlas. (1) **Se deriva solo cuando los DOS equipos tienen conferencia.** Con uno bastaría para que un amistoso contra un invitado de fuera (que no está en ninguna conferencia) se colara al calendario de la conferencia del rival como si fuera juego oficial — es exactamente el caso del scrimmage contra Whittier College, y por eso ese partido aparece sin conferencia, a propósito. (2) **Un partido entre conferencias distintas pertenece a las dos** (`conference_id` + `conference_id_2`) y sale al filtrar por cualquiera, mismo patrón que ya tenían los grupos con `group_id_2`; nadie lo marca a mano, se detecta solo. (3) El override por partido es **columna nueva** (`matches.conference_override_id`), no la vieja reutilizada, justo para no pisar el respaldo.
  En el panel, los equipos de cada rama ahora salen **agrupados bajo su conferencia**, con los que no tienen ninguna hasta abajo y visibles — son justo los que hay que asignar. El formulario de partido dejó de pedir la conferencia: la enseña ya heredada ("14 GRANDES — heredada de los equipos"), marca el cruce cuando lo hay, y si a algún equipo le falta el dato **lo nombra** en vez de adivinarle una conferencia. Cambiarla se hace en la rama, una vez, y todos sus partidos se reacomodan solos. En una rama sin conferencias (LFA, que juega todos contra todos) no aparece nada de esto.
  De paso se cerró una brecha real: **el importador de Excel no guardaba `home_team_id`/`away_team_id`**, solo el nombre en texto, así que todo calendario cargado por Excel —el camino por el que entran los calendarios grandes— habría quedado fuera de la derivación. Ahora sí las guarda.
  **La página del partido nunca había mostrado la conferencia**, ni antes ni después del cambio de modelo: no era que no llegara el dato, es que esa fila (`match-card-meta`) solo pintaba jornada, sede y temporada. Ya la muestra. La etiqueta la arma `matchScopeLabel()` en `frontend/src/utils/matchScope.js`, y la usan **las tres pantallas** —panel, calendario y página de partido—; antes el panel tenía su propia copia, y con dos copias tarde o temprano una dice "NACIONAL — NORTE" y la otra "NORTE" para el mismo partido.
  Para arrancar con lo que ya existe está **`backend/scripts/backfill-team-conferences.mjs`**: lee la conferencia que cada equipo ya tiene repetida en sus partidos, decide por mayoría (un partido suelto mal capturado no arrastra al equipo entero), reporta los empates en vez de inventarlos, y escribe **únicamente** en `branch_teams` — nunca en `matches`, `predictions` ni `pools`. Simula por defecto; escribe solo con `--apply`.
  **Estado real de los datos**: ONEFA ya quedó asignada a mano desde el panel, y de paso se aprovechó para partir `NACIONAL` en tres grupos (`BAJÍO`, `CENTRO`, `NORTE`) — 32 equipos con conferencia, 18 de ellos también con grupo, y **132 de 133 partidos derivan su conferencia de los equipos** (el 133 es el scrimmage). Los 9 inscritos sin conferencia son los 8 de LFA, que no usa conferencias, más el invitado. Verificado antes de aplicar nada: la migración, el relleno y las tres consultas públicas se corrieron contra los datos reales dentro de una transacción con `ROLLBACK`, con `lock_timeout`, para comprobar que el partido J3 marcado `NACIONAL` con los dos equipos de `14 GRANDES` se corregía solo, que los dos sin conferencia se llenaban, que LFA no se movía y que ni una fila de `matches` ni de `predictions` se tocaba.
- **Primeras pruebas automáticas que corren solas, y el CI ya las corre (2026-09-16)**: 93 pruebas unitarias con el runner que ya trae Node (`node --test`) — **sin Jest, Vitest ni ninguna dependencia nueva**. 30 en `backend/tests/unit/` y 63 en `frontend/tests/unit/`, con `npm test` en ambos lados y un paso nuevo en cada job del CI. Cubren lo que **se puede** probar sin base de datos ni navegador: la conversión de zonas horarias, los validadores de las dos puntas, el formato de dinero de cobranza, el cálculo del estado de un partido y el texto al compartir. Esto era la Fase 3 del roadmap de negocio, que estaba prácticamente en cero: las dos suites de punta a punta de cobranza son valiosas pero se corren **a mano** contra una rama de Neon, así que hasta hoy ningún cambio se verificaba solo. La elección de qué probar no fue al azar — se priorizó `utils/timezones.js` porque un error de zona horaria **no truena**: no hay excepción ni nada en Sentry, solo un partido anunciado a la hora equivocada. Tres cosas que las pruebas fijan y que no estaban escritas en ningún lado: que Tijuana **sí** tiene horario de verano mientras el resto de México **no** (coinciden en julio y no en diciembre), que `zonedTimeToUtcISO` resuelve hacia adelante una hora que no existe por el salto de horario, y que un marcador de **0-0** sí se anuncia al compartir (`0` es falsy y una revisión ingenua lo desaparecería). Hay una prueba que cruza las dos puntas a propósito: `frontend/tests/unit/matchDisplay.test.mjs` importa la lista de zonas del backend y verifica que toda zona que el backend acepta tenga etiqueta en el frontend — hoy están sincronizadas, y sin esa prueba separarlas no rompe nada, solo hace que el calendario muestre "America/Bogota" en crudo. `npm test` **no** corre las suites de cobranza: el patrón es `tests/unit/*.test.mjs`, así que nunca va a intentar hablarle a una base de datos por accidente.
- **Los datos legales viven en un solo archivo, y los Términos se ocultaron mientras tanto (2026-09-16)**: los placeholders (`[Razón social...]`, `[domicilio...]`, `[correo...]`, `[ciudad/estado]`) estaban escritos a mano dentro de `TermsOfService.jsx` y `PrivacyPolicy.jsx`, **visibles en producción** a cualquiera que abriera `/terminos`. Ahora los cuatro datos viven en `frontend/src/config/legal.js` y las páginas los leen de ahí. Mientras estén vacíos, `LEGAL_DATA_READY` es `false` y **los Términos de Servicio no se publican**: la ruta `/terminos` no existe (cae en "Página no encontrada") y el enlace desaparece del pie de página — unos Términos sin saber quién los emite ni ante qué tribunales se reclaman no obligan a nada. El **Aviso de Privacidad sí se queda publicado**, y es a propósito: el inicio de sesión con Google exige que ese link funcione, y un 404 ahí pone en riesgo el login de toda la app. Lo que hace mientras tanto es **omitir** las frases que dependen de los datos faltantes en vez de enseñar corchetes ("El responsable de CFBAMX… trata tus datos", sin `mailto:` vacío). Para publicar todo: llenar los cuatro campos de `legal.js` y ya — nada de rutas, pie de página ni variables de entorno en Vercel. Verificado en el navegador en los dos estados, vacío y lleno.

- **Pasada de limpieza de deuda técnica (2026-09-15)**: cuatro cosas chicas que estaban anotadas como pendientes y no dependían de nada externo. (1) **Pool de Postgres con valores explícitos** y, lo importante, el manejador `pool.on('error')` que faltaba — sin él un error en una conexión **ociosa** (exactamente lo que pasa cuando Neon se duerme y corta del otro lado) se emitía sin escucha y **tiraba el proceso entero de Node**; ver "Pendientes conocidos". (2) **Código muerto de vuelos borrado** de `matchServices.js` (`buildFlightSearchUrl`, `ORIGIN_CITY_OPTIONS`): nada los importaba desde que el widget embebido reemplazó el approach de link directo. (3) **Reindentado** del contenido dentro del `.dashboard-panel` de `LeagueStructurePanel.jsx` y `TournamentMatchesPanel.jsx` — cosmético del fuente, el render no cambió; **la QA visual de esas dos pantallas sigue pendiente**. (4) **`backend/scripts/diagnose-failed-leagues.mjs`**, para el pendiente de las ligas que no se pudieron registrar: escrito, **sin correr todavía**. Se corrigieron además dos cosas del propio README que ya no eran ciertas: el bullet que decía que "Registrar Organización" solo ofrecía Liga (los cuatro tipos se registran desde hace tiempo, `routes/organizations.js`) y el que decía que el código muerto de vuelos se había dejado a propósito.
- **Badge "✓ Verificado" en la ficha pública del equipo**: antes solo se veía en el panel del propio equipo. Lo que faltaba era del lado del backend — `is_verified` vive en `organizations`, no en `teams`, y **ninguno** de los cuatro endpoints públicos que alimentan `TeamCard`/`TeamInfoPanel` lo traía: `/leagues/all-teams` (Home), `/leagues/:slug/teams` (página de liga), `/leagues/tournaments/:id/public` (torneo) y los `home_team_details`/`away_team_details` de `/leagues/matches/:id` (página de partido). A los cuatro se les agregó el `LEFT JOIN organizations` con el mismo patrón que ya usaban `manage.js` y `auth.js`. En el frontend: palomita sola en la tarjeta (es chica y va en cuadrícula, con el texto en `title`/`aria-label`) y la pastilla completa `.pill is-ok` en la ficha, la misma que ya usaba `TeamWorkspace`. Si el equipo no está verificado no se dice nada — a diferencia de la página pública de liga, aquí no hay un "espacio no administrado oficialmente" que aclarar.
- **El CI ya cubre `scripts/` y `tests/`, y los `.mjs`**: el paso de sintaxis del backend corría `find src -name "*.js"`, así que los dos recorridos de punta a punta y los scripts de diagnóstico (todos `.mjs`) quedaban fuera del chequeo. Ahora son 38 archivos en vez de 36. Sigue sin *correr* los tests — eso necesita un backend vivo y una rama de Neon.
- **Cerrada una fuga de datos en la tarjeta pública de jugador, y arrancada la separación de las dos poblaciones.** `GET /api/players/:id/card` es público y hacía `SELECT * FROM players` sin exigir nada más: servía **cualquier** fila de `players`, incluidos los clientes del padrón de un club —nombre, fecha de nacimiento, CURP y foto, en buena parte menores de edad— a cualquiera que adivinara un id. Ahora exige **al menos una membresía de torneo** (un cliente del padrón responde 404, no 403: desde afuera no se debe distinguir "existe pero no te lo muestro" de "no existe") y devuelve solo los cinco campos que la tarjeta pinta — el CURP es identificación oficial y tampoco tenía por qué salir para los jugadores reales. La causa de raíz era compartir tabla, y de ahí sale el cambio de fondo: **`club_members` + `club_ledger_entries`** (ver "Dos poblaciones distintas" más abajo). El esquema ya está; **el código de cobranza todavía no se ha movido a las tablas nuevas.**
- **Dos poblaciones distintas: el cliente del club dejó de ser un `players` (fase A).** Antes, dar de alta a alguien en el padrón de cobranza creaba una fila en `players`, la misma tabla del roster de torneo. En cuanto a filas ya eran independientes (importar del roster copiaba, no enlazaba), pero compartir tabla traía tres problemas reales: nada distinguía a un cliente de un atleta, la tarjeta pública servía **cualquier** fila de `players` (ver la fuga de arriba), y `first_name`/`last_name NOT NULL` obligaba al club a inventarle un apellido a quien solo conoce por su apodo. Ahora el padrón vive en **`club_members`** —con **un solo `display_name`**, así que "El Güero" es un nombre válido— y su libro en **`club_ledger_entries`**, colgado del miembro y no del jugador. `players` se queda para lo único que es: quién puede jugar en qué rama de qué torneo.
  Se hizo en dos fases a propósito. Esta, la A, **cambia dónde viven los datos sin tocar el contrato de la API**: sigue respondiendo `player_id`, `first_name` y `last_name` (derivados del `display_name`), así que el frontend no se movió ni una línea. Eso permitió usar las suites de punta a punta como juez: **46 aserciones, 0 fallas antes y 46, 0 después**, con el único cambio en las pruebas siendo una consulta que lee la tabla directo. Si se hubieran renombrado las URLs al mismo tiempo, habría habido que editar las pruebas, y una prueba editada ya no demuestra que nada se rompió. La fase B —renombrar la superficie y poner un solo campo de nombre en el formulario— queda pendiente y no toca saldos.
  Efecto colateral bueno: el borrado de un jugador del roster (`DELETE .../roster/:playerId?hard=true`) ya **no** tiene que revisar si esa persona tiene cuenta en algún padrón o movimientos de cuotas. No puede tenerlos. Esa comprobación existía solo porque las dos poblaciones compartían tabla.
  **Las tablas viejas ya no se crean.** Sus `CREATE TABLE` se quitaron de `db.js`: mientras estuvieran, cada arranque del servidor las volvía a crear vacías después de borrarlas y nunca se acababa de limpiar. Una base nueva ya no las tiene. En una que ya existía siguen ahí con sus datos hasta que se corra `scripts/cleanup-legacy-club-padron.mjs`, que **simula por defecto**, enseña fila por fila con el dueño de cada equipo, y solo dropea con `--confirm` — una tabla de dinero no se borra como efecto secundario de reiniciar un servidor. Probado en la rama: dropeadas, servidor reiniciado, **no se recrearon**, y las 46 aserciones siguieron pasando.
- **Quitar un jugador del roster, y rechazar una solicitud de publicación**: los dos huecos que quedaban en "En progreso" y que no dependían de nada externo. Detalle del roster en "Roster de jugadores"; el rechazo es `PUT /api/admin/leagues/:id/decline-publish`, con botón "Rechazar solicitud" en `/admin` que **solo aparece si hay una solicitud pendiente** (`!is_public && publish_requested`) y pide un **motivo obligatorio**, porque el punto de rechazar en vez de ignorar es que el dueño sepa qué arreglar. No toca `is_public` ni borra nada: apaga `publish_requested`, le manda el motivo a la bandeja del dueño (tipo nuevo `league_publish_declined`, distinto de `league_unapproved`, que es ocultar una liga que ya era pública) y así el dueño puede volver a solicitarlo cuando corrija — el ciclo se cierra sin que nadie mande un WhatsApp. `ConfirmDialog` ganó una casilla opcional (`checkboxLabel`) para la acción con dos variantes; los cuatro llamadores que ya tenía no la pasan y no cambian en nada.
- **Borrado el roster "por equipo sin rama", que no era código muerto sino una trampa.** El panel de la liga tenía un botón "Roster" por equipo (del modelo de antes de la corrección "roster por rama") que daba de alta al jugador con `player_team_memberships.branch_id = NULL` — invisible después para **todas** las consultas del modelo actual, mientras el `GET` obsoleto sí lo mostraba. Se borró el botón en vez de repuntarlo porque el camino correcto ya existía en la misma pantalla: el chip "roster" del árbol Torneo → Categoría → Rama, que abre `BranchRosterModal` de esa rama. Se fueron con él `TeamRosterModal.jsx`, los tres endpoints obsoletos de `players.js` y sus tres funciones en `api/client.js` (81 líneas de backend). Detalle completo en "Roster de jugadores → Fuera de esta versión / pendiente". Las membresías huérfanas que ya existan siguen en la base: `backend/scripts/find-orphan-roster-players.mjs` las encuentra, **falta correrlo**.

- **Panel de trabajo del equipo (workspace) + cuotas del club a sus jugadores**: `/panel/equipo/:id` dejó de ser un editor de perfil y pasó a ser un espacio de trabajo con seis secciones (Resumen, Finanzas, Jugadores, Con la liga, Perfil, Administradores), con el logo y el **color del club** (`teams.brand_color`) como acento. Lo nuevo de fondo es **Finanzas**: el libro de cuotas **equipo → jugador** (`player_ledger_entries`) y el **flujo de conciliación** que faltaba — el papá abre un **estado de cuenta público sin cuenta** (`/cuenta/:token`), sube su comprobante, y el club lo confirma con un clic. Pieza clave: el **padrón del club** (`team_player_accounts`) es **independiente de los rosters de torneo** — un equipo sin liga, o al que su liga todavía no inscribe en ninguna rama, da de alta a su gente y le cobra igual. Detalle completo en la sección "Cuotas del club" más abajo. **Nota**: las tablas que este bullet nombra (`player_ledger_entries`, `team_player_accounts`) se reemplazaron después por `club_ledger_entries` y `club_members` — ver "Dos poblaciones distintas" en la misma sección.
- **Monitoreo de errores (Sentry)**: integrado en frontend (`frontend/src/main.jsx` + `ErrorBoundary.jsx`, variable `VITE_SENTRY_DSN`) y backend (`backend/src/instrument.js`, importado antes que nada más en `server.js`; `Sentry.setupExpressErrorHandler(app)` justo antes del manejador de errores propio; variable `SENTRY_DSN`). Verificado en producción (Render + Vercel) forzando un error real y confirmando que llegó a Sentry.
- **Páginas legales**: Términos de Servicio (`/terminos`) y Aviso de Privacidad (`/privacidad`) — `frontend/src/pages/TermsOfService.jsx` y `PrivacyPolicy.jsx`. **Actualizado (2026-09-16)**: los datos de quien opera el Servicio ya no están escritos a mano en cada página, viven en `frontend/src/config/legal.js`; mientras estén vacíos, los Términos no se publican y el Aviso omite las frases que dependen de ellos. Ver el bullet correspondiente al inicio de esta sección.
- **CI en GitHub Actions** (`.github/workflows/ci.yml`): en cada push/PR a `main` corre las pruebas unitarias de las dos puntas (`npm test`), el build del frontend (`npm run build`) y un chequeo de sintaxis de `backend/src`, `scripts/` y `tests/` (`node --check`, 47 archivos). Las pruebas van **antes** del build a propósito: tardan medio segundo y el build casi un minuto. No bloquea el deploy de Render/Vercel si falla — son procesos independientes, esto solo te avisa.
- **Bug corregido: registrar una liga daba 500.** `POST /leagues` (`routes/leagues.js`) tenía **19 placeholders para 18 columnas** en su `INSERT`, así que Postgres la rechazaba con "INSERT has more expressions than target columns" y ninguna liga nueva se podía crear. Preexistente y sin relación con la cobranza — se topó de frente al intentar crear una liga de prueba para el recorrido de punta a punta. **Revisar si alguien intentó registrar una liga y no pudo.**
- **Verificación de la sesión**: las dos suites de punta a punta corrieron contra una rama de Neon con **46 aserciones y 0 fallas**, y encima se hizo la **QA visual en navegador** — se revisó el panel del equipo, se confirmó que la tarjeta del estado de cuenta público se ve bien, y se mandó un **WhatsApp real** desde el panel (ese link se arma en el cliente y no pasa por el backend, así que ninguna prueba automática lo cubre). La rama de prueba se borró al terminar.
- **Dos suites de punta a punta** (`backend/tests/`, ver su README): ejercitan los dos libros contra un backend vivo apuntado a una rama de Neon, nunca a producción. No corren en el CI. Cubren lo único que no se puede revisar leyendo el código — que el saldo cuadre después de cancelar, rechazar y retirar. Fueron las que cazaron los dos bugs de arriba.
- **Conciliación en los dos libros**: quien paga ahora puede reportar su pago con comprobante y quien cobra lo confirma con un clic — el equipo hacia su liga (`POST /billing/teams/:id/report-payment`) y el jugador hacia su club. El pago nace `pending` y **no mueve el saldo** hasta que lo confirman; rechazarlo no genera ajuste (nunca entró al saldo) y quien lo reportó lo puede retirar si se equivocó. Esto era lo que quedaba "Fuera de la V1" de Cobranza.
- **Pasada de estilo al panel de cobranza de la liga**: `BillingLeaguePanel` adoptó las piezas que nacieron para el panel del equipo (`.data-table`, `ConfirmDialog`, `LedgerEntryList`, `utils/money.js`) y borró su copia de cada una — incluido el `window.confirm` del navegador para cancelar un movimiento contable y la clase `billing-table`, que no existía en ninguna hoja de estilo. Se le agregó la tira de KPIs (por cobrar, vencido, % al corriente) derivada de datos que el overview ya devolvía.
- **Cobranza liga → equipos ("estado de cuenta") — V1**: la liga registra desde `/panel/liga/:id/cobranza` lo que cobra cada semana a sus equipos (renta de campo, arbitraje, transmisión, inscripción, multas), lleva un **libro append-only** por equipo y ve el panorama de adeudos. El monto es **por equipo** (tabla con casilla por equipo + botón que lo calcula como cuota × # de partidos de ese equipo en la jornada). El representante del equipo ve su estado de cuenta **de solo lectura** en `/panel/equipo/:id/estado-de-cuenta` y recibe recordatorios (cargo nuevo / por vencer / vencido / pago registrado) en su bandeja. En esta V1 **solo la liga escribe** — no hay flujo de "el equipo reporta un pago". Detalle completo en la sección "Cobranza" más abajo.
- **Roster por plantilla de Excel**: además del alta manual jugador por jugador que ya existía, ahora se puede descargar (desde el modal de roster de un equipo dentro de una rama) una plantilla `.xlsx` con el logo de la liga, el logo del equipo y el contexto (Liga/Torneo/Categoría/Rama/Equipo) ya incrustados, llenarla y volver a subirla — solo agrega a los jugadores que todavía no estén en esa rama, nunca borra a nadie. Se agregó CURP a `players` y un botón de foto por jugador (Cloudinary). Detalle completo en la sección "Roster de jugadores" más abajo.
- **Equipos independientes (sin liga)**: un equipo ya se puede registrar directo desde `/registrar-equipo` sin pertenecer a ninguna liga de la plataforma (`teams.league_id` ahora es opcional). Usa el mismo mecanismo de verificación de identidad que cualquier otra organización (`organizations.is_verified`, admin desde `/admin`) — antes esa pestaña excluía a todos los equipos. Aparecer en el home es decisión propia del equipo (`show_on_platform`, interruptor sin aprobación de nadie, se prende/apaga desde su panel) y no limita ninguna otra función; un equipo de liga sigue apareciendo exactamente igual que antes, sin cambios. Detalle completo en la sección "Equipos independientes" más abajo.
- **Footer ya no se pinta negro por default**: `.footer` en `styles.css` tenía `background: #000` fijo, así que se veía como una barra negra sólida en cualquier página, sin importar si esa sección tenía o no un panel negro real detrás (ej. el Home, que no usa panel negro en ningún lado). Se cambió a `background: transparent` para que herede el fondo verde de cancha del `body`, igual que el resto del sitio.
- **Travelpayouts Drive removido de `frontend/index.html`**: ese script reescribía automáticamente los links salientes a marcas de viaje y podía insertar ofertas/contenido propio en la página — se quitó a petición explícita (no se quieren anuncios ni contenido que "salte" en el sitio), y porque Brave Shields (y listas de bloqueo tipo EasyPrivacy) lo bloqueaban de cualquier forma. **Efecto directo: el botón 🏨 Hotel en `MatchPage` dejó de generar comisión** — era el único mecanismo que agregaba el marcador de afiliado al link de Booking.com. El botón ✈️ Vuelo (widget de Aviasales) no se afectó — trae su propio marcador embebido, independiente de Drive. Detalle y alternativa sin Drive en "Monetización" más abajo.
- **Diagnóstico de pantalla en blanco en `localhost` (solo en dev, no afecta producción)**: `PrivacyPolicy.jsx` se importaba de forma estática en `App.jsx`. En dev, Vite sirve cada componente como su propio archivo (`/src/pages/PrivacyPolicy.jsx`), y Brave Shields bloquea por heurística cualquier URL que contenga la palabra "privacy" — al bloquearse ese import estático se rompía la carga de **toda** la app (pantalla en blanco). En producción no pasaba porque Vite empaqueta todo en un solo bundle sin nombres de archivo reconocibles, pero el riesgo estaba ahí para cualquier página que en el futuro se cargara distinto.
- **Code-splitting por ruta** (`App.jsx` + `vite.config.js`): todas las páginas excepto `Home` ahora se cargan con `React.lazy()` dentro de un `<Suspense fallback={<Loading />}>`, y los chunks resultantes se nombran con hash genérico (`chunkFileNames: 'assets/chunk-[hash].js'` en `vite.config.js`) en vez del nombre real de cada página — así ningún bloqueador puede tumbar una página por su nombre. Efecto medido con `npm run build`: el bundle principal bajó de 946 KB a ~300 KB; el resto se reparte en ~40 chunks pequeños que se descargan solo al entrar a esa página. Bonus: si algún chunk llega a fallar (bloqueado, red lenta), el `ErrorBoundary`/`Suspense` ya existentes lo contienen a esa sola página — TopBar, SponsorBar y footer siguen funcionando.
- **Panel negro (`dashboard-panel`) ahora envuelve el contenido de `Dashboard.jsx`, `LeagueStructurePanel.jsx` y `TournamentMatchesPanel.jsx`** — antes solo lo tenía `Dashboard.jsx` en parte de su contenido. **Sin verificar visualmente todavía**: revisar en el navegador que se vea bien en las tres pantallas antes de darlo por cerrado (en los dos últimos archivos el `<div>` nuevo no reindentó el contenido interno — cosmético en el código fuente, no afecta el render).
- **Varios administradores por liga o equipo ("Invitar administrador")**: una liga o un equipo ya puede tener más de una persona con acceso simultáneo a su panel, no solo un dueño único — mismo mecanismo que ya existía para "entregar" un equipo a su representante, pero sin reemplazar a nadie. Nuevo tipo de invitación `org_admin` (`routes/invites.js`, columna `invites.organization_id`) que, al reclamarse, agrega a esa persona como fila nueva en `organization_members` en vez de sustituir al dueño actual. Nuevas rutas `GET/DELETE /organizations/:id/members` para listar y quitar administradores (no deja quitar al último — evita dejar la organización sin nadie). Botón "+ Invitar administrador" y la lista correspondiente viven en el componente nuevo `OrgAdminsPanel.jsx`, presente en el panel de equipo (`Dashboard.jsx`) y en el panel de liga (`LeagueStructurePanel.jsx`). Por ahora todos los administradores tienen el mismo permiso — no hay jerarquía de roles todavía (`owner`/`admin`/`editor` no se distinguen, ver `isOrgMember`).
- **Dos huecos corregidos para que lo anterior funcione de punta a punta**: (1) `GET /auth/me` calculaba `leagues`/`teams` solo por `owner_user_id` — alguien invitado como administrador nunca veía esa liga/equipo en "Mi panel" aunque el backend ya le diera permiso de editarla; ahora también cuenta la membresía activa en `organization_members`. (2) `POST /leagues` no creaba la fila en `organizations` ni el `organization_members` del dueño al momento de crear la liga (a diferencia de un equipo, que sí lo hacía desde siempre) — se quedaba así hasta el siguiente reinicio del servidor, que es cuando corre el backfill que lo completa; ahora una liga nueva nace con su organización y su dueño registrado de inmediato.
- **Pantalla vieja de liga retirada (`/panel/liga/:id`, modelo plano sin torneos)**: todo lo que hacía ya vivía en `LeagueStructurePanel.jsx` (`/panel/liga/:id/estructura`), la pantalla que de verdad se usa desde hace tiempo — se confirmó contra la base de datos que ninguna liga tenía ya partidos en el modelo viejo antes de quitarla. `Dashboard.jsx` bajó de ~800 a ~250 líneas (ahora solo sirve "Mi panel" y el panel de equipo). La ruta vieja redirige automáticamente a `/estructura` (`RedirectToLeagueStructure` en `App.jsx`) para no romper links guardados; el aviso "Abrir pantalla clásica" que apuntaba ahí también se quitó de `LeagueStructurePanel.jsx`.

## Cambios recientes importantes (agosto 2026)

- **Monetización de afiliados de viaje activada**: la plataforma ya genera comisión real sobre los botones de Hotel y Vuelo en `MatchPage`. Ver la sección "Monetización" más abajo para el detalle completo de cómo funciona y qué falta.
- **Travelpayouts Drive instalado** (`frontend/index.html`, `<script>` al inicio del `<head>`): convierte automáticamente los links salientes a marcas de viaje soportadas (ej. Booking.com) en links de afiliado, sin tocar el código de React que genera esos links.
- **Función de Vuelos construida** (antes solo era un comentario de "a futuro" en el código): nuevo componente `frontend/src/components/FlightSearchWidget.jsx` y utilidades nuevas en `matchServices.js` (`IATA_BY_CITY`, `iataForCity`). Al hacer clic en "✈️ Vuelo" en la tarjeta de un partido, se despliega un formulario de búsqueda de Aviasales embebido (vía Travelpayouts), con el destino ya puesto según la ciudad de la sede — el origen lo detecta Aviasales por la IP del usuario, y las fechas las ajusta el usuario a mano (el widget no acepta fecha por default; se le muestra la fecha del partido como referencia).
- El botón de Hotel (`buildHotelSearchUrl`) no cambió de código — sigue generando un link limpio a `booking.com/searchresults.html`; ahora es Drive quien le agrega el marcador de afiliado en el navegador del usuario.
- `buildFlightSearchUrl` y `ORIGIN_CITY_OPTIONS` en `matchServices.js` quedaron sin uso (eran de un primer approach con link directo + selector de ciudad de origen, reemplazado por el widget embebido). **Borrados en septiembre 2026** — nada los importaba. Lo que sí sigue vivo de ese archivo para vuelos es `IATA_BY_CITY` e `iataForCity()`, que es lo que `FlightSearchWidget` usa para resolver el destino.

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

~~**Lo primero al retomar**: correr los dos scripts de limpieza contra la base
real~~ — **hecho (2026-09-17)**. Se corrieron contra producción, con el dueño de
los datos confirmando que las dos filas eran suyas y de prueba:

- `delete-orphan-roster-players.mjs`: borró la única membresía sin rama que
  quedaba (ZHAMIS TOLEDO, equipo BULLDOGS) y su fila en `players`, porque no
  estaba referenciado en ningún otro lado.
- `cleanup-legacy-club-padron.mjs`: tiró `team_player_accounts` y
  `player_ledger_entries`, que tenían una cuenta y un cargo de prueba de $500
  en GRIZZLIES.

Antes de confirmar se revisaron las llaves foráneas hacia `players`: son cuatro
tablas, y ZHAMIS TOLEDO no aparecía en ninguna salvo su membresía rota, así que
no se perdió nada en cascada. **El detalle que salió de esa revisión**: al
momento de correrlos, `club_members` y `club_ledger_entries` (las tablas nuevas)
estaban **vacías** — ese cargo de $500 nunca se migró, era el único dato de
cuotas de club en toda la base. Por eso el borrado necesitaba una confirmación
humana y no se hizo de corrido; el script avisa de esto a propósito.

Reverificación después de correrlos, toda en verde: cero membresías sin rama,
cero filas de ZHAMIS TOLEDO, las dos tablas viejas ya no existen, y
`club_members`/`club_ledger_entries` siguen en su lugar. Quedaron dos filas en
`players` sin ninguna membresía de roster (FERCHO BULLDOG y alfredo reyes): no
las tocó ningún script porque no son membresías huérfanas sino jugadores sin
membresía, no se ven en ninguna pantalla y no estorban.

- **Fase B de la separación del padrón** — ver "Fase B" al final de "Cuotas del
  club". Es lo único grande que queda abierto de esta línea de trabajo, y está
  especificado con detalle para poder arrancarlo en frío.
- **Reactivar comisión de Hotel sin Drive**: desde que se quitó Travelpayouts Drive (ver "Cambios recientes" y "Monetización"), el botón 🏨 Hotel no genera comisión. Ya no depende de la aprobación de Booking.com dentro de Travelpayouts (ese flujo se fue junto con Drive) — la alternativa ya integrada en el código es configurar `VITE_HOTEL_AFFILIATE_ID` con un ID de afiliado directo de Booking.com. Falta conseguir/confirmar ese ID y configurarlo en Vercel.
- **Rellenar los datos legales** — **son cuatro datos y un solo archivo**: `frontend/src/config/legal.js` (razón social o nombre de quien opera, domicilio fiscal, correo de contacto y ciudad/estado de jurisdicción). En cuanto los cuatro tengan contenido, los Términos de Servicio vuelven a publicarse solos y el Aviso de Privacidad queda completo; no hay nada más que tocar. **Hoy `/terminos` no existe** (ver "Cambios recientes"). Es lo único que bloquea cerrar la Fase 1 del roadmap de negocio. Nota de prioridad entre los dos: el **Aviso de Privacidad** es el más urgente, porque sigue público, es el que exige la LFPDPPP y es el link que usa la pantalla de consentimiento de Google — sin razón social ni contacto ARCO está incompleto como aviso legal.
- **Configurar la competencia de ONEFA** — es captura, no código: su temporada
  está en curso y todavía no tiene fases ni títulos declarados, así que su
  página pública no muestra tabla. Se hace desde Estructura → rama →
  **⚙ competencia**. Ver "Lo que queda abierto" al final de "Tabla de
  posiciones y modelo de competencia", donde está también lo único de código
  que quedó suelto de esa línea.
- ~~**QA visual del panel negro en LeagueStructurePanel/TournamentMatchesPanel**~~
  — **hecha en navegador (2026-09-17)** para `LeagueStructurePanel`: el
  `.dashboard-panel` renderiza bien, el árbol crece dentro del panel sin
  desbordarlo y los modales (nuevo torneo, quitar administrador) se ven
  correctos. **`TournamentMatchesPanel` sigue sin verificarse**: llegar a él
  pide categoría, rama y partidos, y la QA no llegó tan hondo.
- ~~**QA visual de "Invitar administrador"**~~ — **hecha de punta a punta en
  navegador (2026-09-17)**, con dos cuentas de prueba y una liga desechable que
  se borró al terminar. Funciona: generar el link, reclamarlo con una segunda
  cuenta creada desde el propio link, verla aparecer en su "Mi panel" con acceso
  real, quitar a un administrador, y el candado del último administrador — que
  **no es solo visual**: el botón queda deshabilitado con su explicación en el
  tooltip, y el backend además responde 400 si se le pega directo. El link es de
  un solo uso y al reabrirlo dice "Esta invitación ya fue utilizada".

  **Dos cosas del mecanismo de invitaciones que salieron de paso** (ninguna es
  un bug abierto, pero conviene tenerlas escritas):
  - **El link se genera al ABRIR el modal, no al enviarlo** (`InviteAdminModal.jsx`
    lo pide en un `useEffect`). Abrir y cerrar sin mandar nada deja una
    invitación válida en la base. No se acumulan, porque `routes/invites.js`
    borra las no usadas de esa organización antes de crear la siguiente — la
    consecuencia real es que **generar un link nuevo invalida el anterior**, que
    es lo correcto pero no es obvio desde la pantalla. En desarrollo se ven DOS
    filas por cada apertura: `React.StrictMode` corre el efecto dos veces y las
    dos peticiones se pisan (ambas borran antes de que la otra inserte). Es
    ruido de desarrollo — en el build de producción StrictMode no duplica
    efectos — pero explica por qué en la QA apareció una invitación huérfana.
  - **Las invitaciones no caducan**: el esquema de `invites` no tiene
    `expires_at` y el único freno es `used_at`. Un link que nunca se usó sigue
    sirviendo indefinidamente, hasta que alguien genere otro para esa misma
    organización. Trade-off aceptable hoy (el link se manda por WhatsApp y se
    usa en el momento), pero si algún día se reenvía un chat viejo, ese link
    todavía funciona.
  **Pero salió un hueco de fondo, ver abajo.**

- ~~**Quitar a quien registró la organización NO le quita el acceso**~~ —
  **arreglado (2026-09-17)**. El problema: `middleware/ownership.js` autoriza con
  `isMember || owner_user_id === req.user.id`, y ese segundo término es un
  respaldo deliberado de la migración a `organization_members`. Consecuencia que
  el comentario no contemplaba: a quien **creó** la liga o el equipo no se le
  podía revocar el acceso — la pantalla lo quitaba de la lista y el diálogo decía
  "puedes volver a invitarla más adelante", pero su token seguía dando **200** en
  `GET /leagues/:id/tree` y en `GET /billing/leagues/:id/overview`, o sea también
  la cobranza.

  **Cómo se arregló, y por qué así.** Se revisó primero la base real: **cero**
  ligas y **cero** equipos dependen hoy del respaldo (todos los que tienen
  `owner_user_id` ya tienen su fila en `organization_members`), así que se podía
  quitar de los 18 puntos donde aparece. **No se hizo eso.** En vez de tocar 18
  sitios de autorización, se mantiene `owner_user_id` **sincronizado** con el
  administrador principal: el respaldo deja de ser puerta trasera porque siempre
  apunta a alguien que de todas formas tiene acceso, y la red de seguridad de la
  migración se queda intacta. Retirar el respaldo sigue siendo posible más
  adelante, pero ya como limpieza aparte y no como parte de un arreglo urgente.

  **Lo que se construyó** (`routes/organizations.js`, `OrgAdminsPanel.jsx`):
  - **`POST /organizations/:id/transfer-owner`** — cede el puesto de principal a
    otro administrador ya existente. Mueve el `role` de organization_members y el
    `owner_user_id` de la liga/equipo **en una sola sentencia con CTEs**: no en
    varias seguidas, porque `db.prepare` toma una conexión del pool por consulta
    y del otro lado hay un pooler en modo transacción, así que un BEGIN/COMMIT
    repartido no tiene garantizada la misma conexión. Solo lo puede hacer quien
    tiene el puesto — si no, un invitado podría nombrarse principal y después
    quitar a quien lo invitó.
  - **Al principal ya no se le ofrece "Quitar"**, en vez de ofrecerlo
    deshabilitado: un botón muerto no explica nada, y antes prometía algo que el
    backend no cumplía. El backend además responde `409` si se le pega directo.
  - **"Retirarme"** — quitarse a uno mismo siempre estuvo permitido por el
    endpoint; lo que faltaba era que surtiera efecto. Es el caso de quien registra
    el equipo donde trabaja (un coach) y **no quiere** acceso a las cuentas de
    dinero: cede el puesto al tesorero y se retira. El diálogo lo dice sin
    rodeos — se pierde el acceso al panel y a la cobranza.

  **Verificado de punta a punta** contra la base real, con dos cuentas de prueba
  y una liga desechable que se borró al terminar: roles iniciales correctos, el
  principal no se puede quitar ni quitarse (409 en ambos), un invitado no puede
  auto-nombrarse principal (403), el traspaso mueve rol **y** `owner_user_id`
  juntos, y después de retirarse la cuenta saliente recibe **403** en el panel y
  en la cobranza — donde antes recibía 200. Las 135 pruebas unitarias siguen en
  verde.
- ~~**El registro de liga promete algo que no pasa**~~ — **arreglado
  (2026-09-17)**. `RegisterLeague.jsx` decía "Tu liga aparecerá de inmediato en
  la página de inicio", y era falso: `leagues.is_public` nace en `FALSE`
  (`db.js`), el `INSERT` de `routes/leagues.js` no lo toca y la portada filtra
  `WHERE is_public = TRUE`. Comprobado creando una liga real: quedó
  `is_public=false` y no apareció en el listado público. Ahora el formulario dice
  lo que de verdad ocurre — que la liga empieza privada, que se puede cargar todo
  sin que nadie la vea, y que se publica cuando se pide desde el panel y el admin
  aprueba. El panel de la liga ya lo decía bien; el que prometía de más era este
  formulario.
- ~~**Al aceptar una invitación no se sube el scroll**~~ — **arreglado
  (2026-09-17)**, junto con el contraste de esa misma pantalla. La pantalla de
  éxito se pinta arriba, pero el navegador conservaba el scroll del formulario
  que acababa de desaparecer: lo primero que se veía era cancha vacía y parecía
  que el clic no había hecho nada (pasó en la propia QA). Ahora `InviteClaim.jsx`
  sube el scroll al llegar a éxito o a error. Y las **tres** pantallas de esa
  ruta (invitación, éxito y "ya fue utilizada") van dentro de `.dashboard-panel`
  como el resto del área con sesión — antes iban sueltas sobre el fondo de
  cancha, con el texto secundario en verde claro sobre verde. Verificado en
  navegador: `scrollY` pasa de 609 a 0 al aceptar.
- **"Notificaciones" ya muestra contenido real** (cobranza en los dos libros, avisos de partidos, aprobaciones) — lo que falta es que el jugador/tutor tenga bandeja propia. Hoy no puede: `notifications` tiene `CHECK (recipient_type IN ('league','team'))` y los jugadores no tienen cuenta. Por eso los recordatorios de cuotas llegan **agregados a la bandeja del equipo** y el aviso al papá lo dispara el tesorero por WhatsApp.
- **Permisos de colaboración entre organizaciones** — ver punto 2 de "Roadmap —
  en construcción". Los cuatro tipos de organización **ya se registran** (eso
  era el punto 1 y quedó hecho); lo que sigue pendiente es que una organización
  pueda darle permiso a otra.
- ~~Revisar si alguien no pudo registrar su liga~~ — **cerrado**. El bug de
  `POST /leagues` (19 placeholders para 18 columnas) está corregido.
  `scripts/diagnose-failed-leagues.mjs` quedó, pero **no sirve para contar
  intentos fallidos**: su primera versión listaba a los usuarios sin
  organización como sospechosos, y eso es ruido — en esta app la mayoría de las
  cuentas son de aficionados que entran por el calendario o la quiniela, y no
  tienen por qué administrar nada. El script ya no los lista.
- ~~Configurar método de pago (payout) en Travelpayouts~~ — **hecho**: ya está configurado el payout a PayPal.
- ~~Botón de "Rechazar" una liga pendiente~~ — **hecho (septiembre 2026)**, ver "Cambios recientes".

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

La plataforma monetiza mediante comisión de afiliado en dos accesos de `MatchPage`: 🏨 Hotel y ✈️ Vuelo. Ninguno de los dos vende nada directamente — ambos mandan al usuario a un tercero (Booking.com, Aviasales) que sí procesa la reserva y el pago; LIFA solo cobra comisión cuando esa reserva se completa.

Todo corre a través de una sola cuenta de **Travelpayouts** (red de afiliados de viaje), sin necesidad de tener una empresa constituida — basta con RFC persona física con actividad empresarial para poder facturar la comisión más adelante.

### Hotel — link limpio, sin comisión activa por ahora

- `buildHotelSearchUrl()` en `matchServices.js` arma un link normal a `booking.com/searchresults.html` con la ciudad de la sede y la fecha del partido — sin ningún ID de afiliado hardcodeado.
- **Travelpayouts Drive se quitó de `frontend/index.html`** (septiembre 2026): era el script que detectaba ese link en el navegador del usuario y le agregaba el marcador de afiliado automáticamente. Se quitó porque también insertaba contenido/ofertas por su cuenta (anuncios, en la práctica) y Brave Shields lo bloqueaba de cualquier forma. **Efecto: el botón Hotel hoy no genera ninguna comisión** — el link sigue funcionando normal para el usuario, solo que sin marcador de afiliado.
- La variable de entorno `VITE_HOTEL_AFFILIATE_ID` sigue en el código como alternativa: si se configura con un ID de afiliado **directo** de Booking.com (sin pasar por Travelpayouts ni por ningún script de terceros), `buildHotelSearchUrl()` le agrega el parámetro `aid` directo a la URL. Antes debía quedar vacío para no chocar con Drive; ahora que Drive no existe, ya se puede configurar sin conflicto. **Pendiente**: conseguir ese ID (ver "En progreso").

### Vuelo — widget embebido de Aviasales

- El botón "✈️ Vuelo" (`FlightSearchWidget.jsx`) despliega, dentro de la misma tarjeta del partido, el widget "Flights Search Form" de Aviasales (vía Travelpayouts) — el usuario busca y compara sin salir de la página; solo sale del sitio al momento de reservar.
- El **destino** viene pre-cargado según la ciudad de la sede, resuelta a código IATA con el diccionario `IATA_BY_CITY` (`matchServices.js` — cubre las ciudades mexicanas con aeropuerto más comunes para sedes de ligas; si una sede real no aparece ahí, el botón de Vuelo no se muestra — nunca se manda un destino adivinado).
- El **origen** no se pide — Aviasales lo detecta por la IP del usuario.
- La **fecha** no se puede pre-cargar (este tipo de widget no lo soporta); se le muestra al usuario la fecha del partido como texto de referencia arriba del formulario, para que la ajuste ahí mismo.
- El código base del widget (`AVIASALES_WIDGET_BASE_SRC` en `FlightSearchWidget.jsx`) incluye el marcador de afiliado (`shmarker`) y el diseño configurado en Travelpayouts (Tools → Search Forms). Si se vuelve a generar el widget desde su panel con otro diseño, hay que actualizar esa constante con el código nuevo completo.
- A diferencia de Booking, Aviasales no requirió aprobación manual — quedó activo automáticamente al registrarse en Travelpayouts.

### Pendiente del lado de la cuenta (no de código)

- Conseguir un ID de afiliado directo de Booking.com y configurarlo en `VITE_HOTEL_AFFILIATE_ID` (ver "Hotel" arriba y "En progreso") — es lo único que falta para que el botón Hotel vuelva a generar comisión, ahora que ya no depende de Travelpayouts Drive ni de su aprobación de programa.
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
| PATCH | `/teams/:id/accounts/:playerId` | Edita persona **y** ficha de cobranza en una llamada |
| DELETE | `/teams/:id/members/:playerId` | Baja si ya tiene movimientos; borrado real solo si nunca tuvo |
| POST | `/teams/:id/members/import-roster` | Copia (una vez) de un roster de torneo |
| GET | `/teams/:id/players/:playerId/entries` | Libro de un jugador |
| POST | `/teams/:id/charges` | Cargos en bloque, monto por jugador |
| POST | `/teams/:id/charges/repeat` | Repetir un lote anterior |
| POST | `/teams/:id/players/:playerId/payments` | Pago capturado por el club (nace confirmado) |
| POST | `/entries/:entryId/confirm` | Confirmar un pago reportado por el papá |
| POST | `/entries/:entryId/void` | Cancelar / rechazar |
| POST | `/teams/:id/accounts/:playerId/rotate-token` | Regenerar el link (si se filtró) |
| PATCH | `/teams/:id/settings` | Interruptor de recordatorios |
| **GET** | **`/statement/:shareToken`** | **Público, sin sesión** |
| **POST** | **`/statement/:shareToken/report-payment`** | **Público** — un pendiente a la vez por jugador |
| **POST** | **`/statement/:shareToken/upload-proof`** | **Público** — subida del comprobante |

En los tres públicos el token **es** la credencial. La respuesta del estado de
cuenta se arma campo por campo en vez de devolver la fila: de ahí nunca debe
salir el teléfono del tutor, el id interno del jugador, ni rastro de ningún otro
jugador. Van con su propio limitador (`publicStatementLimiter` /
`reportPaymentLimiter` en `middleware/rateLimit.js`).

> **Nombres en la API.** Las rutas y campos todavía dicen `player` /
> `player_id`, y las respuestas siguen trayendo `first_name` / `last_name`
> derivados del `display_name`. Es compatibilidad deliberada de la fase A, no un
> descuido: ver "Fase B" más abajo.

El comprobante no puede pasar por `POST /api/upload` porque ese exige sesión; la
configuración de Cloudinary se sacó a **`utils/cloudinary.js`** en cuanto hubo un
segundo llamador, y el comprobante va a `lifa-app/comprobantes` sin el recorte
cuadrado de los logos (una captura de SPEI es alta y angosta, y a 800x800 el
monto queda ilegible). **Nota de privacidad**: la URL de Cloudinary es pública
para quien la tenga — mismo trato que `proof_url` en la cobranza liga→equipo.

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

### Fase B — renombrar la superficie (PENDIENTE)

> Escrito para poder arrancarlo en frío, sin contexto de la sesión en que se
> hizo la fase A.

**Dónde quedó la fase A.** Los datos ya están separados: el padrón vive en
`club_members` y su libro en `club_ledger_entries`, sin ninguna columna que
apunte a `players`. Lo que **no** se movió fue el contrato de la API: sigue
respondiendo `player_id`, `first_name` y `last_name`, estos dos derivados del
`display_name` partiéndolo por el primer espacio. Por eso el frontend no se tocó
ni una línea.

**Por qué se dejó a medias a propósito.** Las dos suites de punta a punta
(`backend/tests/`) asumen ese contrato. Al no moverlo, sirvieron de juez del
refactor: **46 aserciones y 0 fallas antes, 46 y 0 después**, con el único cambio
en las pruebas siendo una consulta que lee la tabla directo. Si se hubieran
renombrado las URLs al mismo tiempo, habría habido que editar las pruebas — y una
prueba editada ya no demuestra que nada se rompió. La fase B sí necesita editar
las pruebas, y por eso va después y aparte.

**Qué falta hacer:**

1. **Un solo campo de nombre en el formulario.** `ClubMemberForm.jsx` pide
   nombre y apellido y exige los dos (`if (!form.first_name.trim() ||
   !form.last_name.trim())`). Debe pedir **un** campo, "Nombre", que se mande
   como `display_name`. El backend ya lo acepta desde la fase A: si viene
   `display_name` lo usa tal cual, y si no, arma uno juntando first/last. Este
   punto es el que le da sentido a todo lo demás — es lo que permite registrar a
   alguien como "El Güero" sin inventarle un apellido.
2. **Que el frontend lea `display_name`** en vez de `first_name`/`last_name`.
   Los consumidores son `TeamRosterSection.jsx`, `TeamFinancesSection.jsx`,
   `TeamOverviewSection.jsx` y `PlayerStatementPage.jsx` (el estado de cuenta
   público del papá). La API ya devuelve `display_name` junto a los derivados, así
   que este paso se puede hacer y verificar antes de quitar nada.
3. **Quitar la compatibilidad del backend** una vez que (2) esté hecho:
   `nameCompatSql`, `splitDisplayName` y `memberAsPlayer` en
   `routes/playerBilling.js`, más los `AS first_name` / `AS last_name` de las
   consultas. Están marcados en el código con el comentario que dice que se
   borran en esta fase.
4. **Renombrar URLs y campos** para que dejen de decir "player" donde quieren
   decir "miembro del club": `/teams/:id/players/:playerId/entries`,
   `/teams/:id/accounts/:playerId`, `/teams/:id/members/:playerId`, el campo
   `player_id` de las respuestas y el `items: [{ player_id, amount }]` de crear
   cargos. Es puro renombre, pero toca las dos puntas a la vez.
5. **Actualizar las suites** al contrato nuevo. Aquí sí hay que editarlas; el
   valor que conservan es que las aserciones de saldo (cancelar, rechazar,
   retirar, confirmar) sigan cuadrando.

**Cómo verificarlo.** Igual que la fase A, y es la parte que no se debe saltar:
crear una rama en Neon (Branches → New branch, es copia instantánea y no toca
producción), levantar el backend contra ella en el puerto 4100 y correr las dos
suites — antes de empezar, para tener el verde de partida, y después. Ver
`backend/tests/README.md`. **Nunca contra producción**: las suites crean
usuarios, equipos y movimientos de cobranza reales.

**Advertencia de la fase A, para no repetirla.** Al escribir el esquema nuevo se
"mejoró" un valor de `created_by_side` de `'player'` a `'member'` sin cambiar el
código que lo escribe, y eso tiraba **todo pago reportado desde el link del
papá** contra el CHECK. Lo cazaron las suites. En esta fase hay mucho renombre de
ese tipo: cada valor que viaje en la API (`created_by_side`, `status`, `kind`)
hay que cambiarlo en el esquema **y** en el código **y** en el frontend, o no
cambiarlo en ninguno.

**Lo que NO hay que tocar en esta fase:** nada del cálculo de saldo
(`BALANCE_SUM_SQL`), ni los estados de un pago (`pending` / `rejected` /
`withdrawn` / `void`), ni `reverses_entry_id`. Esa lógica ya está probada y el
refactor de la fase A no la movió. La fase B es renombre de superficie.

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
  "En progreso" arriba.
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

El modelo de "varias organizaciones por cuenta" ya está en marcha (ver "Cambios recientes" arriba). Lo que falta para completarlo:

1. ~~Agregar los tipos Equipo independiente, Empresa/Marca y Medio de comunicación a "Registrar Organización"~~ — **hecho**: los cuatro tipos ya se registran (Equipo independiente desde `/registrar-equipo`, ver sección "Equipos independientes"; Medio/Tienda/Clínica/Marca desde `/registrar-organizacion`).
2. Más adelante: permisos de colaboración entre organizaciones — por ejemplo, que un Medio con permiso pueda actualizar directamente el link de transmisión de un partido registrado por una Liga, sin pasar por su dueño original.

## Roadmap de negocio — operar sin intervención constante (actualizado 2026-09-14)

Objetivo: que la plataforma genere flujo de cobro real sin que cada venta dependa de una acción manual del dueño. Progreso por fase:

**Fase 0 — Cerrar lo que ya estaba a medias**
- ✅ Payout de Travelpayouts a PayPal configurado.
- ⏳ Aprobación de Booking.com: sin acción de código, solo esperar a que crezca el tráfico y volver a pedir revisión (ver "En progreso" arriba).

**Fase 1 — Fundación de confiabilidad**
- ✅ Páginas legales (`/terminos`, `/privacidad`) escritas, y sus datos centralizados en `frontend/src/config/legal.js`. ⏳ Los cuatro datos siguen sin llenar: mientras tanto los Términos están ocultos y el Aviso publicado pero incompleto.
- ✅ Monitoreo de errores (Sentry) en frontend y backend, verificado en producción.
- ✅ CI en GitHub Actions (pruebas unitarias + build + chequeo de sintaxis en cada push).
- ⏳ Pendiente: subir Render y Neon a un plan de pago (hoy se "duerme" en free tier — ver "Pendientes conocidos").
- ⏳ Pendiente: rotar `CLOUDINARY_API_SECRET`.

**Fase 2 — Automatizar el cobro (el bloqueador real de fondo)**
No iniciado. Hoy `PUT /organizations/:id/plan` (`admin.js`) requiere que el admin active el plan "pro" a mano después de un pago fuera de la plataforma (transferencia/PayPal). Reemplazar por checkout self-serve + webhook (Conekta o Stripe — Conekta tiene ventaja en México por soportar OXXO/SPEI) que actualice `plan`/`plan_expires_at` solo, con downgrade automático si el pago falla. Después, evaluar extender el mismo mecanismo a `billing.js`: cobro en línea liga→equipo, y eventualmente equipo→jugador (para que los equipos cobren a sus propios jugadores).

**Fase 3 — Red de seguridad técnica**
En marcha. **Hecho (2026-09-16)**: 135 pruebas unitarias que corren solas en cada
push (54 en `backend/tests/unit/` y 81 en `frontend/tests/unit/`, con
`node --test`) — ver "Cambios recientes". Las 18 más nuevas son de
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
No iniciado, salvo el rechazo de solicitud de publicación (ya hecho, ver "Cambios recientes"). Falta: onboarding automático por correo para organizaciones nuevas — `RESEND_API_KEY`/`EMAIL_FROM` ya están configurados para los códigos de verificación, así que no hace falta cuenta nueva, solo construir los correos. Los tipos de organización pendientes ya se habilitaron (los cuatro se registran).

**Fase 5 — Crecimiento sin esfuerzo manual**
No iniciado. Página de precios pública para el plan "pro", analítica de conversión (hoy `track.js` solo cuenta vistas/clicks de sponsors), SEO/contenido más allá del sitemap actual.

## Roadmap de producto — herramientas para ligas y equipos

> **De esta lista ya están construidos**: Cobranza liga→equipo, cuotas del club
> equipo→jugador con su padrón propio, y la conciliación (quien paga reporta con
> comprobante, quien cobra confirma) en los dos libros. Lo demás sigue siendo
> estrategia, no compromiso de calendario.
>
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
- Dominio propio sin marca LIFA; tienda oficial de la liga (`products.js`/bot de WhatsApp ya existen para tiendas tipo `store`, falta adaptarlo a mercancía de liga); módulo de disciplina (expulsión → suspensión automática); credenciales físicas impresas; seguro de jugadores vía aseguradora aliada.

**Para equipos**
- ~~**Cobro de cuotas a jugadores** (equipo → jugador)~~ — **hecho**, y resultó ser gratuito y no de pago: es lo que engancha al club (su historial de cobranza vive en la plataforma y no se va con el tesorero que sale cada año). Ver sección "Cuotas del club" más arriba. Lo monetizable de encima sigue pendiente: pasarela con comisión, y los servicios alrededor (uniformes, seguro, viajes).
- Video/film del partido con recorte de jugadas (Hudl más barato).
- Tienda del equipo (uniformes, fan gear); scouting de rivales de la misma liga; vitrina de reclutamiento para universidades/LFA.

### Orden sugerido (revisar contra lo ya avanzado)

Orden original propuesto: 1) tabla de posiciones + generador de calendario, 2) roster + credencial QR, 3) inscripciones/pagos en línea, 4) estadísticas por jugador, 5) patrocinadores self-serve. **En la práctica se adelantó Cobranza (liga→equipo) antes que el resto** porque resolvía el dolor más agudo hoy (cobranza semanal por WhatsApp) — orden válido, esto es una guía, no una secuencia obligatoria.

### Estrategia de entrada (sin construir todavía)

Todo lo operativo gratis el primer año; ofrecer migrar la temporada pasada desde su Excel; priorizar flag/tochito infantil-juvenil (menos herramientas legado que reemplazar, crecimiento fuerte de cara a LA 2028); conseguir una liga ancla bien montada y visible para que las demás sigan. El módulo de pagos (Cobranza → cobro en línea) es el punto de no retorno: en cuanto una liga cobra por la plataforma, no se va.
