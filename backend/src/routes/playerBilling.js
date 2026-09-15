import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isNonEmptyString, isValidUrl, isValidEmail } from '../utils/validation.js';
import { isOrgMember } from '../utils/orgMembers.js';
import { teamOwnerRequired } from '../middleware/ownership.js';
import { publicStatementLimiter, reportPaymentLimiter } from '../middleware/rateLimit.js';
import { ensureCloudinaryConfigured, uploadBufferToCloudinary } from '../utils/cloudinary.js';

const router = express.Router();

// Cobranza equipo → jugadores ("cuotas del club"). Hermano de routes/billing.js
// (liga → equipo): mismo libro append-only, mismas reglas de cancelación, mismo
// criterio de que el saldo NUNCA se guarda sino que se suma.
//
// Dos cosas que este libro sí hace y el de la liga no:
//
//  1. El papá ESCRIBE. Reporta su pago con comprobante desde un link público
//     (/api/player-billing/statement/:shareToken), sin cuenta y sin sesión —
//     la mayoría de los jugadores no tiene usuario en la plataforma
//     (players.user_id es nullable y no hay flujo para reclamarlo todavía).
//     Ese pago nace en 'pending' y NO baja el saldo hasta que el club lo
//     confirma.
//
//  2. El aviso al papá lo dispara un humano, no el cron. El panel arma el
//     mensaje de WhatsApp y el tesorero lo manda; aquí solo se registra cuándo
//     (team_player_accounts.last_reminded_at).

const CHARGE_CATEGORIES = ['mensualidad', 'inscripcion', 'uniforme', 'torneo', 'equipamiento', 'multa', 'otro'];
const PAYMENT_METHODS   = ['transferencia', 'efectivo', 'deposito', 'otro'];
const ACCOUNT_STATUSES  = ['activo', 'baja', 'beca'];

function formatMoney(amount, currency = 'MXN') {
  const n = Number(amount);
  if (Number.isNaN(n)) return `${amount} ${currency}`;
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

// Suma de movimientos = saldo. Negativo = el jugador le debe al club.
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

async function computeBalance(teamId, playerId) {
  const row = await db.prepare(`
    SELECT ${BALANCE_SUM_SQL} AS balance
    FROM player_ledger_entries
    WHERE team_id = ? AND player_id = ?
  `).get(teamId, playerId);
  return Number(row?.balance || 0);
}

// Misma heurística que la liga: si el jugador ya no debe nada, sus cargos
// abiertos pasan a 'settled' y dejan de disparar recordatorios.
async function settleIfPaid(teamId, playerId) {
  const balance = await computeBalance(teamId, playerId);
  if (balance >= 0) {
    await db.prepare(`
      UPDATE player_ledger_entries
      SET status = 'settled', updated_at = NOW()
      WHERE team_id = ? AND player_id = ? AND kind = 'charge' AND status = 'open'
    `).run(teamId, playerId);
  }
  return balance;
}

// Aviso a la bandeja del EQUIPO. No existe bandeja de jugador: la tabla
// notifications tiene CHECK (recipient_type IN ('league','team')) y los
// jugadores no tienen cuenta. Al papá se le avisa por WhatsApp desde el panel.
async function notifyTeam(teamId, type, title, body, extra = {}) {
  await db.prepare(`
    INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
    VALUES ('team', ?, ?, ?, ?, ?)
  `).run(
    teamId,
    type,
    title,
    body,
    JSON.stringify({ team_id: teamId, url: `/panel/equipo/${teamId}/finanzas`, ...extra })
  );
}

// El padrón del club es team_player_accounts y nada más.
//
// Antes esta función creaba cuentas a partir de player_team_memberships (el
// roster por rama). Eso ataba la contabilidad a que la LIGA inscribiera al
// equipo: un equipo independiente no podía cobrarle a nadie, jamás. Ahora el
// club da de alta a su gente directamente (POST /teams/:id/members) y esto
// solo responde quién está en el padrón.
async function membersOfTeam(teamId, playerIds) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) return new Set();
  const rows = await db.prepare(`
    SELECT player_id
    FROM team_player_accounts
    WHERE team_id = ?
      AND player_id IN (${playerIds.map(() => '?').join(',')})
  `).all(teamId, ...playerIds);
  return new Set(rows.map((r) => r.player_id));
}

// Acceso a un movimiento por su id. No hay id de equipo en la URL, así que se
// resuelve el equipo desde el movimiento y se repite el criterio de
// teamOwnerRequired (org del equipo, org de la liga, dueño de cualquiera de
// las dos, o admin de plataforma).
async function assertEntryAccess(req, res, entryId) {
  const entry = await db.prepare('SELECT * FROM player_ledger_entries WHERE id = ?').get(entryId);
  if (!entry) {
    res.status(404).json({ error: 'Movimiento no encontrado' });
    return null;
  }
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(entry.team_id);
  if (!team) {
    res.status(404).json({ error: 'Equipo no encontrado' });
    return null;
  }
  const league = team.league_id
    ? await db.prepare('SELECT * FROM leagues WHERE id = ?').get(team.league_id)
    : null;

  const isTeamMember   = await isOrgMember(req.user.id, team.organization_id);
  const isLeagueMember = league ? await isOrgMember(req.user.id, league.organization_id) : false;

  if (
    req.user.role === 'admin' ||
    isTeamMember ||
    isLeagueMember ||
    team.owner_user_id === req.user.id ||
    (league && league.owner_user_id === req.user.id)
  ) {
    return { entry, team };
  }
  res.status(403).json({ error: 'No tienes permiso sobre esta cobranza' });
  return null;
}

