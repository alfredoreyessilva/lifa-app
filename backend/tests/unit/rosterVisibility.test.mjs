// Pruebas de la regla que decide qué sale de un roster en público
// (utils/rosterVisibility.js).
//
// Lo que se fija aquí no es la tabla de verdad —eso se lee en el archivo—. Son
// las tres formas en que esta regla se puede romper en silencio, y las tres
// terminan en lo mismo: la cara de un menor de edad publicada en una página
// abierta sin que nadie lo haya decidido.
//
//   1. El default es apagado. Una categoría recién creada, o una fila a la que
//      le falte el campo, no publica nada.
//   2. El equipo baja el techo, nunca lo sube. `show_photos = true` sobre una
//      categoría que dejó la foto apagada NO la enciende.
//   3. NULL no es FALSE. Un equipo que nunca tocó el interruptor sigue a su
//      categoría; solo un FALSE explícito veta.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rosterEsPublico,
  fotoSePublica,
  fotoSePublicaSql,
  interruptoresDeCategoria,
  visibilidadDeRoster,
} from '../../src/utils/rosterVisibility.js';

// Una categoría como la crea el esquema: las dos columnas en FALSE.
const RECIEN_CREADA = { roster_public: false, roster_photos: false };
const PUBLICA_SIN_FOTO = { roster_public: true, roster_photos: false };
const PUBLICA_CON_FOTO = { roster_public: true, roster_photos: true };

// ── 1. El default es apagado, y lo que no se entiende tampoco publica ─────

test('una categoría recién creada no publica su roster', () => {
  assert.equal(rosterEsPublico(RECIEN_CREADA), false);
  assert.equal(fotoSePublica(RECIEN_CREADA, {}), false);
});

test('falla cerrado: sin categoría, o con campos que no llegaron, no se publica', () => {
  for (const categoria of [undefined, null, {}, { roster_public: undefined }, { roster_public: 'true' }]) {
    assert.equal(rosterEsPublico(categoria), false, `${JSON.stringify(categoria)} no debería publicar`);
    assert.equal(fotoSePublica(categoria, {}), false, `${JSON.stringify(categoria)} no debería publicar foto`);
  }
});

test('la foto nunca sale si el roster entero es privado', () => {
  // Estado imposible de producir desde la pantalla, pero escribible en la base
  // a mano: si alguna vez ocurre, manda el interruptor de arriba.
  assert.equal(fotoSePublica({ roster_public: false, roster_photos: true }, { show_photos: true }), false);
});

// ── 2. El equipo baja el techo, nunca lo sube ─────────────────────────────

test('un equipo NO puede encender lo que su categoría dejó apagado', () => {
  assert.equal(fotoSePublica(PUBLICA_SIN_FOTO, { show_photos: true }), false);
});

test('un equipo SÍ puede apagar la suya aunque la categoría la permita', () => {
  assert.equal(fotoSePublica(PUBLICA_CON_FOTO, { show_photos: false }), false);
});

// ── 3. NULL sigue a la categoría; solo un FALSE explícito veta ────────────

test('el equipo que nunca tocó nada no bloquea a su liga', () => {
  assert.equal(fotoSePublica(PUBLICA_CON_FOTO, { show_photos: null }), true);
  assert.equal(fotoSePublica(PUBLICA_CON_FOTO, {}), true);
  assert.equal(fotoSePublica(PUBLICA_CON_FOTO, undefined), true);
});

test('el roster público no depende del interruptor de la foto', () => {
  assert.equal(rosterEsPublico(PUBLICA_SIN_FOTO), true);
  assert.equal(fotoSePublica(PUBLICA_SIN_FOTO, { show_photos: null }), false);
});

// ── La copia de SQL dice lo mismo que la de JavaScript ────────────────────
//
// No se puede ejecutar SQL aquí (eso es lo que el CI no alcanza), así que lo
// que se fija es que la expresión nombre las tres columnas y las una con AND:
// si alguien le quita una, esto lo caza antes de que se despliegue una foto.

test('la expresión de SQL pide las tres columnas', () => {
  const sql = fotoSePublicaSql();
  assert.match(sql, /c\.roster_public/);
  assert.match(sql, /c\.roster_photos/);
  assert.match(sql, /COALESCE\(bt\.show_photos, TRUE\)/);
  assert.equal(sql.includes(' OR '), false, 'las tres condiciones van con AND, no con OR');
});

test('la expresión de SQL respeta los alias que le pasen', () => {
  const sql = fotoSePublicaSql('cat', 'inscripcion');
  assert.match(sql, /cat\.roster_photos/);
  assert.match(sql, /COALESCE\(inscripcion\.show_photos, TRUE\)/);
});

// ── Lo que se guarda al crear o editar la categoría ───────────────────────

test('sin mencionar roster_public no se toca ninguno de los dos', () => {
  assert.equal(interruptoresDeCategoria({}), null);
  assert.equal(interruptoresDeCategoria({ name: 'BANTAM' }), null);
  assert.equal(interruptoresDeCategoria({ roster_photos: true }), null);
});

test('"con foto" no se guarda sobre un roster privado', () => {
  assert.deepEqual(
    interruptoresDeCategoria({ roster_public: false, roster_photos: true }),
    { roster_public: false, roster_photos: false }
  );
});

test('solo `true` enciende: cualquier otra cosa apaga', () => {
  assert.deepEqual(
    interruptoresDeCategoria({ roster_public: 'sí', roster_photos: 1 }),
    { roster_public: false, roster_photos: false }
  );
  assert.deepEqual(
    interruptoresDeCategoria({ roster_public: true, roster_photos: true }),
    { roster_public: true, roster_photos: true }
  );
});

// ── Lo que viaja al frontend ──────────────────────────────────────────────

test('visibilidadDeRoster manda los tres valores crudos y la conclusión', () => {
  assert.deepEqual(visibilidadDeRoster(PUBLICA_CON_FOTO, { show_photos: false }), {
    roster_public: true,
    roster_photos: true,
    show_photos: false,
    photos_visible: false,
  });
  // El equipo que no ha tocado nada viaja como null, no como true: el frontend
  // tiene que poder distinguir "sigue a la categoría" de "lo dejé prendido".
  assert.deepEqual(visibilidadDeRoster(RECIEN_CREADA, {}), {
    roster_public: false,
    roster_photos: false,
    show_photos: null,
    photos_visible: false,
  });
});
