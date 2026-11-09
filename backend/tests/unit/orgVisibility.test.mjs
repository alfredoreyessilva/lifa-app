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
//   5. La página de una tienda no le dice al público su plan (PD-46): solo el
//      número de WhatsApp, y solo cuando la vitrina lleva el botón.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TIPOS_PUBLICABLES,
  esPrivadaAlPublico,
  puedeTransmitir,
  puedeTransmitirSql,
  CAMPOS_DE_FICHA,
  camposDeFichaSql,
  CAMPOS_DE_PAGINA,
  CAMPOS_DE_QUIEN_ADMINISTRA,
  planProVigente,
  whatsappDeVitrina,
  organizacionParaQuienLaVe,
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
    'facebook_url', 'instagram_url', 'tiktok_url', 'website_url', 'youtube_url',
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

// ── 5. La página de una tienda (PD-46) ────────────────────────────────────

const AHORA = new Date('2026-11-08T20:00:00Z');

// Una fila como la lee GET /organizations/:id: `o.*` más el país, con todo lo
// que `organizations` tiene hoy.
const fila = (extra = {}) => ({
  id: 7, name: 'Deportes Cancún', slug: 'deportes-cancun', type: 'store', country_id: 1, country_name: 'México',
  logo_url: 'https://img.test/logo.png', description: 'Uniformes', website_url: null, cover_url: null,
  facebook_url: null, instagram_url: null, youtube_url: null, tiktok_url: null,
  contact_email: null, contact_phone: '998 123 4567',
  status: 'active', created_at: new Date('2026-10-01T12:00:00Z'), is_verified: false, is_public: true,
  plan: 'pro', plan_expires_at: new Date('2026-12-03T06:00:00Z'),
  whatsapp_phone_number_id: '1234567890', whatsapp_display_number: '+52 998 123 4567',
  ...extra,
});

const PRIVADOS = ['is_public', 'plan', 'plan_expires_at', 'whatsapp_display_number', 'whatsapp_phone_number_id'];

test('el público no ve el plan, su vencimiento ni los datos del bot', () => {
  const vista = organizacionParaQuienLaVe(fila(), { ahora: AHORA });
  for (const campo of PRIVADOS) assert.ok(!(campo in vista), campo);
  // Lo de la página sí, con la ficha completa.
  for (const campo of [...CAMPOS_DE_PAGINA, ...CAMPOS_DE_FICHA]) assert.ok(campo in vista, campo);
});

test('una columna que no está en las listas no sale, para nadie', () => {
  const conAlgoNuevo = fila({ notas_internas: 'debe 3 meses' });
  assert.ok(!('notas_internas' in organizacionParaQuienLaVe(conAlgoNuevo, { ahora: AHORA })));
  assert.ok(!('notas_internas' in organizacionParaQuienLaVe(conAlgoNuevo, { administra: true, ahora: AHORA })));
});

test('quien la administra ve su plan y su número; el id de Meta, tampoco él', () => {
  const vista = organizacionParaQuienLaVe(fila(), { administra: true, ahora: AHORA });
  assert.equal(vista.plan, 'pro');
  assert.equal(vista.is_public, true);
  assert.equal(vista.whatsapp_display_number, '+52 998 123 4567');
  assert.deepEqual(vista.plan_expires_at, new Date('2026-12-03T06:00:00Z'));
  assert.ok(!('whatsapp_phone_number_id' in vista));
  assert.deepEqual(CAMPOS_DE_QUIEN_ADMINISTRA.filter((c) => CAMPOS_DE_PAGINA.includes(c)), [], 'las listas no se pisan');
});

test('lo privado no se cuela en la lista pública', () => {
  for (const campo of PRIVADOS) assert.ok(!CAMPOS_DE_PAGINA.includes(campo), campo);
});

test('el plan Pro vale hasta su fecha, sin fecha no vence, y una fecha ilegible cuenta como vencida', () => {
  assert.equal(planProVigente(fila(), AHORA), true);
  assert.equal(planProVigente(fila({ plan_expires_at: null }), AHORA), true);
  assert.equal(planProVigente(fila({ plan_expires_at: '2026-11-01T06:00:00Z' }), AHORA), false);
  assert.equal(planProVigente(fila({ plan_expires_at: AHORA }), AHORA), false, 'el instante en que vence ya no es Pro');
  assert.equal(planProVigente(fila({ plan_expires_at: 'mañana' }), AHORA), false);
  assert.equal(planProVigente(fila({ plan: 'free', plan_expires_at: null }), AHORA), false);
  assert.equal(planProVigente(null, AHORA), false);
});

test('al público le llega el número solo cuando la vitrina lleva el botón', () => {
  const encendido = organizacionParaQuienLaVe(fila(), { ahora: AHORA });
  assert.equal(encendido.storefront_whatsapp, '+52 998 123 4567');

  const apagados = [
    fila({ plan: 'free', plan_expires_at: null }),               // sin plan
    fila({ plan_expires_at: new Date('2026-11-01T06:00:00Z') }), // plan vencido
    fila({ whatsapp_display_number: null }),                     // sin número
    fila({ whatsapp_display_number: '   ' }),
    fila({ type: 'media' }),                                     // no es una tienda: no tiene vitrina
  ];
  for (const org of apagados) {
    assert.equal(organizacionParaQuienLaVe(org, { ahora: AHORA }).storefront_whatsapp, null, JSON.stringify(org));
    assert.equal(whatsappDeVitrina(org, AHORA), null);
  }
});

test('sin decir quién pregunta, es el público', () => {
  const vista = organizacionParaQuienLaVe(fila());
  assert.ok(!('plan' in vista));
});
