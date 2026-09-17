// Pruebas del motor de tabla de posiciones (utils/standings.js).
//
// Lo que de verdad importa probar aquí NO es que sume ganados y perdidos —
// eso es aritmética y se ve a simple vista. Es el reglamento de desempates,
// que es donde una implementación casera se equivoca sin que nadie lo note
// hasta que una liga reclama que su tabla está mal:
//
//   · que "entre sí" se calcule SOLO entre los equipos empatados,
//   · que un empate de tres reinicie el reglamento cuando uno se separa
//     (FIBA/FIFA) en vez de seguir de corrido,
//   · que un criterio que no aplica (rivales en común con pocos juegos) se
//     salte sin desempatar a nadie,
//   · y que cuando el reglamento se agota, la tabla LO DIGA en vez de
//     inventar un orden.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeStandings,
  computeQualification,
  countsForStandings,
  TIEBREAKER_PRESETS,
} from '../../src/utils/standings.js';

// ── Ayudantes ────────────────────────────────────────────────────────────

const team = (id, extra = {}) => ({ team_id: id, name: `Equipo ${id}`, ...extra });

let matchSeq = 0;
function game(home, away, homeScore, awayScore, extra = {}) {
  matchSeq += 1;
  return {
    id: matchSeq,
    home_team_id: home,
    away_team_id: away,
    home_score: homeScore,
    away_score: awayScore,
    // `is_final` lo resuelve la consulta SQL con MATCH_IS_FINAL_SQL (la misma
    // regla que los rankings de predicciones), no el motor — ver el comentario
    // de countsForStandings. Aquí se simula ya resuelto.
    is_final: true,
    match_date: `2026-01-${String(matchSeq).padStart(2, '0')} 12:00`,
    ...extra,
  };
}

const order = (rows) => rows.map((r) => r.team_id);

// ── Récord básico ────────────────────────────────────────────────────────

test('cuenta ganados, perdidos, empatados y puntos', () => {
  const rows = computeStandings({
    teams: [team(1), team(2)],
    matches: [
      game(1, 2, 21, 14),
      game(2, 1, 7, 7),
    ],
  });

  const a = rows.find((r) => r.team_id === 1);
  assert.equal(a.wins, 1);
  assert.equal(a.losses, 0);
  assert.equal(a.ties, 1);
  assert.equal(a.points_for, 28);
  assert.equal(a.points_against, 21);
  assert.equal(a.point_diff, 7);
  // El empate vale medio juego: (1 + 0.5) / 2 = 0.75
  assert.equal(a.win_pct, 0.75);
});

test('un equipo inscrito sin partidos aparece en la tabla, en ceros', () => {
  // Y queda POR ENCIMA del que ya perdió, no al fondo: los dos van a 0% de
  // ganados, así que decide el siguiente criterio, y en diferencia de puntos
  // el que no ha jugado está en 0 contra el -10 del que perdió. Es la
  // aplicación literal del reglamento, no un caso especial: quien no ha
  // jugado tampoco ha perdido.
  const rows = computeStandings({
    teams: [team(1), team(2), team(3)],
    matches: [game(1, 2, 10, 0)],
  });

  assert.equal(rows.length, 3);
  const c = rows.find((r) => r.team_id === 3);
  assert.equal(c.played, 0);
  assert.equal(c.win_pct, 0);
  assert.deepEqual(order(rows), [1, 3, 2]);
});

// ── Qué partidos cuentan ─────────────────────────────────────────────────

test('countsForStandings excluye borradores, no terminados, sin marcador y fases que no cuentan', () => {
  assert.equal(countsForStandings(game(1, 2, 10, 0)), true);
  assert.equal(countsForStandings(game(1, 2, 10, 0, { is_draft: true })), false);
  assert.equal(countsForStandings(game(1, 2, 10, 0, { is_final: false })), false);
  assert.equal(countsForStandings(game(1, 2, null, null)), false);
  assert.equal(countsForStandings(game(1, 2, 10, 0, { counts_for_standings: false })), false);

  // El caso que costó caro: en la base real el estado es 'finished', no
  // 'final', y además un 'scheduled' con auto-status vencido TAMBIÉN cuenta.
  // Por eso el motor no mira `status` — mira `is_final`, que ya resolvió el
  // SQL compartido. Un partido sin esa bandera no entra, venga como venga.
  assert.equal(countsForStandings({ status: 'finished', home_score: 10, away_score: 0 }), false);
});

test('un playoff no ensucia la tabla de temporada regular', () => {
  const rows = computeStandings({
    teams: [team(1), team(2)],
    matches: [
      game(1, 2, 21, 0),
      game(2, 1, 35, 0, { counts_for_standings: false }), // final: no cuenta
    ],
  });

  const a = rows.find((r) => r.team_id === 1);
  assert.equal(a.played, 1);
  assert.equal(a.wins, 1);
  assert.equal(a.losses, 0);
});

