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
const idDe = async (quien) => (await pool.query(
  'SELECT id FROM users WHERE email=$1', [`${quien.toLowerCase()}${stamp}@example.com`]
)).rows[0]?.id;
const rolDe = async (organizationId, userId) => (await pool.query(
  "SELECT role FROM organization_members WHERE organization_id=$1 AND user_id=$2 AND status='active'", [organizationId, userId]
)).rows[0]?.role ?? null;
// Un link generado hace ocho días. La caducidad se resuelve al leer contra
// `created_at` (utils/invitaciones.js), así que envejecerlo es todo lo que
// hace falta para probarla sin esperar una semana.
const envejecer = (token) => pool.query("UPDATE invites SET created_at = created_at - INTERVAL '8 days' WHERE token=$1", [token]);
const sinUsar = async (token) => (await pool.query('SELECT used_at FROM invites WHERE token=$1', [token])).rows[0]?.used_at === null;

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
const nada = await call(`/invites/teams/${TEAM}`, { token: LIGA });
ok(nada.status === 200 && nada.data.invite === null, 'antes de generarla, no hay entrega vigente', JSON.stringify(nada.data));
const primera = await call(`/invites/teams/${TEAM}`, { method: 'POST', token: LIGA });
const inv = await call(`/invites/teams/${TEAM}`, { method: 'POST', token: LIGA });
ok(inv.status === 201 && inv.data.role === 'owner', 'la entrega de un equipo siempre es como dueño', JSON.stringify(inv.data));
const pub = await call(`/invites/${inv.data.token}`);
ok(pub.data.role === 'owner' && pub.data.role_label === 'Dueño',
  'el link público dice el rol con su etiqueta, antes de crear cuenta', JSON.stringify({ r: pub.data.role, l: pub.data.role_label }));

console.log('\n=== 3b. La entrega es la única que cancela la anterior (PD-30) ===');
ok((await call(`/invites/${primera.data.token}`)).status === 404,
  'generar otra entrega MATA la anterior: del otro lado hay una sola persona');
const vigente = await call(`/invites/teams/${TEAM}`, { token: LIGA });
ok(vigente.data.invite?.token === inv.data.token,
  'volver a abrir "Entregar perfil" enseña la que ya existe, en vez de generar otra', JSON.stringify(vigente.data));
ok(vigente.data.invite?.seconds_left > 6 * 86400, 'y dice cuánto le queda: casi siete días', `=${vigente.data.invite?.seconds_left}`);
ok((await call(`/invites/${inv.data.token}`)).status === 200, 'leerla no la mata');

// Un doble clic en "Entregar perfil" deja DOS entregas vivas (las dos
// peticiones borran antes de insertar). Se fabrica directo en la base para
// probar lo que importa: que la segunda no sirva después de la entrega.
const TOKEN_DOBLE = `doble${stamp}`;
await pool.query("INSERT INTO invites (token, type, team_id, role) VALUES ($1, 'team', $2, 'owner')", [TOKEN_DOBLE, TEAM]);

console.log('\n=== 4. Reclamar puebla la organización del equipo ===');
const claim = await call(`/invites/${inv.data.token}/claim`, { method: 'POST', token: REP });
ok(claim.status === 200 && claim.data.role === 'owner', 'reclamado', JSON.stringify(claim.data).slice(0, 100));
const m1 = await miembros(ORG);
ok(m1.length === 1 && m1[0].role === 'owner' && m1[0].status === 'active',
  'el representante quedó de alta como owner de la organización', JSON.stringify(m1));
ok((await call(`/invites/${inv.data.token}/claim`, { method: 'POST', token: TESO })).status === 410,
  'el mismo link, usado otra vez, da 410');

