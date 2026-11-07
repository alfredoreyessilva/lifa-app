// Pruebas del detalle de una fila del ranking de predicciones
// (utils/rankingFormat.js).
//
// Lo que importa: la fracción siempre son aciertos, nunca puntos, y lo que hace
// que los puntos sean más que los aciertos se dice en la misma fila.

import test from 'node:test';
import assert from 'node:assert/strict';

import { rankingDetail } from '../../src/utils/rankingFormat.js';

const fila = (extra) => ({ total: 135, graded: 129, correct: 99, correctFinalPhase: 0, accuracyPct: 77, ...extra });

test('los aciertos en fase final se dicen entre la fracción y el porcentaje', () => {
  assert.equal(rankingDetail(fila({ correctFinalPhase: 2 })), '99/129 aciertos · 2 en fase final · 77%');
});

test('uno solo se escribe igual: la frase no cambia con el número', () => {
  assert.equal(rankingDetail(fila({ correctFinalPhase: 1 })), '99/129 aciertos · 1 en fase final · 77%');
});

test('sin aciertos en fase final, la fila no los menciona', () => {
  assert.equal(rankingDetail(fila()), '99/129 aciertos · 77%');
});

test('un backend que todavía no manda el dato deja la fila como estaba', () => {
  const { correctFinalPhase, ...sinElDato } = fila();
  assert.equal(rankingDetail(sinElDato), '99/129 aciertos · 77%');
});

test('la fracción nunca lleva puntos, aunque la fila los traiga', () => {
  assert.equal(rankingDetail(fila({ points: 101, correctFinalPhase: 2 })), '99/129 aciertos · 2 en fase final · 77%');
});

test('sin porcentaje, tampoco queda un separador suelto', () => {
  assert.equal(rankingDetail(fila({ correctFinalPhase: 2, accuracyPct: null })), '99/129 aciertos · 2 en fase final');
});

test('nada calificado todavía: cuenta las predicciones, en singular y en plural', () => {
  assert.equal(rankingDetail({ total: 1, graded: 0, correct: 0, correctFinalPhase: 0, accuracyPct: null }), '1 predicción · sin calificar');
  assert.equal(rankingDetail({ total: 6, graded: 0, correct: 0, correctFinalPhase: 0, accuracyPct: null }), '6 predicciones · sin calificar');
  assert.equal(rankingDetail({ total: 0, graded: 0, correct: 0, correctFinalPhase: 0, accuracyPct: null }), '0 predicciones · sin calificar');
});