test('un juego contra un invitado que no está en la tabla se ignora', () => {
  // Amistoso contra alguien de fuera: cuenta como partido jugado en la vida
  // real, pero no puede alterar el récord dentro de esta competencia.
  const rows = computeStandings({
    teams: [team(1), team(2)],
    matches: [
      game(1, 2, 21, 0),
      game(1, 99, 0, 60),
    ],
  });

  const a = rows.find((r) => r.team_id === 1);
  assert.equal(a.played, 1);
  assert.equal(a.losses, 0);
});

// ── Desempate de dos: el "entre sí" ──────────────────────────────────────

test('empate de dos se rompe con el resultado entre sí, aunque el otro tenga mejor diferencia', () => {
  // A y B quedan 2-1. B le ganó a A, pero A tiene mejor diferencia de puntos.
  // Con "entre sí" antes que diferencia, manda B — si saliera A, el
  // reglamento se estaría aplicando en el orden equivocado.
  const rows = computeStandings({
    teams: [team(1), team(2), team(3), team(4)],
    matches: [
      game(1, 3, 40, 0),   // A gana
      game(1, 4, 40, 0),   // A gana
      game(2, 1, 7, 0),    // B le gana a A
      game(3, 2, 3, 0),    // C le gana a B
      game(2, 4, 10, 0),   // B gana
      game(4, 3, 10, 0),   // D le gana a C
    ],
    config: TIEBREAKER_PRESETS.porcentaje,
  });

  assert.deepEqual(order(rows).slice(0, 2), [2, 1]);
  assert.equal(rows[0].resolved_by, 'h2h_win_pct');
});

// ── Desempate de tres: reinicio del reglamento ───────────────────────────

test('empate circular de tres: entre sí no separa a nadie y se pasa al criterio general', () => {
  // A→B, B→C, C→A: los tres quedan 1-1 entre sí, con la misma diferencia y
  // los mismos puntos anotados en ese universo. El reglamento tiene que
  // seguir de largo hasta la diferencia general, donde sí se separan.
  const rows = computeStandings({
    teams: [team(1), team(2), team(3), team(4)],
    matches: [
      game(1, 2, 21, 0),
      game(2, 3, 21, 0),
      game(3, 1, 21, 0),
      game(1, 4, 50, 0),
      game(2, 4, 30, 0),
      game(3, 4, 10, 0),
    ],
    config: TIEBREAKER_PRESETS.entre_si,
  });

  assert.deepEqual(order(rows), [1, 2, 3, 4]);
  assert.equal(rows[0].resolved_by, 'point_diff');
});

// Triángulo A→B→C→A con márgenes 14, 6 y 10. Las diferencias "entre sí"
// quedan A +4, C +4, B −8: B se separa por abajo y A y C siguen atados.
// Ese es el escenario donde el modo de empate múltiple importa de verdad.
const TRIANGULO = [
  game(1, 2, 21, 7),    // A le gana a B por 14
  game(2, 3, 20, 14),   // B le gana a C por 6
  game(3, 1, 17, 7),    // C le gana a A por 10
  game(1, 4, 30, 0),
  game(2, 4, 30, 0),
  game(3, 4, 30, 0),
];

test('modo restart: al separarse uno, los que quedan vuelven al primer criterio', () => {
  // Con tres atados, el "entre sí" de cada uno era 1-1 y no separó a nadie.
  // Al irse B, ese universo CAMBIA: entre A y C solos sí hay un ganador. El
  // modo 'restart' (FIBA/FIFA) vuelve al principio del reglamento justamente
  // para volver a preguntarlo — por eso C queda primero resuelto por el
  // juego entre ellos, un criterio que ya se había "gastado" cuando eran tres.
  const rows = computeStandings({
    teams: [team(1), team(2), team(3), team(4)],
    matches: TRIANGULO,
    config: { ...TIEBREAKER_PRESETS.entre_si, multi_team_mode: 'restart' },
  });

  assert.deepEqual(order(rows), [3, 1, 2, 4]);
  assert.equal(rows[0].resolved_by, 'h2h_wins');
});

