# Panel del club — errores y áreas de oportunidad

> **Estado (2026-09-23).** Los diez hallazgos mayores están cerrados: H1, H2,
> H3, H7 y H8 el 2026-09-18; H4, H9 y H10 el 2026-09-19; H6 el 2026-09-20; H5
> el 2026-09-21. Cada uno tiene su entrada en `docs/CHANGELOG.md` y su marca ✅
> abajo. De los menores se cerraron M1, M5 y M8; **M2, M3, M6 y M7 siguen
> abiertos** y viven en `docs/PENDIENTES.md` como `PD-27`, y M4 no es un
> defecto. Las "Áreas de oportunidad" del final son producto, no pendientes.
>
> Este documento se deja como está por lo que explica. Lo que falta ya no se
> sigue aquí sino en `docs/PENDIENTES.md`.

Revisión de lectura del código (2026-09-18), aparte del guion descriptivo
(`docs/panel-del-club-guion.md`). **Nada de esto se verificó corriendo la app ni
contra la base**: son hallazgos de lectura, y donde digo "revienta" quiero decir
"el código dice que revienta". Los que tienen consecuencia en producción van
primero.

Lo que ya está anotado en "Pendientes abiertos" del README **no se repite aquí**
(roles `editor` con acceso a la cobranza, renombre del prefijo
`/api/player-billing`, datos legales, scroll horizontal del modal de la ficha).

---

## H1 · ✅ CERRADO · El interruptor de recordatorios está desconectado

**Severidad: alta. Está en producción hoy.**

| Lado | Clave que usa |
|---|---|
| `frontend/src/components/TeamFinancesSection.jsx:99-101, 238` | `member_billing_reminders_enabled` |
| `backend/src/routes/playerBilling.js:309, 861-863` | `player_billing_reminders_enabled` |

Dos consecuencias, no una:

1. **La casilla siempre se pinta desmarcada.** `data.team.member_billing_reminders_enabled`
   es `undefined` porque el overview nunca devuelve esa clave.
2. **Cualquier clic la guarda en `false`.** El handler manda
   `{ member_billing_reminders_enabled: next }`, y el backend hace
   `Boolean(req.body?.player_billing_reminders_enabled)` → `Boolean(undefined)`
   → `false`. Un club que tuviera los recordatorios prendidos los pierde en el
   primer clic y **no hay forma de volver a prenderlos desde la UI**. El estado
   local sí cambia a marcado, así que la pantalla miente hasta que se recarga.

**Origen:** commit `dcf6ac7` ("El padrón del club deja de decir 'players'"). El
renombre de la fase B alcanzó a una clave que el propio README marcaba como
intocable: *"`player_billing_reminders_enabled` (columna de `teams`) … son
columnas y valores guardados, no superficie"*. Es exactamente la regla 6 de
`CLAUDE.md` rota: se cambió en un lado y en los otros dos no.

**Arreglo:** devolver esas cuatro referencias del frontend a
`player_billing_reminders_enabled`. Es un `sed` en un archivo.

**Lo que esto dice del proceso:** el smoke test de contrato de 18
comprobaciones de la fase B cazó tres roturas y dejó pasar esta. Vale la pena
que ese script compare **todas** las claves que el frontend lee de
`data.team.*`, no solo las de `members`.

---

## H2 · ✅ CERRADO · Al dar de alta a alguien, su "Situación" se ignora en silencio

**Severidad: alta. Cuesta dinero mal cobrado.**

`ClubMemberForm` siempre manda `status` (`frontend/src/components/ClubMemberForm.jsx:76`),
y el select de **Situación** está visible tanto al crear como al editar. Pero
`POST /teams/:id/members` (`backend/src/routes/playerBilling.js:567-630`) **no
desestructura ni inserta `status`**: la fila nace con el `DEFAULT 'activo'` del
esquema.