function validateChargeMeta(body) {
  const { category, concept, due_date } = body;
  if (!CHARGE_CATEGORIES.includes(category)) return 'Categoría de cargo no válida';
  if (!isNonEmptyString(concept)) return 'El concepto es obligatorio';
  if (!due_date || Number.isNaN(new Date(due_date).getTime())) return 'La fecha de vencimiento no es válida';
  return null;
}

// Normaliza el cuerpo de "crear cargos" a [{player_id, amount}]. Copia de
// normalizeChargeItems en routes/billing.js con player_id en vez de team_id.
// Se permite amount = 0 (a diferencia del libro de liga) para poder generar la
// mensualidad de TODA la categoría de un jalón incluyendo a los becados, sin
// tener que acordarse de destildarlos uno por uno. Las filas en 0 no se
// insertan (ver el handler): un cargo de cero no es un movimiento contable.
function normalizeChargeItems(body) {
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return { error: 'Selecciona al menos un jugador' };
  }
  const items = [];
  for (const it of body.items) {
    const playerId = Number(it.player_id);
    const amount = Number(it.amount);
    if (!playerId || Number.isNaN(amount) || amount < 0) {
      return { error: 'Cada jugador necesita un monto válido' };
    }
    items.push({ player_id: playerId, amount });
  }
  // si un jugador viene repetido, el último gana
  const byPlayer = new Map(items.map((i) => [i.player_id, i.amount]));
  return { items: [...byPlayer].map(([player_id, amount]) => ({ player_id, amount })) };
}

// ─── Panorama del equipo ────────────────────────────────────────────────────

router.get('/teams/:id/overview', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {

  const teamId = req.team.id;
  // Sale del padrón del club (team_player_accounts), NO del roster de torneo.
  // Un equipo independiente, o uno al que su liga todavía no inscribe en
  // ninguna rama, tiene aquí a toda su gente igual.
  const players = await db.prepare(`
    SELECT p.id AS player_id, p.first_name, p.last_name, p.photo_url,
           p.jersey_number, p.position, p.birth_date, p.curp,
           a.monthly_amount, a.status, a.group_label, a.joined_date, a.note,
           a.tutor_name, a.tutor_phone, a.tutor_email,
           a.share_token, a.last_reminded_at
    FROM team_player_accounts a
    JOIN players p ON p.id = a.player_id
    WHERE a.team_id = ?
    ORDER BY a.group_label NULLS LAST, p.last_name, p.first_name
  `).all(teamId);

  const agg = await db.prepare(`
    SELECT player_id,
           ${BALANCE_SUM_SQL} AS balance,
           COALESCE(SUM(CASE WHEN kind = 'charge' AND status = 'open' AND due_date < CURRENT_DATE THEN amount ELSE 0 END), 0) AS overdue_charges,
           MIN(CASE WHEN kind = 'charge' AND status = 'open' THEN due_date END) AS next_due_date
    FROM player_ledger_entries
    WHERE team_id = ?
    GROUP BY player_id
  `).all(teamId);
  const byPlayer = new Map(agg.map((r) => [r.player_id, r]));

  const rows = players.map((p) => {
    const a = byPlayer.get(p.player_id);
    const balance = Number(a?.balance || 0);
    const overdueCharges = Number(a?.overdue_charges || 0);
    return {
      ...p,
      balance,
      // El adeudo vencido no puede ser mayor a lo que el jugador debe en total.
      overdue_amount: Math.min(overdueCharges, Math.max(-balance, 0)),
      next_due_date: a?.next_due_date || null,
    };
  });

  // Los de baja no cuentan para el porcentaje al corriente: ya no son plantel.
  const active = rows.filter((r) => r.status !== 'baja');
  const upToDate = active.filter((r) => r.balance >= 0).length;

  const collectedThisMonth = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM player_ledger_entries
    WHERE team_id = ? AND kind = 'payment' AND status IN ('confirmed', 'settled')
      AND created_at >= date_trunc('month', CURRENT_DATE)
  `).get(teamId);

  // Seis meses de cobranza para la gráfica del Resumen.
  const monthlyFlow = await db.prepare(`
    SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
           COALESCE(SUM(amount), 0) AS total
    FROM player_ledger_entries
    WHERE team_id = ? AND kind = 'payment' AND status IN ('confirmed', 'settled')
      AND created_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '5 months'
    GROUP BY 1
    ORDER BY 1
  `).all(teamId);

  const pendingPayments = await db.prepare(`
    SELECT e.id, e.player_id, e.amount, e.currency, e.payment_method, e.reference,
           e.proof_url, e.note, e.created_at,
           p.first_name, p.last_name
    FROM player_ledger_entries e
    JOIN players p ON p.id = e.player_id
    WHERE e.team_id = ? AND e.kind = 'payment' AND e.status = 'pending'
    ORDER BY e.created_at ASC
  `).all(teamId);

  const recentActivity = await db.prepare(`
    SELECT e.id, e.kind, e.category, e.concept, e.amount, e.status, e.direction,
           e.created_by_side, e.created_at,
           p.first_name, p.last_name
    FROM player_ledger_entries e
    JOIN players p ON p.id = e.player_id
    WHERE e.team_id = ?
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 12
  `).all(teamId);

  const recentBatches = await db.prepare(`
    SELECT batch_id,
           MIN(created_at)   AS created_at,
           MAX(category)     AS category,
           MAX(concept)      AS concept,
           MIN(amount)       AS min_amount,
           MAX(amount)       AS max_amount,
           SUM(amount)       AS total_amount,
           MAX(period_label) AS period_label,
           COUNT(*)          AS player_count
    FROM player_ledger_entries
    WHERE team_id = ? AND kind = 'charge' AND batch_id IS NOT NULL
    GROUP BY batch_id
    ORDER BY MIN(created_at) DESC
    LIMIT 12
  `).all(teamId);

  res.json({
    team: {
      id: req.team.id,
      name: req.team.name,
      logo_url: req.team.logo_url,
      brand_color: req.team.brand_color,
      contact_phone: req.team.contact_phone,
      contact_email: req.team.contact_email,
      player_billing_reminders_enabled: req.team.player_billing_reminders_enabled,
    },
    kpis: {
      collected_this_month: Number(collectedThisMonth?.total || 0),
      receivable: rows.reduce((sum, r) => sum + Math.max(-r.balance, 0), 0),
      overdue: rows.reduce((sum, r) => sum + r.overdue_amount, 0),
      up_to_date_count: upToDate,
      active_count: active.length,
      pending_payments_count: pendingPayments.length,
    },
    players: rows,
    monthly_flow: monthlyFlow.map((m) => ({ month: m.month, total: Number(m.total) })),
    pending_payments: pendingPayments,
    recent_activity: recentActivity,
    recent_batches: recentBatches,
    categories: CHARGE_CATEGORIES,
    payment_methods: PAYMENT_METHODS,
    account_statuses: ACCOUNT_STATUSES,
  });
}));

// Libro de un jugador, visto por el club.
router.get('/teams/:id/players/:playerId/entries', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const teamId = req.team.id;
  const playerId = Number(req.params.playerId);

  const inTeam = await membersOfTeam(teamId, [playerId]);
  if (!inTeam.has(playerId)) return res.status(404).json({ error: 'Ese jugador no está en el plantel de este equipo' });

  const player = await db.prepare('SELECT id, first_name, last_name FROM players WHERE id = ?').get(playerId);

  const entries = await db.prepare(`
    SELECT * FROM player_ledger_entries
    WHERE team_id = ? AND player_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(teamId, playerId);

  res.json({
    player,
    balance: await computeBalance(teamId, playerId),
    entries,
  });
}));