test('modo secuencial: los mismos partidos se resuelven con otro criterio', () => {
  // Mismos juegos, mismo orden final — pero llegado por otro camino: al no
  // reiniciar, el desempate sigue con el criterio siguiente (puntos anotados
  // entre sí) en vez de volver a mirar quién le ganó a quién. Que el orden
  // coincida aquí es casualidad del ejemplo; lo que se prueba es que el modo
  // cambia de verdad qué criterio decide, y eso es auditable en `resolved_by`.
  const rows = computeStandings({
    teams: [team(1), team(2), team(3), team(4)],
    matches: TRIANGULO,
    config: { ...TIEBREAKER_PRESETS.entre_si, multi_team_mode: 'sequential' },
  });

  assert.deepEqual(order(rows), [3, 1, 2, 4]);
  assert.equal(rows[0].resolved_by, 'h2h_points_for');
});

// ── Criterios que no aplican ─────────────────────────────────────────────

test('rivales en común se salta cuando no hay al menos 4 juegos comparables', () => {
  // Con tan pocos partidos el criterio de NFL no aplica. Debe SALTARSE (no
  // desempatar, no eliminar a nadie) y dejar que resuelva la diferencia.
  const rows = computeStandings({
    teams: [team(1), team(2), team(3)],
    matches: [
      game(1, 3, 30, 0),
      game(2, 3, 10, 0),
    ],
    config: { tiebreakers: ['win_pct', 'common_win_pct', 'point_diff'], multi_team_mode: 'sequential' },
  });

  assert.deepEqual(order(rows).slice(0, 2), [1, 2]);
  assert.equal(rows[0].resolved_by, 'point_diff');
});

test('si el reglamento se agota, los equipos quedan marcados y no se inventa un ganador', () => {
  const rows = computeStandings({
    teams: [team(1), team(2)],
    matches: [
      game(1, 3, 10, 0),
      game(2, 3, 10, 0),
    ],
    config: { tiebreakers: ['win_pct'], multi_team_mode: 'restart' },
  });

  assert.equal(rows[0].unresolved_tie, true);
  assert.equal(rows[1].unresolved_tie, true);
});

// ── Reglamentos reales ───────────────────────────────────────────────────

test('ganados por encima de porcentaje: 3-1 va arriba de 2-0', () => {
  // Es la diferencia entre los dos reglamentos más comunes, y no es teórica:
  // a media temporada, con equipos que llevan distinto número de juegos, el
  // orden cambia según cuál se use. ONEFA ordena por juegos GANADOS, así que
  // el de 3-1 va arriba del invicto de 2-0.
  const partidos = [
    game(1, 3, 20, 0), game(1, 4, 20, 0), game(1, 5, 20, 0), game(5, 1, 20, 0), // A: 3-1
    game(2, 3, 20, 0), game(2, 4, 20, 0),                                        // B: 2-0
  ];
  const equipos = [team(1), team(2), team(3), team(4), team(5)];

  const porGanados = computeStandings({ teams: equipos, matches: partidos, config: TIEBREAKER_PRESETS.ganados });
  assert.deepEqual(order(porGanados).slice(0, 2), [1, 2]);

  const porPorcentaje = computeStandings({ teams: equipos, matches: partidos, config: TIEBREAKER_PRESETS.porcentaje });
  assert.deepEqual(order(porPorcentaje).slice(0, 2), [2, 1]);
});

test('ONEFA: empatados en ganados que SÍ se enfrentaron — manda ese juego', () => {
  // Primera mitad del reglamento de ONEFA: ganados, y el empate lo rompe el
  // juego entre ellos. A y B quedan 2-1; A le ganó a B, así que A va arriba.
  const rows = computeStandings({
    teams: [team(1), team(2), team(3), team(4)],
    matches: [
      game(1, 2, 21, 14),  // A le gana a B
      game(1, 3, 21, 0),   // A gana
      game(4, 1, 21, 0),   // A pierde  -> A 2-1
      game(2, 3, 21, 0),   // B gana
      game(2, 4, 21, 0),   // B gana    -> B 2-1
    ],
    config: TIEBREAKER_PRESETS.ganados,
  });

  assert.deepEqual(order(rows).slice(0, 2), [1, 2]);
  assert.equal(rows[0].resolved_by, 'h2h_wins');
});

test('ONEFA: empatados en ganados que NO se enfrentaron — manda la diferencia', () => {
  // Segunda mitad, y la que se olvida al implementar: si los empatados nunca
  // jugaron entre sí, el criterio "entre sí" no puede decidir nada. Tiene que
  // SALTARSE en silencio y dejar que resuelva la diferencia de puntos — no
  // dejarlos igualados ni inventar un ganador.
  const rows = computeStandings({
    teams: [team(1), team(2), team(3), team(4)],
    matches: [
      game(1, 3, 40, 0),   // A gana por 40
      game(2, 4, 10, 0),   // B gana por 10  (A y B nunca se enfrentan)
    ],
    config: TIEBREAKER_PRESETS.ganados,
  });

  assert.deepEqual(order(rows), [1, 2, 4, 3]);
  assert.equal(rows[0].resolved_by, 'point_diff');
});

