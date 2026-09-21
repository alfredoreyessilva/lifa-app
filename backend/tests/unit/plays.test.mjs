// Pruebas de las estadísticas por jugada (utils/plays.js).
//
// Aquí se fija la **aritmética de acreditación de la NCAA**, que es lo que
// alguien va a "arreglar" más adelante creyendo que encontró un bug. Cada
// prueba rara existe para que ese arreglo falle en el CI y no en la tabla de
// líderes de la temporada:
//
//   1. Una captura NO es un intento de pase: es un acarreo del pasador con la
//      pérdida, y se parte entre quienes la hicieron (media captura cada uno).
//   2. Una conversión de dos puntos no entra en los totales individuales.
//   3. Un partido capturado en `scoring` NO alimenta el box score derivado. Es
//      la prueba que impide el "número falso con cara de verdadero".
//   4. El down se deriva, y cuando la cadena se rompe se DICE en vez de
//      inventar un quinto down.
//   5. El lote falla explícito, salvo con el duplicado —que la cola produce de
//      verdad— donde gana el último.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NIVELES_DE_CAPTURA,
  esNivelValido,
  derivaBoxScore,
  TIPOS_DE_JUGADA,
  ROLES_DE_PARTICIPANTE,
  normalizarJugada,
  normalizarLoteDeJugadas,
  derivarDowns,
  derivarDownsDelPartido,
  boxScoreDerivado,
  boxScoreDeTotales,
  fuenteDelBoxScore,
  EQUIVALENCIAS_SPORTSML,
  CONTEOS,
  EXTRAS,
} from '../../src/utils/plays.js';

// Una jugada válida mínima, para no repetirla en cada prueba.
function jugada(extra = {}) {
  return {
    client_play_id: extra.client_play_id ?? 'uuid-1',
    sequence: 1,
    drive_number: 1,
    period: '1',
    offense_team_id: 10,
    play_type: 'rush',
    yards_gained: 4,
    participants: [{ player_id: 7, role: 'rusher' }],
    ...extra,
  };
}

// ── 1. Los niveles, y el que no deriva ────────────────────────────────────

test('los tres niveles existen y solo dos derivan box score', () => {
  assert.deepEqual(NIVELES_DE_CAPTURA, ['scoring', 'offense', 'full']);
  assert.equal(esNivelValido('offense'), true);
  assert.equal(esNivelValido('todo'), false);

  // La que importa: `scoring` tiene jugadas pero NO produce box score. Derivar
  // de ocho jugadas de anotación diría que el equipo corrió 80 yardas en todo
  // el partido.
  assert.equal(derivaBoxScore('scoring'), false);
  assert.equal(derivaBoxScore('offense'), true);
  assert.equal(derivaBoxScore('full'), true);
  // Falla cerrado: un nivel que no existe no deriva nada.
  assert.equal(derivaBoxScore(undefined), false);
});

test('la cascada elige las jugadas solo cuando el nivel deriva', () => {
  const conOffense = fuenteDelBoxScore([
    { id: 1, capture_level: 'scoring', is_authoritative: false },
    { id: 2, capture_level: 'offense', is_authoritative: true },
  ]);
  assert.equal(conOffense.source, 'plays');
  assert.equal(conOffense.session_id, 2);

  // Hay jugadas y la sesión es la buena, pero es `scoring`: gana la tabla de
  // totales. Y de todos modos se dice qué nivel hay, porque la pantalla tiene
  // que poder explicar por qué.
  const soloScoring = fuenteDelBoxScore([{ id: 3, capture_level: 'scoring', is_authoritative: true }]);
  assert.equal(soloScoring.source, 'totals');
  assert.equal(soloScoring.capture_level, 'scoring');

  // Una sesión `offense` que alguien marcó como NO buena no gana: es
  // exactamente lo que hace `is_authoritative`.
  const descartada = fuenteDelBoxScore([{ id: 4, capture_level: 'full', is_authoritative: false }]);
  assert.equal(descartada.source, 'totals');

  // Sin nada capturado, también los totales.
  assert.equal(fuenteDelBoxScore([]).source, 'totals');
  assert.equal(fuenteDelBoxScore(undefined).source, 'totals');
});

// ── 2. La jugada mínima ───────────────────────────────────────────────────

