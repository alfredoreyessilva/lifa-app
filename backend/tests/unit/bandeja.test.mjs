// Pruebas de "Mis notificaciones" (utils/bandeja.js). README, "Notificaciones:
// la bandeja y el push".
//
// Lo que se fija aquí son las dos cosas que se rompen en silencio:
//
//   1. Quién lee cada aviso de una organización. La bandeja vieja se leía con
//      una sola guarda y el coach terminó leyendo cuotas vencidas con nombres
//      del padrón. Si alguien "simplifica" la tabla, estas pruebas lo dicen.
//   2. Qué avisos de seguimiento salen y cuándo. "Próximo" y "en vivo" no se
//      guardan en ningún lado: se calculan con la hora del partido, así que la
//      única red que tienen es esta.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PERMISO_POR_AVISO,
  permisoDeAviso,
  puedeLeerAviso,
  filtrosDeBandeja,
  cubre,
  avisosDeSeguimiento,
  avisosDePrediccion,
  sinMarcadorRepetido,
  alcanceDe,
  urlDelCalendario,
  esNuevo,
  contarNuevos,
  juntarBandeja,
} from '../../src/utils/bandeja.js';
import { PERMISOS } from '../../src/utils/orgRoles.js';

const DINERO = Object.keys(PERMISO_POR_AVISO).filter((t) =>
  ['cobranza_liga', 'cuotas_club'].includes(PERMISO_POR_AVISO[t]));

// ── 1. Quién lee qué ──────────────────────────────────────────────────────

test('todo aviso clasificado pide un permiso que existe (o nadie lo leería)', () => {
  for (const [tipo, permiso] of Object.entries(PERMISO_POR_AVISO)) {
    assert.ok(PERMISOS.includes(permiso), `"${tipo}" pide "${permiso}", que no está en PERMISOS`);
  }
});

test('el coach y el editor de roster no leen ningún aviso de dinero', () => {
  assert.ok(DINERO.length >= 9, 'la lista de avisos de dinero se quedó corta');
  for (const rol of ['coach', 'roster_editor']) {
    for (const tipo of DINERO) {
      assert.equal(puedeLeerAviso('team', rol, tipo), false, `${rol} lee ${tipo}`);
    }
  }
});

test('el tesorero del equipo lee los dos libros, y no quién entró al equipo', () => {
  assert.ok(puedeLeerAviso('team', 'treasurer', 'billing_charge_new'));
  assert.ok(puedeLeerAviso('team', 'treasurer', 'player_payment_reported'));
  assert.ok(puedeLeerAviso('team', 'treasurer', 'player_billing_overdue'));
  assert.equal(puedeLeerAviso('team', 'treasurer', 'org_admin_claimed'), false);
});

test('el tesorero de la liga lee el pago que le toca confirmar (antes no lo veía)', () => {
  assert.ok(puedeLeerAviso('league', 'treasurer', 'team_payment_reported'));
  assert.equal(puedeLeerAviso('league', 'treasurer', 'score_reminder'), false);
});

test('el editor de partidos lee los recordatorios de captura, y nada de dinero', () => {
  assert.ok(puedeLeerAviso('league', 'editor', 'score_reminder'));
  assert.ok(puedeLeerAviso('league', 'editor', 'match_not_started'));
  assert.equal(puedeLeerAviso('league', 'editor', 'team_payment_reported'), false);
  assert.equal(puedeLeerAviso('league', 'editor', 'league_approved'), false);
});

test('un aviso sin clasificar lo leen solo los dueños: falla cerrado, pero no invisible', () => {
  assert.equal(permisoDeAviso('algo_que_nadie_agrego'), 'duenos');
  assert.ok(puedeLeerAviso('team', 'owner', 'algo_que_nadie_agrego'));
  assert.ok(puedeLeerAviso('league', 'owner', 'algo_que_nadie_agrego'));
  assert.equal(puedeLeerAviso('team', 'admin', 'algo_que_nadie_agrego'), false);
  assert.equal(puedeLeerAviso('league', 'admin', 'algo_que_nadie_agrego'), false);
});

