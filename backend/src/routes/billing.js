import express from 'express';
import crypto from 'crypto';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isOrgMember } from '../utils/orgMembers.js';
import { isNonEmptyString, isValidUrl } from '../utils/validation.js';
import { leagueOwnerRequired, teamOwnerRequired } from '../middleware/ownership.js';
import { HOY_MX } from '../utils/sqlDates.js';

const router = express.Router();

// Cobranza liga → equipos ("estado de cuenta"). Libro append-only por
// (liga, equipo): la liga registra los cargos, y los pagos los puede registrar
// la liga (nacen confirmados) o reportarlos el equipo con su comprobante
// (nacen 'pending' y no mueven el saldo hasta que la liga los confirma).
// El saldo NUNCA se guarda — se calcula sumando los movimientos.
//
// Cancelar un movimiento = 2 escrituras: (1) status='void' en el original
// (solo para que deje de disparar recordatorios), (2) una fila 'adjustment'
// que revierte el monto. Así el libro conserva todo y el saldo cuadra.

const CHARGE_CATEGORIES = ['campo', 'arbitraje', 'transmision', 'inscripcion', 'multa', 'fianza', 'otro'];
const PAYMENT_METHODS   = ['transferencia', 'efectivo', 'deposito', 'otro'];

function formatMoney(amount, currency = 'MXN') {
  const n = Number(amount);
  if (Number.isNaN(n)) return `${amount} ${currency}`;
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function formatDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Suma de movimientos = saldo. Negativo = el equipo le debe a la liga.
//
// Los tres estados de un pago que NUNCA entró al saldo se descartan juntos, y
// el caso general de 'payment' sigue sin filtrar por status a propósito:
//
//   pending    reportado, esperando confirmación        → 0
//   rejected   el cobrador no lo reconoció              → 0
//   withdrawn  quien lo reportó lo retiró               → 0
//   void       un pago CONFIRMADO que se canceló        → suma +amount
//
// Ese último suma porque su cancelación ya metió una fila 'adjustment' de signo
// contrario; excluirlo restaría el monto dos veces. Los otros tres no llevan
// ajuste (nunca se abonaron), y por eso necesitan estado propio: si se les
// pusiera 'void' como al cancelado, empezarían a sumar un dinero que no existe.
// Ese fue justo el bug que cazó la prueba de punta a punta.
const BALANCE_SUM_SQL = `
  COALESCE(SUM(
    CASE
      WHEN kind = 'payment' AND status IN ('pending', 'rejected', 'withdrawn') THEN 0
      WHEN kind = 'payment' THEN amount
      WHEN kind = 'adjustment' AND direction = 'credit' THEN amount
      WHEN kind = 'adjustment' AND direction = 'debit'  THEN -amount
      WHEN kind = 'charge' THEN -amount
      ELSE 0
    END
  ), 0)
`;

async function computeBalance(leagueId, teamId) {
  const row = await db.prepare(`
    SELECT ${BALANCE_SUM_SQL} AS balance
    FROM team_ledger_entries
    WHERE league_id = ? AND team_id = ?
  `).get(leagueId, teamId);
  return Number(row?.balance || 0);
}

// Heurística simple de la V1: si el equipo ya no debe nada (saldo >= 0),
// todos sus cargos abiertos pasan a 'settled' y dejan de recordar.
async function settleIfPaid(leagueId, teamId) {
  const balance = await computeBalance(leagueId, teamId);
  if (balance >= 0) {
    await db.prepare(`
      UPDATE team_ledger_entries
      SET status = 'settled', updated_at = NOW()
      WHERE league_id = ? AND team_id = ? AND kind = 'charge' AND status = 'open'
    `).run(leagueId, teamId);
  }
  return balance;
}

// Aviso a la bandeja del equipo (in-app, sin push). data.url lleva al estado
// de cuenta, misma convención que el resto de notificaciones.
async function notifyTeam(teamId, leagueId, type, title, body, extra = {}) {
  await db.prepare(`
    INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
    VALUES ('team', ?, ?, ?, ?, ?)
  `).run(
    teamId,
    type,
    title,
    body,
    JSON.stringify({ team_id: teamId, league_id: leagueId, url: `/panel/equipo/${teamId}/estado-de-cuenta`, ...extra })
  );
}

// Confirma que un equipo pertenece a la liga (modelo clásico teams.league_id,
// el mismo que usa el panel de administración en manage.js).
async function teamInLeague(teamId, leagueId) {
  const row = await db.prepare('SELECT id, name FROM teams WHERE id = ? AND league_id = ?').get(teamId, leagueId);
  return row || null;
}

// Acceso a un movimiento por su id: admin de plataforma, o miembro de la
// organización de la liga dueña (con respaldo a owner_user_id). Copia del
// patrón de assertOrgAccess en routes/products.js.
async function assertLedgerLeagueAccess(req, res, entryId) {
  const entry = await db.prepare('SELECT * FROM team_ledger_entries WHERE id = ?').get(entryId);
  if (!entry) {
    res.status(404).json({ error: 'Movimiento no encontrado' });
    return null;
  }
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(entry.league_id);
  if (!league) {
    res.status(404).json({ error: 'Liga no encontrada' });
    return null;
  }
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role !== 'admin' && !isMember && league.owner_user_id !== req.user.id) {
    res.status(403).json({ error: 'No tienes permiso sobre esta cobranza' });
    return null;
  }
  return { entry, league };
}

