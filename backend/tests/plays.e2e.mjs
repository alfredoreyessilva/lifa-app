// Recorrido de las ESTADÍSTICAS POR JUGADA contra un backend vivo — README,
// "Estadísticas por jugada".
//
// Por qué existe y no bastaban las pruebas unitarias: lo que aquí se prueba es
// justo lo que no se puede leer en el código ni inventar con datos de mentira.
//
//   · Que **reenviar el mismo lote sea gratis**. Es la promesa entera del modo
//     sin señal, vive en un `ON CONFLICT` de Postgres y una prueba unitaria no
//     la puede tocar.
//   · Que la **cascada** entregue un solo box score, y que un partido
//     capturado en `scoring` NO derive — el "número falso con cara de
//     verdadero".
//   · Que **dos capturistas no se pisen**, y que tomar el control no borre lo
//     que el primero capturó.
//   · Que las reglas de la NCAA sobrevivan el viaje completo por la base, no
//     solo dentro de la función pura.
//
// Se crea sus propios datos y se puede correr varias veces. Instrucciones en
// tests/README.md (backend en :4100 con la DATABASE_URL de una rama de Neon).
import pg from 'pg';

const API = 'http://localhost:4100/api';
const stamp = Date.now();
let pass = 0, fail = 0;
const ok = (c, l, e = '') => { if (c) { console.log(`  OK    ${l}`); pass++; } else { console.log(`  FALLA ${l} ${e}`); fail++; } };

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 429) {
    console.log('\n  !! ' + path + ' recibió 429: limitador de peticiones. Reinicia el backend y repite.\n');
    process.exit(2);
  }
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const alta = async (quien) => (await call('/auth/register', {
  method: 'POST',
  body: { name: quien, email: `${quien.toLowerCase()}${stamp}@example.com`, password: 'prueba123' },
})).data.token;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });

// ── Montaje ───────────────────────────────────────────────────────────────

console.log('\n=== 0. Un partido con sus dos rosters ===');
const LIGA = await alta('LigaStats');
const VISOR = await alta('VisorStats');
const OTRO = await alta('OtroVisor');
const AJENO = await alta('AjenoStats');

const lg = await call('/leagues', { method: 'POST', token: LIGA, body: { name: `Liga Stats ${stamp}`, state: 'CIUDAD DE MEXICO' } });
const LEAGUE = lg.data.league?.id ?? lg.data.id;

const ct = await call(`/leagues/${LEAGUE}/categories`, { method: 'POST', token: LIGA, body: { name: `Mayor ${stamp}`, season: 'Apertura', year: 2026 } });
const CAT = ct.data.category?.id ?? ct.data.id;

const br = await call(`/manage/categories/${CAT}/branches`, { method: 'POST', token: LIGA, body: { name: 'Varonil' } });
const BRANCH = br.data.branch?.id ?? br.data.id;
ok(!!LEAGUE && !!CAT && !!BRANCH, 'liga, categoría y rama creadas', JSON.stringify(br.data).slice(0, 140));

// Un equipo se crea en la LIGA y después se inscribe en la rama: son dos
// pasos distintos en este modelo, y el segundo es el que lo pone en el
// torneo. Los nombres se guardan en mayúsculas, y así hay que nombrarlos
// después para que el partido los resuelva.
const NOMBRE_A = `PUMAS ${stamp}`;
const NOMBRE_B = `AGUILAS ${stamp}`;
const tA = await call(`/manage/leagues/${LEAGUE}/teams`, { method: 'POST', token: LIGA, body: { name: NOMBRE_A } });
const tB = await call(`/manage/leagues/${LEAGUE}/teams`, { method: 'POST', token: LIGA, body: { name: NOMBRE_B } });
const TEAM_A = tA.data.team?.id ?? tA.data.id;
const TEAM_B = tB.data.team?.id ?? tB.data.id;
for (const id of [TEAM_A, TEAM_B]) {
  await call(`/manage/branches/${BRANCH}/teams`, { method: 'POST', token: LIGA, body: { team_id: id } });
}
ok(!!TEAM_A && !!TEAM_B, 'los dos equipos existen e inscritos en la rama', JSON.stringify(tA.data).slice(0, 140));

