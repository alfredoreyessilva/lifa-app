// Pruebas del bracket de los playoffs (utils/bracket.js). README, "El bracket
// de los playoffs".
//
// La siembra se prueba con las tablas REALES de la Conferencia Nacional de
// ONEFA, leídas de la API pública de producción el 2026-11-01 al terminar su
// temporada regular: el orden que sale tiene que ser el que publicó la liga.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSeeding, bracketOrder, bracketSize, buildBracket, knockoutPhasesFor,
  knockoutMatchesOf, regularSeasonProgress, isBracketReady,
} from '../../src/utils/bracket.js';
import { computeQualification } from '../../src/utils/standings.js';

// [team_id, nombre, G, P, E, PF, PC, empate sin resolver]
const fila = ([team_id, name, wins, losses, ties, points_for, points_against, tie], i) => ({
  team_id, name, logo_url: null, wins, losses, ties, points_for, points_against,
  played: wins + losses + ties, rank: i + 1, unresolved_tie: Boolean(tie),
});

const CENTRO = [[37, 'PUMAS FES ACATLÁN UNAM', 7, 1, 0, 250, 88, 0], [36, 'POTROS SALVAJES UAEM', 7, 1, 0, 219, 74, 0], [59, 'BÚHOS GUINDA IPN', 4, 4, 0, 172, 95, 0], [40, 'FRAILES UT', 4, 4, 0, 96, 111, 0], [56, 'HALCONES UV', 4, 4, 0, 103, 170, 0], [42, 'TOROS SALVAJES CHAP', 2, 6, 0, 54, 144, 0], [54, 'PANTERAS GES 21', 0, 9, 0, 37, 216, 0]].map(fila);
const BAJIO = [[60, 'LEONES UANQ', 8, 0, 0, 324, 38, 0], [44, 'TECOS UAG', 7, 1, 0, 232, 49, 0], [58, 'LOBOS ULM', 4, 4, 0, 63, 109, 0], [41, 'CARDINALS UIW', 2, 6, 0, 72, 238, 0], [55, 'RED WOLVES ASUCQ', 2, 6, 0, 71, 177, 0], [38, 'CORRECAMINOS UAT', 0, 8, 0, 52, 323, 0]].map(fila);
const NORTE = [[39, 'ÁGUILAS UACH', 8, 0, 0, 244, 42, 0], [53, 'POTROS ITSON', 6, 2, 0, 215, 108, 0], [52, 'LOBOS UADEC', 5, 3, 0, 135, 122, 0], [43, 'INDIOS UACJ', 4, 4, 0, 146, 156, 0], [51, 'CIMARRONES UABC', 3, 6, 0, 60, 277, 0], [126, 'LIEBRES ITCJ', 0, 8, 0, 0, 8, 0]].map(fila);
const CATORCE = [[28, 'PUMAS UNAM CU', 8, 1, 0, 312, 263, 0], [17, 'BORREGOS TEC MTY', 7, 0, 0, 385, 134, 0], [16, 'AUTÉNTICOS TIGRES UANL', 7, 0, 0, 292, 128, 0], [22, 'BORREGOS TEC PUE', 5, 3, 0, 325, 168, 0], [20, 'LEONES UAMN', 5, 3, 0, 196, 189, 0], [19, 'BORREGOS TEC CEM', 5, 4, 0, 304, 212, 0], [27, 'BURROS BLANCOS IPN', 4, 4, 0, 154, 204, 0], [21, 'BORREGOS TEC CCM', 4, 4, 0, 226, 210, 0], [18, 'BORREGOS TEC GDL', 4, 4, 0, 129, 213, 0], [25, 'LINCES UVM', 2, 6, 0, 158, 176, 0]].map(fila);

// En el orden en que las devuelve la tabla de producción.
const TABLAS_NACIONAL = [
  { key: 'group-23', name: 'CENTRO', rows: CENTRO },
  { key: 'group-24', name: 'BAJÍO', rows: BAJIO },
  { key: 'group-25', name: 'NORTE', rows: NORTE },
];

