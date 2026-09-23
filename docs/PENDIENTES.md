# Pendientes

El **único** lugar de lo que falta. Antes estaba repartido en cinco secciones
del README y ninguna tenía prioridad; así fue como un pendiente cerrado el
2026-09-21 seguía listado en tres lugares dos días después, y como la falta de
"olvidé mi contraseña" no aparecía en ninguno.

- Lo que se **cerró** pasa a [`CHANGELOG.md`](CHANGELOG.md) con fecha y
  verificación.
- El **porqué** de cada dominio sigue en el [README](../README.md), en la
  sección de su dominio. Aquí se enlaza, no se repite.
- El **nivel** de cada producto está en [`ESTADO.md`](ESTADO.md).
- Lo que un dominio dejó **fuera de su versión a propósito** no es pendiente:
  vive en el "Fuera de esta versión" de su sección.

## Las reglas

1. **El commit que cierra un pendiente borra su renglón** del índice y su
   sección, y deja la entrada en el CHANGELOG. Un pendiente cerrado que sigue
   aquí es peor que uno que falta: hace dudar de todo lo demás.
2. **Los ID no se reusan.** `PD-07` es siempre el mismo pendiente, aunque cambie
   de prioridad. Sirve para nombrarlo en un commit o en una conversación.
3. **No se empieza un plan nuevo con un P0 abierto.**
4. Cuando cambia la prioridad de algo, se cambia aquí y se dice por qué.

| Prioridad | Qué significa |
|-|-|
| **P0** | Puede perder datos, ya afecta a usuarios, o es un hueco que nadie sabía que existía |
| **P1** | Hoy no daña, pero frena el siguiente paso: la primera liga que cobre, la prueba en cancha, el siguiente cliente |
| **P2** | Deuda y pulido. Se toma cuando hay tiempo o cuando se toca ese archivo |

## Índice (2026-09-23)

| ID | P | Qué | Tipo |
|-|-|-|-|
| PD-01 | P0 | No hay respaldo propio de producción | operación |
| PD-02 | P0 | El cron de GitHub corre 5–8 veces al día, y el externo nadie lo identifica | operación |
| PD-03 | P0 | La API tarda ~40 s en despertar | dinero |
| PD-04 | P0 | No existe "olvidé mi contraseña" | código |
| PD-05 | P0 | La tarjeta pública del jugador publica su historial de equipos | código |
| PD-06 | P1 | `DELETE /admin/leagues/:id` borra el libro liga↔equipo | decisión |
| PD-07 | P1 | `teams.league_id` todavía da permisos | decisión |
| PD-08 | P1 | Las invitaciones no caducan | código |
| PD-09 | P1 | El día del partido no se ha probado en una cancha | verificación |
| PD-10 | P1 | Nadie le dice al visor que instale la app | decisión |
| PD-11 | P1 | `main` sin protección y el CI no frena el despliegue | configuración |
| PD-12 | P1 | Nadie avisa si el servicio deja de responder | configuración |
| PD-13 | P1 | No existe rescate de un equipo cuyo único dueño perdió acceso | código |
| PD-14 | P1 | ONEFA sin competencia configurada: su tabla no se ve | captura |
| PD-15 | P2 | `PUT /manage/teams/:id` no es atómico | código |
| PD-16 | P2 | El pie del estado de cuenta público es ilegible | decisión |
| PD-17 | P2 | Prorrateo de quien entra a media quincena | decisión |
| PD-18 | P2 | No hay auditoría del padrón | código |
| PD-19 | P2 | Respaldo por nombre en cuatro archivos | código |
| PD-20 | P2 | Dos vulnerabilidades altas con parche que no rompe | código |
| PD-21 | P2 | Rotar `CLOUDINARY_API_SECRET` | operación |
| PD-22 | P2 | Repo público sin `LICENSE` | decisión |
| PD-23 | P2 | Renombrar `/api/player-billing` | código |
| PD-24 | P2 | Scroll horizontal en el modal de la ficha del padrón | código |
| PD-25 | P2 | El pase de lista no tiene suite e2e | código |
| PD-26 | P2 | QA visual de `TournamentMatchesPanel` | verificación |
| PD-27 | P2 | Los menores del panel del club (M2, M3, M6, M7) | código |
| PD-28 | P2 | Cinco archivos concentran demasiado | deuda |
| PD-29 | P2 | Ramas viejas en local y en el remoto | limpieza |

