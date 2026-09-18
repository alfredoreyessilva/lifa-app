// Rellena la conferencia/grupo de cada equipo inscrito (branch_teams) a partir
// de lo que ya está capturado en sus partidos.
//
// Es el paso que hace que el cambio "la conferencia se dice UNA vez por equipo,
// no una vez por partido" no empiece desde cero: la información ya existe,
// solo está guardada en el lugar equivocado (repetida en cada partido). Esto la
// lee de ahí y la deja donde ahora vive.
//
// QUÉ ESCRIBE, exactamente:
//   · branch_teams.conference_id y branch_teams.group_id. Nada más.
//
// QUÉ NO TOCA, nunca:
//   · `matches`  — ni conference_id, ni group_id, ni una sola fila. Lo que se
//                  capturó a mano durante la temporada se queda íntegro como
//                  respaldo, y un partido mal capturado se corrige solo porque
//                  la derivación le gana al valor viejo al LEER, no porque se
//                  haya reescrito la base.
//   · `predictions` / `pools` / `pool_members` — el concurso de predicciones no
//                  se roza. Cuelga de match_id, y ningún partido cambia de id,
//                  de fecha, de marcador ni de estado aquí.
//
// Cómo decide la conferencia de un equipo: cuenta en cuántos de sus partidos
// aparece cada conferencia y se queda con la que más veces salga. Si hay
// empate, no decide nada y lo reporta para que lo resuelvas a mano. Un partido
// suelto mal capturado no arrastra al equipo entero.
//
// Por defecto NO escribe: imprime lo que haría y termina. Para aplicarlo de
// verdad hay que pasar --apply explícitamente.
//
// Uso, desde la carpeta `backend/`:
//   node scripts/backfill-team-conferences.mjs            (simulación)
//   node scripts/backfill-team-conferences.mjs --apply    (escribe)
//   node scripts/backfill-team-conferences.mjs --apply --force
//       …--force además PISA la conferencia de los equipos que ya tuvieran una
//         puesta a mano. Sin él, esos se respetan y no se tocan.

import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL (revisa tu .env o pásala en la línea del comando).');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // `true` a propósito, y solo aplica si DATABASE_URL viene sin sslmode:
  // si la trae, la cadena pisa esto. Ver el comentario en config/db.js.
  ssl: { rejectUnauthorized: true },
  max: 1,
});

const titulo = (t) => console.log(`\n${'─'.repeat(74)}\n${t}\n${'─'.repeat(74)}`);