function validateChargeMeta(body) {
  const { category, concept, due_date } = body;
  if (!CHARGE_CATEGORIES.includes(category)) return 'Categoría de cargo no válida';
  if (!isNonEmptyString(concept)) return 'El concepto es obligatorio';
  if (!due_date || Number.isNaN(new Date(due_date).getTime())) return 'La fecha de vencimiento no es válida';
  return null;
}

// Normaliza el cuerpo de "crear cargos" a una lista [{team_id, amount}]. Acepta
// la forma nueva { items: [{team_id, amount}] } (un monto por equipo) y la vieja
// { team_ids: [...], amount } (mismo monto para todos), por si algo externo la usa.
function normalizeChargeItems(body) {
  if (Array.isArray(body.items) && body.items.length > 0) {
    const items = [];
    for (const it of body.items) {
      const teamId = Number(it.team_id);
      const amount = Number(it.amount);
      if (!teamId || Number.isNaN(amount) || amount <= 0) {
        return { error: 'Cada equipo necesita un monto mayor a cero' };
      }
      items.push({ team_id: teamId, amount });
    }
    // si un equipo viene repetido, el último gana
    const byTeam = new Map(items.map((i) => [i.team_id, i.amount]));
    return { items: [...byTeam].map(([team_id, amount]) => ({ team_id, amount })) };
  }
  if (Array.isArray(body.team_ids) && body.team_ids.length > 0) {
    const amount = Number(body.amount);
    if (Number.isNaN(amount) || amount <= 0) return { error: 'El monto debe ser un número mayor a cero' };
    return { items: [...new Set(body.team_ids.map(Number))].map((team_id) => ({ team_id, amount })) };
  }
  return { error: 'Selecciona al menos un equipo' };
}

// Ordena etiquetas de jornada: las numéricas ascendentes primero, luego el resto
// alfabético (FINAL, PLAYOFF, SEMIFINAL…).
function sortWeekLabels(labels) {
  return [...labels].sort((a, b) => {
    const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
    if (na && nb) return Number(a) - Number(b);
    if (na) return -1;
    if (nb) return 1;
    return a.localeCompare(b);
  });
}

// ─── Panorama de la liga ────────────────────────────────────────────────────