test('una jugada es válida con tipo, alguien con el balón y sus yardas', () => {
  const ok = normalizarJugada(jugada());
  assert.equal(ok.error, undefined);
  assert.equal(ok.play_type, 'rush');
  assert.equal(ok.yards_gained, 4);
});

test('cero yardas es un valor, no un hueco; faltar sí es error', () => {
  // Un pase incompleto ganó cero, y eso es un dato.
  const incompleto = normalizarJugada(jugada({
    play_type: 'pass', yards_gained: 0, participants: [{ player_id: 9, role: 'passer' }],
  }));
  assert.equal(incompleto.error, undefined);
  assert.equal(incompleto.yards_gained, 0);

  assert.match(normalizarJugada(jugada({ yards_gained: undefined })).error, /yardas/);
  assert.match(normalizarJugada(jugada({ yards_gained: null })).error, /yardas/);
  assert.match(normalizarJugada(jugada({ yards_gained: 'muchas' })).error, /yardas/);
});

test('cada tipo de jugada exige a quien llevó el balón', () => {
  assert.match(
    normalizarJugada(jugada({ participants: [] })).error,
    /quién llevó el balón/,
  );
  // Un taqueador no es alguien con el balón.
  assert.match(
    normalizarJugada(jugada({ participants: [{ player_id: 3, role: 'tackler' }] })).error,
    /quién llevó el balón/,
  );
  // Una conversión de dos puntos vale corrida o pasada.
  assert.equal(normalizarJugada(jugada({
    play_type: 'two_point', participants: [{ player_id: 7, role: 'rusher' }],
  })).error, undefined);
  assert.equal(normalizarJugada(jugada({
    play_type: 'two_point', participants: [{ player_id: 9, role: 'passer' }],
  })).error, undefined);

  // La penalización es la única sin nadie obligatorio: una jugada anulada
  // antes del snap no la tocó nadie, y exigir un participante obligaría al
  // visor a inventárselo.
  assert.equal(normalizarJugada(jugada({ play_type: 'penalty', participants: [] })).error, undefined);
});

test('el tipo de jugada y el papel salen del catálogo, y falla cerrado', () => {
  assert.match(normalizarJugada(jugada({ play_type: 'hail_mary' })).error, /no es un tipo de jugada/);
  assert.match(
    normalizarJugada(jugada({ participants: [{ player_id: 1, role: 'quarterback' }] })).error,
    /no es un papel/,
  );
  assert.ok(TIPOS_DE_JUGADA.includes('spike'));
  assert.ok(ROLES_DE_PARTICIPANTE.includes('sack'));
});

test('sin client_play_id no hay jugada: es la identidad, no sequence', () => {
  assert.match(normalizarJugada(jugada({ client_play_id: '' })).error, /client_play_id/);
  assert.match(normalizarJugada(jugada({ client_play_id: '  ' })).error, /client_play_id/);
  assert.match(normalizarJugada(jugada({ client_play_id: 'x'.repeat(65) })).error, /demasiado largo/);
});

test('el down y la distancia llegan en nulo salvo que alguien los corrija', () => {
  // Lo normal: no se capturan, se derivan al leer.
  assert.equal(normalizarJugada(jugada()).down, null);
  // Corregidos: se guardan.
  const corregida = normalizarJugada(jugada({ down: 3, distance: 7 }));
  assert.equal(corregida.down, 3);
  assert.equal(corregida.distance, 7);
  // Un down imposible no se guarda como corrección: se ignora y se deriva.
  assert.equal(normalizarJugada(jugada({ down: 5 })).down, null);
});

test('una jugada que anotó tiene que decir qué equipo anotó', () => {
  // Por default, el que traía el balón.
  const td = normalizarJugada(jugada({ points: 6 }));
  assert.equal(td.scoring_team_id, 10);
  // Pero se puede decir el otro: una devolución de intercepción anota para la
  // defensa, que no es `offense_team_id`.
  const pickSix = normalizarJugada(jugada({
    play_type: 'pass', points: 6, scoring_team_id: 20,
    participants: [{ player_id: 9, role: 'passer' }, { player_id: 4, role: 'interceptor' }],
  }));
  assert.equal(pickSix.scoring_team_id, 20);
  assert.match(normalizarJugada(jugada({ points: 99 })).error, /puntos/);
});

