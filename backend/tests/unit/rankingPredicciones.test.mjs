// Pruebas del orden del ranking de predicciones (utils/rankingPredicciones.js).
// README, "Predicciones y quinielas" y "Los avisos de tus predicciones".
//
// Lo que se fija aquí es lo que no se puede ver en la pantalla sin un concurso
// en curso: que el orden sea el de siempre (un cambio aquí reordena ONEFA), que
// un empate exacto comparta lugar, y que repetir el ranking jornada por jornada
// use solo lo que ya había en cada corte.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compararRanking,
  conPosiciones,
  porcentaje,
  jornadaDe,
  tablaAl,
  cortesDeJornada,
  repasoPorJornada,
  hitoEntre,
} from '../../src/utils/rankingPredicciones.js';

const fila = (userId, points, correct, graded, total) => ({ userId, points, correct, graded, total });

test('el orden es puntos → aciertos → calificadas → total, el mismo que tenían los dos rankings', () => {
  const filas = [
    fila(1, 5, 5, 8, 10),
    fila(2, 6, 4, 8, 10),  // más puntos gana aunque tenga menos aciertos (fase final vale 2)
    fila(3, 5, 5, 9, 10),  // mismos puntos y aciertos: más calificadas va antes
    fila(4, 5, 5, 8, 12),  // y después, más predicciones
  ];
  assert.deepEqual([...filas].sort(compararRanking).map((f) => f.userId), [2, 3, 4, 1]);
});

test('un empate exacto comparte lugar, y el siguiente salta: 1, 2, 2, 4', () => {
  const ranking = conPosiciones([
    fila(1, 3, 3, 4, 4),
    fila(2, 5, 5, 5, 5),
    fila(3, 3, 3, 4, 4),
    fila(4, 1, 1, 4, 4),
  ]);
  assert.deepEqual(ranking.map((f) => [f.userId, f.position]), [[2, 1], [1, 2], [3, 2], [4, 4]]);
});

test('el % solo sobre lo calificado', () => {
  assert.equal(porcentaje(2, 3), 67);
  assert.equal(porcentaje(0, 0), null);
});

test('la jornada es week_label tal cual; sin ella, el día del partido en su zona', () => {
  assert.deepEqual(jornadaDe({ week_label: '5', match_date: '2026-10-03T00:00:00Z' }), { key: 'J:5', week_label: '5', fecha: null });
  // 02:00 UTC del 4 de octubre todavía es 3 de octubre en la Ciudad de México.
  assert.equal(jornadaDe({ week_label: null, match_date: '2026-10-04T02:00:00Z', timezone: 'America/Mexico_City' }).key, 'D:2026-10-03');
  assert.equal(jornadaDe({ week_label: '  ', match_date: '2026-10-04T18:00:00Z' }).key, 'D:2026-10-04');
});

const HORA = 60 * 60 * 1000;
const AHORA = new Date('2026-10-03T20:00:00.000Z');
const antes = (h) => new Date(AHORA.getTime() - h * HORA);
const despues = (h) => new Date(AHORA.getTime() + h * HORA);
const partido = (id, week_label, inicio, gradable_at = null, extra = {}) => ({
  id, week_label, match_date: inicio.toISOString(), gradable_at, exhibition: false, ...extra,
});
const pred = (user_id, match_id, correct, created_at = antes(24 * 10), points = correct ? 1 : 0) => ({
  user_id, match_id, correct, points, created_at,
});

