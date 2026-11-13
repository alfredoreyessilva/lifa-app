// Pruebas de lo que calcula el Panel Admin (utils/adminPanel.js). Los casos salen
// de lo que de verdad contesta la API: conteos como texto, "CIUDAD DE MÉXICO" junto
// a "CIUDAD DE MEXICO", y solo 5 días con visitas en un mes.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ORGANIZATION_FILTERS, LEAGUE_FILTERS, attentionItems, clickRate, countFilters, fillDays, formatNumber,
  isHandedOverTeam, isNewThisMonth, leagueHasRequest, matchesSearch, niceScale, normalize, paginate,
  planStatus, pluralize, prizesSwitch, sortLeagues, sponsorTotals, switchChangedBy, toNumber, topRows,
  userFilters,
} from '../../src/utils/adminPanel.js';

test('un conteo que llega como texto se lee como número', () => {
  assert.equal(toNumber('99'), 99);
  assert.equal(toNumber(undefined), 0);
  assert.equal(formatNumber('1408'), '1,408');
});

test('el plural mira el valor, no el tipo: "1" es singular aunque llegue como texto', () => {
  assert.equal(pluralize('1', 'liga'), '1 liga');
  assert.equal(pluralize(2, 'liga'), '2 ligas');
  assert.equal(pluralize(0, 'organización', 'organizaciones'), '0 organizaciones');
});

test('buscar ignora acentos, mayúsculas y el orden de las palabras', () => {
  assert.equal(normalize('QUERÉTARO'), 'queretaro');
  assert.ok(matchesSearch('queretaro', ['QUERÉTARO']));
  assert.ok(matchesSearch('ana grizz', ['Grizzlies', 'Ana López']));
  assert.ok(!matchesSearch('ana grizz', ['Grizzlies', 'Luis']));
  assert.ok(matchesSearch('   ', ['lo que sea']));
  assert.ok(!matchesSearch('x', [null, undefined]));
});

test('una liga ya pública no cuenta como solicitud aunque el campo siga prendido', () => {
  assert.ok(leagueHasRequest({ publish_requested: true, is_public: false }));
  assert.ok(!leagueHasRequest({ publish_requested: true, is_public: true }));
  assert.ok(!leagueHasRequest({ publish_requested: false, is_public: false }));
});

test('las solicitudes van primero y lo demás conserva el orden del backend', () => {
  const ligas = [
    { id: 1 },
    { id: 2, publish_requested: true },
    { id: 3 },
    { id: 4, publish_requested: true },
  ];
  assert.deepEqual(sortLeagues(ligas).map((l) => l.id), [2, 4, 1, 3]);
  assert.deepEqual(ligas.map((l) => l.id), [1, 2, 3, 4], 'no reordena la lista original');
});

test('cada filtro de ligas cuenta sus filas y "Solicitudes" pide atención', () => {
  const ligas = [
    { is_public: true, is_verified: true },
    { is_public: false, publish_requested: true },
    { is_public: false },
  ];
  const celdas = countFilters(LEAGUE_FILTERS, ligas);
  assert.deepEqual(celdas.map((c) => [c.key, c.count]), [
    ['todas', 3], ['solicitudes', 1], ['publicas', 1], ['privadas', 2], ['verificadas', 1],
  ]);
  assert.ok(celdas.find((c) => c.key === 'solicitudes').attention);
});

test('un tipo de organización sin filas no ocupa celda, salvo que sea el filtro elegido', () => {
  const orgs = [{ type: 'media', is_verified: true }, { type: 'store' }];
  const llaves = (activo) => countFilters(ORGANIZATION_FILTERS, orgs, activo).map((c) => c.key);
  assert.deepEqual(llaves(), ['todas', 'sin_verificar', 'media', 'store']);
  assert.deepEqual(llaves('clinic'), ['todas', 'sin_verificar', 'media', 'store', 'clinic']);
});

test('"sin verificar" conserva su celda aunque esté en cero', () => {
  const orgs = [{ type: 'media', is_verified: true }];
  assert.ok(countFilters(ORGANIZATION_FILTERS, orgs).some((c) => c.key === 'sin_verificar'));
});

