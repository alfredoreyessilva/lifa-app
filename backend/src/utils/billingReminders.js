// Recordatorios de cobranza, disparados por el mismo cron externo que ya llama
// a POST /api/notifications/trigger. Se llaman al final de ese handler
// (routes/notifications.js), después de los avisos de partidos.
//
// Son DOS libros distintos y cada uno tiene su función exportada:
//   - runBillingReminders        → liga → equipos (aviso por movimiento)
//   - runPlayerBillingReminders  → equipo → jugadores (aviso agregado por equipo)
// Comparten cadencia y helpers; ver el bloque de la segunda, más abajo, para
// por qué una avisa por movimiento y la otra no.
//
// Mismo patrón idempotente que la "Fase 3" de ese archivo: banderas por fila
// para no repetir, ventana de fechas acotada, y todo va a la bandeja in-app
// (tabla `notifications`), sin push ni correo.
//
// Cadencia fija (no configurable en la V1):
//   - "por vencer":  una sola vez, cuando faltan 3 días o menos.
//   - "vencido":     cada 3 días, hasta un máximo de 4 recordatorios.
// Solo corre para ligas con billing_reminders_enabled = TRUE.

const DUE_SOON_DAYS = 3;
const OVERDUE_REPEAT_DAYS = 3;
const OVERDUE_MAX_REMINDERS = 4;

