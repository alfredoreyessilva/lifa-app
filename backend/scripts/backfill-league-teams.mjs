// Repara, UNA sola vez, las membresías que el relleno roto de initSchema()
// nunca llegó a escribir: equipos con `teams.league_id` puesto y sin su fila
// en `league_teams`.
//
// POR QUÉ EXISTE ESTE SCRIPT Y NO UNA MIGRACIÓN
//
// El relleno vivía en initSchema() y corría en CADA arranque:
//
//     INSERT INTO league_teams (league_id, team_id)
//     SELECT league_id, id FROM teams
//     ON CONFLICT (league_id, team_id) DO NOTHING
//
// Le faltaba `WHERE league_id IS NOT NULL`. En cuanto existió el primer equipo
// independiente reventó contra el NOT NULL de league_teams.league_id, y como
// cada migración corre en su propio SAVEPOINT, falló ENTERA y en silencio —
// sin error en los logs y sin insertar tampoco las filas válidas.
//
// Arreglarlo allá habría sido peor: corriendo en cada arranque, le devolvería
// la membresía, en el siguiente despliegue, a todo equipo que una liga sacara
// de su roster a propósito (DELETE /leagues/:leagueId/roster/:teamId). Por eso
// se quitó del arranque y la reparación es esto, de una sola vez y a mano.
//
// QUÉ ESCRIBE, exactamente:
//   · Filas nuevas en `league_teams`, con (teams.league_id, teams.id). Nada más.
//
// QUÉ NO TOCA, nunca:
//   · `teams`   — ni league_id ni ninguna otra columna. Esto solo COPIA.
//   · Las membresías que ya existen. El ON CONFLICT las deja como están, y a
//     un equipo que la liga sacó del roster DESPUÉS de este arreglo no lo va a
//     resucitar nadie, porque esto no vuelve a correr.
//
// Lo que nazca de aquí en adelante no lo necesita: POST /manage/leagues/
// :leagueId/teams inserta la membresía en el mismo momento desde el 2026-09-21.
//
// OJO CON QUÉ BASE: al 2026-09-22, PRODUCCIÓN NO NECESITA ESTO — se censó y da
// 0 equipos con liga y sin membresía. El hueco está en las ramas de prueba,
// donde las suites e2e crearon decenas de equipos después de que existiera el
// primer independiente. Si algún día esto vuelve a dar filas en producción,
// hay un bug nuevo: significa que apareció una tercera ruta que escribe
// teams.league_id sin escribir league_teams.
//
// Por defecto NO escribe: imprime lo que haría y termina. Para aplicarlo de
// verdad hay que pasar --apply explícitamente.
//
// Uso, desde la carpeta `backend/`:
//   node scripts/backfill-league-teams.mjs            (simulación)
//   node scripts/backfill-league-teams.mjs --apply    (escribe)

import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL (revisa tu .env o pásala en la línea del comando).');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // `true` a propósito, y solo aplica si DATABASE_URL viene sin sslmode:
  // si la trae, la cadena pisa esto. Ver el comentario en config/db.js.
  ssl: { rejectUnauthorized: true },
  max: 1,
});

const titulo = (t) => console.log(`\n${'─'.repeat(74)}\n${t}\n${'─'.repeat(74)}`);

// El criterio es el del relleno viejo, ya con el filtro que le faltaba: un
// equipo con liga cuya membresía CON ESA liga no existe. Se ordena por liga
// para que la simulación se lea por bloques.
const PENDIENTES = `
  SELECT t.id, t.name, t.league_id, l.name AS league_name, l.is_public
  FROM teams t
  JOIN leagues l ON l.id = t.league_id
  WHERE t.league_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM league_teams lt
      WHERE lt.team_id = t.id AND lt.league_id = t.league_id
    )
  ORDER BY l.is_public DESC, l.name ASC, t.name ASC
`;

try {
  const { rows: pendientes } = await pool.query(PENDIENTES);

  // Contexto, porque el número solo no dice si esto es grave: cuántos equipos
  // hay, cuántos son independientes de verdad (sin liga, y esos NO se tocan) y
  // cuántas membresías existen ya.
  const { rows: [censo] } = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM teams)                                AS equipos,
      (SELECT COUNT(*)::int FROM teams WHERE league_id IS NULL)        AS independientes,
      (SELECT COUNT(*)::int FROM league_teams)                         AS membresias
  `);

  titulo('Estado');
  console.log(`  ${censo.equipos} equipos · ${censo.independientes} sin liga (no se tocan) · ${censo.membresias} membresías en league_teams`);

  if (!pendientes.length) {
    console.log('\n  No hay nada que reparar: todo equipo con liga ya tiene su membresía.');
    process.exit(0);
  }

  titulo(`Les falta su fila en league_teams: ${pendientes.length}`);
  let ligaActual = null;
  for (const e of pendientes) {
    if (e.league_name !== ligaActual) {
      ligaActual = e.league_name;
      console.log(`\n  ${ligaActual}${e.is_public ? '  (PÚBLICA)' : ''}`);
    }
    console.log(`    · ${e.name}  (equipo ${e.id})`);
  }

  // Lo que de verdad importa revisar antes de aplicar. Un equipo de una liga
  // pública sin membresía es el que se estaba cayendo de la página pública
  // ahora que las lecturas salen de league_teams; el resto es, casi siempre,
  // basura de las suites e2e.
  const enPublicas = pendientes.filter((e) => e.is_public);
  if (enPublicas.length) {
    titulo('Ojo: de ligas PÚBLICAS');
    console.log(`  ${enPublicas.length} de los ${pendientes.length}. Estos son los que no estaban saliendo`);
    console.log('  en la página de su liga. Vale la pena mirarlos uno por uno antes de aplicar.');
  }

  if (!APPLY) {
    titulo('Nada se escribió');
    console.log('  Esto fue una simulación. Para aplicarlo:');
    console.log('    node scripts/backfill-league-teams.mjs --apply');
    process.exit(0);
  }

  // Una sola sentencia, con el mismo criterio que la simulación: entre leer y
  // escribir pudo nacer un equipo, y el ON CONFLICT cubre que alguien más lo
  // haya dado de alta en el camino.
  const { rowCount } = await pool.query(`
    INSERT INTO league_teams (league_id, team_id)
    SELECT t.league_id, t.id
    FROM teams t
    WHERE t.league_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM league_teams lt
        WHERE lt.team_id = t.id AND lt.league_id = t.league_id
      )
    ON CONFLICT (league_id, team_id) DO NOTHING
  `);

  titulo('Listo');
  console.log(`  ${rowCount} membresías creadas en league_teams.`);
  console.log('  Ni una fila de `teams` fue modificada.');
  console.log('\n  Esto no se vuelve a correr solo: el relleno ya no vive en initSchema().');
  console.log('  Si mañana falta una membresía, es un endpoint que no la escribió.');
} finally {
  await pool.end();
}