---

## P0

### PD-01 · No hay respaldo propio de producción

No existe `pg_dump`, ni script, ni rutina de respaldo en ningún lado del
proyecto. Lo único que protege los datos es la restauración a un punto en el
tiempo que trae Neon, y en el plan gratuito esa ventana es de **horas**, no de
semanas. Si un borrado malo se nota al día siguiente, ya no se puede deshacer.

Lo que hay que proteger (ver "Qué hay en juego" en [`ESTADO.md`](ESTADO.md)): las
**1,648 predicciones** del concurso de ONEFA y su calendario. Y este proyecto ya
tuvo, en una semana, dos `ON DELETE CASCADE` que borraban de más con un solo
clic: el riesgo realista no es que Neon pierda la base, sino un borrado o una
migración propia.

**Una restricción que cambia el cómo:** el repositorio es **público**, así que
el respaldo **no** puede guardarse como artefacto de GitHub Actions. Llevaría
los correos de los usuarios y sus contraseñas cifradas.

### PD-02 · El cron de GitHub corre 5–8 veces al día, y el externo nadie lo identifica

**Medido el 2026-09-23** con `gh run list --workflow cron.yml`: el `schedule` de
`*/15 * * * *` produjo **5, 8, 5 y 6 corridas** del 19 al 22 de septiembre, con
huecos de **3 a 5 horas**. No son las ~96 al día que se suponían.

La cobranza aguanta eso: corre una vez al día y es idempotente. **Los avisos de
partido no.** El push de "próximo" solo sale si una llamada cae en la hora
anterior al partido (`NOTIFY_WINDOW_MS` en `routes/notifications.js`). Con
huecos de 3–5 horas, el cron de GitHub se lo salta casi siempre.

**Esto invierte un pendiente viejo.** El README decía "falta apagar el cron
viejo": un servicio **externo** llama al mismo endpoint, nadie recuerda cuál es,
y se trataba como un gasto duplicado. Con este número, ese servicio puede ser
justo lo que hoy sostiene los avisos de partido. **No se apaga hasta medir.**

Cómo se cierra:

1. En `/admin` → pestaña **Cron**, ver las llamadas de un día **completo**. Si
   son bastantes más de 8, el externo sigue vivo y es quien da la cadencia.
2. Identificarlo. La pestaña cuenta llamadas pero no dice de quién son;
   registrar el `User-Agent` de `POST /notifications/trigger` lo contesta en un
   día (el de GitHub es `curl/…`).
3. Decidir cuál es **el** scheduler, dejarlo escrito en el repo y medir que
   cumpla la cadencia. El de GitHub puede quedarse de respaldo: llamar de más es
   inofensivo por diseño (ver "Cadencia del cron" en el README).

Referencia que ya estaba escrita. Los dos secretos del repositorio (GitHub →
Settings → Secrets and variables → Actions):

| Secreto | Valor |
|---|---|
| `CRON_TARGET_URL` | `https://lifa-backend-p0hq.onrender.com/api/notifications/trigger` |
| `CRON_SECRET` | el mismo valor que la variable `CRON_SECRET` **del servicio en Render** |

Van en GitHub y **no** en el `.env`: el workflow corre en los servidores de
GitHub y nunca ve `backend/.env`. Si alguna vez hay que rotarlos, `CRON_SECRET`
tiene que coincidir con el de **Render**, no con el del `.env` local. Y GitHub
**deshabilita los workflows programados tras 60 días sin actividad** en el
repositorio: si el proyecto se queda quieto dos meses, este cron se apaga solo.