// ─── Crear cargos ───────────────────────────────────────────────────────────

router.post('/teams/:id/charges', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const teamId = req.team.id;

  const metaErr = validateChargeMeta(req.body);
  if (metaErr) return res.status(400).json({ error: metaErr });

  const { items, error } = normalizeChargeItems(req.body);
  if (error) return res.status(400).json({ error });

  const { category, concept, due_date, period_label, note } = req.body;

  const valid = await membersOfTeam(teamId, items.map((i) => i.player_id));
  if (items.some((i) => !valid.has(i.player_id))) {
    return res.status(400).json({ error: 'Uno o más jugadores no están en el plantel de este equipo' });
  }


  const batchId = crypto.randomUUID();
  const cleanConcept = concept.trim();
  const cleanPeriod = isNonEmptyString(period_label) ? period_label.trim().toUpperCase() : null;
  const cleanNote = isNonEmptyString(note) ? note.trim() : null;

  // Un cargo en cero (becado) no es movimiento contable — se omite en silencio.
  const billable = items.filter((i) => i.amount > 0);

  for (const { player_id, amount } of billable) {
    await db.prepare(`
      INSERT INTO player_ledger_entries
        (team_id, player_id, kind, category, concept, amount, due_date, period_label, note, batch_id, created_by_user_id, created_by_side)
      VALUES (?, ?, 'charge', ?, ?, ?, ?, ?, ?, ?, ?, 'team')
    `).run(teamId, player_id, category, cleanConcept, amount, due_date, cleanPeriod, cleanNote, batchId, req.user.id);
  }

  res.status(201).json({ created: billable.length, skipped: items.length - billable.length, batch_id: batchId });
}));

// Repetir un lote anterior con nueva fecha de vencimiento ("las cuotas de
// octubre igual que las de septiembre"). Respeta el monto de cada jugador.
router.post('/teams/:id/charges/repeat', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const teamId = req.team.id;
  const { source_batch_id, due_date, period_label } = req.body;

  if (!isNonEmptyString(source_batch_id)) return res.status(400).json({ error: 'Falta el lote de origen' });
  if (!due_date || Number.isNaN(new Date(due_date).getTime())) return res.status(400).json({ error: 'La fecha de vencimiento no es válida' });

  const source = await db.prepare(`
    SELECT * FROM player_ledger_entries
    WHERE batch_id = ? AND team_id = ? AND kind = 'charge'
  `).all(source_batch_id, teamId);
  if (source.length === 0) return res.status(404).json({ error: 'No se encontró el lote de origen' });

  const template = source[0];
  const amountByPlayer = new Map(source.map((r) => [r.player_id, Number(r.amount)]));
  const requested = Array.isArray(req.body.player_ids) && req.body.player_ids.length > 0
    ? [...new Set(req.body.player_ids.map(Number))]
    : [...amountByPlayer.keys()];

  // Solo jugadores que sigan en el plantel y que estuvieran en el lote original
  // — si alguien se dio de baja entre un mes y otro, no se le vuelve a cobrar.
  const stillInTeam = await membersOfTeam(teamId, requested);
  const playerIds = requested.filter((id) => stillInTeam.has(id) && amountByPlayer.has(id));
  if (playerIds.length === 0) return res.status(400).json({ error: 'Ningún jugador válido para repetir el cargo' });

  const batchId = crypto.randomUUID();
  const cleanPeriod = isNonEmptyString(period_label) ? period_label.trim().toUpperCase() : template.period_label;

  for (const playerId of playerIds) {
    await db.prepare(`
      INSERT INTO player_ledger_entries
        (team_id, player_id, kind, category, concept, amount, due_date, period_label, note, batch_id, created_by_user_id, created_by_side)
      VALUES (?, ?, 'charge', ?, ?, ?, ?, ?, ?, ?, ?, 'team')
    `).run(
      teamId, playerId, template.category, template.concept, amountByPlayer.get(playerId),
      due_date, cleanPeriod, template.note, batchId, req.user.id
    );
  }

  res.status(201).json({ created: playerIds.length, batch_id: batchId });
}));

