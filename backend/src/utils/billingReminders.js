// Recordatorios de cobranza (liga → equipos), disparados por el mismo cron
// externo que ya llama a POST /api/notifications/trigger. Se llama al final de
// ese handler (routes/notifications.js), después de los avisos de partidos.
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
