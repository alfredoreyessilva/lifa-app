// Estadísticas por jugada: la bitácora, el lote que sube lo capturado sin
// señal y el box score que se deriva de ahí. El porqué de cada decisión está
// en el README, "Estadísticas por jugada".
//
// La REGLA no vive aquí: vive en `utils/plays.js`, que es puro y sí lo alcanza
// el CI. Aquí vive el SQL, que es lo que este proyecto pone en `routes/`.
//
// Es la tercera pantalla que cuelga del partido, junto con el roster público y
// el pase de lista, y por la misma razón: una jugada es de un partido, y un
// roster suelto sin partido en contexto no tiene a qué capturarle nada.

import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { matchStatsRequired } from '../middleware/ownership.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { rosterDelPartidoSql } from '../utils/attendance.js';
import {
  esNivelValido,
  normalizarLoteDeJugadas,
  normalizarJugada,
  derivarDownsDelPartido,
  boxScoreDerivado,
  boxScoreDeTotales,
  fuenteDelBoxScore,
  EQUIVALENCIAS_SPORTSML,
} from '../utils/plays.js';

const router = express.Router();

// Las dos cosas que tienen que estar antes de poder capturar, dichas con una
// frase que explica qué hacer en vez de una lista vacía que se lea como "este
// partido no tuvo jugadas". Es el mismo par que el pase de lista, porque los
// dos cuelgan del partido y necesitan saber de quién es cada balón.
function faltaParaCapturar(match) {
  if (!match.branch_id) {
    return 'Este partido no está dentro de una rama, así que todavía no tiene roster. Muévelo a una rama desde el panel de la liga.';
  }
  if (!match.home_team_id || !match.away_team_id) {
    return 'Este partido todavía no está conectado con sus dos equipos. Sincronízalo primero desde el panel de la liga.';
  }
  return null;
}

// ── Leer las jugadas ──────────────────────────────────────────────────────

async function sesionesDe(matchId) {
  return db.prepare(`
    SELECT s.id, s.capture_level, s.claimed_by_user_id, s.claimed_at, s.released_at,
           s.is_authoritative, u.name AS claimed_by,
           (SELECT COUNT(*)::int FROM match_plays p WHERE p.session_id = s.id) AS plays
      FROM match_capture_sessions s
      LEFT JOIN users u ON u.id = s.claimed_by_user_id
     WHERE s.match_id = ?
     ORDER BY s.is_authoritative DESC, s.claimed_at
  `).all(matchId);
}

// Las jugadas de una sesión, con sus participantes y con el down ya derivado.
//
// **El orden sale de `sequence` dentro de la serie, nunca de `created_at`.** El
// de una jugada capturada sin señal es el momento en que se SUBIÓ: un partido
// entero puede llegar con el mismo segundo. Ordenar por fecha es lo primero
// que alguien va a intentar, se ve razonable en un partido capturado en vivo y
// sale revuelto justo en el que se capturó sin señal — sin que nada falle a la
// vista, que es lo que lo vuelve peligroso.
async function jugadasDe(sessionId) {
  if (!sessionId) return [];

  const jugadas = await db.prepare(`
    SELECT p.id, p.client_play_id, p.sequence, p.drive_number, p.period, p.clock,
           p.offense_team_id, p.down, p.distance, p.yard_line, p.play_type,
           p.yards_gained, p.points, p.scoring_team_id, p.notes, p.created_at
      FROM match_plays p
     WHERE p.session_id = ?
     ORDER BY p.drive_number, p.sequence
  `).all(sessionId);

  if (jugadas.length === 0) return [];

  // Los participantes de todas las jugadas de un jalón. Traer el nombre y el
  // número aquí evita que la pantalla tenga que cruzarlos contra el roster
  // —que pudo cambiar— para poder pintar una bitácora vieja.
  const participantes = await db.prepare(`
    SELECT pp.play_id, pp.player_id, pp.role, pp.yards,
           pl.first_name, pl.last_name
      FROM play_participants pp
      JOIN players pl ON pl.id = pp.player_id
     WHERE pp.play_id = ANY(?::int[])
  `).all(jugadas.map((j) => j.id));

  const porJugada = new Map();
  for (const p of participantes) {
    if (!porJugada.has(p.play_id)) porJugada.set(p.play_id, []);
    porJugada.get(p.play_id).push({
      player_id: p.player_id, role: p.role, yards: p.yards,
      name: `${p.first_name} ${p.last_name}`,
    });
  }

  const conParticipantes = jugadas.map((j) => ({ ...j, participants: porJugada.get(j.id) || [] }));

  // El down se deriva al leer y se entrega junto a la jugada. Lo que se guardó
  // —cuando alguien corrigió— manda sobre lo derivado, y la pantalla los pinta
  // distinto: el visor no captura el down, lo desmiente cuando se desvía.
  const derivados = derivarDownsDelPartido(conParticipantes);
  return conParticipantes.map((j) => {
    const d = derivados.get(j.client_play_id);
    return {
      ...j,
      down_derivado: d?.down ?? null,
      distance_derivada: d?.distance ?? null,
      yard_line_derivada: d?.yard_line ?? null,
      es_derivado: d?.derivado ?? false,
      cadena_rota: d?.cadena_rota ?? false,
    };
  });
}

