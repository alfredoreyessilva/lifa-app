# Changelog

Lo que se construyó y se cerró, con su fecha y su verificación. Es el histórico
del proyecto: sirve para entender **por qué** algo quedó como quedó, y varias
entradas traen el post-mortem del bug que las provocó.

- Lo que sigue **abierto** vive en "Pendientes abiertos" del [README](../README.md).
- El detalle **vigente** de cada dominio (cobranza, posiciones, roster, …) vive
  en la sección correspondiente del README, no aquí.
- Las reglas de trabajo están en [CLAUDE.md](../CLAUDE.md).

---

## Septiembre 2026

### Cambios

- **La mensualidad del club se cobra sola (2026-09-18)**: se retiró el botón
  "Repetir el mes pasado" (`POST /teams/:id/charges/repeat`,
  `RepeatPlayerChargeModal.jsx`) y en su lugar el club configura **una sola
  fecha** —el día en que se paga— y el cargo nace solo, cinco días antes, para
  cada miembro `activo` con cuota definida.

  No se quitó por sus bugs, aunque los tenía: **le volvía a cobrar a quien ya
  estaba dado de baja** (solo comprobaba que la fila siguiera existiendo en
  `club_members`, y una baja es justamente una fila que sigue existiendo) y
  repetía también los cargos que se habían cancelado en el lote original. Se
  quitó porque el modelo estaba mal de origen: si una cuota ya está configurada
  como mensual, que alguien tenga que acordarse de apretar un botón el día
  correcto de cada mes no es una función, es una tarea pendiente que la
  plataforma le deja al tesorero. El cargo esporádico —uniforme, viaje,
  arbitraje— se queda en **"Generar cargo"**, que ya no ofrece la categoría
  `mensualidad`.

  **La idempotencia es de la base, no del código**, porque la generación se
  dispara desde dos lados: el cron y la carga del panel. Lo segundo no es
  redundancia — el cron es **externo al repositorio** (no está en
  `.github/workflows/`, no hay `render.yaml`, no hay `node-cron`) y su
  frecuencia no está documentada en ningún archivo, así que si se cae el club
  dejaría de facturar en silencio. La garantía la da
  `idx_club_ledger_auto_cycle` sobre la columna nueva
  `club_ledger_entries.auto_cycle_key`, con `ON CONFLICT DO NOTHING`. Dos
  detalles del índice que no son detalle: su predicado es **inmutable** (no
  filtra por `status`), así que cancelar una mensualidad automática impide que
  se regenere; y la columna nace NULL en toda la tabla, así que el índice se
  crea sobre cero filas y **no puede fallar** por duplicados históricos — que
  importa porque `run()` de `initSchema()` se traga el error de una migración
  que falle. Por si acaso, el generador **se niega a insertar** si el índice no
  está, y `scripts/report-mensualidades-duplicadas.mjs` lo reporta.

  Detalle en el README, "Cuotas del club" → "La mensualidad se genera sola".

- **Cuatro correcciones del panel del club (2026-09-18)**, las tres primeras en
  producción:

  1. **El interruptor de recordatorios estaba muerto.** El frontend leía y
     escribía `member_billing_reminders_enabled` y el backend
     `player_billing_reminders_enabled`, así que la casilla siempre salía
     desmarcada y **cualquier clic la guardaba en `false`**
     (`Boolean(undefined)`): un club que los tuviera prendidos los perdía y no
     podía volver a prenderlos. Lo introdujo el renombre de la fase B (`dcf6ac7`)
     sobre una clave que el propio README marcaba como intocable — es la regla 6
     de CLAUDE.md rota: se cambió en un lado y en los otros dos no.
  2. **La situación se ignoraba al dar de alta.** `POST /teams/:id/members` no
     desestructuraba ni insertaba `status`, así que quien registrabas como
     **Becado** nacía **Activo** y al mes siguiente entraba en el cobro. Con la
     generación automática habría dejado de necesitar que alguien apretara un
     botón para cobrarle de más. La suite e2e creaba un becado y **nunca lo
     verificaba**; ahora sí.
  3. **La nota interna viajaba en el estado de cuenta público.**
     `GET /statement/:shareToken` devolvía `note` por movimiento. No se pintaba,
     pero estaba en el JSON y se leía con la pestaña de red — y el campo que la
     captura promete "solo la ves tú, no aparece en el estado de cuenta del papá".
  4. **`PATCH /teams/:id/settings` pisaba lo que no le mandabas.** Hacía
     `Boolean(req.body?.player_billing_reminders_enabled)` sin preguntar si la
     clave venía, así que en cuanto el panel mandó el interruptor del ciclo
     habría apagado los recordatorios en silencio. Ahora es parcial, como el
     `PATCH` de un miembro.

- **La fecha de hoy se calcula en México, no en UTC (2026-09-18)**: `CURRENT_DATE`
  se evalúa en la zona del servidor de Postgres y Neon corre en UTC, seis horas
  adelante. Consecuencia real: **un cargo que vencía hoy se marcaba vencido desde
  las 18:00 hora de México del mismo día**, y el papá que pagaba a las 7 pm veía
  "vencido" en su estado de cuenta. Se sacó a `utils/sqlDates.js` (`HOY_MX`), que
  pone la zona **en la expresión** y no en la sesión: con un pooler en modo
  transacción un `SET TIME ZONE` no es confiable, por el mismo motivo por el que
  `pg_advisory_lock()` se tuvo que cambiar por su versión de transacción. Se
  aplicó en `routes/playerBilling.js` y en `runPlayerBillingReminders`; el libro
  de la liga sigue con `CURRENT_DATE` (ver "Pendientes abiertos").