// La regla que deja el Modo ONEFA para Nacional.
const REGLA_NACIONAL = {
  id: 2, phase_id: 18, conference_id: 8, from_scope: 'group',
  top_n: 2, plus_best_n: 2, of_rank: 3, target_phase_id: 19,
  cross_tiebreakers: ['win_pct', 'goal_average'],
};
const REGLA_14 = {
  id: 1, phase_id: 18, conference_id: 7, from_scope: 'conference',
  top_n: 8, plus_best_n: 0, of_rank: null, target_phase_id: 19, cross_tiebreakers: null,
};

const FASES_ONEFA = [
  { id: 18, name: 'Temporada regular', type: 'groups', sort_order: 1 },
  { id: 19, name: 'Cuartos de final', type: 'single_elimination', sort_order: 2 },
  { id: 20, name: 'Semifinales', type: 'single_elimination', sort_order: 3 },
  { id: 21, name: 'Final', type: 'single_elimination', sort_order: 4 },
];
const KO = FASES_ONEFA.slice(1);

const siembraNacional = () => computeSeeding({ tables: TABLAS_NACIONAL, rule: REGLA_NACIONAL });

// Un partido de playoffs ya terminado, local primero.
let nextId = 1000;
const jugado = (home, away, hs, as, extra = {}) => ({
  id: nextId++, home_team_id: home, away_team_id: away, home_score: hs, away_score: as,
  is_final: true, status: 'finished', match_date: '2026-11-08T18:00:00.000Z',
  phase_id: null, explicit_phase_id: null, ...extra,
});

// ── La forma del bracket ─────────────────────────────────────────────────