// ── El box score, en público ──────────────────────────────────────────────
//
// Sin sesión y sin guarda: es el resultado deportivo, que es justo lo que un
// torneo publica. Lo que no sale nunca es el dato personal detrás del jugador,
// y aquí no sale — nombre, número y nada más, igual que el roster público
// (regla 7).
//
// **La cascada.** Un partido tiene UN box score, no dos, y la pregunta se
// contesta al leer (regla 4): si hay una sesión buena con nivel que derive, se
// deriva de sus jugadas; si no, se leen los totales tecleados a mano. Nunca se
// mezclan, nunca se suman entre sí, y nadie copia lo derivado dentro de la otra
// tabla.
router.get('/matches/:matchId/box-score', asyncHandler(async (req, res) => {
  const matchId = Number(req.params.matchId);
  const match = await db.prepare(`
    SELECT m.id, m.match_date, m.week_label, m.branch_id, m.status,
           m.home_team_id, m.away_team_id, m.home_score, m.away_score,
           ht.name AS home_team, at.name AS away_team
      FROM matches m
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
     WHERE m.id = ?
  `).get(matchId);
  if (!match) return res.status(404).json({ error: 'Partido no encontrado' });

  const sesiones = await sesionesDe(matchId);
  const fuente = fuenteDelBoxScore(sesiones);

  let players = [];
  let puntosPorJugadas = null;

  if (fuente.source === 'plays') {
    const jugadas = await jugadasDe(fuente.session_id);
    const derivado = boxScoreDerivado(jugadas);
    players = derivado.players;
    puntosPorJugadas = derivado.points_by_team;
  } else {
    const columnas = Object.keys(EQUIVALENCIAS_SPORTSML).join(', ');
    const filas = await db.prepare(
      `SELECT player_id, team_id, ${columnas} FROM player_match_stats WHERE match_id = ?`,
    ).all(matchId);
    players = boxScoreDeTotales(filas);
    // El equipo viene de la tabla y no del roster: es el que se capturó.
    const equipoDe = new Map(filas.map((f) => [f.player_id, f.team_id]));
    for (const p of players) p.team_id = equipoDe.get(p.player_id) ?? null;
  }

  // Quién es cada quién. Se piden los nombres UNA vez, ya que se sabe quiénes
  // salieron, en vez de traer los dos rosters completos: en un partido
  // capturado en `full` participan treinta personas, no cien.
  if (players.length) {
    const quienes = await db.prepare(`
      SELECT p.id, p.first_name, p.last_name,
             (SELECT ptm.jersey_number FROM player_team_memberships ptm
               WHERE ptm.player_id = p.id AND ptm.branch_id = ?
               ORDER BY (ptm.end_date IS NULL) DESC, ptm.start_date DESC LIMIT 1) AS jersey_number,
             (SELECT ptm.team_id FROM player_team_memberships ptm
               WHERE ptm.player_id = p.id AND ptm.branch_id = ?
               ORDER BY (ptm.end_date IS NULL) DESC, ptm.start_date DESC LIMIT 1) AS team_id
        FROM players p WHERE p.id = ANY(?::int[])
    `).all(match.branch_id, match.branch_id, players.map((p) => p.player_id));

    const porId = new Map(quienes.map((q) => [q.id, q]));
    for (const p of players) {
      const quien = porId.get(p.player_id);
      p.name = quien ? `${quien.first_name} ${quien.last_name}` : null;
      p.jersey_number = quien?.jersey_number ?? null;
      p.team_id = p.team_id ?? quien?.team_id ?? null;
    }
  }

  res.json({
    match: {
      id: match.id, match_date: match.match_date, week_label: match.week_label,
      status: match.status,
      home_team: match.home_team, away_team: match.away_team,
      home_team_id: match.home_team_id, away_team_id: match.away_team_id,
      home_score: match.home_score, away_score: match.away_score,
    },
    // De dónde salió este box score y con qué nivel se capturó. Viaja SIEMPRE,
    // porque de eso depende cómo se lee: un partido en `scoring` tiene jugadas
    // y aun así su box score viene de los totales, y la pantalla tiene que
    // poder explicarlo en vez de dejar al lector suponiendo.
    ...fuente,
    players,
    // La segunda lectura del marcador. NO lo reemplaza: `matches.home_score` se
    // sigue capturando a mano con el permiso `marcadores`, que ya funciona.
    // Esto es con qué contrastarlo para avisar "esto no cuadra" — cambiar de
    // dónde sale el marcador publicado es otro cambio, con su propia ventana de
    // riesgo, y no tiene por qué viajar con este.
    points_by_team: puntosPorJugadas,
  });
}));