Cadena completa del daño: das de alta a alguien como **Becado** → se guarda
Activo → el mes siguiente aprietas *"Usar la cuota de cada quien"* → como no es
`beca`, se le llena su `monthly_amount` en vez de 0 → **le generas un cargo a
un becado**. Se arregla solo si alguien se acuerda de entrar a la ficha después
del alta y volver a poner "Becado" (por `PATCH` sí funciona).

**Por qué no lo cazó nadie:** la suite e2e (`backend/tests/billing-player.e2e.mjs:48`)
crea a ANA con `status: 'beca'`, **no lo asserta**, y en el cargo le pasa
explícitamente `amount: 0`. La aserción "el becado se omitió" pasa por el 0
explícito, no porque el estado se haya guardado.

**Arreglo:** agregar `status` al destructuring y al INSERT, validado contra
`ACCOUNT_STATUSES` como ya lo hace el PATCH, y una aserción en la e2e.

---

## H3 · ✅ CERRADO (se retiró el endpoint) · "Repetir el mes pasado" le vuelve a cobrar a los dados de baja

**Severidad: alta. Contradice lo que promete la pantalla.**

`POST /teams/:id/charges/repeat` (`playerBilling.js:395-430`) filtra a los
destinatarios con `membersOfTeam()` (`playerBilling.js:122`), que solo pregunta
*"¿esta fila existe en `club_members` de este equipo?"*. **No mira `status`.**

Y una baja es precisamente una fila que sigue existiendo: `DELETE .../members/:memberId`
solo pone `status='baja'` cuando la persona **ya tiene movimientos** — o sea,
justo cuando estuvo en el lote que se va a repetir.

Lo que dicen las tres fuentes que sí están de acuerdo entre ellas, y que el
código no cumple:

- README: *"Solo jugadores que sigan en el plantel … si alguien se dio de baja
  entre un mes y otro, no se le vuelve a cobrar"*.
- `RepeatPlayerChargeModal`: *"para los N jugadores que sigan en el plantel"*.
- `PlayerChargeForm` (el otro camino): **sí** excluye las bajas
  (`members.filter(p => p.status !== 'baja')`).

Dos formas de generar el mismo cargo, con criterios distintos.

**Segundo defecto en el mismo endpoint:** la consulta del lote de origen
(`playerBilling.js:403`) trae los cargos sin filtrar por `status`, así que un
cargo **cancelado** en septiembre se vuelve a crear en octubre.

**Arreglo:** filtrar `status <> 'baja'` al repetir (en el handler, no en
`membersOfTeam`, que también lo usan el alta de pagos y el libro), y agregar
`AND status <> 'void'` a la consulta del lote.

---

## H4 · ✅ CERRADO (2026-09-19, `6e2e4de`) · No hay manera de rotar el link público desde ninguna pantalla

**Severidad: media-alta. Es un hueco de seguridad sin remedio operativo.**

`POST /teams/:id/members/:memberId/rotate-token` existe y funciona.
`api.rotateMemberShareToken` existe (`frontend/src/api/client.js:579`).
**Ningún componente la llama** — lo verifiqué con un grep sobre todo `frontend/src`.

Consecuencia: el `share_token` es un secreto permanente y sin caducidad que
abre una pantalla con nombre, foto, saldo, historial completo de pagos y el
botón de reportar pagos a nombre de esa persona. El README documenta la rotación
como el remedio de "si se filtró en el grupo equivocado", que es un escenario
cotidiano en un club (se pega el link en el chat de la categoría en vez del
privado). Hoy ese remedio no se puede ejecutar sin entrar a la base.

**Arreglo:** un botón en el modal de la Ficha — *"Regenerar link (el anterior
deja de funcionar)"* — con `ConfirmDialog`, que es donde ya está el contexto de
esa persona.

---

## H5 · ✅ CERRADO (2026-09-21, `db4eccc`) · Borrar un equipo borra su contabilidad completa, en cascada

**Severidad: media-alta. Choca de frente con la invariante del libro.**