// ─── Registrar un pago recibido (lo captura el club) ────────────────────────

router.post('/teams/:id/players/:playerId/payments', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const teamId = req.team.id;
  const playerId = Number(req.params.playerId);

  const inTeam = await membersOfTeam(teamId, [playerId]);
  if (!inTeam.has(playerId)) return res.status(404).json({ error: 'Ese jugador no está en el plantel de este equipo' });

  const { amount, payment_method, reference, proof_url, note } = req.body;
  if (amount === undefined || amount === null || amount === '' || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'El monto debe ser un número mayor a cero' });
  }
  if (!PAYMENT_METHODS.includes(payment_method)) return res.status(400).json({ error: 'Método de pago no válido' });
  if (proof_url && !isValidUrl(proof_url)) return res.status(400).json({ error: 'El comprobante no es una dirección web válida' });

  const concept = isNonEmptyString(note) ? note.trim() : 'Pago recibido';

  const payment = await db.prepare(`
    INSERT INTO player_ledger_entries
      (team_id, player_id, kind, concept, amount, payment_method, reference, proof_url, note, status, created_by_user_id, created_by_side)
    VALUES (?, ?, 'payment', ?, ?, ?, ?, ?, ?, 'confirmed', ?, 'team')
    RETURNING *
  `).get(
    teamId, playerId, concept, Number(amount),
    payment_method,
    isNonEmptyString(reference) ? reference.trim() : null,
    proof_url || null,
    isNonEmptyString(note) ? note.trim() : null,
    req.user.id
  );

  const balance = await settleIfPaid(teamId, playerId);
  res.status(201).json({ payment, balance });
}));

// ─── Confirmar un pago reportado por el papá ────────────────────────────────

router.post('/entries/:entryId/confirm', authRequired, asyncHandler(async (req, res) => {
  const access = await assertEntryAccess(req, res, Number(req.params.entryId));
  if (!access) return;
  const { entry } = access;

  if (entry.kind !== 'payment' || entry.status !== 'pending') {
    return res.status(400).json({ error: 'Solo se puede confirmar un pago pendiente' });
  }

  await db.prepare(`
    UPDATE player_ledger_entries
    SET status = 'confirmed', updated_at = NOW()
    WHERE id = ? AND status = 'pending'
  `).run(entry.id);

  const balance = await settleIfPaid(entry.team_id, entry.player_id);
  res.json({ ok: true, balance });
}));

// ─── Cancelar un movimiento ─────────────────────────────────────────────────

router.post('/entries/:entryId/void', authRequired, asyncHandler(async (req, res) => {
  const access = await assertEntryAccess(req, res, Number(req.params.entryId));
  if (!access) return;
  const { entry } = access;

  if (entry.kind === 'adjustment') {
    return res.status(400).json({ error: 'Un ajuste no se puede cancelar' });
  }

  const reason = isNonEmptyString(req.body?.reason) ? req.body.reason.trim() : null;

  // Rechazar un pago PENDIENTE no lleva ajuste: ese pago nunca entró al saldo
  // (ver BALANCE_SUM_SQL), así que no hay nada que revertir. Meterle un ajuste
  // le restaría al jugador un dinero que nunca se le abonó.
  const isPendingPayment = entry.kind === 'payment' && entry.status === 'pending';

  if (!isPendingPayment) {
    const direction = entry.kind === 'charge' ? 'credit' : 'debit';
    // Idempotente: si ya existe el ajuste que lo revierte, no se crea otro.
    const existingReversal = await db.prepare(
      'SELECT id FROM player_ledger_entries WHERE reverses_entry_id = ?'
    ).get(entry.id);

    if (!existingReversal) {
      await db.prepare(`
        INSERT INTO player_ledger_entries
          (team_id, player_id, kind, concept, amount, direction, note, reverses_entry_id, status, created_by_user_id, created_by_side)
        VALUES (?, ?, 'adjustment', ?, ?, ?, ?, ?, 'applied', ?, 'team')
      `).run(
        entry.team_id, entry.player_id,
        `Cancelación: ${entry.concept}`,
        entry.amount, direction, reason, entry.id, req.user.id
      );
    }
  }

  // 'rejected' en vez de 'void' para un pendiente: ver BALANCE_SUM_SQL. Un
  // pago rechazado nunca se abonó, así que no puede compartir estado con uno
  // que sí se abonó y luego se canceló.
  const nextStatus = isPendingPayment ? 'rejected' : 'void';
  if (entry.status !== nextStatus) {
    await db.prepare(`
      UPDATE player_ledger_entries
      SET status = ?, voided_at = NOW(), voided_by_user_id = ?, note = COALESCE(?, note), updated_at = NOW()
      WHERE id = ?
    `).run(nextStatus, req.user.id, reason, entry.id);
  }

  const balance = await settleIfPaid(entry.team_id, entry.player_id);
  res.json({ ok: true, balance });
}));

// ─── Padrón del club: alta, edición y baja ──────────────────────────────────
//
// Esto es lo que hace que la contabilidad funcione SIN liga. El club da de alta
// a su gente aquí y ya puede cobrarle, aunque no esté inscrito en ningún
// torneo. Nada de esto toca player_team_memberships (el roster por rama, que
// arma la liga y sirve para elegibilidad): son dos padrones distintos que solo
// comparten la tabla `players` como identidad de la persona.

function cleanText(value, max = 120) {
  if (!isNonEmptyString(value)) return null;
  return value.trim().slice(0, max);
}

function parseJersey(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 999 ? n : undefined; // undefined = inválido
}