// ── El panel de captura ───────────────────────────────────────────────────
//
// Todo lo que el visor necesita para capturar, en una sola respuesta: es lo que
// baja "Preparar partido" y lo que se guarda en IndexedDB. Una descarga
// explícita y previa se puede verificar ANTES de salir; un cache oportunista
// falla exactamente cuando importa.
router.get('/matches/:matchId/capture', authRequired, matchStatsRequired, asyncHandler(async (req, res) => {
  const match = req.match;
  const falta = faltaParaCapturar(match);
  if (falta) return res.status(400).json({ error: falta });

  const sesiones = await sesionesDe(match.id);
  const fuente = fuenteDelBoxScore(sesiones);

  // Los dos rosters vigentes a la fecha del partido. Es la MISMA consulta del
  // pase de lista y del roster público, sin foto y sin asistencia: quien
  // aparece en la lista para marcarle presente es exactamente quien puede
  // aparecer en una jugada, y dos consultas parecidas acabarían enseñando dos
  // listas distintas el día que una se toque y la otra no.
  const equipos = [];
  for (const teamId of [match.home_team_id, match.away_team_id]) {
    const team = await db.prepare('SELECT id, name, logo_url FROM teams WHERE id = ?').get(teamId);
    if (!team) continue;
    equipos.push({
      team_id: team.id,
      name: team.name,
      logo_url: team.logo_url,
      side: match.home_team_id === team.id ? 'home' : 'away',
      roster: await db.prepare(rosterDelPartidoSql()).all(match.id, teamId, match.branch_id),
    });
  }

  // Las jugadas de CADA sesión, no solo de la buena: el panel enseña las dos
  // para que una persona elija cuál es la correcta, que es lo único que hace
  // `is_authoritative`. Nunca se descarta lo capturado.
  const porSesion = {};
  for (const sesion of sesiones) porSesion[sesion.id] = await jugadasDe(sesion.id);

  res.json({
    match: {
      id: match.id, match_date: match.match_date, week_label: match.week_label,
      branch_id: match.branch_id, status: match.status,
      home_team_id: match.home_team_id, away_team_id: match.away_team_id,
      home_score: match.home_score, away_score: match.away_score,
      category_name: req.category?.name || null,
      league_id: req.league.id,
    },
    teams: equipos,
    sessions: sesiones,
    plays_by_session: porSesion,
    ...fuente,
  });
}));