const mt = await call(`/manage/categories/${CAT}/matches`, {
  method: 'POST', token: LIGA,
  body: {
    home_team: NOMBRE_A, away_team: NOMBRE_B,
    match_date_local: '2026-10-04T12:00', branch_id: BRANCH, status: 'finished',
    home_score: 21, away_score: 14,
  },
});
const MATCH = mt.data.match?.id ?? mt.data.id;
ok(!!MATCH, 'partido creado y ligado a sus dos equipos', JSON.stringify(mt.data).slice(0, 160));

// El roster: el que va a aparecer en las jugadas.
const nuevoJugador = async (teamId, nombre, numero, posicion) => (await call(
  `/players/branches/${BRANCH}/teams/${teamId}/roster`,
  { method: 'POST', token: LIGA, body: { first_name: nombre, last_name: `De${stamp}`, jersey_number: numero, position: posicion } },
)).data.player?.id;

const QB = await nuevoJugador(TEAM_A, 'Quique', 12, 'QB');
const RB = await nuevoJugador(TEAM_A, 'Ramiro', 22, 'RB');
const WR = await nuevoJugador(TEAM_A, 'Wilfrido', 80, 'WR');
const K = await nuevoJugador(TEAM_A, 'Kique', 3, 'K');
const LB1 = await nuevoJugador(TEAM_B, 'Lalo', 55, 'LB');
const LB2 = await nuevoJugador(TEAM_B, 'Lucio', 91, 'DL');
ok([QB, RB, WR, K, LB1, LB2].every(Boolean), 'seis jugadores en el roster del partido');

// El visor entra como `editor` de la liga. La invitación tiene su propia suite
// (`invites-roles.e2e.mjs`); aquí solo hace falta que el rol exista.
const { rows: [{ organization_id: ORG }] } = await pool.query('SELECT organization_id FROM leagues WHERE id=$1', [LEAGUE]);
const idDe = async (token) => (await call('/auth/me', { token })).data.user.id;
const VISOR_ID = await idDe(VISOR);
const OTRO_ID = await idDe(OTRO);
for (const uid of [VISOR_ID, OTRO_ID]) {
  await pool.query(
    "INSERT INTO organization_members (organization_id, user_id, role, status) VALUES ($1,$2,'editor','active')",
    [ORG, uid],
  );
}
ok(true, 'dos visores dados de alta en la liga');

// ── 1. Quién puede capturar ───────────────────────────────────────────────

console.log('\n=== 1. Capturar es de la liga; leer el box score es de todos ===');
const sinPermiso = await call(`/plays/matches/${MATCH}/capture`, { token: AJENO });
ok(sinPermiso.status === 403, 'quien no es de la liga recibe 403 al abrir el panel', `=${sinPermiso.status}`);

const sinSesion = await call(`/plays/matches/${MATCH}/box-score`);
ok(sinSesion.status === 200, 'el box score se lee SIN cuenta: es el resultado deportivo', `=${sinSesion.status}`);
ok(sinSesion.data.source === 'totals', 'sin jugadas, la cascada cae en los totales', `=${sinSesion.data.source}`);
ok(sinSesion.data.players.length === 0, 'y no hay nada capturado todavía');

const delVisor = await call(`/plays/matches/${MATCH}/capture`, { token: VISOR });
ok(delVisor.status === 200, 'el visor sí abre el panel', `=${delVisor.status}`);
ok(delVisor.data.teams?.length === 2, 'el panel trae los dos rosters vigentes a la fecha del partido',
  JSON.stringify(delVisor.data.teams?.map((t) => t.roster.length)));

// ── 2. Reclamar el partido ────────────────────────────────────────────────

console.log('\n=== 2. Un partido, un capturista a la vez ===');
const malNivel = await call(`/plays/matches/${MATCH}/sessions`, { method: 'POST', token: VISOR, body: { capture_level: 'todo' } });
ok(malNivel.status === 400, 'un nivel que no existe se rechaza: el nivel no es una preferencia', `=${malNivel.status}`);

