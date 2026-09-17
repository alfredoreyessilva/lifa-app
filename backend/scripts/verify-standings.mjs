// Verifica, contra la base de datos real, que la tabla de posiciones quedó
// bien instalada y que calcula lo que debe.
//
// NO ESCRIBE NADA. Ni una fila, ni una columna, ni una migración. Solo lee y
// reporta. Se puede correr contra producción sin pensarlo dos veces.
//
// Qué revisa, en este orden:
//   1. Que existan las tablas y columnas nuevas (si faltan, dice exactamente
//      qué hacer: arrancar el servidor una vez, que es quien corre initSchema).
//   2. Que las consultas nuevas corran de verdad contra el esquema real —
//      es lo que las pruebas unitarias NO pueden comprobar, porque corren sin
//      Postgres.
//   3. La tabla de posiciones ya calculada de una rama, para poder comparar
//      los números contra lo que la liga tiene a mano.
//
// Uso, desde la carpeta `backend/`:
//   node scripts/verify-standings.mjs              (revisa y elige una rama con partidos)
//   node scripts/verify-standings.mjs --branch 12  (una rama específica)

import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL (revisa tu .env o pásala en la línea del comando).');
  process.exit(1);
}

const argBranch = (() => {
  const i = process.argv.indexOf('--branch');
  return i >= 0 ? Number(process.argv[i + 1]) : null;
})();

const titulo = (t) => console.log(`\n${'─'.repeat(74)}\n${t}\n${'─'.repeat(74)}`);
const ok   = (m) => console.log(`  ✓ ${m}`);
const bad  = (m) => console.log(`  ✗ ${m}`);

// Se importan DESPUÉS de dotenv para que el pool ya vea DATABASE_URL.
const { default: db } = await import('../src/config/db.js');
const { buildBranchStandings } = await import('../src/utils/branchStandings.js');

let problemas = 0;

try {
  titulo('1. Estructura nueva en la base de datos');

  const tablas = ['phases', 'titles', 'title_overrides', 'phase_qualifications'];
  for (const t of tablas) {
    const row = await db.prepare(
      'SELECT to_regclass(?) AS existe'
    ).get(`public.${t}`);
    if (row?.existe) ok(`tabla ${t}`);
    else { bad(`FALTA la tabla ${t}`); problemas += 1; }
  }

  const columnas = [
    ['matches', 'phase_id'],
    ['branches', 'standings_levels'],
    ['branches', 'tiebreakers'],
    ['branches', 'tiebreaker_mode'],
    ['branches', 'points_win'],
  ];
  for (const [tabla, col] of columnas) {
    const row = await db.prepare(`
      SELECT 1 AS existe FROM information_schema.columns
      WHERE table_name = ? AND column_name = ?
    `).get(tabla, col);
    if (row) ok(`columna ${tabla}.${col}`);
    else { bad(`FALTA la columna ${tabla}.${col}`); problemas += 1; }
  }

  if (problemas) {
    console.log(`
  Falta correr las migraciones. No las corre este script — las corre
  initSchema() al arrancar el servidor:

      npm run dev     (o el deploy normal a Render)

  Son todas aditivas (tablas nuevas y columnas nuevas con default), no
  tocan ni borran nada de lo que ya existe.`);
    process.exit(1);
  }

  titulo('2. Las consultas nuevas corren contra el esquema real');

  // Esto es lo que las pruebas unitarias no alcanzan: que el SQL con los
  // fragmentos de matchScope + matchPhase sea válido de verdad.
  const rama = argBranch
    ? await db.prepare('SELECT id, name FROM branches WHERE id = ?').get(argBranch)
    : await db.prepare(`
        SELECT b.id, b.name, COUNT(m.id) AS partidos
        FROM branches b
        JOIN matches m ON m.branch_id = b.id AND m.status = 'final' AND m.is_draft = FALSE
        GROUP BY b.id, b.name
        ORDER BY COUNT(m.id) DESC
        LIMIT 1
      `).get();

  if (!rama) {
    console.log('  No hay ninguna rama con partidos finalizados todavía — nada que calcular.');
    console.log('  La estructura sí quedó bien instalada (punto 1).');
    process.exit(0);
  }

  const resultado = await buildBranchStandings(rama.id);
  ok(`buildBranchStandings(${rama.id}) corrió sin error`);

  titulo(`3. Tabla de posiciones — rama "${rama.name}" (id ${rama.id})`);

  const cfg = resultado.branch;
  console.log(`  Niveles publicados : ${cfg.standings_levels.join(', ')}`);
  console.log(`  Desempates         : ${cfg.tiebreakers.join(' → ')}`);
  console.log(`  Empate de 3+       : ${cfg.multi_team_mode === 'restart' ? 'reinicia el reglamento' : 'sigue con el criterio siguiente'}`);
  console.log(`  Sistema de puntos  : ${cfg.uses_points ? `${cfg.points_win}/${cfg.points_draw}/${cfg.points_loss}` : 'no (ordena por % de ganados)'}`);
  console.log(`  Fases creadas      : ${resultado.phases.length || 'ninguna (se deduce de la jornada)'}`);

  for (const tabla of resultado.tables) {
    console.log(`\n  ── ${tabla.level}${tabla.scope_name ? `: ${tabla.scope_name}` : ''} ──`);
    console.log('  ' + '#'.padEnd(4) + 'EQUIPO'.padEnd(26) + 'JJ'.padStart(4) + 'G'.padStart(4)
      + 'P'.padStart(4) + 'E'.padStart(4) + '%'.padStart(7) + 'PF'.padStart(6) + 'PC'.padStart(6) + 'DIF'.padStart(6));
    for (const r of tabla.rows) {
      console.log('  '
        + String(r.rank).padEnd(4)
        + String(r.name).slice(0, 25).padEnd(26)
        + String(r.played).padStart(4)
        + String(r.wins).padStart(4)
        + String(r.losses).padStart(4)
        + String(r.ties).padStart(4)
        + r.win_pct.toFixed(3).padStart(7)
        + String(r.points_for).padStart(6)
        + String(r.points_against).padStart(6)
        + String(r.point_diff > 0 ? `+${r.point_diff}` : r.point_diff).padStart(6)
        + (r.unresolved_tie ? '  ← empate sin resolver' : '')
        + (r.resolved_by ? `  (${r.resolved_by})` : ''));
    }
  }

  if (resultado.titles.length) {
    titulo('4. Títulos declarados');
    for (const t of resultado.titles) {
      const ganadores = t.winners.filter((w) => w.team_id);
      console.log(`  ${t.name} — ${t.scope}, por ${t.decided_by === 'standings' ? 'tabla' : 'partido'}`);
      if (!ganadores.length) console.log('    (todavía sin campeón definido)');
      for (const w of ganadores) {
        console.log(`    ${w.scope_name ? `${w.scope_name}: ` : ''}${w.team_name} [${w.source}]`);
      }
    }
  } else {
    titulo('4. Títulos declarados');
    console.log('  Ninguno todavía. Se declaran desde el panel: Estructura → rama → ⚙ competencia → Títulos.');
  }

  console.log('\n  Listo. Nada se escribió.\n');
} catch (err) {
  console.error('\n  Error al verificar:', err.message);
  console.error(err.stack);
  process.exit(1);
} finally {
  // Salida explícita: este script usa el `db` compartido (src/config/db.js),
  // que no expone forma de cerrar el pool, y un pool abierto deja el proceso
  // colgado en vez de terminar. Los `process.exit(1)` de arriba salen antes
  // de llegar aquí, así que el código de error se respeta.
  process.exit(0);
}