`DELETE /api/manage/teams/:id` (`backend/src/routes/manage.js:1773`) es un
`DELETE FROM teams` pelón. El esquema encadena:
`teams` → `club_members` (`ON DELETE CASCADE`) → `club_ledger_entries`
(`ON DELETE CASCADE`).

Todo el trabajo de "un movimiento no se edita ni se borra; cancelar es void +
ajuste" se puede deshacer con un clic, **y no necesariamente por el club**: la
guarda es `teamOwnerRequired`, que también deja pasar a los administradores de
la **organización de la liga**, y el panel de la liga ya tiene el botón
(`frontend/src/pages/LeagueStructurePanel.jsx:209`, 🗑 "Eliminar equipo"). Una
liga que quiere "limpiar equipos viejos" borra de paso la cobranza privada de
ese club con sus familias.

El diálogo de esa pantalla no menciona nada de esto.

**Arreglo, en orden de lo que yo haría:**

1. Que el `DELETE` responda 409 si `club_ledger_entries` tiene filas de ese
   equipo, con un mensaje que diga por qué. Un libro de dinero no se borra como
   efecto secundario de una limpieza — es el mismo criterio que ya se aplicó
   para no dropear `team_player_accounts` desde una migración.
2. Si hace falta poder "sacar" un equipo, que sea `status`/soft-delete, no
   `DELETE`.
3. Aunque se quede como está: el diálogo de la liga debe decir cuántos
   movimientos y cuántas personas del padrón se van a borrar.

---

## H6 · ✅ CERRADO (2026-09-20, `d3899c8`) · El padrón del club —con CURP y fechas de nacimiento de menores— lo ve la liga

**Severidad: media. Es una decisión de producto, no un bug, pero hay que tomarla.**

`teamOwnerRequired` deja pasar a los miembros de la organización de la **liga**,
así que un administrador de liga puede pedir
`GET /api/player-billing/teams/:id/overview` de cualquiera de sus equipos y
recibir, de todas las personas del padrón: `curp`, `birth_date`, `photo_url`,
`tutor_name`, `tutor_phone`, `tutor_email`, la cuota de cada quien, su saldo y
el libro completo del club.

Eso es justo lo que el propio proyecto separó de `players` para proteger
(regla 7 de `CLAUDE.md`, y la razón (b) por la que nació `club_members`): datos
de gente en buena parte menor de edad. El README es explícito en que el padrón
**es la relación comercial del club**, no de la liga — "Quién lo arma: el club,
siempre".

No es una filtración pública, pero sí es una organización distinta a la que
capturó el dato, sin que nadie se lo haya concedido y sin que el club lo sepa.

**Arreglo:** una guarda propia para `/api/player-billing` — la organización del
equipo y el admin de plataforma, y nadie más — o, si la liga necesita ver algo,
una versión recortada del overview sin CURP, sin fecha de nacimiento y sin
contacto del tutor.

---

## H7 · ✅ CERRADO · La nota interna de un cargo viaja en el estado de cuenta público

**Severidad: media. La UI promete lo contrario, literalmente.**

`GET /player-billing/statement/:shareToken` (`playerBilling.js:886-894`) incluye
`note` en cada movimiento. `LedgerEntryList` no la pinta, así que no se ve —
pero está en el JSON, legible por cualquiera con el link abriendo la pestaña de
red del navegador.

Y el campo que la captura dice, con esas palabras:

> *"Nota interna (opcional) — Solo la ves tú, no aparece en el estado de cuenta
> del papá"* (`PlayerChargeForm.jsx`)

La nota de un tesorero es exactamente el lugar donde se escribe *"la mamá pidió
prórroga"* o *"este ya debe tres meses, hablar con el coach"*.

Lo que sí está bien: `club_members.note` (la nota de la persona) **no** sale —
`loadAccountByToken()` no la selecciona. Es solo la nota a nivel movimiento.

**Arreglo:** quitar `note` de ese SELECT. Si algo de la nota tenía que llegarle
al papá, que sea `concept`, que es el campo que sí se pinta.