- **Un lote de cargos es atómico (2026-09-18)**: `POST /teams/:id/charges`
  insertaba fila por fila en un `for...await`. Si tronaba en el jugador 20 de 40
  quedaba **medio lote creado**, ya visible en los saldos de veinte familias, y no
  hay acción de "cancelar el lote": había que cancelar cargo por cargo, cada uno
  con su ajuste. Ahora es un solo `INSERT` multi-fila, que es una sola sentencia y
  por lo tanto atómica pase lo que pase con el pooler.

- **La pestaña "Jugadores" se llama "Padrón" (2026-09-18)**: el padrón del club no
  son solo jugadores — hay becados, gente que entrena sin estar en ninguna liga y,
  más adelante, staff. Es además la palabra que ya usaban el README, los
  comentarios del código y la propia pantalla. **La ruta sigue siendo
  `/panel/equipo/:id/jugadores`**: cambiarla rompería links guardados y abriría
  una ventana de incompatibilidad al desplegar, que es caro por una etiqueta.

  De paso, `recent_batches` dejó de contar los cargos **cancelados** (sumaba
  montos que ya no existían) y ahora distingue el lote del ciclo del capturado a
  mano (`is_auto`).
- **Las tarjetas que se abren sobre la cancha van en negro (2026-09-17)**: la
  tarjeta del partido en MatchPage y las fichas de equipo y de sede
  (`.team-profile-modal`, en modal o embebidas) pasaron del verde `--card` a un
  negro propio (`--card-open`). El verde sobre el fondo de cancha casi no se
  despegaba y el amarillo de los botones perdía fuerza; al abrir un partido, sus
  cuatro tarjetas —partido, local, visitante y sede— ahora se leen como una sola
  pantalla. **No cambian** las portadas sin imagen ni los logos sin imagen: ahí
  el degradado verde es el contenido, no el fondo. Tampoco cambian las tarjetas
  del calendario ni el grid de equipos/sedes, donde la tarjeta es un renglón de
  una lista y no la pantalla.

  La vista previa del editor (`.team-editor-preview`, en el formulario de equipo
  y de sede y en "Así se ve el perfil de tu equipo") va del mismo negro **a
  propósito**: promete "así se ve tu ficha", así que tiene que verse igual. Por
  lo mismo sus campos editables dejaron de ser verdes — públicamente ese valor
  es texto sobre negro, y lo que marca qué se puede escribir es el borde. Se
  salvan el selector de color del club (`type="color"`), donde el fondo es el
  dato, y todos los formularios fuera del preview, que siguen en verde.

  Dos detalles de cascada: la tarjeta de MatchPage heredaba el `:hover` verde de
  las del calendario aunque ahí es un `<div>` y no un `<Link>`, y el borde rojo
  de "en vivo" pesaba menos que el selector nuevo y se lo comía; los dos quedaron
  fijados explícitamente. El campo del hex del color del club, de paso, dejó de
  salir blanco del navegador: era el único campo del editor fuera de un
  `.field`, así que nunca heredó los estilos del formulario.

  **Verificación**: es un cambio de solo CSS, así que se probó con el
  `styles.css` real en el navegador sobre el marcado de MatchPage y del editor,
  **sin levantar el backend** para no tocar la base de producción. Comprobado por
  estilos calculados: las cuatro tarjetas en `rgb(16,18,17)`, el hover de la de
  MatchPage sin cambio de color, el borde rojo de "en vivo" intacto, la tarjeta
  del calendario todavía en verde `rgb(52,126,58)` y un `.field` fuera del
  preview también. 81 unitarias de frontend en verde. Falta verla contra datos
  reales al desplegar.