test('un rol desconocido no lee nada', () => {
  for (const tipo of Object.keys(PERMISO_POR_AVISO)) {
    assert.equal(puedeLeerAviso('team', 'rol_inventado', tipo), false);
  }
});

test('filtrosDeBandeja: el dueño lee todo, el coach queda fuera, y se agrupa por rol', () => {
  const grupos = filtrosDeBandeja([
    { tipo: 'team', id: 1, rol: 'owner' },
    { tipo: 'team', id: 2, rol: 'owner' },
    { tipo: 'team', id: 3, rol: 'coach' },
    { tipo: 'team', id: 4, rol: 'treasurer' },
    { tipo: 'league', id: 9, rol: 'owner' },
  ]);
  const dueñosEquipo = grupos.find((g) => g.tipo === 'team' && g.avisos === null);
  assert.deepEqual(dueñosEquipo.ids, [1, 2], 'los dos equipos del dueño van en un solo grupo');
  assert.ok(!grupos.some((g) => g.ids.includes(3)), 'el coach no tiene ningún aviso que leer');
  const tesorero = grupos.find((g) => g.ids.includes(4));
  assert.ok(tesorero.avisos.includes('player_billing_overdue'));
  assert.ok(!tesorero.avisos.includes('org_admin_claimed'));
  assert.ok(grupos.some((g) => g.tipo === 'league' && g.ids.includes(9) && g.avisos === null));
});

// ── 2. Los avisos de lo que sigues ────────────────────────────────────────

const HORA = 60 * 60 * 1000;
const AHORA = new Date('2026-10-03T20:00:00.000Z');
const antes = (h) => new Date(AHORA.getTime() - h * HORA);
const despues = (h) => new Date(AHORA.getTime() + h * HORA);

const partido = (id, inicio, extra = {}) => ({
  id, match_date: inicio.toISOString(), league_id: 7,
  home_team: 'HALCONES', away_team: 'TIGRES', ...extra,
});
const siguePartido = (match_id, desde = antes(24 * 5), prefs = {}) => ({
  match_id, team_name: null, league_id: null, desde, ...prefs,
});
const sigueEquipo = (team_name, league_id, desde = antes(24 * 5), prefs = {}) => ({
  match_id: null, team_name, league_id, desde, ...prefs,
});
const tipos = (avisos) => avisos.map((a) => a.type).sort();

test('"próximo" sale una hora antes y "en vivo" a la hora del partido, ni un minuto antes', () => {
  const empiezaEn30 = partido(1, despues(0.5));
  let avisos = avisosDeSeguimiento({ seguimientos: [siguePartido(1)], partidos: [empiezaEn30], eventos: [], ahora: AHORA });
  assert.deepEqual(tipos(avisos), ['upcoming'], 'a media hora: ya hay "próximo", todavía no "en vivo"');

  const empiezaEn2h = partido(2, despues(2));
  avisos = avisosDeSeguimiento({ seguimientos: [siguePartido(2)], partidos: [empiezaEn2h], eventos: [], ahora: AHORA });
  assert.deepEqual(avisos, [], 'a dos horas no hay nada');

  const empezoHace1h = partido(3, antes(1));
  avisos = avisosDeSeguimiento({ seguimientos: [siguePartido(3)], partidos: [empezoHace1h], eventos: [], ahora: AHORA });
  assert.deepEqual(tipos(avisos), ['live', 'upcoming']);
  assert.equal(avisos.find((a) => a.type === 'live').at.getTime(), antes(1).getTime());
});

test('no enseña lo que pasó antes de que empezaras a seguir', () => {
  const p = partido(1, antes(1));
  // Empezó a seguirlo hace 90 minutos: el "próximo" (hace 2 h) ya había pasado.
  const avisos = avisosDeSeguimiento({ seguimientos: [siguePartido(1, antes(1.5))], partidos: [p], eventos: [], ahora: AHORA });
  assert.deepEqual(tipos(avisos), ['live']);
});