---

## H8 · ✅ CERRADO · Un lote de cargos no es atómico: 40 jugadores, 40 INSERT sueltos

**Severidad: media.**

`playerBilling.js:382` (y el equivalente en `/charges/repeat`) inserta fila por
fila en un `for … await`. Si truena en el jugador 20 de 40 —una caída de red,
un `statement_timeout`, el arranque en frío de Render— queda **medio lote
creado**, ya visible en los saldos de 20 familias, y no hay acción de "cancelar
el lote": hay que entrar a cancelar cargo por cargo, cada uno con su ajuste.

Esto no choca con la regla de "una transacción real no se reparte en varias
llamadas": un `INSERT ... VALUES (…),(…),(…)` de varias filas **es una sola
sentencia**, y por lo tanto atómico pase lo que pase con el pooler. Es el mismo
patrón que ya se usó para `transfer-owner` con CTEs.

**Arreglo:** armar un INSERT multi-fila. De paso quita 40 viajes de red por lote.

---

## H9 · ✅ CERRADO (2026-09-19, `2402659`) · El WhatsApp de "Recordar" se lo va a comer el bloqueador de popups

**Severidad: media. Depende del navegador, y Safari es el caso malo.**

`TeamFinancesSection.jsx:109-117`:

```js
await api.updateTeamMember(..., { mark_reminded: true }, token);
await refresh();
window.open(whatsappReminderUrl(member, team.name), '_blank', 'noopener');
```

Los navegadores solo permiten `window.open` cuando cuelga **síncronamente** del
gesto del usuario. Después de dos `await` ese permiso ya expiró: Safari lo
bloquea de forma consistente y Firefox casi siempre. El tesorero aprieta
"Recordar", ve que la fila dice "recordado hoy"… y no se abrió nada. Peor: la
plataforma ya registró un recordatorio que nunca se mandó.

El comentario del código explica bien **por qué** se marca primero (si se
marcara después, el cambio de pestaña puede dejar la petición a medias). Los dos
objetivos son compatibles: la URL de `wa.me` se calcula sin pedirle nada al
servidor.

**Arreglo:** abrir la ventana en la primera línea del handler, síncronamente, y
disparar el `PATCH` + `refresh` después (o guardar la referencia de la ventana
y asignarle `.location` al terminar).

---

## H10 · ✅ CERRADO (2026-09-19, `6e2e4de`) · "Copiar link" solo existe cuando NO hay teléfono

`TeamFinancesSection.jsx:315-323`: los dos botones son excluyentes. Si el
miembro tiene `tutor_phone`, sale "Recordar"; si no, sale "Copiar link".

O sea: **un club que sí capturó los teléfonos no puede copiar ningún link**. Y
copiar el link es lo que se necesita para pegarlo en el grupo de la categoría,
mandarlo por correo, o pasárselo a un papá cuyo WhatsApp está en otro número.
El propio código de `copyLink` sugiere "Pégalo en tu grupo de WhatsApp", que es
un uso distinto al recordatorio individual.

**Arreglo:** mostrar los dos, o mover "Copiar link" (y el "Regenerar" de H4) al
modal de la Ficha, que es donde vive el contexto de esa persona.

---

## Menores y de consistencia

**M1 · `recent_batches` cuenta los cargos cancelados.**
`playerBilling.js:284-297` agrupa sin filtrar `status`, así que el selector de
"Repetir el mes pasado" anuncia *"$X total · N jugadores"* con montos que ya se
cancelaron. Lo que de verdad se va a crear es otra cosa.

**M2 · El CURP se protege contra duplicados solo a la mitad.**
Se valida en el alta (409) pero **no en el `PATCH`**, y no hay índice único en
la base: dos altas simultáneas con el mismo CURP entran las dos. Si el CURP es
la llave anti-duplicados que usa el importador de rosters, conviene que sea un
`UNIQUE (team_id, UPPER(curp)) WHERE curp IS NOT NULL` de verdad.

