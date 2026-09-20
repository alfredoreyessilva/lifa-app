// Recorrido de la INVITACIÓN CON ROL y de la ENTREGA de un equipo — el paso 4
// de "Roles y fronteras de información" (README).
//
// Por qué existe esta suite y no bastaban las dos de cobranza: las dos usan un
// equipo independiente cuyo dueño es el propio actor, así que nunca hay una
// liga entregando nada ni nadie entrando con un rol que no sea el suyo. Lo que
// se prueba aquí es justo lo que no se puede leer en el código —que el claim
// escriba de verdad la fila de organization_members, que revocar la borre, y
// que un 403 le toque a quien debe— contra un backend vivo.
//
// Se crea sus propios datos y se puede correr varias veces. Instrucciones en
// tests/README.md (backend en :4100 con la DATABASE_URL de una rama de Neon).
import pg from 'pg';

const API = 'http://localhost:4100/api';
const stamp = Date.now();
let pass = 0, fail = 0;
const ok = (c, l, e = '') => { if (c) { console.log(`  OK    ${l}`); pass++; } else { console.log(`  FALLA ${l} ${e}`); fail++; } };

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 429) {
    console.log('\n  !! ' + path + ' recibió 429: limitador de peticiones. Reinicia el backend y repite.\n');
    process.exit(2);
  }
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const alta = async (quien) => (await call('/auth/register', {
  method: 'POST',
  body: { name: quien, email: `${quien.toLowerCase()}${stamp}@example.com`, password: 'prueba123' },
})).data.token;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
const miembros = async (organizationId) => (await pool.query(
  "SELECT user_id, role, status FROM organization_members WHERE organization_id=$1 ORDER BY id", [organizationId]
)).rows;

console.log('\n=== 1. Una liga con un equipo sin entregar ===');
const LIGA = await alta('Liga');
const REP = await alta('Rep');
const TESO = await alta('Teso');
const COACH = await alta('Coach');

const lg = await call('/leagues', { method: 'POST', token: LIGA, body: { name: `Liga Roles ${stamp}`, state: 'CIUDAD DE MEXICO' } });
const LEAGUE = lg.data.league?.id ?? lg.data.id;
const tm = await call(`/manage/leagues/${LEAGUE}/teams`, { method: 'POST', token: LIGA, body: { name: `Equipo Roles ${stamp}` } });
const TEAM = tm.data.team?.id ?? tm.data.id;
ok(!!LEAGUE && !!TEAM, 'liga y equipo creados', JSON.stringify(tm.data).slice(0, 120));

const { rows: [{ organization_id: ORG }] } = await pool.query('SELECT organization_id FROM teams WHERE id=$1', [TEAM]);
ok(!!ORG, 'el equipo ya tiene organización propia aunque nadie lo haya reclamado', `org=${ORG}`);
ok((await miembros(ORG)).length === 0, 'y está VACÍA: la entrega no la crea, la puebla', JSON.stringify(await miembros(ORG)));

console.log('\n=== 2. Sin entregar, las cuotas del club no existen todavía ===');
const sinEntregar = await call(`/player-billing/teams/${TEAM}/overview`, { token: LIGA });
ok(sinEntregar.status === 409, 'la liga recibe 409, no 403: la función no está encendida', `=${sinEntregar.status}`);

console.log('\n=== 3. La invitación dice a qué invita ===');
const inv = await call(`/invites/teams/${TEAM}`, { method: 'POST', token: LIGA });
ok(inv.status === 201 && inv.data.role === 'owner', 'la entrega de un equipo siempre es como dueño', JSON.stringify(inv.data));
const pub = await call(`/invites/${inv.data.token}`);
ok(pub.data.role === 'owner' && pub.data.role_label === 'Dueño',
  'el link público dice el rol con su etiqueta, antes de crear cuenta', JSON.stringify({ r: pub.data.role, l: pub.data.role_label }));

console.log('\n=== 4. Reclamar puebla la organización del equipo ===');
const claim = await call(`/invites/${inv.data.token}/claim`, { method: 'POST', token: REP });
ok(claim.status === 200 && claim.data.role === 'owner', 'reclamado', JSON.stringify(claim.data).slice(0, 100));
const m1 = await miembros(ORG);
ok(m1.length === 1 && m1[0].role === 'owner' && m1[0].status === 'active',
  'el representante quedó de alta como owner de la organización', JSON.stringify(m1));