const reclamo = await call(`/plays/matches/${MATCH}/sessions`, { method: 'POST', token: VISOR, body: { capture_level: 'offense' } });
const SESION = reclamo.data.session?.id;
ok(reclamo.status === 201 && !!SESION, 'el visor reclama el partido', JSON.stringify(reclamo.data).slice(0, 140));

const reentra = await call(`/plays/matches/${MATCH}/sessions`, { method: 'POST', token: VISOR, body: { capture_level: 'offense' } });
ok(reentra.data.reanudada === true && reentra.data.session.id === SESION,
  'recargar la pantalla NO abre otra sesión: es el mismo visor, no uno nuevo', JSON.stringify(reentra.data).slice(0, 120));

const choque = await call(`/plays/matches/${MATCH}/sessions`, { method: 'POST', token: OTRO, body: { capture_level: 'offense' } });
ok(choque.status === 409, 'un segundo visor recibe 409, no un reclamo silencioso', `=${choque.status}`);
ok(choque.data.puede_tomar_control === true, 'y el 409 dice que se puede tomar el control (es un "confirma", no un "no")');

// ── 3. El lote ────────────────────────────────────────────────────────────

console.log('\n=== 3. El lote, y reenviarlo dos veces ===');

// Una serie de verdad, con las tres reglas de la NCAA adentro.
const JUGADAS = [
  // 1 y 10 desde la 75 (75 por recorrer). Acarreo de 4.
  { client_play_id: `p1-${stamp}`, sequence: 1, drive_number: 1, period: '1', clock: '15:00', yard_line: 75,
    offense_team_id: TEAM_A, play_type: 'rush', yards_gained: 4,
    participants: [{ player_id: RB, role: 'rusher' }, { player_id: LB1, role: 'tackler' }] },
  // Pase completo de 20.
  { client_play_id: `p2-${stamp}`, sequence: 2, drive_number: 1, period: '1',
    offense_team_id: TEAM_A, play_type: 'pass', yards_gained: 20,
    participants: [{ player_id: QB, role: 'passer' }, { player_id: WR, role: 'receiver' }] },
  // CAPTURA: no es intento de pase, es acarreo del QB, y se parte entre dos.
  { client_play_id: `p3-${stamp}`, sequence: 3, drive_number: 1, period: '1',
    offense_team_id: TEAM_A, play_type: 'pass', yards_gained: -8,
    participants: [{ player_id: QB, role: 'passer' }, { player_id: LB1, role: 'sack' }, { player_id: LB2, role: 'sack' }] },
  // Pase incompleto: cero yardas es un valor.
  { client_play_id: `p4-${stamp}`, sequence: 4, drive_number: 1, period: '1',
    offense_team_id: TEAM_A, play_type: 'pass', yards_gained: 0,
    participants: [{ player_id: QB, role: 'passer' }] },
  // Touchdown por aire.
  { client_play_id: `p5-${stamp}`, sequence: 5, drive_number: 1, period: '1',
    offense_team_id: TEAM_A, play_type: 'pass', yards_gained: 59, points: 6, scoring_team_id: TEAM_A,
    participants: [{ player_id: QB, role: 'passer' }, { player_id: WR, role: 'receiver' }] },
  // Punto extra.
  { client_play_id: `p6-${stamp}`, sequence: 6, drive_number: 1, period: '1',
    offense_team_id: TEAM_A, play_type: 'extra_point', yards_gained: 0, points: 1, scoring_team_id: TEAM_A,
    participants: [{ player_id: K, role: 'kicker' }] },
];

const lote = await call(`/plays/matches/${MATCH}/plays`, {
  method: 'POST', token: VISOR, body: { session_id: SESION, plays: JUGADAS },
});
ok(lote.status === 201 && lote.data.guardadas === 6, 'las seis jugadas suben', JSON.stringify(lote.data));
ok(lote.data.participantes === 11, 'con sus once participantes', JSON.stringify(lote.data));