router.get('/leagues/:leagueId/overview', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const leagueId = req.league.id;

  const teams = await db.prepare(
    'SELECT id, name, logo_url, owner_user_id FROM teams WHERE league_id = ? ORDER BY sort_order ASC, name ASC'
  ).all(leagueId);

  const agg = await db.prepare(`
    SELECT team_id,
           ${BALANCE_SUM_SQL} AS balance,
           COALESCE(SUM(CASE WHEN kind = 'charge' AND status = 'open' AND due_date < ${HOY_MX} THEN amount ELSE 0 END), 0) AS overdue_charges,
           MIN(CASE WHEN kind = 'charge' AND status = 'open' THEN due_date END) AS next_due_date
    FROM team_ledger_entries
    WHERE league_id = ?
    GROUP BY team_id
  `).all(leagueId);
  const byTeam = new Map(agg.map((r) => [r.team_id, r]));

  const rows = teams.map((t) => {
    const a = byTeam.get(t.id);
    const balance = Number(a?.balance || 0);
    const overdueCharges = Number(a?.overdue_charges || 0);
    return {
      team_id: t.id,
      team_name: t.name,
      logo_url: t.logo_url,
      has_representative: !!t.owner_user_id,
      balance,
      // El adeudo vencido no puede ser mayor a lo que el equipo debe en total.
      overdue_amount: Math.min(overdueCharges, Math.max(-balance, 0)),
      next_due_date: a?.next_due_date || null,
    };
  });

  const recentBatches = await db.prepare(`
    SELECT batch_id,
           MIN(created_at) AS created_at,
           MAX(category)   AS category,
           MAX(concept)    AS concept,
           MIN(amount)     AS min_amount,
           MAX(amount)     AS max_amount,
           SUM(amount)     AS total_amount,
           MAX(week_label) AS week_label,
           COUNT(*)        AS team_count
    FROM team_ledger_entries
    WHERE league_id = ? AND kind = 'charge' AND batch_id IS NOT NULL
    GROUP BY batch_id
    ORDER BY MIN(created_at) DESC
    LIMIT 12
  `).all(leagueId);

  // Pagos que los equipos reportaron y la liga todavía no confirma. Van aparte
  // de la tabla de saldos porque son lo único de la pantalla que pide una
  // acción hoy.
  const pendingPayments = await db.prepare(`
    SELECT e.id, e.team_id, e.amount, e.currency, e.payment_method, e.reference,
           e.proof_url, e.note, e.created_at,
           t.name AS team_name
    FROM team_ledger_entries e
    JOIN teams t ON t.id = e.team_id
    WHERE e.league_id = ? AND e.kind = 'payment' AND e.status = 'pending'
    ORDER BY e.created_at ASC
  `).all(leagueId);

  const tournaments = await db.prepare(
    'SELECT id, name, year FROM tournaments WHERE league_id = ? ORDER BY year DESC, sort_order ASC, name ASC'
  ).all(leagueId);

  const weekRows = await db.prepare(`
    SELECT DISTINCT m.week_label
    FROM matches m
    JOIN categories c ON c.id = m.category_id
    WHERE c.league_id = ? AND m.week_label IS NOT NULL AND m.is_draft = FALSE
  `).all(leagueId);

  res.json({
    league: { id: req.league.id, name: req.league.name, billing_reminders_enabled: req.league.billing_reminders_enabled },
    teams: rows,
    pending_payments: pendingPayments,
    recent_batches: recentBatches,
    tournaments,
    week_labels: sortWeekLabels(weekRows.map((r) => r.week_label)),
    categories: CHARGE_CATEGORIES,
    payment_methods: PAYMENT_METHODS,
  });
}));

