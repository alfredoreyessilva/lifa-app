// Pruebas de lo que dicen las pantallas de un premio por acertar
// (src/utils/premios.js; README, "Premios por acertar").
//
// Lo que se fija aquí: que las cuatro pantallas —la página del partido, tu aviso
// del resultado, "Mis premios" y el panel de la tienda— digan lo mismo del mismo
// premio, sin "undefined", "null" ni "NaN" en ningún texto, y que el formulario
// pida lo mismo que el backend (regla 6).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DESCUENTO_MAXIMO,
  DESCUENTO_MINIMO,
  PREMIO_VACIO,
  PRIZE_FILTERS,
  VIGENCIAS,
  candadoDePremios,
  cifraDelPremio,
  estadoDelGanador,
  estadoDelPremio,
  fechaDelPremio,
  figuraDePremios,
  limpiarCodigo,
  partidoDelPremio,
  payloadDePremio,
  preciosDelPremio,
  productosParaPremiar,
  resultadoDelCodigo,
  textoDeCanjes,
  textoDelPremio,
  textoDeVigencia,
  totalesDePremios,
  tramosDeMisPremios,
  tramosDelPanel,
  validarFormularioDePremio,
} from '../../src/utils/premios.js';

const AHORA = new Date('2026-11-20T18:00:00Z');
const JERSEY = { name: 'Jersey oficial', price: 899, currency: 'MXN', image_url: null };
const PREMIO = { id: 27, discount_percent: 20, valid_days: 30, product: JERSEY, store: { id: 5, name: 'Deportes Halcón', is_verified: true } };

const SIN_HUECOS = /undefined|null|NaN/;

// ── El premio ─────────────────────────────────────────────────────────────

test('el premio se dice con su descuento y su producto, y el 100 es gratis', () => {
  assert.equal(textoDelPremio(PREMIO), '20% en Jersey oficial');
  assert.equal(textoDelPremio({ ...PREMIO, discount_percent: 100 }), 'Jersey oficial gratis');
  assert.equal(cifraDelPremio(PREMIO), '20%');
  assert.equal(cifraDelPremio({ ...PREMIO, discount_percent: 100 }), 'Gratis');
});

test('un premio a medias no pinta huecos', () => {
  for (const premio of [{}, null, undefined, { discount_percent: 15 }, { product: {} }]) {
    assert.doesNotMatch(textoDelPremio(premio), SIN_HUECOS, JSON.stringify(premio));
    assert.doesNotMatch(cifraDelPremio(premio), SIN_HUECOS);
  }
});

test('el precio de antes y el de después, como los escribe la vitrina', () => {
  assert.deepEqual(preciosDelPremio(PREMIO), { antes: '$899', despues: '$719.20', moneda: 'MXN' });
  assert.deepEqual(
    preciosDelPremio({ ...PREMIO, discount_percent: 50, product: { ...JERSEY, price: '1650.00' } }),
    { antes: '$1,650', despues: '$825', moneda: 'MXN' },
    'el precio llega de Postgres como texto',
  );
});

test('sin precio, o gratis, no hay precios que enseñar', () => {
  assert.equal(preciosDelPremio({ ...PREMIO, product: { ...JERSEY, price: null } }), null);
  assert.equal(preciosDelPremio({ ...PREMIO, discount_percent: 100 }), null);
});

test('la vigencia se dice en días después del partido', () => {
  assert.equal(textoDeVigencia(30), 'Vale 30 días después del partido');
  assert.equal(textoDeVigencia(1), 'Vale 1 día después del partido');
});

test('la fecha de un premio, en la hora de México, y con año solo si no es este', () => {
  assert.equal(fechaDelPremio('2026-12-15T06:00:00Z', AHORA), '15 dic');
  assert.equal(fechaDelPremio('2027-01-10T06:00:00Z', AHORA), '10 ene 2027');
  // A las 2 de la mañana del 16 en UTC todavía es 15 en México.
  assert.equal(fechaDelPremio('2026-12-16T02:00:00Z', AHORA), '15 dic');
  assert.equal(fechaDelPremio(null, AHORA), null);
  assert.equal(fechaDelPremio('no es fecha', AHORA), null);
});

// ── El premio de quien lo ganó ────────────────────────────────────────────

