// Recorrido de punta a punta de la cobranza equipo → jugador.
// Se crea su propio equipo y su propio padrón en cada corrida, así que se puede
// repetir cuantas veces haga falta sin arrastrar estado de la anterior.
import pg from 'pg';
const API = 'http://localhost:4100/api';
const stamp = Date.now();
let pass = 0, fail = 0;
const ok = (c, l, e = '') => { if (c) { console.log(`  OK    ${l}`); pass++; } else { console.log(`  FALLA ${l} ${e}`); fail++; } };

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  // reportPaymentLimiter permite 10 reportes cada 15 min por IP, y esta suite
  // gasta 4 en cada corrida: a la tercera seguida empieza a dar 429. Es el
  // limitador haciendo su trabajo, no un bug — pero sin avisar aquí, el fallo
  // aparecía diez líneas después como un "cannot read properties of undefined".
  if (res.status === 429) {
    console.log('\n  !! ' + path + ' recibió 429: se activó el limitador de peticiones.');
    console.log('     No es un fallo del código. El conteo vive en memoria del backend:');
    console.log('     reinícialo (o espera 15 minutos) y vuelve a correr la suite.\n');
    process.exit(2);
  }
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

console.log('\n=== 1. Equipo INDEPENDIENTE, sin liga ni roster de torneo ===');
const reg = await call('/auth/register', { method: 'POST', body: { name: 'Tesorero', email: `e2e${stamp}@example.com`, password: 'prueba123' } });
const T = reg.data.token;
const teamRes = await call('/manage/teams', { method: 'POST', token: T, body: { name: `E2E ${stamp}` } });
const TEAM = teamRes.data.team?.id ?? teamRes.data.id;
const me = await call('/auth/me', { token: T });
const mine = (me.data.teams || []).find((t) => t.id === TEAM);
ok(!!TEAM && mine && mine.league_id === null, 'equipo creado sin liga');

const overview = () => call(`/player-billing/teams/${TEAM}/overview`, { token: T });
const balOf = (ov, id) => Number(ov.data.members.find((p) => p.member_id === id).balance);
const rowsOf = async (id) => (await pool.query(
  'SELECT id, kind, status, amount, direction, reverses_entry_id FROM club_ledger_entries WHERE team_id=$1 AND member_id=$2 ORDER BY id', [TEAM, id]
)).rows;

console.log('\n=== 2. Alta en el padrón (sin pasar por ninguna liga) ===');
const add = async (b) => (await call(`/player-billing/teams/${TEAM}/members`, { method: 'POST', token: T, body: b })).data.member.id;
const JUAN = await add({ display_name: 'Juan Perez', group_label: 'U17', monthly_amount: 800, tutor_phone: '52-155-1111-1111' });
const CARLOS = await add({ display_name: 'Guero', group_label: 'U17', monthly_amount: 800 });
const ANA = await add({ display_name: 'Ana Ramirez', group_label: 'Femenil', monthly_amount: 0, status: 'beca' });
let ov = await overview();
ok(ov.data.members.length === 3, 'el padrón tiene 3');
ok(ov.data.members.every((p) => p.share_token), 'cada uno con su link');
ok(ov.data.members.find((p) => p.member_id === CARLOS).display_name === 'Guero',
  'un nombre de una sola palabra se guarda tal cual (antes last_name era NOT NULL)');
ok(ov.data.members.find((p) => p.member_id === JUAN).tutor_phone === '5215511111111', 'teléfono normalizado');

console.log('\n=== 3. Cuotas del mes ===');
const ch = await call(`/player-billing/teams/${TEAM}/charges`, { method: 'POST', token: T, body: {
  category: 'mensualidad', concept: 'Mensualidad', due_date: '2026-09-30', period_label: 'SEP-2026',
  items: [{ member_id: JUAN, amount: 800 }, { member_id: CARLOS, amount: 800 }, { member_id: ANA, amount: 0 }] } });
ok(ch.data.created === 2 && ch.data.skipped === 1, 'el becado se omitió');
ov = await overview();
ok(balOf(ov, JUAN) === -800 && balOf(ov, ANA) === 0, 'saldos correctos tras el cargo');

console.log('\n=== 4. Cancelar un cargo (el libro no borra nada) ===');
let led = await call(`/player-billing/teams/${TEAM}/members/${CARLOS}/entries`, { token: T });
const cargo = led.data.entries.find((e) => e.kind === 'charge');
await call(`/player-billing/entries/${cargo.id}/void`, { method: 'POST', token: T, body: { reason: 'se capturo dos veces' } });
let rows = await rowsOf(CARLOS);
ok(rows.length === 2, 'quedaron 2 filas: original + reversa', `=${rows.length}`);
ok(rows[0].status === 'void' && rows[1].kind === 'adjustment' && rows[1].direction === 'credit', 'original en void + ajuste credit');
ov = await overview();
ok(balOf(ov, CARLOS) === 0, 'el saldo cuadra en 0', `=${balOf(ov, CARLOS)}`);