console.log('\n=== 4b. La segunda entrega ya no entrega nada ===');
const pubDoble = await call(`/invites/${TOKEN_DOBLE}`);
ok(pubDoble.status === 409, 'el link público de la segunda entrega ya dice que el equipo fue entregado', `=${pubDoble.status}`);
const claimDoble = await call(`/invites/${TOKEN_DOBLE}/claim`, { method: 'POST', token: LIGA });
ok(claimDoble.status === 409, 'y si la LIGA la reclama, 409: era la puerta trasera al padrón', `=${claimDoble.status}`);
ok((await miembros(ORG)).length === 1, 'la organización sigue con su único dueño', JSON.stringify(await miembros(ORG)));
ok((await call(`/player-billing/teams/${TEAM}/overview`, { token: LIGA })).status === 403, 'y la liga no alcanzó el padrón');

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
const invCoachB = await call(`/invites/organizations/${ORG}/admins`, {
  method: 'POST', token: REP, body: { role: 'coach', note: '  Coach   de línea ' },
});
ok(invCoachB.status === 201 && invCoachB.data.note === 'Coach de línea',
  'otra de coach, con nota de para quién (limpia de espacios)', JSON.stringify(invCoachB.data));
ok((await call(`/invites/${invCoach.data.token}`)).status === 200,
  'la PRIMERA de coach sigue viva después de generar la segunda: un link por persona, no uno por rol');
ok((await call(`/invites/${invTeso.data.token}`)).status === 200, 'y la del tesorero también');

const pendientes = await call(`/invites/organizations/${ORG}`, { token: REP });
ok(pendientes.status === 200 && pendientes.data.invites.length === 3,
  'la lista de pendientes trae las tres', JSON.stringify(pendientes.data).slice(0, 160));
ok(pendientes.data.invites.find((i) => i.id === invCoachB.data.id)?.note === 'Coach de línea',
  'con su nota, para distinguir un link de Coach de otro');
ok(pendientes.data.invites.every((i) => i.token && i.can_cancel && i.created_by_name === 'Rep'),
  'el dueño ve todos los links completos, quién los generó, y puede cancelarlos',
  JSON.stringify(pendientes.data.invites.map((i) => [i.role, !!i.token, i.can_cancel, i.created_by_name])));
ok((await call(`/invites/organizations/${ORG}`, { token: COACH })).status === 403, 'alguien de fuera no ve la lista');

console.log('\n=== 7. Cada quien entra con lo suyo ===');
await call(`/invites/${invTeso.data.token}/claim`, { method: 'POST', token: TESO });
await call(`/invites/${invCoach.data.token}/claim`, { method: 'POST', token: COACH });
const m2 = await miembros(ORG);
ok(m2.length === 3, 'la organización tiene tres personas', JSON.stringify(m2));
ok(m2.some((m) => m.role === 'treasurer') && m2.some((m) => m.role === 'coach'),
  'y cada una con el rol que decía su invitación, no todas como admin', JSON.stringify(m2.map((m) => m.role)));
ok((await call(`/invites/organizations/${ORG}`, { token: REP })).data.invites.length === 1,
  'las dos usadas salen de la lista de pendientes: ya se ven como personas');

console.log('\n=== 7b. Un link es para alguien que todavía no está (PD-31) ===');
const coachOtraVez = await call(`/invites/${invCoachB.data.token}/claim`, { method: 'POST', token: COACH });
ok(coachOtraVez.status === 409, 'un miembro que abre un link recibe 409', `=${coachOtraVez.status} ${coachOtraVez.data.error}`);
const duenoAbre = await call(`/invites/${invCoachB.data.token}/claim`, { method: 'POST', token: REP });
ok(duenoAbre.status === 409 && /otra persona/.test(duenoAbre.data.error),
  'un DUEÑO que abre el link de otro, también 409, y le dice que es para otra persona', duenoAbre.data.error);
ok(await sinUsar(invCoachB.data.token), 'y el link NO se gastó: le sigue sirviendo a quien se lo mandaron');
ok(await rolDe(ORG, await idDe('Rep')) === 'owner', 'el dueño sigue siendo dueño');

console.log('\n=== 7c. Un link vivo se cancela sin tocar a los demás ===');
const invCoachC = await call(`/invites/organizations/${ORG}/admins`, { method: 'POST', token: REP, body: { role: 'coach' } });
const cancelarB = await call(`/invites/organizations/${ORG}/${invCoachB.data.id}`, { method: 'DELETE', token: REP });
ok(cancelarB.status === 200, 'el dueño cancela un link de coach', `=${cancelarB.status}`);
ok((await call(`/invites/${invCoachB.data.token}`)).status === 404, 'ese link deja de servir');
ok((await call(`/invites/${invCoachC.data.token}`)).status === 200, 'y el otro de coach sigue vivo');
const cancelarUsada = await call(`/invites/organizations/${ORG}/${invCoach.data.id}`, { method: 'DELETE', token: REP });
ok(cancelarUsada.status === 409, 'una ya usada no se "cancela": a esa persona se le quita de la lista de acceso', `=${cancelarUsada.status}`);
const cancelarAjena = await call(`/invites/organizations/${ORG}/${invCoachC.data.id}`, { method: 'DELETE', token: COACH });
ok(cancelarAjena.status === 403, 'un coach no cancela links', `=${cancelarAjena.status}`);