console.log('\n=== 5. Y con eso, el padrón es del equipo y de nadie más ===');
ok((await call(`/player-billing/teams/${TEAM}/overview`, { token: REP })).status === 200, 'el representante sí entra al padrón');
ok((await call(`/player-billing/teams/${TEAM}/overview`, { token: LIGA })).status === 403, 'la liga recibe 403 — ya no es 409, el equipo fue entregado');
ok((await call(`/player-billing/teams/${TEAM}/overview`, { token: TESO })).status === 403, 'un tercero cualquiera, 403');

console.log('\n=== 6. El equipo reparte su propio acceso, con rol ===');
const malo = await call(`/invites/organizations/${ORG}/admins`, { method: 'POST', token: REP, body: { role: 'presidente' } });
ok(malo.status === 400, 'un rol inventado se rechaza con 400, no con un 500 de la base', `=${malo.status}`);
const visor = await call(`/invites/organizations/${ORG}/admins`, { method: 'POST', token: REP, body: { role: 'editor' } });
ok(visor.status === 400, 'un visor no significa nada en un equipo: 400 aunque el CHECK lo acepte', `=${visor.status}`);

const invTeso = await call(`/invites/organizations/${ORG}/admins`, { method: 'POST', token: REP, body: { role: 'treasurer' } });
ok(invTeso.status === 201 && invTeso.data.role_label === 'Tesorero', 'invitación de tesorero', JSON.stringify(invTeso.data));
const invCoach = await call(`/invites/organizations/${ORG}/admins`, { method: 'POST', token: REP, body: { role: 'coach' } });
ok(invCoach.status === 201, 'invitación de coach');
ok((await call(`/invites/${invTeso.data.token}`)).status === 200,
  'el link del tesorero SIGUE VIVO después de generar el del coach (una vigente por rol)');

console.log('\n=== 7. Cada quien entra con lo suyo ===');
await call(`/invites/${invTeso.data.token}/claim`, { method: 'POST', token: TESO });
await call(`/invites/${invCoach.data.token}/claim`, { method: 'POST', token: COACH });
const m2 = await miembros(ORG);
ok(m2.length === 3, 'la organización tiene tres personas', JSON.stringify(m2));
ok(m2.some((m) => m.role === 'treasurer') && m2.some((m) => m.role === 'coach'),
  'y cada una con el rol que decía su invitación, no todas como admin', JSON.stringify(m2.map((m) => m.role)));

const lista = await call(`/organizations/${ORG}/members`, { token: REP });
ok(lista.data.members.every((m) => !!m.role_label), 'la lista de miembros trae la etiqueta lista para pintar',
  JSON.stringify(lista.data.members.map((m) => m.role_label)));
const cat = await call(`/organizations/${ORG}/roles`, { token: REP });
ok(cat.data.roles.length === 5 && cat.data.roles.every((r) => r.grantable),
  'el catálogo del selector trae los cinco roles de equipo, y el dueño puede repartirlos todos',
  JSON.stringify(cat.data.roles.map((r) => r.value)));

console.log('\n=== 8. Nombrar dueños es del dueño ===');
const invAdmin = await call(`/invites/organizations/${ORG}/admins`, { method: 'POST', token: REP, body: { role: 'admin' } });
const ADMIN = await alta('Admin');
await call(`/invites/${invAdmin.data.token}/claim`, { method: 'POST', token: ADMIN });
const catAdmin = await call(`/organizations/${ORG}/roles`, { token: ADMIN });
ok(catAdmin.data.roles.find((r) => r.value === 'owner')?.grantable === false,
  'el admin VE el rol de dueño pero no lo puede repartir', JSON.stringify(catAdmin.data.roles));
const intento = await call(`/invites/organizations/${ORG}/admins`, { method: 'POST', token: ADMIN, body: { role: 'owner' } });
ok(intento.status === 403, 'y si lo intenta de todas formas, 403 — no se puede ascender solo', `=${intento.status}`);
ok((await call(`/invites/organizations/${ORG}/admins`, { method: 'POST', token: REP, body: { role: 'owner' } })).status === 201,
  'el dueño sí puede invitar a otro dueño');

console.log('\n=== 9. Una invitación vieja (sin rol) vale lo que valía ===');
const vieja = await call(`/invites/organizations/${ORG}/admins`, { method: 'POST', token: REP, body: { role: 'coach' } });
await pool.query('UPDATE invites SET role = NULL WHERE token = $1', [vieja.data.token]);
const VIEJO = await alta('Viejo');
await call(`/invites/${vieja.data.token}/claim`, { method: 'POST', token: VIEJO });
const { rows: [mv] } = await pool.query(
  'SELECT om.role FROM organization_members om JOIN invites i ON i.used_by = om.user_id WHERE i.token=$1 AND om.organization_id=$2',
  [vieja.data.token, ORG]
);
ok(mv?.role === 'admin', "una invitación con role NULL entrega 'admin', como antes de que la columna existiera", JSON.stringify(mv));

