// Diagnóstico: qué quedó en el padrón VIEJO después de la separación.
//
// Contexto: el padrón del club dejó de colgar de `players` y ahora vive en
// `club_members`, con su libro propio `club_ledger_entries` (ver README,
// "Dos poblaciones distintas"). Las tablas viejas —`team_player_accounts` y
// `player_ledger_entries`— NO se borraron: el código nuevo simplemente dejó de
// usarlas. Esto reporta lo que quedó ahí para que la decisión de borrarlo sea
// humana y no un efecto secundario de arrancar el servidor.
//
// Ojo con una cosa antes de borrar: `player_ledger_entries` es un libro de
// DINERO. Si sale con movimientos de un club real —no de prueba— hay que
// moverlos a `club_ledger_entries`, no tirarlos. Este script no mueve nada.
//
// ES DE SOLO LECTURA: únicamente SELECT, sin migraciones. Seguro contra
// producción.
//
// Uso, desde la carpeta `backend/`:
//   node scripts/report-legacy-club-padron.mjs
//   DATABASE_URL="postgresql://…" node scripts/report-legacy-club-padron.mjs

import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

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

// Las tablas viejas pueden no existir en una base creada desde cero después de
// la separación, así que se pregunta antes en vez de dejar que truene.
async function tableExists(name) {
  const { rows } = await pool.query(
    `SELECT to_regclass($1) IS NOT NULL AS ok`,
    [`public.${name}`]
  );
  return rows[0].ok;
}

try {
  console.log('\n=== Padrón viejo (colgado de `players`) ===\n');

  if (!(await tableExists('team_player_accounts'))) {
    console.log('  team_player_accounts no existe — base creada después de la separación.');
  } else {
    const { rows } = await pool.query(`
      SELECT t.id AS team_id, t.name AS team_name, COUNT(*)::int AS cuentas
        FROM team_player_accounts a
        JOIN teams t ON t.id = a.team_id
       GROUP BY t.id, t.name
       ORDER BY cuentas DESC, t.name ASC
    `);
    const total = rows.reduce((s, r) => s + r.cuentas, 0);
    console.log(`  team_player_accounts: ${total} cuenta(s) en ${rows.length} equipo(s)`);
    for (const r of rows) console.log(`    · ${r.team_name} (#${r.team_id}): ${r.cuentas}`);
    if (!rows.length) console.log('    (vacía)');
  }

  console.log('');

  if (!(await tableExists('player_ledger_entries'))) {
    console.log('  player_ledger_entries no existe — base creada después de la separación.');
  } else {
    const { rows } = await pool.query(`
      SELECT t.id AS team_id, t.name AS team_name,
             COUNT(*)::int AS movimientos,
             COUNT(*) FILTER (WHERE e.kind = 'charge')::int  AS cargos,
             COUNT(*) FILTER (WHERE e.kind = 'payment')::int AS pagos,
             COALESCE(SUM(e.amount) FILTER (WHERE e.kind = 'payment' AND e.status <> 'pending'), 0) AS pagado
        FROM player_ledger_entries e
        JOIN teams t ON t.id = e.team_id
       GROUP BY t.id, t.name
       ORDER BY movimientos DESC, t.name ASC
    `);
    const total = rows.reduce((s, r) => s + r.movimientos, 0);
    console.log(`  player_ledger_entries: ${total} movimiento(s) en ${rows.length} equipo(s)`);
    for (const r of rows) {
      console.log(`    · ${r.team_name} (#${r.team_id}): ${r.movimientos} (${r.cargos} cargos, ${r.pagos} pagos, $${Number(r.pagado).toLocaleString('es-MX')} cobrado)`);
    }
    if (!rows.length) console.log('    (vacía)');
  }

  console.log('\n=== Padrón nuevo ===\n');

  const { rows: [nuevo] } = await pool.query(`
    SELECT (SELECT COUNT(*)::int FROM club_members)        AS miembros,
           (SELECT COUNT(*)::int FROM club_ledger_entries) AS movimientos
  `);
  console.log(`  club_members:        ${nuevo.miembros} miembro(s)`);
  console.log(`  club_ledger_entries: ${nuevo.movimientos} movimiento(s)`);

  console.log('\nSi las tablas viejas salen vacías o solo con datos de prueba, se pueden');
  console.log('tirar sin más. Si traen movimientos de un club real, hay que MOVERLOS a');
  console.log('club_ledger_entries antes de borrar nada — es dinero de familias.\n');
} catch (err) {
  console.error('\nFalló la consulta:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