console.log('\n=== 7d. Los links caducan a los 7 días ===');
await envejecer(invCoachC.data.token);
const caducada = await call(`/invites/${invCoachC.data.token}`);
ok(caducada.status === 410 && /caducó/.test(caducada.data.error) && !/utilizada/.test(caducada.data.error),
  'un link de hace 8 días da 410 y dice que caducó, no que alguien lo usó', caducada.data.error);
const NUEVO = await alta('Nuevo');
ok((await call(`/invites/${invCoachC.data.token}/claim`, { method: 'POST', token: NUEVO })).status === 410,
  'y no deja entrar a nadie');
ok(await rolDe(ORG, await idDe('Nuevo')) === null, 'la persona no quedó de alta');
ok(!(await call(`/invites/organizations/${ORG}`, { token: REP })).data.invites.some((i) => i.id === invCoachC.data.id),
  'y ya no sale en la lista de pendientes');

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
const invDueno = await call(`/invites/organizations/${ORG}/admins`, { method: 'POST', token: REP, body: { role: 'owner' } });
ok(invDueno.status === 201, 'el dueño sí puede invitar a otro dueño');

console.log('\n=== 8b. El admin ve que hay un link de dueño, pero no el link ===');
const vistaAdmin = await call(`/invites/organizations/${ORG}`, { token: ADMIN });
const duenoVistoPorAdmin = vistaAdmin.data.invites?.find((i) => i.id === invDueno.data.id);
ok(!!duenoVistoPorAdmin && duenoVistoPorAdmin.token === null && duenoVistoPorAdmin.can_cancel === false,
  'en su lista el link de dueño aparece SIN token: copiarlo y usarlo sería ascenderse solo', JSON.stringify(duenoVistoPorAdmin));
const vistaDueno = await call(`/invites/organizations/${ORG}`, { token: REP });
ok(vistaDueno.data.invites.find((i) => i.id === invDueno.data.id)?.token === invDueno.data.token,
  'el dueño sí lo ve completo');
ok((await call(`/invites/organizations/${ORG}/${invDueno.data.id}`, { method: 'DELETE', token: ADMIN })).status === 403,
  'y el admin no lo puede cancelar');

// El caso que obligó a la regla "un link es para alguien que todavía no está":
// antes, un admin que abría un link de Coach quedaba como Coach.
const invCoachD = await call(`/invites/organizations/${ORG}/admins`, { method: 'POST', token: REP, body: { role: 'coach' } });
ok((await call(`/invites/${invCoachD.data.token}/claim`, { method: 'POST', token: ADMIN })).status === 409,
  'un admin que abre un link de Coach recibe 409');
ok(await rolDe(ORG, await idDe('Admin')) === 'admin', 'y sigue siendo admin: el link ya no lo degrada');
ok(await sinUsar(invCoachD.data.token), 'y el link sigue vivo');

console.log('\n=== 8c. Cambiar un rol es un botón, no una invitación ===');
const idCoach = await idDe('Coach');
const cambio = await call(`/organizations/${ORG}/members/${idCoach}`, { method: 'PATCH', token: REP, body: { role: 'roster_editor' } });
ok(cambio.status === 200 && cambio.data.role_label === 'Editor de roster',
  'el dueño cambia al coach a editor de roster', JSON.stringify(cambio.data));
ok(await rolDe(ORG, idCoach) === 'roster_editor', 'y la fila cambió');
ok((await call(`/organizations/${ORG}/members/${idCoach}`, { method: 'PATCH', token: ADMIN, body: { role: 'coach' } })).status === 200,
  'un admin también cambia roles que no son de dueño');