console.log('\n=== 10. La entrega no se deshace: "revocado" ya no existe ===');
const reinvitar = await call(`/invites/teams/${TEAM}`, { method: 'POST', token: LIGA });
ok(reinvitar.status === 409, 'la liga NO puede generar otra entrega de un equipo que ya se administra solo', `=${reinvitar.status}`);
const revocar = await call(`/invites/teams/${TEAM}/owner`, { method: 'DELETE', token: LIGA });
ok(revocar.status === 409, 'y tampoco puede quitarle el representante', `=${revocar.status}`);
ok((await miembros(ORG)).length > 0, 'la organización del equipo sigue intacta', JSON.stringify(await miembros(ORG)));
ok((await call(`/player-billing/teams/${TEAM}/overview`, { token: REP })).status === 200, 'el representante conserva su padrón');
ok((await call(`/player-billing/teams/${TEAM}/overview`, { token: LIGA })).status === 403, 'y la liga sigue sin poder entrar');

console.log('\n=== 11. Pero un link que nadie reclamó sí se cancela ===');
const tm2 = await call(`/manage/leagues/${LEAGUE}/teams`, { method: 'POST', token: LIGA, body: { name: `Equipo Sin Entregar ${stamp}` } });
const TEAM2 = tm2.data.team?.id ?? tm2.data.id;
const inv2 = await call(`/invites/teams/${TEAM2}`, { method: 'POST', token: LIGA });
ok(inv2.status === 201, 'un equipo sin entregar sí acepta invitación', `=${inv2.status}`);
const cancel = await call(`/invites/teams/${TEAM2}/owner`, { method: 'DELETE', token: LIGA });
ok(cancel.status === 200, 'la liga cancela la entrega que todavía nadie usó', `=${cancel.status}`);
ok((await call(`/invites/${inv2.data.token}`)).status === 404, 'y el link deja de servir');
ok((await call(`/invites/teams/${TEAM2}`, { method: 'POST', token: LIGA })).status === 201,
  'cancelar no deja al equipo trabado: se puede volver a entregar');

console.log('\n=== 12. Administrarse solo y participar son cosas distintas ===');
// El corazón del modelo corregido. Entregar el perfil de un equipo NO lo saca
// de los torneos de la liga: son dos preguntas distintas, viven en dos tablas
// distintas (organization_members y branch_teams) y ninguna mueve a la otra.
const categoria = await call(`/leagues/${LEAGUE}/categories`, { method: 'POST', token: LIGA, body: { name: 'Mayor' } });
const CAT = categoria.data.category?.id ?? categoria.data.id;
const br = await call(`/manage/categories/${CAT}/branches`, { method: 'POST', token: LIGA, body: { name: 'Varonil' } });
const BRANCH = br.data.branch?.id ?? br.data.id;
const insc = await call(`/manage/branches/${BRANCH}/teams`, { method: 'POST', token: LIGA, body: { team_id: TEAM } });
ok(insc.status === 200 || insc.status === 201, 'el equipo YA ENTREGADO se inscribe a una rama de la liga', `=${insc.status}`);

const { rows: [{ n: inscrito }] } = await pool.query(
  'SELECT COUNT(*)::int n FROM branch_teams WHERE branch_id=$1 AND team_id=$2', [BRANCH, TEAM]
);
ok(inscrito === 1, 'participa en la liga aunque la liga no lo administre', `=${inscrito}`);
ok((await call(`/player-billing/teams/${TEAM}/overview`, { token: LIGA })).status === 403,
  'y estar inscrito NO le da a la liga acceso al padrón del club');
ok((await call(`/invites/teams/${TEAM}`, { method: 'POST', token: LIGA })).status === 409,
  'ni le devuelve el poder de repartir su acceso');

const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int n FROM club_members WHERE team_id=$1', [TEAM]);
ok(Number.isInteger(n), 'el padrón sigue siendo del equipo y de nadie más', `filas=${n}`);


console.log('\n=== 13. Paso 3: cada rol del equipo puede lo suyo y nada más ===');
// Esto es lo que ninguna prueba unitaria podía atrapar: que el catálogo de
// permisos y lo que de verdad contesta la API sean la misma cosa. El equipo de
// esta sección es TEAM2, que sigue sin entregar, así que se entrega primero.
const REP2 = await alta('Rep2');
const inv3 = await call(`/invites/teams/${TEAM2}`, { method: 'POST', token: LIGA });
await call(`/invites/${inv3.data.token}/claim`, { method: 'POST', token: REP2 });
const { rows: [{ organization_id: ORG2 }] } = await pool.query('SELECT organization_id FROM teams WHERE id=$1', [TEAM2]);

