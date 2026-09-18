# El Panel del Club (CFBAMX) — guion completo para ChatGPT

> **Para qué sirve este documento.** Es el contexto autocontenido de una sola
> pantalla de la app CFBAMX: el **panel de administración de un club**. Está
> escrito para que un modelo de lenguaje que NO tiene acceso al repositorio
> pueda responder preguntas sobre él, proponer cambios y entender por qué las
> cosas están como están. Todo lo que dice describe el código tal como está
> hoy, no como debería estar. Las rutas de archivo son relativas a `lifa-app/`.

---

## 1. Qué es, en una frase

CFBAMX es una app full-stack (React 18 + Vite en el front, Node 22 + Express +
Postgres en el back) para ligas y equipos de fútbol americano en México. El
**panel del club** es el espacio de trabajo privado de **un equipo**: desde ahí
su tesorero lleva el padrón de quién entrena, les cobra la cuota mensual,
concilia los pagos que las familias reportan con comprobante, revisa lo que el
equipo le debe a su liga, edita su perfil público y administra quién más tiene
acceso.

Reemplaza el flujo real de un club amateur mexicano: **Excel del tesorero +
capturas de SPEI sueltas en el grupo de WhatsApp**.

---

## 2. Vocabulario indispensable (si te equivocas aquí, te equivocas en todo)

| Término | Qué es realmente |
|---|---|
| **Club** | Es la palabra de UI para lo que en la base de datos es un **equipo** (`teams`). El encabezado del panel literalmente dice "Panel del club". No existe una tabla `clubs`. |
| **Equipo independiente** | Un equipo con `teams.league_id = NULL`. No pertenece a ninguna liga. Puede usar TODO el panel salvo la sección "Con la liga". |
| **Padrón del club** | `club_members`. La gente que entrena aquí y a la que el club le cobra. **Lo arma el club.** Existe sin liga. |
| **Roster de torneo** | `players` + `player_team_memberships`. Quién puede jugar en qué rama de qué torneo. **Lo arma la liga** al inscribir al equipo. Sirve para elegibilidad. |
| **Libro / ledger** | Tabla de movimientos append-only. Hay **tres** libros en la app; el panel del club toca dos: `club_ledger_entries` (equipo → jugadores) y `team_ledger_entries` (liga → equipo, solo lectura desde aquí). |
| **El papá** | Así se le dice en todo el código al tutor o responsable de pago de un jugador. No tiene cuenta en la plataforma. |
| **Organización** | `organizations`: la capa de identidad común. Cada equipo y cada liga tienen la suya (`teams.organization_id`), y los administradores cuelgan de ahí (`organization_members`). |

**La distinción más importante del documento:** el padrón del club y el roster
de torneo son **dos poblaciones distintas que no se sincronizan y no comparten
ni tabla**. `club_members` no tiene ninguna columna que apunte a `players`.

| | Roster de torneo | Padrón del club |
|---|---|---|
| Tablas | `players` + `player_team_memberships` | `club_members` |
| Quién lo arma | La liga | El club, siempre |
| Para qué | Elegibilidad | Cobranza |
| Sin liga | No existe | Existe igual |
| Nombre | `first_name` + `last_name`, ambos `NOT NULL` | **Un solo `display_name`** |
| Ficha pública | Sí (`/jugador/:id`) | **Nunca** |
| Agrupación | Rama/categoría de la liga | `group_label`, texto libre del club ("U17", "Femenil") |

Lo único que los cruza es un botón de **importar**, que copia nombres una sola
vez. Copia texto, no enlaza filas.

**Por qué se separaron** (fue la corrección más importante de todo el dominio):
cuando el cliente del club vivía en `players`, (a) un equipo independiente no
podía cobrarle a nadie nunca, porque las cuentas nacían del roster que la liga
inscribía; (b) `GET /players/:id/card` es público y servía cualquier fila de
`players`, así que CURP, fecha de nacimiento y foto de gente en buena parte
**menor de edad** eran consultables adivinando un id; (c) `last_name NOT NULL`
obligaba al tesorero a inventarle un apellido a quien solo conocía por su apodo.

---

## 3. Cómo se entra y quién puede

### Rutas (React Router, `src/App.jsx`)

Las seis secciones son seis rutas que montan **la misma página** con un prop
distinto. Todas van dentro de `<ProtectedRoute>` (exige sesión):

| Ruta | `section` | Sección |
|---|---|---|
| `/panel/equipo/:id` | `resumen` | Resumen |
| `/panel/equipo/:id/finanzas` | `finanzas` | Finanzas (cuotas del club) |
| `/panel/equipo/:id/jugadores` | `jugadores` | **Padrón** (padrón del club + rosters de torneo). La ruta conserva la palabra `jugadores` aunque la pestaña ya no se llame así |
| `/panel/equipo/:id/estado-de-cuenta` | `liga` | Con la liga |
| `/panel/equipo/:id/perfil` | `perfil` | Perfil público |
| `/panel/equipo/:id/administradores` | `administradores` | Administradores |

Más una ruta **fuera** de `ProtectedRoute`, que es la contraparte del panel:
`/cuenta/:shareToken` — el estado de cuenta público del jugador, sin sesión,
donde el token **es** la credencial.

La ruta de "estado de cuenta" conserva su URL vieja a propósito: ya viaja
dentro de notificaciones (`data.url`) y en links guardados.

### Permisos

**En el frontend** (`pages/TeamPanel.jsx`) la comprobación es cosmética: busca
el `id` de la URL dentro de `teams`, la lista que `GET /api/auth/me` devuelve.
Si no está, pinta "No tienes permiso para ver este panel". Eso **no decide nada
de seguridad**.

**En el backend** el permiso real lo aplica `teamOwnerRequired`
(`middleware/ownership.js`) en cada endpoint. Deja pasar a cualquiera de estos:

1. `req.user.role === 'admin'` (admin de plataforma),
2. miembro activo de la **organización del equipo** (`organization_members`),
3. miembro activo de la **organización de su liga**,
4. `leagues.owner_user_id === req.user.id`,
5. `teams.owner_user_id === req.user.id`.

Los puntos 4 y 5 son el respaldo histórico de antes de `organization_members`;
se dejan a propósito hasta confirmar la migración.

