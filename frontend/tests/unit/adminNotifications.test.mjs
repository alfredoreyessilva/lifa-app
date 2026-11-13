// Pruebas de la sección Notificaciones del Panel Admin (utils/adminNotifications.js).
//
// El catálogo de muestra es el de verdad: se arma con utils/catalogoDeAvisos.js del
// backend, que es puro —no importa nada de npm— y vive en el mismo repositorio. Así
// estas pruebas también dicen si los datos de muestra del backend tienen la forma
// que esperan las funciones de la bandeja: un campo con otro nombre sale aquí como
// "undefined" en el texto, antes de que lo vea nadie en el panel.

import test from 'node:test';
import assert from 'node:assert/strict';

import { armarCatalogo } from '../../../backend/src/utils/catalogoDeAvisos.js';
import { matchesSearch } from '../../src/utils/adminPanel.js';
import {
  NOTIFICATION_FILTERS, channelStates, groupNotifications, notificationAudience, notificationMeta, notificationPreview,
  notificationPrizePreview, notificationReaders, notificationSearchFields, notificationText, notificationVariants,
  reachLabel, recipientsLabel,
} from '../../src/utils/adminNotifications.js';

const catalogo = armarCatalogo({
  seguidores: { notify_upcoming: 17, notify_live: 34, notify_final: 34, notify_changes: 34 },
  predicen: 1,
});
const de = (tipo) => catalogo.avisos.find((a) => a.tipo === tipo);

test('cada aviso del catálogo se lee completo, con las funciones de la bandeja', () => {
  for (const aviso of catalogo.avisos) {
    const meta = notificationMeta(aviso);
    const texto = notificationText(aviso);
    assert.ok(meta.label && meta.label !== 'Aviso', `${aviso.tipo} no tiene etiqueta propia`);
    assert.ok(texto.title, `${aviso.tipo} no tiene título`);
    for (const t of [texto, ...notificationVariants(aviso)]) {
      assert.doesNotMatch(`${t.title} ${t.body}`, /undefined|null|NaN/, `${aviso.tipo}: «${t.title} ${t.body}»`);
    }
  }
});

test('la muestra de un calculado dice lo que diría la bandeja', () => {
  assert.deepEqual(notificationText(de('final_score')), {
    title: 'Marcador final — Halcones vs Coyotes',
    body: 'Halcones 21 · Coyotes 14',
  });
  const resultado = notificationText(de('prediction_result'));
  assert.equal(resultado.title, 'Acertaste — Halcones vs Coyotes');
  assert.match(resultado.body, /\+1 punto/);
  assert.match(notificationText(de('prediction_new_matches')).body, /PLAYOFFS \(4\) y SEMIFINAL \(2\)/);

  // Las variantes cambian los datos, no el partido. La del premio no entra en
  // esta lista: dice el mismo texto que la muestra y sería un renglón repetido;
  // se enseña como tarjeta aparte (abajo).
  assert.deepEqual(notificationVariants(de('prediction_result')).map((v) => v.title), [
    'No se dio — Halcones vs Coyotes',
    'Acertaste — Halcones vs Coyotes',
  ]);
  assert.match(notificationVariants(de('schedule_change'))[2].body, /por definir/);
});

test('el aviso con premio se enseña como tarjeta, con el premio como lo manda la bandeja', () => {
  const muestra = notificationPrizePreview(de('prediction_result'), '2026-11-09T18:00:00.000Z');
  assert.ok(muestra, 'falta la variante con premio');
  assert.equal(muestra.origin, 'prediction');
  assert.equal(muestra.data.correct, true, 'un premio solo le llega a quien acertó');
  const [premio] = muestra.data.prizes;
  assert.equal(premio.status, 'valid');
  assert.match(premio.code, /^CFB-\d+-[0-9A-HJKMNP-TV-Z]{6}$/, 'el código con la forma que reparte el backend');
  for (const campo of ['discount_percent', 'product', 'store', 'expires_at']) {
    assert.ok(premio[campo] !== undefined, `al premio de muestra le falta «${campo}»`);
  }
  // Los avisos sin premio no traen esa tarjeta.
  assert.equal(notificationPrizePreview(de('final_score')), null);
  assert.equal(notificationPrizePreview(de('prediction_round')), null);
});

test('la muestra se arma con la forma de la API de la bandeja', () => {
  const guardado = notificationPreview(de('billing_overdue'), null, '2026-11-09T18:00:00.000Z');
  assert.equal(guardado.origin, 'organization');
  assert.equal(guardado.title, 'Cargo vencido 🔴');
  assert.equal(guardado.url, '#');
  assert.deepEqual(guardado.org, { name: 'Halcones', logo_url: null });
  assert.equal(guardado.at, '2026-11-09T18:00:00.000Z');

  // Sin botón en la bandeja, sin botón en la muestra.
  assert.equal(notificationPreview(de('team_claimed')).url, null);

  const sigue = notificationPreview(de('upcoming'));
  assert.equal(sigue.origin, 'follow');
  assert.equal(sigue.match.league_name, 'Liga del Valle');

  const prediccion = notificationPreview(de('prediction_round'));
  assert.equal(prediccion.origin, 'prediction');
  assert.deepEqual(prediccion.scope, { league_name: 'Liga del Valle' });

  // La variante de un guardado cambia el texto y conserva de quién es.
  const cancelado = notificationPreview(de('billing_payment_recorded'), de('billing_payment_recorded').variantes[0]);
  assert.equal(cancelado.title, 'Tu liga canceló un cargo ✅');
  assert.equal(cancelado.org.name, 'Halcones');
});