await call(`/player-billing/entries/${cargo.id}/void`, { method: 'POST', token: T, body: { reason: 'otra vez' } });
rows = await rowsOf(CARLOS);
ok(rows.length === 2, 'cancelar dos veces NO crea una tercera fila', `=${rows.length}`);
ov = await overview();
ok(balOf(ov, CARLOS) === 0, 'y el saldo sigue cuadrando');

console.log('\n=== 5. Rechazar un pendiente NO infla el saldo ===');
const tokCarlos = ov.data.members.find((p) => p.member_id === CARLOS).share_token;
await call(`/player-billing/teams/${TEAM}/charges`, { method: 'POST', token: T, body: {
  category: 'uniforme', concept: 'Uniforme', due_date: '2026-10-15', items: [{ member_id: CARLOS, amount: 1500 }] } });
await call(`/player-billing/statement/${tokCarlos}/report-payment`, { method: 'POST', body: { amount: 1500, payment_method: 'transferencia' } });
const antes = (await rowsOf(CARLOS)).length;
ov = await overview();
ok(balOf(ov, CARLOS) === -1500, 'un pendiente no baja el saldo', `=${balOf(ov, CARLOS)}`);
const pend = ov.data.pending_payments.find((p) => p.member_id === CARLOS);
await call(`/player-billing/entries/${pend.id}/void`, { method: 'POST', token: T, body: { reason: 'no llego el deposito' } });
rows = await rowsOf(CARLOS);
ok(rows.length === antes, 'rechazar NO agrega fila de ajuste', `antes=${antes} ahora=${rows.length}`);
ok(rows.find((r) => r.id === pend.id).status === 'rejected', "queda en 'rejected', no en 'void'", `=${rows.find((r) => r.id === pend.id).status}`);
ov = await overview();
ok(balOf(ov, CARLOS) === -1500, 'el saldo NO se infló: sigue debiendo 1500', `=${balOf(ov, CARLOS)}`);

console.log('\n=== 6. Retirar el propio reporte ===');
await call(`/player-billing/statement/${tokCarlos}/report-payment`, { method: 'POST', body: { amount: 1500, payment_method: 'efectivo' } });
await call(`/player-billing/statement/${tokCarlos}/withdraw-payment`, { method: 'POST' });
const pub = await call(`/player-billing/statement/${tokCarlos}`);
ok(pub.data.has_pending_payment === false, 'ya no hay pendiente');
ok(Number(pub.data.balance) === -1500, 'el saldo tampoco se movió al retirar', `=${pub.data.balance}`);
ok((await rowsOf(CARLOS)).some((r) => r.status === 'withdrawn'), "queda en 'withdrawn'");
const re = await call(`/player-billing/statement/${tokCarlos}/report-payment`, { method: 'POST', body: { amount: 1500, payment_method: 'transferencia' } });
ok(re.status === 201, 'y ya puede reportar de nuevo');

console.log('\n=== 7. Confirmar: ahora sí mueve el saldo ===');
ov = await overview();
const p2 = ov.data.pending_payments.find((p) => p.member_id === CARLOS);
await call(`/player-billing/entries/${p2.id}/confirm`, { method: 'POST', token: T });
ov = await overview();
ok(balOf(ov, CARLOS) === 0, 'saldo en 0 tras confirmar', `=${balOf(ov, CARLOS)}`);

console.log('\n=== 8. Aislamiento ===');
const tokJuan = ov.data.members.find((p) => p.member_id === JUAN).share_token;
const pj = await call(`/player-billing/statement/${tokJuan}`);
const leak = JSON.stringify(pj.data);
ok(!leak.includes('Carlos') && !leak.includes('Ana'), 'el link de Juan no filtra a nadie más');
ok(!leak.includes('5215511111111'), 'no expone el teléfono del tutor');
ok((await call('/player-billing/statement/token-inventado')).status === 404, 'token inventado da 404');
const intruso = (await call('/auth/register', { method: 'POST', body: { name: 'X', email: `x${stamp}@example.com`, password: 'prueba123' } })).data.token;
ok((await call(`/player-billing/teams/${TEAM}/overview`, { token: intruso })).status === 403, 'otro usuario recibe 403');
ok((await call(`/player-billing/teams/${TEAM}/overview`)).status === 401, 'sin sesión da 401');