`GET /api/auth/me` devuelve `teams` con `SELECT t.*` más `league_name`,
`league_slug`, y `country_id` / `description` / `is_verified` traídos de la
organización. De ahí salen `brand_color`, `league_id`, `show_on_platform`,
`organization_id` y `player_billing_reminders_enabled`, que el panel lee
directo del contexto de auth (`context/AuthContext.jsx`) sin pedirlos otra vez.

---

## 4. Dónde vive el código

```
frontend/src/
  pages/TeamPanel.jsx                    Resuelve equipo + permiso UNA vez y monta la sección
  components/TeamWorkspace.jsx           Cascarón: logo, encabezado, nav de 6 pestañas, acento
  components/TeamOverviewSection.jsx     Sección Resumen
  components/TeamFinancesSection.jsx     Sección Finanzas  (la más grande, ~483 líneas)
  components/TeamRosterSection.jsx       Sección Padrón
  components/TeamLeagueStatementSection.jsx  Sección Con la liga
  components/TeamProfileSection.jsx      Sección Perfil (envuelve TeamForm.jsx)
  components/OrgAdminsPanel.jsx          Sección Administradores (compartida con el panel de liga)
  pages/PlayerStatementPage.jsx          La pantalla pública del papá (/cuenta/:token)

  components/  ClubMemberForm · PlayerChargeForm · PlayerPaymentForm ·
               ImportRosterModal · BranchRosterModal ·
               ReportPaymentForm · LedgerEntryList · ConfirmDialog ·
               MonthlyFlowChart · Modal · OrgLogoBar
  utils/money.js   Formato de dinero/fechas, balanceClass, periodLabelFor
  utils/color.js   useAccentColor: el color de marca del club
  api/client.js    ÚNICA puerta al backend. Ningún componente hace fetch por su cuenta.

backend/src/
  routes/playerBilling.js   El corazón: 18 endpoints de cuotas del club (~1050 líneas)
  routes/billing.js         Libro liga → equipo (la sección "Con la liga" lee de aquí)
  routes/manage.js          PUT /teams/:id (perfil), DELETE /teams/:id
  routes/players.js         GET /teams/:id/branches y el roster de torneo por rama
  routes/organizations.js   Administradores: listar, quitar, ceder el puesto principal
  middleware/ownership.js   teamOwnerRequired y las otras 9 guardas
  middleware/rateLimit.js   publicStatementLimiter (30/min) y reportPaymentLimiter (10/15min)
  utils/billingReminders.js runPlayerBillingReminders (el cron agregado por equipo)
  utils/monthlyCharges.js   runMonthlyChargeGeneration — la mensualidad automática
  utils/sqlDates.js         HOY_MX: la fecha de hoy en México, no en UTC
  config/db.js              El esquema COMPLETO + migraciones idempotentes al arrancar
```

Convención del proyecto: **español** en comentarios, errores y UI; **inglés**
en identificadores, columnas y rutas de API. SQL con `db.prepare('... WHERE id
= ?')` usando `?` (se traduce a `$n` solo). `.get()` una fila, `.all()` varias,
`.run()` escribe. Todo handler async va envuelto en `asyncHandler`.

---

## 5. El modelo de datos

### `club_members` — el padrón

Una fila por persona **en un club**. Identidad y relación comercial en la misma
fila (antes eran dos tablas).

```sql
id                SERIAL PK
team_id           INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE
display_name      TEXT NOT NULL          -- LO ÚNICO OBLIGATORIO de una persona
birth_date        DATE                   -- opcionales de verdad
curp              TEXT
photo_url         TEXT
position          TEXT
jersey_number     INTEGER
monthly_amount    NUMERIC(12,2)          -- su cuota; NULL = "sin definir"
status            TEXT NOT NULL DEFAULT 'activo' CHECK (activo | baja | beca)
group_label       TEXT                   -- categoría PROPIA del club, texto libre
tutor_name        TEXT
tutor_phone       TEXT                   -- se normaliza a solo dígitos y '+'
tutor_email       TEXT
note              TEXT                   -- nota interna del tesorero
share_token       TEXT UNIQUE NOT NULL   -- UUID v4: la credencial del link público
joined_date       DATE
last_reminded_at  TIMESTAMP              -- cuándo se le mandó el último WhatsApp
created_at, updated_at TIMESTAMP
```

`"Juan Pérez"`, `"El Güero"` y `"Sofía (hija de Marta)"` son todos nombres
válidos.

### `club_ledger_entries` — el libro de cuotas

```sql
id                 SERIAL PK
team_id            INTEGER NOT NULL REFERENCES teams(id)        ON DELETE CASCADE
member_id          INTEGER NOT NULL REFERENCES club_members(id) ON DELETE CASCADE
kind               TEXT NOT NULL CHECK (charge | payment | adjustment)
category           TEXT      -- mensualidad|inscripcion|uniforme|torneo|equipamiento|multa|otro
concept            TEXT NOT NULL
amount             NUMERIC(12,2) NOT NULL CHECK (amount > 0)
currency           TEXT NOT NULL DEFAULT 'MXN'
due_date           DATE
period_label       TEXT      -- "SEP-2026"
status             TEXT NOT NULL DEFAULT 'open'
direction          TEXT CHECK (credit | debit)   -- solo para adjustment
payment_method     TEXT      -- transferencia|efectivo|deposito|otro
reference          TEXT
proof_url          TEXT      -- Cloudinary, carpeta lifa-app/comprobantes
note               TEXT
batch_id           TEXT      -- UUID que agrupa un lote de cargos
reverses_entry_id  INTEGER REFERENCES club_ledger_entries(id)   -- hace idempotente la cancelación
created_by_user_id INTEGER REFERENCES users(id)
created_by_side    TEXT NOT NULL DEFAULT 'team' CHECK (team | player)
provider, provider_payment_id, fee_amount   -- reservadas para una pasarela que NO se construyó
voided_by_user_id, voided_at
reminded_due_soon BOOLEAN, overdue_reminder_count INTEGER, last_overdue_reminder_at  -- banderas del cron
created_at, updated_at
```

Índices: `(team_id, created_at)`, `(member_id, created_at)`, `(batch_id)`, y uno
parcial sobre `due_date` filtrado a `kind='charge' AND status='open'`.

### Columnas de `teams` que solo existen para este panel

- `brand_color TEXT` (nullable) — el acento de color del panel. Solo UI.
- `player_billing_reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE` — el
  interruptor del cron de recordatorios. Nace apagado.

