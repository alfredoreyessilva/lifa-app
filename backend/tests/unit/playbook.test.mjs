// Pruebas del título de una imagen del playbook (utils/playbook.js).
//
// Lo que se fija es que vacío sea NULL y nunca cadena vacía: la columna se
// lee con `title || 'Sin título'` en la pantalla, y una cadena vacía es justo
// lo que `COALESCE` no se salta (el logo de visitante, 2026-10-04).

import test from 'node:test';
import assert from 'node:assert/strict';

import { limpiarTitulo, TITULO_MAX } from '../../src/utils/playbook.js';

test('un título vacío o ausente se guarda como NULL, no como cadena vacía', () => {
  for (const vacio of [undefined, null, '', '   ', '\n\t']) {
    assert.equal(limpiarTitulo(vacio), null, JSON.stringify(vacio));
  }
});

test('algo que no es texto no se vuelve título', () => {
  assert.equal(limpiarTitulo(42), null);
  assert.equal(limpiarTitulo({ title: 'x' }), null);
  assert.equal(limpiarTitulo(['Spread']), null);
});

test('se le quitan los espacios de sobra', () => {
  assert.equal(limpiarTitulo('  Spread   derecha\n 2x2 '), 'Spread derecha 2x2');
});

test('un título largo se recorta, no se rechaza, y no termina en espacio', () => {
  assert.equal(limpiarTitulo('x'.repeat(300)).length, TITULO_MAX);
  const cortado = limpiarTitulo(`${'a'.repeat(TITULO_MAX - 1)} b`);
  assert.equal(cortado, 'a'.repeat(TITULO_MAX - 1));
});