### PD-03 · La API tarda ~40 s en despertar

Render en plan gratuito duerme el servicio tras ~15 minutos sin tráfico.
**Medido el 2026-09-23**: `/api/health` contestó en **41.5 s**. Quien abre el
calendario de ONEFA con el servicio dormido ve la página vacía todo ese tiempo.
Las corridas de 50–60 s del workflow del cron son eso mismo: cada una despierta
a Render desde cero.

Con la cadencia real del cron (PD-02), nada lo mantiene despierto.

Salidas:

- **El plan de pago más bajo de Render.** Es la solución de fondo y es decisión
  de dinero, no de código. Era ya un pendiente de la Fase 1 del roadmap de
  negocio.
- Un ping externo cada <15 min (el mismo monitor de PD-12) lo mantiene despierto
  en plan gratuito. Antes de apoyarse en eso, verificar cuántas horas de
  instancia al mes incluye el plan gratuito de Render: un servicio despierto 24/7
  son ~744 h.

### PD-04 · No existe "olvidé mi contraseña"

Verificado el 2026-09-23: `routes/auth.js` tiene `register`, `login`,
`verify-email`, `resend-code`, `google` y `me`, y ni el backend ni el frontend
tienen ninguna forma de recuperar una contraseña. No estaba anotado en ningún
lado.

Un admin de liga que se registró con correo y contraseña y la olvida **se queda
fuera**. Y como tampoco existe el rescate de un equipo (PD-13), se queda fuera
también su organización.

Lo que ya existe y abarata: `RESEND_API_KEY` y `EMAIL_FROM` están configurados
y se usan para los códigos de verificación, así que el correo no pide cuenta
nueva. Falta decidir el modelo antes del código: código por correo (como la
verificación) o link con token, cuánto dura, y qué pasa con las sesiones
abiertas. Un JWT de 7 días no se puede revocar hoy.

### PD-05 · La tarjeta pública del jugador publica su historial de equipos

Es lo que queda de recortar la tarjeta pública, y va contra la regla 7 de
`CLAUDE.md` en una población con muchos menores. `GET /players/:id/card`
devuelve `trajectory` (`routes/players.js`), que es de una **tarjeta
histórica** y no de la de temporada. La tarjeta describe la participación de
**una** temporada; juntar una carrera en un solo lugar es otra función (que el
jugador "recolecte" su tarjeta) que no existe y no está diseñada. Ver "Qué se
publica de un roster, y qué no" en el README.

La otra mitad se cerró el 2026-09-20: la foto ya sale solo si la categoría la
permite y el equipo no la vetó.

---

## P1

### PD-06 · `DELETE /admin/leagues/:id` borra el libro liga↔equipo

`teams.league_id` ya es `SET NULL` y el equipo sobrevive, pero
`team_ledger_entries` tiene **su propia** llave a la liga, y esa sigue siendo
`ON DELETE CASCADE`:

```sql
team_ledger_entries.league_id → leagues(id) ON DELETE CASCADE
```

Medido en la rama de pruebas: con 5 movimientos colgando, sobreviven **0 de 5**.
La regla 5 dice que un movimiento no se edita ni se borra, y aquí un clic los
borra todos. El endpoint sigue siendo un `DELETE FROM leagues` pelón, sin
pregunta previa.

**Se decide antes de escribir código**, porque las dos salidas dicen cosas
distintas:

1. **Una liga con movimientos no se borra.** `RESTRICT` en el esquema y un 409
   con motivo en el endpoint, igual que `DELETE /manage/teams/:id`.
2. **Se borra, y el libro queda sin liga.** Obliga a que `league_id` deje de ser
   `NOT NULL` ahí, y a contestar qué significa un saldo con una liga que ya no
   existe.

Hoy no hay nada que perder (0 movimientos en producción al 2026-09-22) y solo
el admin de la plataforma alcanza ese botón. **Pasa a P0 el día que una liga
cobre el primer peso.** Ver "Jubilar `teams.league_id`" en el README.

