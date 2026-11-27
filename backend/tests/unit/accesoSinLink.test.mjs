// Pruebas de lo que decide el Panel Admin al agregar a una cuenta que ya existe a
// una organización, sin link, y al borrar una cuenta (utils/accesoSinLink.js;
// README, "Sin link: el Panel Admin agrega a una cuenta que ya existe").
//
// Lo que se fija aquí son las fronteras que no se pueden mover sin decidirlo:
//
//   1. A un equipo sin nadie adentro solo se entra como dueño, porque eso es la
//      entrega. Un coach primero haría que el equipo se diera por entregado sin
//      dueño.
//   2. Quien ya está no se toca, con el rol que sea.
//   3. El admin de la plataforma no se agrega a sí mismo ni a otro admin: en una
//      tienda, eso le saltaría el candado de su Mercado Pago.
//   4. La cuenta del único dueño de un equipo no se borra: el equipo quedaría
//      vacío y su liga lo podría volver a entregar, padrón incluido.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rolesSinLink, motivoParaNoAgregar, motivoParaNoBorrarCuenta, listaDeNombres,
} from '../../src/utils/accesoSinLink.js';
import { rolesDeTipo } from '../../src/utils/orgRoles.js';

const ALFREDO = { id: 7, name: 'Alfredo', role: 'admin' };
const ANA = { id: 90, name: 'Ana López', role: 'rep' };
const PFL = { name: 'PFL', type: 'league' };
const HALCONES = { name: 'Halcones', type: 'team' };
const TIENDA = { name: 'Deportes Cancún', type: 'store' };

const agregar = (cambios) => motivoParaNoAgregar({
  organizacion: PFL, cuenta: ANA, quienAgrega: ALFREDO, rol: 'owner', ...cambios,
});

// ── Los roles ───────────────────────────────────────────────────────────────

test('sin link se reparten los mismos roles que con un link', () => {
  for (const tipo of ['league', 'team', 'media', 'store', 'clinic', 'brand']) {
    assert.deepEqual(rolesSinLink(tipo), rolesDeTipo(tipo), tipo);
  }
});

test('a un equipo sin nadie adentro solo se entra como dueño: es la entrega', () => {
  assert.deepEqual(rolesSinLink('team', { vacio: true }), ['owner']);
  // En las demás no existe la entrega, aunque no tengan a nadie.
  assert.deepEqual(rolesSinLink('league', { vacio: true }), rolesDeTipo('league'));
  assert.deepEqual(rolesSinLink('store', { vacio: true }), rolesDeTipo('store'));
});

test('un tipo de organización que no existe no reparte nada', () => {
  assert.deepEqual(rolesSinLink('hotel'), []);
});

// ── Cuándo sí ───────────────────────────────────────────────────────────────

test('una cuenta que no está en la organización entra con cualquier rol del tipo', () => {
  for (const rol of rolesDeTipo('league')) assert.equal(agregar({ rol }), null, rol);
  for (const rol of rolesDeTipo('team')) assert.equal(agregar({ organizacion: HALCONES, rol }), null, rol);
  assert.equal(agregar({ organizacion: TIENDA, rol: 'owner' }), null);
});

test('a un equipo vacío entra como dueño: esa es la entrega', () => {
  assert.equal(agregar({ organizacion: HALCONES, rol: 'owner', vacio: true }), null);
});

// ── Cuándo no ───────────────────────────────────────────────────────────────

test('a un equipo vacío no se entra con otro rol, y se dice por qué', () => {
  for (const rol of ['admin', 'treasurer', 'roster_editor', 'coach']) {
    const m = agregar({ organizacion: HALCONES, rol, vacio: true });
    assert.equal(m?.status, 409, rol);
    assert.match(m.error, /todavía no se entrega/);
    assert.deepEqual(m.roles, ['owner']);
  }
});