**M3 · El id del miembro se llama distinto según el endpoint.**
`overview` devuelve `member_id`; `POST /members`, `PATCH /members/:id` y
`GET .../entries` devuelven `{ member: { id, … } }`. Hoy no rompe nada porque el
frontend siempre recarga el overview después de escribir, pero es una trampa
puesta para el siguiente que lea el contrato — y la fase B se hizo justamente
para que esto fuera parejo.

**M4 · La lógica de "el cargo en cero se omite" nunca corre en producción.**
`PlayerChargeForm` ya filtra `amount > 0` antes de mandar, así que el `skipped`
del backend siempre llega en 0 desde la UI. El único caller que ejercita ese
camino es la e2e. No es un bug; es que la prueba no prueba el flujo real.

**M5 · Comentario obsoleto.** `TeamFinancesSection.jsx:47` dice
*"(member_ledger_entries)"*. La tabla se llama `club_ledger_entries`;
`member_ledger_entries` no existió nunca.

**M6 · Las tres secciones piden el overview completo.**
Resumen, Finanzas y Jugadores llaman al mismo endpoint, que trae padrón + libro
+ KPIs + 12 movimientos + 12 lotes, aunque Jugadores solo use `members` y
`account_statuses`. Con 30 personas da igual; con 150 y fotos, cada cambio de
pestaña es una respuesta grande. Es lo primero que va a doler cuando esto crezca,
y la salida barata es un `?include=` o un endpoint de padrón a secas.

**M7 · "Por cobrar" incluye a los dados de baja; "% al corriente" no.**
Es defendible (el que se fue debiendo sigue debiendo), pero la pantalla no lo
dice, y el KPI más visible del panel puede estar contando dinero que nadie va a
perseguir. Con un subtítulo tipo "incluye N bajas" se resuelve.

**M8 · Zona horaria.** `CURRENT_DATE` y `date_trunc('month', CURRENT_DATE)` se
evalúan en la zona del servidor de Postgres (Neon, UTC por omisión). "Cobrado
este mes", "vencido" y `next_due_date` pueden desfasarse un día respecto a
México. Se arregla fijando la zona en la conexión o con
`AT TIME ZONE 'America/Mexico_City'`.

---

## Áreas de oportunidad (producto, no defectos)

Ordenadas por lo que yo creo que un tesorero pediría primero:

1. **Exportar el corte del mes** (Excel o PDF). Es lo primero que va a pedir
   quien hoy vive en Excel, y es lo que justifica dejar el Excel. El proyecto ya
   carga `xlsx` desde el CDN de SheetJS para la plantilla de roster, así que la
   pieza ya está.
2. **Buscador y orden en la tabla de Finanzas.** Con 60 jugadores no hay cómo
   encontrar a alguien ni cómo ordenar por saldo o por vencido. Es la tabla
   donde más tiempo se pasa.
3. **Recordar en bloque.** Hoy es un clic por familia, con su ida y vuelta a
   WhatsApp. Un "recordar a los N vencidos" que abra los links en cola, o que al
   menos marque a todos y deje una lista para ir tachando, cambia la tarde del
   tesorero.
4. **Cancelar un lote completo.** Complemento natural de H8 y de "me equivoqué
   de mes": un solo `ConfirmDialog` que meta los N ajustes de reversa.
5. **Ligar un pago a un cargo.** Hoy todo es saldo global, que es lo correcto
   para el balance pero deja sin responder "¿este pago fue de la mensualidad de
   agosto o del uniforme?". El esquema ya tiene `reverses_entry_id`; faltaría un
   `applies_to_entry_id` opcional.
6. **Cerrar el ciclo del rechazo hacia el papá.** Cuando el club rechaza un
   pago, el motivo queda asentado en el libro pero al papá no le llega nada: el
   `ConfirmDialog` le dice al tesorero "avísale por WhatsApp". Ese aviso se
   puede armar igual que el recordatorio, con el motivo ya escrito.