try {
  // Un renglón por (equipo, rama, conferencia) con cuántos partidos lo avalan.
  // Se miran los partidos de la rama donde el equipo juega de local o visitante
  // (por id: el nombre en texto no basta para saber de qué equipo se trata).
  const { rows: votos } = await pool.query(`
    WITH lados AS (
      SELECT branch_id, home_team_id AS team_id, conference_id, group_id
      FROM matches WHERE branch_id IS NOT NULL AND home_team_id IS NOT NULL
      UNION ALL
      SELECT branch_id, away_team_id, conference_id, group_id
      FROM matches WHERE branch_id IS NOT NULL AND away_team_id IS NOT NULL
    )
    SELECT bt.branch_id, bt.team_id, t.name AS equipo,
           b.name AS rama, cat.name AS categoria, l.name AS liga,
           bt.conference_id AS conferencia_actual,
           bt.group_id      AS grupo_actual,
           ld.conference_id AS conferencia_votada,
           ld.group_id      AS grupo_votado,
           COUNT(*)         AS votos
    FROM branch_teams bt
    JOIN teams      t   ON t.id   = bt.team_id
    JOIN branches   b   ON b.id   = bt.branch_id
    JOIN categories cat ON cat.id = b.category_id
    JOIN leagues    l   ON l.id   = cat.league_id
    LEFT JOIN lados ld  ON ld.branch_id = bt.branch_id AND ld.team_id = bt.team_id
    GROUP BY bt.branch_id, bt.team_id, t.name, b.name, cat.name, l.name,
             bt.conference_id, bt.group_id, ld.conference_id, ld.group_id
    ORDER BY l.name, cat.name, b.name, t.name
  `);

  // Se agrupa por equipo y se elige por mayoría.
  const equipos = new Map();
  for (const v of votos) {
    const key = `${v.branch_id}:${v.team_id}`;
    if (!equipos.has(key)) {
      equipos.set(key, {
        branch_id: v.branch_id, team_id: v.team_id, equipo: v.equipo,
        ruta: `${v.liga} › ${v.categoria} › ${v.rama}`,
        conferenciaActual: v.conferencia_actual, grupoActual: v.grupo_actual,
        conferencias: new Map(), grupos: new Map(), sinConferencia: 0, total: 0,
      });
    }
    const e = equipos.get(key);
    const n = Number(v.votos);
    e.total += n;
    if (v.conferencia_votada) e.conferencias.set(v.conferencia_votada, (e.conferencias.get(v.conferencia_votada) || 0) + n);
    else e.sinConferencia += n;
    if (v.grupo_votado) e.grupos.set(v.grupo_votado, (e.grupos.get(v.grupo_votado) || 0) + n);
  }

  // Mayoría simple, y null cuando hay empate (nadie decide por ti).
  function mayoria(conteo) {
    if (conteo.size === 0) return { ganador: null, empate: false };
    const orden = [...conteo.entries()].sort((a, b) => b[1] - a[1]);
    if (orden.length > 1 && orden[0][1] === orden[1][1]) return { ganador: null, empate: true };
    return { ganador: orden[0][0], empate: false };
  }

  const { rows: confRows } = await pool.query('SELECT id, name FROM conferences');
  const { rows: groupRows } = await pool.query('SELECT id, name FROM groups');
  const nombreConf = new Map(confRows.map((r) => [r.id, r.name]));
  const nombreGrupo = new Map(groupRows.map((r) => [r.id, r.name]));

  const aEscribir = [];
  const conflictos = [];
  const sinDatos = [];
  const respetados = [];

  for (const e of equipos.values()) {
    const conf = mayoria(e.conferencias);
    const grupo = mayoria(e.grupos);

    if (conf.empate || grupo.empate) {
      conflictos.push({ ...e, motivo: 'empate — ninguna conferencia/grupo tiene más partidos que la otra' });
      continue;
    }
    if (!conf.ganador && !grupo.ganador) {
      sinDatos.push(e);
      continue;
    }
    // Ya tiene algo puesto a mano y no se pidió --force: no se pisa.
    if (!FORCE && (e.conferenciaActual || e.grupoActual)) {
      respetados.push(e);
      continue;
    }
    if (e.conferenciaActual === conf.ganador && e.grupoActual === grupo.ganador) continue; // ya está igual

    const discrepancias = e.conferencias.size > 1
      ? [...e.conferencias.entries()].map(([id, n]) => `${nombreConf.get(id) || id}: ${n}`).join(', ')
      : null;

    aEscribir.push({ ...e, conferencia: conf.ganador, grupo: grupo.ganador, discrepancias });
  }

  titulo(APPLY ? 'Se va a escribir esto en branch_teams' : 'SIMULACIÓN — esto es lo que se escribiría (nada se ha tocado)');
  if (aEscribir.length === 0) {
    console.log('  (nada que hacer)');
  } else {
    let rutaActual = null;
    for (const e of aEscribir) {
      if (e.ruta !== rutaActual) { rutaActual = e.ruta; console.log(`\n  ${rutaActual}`); }
      const destino = [
        e.conferencia ? `conferencia "${nombreConf.get(e.conferencia) || e.conferencia}"` : null,
        e.grupo ? `grupo "${nombreGrupo.get(e.grupo) || e.grupo}"` : null,
      ].filter(Boolean).join(' · ');
      console.log(`    ${e.equipo.padEnd(28)} → ${destino}   (${e.total} partidos)`);
      if (e.discrepancias) {
        console.log(`      ⚠ sus partidos no coinciden entre sí → ${e.discrepancias}`);
        console.log('        se toma la mayoría; los partidos minoritarios pasan a mostrar la conferencia ganadora');
      }
      if (e.sinConferencia > 0) {
        console.log(`      · ${e.sinConferencia} de sus partidos no tenían conferencia; van a heredarla ahora`);
      }
    }
  }

  if (respetados.length) {
    titulo('Ya tenían conferencia puesta — no se tocan (usa --force para pisarlos)');
    for (const e of respetados) console.log(`  ${e.equipo}  (${e.ruta})`);
  }

  if (conflictos.length) {
    titulo('NO se deciden solos — revísalos a mano');
    for (const e of conflictos) {
      const detalle = [...e.conferencias.entries()].map(([id, n]) => `${nombreConf.get(id) || id}: ${n}`).join(', ');
      console.log(`  ${e.equipo}  (${e.ruta})  → ${detalle}`);
    }
  }

  if (sinDatos.length) {
    titulo('Sin nada de dónde derivar (no tienen partidos con conferencia)');
    for (const e of sinDatos) console.log(`  ${e.equipo}  (${e.ruta})  — ${e.total} partidos`);
    console.log('\n  Normal en ligas que no se dividen en conferencias, o en un equipo');
    console.log('  invitado. Quedan sin conferencia, que es justo lo correcto.');
  }

  if (!APPLY) {
    titulo('Nada se escribió');
    console.log('  Esto fue una simulación. Para aplicarlo:');
    console.log('    node scripts/backfill-team-conferences.mjs --apply');
    process.exit(0);
  }

  // Escritura, toda dentro de una transacción: o queda completa o no queda nada.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of aEscribir) {
      await client.query(
        'UPDATE branch_teams SET conference_id = $1, group_id = $2 WHERE branch_id = $3 AND team_id = $4',
        [e.conferencia, e.grupo, e.branch_id, e.team_id],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  titulo('Listo');
  console.log(`  ${aEscribir.length} equipos actualizados en branch_teams.`);
  console.log('  Ni un solo partido, predicción ni quiniela fue modificado.');
  console.log('\n  A partir de ahora la conferencia de cada partido se deduce de sus');
  console.log('  equipos. Para cambiarla, se cambia la del equipo en el panel de la');
  console.log('  rama — no partido por partido.');
} finally {
  await pool.end();
}