function formatAmount(amount, currency = 'MXN') {
  const n = Number(amount);
  if (Number.isNaN(n)) return `${amount} ${currency}`;
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function conceptLabel(row) {
  return row.concept || 'Cargo';
}

// Inserta el aviso en la bandeja del equipo. `data.url` lleva al estado de
// cuenta del equipo, igual que el resto de notificaciones usan data.url.
async function notifyTeam(db, charge, type, title, body) {
  await db.prepare(`
    INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
    VALUES ('team', ?, ?, ?, ?, ?)
  `).run(
    charge.team_id,
    type,
    title,
    body,
    JSON.stringify({
      entry_id: charge.id,
      team_id: charge.team_id,
      league_id: charge.league_id,
      url: `/panel/equipo/${charge.team_id}/estado-de-cuenta`,
    })
  );
}

export async function runBillingReminders(db) {
  const result = { dueSoon: 0, overdue: 0 };

  try {
    // (1) Cargos por vencer — una sola vez.
    const dueSoon = await db.prepare(`
      SELECT e.id, e.team_id, e.league_id, e.concept, e.amount, e.currency, e.due_date,
             t.name AS team_name, l.name AS league_name
      FROM team_ledger_entries e
      JOIN teams   t ON t.id = e.team_id
      JOIN leagues l ON l.id = e.league_id
      WHERE e.kind = 'charge'
        AND e.status = 'open'
        AND e.reminded_due_soon = FALSE
        AND e.due_date IS NOT NULL
        AND e.due_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + ${DUE_SOON_DAYS})
        AND l.billing_reminders_enabled = TRUE
    `).all();

    for (const charge of dueSoon) {
      await notifyTeam(
        db,
        charge,
        'billing_due_soon',
        'Cargo por vencer ⏰',
        `Tu liga ${charge.league_name} te registró un cargo de ${formatAmount(charge.amount, charge.currency)} `
          + `(${conceptLabel(charge)}) que vence pronto. Ponte al corriente con la liga.`
      );
      await db.prepare('UPDATE team_ledger_entries SET reminded_due_soon = TRUE, updated_at = NOW() WHERE id = ?')
        .run(charge.id);
      result.dueSoon++;
    }

    // (2) Cargos vencidos — se repite cada OVERDUE_REPEAT_DAYS, con tope.
    const overdue = await db.prepare(`
      SELECT e.id, e.team_id, e.league_id, e.concept, e.amount, e.currency, e.due_date,
             e.overdue_reminder_count,
             t.name AS team_name, l.name AS league_name
      FROM team_ledger_entries e
      JOIN teams   t ON t.id = e.team_id
      JOIN leagues l ON l.id = e.league_id
      WHERE e.kind = 'charge'
        AND e.status = 'open'
        AND e.due_date IS NOT NULL
        AND e.due_date < CURRENT_DATE
        AND e.overdue_reminder_count < ${OVERDUE_MAX_REMINDERS}
        AND (
          e.last_overdue_reminder_at IS NULL
          OR e.last_overdue_reminder_at < NOW() - INTERVAL '${OVERDUE_REPEAT_DAYS} days'
        )
        AND l.billing_reminders_enabled = TRUE
    `).all();

    for (const charge of overdue) {
      await notifyTeam(
        db,
        charge,
        'billing_overdue',
        'Cargo vencido 🔴',
        `El cargo de ${formatAmount(charge.amount, charge.currency)} (${conceptLabel(charge)}) con tu liga `
          + `${charge.league_name} ya venció. Regulariza tu pago para no acumular adeudo.`
      );
      await db.prepare(`
        UPDATE team_ledger_entries
        SET overdue_reminder_count = overdue_reminder_count + 1,
            last_overdue_reminder_at = NOW(),
            updated_at = NOW()
        WHERE id = ?
      `).run(charge.id);
      result.overdue++;
    }
  } catch (err) {
    // No debe tumbar el resto del cron (avisos de partidos ya corrieron antes).
    console.error('runBillingReminders falló:', err);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recordatorios de cuotas (equipo → jugadores).
//
// Una diferencia de fondo con el de arriba: aquí el aviso va AGREGADO, uno por
// equipo y por corrida ("3 jugadores tienen cuotas vencidas — $2,400 en total"),
// no uno por movimiento. Dos razones:
//
//  1. Un equipo de 40 jugadores generaría 40 avisos idénticos en la misma
//     corrida y volvería inservible su bandeja. Una liga tiene 8 equipos; un
//     equipo tiene decenas de jugadores.
//  2. El destinatario real es el tesorero, y lo que necesita saber es "hoy
//     tienes que perseguir a estos", no el detalle movimiento por movimiento
//     (ese ya lo tiene en el panel de Finanzas).
//
// El aviso NO le llega al papá: la tabla notifications tiene
// CHECK (recipient_type IN ('league','team')) y los jugadores no tienen cuenta
// en la plataforma. Al papá lo contacta el tesorero por WhatsApp desde el
// panel, con el mensaje y el link ya armados.
//
// Las banderas por fila (reminded_due_soon / overdue_reminder_count) se siguen
// marcando por movimiento aunque el aviso sea agregado, así que cada cargo
// respeta su propio tope de 4 recordatorios igual que en el libro de la liga.

const DUE_SOON_WINDOW = `e.due_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + ${DUE_SOON_DAYS})`;

function playerCountLabel(n) {
  return Number(n) === 1 ? '1 jugador' : `${n} jugadores`;
}

async function notifyTeamAggregate(db, teamId, type, title, body) {
  await db.prepare(`
    INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
    VALUES ('team', ?, ?, ?, ?, ?)
  `).run(
    teamId,
    type,
    title,
    body,
    JSON.stringify({ team_id: teamId, url: `/panel/equipo/${teamId}/finanzas` })
  );
}

export async function runPlayerBillingReminders(db) {
  const result = { dueSoon: 0, overdue: 0 };

  try {
    // (1) Cuotas por vencer — una sola vez por movimiento.
    const dueSoon = await db.prepare(`
      SELECT e.team_id,
             COUNT(DISTINCT e.player_id) AS player_count,
             SUM(e.amount) AS total_amount
      FROM player_ledger_entries e
      JOIN teams t ON t.id = e.team_id
      WHERE e.kind = 'charge'
        AND e.status = 'open'
        AND e.reminded_due_soon = FALSE
        AND e.due_date IS NOT NULL
        AND ${DUE_SOON_WINDOW}
        AND t.player_billing_reminders_enabled = TRUE
      GROUP BY e.team_id
    `).all();

    for (const row of dueSoon) {
      await notifyTeamAggregate(
        db,
        row.team_id,
        'player_billing_due_soon',
        'Cuotas por vencer ⏰',
        `${playerCountLabel(row.player_count)} tienen cuotas que vencen pronto, `
          + `${formatAmount(row.total_amount)} en total. Mándales el recordatorio desde Finanzas.`
      );
      // Se vuelve a filtrar con las mismas condiciones para marcar exactamente
      // los movimientos que se acaban de contar.
      await db.prepare(`
        UPDATE player_ledger_entries e
        SET reminded_due_soon = TRUE, updated_at = NOW()
        WHERE e.team_id = ?
          AND e.kind = 'charge'
          AND e.status = 'open'
          AND e.reminded_due_soon = FALSE
          AND e.due_date IS NOT NULL
          AND ${DUE_SOON_WINDOW}
      `).run(row.team_id);
      result.dueSoon++;
    }

    // (2) Cuotas vencidas — se repite cada OVERDUE_REPEAT_DAYS, con tope por
    // movimiento.
    const overdueWindow = `
      e.kind = 'charge'
      AND e.status = 'open'
      AND e.due_date IS NOT NULL
      AND e.due_date < CURRENT_DATE
      AND e.overdue_reminder_count < ${OVERDUE_MAX_REMINDERS}
      AND (
        e.last_overdue_reminder_at IS NULL
        OR e.last_overdue_reminder_at < NOW() - INTERVAL '${OVERDUE_REPEAT_DAYS} days'
      )
    `;

    const overdue = await db.prepare(`
      SELECT e.team_id,
             COUNT(DISTINCT e.player_id) AS player_count,
             SUM(e.amount) AS total_amount
      FROM player_ledger_entries e
      JOIN teams t ON t.id = e.team_id
      WHERE ${overdueWindow}
        AND t.player_billing_reminders_enabled = TRUE
      GROUP BY e.team_id
    `).all();

    for (const row of overdue) {
      await notifyTeamAggregate(
        db,
        row.team_id,
        'player_billing_overdue',
        'Cuotas vencidas 🔴',
        `${playerCountLabel(row.player_count)} tienen cuotas vencidas, `
          + `${formatAmount(row.total_amount)} en total. Revisa quiénes en Finanzas.`
      );
      await db.prepare(`
        UPDATE player_ledger_entries e
        SET overdue_reminder_count = e.overdue_reminder_count + 1,
            last_overdue_reminder_at = NOW(),
            updated_at = NOW()
        WHERE e.team_id = ? AND ${overdueWindow}
      `).run(row.team_id);
      result.overdue++;
    }
  } catch (err) {
    // Mismo criterio que runBillingReminders: no debe tumbar el resto del cron.
    console.error('runPlayerBillingReminders falló:', err);
  }

  return result;
}