---

## 6. La regla del saldo — léela dos veces

**El saldo nunca se guarda. Se suma.** No hay columna `balance` en ningún lado.
Se calcula con `BALANCE_SUM_SQL`, que vive en `routes/playerBilling.js`:

```sql
COALESCE(SUM(
  CASE
    WHEN kind = 'payment' AND status IN ('pending','rejected','withdrawn') THEN 0
    WHEN kind = 'payment'                             THEN  amount
    WHEN kind = 'adjustment' AND direction = 'credit' THEN  amount
    WHEN kind = 'adjustment' AND direction = 'debit'  THEN -amount
    WHEN kind = 'charge'                              THEN -amount
    ELSE 0
  END
), 0)
```

**Negativo = el jugador le debe al club.** Positivo = saldo a favor.

Los estados de un pago y por qué cada uno necesita nombre propio:

| Estado | Qué pasó | Al saldo |
|---|---|---|
| `pending` | el papá lo reportó, nadie lo ha revisado | **0** |
| `rejected` | el club no lo reconoció | **0** |
| `withdrawn` | quien lo reportó lo retiró él mismo | **0** |
| `confirmed` | el club lo dio por bueno | `+amount` |
| `void` | un pago **ya confirmado** que se canceló | **`+amount`** (sí, suma) |

El último es contraintuitivo y es correcto: cancelar un movimiento confirmado
inserta **además** una fila `adjustment` de signo contrario. Si el pago en
`void` también se excluyera, el monto se restaría **dos veces**. Por eso
`rejected` y `withdrawn` no pueden compartir el estado `void`: nunca llevaron
ajuste, y si sumaran inflarían el saldo por el monto completo. Ese fue un bug
real que cazó la prueba de punta a punta.

Corolario: **rechazar un pago pendiente no genera ajuste**, porque ese pago
nunca entró al saldo y no hay nada que revertir.

### Las reglas del libro (invariantes que no se negocian)

1. **Append-only.** Un movimiento no se edita ni se borra.
2. Cancelar = `status='void'` en el original **más** una fila `adjustment` con
   `reverses_entry_id` apuntándole. Antes de insertar el ajuste se verifica que
   no exista ya uno con ese `reverses_entry_id` → la operación es idempotente.
3. Un ajuste **no se puede cancelar** (400).
4. `settleIfPaid()`: después de cada escritura, si el saldo del miembro quedó
   `>= 0`, sus cargos `status='open'` pasan a `'settled'` y dejan de disparar
   recordatorios.
5. Un cargo de **monto 0** no se inserta: un cargo de cero no es un movimiento
   contable. Se permite mandarlo para poder generar la mensualidad de toda una
   categoría de un jalón sin tener que destildar a los becados uno por uno.

---

## 7. Las seis secciones, una por una

### Cascarón común — `TeamWorkspace.jsx`

Arriba de toda sección va: la barra de logos de las organizaciones que
administras (`OrgLogoBar`, para saltar a otra sin volver a `/panel`), el
encabezado con logo del equipo + eyebrow "Panel del club" + nombre +
`league_name` o "Equipo independiente" + píldora "✓ Verificado" si aplica, y la
nav de pestañas. **Si el equipo es independiente, la pestaña "Con la liga" no se
renderiza** (`hideWhenIndependent`).

**El color del club.** `useAccentColor(team.brand_color)` (`utils/color.js`)
aplica `--accent` y `--accent-ink` a `:root`, no al contenedor del workspace.
La razón: los modales se montan con `createPortal` en `document.body`, o sea
FUERA del árbol del panel, así que puesto en el contenedor los botones del
modal salían amarillos aunque el club tuviera otro color. Se restaura al
desmontar. `--accent-ink` (el color del texto ENCIMA del acento) se calcula con
luminancia relativa WCAG y umbral **0.55** en vez de 0.5, porque el amarillo y
el verde —los dos colores más probables en un club de americano— se perciben
más claros de lo que sugiere un promedio simple de canales. Si el club no
eligió color, todo hereda el amarillo de CFBAMX (`--flag`).

Por lo mismo, los formularios compartidos usan la clase `btn-accent` en vez de
`btn-flag`: siguen al acento activo, y en el panel de liga —que no tiene color
propio— se siguen viendo amarillos.

---

### 7.1 Resumen — `/panel/equipo/:id`

**Qué responde:** *qué pasó, qué falta, y los tres botones que el tesorero va a
apretar hoy.*

Se alimenta del **mismo** `GET /player-billing/teams/:id/overview` que Finanzas.
No hay endpoint aparte para el resumen: una consulta menos que mantener y
garantía de que las dos pantallas nunca muestren cifras distintas.

Contenido, en orden:

1. **Bandeja de pendientes** (solo si `kpis.pending_payments_count > 0`):
   "N pagos esperan tu confirmación" + botón "Revisar ahora" → Finanzas.
2. **Tira de KPIs** (`stat-strip`):
   - *Cobrado este mes* — `kpis.collected_this_month`
   - *Por cobrar* — `kpis.receivable`, con subtítulo "$X ya vencido" o "nada vencido"
   - *Al corriente* — porcentaje `up_to_date_count / active_count`
   - *Con tu liga* — solo si NO es independiente; saldo de
     `GET /billing/teams/:id/statement`, con link a la sección
3. **Barra de acciones**: "Generar cuotas del mes" y "Registrar un pago" (los dos
   llevan a Finanzas) y "Administrar plantel" (lleva a Jugadores).