// LA PRUEBA QUE IMPORTA: el mismo lote otra vez. Es lo que hace la cola cuando
// el internet del campo va y viene, y tiene que ser gratis.
const otraVez = await call(`/plays/matches/${MATCH}/plays`, {
  method: 'POST', token: VISOR, body: { session_id: SESION, plays: JUGADAS },
});
ok(otraVez.data.guardadas === 0 && otraVez.data.repetidas === 6,
  'reenviar el MISMO lote no guarda nada y lo dice: subirlo dos veces es gratis', JSON.stringify(otraVez.data));

const { rows: [{ n: cuantas }] } = await pool.query('SELECT COUNT(*)::int AS n FROM match_plays WHERE match_id=$1', [MATCH]);
ok(cuantas === 6, 'y en la base siguen siendo seis filas, no doce', `=${cuantas}`);
const { rows: [{ n: cuantosP }] } = await pool.query(
  'SELECT COUNT(*)::int AS n FROM play_participants pp JOIN match_plays p ON p.id=pp.play_id WHERE p.match_id=$1', [MATCH]);
ok(cuantosP === 11, 'ni los participantes se duplicaron', `=${cuantosP}`);

// Un lote a medias no entra a medias.
const loteMalo = await call(`/plays/matches/${MATCH}/plays`, {
  method: 'POST', token: VISOR,
  body: { session_id: SESION, plays: [
    { client_play_id: `bueno-${stamp}`, sequence: 9, drive_number: 2, period: '2', offense_team_id: TEAM_A, play_type: 'rush', yards_gained: 3, participants: [{ player_id: RB, role: 'rusher' }] },
    { client_play_id: `malo-${stamp}`, sequence: 10, drive_number: 2, period: '2', offense_team_id: TEAM_A, play_type: 'rush', yards_gained: 3, participants: [] },
  ] },
});
ok(loteMalo.status === 400, 'una jugada sin nadie con el balón tumba el lote entero', `=${loteMalo.status}`);
const { rows: [{ n: trasMalo }] } = await pool.query('SELECT COUNT(*)::int AS n FROM match_plays WHERE match_id=$1', [MATCH]);
ok(trasMalo === 6, 'y no se guardó ni la buena: el lote es todo o nada', `=${trasMalo}`);

const ajeno = await call(`/plays/matches/${MATCH}/plays`, {
  method: 'POST', token: VISOR,
  body: { session_id: SESION, plays: [{ ...JUGADAS[0], client_play_id: `x-${stamp}`, offense_team_id: 999999 }] },
});
ok(ajeno.status === 400, 'una jugada de un equipo que no juega este partido se rechaza', `=${ajeno.status}`);

// ── 4. El box score derivado ──────────────────────────────────────────────

console.log('\n=== 4. El box score sale de las jugadas, con las reglas de la NCAA ===');
const box = await call(`/plays/matches/${MATCH}/box-score`);
ok(box.data.source === 'plays', 'con una sesión `offense`, la cascada deriva de las jugadas', `=${box.data.source}`);
ok(box.data.capture_level === 'offense', 'y dice con qué nivel se capturó', `=${box.data.capture_level}`);

const de = (id) => box.data.players.find((p) => p.player_id === id) || {};
const qb = de(QB);
ok(qb['passes-attempts'] === 3,
  'el QB tiene TRES intentos de pase, no cuatro: la captura no cuenta como intento (NCAA)',
  `=${qb['passes-attempts']}`);
ok(qb['passes-completions'] === 2 && qb['passes-yards'] === 79, 'dos completos y 79 yardas', JSON.stringify([qb['passes-completions'], qb['passes-yards']]));
ok(qb['passes-touchdowns'] === 1, 'un touchdown por aire');
ok(qb['rushes-attempts'] === 1 && qb['rushes-yards'] === -8,
  'y la captura le quedó como ACARREO de -8, que es como la acredita la NCAA',
  JSON.stringify([qb['rushes-attempts'], qb['rushes-yards']]));