test('un usuario es nuevo con el mes de México, no con el de UTC', () => {
  // 2026-11-01 01:00 UTC todavía es 31 de octubre en la Ciudad de México.
  const yaEnNoviembreSoloEnUtc = { created_at: '2026-11-01T01:00:00.000Z' };
  assert.ok(!isNewThisMonth(yaEnNoviembreSoloEnUtc, new Date('2026-11-15T18:00:00Z')));
  assert.ok(isNewThisMonth({ created_at: '2026-11-02T01:00:00.000Z' }, new Date('2026-11-15T18:00:00Z')));
  assert.ok(!isNewThisMonth({ created_at: null }, new Date('2026-11-15T18:00:00Z')));
});

test('los filtros de usuarios leen `league_count` aunque llegue como texto', () => {
  const ahora = new Date('2026-11-15T18:00:00Z');
  const usuarios = [
    { role: 'admin', league_count: '0', created_at: '2026-01-02T18:00:00Z' },
    { role: 'rep', league_count: '2', created_at: '2026-11-03T18:00:00Z' },
    { role: 'rep', league_count: '0', created_at: '2026-11-03T18:00:00Z' },
  ];
  assert.deepEqual(countFilters(userFilters(ahora), usuarios).map((c) => [c.key, c.count]), [
    ['todos', 3], ['nuevos', 2], ['con_liga', 1], ['admins', 1],
  ]);
});

test('sin nada pendiente no hay nada que atender', () => {
  assert.deepEqual(attentionItems({ leagues: [], organizations: [], cron: { estado: 'ok' } }), []);
});

test('mientras algo no ha cargado no se inventa un aviso', () => {
  assert.deepEqual(attentionItems({}), []);
});

test('cada renglón por atender dice cuántos y lleva a su sección ya filtrada', () => {
  const items = attentionItems({
    leagues: [{ publish_requested: true }, { publish_requested: true }, { is_public: true }],
    organizations: [{ is_verified: false }],
    cron: { estado: 'sin_señal' },
  });
  assert.deepEqual(items.map((i) => i.text), [
    '2 ligas pidieron publicarse', '1 organización sin verificar', 'El cron no da señal',
  ]);
  assert.equal(items[0].to, '/admin?seccion=ligas&filtro=solicitudes');
  assert.equal(items[1].to, '/admin?seccion=organizaciones&filtro=sin_verificar');
  assert.equal(items[2].tone, 'bad');
});

test('un cron atrasado avisa menos fuerte que uno sin señal', () => {
  const [item] = attentionItems({ cron: { estado: 'atrasado' } });
  assert.equal(item.text, 'El cron va atrasado');
  assert.equal(item.tone, 'ask');
});

test('un equipo entregado trae liga; uno independiente, no', () => {
  assert.ok(isHandedOverTeam({ type: 'team', league_id: 3 }));
  assert.ok(!isHandedOverTeam({ type: 'team', league_id: null }));
  assert.ok(!isHandedOverTeam({ type: 'media', league_id: 3 }));
});

test('un plan Pro con la fecha vencida ya no está activo', () => {
  const ahora = new Date('2026-11-06T12:00:00Z');
  assert.ok(planStatus({ plan: 'pro', plan_expires_at: '2026-12-01T00:00:00Z' }, ahora).active);
  assert.ok(!planStatus({ plan: 'pro', plan_expires_at: '2026-10-01T00:00:00Z' }, ahora).active);
  assert.ok(planStatus({ plan: 'pro', plan_expires_at: null }, ahora).active, 'sin fecha no vence');
  assert.ok(!planStatus({ plan: 'free' }, ahora).active);
});

test('paginar dice qué filas se ven y no se queda en una página que ya no existe', () => {
  const filas = Array.from({ length: 53 }, (_, i) => i + 1);
  const dos = paginate(filas, 2, 25);
  assert.deepEqual([dos.from, dos.to, dos.pages, dos.rows.length], [26, 50, 3, 25]);
  const ultima = paginate(filas, 3, 25);
  assert.deepEqual([ultima.from, ultima.to, ultima.rows.length], [51, 53, 3]);
  assert.equal(paginate(filas.slice(0, 10), 3, 25).page, 1);
  assert.deepEqual([paginate([], 1, 25).from, paginate([], 1, 25).to, paginate([], 1, 25).pages], [0, 0, 1]);
});

test('sin impresiones no hay porcentaje de clics', () => {
  assert.equal(clickRate(0, 0), null);
  assert.equal(clickRate(200, 5), 2.5);
});