// ── Reclamar el partido ───────────────────────────────────────────────────
//
// Un partido, un capturista a la vez. Sin esto, dos visores capturando el
// mismo partido producen dos medias listas que **nadie puede volver a unir**:
// no hay forma automática de saber si dos jugadas parecidas son la misma
// capturada dos veces o dos jugadas distintas.
//
// Se reclama CON SEÑAL, en el mismo momento de preparar el partido, porque
// reclamar es justamente lo que no se puede hacer desde la cancha. Y la
// contraparte importa más: quien haya capturado sin reclamar sube igual, en su
// propia sesión (ver el `POST` del lote).
router.post('/matches/:matchId/sessions', authRequired, matchStatsRequired, asyncHandler(async (req, res) => {
  const match = req.match;
  const falta = faltaParaCapturar(match);
  if (falta) return res.status(400).json({ error: falta });

  const nivel = req.body.capture_level;
  if (!esNivelValido(nivel)) {
    return res.status(400).json({ error: 'Hay que decir qué se va a capturar: scoring, offense o full' });
  }

  const sesiones = await sesionesDe(match.id);
  const abierta = sesiones.find((s) => !s.released_at);

  // Ya hay alguien capturando y no soy yo: se pide que lo diga explícitamente.
  // Tomar el control es un acto, no un efecto secundario de abrir la pantalla.
  if (abierta && abierta.claimed_by_user_id !== req.user.id && req.body.take_over !== true) {
    return res.status(409).json({
      error: `${abierta.claimed_by || 'Alguien'} está capturando este partido desde las ${new Date(abierta.claimed_at).toLocaleTimeString('es-MX')}`,
      session: abierta,
      // El 409 no es un no: es un "confirma". La pantalla pregunta y reenvía
      // con `take_over`.
      puede_tomar_control: true,
    });
  }

  // Volver a entrar con el mismo nivel no abre otra sesión: es el visor que
  // recargó la página, no un capturista nuevo.
  if (abierta && abierta.claimed_by_user_id === req.user.id && abierta.capture_level === nivel) {
    return res.json({ session: abierta, reanudada: true });
  }

  // Tomar el control cierra la sesión anterior pero NO la borra ni le quita sus
  // jugadas: queda registrada con quién la tenía y hasta cuándo. Lo capturado
  // no se descarta nunca.
  const sesion = await db.prepare(`
    WITH cerrada AS (
      UPDATE match_capture_sessions SET released_at = CURRENT_TIMESTAMP
       WHERE match_id = ? AND released_at IS NULL
      RETURNING id
    )
    INSERT INTO match_capture_sessions (match_id, capture_level, claimed_by_user_id, is_authoritative)
    VALUES (?, ?, ?, TRUE)
    RETURNING id, capture_level, claimed_by_user_id, claimed_at, released_at, is_authoritative
  `).get(match.id, match.id, nivel, req.user.id);

  // La nueva es la buena y las demás dejan de serlo: hay UN ganador por
  // partido. Se puede cambiar después desde el panel, que es para lo que existe
  // el endpoint de abajo.
  await db.prepare(
    'UPDATE match_capture_sessions SET is_authoritative = FALSE WHERE match_id = ? AND id <> ?',
  ).run(match.id, sesion.id);

  res.status(201).json({ session: sesion, tomado: Boolean(abierta) });
}));

// Cuál de dos capturas es la buena lo decide **una persona**, no la
// plataforma: no hay forma automática de saber cuál de dos bitácoras del mismo
// partido es la correcta, y adivinar sería inventar un resultado deportivo
// (regla 10). Lo único que hace `is_authoritative` es registrar esa decisión.
router.put('/matches/:matchId/sessions/:sessionId/authoritative', authRequired, matchStatsRequired, asyncHandler(async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const sesion = await db.prepare(
    'SELECT id FROM match_capture_sessions WHERE id = ? AND match_id = ?',
  ).get(sessionId, req.match.id);
  if (!sesion) return res.status(404).json({ error: 'Esa sesión de captura no es de este partido' });

  // Una sola sentencia: dejar a las otras en falso y a esta en verdadero en dos
  // viajes puede quedarse a medias y dejar el partido con dos buenas o con
  // ninguna. Los dos CTE tocan la misma tabla y nunca la misma fila.
  await db.prepare(`
    WITH otras AS (
      UPDATE match_capture_sessions SET is_authoritative = FALSE
       WHERE match_id = ? AND id <> ?
      RETURNING 1
    )
    UPDATE match_capture_sessions SET is_authoritative = TRUE WHERE id = ?
  `).run(req.match.id, sessionId, sessionId);

  res.json({ sessions: await sesionesDe(req.match.id) });
}));