4. **Si el padrón está vacío**: en vez de gráfica y actividad, un bloque
   `empty-teach` que enseña qué hacer primero ("Empieza por tu padrón… No hace
   falta estar en una liga para esto") con un botón a Jugadores.
5. **Si hay padrón**: `MonthlyFlowChart` (seis meses de cobranza) y **Actividad
   reciente** (los últimos 12 movimientos, con el nombre del miembro, si el
   movimiento lo creó el papá o el club, píldora "Por confirmar" en los
   pendientes, tachado en los cancelados, y el monto con signo).

---

### 7.2 Finanzas — `/panel/equipo/:id/finanzas`

**La pantalla principal.** Es el libro equipo → jugadores. Todo lo que sigue
sale de una sola llamada, `GET /player-billing/teams/:id/overview`, que
devuelve:

```js
{
  team: { id, name, logo_url, brand_color, contact_phone, contact_email,
          player_billing_reminders_enabled },
  kpis: { collected_this_month, receivable, overdue,
          up_to_date_count, active_count, pending_payments_count },
  members: [ ...toda la fila de club_members + balance, overdue_amount, next_due_date ],
  monthly_flow:    [ { month: 'YYYY-MM', total } ],   // 6 meses
  pending_payments:[ ... ],                           // pagos en status='pending'
  recent_activity: [ ... ],                           // últimos 12 movimientos
  recent_batches:  [ ... ],                           // últimos 12 lotes de cargos
  categories:       ['mensualidad','inscripcion','uniforme','torneo','equipamiento','multa','otro'],
  payment_methods:  ['transferencia','efectivo','deposito','otro'],
  account_statuses: ['activo','baja','beca'],
}
```

Cómo se calculan los KPIs en SQL:

- `collected_this_month` = suma de `kind='payment'` con
  `status IN ('confirmed','settled')` y `created_at >= date_trunc('month', CURRENT_DATE)`.
- `receivable` = suma de `max(-balance, 0)` de **todas** las filas del padrón.
- `overdue` = suma de `overdue_amount`, donde por miembro
  `overdue_amount = min(suma de cargos open ya vencidos, max(-balance, 0))`. El
  clamp existe para que el adeudo vencido nunca sea mayor a lo que la persona
  debe en total.
- `up_to_date_count` / `active_count` **excluyen a los de baja**: ya no son plantel.
- `next_due_date` por miembro = `MIN(due_date)` de sus cargos `open`.

**Si el padrón está vacío**, la sección entera se reemplaza por un
`empty-teach`: "Primero arma el padrón de tu club", que manda a Jugadores.

#### Lo que se ve, de arriba a abajo

**a) Cuatro KPIs**: Cobrado este mes · Por cobrar · Vencido · Al corriente (%).

**b) Bandeja de conciliación** (`pending-tray`), solo si hay pagos pendientes.
Una fila por pago con: nombre de quien reportó, método, referencia, fecha, nota,
monto, botón **"Ver comprobante"** (abre la URL de Cloudinary en otra pestaña),
botón **"Confirmar"** y botón **"Rechazar"**.

- *Confirmar* → `POST /player-billing/entries/:entryId/confirm`. Valida que sea
  un `payment` en `pending`; lo pasa a `confirmed` y corre `settleIfPaid`.
- *Rechazar* → abre un `ConfirmDialog` que **exige motivo** ("queda asentado") y
  llama a `POST /player-billing/entries/:entryId/void`. Como es un pendiente, el
  backend **no** crea ajuste y lo deja en `status='rejected'`.

**c) Bloque "Cobro automático"** (`CobranzaAutomatica`, plegable). Dice si está
activo, con qué fecha de pago, cuántos miembros entran en el cobro y cuándo es
la próxima generación. Al abrirlo: selector de día (1–28), y activar o apagar.
Al activarlo, el backend genera de inmediato y el panel se recarga.

**d) Barra de acciones**: "Generar cargo" · casilla "Avisarme de cuotas
vencidas". **Ya no existe "Repetir el mes pasado"** — ver §7.2.1.

**d) `empty-teach` de enseñanza** si hay padrón pero cero movimientos: "Todavía
no le cobras a nadie", con botón a Generar cuotas.

**e) La tabla de jugadores** (`data-table`: encabezado pegajoso, cebra, dinero a
la derecha con `tabular-nums`). Columnas: *Jugador* (foto + nombre + `#número` +
categoría + "Becado"/"Baja") · *Cuota* (`monthly_amount` o "sin definir") ·
*Saldo* · *Vencido* · *Vence* · *Recordado* ("hace 3 días", con `timeAgo`) ·
acciones. Las filas de gente dada de baja van con la clase `row-muted`.

Las acciones por fila:

1. **"Recordar"** — solo si el miembro tiene `tutor_phone`. Hace dos cosas, en
   este orden y a propósito: primero `PATCH .../members/:memberId` con
   `{ mark_reminded: true }` (que solo toca `last_reminded_at = NOW()`), refresca,
   y **luego** abre `window.open()` a un link `wa.me/<teléfono>?text=…`. El orden
   importa porque si se marcara después, el navegador ya cambió de pestaña y la
   petición se puede quedar a medias.
   El mensaje se arma en `whatsappReminderUrl()` y siempre lleva **el link del
   estado de cuenta**: ese link es lo que corta la conversación de "¿cuánto
   debo?" / "mándame captura". Tiene dos variantes, deber o estar al corriente.
   No se manda solo: se abre WhatsApp con el texto escrito, para que el tesorero
   pueda editarlo — conoce el tono de cada familia.
2. **"Copiar link"** — aparece **en lugar** de "Recordar" cuando no hay teléfono.
   Copia `https://<origen>/cuenta/<share_token>` al portapapeles.
3. **"Ficha"** — abre `ClubMemberForm` en modal para editar a la persona y su
   ficha de cobranza en una sola llamada (`PATCH`).
4. **"+ Pago"** — abre `PlayerPaymentForm`. Registra un pago que el club **ya
   recibió**: nace `confirmed` y baja el saldo de inmediato. El monto viene
   presugerido con lo que la persona debe.
5. **"Movimientos"** — despliega, debajo de la tabla, el libro completo de ese
   miembro (`GET .../members/:memberId/entries`), pintado con
   `LedgerEntryList`, con sus propios botones de Confirmar y Cancelar.

**f) `MonthlyFlowChart`** al final si hay datos.

#### Los modales de Finanzas

**"Generar cuotas" — `PlayerChargeForm`.** Cargos en bloque, **monto por
jugador**, no un monto único para todos: en un club real conviven la cuota
normal, el hermano con descuento y el becado. Trae:

- metadatos del lote: tipo de cargo (las 7 categorías), periodo
  (`"SEP-2026"`, se autollena con el mes actual), concepto, fecha de
  vencimiento, nota interna;
- filtro por `group_label` (las categorías propias del club);
- botón **"Usar la cuota de cada quien"**, que llena la columna de montos con el
  `monthly_amount` guardado en cada ficha (0 para los becados);
- botón "Limpiar";
- tabla editable con un input de monto por jugador, total al pie.

