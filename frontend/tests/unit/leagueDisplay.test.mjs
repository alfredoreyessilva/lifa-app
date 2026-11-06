// Pruebas de lo que la página de una liga dice de ella
// (utils/leagueDisplay.js). Los casos salen de las cuatro ligas de producción:
// "55 5541 1027" es el WhatsApp que ONEFA capturó, tal cual lo pide el
// formulario, y la lista de doce estados es la suya.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calendariosDeLiga, contactosDeLiga, encabezadoApilado, equiposEnOrden, largoDelNombre, linkDeWhatsApp,
  regionDeLiga,
} from '../../src/utils/leagueDisplay.js';

test('un número de diez dígitos es de México: wa.me lo necesita con su 52', () => {
  assert.equal(linkDeWhatsApp('55 5541 1027'), 'https://wa.me/525555411027');
  assert.equal(linkDeWhatsApp('5512345678'), 'https://wa.me/525512345678');
});

test('un número que ya trae su lada de país se queda como está', () => {
  assert.equal(linkDeWhatsApp('+52 984 176 0967'), 'https://wa.me/529841760967');
  assert.equal(linkDeWhatsApp('521 55 1234 5678'), 'https://wa.me/5215512345678');
});

test('un link de WhatsApp ya armado se respeta', () => {
  assert.equal(linkDeWhatsApp('https://wa.me/5215512345678'), 'https://wa.me/5215512345678');
  assert.equal(linkDeWhatsApp('https://chat.whatsapp.com/abc'), 'https://chat.whatsapp.com/abc');
});

test('sin número completo no hay botón', () => {
  assert.equal(linkDeWhatsApp(''), null);
  assert.equal(linkDeWhatsApp(null), null);
  assert.equal(linkDeWhatsApp('   '), null);
  assert.equal(linkDeWhatsApp('12345'), null);
  assert.equal(linkDeWhatsApp('https://'), null);
});

test('los contactos salen en orden, y solo los que la liga capturó', () => {
  const contactos = contactosDeLiga({
    tiktok_url: 'https://www.tiktok.com/@lfa_mex',
    website_url: 'https://site.lfa.mx/',
    instagram_url: '',
    whatsapp: '55 5541 1027',
    facebook_url: null,
  });
  assert.deepEqual(contactos.map((c) => c.key), ['whatsapp', 'website_url', 'tiktok_url']);
  assert.equal(contactos[0].href, 'https://wa.me/525555411027');
  assert.equal(contactos[1].label, 'Sitio web');
});

test('lo que no es un link web no llega al href de una página pública', () => {
  const contactos = contactosDeLiga({
    website_url: 'javascript:alert(1)',
    facebook_url: 'facebook.com/liga',
    instagram_url: 'https://www.instagram.com/onefamexico/',
    whatsapp: 'javascript:alert(1)',
  });
  assert.deepEqual(contactos.map((c) => c.key), ['instagram_url']);
});

test('una liga sin contactos, o sin datos todavía, no truena', () => {
  assert.deepEqual(contactosDeLiga({}), []);
  assert.deepEqual(contactosDeLiga(null), []);
});

test('la región se dice como la capturó la liga mientras quepa', () => {
  assert.equal(regionDeLiga({ state: 'NACIONAL' }), 'NACIONAL');
  assert.equal(regionDeLiga({ state: 'YUCATÁN' }), 'YUCATÁN');
  assert.equal(regionDeLiga({ state: 'CAMPECHE, QUINTANA ROO, YUCATÁN' }), 'CAMPECHE, QUINTANA ROO, YUCATÁN');
});

test('una lista larga de estados se resume', () => {
  const state = 'CIUDAD DE MÉXICO, ESTADO DE MÉXICO, JALISCO, NUEVO LEÓN, PUEBLA, QUINTANA ROO, SONORA, '
    + 'TAMAULIPAS, VERACRUZ, CHIHUAHUA, COAHUILA, QUERÉTARO';
  assert.equal(regionDeLiga({ state }), '12 estados');
});

test('sin región no hay nada que decir', () => {
  assert.equal(regionDeLiga({ state: '' }), '');
  assert.equal(regionDeLiga({ state: null }), '');
  assert.equal(regionDeLiga(null), '');
});

test('la temporada más reciente va al frente y las demás quedan como anteriores', () => {
  const { vigentes, anteriores } = calendariosDeLiga([
    { id: 25, name: 'TAZÓN MÉXICO', year: 2024 },
    { id: 17, name: 'TAZÓN MÉXICO', year: 2025 },
    { id: 23, name: 'TAZÓN MÉXICO', year: 2026 },
  ]);
  assert.deepEqual(vigentes.map((t) => t.id), [23]);
  assert.deepEqual(anteriores.map((t) => t.id), [17, 25]);
});

