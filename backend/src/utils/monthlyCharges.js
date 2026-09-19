import { HOY_MX } from './sqlDates.js';

// Generación automática de la mensualidad del club.
//
// Reemplaza al botón "Repetir el mes pasado", que tenía dos defectos de fondo:
// le volvía a cobrar a quien ya estaba dado de baja (solo comprobaba que la
// fila siguiera existiendo, no su situación), y nada impedía apretarlo dos
// veces y cobrar el mes doble. Aquí no hay botón: el club define UNA fecha —el
// día en que se paga— y el cargo nace solo, cinco días antes.
//
// ── Por qué es idempotente y no "se llama una vez al mes" ──
//
// El único cron que existe es EXTERNO al repositorio: un servicio de fuera
// llama POST /api/notifications/trigger con x-cron-secret. No está en
// .github/workflows/, no hay render.yaml, no hay node-cron, y su frecuencia no
// está documentada en ningún archivo del proyecto. Colgar de ahí la generación
// de dinero significa que si ese cron se cae, se reconfigura mal o nadie se
// acuerda de él, el club deja de facturar EN SILENCIO.
//
// Del lado del cron eso ya está acotado: utils/cronSchedule.js hace que esta
// función corra UNA vez al día la llamen las veces que la llamen, así que su
// frecuencia dejó de importar mientras el cron siga vivo. Lo que ese candado
// NO puede arreglar es que el cron se muera del todo — para eso sigue estando
// la vía perezosa del panel, y por eso las dos siguen existiendo.
//
// Por eso esto se llama desde dos lados —el cron y la carga del panel— y la
// garantía de no duplicar no vive en el código sino en la base: el índice
// único parcial idx_club_ledger_auto_cycle (ver config/db.js). Correrla dos
// veces el mismo día, o veinte, da exactamente el mismo resultado que correrla
// una. Si el cron y el panel coinciden, Postgres bloquea un instante y la
// segunda sentencia salta las filas en conflicto; con una comprobación en JS
// habría ventana de carrera de verdad.

// El cargo nace este número de días antes de la fecha de pago. Es constante
// del sistema y no una perilla más: el club ya configura una fecha, y dos
// fechas para lo mismo es justo lo que volvía confuso el modelo anterior de
// "vence el día X pero se genera el día Y". Sirve para que la familia lo vea
// venir y para que el aviso de "cuotas por vencer" (≤3 días) alcance a correr.
const DIAS_DE_ANTICIPACION = 5;

const NOMBRE_INDICE = 'idx_club_ledger_auto_cycle';

// Se comprueba una sola vez por proceso. `undefined` = todavía no se preguntó.
let indicePresente;

// El índice es la única protección contra el doble cobro, y `run()` de
// initSchema se traga el error de cualquier migración que falle (ver el
// SAVEPOINT en config/db.js). O sea: el índice podría no existir y no habría
// rastro en ningún log. Antes que insertar sin protección, esto se niega a
// insertar — una negativa ruidosa es mejor que una corrupción callada.
async function hayIndice(db) {
  if (indicePresente !== undefined) return indicePresente;
  const row = await db.prepare(`
    SELECT 1 AS ok FROM pg_indexes
    WHERE tablename = 'club_ledger_entries' AND indexname = ?
  `).get(NOMBRE_INDICE);
  indicePresente = Boolean(row);
  if (!indicePresente) {
    console.error(
      `[mensualidad] Falta el índice ${NOMBRE_INDICE}. No se genera nada: sin él, ` +
      'el cron y el panel pueden cobrar el mismo mes dos veces. Revisa que la ' +
      'migración de config/db.js se haya aplicado (run() no avisa si falla).'
    );
  }
  return indicePresente;
}

// Los meses en español salen de un arreglo y no de to_char(): to_char depende
// de lc_time, que es un ajuste del servidor, y con el pooler de por medio no
// es confiable fijarlo. Así "OCT-2026" es determinista y ya viene en español.
const ETIQUETA_MES = `(ARRAY['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'])`;
const NOMBRE_MES = `(ARRAY['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])`;