Excluye a los de `status='baja'`. Los becados aparecen en 0 para que el tesorero
vea el plantel completo. El submit manda
`{ items: [{member_id, amount}], category, concept, due_date, period_label, note }`
a `POST /player-billing/teams/:id/charges`. El backend valida la metadata,
normaliza los items (si un jugador viene repetido, gana el último), verifica que
todos pertenezcan a este equipo, genera un `batch_id` (UUID) y **inserta una
fila por jugador con monto > 0**, en un bucle.

> **Este formulario ya no ofrece la categoría `mensualidad`.** Es para lo
> esporádico —uniforme, viaje, arbitraje, multa, equipamiento, inscripción—,
> que es justo lo que no tiene fecha fija. El backend sigue aceptando la
> categoría porque la escribe el ciclo automático; ofrecerla en los dos lados
> era invitar al doble cobro.

#### 7.2.1 · La mensualidad se genera sola

**No hay botón.** El club configura **una sola fecha** (el día en que se paga,
típicamente 1 o 15) y el cargo nace solo, **cinco días antes**, para cada
miembro `activo` con `monthly_amount > 0`, por el monto de su propia ficha. Los
`beca` y los `baja` no reciben nada.

**No existe "vencimiento" aparte de la fecha de pago.** Hay una fecha de pago;
del día siguiente en adelante *se debe*; lo que no se pagó se acumula con el mes
que entra.

Columnas nuevas en `teams`: `monthly_charge_enabled` (opt-in, nace apagado),
`monthly_charge_day` (`CHECK` 1–28) y `monthly_charge_started_on` (se sella al
encender; impide generar meses anteriores a esa fecha).

**Se dispara desde dos lugares**, y eso obliga a que sea idempotente:

1. El cron, al final de `POST /api/notifications/trigger`.
2. `GET /teams/:id/overview` (la carga del panel), con un acelerador de 10
   minutos por equipo en memoria del proceso.

Lo segundo existe porque **el cron es externo al repositorio** y su frecuencia
no está documentada en ningún archivo: si se cae, el club dejaría de facturar en
silencio. La vía perezosa garantiza que el cargo exista de todos modos.

**La idempotencia la garantiza la base, no el código:**
`club_ledger_entries.auto_cycle_key` (`'mensualidad:OCT-2026'`, NULL en lo que
capturó un humano) más el índice `idx_club_ledger_auto_cycle`
(`UNIQUE (team_id, member_id, auto_cycle_key) WHERE auto_cycle_key IS NOT NULL`)
y `ON CONFLICT DO NOTHING`. Dos consecuencias que hay que tener claras:

- El predicado es **inmutable** (no filtra por `status`), así que **cancelar una
  mensualidad automática impide que se regenere**. El humano le gana al robot.
- La columna nace NULL en toda la tabla, así que el índice se crea sobre cero
  filas y **no puede fallar** por datos históricos. El generador además **se
  niega a insertar** si el índice no existe.

**Cuánto genera una corrida:** mes−1, mes y mes+1, codificado en
`generate_series(-1, 1)`. Recupera hasta un mes de cron caído y es
estructuralmente incapaz de producir una avalancha.

**Cambiar `monthly_amount` NO reescribe cargos pasados**: la cuota es la
configuración, cada cargo guarda su propio `amount`.

**"Ficha" — `ClubMemberForm`.** El mismo formulario que se usa para dar de alta.
Tres bloques: **Quién es** (nombre, categoría del club, número, posición, fecha
de nacimiento, CURP, foto) · **Cuánto paga** (cuota mensual, situación) · **A
quién se le cobra** (nombre del tutor, WhatsApp con lada y sin espacios, correo,
nota interna).

**Cancelar un movimiento — `ConfirmDialog`.** Reemplazó a `window.confirm` en
todas las acciones contables, y no es cosmético: el confirm del navegador no
puede mostrar QUÉ se está cancelando, no puede pedir un motivo que quede
asentado en el libro, y en un panel que maneja dinero se lee como software
improvisado. El diálogo muestra concepto y monto, explica que el libro no borra
nada, y manda el motivo a `POST /entries/:entryId/void`.

**La casilla "Avisarme de cuotas vencidas"** debería escribir en
`teams.player_billing_reminders_enabled` vía
`PATCH /player-billing/teams/:id/settings` (→ ver hallazgos, H1: hoy el nombre
de la clave no coincide entre las dos capas y el interruptor no funciona).

---

### 7.3 Padrón — `/panel/equipo/:id/jugadores`

Muestra **los dos padrones, uno debajo del otro y con los nombres bien
puestos**, porque confundirlos fue el error de la primera versión.

#### Arriba: el padrón del club