// ── El lote ───────────────────────────────────────────────────────────────
//
// Sube lo capturado sin señal. Es idempotente por `client_play_id`, que nace en
// el celular: **subir el mismo lote dos veces es gratis**, que es justo lo que
// pasa cuando el internet del campo va y viene. Es el mismo patrón que
// `auto_cycle_key` en la mensualidad del club.
//
// `ON CONFLICT DO NOTHING` y no `DO UPDATE`, y la diferencia importa: una
// jugada ya subida que la liga corrigió después —revisó el video y el touchdown
// era del otro— no puede volver a quedar como estaba porque el teléfono del
// visor recuperó la señal tres horas tarde. Reenviar es gratis; reenviar y
// pisar no lo es. Corregir tiene su propio endpoint, abajo.
router.post('/matches/:matchId/plays', authRequired, matchStatsRequired, asyncHandler(async (req, res) => {
  const match = req.match;
  const falta = faltaParaCapturar(match);
  if (falta) return res.status(400).json({ error: falta });

  const lote = normalizarLoteDeJugadas(req.body.plays);
  if (lote.error) return res.status(400).json({ error: lote.error });

  const equipos = [match.home_team_id, match.away_team_id];
  for (const jugada of lote.plays) {
    if (!equipos.includes(jugada.offense_team_id)) {
      return res.status(400).json({ error: 'Una de las jugadas dice que el balón era de un equipo que no juega este partido' });
    }
    if (jugada.scoring_team_id && !equipos.includes(jugada.scoring_team_id)) {
      return res.status(400).json({ error: 'Una de las jugadas dice que anotó un equipo que no juega este partido' });
    }
  }

  // A qué sesión van. Lo normal es que el cliente traiga la suya, reclamada con
  // señal antes de salir. Si no la trae —o si la que trae ya no existe— se le
  // abre una propia en vez de rechazar el lote: **nunca se descarta lo
  // capturado**. Quien capturó sin haber reclamado el partido sube igual, en su
  // propia sesión, y el panel muestra las dos para que una persona elija.
  let sessionId = Number(req.body.session_id) || null;
  if (sessionId) {
    const suya = await db.prepare(
      'SELECT id FROM match_capture_sessions WHERE id = ? AND match_id = ?',
    ).get(sessionId, match.id);
    if (!suya) sessionId = null;
  }

  let sesionNueva = false;
  if (!sessionId) {
    const nivel = esNivelValido(req.body.capture_level) ? req.body.capture_level : 'offense';
    // Si ya hay una buena, esta nace como no-buena: llegó sin reclamar y no
    // puede desbancar a la que sí reclamó. Que se quede con lo capturado y que
    // una persona decida es exactamente lo que se quiere.
    const hayBuena = (await sesionesDe(match.id)).some((s) => s.is_authoritative);
    const creada = await db.prepare(`
      INSERT INTO match_capture_sessions (match_id, capture_level, claimed_by_user_id, is_authoritative)
      VALUES (?, ?, ?, ?) RETURNING id
    `).get(match.id, nivel, req.user.id, !hayBuena);
    sessionId = creada.id;
    sesionNueva = true;
  }

  // Una sola sentencia, por la regla de que una transacción no se reparte entre
  // varias llamadas: `db.prepare` toma una conexión del pool por consulta y del
  // otro lado hay un pooler en modo transacción. Guardar las jugadas y luego
  // sus participantes en dos viajes dejaría jugadas sin nadie si el segundo
  // falla — y una jugada sin participantes no dice nada.
  //
  // Los participantes se cuelgan de lo que el INSERT DEVOLVIÓ, así que una
  // jugada que ya estaba (el reenvío) no vuelve a insertar a los suyos.
  //
  // El `WHERE EXISTS` sobre `players` es lo mismo que hace el `PUT` del pase de
  // lista: un jugador borrado entre la captura y el envío se ignora en silencio
  // en vez de reventar el lote entero con un error de llave foránea. Se reporta
  // cuántos se ignoraron para que la pantalla pueda decirlo.
  const filas = lote.plays;
  const pp = filas.flatMap((j) => j.participants.map((p) => ({ ...p, client_play_id: j.client_play_id })));

  const resultado = await db.prepare(`
    WITH entrada AS (
      SELECT * FROM UNNEST(
        ?::text[], ?::int[], ?::int[], ?::text[], ?::text[], ?::int[],
        ?::int[], ?::int[], ?::int[], ?::text[], ?::int[], ?::int[], ?::int[], ?::text[]
      ) AS e(client_play_id, sequence, drive_number, period, clock, offense_team_id,
             down, distance, yard_line, play_type, yards_gained, points, scoring_team_id, notes)
    ),
    insertadas AS (
      INSERT INTO match_plays (
        match_id, session_id, client_play_id, sequence, drive_number, period, clock,
        offense_team_id, down, distance, yard_line, play_type, yards_gained, points,
        scoring_team_id, notes, created_by_user_id
      )
      SELECT ?, ?, e.client_play_id, e.sequence, e.drive_number, e.period, e.clock,
             e.offense_team_id, e.down, e.distance, e.yard_line, e.play_type, e.yards_gained,
             e.points, e.scoring_team_id, e.notes, ?
        FROM entrada e
      ON CONFLICT (match_id, client_play_id) DO NOTHING
      RETURNING id, client_play_id
    ),
    gente AS (
      SELECT * FROM UNNEST(?::text[], ?::int[], ?::text[], ?::int[])
        AS g(client_play_id, player_id, role, yards)
    ),
    guardados AS (
      INSERT INTO play_participants (play_id, player_id, role, yards)
      SELECT i.id, g.player_id, g.role, g.yards
        FROM gente g
        JOIN insertadas i ON i.client_play_id = g.client_play_id
       WHERE EXISTS (SELECT 1 FROM players pl WHERE pl.id = g.player_id)
      ON CONFLICT (play_id, player_id, role) DO NOTHING
      RETURNING 1
    )
    SELECT (SELECT COUNT(*)::int FROM insertadas) AS jugadas,
           (SELECT COUNT(*)::int FROM guardados)  AS participantes
  `).get(
    filas.map((j) => j.client_play_id), filas.map((j) => j.sequence), filas.map((j) => j.drive_number),
    filas.map((j) => j.period), filas.map((j) => j.clock), filas.map((j) => j.offense_team_id),
    filas.map((j) => j.down), filas.map((j) => j.distance), filas.map((j) => j.yard_line),
    filas.map((j) => j.play_type), filas.map((j) => j.yards_gained), filas.map((j) => j.points),
    filas.map((j) => j.scoring_team_id), filas.map((j) => j.notes),
    match.id, sessionId, req.user.id,
    pp.map((p) => p.client_play_id), pp.map((p) => p.player_id), pp.map((p) => p.role), pp.map((p) => p.yards),
  );

  res.status(201).json({
    session_id: sessionId,
    sesion_nueva: sesionNueva,
    guardadas: resultado.jugadas,
    // Las que ya estaban. No es un error: es el reenvío haciendo su trabajo, y
    // la pantalla lo dice así para que nadie crea que perdió algo.
    repetidas: filas.length - resultado.jugadas,
    participantes: resultado.participantes,
  });
}));