test('respeta las casillas; una casilla en NULL cuenta como marcada', () => {
  const p = partido(1, antes(1));
  let avisos = avisosDeSeguimiento({
    seguimientos: [siguePartido(1, undefined, { notify_upcoming: false, notify_live: null })],
    partidos: [p], eventos: [], ahora: AHORA,
  });
  assert.deepEqual(tipos(avisos), ['live']);

  avisos = avisosDeSeguimiento({
    seguimientos: [siguePartido(1, undefined, { notify_upcoming: false, notify_live: false })],
    partidos: [p], eventos: [], ahora: AHORA,
  });
  assert.deepEqual(avisos, []);
});

test('un partido que sigues directo Y por su equipo avisa una sola vez', () => {
  const p = partido(1, antes(1));
  const avisos = avisosDeSeguimiento({
    seguimientos: [siguePartido(1), sigueEquipo('Halcones', 7)],
    partidos: [p], eventos: [], ahora: AHORA,
  });
  assert.deepEqual(tipos(avisos), ['live', 'upcoming']);
});

test('basta con que UNO de los seguimientos que cubren el partido pida el aviso', () => {
  const p = partido(1, antes(1));
  const avisos = avisosDeSeguimiento({
    seguimientos: [
      siguePartido(1, undefined, { notify_live: false }),
      sigueEquipo('HALCONES', 7),
    ],
    partidos: [p], eventos: [], ahora: AHORA,
  });
  assert.ok(avisos.some((a) => a.type === 'live'));
});

test('seguir a un equipo: sin distinguir mayúsculas, dentro de su liga, o en cualquiera si no dice', () => {
  const p = partido(1, antes(1), { league_id: 7 });
  assert.equal(cubre(sigueEquipo('halcones', 7), p), true);
  assert.equal(cubre(sigueEquipo('HALCONES', 8), p), false, 'el mismo nombre en otra liga no es el mismo equipo');
  assert.equal(cubre(sigueEquipo('HALCONES', null), p), true, 'sin liga: un independiente que juega en varias');
  assert.equal(cubre(sigueEquipo('AGUILAS', 7), p), false);
  assert.equal(cubre({ match_id: null, team_name: null, league_id: 7 }, p), true, 'seguir la liga entera');
});

test('de los cambios de fecha o sede solo el último de cada partido', () => {
  const p = partido(1, despues(24 * 3));
  const eventos = [
    { id: 10, match_id: 1, type: 'schedule_change', at: antes(5), data: { date_changed: true } },
    { id: 11, match_id: 1, type: 'schedule_change', at: antes(2), data: { venue_changed: true } },
  ];
  const avisos = avisosDeSeguimiento({ seguimientos: [siguePartido(1)], partidos: [p], eventos, ahora: AHORA });
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].key, 'schedule_change-11');
  assert.deepEqual(avisos[0].data, { venue_changed: true });
});

test('el marcador final sale cuando el partido TERMINÓ (gradable_at), y respeta su casilla', () => {
  const p = partido(1, antes(24 * 2), { gradable_at: antes(3) });
  let avisos = avisosDeSeguimiento({ seguimientos: [siguePartido(1)], partidos: [p], eventos: [], ahora: AHORA });
  const final = avisos.find((a) => a.type === 'final_score');
  assert.equal(final.at.getTime(), antes(3).getTime(), 'la hora es la de "terminó", no la del partido');
  assert.equal(final.key, 'final_score-1');

  avisos = avisosDeSeguimiento({
    seguimientos: [siguePartido(1, undefined, { notify_final: false })], partidos: [p], eventos: [], ahora: AHORA,
  });
  assert.ok(!avisos.some((a) => a.type === 'final_score'));
});

test('el marcador parcial de un partido que sigue en juego NO es "marcador final"', () => {
  // Así era antes: el primer 7–0 guardaba `final_score` y el aviso salía a
  // media partida. Ahora el evento sigue ahí, pero sin gradable_at no hay aviso.
  const enJuego = partido(1, antes(1), { home_score: 7, away_score: 0, gradable_at: null });
  const eventos = [{ id: 20, match_id: 1, type: 'final_score', at: antes(0.5), data: null }];
  const avisos = avisosDeSeguimiento({ seguimientos: [siguePartido(1)], partidos: [enJuego], eventos, ahora: AHORA });
  assert.ok(!avisos.some((a) => a.type === 'final_score'));
});