- **Fase B de la separación del padrón: un solo campo de nombre, y el padrón
  deja de llamarse "players" (2026-09-17)**: cierra lo que la fase A dejó a
  medias a propósito. El nombre de un miembro del club es ahora **un solo
  campo** (`display_name`) de punta a punta — el formulario pide "Nombre" y ya
  no exige apellido, así que un club puede registrar a "El Güero", o a "Chispa"
  a secas, que es lo que `players.last_name NOT NULL` hacía imposible. Se fue
  del backend la capa de compatibilidad (`nameCompatSql`, `splitDisplayName`,
  `memberAsPlayer`, y el `split_part` que partía el nombre por el primer
  espacio), y la superficie de la API pasó de `player`/`player_id` a
  `member`/`member_id`: `/teams/:id/players/:playerId/entries` →
  `/members/:memberId/entries`, `/accounts/:playerId` → `/members/:memberId`
  (editar y dar de baja quedaron en la misma URL, separadas por el método), y
  las claves `players`, `player_count`, `{ player, account }` y
  `{ player: {...} }` del estado de cuenta público. El detalle completo, con la
  tabla antes/ahora, está en "Cuotas del club → Fase B" del
  [README](../README.md).

  **Salieron dos bugs de la fase A que las suites no cubrían, los dos vivos en
  producción.** (1) El libro de un miembro hacía `SELECT ... FROM players` con
  un id de `club_members`: son padrones distintos y sus ids no se corresponden,
  así que el modal de movimientos salía con el nombre de **otra persona** o
  vacío. (2) **Repetir un lote de cargos estaba roto al 100%**: el código leía
  `r.player_id` de `club_ledger_entries`, cuya columna es `member_id`, así que
  el endpoint respondía *400 "Ningún jugador válido para repetir el cargo"*
  siempre, con lote válido y jugadores en plantel. El renombre arregló el
  segundo solo; el primero se corrigió apuntando la consulta a `club_members`.

  **Verificación**, en una rama de Neon (`fase-b-test`), nunca contra
  producción: las dos suites e2e antes y después — **46 y 0 de partida, 47 y 0
  al final** (la de más comprueba que un nombre de una sola palabra se guarda
  tal cual); 81 unitarias de frontend y 54 de backend; un **smoke test de
  contrato** de 18 comprobaciones que verifica que cada clave que lee el
  frontend existe en la respuesta — hizo falta porque el build de Vite compila
  igual un `data.players` que ya no existe, y cazó tres roturas del propio
  refactor; y **QA visual en el navegador** contra la rama: Resumen, Finanzas,
  Jugadores, el modal de movimientos, la ficha, el estado de cuenta público del
  papá, el alta de "Chispa" y repetir un lote. La rama se borró al terminar.

  **Ojo al desplegar**: es un cambio de contrato sin solapamiento, y el frontend
  (Vercel) y el backend (Render) no terminan de desplegarse al mismo tiempo, así
  que hay una ventana en la que un lado pide una ruta que el otro ya no sirve —
  y las pestañas ya abiertas siguen con el bundle viejo hasta recargar. Solo
  afecta a la cobranza del club, son 404 y no escrituras malas, y se arregla
  recargando. Las salidas están en "Fase B" del README.

  **Quedó fuera a propósito**: el prefijo `/api/player-billing` y el archivo
  `routes/playerBilling.js` (mueve los 18 endpoints del router de golpe en vez
  de los 5 de esta fase — misma clase de cambio, más grande),
  y `created_by_side = 'player'` más los tipos de notificación `player_*`, que
  son valores guardados y piden migración — vale la regla 6 de `CLAUDE.md`: los
  tres lados o ninguno, y se eligió ninguno. Está anotado en "Pendientes
  abiertos".
- **`CLAUDE.md`, el changelog aparte, y las funciones que nadie había
  documentado (2026-09-17)**: el README pasó de 1,629 líneas a un índice por
  dominio. Lo cronológico se movió a este archivo y las reglas de trabajo a
  [`CLAUDE.md`](../CLAUDE.md), que antes había que deducir leyendo todo. De paso
  se documentaron **siete módulos vivos en producción que no aparecían en el
  README** —941 líneas de backend—: predicciones y quinielas (la función con más
  uso real de la app, 36 participantes), transmisiones por medios, tiendas con
  bot de WhatsApp, "Mi cartelera" y el tracking de patrocinadores. Ninguno tenía
  sección propia; cuatro de ellos (`bot.js`, `broadcasts.js`, `pools.js`,
  `predictions.js`) no se mencionaban **ni una sola vez**.
- **Faltaba la tabla `bot_messages` (2026-09-17)**: `routes/bot.js` la lee y
  escribe en tres lugares y **nunca se creó en `db.js`** — no estaba en ninguna
  migración. No había reventado porque el bot todavía no está conectado (faltan
  el número de WhatsApp y la llave de Anthropic), así que ese código nunca se
  había ejecutado. El día que se conectara, el `SELECT` habría tronado con
  *relation "bot_messages" does not exist*; como el webhook no alcanza a
  responder 200, Meta habría reintentado el mismo mensaje en ciclo y el cliente
  nunca habría recibido respuesta — con 500 repetidos en Sentry sin relación
  obvia con la causa. Se agregó siguiendo el patrón de `notifications`, con
  `CHECK (role IN ('user','assistant'))` (los dos valores que acepta la API de
  Claude) y el índice `(organization_id, wa_from, created_at DESC)`, que es
  exactamente la consulta de los últimos 10 turnos. **Sin verificar contra un
  Postgres real**: no hay uno local y no se corrió contra producción. Ojo con
  esto al arrancar — `run()` en `db.js` se traga los errores de migración en
  silencio, así que si el SQL tuviera algo mal la tabla simplemente no existiría
  y nada lo diría en los logs.

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