// ── 3. El lote ────────────────────────────────────────────────────────────

test('el lote falla explícito, y una jugada mala tumba el lote entero', () => {
  assert.match(normalizarLoteDeJugadas(undefined).error, /Falta la lista/);
  assert.match(normalizarLoteDeJugadas('jugadas').error, /tiene que ser una lista/);
  assert.match(normalizarLoteDeJugadas([]).error, /vacío/);
  assert.match(
    normalizarLoteDeJugadas([jugada(), jugada({ client_play_id: 'uuid-2', play_type: 'x' })]).error,
    /no es un tipo de jugada/,
  );
});

test('el mismo client_play_id dos veces en un lote no es error: gana el último', () => {
  // Pasa de verdad cuando la cola junta dos capturas de la misma pantalla.
  // Tirar un partido entero por eso sería perderlo todo por lo de menos.
  const lote = normalizarLoteDeJugadas([
    jugada({ client_play_id: 'uuid-1', yards_gained: 4 }),
    jugada({ client_play_id: 'uuid-1', yards_gained: 9 }),
  ]);
  assert.equal(lote.error, undefined);
  assert.equal(lote.plays.length, 1);
  assert.equal(lote.plays[0].yards_gained, 9);
});

test('el mismo jugador con el mismo papel se colapsa; con dos papeles, no', () => {
  const repetido = normalizarJugada(jugada({
    participants: [{ player_id: 7, role: 'rusher' }, { player_id: 7, role: 'rusher' }],
  }));
  assert.equal(repetido.participants.length, 1);

  // Quien corrió y recuperó su propio balón suelto es dos papeles, y es normal.
  const dosPapeles = normalizarJugada(jugada({
    participants: [{ player_id: 7, role: 'rusher' }, { player_id: 7, role: 'fumbler' }],
  }));
  assert.equal(dosPapeles.participants.length, 2);
});

// ── 4. El down se deriva ──────────────────────────────────────────────────

test('la cadena de downs sale de las yardas, y primero y diez se reinicia', () => {
  // 1 y 10 desde la 25 (25 yardas para anotar), gana 4 → 2 y 6; gana 6 → 1 y 10.
  const filas = derivarDowns([
    { client_play_id: 'a', sequence: 1, play_type: 'rush', yards_gained: 4, yard_line: 25, down: null, distance: null },
    { client_play_id: 'b', sequence: 2, play_type: 'rush', yards_gained: 6, down: null, distance: null },
    { client_play_id: 'c', sequence: 3, play_type: 'rush', yards_gained: 1, down: null, distance: null },
  ]);
  assert.deepEqual(filas.map((f) => [f.down, f.distance]), [[1, 10], [2, 6], [1, 10]]);
  // Y todos vienen marcados como derivados, que es lo que la pantalla pinta
  // distinto de lo confirmado.
  assert.ok(filas.every((f) => f.derivado));
});

test('primero y gol: la distancia nunca es más que lo que falta para anotar', () => {
  const filas = derivarDowns([
    { client_play_id: 'a', sequence: 1, play_type: 'rush', yards_gained: 0, yard_line: 6, down: null, distance: null },
  ]);
  assert.deepEqual([filas[0].down, filas[0].distance], [1, 6]);
});

test('el quinto down no existe: se dice que la cadena se rompió', () => {
  // Cuatro jugadas cortas sin anotar el cambio de posesión. Nadie captura un
  // quinto down: se avisa y se deja de contar.
  const filas = derivarDowns([
    { client_play_id: 'a', sequence: 1, play_type: 'rush', yards_gained: 1, yard_line: 50, down: null, distance: null },
    { client_play_id: 'b', sequence: 2, play_type: 'rush', yards_gained: 1, down: null, distance: null },
    { client_play_id: 'c', sequence: 3, play_type: 'rush', yards_gained: 1, down: null, distance: null },
    { client_play_id: 'd', sequence: 4, play_type: 'rush', yards_gained: 1, down: null, distance: null },
    { client_play_id: 'e', sequence: 5, play_type: 'rush', yards_gained: 1, down: null, distance: null },
  ]);
  assert.deepEqual(filas.map((f) => f.down), [1, 2, 3, 4, null]);
  assert.equal(filas[4].cadena_rota, true);
});

