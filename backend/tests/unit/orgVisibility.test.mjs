// Pruebas de la regla que decide qué se ve de una organización en público y
// quién puede transmitir (utils/orgVisibility.js). README, "Organizaciones:
// publicar y verificar".
//
// Lo que se fija aquí son las tres formas en que se puede romper sin que nadie
// lo note:
//
//   1. Falla cerrado. Una organización recién registrada, o una fila a la que
//      le falte el campo, es privada y no transmite.
//   2. Publicar y verificar son dos cosas. Ninguna de las dos sola deja
//      transmitir — que fue justo lo que se separó el 2026-10-29.
//   3. Liga y equipo no se ocultan por aquí: tienen su propio interruptor, y
//      `organizations.is_public` no se lee para ellos.
//   4. La ficha pública trae lo que la organización llenó en su página, y nada
//      de lo que solo es para administrarla.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TIPOS_PUBLICABLES,
  esPrivadaAlPublico,
  puedeTransmitir,
  puedeTransmitirSql,
  CAMPOS_DE_FICHA,
  camposDeFichaSql,
} from '../../src/utils/orgVisibility.js';

// Un medio como lo deja `POST /organizations`: privado y sin verificar.
const RECIEN_REGISTRADO = { type: 'media', is_public: false, is_verified: false };

// ── 1. Falla cerrado ──────────────────────────────────────────────────────

test('una organización recién registrada es privada y no transmite', () => {
  assert.equal(esPrivadaAlPublico(RECIEN_REGISTRADO), true);
  assert.equal(puedeTransmitir(RECIEN_REGISTRADO), false);
});

test('sin el campo, o con uno que no es booleano, es privada', () => {
  for (const org of [{ type: 'store' }, { type: 'store', is_public: null }, { type: 'store', is_public: 'true' }]) {
    assert.equal(esPrivadaAlPublico(org), true, `${JSON.stringify(org)} debería ser privada`);
  }
});

test('sin organización no se transmite', () => {
  for (const org of [undefined, null, {}]) {
    assert.equal(puedeTransmitir(org), false);
  }
});

test('los cuatro tipos que se registran solos son los que se publican', () => {
  assert.deepEqual([...TIPOS_PUBLICABLES].sort(), ['brand', 'clinic', 'media', 'store']);
  for (const type of TIPOS_PUBLICABLES) {
    assert.equal(esPrivadaAlPublico({ type, is_public: false }), true, type);
    assert.equal(esPrivadaAlPublico({ type, is_public: true }), false, type);
  }
});

// ── 2. Publicar y verificar son dos cosas ─────────────────────────────────

test('publicado sin verificar no transmite', () => {
  assert.equal(puedeTransmitir({ type: 'media', is_public: true, is_verified: false }), false);
});

test('verificado pero privado tampoco: su logo saldría en la página del partido', () => {
  assert.equal(puedeTransmitir({ type: 'media', is_public: false, is_verified: true }), false);
});

test('publicado y verificado, sí', () => {
  assert.equal(puedeTransmitir({ type: 'media', is_public: true, is_verified: true }), true);
});

test('solo un medio transmite, aunque esté publicado y verificado', () => {
  for (const type of ['store', 'clinic', 'brand', 'league', 'team']) {
    assert.equal(puedeTransmitir({ type, is_public: true, is_verified: true }), false, type);
  }
});

test('la versión SQL pide lo mismo: medio, publicado y verificado', () => {
  assert.equal(puedeTransmitirSql('o'), "(o.type = 'media' AND o.is_public AND o.is_verified)");
  assert.equal(puedeTransmitirSql(), puedeTransmitirSql('o'), 'el alias por default es o');
  assert.ok(!puedeTransmitirSql('org').includes('?'), 'sin signos de interrogación: db.prepare los vuelve parámetros');
});

// ── 3. Liga y equipo no se ocultan por aquí ───────────────────────────────

test('una liga o un equipo nunca son privados por organizations.is_public', () => {
  // Su organización queda con is_public en FALSE (la migración no la llena),
  // y aun así no se esconden: una liga se publica con leagues.is_public y un
  // equipo con teams.show_on_platform.
  assert.equal(esPrivadaAlPublico({ type: 'league', is_public: false }), false);
  assert.equal(esPrivadaAlPublico({ type: 'team', is_public: false }), false);
});

// ── 4. Lo que enseña la ficha ─────────────────────────────────────────────

test('la ficha trae portada, redes y contacto, además de descripción y sitio web', () => {
  assert.deepEqual([...CAMPOS_DE_FICHA].sort(), [
    'contact_email', 'contact_phone', 'cover_url', 'description',
    'facebook_url', 'instagram_url', 'tiktok_url', 'website_url',
  ]);
});

test('la ficha no trae nada de lo que es solo para administrarla', () => {
  // El plan, el número del bot de WhatsApp y si está publicada no son de la
  // ficha: los lee quien la administra en GET /organizations/:id.
  for (const campo of ['plan', 'plan_expires_at', 'whatsapp_phone_number_id', 'whatsapp_display_number', 'is_public']) {
    assert.ok(!CAMPOS_DE_FICHA.includes(campo), campo);
  }
});

test('la versión SQL lleva el alias en cada columna y ningún signo de interrogación', () => {
  assert.equal(camposDeFichaSql('o'), CAMPOS_DE_FICHA.map((c) => `o.${c}`).join(', '));
  assert.equal(camposDeFichaSql(), camposDeFichaSql('o'), 'el alias por default es o');
  assert.ok(!camposDeFichaSql('org').includes('?'), 'sin signos de interrogación: db.prepare los vuelve parámetros');
});
