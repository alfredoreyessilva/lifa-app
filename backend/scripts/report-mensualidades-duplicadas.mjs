// Diagnóstico: ¿hay clubes a los que ya se les cobró dos veces el mismo mes?
//
// Contexto: hasta el cobro automático, la mensualidad se creaba a mano con
// "Generar cuotas" o con "Repetir el mes pasado", y NADA impedía apretar el
// botón dos veces y dejar dos cargos legítimos del mismo periodo al mismo
// jugador. El ciclo automático ya no puede duplicar (lo impide el índice único
// idx_club_ledger_auto_cycle, ver config/db.js), pero eso no repara lo que ya
// haya pasado antes.
//
// Esto NO bloquea ningún despliegue: el índice nuevo se crea sobre la columna
// auto_cycle_key, que nace NULL en toda la tabla, así que no puede fallar por
// duplicados históricos. Este reporte existe para que alguien mire esas filas y
// decida, no para que el arranque del servidor decida por su cuenta.
//
// Si sale algo: el libro es append-only, así que el sobrante NO se borra. Se
// cancela desde el panel (Finanzas → Movimientos → Cancelar), que deja el
// original en 'void' y le suma su ajuste de reversa.
//
// ES DE SOLO LECTURA: únicamente SELECT, sin migraciones. Seguro contra
// producción.
//
// Uso, desde la carpeta `backend/`:
//   node scripts/report-mensualidades-duplicadas.mjs
//   DATABASE_URL="postgresql://…" node scripts/report-mensualidades-duplicadas.mjs

import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL (revisa tu .env o pásala en la línea del comando).');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

function money(n) {
  return `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

try {
  // (1) Mismo periodo etiquetado, mismo miembro, más de un cargo vivo.
  const porPeriodo = await pool.query(`
    SELECT e.team_id, t.name AS team_name, e.member_id, m.display_name,
           e.period_label, COUNT(*) AS veces, SUM(e.amount) AS total,
           array_agg(e.id ORDER BY e.id) AS entry_ids
    FROM club_ledger_entries e
    JOIN teams t        ON t.id = e.team_id
    JOIN club_members m ON m.id = e.member_id
    WHERE e.kind = 'charge' AND e.category = 'mensualidad'
      AND e.status <> 'void' AND e.period_label IS NOT NULL
    GROUP BY 1, 2, 3, 4, 5
    HAVING COUNT(*) > 1
    ORDER BY veces DESC, e.team_id
  `);

  console.log('\n── Mensualidades duplicadas por periodo etiquetado ──');
  if (porPeriodo.rowCount === 0) {
    console.log('   Ninguna. 👍');
  } else {
    for (const r of porPeriodo.rows) {
      console.log(
        `   ${r.team_name} · ${r.display_name} · ${r.period_label}: ` +
        `${r.veces} cargos, ${money(r.total)} — ids ${r.entry_ids.join(', ')}`
      );
    }
  }

  // (2) El caso que una etiqueta de periodo no alcanza a ver: dos cargos de
  // mensualidad que vencen el MISMO mes, aunque no tengan period_label (es un
  // campo opcional y de texto libre). Es el mismo doble cobro visto por fecha.
  const porMes = await pool.query(`
    SELECT e.team_id, t.name AS team_name, e.member_id, m.display_name,
           to_char(date_trunc('month', e.due_date), 'YYYY-MM') AS mes,
           COUNT(*) AS veces, SUM(e.amount) AS total,
           array_agg(e.id ORDER BY e.id) AS entry_ids
    FROM club_ledger_entries e
    JOIN teams t        ON t.id = e.team_id
    JOIN club_members m ON m.id = e.member_id
    WHERE e.kind = 'charge' AND e.category = 'mensualidad'
      AND e.status <> 'void' AND e.due_date IS NOT NULL
    GROUP BY 1, 2, 3, 4, 5
    HAVING COUNT(*) > 1
    ORDER BY veces DESC, e.team_id
  `);

  console.log('\n── Mensualidades que vencen el mismo mes (con o sin etiqueta) ──');
  if (porMes.rowCount === 0) {
    console.log('   Ninguna. 👍');
  } else {
    for (const r of porMes.rows) {
      console.log(
        `   ${r.team_name} · ${r.display_name} · ${r.mes}: ` +
        `${r.veces} cargos, ${money(r.total)} — ids ${r.entry_ids.join(', ')}`
      );
    }
  }

  // (3) Estado del índice que protege al ciclo automático. Se comprueba aquí
  // porque initSchema() se traga el error de cualquier migración que falle (ver
  // el SAVEPOINT en config/db.js): sin esta comprobación, un índice ausente no
  // aparecería en ningún log.
  const idx = await pool.query(`
    SELECT indexdef FROM pg_indexes
    WHERE tablename = 'club_ledger_entries' AND indexname = 'idx_club_ledger_auto_cycle'
  `);
  console.log('\n── Índice del ciclo automático ──');
  console.log(idx.rowCount > 0
    ? `   Existe: ${idx.rows[0].indexdef}`
    : '   NO EXISTE. El cobro automático se va a negar a generar hasta que se cree.');

  console.log('');
} catch (err) {
  console.error('Error consultando la base:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