test('lo que dice tu premio: para usar, usado o vencido', () => {
  const vale = estadoDelGanador({ status: 'valid', expires_at: '2026-12-15T06:00:00Z' }, AHORA);
  assert.deepEqual(vale, { tone: 'on', label: 'Para usar', detail: 'Vence el 15 dic' });
  const usado = estadoDelGanador({ status: 'redeemed', redeemed_at: '2026-11-25T23:00:00Z' }, AHORA);
  assert.deepEqual(usado, { tone: 'off', label: 'Usado', detail: 'Lo usaste el 25 nov' });
  const vencido = estadoDelGanador({ status: 'expired', expires_at: '2026-11-18T06:00:00Z' }, AHORA);
  assert.deepEqual(vencido, { tone: 'off', label: 'Vencido', detail: 'Venció el 18 nov' });
});

test('Mis premios: primero lo que vence antes, y lo usado y lo vencido después', () => {
  const premios = [
    { id: 1, status: 'expired', expires_at: '2026-10-01T06:00:00Z' },
    { id: 2, status: 'valid', expires_at: '2026-12-30T06:00:00Z' },
    { id: 3, status: 'redeemed', redeemed_at: '2026-11-02T06:00:00Z' },
    { id: 4, status: 'valid', expires_at: '2026-11-25T06:00:00Z' },
    { id: 5, status: 'redeemed', redeemed_at: '2026-11-10T06:00:00Z' },
  ];
  const tramos = tramosDeMisPremios(premios);
  assert.deepEqual(tramos.map((t) => t.key), ['valid', 'redeemed', 'expired']);
  assert.deepEqual(tramos[0].rows.map((p) => p.id), [4, 2], 'el que vence primero, arriba');
  assert.deepEqual(tramos[1].rows.map((p) => p.id), [5, 3], 'lo último que usaste, arriba');
  assert.deepEqual(tramosDeMisPremios([{ id: 9, status: 'valid' }]).map((t) => t.key), ['valid'], 'un tramo vacío no sale');
  assert.deepEqual(tramosDeMisPremios(null), []);
});

test('la celda de Mi panel solo sale si ganaste alguno', () => {
  assert.equal(figuraDePremios([]), null);
  assert.equal(figuraDePremios(null), null);
  assert.deepEqual(figuraDePremios([{ status: 'valid' }, { status: 'redeemed' }]), { value: '2', sub: '1 para usar →' });
  assert.deepEqual(figuraDePremios([{ status: 'expired' }]), { value: '1', sub: 'Ver mis premios →' });
});

// ── El panel de la tienda ─────────────────────────────────────────────────

test('cada estado del premio tiene su palabra, y uno desconocido se lee abierto', () => {
  assert.equal(estadoDelPremio({ state: 'open' }).label, 'Abierto');
  assert.equal(estadoDelPremio({ state: 'locked' }).label, 'En juego');
  assert.equal(estadoDelPremio({ state: 'awarded' }).label, 'Entregado');
  assert.equal(estadoDelPremio({ state: 'otro' }).label, 'Abierto');
});

test('los filtros del marcador reparten cada premio en uno de sus tres estados', () => {
  const premios = [{ state: 'open' }, { state: 'open' }, { state: 'locked' }, { state: 'awarded' }];
  const contar = (key) => premios.filter(PRIZE_FILTERS.find((f) => f.key === key).test).length;
  assert.equal(contar('todos'), 4);
  assert.equal(contar('abiertos') + contar('en-juego') + contar('entregados'), 4);
});

test('la tabla en tramos: lo abierto por fecha, lo sin fecha al final, lo entregado de lo reciente a lo viejo', () => {
  const premios = [
    { prize_id: 1, state: 'awarded', match_date: '2026-11-01T18:00:00Z' },
    { prize_id: 2, state: 'open', match_date: null },
    { prize_id: 3, state: 'open', match_date: '2026-11-28T18:00:00Z' },
    { prize_id: 4, state: 'awarded', match_date: '2026-11-08T18:00:00Z' },
    { prize_id: 5, state: 'open', match_date: '2026-11-22T18:00:00Z' },
  ];
  const tramos = tramosDelPanel(premios);
  assert.deepEqual(tramos.map((t) => t.key), ['open', 'awarded']);
  assert.deepEqual(tramos[0].rows.map((p) => p.prize_id), [5, 3, 2]);
  assert.deepEqual(tramos[1].rows.map((p) => p.prize_id), [4, 1]);
});

test('lo cobrado se dice de lo entregado, y sin ganadores lo dice', () => {
  assert.equal(textoDeCanjes({ state: 'awarded', winners: '18', redeemed: '12' }), '12 de 18', 'los conteos llegan como texto');
  assert.equal(textoDeCanjes({ state: 'awarded', winners: 0, redeemed: 0 }), 'Nadie acertó');
  assert.equal(textoDeCanjes({ state: 'open', winners: 0, redeemed: 0 }), null);
  assert.deepEqual(
    totalesDePremios([
      { state: 'awarded', winners: '18', redeemed: '12' },
      { state: 'awarded', winners: 2, redeemed: 0 },
      { state: 'open', winners: 0, redeemed: 0 },
    ]),
    { ganadores: 20, canjeados: 12 },
  );
});

