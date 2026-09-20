// Pruebas del catálogo de roles de una organización (utils/orgRoles.js).
//
// Lo que importa fijar aquí NO es que la tabla diga lo que dice —eso se ve
// leyéndola—. Son tres cosas que, si se rompen, se rompen en silencio:
//
//   1. La lista de roles y el CHECK del esquema no se pueden separar. `db.js`
//      construye el CHECK importando TODOS_LOS_ROLES, así que un rol que se
//      ofrece al invitar pero no está en esa lista lo rechazaría la base en el
//      INSERT — un 500 en vez de una validación.
//   2. Los permisos fallan cerrado. Un typo en el nombre de un permiso dentro
//      de una ruta tiene que dejar a alguien fuera, nunca dejar a todos adentro.
//   3. `ver` no arrastra los dos dominios sensibles. El día que alguien
//      "simplifique" dándole a `ver` el padrón y los libros, un coach pasa a
//      ver CURP de menores y contabilidad. Es justo lo que este modelo existe
//      para impedir (README, "Roles y fronteras de información").

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROLES,
  TODOS_LOS_ROLES,
  PERMISOS,
  rolesDeTipo,
  esRolValido,
  etiquetaDeRol,
  puede,
  rolesConPermiso,
  rolDeInvitacion,
} from '../../src/utils/orgRoles.js';

const TIPOS = ['league', 'team', 'media', 'store', 'clinic', 'brand'];

// ── 1. La base y el código no se pueden separar ───────────────────────────

test('todo rol ofrecido por algún tipo está en TODOS_LOS_ROLES (o la base lo rechaza)', () => {
  const ofrecidos = new Set(TIPOS.flatMap(rolesDeTipo));
  for (const rol of ofrecidos) {
    assert.ok(TODOS_LOS_ROLES.includes(rol), `"${rol}" se ofrece al invitar pero el CHECK no lo acepta`);
  }
});

test('no hay roles muertos: cada uno de TODOS_LOS_ROLES lo usa algún tipo', () => {
  const ofrecidos = new Set(TIPOS.flatMap(rolesDeTipo));
  for (const rol of TODOS_LOS_ROLES) {
    assert.ok(ofrecidos.has(rol), `"${rol}" está en el CHECK pero ningún tipo lo puede usar`);
  }
});

test('los valores son seguros de interpolar en el SQL del CHECK', () => {
  // db.js los mete literales dentro de CHECK (role IN (...)). Una comilla o un
  // espacio ahí no sería un bug de estilo, sería SQL roto en el arranque.
  for (const rol of TODOS_LOS_ROLES) {
    assert.match(rol, /^[a-z_]+$/, `"${rol}" no es un identificador simple`);
  }
});

test('toda organización puede tener dueño', () => {
  for (const tipo of TIPOS) {
    assert.ok(esRolValido(tipo, 'owner'), `${tipo} no acepta owner`);
  }
});

// ── 2. Cada rol donde va, y no en otro lado ───────────────────────────────

test('el visor es de liga y el coach es de equipo, no al revés', () => {
  assert.ok(esRolValido('league', 'editor'));
  assert.ok(!esRolValido('team', 'editor'), 'un visor no significa nada en un equipo');

  assert.ok(esRolValido('team', 'coach'));
  assert.ok(!esRolValido('league', 'coach'), 'un coach no significa nada en una liga');
});

test('medio, tienda, clínica y marca se quedan en dueño y administrador', () => {
  for (const tipo of ['media', 'store', 'clinic', 'brand']) {
    assert.deepEqual(rolesDeTipo(tipo), ['owner', 'admin'], `${tipo} cambió de roles`);
  }
});

test('el roster de torneo no es un rol de liga', () => {
  // La liga edita rosters, pero por ser liga — no hay un "editor de roster"
  // que invitar del lado de la liga.
  assert.ok(!esRolValido('league', 'roster_editor'));
  assert.ok(esRolValido('team', 'roster_editor'));
});

// ── 3. El dinero y el padrón, que es lo caro ──────────────────────────────

test('en un equipo, solo dueño, administrador y tesorero tocan dinero', () => {
  for (const permiso of ['cuotas_club', 'cobranza_liga']) {
    assert.deepEqual(rolesConPermiso('team', permiso), ['owner', 'admin', 'treasurer']);
  }
});

test('el coach ve el equipo pero NO el padrón ni los libros', () => {
  assert.ok(puede('team', 'coach', 'ver'));
  assert.ok(!puede('team', 'coach', 'cuotas_club'), 'el coach vería CURP de menores');
  assert.ok(!puede('team', 'coach', 'cobranza_liga'));
  assert.ok(!puede('team', 'coach', 'roster'), 'el coach lee el roster, no lo edita');
  assert.ok(!puede('team', 'coach', 'perfil'));
});

test('el editor de roster no toca dinero', () => {
  assert.ok(puede('team', 'roster_editor', 'roster'));
  assert.ok(!puede('team', 'roster_editor', 'cuotas_club'));
  assert.ok(!puede('team', 'roster_editor', 'cobranza_liga'));
});

test('la liga nunca tiene acceso a las cuotas del club, con ningún rol', () => {
  // El corazón del modelo: no es que un rol de liga no lo tenga, es que
  // NINGUNO lo tiene.
  assert.deepEqual(rolesConPermiso('league', 'cuotas_club'), []);
});

test('el visor solo mueve el marcador', () => {
  assert.ok(puede('league', 'editor', 'ver'));
  assert.ok(puede('league', 'editor', 'marcadores'));
  for (const prohibido of ['partidos', 'estructura', 'roster', 'cobranza_liga', 'perfil', 'miembros', 'duenos']) {
    assert.ok(!puede('league', 'editor', prohibido), `el visor no debería poder "${prohibido}"`);
  }
});