test('una corrección manda sobre el derivado y rearranca la cadena', () => {
  // El visor no captura el down: lo desmiente cuando se desvía.
  const filas = derivarDowns([
    { client_play_id: 'a', sequence: 1, play_type: 'rush', yards_gained: 2, yard_line: 40, down: null, distance: null },
    { client_play_id: 'b', sequence: 2, play_type: 'rush', yards_gained: 2, down: 1, distance: 10 },
    { client_play_id: 'c', sequence: 3, play_type: 'rush', yards_gained: 2, down: null, distance: null },
  ]);
  assert.deepEqual(filas.map((f) => [f.down, f.distance]), [[1, 10], [1, 10], [2, 8]]);
  // La corregida no se pinta como derivada; la que la sigue sí.
  assert.equal(filas[1].derivado, false);
  assert.equal(filas[2].derivado, true);
});

test('el kickoff y el punto extra no tienen down', () => {
  const filas = derivarDowns([
    { client_play_id: 'a', sequence: 1, play_type: 'kickoff', yards_gained: 40, yard_line: 65, down: null, distance: null },
    { client_play_id: 'b', sequence: 2, play_type: 'extra_point', yards_gained: 0, down: null, distance: null },
  ]);
  assert.deepEqual(filas.map((f) => f.down), [null, null]);
});

test('una penalización mueve el balón pero no consume down', () => {
  const filas = derivarDowns([
    { client_play_id: 'a', sequence: 1, play_type: 'rush', yards_gained: 3, yard_line: 50, down: null, distance: null },
    { client_play_id: 'b', sequence: 2, play_type: 'penalty', yards_gained: -5, down: null, distance: null },
    { client_play_id: 'c', sequence: 3, play_type: 'rush', yards_gained: 0, down: null, distance: null },
  ]);
  // 1 y 10 → 2 y 7 → la falta lo echa 5 atrás: sigue en 2, ahora y 12.
  assert.deepEqual(filas.map((f) => [f.down, f.distance]), [[1, 10], [2, 7], [2, 12]]);
});

test('cada serie se deriva por separado y el orden sale de sequence', () => {
  // A propósito desordenadas: así llegan de una captura sin señal, donde el
  // `created_at` de todas es el mismo segundo en que se subieron.
  const derivadas = derivarDownsDelPartido([
    { client_play_id: 'b', drive_number: 1, sequence: 2, play_type: 'rush', yards_gained: 3, down: null, distance: null },
    { client_play_id: 'z', drive_number: 2, sequence: 9, play_type: 'rush', yards_gained: 1, yard_line: 80, down: null, distance: null },
    { client_play_id: 'a', drive_number: 1, sequence: 1, play_type: 'rush', yards_gained: 2, yard_line: 70, down: null, distance: null },
  ]);
  assert.equal(derivadas.get('a').down, 1);
  assert.equal(derivadas.get('b').down, 2);
  // La segunda serie arranca en primero y diez otra vez, no en tercero.
  assert.equal(derivadas.get('z').down, 1);
});

// ── 5. El box score derivado, y las reglas de la NCAA ─────────────────────

test('un pase completo acredita al pasador y al receptor, y el TD a los dos', () => {
  const { players } = boxScoreDerivado([{
    play_type: 'pass', yards_gained: 22, points: 6, scoring_team_id: 10,
    participants: [{ player_id: 9, role: 'passer' }, { player_id: 80, role: 'receiver' }],
  }]);
  const qb = players.find((p) => p.player_id === 9);
  const wr = players.find((p) => p.player_id === 80);
  assert.equal(qb['passes-attempts'], 1);
  assert.equal(qb['passes-completions'], 1);
  assert.equal(qb['passes-yards'], 22);
  assert.equal(qb['passes-touchdowns'], 1);
  assert.equal(wr['receptions-total'], 1);
  assert.equal(wr['receptions-yards'], 22);
  assert.equal(wr['receptions-touchdowns'], 1);
});

test('un pase incompleto es intento sin completar, y cuenta cero yardas', () => {
  const { players } = boxScoreDerivado([{
    play_type: 'pass', yards_gained: 0,
    participants: [{ player_id: 9, role: 'passer' }],
  }]);
  const qb = players[0];
  assert.equal(qb['passes-attempts'], 1);
  assert.equal(qb['passes-completions'], 0);
  assert.equal(qb['passes-yards'], 0);
});