test('nada de hace más de 30 días, y nada de un partido que no sigues', () => {
  const viejo = partido(1, antes(24 * 31));
  const ajeno = partido(2, antes(1));
  const avisos = avisosDeSeguimiento({
    seguimientos: [siguePartido(1, antes(24 * 60))], partidos: [viejo, ajeno], eventos: [], ahora: AHORA,
  });
  assert.deepEqual(avisos, []);
});

// ── 4. Los avisos de tus predicciones ─────────────────────────────────────
//
// Se calculan al leer y no dejan rastro en la base: esta es su única red. El
// escenario es un alcance (la rama 17 del torneo 7) con dos jornadas: la 1 ya
// se jugó y calificó, la 2 empieza en 20 horas.

const YO = 1;
const A = 2;
const B = 3;
const deRama = (id, inicio, extra = {}) => ({
  id, branch_id: 17, category_id: 46, tournament_id: 7, week_label: '1',
  match_date: inicio.toISOString(), timezone: 'America/Mexico_City',
  home_team: `LOCAL ${id}`, away_team: `VISITA ${id}`, home_score: null, away_score: null,
  league_name: 'ONEFA', category_name: 'COLEGIAL', branch_name: 'Varonil',
  gradable_at: null, exhibition: false, ...extra,
});
const voto = (user_id, match_id, pick, correct, points = correct ? 1 : 0) => ({
  user_id, match_id, pick, correct, points, created_at: antes(24 * 3),
});
const jornada1 = [
  deRama(1, antes(48), { home_score: 21, away_score: 14, gradable_at: antes(44) }),
  deRama(2, antes(46), { home_score: 10, away_score: 3, gradable_at: antes(40) }),
];
const jornada2 = [
  deRama(3, despues(20), { week_label: '2' }),
  deRama(4, despues(26), { week_label: '2' }),
];
// Tras la jornada 1: YO 2 pts (1.º); A y B 1 pt con los mismos números (2.º los dos).
const votosJ1 = [
  voto(YO, 1, 'home', true), voto(A, 1, 'away', false), voto(B, 1, 'home', true),
  voto(YO, 2, 'home', true), voto(A, 2, 'home', true), voto(B, 2, 'away', false),
];
const deTipo = (avisos, tipo) => avisos.filter((a) => a.type === tipo);

test('el resultado de cada partido que votaste sale a la hora en que terminó, con cuántos votaron igual', () => {
  const avisos = avisosDePrediccion({ userId: YO, partidos: jornada1, predicciones: votosJ1, ahora: AHORA });
  const resultados = deTipo(avisos, 'prediction_result');
  assert.deepEqual(resultados.map((a) => a.key).sort(), ['prediction-1', 'prediction-2']);
  const del1 = resultados.find((a) => a.key === 'prediction-1');
  assert.equal(del1.at.getTime(), antes(44).getTime());
  assert.equal(del1.url, '/partidos/1');
  assert.deepEqual(del1.data, { pick: 'home', correct: true, points: 1, votes: 3, same_pct: 67 });
});

test('sin gradable_at no hay resultado: el marcador parcial no califica a nadie', () => {
  const enJuego = [deRama(1, antes(1), { home_score: 7, away_score: 0, gradable_at: null })];
  const avisos = avisosDePrediccion({ userId: YO, partidos: enJuego, predicciones: [voto(YO, 1, 'home', false)], ahora: AHORA });
  assert.deepEqual(deTipo(avisos, 'prediction_result'), []);
});

test('un amistoso no avisa resultado ni cuenta para la jornada', () => {
  const amistoso = deRama(9, antes(47), { week_label: 'SCRIMMAGE', exhibition: true, home_score: 1, away_score: 0, gradable_at: antes(41) });
  const avisos = avisosDePrediccion({
    userId: YO, partidos: [...jornada1, amistoso], predicciones: [...votosJ1, voto(YO, 9, 'home', true, 0)], ahora: AHORA,
  });
  assert.ok(!avisos.some((a) => a.key === 'prediction-9'));
  assert.ok(!avisos.some((a) => a.key.includes('SCRIMMAGE')), 'el amistoso no abre una jornada propia');
});

