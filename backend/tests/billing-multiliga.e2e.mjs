// Un equipo que juega en DOS ligas, y las dos le cobran — README, "Un equipo
// puede deberle a varias ligas".
//
// Por qué existe y no bastaban las unitarias: todo lo que aquí se prueba es una
// consulta contra Postgres. Que la membresía sea `league_teams` y no
// `teams.league_id`, que los dos libros no se mezclen, y que una deuda no se
// esconda cuando la liga saca al equipo de su roster — nada de eso se puede
// tocar con una función pura.
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

const crearLiga = async (token, nombre) => {
  const r = await call('/leagues', { method: 'POST', token, body: { name: nombre, state: 'CIUDAD DE MEXICO' } });
  return r.data.league?.id ?? r.data.id;
};
const cargar = (token, ligaId, teamId, monto, concepto) => call(`/billing/leagues/${ligaId}/charges`, {
  method: 'POST', token,
  body: { category: 'inscripcion', concept: concepto, due_date: '2026-12-31', items: [{ team_id: teamId, amount: monto }] },
});

console.log('\n=== 1. Dos ligas distintas y un equipo de la primera ===');
const A = await alta('LigaA');
const B = await alta('LigaB');
const REP = await alta('RepEq');

const LIGA_A = await crearLiga(A, `Liga A ${stamp}`);
const LIGA_B = await crearLiga(B, `Liga B ${stamp}`);
const tm = await call(`/manage/leagues/${LIGA_A}/teams`, { method: 'POST', token: A, body: { name: `Equipo Dos Ligas ${stamp}` } });
const TEAM = tm.data.team?.id ?? tm.data.id;
ok(!!LIGA_A && !!LIGA_B && !!TEAM, 'dos ligas y un equipo', `A=${LIGA_A} B=${LIGA_B} T=${TEAM}`);

// La pieza que antes no existía: crear el equipo lo da de alta en league_teams
// de una vez, sin esperar al backfill del próximo arranque del servidor.
const { rows: membresias } = await pool.query('SELECT league_id FROM league_teams WHERE team_id=$1', [TEAM]);
ok(membresias.length === 1 && membresias[0].league_id === LIGA_A,
  'crear el equipo ya lo dejó en league_teams, sin reiniciar el servidor', JSON.stringify(membresias));

console.log('\n=== 2. La liga B no le puede cobrar a un equipo que no es suyo ===');
const ajeno = await cargar(B, LIGA_B, TEAM, 999, 'Cargo indebido');
ok(ajeno.status === 400, 'la B recibe 400: el equipo no está en su roster', `=${ajeno.status}`);

console.log('\n=== 3. El equipo entra también a la liga B ===');
const sumar = await call(`/leagues/${LIGA_B}/roster`, { method: 'POST', token: B, body: { team_id: TEAM } });
ok(sumar.status === 200 || sumar.status === 201, 'la B lo agrega a su roster', `=${sumar.status}`);
const { rows: dos } = await pool.query('SELECT league_id FROM league_teams WHERE team_id=$1 ORDER BY league_id', [TEAM]);
ok(dos.length === 2, 'ahora es miembro de las dos', JSON.stringify(dos.map((r) => r.league_id)));

console.log('\n=== 4. Las dos le cobran, y los libros no se mezclan ===');
ok((await cargar(A, LIGA_A, TEAM, 1000, 'Inscripción A')).status === 201, 'la A le carga 1000');
ok((await cargar(B, LIGA_B, TEAM, 300, 'Inscripción B')).status === 201, 'la B le carga 300');

// Entregar el equipo para que su representante sea quien lo consulte: es el
// caso real, el tesorero del equipo mirando sus dos cuentas.
const inv = await call(`/invites/teams/${TEAM}`, { method: 'POST', token: A });
await call(`/invites/${inv.data.token}/claim`, { method: 'POST', token: REP });

const lista = await call(`/billing/teams/${TEAM}/leagues`, { token: REP });
ok(lista.status === 200 && lista.data.leagues.length === 2, 'el equipo ve SUS DOS ligas', JSON.stringify(lista.data.leagues?.map((l) => l.name)));
const sA = lista.data.leagues.find((l) => l.id === LIGA_A);
const sB = lista.data.leagues.find((l) => l.id === LIGA_B);
ok(Number(sA.balance) === -1000, 'debe 1000 a la A', `=${sA.balance}`);
ok(Number(sB.balance) === -300, 'y 300 a la B — cada libro por su lado', `=${sB.balance}`);