ok(de(LB1)['sacks-total'] === 0.5 && de(LB2)['sacks-total'] === 0.5,
  'la captura se partió entre los dos: media para cada uno',
  JSON.stringify([de(LB1)['sacks-total'], de(LB2)['sacks-total']]));
ok(de(LB1)['tackles-total'] === 1, 'y el taqueo del primer acarreo se acreditó aparte');

ok(de(WR)['receptions-total'] === 2 && de(WR)['receptions-yards'] === 79, 'el receptor, dos recepciones y 79 yardas',
  JSON.stringify([de(WR)['receptions-total'], de(WR)['receptions-yards']]));
ok(de(K)['extra-points-made'] === 1, 'el pateador, su punto extra');
ok(de(RB)['rushes-attempts'] === 1 && de(RB)['rushes-yards'] === 4, 'el corredor, su acarreo de 4');
ok(qb.name && qb.jersey_number === 12, 'cada renglón trae nombre y número, y nada más (regla 7)', JSON.stringify([qb.name, qb.jersey_number]));

ok(box.data.points_by_team?.[TEAM_A] === 7,
  'los puntos de las jugadas se suman aparte: son la SEGUNDA lectura del marcador',
  JSON.stringify(box.data.points_by_team));
ok(box.data.match.home_score === 21,
  'y el marcador publicado sigue siendo el capturado a mano — esto no lo reemplaza',
  `=${box.data.match.home_score}`);

// ── 5. El down derivado ───────────────────────────────────────────────────

console.log('\n=== 5. El down no se capturó y aun así está ===');
const panel = await call(`/plays/matches/${MATCH}/capture`, { token: VISOR });
const bitacora = panel.data.plays_by_session[SESION];
ok(bitacora.length === 6, 'la bitácora trae las seis, ordenadas por serie y sequence', `=${bitacora.length}`);
ok(bitacora.every((j) => j.down === null), 'ninguna guardó su down: no se captura', '');
ok(bitacora[0].down_derivado === 1 && bitacora[0].distance_derivada === 10, '1 y 10 al empezar la serie',
  JSON.stringify([bitacora[0].down_derivado, bitacora[0].distance_derivada]));
ok(bitacora[1].down_derivado === 2 && bitacora[1].distance_derivada === 6, 'ganó 4 → 2 y 6',
  JSON.stringify([bitacora[1].down_derivado, bitacora[1].distance_derivada]));
ok(bitacora[2].down_derivado === 1, 'el pase de 20 dio primero y diez',
  `=${bitacora[2].down_derivado}`);
ok(bitacora.every((j) => j.es_derivado || j.play_type === 'extra_point'),
  'y todos vienen marcados como derivados, para que la pantalla los pinte distinto');

// ── 6. Corregir y borrar ──────────────────────────────────────────────────

console.log('\n=== 6. Se corrige LA JUGADA, no el total ===');
const corregida = await call(`/plays/matches/${MATCH}/plays/p1-${stamp}`, {
  method: 'PUT', token: VISOR,
  body: { ...JUGADAS[0], yards_gained: 9, participants: [{ player_id: RB, role: 'rusher' }] },
});
ok(corregida.status === 200, 'la jugada se corrige entera, participantes incluidos', `=${corregida.status}`);

const boxTrasCorregir = await call(`/plays/matches/${MATCH}/box-score`);
const rbAhora = boxTrasCorregir.data.players.find((p) => p.player_id === RB);
ok(rbAhora['rushes-yards'] === 9, 'el box score se recalculó solo: no se guarda en ningún lado (regla 4)',
  `=${rbAhora['rushes-yards']}`);
const lb1Ahora = boxTrasCorregir.data.players.find((p) => p.player_id === LB1);
ok(lb1Ahora['tackles-total'] === 0, 'y el taqueador que se quitó de la jugada perdió su taqueo',
  `=${lb1Ahora['tackles-total']}`);