- **Pasada de limpieza de deuda técnica (2026-09-15)**: cuatro cosas chicas que estaban anotadas como pendientes y no dependían de nada externo. (1) **Pool de Postgres con valores explícitos** y, lo importante, el manejador `pool.on('error')` que faltaba — sin él un error en una conexión **ociosa** (exactamente lo que pasa cuando Neon se duerme y corta del otro lado) se emitía sin escucha y **tiraba el proceso entero de Node**; ver "Pendientes conocidos" en el README. (2) **Código muerto de vuelos borrado** de `matchServices.js` (`buildFlightSearchUrl`, `ORIGIN_CITY_OPTIONS`): nada los importaba desde que el widget embebido reemplazó el approach de link directo. (3) **Reindentado** del contenido dentro del `.dashboard-panel` de `LeagueStructurePanel.jsx` y `TournamentMatchesPanel.jsx` — cosmético del fuente, el render no cambió; **la QA visual de esas dos pantallas seguía pendiente** (se hizo el 2026-09-17 para `LeagueStructurePanel`; `TournamentMatchesPanel` sigue sin verificarse — ver "Pendientes abiertos" en el README). (4) **`backend/scripts/diagnose-failed-leagues.mjs`**, para el pendiente de las ligas que no se pudieron registrar: escrito, **sin correr todavía**. Se corrigieron además dos cosas del propio README que ya no eran ciertas: el bullet que decía que "Registrar Organización" solo ofrecía Liga (los cuatro tipos se registran desde hace tiempo, `routes/organizations.js`) y el que decía que el código muerto de vuelos se había dejado a propósito.
- **Badge "✓ Verificado" en la ficha pública del equipo**: antes solo se veía en el panel del propio equipo. Lo que faltaba era del lado del backend — `is_verified` vive en `organizations`, no en `teams`, y **ninguno** de los cuatro endpoints públicos que alimentan `TeamCard`/`TeamInfoPanel` lo traía: `/leagues/all-teams` (Home), `/leagues/:slug/teams` (página de liga), `/leagues/tournaments/:id/public` (torneo) y los `home_team_details`/`away_team_details` de `/leagues/matches/:id` (página de partido). A los cuatro se les agregó el `LEFT JOIN organizations` con el mismo patrón que ya usaban `manage.js` y `auth.js`. En el frontend: palomita sola en la tarjeta (es chica y va en cuadrícula, con el texto en `title`/`aria-label`) y la pastilla completa `.pill is-ok` en la ficha, la misma que ya usaba `TeamWorkspace`. Si el equipo no está verificado no se dice nada — a diferencia de la página pública de liga, aquí no hay un "espacio no administrado oficialmente" que aclarar.
- **El CI ya cubre `scripts/` y `tests/`, y los `.mjs`**: el paso de sintaxis del backend corría `find src -name "*.js"`, así que los dos recorridos de punta a punta y los scripts de diagnóstico (todos `.mjs`) quedaban fuera del chequeo. Ahora son 38 archivos en vez de 36. Sigue sin *correr* los tests — eso necesita un backend vivo y una rama de Neon.
- **Cerrada una fuga de datos en la tarjeta pública de jugador, y arrancada la separación de las dos poblaciones.** `GET /api/players/:id/card` es público y hacía `SELECT * FROM players` sin exigir nada más: servía **cualquier** fila de `players`, incluidos los clientes del padrón de un club —nombre, fecha de nacimiento, CURP y foto, en buena parte menores de edad— a cualquiera que adivinara un id. Ahora exige **al menos una membresía de torneo** (un cliente del padrón responde 404, no 403: desde afuera no se debe distinguir "existe pero no te lo muestro" de "no existe") y devuelve solo los cinco campos que la tarjeta pinta — el CURP es identificación oficial y tampoco tenía por qué salir para los jugadores reales. La causa de raíz era compartir tabla, y de ahí sale el cambio de fondo: **`club_members` + `club_ledger_entries`** (ver "Dos poblaciones distintas" del README). El esquema ya está; **el código de cobranza todavía no se ha movido a las tablas nuevas.**
- **Dos poblaciones distintas: el cliente del club dejó de ser un `players` (fase A).** Antes, dar de alta a alguien en el padrón de cobranza creaba una fila en `players`, la misma tabla del roster de torneo. En cuanto a filas ya eran independientes (importar del roster copiaba, no enlazaba), pero compartir tabla traía tres problemas reales: nada distinguía a un cliente de un atleta, la tarjeta pública servía **cualquier** fila de `players` (ver la fuga de arriba), y `first_name`/`last_name NOT NULL` obligaba al club a inventarle un apellido a quien solo conoce por su apodo. Ahora el padrón vive en **`club_members`** —con **un solo `display_name`**, así que "El Güero" es un nombre válido— y su libro en **`club_ledger_entries`**, colgado del miembro y no del jugador. `players` se queda para lo único que es: quién puede jugar en qué rama de qué torneo.
  Se hizo en dos fases a propósito. Esta, la A, **cambia dónde viven los datos sin tocar el contrato de la API**: sigue respondiendo `player_id`, `first_name` y `last_name` (derivados del `display_name`), así que el frontend no se movió ni una línea. Eso permitió usar las suites de punta a punta como juez: **46 aserciones, 0 fallas antes y 46, 0 después**, con el único cambio en las pruebas siendo una consulta que lee la tabla directo. Si se hubieran renombrado las URLs al mismo tiempo, habría habido que editar las pruebas, y una prueba editada ya no demuestra que nada se rompió. La fase B —renombrar la superficie y poner un solo campo de nombre en el formulario— queda pendiente y no toca saldos.
  Efecto colateral bueno: el borrado de un jugador del roster (`DELETE .../roster/:playerId?hard=true`) ya **no** tiene que revisar si esa persona tiene cuenta en algún padrón o movimientos de cuotas. No puede tenerlos. Esa comprobación existía solo porque las dos poblaciones compartían tabla.
  **Las tablas viejas ya no se crean.** Sus `CREATE TABLE` se quitaron de `db.js`: mientras estuvieran, cada arranque del servidor las volvía a crear vacías después de borrarlas y nunca se acababa de limpiar. Una base nueva ya no las tiene. En una que ya existía siguen ahí con sus datos hasta que se corra `scripts/cleanup-legacy-club-padron.mjs`, que **simula por defecto**, enseña fila por fila con el dueño de cada equipo, y solo dropea con `--confirm` — una tabla de dinero no se borra como efecto secundario de reiniciar un servidor. Probado en la rama: dropeadas, servidor reiniciado, **no se recrearon**, y las 46 aserciones siguieron pasando.