ok((await call(`/organizations/${ORG}/members/${idCoach}`, { method: 'PATCH', token: ADMIN, body: { role: 'owner' } })).status === 403,
  'pero no nombra dueños');
ok((await call(`/organizations/${ORG}/members/${await idDe('Rep')}`, { method: 'PATCH', token: ADMIN, body: { role: 'coach' } })).status === 409,
  'ni le cambia el rol a un dueño');
ok((await call(`/organizations/${ORG}/members/${await idDe('Rep')}`, { method: 'PATCH', token: REP, body: { role: 'admin' } })).status === 409,
  'y a un dueño no se le cambia el rol desde ahí, ni siquiera él mismo (PD-32)');
ok((await call(`/organizations/${ORG}/members/${idCoach}`, { method: 'PATCH', token: REP, body: { role: 'editor' } })).status === 400,
  'un rol que no existe en un equipo, 400');
ok((await call(`/organizations/${ORG}/members/${idCoach}`, { method: 'PATCH', token: COACH, body: { role: 'admin' } })).status === 403,
  'y un coach no se asciende solo');
ok(await rolDe(ORG, idCoach) === 'coach', 'al final sigue siendo coach', await rolDe(ORG, idCoach));

// Se cancelan los dos que quedaron vivos, para que la sección 9 cuente limpio.
await call(`/invites/organizations/${ORG}/${invDueno.data.id}`, { method: 'DELETE', token: REP });
await call(`/invites/organizations/${ORG}/${invCoachD.data.id}`, { method: 'DELETE', token: REP });

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
ok((await call(`/invites/teams/${TEAM}`, { token: LIGA })).status === 409,
  'ni leer una entrega vigente: para la liga, la opción ya no existe');
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
const inv2b = await call(`/invites/teams/${TEAM2}`, { method: 'POST', token: LIGA });
ok(inv2b.status === 201, 'cancelar no deja al equipo trabado: se puede volver a entregar');

console.log('\n=== 11b. La entrega también caduca ===');
await envejecer(inv2b.data.token);
ok((await call(`/invites/teams/${TEAM2}`, { token: LIGA })).data.invite === null,
  'una entrega de hace 8 días ya no sale como vigente al reabrir el modal');
ok((await call(`/invites/${inv2b.data.token}`)).status === 410, 'y su link da 410');

console.log('\n=== 11c. Antes de la entrega, no hay invitaciones con rol al equipo ===');
// Ninguna liga llega a la organización de un equipo sin entregar, pero el
// admin de la plataforma sí. Se fabrica uno en esta rama de pruebas.
await alta('Plataforma');
const idPlat = await idDe('Plataforma');
await pool.query("UPDATE users SET role='admin' WHERE id=$1", [idPlat]);
const PLAT = (await call('/auth/login', {
  method: 'POST', body: { email: `plataforma${stamp}@example.com`, password: 'prueba123' },
})).data.token;
const { rows: [{ organization_id: ORG2pre }] } = await pool.query('SELECT organization_id FROM teams WHERE id=$1', [TEAM2]);
const rolAntes = await call(`/invites/organizations/${ORG2pre}/admins`, { method: 'POST', token: PLAT, body: { role: 'coach' } });
ok(rolAntes.status === 409, 'ni el admin de la plataforma genera un link con rol para un equipo sin entregar', `=${rolAntes.status} ${rolAntes.data.error}`);
// Y uno que ya existiera de antes del candado tampoco sirve.
const TOKEN_ANTES = `antes${stamp}`;
await pool.query("INSERT INTO invites (token, type, organization_id, role) VALUES ($1, 'org_admin', $2, 'coach')", [TOKEN_ANTES, ORG2pre]);
ok((await call(`/invites/${TOKEN_ANTES}/claim`, { method: 'POST', token: NUEVO })).status === 409,
  'un link con rol viejo a un equipo sin entregar tampoco deja entrar');
ok((await miembros(ORG2pre)).length === 0, 'el equipo sigue vacío: su primera persona entra por la entrega');
await pool.query("UPDATE users SET role='rep' WHERE id=$1", [idPlat]);

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