test('se premia con lo que está a la venta y en la vitrina, por nombre', () => {
  const productos = [
    { id: 1, name: 'Tacos', is_active: true, show_on_platform: true },
    { id: 2, name: 'Balón', is_active: true, show_on_platform: false },
    { id: 3, name: 'Casco', is_active: false, show_on_platform: true },
    { id: 4, name: 'Árbitro silbato', is_active: true, show_on_platform: true },
  ];
  assert.deepEqual(productosParaPremiar(productos).map((p) => p.id), [4, 1]);
  assert.deepEqual(productosParaPremiar(null), []);
});

test('por qué todavía no premia, en una frase, y nada si ya puede', () => {
  assert.equal(candadoDePremios({ is_public: true, is_verified: true }), null);
  assert.equal(candadoDePremios({ is_public: true, is_verified: false }), 'Tu tienda todavía no está verificada');
  assert.equal(candadoDePremios({ is_public: false, is_verified: true }), 'Tu tienda todavía no está publicada');
  assert.equal(candadoDePremios({ is_public: false, is_verified: false }), 'Tu tienda todavía no está publicada ni verificada');
  assert.equal(candadoDePremios(null), null, 'mientras no llega la tienda, no se acusa nada');
});

// ── El formulario, con los rangos del backend ─────────────────────────────

test('el formulario pide lo mismo que el backend', () => {
  assert.equal(DESCUENTO_MINIMO, 5);
  assert.equal(DESCUENTO_MAXIMO, 100);
  assert.deepEqual(VIGENCIAS, [7, 15, 30, 60]);
  const completo = { ...PREMIO_VACIO, match_id: '10', product_id: '3' };
  assert.equal(validarFormularioDePremio(completo), null);
  assert.deepEqual(payloadDePremio(completo), { match_id: 10, product_id: 3, discount_percent: 20, valid_days: 30 });
  assert.match(validarFormularioDePremio({ ...completo, match_id: '' }), /partido/);
  assert.match(validarFormularioDePremio({ ...completo, product_id: '' }), /producto/);
  for (const discount_percent of ['4', '101', '12.5', '', 'veinte']) {
    assert.match(validarFormularioDePremio({ ...completo, discount_percent }), /descuento/, discount_percent);
  }
  assert.match(validarFormularioDePremio({ ...completo, valid_days: '45' }), /días/);
});

// ── Revisar un código ─────────────────────────────────────────────────────

test('lo que se teclea se manda en mayúsculas y sin espacios en las orillas', () => {
  assert.equal(limpiarCodigo('  cfb-27-k7m2q9 '), 'CFB-27-K7M2Q9');
  assert.equal(limpiarCodigo(null), '');
});

test('lo que la tienda ve al revisar un código', () => {
  const base = { discount_percent: 20, product: JERSEY, match: { home_team: 'HALCONES', away_team: 'TIGRES' } };
  const vale = resultadoDelCodigo({ ...base, result: 'valid', expires_at: '2026-12-15T06:00:00Z' }, AHORA);
  assert.equal(vale.title, 'Vale');
  assert.equal(vale.detail, '20% en Jersey oficial · vence el 15 dic');
  assert.equal(vale.canRedeem, true);

  const usado = resultadoDelCodigo({ ...base, result: 'redeemed', redeemed_at: '2026-11-25T23:40:00Z' }, AHORA);
  assert.equal(usado.title, 'Ya se usó');
  assert.equal(usado.detail, '20% en Jersey oficial · se usó el 25 nov a las 17:40');
  assert.ok(!usado.canRedeem);

  const vencido = resultadoDelCodigo({ ...base, result: 'expired', expires_at: '2026-11-18T06:00:00Z' }, AHORA);
  assert.equal(vencido.title, 'Venció');

  const ajeno = resultadoDelCodigo({ result: 'not_found', error: 'No encontramos ese código' }, AHORA);
  assert.equal(ajeno.title, 'No es de tus premios');
  assert.ok(!ajeno.canRedeem);

  for (const r of [vale, usado, vencido, ajeno]) assert.doesNotMatch(`${r.title} ${r.detail}`, SIN_HUECOS);
});

test('el partido de un premio en una línea', () => {
  assert.equal(partidoDelPremio({ home_team: 'HALCONES', away_team: 'TIGRES' }), 'HALCONES vs TIGRES');
  assert.equal(partidoDelPremio(null), '');
});