- **Quitar un jugador del roster, y rechazar una solicitud de publicación**: los dos huecos que quedaban pendientes y que no dependían de nada externo. Detalle del roster en "Roster de jugadores"; el rechazo es `PUT /api/admin/leagues/:id/decline-publish`, con botón "Rechazar solicitud" en `/admin` que **solo aparece si hay una solicitud pendiente** (`!is_public && publish_requested`) y pide un **motivo obligatorio**, porque el punto de rechazar en vez de ignorar es que el dueño sepa qué arreglar. No toca `is_public` ni borra nada: apaga `publish_requested`, le manda el motivo a la bandeja del dueño (tipo nuevo `league_publish_declined`, distinto de `league_unapproved`, que es ocultar una liga que ya era pública) y así el dueño puede volver a solicitarlo cuando corrija — el ciclo se cierra sin que nadie mande un WhatsApp. `ConfirmDialog` ganó una casilla opcional (`checkboxLabel`) para la acción con dos variantes; los cuatro llamadores que ya tenía no la pasan y no cambian en nada.
- **Borrado el roster "por equipo sin rama", que no era código muerto sino una trampa.** El panel de la liga tenía un botón "Roster" por equipo (del modelo de antes de la corrección "roster por rama") que daba de alta al jugador con `player_team_memberships.branch_id = NULL` — invisible después para **todas** las consultas del modelo actual, mientras el `GET` obsoleto sí lo mostraba. Se borró el botón en vez de repuntarlo porque el camino correcto ya existía en la misma pantalla: el chip "roster" del árbol Torneo → Categoría → Rama, que abre `BranchRosterModal` de esa rama. Se fueron con él `TeamRosterModal.jsx`, los tres endpoints obsoletos de `players.js` y sus tres funciones en `api/client.js` (81 líneas de backend). Detalle completo en "Roster de jugadores → Fuera de esta versión / pendiente". Las membresías huérfanas que ya existan siguen en la base: `backend/scripts/find-orphan-roster-players.mjs` las encuentra, **falta correrlo**.

