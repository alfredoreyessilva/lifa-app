// Pruebas del formato de dinero de las pantallas de cobranza (utils/money.js).
//
// Estas funciones no calculan saldos — el cálculo vive en el backend
// (BALANCE_SUM_SQL) y lo cubren las suites de punta a punta. Lo que se prueba
// aquí es lo que el tesorero LEE, que es donde un error se vuelve una
// discusión con un papá: un signo de menos de más, un "Debe" donde decía
// "A favor", o una cifra sin centavos donde sí importaban.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  money,
  moneyShort,
  fmtDate,
  timeAgo,
  balanceClass,
  balanceText,
  periodLabelFor,
  monthLabel,
} from '../../src/utils/money.js';

// ── money ────────────────────────────────────────────────────────────────

test('money siempre formatea con dos decimales y separador de miles', () => {
  assert.equal(money(1234.5), '$1,234.50');
  assert.equal(money(0), '$0.00');
  assert.equal(money(1000000), '$1,000,000.00');
});

test('money devuelve el VALOR ABSOLUTO — el signo lo pone quien llama', () => {
  // Regla del proyecto: el formateador nunca mete el signo, porque si lo
  // metiera, "Debe $800" se leería "Debe -$800" y eso se entiende al revés.
  assert.equal(money(-800), '$800.00');
  assert.equal(money(-1234.56), '$1,234.56');
});

test('money trata null/undefined/vacío como cero, sin devolver NaN', () => {
  // Una celda con "$NaN" en la pantalla de cobranza destruye la confianza en
  // toda la tabla, y llega solo con que un campo venga null de la base.
  assert.equal(money(null), '$0.00');
  assert.equal(money(undefined), '$0.00');
  assert.equal(money(''), '$0.00');
});

test('money acepta el string que devuelve Postgres para NUMERIC', () => {
  // El driver de pg entrega NUMERIC como string, no como número. Si esto se
  // rompe, TODA la cobranza se muestra mal sin que truene nada.
  assert.equal(money('1234.50'), '$1,234.50');
  assert.equal(money('-800'), '$800.00');
});

test('moneyShort quita los centavos, para los números grandes de los KPIs', () => {
  assert.equal(moneyShort(1234567.89), '$1,234,568'); // redondea
  assert.equal(moneyShort(800), '$800');
  assert.equal(moneyShort(null), '$0');
});

// ── balanceClass y balanceText ───────────────────────────────────────────

test('balanceClass distingue deber, tener a favor y estar al corriente', () => {
  assert.equal(balanceClass(-800), 'is-owed');
  assert.equal(balanceClass(800), 'is-positive');
  assert.equal(balanceClass(0), 'is-zero');
  assert.equal(balanceClass(null), 'is-zero');
});

test('balanceText dice en palabras lo mismo que el color', () => {
  // El signo se traduce a palabras aquí: negativo = debe. Invertirlo por
  // accidente le cobraría a quien está al corriente.
  assert.equal(balanceText(-800), 'Debe $800.00');
  assert.equal(balanceText(800), 'A favor $800.00');
  assert.equal(balanceText(0), 'Al corriente');
  assert.equal(balanceText(null), 'Al corriente');
});

test('balanceText y balanceClass nunca se contradicen', () => {
  const casos = [-5000, -0.01, 0, 0.01, 5000, null, undefined, '', '-250.75'];
  for (const valor of casos) {
    const clase = balanceClass(valor);
    const texto = balanceText(valor);
    if (clase === 'is-owed')     assert.match(texto, /^Debe /,    `desacuerdo en ${valor}`);
    if (clase === 'is-positive') assert.match(texto, /^A favor /, `desacuerdo en ${valor}`);
    if (clase === 'is-zero')     assert.equal(texto, 'Al corriente', `desacuerdo en ${valor}`);
  }
});

// ── fmtDate ──────────────────────────────────────────────────────────────

test('fmtDate devuelve un guion largo cuando no hay fecha', () => {
  assert.equal(fmtDate(null), '—');
  assert.equal(fmtDate(undefined), '—');
  assert.equal(fmtDate(''), '—');
});

test('fmtDate devuelve el valor original si no es una fecha parseable', () => {
  // Preferimos mostrar el dato crudo antes que "Invalid Date": si algo raro
  // llegó a la base, que se vea qué fue.
  assert.equal(fmtDate('no soy fecha'), 'no soy fecha');
});

test('fmtDate formatea una fecha real en español', () => {
  // Se usa un instante con hora (mediodía UTC) a propósito: así el resultado
  // es el mismo día tanto en el runner del CI (UTC) como en una máquina en
  // México (UTC-6). Una fecha sin hora sí cambiaría de día entre las dos.
  const salida = fmtDate('2026-09-16T12:00:00.000Z');
  assert.match(salida, /16/);
  assert.match(salida, /sep/i);
  assert.match(salida, /2026/);
});

// ── timeAgo ──────────────────────────────────────────────────────────────

const DIA = 86400000;

test('timeAgo dice hoy, ayer, días y meses', () => {
  const haceDias = (n) => new Date(Date.now() - n * DIA).toISOString();

  assert.equal(timeAgo(haceDias(0)),  'hoy');
  assert.equal(timeAgo(haceDias(1)),  'ayer');
  assert.equal(timeAgo(haceDias(3)),  'hace 3 días');
  assert.equal(timeAgo(haceDias(29)), 'hace 29 días');
  assert.equal(timeAgo(haceDias(30)), 'hace 1 mes');   // singular, no "1 meses"
  assert.equal(timeAgo(haceDias(90)), 'hace 3 meses');
});

test('timeAgo devuelve null cuando no hay nada que mostrar', () => {
  // null y no un texto: la columna "último recordatorio" se deja vacía si
  // nunca se mandó uno, en vez de decir "hace 0 días".
  assert.equal(timeAgo(null), null);
  assert.equal(timeAgo(''), null);
  assert.equal(timeAgo('no soy fecha'), null);
});

test('timeAgo no dice "hace -2 días" si la fecha está en el futuro', () => {
  const enDosDias = new Date(Date.now() + 2 * DIA).toISOString();
  assert.equal(timeAgo(enDosDias), 'hoy');
});

// ── periodLabelFor y monthLabel ──────────────────────────────────────────

test('periodLabelFor arma la etiqueta del periodo de la mensualidad', () => {
  // El mes va 0-indexado en Date: el 8 es septiembre. Este error por uno es
  // el que le cobraría a todo un club el mes equivocado.
  assert.equal(periodLabelFor(new Date(2026, 8, 16)), 'SEP-2026');
  assert.equal(periodLabelFor(new Date(2026, 0, 1)),  'ENE-2026');
  assert.equal(periodLabelFor(new Date(2026, 11, 31)), 'DIC-2026');
});

test('monthLabel abrevia el año a dos dígitos', () => {
  assert.equal(monthLabel('2026-09'), 'SEP 26');
  assert.equal(monthLabel('2026-01'), 'ENE 26');
  assert.equal(monthLabel('2026-12'), 'DIC 26');
});

test('monthLabel devuelve la entrada tal cual si el mes no existe', () => {
  assert.equal(monthLabel('2026-13'), '2026-13');
  assert.equal(monthLabel('2026-00'), '2026-00');
  assert.equal(monthLabel('basura'), 'basura');
  assert.equal(monthLabel(''), '');
});