// ── Sistema de puntos ────────────────────────────────────────────────────

test('con sistema de puntos la tabla se ordena por puntos, no por % de ganados', () => {
  // A: 1 ganado y 2 empatados = 5 pts en 3 juegos (33% de ganados).
  // B: 1 ganado y 1 perdido    = 3 pts en 2 juegos (50% de ganados).
  // Por % de ganados iría B primero; por puntos va A. La diferencia es
  // exactamente lo que separa a un torneo de fútbol de uno de americano.
  const rows = computeStandings({
    teams: [team(1), team(2), team(3), team(4)],
    matches: [
      game(1, 3, 2, 0),
      game(1, 4, 1, 1),
      game(3, 1, 1, 1),
      game(2, 4, 3, 0),
      game(3, 2, 2, 0),
    ],
    config: TIEBREAKER_PRESETS.puntos,
  });

  const a = rows.find((r) => r.team_id === 1);
  const b = rows.find((r) => r.team_id === 2);
  assert.equal(a.table_points, 5);
  assert.equal(b.table_points, 3);
  assert.ok(a.rank < b.rank);
});

// ── Récord dentro del alcance ────────────────────────────────────────────

test('scope_record separa el récord de conferencia del récord general', () => {
  // A juega dos veces dentro de su conferencia (1 y 2) y una contra alguien
  // de fuera (3). Su récord general y el de conferencia no son el mismo
  // número — es la distinción que usa el desempate de NFL.
  const teams = [team(1), team(2), team(3)];
  const inScope = (m) => [1, 2].includes(m.home_team_id) && [1, 2].includes(m.away_team_id);

  const rows = computeStandings({
    teams,
    matches: [
      game(1, 2, 21, 0),
      game(2, 1, 14, 7),
      game(1, 3, 35, 0),
    ],
    inScope,
  });

  const a = rows.find((r) => r.team_id === 1);
  assert.equal(a.wins, 2);                  // general: 2-1
  assert.equal(a.losses, 1);
  assert.equal(a.scope_record.wins, 1);     // conferencia: 1-1
  assert.equal(a.scope_record.losses, 1);
});

// ── Racha ────────────────────────────────────────────────────────────────

test('la racha se lee del partido más reciente hacia atrás', () => {
  const rows = computeStandings({
    teams: [team(1), team(2)],
    matches: [
      game(1, 2, 0, 10),   // el más viejo: A pierde
      game(1, 2, 10, 0),   // A gana
      game(2, 1, 0, 10),   // el más nuevo: A gana
    ],
  });

  assert.equal(rows.find((r) => r.team_id === 1).streak, 'G2');
  assert.equal(rows.find((r) => r.team_id === 2).streak, 'P2');
});

// ── Clasificación a la siguiente fase ────────────────────────────────────

test('grupos de cuatro: pasa el primero de cada grupo', () => {
  const mk = (ids) => ({
    key: ids.join('-'),
    rows: ids.map((id, i) => ({
      team_id: id, rank: i + 1,
      wins: 3 - i, losses: i, ties: 0,
      points_for: 100 - i * 10, points_against: 50,
    })),
  });

  const clasificados = computeQualification({
    tables: [mk([1, 2, 3, 4]), mk([5, 6, 7, 8])],
    rule: { top_n: 1 },
  });

  assert.deepEqual(clasificados.map((c) => c.team_id), [1, 5]);
  assert.ok(clasificados.every((c) => c.qualified_as === 'direct'));
});

test('mejores terceros: se comparan entre grupos con criterios generales', () => {
  // Tres grupos, pasan los dos primeros más el mejor tercero. Los terceros
  // nunca jugaron entre sí, así que se comparan por sus números generales.
  const mkTable = (key, rows) => ({ key, rows });
  const row = (id, wins, pf, pa) => ({
    team_id: id, wins, losses: 3 - wins, ties: 0, points_for: pf, points_against: pa,
  });

  const clasificados = computeQualification({
    tables: [
      mkTable('A', [row(1, 3, 90, 10), row(2, 2, 70, 30), row(3, 1, 40, 60)]),
      mkTable('B', [row(4, 3, 80, 20), row(5, 2, 60, 40), row(6, 1, 20, 80)]),
      mkTable('C', [row(7, 3, 85, 15), row(8, 2, 65, 35), row(9, 1, 55, 45)]),
    ],
    rule: { top_n: 2, plus_best_n: 1, of_rank: 3 },
  });

  assert.equal(clasificados.length, 7);
  const wild = clasificados.filter((c) => c.qualified_as === 'wildcard');
  assert.deepEqual(wild.map((c) => c.team_id), [9]); // el tercero con mejor diferencia
});