// Una sola sentencia. No se reparte en varias llamadas porque `db.prepare` toma
// una conexión del pool por consulta y del otro lado hay un pooler en modo
// transacción: un BEGIN/COMMIT repartido no tiene garantizada la misma
// conexión. Un INSERT ... SELECT sí es atómico pase lo que pase.
const SQL_GENERAR = `
WITH hoy AS (
  SELECT ${HOY_MX} AS d
),
candidatos AS (
  -- Mes anterior, actual y siguiente. Ese rango ±1 ES la política de
  -- retroactividad: recupera hasta un mes de cron caído, y hace
  -- ESTRUCTURALMENTE imposible que una corrida genere una avalancha. El mes
  -- siguiente hace falta por los 5 días de anticipación (el 26 de septiembre
  -- ya toca generar octubre).
  SELECT t.id                        AS team_id,
         t.monthly_charge_started_on AS ancla,
         h.d                         AS hoy,
         (date_trunc('month', h.d)
            + make_interval(months => g.k)
            + make_interval(days   => t.monthly_charge_day - 1))::date AS due_date
  FROM teams t
  CROSS JOIN hoy h
  CROSS JOIN generate_series(-1, 1) AS g(k)
  WHERE t.monthly_charge_enabled = TRUE
    AND t.monthly_charge_day BETWEEN 1 AND 28
    AND t.monthly_charge_started_on IS NOT NULL
    AND (?::int IS NULL OR t.id = ?::int)
),
periodos AS (
  SELECT team_id,
         due_date,
         ${ETIQUETA_MES}[EXTRACT(MONTH FROM due_date)::int]
           || '-' || EXTRACT(YEAR FROM due_date)::text AS period_label,
         ${NOMBRE_MES}[EXTRACT(MONTH FROM due_date)::int]
           || ' ' || EXTRACT(YEAR FROM due_date)::text AS mes_largo
  FROM candidatos
  WHERE due_date - ${DIAS_DE_ANTICIPACION} <= hoy
    AND due_date >= ancla
)
INSERT INTO club_ledger_entries
  (team_id, member_id, kind, category, concept, amount, currency, due_date,
   period_label, status, batch_id, auto_cycle_key, created_by_user_id, created_by_side)
SELECT
  m.team_id,
  m.id,
  'charge',
  'mensualidad',
  'Mensualidad de ' || pe.mes_largo,
  m.monthly_amount,
  'MXN',
  pe.due_date,
  pe.period_label,
  'open',
  -- batch_id determinista: la corrida repetida agrupa igual, y el panel puede
  -- mostrar el mes como una unidad ("Mensualidad OCT-2026 · 23 jugadores").
  'auto-' || pe.team_id || '-' || pe.period_label,
  'mensualidad:' || pe.period_label,
  NULL,
  'team'
FROM periodos pe
JOIN club_members m ON m.team_id = pe.team_id
WHERE m.status = 'activo'
  AND m.monthly_amount IS NOT NULL
  AND m.monthly_amount > 0
  -- A quien entró al padrón DESPUÉS de la fecha de pago no se le cobra ese mes.
  AND (m.joined_date IS NULL OR m.joined_date <= pe.due_date)
  -- Guarda blanda: el ciclo no cobra un mes que un humano ya cobró a mano.
  -- Solo mira filas MANUALES (auto_cycle_key IS NULL) — las automáticas ya las
  -- bloquea el índice, incluso canceladas, que es justo lo que se quiere.
  --
  -- Esta guarda es heurística a propósito y no puede ser un índice: un cargo
  -- manual no tiene identidad de periodo confiable (period_label es texto
  -- libre y nullable), así que se compara por el mes de la fecha de pago.
  AND NOT EXISTS (
    SELECT 1
    FROM club_ledger_entries x
    WHERE x.team_id   = m.team_id
      AND x.member_id = m.id
      AND x.kind      = 'charge'
      AND x.category  = 'mensualidad'
      AND x.auto_cycle_key IS NULL
      AND x.status <> 'void'
      AND x.due_date IS NOT NULL
      AND date_trunc('month', x.due_date) = date_trunc('month', pe.due_date)
  )
ON CONFLICT (team_id, member_id, auto_cycle_key) WHERE auto_cycle_key IS NOT NULL
DO NOTHING
RETURNING team_id, period_label, amount
`;

/**
 * Genera la mensualidad de los periodos vigentes.
 *
 * Nunca lanza: la llama tanto el cron (que no debe morir por esto) como la
 * carga del panel (que tiene que abrir aunque la generación falle).
 *
 * @param {object} db
 * @param {{ teamId?: number|null }} opts  teamId null = todos los equipos (cron)
 * @returns {Promise<{created: number, lotes: Array<{team_id:number, period_label:string, miembros:number, total:number}>, error: string|null}>}
 */
export async function runMonthlyChargeGeneration(db, { teamId = null } = {}) {
  const vacio = { created: 0, lotes: [], error: null };
  try {
    if (!(await hayIndice(db))) {
      return { ...vacio, error: `falta el índice ${NOMBRE_INDICE}` };
    }

    // teamId va dos veces: toPgPlaceholders traduce cada `?` a un $n nuevo,
    // no reutiliza el número (ver config/db.js).
    const filas = await db.prepare(SQL_GENERAR).all(teamId, teamId);

    const porLote = new Map();
    for (const f of filas) {
      const clave = `${f.team_id}|${f.period_label}`;
      const acc = porLote.get(clave) || { team_id: f.team_id, period_label: f.period_label, miembros: 0, total: 0 };
      acc.miembros += 1;
      acc.total += Number(f.amount);
      porLote.set(clave, acc);
    }

    const lotes = [...porLote.values()];
    if (lotes.length > 0) {
      const resumen = lotes.map((l) => `equipo ${l.team_id} ${l.period_label}: ${l.miembros} cargos`).join(' · ');
      console.log(`[mensualidad] ${filas.length} cargos generados — ${resumen}`);
    }
    return { created: filas.length, lotes, error: null };
  } catch (err) {
    // Mismo criterio que runPlayerBillingReminders: no debe tumbar ni el cron
    // ni el panel. Pero "no truena" no puede significar "nadie se entera": el
    // error sube en el resultado para que quien llama lo muestre.
    console.error('[mensualidad] la generación falló:', err);
    return { ...vacio, error: err.message };
  }
}