test('el orden de un bracket deja al 1 y al 2 en mitades distintas', () => {
  assert.deepEqual(bracketOrder(2), [1, 2]);
  assert.deepEqual(bracketOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(bracketOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  assert.deepEqual(bracketOrder(16), [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
});

test('el tamaño es la potencia de dos que alcanza a todos', () => {
  assert.deepEqual([2, 3, 4, 5, 6, 8, 9].map(bracketSize), [2, 4, 4, 8, 8, 8, 16]);
});

// ── La siembra ───────────────────────────────────────────────────────────

test('Nacional 2026: líderes 1–3, segundos 4–6 y los dos mejores terceros 7 y 8', () => {
  const seeds = siembraNacional();
  assert.deepEqual(seeds.map((s) => s.name), [
    'LEONES UANQ',            // 8-0, avg 8.526
    'ÁGUILAS UACH',           // 8-0, avg 5.810
    'PUMAS FES ACATLÁN UNAM', // 7-1
    'TECOS UAG',              // 7-1, avg 4.735
    'POTROS SALVAJES UAEM',   // 7-1, avg 2.959
    'POTROS ITSON',           // 6-2
    'LOBOS UADEC',            // 5-3
    'BÚHOS GUINDA IPN',       // 4-4, avg 1.811 contra 0.578 de Lobos ULM
  ]);
  assert.deepEqual(seeds.map((s) => s.seed), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(seeds.map((s) => s.qualified_as), ['direct', 'direct', 'direct', 'direct', 'direct', 'direct', 'wildcard', 'wildcard']);
  assert.deepEqual(seeds.map((s) => `${s.table_rank}.º ${s.table_name}`).slice(0, 3), ['1.º BAJÍO', '1.º NORTE', '1.º CENTRO']);
  assert.ok(seeds.every((s) => !s.tied), 'ningún número de la Nacional quedó sin decidir');
});

test('los lugares extra de la siembra son los mismos que la tabla marca como comodín', () => {
  const comodines = computeQualification({ tables: TABLAS_NACIONAL, rule: REGLA_NACIONAL })
    .filter((q) => q.qualified_as === 'wildcard').map((q) => q.team_id);
  const extra = siembraNacional().filter((s) => s.qualified_as === 'wildcard').map((s) => s.team_id);
  assert.deepEqual(extra, comodines);
});

test('con una sola tabla, la siembra es el orden de la tabla', () => {
  const seeds = computeSeeding({ tables: [{ key: 'conference-7', name: '14 GRANDES', rows: CATORCE }], rule: REGLA_14 });
  assert.deepEqual(seeds.map((s) => s.name), CATORCE.slice(0, 8).map((r) => r.name));
});

test('dos del mismo lugar que los criterios no separan llevan asterisco', () => {
  const a = { key: 'a', name: 'A', rows: [fila([1, 'UNO', 5, 1, 0, 100, 50, 0], 0)] };
  const b = { key: 'b', name: 'B', rows: [fila([2, 'DOS', 5, 1, 0, 100, 50, 0], 0)] };
  const c = { key: 'c', name: 'C', rows: [fila([3, 'TRES', 4, 2, 0, 100, 50, 0], 0)] };
  const seeds = computeSeeding({ tables: [a, b, c], rule: { top_n: 1, cross_tiebreakers: ['win_pct', 'goal_average'] } });
  assert.deepEqual(seeds.map((s) => [s.name, s.tied]), [['UNO', true], ['DOS', true], ['TRES', false]]);
});

test('un equipo con su lugar en empate sin resolver lleva asterisco', () => {
  const rows = [fila([1, 'UNO', 5, 1, 0, 100, 50, 1], 0), fila([2, 'DOS', 5, 1, 0, 90, 50, 1], 1)];
  const seeds = computeSeeding({ tables: [{ key: 't', name: 'T', rows }], rule: { top_n: 2 } });
  assert.deepEqual(seeds.map((s) => s.tied), [true, true]);
});

// ── Las rondas ───────────────────────────────────────────────────────────

test('las rondas son las fases de eliminación directa desde la fase destino', () => {
  assert.deepEqual(knockoutPhasesFor(REGLA_NACIONAL, FASES_ONEFA).map((f) => f.id), [19, 20, 21]);
  // Sin fase destino: la primera de eliminación directa después de la suya.
  assert.deepEqual(knockoutPhasesFor({ ...REGLA_NACIONAL, target_phase_id: null }, FASES_ONEFA).map((f) => f.id), [19, 20, 21]);
  // Sin fases de eliminación directa no hay bracket.
  assert.deepEqual(knockoutPhasesFor({ phase_id: 18 }, FASES_ONEFA.slice(0, 1)), []);
  // Se corta en la primera que no es de eliminación directa.
  const conSerie = [...FASES_ONEFA.slice(0, 3), { id: 30, name: 'Serie final', type: 'series', sort_order: 4 }];
  assert.deepEqual(knockoutPhasesFor(REGLA_NACIONAL, conSerie).map((f) => f.id), [19, 20]);
});

test('primera ronda: 1–8, 4–5, 2–7 y 3–6, con el mejor sembrado de local', () => {
  const b = buildBracket({ seeds: siembraNacional(), phases: KO });
  assert.equal(b.size, 8);
  assert.deepEqual(b.rounds.map((r) => r.name), ['Cuartos de final', 'Semifinales', 'Final']);
  assert.deepEqual(b.rounds[0].games.map((g) => [g.top.seed, g.bottom.seed]), [[1, 8], [4, 5], [2, 7], [3, 6]]);
  assert.equal(b.rounds[0].games[0].top.name, 'LEONES UANQ');
  assert.equal(b.rounds[0].games[0].bottom.name, 'BÚHOS GUINDA IPN');
  // Nada jugado: semifinales y final por definir, sin campeón.
  assert.ok(b.rounds[1].games.every((g) => !g.top && !g.bottom));
  assert.equal(b.champion, null);
  assert.deepEqual(b.unplaced_matches, []);
});

test('el partido se encuentra por la pareja, aunque solo diga PLAYOFF y el local sea el de abajo', () => {
  const seeds = siembraNacional();
  // Búhos (8) de local contra Leones (1), capturado sin fase.
  const m = jugado(59, 60, 3, 35, { week_label: 'PLAYOFF' });
  const b = buildBracket({ seeds, phases: KO, matches: [m] });
  const g = b.rounds[0].games[0];
  assert.equal(g.match.id, m.id);
  assert.equal(g.top.score, 35);   // Leones, que va arriba
  assert.equal(g.bottom.score, 3);
  assert.equal(g.winner_team_id, 60);
});

test('las semifinales se reacomodan: el mejor que sigue vivo recibe al peor', () => {
  const seeds = siembraNacional();
  const [s1, s2, s3, s4, s5, s6, s7, s8] = seeds.map((s) => s.team_id);
  // Gana el 1, el 4, el 7 (sorpresa sobre el 2) y el 3.
  const matches = [
    jugado(s1, s8, 35, 3),
    jugado(s4, s5, 21, 14),
    jugado(s2, s7, 10, 17),
    jugado(s3, s6, 28, 20),
  ];
  const b = buildBracket({ seeds, phases: KO, matches });
  // Reacomodado: 1–7 y 3–4. Un bracket fijo habría dado 1–4 y 7–3.
  assert.deepEqual(b.rounds[1].games.map((g) => [g.top.seed, g.bottom.seed]), [[1, 7], [3, 4]]);
  // Cada uno dice de qué cruce de cuartos viene, para pintarse de su lado.
  assert.deepEqual(b.rounds[1].games.map((g) => [g.top.from_game, g.bottom.from_game]), [[0, 2], [3, 1]]);
  // La ronda nueva no arrastra el marcador de la anterior.
  assert.ok(b.rounds[1].games.every((g) => g.top.score === null && g.bottom.score === null));
});

test('una ronda reacomodada se conoce hasta que termina toda la anterior', () => {
  const seeds = siembraNacional();
  const [s1, s2, s3, s4, s5, s6, s7, s8] = seeds.map((s) => s.team_id);
  const matches = [jugado(s1, s8, 35, 3), jugado(s4, s5, 21, 14), jugado(s2, s7, 24, 17)];
  // El 3–6 todavía no se juega.
  const b = buildBracket({ seeds, phases: KO, matches: [...matches, { ...jugado(s3, s6, null, null), is_final: false, status: 'scheduled' }] });
  assert.ok(b.rounds[1].games.every((g) => !g.top && !g.bottom));
  assert.deepEqual(b.rounds[0].advanced.map((p) => p.seed), [1, 4, 2]);
  // El cruce pendiente trae su partido, sin marcador ni ganador.
  const pendiente = b.rounds[0].games[3];
  assert.equal(pendiente.match.is_final, false);
  assert.equal(pendiente.winner_team_id, null);
  assert.equal(pendiente.top.score, null);
});

test('el que ya ganó su semifinal aparece en la final sin esperar la otra', () => {
  const seeds = siembraNacional();
  const [s1, s2, s3, s4, s5, s6, s7, s8] = seeds.map((s) => s.team_id);
  const matches = [
    jugado(s1, s8, 35, 3), jugado(s4, s5, 21, 24), jugado(s2, s7, 10, 17), jugado(s3, s6, 28, 20),
    jugado(s1, s7, 31, 14), // la otra semifinal, 3–5, no se ha jugado
  ];
  const b = buildBracket({ seeds, phases: KO, matches });
  const final = b.rounds[2].games[0];
  assert.equal(final.top.team_id, s1);
  assert.equal(final.top.from_game, 0, 'viene de la semifinal de la izquierda');
  assert.equal(final.bottom, null);
  assert.deepEqual(b.rounds[1].advanced.map((p) => p.seed), [1]);
});

test('la final corona al campeón; una final empatada no corona a nadie', () => {
  const seeds = siembraNacional();
  const [s1, s2, s3, s4, s5, s6, s7, s8] = seeds.map((s) => s.team_id);
  const base = [
    jugado(s1, s8, 35, 3), jugado(s4, s5, 21, 14), jugado(s2, s7, 24, 17), jugado(s3, s6, 28, 20),
    jugado(s1, s4, 30, 27), jugado(s2, s3, 14, 21),
  ];
  const b = buildBracket({ seeds, phases: KO, matches: [...base, jugado(s1, s3, 20, 17)] });
  assert.deepEqual(b.rounds[2].games[0].top.seed, 1);
  assert.deepEqual(b.rounds[2].games[0].bottom.seed, 3);
  assert.equal(b.champion.team_id, s1);
  assert.equal(b.champion.score, undefined, 'el campeón viaja sin marcador');

  const empate = buildBracket({ seeds, phases: KO, matches: [...base, jugado(s1, s3, 17, 17)] });
  assert.equal(empate.rounds[2].games[0].winner_team_id, null);
  assert.equal(empate.champion, null);
});

test('lo capturado manda: un partido con la fase de la ronda corrige el cruce', () => {
  const seeds = siembraNacional();
  const [s1, s2, s3, s4, s5, s6, s7, s8] = seeds.map((s) => s.team_id);
  const cuartos = [jugado(s1, s8, 35, 3), jugado(s4, s5, 21, 14), jugado(s2, s7, 10, 17), jugado(s3, s6, 28, 20)];
  // La proyección reacomodada dice 1–7 y 3–4, pero la liga jugó 1–4 y 3–7.
  const semis = [
    jugado(s1, s4, 30, 27, { phase_id: 20, explicit_phase_id: 20 }),
    jugado(s3, s7, 21, 7, { phase_id: 20, explicit_phase_id: 20 }),
  ];
  const b = buildBracket({ seeds, phases: KO, matches: [...cuartos, ...semis] });
  assert.deepEqual(b.rounds[1].games.map((g) => [g.top.seed, g.bottom.seed]), [[1, 4], [3, 7]]);
  assert.ok(b.rounds[1].games.every((g) => g.corrected));
  assert.deepEqual(b.rounds[1].games.map((g) => g.winner_team_id), [s1, s3]);
  assert.deepEqual(b.unplaced_matches, []);
});

test('un partido corregido saca a su equipo del otro cruce proyectado', () => {
  const seeds = siembraNacional();
  const [s1, s2, s3, s4, s5, s6, s7, s8] = seeds.map((s) => s.team_id);
  const cuartos = [jugado(s1, s8, 35, 3), jugado(s4, s5, 21, 14), jugado(s2, s7, 10, 17), jugado(s3, s6, 28, 20)];
  // Solo se capturó una semifinal, 1–4, que no es la proyectada.
  const b = buildBracket({ seeds, phases: KO, matches: [...cuartos, jugado(s1, s4, 30, 27, { phase_id: 20, explicit_phase_id: 20 })] });
  const [g0, g1] = b.rounds[1].games;
  assert.deepEqual([g0.top.seed, g0.bottom.seed], [1, 4]);
  // El 4 ya no aparece dos veces: el otro cruce se queda con el 3 y un lugar por definir.
  assert.equal(g1.top.seed, 3);
  assert.equal(g1.bottom, null);
});

test('sin fase de la ronda, un partido que no cabe no se adivina', () => {
  const seeds = siembraNacional();
  const [s1, , , , , , , s8] = seeds.map((s) => s.team_id);
  // Leones contra Lobos ULM (que no clasificó), capturado como PLAYOFF.
  const raro = jugado(s1, 58, 40, 0, { week_label: 'PLAYOFF' });
  const b = buildBracket({ seeds, phases: KO, matches: [raro, jugado(s1, s8, 35, 3)] });
  assert.deepEqual(b.unplaced_matches.map((m) => m.id), [raro.id]);
  assert.equal(b.rounds[0].games[0].match.home_team_id, s1);
});

test('cada equipo del bracket trae su logo de visitante, para el lado derecho del espejo', () => {
  const conLogos = TABLAS_NACIONAL.map((t) => ({
    ...t,
    rows: t.rows.map((r) => ({ ...r, logo_url: `https://x/${r.team_id}.png`, away_logo_url: r.team_id === 44 ? 'https://x/44-visita.png' : null })),
  }));
  const seeds = computeSeeding({ tables: conLogos, rule: REGLA_NACIONAL });
  assert.equal(seeds.find((s) => s.team_id === 44).away_logo_url, 'https://x/44-visita.png');
  assert.equal(seeds.find((s) => s.team_id === 60).away_logo_url, null);

  const b = buildBracket({ seeds, phases: KO });
  const todos = b.rounds[0].games.flatMap((g) => [g.top, g.bottom]);
  assert.equal(todos.find((p) => p.team_id === 44).away_logo_url, 'https://x/44-visita.png');
  assert.equal(todos.find((p) => p.team_id === 60).away_logo_url, null);
  assert.equal(todos.find((p) => p.team_id === 60).logo_url, 'https://x/60.png');
});

test('con una sola fase para todos los playoffs, las rondas llevan nombre genérico', () => {
  const b = buildBracket({ seeds: siembraNacional(), phases: [{ id: 6, name: 'Postemporada', type: 'single_elimination' }] });
  assert.deepEqual(b.rounds.map((r) => [r.name, r.phase_id]), [['Cuartos de final', null], ['Semifinales', null], ['Final', null]]);
});

test('con 6 clasificados, el 1 y el 2 descansan la primera ronda', () => {
  const seeds = siembraNacional().slice(0, 6);
  const [s1, s2, s3, s4, s5, s6] = seeds.map((s) => s.team_id);
  const b = buildBracket({ seeds, phases: KO, matches: [jugado(s4, s5, 21, 14), jugado(s3, s6, 10, 13)] });
  const r0 = b.rounds[0].games;
  assert.deepEqual(r0.map((g) => g.bye), [true, false, true, false]);
  assert.deepEqual(r0.map((g) => g.winner_team_id), [s1, s4, s2, s6]);
  // Reacomodados: 1–6 y 2–4.
  assert.deepEqual(b.rounds[1].games.map((g) => [g.top.seed, g.bottom.seed]), [[1, 6], [2, 4]]);
});

test('con dos clasificados el bracket es solo la final; con uno no hay bracket', () => {
  const seeds = siembraNacional().slice(0, 2);
  const b = buildBracket({ seeds, phases: [KO[2]] });
  assert.deepEqual(b.rounds.map((r) => r.name), ['Final']);
  assert.deepEqual(b.rounds[0].games.map((g) => [g.top.seed, g.bottom.seed]), [[1, 2]]);
  assert.equal(buildBracket({ seeds: seeds.slice(0, 1), phases: KO }), null);
});

// ── Cuándo se publica ────────────────────────────────────────────────────

test('la temporada regular termina cuando todos sus partidos tienen marcador final', () => {
  const pool = [1, 2, 3];
  const eligibles = [1, 2, 3, 4, 5];
  const partido = (h, a, extra = {}) => ({ home_team_id: h, away_team_id: a, home_score: 7, away_score: 3, is_final: true, counts_for_standings: true, ...extra });
  const matches = [
    partido(1, 2),
    partido(3, 4),
    partido(4, 5, { is_final: false }),               // de otra conferencia: no cuenta
    partido(1, 99, { is_final: false }),              // contra alguien no inscrito: no cuenta
    partido(2, 3, { counts_for_standings: false, is_final: false }), // un playoff: no es temporada regular
  ];
  assert.deepEqual(regularSeasonProgress({ matches, poolIds: pool, eligibleIds: eligibles }), { played: 2, pending: 0 });

  const conPendiente = [...matches, partido(2, 3, { home_score: null, away_score: null, is_final: false })];
  assert.deepEqual(regularSeasonProgress({ matches: conPendiente, poolIds: pool, eligibleIds: eligibles }), { played: 2, pending: 1 });
  // Terminado sin marcador también falta: no se inventa como 0-0.
  const sinMarcador = [...matches, partido(2, 3, { home_score: null, away_score: null })];
  assert.deepEqual(regularSeasonProgress({ matches: sinMarcador, poolIds: pool, eligibleIds: eligibles }), { played: 2, pending: 1 });
});

test('se publica al terminar la temporada regular, o en cuanto hay un partido de playoffs', () => {
  assert.equal(isBracketReady({ played: 77, pending: 0, knockoutCount: 0 }), true);
  assert.equal(isBracketReady({ played: 56, pending: 7, knockoutCount: 0 }), false);
  assert.equal(isBracketReady({ played: 76, pending: 1, knockoutCount: 1 }), true);
  // Sin un solo partido jugado no hay temporada que haya terminado.
  assert.equal(isBracketReady({ played: 0, pending: 0, knockoutCount: 0 }), false);
});

test('el bracket solo lee partidos de eliminación directa entre equipos suyos', () => {
  const matches = [
    { id: 1, home_team_id: 60, away_team_id: 59, phase_type: 'single_elimination', phase_id: 19, phase_is_explicit: true },
    { id: 2, home_team_id: 60, away_team_id: 59, phase_type: 'round_robin', phase_id: null, phase_is_explicit: false },
    { id: 3, home_team_id: 60, away_team_id: 17, phase_type: 'single_elimination', phase_id: null, phase_is_explicit: false },
    { id: 4, home_team_id: 39, away_team_id: 52, phase_type: 'single_elimination', phase_id: null, phase_is_explicit: false, is_draft: true },
  ];
  const ko = knockoutMatchesOf({ matches, poolIds: [60, 59, 39, 52] });
  assert.deepEqual(ko.map((m) => [m.id, m.explicit_phase_id]), [[1, 19]]);
});
