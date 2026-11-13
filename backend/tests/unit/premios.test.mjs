// Pruebas de las reglas de los premios por acertar (utils/premios.js; README,
// "Premios por acertar").
//
// Lo que se fija aquí es lo que se rompe en silencio:
//
//   1. El código. No se guarda: se recalcula cada vez. Si dejara de dar lo
//      mismo para la misma persona, todos los códigos ya repartidos dejarían
//      de valer sin que nadie lo notara.
//   2. Leer lo que se teclea en un mostrador, como venga.
//   3. La vigencia, que corre desde que terminó el partido y no desde una
//      fecha: un partido pospuesto no puede vencer el premio antes de jugarse.
//   4. Lo que se valida, que es lo mismo que los CHECK del esquema (regla 6).
//   5. Que el secreto no salga en lo que viaja.
//   6. Que el interruptor se llame igual en el esquema, en el backend y en el
//      Panel Admin, y que no vuelva a haber uno segundo en una variable.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DESCUENTO_MAXIMO,
  DESCUENTO_MINIMO,
  LARGO_DE_FIRMA,
  VIGENCIAS,
  VIGENCIA_MAXIMA,
  codigoDePremio,
  estadoDelCanje,
  estadoDelPremio,
  firmaDe,
  ganadorDeLaFirma,
  leerCodigo,
  nuevoSecreto,
  premioDelGanador,
  premioParaQuienLoVe,
  validarPremio,
  venceEl,
} from '../../src/utils/premios.js';

const PREMIO = { id: 27, code_secret: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' };
const SIN_CONFUSAS = /^[0-9A-HJKMNP-TV-Z]+$/;

// ── 1. El código ──────────────────────────────────────────────────────────

test('el código es el mismo cada vez para la misma persona', () => {
  assert.equal(codigoDePremio(PREMIO, 41), codigoDePremio(PREMIO, 41));
  assert.equal(firmaDe(PREMIO.code_secret, 41), firmaDe(PREMIO.code_secret, '41'), 'el id llega como número o como texto');
});

test('el código dice el premio y lleva seis caracteres sin letras que se confundan', () => {
  const codigo = codigoDePremio(PREMIO, 41);
  const [prefijo, premio, firma] = codigo.split('-');
  assert.equal(prefijo, 'CFB');
  assert.equal(premio, '27');
  assert.equal(firma.length, LARGO_DE_FIRMA);
  assert.match(firma, SIN_CONFUSAS, 'sin I, L, O ni U');
});

test('dos personas del mismo premio tienen códigos distintos', () => {
  const firmas = new Set();
  for (let userId = 1; userId <= 300; userId += 1) firmas.add(firmaDe(PREMIO.code_secret, userId));
  assert.equal(firmas.size, 300, 'dos ganadores con la misma firma');
});

test('la misma persona tiene otro código en otro premio', () => {
  const otro = { id: 28, code_secret: nuevoSecreto() };
  assert.notEqual(firmaDe(PREMIO.code_secret, 41), firmaDe(otro.code_secret, 41));
});

test('cada premio nace con su propio secreto', () => {
  const a = nuevoSecreto();
  const b = nuevoSecreto();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{32}$/);
});

test('el código de cualquier persona tiene la forma que leerCodigo entiende', () => {
  for (let userId = 1; userId <= 200; userId += 1) {
    const codigo = codigoDePremio({ id: userId * 7, code_secret: PREMIO.code_secret }, userId);
    const leido = leerCodigo(codigo);
    assert.ok(leido, codigo);
    assert.equal(leido.prizeId, userId * 7);
    assert.equal(leido.firma, codigo.split('-')[2]);
  }
});

// ── 2. Lo que se teclea en el mostrador ───────────────────────────────────