const borrada = await call(`/plays/matches/${MATCH}/plays/p4-${stamp}`, { method: 'DELETE', token: VISOR });
ok(borrada.status === 200 && borrada.data.plays.length === 5, 'una jugada que no existió se borra', `=${borrada.status}`);
const { rows: [{ n: huerfanos }] } = await pool.query(
  'SELECT COUNT(*)::int AS n FROM play_participants pp LEFT JOIN match_plays p ON p.id=pp.play_id WHERE p.id IS NULL');
ok(huerfanos === 0, 'y sus participantes se fueron con ella: no quedan huérfanos', `=${huerfanos}`);

const noExiste = await call(`/plays/matches/${MATCH}/plays/nada-${stamp}`, { method: 'DELETE', token: VISOR });
ok(noExiste.status === 404, 'borrar una jugada que no existe es 404, no un 200 silencioso', `=${noExiste.status}`);

// ── 7. Tomar el control ───────────────────────────────────────────────────

console.log('\n=== 7. Tomar el control no borra lo capturado ===');
const tomado = await call(`/plays/matches/${MATCH}/sessions`, {
  method: 'POST', token: OTRO, body: { capture_level: 'full', take_over: true },
});
const SESION2 = tomado.data.session?.id;
ok(tomado.status === 201 && SESION2 !== SESION, 'el segundo visor toma el control y abre su sesión', `=${tomado.status}`);

const { rows: [{ n: siguen }] } = await pool.query('SELECT COUNT(*)::int AS n FROM match_plays WHERE session_id=$1', [SESION]);
ok(siguen === 5, 'las jugadas del primero SIGUEN AHÍ: nunca se descarta lo capturado', `=${siguen}`);

const conDos = await call(`/plays/matches/${MATCH}/capture`, { token: OTRO });
ok(conDos.data.sessions.length === 2, 'el panel muestra las dos sesiones para que una persona elija', `=${conDos.data.sessions.length}`);
ok(conDos.data.session_id === SESION2, 'y la nueva es la buena', `=${conDos.data.session_id}`);

const vacio = await call(`/plays/matches/${MATCH}/box-score`);
ok(vacio.data.players.length === 0,
  'el box score ahora sale de la sesión nueva, que está vacía — no se mezclan nunca', `=${vacio.data.players.length}`);

// Y se puede devolver la buena a la primera, que es para lo que existe.
const devuelta = await call(`/plays/matches/${MATCH}/sessions/${SESION}/authoritative`, { method: 'PUT', token: VISOR });
ok(devuelta.status === 200, 'una persona elige cuál captura es la buena', `=${devuelta.status}`);
const recuperado = await call(`/plays/matches/${MATCH}/box-score`);
ok(recuperado.data.players.length > 0 && recuperado.data.session_id === SESION,
  'y el box score vuelve a salir de la primera', JSON.stringify([recuperado.data.players.length, recuperado.data.session_id]));

// ── 8. El nivel `scoring` no deriva ───────────────────────────────────────

console.log('\n=== 8. Un partido en `scoring` NO produce box score ===');
// Es la prueba del "número falso con cara de verdadero": ocho jugadas de
// anotación SÍ son jugadas, y derivar de ahí diría que el equipo entero corrió
// las yardas de sus touchdowns y nada más.
const mt2 = await call(`/manage/categories/${CAT}/matches`, {
  method: 'POST', token: LIGA,
  body: { home_team: NOMBRE_A, away_team: NOMBRE_B, match_date_local: '2026-10-11T12:00', branch_id: BRANCH },
});
const MATCH2 = mt2.data.match?.id ?? mt2.data.id;

await call(`/plays/matches/${MATCH2}/sessions`, { method: 'POST', token: VISOR, body: { capture_level: 'scoring' } });
const soloAnotaciones = await call(`/plays/matches/${MATCH2}/plays`, {
  method: 'POST', token: VISOR,
  body: { plays: [{
    client_play_id: `s1-${stamp}`, sequence: 1, drive_number: 1, period: '1',
    offense_team_id: TEAM_A, play_type: 'rush', yards_gained: 3, points: 6, scoring_team_id: TEAM_A,
    participants: [{ player_id: RB, role: 'rusher' }],
  }] },
});
ok(soloAnotaciones.data.guardadas === 1, 'la jugada de anotación se guarda igual');

