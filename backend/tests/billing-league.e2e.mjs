// Recorrido de la conciliación liga → equipo: el equipo reporta un pago con
// comprobante y la liga lo confirma o lo rechaza. Se crea sus propios datos.
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

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });

console.log('\n=== 1. Liga con un equipo ===');
const reg = await call('/auth/register', { method: 'POST', body: { name: 'Presi Liga', email: `liga${stamp}@example.com`, password: 'prueba123' } });
const L = reg.data.token;
const lg = await call('/leagues', { method: 'POST', token: L, body: { name: `Liga E2E ${stamp}`, state: 'CIUDAD DE MEXICO' } });
const LEAGUE = lg.data.league?.id ?? lg.data.id;
ok(!!LEAGUE, 'liga creada', JSON.stringify(lg.data).slice(0, 140));
const tm = await call(`/manage/leagues/${LEAGUE}/teams`, { method: 'POST', token: L, body: { name: `Equipo E2E ${stamp}` } });
const TEAM = tm.data.team?.id ?? tm.data.id;
ok(!!TEAM, 'equipo creado dentro de la liga', JSON.stringify(tm.data).slice(0, 140));

const lov = () => call(`/billing/leagues/${LEAGUE}/overview`, { token: L });
const stmt = () => call(`/billing/teams/${TEAM}/statement`, { token: L });
const rowsOf = async () => (await pool.query(
  'SELECT id, kind, status, amount, direction FROM team_ledger_entries WHERE league_id=$1 AND team_id=$2 ORDER BY id', [LEAGUE, TEAM]
)).rows;

console.log('\n=== 2. La liga le cobra al equipo ===');
const ch = await call(`/billing/leagues/${LEAGUE}/charges`, { method: 'POST', token: L, body: {
  category: 'arbitraje', concept: 'Arbitraje J1', due_date: '2026-09-30',
  items: [{ team_id: TEAM, amount: 2000 }] } });
ok(ch.status === 201, 'cargo creado', JSON.stringify(ch.data).slice(0, 120));
let st = await stmt();
ok(Number(st.data.balance) === -2000, 'el equipo debe 2000', `=${st.data.balance}`);

console.log('\n=== 3. El equipo reporta su pago (antes solo escribía la liga) ===');
const rep = await call(`/billing/teams/${TEAM}/report-payment`, { method: 'POST', token: L, body: {
  amount: 2000, payment_method: 'transferencia', reference: 'SPEI-LIGA' } });
ok(rep.status === 201, 'se reportó', JSON.stringify(rep.data).slice(0, 120));
st = await stmt();
ok(Number(st.data.balance) === -2000, 'el saldo NO bajó todavía', `=${st.data.balance}`);
ok(st.data.has_pending_payment === true, 'el equipo ve que está en revisión');
const dup = await call(`/billing/teams/${TEAM}/report-payment`, { method: 'POST', token: L, body: { amount: 2000, payment_method: 'efectivo' } });
ok(dup.status === 409, 'no deja reportar dos veces', `=${dup.status}`);
let ov = await lov();
ok((ov.data.pending_payments || []).length === 1, 'a la liga le aparece 1 por confirmar', `=${(ov.data.pending_payments || []).length}`);

console.log('\n=== 4. La liga rechaza: no infla el saldo ===');
const antes = (await rowsOf()).length;
const pend = ov.data.pending_payments[0];
await call(`/billing/entries/${pend.id}/void`, { method: 'POST', token: L, body: { reason: 'no aparece en la cuenta' } });
let rows = await rowsOf();
ok(rows.length === antes, 'rechazar NO agrega ajuste', `antes=${antes} ahora=${rows.length}`);
ok(rows.find((r) => r.id === pend.id).status === 'rejected', "queda en 'rejected'", `=${rows.find((r) => r.id === pend.id).status}`);
st = await stmt();
ok(Number(st.data.balance) === -2000, 'sigue debiendo 2000, no 0', `=${st.data.balance}`);

console.log('\n=== 5. Retirar y confirmar ===');
await call(`/billing/teams/${TEAM}/report-payment`, { method: 'POST', token: L, body: { amount: 2000, payment_method: 'deposito' } });
await call(`/billing/teams/${TEAM}/withdraw-payment`, { method: 'POST', token: L });
st = await stmt();
ok(st.data.has_pending_payment === false, 'se retiró');
ok(Number(st.data.balance) === -2000, 'el saldo no se movió al retirar', `=${st.data.balance}`);
await call(`/billing/teams/${TEAM}/report-payment`, { method: 'POST', token: L, body: { amount: 2000, payment_method: 'transferencia' } });
ov = await lov();
const p2 = ov.data.pending_payments[0];
const conf = await call(`/billing/entries/${p2.id}/confirm`, { method: 'POST', token: L });
ok(conf.status === 200, 'la liga confirmó');
st = await stmt();
ok(Number(st.data.balance) === 0, 'AHORA sí queda en 0', `=${st.data.balance}`);
rows = await rowsOf();
ok(rows.find((r) => r.kind === 'charge').status === 'settled', 'el cargo pasó a saldado');

console.log('\n=== 6. Cancelar un cargo confirmado sigue cuadrando ===');
const cargo = rows.find((r) => r.kind === 'charge');
await call(`/billing/entries/${cargo.id}/void`, { method: 'POST', token: L, body: { reason: 'cargo mal capturado' } });
rows = await rowsOf();
ok(rows.some((r) => r.kind === 'adjustment' && r.direction === 'credit'), 'sí generó el ajuste de reversa');
st = await stmt();
ok(Number(st.data.balance) === 2000, 'queda saldo a favor de 2000 (pagó y le cancelaron el cargo)', `=${st.data.balance}`);

console.log('\n=== 7. Aislamiento ===');
const otro = (await call('/auth/register', { method: 'POST', body: { name: 'X', email: `y${stamp}@example.com`, password: 'prueba123' } })).data.token;
ok((await call(`/billing/leagues/${LEAGUE}/overview`, { token: otro })).status === 403, 'otro usuario no ve la cobranza de la liga');
ok((await call(`/billing/teams/${TEAM}/report-payment`, { method: 'POST', token: otro, body: { amount: 1, payment_method: 'efectivo' } })).status === 403, 'otro usuario no puede reportar por ese equipo');

console.log(`\n========  ${pass} ok, ${fail} fallas  ========`);
await pool.end();
process.exit(fail > 0 ? 1 : 0);
