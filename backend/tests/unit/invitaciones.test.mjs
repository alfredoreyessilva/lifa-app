// Pruebas de cuánto vive un link de invitación (utils/invitaciones.js).
//
// Lo que se fija aquí es lo que no se puede volver a probar a mano: un link
// repartido por WhatsApp hace una semana. Tres cosas:
//
//   1. El orden de los motivos. Un link usado hace un mes también está
//      caducado, y lo que se le dice es que alguien lo usó — no al revés.
//   2. Que un link caducado no diga "ya fue utilizada". Antes de que existiera
//      la caducidad esa era la única respuesta, y decirla de un link que nadie
//      usó hace pensar que alguien entró con él.
//   3. Que la vigencia se compare dentro de SQL con LOCALTIMESTAMP, que es de
//      la misma clase que `created_at` (TIMESTAMP sin zona). Comparar en
//      JavaScript la haría caducar seis horas antes o después en una PC en
//      México que en Render.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VIGENCIA_DIAS,
  vigenteSql,
  segundosRestantesSql,
  motivoInvalido,
  limpiarNota,
  NOTA_MAX,
} from '../../src/utils/invitaciones.js';

// ── 1 y 2. Qué se le contesta a un link ──────────────────────────────────────

test('un link que no existe es 404', () => {
  assert.equal(motivoInvalido(undefined).status, 404);
  assert.equal(motivoInvalido(null).status, 404);
});

test('un link vivo no tiene motivo para fallar', () => {
  assert.equal(motivoInvalido({ used_at: null, vigente: true }), null);
});

test('un link usado dice que se usó, aunque además ya haya caducado', () => {
  const m = motivoInvalido({ used_at: '2026-08-01T00:00:00Z', vigente: false });
  assert.equal(m.status, 410);
  assert.match(m.error, /utilizada/);
});

test('un link caducado dice que caducó, no que alguien lo usó', () => {
  const m = motivoInvalido({ used_at: null, vigente: false });
  assert.equal(m.status, 410);
  assert.match(m.error, /caducó/);
  assert.doesNotMatch(m.error, /utilizada/);
  assert.match(m.error, new RegExp(`${VIGENCIA_DIAS} días`));
});

test('una fila sin `vigente` calculado falla cerrado: se trata como caducada', () => {
  // Si una ruta olvida pedir la columna, el link deja de servir en vez de
  // servir para siempre, que es lo que pasaba antes de la caducidad.
  assert.equal(motivoInvalido({ used_at: null }).status, 410);
});

// ── 3. La vigencia vive en SQL, sin cruzar zonas ─────────────────────────────

test('la vigencia son 7 días', () => {
  assert.equal(VIGENCIA_DIAS, 7);
});

test('la comparación usa LOCALTIMESTAMP, no NOW() ni CURRENT_TIMESTAMP', () => {
  for (const sql of [vigenteSql('i'), segundosRestantesSql('i')]) {
    assert.match(sql, /LOCALTIMESTAMP/);
    assert.doesNotMatch(sql, /NOW\(\)|CURRENT_TIMESTAMP/);
    assert.match(sql, /INTERVAL '7 days'/);
  }
});

test('el alias se respeta, y sirve igual con el nombre de la tabla', () => {
  assert.match(vigenteSql('i'), /^i\.created_at > /);
  assert.match(vigenteSql('invites'), /^invites\.created_at > /);
});

test('los fragmentos no llevan signos de interrogación (db.prepare los volvería parámetros)', () => {
  assert.doesNotMatch(vigenteSql('i'), /\?/);
  assert.doesNotMatch(segundosRestantesSql('i'), /\?/);
});

// ── La nota de "para quién" ──────────────────────────────────────────────────

test('la nota vacía, en blanco o que no es texto es lo mismo que no ponerla', () => {
  for (const vacia of [undefined, null, '', '   ', 42, {}]) {
    assert.equal(limpiarNota(vacia), null);
  }
});

test('la nota se recorta y se le quitan los espacios de sobra, no se rechaza', () => {
  assert.equal(limpiarNota('  Yayo   Rocha '), 'Yayo Rocha');
  assert.equal(limpiarNota('x'.repeat(200)).length, NOTA_MAX);
});
