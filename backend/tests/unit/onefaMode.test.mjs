// Pruebas del Modo ONEFA (utils/onefaMode.js): el plan que se escribe en la
// rama al apretar el botón. README, "Modo ONEFA".

import test from 'node:test';
import assert from 'node:assert/strict';

import { planOnefaMode, defaultChoice, blockedReason, ONEFA_LEAGUE_ID } from '../../src/utils/onefaMode.js';

// La estructura real de ONEFA en 2026: 14 Grandes sin grupos y Nacional con
// tres.
const CATORCE = { id: 7, name: '14 GRANDES', groups: [] };
const NACIONAL = {
  id: 8, name: 'NACIONAL',
  groups: [{ id: 23, name: 'CENTRO' }, { id: 24, name: 'BAJÍO' }, { id: 25, name: 'NORTE' }],
};

test('ONEFA se reconoce por su id', () => {
  assert.equal(ONEFA_LEAGUE_ID, 13);
});

test('por default, 14 Grandes clasifica por su tabla y Nacional por grupos', () => {
  assert.equal(defaultChoice(CATORCE), 'table');
  assert.equal(defaultChoice(NACIONAL), 'groups');
  // Dos grupos (pares y nones) no son la Nacional: por tabla.
  assert.equal(defaultChoice({ id: 1, groups: [{}, {}] }), 'table');
});

test('el plan completo para la estructura de ONEFA', () => {
  const { plan, error } = planOnefaMode({ conferences: [CATORCE, NACIONAL] });
  assert.equal(error, undefined);

  assert.deepEqual(plan.standings, {
    standings_levels: ['conference', 'group'],
    tiebreakers: ['wins', 'h2h_wins', 'goal_average'],
    tiebreaker_mode: 'dominant_or_points_against',
  });
  assert.deepEqual(plan.phases.map((p) => [p.name, p.type, p.counts_for_standings]), [
    ['Temporada regular', 'groups', true],
    ['Cuartos de final', 'single_elimination', false],
    ['Semifinales', 'single_elimination', false],
    ['Final', 'single_elimination', false],
  ]);

  const [q14, qNac] = plan.qualifications;
  assert.deepEqual(
    [q14.conference_id, q14.from_scope, q14.top_n, q14.plus_best_n, q14.cross_tiebreakers],
    [7, 'conference', 8, 0, null]);
  assert.deepEqual(
    [qNac.conference_id, qNac.from_scope, qNac.top_n, qNac.plus_best_n, qNac.of_rank, qNac.cross_tiebreakers],
    [8, 'group', 2, 2, 3, ['win_pct', 'goal_average']]);
  assert.ok(plan.qualifications.every((q) => q.phase === 'Temporada regular' && q.target === 'Cuartos de final'));

  assert.deepEqual(plan.titles, [
    { name: 'Campeón de conferencia', scope: 'conference', decided_by: 'match', phase: 'Final', sort_order: 1 },
  ]);
});

test('sin grupos en la rama no se publica tabla por grupo', () => {
  const { plan } = planOnefaMode({ conferences: [CATORCE, { id: 9, name: 'OTRA', groups: [] }] });
  assert.deepEqual(plan.standings.standings_levels, ['conference']);
  assert.equal(plan.phases[0].type, 'round_robin');
});

test('la elección de pantalla manda sobre el default (llaves en texto, como llegan del JSON)', () => {
  const { plan } = planOnefaMode({ conferences: [CATORCE, NACIONAL], choices: { 8: 'table' } });
  assert.equal(plan.qualifications[1].from_scope, 'conference');
  assert.equal(plan.qualifications[1].top_n, 8);
  const otra = planOnefaMode({ conferences: [CATORCE, NACIONAL], choices: { '8': 'groups' } });
  assert.equal(otra.plan.qualifications[1].from_scope, 'group');
});

test('se rechaza clasificar por grupos a una conferencia sin grupos', () => {
  const { error } = planOnefaMode({ conferences: [CATORCE, NACIONAL], choices: { 7: 'groups' } });
  assert.match(error, /14 GRANDES no tiene grupos/);
});

test('se rechaza una conferencia que no es de la rama, y una elección desconocida', () => {
  assert.match(planOnefaMode({ conferences: [CATORCE], choices: { 99: 'table' } }).error, /no es de esta rama/);
  assert.match(planOnefaMode({ conferences: [CATORCE], choices: { 7: 'sorteo' } }).error, /desconocida/);
});

test('sin conferencias no hay plan', () => {
  assert.match(planOnefaMode({ conferences: [] }).error, /conferencias/);
});

test('una rama con fases o títulos queda bloqueada, y lo dice', () => {
  assert.equal(blockedReason({ phases: 0, titles: 0 }), null);
  assert.match(blockedReason({ phases: 1, titles: 0 }), /ya tiene 1 fase\./);
  assert.match(blockedReason({ phases: 2, titles: 1 }), /2 fases y 1 título/);
});