console.log('\n=== 5. Con dos ligas, no se adivina cuál ===');
const sinDecir = await call(`/billing/teams/${TEAM}/statement`, { token: REP });
ok(sinDecir.status === 400, 'el estado de cuenta sin league_id da 400, no una liga al azar', `=${sinDecir.status}`);
const conA = await call(`/billing/teams/${TEAM}/statement?league_id=${LIGA_A}`, { token: REP });
ok(conA.status === 200 && Number(conA.data.balance) === -1000, 'con league_id sí responde, y es el de esa liga', `=${conA.data.balance}`);
ok(conA.data.entries.length === 1 && Number(conA.data.entries[0].amount) === 1000,
  'y solo trae los movimientos de la A', JSON.stringify(conA.data.entries.map((e) => e.amount)));
const ajena = await call(`/billing/teams/${TEAM}/statement?league_id=999999`, { token: REP });
ok(ajena.status === 404, 'una liga con la que no tiene cuenta da 404', `=${ajena.status}`);

console.log('\n=== 6. Un pendiente a la vez POR LIGA, no por equipo ===');
const pagoA = await call(`/billing/teams/${TEAM}/report-payment`, {
  method: 'POST', token: REP, body: { league_id: LIGA_A, amount: 500, payment_method: 'transferencia' },
});
ok(pagoA.status === 201, 'reporta un pago a la A', `=${pagoA.status}`);
const repetirA = await call(`/billing/teams/${TEAM}/report-payment`, {
  method: 'POST', token: REP, body: { league_id: LIGA_A, amount: 100, payment_method: 'efectivo' },
});
ok(repetirA.status === 409, 'un segundo pago a la MISMA liga da 409', `=${repetirA.status}`);
const pagoB = await call(`/billing/teams/${TEAM}/report-payment`, {
  method: 'POST', token: REP, body: { league_id: LIGA_B, amount: 300, payment_method: 'efectivo' },
});
ok(pagoB.status === 201, 'pero a la OTRA liga sí puede — la bandeja es de cada quien', `=${pagoB.status}`);

console.log('\n=== 7. Retirar un pago retira el de SU liga, no el de la otra ===');
const retirarA = await call(`/billing/teams/${TEAM}/withdraw-payment`, { method: 'POST', token: REP, body: { league_id: LIGA_A } });
ok(retirarA.status === 200, 'retira el de la A', `=${retirarA.status}`);
const { rows: pendientes } = await pool.query(
  "SELECT league_id, status FROM team_ledger_entries WHERE team_id=$1 AND kind='payment' ORDER BY id", [TEAM]
);
const enA = pendientes.filter((r) => r.league_id === LIGA_A);
const enB = pendientes.filter((r) => r.league_id === LIGA_B);
ok(enA.length > 0 && enA.every((r) => r.status === 'withdrawn'), 'el de la A quedó retirado', JSON.stringify(enA));
ok(enB.length === 1 && enB[0].status === 'pending',
  'y el de la B SIGUE pendiente — este era el bug latente', JSON.stringify(enB));

console.log('\n=== 8. Sacarlo del roster no le esconde la deuda ===');
const sacar = await call(`/leagues/${LIGA_B}/roster/${TEAM}`, { method: 'DELETE', token: B });
ok(sacar.status === 200, 'la B lo saca de su roster', `=${sacar.status}`);
const { rows: unaSola } = await pool.query('SELECT league_id FROM league_teams WHERE team_id=$1', [TEAM]);
ok(unaSola.length === 1, 'ya no es miembro de la B', JSON.stringify(unaSola.map((r) => r.league_id)));

const despues = await call(`/billing/teams/${TEAM}/leagues`, { token: REP });
const bDespues = despues.data.leagues.find((l) => l.id === LIGA_B);
ok(!!bDespues, 'pero la B SIGUE en su lista de cuentas: la deuda no se esconde', JSON.stringify(despues.data.leagues?.map((l) => l.name)));
ok(bDespues && bDespues.is_member === false, 'marcada como "ya no eres miembro"', JSON.stringify({ is_member: bDespues?.is_member }));
ok(bDespues && Number(bDespues.balance) === -300, 'y con su saldo intacto', `=${bDespues?.balance}`);

console.log('\n=== 9. Pero ya no recibe cargos nuevos de esa liga ===');
const nuevoCargo = await cargar(B, LIGA_B, TEAM, 50, 'Cargo tardío');
ok(nuevoCargo.status === 400, 'la B ya no le puede cargar nada', `=${nuevoCargo.status}`);

console.log(`\n========  ${pass} ok, ${fail} fallas  ========`);
await pool.end();
process.exit(fail ? 1 : 0);