test('REGLA NCAA: una captura NO es intento de pase, es acarreo del pasador', () => {
  // En la NFL la pérdida se descuenta de las yardas de pase. En la NCAA se le
  // carga al pasador como ACARREO, y por eso los quarterbacks colegiales
  // tienen totales de carrera horribles. Si alguien "arregla" esto, esta
  // prueba es la que lo detiene.
  const { players } = boxScoreDerivado([{
    play_type: 'pass', yards_gained: -7,
    participants: [
      { player_id: 9, role: 'passer' },
      { player_id: 55, role: 'sack' },
    ],
  }]);
  const qb = players.find((p) => p.player_id === 9);
  assert.equal(qb['passes-attempts'], 0, 'una captura no es intento de pase');
  assert.equal(qb['rushes-attempts'], 1);
  assert.equal(qb['rushes-yards'], -7);

  const de = players.find((p) => p.player_id === 55);
  assert.equal(de['sacks-total'], 1);
});

test('REGLA NCAA: la captura se parte entre quienes la hicieron', () => {
  const { players } = boxScoreDerivado([{
    play_type: 'pass', yards_gained: -9,
    participants: [
      { player_id: 9, role: 'passer' },
      { player_id: 55, role: 'sack' },
      { player_id: 91, role: 'sack' },
    ],
  }]);
  assert.equal(players.find((p) => p.player_id === 55)['sacks-total'], 0.5);
  assert.equal(players.find((p) => p.player_id === 91)['sacks-total'], 0.5);
  // Media captura es un número real que la columna entera de
  // `player_match_stats` no sabe expresar: es de lo que solo la captura por
  // jugada se entera.
  assert.equal(players.find((p) => p.player_id === 9)['rushes-yards'], -9);
});

test('REGLA NCAA: los dos puntos no entran en los totales individuales', () => {
  const { players, points_by_team: puntos } = boxScoreDerivado([{
    play_type: 'two_point', yards_gained: 3, points: 2, scoring_team_id: 10,
    participants: [{ player_id: 7, role: 'rusher' }],
  }]);
  const rb = players.find((p) => p.player_id === 7);
  assert.equal(rb['rushes-attempts'], 0, 'una conversión no es un acarreo más');
  assert.equal(rb['rushes-yards'], 0);
  // Los puntos sí cuentan, que es lo único que una conversión aporta.
  assert.equal(puntos[10], 2);
});

test('un pase interceptado no es completo, y le cuenta al pasador', () => {
  const { players } = boxScoreDerivado([{
    play_type: 'pass', yards_gained: 0,
    participants: [
      { player_id: 9, role: 'passer' },
      { player_id: 80, role: 'receiver' },
      { player_id: 21, role: 'interceptor' },
    ],
  }]);
  const qb = players.find((p) => p.player_id === 9);
  assert.equal(qb['passes-attempts'], 1);
  assert.equal(qb['passes-completions'], 0, 'se completó, pero al otro equipo');
  assert.equal(qb['passes-interceptions'], 1);
  // Y el receptor pretendido no se lleva una recepción.
  assert.equal(players.find((p) => p.player_id === 80)['receptions-total'], 0);
  assert.equal(players.find((p) => p.player_id === 21)['interceptions-total'], 1);
});

test('el spike es intento de pase y nunca completo; el kneel es acarreo', () => {
  const { players } = boxScoreDerivado([
    { play_type: 'spike', yards_gained: 0, participants: [{ player_id: 9, role: 'passer' }] },
    { play_type: 'kneel', yards_gained: -1, participants: [{ player_id: 9, role: 'rusher' }] },
  ]);
  const qb = players[0];
  assert.equal(qb['passes-attempts'], 1);
  assert.equal(qb['passes-completions'], 0);
  assert.equal(qb['rushes-attempts'], 1);
  assert.equal(qb['rushes-yards'], -1);
});

