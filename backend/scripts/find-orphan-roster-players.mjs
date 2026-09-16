// Diagnóstico: jugadores dados de alta SIN RAMA, que hoy nadie ve.
//
// Contexto: el panel de la liga tenía un botón "Roster" por equipo (del modelo
// viejo, antes de la corrección "roster por rama") que daba de alta al jugador
// con `player_team_memberships.branch_id = NULL`, porque ese modal no sabía en
// qué rama estabas. Todas las consultas del modelo actual filtran por
// `ptm.branch_id`, así que un jugador así no aparece en el roster de ninguna
// rama, ni en la plantilla de Excel, ni en el conteo de "tus planteles".
// El botón y sus endpoints ya se borraron, así que no se pueden crear nuevos —
// pero los que ya se crearon siguen ahí, guardados y sin verse.
//
// Este script los encuentra. Para recuperar a uno hay que decidir a qué rama
// pertenece (eso no lo puede adivinar el script: depende de la categoría y la
// rama en la que ese equipo compitió esa temporada) y asignárselo. Si la lista
// sale vacía, nadie usó nunca ese botón para dar de alta y no hay nada que
// arreglar.
//
// ES DE SOLO LECTURA: únicamente SELECT, sin migraciones. Seguro contra
// producción.
//
// Uso, desde la carpeta `backend/`:
//   node scripts/find-orphan-roster-players.mjs
//   DATABASE_URL="postgresql://…" node scripts/find-orphan-roster-players.mjs

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

const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

try {
  const { rows } = await pool.query(`
    SELECT ptm.id AS membership_id,
           p.id   AS player_id,
           p.first_name, p.last_name,
           ptm.jersey_number, ptm.position, ptm.season, ptm.start_date,
           t.id   AS team_id,
           t.name AS team_name,
           l.name AS league_name,
           (
             SELECT COUNT(*)::int FROM branch_teams bt WHERE bt.team_id = t.id
           ) AS ramas_del_equipo
      FROM player_team_memberships ptm
      JOIN players p ON p.id = ptm.player_id
      JOIN teams   t ON t.id = ptm.team_id
      LEFT JOIN leagues l ON l.id = t.league_id
     WHERE ptm.branch_id IS NULL
       AND ptm.end_date IS NULL
     ORDER BY t.name ASC, p.last_name ASC
  `);

  if (!rows.length) {
    console.log('\n✓ No hay ninguna membresía sin rama. Nadie usó el botón viejo para dar de alta.\n');
  } else {
    console.log(`\n⚠ ${rows.length} jugador(es) con membresía SIN RAMA — invisibles en toda la app:\n`);
    for (const r of rows) {
      console.log(`  ${r.first_name} ${r.last_name}  (jugador #${r.player_id}, membresía #${r.membership_id})`);
      console.log(`     equipo: ${r.team_name} (#${r.team_id})${r.league_name ? ` — liga: ${r.league_name}` : ' — sin liga'}`);
      console.log(`     dorsal: ${r.jersey_number ?? '—'}  posición: ${r.position || '—'}  temporada: ${r.season || '—'}  alta: ${fmt(r.start_date)}`);
      console.log(`     ese equipo está inscrito hoy en ${r.ramas_del_equipo} rama(s) — de ahí hay que elegir a cuál va\n`);
    }
    console.log('Para recuperarlos hay que asignarle a cada uno su rama. No lo hace este');
    console.log('script porque la rama correcta depende de en qué categoría/rama compitió');
    console.log('ese equipo esa temporada — es una decisión, no un dato deducible.\n');
  }
} catch (err) {
  console.error('\nFalló la consulta:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