const boxScoring = await call(`/plays/matches/${MATCH2}/box-score`);
ok(boxScoring.data.source === 'totals',
  'pero el box score NO se deriva de ella: son ocho jugadas, no un partido', `=${boxScoring.data.source}`);
ok(boxScoring.data.capture_level === 'scoring',
  'y se dice el nivel, para que la pantalla pueda explicar por qué', `=${boxScoring.data.capture_level}`);
ok(boxScoring.data.players.length === 0, 'sin totales tecleados, no hay box score — y eso es lo correcto');

// ── 9. Capturar sin haber reclamado ───────────────────────────────────────

console.log('\n=== 9. Quien capturó sin reclamar sube igual ===');
const sinReclamar = await call(`/plays/matches/${MATCH2}/plays`, {
  method: 'POST', token: OTRO,
  body: { capture_level: 'offense', plays: [{
    client_play_id: `libre-${stamp}`, sequence: 1, drive_number: 1, period: '1',
    offense_team_id: TEAM_B, play_type: 'rush', yards_gained: 7,
    participants: [{ player_id: LB1, role: 'rusher' }],
  }] },
});
ok(sinReclamar.status === 201 && sinReclamar.data.sesion_nueva === true,
  'sin session_id se le abre una propia en vez de rechazar el lote', JSON.stringify(sinReclamar.data));

const { rows: [{ is_authoritative: esBuena }] } = await pool.query(
  'SELECT is_authoritative FROM match_capture_sessions WHERE id=$1', [sinReclamar.data.session_id]);
ok(esBuena === false, 'y nace como NO buena: llegó sin reclamar y no desbanca a quien sí reclamó', `=${esBuena}`);

const sesionInventada = await call(`/plays/matches/${MATCH2}/plays`, {
  method: 'POST', token: OTRO,
  body: { session_id: 99999999, plays: [{
    client_play_id: `perdida-${stamp}`, sequence: 2, drive_number: 1, period: '1',
    offense_team_id: TEAM_B, play_type: 'rush', yards_gained: 2,
    participants: [{ player_id: LB1, role: 'rusher' }],
  }] },
});
ok(sesionInventada.status === 201 && sesionInventada.data.guardadas === 1,
  'un session_id que ya no existe tampoco pierde la captura', JSON.stringify(sesionInventada.data));

// ── 10. La otra rama de la cascada ────────────────────────────────────────

console.log('\n=== 10. Los totales tecleados leen igual que lo derivado ===');
await call(`/players/matches/${MATCH2}/stats/${QB}`, {
  method: 'PUT', token: LIGA,
  body: { team_id: TEAM_A, pass_completions: 10, pass_attempts: 18, pass_yards: 145, pass_td: 2 },
});
const porTotales = await call(`/plays/matches/${MATCH2}/box-score`);
ok(porTotales.data.source === 'totals', 'el partido en `scoring` lee sus totales', `=${porTotales.data.source}`);
const qbTotales = porTotales.data.players.find((p) => p.player_id === QB) || {};
ok(qbTotales['passes-yards'] === 145 && qbTotales['passes-completions'] === 10,
  'con los MISMOS nombres que la rama derivada (SportsML)', JSON.stringify(qbTotales).slice(0, 120));
ok(qbTotales['fumbles-total'] === null,
  'y lo que esta captura no registra viene en null, no en cero: son dos cosas distintas',
  `=${qbTotales['fumbles-total']}`);

const derivadoQb = recuperado.data.players.find((p) => p.player_id === QB) || {};
ok(Object.keys(derivadoQb).sort().join() === Object.keys(qbTotales).sort().join(),
  'las dos ramas entregan exactamente las mismas llaves: la pantalla lee igual');

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} OK · ${fail} fallas\n`);
await pool.end();
process.exit(fail === 0 ? 0 : 1);
