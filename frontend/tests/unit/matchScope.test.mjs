// Pruebas de la herencia de conferencia (utils/matchScope.js).
//
// La regla que fija este archivo: la conferencia de un partido NO se captura,
// se hereda de sus equipos. Antes se elegía en un dropdown juego por juego, y
// eso tenía dos costos — el trabajo repetido, y que un solo error de dedo
// dejaba un partido en la conferencia equivocada sin que nada lo delatara.
//
// Los tres casos que no se pueden romper:
//   1. Un equipo sin conferencia asignada se DENUNCIA por su nombre, no se
//      adivina. Adivinar es justo lo que reintroduce el error silencioso.
//   2. Local y visitante de conferencias distintas = el partido es de LAS DOS.
//      Si esto se rompe, un cruce desaparece del calendario de una de ellas.
//   3. El filtro por conferencia compara como texto: el id llega número desde
//      la API y string desde la URL, y un === crudo entre esos dos es false.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scopeName, matchInConference, inheritedConference, matchScopeLabel,
} from '../../src/utils/matchScope.js';

const CATORCE = { name: 'BORREGOS TEC GDL', conference_id: 7, conference_name: '14 GRANDES' };
const NACIONAL = { name: 'ÁGUILAS UACH', conference_id: 8, conference_name: 'NACIONAL' };
const INVITADO = { name: 'WHITTIER COLLEGE POETS' }; // sin conferencia: es de scrimmage
const EN_GRUPO = { name: 'LINCES UVM', conference_name: 'NACIONAL', group_name: 'NORTE' };

const RAMA = [CATORCE, NACIONAL, INVITADO, EN_GRUPO];

test('scopeName combina conferencia y grupo cuando el equipo está en los dos', () => {
  assert.equal(scopeName(EN_GRUPO), 'NACIONAL — NORTE');
  assert.equal(scopeName(CATORCE), '14 GRANDES');
  assert.equal(scopeName(INVITADO), null);
  assert.equal(scopeName(null), null);
});

test('scopeName usa el grupo solo cuando no hay conferencia arriba de él', () => {
  assert.equal(scopeName({ group_name: 'GRUPO A' }), 'GRUPO A');
});

test('sin los dos equipos elegidos todavía no hay nada que heredar', () => {
  assert.equal(inheritedConference('', '', RAMA).estado, 'faltan-equipos');
  assert.equal(inheritedConference('BORREGOS TEC GDL', '', RAMA).estado, 'faltan-equipos');
});

test('dos equipos de la misma conferencia: el partido la hereda', () => {
  const otro = { name: 'PUMAS UNAM CU', conference_id: 7, conference_name: '14 GRANDES' };
  const r = inheritedConference('BORREGOS TEC GDL', 'PUMAS UNAM CU', [...RAMA, otro]);
  assert.equal(r.estado, 'heredada');
  assert.equal(r.label, '14 GRANDES');
});

test('conferencias distintas: el partido pertenece a LAS DOS, no a la del local', () => {
  const r = inheritedConference('BORREGOS TEC GDL', 'ÁGUILAS UACH', RAMA);
  assert.equal(r.estado, 'cruce');
  assert.equal(r.label, '14 GRANDES × NACIONAL');
});

test('un equipo sin conferencia se denuncia por su nombre en vez de adivinarle una', () => {
  const r = inheritedConference('WHITTIER COLLEGE POETS', 'BORREGOS TEC GDL', RAMA);
  assert.equal(r.estado, 'sin-asignar');
  assert.deepEqual(r.pendientes, ['WHITTIER COLLEGE POETS']);
});

test('si a los dos les falta conferencia, se nombran los dos', () => {
  const otro = { name: 'EQUIPO NUEVO' };
  const r = inheritedConference('WHITTIER COLLEGE POETS', 'EQUIPO NUEVO', [...RAMA, otro]);
  assert.deepEqual(r.pendientes, ['WHITTIER COLLEGE POETS', 'EQUIPO NUEVO']);
});

test('el nombre se compara sin importar mayúsculas ni espacios de sobra', () => {
  const r = inheritedConference('  borregos tec gdl  ', 'ÁGUILAS UACH', RAMA);
  assert.equal(r.estado, 'cruce');
});

test('un equipo que no está inscrito en la rama cuenta como sin asignar', () => {
  const r = inheritedConference('EQUIPO FANTASMA', 'BORREGOS TEC GDL', RAMA);
  assert.equal(r.estado, 'sin-asignar');
  assert.deepEqual(r.pendientes, ['EQUIPO FANTASMA']);
});

test('una rama sin conferencias deja todo en sin-asignar, no truena', () => {
  const r = inheritedConference('A', 'B', []);
  assert.equal(r.estado, 'sin-asignar');
});

// La etiqueta que ve la afición en la página del partido y en el calendario.
// Las tres pantallas (panel, calendario, página de partido) usan esta misma
// función: si se rompe aquí, se rompe en las tres a la vez — que es justo el
// punto de que exista una sola.
test('la etiqueta del partido antepone la conferencia a su grupo', () => {
  assert.equal(
    matchScopeLabel({ conference_name: 'NACIONAL', group_name: 'NORTE' }),
    'NACIONAL — NORTE',
  );
});

test('sin grupo, la etiqueta es la conferencia sola', () => {
  assert.equal(matchScopeLabel({ conference_name: '14 GRANDES' }), '14 GRANDES');
});

test('un cruce de conferencias se etiqueta con las dos', () => {
  assert.equal(
    matchScopeLabel({ conference_name: '14 GRANDES', conference_name_2: 'NACIONAL' }),
    '14 GRANDES × NACIONAL',
  );
});

test('un cruce de grupos no repite la conferencia, que sería ruido', () => {
  assert.equal(
    matchScopeLabel({ conference_name: 'NACIONAL', group_name: 'NORTE', group_name_2: 'BAJÍO' }),
    'NORTE × BAJÍO',
  );
});

test('un partido sin conferencia no inventa etiqueta (es el caso del scrimmage)', () => {
  assert.equal(matchScopeLabel({ conference_name: null, group_name: null }), null);
  assert.equal(matchScopeLabel({}), null);
  assert.equal(matchScopeLabel(null), null);
});

test('el filtro por conferencia compara como texto (id numérico vs string de la URL)', () => {
  const partido = { conference_id: 7, conference_id_2: null };
  assert.equal(matchInConference(partido, '7'), true);
  assert.equal(matchInConference(partido, 7), true);
  assert.equal(matchInConference(partido, '8'), false);
});

test('un cruce sale al filtrar por CUALQUIERA de sus dos conferencias', () => {
  const cruce = { conference_id: 7, conference_id_2: 8 };
  assert.equal(matchInConference(cruce, '7'), true);
  assert.equal(matchInConference(cruce, '8'), true);
  assert.equal(matchInConference(cruce, '9'), false);
});

test('un partido sin conferencia no se cuela en ningún filtro', () => {
  const suelto = { conference_id: null, conference_id_2: null };
  assert.equal(matchInConference(suelto, '7'), false);
  // Y al revés: un filtro vacío no debe hacer match con los nulos del partido,
  // que es como se colaría TODO el calendario en una conferencia cualquiera.
  assert.equal(matchInConference(suelto, null), false);
  assert.equal(matchInConference(suelto, ''), false);
  assert.equal(matchInConference(suelto, undefined), false);
});