console.log('');
console.log('=== 9. La situación se guarda desde el alta ===');
// Antes esto se ignoraba: quien registrabas como becado nacía activo, y al mes
// siguiente se le generaba cargo. Con el cobro automático se le generaría solo,
// sin que nadie apretara nada.
const BECADO = await add({ display_name: 'Becado Real', monthly_amount: 1200, status: 'beca' });
const DEBAJA = await add({ display_name: 'Ya No Entrena', monthly_amount: 900 });
ov = await overview();
const statusBecado = ov.data.members.find((m) => m.member_id === BECADO).status;
ok(statusBecado === 'beca', 'status=beca se guarda en el alta (antes nacía activo)', '=' + statusBecado);
const malStatus = await call('/player-billing/teams/' + TEAM + '/members', { method: 'POST', token: T,
  body: { display_name: 'Inventado', status: 'jubilado' } });
ok(malStatus.status === 400, 'un status inválido se rechaza con 400', '=' + malStatus.status);

console.log('');
console.log('=== 10. Mensualidad automática ===');
// Se elige una fecha de pago que caiga dentro de la ventana de generación
// (entre hoy y hoy+5) para que la prueba no dependa del día en que se corra.
function diaDeCobroQueGenera() {
  const hoy = new Date();
  const desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const hasta = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 5);
  for (let d = 1; d <= 28; d++) {
    for (const salto of [0, 1]) {
      const cand = new Date(hoy.getFullYear(), hoy.getMonth() + salto, d);
      if (cand >= desde && cand <= hasta) return d;
    }
  }
  return null;
}
const DIA = diaDeCobroQueGenera();

// A este se le da de baja ANTES de activar el ciclo. Como ya tiene movimientos,
// el DELETE lo deja en status='baja' en vez de borrarlo — que es exactamente el
// caso que 'repetir el mes pasado' volvía a cobrar.
await call('/player-billing/teams/' + TEAM + '/charges', { method: 'POST', token: T, body: {
  category: 'uniforme', concept: 'Uniforme', due_date: '2026-10-15',
  items: [{ member_id: DEBAJA, amount: 100 }] } });
await call('/player-billing/teams/' + TEAM + '/members/' + DEBAJA, { method: 'DELETE', token: T });
ov = await overview();
ok(ov.data.members.find((m) => m.member_id === DEBAJA).status === 'baja', 'quedó dado de baja, no borrado');

const activar = await call('/player-billing/teams/' + TEAM + '/settings', { method: 'PATCH', token: T,
  body: { monthly_charge_enabled: true, monthly_charge_day: DIA } });
ok(activar.status === 200, 'se activa el cobro automático', '=' + activar.status);

const autoDe = async (id) => (await pool.query(
  'SELECT id, period_label, amount FROM club_ledger_entries WHERE team_id=$1 AND member_id=$2 AND auto_cycle_key IS NOT NULL ORDER BY id',
  [TEAM, id]
)).rows;

const autoJuan = await autoDe(JUAN);
ok(autoJuan.length === 1, 'a un activo con cuota se le genera su mensualidad', '=' + autoJuan.length);
ok(Number(autoJuan[0] && autoJuan[0].amount) === 800, 'por el monto de su ficha');
ok((await autoDe(BECADO)).length === 0, 'a un BECADO no se le genera nada, aunque tenga cuota');
ok((await autoDe(DEBAJA)).length === 0, 'a un dado de BAJA no se le genera nada');
ok((await autoDe(ANA)).length === 0, 'a quien tiene la cuota en 0 tampoco');

const periodos = new Set((await pool.query(
  'SELECT DISTINCT period_label FROM club_ledger_entries WHERE team_id=$1 AND auto_cycle_key IS NOT NULL',
  [TEAM]
)).rows.map((r) => r.period_label));
ok(periodos.size === 1, 'un club recién activado recibe UN mes, no doce', '=' + periodos.size);

// La segunda corrida sale de la vía perezosa del panel: PATCH /settings limpia
// el acelerador, así que este GET sí vuelve a ejecutar la generación.
const antesIdem = (await autoDe(JUAN)).length;
await overview();
await overview();
const despuesIdem = (await autoDe(JUAN)).length;
ok(despuesIdem === antesIdem, 'correr la generación otra vez NO crea un segundo cargo del mismo mes',
  'antes=' + antesIdem + ' ahora=' + despuesIdem);

console.log('');
console.log('=== 11. La nota interna no sale en el link público ===');
await call('/player-billing/teams/' + TEAM + '/charges', { method: 'POST', token: T, body: {
  category: 'multa', concept: 'Multa', due_date: '2026-11-01', note: 'HABLAR-CON-EL-COACH',
  items: [{ member_id: JUAN, amount: 50 }] } });
const pubJuan = await call('/player-billing/statement/' + tokJuan);
ok(!JSON.stringify(pubJuan.data).includes('HABLAR-CON-EL-COACH'),
  'la nota interna de un cargo no viaja en el estado de cuenta del papá');

console.log(`\n========  ${pass} ok, ${fail} fallas  ========`);
console.log(JSON.stringify({ TEAM, JUAN, CARLOS, ANA }));
await pool.end();
process.exit(fail > 0 ? 1 : 0);
