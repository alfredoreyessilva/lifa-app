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
//     (club_members.last_reminded_at).

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

// Compatibilidad de nombre. `club_members` guarda UN solo `display_name` —ese
// es el punto de la separación: el club puede registrar a alguien como "El
// Güero" sin inventarle un apellido, cosa que `players.last_name NOT NULL` no
// permitía. Pero el frontend todavía lee first_name/last_name, así que la API
// los sigue devolviendo, partidos por el primer espacio:
//
//   "Juan Perez"  -> first "Juan",  last "Perez"
//   "El Güero"    -> first "El",    last "Güero"
//   "Güero"       -> first "Güero", last ""      <- antes no se podía guardar
//
// `display_name` también va en la respuesta: cuando el frontend se mueva a él
// (fase B), estos dos derivados se borran y esta función con ellos.
const nameCompatSql = (alias) => `
    ${alias}.display_name,
    split_part(${alias}.display_name, ' ', 1) AS first_name,
    CASE WHEN position(' ' IN ${alias}.display_name) > 0
         THEN substring(${alias}.display_name FROM position(' ' IN ${alias}.display_name) + 1)
         ELSE '' END AS last_name`;

// Espejo en JS de nameCompatSql, para las respuestas que no salen de una
// consulta. Parte por el PRIMER espacio, igual que el SQL.
function splitDisplayName(displayName) {
  const s = String(displayName || '').trim();
  const i = s.indexOf(' ');
  return i === -1
    ? { first_name: s, last_name: '' }
    : { first_name: s.slice(0, i), last_name: s.slice(i + 1) };
}

// Una fila de club_members con la forma que el frontend espera de un "player".
function memberAsPlayer(m) {
  return {
    id: m.id,
    display_name: m.display_name,
    ...splitDisplayName(m.display_name),
    birth_date: m.birth_date,
    position: m.position,
    jersey_number: m.jersey_number,
    photo_url: m.photo_url,
    curp: m.curp,
  };
}

async function computeBalance(teamId, playerId) {
  const row = await db.prepare(`
    SELECT ${BALANCE_SUM_SQL} AS balance
    FROM club_ledger_entries
    WHERE team_id = ? AND member_id = ?
  `).get(teamId, playerId);
  return Number(row?.balance || 0);
}