test('leerCodigo tolera minúsculas, espacios y guiones de más o de menos', () => {
  const esperado = { prizeId: 27, firma: 'K7M2Q9' };
  for (const tecleado of [
    'CFB-27-K7M2Q9', 'cfb-27-k7m2q9', ' cfb 27 k7m2q9 ', 'CFB27K7M2Q9', '27-K7M2Q9', '27K7M2Q9',
    'CFB_27_K7M2Q9', 'CFB27-K7M2Q9', 'CFB-27-K7M2 Q9', 'CFB -- 27 -- K7M2Q9',
  ]) {
    assert.deepEqual(leerCodigo(tecleado), esperado, tecleado);
  }
});

test('sin separadores, la firma son los últimos seis, aunque empiece con número', () => {
  // "CFB-27-7KM2Q9" sin guiones es "277KM2Q9": el premio es 27, no 277.
  assert.deepEqual(leerCodigo('CFB277KM2Q9'), { prizeId: 27, firma: '7KM2Q9' });
});

test('con separadores, una firma incompleta no se lee como la de otro premio', () => {
  // Sin los guiones, "27K7M2Q" sería el premio 2 con la firma 7K7M2Q.
  assert.equal(leerCodigo('CFB-27-K7M2Q'), null);
  assert.equal(leerCodigo('CFB-27-K7M2Q99'), null, 'ni una de más');
});

test('la O se lee como cero, y la I y la L como uno', () => {
  assert.deepEqual(leerCodigo('CFB-27-K7M2QO'), { prizeId: 27, firma: 'K7M2Q0' });
  assert.deepEqual(leerCodigo('CFB-27-KIM2QL'), { prizeId: 27, firma: 'K1M2Q1' });
  assert.deepEqual(leerCodigo('CFB-2O-K7M2Q9'), { prizeId: 20, firma: 'K7M2Q9' }, 'también en el número del premio');
});

test('lo que no tiene forma de código no se lee', () => {
  for (const tecleado of [
    '', 'CFB', 'K7M2Q9', 'CFB-K7M2Q9', 'CFB-27-K7M2Q', 'CFB-AB-K7M2Q9', 'CFB-0-K7M2Q9',
    'CFB-27-K7M2QU', null, undefined, 27, {},
  ]) {
    assert.equal(leerCodigo(tecleado), null, String(tecleado));
  }
});

test('el ganador de una firma es el que la tiene, y nadie más', () => {
  const ganadores = [3, 41, 58];
  assert.equal(ganadorDeLaFirma(PREMIO, firmaDe(PREMIO.code_secret, 41), ganadores), 41);
  assert.equal(ganadorDeLaFirma(PREMIO, firmaDe(PREMIO.code_secret, 99), ganadores), null, 'no acertó');
  assert.equal(ganadorDeLaFirma(PREMIO, 'ZZZZZZ', ganadores), null);
  assert.equal(ganadorDeLaFirma(PREMIO, firmaDe(PREMIO.code_secret, 41), []), null, 'sin ganadores');
});

// ── 3. La vigencia y los estados ──────────────────────────────────────────

test('vence a los N días de que terminó el partido', () => {
  const termino = new Date('2026-11-15T03:00:00Z');
  assert.equal(venceEl(termino, 30).toISOString(), '2026-12-15T03:00:00.000Z');
  assert.equal(venceEl('2026-11-15T03:00:00Z', 7).toISOString(), '2026-11-22T03:00:00.000Z');
});

test('un partido que no ha terminado no tiene vencimiento', () => {
  assert.equal(venceEl(null, 30), null);
  assert.equal(venceEl(undefined, 30), null);
  assert.equal(venceEl('no es fecha', 30), null);
});

