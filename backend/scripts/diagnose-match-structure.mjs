// Diagnóstico: ¿se puede derivar la conferencia/grupo de un partido a partir
// de los equipos que juegan, en vez de capturarla partido por partido?
//
// YA SE HIZO (2026-09-16). Este script es el estudio previo que dijo que se
// podía; se queda porque sigue sirviendo para lo mismo en otra liga: mide si
// sus partidos saben qué equipos juegan y si sus equipos están inscritos, que
// es de lo que depende la derivación. Para PONER la conferencia a los equipos a
// partir de sus partidos, el script es `backfill-team-conferences.mjs`; la
// regla de resolución vive en `src/utils/matchScope.js`.
//
// Contexto. Hoy `matches` guarda `conference_id`, `group_id` y `group_id_2` a
// mano: quien captura el partido elige rama, conferencia y grupo en el
// formulario. Eso es dato DERIVADO capturado como dato primario — el hecho
// estable es "este equipo juega en este grupo", y la pertenencia del partido
// es una consecuencia. Con 133 partidos son ~400 selecciones de dropdown que
// no deberían existir.
//
// La propuesta es registrar la conferencia/grupo en `branch_teams` (la tabla
// que ya dice qué equipos están inscritos en cada rama) y derivar el resto.
//
// PERO eso depende de que cada partido sepa QUÉ equipos juegan, y ahí está la
// duda que este script resuelve: `matches.home_team`/`away_team` son TEXTO, y
// `home_team_id`/`away_team_id` son OPCIONALES. El importador de Excel
// (`routes/manage.js`, endpoint `/import`) inserta solo el texto y NO las
// llaves — así que todo partido cargado por Excel no sabe contra qué fila de
// `teams` corresponde, y para esos la derivación es imposible hasta
// emparejarlos.
//
// Este script mide exactamente eso: cuántos partidos se podrían derivar hoy,
// cuántos necesitan emparejarse primero, y si el emparejamiento por nombre es
// viable o ambiguo.
//
// ES DE SOLO LECTURA: únicamente SELECT, sin migraciones ni escrituras.
// Seguro contra producción.
//
// Uso, desde la carpeta `backend/`:
//   node scripts/diagnose-match-structure.mjs
//   DATABASE_URL="postgresql://…" node scripts/diagnose-match-structure.mjs

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

const titulo = (t) => console.log(`\n${'─'.repeat(72)}\n${t}\n${'─'.repeat(72)}`);
const fila = (etiqueta, valor, nota = '') =>
  console.log(`  ${String(valor).padStart(6)}  ${etiqueta}${nota ? `  — ${nota}` : ''}`);