router.post('/teams/:id/members', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const teamId = req.team.id;
  const {
    first_name, last_name, birth_date, position, jersey_number, photo_url, curp,
    monthly_amount, group_label, tutor_name, tutor_phone, tutor_email, note,
  } = req.body;

  if (!isNonEmptyString(first_name) || !isNonEmptyString(last_name)) {
    return res.status(400).json({ error: 'Nombre y apellido son obligatorios' });
  }
  const jersey = parseJersey(jersey_number);
  if (jersey === undefined) return res.status(400).json({ error: 'El número debe ser un entero entre 0 y 999' });
  if (tutor_email && !isValidEmail(tutor_email)) {
    return res.status(400).json({ error: 'El correo del tutor no es válido' });
  }
  if (monthly_amount !== undefined && monthly_amount !== null && monthly_amount !== ''
      && (Number.isNaN(Number(monthly_amount)) || Number(monthly_amount) < 0)) {
    return res.status(400).json({ error: 'La cuota debe ser un número mayor o igual a cero' });
  }

  // El CURP sirve para no dar de alta dos veces a la misma persona en el mismo
  // club (por ejemplo al importar del roster y luego capturarla a mano). Es
  // opcional: sin él, dos personas homónimas se dan de alta sin problema, que
  // es lo correcto — el club sabe a quién tiene.
  const cleanCurp = cleanText(curp, 18);
  if (cleanCurp) {
    const dup = await db.prepare(`
      SELECT p.id FROM team_player_accounts a
      JOIN players p ON p.id = a.player_id
      WHERE a.team_id = ? AND UPPER(p.curp) = UPPER(?)
    `).get(teamId, cleanCurp);
    if (dup) return res.status(409).json({ error: 'Ya tienes a alguien con ese CURP en tu padrón' });
  }

  const player = await db.prepare(`
    INSERT INTO players (first_name, last_name, birth_date, position, jersey_number, photo_url, curp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    first_name.trim(), last_name.trim(),
    birth_date || null,
    cleanText(position, 40),
    jersey,
    cleanText(photo_url, 500),
    cleanCurp
  );

  const account = await db.prepare(`
    INSERT INTO team_player_accounts
      (team_id, player_id, share_token, monthly_amount, group_label, tutor_name, tutor_phone, tutor_email, note, joined_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_DATE)
    RETURNING *
  `).get(
    teamId, player.id, crypto.randomUUID(),
    monthly_amount === undefined || monthly_amount === null || monthly_amount === '' ? null : Number(monthly_amount),
    cleanText(group_label, 40),
    cleanText(tutor_name, 80),
    isNonEmptyString(tutor_phone) ? tutor_phone.replace(/[^\d+]/g, '') : null,
    cleanText(tutor_email, 120),
    cleanText(note, 200)
  );

  res.status(201).json({ player, account });
}));

// Edición de un miembro del padrón: datos de la persona Y su ficha de cobranza
// en una sola llamada, porque en la UI es un solo formulario. Solo se tocan los
// campos que vinieron en el cuerpo — así el botón de WhatsApp puede mandar
// únicamente { mark_reminded: true } sin borrar el resto con NULLs.

router.patch('/teams/:id/accounts/:playerId', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const teamId = req.team.id;
  const playerId = Number(req.params.playerId);

  const inTeam = await membersOfTeam(teamId, [playerId]);
  if (!inTeam.has(playerId)) return res.status(404).json({ error: 'Ese jugador no está en el plantel de este equipo' });


  const {
    first_name, last_name, birth_date, position, jersey_number, photo_url, curp,
    monthly_amount, status, group_label, tutor_name, tutor_phone, tutor_email, note, mark_reminded,
  } = req.body;

  if (monthly_amount !== undefined && monthly_amount !== null && monthly_amount !== '') {
    if (Number.isNaN(Number(monthly_amount)) || Number(monthly_amount) < 0) {
      return res.status(400).json({ error: 'La cuota debe ser un número mayor o igual a cero' });
    }
  }
  if (status !== undefined && !ACCOUNT_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Estatus de jugador no válido' });
  }
  if (tutor_email && !isValidEmail(tutor_email)) {
    return res.status(400).json({ error: 'El correo del tutor no es válido' });
  }

  if (first_name !== undefined && !isNonEmptyString(first_name)) {
    return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
  }
  if (last_name !== undefined && !isNonEmptyString(last_name)) {
    return res.status(400).json({ error: 'El apellido no puede quedar vacío' });
  }
  const jersey = parseJersey(jersey_number);
  if (jersey === undefined) return res.status(400).json({ error: 'El número debe ser un entero entre 0 y 999' });

  // Datos de la PERSONA (tabla players). Van en su propio UPDATE porque son
  // otra tabla, no otra decisión: para quien usa el panel es un solo formulario.
  const pSets = [];
  const pArgs = [];
  if (first_name !== undefined)    { pSets.push('first_name = ?');    pArgs.push(first_name.trim()); }
  if (last_name !== undefined)     { pSets.push('last_name = ?');     pArgs.push(last_name.trim()); }
  if (birth_date !== undefined)    { pSets.push('birth_date = ?');    pArgs.push(birth_date || null); }
  if (position !== undefined)      { pSets.push('position = ?');      pArgs.push(cleanText(position, 40)); }
  if (jersey_number !== undefined) { pSets.push('jersey_number = ?'); pArgs.push(jersey); }
  if (photo_url !== undefined)     { pSets.push('photo_url = ?');     pArgs.push(cleanText(photo_url, 500)); }
  if (curp !== undefined)          { pSets.push('curp = ?');          pArgs.push(cleanText(curp, 18)); }

  if (pSets.length > 0) {
    pArgs.push(playerId);
    await db.prepare(`UPDATE players SET ${pSets.join(', ')} WHERE id = ?`).run(...pArgs);
  }

  // Solo se tocan los campos que vinieron en el cuerpo — así el botón de
  // WhatsApp puede mandar únicamente { mark_reminded: true } sin borrar el
  // resto de la cuenta con NULLs.
  const sets = [];
  const args = [];
  if (monthly_amount !== undefined) {
    sets.push('monthly_amount = ?');
    args.push(monthly_amount === '' || monthly_amount === null ? null : Number(monthly_amount));
  }
  if (status !== undefined)      { sets.push('status = ?');      args.push(status); }
  if (group_label !== undefined) { sets.push('group_label = ?'); args.push(cleanText(group_label, 40)); }
  if (note !== undefined)        { sets.push('note = ?');        args.push(cleanText(note, 200)); }
  if (tutor_name !== undefined)  { sets.push('tutor_name = ?');  args.push(isNonEmptyString(tutor_name) ? tutor_name.trim() : null); }
  if (tutor_phone !== undefined) { sets.push('tutor_phone = ?'); args.push(isNonEmptyString(tutor_phone) ? tutor_phone.replace(/[^\d+]/g, '') : null); }
  if (tutor_email !== undefined) { sets.push('tutor_email = ?'); args.push(isNonEmptyString(tutor_email) ? tutor_email.trim() : null); }
  if (mark_reminded)             { sets.push('last_reminded_at = NOW()'); }

  if (sets.length === 0) {
    // Si solo vinieron campos de la persona, ya se guardaron arriba.
    if (pSets.length > 0) return res.json({ ok: true });
    return res.status(400).json({ error: 'No hay nada que actualizar' });
  }

  sets.push('updated_at = NOW()');
  args.push(teamId, playerId);

  const account = await db.prepare(`
    UPDATE team_player_accounts
    SET ${sets.join(', ')}
    WHERE team_id = ? AND player_id = ?
    RETURNING *
  `).get(...args);

  res.json({ account });
}));

// Quitar a alguien del padrón del club.
//
// Si ya tiene movimientos NO se borra: el libro es append-only y borrar a la
// persona dejaría cargos y pagos huérfanos, o peor, descuadraría lo cobrado.
// En ese caso se le da de baja (status='baja'), que es lo que de verdad pasa
// en un club: dejó de entrenar, pero lo que pagó (o lo que quedó a deber) es
// historia y ahí se queda.
//
// Solo si nunca tuvo un movimiento se borra de verdad — el caso de "lo capturé
// mal" a los dos minutos. La fila de `players` se borra solo si esa persona no
// existe en ningún otro lado (otro club, roster de torneo, estadísticas o una
// cuenta de usuario); si existe, se queda y solo se suelta del club.
router.delete('/teams/:id/members/:playerId', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const teamId = req.team.id;
  const playerId = Number(req.params.playerId);

  const inTeam = await membersOfTeam(teamId, [playerId]);
  if (!inTeam.has(playerId)) return res.status(404).json({ error: 'Esa persona no está en tu padrón' });

  const movements = await db.prepare(
    'SELECT 1 FROM player_ledger_entries WHERE team_id = ? AND player_id = ? LIMIT 1'
  ).get(teamId, playerId);

  if (movements) {
    await db.prepare(`
      UPDATE team_player_accounts SET status = 'baja', updated_at = NOW()
      WHERE team_id = ? AND player_id = ?
    `).run(teamId, playerId);
    return res.json({ ok: true, action: 'baja' });
  }

  await db.prepare('DELETE FROM team_player_accounts WHERE team_id = ? AND player_id = ?').run(teamId, playerId);

  const stillReferenced = await db.prepare(`
    SELECT 1 FROM players p
    WHERE p.id = ?
      AND (
        p.user_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM team_player_accounts a WHERE a.player_id = p.id)
        OR EXISTS (SELECT 1 FROM player_team_memberships m WHERE m.player_id = p.id)
        OR EXISTS (SELECT 1 FROM player_match_stats s WHERE s.player_id = p.id)
        OR EXISTS (SELECT 1 FROM player_ledger_entries e WHERE e.player_id = p.id)
      )
    LIMIT 1
  `).get(playerId);

  if (!stillReferenced) {
    await db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
  }

  res.json({ ok: true, action: 'eliminado' });
}));

// Copiar gente de un roster de torneo al padrón del club.
//
// Atajo de captura, NO un enlace. Copia los nombres una vez y ahí se acaba la
// relación: de ahí en adelante el padrón del club y el roster de la liga viven
// cada uno por su lado, y editar uno no toca al otro. Existe nada más para que
// un club que ya subió 40 jugadores por la plantilla de Excel no los tenga que
// volver a teclear.
//
// A quien ya está en el padrón se le salta (por CURP si lo hay, si no por
// nombre + apellido), así que se puede correr dos veces sin duplicar a nadie.
router.post('/teams/:id/members/import-roster', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const teamId = req.team.id;
  const branchId = req.body?.branch_id ? Number(req.body.branch_id) : null;
  const groupLabel = cleanText(req.body?.group_label, 40);

  const enrolled = branchId
    ? await db.prepare('SELECT 1 FROM branch_teams WHERE branch_id = ? AND team_id = ?').get(branchId, teamId)
    : true;
  if (!enrolled) return res.status(400).json({ error: 'Tu equipo no está inscrito en esa rama' });

  const args = [teamId];
  let branchFilter = '';
  if (branchId) { branchFilter = 'AND ptm.branch_id = ?'; args.push(branchId); }

  const source = await db.prepare(`
    SELECT DISTINCT ON (p.id) p.id, p.first_name, p.last_name, p.birth_date,
           p.position, p.jersey_number, p.photo_url, p.curp
    FROM player_team_memberships ptm
    JOIN players p ON p.id = ptm.player_id
    WHERE ptm.team_id = ? AND ptm.end_date IS NULL ${branchFilter}
    ORDER BY p.id
  `).all(...args);

  const existing = await db.prepare(`
    SELECT UPPER(COALESCE(p.curp, '')) AS curp,
           UPPER(p.first_name || ' ' || p.last_name) AS full_name
    FROM team_player_accounts a
    JOIN players p ON p.id = a.player_id
    WHERE a.team_id = ?
  `).all(teamId);
  const byCurp = new Set(existing.map((e) => e.curp).filter(Boolean));
  const byName = new Set(existing.map((e) => e.full_name));

  let imported = 0;
  for (const row of source) {
    const curp = (row.curp || '').toUpperCase();
    const fullName = `${row.first_name} ${row.last_name}`.toUpperCase();
    if ((curp && byCurp.has(curp)) || byName.has(fullName)) continue;

    // Persona NUEVA, no la misma fila: el padrón del club es independiente, así
    // que si mañana la liga da de baja a alguien de su roster, el club lo sigue
    // teniendo (y cobrándole) sin enterarse.
    const player = await db.prepare(`
      INSERT INTO players (first_name, last_name, birth_date, position, jersey_number, photo_url, curp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `).get(row.first_name, row.last_name, row.birth_date, row.position, row.jersey_number, row.photo_url, row.curp);

    await db.prepare(`
      INSERT INTO team_player_accounts (team_id, player_id, share_token, group_label, joined_date)
      VALUES (?, ?, ?, ?, CURRENT_DATE)
    `).run(teamId, player.id, crypto.randomUUID(), groupLabel);

    if (curp) byCurp.add(curp);
    byName.add(fullName);
    imported++;
  }

  res.status(201).json({ imported, skipped: source.length - imported });
}));

// Regenerar el link del papá (si se filtró en un grupo equivocado). El token
// viejo deja de funcionar en cuanto se reemplaza.
router.post('/teams/:id/accounts/:playerId/rotate-token', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const teamId = req.team.id;
  const playerId = Number(req.params.playerId);

  const inTeam = await membersOfTeam(teamId, [playerId]);
  if (!inTeam.has(playerId)) return res.status(404).json({ error: 'Ese jugador no está en el plantel de este equipo' });

  const account = await db.prepare(`
    UPDATE team_player_accounts
    SET share_token = ?, updated_at = NOW()
    WHERE team_id = ? AND player_id = ?
    RETURNING share_token
  `).get(crypto.randomUUID(), teamId, playerId);

  res.json({ share_token: account.share_token });
}));

// ─── Ajustes del equipo ─────────────────────────────────────────────────────

router.patch('/teams/:id/settings', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const enabled = Boolean(req.body?.player_billing_reminders_enabled);
  await db.prepare('UPDATE teams SET player_billing_reminders_enabled = ? WHERE id = ?').run(enabled, req.team.id);
  res.json({ player_billing_reminders_enabled: enabled });
}));

// ─── Estado de cuenta público del jugador (SIN sesión) ──────────────────────
//
// Esto es lo que el papá abre desde WhatsApp. No hay login de por medio: el
// token ES la credencial. Por eso la respuesta se arma a mano campo por campo
// en vez de devolver la fila completa — de aquí nunca debe salir el teléfono
// del tutor, el id interno del jugador, ni rastro de ningún otro jugador.

async function loadAccountByToken(shareToken) {
  if (!isNonEmptyString(shareToken)) return null;
  return db.prepare(`
    SELECT a.team_id, a.player_id, a.monthly_amount, a.status,
           p.first_name, p.last_name, p.photo_url, p.jersey_number,
           t.name AS team_name, t.logo_url AS team_logo_url, t.brand_color,
           t.contact_phone AS team_phone, t.contact_email AS team_email
    FROM team_player_accounts a
    JOIN players p ON p.id = a.player_id
    JOIN teams   t ON t.id = a.team_id
    WHERE a.share_token = ?
  `).get(String(shareToken).trim());
}

router.get('/statement/:shareToken', publicStatementLimiter, asyncHandler(async (req, res) => {
  const account = await loadAccountByToken(req.params.shareToken);
  if (!account) return res.status(404).json({ error: 'Este estado de cuenta no existe o fue reemplazado' });

  const entries = await db.prepare(`
    SELECT id, kind, category, concept, amount, currency, due_date, period_label, status,
           direction, payment_method, reference, proof_url, note, reverses_entry_id,
           voided_at, created_at
    FROM player_ledger_entries
    WHERE team_id = ? AND player_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(account.team_id, account.player_id);

  const agg = await db.prepare(`
    SELECT ${BALANCE_SUM_SQL} AS balance,
           MIN(CASE WHEN kind = 'charge' AND status = 'open' THEN due_date END) AS next_due_date,
           COALESCE(SUM(CASE WHEN kind = 'charge' AND status = 'open' AND due_date < CURRENT_DATE THEN amount ELSE 0 END), 0) AS overdue_charges
    FROM player_ledger_entries
    WHERE team_id = ? AND player_id = ?
  `).get(account.team_id, account.player_id);

  const balance = Number(agg?.balance || 0);
  const hasPending = entries.some((e) => e.kind === 'payment' && e.status === 'pending');

  res.json({
    player: {
      first_name: account.first_name,
      last_name: account.last_name,
      photo_url: account.photo_url,
      jersey_number: account.jersey_number,
    },
    team: {
      name: account.team_name,
      logo_url: account.team_logo_url,
      brand_color: account.brand_color,
      contact_phone: account.team_phone,
      contact_email: account.team_email,
    },
    monthly_amount: account.monthly_amount,
    balance,
    currency: 'MXN',
    next_due_date: agg?.next_due_date || null,
    overdue_amount: Math.min(Number(agg?.overdue_charges || 0), Math.max(-balance, 0)),
    has_pending_payment: hasPending,
    payment_methods: PAYMENT_METHODS,
    entries,
  });
}));