### PD-07 · `teams.league_id` todavía da permisos

`guardaDeEquipo()` y `teamLeagueOwnerRequired` (`middleware/ownership.js`) leen
`team.league_id` para decidir **quién administra** un equipo. Por eso una liga
que ya entregó un equipo sigue editando su perfil y su roster.

Es el punto 2 de "Lo que falta para que un equipo viva en varias ligas" en el
README, y es un cambio de modelo: moverlo obliga a decidir si una liga que ya
entregó un equipo conserva su roster de torneo. Las tres preguntas que hay que
contestar antes del código están escritas ahí.

### PD-08 · Las invitaciones no caducan

`invites` no tiene `expires_at`; el único freno es `used_at`. Un link que nunca
se usó sigue sirviendo indefinidamente, hasta que se genere otro para la misma
organización y el mismo rol. El link se manda por WhatsApp y se usa en el
momento, pero si alguien reenvía un chat viejo, ese link todavía funciona, y
ahora puede llevar rol de **dueño**.

### PD-09 · El día del partido no se ha probado en una cancha

El pase de lista y la captura por jugada corrieron de punta a punta contra la
compilación real, pero con **Chromium y el modo offline de Playwright**. Eso
apaga la red, pero no mata la pestaña, no se queda sin batería y no tiene al
administrador de memoria de Android cerrando la app a media captura. Que es
justo el escenario para el que se construyó "Capturar sin señal".

Ya está desplegado (2026-09-20), así que no lo bloquea nada. Tres cosas que
mirar durante la prueba:

1. **Si la jugada mínima es de verdad mínima.** Ciento veinte capturas
   seguidas, con el partido enfrente, son lo único que lo contesta. Si no lo es,
   la salida ya está escrita: bajar de `full` a `offense` no migra nada.
2. **El riesgo que no se puede tapar**: mientras no suben, las capturas viven
   solo en ese teléfono. La pantalla lo dice y el navegador avisa al salir, pero
   nada de eso se ha visto en manos de alguien que no escribió el código.
3. **Que el `apple-touch-icon` se instale bien en iOS.** El PNG ya se midió
   opaco en la esquina (`rgba(47,122,53,255)`); lo único que falta es ver cómo
   lo recorta iOS al agregarlo a inicio.

Y un dato que la prueba debe traer de vuelta: **si en iOS la app instalada
tiene almacenamiento separado del Safari normal.** Si lo tiene, hay que instalar
**antes** de "⬇ Preparar partido", o lo preparado se queda en la pestaña y la
app abre vacía.

### PD-10 · Nadie le dice al visor que instale la app

Verificado el 2026-09-21: **cero** ocurrencias de `beforeinstallprompt`,
`appinstalled` o de cualquier texto de instalación en `frontend/src/`. Todo
"Capturar sin señal" se sostiene en que una app instalada aguanta mucho mejor
que una pestaña, pero el producto nunca lo pide.

Son dos problemas distintos:

- **Android/Chrome se resuelve con código**: se captura
  `beforeinstallprompt` y se ofrece como botón propio.
- **iOS no se puede provocar.** Es Compartir → "Añadir a pantalla de inicio",
  **solo en Safari**. Ahí la solución es una instrucción en pantalla.

Falta decidir: en qué pantalla se dice (¿al llegar a la captura?, ¿al preparar
partido?), si se insiste o se dice una vez, y si se detecta
`display-mode: standalone` para no molestar a quien ya instaló. El dato de iOS
de PD-09 decide además **cuándo** decirlo.

### PD-11 · `main` sin protección y el CI no frena el despliegue

Verificado el 2026-09-23: `main` no tiene reglas de protección y el repositorio
es público. Render y Vercel despliegan en cuanto llega un push a `main`, sin
esperar el resultado del CI, así que un push con pruebas fallando llega a
producción igual.

Cómo se cierra, y es configuración, no código:

- En GitHub, proteger `main` con los jobs `frontend-build` y
  `backend-syntax-check` como checks obligatorios.