// Cuántos partidos tiene cada equipo de la liga en un filtro dado (torneo y/o
// jornada). Alimenta el botón "calcular por # de partidos" del alta de cargos:
// cargo del equipo = cuota por partido × este conteo.
router.get('/leagues/:leagueId/match-counts', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const leagueId = req.league.id;
  const tournamentId = req.query.tournament_id ? Number(req.query.tournament_id) : null;
  const weekLabel = isNonEmptyString(req.query.week_label)
    ? String(req.query.week_label).trim().toUpperCase()
    : null;

  // El orden de los "?" en el texto SQL define el orden de los args (ver db.js).
  const args = [leagueId];
  let catFilter = 'c.league_id = ?';
  if (tournamentId) { catFilter += ' AND c.tournament_id = ?'; args.push(tournamentId); }
  let weekFilter = '';
  if (weekLabel) { weekFilter = 'AND m.week_label = ?'; args.push(weekLabel); }
  args.push(leagueId); // para el WHERE t.league_id = ? final

  const rows = await db.prepare(`
    SELECT t.id AS team_id, COUNT(m.id) AS match_count
    FROM teams t
    LEFT JOIN matches m ON (
      m.is_draft = FALSE
      AND (m.home_team_id = t.id OR m.away_team_id = t.id
           OR UPPER(m.home_team) = UPPER(t.name) OR UPPER(m.away_team) = UPPER(t.name))
      AND m.category_id IN (SELECT c.id FROM categories c WHERE ${catFilter})
      ${weekFilter}
    )
    WHERE t.league_id = ?
    GROUP BY t.id
  `).all(...args);

  res.json({ counts: rows.map((r) => ({ team_id: r.team_id, match_count: Number(r.match_count) })) });
}));