test('al cerrar la jornada: tu lugar, cuántos participan y el hito, con link al ranking de esa rama', () => {
  const avisos = avisosDePrediccion({ userId: YO, partidos: jornada1, predicciones: votosJ1, ahora: AHORA });
  const [cierre] = deTipo(avisos, 'prediction_round');
  assert.equal(cierre.key, 'round-rama-17-J:1');
  assert.equal(cierre.at.getTime(), antes(40).getTime(), 'el corte es la última hora de "terminó" de la jornada');
  assert.equal(cierre.url, '/torneos/7?rama=17&tab=ranking');
  assert.deepEqual(
    { ...cierre.data, jornada: cierre.data.jornada.week_label },
    {
      jornada: '1', voted: 2, graded: 2, correct: 2, points: 2, total_points: 2,
      position: 1, tied: 0, participants: 3, change: null, milestone: 'first', pools: [],
    }
  );
});

test('el cierre de la jornada queda ARRIBA del resultado del partido que la cerró (misma hora)', () => {
  const avisos = avisosDePrediccion({ userId: YO, partidos: jornada1, predicciones: votosJ1, ahora: AHORA });
  const lista = juntarBandeja([avisos]).map((a) => a.key);
  assert.deepEqual(lista, ['round-rama-17-J:1', 'prediction-2', 'prediction-1']);
});

test('un empate exacto comparte lugar, y un top 3 entre tres personas no es hito', () => {
  const avisos = avisosDePrediccion({ userId: A, partidos: jornada1, predicciones: votosJ1, ahora: AHORA });
  const [cierre] = deTipo(avisos, 'prediction_round');
  assert.equal(cierre.data.position, 2);
  assert.equal(cierre.data.tied, 1, 'comparte el 2.º con B');
  assert.equal(cierre.data.milestone, null);
  const deB = deTipo(avisosDePrediccion({ userId: B, partidos: jornada1, predicciones: votosJ1, ahora: AHORA }), 'prediction_round')[0];
  assert.equal(deB.data.position, 2, 'A y B empatan en todo: los dos son 2.º');
});

test('la jornada no cierra mientras un partido ya jugado siga sin calificar; uno pospuesto no la detiene', () => {
  const sinMarcador = [jornada1[0], { ...jornada1[1], home_score: null, away_score: null, gradable_at: null }];
  let avisos = avisosDePrediccion({ userId: YO, partidos: sinMarcador, predicciones: votosJ1, ahora: AHORA });
  assert.deepEqual(deTipo(avisos, 'prediction_round'), []);
  assert.equal(deTipo(avisos, 'prediction_result').length, 1, 'el partido que sí terminó avisa su resultado');

  const pospuesto = [jornada1[0], { ...jornada1[1], match_date: despues(24 * 7).toISOString(), home_score: null, away_score: null, gradable_at: null }];
  avisos = avisosDePrediccion({ userId: YO, partidos: pospuesto, predicciones: votosJ1, ahora: AHORA });
  const [cierre] = deTipo(avisos, 'prediction_round');
  assert.equal(cierre.at.getTime(), antes(44).getTime());
  assert.equal(cierre.data.graded, 1);
});