// La bandeja: cada aviso pide el permiso de su tema (README, "Quién ve cada
// aviso de una organización"). Antes se leía entera con `ver`, y el coach veía
// cuotas vencidas con nombres del padrón.
await pool.query(
  `INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data) VALUES
     ('team', $1, 'billing_charge_new',      'Cargo e2e',       'Tu liga te registró un cargo', '{}'),
     ('team', $1, 'player_payment_reported', 'Pago padrón e2e', 'Juan Pérez reportó un pago',   '{}')`,
  [TEAM2]);
const bandejaDe = async (token) => {
  const r = await call('/notifications/mine', { token });
  return (r.data.items || []).filter((i) => i.org?.kind === 'team' && i.org?.id === TEAM2).map((i) => i.type);
};
const deCoach = await bandejaDe(COACH2);
ok(!deCoach.includes('billing_charge_new') && !deCoach.includes('player_payment_reported'),
  'el COACH ya no lee avisos de dinero en su bandeja', JSON.stringify(deCoach));
ok(deCoach.length === 0, 'ni ningún otro del equipo: `ver` no lee avisos', JSON.stringify(deCoach));
ok((await bandejaDe(ROSTER2)).length === 0, 'el editor de roster tampoco');
const deTeso2 = await bandejaDe(TESO2);
ok(deTeso2.includes('billing_charge_new') && deTeso2.includes('player_payment_reported'),
  'el TESORERO lee los dos libros', JSON.stringify(deTeso2));
ok(!deTeso2.includes('org_admin_claimed'), 'pero no quién entró al equipo', JSON.stringify(deTeso2));
const deRep2 = await bandejaDe(REP2);
ok(deRep2.includes('billing_charge_new') && deRep2.includes('org_admin_claimed'), 'el DUEÑO lee todo', JSON.stringify(deRep2));
ok((await call(`/notifications/team/${TEAM2}`, { token: COACH2 })).status === 404,
  'y la bandeja vieja por organización ya no existe: el coach tampoco la alcanza por la API');

const nuevasDe = async (token) => (await call('/notifications/mine/unread', { token })).data.unread;
ok((await nuevasDe(TESO2)) >= 2, 'el balón del tesorero cuenta lo nuevo', `=${await nuevasDe(TESO2)}`);
ok((await call('/notifications/mine/seen', { method: 'POST', token: TESO2 })).status === 200, 'abrir la bandeja la marca como vista');
ok((await nuevasDe(TESO2)) === 0, 'y el balón se pone en cero', `=${await nuevasDe(TESO2)}`);
ok((await nuevasDe(REP2)) >= 2, 'solo para él: lo leído es de cada persona, no del equipo', `=${await nuevasDe(REP2)}`);

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

// Un aficionado lo sigue ANTES del marcador: la bandeja no enseña lo que pasó
// antes de que empezaras a seguir.
const FAN = await alta('Fan');
const { enabled: conPush } = (await call('/notifications/push-status')).data;
const seguir = (prefs) => call('/notifications/subscribe', {
  method: 'POST', token: FAN,
  body: {
    match_id: MATCH, preferences: prefs,
    subscription: { endpoint: `https://push.example.com/${stamp}`, keys: { p256dh: 'x', auth: 'y' } },
  },
});
const seguido = await seguir({ push_enabled: true, notify_final: true });
ok(seguido.status === 201, 'el aficionado sigue el partido', `=${seguido.status}`);
if (!conPush) {
  ok(seguido.data.preferences?.push_enabled === false && seguido.data.preferences?.in_app === true,
    'con el push en pausa se guarda el seguimiento, sin dispositivo y con la bandeja encendida', JSON.stringify(seguido.data.preferences));
}
const desdeDe = async () => (await pool.query(
  'SELECT created_at FROM push_subscriptions WHERE user_id=$1 AND match_id=$2', [await idDe('Fan'), MATCH]
)).rows.map((r) => r.created_at.toISOString());
const desdeAntes = await desdeDe();
await new Promise((r) => setTimeout(r, 1100));
await seguir({ push_enabled: false, notify_final: true, notify_upcoming: false });
const desdeDespues = await desdeDe();
ok(desdeDespues.length === 1 && desdeDespues[0] === desdeAntes[0],
  'ajustar las casillas no reinicia "desde cuándo lo sigues" (ni duplica el seguimiento)', JSON.stringify({ desdeAntes, desdeDespues }));