test('un correo trae su ícono, su etiqueta y su asunto', () => {
  const correo = de('sendPasswordResetEmail');
  assert.deepEqual(notificationMeta(correo), { icon: '🔑', label: 'Cambiar la contraseña', tone: 'cal' });
  assert.equal(notificationText(correo).title, '482915 es tu código para cambiar tu contraseña');
  assert.deepEqual(notificationVariants(correo), []);
});

test('las celdas del marcador cuentan a quién le llega cada aviso', () => {
  const cuenta = Object.fromEntries(
    NOTIFICATION_FILTERS.map((f) => [f.key, catalogo.avisos.filter(f.test).length]),
  );
  assert.deepEqual(cuenta, { todos: 29, aficionado: 8, liga: 11, equipo: 9, correo: 2 });
});

test('los temas salen en su orden, y uno sin avisos no sale', () => {
  const grupos = groupNotifications(catalogo.avisos, catalogo.temas);
  assert.deepEqual(grupos.map((g) => g.tema.clave), catalogo.temas.map((t) => t.clave));
  assert.equal(grupos.reduce((n, g) => n + g.avisos.length, 0), 29);

  const soloCorreos = groupNotifications(catalogo.avisos.filter((a) => a.como === 'correo'), catalogo.temas);
  assert.deepEqual(soloCorreos.map((g) => g.tema.clave), ['cuenta']);
});

test('a quién le llega y quién de adentro lo ve', () => {
  assert.equal(notificationAudience(de('billing_overdue')), 'El equipo');
  assert.equal(notificationAudience(de('org_admin_claimed')), 'La liga o el equipo');
  assert.equal(notificationAudience(de('upcoming')), 'Quien sigue el partido');

  assert.equal(notificationReaders(de('billing_overdue')), 'Dueño · Administrador · Tesorero');
  // Mismos roles en la liga y en el equipo: una sola línea.
  assert.equal(notificationReaders(de('org_admin_claimed')), 'Dueño · Administrador');
  assert.equal(
    notificationReaders({ lo_ven: { liga: ['Dueño'], equipo: ['Dueño', 'Tesorero'] } }),
    'La liga: Dueño — El equipo: Dueño · Tesorero',
  );
  assert.equal(notificationReaders(de('upcoming')), null);
});

test('cuántos les llegaron y a cuántos les puede llegar', () => {
  assert.equal(recipientsLabel(de('team_claimed'), 1), '1 liga');
  assert.equal(recipientsLabel(de('billing_overdue'), 3), '3 equipos');
  assert.equal(recipientsLabel(de('org_admin_claimed'), 2), '2 organizaciones');
  assert.equal(recipientsLabel(de('sendVerificationEmail'), 1), '1 persona');

  assert.equal(reachLabel(de('upcoming')), '17 personas pueden recibirlo');
  assert.equal(reachLabel(de('prediction_round')), '1 persona puede recibirlo');
  assert.equal(reachLabel(de('billing_overdue')), null);
});

test('la búsqueda encuentra un aviso por lo que dice, no solo por su nombre', () => {
  const encontrados = (q) => catalogo.avisos
    .filter((a) => matchesSearch(q, notificationSearchFields(a)))
    .map((a) => a.tipo);
  assert.ok(encontrados('vencido').includes('billing_overdue'));
  assert.ok(encontrados('votar').includes('prediction_reminder'));
  // Sin acentos ni mayúsculas, como el resto del panel.
  assert.ok(encontrados('CONTRASENA').includes('sendPasswordResetEmail'));
  assert.deepEqual(encontrados('broadcast_added'), ['broadcast_added']);
});

test('cada canal dice si está encendido, con su palabra', () => {
  // Push apagado a propósito: gris. Correo apagado: rojo, es un hueco (PD-38).
  assert.deepEqual(channelStates(de('upcoming'), { push: false, correo: false }), [
    { canal: 'bandeja', tone: 'on', text: 'Bandeja' },
    { canal: 'push', tone: 'off', text: 'Push en pausa' },
  ]);
  assert.deepEqual(channelStates(de('upcoming'), { push: true }).map((e) => e.text), ['Bandeja', 'Push']);
  assert.deepEqual(channelStates(de('sendVerificationEmail'), { correo: false }), [
    { canal: 'correo', tone: 'bad', text: 'Correo apagado' },
  ]);
  assert.deepEqual(channelStates(de('sendVerificationEmail'), { correo: true }).map((e) => e.tone), ['on']);
  // Lo que sale solo por la bandeja no trae otro canal que decir.
  assert.deepEqual(channelStates(de('billing_overdue'), {}).map((e) => e.canal), ['bandeja']);
});