test('usado gana a vencido, y vencido es pasada la hora', () => {
  const vence = new Date('2026-12-15T03:00:00Z');
  assert.equal(estadoDelCanje({ redeemedAt: null, vence, ahora: new Date('2026-12-01T00:00:00Z') }), 'valid');
  assert.equal(estadoDelCanje({ redeemedAt: null, vence, ahora: new Date('2026-12-15T03:00:00Z') }), 'valid', 'el último instante vale');
  assert.equal(estadoDelCanje({ redeemedAt: null, vence, ahora: new Date('2026-12-15T03:00:01Z') }), 'expired');
  assert.equal(
    estadoDelCanje({ redeemedAt: new Date('2026-12-14T00:00:00Z'), vence, ahora: new Date('2027-01-01T00:00:00Z') }),
    'redeemed',
    'un código que se cobró sigue diciendo que se usó',
  );
});

test('el premio visto desde la tienda: abierto, en juego y entregado', () => {
  assert.equal(estadoDelPremio({ votacionCerrada: false, gradableAt: null }), 'open');
  assert.equal(estadoDelPremio({ votacionCerrada: true, gradableAt: null }), 'locked');
  assert.equal(estadoDelPremio({ votacionCerrada: true, gradableAt: new Date() }), 'awarded');
});

// ── 4. Lo que se valida al poner un premio ────────────────────────────────

const VALIDO = { match_id: 10, product_id: 3, discount_percent: 20, valid_days: 30 };

test('un premio completo pasa, y los números en texto se aceptan', () => {
  assert.deepEqual(validarPremio(VALIDO), { premio: VALIDO });
  assert.deepEqual(validarPremio({ match_id: '10', product_id: '3', discount_percent: '20', valid_days: '30' }), { premio: VALIDO });
});

test('el descuento va de 5 a 100, entero, como el CHECK del esquema', () => {
  assert.equal(DESCUENTO_MINIMO, 5);
  assert.equal(DESCUENTO_MAXIMO, 100);
  for (const discount_percent of [5, 50, 100]) {
    assert.ok(validarPremio({ ...VALIDO, discount_percent }).premio, String(discount_percent));
  }
  for (const discount_percent of [0, 4, 101, 12.5, -10, '', null, undefined, 'veinte']) {
    assert.match(validarPremio({ ...VALIDO, discount_percent }).error ?? '', /descuento/, String(discount_percent));
  }
});

test('la vigencia son días, de 1 a 365, y la pantalla ofrece cuatro', () => {
  assert.deepEqual(VIGENCIAS, [7, 15, 30, 60]);
  assert.equal(VIGENCIA_MAXIMA, 365);
  for (const valid_days of VIGENCIAS) assert.ok(validarPremio({ ...VALIDO, valid_days }).premio);
  for (const valid_days of [0, 366, 2.5, null, 'mucho']) {
    assert.ok(validarPremio({ ...VALIDO, valid_days }).error, String(valid_days));
  }
});

test('sin partido o sin producto no hay premio', () => {
  assert.equal(validarPremio({ ...VALIDO, match_id: undefined }).error, 'Elige un partido');
  assert.equal(validarPremio({ ...VALIDO, product_id: 0 }).error, 'Elige un producto de tu vitrina');
  assert.ok(validarPremio().error, 'sin cuerpo');
});

// ── 5. Lo que viaja ───────────────────────────────────────────────────────

const FILA = {
  id: 27,
  match_id: 10,
  organization_id: 5,
  product_id: 3,
  product_name: 'Jersey oficial',
  product_price: '899.00',
  product_currency: 'MXN',
  product_image_url: null,
  discount_percent: 20,
  valid_days: 30,
  code_secret: PREMIO.code_secret,
  store_name: 'Deportes Halcón',
  store_logo_url: null,
  store_is_verified: true,
  gradable_at: new Date('2026-11-15T03:00:00Z'),
  redeemed_at: null,
};

test('lo que ve el público no lleva el secreto ni nada del ganador', () => {
  const premio = premioParaQuienLoVe(FILA);
  assert.ok(!JSON.stringify(premio).includes(PREMIO.code_secret), 'se coló el secreto');
  assert.equal(premio.code, undefined);
  assert.deepEqual(premio.product, { name: 'Jersey oficial', price: 899, currency: 'MXN', image_url: null });
  assert.deepEqual(premio.store, { id: 5, name: 'Deportes Halcón', logo_url: null, is_verified: true });
});