const marcador = await call(`/manage/matches/${MATCH}`, { method: 'PUT', token: VISOR, body: { home_score: 21, away_score: 14 } });
ok(marcador.status === 200, 'el VISOR sí edita el marcador — es todo lo que hace', `=${marcador.status}`);

// El aviso se registra después de responder (no frena el guardado), así que se
// espera a que aparezca.
let finales = [];
for (let i = 0; i < 20 && finales.length === 0; i++) {
  await new Promise((r) => setTimeout(r, 150));
  finales = (await pool.query("SELECT id FROM match_events WHERE match_id=$1 AND type='final_score'", [MATCH])).rows;
}
ok(finales.length === 1, 'capturar el marcador deja UN "marcador final" en match_events', `filas=${finales.length}`);
const delFan = (await call('/notifications/mine', { token: FAN })).data.items || [];
const finalDelFan = delFan.find((i) => i.type === 'final_score' && i.match?.id === MATCH);
ok(!!finalDelFan && finalDelFan.match.home_score === 21 && finalDelFan.is_new === true,
  'y le llega al aficionado a Mis notificaciones, con el marcador y como nuevo', JSON.stringify(delFan).slice(0, 200));

// La bandeja de la liga, por permiso. Antes el visor y el tesorero de liga no
// veían nada: la bandeja de la liga pedía `estructura`.
await pool.query(
  `INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data) VALUES
     ('league', $1, 'score_reminder',        'Falta capturar un marcador e2e',  '', '{}'),
     ('league', $1, 'team_payment_reported', 'Un pago espera tu confirmación e2e', '', '{}')`,
  [LEAGUE]);
const ligaDe = async (token) => ((await call('/notifications/mine', { token })).data.items || [])
  .filter((i) => i.org?.kind === 'league' && i.org?.id === LEAGUE).map((i) => i.type);
const deVisor = await ligaDe(VISOR);
ok(deVisor.includes('score_reminder') && !deVisor.includes('team_payment_reported'),
  'el VISOR lee "falta capturar un marcador", y nada de dinero', JSON.stringify(deVisor));
const deTesoLiga = await ligaDe(TESOLIGA);
ok(deTesoLiga.includes('team_payment_reported') && !deTesoLiga.includes('score_reminder'),
  'el TESORERO DE LIGA lee el pago que le toca confirmar', JSON.stringify(deTesoLiga));
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


console.log('\n=== 15. El editor de roster sí puede hacer su trabajo ===');
// Lo que faltaba probar: que el rol no solo VEA su pestaña sino que pueda
// escribir. Un rol que existe pero no alcanza a hacer su trabajo es peor que
// no tenerlo — se reparte, la persona entra, y no puede.
await call(`/manage/branches/${BRANCH}/teams`, { method: 'POST', token: LIGA, body: { team_id: TEAM2 } });
const rutaRoster = `/players/branches/${BRANCH}/teams/${TEAM2}/roster`;

ok((await call(rutaRoster, { token: ROSTER2 })).status === 200, 'el editor de roster LEE el roster de la rama');
const altaJugador = await call(rutaRoster, {
  method: 'POST', token: ROSTER2,
  body: { first_name: 'Juan', last_name: 'Pérez', jersey_number: 7, position: 'QB' },
});
ok(altaJugador.status === 200 || altaJugador.status === 201,
  'y DA DE ALTA a un jugador, que es su trabajo', `=${altaJugador.status}`);
ok((await call(`${rutaRoster}/template`, { token: ROSTER2 })).status === 200,
  'y baja la plantilla de Excel');

ok((await call(rutaRoster, { method: 'POST', token: COACH2, body: { first_name: 'X', last_name: 'Y' } })).status === 403,
  'el coach NO da de alta en el roster: lo lee desde el panel, no lo edita');
ok((await call(rutaRoster, { method: 'POST', token: TESO2, body: { first_name: 'X', last_name: 'Y' } })).status === 403,
  'y el tesorero tampoco — lleva dinero, no jugadores');
// ─────────────────────────────────────────────────────────────────────────
// Eliminar un equipo: el candado es "¿lo administra alguien más?", NO
// "¿ya tiene movimientos?". Ver README, "Quién puede eliminar un equipo, y
// por qué ese candado y no otro".
//
// Esto no se puede probar con una función pura: el candado pregunta por filas
// de `organization_members` y el borrado encadena a dos libros de dinero por
// FK. Las dos mitades viven en Postgres.
console.log('\n=== 16. Un equipo sin entregar sí se elimina, aunque deba dinero ===');