test('te quitaron el 1.º: se avisa aunque no hayas votado esa jornada; y el cambio de lugar', () => {
  const j2Jugada = [
    deRama(3, antes(20), { week_label: '2', home_score: 3, away_score: 0, gradable_at: antes(17) }),
    deRama(4, antes(19), { week_label: '2', home_score: 0, away_score: 7, gradable_at: antes(16) }),
  ];
  // En la jornada 2 solo vota A, y acierta las dos: 3 pts contra los 2 de YO.
  const votos = [...votosJ1, voto(A, 3, 'home', true), voto(A, 4, 'away', true)];
  const deYo = deTipo(avisosDePrediccion({ userId: YO, partidos: [...jornada1, ...j2Jugada], predicciones: votos, ahora: AHORA }), 'prediction_round');
  const cierre2 = deYo.find((a) => a.key === 'round-rama-17-J:2');
  assert.equal(cierre2.data.milestone, 'lost_first');
  assert.equal(cierre2.data.voted, 0);
  assert.equal(cierre2.data.position, 2);
  assert.equal(cierre2.data.change, -1);

  const deA = deTipo(avisosDePrediccion({ userId: A, partidos: [...jornada1, ...j2Jugada], predicciones: votos, ahora: AHORA }), 'prediction_round');
  const deA2 = deA.find((a) => a.key === 'round-rama-17-J:2');
  assert.equal(deA2.data.milestone, 'first');
  assert.equal(deA2.data.change, 1);

  const deB = deTipo(avisosDePrediccion({ userId: B, partidos: [...jornada1, ...j2Jugada], predicciones: votos, ahora: AHORA }), 'prediction_round');
  assert.ok(!deB.some((a) => a.key === 'round-rama-17-J:2'), 'B no votó la jornada 2 ni perdió nada: no se le avisa');
});

test('en cada quiniela tuya: tu lugar entre sus miembros, y una quiniela de una sola persona no cuenta', () => {
  const quinielas = [
    { id: 1, name: 'Los del trabajo', join_code: 'abc', miembros: [YO, A, 99] },
    { id: 2, name: 'Solo yo', join_code: 'def', miembros: [YO] },
  ];
  const [cierre] = deTipo(avisosDePrediccion({ userId: YO, partidos: jornada1, predicciones: votosJ1, quinielas, ahora: AHORA }), 'prediction_round');
  assert.deepEqual(cierre.data.pools, [
    { name: 'Los del trabajo', join_code: 'abc', position: 1, tied: 0, members: 3, change: null, milestone: 'first' },
  ]);
});

test('te falta votar: 24 h antes del primer partido de la jornada, y se quita solo al votar', () => {
  const partidos = [...jornada1, ...jornada2];
  let avisos = avisosDePrediccion({ userId: YO, partidos, predicciones: votosJ1, ahora: AHORA });
  const [recordatorio] = deTipo(avisos, 'prediction_reminder');
  assert.equal(recordatorio.key, 'vote-rama-17-J:2');
  assert.equal(recordatorio.at.getTime(), despues(20 - 24).getTime());
  assert.equal(recordatorio.data.missing, 2);
  assert.equal(recordatorio.partido.id, 3, 'apunta al primero que te falta');
  assert.equal(recordatorio.url, '/torneos/7?rama=17&view=jornada&sel=2');

  avisos = avisosDePrediccion({ userId: YO, partidos, predicciones: [...votosJ1, voto(YO, 3, 'home', false)], ahora: AHORA });
  assert.equal(deTipo(avisos, 'prediction_reminder')[0].data.missing, 1);

  avisos = avisosDePrediccion({
    userId: YO, partidos, predicciones: [...votosJ1, voto(YO, 3, 'home', false), voto(YO, 4, 'away', false)], ahora: AHORA,
  });
  assert.deepEqual(deTipo(avisos, 'prediction_reminder'), []);
});

test('te falta votar: no antes de 24 h, y nada si ya no queda partido por empezar', () => {
  const lejos = [...jornada1, deRama(3, despues(30), { week_label: '2' })];
  assert.deepEqual(deTipo(avisosDePrediccion({ userId: YO, partidos: lejos, predicciones: votosJ1, ahora: AHORA }), 'prediction_reminder'), []);
  // La jornada 1 ya se jugó y YO no votó un partido suyo: ya no hay nada que votar.
  const sinVotar = votosJ1.filter((v) => !(v.user_id === YO && v.match_id === 2));
  assert.deepEqual(deTipo(avisosDePrediccion({ userId: YO, partidos: jornada1, predicciones: sinVotar, ahora: AHORA }), 'prediction_reminder'), []);
});

test('nada de hace más de 30 días', () => {
  const viejos = jornada1.map((p) => ({ ...p, match_date: antes(24 * 40).toISOString(), gradable_at: antes(24 * 39) }));
  assert.deepEqual(avisosDePrediccion({ userId: YO, partidos: viejos, predicciones: votosJ1, ahora: AHORA }), []);
});