// El papá reporta su pago. Nace 'pending': NO baja el saldo hasta que el club
// lo confirma. Es el reemplazo directo de mandar la captura por WhatsApp y que
// el tesorero la anote en su Excel.
router.post('/statement/:shareToken/report-payment', reportPaymentLimiter, asyncHandler(async (req, res) => {
  const account = await loadAccountByToken(req.params.shareToken);
  if (!account) return res.status(404).json({ error: 'Este estado de cuenta no existe o fue reemplazado' });

  const { amount, payment_method, reference, proof_url, note } = req.body;
  if (amount === undefined || amount === null || amount === '' || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'El monto debe ser un número mayor a cero' });
  }
  if (!PAYMENT_METHODS.includes(payment_method)) return res.status(400).json({ error: 'Método de pago no válido' });
  if (proof_url && !isValidUrl(proof_url)) return res.status(400).json({ error: 'El comprobante no es una dirección web válida' });

  // Un pago pendiente a la vez por jugador: si el papá le da dos veces al
  // botón, o reporta de nuevo antes de que el club revise, no se le llena la
  // bandeja al tesorero de duplicados que luego tiene que rechazar a mano.
  const alreadyPending = await db.prepare(`
    SELECT id FROM player_ledger_entries
    WHERE team_id = ? AND player_id = ? AND kind = 'payment' AND status = 'pending'
  `).get(account.team_id, account.player_id);
  if (alreadyPending) {
    return res.status(409).json({ error: 'Ya tienes un pago esperando confirmación del club. Espera a que lo revisen.' });
  }

  const playerName = `${account.first_name} ${account.last_name}`.trim();

  await db.prepare(`
    INSERT INTO player_ledger_entries
      (team_id, player_id, kind, concept, amount, payment_method, reference, proof_url, note, status, created_by_side)
    VALUES (?, ?, 'payment', ?, ?, ?, ?, ?, ?, 'pending', 'player')
  `).run(
    account.team_id, account.player_id,
    'Pago reportado por el jugador',
    Number(amount),
    payment_method,
    isNonEmptyString(reference) ? reference.trim() : null,
    proof_url || null,
    isNonEmptyString(note) ? note.trim() : null
  );

  await notifyTeam(
    account.team_id,
    'player_payment_reported',
    'Un pago espera tu confirmación 🧾',
    `${playerName} reportó un pago de ${formatMoney(amount)} (${payment_method}). `
      + `Revísalo en Finanzas para que se aplique a su estado de cuenta.`,
    { player_id: account.player_id }
  );

  res.status(201).json({ ok: true });
}));