const tm4 = await call(`/manage/leagues/${LEAGUE}/teams`, { method: 'POST', token: LIGA, body: { name: `Equipo Borrable ${stamp}` } });
const TEAM4 = tm4.data.team?.id ?? tm4.data.id;
const { rows: [{ organization_id: ORG4 }] } = await pool.query('SELECT organization_id FROM teams WHERE id=$1', [TEAM4]);
ok((await miembros(ORG4)).length === 0, 'nace sin nadie administrándolo', `org=${ORG4}`);

// Un cargo de la liga a ese equipo: es justo lo que un candado por movimientos
// habría bloqueado, y que a propósito NO bloquea.
const cargo4 = await call(`/billing/leagues/${LEAGUE}/charges`, {
  method: 'POST', token: LIGA,
  body: {
    category: 'inscripcion', concept: 'Inscripción', due_date: '2026-12-31',
    items: [{ team_id: TEAM4, amount: 500 }],
  },
});
ok(cargo4.status === 201, 'la liga le carga dinero', `=${cargo4.status} ${JSON.stringify(cargo4.data).slice(0, 90)}`);
const { rows: libroAntes } = await pool.query('SELECT id FROM team_ledger_entries WHERE team_id=$1', [TEAM4]);
ok(libroAntes.length > 0, 'y el cargo quedó en el libro liga↔equipo', `filas=${libroAntes.length}`);

const borrar4 = await call(`/manage/teams/${TEAM4}`, { method: 'DELETE', token: LIGA });
ok(borrar4.status === 200, 'la liga SÍ lo elimina: tener movimientos no es el candado', `=${borrar4.status}`);
const { rows: quedaEquipo } = await pool.query('SELECT id FROM teams WHERE id=$1', [TEAM4]);
ok(quedaEquipo.length === 0, 'el equipo ya no existe', JSON.stringify(quedaEquipo));
const { rows: libroDespues } = await pool.query('SELECT id FROM team_ledger_entries WHERE team_id=$1', [TEAM4]);
ok(libroDespues.length === 0,
  'y su libro se fue con él — el único historial destruido es el de la liga, sobre su propio equipo',
  `filas=${libroDespues.length}`);

console.log('\n=== 17. Un equipo entregado NO se elimina, tenga o no movimientos ===');
// TEAM se entregó en el paso 4 y su organización tiene miembros desde
// entonces. No se le cargó nada: si el candado fuera por movimientos, este
// borrado pasaría.
const { rows: sinLibro } = await pool.query('SELECT id FROM team_ledger_entries WHERE team_id=$1', [TEAM]);
ok(sinLibro.length === 0, 'este equipo no tiene ni un movimiento', `filas=${sinLibro.length}`);
ok((await miembros(ORG)).length > 0, 'pero sí tiene quien lo administre', JSON.stringify(await miembros(ORG)));

const borrarEntregado = await call(`/manage/teams/${TEAM}`, { method: 'DELETE', token: LIGA });
ok(borrarEntregado.status === 409, 'la liga recibe 409 — ya no es suyo', `=${borrarEntregado.status}`);
const { rows: sigueVivo } = await pool.query('SELECT id FROM teams WHERE id=$1', [TEAM]);
ok(sigueVivo.length === 1, 'y el equipo sigue existiendo', JSON.stringify(sigueVivo));
ok((await call(`/player-billing/teams/${TEAM}/overview`, { token: REP })).status === 200,
  'con su padrón intacto');

// El dueño del propio equipo tampoco: el endpoint es el de la liga y el
// candado no distingue quién pregunta, solo si hay administración.
const borrarPorSuDueno = await call(`/manage/teams/${TEAM}`, { method: 'DELETE', token: REP });
ok(borrarPorSuDueno.status === 409, 'ni siquiera su propio dueño lo borra por esta ruta', `=${borrarPorSuDueno.status}`);


console.log(`\n========  ${pass} ok, ${fail} fallas  ========`);
await pool.end();
process.exit(fail ? 1 : 0);