test('el tesorero de liga solo lleva la cobranza', () => {
  assert.ok(puede('league', 'treasurer', 'cobranza_liga'));
  for (const prohibido of ['estructura', 'partidos', 'marcadores', 'roster', 'perfil']) {
    assert.ok(!puede('league', 'treasurer', prohibido), `el tesorero no debería poder "${prohibido}"`);
  }
});

test('solo el dueño reparte el puesto de dueño', () => {
  for (const tipo of TIPOS) {
    assert.deepEqual(rolesConPermiso(tipo, 'duenos'), ['owner'], `${tipo} deja a alguien más nombrar dueños`);
  }
});

test('el administrador puede todo lo del dueño salvo nombrar dueños', () => {
  for (const tipo of TIPOS) {
    if (!esRolValido(tipo, 'admin')) continue;
    for (const permiso of PERMISOS) {
      if (permiso === 'duenos') continue;
      if (!puede(tipo, 'owner', permiso)) continue;
      assert.ok(puede(tipo, 'admin', permiso), `en ${tipo}, el admin no puede "${permiso}" y el owner sí`);
    }
  }
});

// ── 4. Falla cerrado ──────────────────────────────────────────────────────

test('un tipo de organización que no existe no da ningún rol', () => {
  assert.deepEqual(rolesDeTipo('federacion'), []);
  assert.ok(!esRolValido('federacion', 'owner'));
  assert.ok(!puede('federacion', 'owner', 'ver'));
});

test('un rol que no existe no puede nada', () => {
  assert.ok(!esRolValido('team', 'presidente'));
  assert.ok(!puede('team', 'presidente', 'ver'));
});

test('un permiso mal escrito devuelve false, no se ignora', () => {
  // El caso que importa: si `puede()` tratara un permiso desconocido como
  // "no aplica, déjalo pasar", un typo en una ruta abriría esa ruta a todos.
  assert.ok(!puede('team', 'owner', 'cuotas_clud'));
  assert.ok(!puede('team', 'owner', ''));
  assert.ok(!puede('team', 'owner', undefined));
});

test('rolesDeTipo devuelve una copia, no la tabla de adentro', () => {
  const roles = rolesDeTipo('team');
  roles.push('presidente');
  assert.ok(!esRolValido('team', 'presidente'), 'se pudo modificar el catálogo desde fuera');
});

// ── 5. Cómo se lee en pantalla ────────────────────────────────────────────

test('todo rol tiene etiqueta y ninguna se lee "editor" a secas', () => {
  for (const rol of TODOS_LOS_ROLES) {
    const etiqueta = etiquetaDeRol(rol);
    assert.ok(etiqueta, `"${rol}" no tiene etiqueta`);
    assert.notEqual(etiqueta.toLowerCase(), 'editor');
  }
});

test('el visor se lee como visor, nunca como su valor en la base', () => {
  assert.equal(etiquetaDeRol('editor', 'league'), 'Editor de partidos (Visor)');
  assert.match(etiquetaDeRol('editor', 'league'), /Visor/);
});

test('el tesorero de una liga se distingue del de un equipo', () => {
  assert.equal(etiquetaDeRol('treasurer', 'league'), 'Tesorero de liga');
  assert.equal(etiquetaDeRol('treasurer', 'team'), 'Tesorero');
});

test('un rol desconocido no se pinta crudo: devuelve null', () => {
  assert.equal(etiquetaDeRol('presidente', 'team'), null);
  assert.equal(etiquetaDeRol(undefined, 'team'), null);
});

test('ROLES y TODOS_LOS_ROLES no se contradicen', () => {
  assert.deepEqual(TODOS_LOS_ROLES, Object.keys(ROLES));
});

// ── 6. La invitación que no dice rol ──────────────────────────────────────
//
// `invites.role` nació en el paso 4 y las invitaciones anteriores se quedan
// en NULL para siempre. Un link repartido por WhatsApp hace tres días no se
// puede volver a probar a mano, así que lo que vale ese NULL se fija aquí.

test('una invitación sin rol vale lo que valía antes de que la columna existiera', () => {
  // El caso que importa: desplegar el paso 4 no puede cambiar en silencio con
  // qué acceso entra alguien que ya tiene el link en la mano.
  assert.equal(rolDeInvitacion({ type: 'org_admin', role: null }), 'admin');
  assert.equal(rolDeInvitacion({ type: 'team', role: null }), 'owner');
});

test('el rol escrito en la invitación le gana al default', () => {
  assert.equal(rolDeInvitacion({ type: 'org_admin', role: 'treasurer' }), 'treasurer');
  assert.equal(rolDeInvitacion({ type: 'org_admin', role: 'coach' }), 'coach');
});

test('una invitación de equipo entrega el equipo, no un acceso más', () => {
  // Reclamar la entrega es lo más fuerte que hay: da de alta como dueño de la
  // organización del equipo. Si esto dejara de ser 'owner', un equipo
  // entregado se quedaría sin nadie que pudiera repartir su propio acceso.
  assert.equal(rolDeInvitacion({ type: 'team' }), 'owner');
  assert.ok(esRolValido('team', rolDeInvitacion({ type: 'team' })));
});

test('el default de cada tipo de invitación es un rol que la base acepta', () => {
  for (const type of ['team', 'org_admin']) {
    assert.ok(TODOS_LOS_ROLES.includes(rolDeInvitacion({ type })), `el default de "${type}" no está en el CHECK`);
  }
});

test('un tipo de invitación que no existe no da ningún rol', () => {
  assert.equal(rolDeInvitacion({ type: 'federacion' }), null);
  assert.equal(rolDeInvitacion({}), null);
  assert.equal(rolDeInvitacion(null), null);
});