test('tablaAl: solo lo votado y lo calificado HASTA ese momento; los amistosos ni cuentan', () => {
  const partidos = [
    partido(1, '1', antes(50), antes(46)),
    partido(2, '2', antes(10), antes(6)),
    partido(3, 'SCRIMMAGE', antes(40), antes(36), { exhibition: true }),
  ];
  const predicciones = [
    pred(1, 1, true), pred(1, 2, true), pred(1, 3, true),
    pred(2, 1, false), pred(2, 2, true, antes(30)),
  ];
  const alCorte1 = tablaAl({ partidos, predicciones, momento: antes(46) });
  assert.deepEqual(alCorte1.map((f) => [f.userId, f.points, f.graded, f.total]), [[1, 1, 1, 2], [2, 0, 1, 1]],
    'al primer corte: el partido 2 no califica y la predicción de hace 30 h todavía no existía');
  const hoy = tablaAl({ partidos, predicciones, momento: AHORA });
  assert.deepEqual(hoy.map((f) => [f.userId, f.points, f.graded, f.total]), [[1, 2, 2, 2], [2, 1, 2, 2]]);
});

test('tablaAl en una quiniela: solo sus miembros, y todos aunque no hayan votado', () => {
  const partidos = [partido(1, '1', antes(50), antes(46))];
  const tabla = tablaAl({ partidos, predicciones: [pred(1, 1, true), pred(2, 1, true)], momento: AHORA, miembros: [1, 7] });
  assert.deepEqual(tabla.map((f) => [f.userId, f.points, f.position]), [[1, 1, 1], [7, 0, 2]]);
});

test('cortes: una jornada cierra cuando todo lo jugado califica, a la hora del último', () => {
  const partidos = [
    partido(1, '1', antes(50), antes(46)),
    partido(2, '1', antes(48), antes(40)),
    partido(3, '2', antes(5), null),          // jugado y sin calificar: la 2 no cierra
    partido(4, '2', antes(4), antes(1)),
    partido(5, '3', antes(30), antes(26)),
    partido(6, '3', despues(24 * 7), null),   // pospuesto: no detiene a la 3
  ];
  const cortes = cortesDeJornada({ partidos, ahora: AHORA });
  assert.deepEqual(cortes.map((c) => [c.jornada.key, c.at.getTime()]), [
    ['J:1', antes(40).getTime()],
    ['J:3', antes(26).getTime()],
  ]);
});

test('repasoPorJornada: un corte por jornada cerrada, cada uno con su tabla', () => {
  const partidos = [partido(1, '1', antes(50), antes(46)), partido(2, '2', antes(10), antes(6))];
  const predicciones = [pred(1, 1, true), pred(2, 1, false), pred(2, 2, true), pred(1, 2, false)];
  const repaso = repasoPorJornada({ partidos, predicciones, ahora: AHORA });
  assert.equal(repaso.length, 2);
  assert.equal(repaso[0].tabla.get(1).position, 1);
  assert.equal(repaso[0].tabla.get(2).position, 2);
  assert.equal(repaso[1].tabla.get(1).position, 1, '1 acierto cada uno, mismas calificadas y total: empatan');
  assert.equal(repaso[1].tabla.get(2).position, 1);
  assert.equal(repaso[1].participantes, 2);
});

test('hitos: el mejor umbral cruzado hacia arriba, y solo con más participantes que el umbral', () => {
  assert.equal(hitoEntre(12, 8, 36), 'top10');
  assert.equal(hitoEntre(12, 2, 36), 'top3', 'de 12.º a 2.º se avisa el top 3, no el top 10');
  assert.equal(hitoEntre(2, 1, 36), 'first');
  assert.equal(hitoEntre(null, 5, 36), 'top10', 'tu primera jornada ya en el top 10');
  assert.equal(hitoEntre(5, 4, 36), null, 'subir dentro del top 10 no es hito');
  assert.equal(hitoEntre(1, 1, 36), null);
  assert.equal(hitoEntre(null, 3, 3), null, 'un top 3 entre tres personas no es nada');
  assert.equal(hitoEntre(null, 1, 1), null, 'ser 1.º solo no es nada');
  assert.equal(hitoEntre(null, 8, 9), null, 'ni un top 10 entre nueve');
});

test('hitos: se avisa perder el 1.º, pero no bajar del top 10 ni del top 3', () => {
  assert.equal(hitoEntre(1, 2, 36), 'lost_first');
  assert.equal(hitoEntre(3, 4, 36), null);
  assert.equal(hitoEntre(9, 14, 36), null);
});