Dos KPIs: *En el padrón* (activos, con "N de baja" abajo) y *Sin cuota definida*
(cuántos activos tienen `monthly_amount = NULL`, con el subtítulo "no entran en
el cobro del mes").

Botones: **"+ Agregar jugador"** y —solo si el equipo tiene ramas— **"Importar
de un roster de torneo"**.

Tabla: Jugador (foto, nombre, número, posición) · Categoría (`group_label`) ·
Cuota (o píldora "falta cuota") · Responsable de pago (nombre + teléfono, o
píldora "sin WhatsApp") · Situación (píldora Activo / Becado / Baja) · acciones
**Editar** y **Quitar**.

- **Agregar / Editar** → `ClubMemberForm` → `POST .../members` o
  `PATCH .../members/:memberId`. En el alta, el backend solo exige
  `display_name`; valida el número de playera (entero 0–999), el correo del
  tutor y que la cuota sea ≥ 0; normaliza el teléfono a dígitos y `+`; genera el
  `share_token`; y **rechaza con 409 si ya existe alguien con el mismo CURP en
  este club** (el CURP es opcional justo para que dos homónimos sí se puedan dar
  de alta: el club sabe a quién tiene).
- **Quitar** → `ConfirmDialog` → `DELETE .../members/:memberId`. La regla:
  **si ya tiene movimientos NO se borra, se le da de baja** (`status='baja'`),
  porque el libro es append-only y borrar a la persona dejaría cargos y pagos
  huérfanos. Solo si nunca tuvo un movimiento se borra de verdad — el caso de
  "lo capturé mal hace dos minutos". La respuesta dice cuál de las dos pasó
  (`action: 'baja' | 'eliminado'`).
- **Importar de un roster de torneo** → `ImportRosterModal` →
  `POST .../members/import-roster` con `{ branch_id, group_label }`. Copia
  `first_name + ' ' + last_name` como `display_name`, junto con fecha de
  nacimiento, posición, número, foto y CURP. **Salta a quien ya esté en el
  padrón** (por CURP si lo hay, si no por nombre completo en mayúsculas), así
  que se puede correr dos veces sin duplicar. Devuelve `{ imported, skipped }`.
  El modal remata con "Ahora ponles su cuota para que entren en el cobro del mes".

#### Abajo: los rosters de torneo

`GET /api/players/teams/:id/branches` lista en qué ramas está inscrito el equipo,
con `roster_count` por rama. Este endpoint se agregó **solo** para esta pantalla:
hasta entonces la única puerta de entrada al roster era el panel de la LIGA,
aunque `branchTeamOwnerRequired` ya le diera acceso al equipo.

Tres estados posibles:

- equipo independiente → texto explicando que no participa en ninguna rama y
  que su padrón se queda tal cual;
- con liga pero sin ramas → "Tu liga todavía no te inscribe en ninguna rama…
  Tu padrón y tu cobranza no dependen de esto";
- con ramas → tabla Torneo · Categoría · Rama · Inscritos · botón "Ver roster",
  que abre `BranchRosterModal`: el roster de esa rama, con **plantilla de Excel**
  (se descarga con el membrete de la liga y se vuelve a subir llena) o captura
  jugador por jugador. Ahí sí `first_name` y `last_name` son obligatorios.

---

### 7.4 Con la liga — `/panel/equipo/:id/estado-de-cuenta`

El **otro** libro: `team_ledger_entries`, en `routes/billing.js`. Lo que el
equipo le debe A SU LIGA. Aquí el club es el que debe, no el que cobra.

Solo lectura en cuanto a cargos: **los cargos los pone la liga y el equipo no
los toca**. Lo que sí puede hacer el equipo es **reportar sus pagos**, con
comprobante — exactamente el mismo mecanismo que un papá con su club, un nivel
arriba.

`GET /billing/teams/:id/statement` devuelve saldo, próximo vencimiento, vencido,
`has_pending_payment`, los métodos de pago, el nombre y el WhatsApp de contacto
de la liga, y todos los movimientos.

- Tres KPIs: saldo (con etiqueta "Le debes a la liga" / "Saldo a favor" /
  "Saldo") · próximo vencimiento · vencido.
- Botón **"Ya pagué — reportar pago"** → `ReportPaymentForm` en modal → sube el
  comprobante con `POST /api/upload` (aquí SÍ hay sesión) y manda
  `POST /billing/teams/:id/report-payment`. El pago nace `pending`, **no baja el
  saldo**, y le cae un aviso a la bandeja de la **liga**
  (`type: 'team_payment_reported'`), no a la del equipo: el que tiene que actuar
  es quien cobra.
- Si ya hay uno pendiente, en su lugar salen la píldora "Tienes un pago en
  revisión" y el botón **"Retirarlo"** → `POST /billing/teams/:id/withdraw-payment`.
  Existe porque la regla de "un pendiente a la vez" sin salida se vuelve una
  trampa: quien tecleó 500 en vez de 5000 se quedaría atorado hasta que del otro
  lado se lo rechacen. Solo se puede retirar lo que reportó el equipo
  (`created_by_side='team'`).
- La lista de movimientos usa el mismo `LedgerEntryList`, con `periodPrefix="J"`
  (jornada) y las categorías de la liga (campo, arbitraje, transmisión,
  inscripción, multa, fianza, otro).

Para un equipo independiente el endpoint devuelve un estado de cuenta vacío con
saldo 0 — pero la pestaña ni siquiera aparece en la nav.

---

### 7.5 Perfil — `/panel/equipo/:id/perfil`

El perfil **público** del equipo: lo que ve cualquiera en CFBAMX. Es el
contenido que antes ERA todo el panel del equipo.

Arranca en modo vista (`TeamProfileView`): portada, logo, nombre, contacto
(ubicación, correo, teléfono), redes (Facebook, Instagram, X, sitio web) y los
links predeterminados de **transmisión** y **boletos**, separados en "en casa" y
"de visita". Botón "Editar perfil del equipo" → `TeamForm`, que además del
perfil trae el selector de **color del club** (`brand_color`, un `#RRGGBB`
validado en el backend, con botón "Quitar" que manda `null` para volver al
amarillo).

Si el equipo es **independiente**, arriba aparece además un interruptor de
visibilidad: "Tu equipo aparece en el home de CFBAMX" / "Tu equipo es privado
por ahora — puedes usar todas las herramientas sin que nadie más lo vea"
(`show_on_platform`), y el formulario suma país y descripción, que viven en la
organización del equipo y no en `teams`.

Guarda con `PUT /api/manage/teams/:id`. Dos detalles del backend:

- ese UPDATE usa `COALESCE(?, col)` en todas sus columnas, así que con ese
  patrón un campo nunca se puede vaciar; por eso **`brand_color` se actualiza en
  una sentencia aparte**, y solo si la clave viene en el cuerpo;
- después de guardar, `syncTeamLinksToMatches()` propaga los links de
  transmisión/boletos a **todos los partidos del equipo que aún no se hayan
  jugado** — exacto, no solo agregando: si un link se quitó, también desaparece
  de esos partidos. Los partidos `finished` nunca se tocan.

---

### 7.6 Administradores — `/panel/equipo/:id/administradores`

Es `OrgAdminsPanel`, el mismo componente que usa el panel de liga. Opera sobre
`organization_members` de `teams.organization_id`. Si el equipo no tiene
organización enlazada, la sección muestra un aviso y no ofrece nada.

Bloque colapsable (carga la lista al expandir) con el aviso de que **todas las
personas listadas tienen el mismo acceso a este panel, incluida la cobranza**.
Por cada persona: nombre, correo, y la marca "· admin principal" en quien tenga
`role = 'owner'`.

Acciones y sus candados:

- **"+ Invitar administrador"** (`InviteAdminModal`).
- **"Hacer principal"** — solo se lo ofrece a quien ya es principal, y solo
  sobre los demás. `POST /organizations/:id/transfer-owner`. Mueve **dos cosas
  que tienen que viajar juntas**: el `role` en `organization_members` y el
  `owner_user_id` de la liga o el equipo. Va en **una sola sentencia con CTEs**
  porque `db.prepare` toma una conexión del pool por consulta y del otro lado
  hay un pooler en modo transacción: un `BEGIN/COMMIT` repartido en varias
  llamadas no tiene garantizada la misma conexión.
- **"Quitar" / "Retirarme"** — `DELETE /organizations/:id/members/:userId`. Dos
  candados distintos: (1) no se deja vaciar la organización — si solo queda un
  administrador hay que invitar a otro antes; (2) **al principal no se le quita
  el acceso desde aquí**, y no es cortesía: `owner_user_id` lo seguiría
  autorizando por el respaldo de `ownership.js`, así que borrar su fila lo
  sacaba de la lista sin quitarle nada — la pantalla decía que había perdido el
  acceso y no era cierto. Primero se cede el puesto.

---

## 8. El estado de cuenta público — `/cuenta/:shareToken`

La contraparte del panel. Es lo que el papá abre desde WhatsApp, **casi siempre
en el teléfono y casi siempre con prisa**.

**No hay login. El token de la URL ES la credencial.** Vive fuera de
`ProtectedRoute` a propósito: exigir cuenta ahí es exactamente la fricción que
mata el cobro. La mayoría de los jugadores no tiene usuario en la plataforma y
no existe todavía un flujo para reclamarlo.

**Cómo se protege lo que sale de ahí.** La respuesta se arma **campo por campo**
en vez de devolver la fila: de ahí nunca debe salir el teléfono del tutor, el id
interno del jugador, ni rastro de ningún otro jugador. Va con sus propios
limitadores: `publicStatementLimiter` (30/min por IP) y `reportPaymentLimiter`
(10 cada 15 min).

La pantalla: el **saldo es lo primero y lo más grande** ("Al corriente" si es 0),
con el logo y el color del club; abajo el vencimiento o el monto vencido; y el
botón de reportar el pago **arriba, no al final del historial**. Luego la lista
de movimientos.

Endpoints públicos:

1. `GET /player-billing/statement/:shareToken` — el estado de cuenta.
2. `POST /player-billing/statement/:shareToken/report-payment` — el papá reporta.
   Nace `pending`: **no baja el saldo** hasta que el club lo confirma. Se permite
   **un pendiente a la vez por jugador** (409 si ya hay uno), para que darle dos
   veces al botón no le llene la bandeja al tesorero de duplicados que luego
   tiene que rechazar a mano. Dispara una notificación `player_payment_reported`
   a la bandeja del **equipo**.
3. `POST /player-billing/statement/:shareToken/withdraw-payment` — el espejo del
   de la liga: el papá que se equivocó retira su propio pendiente. Solo retira lo
   que reportó él (`created_by_side='player'`), nunca un pago que capturó el club.
4. `POST /player-billing/statement/:shareToken/upload-proof` — sube el
   comprobante. No puede pasar por `POST /api/upload` porque ese exige sesión.
   Va a Cloudinary, carpeta `lifa-app/comprobantes`, **sin el recorte cuadrado**
   de los logos: una captura de SPEI es alta y angosta y a 800x800 el monto
   queda ilegible; solo se le pone un techo de 1600x1600. Límite de 5 MB, solo
   imágenes.
   *Nota de privacidad:* la URL que devuelve Cloudinary es pública para quien la
   tenga (no hay firma) — el mismo trato que ya recibe `proof_url` en la
   cobranza liga→equipo.

**Rotar el link:** `POST /teams/:id/members/:memberId/rotate-token` regenera el
`share_token` si se filtró en un grupo equivocado; el viejo deja de funcionar en
cuanto se reemplaza. (→ hallazgos, H4: el método existe en `api/client.js` pero
ningún componente lo llama.)

---

## 9. Recordatorios — hay dos caminos, y son distintos a propósito

**Camino 1: al papá, disparado por un humano.** No hay API de WhatsApp ni costo.
El panel arma el mensaje con nombre, monto, vencimiento y link; el tesorero lo
manda y puede editarlo antes. La plataforma solo registra **cuándo**
(`club_members.last_reminded_at`) y la tabla muestra "recordado hace 3 días".

**Camino 2: al tesorero, disparado por el cron.**
`utils/billingReminders.js` exporta `runPlayerBillingReminders(db)`, que se llama
al final de `POST /api/notifications/trigger` (el mismo cron externo que ya
manda los avisos de partidos). Cadencia fija, no configurable:

- **por vencer**: una sola vez, cuando faltan ≤ 3 días;
- **vencido**: cada 3 días, hasta un máximo de 4 recordatorios.

Solo corre para equipos con `teams.player_billing_reminders_enabled = TRUE`.
Las banderas de control viven **por movimiento** (`reminded_due_soon`,
`overdue_reminder_count`, `last_overdue_reminder_at`), así que cada cargo
respeta su propio tope.

La diferencia clave con el libro de la liga: **el aviso va agregado, uno por
equipo y por corrida** ("3 jugadores tienen cuotas vencidas — $2,400 en total"),
no uno por movimiento. Un equipo de 40 jugadores generaría 40 avisos idénticos y
volvería inservible la bandeja; y quien lo lee es el tesorero, que necesita
saber a quién perseguir hoy, no el detalle fila por fila — ese ya está en el
panel.

**El aviso nunca le llega al papá.** La tabla `notifications` tiene
`CHECK (recipient_type IN ('league','team'))` y los jugadores no tienen cuenta.

Tipos de notificación de este dominio: `player_payment_reported`,
`player_billing_due_soon`, `player_billing_overdue`. Se pintan en
`pages/Notifications.jsx` con su icono y etiqueta, y su `data.url` apunta a
`/panel/equipo/:id/finanzas`.

---

## 10. La API completa del panel

Prefijo `/api/player-billing` (`routes/playerBilling.js`). Todos los privados
llevan `authRequired` + `teamOwnerRequired`.

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/teams/:id/overview` | KPIs, padrón con saldo, pagos por confirmar, flujo mensual, lotes repetibles |
| GET | `/teams/:id/members/:memberId/entries` | El libro de un miembro |
| POST | `/teams/:id/members` | Alta en el padrón |
| PATCH | `/teams/:id/members/:memberId` | Edita persona **y** ficha de cobranza en una llamada |
| DELETE | `/teams/:id/members/:memberId` | Baja si tiene movimientos; borrado real si nunca tuvo |
| POST | `/teams/:id/members/import-roster` | Copia (una vez) de un roster de torneo |
| POST | `/teams/:id/charges` | Cargos en bloque, monto por jugador (lo esporádico; la mensualidad la genera el ciclo) |
| POST | `/teams/:id/members/:memberId/payments` | Pago capturado por el club (nace `confirmed`) |
| POST | `/entries/:entryId/confirm` | Confirmar un pago reportado por el papá |
| POST | `/entries/:entryId/void` | Cancelar (o rechazar, si era pendiente) |
| POST | `/teams/:id/members/:memberId/rotate-token` | Regenerar el link público |
| PATCH | `/teams/:id/settings` | Recordatorios y cobro automático (parcial) |
| **GET** | **`/statement/:shareToken`** | **Público, sin sesión** |
| **POST** | **`/statement/:shareToken/report-payment`** | **Público** — un pendiente a la vez |
| **POST** | **`/statement/:shareToken/withdraw-payment`** | **Público** — retirar el propio pendiente |
| **POST** | **`/statement/:shareToken/upload-proof`** | **Público** — subida del comprobante |

Los dos endpoints por `entryId` no llevan id de equipo en la URL, así que
`assertEntryAccess()` resuelve el equipo **desde el movimiento** y repite a mano
el criterio de `teamOwnerRequired`.

Otros routers que el panel consume:

| Método | Ruta | Sección |
|---|---|---|
| GET | `/api/billing/teams/:id/statement` | Con la liga |
| POST | `/api/billing/teams/:id/report-payment` | Con la liga |
| POST | `/api/billing/teams/:id/withdraw-payment` | Con la liga |
| GET | `/api/players/teams/:id/branches` | Jugadores (rosters de torneo) |
| GET/POST/… | `/api/players/branches/:branchId/teams/:teamId/roster` | `BranchRosterModal` |
| PUT | `/api/manage/teams/:id` | Perfil |
| GET/DELETE/POST | `/api/organizations/:id/members`, `/transfer-owner` | Administradores |
| POST | `/api/upload` | Comprobantes y fotos **con sesión** |

**El nombre de las cosas en la API.** El padrón son `members` y su id es
`member_id`; el nombre es un solo `display_name`. `first_name`/`last_name` ya no
existen en este router. Lo que sigue diciendo "player" es: el prefijo
`/api/player-billing`, el archivo `routes/playerBilling.js`, el valor
`created_by_side = 'player'`, la columna
`teams.player_billing_reminders_enabled` y los tipos de notificación `player_*`.
Todo eso se dejó a propósito: son valores guardados y prefijos cuyo renombre
mueve 18 endpoints de golpe (incluidos los tres públicos del papá) y **tiene
ventana de incompatibilidad al desplegar**, porque el frontend (Vercel) y el
backend (Render) se despliegan por separado y no terminan al mismo tiempo — y
quien tenga la pestaña abierta sigue con el bundle viejo hasta que recargue.

---

## 11. Reglas del proyecto que aplican a cualquier cambio aquí

1. **Nunca probar contra producción.** La `DATABASE_URL` local apunta hoy a la
   base real. Para cualquier prueba que escriba, se crea una rama en Neon.
2. **Nunca levantar un segundo backend en el 4000**: el que falla por
   `EADDRINUSE` alcanza a correr `initSchema()` antes de morir y tumba las
   consultas del que sí está sirviendo.
3. **Un script que escribe simula por defecto** (sin `--apply`/`--confirm`).
4. **Se resuelve al leer, no se migra.** Una excepción se guarda en columna
   nueva (`*_override`), nunca reusando la vieja.
5. **Los libros de dinero son append-only** (ver §6). No tocar `BALANCE_SUM_SQL`,
   los estados de un pago ni `reverses_entry_id` sin correr las dos suites e2e
   antes y después.
6. **Un valor que viaja en la API se cambia en los tres lados o en ninguno:**
   esquema, backend y frontend.
7. **Los datos de un menor no salen en ninguna pantalla pública.**
8. **El esquema se agrega, no se edita.** `db.js` corre ~150 instrucciones
   idempotentes en cada arranque, con `pg_advisory_xact_lock()` y un `SAVEPOINT`
   por migración.
9. **A quien solo viene a pagar o a ver, no se le pide cuenta.**
10. **Una transacción real no se reparte en varias llamadas**: `db.prepare` toma
    una conexión del pool por consulta y del otro lado hay un pooler en modo
    transacción. Lo atómico va en **una sola sentencia** con CTEs.
11. No hay ESLint ni Prettier: se sigue el estilo del archivo que se esté tocando.
12. Dependencia nueva solo si de verdad hace falta: el proyecto usa el runner de
    Node en vez de Jest y dibuja sus gráficas en **SVG a mano**.

**Cómo se verifica un cambio aquí:** cambio de cobranza → las dos suites e2e
(`backend/tests/billing-league.e2e.mjs` y `billing-player.e2e.mjs`) contra una
rama de Neon, antes y después. Cambio de UI → abrirlo en el navegador. Cambio de
esquema o de consulta → correrlo contra los datos reales dentro de una
transacción con `ROLLBACK` y `lock_timeout`. Las 135 pruebas unitarias (54
backend + 81 frontend) corren en CI en cada push; las e2e **no**, porque
necesitan Postgres vivo.

---

## 12. Qué NO hace este panel (fuera de alcance, a propósito)

- **Pasarela de pago en línea.** El esquema ya tiene las columnas (`provider`,
  `provider_payment_id`, `fee_amount`) para que un pago de pasarela entre como
  un movimiento más, pero no se construyó: en México estas cuotas ya son
  transferencias SPEI, y resolver la **conciliación** valía más hoy que cobrar
  con tarjeta.
- **CFDI / facturación.**
- **Cuenta propia para el papá** ni bandeja de notificaciones para él.
- **Recordatorio automático por WhatsApp o correo** al papá: hoy el disparo es
  humano, con el mensaje ya armado.
- **Inscripciones en línea y convocatorias.**
- **Control de asistencia a entrenamientos** (el padrón está pensado para
  soportarlo más adelante).
- **Un bloque de "oportunidades para el club"** (proveedores): no se construye
  hasta que haya oferta real registrada, porque con espacios vacíos se lee como
  publicidad y abarata justo la pantalla que se quería ver seria.