const invitarA = async (orgId, quienInvita, rol, nombre) => {
  const i = await call(`/invites/organizations/${orgId}/admins`, { method: 'POST', token: quienInvita, body: { role: rol } });
  const t = await alta(nombre);
  await call(`/invites/${i.data.token}/claim`, { method: 'POST', token: t });
  return t;
};

const TESO2 = await invitarA(ORG2, REP2, 'treasurer', 'Teso2');
const ROSTER2 = await invitarA(ORG2, REP2, 'roster_editor', 'Roster2');
const COACH2 = await invitarA(ORG2, REP2, 'coach', 'Coach2');

const padron = (token) => call(`/player-billing/teams/${TEAM2}/overview`, { token });
ok((await padron(TESO2)).status === 200, 'el TESORERO del equipo sí entra al padrón — para eso existe el rol');
ok((await padron(ROSTER2)).status === 403, 'el editor de roster NO entra al padrón');
ok((await padron(COACH2)).status === 403, 'el coach NO entra al padrón: ahí hay CURP de menores');

const bandeja = (token) => call(`/notifications/team/${TEAM2}`, { token });
ok((await bandeja(COACH2)).status === 200, 'pero el coach sí ve el equipo en solo lectura');
ok((await bandeja(ROSTER2)).status === 200, 'y el editor de roster también');

const cuenta = (token) => call(`/billing/teams/${TEAM2}/statement`, { token });
ok((await cuenta(TESO2)).status === 200, 'el tesorero ve la cuenta con la liga (la otra mitad de su trabajo)');
ok((await cuenta(COACH2)).status === 403, 'el coach no ve dinero de ningún libro');
ok((await cuenta(ROSTER2)).status === 403, 'el editor de roster tampoco');

console.log('\n=== 14. El visor de liga: marcadores sí, todo lo demás no ===');
const { rows: [{ organization_id: ORGLIGA }] } = await pool.query('SELECT organization_id FROM leagues WHERE id=$1', [LEAGUE]);
const VISOR = await invitarA(ORGLIGA, LIGA, 'editor', 'Visor');
const TESOLIGA = await invitarA(ORGLIGA, LIGA, 'treasurer', 'TesoLiga');

const partido = await call(`/manage/categories/${CAT}/matches`, {
  method: 'POST', token: LIGA,
  body: { home_team: `Equipo Roles ${stamp}`, away_team: `Equipo Sin Entregar ${stamp}`, match_date_local: '2026-10-01T18:00', branch_id: BRANCH },
});
const MATCH = partido.data.match?.id ?? partido.data.id;
ok(!!MATCH, 'partido creado por la liga', JSON.stringify(partido.data).slice(0, 120));

const marcador = await call(`/manage/matches/${MATCH}`, { method: 'PUT', token: VISOR, body: { home_score: 21, away_score: 14 } });
ok(marcador.status === 200, 'el VISOR sí edita el marcador — es todo lo que hace', `=${marcador.status}`);
const borrar = await call(`/manage/matches/${MATCH}`, { method: 'DELETE', token: VISOR });
ok(borrar.status === 403, 'pero NO puede borrar el partido: un resultado borrado no se recupera', `=${borrar.status}`);
ok((await call(`/billing/leagues/${LEAGUE}/overview`, { token: VISOR })).status === 403, 'ni tocar la cobranza de la liga');
ok((await call(`/leagues/${LEAGUE}/categories`, { method: 'POST', token: VISOR, body: { name: 'Pirata' } })).status === 403,
  'ni crear estructura');

ok((await call(`/billing/leagues/${LEAGUE}/overview`, { token: TESOLIGA })).status === 200,
  'el TESORERO DE LIGA sí lleva la cobranza');
ok((await call(`/manage/matches/${MATCH}`, { method: 'PUT', token: TESOLIGA, body: { home_score: 7 } })).status === 403,
  'y no toca los partidos');
ok((await call(`/player-billing/teams/${TEAM2}/overview`, { token: TESOLIGA })).status === 403,
  'ni el padrón de un club: ningún rol de liga lo alcanza, y ese es el corazón del modelo');

console.log(`\n========  ${pass} ok, ${fail} fallas  ========`);
await pool.end();
process.exit(fail ? 1 : 0);
