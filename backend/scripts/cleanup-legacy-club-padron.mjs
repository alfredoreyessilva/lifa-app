// Tira las tablas VIEJAS del padrón del club: `team_player_accounts` y
// `player_ledger_entries`.
//
// Las reemplazaron `club_members` y `club_ledger_entries` (ver README, "Dos
// poblaciones distintas"). El código ya no las lee ni las escribe, y `db.js`
// ya no las crea al arrancar — pero en una base que ya existía siguen ahí con
// sus datos, porque una tabla de dinero no se borra como efecto secundario de
// reiniciar un servidor.
//
// SIMULA POR DEFECTO. Sin `--confirm` no toca nada: enseña fila por fila lo que
// hay y se sale. Con `--confirm` las dropea, dentro de una transacción.
//
// ANTES DE CONFIRMAR, MIRA LA LISTA. Si aparece un club que no es tuyo, o
// movimientos con montos que reconozcas como cobros de verdad, NO lo corras:
// ese dinero hay que moverlo a `club_ledger_entries`, no tirarlo. El script
// enseña el dueño de cada equipo justamente para que eso se pueda ver.
//
// Uso, desde la carpeta `backend/`:
//   node scripts/cleanup-legacy-club-padron.mjs             # simula
//   node scripts/cleanup-legacy-club-padron.mjs --confirm   # dropea

import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const CONFIRM = process.argv.includes('--confirm');

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL (revisa tu .env o pásala en la línea del comando).');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // `true` a propósito, y solo aplica si DATABASE_URL viene sin sslmode:
  // si la trae, la cadena pisa esto. Ver el comentario en config/db.js.
  ssl: { rejectUnauthorized: true },
  max: 1,
});

const client = await pool.connect();

async function tableExists(name) {
  const { rows } = await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${name}`]);
  return rows[0].ok;
}

try {
  const hayCuentas = await tableExists('team_player_accounts');
  const hayLibro   = await tableExists('player_ledger_entries');

  if (!hayCuentas && !hayLibro) {
    console.log('\n✓ Las tablas viejas ya no existen. Nada que limpiar.\n');
    process.exit(0);
  }

  console.log(`\n${CONFIRM ? '=== BORRANDO ===' : '=== SIMULACIÓN (no se toca nada) ==='}\n`);

  if (hayCuentas) {
    const { rows } = await client.query(`
      SELECT a.id, t.name AS equipo, t.id AS team_id,
             COALESCE(p.first_name || ' ' || p.last_name, '(sin persona)') AS persona,
             COALESCE(u.email, 'sin dueño') AS dueno
        FROM team_player_accounts a
        JOIN teams t   ON t.id = a.team_id
        LEFT JOIN players p ON p.id = a.player_id
        LEFT JOIN users u   ON u.id = t.owner_user_id
       ORDER BY a.id
    `);
    console.log(`team_player_accounts — ${rows.length} cuenta(s):`);
    for (const r of rows) {
      console.log(`  #${r.id} · ${r.persona} · equipo ${r.equipo} (#${r.team_id}) · dueño: ${r.dueno}`);
    }
    if (!rows.length) console.log('  (vacía)');
    console.log('');
  }

  if (hayLibro) {
    const { rows } = await client.query(`
      SELECT e.id, t.name AS equipo, t.id AS team_id, e.kind, e.concept, e.amount,
             e.status, e.created_at::date AS fecha,
             COALESCE(u.email, 'sin dueño') AS dueno
        FROM player_ledger_entries e
        JOIN teams t ON t.id = e.team_id
        LEFT JOIN users u ON u.id = t.owner_user_id
       ORDER BY e.id
    `);
    console.log(`player_ledger_entries — ${rows.length} movimiento(s):`);
    for (const r of rows) {
      console.log(`  #${r.id} · ${r.kind} "${r.concept}" $${r.amount} [${r.status}] · equipo ${r.equipo} (#${r.team_id}) · ${r.fecha} · dueño: ${r.dueno}`);
    }
    if (!rows.length) console.log('  (vacía)');
    console.log('');
  }

  if (!CONFIRM) {
    console.log('Nada se borró. Revisa la lista de arriba: si todo eso es de prueba,');
    console.log('vuelve a correrlo con --confirm. Si hay cobros reales de algún club,');
    console.log('NO lo corras — ese dinero se mueve a club_ledger_entries, no se tira.\n');
    process.exit(0);
  }

  await client.query('BEGIN');
  // El libro primero: es el que podría referenciar a la otra por si en alguna
  // base quedó una FK que no está en el esquema base.
  if (hayLibro)   await client.query('DROP TABLE player_ledger_entries');
  if (hayCuentas) await client.query('DROP TABLE team_player_accounts');
  await client.query('COMMIT');

  console.log('✓ Listo. Tablas viejas eliminadas.');
  console.log('  El padrón del club vive ahora en club_members / club_ledger_entries.\n');
} catch (err) {
  try { await client.query('ROLLBACK'); } catch { /* la transacción pudo no haber iniciado */ }
  console.error('\nFalló — no se borró nada:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