// ── Corregir ──────────────────────────────────────────────────────────────
//
// La liga revisa el video y el touchdown era del otro. Se corrige **la
// jugada**, no el total: el box score derivado se recalcula solo, porque no se
// guarda en ningún lado (regla 4).
//
// Se reemplaza la jugada entera —incluidos sus participantes— y no un campo
// suelto, por la misma razón que el pase de lista recibe la lista completa: un
// parche por campo obliga a saber qué había antes, y aquí lo que se sabe es
// cómo quedó.
router.put('/matches/:matchId/plays/:clientPlayId', authRequired, matchStatsRequired, asyncHandler(async (req, res) => {
  const match = req.match;
  const clientPlayId = String(req.params.clientPlayId);

  const existente = await db.prepare(
    'SELECT id, session_id FROM match_plays WHERE match_id = ? AND client_play_id = ?',
  ).get(match.id, clientPlayId);
  if (!existente) return res.status(404).json({ error: 'Esa jugada no existe en este partido' });

  const jugada = normalizarJugada({ ...req.body, client_play_id: clientPlayId });
  if (jugada.error) return res.status(400).json({ error: jugada.error });

  const equipos = [match.home_team_id, match.away_team_id];
  if (!equipos.includes(jugada.offense_team_id)) {
    return res.status(400).json({ error: 'Ese equipo no juega este partido' });
  }

  // Una sola sentencia, y **los dos CTE que escriben en `play_participants`
  // nunca tocan la misma fila**: el DELETE se queda con quien ya no viene, el
  // INSERT con quien sí. Es exactamente el patrón del `PUT` del pase de lista,
  // y aquí no es elegancia — es lo único que funciona.
  //
  // Borrar TODOS los participantes y volver a insertarlos en la misma
  // sentencia deja la jugada vacía, y cuesta trabajo verlo: los CTE comparten
  // el mismo snapshot, así que el INSERT ve las filas viejas TODAVÍA
  // PRESENTES, su `ON CONFLICT` no inserta nada, y después el DELETE se las
  // lleva. No falla, no avisa: la jugada se queda sin nadie. Salió corriendo
  // la suite de punta a punta, no leyendo el código.
  await db.prepare(`
    WITH gente AS (
      SELECT * FROM UNNEST(?::int[], ?::text[], ?::int[]) AS g(player_id, role, yards)
       WHERE EXISTS (SELECT 1 FROM players pl WHERE pl.id = g.player_id)
    ),
    actualizada AS (
      UPDATE match_plays SET
        sequence = ?, drive_number = ?, period = ?, clock = ?, offense_team_id = ?,
        down = ?, distance = ?, yard_line = ?, play_type = ?, yards_gained = ?,
        points = ?, scoring_team_id = ?, notes = ?
       WHERE id = ?
      RETURNING id
    ),
    borrados AS (
      DELETE FROM play_participants
       WHERE play_id = ?
         AND (player_id, role) NOT IN (SELECT player_id, role FROM gente)
      RETURNING 1
    )
    INSERT INTO play_participants (play_id, player_id, role, yards)
    SELECT ?, g.player_id, g.role, g.yards FROM gente g
    ON CONFLICT (play_id, player_id, role) DO UPDATE SET yards = EXCLUDED.yards
  `).run(
    jugada.participants.map((p) => p.player_id),
    jugada.participants.map((p) => p.role),
    jugada.participants.map((p) => p.yards),
    jugada.sequence, jugada.drive_number, jugada.period, jugada.clock, jugada.offense_team_id,
    jugada.down, jugada.distance, jugada.yard_line, jugada.play_type, jugada.yards_gained,
    jugada.points, jugada.scoring_team_id, jugada.notes,
    existente.id,
    existente.id,
    existente.id,
  );

  res.json({ plays: await jugadasDe(existente.session_id) });
}));

// Borrar una jugada que no existió —el visor la capturó dos veces, o se le fue
// el dedo. Es un registro de actividad y no un libro de dinero: aquí no hay
// maquinaria de regla 5 (`void` más asiento que revierte), porque no hay saldo
// que cuadrar ni un tercero que reclame. Los participantes se van con ella por
// el ON DELETE CASCADE.
router.delete('/matches/:matchId/plays/:clientPlayId', authRequired, matchStatsRequired, asyncHandler(async (req, res) => {
  const borrada = await db.prepare(
    'DELETE FROM match_plays WHERE match_id = ? AND client_play_id = ? RETURNING id, session_id',
  ).get(req.match.id, String(req.params.clientPlayId));
  if (!borrada) return res.status(404).json({ error: 'Esa jugada no existe en este partido' });

  res.json({ plays: await jugadasDe(borrada.session_id) });
}));

export default router;