try {
  // ── 1. Panorama general ────────────────────────────────────────────────
  titulo('1. Partidos en la base');

  const { rows: [tot] } = await pool.query(`
    SELECT
      COUNT(*)                                                       AS total,
      COUNT(*) FILTER (WHERE home_team_id IS NOT NULL
                         AND away_team_id IS NOT NULL)               AS con_ambos_ids,
      COUNT(*) FILTER (WHERE home_team_id IS NULL
                          OR away_team_id IS NULL)                   AS sin_algun_id,
      COUNT(*) FILTER (WHERE branch_id     IS NOT NULL)              AS con_rama,
      COUNT(*) FILTER (WHERE conference_id IS NOT NULL)              AS con_conferencia,
      COUNT(*) FILTER (WHERE group_id      IS NOT NULL)              AS con_grupo,
      COUNT(*) FILTER (WHERE group_id_2    IS NOT NULL)              AS con_segundo_grupo,
      COUNT(*) FILTER (WHERE is_draft)                               AS borradores
    FROM matches
  `);

  fila('partidos en total', tot.total);
  fila('con rama asignada', tot.con_rama);
  fila('con conferencia asignada', tot.con_conferencia);
  fila('con grupo asignado', tot.con_grupo);
  fila('con SEGUNDO grupo (cruces)', tot.con_segundo_grupo, 'ya se modelan hoy');
  fila('borradores', tot.borradores);

  titulo('2. EL BLOQUEADOR: ¿el partido sabe qué equipos juegan?');
  console.log('  La derivación necesita home_team_id/away_team_id. Sin eso solo hay texto.\n');
  fila('con AMBOS ids  (derivables hoy)', tot.con_ambos_ids);
  fila('sin algún id   (hay que emparejar)', tot.sin_algun_id);

  if (Number(tot.sin_algun_id) > 0) {
    console.log('\n  ⚠ Estos vienen del importador de Excel, que guarda solo el nombre.');
    console.log('    Hay que emparejarlos con `teams` ANTES de poder derivar nada.');
  }

  // ── 3. ¿El emparejamiento por nombre es viable? ────────────────────────
  titulo('3. ¿Se pueden emparejar por nombre los que no tienen id?');

  const { rows: nombres } = await pool.query(`
    WITH sin_id AS (
      SELECT m.id,
             c.league_id,
             UPPER(TRIM(m.home_team)) AS nombre,
             'local'                  AS lado
      FROM matches m
      JOIN categories c ON c.id = m.category_id
      WHERE m.home_team_id IS NULL
      UNION ALL
      SELECT m.id, c.league_id, UPPER(TRIM(m.away_team)), 'visitante'
      FROM matches m
      JOIN categories c ON c.id = m.category_id
      WHERE m.away_team_id IS NULL
    )
    SELECT s.nombre,
           s.league_id,
           COUNT(*)                                   AS apariciones,
           COUNT(DISTINCT t.id)                       AS equipos_que_coinciden
    FROM sin_id s
    LEFT JOIN teams t
           ON UPPER(TRIM(t.name)) = s.nombre
          AND (t.league_id = s.league_id OR t.league_id IS NULL)
    GROUP BY s.nombre, s.league_id
    ORDER BY equipos_que_coinciden, apariciones DESC
  `);

  const exactos   = nombres.filter((r) => Number(r.equipos_que_coinciden) === 1);
  const sinMatch  = nombres.filter((r) => Number(r.equipos_que_coinciden) === 0);
  const ambiguos  = nombres.filter((r) => Number(r.equipos_que_coinciden) > 1);
  const suma      = (rs) => rs.reduce((a, r) => a + Number(r.apariciones), 0);

  fila('nombres distintos sin id', nombres.length);
  fila('→ coinciden con 1 equipo', exactos.length,  `${suma(exactos)} apariciones (automatizable)`);
  fila('→ NO coinciden con ninguno', sinMatch.length, `${suma(sinMatch)} apariciones (a mano)`);
  fila('→ coinciden con VARIOS', ambiguos.length,  `${suma(ambiguos)} apariciones (a mano)`);

  if (sinMatch.length) {
    console.log('\n  Nombres sin equipo correspondiente (los primeros 25):');
    for (const r of sinMatch.slice(0, 25)) {
      console.log(`    · "${r.nombre}"  (${r.apariciones} ${r.apariciones === '1' ? 'aparición' : 'apariciones'})`);
    }
    if (sinMatch.length > 25) console.log(`    … y ${sinMatch.length - 25} más`);
  }

  if (ambiguos.length) {
    console.log('\n  Nombres ambiguos (coinciden con más de un equipo):');
    for (const r of ambiguos.slice(0, 15)) {
      console.log(`    · "${r.nombre}"  → ${r.equipos_que_coinciden} equipos`);
    }
  }

  // ── 4. La estructura: ramas, conferencias, grupos y equipos inscritos ──
  titulo('4. Estructura actual, y equipos inscritos por rama');

  const { rows: estructura } = await pool.query(`
    SELECT l.name  AS liga,
           cat.name AS categoria,
           b.name   AS rama,
           b.id     AS branch_id,
           (SELECT COUNT(*) FROM conferences cf WHERE cf.branch_id = b.id)  AS conferencias,
           (SELECT COUNT(*) FROM groups g       WHERE g.branch_id  = b.id)  AS grupos,
           (SELECT COUNT(*) FROM branch_teams bt WHERE bt.branch_id = b.id) AS equipos_inscritos,
           (SELECT COUNT(*) FROM matches m      WHERE m.branch_id  = b.id)  AS partidos
    FROM branches b
    JOIN categories cat ON cat.id = b.category_id
    JOIN leagues    l   ON l.id   = cat.league_id
    ORDER BY l.name, cat.sort_order, b.sort_order
  `);

  if (!estructura.length) {
    console.log('  (no hay ramas registradas)');
  } else {
    console.log('  conf/grupos/inscritos/partidos');
    for (const r of estructura) {
      console.log(
        `    ${String(r.conferencias).padStart(2)} ${String(r.grupos).padStart(3)} ` +
        `${String(r.equipos_inscritos).padStart(4)} ${String(r.partidos).padStart(5)}   ` +
        `${r.liga} › ${r.categoria} › ${r.rama}`
      );
    }
    console.log('\n  Ojo en las ramas con partidos pero 0 equipos inscritos: ahí');
    console.log('  `branch_teams` está vacío y no hay de dónde derivar nada todavía.');
  }

  // ── 5. Qué pasaría si se derivara hoy ─────────────────────────────────
  titulo('5. Simulación: derivar de los equipos, en los partidos que SÍ tienen id');

  const { rows: [sim] } = await pool.query(`
    SELECT
      COUNT(*)                                                        AS evaluados,
      COUNT(*) FILTER (WHERE bh.id IS NULL OR ba.id IS NULL)          AS algun_equipo_no_inscrito,
      COUNT(*) FILTER (WHERE bh.id IS NOT NULL AND ba.id IS NOT NULL) AS ambos_inscritos
    FROM matches m
    LEFT JOIN branch_teams bh ON bh.branch_id = m.branch_id AND bh.team_id = m.home_team_id
    LEFT JOIN branch_teams ba ON ba.branch_id = m.branch_id AND ba.team_id = m.away_team_id
    WHERE m.home_team_id IS NOT NULL
      AND m.away_team_id IS NOT NULL
      AND m.branch_id    IS NOT NULL
  `);

  fila('partidos evaluables', sim.evaluados, 'con ambos ids y rama');
  fila('ambos equipos inscritos en la rama', sim.ambos_inscritos);
  fila('algún equipo NO inscrito', sim.algun_equipo_no_inscrito, 'habría que inscribirlo');

  titulo('Resumen');
  const total = Number(tot.total);
  const derivablesYa = Number(sim.ambos_inscritos || 0);
  console.log(`  De ${total} partidos, hoy se podrían derivar ${derivablesYa} sin tocar nada más.`);
  console.log(`  Faltarían ${total - derivablesYa}, que necesitan primero uno de estos dos pasos:`);
  console.log('    a) emparejar el nombre de texto con su fila de `teams` (ver punto 3), y/o');
  console.log('    b) inscribir el equipo en la rama (`branch_teams`, ver punto 4).');
  console.log('\n  Ninguno de los dos se hizo aquí: esto solo leyó.');
} finally {
  await pool.end();
}
