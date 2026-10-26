// Pruebas del motor de tabla de posiciones (utils/standings.js).
//
// Lo que de verdad importa probar aquí NO es que sume ganados y perdidos —
// eso es aritmética y se ve a simple vista. Es el reglamento de desempates,
// que es donde una implementación casera se equivoca sin que nadie lo note
// hasta que una liga reclama que su tabla está mal:
//
//   · que "entre sí" se calcule SOLO entre los equipos empatados: como
//     mini-liga si se enfrentaron todos contra todos, y si no, sin dejar a
//     nadie arriba de un empatado que le ganó,
//   · que un empate de tres reinicie el reglamento cuando uno se separa
//     (FIBA/FIFA) en vez de seguir de corrido, uno a la vez,
//   · que un criterio que no aplica (rivales en común con pocos juegos) se
//     salte sin desempatar a nadie,
//   · y que cuando el reglamento se agota, la tabla LO DIGA en vez de
//     inventar un orden.

import test from 'node:test';
import assert from 'node:assert/strict';

import { configForLevel, rulesForTable, markWildcards } from '../../src/utils/branchStandings.js';
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
    // Una hora después del anterior, como fecha real: el día escrito a mano
    // ("2026-01-100") dejaba de ordenarse bien en cuanto el archivo pasó de
    // 99 partidos, y la racha se lee ordenando por fecha.
    match_date: new Date(Date.UTC(2026, 0, 1) + matchSeq * 3_600_000).toISOString(),
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