test('quien ya está no se toca, con el rol que sea, y se le dice dónde cambiarlo', () => {
  const m = agregar({ rol: 'owner', rolActual: 'treasurer' });
  assert.equal(m.status, 409);
  assert.match(m.error, /ya es parte de PFL como Tesorero de liga/);
  assert.match(m.error, /Cambiar rol/);
  // Con el mismo rol que ya tiene, tampoco: no se reescribe nada.
  assert.equal(agregar({ rol: 'editor', rolActual: 'editor' }).status, 409);
  assert.match(agregar({ rol: 'editor', rolActual: 'editor' }).error, /Editor de partidos \(Visor\)/);
});

test('el admin de la plataforma no se agrega a sí mismo', () => {
  const m = agregar({ cuenta: { ...ALFREDO } });
  assert.equal(m.status, 400);
  assert.match(m.error, /No te agregas a ti/);
});

test('ni a otra cuenta de admin de la plataforma, aunque no sea la suya', () => {
  const m = agregar({ cuenta: { id: 8, name: 'Otra admin', role: 'admin' }, organizacion: TIENDA });
  assert.equal(m.status, 400);
  assert.match(m.error, /Otra admin es admin de la plataforma/);
});

test('un rol que no es de ese tipo de organización es 400, con los que sí valen', () => {
  const coachEnLiga = agregar({ rol: 'coach' });
  assert.equal(coachEnLiga.status, 400);
  assert.deepEqual(coachEnLiga.roles, rolesDeTipo('league'));
  assert.equal(agregar({ rol: 'tesorero' }).status, 400);
  assert.equal(agregar({ rol: undefined }).status, 400);
  assert.equal(agregar({ organizacion: TIENDA, rol: 'treasurer' }).status, 400);
});

test('una cuenta o una organización que no existen son 404', () => {
  assert.equal(agregar({ cuenta: null }).status, 404);
  assert.equal(agregar({ organizacion: null }).status, 404);
  assert.equal(agregar({ organizacion: { ...HALCONES, sinEntidad: true } }).status, 404);
});

test('primero a quién y a dónde, después el rol: a una cuenta que no existe no se le contesta del rol', () => {
  assert.equal(agregar({ cuenta: null, rol: 'coach' }).status, 404);
  assert.equal(agregar({ cuenta: { ...ALFREDO }, rol: 'coach' }).status, 400);
  assert.match(agregar({ cuenta: { ...ALFREDO }, rol: 'coach' }).error, /No te agregas a ti/);
  // Y quien ya está se entera de eso antes que de la regla de la entrega.
  assert.match(agregar({ organizacion: HALCONES, rol: 'coach', rolActual: 'coach', vacio: true }).error, /ya es parte/);
});

// ── Borrar una cuenta ───────────────────────────────────────────────────────

test('una cuenta que no es la del único dueño de ningún equipo se puede borrar', () => {
  assert.equal(motivoParaNoBorrarCuenta([]), null);
  assert.equal(motivoParaNoBorrarCuenta(undefined), null);
});

test('la del único dueño de un equipo no, y dice cuál y qué hacer antes', () => {
  const m = motivoParaNoBorrarCuenta(['Halcones']);
  assert.equal(m.status, 409);
  assert.match(m.error, /única cuenta con el rol de Dueño en Halcones/);
  assert.match(m.error, /ese equipo se queda sin dueño/);
  assert.match(m.error, /Agregar a una organización/);
});

test('con varios equipos los nombra a todos', () => {
  const m = motivoParaNoBorrarCuenta(['Halcones', 'Coyotes', 'Toros']);
  assert.match(m.error, /Halcones, Coyotes y Toros/);
  assert.match(m.error, /esos equipos se quedan sin dueño/);
});

test('la lista de nombres se lee como se dice', () => {
  assert.equal(listaDeNombres([]), '');
  assert.equal(listaDeNombres(['Halcones']), 'Halcones');
  assert.equal(listaDeNombres(['Halcones', 'Coyotes']), 'Halcones y Coyotes');
  assert.equal(listaDeNombres(['A', null, 'B', 'C']), 'A, B y C');
});