test('un producto sin precio llega sin precio, no en cero', () => {
  assert.equal(premioParaQuienLoVe({ ...FILA, product_price: null }).product.price, null);
});

test('al ganador le llega su código, cuándo vence y si ya lo usó, tampoco el secreto', () => {
  const premio = premioDelGanador(FILA, 41, new Date('2026-11-20T00:00:00Z'));
  assert.equal(premio.code, codigoDePremio(PREMIO, 41));
  assert.equal(premio.expires_at, '2026-12-15T03:00:00.000Z');
  assert.equal(premio.status, 'valid');
  assert.equal(premio.redeemed_at, null);
  assert.ok(!JSON.stringify(premio).includes(PREMIO.code_secret), 'se coló el secreto');

  const usado = premioDelGanador({ ...FILA, redeemed_at: new Date('2026-11-18T20:00:00Z') }, 41, new Date('2026-11-20T00:00:00Z'));
  assert.equal(usado.status, 'redeemed');
  assert.equal(usado.redeemed_at, '2026-11-18T20:00:00.000Z');

  const vencido = premioDelGanador(FILA, 41, new Date('2027-01-01T00:00:00Z'));
  assert.equal(vencido.status, 'expired');
});

// ── 6. El interruptor, en los tres lados ──────────────────────────────────
//
// Hasta el 2026-11-12 iba a ser la variable PREDICTION_PRIZES; es un botón del
// Panel Admin que guarda su estado en `platform_switches`. Su clave viaja en tres
// lados (regla 6): el CHECK del esquema, la lista de utils/interruptores.js —que
// aquí se lee como texto, porque importarla trae config/db.js— y la sección
// Premios del Panel Admin. Si uno cambia solo, el botón contesta 404 o el CHECK
// tira la fila, y ninguna otra prueba lo ve.

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const leer = (relativo) => fs.readFileSync(path.join(RAIZ, relativo), 'utf8');

test('el interruptor de los premios se llama igual en el esquema, en el backend y en el Panel Admin', () => {
  const check = leer('backend/src/config/db.js').match(/switch_key\s+TEXT NOT NULL CHECK \(switch_key IN \(([^)]*)\)\)/);
  assert.ok(check, 'no se encontró el CHECK de platform_switches en config/db.js');
  const delEsquema = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();

  const lista = leer('backend/src/utils/interruptores.js').match(/export const INTERRUPTORES = \{([^}]*)\}/);
  assert.ok(lista, 'no se encontró INTERRUPTORES en utils/interruptores.js');
  const delBackend = [...lista[1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]).sort();

  assert.deepEqual(delBackend, delEsquema);
  assert.ok(delBackend.includes('prediction_prizes'));
  assert.match(leer('frontend/src/components/admin/AdminPrizesSection.jsx'), /SWITCH_KEY = 'prediction_prizes'/);
  assert.match(leer('frontend/src/utils/adminPanel.js'), /switches\?\.prediction_prizes/);
});

// Con dos interruptores se podría prender el botón y olvidar el otro, que es lo
// que el del push evita teniendo uno solo (README, "El push, en pausa").
test('nadie en el backend vuelve a leer PREDICTION_PRIZES', () => {
  const pendientes = [path.join(RAIZ, 'backend/src')];
  const quienLaLee = [];
  while (pendientes.length > 0) {
    const carpeta = pendientes.pop();
    for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
      const ruta = path.join(carpeta, entrada.name);
      if (entrada.isDirectory()) pendientes.push(ruta);
      else if (ruta.endsWith('.js') && fs.readFileSync(ruta, 'utf8').includes('PREDICTION_PRIZES')) {
        quienLaLee.push(path.relative(RAIZ, ruta));
      }
    }
  }
  assert.deepEqual(quienLaLee, []);
});