- En Render y Vercel, que el despliegue espere al CI.
- Trabajar en rama y entrar a `main` por PR, aunque sea una sola persona. El
  PR es el punto donde revisar antes de que algo llegue a producción.

Lo grande de la Fase 3, correr las suites e2e en el CI contra una base efímera,
va después de esto.

### PD-12 · Nadie avisa si el servicio deja de responder

Sentry avisa de errores, pero si el backend simplemente no contesta, nadie se
entera. Un monitor externo contra `/api/health` lo resuelve y, de paso, ayuda
con PD-03. Es la Fase 3 del roadmap de negocio.

### PD-13 · No existe rescate de un equipo cuyo único dueño perdió acceso

Desde el 2026-09-20 un equipo puede tener varios dueños, así que perder una
cuenta deja de ser fatal **si** alguien invitó a un segundo. Si no, no hay flujo
para reclamarlo. La salida existe pero no está en ninguna pantalla: un admin de
la plataforma invita a la persona como `admin` y después le cede el puesto con
`transfer-owner`. Ver "Equipos independientes" en el README. PD-04 lo vuelve
más probable.

### PD-14 · ONEFA sin competencia configurada: su tabla no se ve

Es captura, no código. Su temporada está en curso y no tiene fases ni títulos
declarados, así que su página pública no muestra tabla. Se hace desde
Estructura → rama → **⚙ competencia**. Es lo que lleva la tabla de posiciones de
nivel 4 a nivel 5 en la única liga con uso real. Ver "Lo que queda abierto" en
"Tabla de posiciones y modelo de competencia".

---

## P2

### PD-15 · `PUT /manage/teams/:id` no es atómico

Son tres escrituras sueltas: `UPDATE teams`, `UPDATE organizations` y
`syncTeamLinksToMatches()` (una consulta por partido). Cualquier error después
de la primera deja el equipo **guardado** y a la persona viendo "Error interno
del servidor". Es exactamente lo que confundió en el bug del país vacío (ver el
CHANGELOG). Hoy no se conoce ningún error entre el paso 1 y el 3; lo que queda
vivo es el **modo de falla**.

Los dos caminos:

1. **Una sola sentencia con CTEs**, el patrón de
   `POST /organizations/:id/transfer-owner`. El paso 3 obliga a convertir el
   bucle en un `UPDATE matches … FROM`.
2. **Exponer una transacción de verdad**, `db.transaction(async (tx) => …)`.
   `initSchema()` ya saca **un** cliente del pool y hace
   `BEGIN`/`SAVEPOINT`/`COMMIT` sobre él a través del pooler de Neon, y
   funciona. Un pooler en modo transacción **sí** soporta transacciones mientras
   vivan en **una sola conexión**; lo que no soporta es repartirlas entre
   varias, que es lo que hace `db.prepare`.

La 2 es la preferida: sirve para cualquier otra ruta con el mismo problema. Va
como cambio aparte, porque toca `db.js`, del que depende todo.

### PD-16 · El pie del estado de cuenta público es ilegible