test('dos torneos del mismo año son los dos la temporada vigente, en el orden de la liga', () => {
  const { vigentes, anteriores } = calendariosDeLiga([
    { id: 1, name: 'APERTURA', year: '2026' },
    { id: 2, name: 'CLAUSURA', year: '2026' },
  ]);
  assert.deepEqual(vigentes.map((t) => t.id), [1, 2]);
  assert.deepEqual(anteriores, []);
});

test('un torneo sin año no le gana a uno con año, y no se pierde', () => {
  const { vigentes, anteriores } = calendariosDeLiga([
    { id: 1, name: 'SIN AÑO', year: null },
    { id: 2, name: 'LIGA', year: 2026 },
  ]);
  assert.deepEqual(vigentes.map((t) => t.id), [2]);
  assert.deepEqual(anteriores.map((t) => t.id), [1]);
});

test('sin torneos no hay calendarios, y tampoco error', () => {
  assert.deepEqual(calendariosDeLiga([]), { vigentes: [], anteriores: [] });
  assert.deepEqual(calendariosDeLiga(undefined), { vigentes: [], anteriores: [] });
});

test('los equipos van por abecedario con los acentos en su lugar', () => {
  const nombres = equiposEnOrden([
    { name: 'ZORROS CETYS' }, { name: 'ÁGUILAS UACH' }, { name: 'BORREGOS TEC MTY' }, { name: 'AZTECAS UDLAP' },
  ]).map((e) => e.name);
  assert.deepEqual(nombres, ['ÁGUILAS UACH', 'AZTECAS UDLAP', 'BORREGOS TEC MTY', 'ZORROS CETYS']);
});

test('ordenar no toca la lista que llegó de la API', () => {
  const equipos = [{ name: 'B' }, { name: 'A' }];
  equiposEnOrden(equipos);
  assert.deepEqual(equipos.map((e) => e.name), ['B', 'A']);
  assert.deepEqual(equiposEnOrden(null), []);
});

test('las cuatro ligas de hoy van de lado, con su portada de foto o de flyer', () => {
  const descripcion = 'ORGANIZACION NACIONAL ESTUDIATIL DE FUTBOL AMERICANO';
  assert.equal(encabezadoApilado({ proporcion: 1.333, nombre: 'ONEFA', descripcion }), false);
  assert.equal(encabezadoApilado({ proporcion: 1.9, nombre: 'PFL', descripcion: 'PENINSULAR FOOTBALL LEAGUE' }), false);
});

test('sin portada, o antes de que cargue, no hay proporción y eso no apila', () => {
  assert.equal(encabezadoApilado({ proporcion: null, nombre: 'OFASE', descripcion: '' }), false);
  assert.equal(encabezadoApilado({ proporcion: undefined, nombre: 'OFASE' }), false);
});

test('una portada más ancha que 2:1 se apila', () => {
  assert.equal(encabezadoApilado({ proporcion: 820 / 312, nombre: 'LFA', descripcion: '' }), true);
  assert.equal(encabezadoApilado({ proporcion: 2, nombre: 'LFA', descripcion: '' }), false);
});

test('un nombre o una descripción largos se apilan', () => {
  assert.equal(encabezadoApilado({ proporcion: 1.5, nombre: 'LIGA DE FUTBOL AMERICANO DEL NORESTE', descripcion: '' }), true);
  assert.equal(encabezadoApilado({ proporcion: 1.5, nombre: 'LFA', descripcion: 'x'.repeat(121) }), true);
  assert.equal(encabezadoApilado({ proporcion: 1.5, nombre: 'LFA', descripcion: 'x'.repeat(120) }), false);
});

test('el nombre mide lo que debe acomodar en su renglón', () => {
  assert.equal(largoDelNombre('LFA'), 3);
  assert.equal(largoDelNombre('ONEFA'), 5);
  // Veintitrés letras en dos renglones: doce por renglón.
  assert.equal(largoDelNombre('LIGA INFANTIL DEL NORTE'), 12);
  // Una palabra larga no se parte: ella pone el piso.
  assert.equal(largoDelNombre('INTERCOLEGIAL FEMENIL'), 13);
  assert.equal(largoDelNombre(''), 3);
  assert.equal(largoDelNombre(null), 3);
});