test('los totales de patrocinadores se calculan sobre las cifras, no sobre el promedio', () => {
  const totales = sponsorTotals([{ impressions: 100, clicks: 10 }, { impressions: 900, clicks: 0 }]);
  assert.deepEqual(totales, { impressions: 1000, clicks: 10, rate: 1 });
  assert.equal(sponsorTotals([]).rate, null);
});

test('el eje termina en el primer número redondo que alcanza al máximo', () => {
  assert.deepEqual(niceScale(615).values, [0, 200, 400, 600, 800]);
  assert.deepEqual(niceScale(6).values, [0, 2, 4, 6], 'un máximo redondo no agrega una marca de más');
  assert.deepEqual(niceScale(1000).values, [0, 500, 1000]);
  for (const max of [1, 3, 7, 12, 99, 100, 101, 999, 4321]) {
    const { top, values } = niceScale(max);
    assert.ok(top >= max, `tope de ${max}`);
    assert.ok(values.every(Number.isInteger), `enteros en ${max}`);
  }
});

test('una gráfica sin datos no truena la escala', () => {
  assert.deepEqual(niceScale(0).values, [0, 1]);
});

test('los 30 días van seguidos, con cero en los que no hubo visitas', () => {
  const dias = fillDays([
    { day: '2026-10-30T05:00:00.000Z', count: 6 },
    { day: '2026-11-05T00:00:00.000Z', count: 1 },
  ], '2026-11-06');
  assert.equal(dias.length, 30);
  assert.equal(dias[0].day, '2026-10-08');
  assert.equal(dias[29].day, '2026-11-06');
  assert.equal(dias[22].day, '2026-10-30');
  assert.equal(dias[22].count, 6);
  assert.equal(dias[28].count, 1);
  assert.equal(dias.reduce((suma, d) => suma + d.count, 0), 7);
});

test('un día fuera de la ventana no se suma a los 30', () => {
  const dias = fillDays([{ day: '2026-10-07', count: 50 }], '2026-11-06');
  assert.equal(dias.reduce((suma, d) => suma + d.count, 0), 0);
});

test('el ranking se recorta hasta que lo abren', () => {
  assert.deepEqual(topRows([1, 2, 3], 2, false), [1, 2]);
  assert.deepEqual(topRows([1, 2, 3], 2, true), [1, 2, 3]);
});

// La forma de GET /admin/switches: { switches: { prediction_prizes: { label,
// enabled, history } }, prizes: { active, stores } }.
test('los premios fallan cerrado: solo un true exacto los prende', () => {
  assert.equal(prizesSwitch(undefined).enabled, false);
  assert.equal(prizesSwitch({ switches: {} }).enabled, false);
  assert.equal(prizesSwitch({ switches: { prediction_prizes: { enabled: 'true' } } }).enabled, false);
  assert.equal(prizesSwitch({ switches: { prediction_prizes: { enabled: true, history: [] } } }).enabled, true);
});

test('el interruptor dice desde cuándo, lo último primero, y cuenta aunque llegue como texto', () => {
  const premios = prizesSwitch({
    switches: {
      prediction_prizes: {
        enabled: true,
        history: [
          { enabled: true, changed_at: '2026-11-13T22:00:00.000Z', changed_by_name: 'ALFREDO' },
          { enabled: false, changed_at: '2026-11-12T10:00:00.000Z', changed_by_name: null },
        ],
      },
    },
    prizes: { active: '3', stores: 2 },
  });
  assert.equal(premios.since, '2026-11-13T22:00:00.000Z');
  assert.equal(premios.active, 3);
  assert.equal(premios.stores, 2);
  assert.equal(switchChangedBy(premios.history[0]), 'ALFREDO');
  assert.equal(switchChangedBy(premios.history[1]), 'Una cuenta que ya no existe');
});

test('sin historial nadie lo ha movido: apagado, sin fecha y sin cifras inventadas', () => {
  const premios = prizesSwitch({ switches: { prediction_prizes: { enabled: false, history: [] } } });
  assert.equal(premios.enabled, false);
  assert.equal(premios.since, null);
  assert.deepEqual(premios.history, []);
  assert.equal(premios.active, 0);
  assert.equal(premios.stores, 0);
});