// Misma heurística que la liga: si el jugador ya no debe nada, sus cargos
// abiertos pasan a 'settled' y dejan de disparar recordatorios.
async function settleIfPaid(teamId, playerId) {
  const balance = await computeBalance(teamId, playerId);
  if (balance >= 0) {
    await db.prepare(`
      UPDATE club_ledger_entries
      SET status = 'settled', updated_at = NOW()
      WHERE team_id = ? AND member_id = ? AND kind = 'charge' AND status = 'open'
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

// El padrón del club es club_members y nada más.
//
// Antes esta función creaba cuentas a partir de player_team_memberships (el
// roster por rama). Eso ataba la contabilidad a que la LIGA inscribiera al
// equipo: un equipo independiente no podía cobrarle a nadie, jamás. Ahora el
// club da de alta a su gente directamente (POST /teams/:id/members) y esto
// solo responde quién está en el padrón.
async function membersOfTeam(teamId, playerIds) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) return new Set();
  const rows = await db.prepare(`
    SELECT id AS player_id
    FROM club_members
    WHERE team_id = ?
      AND id IN (${playerIds.map(() => '?').join(',')})
  `).all(teamId, ...playerIds);
  return new Set(rows.map((r) => r.player_id));
}

// Acceso a un movimiento por su id. No hay id de equipo en la URL, así que se
// resuelve el equipo desde el movimiento y se repite el criterio de
// teamOwnerRequired (org del equipo, org de la liga, dueño de cualquiera de
// las dos, o admin de plataforma).
async function assertEntryAccess(req, res, entryId) {
  const entry = await db.prepare('SELECT * FROM club_ledger_entries WHERE id = ?').get(entryId);
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
  // Sale del padrón del club (club_members), NO del roster de torneo.
  // Un equipo independiente, o uno al que su liga todavía no inscribe en
  // ninguna rama, tiene aquí a toda su gente igual.
  const players = await db.prepare(`
    SELECT a.id AS player_id,${nameCompatSql('a')},
           a.photo_url, a.jersey_number, a.position, a.birth_date, a.curp,
           a.monthly_amount, a.status, a.group_label, a.joined_date, a.note,
           a.tutor_name, a.tutor_phone, a.tutor_email,
           a.share_token, a.last_reminded_at
    FROM club_members a
    WHERE a.team_id = ?
    ORDER BY a.group_label NULLS LAST, a.display_name
  `).all(teamId);

  const agg = await db.prepare(`
    SELECT member_id AS player_id,
           ${BALANCE_SUM_SQL} AS balance,
           COALESCE(SUM(CASE WHEN kind = 'charge' AND status = 'open' AND due_date < CURRENT_DATE THEN amount ELSE 0 END), 0) AS overdue_charges,
           MIN(CASE WHEN kind = 'charge' AND status = 'open' THEN due_date END) AS next_due_date
    FROM club_ledger_entries
    WHERE team_id = ?
    GROUP BY member_id
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
    FROM club_ledger_entries
    WHERE team_id = ? AND kind = 'payment' AND status IN ('confirmed', 'settled')
      AND created_at >= date_trunc('month', CURRENT_DATE)
  `).get(teamId);

  // Seis meses de cobranza para la gráfica del Resumen.
  const monthlyFlow = await db.prepare(`
    SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
           COALESCE(SUM(amount), 0) AS total
    FROM club_ledger_entries
    WHERE team_id = ? AND kind = 'payment' AND status IN ('confirmed', 'settled')
      AND created_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '5 months'
    GROUP BY 1
    ORDER BY 1
  `).all(teamId);

  const pendingPayments = await db.prepare(`
    SELECT e.id, e.member_id AS player_id, e.amount, e.currency, e.payment_method, e.reference,
           e.proof_url, e.note, e.created_at,${nameCompatSql('m')}
    FROM club_ledger_entries e
    JOIN club_members m ON m.id = e.member_id
    WHERE e.team_id = ? AND e.kind = 'payment' AND e.status = 'pending'
    ORDER BY e.created_at ASC
  `).all(teamId);

  const recentActivity = await db.prepare(`
    SELECT e.id, e.kind, e.category, e.concept, e.amount, e.status, e.direction,
           e.created_by_side, e.created_at,${nameCompatSql('m')}
    FROM club_ledger_entries e
    JOIN club_members m ON m.id = e.member_id
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
    FROM club_ledger_entries
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
    SELECT * FROM club_ledger_entries
    WHERE team_id = ? AND member_id = ?
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
      INSERT INTO club_ledger_entries
        (team_id, member_id, kind, category, concept, amount, due_date, period_label, note, batch_id, created_by_user_id, created_by_side)
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
    SELECT * FROM club_ledger_entries
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
      INSERT INTO club_ledger_entries
        (team_id, member_id, kind, category, concept, amount, due_date, period_label, note, batch_id, created_by_user_id, created_by_side)
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
    INSERT INTO club_ledger_entries
      (team_id, member_id, kind, concept, amount, payment_method, reference, proof_url, note, status, created_by_user_id, created_by_side)
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
    UPDATE club_ledger_entries
    SET status = 'confirmed', updated_at = NOW()
    WHERE id = ? AND status = 'pending'
  `).run(entry.id);

  const balance = await settleIfPaid(entry.team_id, entry.member_id);
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
      'SELECT id FROM club_ledger_entries WHERE reverses_entry_id = ?'
    ).get(entry.id);

    if (!existingReversal) {
      await db.prepare(`
        INSERT INTO club_ledger_entries
          (team_id, member_id, kind, concept, amount, direction, note, reverses_entry_id, status, created_by_user_id, created_by_side)
        VALUES (?, ?, 'adjustment', ?, ?, ?, ?, ?, 'applied', ?, 'team')
      `).run(
        entry.team_id, entry.member_id,
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
      UPDATE club_ledger_entries
      SET status = ?, voided_at = NOW(), voided_by_user_id = ?, note = COALESCE(?, note), updated_at = NOW()
      WHERE id = ?
    `).run(nextStatus, req.user.id, reason, entry.id);
  }

  const balance = await settleIfPaid(entry.team_id, entry.member_id);
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
    display_name, first_name, last_name, birth_date, position, jersey_number, photo_url, curp,
    monthly_amount, group_label, tutor_name, tutor_phone, tutor_email, note,
  } = req.body;

  // Se acepta `display_name` (un solo campo, lo nuevo) o el par
  // first_name/last_name que manda el formulario de hoy. Basta con cualquiera
  // de los dos, y el apellido ya NO es obligatorio: un club puede tener a
  // alguien registrado solo como "El Güero" y eso es información válida, no un
  // dato incompleto. Lo que se guarda siempre es un display_name.
  const displayName = isNonEmptyString(display_name)
    ? display_name.trim()
    : [first_name, last_name].filter(isNonEmptyString).map((s) => s.trim()).join(' ');

  if (!displayName) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
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
      SELECT id FROM club_members
      WHERE team_id = ? AND UPPER(curp) = UPPER(?)
    `).get(teamId, cleanCurp);
    if (dup) return res.status(409).json({ error: 'Ya tienes a alguien con ese CURP en tu padrón' });
  }

  // UNA sola fila, en el padrón del club. Antes eran dos: una en `players` y
  // otra aquí apuntándole. Esa fila en `players` era el problema — metía al
  // cliente del club en la misma tabla que los jugadores de roster de torneo.
  //
  // 14 columnas, 14 placeholders. Se cuentan a mano a propósito: el bug de
  // `POST /leagues` (19 placeholders para 18 columnas) vivió meses tirando 500
  // en silencio porque nadie los contó.
  const member = await db.prepare(`
    INSERT INTO club_members
      (team_id, display_name, birth_date, position, jersey_number, photo_url, curp,
       share_token, monthly_amount, group_label, tutor_name, tutor_phone, tutor_email, note, joined_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_DATE)
    RETURNING *
  `).get(
    teamId,
    displayName,
    birth_date || null,
    cleanText(position, 40),
    jersey,
    cleanText(photo_url, 500),
    cleanCurp,
    crypto.randomUUID(),
    monthly_amount === undefined || monthly_amount === null || monthly_amount === '' ? null : Number(monthly_amount),
    cleanText(group_label, 40),
    cleanText(tutor_name, 80),
    isNonEmptyString(tutor_phone) ? tutor_phone.replace(/[^\d+]/g, '') : null,
    cleanText(tutor_email, 120),
    cleanText(note, 200)
  );

  // Se sigue respondiendo { player, account } con la misma forma de antes para
  // no mover el frontend en esta fase; las dos mitades salen de la misma fila.
  res.status(201).json({ player: memberAsPlayer(member), account: member });
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
    display_name, first_name, last_name, birth_date, position, jersey_number, photo_url, curp,
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
  const jersey = parseJersey(jersey_number);
  if (jersey === undefined) return res.status(400).json({ error: 'El número debe ser un entero entre 0 y 999' });

  // Solo se tocan los campos que vinieron en el cuerpo — así el botón de
  // WhatsApp puede mandar únicamente { mark_reminded: true } sin borrar el
  // resto de la cuenta con NULLs.
  //
  // Antes esto eran DOS updates contra dos tablas (la persona en `players`, la
  // cuenta aquí). Ahora es uno solo: el miembro del club es una sola fila.
  const sets = [];
  const args = [];

  // El nombre puede llegar como `display_name` (lo nuevo) o como el par
  // first_name/last_name del formulario de hoy. En el segundo caso puede venir
  // solo una mitad, así que se parte el nombre actual y se reemplaza la mitad
  // que cambió, en vez de perder la otra.
  if (display_name !== undefined || first_name !== undefined || last_name !== undefined) {
    let nuevoNombre;
    if (isNonEmptyString(display_name)) {
      nuevoNombre = display_name.trim();
    } else {
      const actual = await db.prepare('SELECT display_name FROM club_members WHERE id = ?').get(playerId);
      const partes = splitDisplayName(actual?.display_name);
      const nom = first_name !== undefined ? first_name.trim() : partes.first_name;
      const ape = last_name  !== undefined ? String(last_name || '').trim() : partes.last_name;
      nuevoNombre = [nom, ape].filter(Boolean).join(' ');
    }
    if (!nuevoNombre) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
    sets.push('display_name = ?'); args.push(nuevoNombre);
  }

  // Datos de la persona, ahora en la misma tabla que su cuenta.
  if (birth_date !== undefined)    { sets.push('birth_date = ?');    args.push(birth_date || null); }
  if (position !== undefined)      { sets.push('position = ?');      args.push(cleanText(position, 40)); }
  if (jersey_number !== undefined) { sets.push('jersey_number = ?'); args.push(jersey); }
  if (photo_url !== undefined)     { sets.push('photo_url = ?');     args.push(cleanText(photo_url, 500)); }
  if (curp !== undefined)          { sets.push('curp = ?');          args.push(cleanText(curp, 18)); }

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
    return res.status(400).json({ error: 'No hay nada que actualizar' });
  }

  sets.push('updated_at = NOW()');
  args.push(teamId, playerId);

  const account = await db.prepare(`
    UPDATE club_members
    SET ${sets.join(', ')}
    WHERE team_id = ? AND id = ?
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
// mal" a los dos minutos.
//
// Antes esto tenía que revisar si la persona seguía referenciada en otros cinco
// lugares (otro club, roster de torneo, estadísticas, el libro, una cuenta de
// usuario) antes de atreverse a borrar su fila de `players`. Ya no: el miembro
// del club es una fila que solo le pertenece a este club. Borrarlo aquí no
// puede tocar el roster de ningún torneo, porque no comparten nada.
router.delete('/teams/:id/members/:playerId', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const teamId = req.team.id;
  const playerId = Number(req.params.playerId);

  const inTeam = await membersOfTeam(teamId, [playerId]);
  if (!inTeam.has(playerId)) return res.status(404).json({ error: 'Esa persona no está en tu padrón' });

  const movements = await db.prepare(
    'SELECT 1 FROM club_ledger_entries WHERE team_id = ? AND member_id = ? LIMIT 1'
  ).get(teamId, playerId);

  if (movements) {
    await db.prepare(`
      UPDATE club_members SET status = 'baja', updated_at = NOW()
      WHERE team_id = ? AND id = ?
    `).run(teamId, playerId);
    return res.json({ ok: true, action: 'baja' });
  }

  await db.prepare('DELETE FROM club_members WHERE team_id = ? AND id = ?').run(teamId, playerId);

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
    SELECT UPPER(COALESCE(curp, '')) AS curp,
           UPPER(display_name) AS full_name
    FROM club_members
    WHERE team_id = ?
  `).all(teamId);
  const byCurp = new Set(existing.map((e) => e.curp).filter(Boolean));
  const byName = new Set(existing.map((e) => e.full_name));

  let imported = 0;
  for (const row of source) {
    const curp = (row.curp || '').toUpperCase();
    const fullName = `${row.first_name} ${row.last_name}`.toUpperCase();
    if ((curp && byCurp.has(curp)) || byName.has(fullName)) continue;

    // Se COPIA el texto, no se enlaza la fila. Ese siempre fue el criterio, y
    // ahora el esquema lo hace literal: del roster de torneo sale un nombre y
    // aquí nace un miembro del club que no tiene ninguna relación con aquella
    // fila. Si mañana la liga lo mueve de rama o lo da de baja del roster, el
    // club lo sigue teniendo y cobrándole sin enterarse — y al revés también.
    await db.prepare(`
      INSERT INTO club_members
        (team_id, display_name, birth_date, position, jersey_number, photo_url, curp,
         share_token, group_label, joined_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_DATE)
    `).run(
      teamId,
      `${row.first_name} ${row.last_name}`.trim(),
      row.birth_date, row.position, row.jersey_number, row.photo_url, row.curp,
      crypto.randomUUID(), groupLabel
    );

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
    UPDATE club_members
    SET share_token = ?, updated_at = NOW()
    WHERE team_id = ? AND id = ?
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
    SELECT a.team_id, a.id AS player_id, a.monthly_amount, a.status,${nameCompatSql('a')},
           a.photo_url, a.jersey_number,
           t.name AS team_name, t.logo_url AS team_logo_url, t.brand_color,
           t.contact_phone AS team_phone, t.contact_email AS team_email
    FROM club_members a
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
    FROM club_ledger_entries
    WHERE team_id = ? AND member_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(account.team_id, account.player_id);

  const agg = await db.prepare(`
    SELECT ${BALANCE_SUM_SQL} AS balance,
           MIN(CASE WHEN kind = 'charge' AND status = 'open' THEN due_date END) AS next_due_date,
           COALESCE(SUM(CASE WHEN kind = 'charge' AND status = 'open' AND due_date < CURRENT_DATE THEN amount ELSE 0 END), 0) AS overdue_charges
    FROM club_ledger_entries
    WHERE team_id = ? AND member_id = ?
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
    SELECT id FROM club_ledger_entries
    WHERE team_id = ? AND member_id = ? AND kind = 'payment' AND status = 'pending'
  `).get(account.team_id, account.player_id);
  if (alreadyPending) {
    return res.status(409).json({ error: 'Ya tienes un pago esperando confirmación del club. Espera a que lo revisen.' });
  }

  const playerName = `${account.first_name} ${account.last_name}`.trim();

  await db.prepare(`
    INSERT INTO club_ledger_entries
      (team_id, member_id, kind, concept, amount, payment_method, reference, proof_url, note, status, created_by_side)
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
    SELECT id FROM club_ledger_entries
    WHERE team_id = ? AND member_id = ? AND kind = 'payment'
      AND status = 'pending' AND created_by_side = 'player'
  `).get(account.team_id, account.player_id);

  if (!pending) return res.status(404).json({ error: 'No tienes ningún pago esperando confirmación' });

  await db.prepare(`
    UPDATE club_ledger_entries
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
