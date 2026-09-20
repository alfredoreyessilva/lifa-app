// Pruebas del candado que impide escribir en producción desde local
// (utils/prodGuard.js).
//
// Lo que de verdad importa fijar aquí NO es que bloquee — eso se ve leyendo
// la función. Es el caso que NO debe bloquear nunca: el arranque de Render.
//
// El costo de equivocarse no es simétrico. Si el candado se relaja de más, se
// escriben unas filas en la base real desde una sesión local; si se aprieta
// de más, el backend de producción no arranca y la API se cae para todos. La
// tentación natural de "mejorar" esto es tratar la AUSENCIA de
// NODE_ENV=production como señal de que es local — y ahí es exactamente donde
// se cae el servicio, porque Render corre `npm start` y nada en el repositorio
// garantiza que defina NODE_ENV. Estas pruebas están para que ese cambio
// falle en el CI en vez de en producción.

import test from 'node:test';
import assert from 'node:assert/strict';

import { decidirCandadoProduccion, hoyEnMexico } from '../../src/utils/prodGuard.js';

const PROD = 'ep-produccion.c-9.us-east-1.aws.neon.tech';
const RAMA = 'ep-rama-de-prueba.c-9.us-east-1.aws.neon.tech';
const HOY = '2026-09-19';
const AYER = '2026-09-18';

const url = (host) => `postgresql://usuario:password@${host}/neondb?sslmode=verify-full`;

const decidir = (extra) => decidirCandadoProduccion({
  databaseUrl: url(PROD),
  prodHost: PROD,
  hoyMx: HOY,
  ...extra,
});

// ── El caso que no se puede romper ───────────────────────────────────────

test('Render: `npm start` contra producción NO se bloquea', () => {
  assert.equal(decidir({ npmLifecycleEvent: 'start' }).accion, 'pasar');
});

test('Render sin NODE_ENV definida tampoco se bloquea — la ausencia no es señal', () => {
  // Este es el que tumbaría la API. Si alguien cambia la función para
  // disparar "cuando no dice production", esta prueba se pone roja.
  assert.equal(decidir({ npmLifecycleEvent: undefined, nodeEnv: undefined }).accion, 'pasar');
});

test('NODE_ENV=production contra producción no se bloquea', () => {
  assert.equal(decidir({ nodeEnv: 'production' }).accion, 'pasar');
});

// ── Lo que sí debe bloquear ──────────────────────────────────────────────

test('`npm run dev` contra producción se bloquea', () => {
  const d = decidir({ npmLifecycleEvent: 'dev' });
  assert.equal(d.accion, 'bloquear');
  assert.equal(d.host, PROD);
});

test('NODE_ENV=development contra producción se bloquea', () => {
  assert.equal(decidir({ nodeEnv: 'development' }).accion, 'bloquear');
});

// ── La salida de emergencia caduca sola ──────────────────────────────────

test('ALLOW_PROD_DB con la fecha de hoy deja pasar, avisando', () => {
  const d = decidir({ npmLifecycleEvent: 'dev', allowProdDb: HOY });
  assert.equal(d.accion, 'avisar');
  assert.equal(d.autorizado, true);
});

test('ALLOW_PROD_DB de ayer ya no sirve: vuelve a bloquear', () => {
  // El punto entero de usar una fecha y no un "1": un permiso olvidado en el
  // .env deja de valer solo al día siguiente.
  assert.equal(decidir({ npmLifecycleEvent: 'dev', allowProdDb: AYER }).accion, 'bloquear');
});

test('un ALLOW_PROD_DB cualquiera no abre el candado', () => {
  for (const valor of ['1', 'true', 'sí', '']) {
    assert.equal(decidir({ npmLifecycleEvent: 'dev', allowProdDb: valor }).accion, 'bloquear',
      `"${valor}" no debería abrir el candado`);
  }
});

// ── Lo demás ─────────────────────────────────────────────────────────────

test('`npm run dev` contra una rama de Neon pasa sin decir nada', () => {
  assert.equal(decidir({ npmLifecycleEvent: 'dev', databaseUrl: url(RAMA) }).accion, 'pasar');
});

test('sin PROD_DATABASE_HOST el candado avisa en vez de callarse', () => {
  const d = decidir({ npmLifecycleEvent: 'dev', prodHost: '' });
  assert.equal(d.accion, 'avisar');
  assert.notEqual(d.autorizado, true);
  assert.equal(d.host, PROD, 'el aviso tiene que decir a qué host se está conectando');
});

test('el host se compara sin usuario ni contraseña: el aviso no filtra credenciales', () => {
  const d = decidir({ npmLifecycleEvent: 'dev', prodHost: '' });
  assert.ok(!String(d.host).includes('password'));
  assert.equal(d.host, PROD);
});

test('una DATABASE_URL ilegible no truena: avisa con el host vacío', () => {
  const d = decidir({ npmLifecycleEvent: 'dev', databaseUrl: 'esto no es una URL', prodHost: '' });
  assert.equal(d.accion, 'avisar');
  assert.equal(d.host, null);
});

// ── La fecha de México ───────────────────────────────────────────────────

test('hoyEnMexico corta el día en México, no en UTC', () => {
  // 00:30 UTC del día 20 son las 18:30 del día 19 en México: es exactamente
  // la ventana en la que Neon (que corre en UTC) se adelanta un día.
  assert.equal(hoyEnMexico(new Date('2026-09-20T00:30:00Z')), '2026-09-19');
  assert.equal(hoyEnMexico(new Date('2026-09-19T12:00:00Z')), '2026-09-19');
});