El párrafo "¿Algo no cuadra? Escríbele a tu club…" de
`PlayerStatementPage.jsx` usa `--ws-ink-faint` (#6b7378) y cae **fuera** de la
tarjeta negra, directo sobre el verde de la cancha: **1.16:1** de contraste,
donde AA exige 4.5:1. Es el mismo problema que arregló `eadac84` para las
tarjetas, pero este párrafo quedó fuera. Es una decisión de diseño: meterlo en
la superficie oscura o darle un color que aguante el verde.

### PD-17 · Prorrateo de quien entra a media quincena

El ciclo le cobra el mes completo a quien esté `activo` al generar, y solo se
salta los periodos con fecha de pago anterior a su `joined_date`. Si un club
espera cobrar medio mes a quien entró el día 20, no está resuelto. Se puede
agregar sin tocar la idempotencia, porque `auto_cycle_key` no depende del monto.

### PD-18 · No hay auditoría del padrón

Se sabe cuál es la cuota de alguien, no quién se la cambió ni cuándo. El patrón
a imitar ya existe: el trío `created_by_user_id` / `voided_by_user_id` /
`reverses_entry_id` del libro.

### PD-19 · Respaldo por nombre en cuatro archivos

`board.js`, `manage.js` (el importador de Excel y la ficha de un equipo),
`notifications.js` y `admin.js` todavía buscan equipos por nombre usando
`teams.league_id`. Es el mismo patrón que se resolvió en `leagues.js` el
2026-09-22 y se arregla igual. De esos, solo `board.js` es público. Ver "Lo que
todavía lee la columna" en el README.

### PD-20 · Dos vulnerabilidades altas con parche que no rompe

`npm audit` al 2026-09-23: en el backend, `ip-address` (alta) y `qs`
(moderada), y en el frontend, `nanoid` (alta). Las tres se arreglan con
`npm audit fix`, sin cambio mayor. El README solo documenta las dos del
frontend que se evaluaron y se aceptaron (`vite` y `react-router`); estas son
otras. `uuid`, vía `exceljs`, pide un cambio mayor y hay que evaluarla aparte.

### PD-21 · Rotar `CLOUDINARY_API_SECRET`

Pendiente desde la Fase 1 del roadmap de negocio.

### PD-22 · Repo público sin `LICENSE`

Verificado el 2026-09-23: el repositorio es **público**. Sin licencia, nadie
tiene permiso de reusar el código, pero todo el mundo puede leerlo, incluido
el README con sus decisiones internas. Es decisión de negocio: o el repo pasa a
privado, o lleva una licencia propietaria explícita. Hoy no es ninguna de las
dos cosas, y no porque se haya elegido así. Si pasa a privado, revisar antes
que Render y Vercel sigan pudiendo leerlo.

### PD-23 · Renombrar `/api/player-billing`

Es lo único que quedó de la fase B (ver "Cuotas del club"). El prefijo y
`routes/playerBilling.js` siguen diciendo "player" donde quieren decir "miembro
del club". Mueve los 18 endpoints del router de un golpe, incluidos los tres
públicos del papá, y **toda esta clase de cambio tiene ventana de
incompatibilidad al desplegar** (está explicado en "Fase B"). Con el prefijo van
`created_by_side = 'player'` y los tipos de notificación `player_*`, que son
valores guardados y piden migración.

### PD-24 · Scroll horizontal en el modal de la ficha del padrón

Las rejillas de "Categoría / Número / Posición" y "Cuota / Situación" desbordan
el ancho del modal. Es anterior a la fase B y está medido en "Fase B".

### PD-25 · El pase de lista no tiene suite e2e

Sus rutas se probaron a mano contra la rama de Neon (los cinco casos del `PUT` y
las cuatro fronteras de permiso) y el resultado está en el CHANGELOG, pero nada
de eso corre solo. Ya salió barato: `plays.e2e.mjs` construye el mismo andamio
(liga, torneo, categoría, rama, equipos inscritos, roster con una baja a media
temporada, partidos vinculados) y no cubre asistencia, así que a esta suite solo
le queda pagar lo suyo.

### PD-26 · QA visual de `TournamentMatchesPanel`

Es la única de las tres pantallas con `.dashboard-panel` que no se ha revisado
en el navegador: llegar a ella pide categoría, rama y partidos. `Dashboard` y
`LeagueStructurePanel` se revisaron el 2026-09-17.

### PD-27 · Los menores del panel del club

Siguen abiertos cuatro de la revisión del 2026-09-18, con su detalle en
[`panel-del-club-hallazgos.md`](panel-del-club-hallazgos.md):

- **M2**: el CURP se valida contra duplicados en el alta pero no en el `PATCH`,
  y no hay índice único. Dos altas simultáneas con el mismo CURP entran las dos.
- **M3**: el id del miembro se llama `member_id` en el overview y `member.id`
  en el resto.
- **M6**: las tres secciones piden el overview completo.
- **M7**: "Por cobrar" incluye a los dados de baja y la pantalla no lo dice.

### PD-28 · Cinco archivos concentran demasiado

Hoy funcionan y no hay razón para tocarlos, pero ahí es donde va a doler.
Medido el 2026-09-23:

| Archivo | Líneas | Qué concentra |
|---|---|---|
| `frontend/src/styles.css` | 4,463 | **Todos** los estilos de la app |
| `backend/src/routes/manage.js` | 2,358 | El CRUD entero de liga, torneo, categoría, rama, equipo, sede y partido |
| `backend/src/config/db.js` | 2,262 | Las 44 tablas y ~150 migraciones |
| `frontend/src/pages/LeagueStructurePanel.jsx` | 1,157 | El árbol completo del panel de liga |
| `frontend/src/pages/AdminPanel.jsx` | 1,143 | Las pestañas de `/admin` |

`db.js` es el que tiene techo real: creció 30% desde la última medición y el
arranque corre todas las migraciones. El día que estorbe, la salida es congelar
las migraciones viejas en un esquema base y dejar en `db.js` solo las nuevas.
Partirlo antes de tiempo costaría la tolerancia a fallos del `SAVEPOINT` por
instrucción.

### PD-29 · Ramas viejas en local y en el remoto

`dia-del-partido` apunta al mismo commit que `main`; `roles-de-organizacion` ya
está contenida en `main`; `origin/panel-equipo-y-cuotas-del-club` tiene dos
commits que no están en `main` con esos hashes (probablemente versiones previas
de commits que ya entraron). Revisar y borrar.

---

## Siguiente alcance (no son defectos)

Lo que sube un producto de nivel pero no es algo roto. Se decide cuándo entra;
no bloquea nada de lo de arriba.

- **Cobro en línea**: la Fase 2 del roadmap de negocio y el bloqueador de fondo
  para cobrar. Ninguna pasarela instalada.
- **Conectar el bot de WhatsApp**: falta el número de WhatsApp Business
  (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`) y saldo en la cuenta de
  Anthropic. **Antes** de conectarlo: cubrir en el Aviso de Privacidad qué guarda
  `bot_messages` (teléfono y conversación de clientes sin cuenta) y ponerle
  borrado por antigüedad, porque hoy crece sin límite.
- **Comisión de Hotel**: configurar `VITE_HOTEL_AFFILIATE_ID` en Vercel con un
  ID de afiliado directo de Booking.com. Ver "Monetización".
- **Bandeja propia del jugador o tutor**, y que el recordatorio de cobranza
  **salga** de la plataforma (correo al tutor). Hoy es imposible:
  `notifications` tiene `CHECK (recipient_type IN ('league','team'))` y los
  jugadores no tienen cuenta.
- **Permisos de colaboración entre organizaciones**: punto 2 de "Roadmap — en
  construcción".
- **Credencial digital con QR**: ver "Roster de jugadores".
- **Orden configurable en `computeQualification`**: ver "Tabla de posiciones".
- **Correos de onboarding**: Fase 4 del roadmap de negocio.

## Lo que parece pendiente y no lo es

Para que nadie lo "arregle":

- **Los `lifa` que quedan** (carpeta del repo, servicio de Render, llaves de
  `localStorage`, carpetas de Cloudinary) son deliberados: renombrar
  `lifa_token` desloguea a todos, y cambiar las carpetas separa los archivos
  viejos de los nuevos. El nombre es CFBAMX y opera José Alfredo Reyes Silva
  como persona física (ver `frontend/src/config/legal.js`).
- **La hoja de visoría no se diseña todavía**, a propósito: se arma con lo que
  la captura por jugada ya esté produciendo.
- **`vite` y `react-router` en `npm audit`**: evaluadas y aceptadas, ver
  "Seguridad" en el README.
- **El respaldo por nombre en `GET /categories/:id/matches`** hoy no resuelve ni
  un partido y se conserva igual: es lo único que pone logos a un calendario
  importado por Excel sin enlazar.
