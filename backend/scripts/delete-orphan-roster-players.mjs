// Borra las membresías SIN RAMA (`player_team_memberships.branch_id IS NULL`) y,
// cuando el jugador no quede referenciado en ningún otro lado, también su fila
// en `players`. Son las que dejó el botón "Roster" viejo del panel de la liga
// (ver README, "Roster de jugadores"); el botón ya se borró, así que no se
// pueden crear nuevas.
//
// SIMULA POR DEFECTO. Sin `--confirm` no escribe nada: solo dice qué haría.
// Para borrar de verdad hay que pasar `--confirm`, y entonces todo corre dentro
// de UNA transacción: si algo falla, no se borra nada a medias.
//
// Por qué no basta un DELETE de una línea: otras tablas apuntan a `players(id)`
// con ON DELETE CASCADE, así que borrar la fila se llevaría sus estadísticas de
// partido en silencio. Así que:
//
//   - La membresía huérfana se borra siempre: está rota por definición, no la
//     ve ninguna pantalla.
//   - La fila del jugador se borra SOLO si no queda referenciada en ningún otro
//     lado: ninguna otra membresía (con rama), ninguna estadística de partido, y
//     que no haya reclamado su perfil (`players.user_id`). Si tiene aunque sea
//     una, el jugador se queda y el script dice por qué.
//
// Ya NO se revisa el padrón ni el libro de cuotas de ningún club: desde la
// separación (`club_members` / `club_ledger_entries`) el dinero del club no
// cuelga de `players`, así que esto no puede tocar la cobranza de nadie.
//
// Uso, desde la carpeta `backend/`:
//   node scripts/delete-orphan-roster-players.mjs              # simula
//   node scripts/delete-orphan-roster-players.mjs --confirm    # borra

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
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const client = await pool.connect();

try {
  // Las membresías huérfanas, con todo lo que hay que saber de cada jugador
  // antes de decidir si su fila se puede borrar o no.
  const { rows } = await client.query(`
    SELECT ptm.id AS membership_id,
           p.id   AS player_id,
           p.first_name, p.last_name,
           t.name AS team_name,
           (SELECT COUNT(*)::int FROM player_team_memberships o
             WHERE o.player_id = p.id AND o.branch_id IS NOT NULL)   AS otras_membresias,
           (SELECT COUNT(*)::int FROM player_match_stats s
             WHERE s.player_id = p.id)                               AS estadisticas,
           CASE WHEN p.user_id IS NOT NULL THEN 1 ELSE 0 END         AS cuenta_propia
      FROM player_team_memberships ptm
      JOIN players p ON p.id = ptm.player_id
      JOIN teams   t ON t.id = ptm.team_id
     WHERE ptm.branch_id IS NULL
     ORDER BY t.name ASC, p.last_name ASC
  `);

  if (!rows.length) {
    console.log('\n✓ No hay ninguna membresía sin rama. Nada que borrar.\n');
    process.exit(0);
  }

  // Un jugador puede tener más de una membresía huérfana; se agrupa por jugador
  // para decidir una sola vez si su fila se borra.
  const porJugador = new Map();
  for (const r of rows) {
    if (!porJugador.has(r.player_id)) porJugador.set(r.player_id, { ...r, membresias: [] });
    porJugador.get(r.player_id).membresias.push(r.membership_id);
  }

  const aBorrarCompleto = [];
  const soloMembresia   = [];
  for (const j of porJugador.values()) {
    const retiene = j.otras_membresias + j.estadisticas + j.cuenta_propia;
    (retiene === 0 ? aBorrarCompleto : soloMembresia).push(j);
  }

  console.log(`\n${CONFIRM ? '=== BORRANDO ===' : '=== SIMULACIÓN (no se escribe nada) ==='}\n`);
  console.log(`Membresías sin rama encontradas: ${rows.length}, en ${porJugador.size} jugador(es).\n`);

  if (aBorrarCompleto.length) {
    console.log(`Se borran por completo (membresía + fila en players) — ${aBorrarCompleto.length}:`);
    for (const j of aBorrarCompleto) {
      console.log(`  • ${j.first_name} ${j.last_name} (#${j.player_id}) — equipo ${j.team_name}`);
    }
    console.log('');
  }

  if (soloMembresia.length) {
    console.log(`Se borra SOLO la membresía huérfana; el jugador se queda — ${soloMembresia.length}:`);
    for (const j of soloMembresia) {
      const motivos = [];
      if (j.otras_membresias)   motivos.push(`${j.otras_membresias} membresía(s) con rama`);
      if (j.estadisticas)       motivos.push(`${j.estadisticas} estadística(s)`);
      if (j.cuenta_propia)      motivos.push("una cuenta de usuario propia");
      console.log(`  • ${j.first_name} ${j.last_name} (#${j.player_id}) — se queda porque tiene: ${motivos.join(', ')}`);
    }
    console.log('');
  }

  if (!CONFIRM) {
    console.log('Nada se borró. Para ejecutarlo de verdad, vuelve a correrlo con --confirm.\n');
    process.exit(0);
  }

  await client.query('BEGIN');

  const idsMembresias = rows.map((r) => r.membership_id);
  const { rowCount: membresiasBorradas } = await client.query(
    `DELETE FROM player_team_memberships WHERE id = ANY($1::int[]) AND branch_id IS NULL`,
    [idsMembresias]
  );

  let jugadoresBorrados = 0;
  if (aBorrarCompleto.length) {
    // Se revalida la condición dentro de la transacción (NOT EXISTS sobre las
    // cuatro tablas) en vez de confiar en los conteos de hace un momento: si
    // entre la lectura y el borrado alguien le registró un pago a ese jugador,
    // esta cláusula lo protege y el DELETE simplemente no lo toca.
    const res = await client.query(`
      DELETE FROM players p
       WHERE p.id = ANY($1::int[])
         AND NOT EXISTS (SELECT 1 FROM player_team_memberships m WHERE m.player_id = p.id)
         AND NOT EXISTS (SELECT 1 FROM player_match_stats     s WHERE s.player_id = p.id)
         AND p.user_id IS NULL
    `, [aBorrarCompleto.map((j) => j.player_id)]);
    jugadoresBorrados = res.rowCount;
  }

  await client.query('COMMIT');

  console.log(`✓ Listo. Membresías borradas: ${membresiasBorradas}. Jugadores borrados: ${jugadoresBorrados}.`);
  if (jugadoresBorrados !== aBorrarCompleto.length) {
    console.log(`  (${aBorrarCompleto.length - jugadoresBorrados} jugador(es) se salvaron por la revalidación`);
    console.log('   dentro de la transacción — les apareció una referencia. Vuelve a correr el');
    console.log('   script sin --confirm para ver cuál.)');
  }
  console.log('');
} catch (err) {
  try { await client.query('ROLLBACK'); } catch { /* la transacción pudo no haber iniciado */ }
  console.error('\nFalló — no se borró nada:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