- **Panel de trabajo del equipo (workspace) + cuotas del club a sus jugadores**: `/panel/equipo/:id` dejó de ser un editor de perfil y pasó a ser un espacio de trabajo con seis secciones (Resumen, Finanzas, Jugadores, Con la liga, Perfil, Administradores), con el logo y el **color del club** (`teams.brand_color`) como acento. Lo nuevo de fondo es **Finanzas**: el libro de cuotas **equipo → jugador** (`player_ledger_entries`) y el **flujo de conciliación** que faltaba — el papá abre un **estado de cuenta público sin cuenta** (`/cuenta/:token`), sube su comprobante, y el club lo confirma con un clic. Pieza clave: el **padrón del club** (`team_player_accounts`) es **independiente de los rosters de torneo** — un equipo sin liga, o al que su liga todavía no inscribe en ninguna rama, da de alta a su gente y le cobra igual. Detalle completo en la sección "Cuotas del club" del README. **Nota**: las tablas que este bullet nombra (`player_ledger_entries`, `team_player_accounts`) se reemplazaron después por `club_ledger_entries` y `club_members` — ver "Dos poblaciones distintas" en la misma sección.
- **Monitoreo de errores (Sentry)**: integrado en frontend (`frontend/src/main.jsx` + `ErrorBoundary.jsx`, variable `VITE_SENTRY_DSN`) y backend (`backend/src/instrument.js`, importado antes que nada más en `server.js`; `Sentry.setupExpressErrorHandler(app)` justo antes del manejador de errores propio; variable `SENTRY_DSN`). Verificado en producción (Render + Vercel) forzando un error real y confirmando que llegó a Sentry.
- **Páginas legales**: Términos de Servicio (`/terminos`) y Aviso de Privacidad (`/privacidad`) — `frontend/src/pages/TermsOfService.jsx` y `PrivacyPolicy.jsx`. **Actualizado (2026-09-16)**: los datos de quien opera el Servicio ya no están escritos a mano en cada página, viven en `frontend/src/config/legal.js`; mientras estén vacíos, los Términos no se publican y el Aviso omite las frases que dependen de ellos. Ver el bullet correspondiente al inicio de esta sección.
- **CI en GitHub Actions** (`.github/workflows/ci.yml`): en cada push/PR a `main` corre las pruebas unitarias de las dos puntas (`npm test`), el build del frontend (`npm run build`) y un chequeo de sintaxis de `backend/src`, `scripts/` y `tests/` (`node --check`, 47 archivos). Las pruebas van **antes** del build a propósito: tardan medio segundo y el build casi un minuto. No bloquea el deploy de Render/Vercel si falla — son procesos independientes, esto solo te avisa.
- **Bug corregido: registrar una liga daba 500.** `POST /leagues` (`routes/leagues.js`) tenía **19 placeholders para 18 columnas** en su `INSERT`, así que Postgres la rechazaba con "INSERT has more expressions than target columns" y ninguna liga nueva se podía crear. Preexistente y sin relación con la cobranza — se topó de frente al intentar crear una liga de prueba para el recorrido de punta a punta. **Revisar si alguien intentó registrar una liga y no pudo.**
- **Verificación de la sesión**: las dos suites de punta a punta corrieron contra una rama de Neon con **46 aserciones y 0 fallas**, y encima se hizo la **QA visual en navegador** — se revisó el panel del equipo, se confirmó que la tarjeta del estado de cuenta público se ve bien, y se mandó un **WhatsApp real** desde el panel (ese link se arma en el cliente y no pasa por el backend, así que ninguna prueba automática lo cubre). La rama de prueba se borró al terminar.
- **Dos suites de punta a punta** (`backend/tests/`, ver su README): ejercitan los dos libros contra un backend vivo apuntado a una rama de Neon, nunca a producción. No corren en el CI. Cubren lo único que no se puede revisar leyendo el código — que el saldo cuadre después de cancelar, rechazar y retirar. Fueron las que cazaron los dos bugs de arriba.
- **Conciliación en los dos libros**: quien paga ahora puede reportar su pago con comprobante y quien cobra lo confirma con un clic — el equipo hacia su liga (`POST /billing/teams/:id/report-payment`) y el jugador hacia su club. El pago nace `pending` y **no mueve el saldo** hasta que lo confirman; rechazarlo no genera ajuste (nunca entró al saldo) y quien lo reportó lo puede retirar si se equivocó. Esto era lo que quedaba "Fuera de la V1" de Cobranza.
- **Pasada de estilo al panel de cobranza de la liga**: `BillingLeaguePanel` adoptó las piezas que nacieron para el panel del equipo (`.data-table`, `ConfirmDialog`, `LedgerEntryList`, `utils/money.js`) y borró su copia de cada una — incluido el `window.confirm` del navegador para cancelar un movimiento contable y la clase `billing-table`, que no existía en ninguna hoja de estilo. Se le agregó la tira de KPIs (por cobrar, vencido, % al corriente) derivada de datos que el overview ya devolvía.
- **Cobranza liga → equipos ("estado de cuenta") — V1**: la liga registra desde `/panel/liga/:id/cobranza` lo que cobra cada semana a sus equipos (renta de campo, arbitraje, transmisión, inscripción, multas), lleva un **libro append-only** por equipo y ve el panorama de adeudos. El monto es **por equipo** (tabla con casilla por equipo + botón que lo calcula como cuota × # de partidos de ese equipo en la jornada). El representante del equipo ve su estado de cuenta **de solo lectura** en `/panel/equipo/:id/estado-de-cuenta` y recibe recordatorios (cargo nuevo / por vencer / vencido / pago registrado) en su bandeja. En esta V1 **solo la liga escribe** — no hay flujo de "el equipo reporta un pago". Detalle completo en la sección "Cobranza" del README.
- **Roster por plantilla de Excel**: además del alta manual jugador por jugador que ya existía, ahora se puede descargar (desde el modal de roster de un equipo dentro de una rama) una plantilla `.xlsx` con el logo de la liga, el logo del equipo y el contexto (Liga/Torneo/Categoría/Rama/Equipo) ya incrustados, llenarla y volver a subirla — solo agrega a los jugadores que todavía no estén en esa rama, nunca borra a nadie. Se agregó CURP a `players` y un botón de foto por jugador (Cloudinary). Detalle completo en la sección "Roster de jugadores" del README.
- **Equipos independientes (sin liga)**: un equipo ya se puede registrar directo desde `/registrar-equipo` sin pertenecer a ninguna liga de la plataforma (`teams.league_id` ahora es opcional). Usa el mismo mecanismo de verificación de identidad que cualquier otra organización (`organizations.is_verified`, admin desde `/admin`) — antes esa pestaña excluía a todos los equipos. Aparecer en el home es decisión propia del equipo (`show_on_platform`, interruptor sin aprobación de nadie, se prende/apaga desde su panel) y no limita ninguna otra función; un equipo de liga sigue apareciendo exactamente igual que antes, sin cambios. Detalle completo en la sección "Equipos independientes" del README.
- **Footer ya no se pinta negro por default**: `.footer` en `styles.css` tenía `background: #000` fijo, así que se veía como una barra negra sólida en cualquier página, sin importar si esa sección tenía o no un panel negro real detrás (ej. el Home, que no usa panel negro en ningún lado). Se cambió a `background: transparent` para que herede el fondo verde de cancha del `body`, igual que el resto del sitio.
- **Travelpayouts Drive removido de `frontend/index.html`**: ese script reescribía automáticamente los links salientes a marcas de viaje y podía insertar ofertas/contenido propio en la página — se quitó a petición explícita (no se quieren anuncios ni contenido que "salte" en el sitio), y porque Brave Shields (y listas de bloqueo tipo EasyPrivacy) lo bloqueaban de cualquier forma. **Efecto directo: el botón 🏨 Hotel en `MatchPage` dejó de generar comisión** — era el único mecanismo que agregaba el marcador de afiliado al link de Booking.com. El botón ✈️ Vuelo (widget de Aviasales) no se afectó — trae su propio marcador embebido, independiente de Drive. Detalle y alternativa sin Drive en "Monetización" del README.
- **Diagnóstico de pantalla en blanco en `localhost` (solo en dev, no afecta producción)**: `PrivacyPolicy.jsx` se importaba de forma estática en `App.jsx`. En dev, Vite sirve cada componente como su propio archivo (`/src/pages/PrivacyPolicy.jsx`), y Brave Shields bloquea por heurística cualquier URL que contenga la palabra "privacy" — al bloquearse ese import estático se rompía la carga de **toda** la app (pantalla en blanco). En producción no pasaba porque Vite empaqueta todo en un solo bundle sin nombres de archivo reconocibles, pero el riesgo estaba ahí para cualquier página que en el futuro se cargara distinto.
- **Code-splitting por ruta** (`App.jsx` + `vite.config.js`): todas las páginas excepto `Home` ahora se cargan con `React.lazy()` dentro de un `<Suspense fallback={<Loading />}>`, y los chunks resultantes se nombran con hash genérico (`chunkFileNames: 'assets/chunk-[hash].js'` en `vite.config.js`) en vez del nombre real de cada página — así ningún bloqueador puede tumbar una página por su nombre. Efecto medido con `npm run build`: el bundle principal bajó de 946 KB a ~300 KB; el resto se reparte en ~40 chunks pequeños que se descargan solo al entrar a esa página. Bonus: si algún chunk llega a fallar (bloqueado, red lenta), el `ErrorBoundary`/`Suspense` ya existentes lo contienen a esa sola página — TopBar, SponsorBar y footer siguen funcionando.
- **Panel negro (`dashboard-panel`) ahora envuelve el contenido de `Dashboard.jsx`, `LeagueStructurePanel.jsx` y `TournamentMatchesPanel.jsx`** — antes solo lo tenía `Dashboard.jsx` en parte de su contenido. **Verificado en navegador el 2026-09-17 para `Dashboard.jsx` y `LeagueStructurePanel.jsx`** (el panel se ve bien y el contenido no se desborda); `TournamentMatchesPanel.jsx` sigue sin verificarse, porque llegar a esa pantalla pide categoría, rama y partidos — ver "Pendientes abiertos" en el README (en los dos últimos archivos el `<div>` nuevo no reindentó el contenido interno — cosmético en el código fuente, no afecta el render).
- **Varios administradores por liga o equipo ("Invitar administrador")**: una liga o un equipo ya puede tener más de una persona con acceso simultáneo a su panel, no solo un dueño único — mismo mecanismo que ya existía para "entregar" un equipo a su representante, pero sin reemplazar a nadie. Nuevo tipo de invitación `org_admin` (`routes/invites.js`, columna `invites.organization_id`) que, al reclamarse, agrega a esa persona como fila nueva en `organization_members` en vez de sustituir al dueño actual. Nuevas rutas `GET/DELETE /organizations/:id/members` para listar y quitar administradores (no deja quitar al último — evita dejar la organización sin nadie). Botón "+ Invitar administrador" y la lista correspondiente viven en el componente nuevo `OrgAdminsPanel.jsx`, presente en el panel de equipo (`Dashboard.jsx`) y en el panel de liga (`LeagueStructurePanel.jsx`). Por ahora todos los administradores tienen el mismo permiso — no hay jerarquía de roles todavía (`owner`/`admin`/`editor` no se distinguen, ver `isOrgMember`).
- **Dos huecos corregidos para que lo anterior funcione de punta a punta**: (1) `GET /auth/me` calculaba `leagues`/`teams` solo por `owner_user_id` — alguien invitado como administrador nunca veía esa liga/equipo en "Mi panel" aunque el backend ya le diera permiso de editarla; ahora también cuenta la membresía activa en `organization_members`. (2) `POST /leagues` no creaba la fila en `organizations` ni el `organization_members` del dueño al momento de crear la liga (a diferencia de un equipo, que sí lo hacía desde siempre) — se quedaba así hasta el siguiente reinicio del servidor, que es cuando corre el backfill que lo completa; ahora una liga nueva nace con su organización y su dueño registrado de inmediato.
- **Pantalla vieja de liga retirada (`/panel/liga/:id`, modelo plano sin torneos)**: todo lo que hacía ya vivía en `LeagueStructurePanel.jsx` (`/panel/liga/:id/estructura`), la pantalla que de verdad se usa desde hace tiempo — se confirmó contra la base de datos que ninguna liga tenía ya partidos en el modelo viejo antes de quitarla. `Dashboard.jsx` bajó de ~800 a ~250 líneas (ahora solo sirve "Mi panel" y el panel de equipo). La ruta vieja redirige automáticamente a `/estructura` (`RedirectToLeagueStructure` en `App.jsx`) para no romper links guardados; el aviso "Abrir pantalla clásica" que apuntaba ahí también se quitó de `LeagueStructurePanel.jsx`.

### Cerrado y verificado

- **Los dos scripts de limpieza ya se corrieron contra la base real
  (2026-09-17)**, con el dueño de los datos confirmando que las dos filas eran
  suyas y de prueba:

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

- **QA visual del panel negro en `LeagueStructurePanel`** — **hecha en navegador
  (2026-09-17)**: el `.dashboard-panel` renderiza bien, el árbol crece dentro del
  panel sin desbordarlo y los modales (nuevo torneo, quitar administrador) se ven
  correctos. `TournamentMatchesPanel` sigue sin verificarse — llegar a esa
  pantalla pide categoría, rama y partidos, y la QA no llegó tan hondo (ver
  "Pendientes abiertos" en el README).

- **QA visual de "Invitar administrador"** — **hecha de punta a punta en
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
- **Quitar a quien registró la organización NO le quita el acceso** —
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
- **El registro de liga promete algo que no pasa** — **arreglado
  (2026-09-17)**. `RegisterLeague.jsx` decía "Tu liga aparecerá de inmediato en
  la página de inicio", y era falso: `leagues.is_public` nace en `FALSE`
  (`db.js`), el `INSERT` de `routes/leagues.js` no lo toca y la portada filtra
  `WHERE is_public = TRUE`. Comprobado creando una liga real: quedó
  `is_public=false` y no apareció en el listado público. Ahora el formulario dice
  lo que de verdad ocurre — que la liga empieza privada, que se puede cargar todo
  sin que nadie la vea, y que se publica cuando se pide desde el panel y el admin
  aprueba. El panel de la liga ya lo decía bien; el que prometía de más era este
  formulario.
- **Al aceptar una invitación no se sube el scroll** — **arreglado
  (2026-09-17)**, junto con el contraste de esa misma pantalla. La pantalla de
  éxito se pinta arriba, pero el navegador conservaba el scroll del formulario
  que acababa de desaparecer: lo primero que se veía era cancha vacía y parecía
  que el clic no había hecho nada (pasó en la propia QA). Ahora `InviteClaim.jsx`
  sube el scroll al llegar a éxito o a error. Y las **tres** pantallas de esa
  ruta (invitación, éxito y "ya fue utilizada") van dentro de `.dashboard-panel`
  como el resto del área con sesión — antes iban sueltas sobre el fondo de
  cancha, con el texto secundario en verde claro sobre verde. Verificado en
  navegador: `scrollY` pasa de 609 a 0 al aceptar.
- Revisar si alguien no pudo registrar su liga — **cerrado**. El bug de
  `POST /leagues` (19 placeholders para 18 columnas) está corregido.
  `scripts/diagnose-failed-leagues.mjs` quedó, pero **no sirve para contar
  intentos fallidos**: su primera versión listaba a los usuarios sin
  organización como sospechosos, y eso es ruido — en esta app la mayoría de las
  cuentas son de aficionados que entran por el calendario o la quiniela, y no
  tienen por qué administrar nada. El script ya no los lista.
- Configurar método de pago (payout) en Travelpayouts — **hecho**: ya está configurado el payout a PayPal.
- Botón de "Rechazar" una liga pendiente — **hecho (septiembre 2026)**, ver "Cambios recientes".

## Agosto 2026

- **Monetización de afiliados de viaje activada**: la plataforma ya genera comisión real sobre los botones de Hotel y Vuelo en `MatchPage`. Ver la sección "Monetización" del README para el detalle completo de cómo funciona y qué falta.
- **Travelpayouts Drive instalado** (`frontend/index.html`, `<script>` al inicio del `<head>`): convierte automáticamente los links salientes a marcas de viaje soportadas (ej. Booking.com) en links de afiliado, sin tocar el código de React que genera esos links.
- **Función de Vuelos construida** (antes solo era un comentario de "a futuro" en el código): nuevo componente `frontend/src/components/FlightSearchWidget.jsx` y utilidades nuevas en `matchServices.js` (`IATA_BY_CITY`, `iataForCity`). Al hacer clic en "✈️ Vuelo" en la tarjeta de un partido, se despliega un formulario de búsqueda de Aviasales embebido (vía Travelpayouts), con el destino ya puesto según la ciudad de la sede — el origen lo detecta Aviasales por la IP del usuario, y las fechas las ajusta el usuario a mano (el widget no acepta fecha por default; se le muestra la fecha del partido como referencia).
- El botón de Hotel (`buildHotelSearchUrl`) no cambió de código — sigue generando un link limpio a `booking.com/searchresults.html`; ahora es Drive quien le agrega el marcador de afiliado en el navegador del usuario.
- `buildFlightSearchUrl` y `ORIGIN_CITY_OPTIONS` en `matchServices.js` quedaron sin uso (eran de un primer approach con link directo + selector de ciudad de origen, reemplazado por el widget embebido). **Borrados en septiembre 2026** — nada los importaba. Lo que sí sigue vivo de ese archivo para vuelos es `IATA_BY_CITY` e `iataForCity()`, que es lo que `FlightSearchWidget` usa para resolver el destino.


## Julio 2026

- **Nuevo modelo de "Mi panel" — varias organizaciones por cuenta**: al crear una cuenta o iniciar sesión, ya no se entra directo al panel de una liga. `/panel` ahora muestra los logos de todas las ligas y equipos que administras (sin abrir ninguno automáticamente), cada uno con su propia URL (`/panel/liga/:id`, `/panel/equipo/:id`). Un clic abre su panel de trabajo; un segundo clic sobre el mismo logo lo cierra. Esto sienta la base para agregar más tipos de organización (empresa, medio) sin rediseñar de nuevo la navegación.
- **Pantalla "Registrar Organización"**: nuevo botón en el TopBar y nueva ruta (`/panel/registrar-organizacion`) desde donde se registran organizaciones nuevas. Por ahora solo tiene la opción "Registrar liga"; los demás tipos se agregan aquí más adelante.
- **Botón de notificaciones en el TopBar**: ícono nuevo (balón amarillo), con su propia página `/notificaciones` — todavía sin contenido conectado, es solo el punto de entrada.
- **Ligas nuevas quedan pendientes de aprobación**: al registrarse, una liga queda con `status = 'pending'` y no aparece en el sitio público hasta que un admin la aprueba desde `/admin` (pestaña "Ligas", botón "Aprobar"). El dueño puede seguir configurando su liga con normalidad mientras está pendiente.
- **Rediseño de la página pública de liga**: portada, logo, nombre, descripción, botones de "Compartir"/"Notificarme", pestañas (Categorías/Equipos/Sedes) y su contenido ahora viven dentro de un solo panel negro continuo. La foto de portada se muestra completa (sin recortar), en vez de forzarla a una altura fija.
- Arreglada la deformación de logos en las tarjetas de equipo cuando el nombre es largo (ya no se fuerza una altura fija a la tarjeta).
- `node_modules/` se sacó del control de versiones de Git.
- Endurecimiento de seguridad: CORS con whitelist, `JWT_SECRET` obligatorio (sin valor por defecto), rate limiting en login/registro, y reemplazo de la dependencia `xlsx` vulnerable (backend **y** frontend). Detalle completo en la sección "Seguridad" del README.
- Las migraciones de `db.js` usan un candado (advisory lock) para no chocar si algún día corren varias instancias del servidor a la vez.
- Se agregó `backend/.env.example` con los nombres de todas las variables de entorno necesarias (sin valores reales).