test('si sigues el partido Y lo predijiste, queda solo el aviso de tu predicción', () => {
  const deLoQueSigue = [
    { key: 'final_score-1', type: 'final_score', match: { id: 1 } },
    { key: 'final_score-5', type: 'final_score', match: { id: 5 } },
    { key: 'live-1', type: 'live', match: { id: 1 } },
  ];
  const dePredicciones = [{ key: 'prediction-1', type: 'prediction_result', match: { id: 1 } }];
  assert.deepEqual(sinMarcadorRepetido(deLoQueSigue, dePredicciones).map((a) => a.key), ['final_score-5', 'live-1']);
});

test('el alcance es la rama; sin rama, la categoría del modelo viejo', () => {
  assert.equal(alcanceDe({ branch_id: 17, category_id: 46 }), 'rama-17');
  assert.equal(alcanceDe({ branch_id: null, category_id: 46 }), 'categoria-46');
  assert.equal(urlDelCalendario({ branch_id: 17, category_id: 46, tournament_id: 7 }), '/torneos/7?rama=17');
  assert.equal(urlDelCalendario({ branch_id: null, category_id: 46, tournament_id: 7 }, { tab: 'ranking' }), '/categorias/46/calendario?tab=ranking');
});

// ── 3. Lo nuevo ───────────────────────────────────────────────────────────

test('nuevo es después de lo visto y nunca en el futuro', () => {
  const marca = { vistoHasta: antes(2) };
  const aviso = (at) => ({ key: 'x', origin: 'organization', at });
  assert.equal(esNuevo(aviso(antes(1)), marca, AHORA), true);
  assert.equal(esNuevo(aviso(antes(2)), marca, AHORA), false, 'justo en la marca ya se vio');
  assert.equal(esNuevo(aviso(antes(3)), marca, AHORA), false);
  assert.equal(esNuevo(aviso(despues(1)), marca, AHORA), false);
  assert.equal(contarNuevos([aviso(antes(1)), aviso(antes(3)), aviso(antes(0.5))], marca, AHORA), 2);
});

// El caso del 2026-09-28: el cierre de la jornada 4 de ONEFA (top 10) nació con
// la hora del sábado, después de que la persona ya había abierto su bandeja.
test('un aviso calculado que nace con hora del pasado es nuevo si no estaba cuando abriste la bandeja', () => {
  const marca = { vistoHasta: antes(2), vistos: new Set(['prediction-1']) };
  const cierre = { key: 'round-rama-17-J:4', origin: 'prediction', at: antes(24) };
  assert.equal(esNuevo(cierre, marca, AHORA), true);
  assert.equal(esNuevo({ ...cierre, key: 'prediction-1' }, marca, AHORA), false, 'el que sí estaba ya se vio');
  assert.equal(esNuevo({ ...cierre, origin: 'follow', key: 'final_score-9' }, marca, AHORA), true,
    'igual con los de lo que sigues');
  assert.equal(esNuevo({ ...cierre, at: despues(1) }, marca, AHORA), false, 'ni así en el futuro');
});

test('uno de organización con hora del pasado no cuenta: ganar un permiso no prende el balón con la historia', () => {
  const marca = { vistoHasta: antes(2), vistos: new Set() };
  assert.equal(esNuevo({ key: 'n-5', origin: 'organization', at: antes(24) }, marca, AHORA), false);
});

test('sin claves guardadas (no ha abierto la bandeja desde el cambio) cuenta solo la marca', () => {
  const marca = { vistoHasta: antes(2), vistos: null };
  assert.equal(esNuevo({ key: 'round-rama-17-J:4', origin: 'prediction', at: antes(24) }, marca, AHORA), false);
  assert.equal(esNuevo({ key: 'round-rama-17-J:5', origin: 'prediction', at: antes(1) }, marca, AHORA), true);
});

test('juntarBandeja: lo más nuevo arriba, con tope', () => {
  const lista = juntarBandeja([[{ key: 'a', at: antes(3) }, { key: 'b', at: antes(1) }], [{ key: 'c', at: antes(2) }]], 2);
  assert.deepEqual(lista.map((a) => a.key), ['b', 'c']);
});