test('taqueo solo y asistido suman los dos al total, como reporta la NCAA', () => {
  const { players } = boxScoreDerivado([{
    play_type: 'rush', yards_gained: 2,
    participants: [
      { player_id: 7, role: 'rusher' },
      { player_id: 55, role: 'tackler' },
      { player_id: 44, role: 'assist' },
    ],
  }]);
  assert.equal(players.find((p) => p.player_id === 55)['tackles-total'], 1);
  assert.equal(players.find((p) => p.player_id === 44)['tackles-total'], 1);
});

test('el pateador solo acredita lo que entró', () => {
  const { players } = boxScoreDerivado([
    { play_type: 'field_goal', yards_gained: 0, points: 3, scoring_team_id: 10, participants: [{ player_id: 3, role: 'kicker' }] },
    { play_type: 'field_goal', yards_gained: 0, points: 0, participants: [{ player_id: 3, role: 'kicker' }] },
    { play_type: 'extra_point', yards_gained: 0, points: 1, scoring_team_id: 10, participants: [{ player_id: 3, role: 'kicker' }] },
  ]);
  const k = players[0];
  assert.equal(k['field-goals-made'], 1, 'el que falló no cuenta como bueno');
  assert.equal(k['extra-points-made'], 1);
});

test('las yardas del participante reparten una jugada entre dos', () => {
  // Recepción de 8 y devolución de 30 después del balón suelto: cada quien
  // con lo suyo, no los 38 para los dos.
  const { players } = boxScoreDerivado([{
    play_type: 'pass', yards_gained: 38,
    participants: [
      { player_id: 9, role: 'passer' },
      { player_id: 80, role: 'receiver', yards: 8 },
      { player_id: 22, role: 'returner', yards: 30 },
    ],
  }]);
  assert.equal(players.find((p) => p.player_id === 80)['receptions-total'], 1);
  assert.equal(players.find((p) => p.player_id === 80)['receptions-yards'], 8);
  assert.equal(players.find((p) => p.player_id === 22)['returns-yards'], 30);
  // Las del pasador son las de la jugada: el pase avanzó 38 en total.
  assert.equal(players.find((p) => p.player_id === 9)['passes-yards'], 38);
});

test('los puntos por equipo se suman aparte: son la segunda lectura del marcador', () => {
  const { points_by_team: puntos } = boxScoreDerivado([
    { play_type: 'pass', yards_gained: 30, points: 6, scoring_team_id: 10, participants: [{ player_id: 9, role: 'passer' }, { player_id: 80, role: 'receiver' }] },
    { play_type: 'extra_point', yards_gained: 0, points: 1, scoring_team_id: 10, participants: [{ player_id: 3, role: 'kicker' }] },
    { play_type: 'rush', yards_gained: 3, points: 6, scoring_team_id: 20, participants: [{ player_id: 77, role: 'rusher' }] },
  ]);
  assert.deepEqual(puntos, { 10: 7, 20: 6 });
});

// ── 6. Las dos ramas leen igual ───────────────────────────────────────────

test('los totales tecleados salen con los mismos nombres, y sus extras en null', () => {
  const [fila] = boxScoreDeTotales([{
    player_id: 9, pass_completions: 12, pass_attempts: 20, pass_yards: 180, pass_td: 2,
    interceptions_thrown: 1, rush_attempts: 0, rush_yards: 0, rush_td: 0,
    receptions: 0, receiving_yards: 0, receiving_td: 0, tackles: 0, sacks: 0,
    interceptions_def: 0, field_goals_made: 0, extra_points_made: 0,
  }]);
  assert.equal(fila['passes-completions'], 12);
  assert.equal(fila['passes-yards'], 180);

  // La diferencia que importa: un cero diría "no hubo balones sueltos" cuando
  // lo cierto es "esta captura no los registra". Son dos cosas distintas.
  for (const nombre of EXTRAS) assert.equal(fila[nombre], null);
});

test('las dos ramas de la cascada entregan exactamente las mismas llaves', () => {
  // Si esto se rompe, la pantalla enseña un box score con huecos según de qué
  // rama vino, que es justo lo que la cascada existe para evitar.
  const derivado = boxScoreDerivado([jugada()]).players[0];
  const [totales] = boxScoreDeTotales([{ player_id: 7 }]);
  assert.deepEqual(Object.keys(derivado).sort(), Object.keys(totales).sort());

  assert.equal(CONTEOS.length, 16);
  assert.equal(Object.keys(EQUIVALENCIAS_SPORTSML).length, 16);
});