// Libro de un equipo, visto por la liga.
router.get('/leagues/:leagueId/teams/:teamId/entries', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const team = await teamInLeague(Number(req.params.teamId), req.league.id);
  if (!team) return res.status(404).json({ error: 'Ese equipo no pertenece a esta liga' });

  const entries = await db.prepare(`
    SELECT * FROM team_ledger_entries
    WHERE league_id = ? AND team_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(req.league.id, team.id);

  res.json({
    team: { id: team.id, name: team.name },
    balance: await computeBalance(req.league.id, team.id),
    entries,
  });
}));

// ─── Crear cargos ───────────────────────────────────────────────────────────

router.post('/leagues/:leagueId/charges', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const metaErr = validateChargeMeta(req.body);
  if (metaErr) return res.status(400).json({ error: metaErr });

  const { items, error } = normalizeChargeItems(req.body);
  if (error) return res.status(400).json({ error });

  const { category, concept, due_date, week_label, note } = req.body;
  const teamIds = items.map((i) => i.team_id);

  // Todos los equipos deben ser de esta liga.
  const valid = await db.prepare(
    `SELECT id FROM teams WHERE league_id = ? AND id IN (${teamIds.map(() => '?').join(',')})`
  ).all(req.league.id, ...teamIds);
  if (valid.length !== teamIds.length) {
    return res.status(400).json({ error: 'Uno o más equipos no pertenecen a esta liga' });
  }

  const batchId = crypto.randomUUID();
  const cleanConcept = concept.trim();
  const cleanWeek = isNonEmptyString(week_label) ? week_label.trim().toUpperCase() : null;
  const cleanNote = isNonEmptyString(note) ? note.trim() : null;

  for (const { team_id, amount } of items) {
    await db.prepare(`
      INSERT INTO team_ledger_entries
        (league_id, team_id, kind, category, concept, amount, due_date, week_label, note, batch_id, created_by_user_id, created_by_side)
      VALUES (?, ?, 'charge', ?, ?, ?, ?, ?, ?, ?, ?, 'league')
    `).run(req.league.id, team_id, category, cleanConcept, amount, due_date, cleanWeek, cleanNote, batchId, req.user.id);

    await notifyTeam(
      team_id,
      req.league.id,
      'billing_charge_new',
      'Nuevo cargo de tu liga 🧾',
      `${req.league.name} te registró un cargo de ${formatMoney(amount)} (${cleanConcept}). `
        + `Vence el ${formatDate(due_date)}.`
    );
  }

  res.status(201).json({ created: items.length, batch_id: batchId });
}));

// Repetir un lote anterior con nueva fecha de vencimiento.
router.post('/leagues/:leagueId/charges/repeat', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const { source_batch_id, due_date, week_label } = req.body;
  if (!isNonEmptyString(source_batch_id)) return res.status(400).json({ error: 'Falta el lote de origen' });
  if (!due_date || Number.isNaN(new Date(due_date).getTime())) return res.status(400).json({ error: 'La fecha de vencimiento no es válida' });

  const source = await db.prepare(`
    SELECT * FROM team_ledger_entries
    WHERE batch_id = ? AND league_id = ? AND kind = 'charge'
  `).all(source_batch_id, req.league.id);
  if (source.length === 0) return res.status(404).json({ error: 'No se encontró el lote de origen' });

  const template = source[0];
  // Monto por equipo del lote original — así "repetir" respeta que cada equipo
  // pagó distinto. Si un equipo aparece más de una vez, el último gana.
  const amountByTeam = new Map(source.map((r) => [r.team_id, Number(r.amount)]));
  const requested = Array.isArray(req.body.team_ids) && req.body.team_ids.length > 0
    ? [...new Set(req.body.team_ids.map(Number))]
    : [...amountByTeam.keys()];

  // Solo equipos que sigan en la liga y que estuvieran en el lote original.
  const valid = await db.prepare(
    `SELECT id FROM teams WHERE league_id = ? AND id IN (${requested.map(() => '?').join(',')})`
  ).all(req.league.id, ...requested);
  const teamIds = valid.map((r) => r.id).filter((id) => amountByTeam.has(id));
  if (teamIds.length === 0) return res.status(400).json({ error: 'Ningún equipo válido para repetir el cargo' });

  const batchId = crypto.randomUUID();
  const cleanWeek = isNonEmptyString(week_label) ? week_label.trim().toUpperCase() : template.week_label;

  for (const teamId of teamIds) {
    const amount = amountByTeam.get(teamId);
    await db.prepare(`
      INSERT INTO team_ledger_entries
        (league_id, team_id, kind, category, concept, amount, due_date, week_label, note, batch_id, created_by_user_id, created_by_side)
      VALUES (?, ?, 'charge', ?, ?, ?, ?, ?, ?, ?, ?, 'league')
    `).run(req.league.id, teamId, template.category, template.concept, amount, due_date, cleanWeek, template.note, batchId, req.user.id);

    await notifyTeam(
      teamId,
      req.league.id,
      'billing_charge_new',
      'Nuevo cargo de tu liga 🧾',
      `${req.league.name} te registró un cargo de ${formatMoney(amount)} (${template.concept}). `
        + `Vence el ${formatDate(due_date)}.`
    );
  }

  res.status(201).json({ created: teamIds.length, batch_id: batchId });
}));

// ─── Registrar un pago recibido (solo la liga en la V1) ─────────────────────

router.post('/leagues/:leagueId/teams/:teamId/payments', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const team = await teamInLeague(Number(req.params.teamId), req.league.id);
  if (!team) return res.status(404).json({ error: 'Ese equipo no pertenece a esta liga' });

  const { amount, payment_method, reference, proof_url, note } = req.body;
  if (amount === undefined || amount === null || amount === '' || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'El monto debe ser un número mayor a cero' });
  }
  if (!PAYMENT_METHODS.includes(payment_method)) return res.status(400).json({ error: 'Método de pago no válido' });
  if (proof_url && !isValidUrl(proof_url)) return res.status(400).json({ error: 'El comprobante no es una dirección web válida' });

  const concept = isNonEmptyString(note) ? note.trim() : 'Pago recibido';

  const payment = await db.prepare(`
    INSERT INTO team_ledger_entries
      (league_id, team_id, kind, concept, amount, payment_method, reference, proof_url, note, status, created_by_user_id, created_by_side)
    VALUES (?, ?, 'payment', ?, ?, ?, ?, ?, ?, 'confirmed', ?, 'league')
    RETURNING *
  `).get(
    req.league.id, team.id, concept, Number(amount),
    payment_method,
    isNonEmptyString(reference) ? reference.trim() : null,
    proof_url || null,
    isNonEmptyString(note) ? note.trim() : null,
    req.user.id
  );

  const balance = await settleIfPaid(req.league.id, team.id);

  await notifyTeam(
    team.id,
    req.league.id,
    'billing_payment_recorded',
    'Tu liga registró un pago ✅',
    `${req.league.name} registró un pago de ${formatMoney(amount)} a tu cuenta. `
      + `Saldo actual: ${formatMoney(balance)}.`
  );

  res.status(201).json({ payment, balance });
}));

// ─── Cancelar un movimiento ─────────────────────────────────────────────────

router.post('/entries/:id/void', authRequired, asyncHandler(async (req, res) => {
  const access = await assertLedgerLeagueAccess(req, res, Number(req.params.id));
  if (!access) return;
  const { entry, league } = access;

  if (entry.kind === 'adjustment') {
    return res.status(400).json({ error: 'Un ajuste no se puede cancelar' });
  }

  const reason = isNonEmptyString(req.body?.reason) ? req.body.reason.trim() : null;

  // Rechazar un pago PENDIENTE no lleva ajuste: ese pago nunca entró al saldo
  // (ver BALANCE_SUM_SQL), así que no hay nada que revertir. Meterle un ajuste
  // le restaría al equipo un dinero que nunca se le abonó.
  const isPendingPayment = entry.kind === 'payment' && entry.status === 'pending';

  if (!isPendingPayment) {
    const direction = entry.kind === 'charge' ? 'credit' : 'debit';

    // Idempotente: si ya existe el ajuste que lo revierte, no se crea otro.
    const existingReversal = await db.prepare(
      'SELECT id FROM team_ledger_entries WHERE reverses_entry_id = ?'
    ).get(entry.id);

    if (!existingReversal) {
      await db.prepare(`
        INSERT INTO team_ledger_entries
          (league_id, team_id, kind, concept, amount, direction, note, reverses_entry_id, status, created_by_user_id, created_by_side)
        VALUES (?, ?, 'adjustment', ?, ?, ?, ?, ?, 'applied', ?, 'league')
      `).run(
        entry.league_id, entry.team_id,
        `Cancelación: ${entry.concept}`,
        entry.amount, direction, reason, entry.id, req.user.id
      );
    }
  }

  // 'rejected' en vez de 'void' para un pendiente: ver BALANCE_SUM_SQL.
  const nextStatus = isPendingPayment ? 'rejected' : 'void';
  if (entry.status !== nextStatus) {
    await db.prepare(`
      UPDATE team_ledger_entries
      SET status = ?, voided_at = NOW(), voided_by_user_id = ?, updated_at = NOW()
      WHERE id = ?
    `).run(nextStatus, req.user.id, entry.id);
  }

  const balance = await settleIfPaid(entry.league_id, entry.team_id);

  // Si se canceló un cargo, avisamos al equipo (le baja el adeudo).
  if (entry.kind === 'charge') {
    await notifyTeam(
      entry.team_id,
      entry.league_id,
      'billing_payment_recorded',
      'Tu liga canceló un cargo ✅',
      `${league.name} canceló el cargo de ${formatMoney(entry.amount)} (${entry.concept}). `
        + `Saldo actual: ${formatMoney(balance)}.`
    );
  }

  // Si se rechazó un pago que el equipo había reportado, tiene que enterarse —
  // si no, se queda creyendo que ya quedó.
  if (isPendingPayment) {
    await notifyTeam(
      entry.team_id,
      entry.league_id,
      'billing_payment_rejected',
      'Tu liga no pudo confirmar tu pago ⚠️',
      `${league.name} rechazó el pago de ${formatMoney(entry.amount)} que reportaste`
        + `${reason ? ` (${reason})` : ''}. Revisa tu estado de cuenta y vuelve a reportarlo.`
    );
  }

  res.json({ ok: true, balance });
}));

// ─── El equipo reporta un pago (y la liga lo confirma) ──────────────────────
//
// El espejo de lo que el papá hace con su club, un nivel arriba. Antes la liga
// era la única que escribía en este libro, así que un equipo que ya había
// transferido le mandaba la captura por WhatsApp y alguien la capturaba a mano
// — o se le olvidaba. Ahora el equipo lo reporta desde su panel y la liga
// confirma con un clic.
//
// El pago nace 'pending' y NO baja el saldo hasta que la liga lo confirma. Eso
// es a propósito: quien cobra es quien decide cuándo el dinero está en su
// cuenta, no quien dice haberlo mandado.
//
// El comprobante se sube con POST /api/upload de siempre — aquí sí hay sesión
// (a diferencia del papá, que no tiene cuenta y necesitó un endpoint aparte).
router.post('/teams/:id/report-payment', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  if (!req.team.league_id) {
    return res.status(400).json({ error: 'Tu equipo no pertenece a ninguna liga, así que no hay a quién reportarle un pago' });
  }

  const { amount, payment_method, reference, proof_url, note } = req.body;
  if (amount === undefined || amount === null || amount === '' || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'El monto debe ser un número mayor a cero' });
  }
  if (!PAYMENT_METHODS.includes(payment_method)) return res.status(400).json({ error: 'Método de pago no válido' });
  if (proof_url && !isValidUrl(proof_url)) return res.status(400).json({ error: 'El comprobante no es una dirección web válida' });

  // Un pendiente a la vez por equipo: si le dan dos veces al botón, o reportan
  // de nuevo antes de que la liga revise, no se le llena la bandeja de
  // duplicados que luego tiene que rechazar uno por uno.
  const alreadyPending = await db.prepare(`
    SELECT id FROM team_ledger_entries
    WHERE league_id = ? AND team_id = ? AND kind = 'payment' AND status = 'pending'
  `).get(req.team.league_id, req.team.id);
  if (alreadyPending) {
    return res.status(409).json({ error: 'Ya tienes un pago esperando confirmación de tu liga. Espera a que lo revisen.' });
  }

  await db.prepare(`
    INSERT INTO team_ledger_entries
      (league_id, team_id, kind, concept, amount, payment_method, reference, proof_url, note, status, created_by_user_id, created_by_side)
    VALUES (?, ?, 'payment', ?, ?, ?, ?, ?, ?, 'pending', ?, 'team')
  `).run(
    req.team.league_id, req.team.id,
    'Pago reportado por el equipo',
    Number(amount),
    payment_method,
    isNonEmptyString(reference) ? reference.trim() : null,
    proof_url || null,
    isNonEmptyString(note) ? note.trim() : null,
    req.user.id
  );

  // A la bandeja de la LIGA, no a la del equipo — el que tiene que actuar es
  // quien cobra. recipient_type='league' ya está permitido por el CHECK.
  await db.prepare(`
    INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
    VALUES ('league', ?, ?, ?, ?, ?)
  `).run(
    req.team.league_id,
    'team_payment_reported',
    'Un pago espera tu confirmación 🧾',
    `${req.team.name} reportó un pago de ${formatMoney(amount)} (${payment_method}). `
      + `Revísalo en Cobranza para que se aplique a su estado de cuenta.`,
    JSON.stringify({
      league_id: req.team.league_id,
      team_id: req.team.id,
      url: `/panel/liga/${req.team.league_id}/cobranza`,
    })
  );

  res.status(201).json({ ok: true });
}));

// Retirar el pago que uno mismo reportó y todavía no le confirman.
//
// Sin esto, la regla de "un pendiente a la vez" se vuelve una trampa: quien
// tecleó 500 en vez de 5000 se queda atorado hasta que del otro lado se lo
// rechacen. No lleva ajuste ni recalcula nada — un pendiente nunca entró al
// saldo (ver BALANCE_SUM_SQL).
//
// Solo se puede retirar lo que reportó el EQUIPO (created_by_side='team'): un
// pago que capturó la liga no es del equipo para quitarlo.
router.post('/teams/:id/withdraw-payment', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const pending = await db.prepare(`
    SELECT id FROM team_ledger_entries
    WHERE team_id = ? AND kind = 'payment' AND status = 'pending' AND created_by_side = 'team'
  `).get(req.team.id);

  if (!pending) return res.status(404).json({ error: 'No tienes ningún pago esperando confirmación' });

  await db.prepare(`
    UPDATE team_ledger_entries
    SET status = 'withdrawn', voided_at = NOW(), voided_by_user_id = ?,
        note = 'Retirado por el equipo antes de confirmarse', updated_at = NOW()
    WHERE id = ?
  `).run(req.user.id, pending.id);

  res.json({ ok: true });
}));

// La liga confirma un pago reportado: pasa a 'confirmed' y ahí sí mueve el saldo.
router.post('/entries/:id/confirm', authRequired, asyncHandler(async (req, res) => {
  const access = await assertLedgerLeagueAccess(req, res, Number(req.params.id));
  if (!access) return;
  const { entry, league } = access;

  if (entry.kind !== 'payment' || entry.status !== 'pending') {
    return res.status(400).json({ error: 'Solo se puede confirmar un pago pendiente' });
  }

  await db.prepare(`
    UPDATE team_ledger_entries
    SET status = 'confirmed', updated_at = NOW()
    WHERE id = ? AND status = 'pending'
  `).run(entry.id);

  const balance = await settleIfPaid(entry.league_id, entry.team_id);

  await notifyTeam(
    entry.team_id,
    entry.league_id,
    'billing_payment_recorded',
    'Tu liga confirmó tu pago ✅',
    `${league.name} confirmó el pago de ${formatMoney(entry.amount)} que reportaste. `
      + `Saldo actual: ${formatMoney(balance)}.`
  );

  res.json({ ok: true, balance });
}));

// ─── Ajustes de la liga ─────────────────────────────────────────────────────

router.patch('/leagues/:leagueId/settings', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const enabled = Boolean(req.body?.billing_reminders_enabled);
  await db.prepare('UPDATE leagues SET billing_reminders_enabled = ? WHERE id = ?').run(enabled, req.league.id);
  res.json({ billing_reminders_enabled: enabled });
}));

// ─── Estado de cuenta del equipo (solo lectura) ─────────────────────────────

router.get('/teams/:id/statement', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  // Un equipo independiente (sin liga) no tiene ninguna relación de cobranza
  // — ese libro es siempre liga -> equipo. No hay estado de cuenta que armar.
  if (!req.team.league_id) {
    return res.json({
      team: { id: req.team.id, name: req.team.name },
      league_name: null,
      league_contact: null,
      balance: 0,
      currency: 'MXN',
      next_due_date: null,
      overdue_amount: 0,
      has_pending_payment: false,
      payment_methods: PAYMENT_METHODS,
      entries: [],
    });
  }

  const leagueId = req.team.league_id;
  const teamId = req.team.id;

  const entries = await db.prepare(`
    SELECT id, kind, category, concept, amount, currency, due_date, week_label, status,
           direction, payment_method, reference, proof_url, note, reverses_entry_id,
           voided_at, created_at
    FROM team_ledger_entries
    WHERE league_id = ? AND team_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(leagueId, teamId);

  const agg = await db.prepare(`
    SELECT ${BALANCE_SUM_SQL} AS balance,
           MIN(CASE WHEN kind = 'charge' AND status = 'open' THEN due_date END) AS next_due_date,
           COALESCE(SUM(CASE WHEN kind = 'charge' AND status = 'open' AND due_date < ${HOY_MX} THEN amount ELSE 0 END), 0) AS overdue_charges
    FROM team_ledger_entries
    WHERE league_id = ? AND team_id = ?
  `).get(leagueId, teamId);

  const balance = Number(agg?.balance || 0);
  const hasPending = entries.some((e) => e.kind === 'payment' && e.status === 'pending');

  res.json({
    team: { id: teamId, name: req.team.name },
    has_pending_payment: hasPending,
    payment_methods: PAYMENT_METHODS,
    league_name: req.league.name,
    league_contact: {
      whatsapp: req.league.whatsapp || null,
      website: req.league.website_url || null,
    },
    balance,
    currency: 'MXN',
    next_due_date: agg?.next_due_date || null,
    overdue_amount: Math.min(Number(agg?.overdue_charges || 0), Math.max(-balance, 0)),
    entries,
  });
}));

export default router;