// Mismo caso que en el libro de la liga: el papá que se equivocó al reportar no
// se puede quedar atorado esperando a que el club lo rechace. Solo retira lo
// que reportó él (created_by_side='player'), nunca un pago que capturó el club.
router.post('/statement/:shareToken/withdraw-payment', reportPaymentLimiter, asyncHandler(async (req, res) => {
  const account = await loadAccountByToken(req.params.shareToken);
  if (!account) return res.status(404).json({ error: 'Este estado de cuenta no existe o fue reemplazado' });

  const pending = await db.prepare(`
    SELECT id FROM player_ledger_entries
    WHERE team_id = ? AND player_id = ? AND kind = 'payment'
      AND status = 'pending' AND created_by_side = 'player'
  `).get(account.team_id, account.player_id);

  if (!pending) return res.status(404).json({ error: 'No tienes ningún pago esperando confirmación' });

  await db.prepare(`
    UPDATE player_ledger_entries
    SET status = 'withdrawn', voided_at = NOW(),
        note = 'Retirado por el jugador antes de confirmarse', updated_at = NOW()
    WHERE id = ?
  `).run(pending.id);

  res.json({ ok: true });
}));

// Subida del comprobante por parte del papá. No puede usar POST /api/upload
// porque ese exige sesión y aquí no hay cuenta: el share_token es la
// credencial, igual que en los dos endpoints de arriba.
//
// Nota de privacidad: la URL que devuelve Cloudinary es pública para quien la
// tenga (no hay firma). Es el mismo trato que ya recibe proof_url en la
// cobranza liga→equipo, y el archivo va a una carpeta aparte para poder
// aplicarle una política distinta más adelante sin tocar los logos.
const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten archivos de imagen'));
  },
});

router.post('/statement/:shareToken/upload-proof', reportPaymentLimiter, proofUpload.single('file'), async (req, res) => {
  try {
    const account = await loadAccountByToken(req.params.shareToken);
    if (!account) return res.status(404).json({ error: 'Este estado de cuenta no existe o fue reemplazado' });
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

    if (!ensureCloudinaryConfigured()) {
      return res.status(500).json({ error: 'El almacenamiento de imágenes no está configurado. Avísale a tu club.' });
    }

    // Sin recorte cuadrado: un comprobante suele ser una captura alta y
    // angosta, y encajarla en 800x800 dejaría el monto ilegible. Solo se le
    // pone un techo generoso para que nadie suba un archivo enorme.
    const result = await uploadBufferToCloudinary(req.file.buffer, {
      folder: 'lifa-app/comprobantes',
      transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
    });
    res.status(201).json({ url: result.secure_url });
  } catch (err) {
    console.error('Error subiendo comprobante:', err);
    res.status(502).json({ error: 'No se pudo subir el comprobante. Intenta de nuevo.' });
  }
});

export default router;