test('por ganados: empatados que SÍ se enfrentaron — manda ese juego', () => {
  // Ganados, y el empate lo rompe el juego entre ellos. A y B quedan 2-1; A
  // le ganó a B, así que A va arriba.
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

test('por ganados: empatados que NO se enfrentaron — manda la diferencia', () => {
  // La mitad que se olvida al implementar: si los empatados nunca
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

// ── Le ganó a todos o, si no, menos puntos en contra (ONEFA 2024) ────────

const DOMINANTE = TIEBREAKER_PRESETS.dominante_o_en_contra;

test('dominante: dos empatados que no se enfrentaron — goal average, no diferencia', () => {
  // A: 10-2 (+8, 5.0). B: 40-20 (+20, 2.0). Por diferencia iría B; por
  // goal average, que es lo que dice el art. 13, va A.
  const rows = computeStandings({
    teams: [team(1), team(2), team(3), team(4)],
    matches: [game(1, 3, 10, 2), game(2, 4, 40, 20)],
    config: DOMINANTE,
  });
  assert.deepEqual(order(rows).slice(0, 2), [1, 2]);
  assert.equal(rows[0].resolved_by, 'goal_average');
});

test('dominante: tres empatados y uno les ganó a todos — va primero, y los otros dos por su juego', () => {
  // A, B y C con 2 ganados. A le ganó a B y a C; C le ganó a B. B tiene la
  // mejor defensa (2 en contra, contra 6 de A y 7 de C), pero no importa:
  // por la vía del entre sí no se mira.
  const rows = computeStandings({
    teams: [team(1), team(2), team(3), team(4)],
    matches: [
      game(1, 2, 1, 0), game(1, 3, 7, 6), game(3, 2, 1, 0),
      game(3, 4, 7, 0),                         // C llega a 2 ganados
      game(2, 4, 7, 0), game(2, 4, 7, 0),       // B llega a 2 ganados
    ],
    config: DOMINANTE,
  });
  const empatados = order(rows).filter((id) => [1, 2, 3].includes(id));
  assert.deepEqual(empatados, [1, 3, 2]);
});

test('dominante: tres en círculo — el grupo entero por menos puntos en contra, sin volver al juego entre ellos', () => {
  // A>B, B>C, C>A: nadie le ganó a todos.
  const rows = computeStandings({
    teams: [team(1), team(2), team(3)],
    matches: [
      game(1, 2, 14, 10),   // A>B
      game(2, 3, 14, 6),    // B>C
      game(3, 1, 10, 4),    // C>A
    ],
    config: DOMINANTE,
  });
  // En contra: A 10+10=20, B 14+6=20, C 14+4=18. C primero; A y B empatan en
  // contra y van al goal average: A 18/20, B 24/20 → B arriba, aunque A le
  // ganó. Es la regla c: prevalece la vía de puntos en contra.
  assert.deepEqual(order(rows), [3, 2, 1]);
  assert.equal(rows[0].resolved_by, 'points_against');
  assert.equal(rows[1].resolved_by, 'goal_average');
});

test('dominante: el mejor no jugó con uno de los empatados — no les ganó a todos, va a puntos en contra', () => {
  // A le ganó a B; A y C no se enfrentaron. C tiene menos en contra y va
  // primero: "le ganó a todos" es en la cancha.
  const rows = computeStandings({
    teams: [team(1), team(2), team(3), team(4)],
    matches: [
      game(1, 2, 21, 20),   // A>B
      game(2, 3, 21, 20),   // B>C
      game(3, 4, 3, 0),     // C>D
      game(4, 1, 30, 0),    // D>A
      game(4, 2, 30, 0),    // D>B
      game(1, 3, 0, 0),     // empate A-C: se enfrentaron, pero A no le ganó
    ],
    config: DOMINANTE,
  });
  // A, B y C con 1 ganado. Nadie le ganó a los otros dos.
  // En contra: A 20+30+0=50, B 21+30=51, C 21+0=21 → C, A, B.
  const empatados = order(rows).filter((id) => [1, 2, 3].includes(id));
  assert.deepEqual(empatados, [3, 1, 2]);
});

test('dominante: si ni el goal average los separa, la tabla lo dice', () => {
  const rows = computeStandings({
    teams: [team(1), team(2), team(3), team(4), team(5), team(6)],
    matches: [game(1, 4, 7, 0), game(2, 5, 7, 0), game(3, 6, 7, 0)],
    config: DOMINANTE,
  });
  const empatados = rows.filter((r) => [1, 2, 3].includes(r.team_id));
  assert.ok(empatados.every((r) => r.unresolved_tie));
});

// ── Empatados que no jugaron todos contra todos ──────────────────────────

test('cuatro empatados con un solo juego entre ellos: nadie brinca a quien no enfrentó, y ese juego decide su par', () => {
  // El caso de 14 Grandes (2026-10-13) en chico. A, B, C y D quedan con 2
  // ganados; el único juego entre ellos es A sobre D. Antes, "entre sí" le
  // daba a A una victoria y a los demás cero, y A quedaba primero sin haber
  // enfrentado a B ni a C. Ahora el grupo no se enfrentó completo, así que el
  // "entre sí" se salta y la diferencia saca uno a la vez: B, luego C, y entre
  // A y D —que sí jugaron— manda ese juego, aunque D tenga mejor diferencia.
  // Separando a todos de golpe por diferencia, D quedaría arriba de A.
  const rows = computeStandings({
    teams: [1, 2, 3, 4, 5, 6, 7, 8].map((id) => team(id)),
    matches: [
      game(1, 4, 3, 0),    // A le gana a D: el único juego entre empatados
      game(1, 5, 1, 0),
      game(6, 1, 1, 0),    // A: 2-1, diferencia +3
      game(4, 7, 15, 0),
      game(4, 8, 18, 0),   // D: 2-1, diferencia +30
      game(2, 5, 40, 0),
      game(2, 6, 40, 0),   // B: 2-0, diferencia +80
      game(3, 7, 20, 0),
      game(3, 8, 20, 0),   // C: 2-0, diferencia +40
    ],
    config: TIEBREAKER_PRESETS.ganados,
  });

  assert.deepEqual(order(rows).slice(0, 4), [2, 3, 1, 4]);
  assert.equal(rows[0].resolved_by, 'point_diff');
  assert.equal(rows[1].resolved_by, 'point_diff');
  assert.equal(rows[2].resolved_by, 'h2h_wins');
});

test('triángulo que sí se enfrentó: la diferencia saca al mejor y el par que queda lo decide su juego', () => {
  // A le ganó a C, C a B y B a A, los tres por 7: "entre sí" los deja 1-1 y
  // empatados en todo. La diferencia general es A +30, B +20, C +10. Separar
  // a los tres de una vez daría A, B, C y contradiría dos juegos (C le ganó a
  // B, B le ganó a A). Uno a la vez: sale A, y entre B y C manda que C ganó.
  // Así solo queda contradicho uno, que en un triángulo es inevitable.
  const rows = computeStandings({
    teams: [1, 2, 3, 4, 5, 6].map((id) => team(id)),
    matches: [
      game(1, 3, 7, 0),    // A le gana a C
      game(3, 2, 7, 0),    // C le gana a B
      game(2, 1, 7, 0),    // B le gana a A
      game(1, 4, 30, 0),
      game(2, 5, 20, 0),
      game(3, 6, 10, 0),
    ],
    config: TIEBREAKER_PRESETS.ganados,
  });

  assert.deepEqual(order(rows).slice(0, 3), [1, 3, 2]);
  assert.equal(rows[0].resolved_by, 'point_diff');
  assert.equal(rows[1].resolved_by, 'h2h_wins');
});

test('un juego empatado entre ellos cuenta como enfrentados', () => {
  // A empató con B, y los dos le ganaron a C: los tres se enfrentaron, así
  // que el "entre sí" aplica y C, sin victorias en ese universo, va al fondo
  // aunque tenga la mejor diferencia general. Entre A y B el juego no separa
  // (fue empate) y decide la diferencia. Si el empate no contara como juego,
  // el grupo quedaría incompleto y C saldría primero por diferencia.
  const rows = computeStandings({
    teams: [team(1), team(2), team(3), team(4)],
    matches: [
      game(1, 2, 7, 7),    // A y B empatan
      game(1, 3, 10, 7),   // A le gana a C   -> A 1-0-1, +3
      game(2, 3, 20, 7),   // B le gana a C   -> B 1-0-1, +13
      game(3, 4, 60, 0),   // C le gana a D   -> C 1-2,   +44
    ],
    config: TIEBREAKER_PRESETS.ganados,
  });

  assert.deepEqual(order(rows), [2, 1, 3, 4]);
  assert.equal(rows[0].resolved_by, 'point_diff');
  assert.equal(rows[2].resolved_by, 'h2h_wins');
});

test('nadie queda arriba de un empatado que le ganó, aunque la diferencia lo saque antes', () => {
  // El caso de CCM y CEM en 14 Grandes (2026-10-13), en chico. Q, R y S
  // quedan 1-1; Q le ganó a R 27-24, y S no jugó con ninguno de los dos. R
  // tiene la mejor diferencia, así que separándolos uno a la vez por
  // diferencia saldría primero... arriba de Q, que le ganó. R no puede ir
  // primero mientras Q siga empatado con él: entre Q y S, que sí pueden,
  // decide la diferencia, y después R va arriba de S por la suya.
  const rows = computeStandings({
    teams: [1, 2, 3, 4, 5, 6, 7].map((id) => team(id)),
    matches: [
      game(1, 2, 27, 24),  // Q le gana a R
      game(4, 1, 3, 0),    // Q: 1-1, diferencia 0
      game(2, 5, 16, 0),   // R: 1-1, diferencia +13
      game(3, 6, 1, 0),
      game(7, 3, 16, 0),   // S: 1-1, diferencia -15
      game(4, 5, 1, 0),    // 4 y 7 se van a 2-0 y 5 y 6 a 0-2,
      game(7, 6, 1, 0),    // para que el empate sea solo de Q, R y S
    ],
    config: TIEBREAKER_PRESETS.ganados,
  });

  assert.deepEqual(order(rows).slice(2, 5), [1, 2, 3]);
});

test('las victorias se encadenan: A le ganó a B y B a C, así que A va arriba de C', () => {
  // A y C nunca jugaron y C tiene por mucho la mejor diferencia. Pero C no
  // puede quedar arriba de B (le ganó) ni B arriba de A (le ganó): para que C
  // quedara arriba de A habría que contradecir uno de los dos juegos, y el
  // reglamento pone el juego entre ellos antes que la diferencia. Es la
  // consecuencia que Alfredo aceptó al adoptar la regla.
  const rows = computeStandings({
    teams: [1, 2, 3, 4, 5, 6].map((id) => team(id)),
    matches: [
      game(1, 2, 3, 0),    // A le gana a B
      game(2, 3, 3, 0),    // B le gana a C
      game(4, 1, 1, 0),    // A: 1-1, diferencia +2
      game(3, 5, 60, 0),   // C: 1-1, diferencia +57;  B: 1-1, diferencia 0
      game(4, 6, 1, 0),    // 4 se va a 2-0
    ],
    config: TIEBREAKER_PRESETS.ganados,
  });

  assert.deepEqual(order(rows), [4, 1, 2, 3, 6, 5]);
  assert.equal(rows[1].resolved_by, 'h2h_wins');
});

test('una derrota dentro de un círculo no le quita a nadie ir primero', () => {
  // B, C y D forman un círculo (B le ganó a C, C a D y D a B), y además A le
  // ganó a B. A no jugó con C ni con D. B no puede ir primero (A le ganó, y A
  // no está en su círculo), pero C y D sí: su única derrota es dentro del
  // círculo. D tiene la mejor diferencia y sale primero, arriba de A, con
  // quien nunca jugó. Si la derrota dentro del círculo contara, solo A podría
  // ir primero y quedaría arriba de D por una cadena que pasa por el círculo.
  const rows = computeStandings({
    teams: [team(1), team(2), team(3), team(4)],
    matches: [
      game(1, 2, 7, 0),    // A le gana a B
      game(2, 3, 7, 0),    // B le gana a C
      game(3, 4, 7, 0),    // C le gana a D
      game(4, 2, 40, 0),   // D le gana a B   -> A +7, B -40, C 0, D +33
    ],
    config: TIEBREAKER_PRESETS.ganados,
  });

  assert.deepEqual(order(rows), [4, 1, 2, 3]);
  assert.equal(rows[0].resolved_by, 'point_diff');
});

test('un anillo de 18 se rompe una sola vez y desde ahí mandan los juegos', () => {
  // 18 equipos en anillo (cada uno le gana al siguiente): todos 1-1, nadie
  // jugó contra todos, y todos perdieron con alguien, porque el anillo entero
  // es un círculo. Decide la diferencia: sale el 18. En cuanto sale, el 1 ya
  // no perdió con nadie de los que quedan, y desde ahí manda la cadena: 1, 2,
  // 3… hasta el 17, aunque el 1 tenga la peor diferencia de todos. El único
  // juego contradicho es el 17 sobre el 18, el que rompe el círculo.
  const ids = Array.from({ length: 18 }, (_, i) => i + 1);
  const rows = computeStandings({
    teams: ids.map((id) => team(id)),
    // El margen de cada juego es i², así que cada diferencia es distinta.
    matches: ids.map((i) => game(i, (i % 18) + 1, i * i, 0)),
    config: TIEBREAKER_PRESETS.ganados,
  });

  assert.deepEqual(order(rows), [18, ...ids.slice(0, 17)]);
  assert.ok(rows.every((r) => !r.unresolved_tie));
  assert.equal(rows[0].resolved_by, 'point_diff');
  assert.equal(rows[1].resolved_by, 'h2h_wins');
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

test('cada renglón trae su goal average, y null cuando no hay puntos en contra', () => {
  const rows = computeStandings({
    teams: [team(1), team(2), team(3), team(4)],
    matches: [game(1, 2, 21, 7), game(3, 1, 7, 14)],
  });
  const de = (id) => rows.find((r) => r.team_id === id).goal_average;
  assert.equal(de(1), 35 / 14);
  assert.equal(de(2), 7 / 21);
  assert.equal(de(4), null);   // no ha jugado: 0 y 0
  // JSON no lleva infinito: con 0 en contra va en null y la pantalla pone "∞".
  const invicto = computeStandings({ teams: [team(1), team(2)], matches: [game(1, 2, 7, 0)] });
  assert.equal(invicto.find((r) => r.team_id === 1).goal_average, null);
  assert.equal(JSON.parse(JSON.stringify(invicto))[0].goal_average, null);
});

// ── El récord de toda la temporada, en la tabla de un grupo ──────────────
//
// La tabla de un grupo cuenta TODOS los juegos de sus equipos contra
// inscritos en la rama, también los de otros grupos. Lo que no cuenta es un
// rival que no está inscrito. Ver README, "El récord es el de toda la
// temporada, en cualquier tabla".

test('grupo: un juego contra otro grupo cuenta en el récord, no en el del grupo', () => {
  // Grupo Norte: 1 y 2. El 3 es de otro grupo de la misma rama.
  const rows = computeStandings({
    teams: [team(1), team(2)],
    matches: [
      game(1, 2, 21, 0),   // dentro del grupo
      game(1, 3, 0, 14),   // 1 pierde contra otro grupo
      game(3, 2, 7, 10),   // 2 le gana a otro grupo
    ],
    eligibleTeamIds: [1, 2, 3],
  });

  const a = rows.find((r) => r.team_id === 1);
  assert.deepEqual([a.wins, a.losses, a.played], [1, 1, 2]);
  assert.deepEqual([a.points_for, a.points_against], [21, 14]);
  assert.deepEqual([a.scope_record.wins, a.scope_record.losses], [1, 0]);

  const b = rows.find((r) => r.team_id === 2);
  assert.deepEqual([b.wins, b.losses], [1, 1]);
  assert.deepEqual([b.scope_record.wins, b.scope_record.losses], [0, 1]);
  // El rival de otro grupo no aparece en la tabla.
  assert.deepEqual(order(rows).sort(), [1, 2]);
});

test('grupo: un rival que no está inscrito en la rama no cuenta', () => {
  const rows = computeStandings({
    teams: [team(1), team(2)],
    matches: [game(1, 99, 50, 0), game(1, 3, 7, 0)],
    eligibleTeamIds: [1, 2, 3],
  });
  const a = rows.find((r) => r.team_id === 1);
  assert.deepEqual([a.wins, a.points_for], [1, 7]);
});

test('sin inscritos de la rama, la tabla solo ve los juegos entre sus equipos (como antes)', () => {
  const rows = computeStandings({
    teams: [team(1), team(2)],
    matches: [game(1, 2, 21, 0), game(1, 3, 0, 14)],
  });
  const a = rows.find((r) => r.team_id === 1);
  assert.deepEqual([a.wins, a.losses], [1, 0]);
});

test('grupo: los puntos en contra del desempate son los de toda la temporada', () => {
  // Grupo de 1, 2 y 3 en círculo, los tres 2-2 contando a 4 y 5, que son de
  // otro grupo. Dentro del grupo los tres reciben 13; con la derrota 0-40 de
  // 1 ante otro grupo, 1 recibe 53 y queda último.
  const rows = computeStandings({
    teams: [team(1), team(2), team(3)],
    matches: [
      game(1, 2, 7, 6), game(2, 3, 7, 6), game(3, 1, 7, 6),
      game(1, 4, 1, 0), game(2, 4, 3, 0), game(3, 4, 1, 0),
      game(5, 1, 40, 0), game(5, 2, 1, 0), game(5, 3, 1, 0),
    ],
    config: TIEBREAKER_PRESETS.dominante_o_en_contra,
    eligibleTeamIds: [1, 2, 3, 4, 5],
  });
  // En contra: 1 → 53, 2 → 14, 3 → 14. Entre 2 y 3 decide el goal average:
  // 2 anotó 16 (16/14) y 3 anotó 14 (14/14).
  assert.deepEqual(order(rows), [2, 3, 1]);
  assert.equal(rows[0].resolved_by, 'goal_average');
  assert.equal(rows[2].resolved_by, 'points_against');
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

// ── Rivales en común: las dos variantes ──────────────────────────────────

// A y B quedan 2-1 los dos. Comparten exactamente dos rivales (C y D):
//   A: le gana a C, pierde con D  -> 1-1 contra los comunes, diferencia 0
//   B: le gana a C, le gana a D   -> 2-0 contra los comunes, diferencia -36
// Es el escenario donde las dos variantes dan ganadores OPUESTOS: por rivales
// en común manda B, y si el criterio se salta por falta de muestra, manda A
// por diferencia de puntos. Los mismos partidos, dos resultados legítimos —
// por eso el umbral tiene que ser una decisión escrita y no un número mío.
const RIVALES_COMUNES = [
  game(1, 3, 20, 0),   // A le gana a C
  game(4, 1, 30, 0),   // D le gana a A   -> A 2-1, diferencia 0
  game(1, 5, 10, 0),   // A le gana a E
  game(2, 3, 7, 0),    // B le gana a C
  game(2, 4, 7, 0),    // B le gana a D
  game(6, 2, 50, 0),   // F le gana a B   -> B 2-1, diferencia -36
];
const SEIS = [team(1), team(2), team(3), team(4), team(5), team(6)];

test('rivales en común SIN mínimo desempata aunque la muestra sea chica', () => {
  const rows = computeStandings({
    teams: SEIS,
    matches: RIVALES_COMUNES,
    config: { tiebreakers: ['wins', 'common_win_pct', 'point_diff'], multi_team_mode: 'restart' },
  });

  assert.deepEqual(order(rows).slice(0, 2), [2, 1]);   // B por encima de A
  assert.equal(rows[0].resolved_by, 'common_win_pct');
});

test('rivales en común CON mínimo 4 se salta, y decide la diferencia', () => {
  // Mismos partidos, criterio con muestra mínima: dos rivales en común no
  // alcanzan, así que el criterio NO desempata (tampoco elimina a nadie) y
  // el orden lo termina decidiendo la diferencia de puntos — al revés.
  const rows = computeStandings({
    teams: SEIS,
    matches: RIVALES_COMUNES,
    config: { tiebreakers: ['wins', 'common_win_pct_min4', 'point_diff'], multi_team_mode: 'restart' },
  });

  assert.deepEqual(order(rows).slice(0, 2), [1, 2]);   // A por encima de B
  assert.equal(rows[0].resolved_by, 'point_diff');
});

// ── Reglamento propio por nivel de tabla ─────────────────────────────────

test('configForLevel: un nivel sin reglamento propio hereda el de la rama', () => {
  const base = { tiebreakers: ['wins', 'point_diff'], multi_team_mode: 'restart', by_level: {} };
  assert.equal(configForLevel(base, 'conference'), base);
  assert.equal(configForLevel(base, 'group'), base);
});

test('configForLevel: cada nivel puede tener su propio reglamento', () => {
  // Es el caso que motivó esto: en la NFL el empate DENTRO de una división y
  // el empate por un wild card no se resuelven igual — cambia el orden, no
  // solo un umbral. Con una sola lista por rama, una de las dos tablas sale
  // mal por construcción.
  const base = {
    tiebreakers: ['wins', 'h2h_wins'], multi_team_mode: 'restart',
    by_level: {
      group:      { tiebreakers: ['win_pct', 'h2h_win_pct', 'scope_win_pct', 'common_win_pct'], multi_team_mode: 'sequential' },
      conference: { tiebreakers: ['win_pct', 'h2h_win_pct', 'common_win_pct_min4'], multi_team_mode: 'sequential' },
    },
  };

  assert.deepEqual(configForLevel(base, 'group').tiebreakers,
    ['win_pct', 'h2h_win_pct', 'scope_win_pct', 'common_win_pct']);
  assert.deepEqual(configForLevel(base, 'conference').tiebreakers,
    ['win_pct', 'h2h_win_pct', 'common_win_pct_min4']);
  // El que no está en el mapa sigue heredando.
  assert.deepEqual(configForLevel(base, 'branch').tiebreakers, ['wins', 'h2h_wins']);
  assert.equal(configForLevel(base, 'group').multi_team_mode, 'sequential');
});

test('configForLevel: un reglamento por nivel vacío o mal formado se ignora', () => {
  const base = { tiebreakers: ['wins'], multi_team_mode: 'restart', by_level: {
    conference: { tiebreakers: [] },
    group: { tiebreakers: null },
  } };
  assert.equal(configForLevel(base, 'conference'), base);
  assert.equal(configForLevel(base, 'group'), base);
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

test('mejores terceros con goal average: separa a dos terceros con el mismo récord', () => {
  // El 3 y el 6 quedan 1-2. Por diferencia iría el 6 (+10 contra +5); por
  // goal average va el 3 (15/10 contra 40/30).
  const row = (id, wins, pf, pa) => ({
    team_id: id, wins, losses: 3 - wins, ties: 0, points_for: pf, points_against: pa,
  });
  const clasificados = computeQualification({
    tables: [
      { key: 'A', rows: [row(1, 3, 90, 10), row(2, 2, 70, 30), row(3, 1, 15, 10)] },
      { key: 'B', rows: [row(4, 3, 80, 20), row(5, 2, 60, 40), row(6, 1, 40, 30)] },
    ],
    rule: { top_n: 2, plus_best_n: 1, of_rank: 3, cross_tiebreakers: ['win_pct', 'goal_average'] },
  });
  const wild = clasificados.filter((c) => c.qualified_as === 'wildcard');
  assert.deepEqual(wild.map((c) => c.team_id), [3]);
});

// ── Una regla de clasificación por conferencia (Modo ONEFA) ──────────────

const R14 = { id: 1, from_scope: 'conference', conference_id: 7, top_n: 8, plus_best_n: 0 };
const RNAC = { id: 2, from_scope: 'group', conference_id: 8, top_n: 2, plus_best_n: 2, of_rank: 3 };

test('rulesForTable: cada conferencia ve solo su regla', () => {
  const quals = [R14, RNAC];
  assert.deepEqual(rulesForTable({ level: 'conference', conference_id: 7 }, quals), [R14]);
  // La tabla de conferencia de Nacional no clasifica a nadie: su regla es por grupo.
  assert.deepEqual(rulesForTable({ level: 'conference', conference_id: 8 }, quals), []);
  assert.deepEqual(rulesForTable({ level: 'group', conference_id: 8 }, quals), [RNAC]);
  // Unos grupos que 14 Grandes tuviera dados de alta no heredan nada.
  assert.deepEqual(rulesForTable({ level: 'group', conference_id: 7 }, quals), []);
});

test('rulesForTable: la regla sin conferencia vale para las que no tienen la suya', () => {
  const general = { id: 3, from_scope: 'conference', conference_id: null, top_n: 4 };
  const quals = [general, RNAC];
  assert.deepEqual(rulesForTable({ level: 'conference', conference_id: 7 }, quals), [general]);
  assert.deepEqual(rulesForTable({ level: 'conference', conference_id: 8 }, quals), []);
  assert.deepEqual(rulesForTable({ level: 'branch', conference_id: null }, [general]), []);
  const deRama = { id: 4, from_scope: 'branch', conference_id: null, top_n: 6 };
  assert.deepEqual(rulesForTable({ level: 'branch', conference_id: null }, [deRama, RNAC]), [deRama]);
});

test('markWildcards: los mejores terceros solo compiten dentro de su conferencia', () => {
  const row = (id, wins) => ({
    team_id: id, wins, losses: 3 - wins, ties: 0, points_for: 10 * wins, points_against: 10,
  });
  const grupo = (id, conf, ids) => ({
    level: 'group', scope_id: id, conference_id: conf,
    rows: ids.map(([tid, w]) => row(tid, w)),
  });
  // Nacional: tres grupos. Más dos grupos de 14 Grandes cuyos terceros tienen
  // mejor récord que cualquier tercero de Nacional: no deben colarse.
  const tables = [
    grupo(23, 8, [[1, 3], [2, 2], [3, 1]]),
    grupo(24, 8, [[4, 3], [5, 2], [6, 0]]),
    grupo(25, 8, [[7, 3], [8, 2], [9, 1]]),
    grupo(30, 7, [[10, 3], [11, 3], [12, 3]]),
    grupo(31, 7, [[13, 3], [14, 3], [15, 3]]),
  ];
  markWildcards(tables, [R14, RNAC]);
  const wild = tables.flatMap((t) => t.rows).filter((r) => r.qualified_as === 'wildcard').map((r) => r.team_id);
  assert.deepEqual(wild.sort((a, b) => a - b), [3, 9]);
});
