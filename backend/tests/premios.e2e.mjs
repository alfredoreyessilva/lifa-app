// Recorrido de los PREMIOS POR ACERTAR — README, "Premios por acertar".
//
// Por qué una suite y no bastan las unitarias: quién gana un premio no se
// guarda en ningún lado, se pregunta cada vez con la misma regla que reparte
// los puntos. Lo único que puede fallar en silencio es el viaje completo: que
// el candado para poner un premio sea el mismo que el del voto, que el aviso del
// resultado traiga el premio solo a quien acertó, que el código que ve el
// ganador sea el que la tienda puede cobrar —una sola vez—, y que una tienda
// que deja de estar publicada y verificada se lleve sus premios.
//
// El interruptor es un botón del Panel Admin (`platform_switches`): la suite lo
// prende con su propia cuenta de admin, prueba al final que apagado los premios no
// existen y que prendido vuelven, y lo deja como lo encontró. Se crea sus propios
// datos y se puede correr varias veces. Instrucciones en tests/README.md.
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
  body: { name: `${quien} ${stamp}`, email: `${quien.toLowerCase()}${stamp}@example.com`, password: 'prueba123' },
})).data.token;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
const idDe = async (quien) => (await pool.query(
  'SELECT id FROM users WHERE email=$1', [`${quien.toLowerCase()}${stamp}@example.com`]
)).rows[0]?.id;

// Mover un partido en el tiempo, con la hora de la BASE (el reloj de esta
// máquina va atrasado contra Neon).
const moverA = (matchId, intervalo) => pool.query(
  `UPDATE matches SET match_date = to_char((NOW() + $2::interval) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
   WHERE id = $1`, [matchId, intervalo]);

async function esperarEvento(matchId, tipo) {
  for (let i = 0; i < 20; i++) {
    const { rows } = await pool.query('SELECT id FROM match_events WHERE match_id=$1 AND type=$2', [matchId, tipo]);
    if (rows.length > 0) return rows.length;
    await new Promise((r) => setTimeout(r, 150));
  }
  return 0;
}

const bandeja = async (token) => (await call('/notifications/mine', { token })).data.items || [];
const resultadoDe = async (token, matchId) => (await bandeja(token))
  .find((i) => i.type === 'prediction_result' && i.match?.id === matchId);
const misPremios = async (token) => (await call('/prizes/mine', { token })).data.prizes || [];
const FORMA_DE_CODIGO = /^CFB-\d+-[0-9A-HJKMNP-TV-Z]{6}$/;

console.log('\n=== 0. El interruptor: el admin prende los premios desde su panel ===');
// La cuenta de admin nace aquí, porque es la que mueve el botón.
await alta('PlatPremios');
const idPlat = await idDe('PlatPremios');
await pool.query("UPDATE users SET role='admin' WHERE id=$1", [idPlat]);
const PLAT = (await call('/auth/login', {
  method: 'POST', body: { email: `platpremios${stamp}@example.com`, password: 'prueba123' },
})).data.token;
ok(!!PLAT, 'una cuenta de admin de la plataforma, solo en esta rama');

const BOTON = '/admin/switches/prediction_prizes';
const comoEstaba = await call('/admin/switches', { token: PLAT });
ok(comoEstaba.status === 200 && typeof comoEstaba.data.switches?.prediction_prizes?.enabled === 'boolean',
  'el Panel Admin lee el interruptor de los premios', `=${comoEstaba.status} ${JSON.stringify(comoEstaba.data).slice(0, 200)}`);
// Para dejarlo como estaba al terminar.
const estabaPrendido = comoEstaba.data.switches?.prediction_prizes?.enabled === true;
const prender = await call(BOTON, { method: 'PUT', token: PLAT, body: { enabled: true } });
ok(prender.status === 200 && prender.data.enabled === true, 'el admin lo prende: 200', `=${prender.status} ${JSON.stringify(prender.data).slice(0, 200)}`);
const estado = await call('/prizes/status');
ok(estado.status === 200 && estado.data.enabled === true, 'y el público ya lo ve prendido, sin reiniciar nada', JSON.stringify(estado.data));
if (estado.data.enabled !== true) {
  console.log('\n  !! El backend del 4100 no prendió los premios: ¿corre el código de este árbol? (ver tests/README.md)\n');
  await pool.end();
  process.exit(2);
}

console.log('\n=== 1. Una liga pública con sus partidos, una privada, y la plataforma ===');

const LIGA = await alta('LigaPremios');
const lg = await call('/leagues', { method: 'POST', token: LIGA, body: { name: `Liga Premios ${stamp}`, state: 'CIUDAD DE MEXICO' } });
const LEAGUE = lg.data.league?.id ?? lg.data.id;
const ct = await call(`/leagues/${LEAGUE}/categories`, { method: 'POST', token: LIGA, body: { name: `Premios ${stamp}` } });
const CAT = ct.data.category?.id ?? ct.data.id;
const br = await call(`/manage/categories/${CAT}/branches`, { method: 'POST', token: LIGA, body: { name: 'Varonil' } });
const BRANCH = br.data.branch?.id ?? br.data.id;
const pub = await call(`/admin/leagues/${LEAGUE}/publish`, { method: 'PUT', token: PLAT });
ok(!!LEAGUE && !!CAT && !!BRANCH && pub.status === 200, 'liga publicada, con categoría y rama', JSON.stringify({ LEAGUE, CAT, BRANCH, pub: pub.status }));

const crear = async (categoria, local, visita, week_label = '1', branch_id = BRANCH) => {
  const r = await call(`/manage/categories/${categoria}/matches`, {
    method: 'POST', token: LIGA,
    body: { home_team: `${local} ${stamp}`, away_team: `${visita} ${stamp}`, match_date_local: '2026-12-05T18:00', week_label, branch_id },
  });
  return r.data.match?.id ?? r.data.id;
};
const M1 = await crear(CAT, 'Halcones', 'Tigres');
const M5 = await crear(CAT, 'Aguilas', 'Lobos');
const BORRADOR = await crear(CAT, 'Osos', 'Pumas');
const AMISTOSO = await crear(CAT, 'Toros', 'Zorros', 'SCRIMMAGE');
const EMPEZADO = await crear(CAT, 'Rayos', 'Truenos');
await call(`/manage/matches/${BORRADOR}`, { method: 'PUT', token: LIGA, body: { is_draft: true } });
await moverA(EMPEZADO, '-1 hours');

// Una liga sin publicar: sus partidos no existen para el público.
const lgP = await call('/leagues', { method: 'POST', token: LIGA, body: { name: `Liga Privada ${stamp}`, state: 'CIUDAD DE MEXICO' } });
const LEAGUE_P = lgP.data.league?.id ?? lgP.data.id;
const ctP = await call(`/leagues/${LEAGUE_P}/categories`, { method: 'POST', token: LIGA, body: { name: `Privada ${stamp}` } });
const CAT_P = ctP.data.category?.id ?? ctP.data.id;
const brP = await call(`/manage/categories/${CAT_P}/branches`, { method: 'POST', token: LIGA, body: { name: 'Varonil' } });
const PRIVADO = await crear(CAT_P, 'Linces', 'Cometas', '1', brP.data.branch?.id ?? brP.data.id);
ok([M1, M5, BORRADOR, AMISTOSO, EMPEZADO, PRIVADO].every(Boolean), 'seis partidos: dos premiables y cuatro que no',
  JSON.stringify({ M1, M5, BORRADOR, AMISTOSO, EMPEZADO, PRIVADO }));

console.log('\n=== 2. Una tienda recién registrada todavía no premia ===');
const TIENDA = await alta('TiendaPremios');
const reg = await call('/organizations', { method: 'POST', token: TIENDA, body: { type: 'store', name: `Deportes Premio ${stamp}` } });
const STORE = reg.data.id;
const producto = async (token, org, body) => (await call(`/products/organization/${org}`, { method: 'POST', token, body })).data;
const JERSEY = await producto(TIENDA, STORE, { name: 'Jersey oficial', price: 899 });
const OCULTO = await producto(TIENDA, STORE, { name: 'Gorra de bodega', price: 300, show_on_platform: false });
const INACTIVO = await producto(TIENDA, STORE, { name: 'Casco viejo', price: 1500 });
await call(`/products/${INACTIVO.id}`, { method: 'PUT', token: TIENDA, body: { is_active: false } });
ok(!!STORE && !!JERSEY.id && !!OCULTO.id && !!INACTIVO.id, 'la tienda con tres productos: uno en la vitrina, uno oculto y uno inactivo');

const ponerPremio = (body, token = TIENDA, org = STORE) => call(`/prizes/organization/${org}`, { method: 'POST', token, body });
const premioDe = (match_id, product_id = JERSEY.id, extra = {}) => ({ match_id, product_id, discount_percent: 20, valid_days: 30, ...extra });

const sinVerificar = await ponerPremio(premioDe(M1));
ok(sinVerificar.status === 403 && /verificada/.test(sinVerificar.data.error), 'sin publicar ni verificar: 403, y dice por qué', `=${sinVerificar.status} ${sinVerificar.data.error}`);
const panelAntes = await call(`/prizes/organization/${STORE}`, { token: TIENDA });
ok(panelAntes.status === 200 && panelAntes.data.can_award === false, 'su panel abre, y dice que todavía no puede', JSON.stringify(panelAntes.data));

await call(`/admin/organizations/${STORE}/verify`, { method: 'PUT', token: PLAT });
const verificadaPrivada = await ponerPremio(premioDe(M1));
ok(verificadaPrivada.status === 403 && /publicada/.test(verificadaPrivada.data.error), 'verificada pero privada: tampoco', `=${verificadaPrivada.status} ${verificadaPrivada.data.error}`);
await call(`/admin/organizations/${STORE}/publish`, { method: 'PUT', token: PLAT });
ok((await call(`/prizes/organization/${STORE}`, { token: TIENDA })).data.can_award === true, 'publicada y verificada: ya puede');

console.log('\n=== 3. Lo que no se puede premiar ===');
const OTRA = await alta('OtraTienda');
const reg2 = await call('/organizations', { method: 'POST', token: OTRA, body: { type: 'store', name: `Otra Tienda ${stamp}` } });
const STORE2 = reg2.data.id;
await call(`/admin/organizations/${STORE2}/verify`, { method: 'PUT', token: PLAT });
await call(`/admin/organizations/${STORE2}/publish`, { method: 'PUT', token: PLAT });
const BALON = await producto(OTRA, STORE2, { name: 'Balón', price: 650 });

for (const [cuerpo, esperado, dice, que] of [
  [premioDe(M1, JERSEY.id, { discount_percent: 3 }), 400, /descuento/, 'un descuento de 3%'],
  [premioDe(M1, JERSEY.id, { discount_percent: 12.5 }), 400, /descuento/, 'un descuento con decimales'],
  [premioDe(M1, BALON.id), 404, /no es de tu tienda/, 'un producto de otra tienda'],
  [premioDe(M1, OCULTO.id), 400, /vitrina/, 'un producto fuera de la vitrina'],
  [premioDe(M1, INACTIVO.id), 400, /vitrina/, 'un producto inactivo'],
  [premioDe(BORRADOR), 404, /no encontrado/i, 'un borrador'],
  [premioDe(PRIVADO), 404, /no encontrado/i, 'un partido de una liga sin publicar'],
  [premioDe(AMISTOSO), 400, /amistoso/, 'un amistoso'],
  [premioDe(EMPEZADO), 400, /ya no se puede votar/, 'un partido que ya empezó'],
]) {
  const r = await ponerPremio(cuerpo);
  ok(r.status === esperado && dice.test(r.data.error || ''), `no se premia ${que}: ${esperado}`, `=${r.status} ${r.data.error}`);
}
const fueraDeLista = await call(`/prizes/organization/${STORE}/matches`, { token: TIENDA });
const idsDeLista = (fueraDeLista.data.matches || []).map((m) => m.match_id);
ok(idsDeLista.includes(M1) && idsDeLista.includes(M5), 'la lista para elegir trae los dos premiables', JSON.stringify(idsDeLista.slice(0, 20)));
ok(![BORRADOR, PRIVADO, AMISTOSO, EMPEZADO].some((id) => idsDeLista.includes(id)), 'y ninguno de los otros cuatro');

console.log('\n=== 4. Poner, retirar y volver a poner ===');
const puesto = await ponerPremio(premioDe(M1));
const PREMIO = puesto.data.prize?.prize_id;
ok(puesto.status === 201 && puesto.data.prize?.state === 'open' && puesto.data.prize?.product?.name === 'Jersey oficial',
  'un premio en un partido que se puede votar: 201, abierto, con la copia del producto', JSON.stringify(puesto.data).slice(0, 300));
ok(!JSON.stringify(puesto.data).includes('code_secret'), 'la respuesta no trae el secreto');
const doble = await ponerPremio(premioDe(M1, JERSEY.id, { discount_percent: 50 }));
ok(doble.status === 409, 'un segundo premio de la misma tienda en el mismo partido: 409', `=${doble.status} ${doble.data.error}`);
const deOtra = await ponerPremio(premioDe(M1, BALON.id, { discount_percent: 100 }), OTRA, STORE2);
ok(deOtra.status === 201, 'otra tienda sí puede ponerle premio al mismo partido', `=${deOtra.status} ${deOtra.data.error}`);

const publico = await call(`/prizes/match/${M1}`);
ok(publico.status === 200 && publico.data.prizes?.length === 2, 'la página del partido enseña los dos, sin sesión', JSON.stringify(publico.data).slice(0, 300));
ok(!JSON.stringify(publico.data).includes('code_secret') && !JSON.stringify(publico.data).includes('"code"'),
  'sin el secreto y sin códigos');
const delJersey = publico.data.prizes?.find((p) => p.id === PREMIO);
ok(delJersey?.store?.name === `Deportes Premio ${stamp}` && delJersey?.store?.is_verified === true && delJersey?.discount_percent === 20,
  'con su tienda, su palomita y su descuento', JSON.stringify(delJersey));

const enM5 = await ponerPremio(premioDe(M5));
const PREMIO5 = enM5.data.prize?.prize_id;
const retiro = await call(`/prizes/organization/${STORE}/${PREMIO5}/withdraw`, { method: 'POST', token: TIENDA });
ok(retiro.status === 200, 'retirarlo antes del partido: 200', `=${retiro.status} ${retiro.data.error}`);
ok((await call(`/prizes/match/${M5}`)).data.prizes?.length === 0, 'y deja de salir en el partido');
const { rows: [fila5] } = await pool.query('SELECT withdrawn_at, withdrawn_by_user_id FROM prediction_prizes WHERE id=$1', [PREMIO5]);
ok(fila5?.withdrawn_at && fila5?.withdrawn_by_user_id === await idDe('TiendaPremios'), 'retirar no borra: queda quién y cuándo', JSON.stringify(fila5));
const otraVez = await ponerPremio(premioDe(M5, JERSEY.id, { discount_percent: 10 }));
ok(otraVez.status === 201, 'y se puede poner otro en el mismo partido', `=${otraVez.status} ${otraVez.data.error}`);

console.log('\n=== 5. Quién entra al panel de premios ===');
ok((await call(`/prizes/organization/${STORE}`, { token: LIGA })).status === 403, 'la liga no entra a los premios de una tienda');
ok((await call(`/prizes/organization/${STORE}`, { token: OTRA })).status === 403, 'ni otra tienda');
ok((await call(`/prizes/organization/${STORE}`)).status === 401, 'ni nadie sin sesión');
const MEDIO = await alta('MedioPremios');
const regM = await call('/organizations', { method: 'POST', token: MEDIO, body: { type: 'media', name: `Medio Premios ${stamp}` } });
ok((await call(`/prizes/organization/${regM.data.id}`, { token: MEDIO })).status === 403, 'el dueño de un medio no tiene el permiso: 403');
ok((await call(`/prizes/organization/${regM.data.id}`, { token: PLAT })).status === 400, 'y al admin de la plataforma, en un medio, le dice que solo una tienda');
ok((await call('/prizes/mine')).status === 401, '"Mis premios" pide sesión');

console.log('\n=== 6. Tres aficionados votan, y se juega ===');
const F1 = await alta('FanLocal');
const F2 = await alta('FanEmpate');
const F3 = await alta('FanVisita');
for (const [token, pick] of [[F1, 'home'], [F2, 'tie'], [F3, 'away']]) {
  const v = await call('/predictions', { method: 'POST', token, body: { match_id: M1, pick } });
  if (v.status !== 201) ok(false, `votar ${pick}`, `=${v.status} ${JSON.stringify(v.data)}`);
}
ok(true, 'tres votos distintos antes de que empiece');

await moverA(M1, '-5 hours');
const tarde = await call(`/prizes/organization/${STORE}/${PREMIO}/withdraw`, { method: 'POST', token: TIENDA });
ok(tarde.status === 409, 'empezado el partido, ya no se retira: 409', `=${tarde.status} ${tarde.data.error}`);
const otroTarde = await ponerPremio(premioDe(M1));
ok(otroTarde.status === 400 && /ya no se puede votar/.test(otroTarde.data.error), 'ni se pone otro: 400, ya no se puede votar', `=${otroTarde.status} ${otroTarde.data.error}`);

await call(`/manage/matches/${M1}`, { method: 'PUT', token: LIGA, body: { home_score: 21, away_score: 14 } });
const fin = await call(`/manage/matches/${M1}/status`, { method: 'PATCH', token: LIGA, body: { status: 'finished' } });
ok(fin.status === 200 && (await esperarEvento(M1, 'finished')) === 1, 'HALCONES 21 · TIGRES 14, finalizado');

console.log('\n=== 7. El premio llega con el aviso del resultado, solo a quien acertó ===');
const r1 = await resultadoDe(F1, M1);
ok(r1?.data?.correct === true && r1?.data?.prizes?.length === 2, 'F1 acertó: su aviso trae los dos premios', JSON.stringify(r1?.data).slice(0, 400));
const delJersey1 = r1?.data?.prizes?.find((p) => p.id === PREMIO);
ok(FORMA_DE_CODIGO.test(delJersey1?.code || '') && delJersey1?.status === 'valid' && delJersey1?.expires_at,
  'con su código, vigente y con su vencimiento', JSON.stringify(delJersey1));
const { rows: [{ termino }] } = await pool.query(
  "SELECT MAX(created_at) AS termino FROM match_events WHERE match_id=$1 AND type IN ('finished','final_score')", [M1]);
const dias = (new Date(delJersey1?.expires_at) - new Date(termino)) / 86400000;
ok(Math.abs(dias - 30) < 0.01, 'vence a los 30 días de que terminó', `${dias} días`);
ok(!JSON.stringify(r1).includes('code_secret'), 'sin el secreto');
const r2 = await resultadoDe(F2, M1);
const r3 = await resultadoDe(F3, M1);
ok(r2?.data?.correct === false && !r2?.data?.prizes && r3?.data?.correct === false && !r3?.data?.prizes,
  'F2 y F3 no acertaron: su aviso de siempre, sin premio', JSON.stringify([r2?.data, r3?.data]));
const unread = await call('/notifications/mine/unread', { token: F1 });
ok(unread.status === 200 && Number.isInteger(unread.data.unread), 'el balón sigue contestando igual');

const deF1 = await misPremios(F1);
ok(deF1.length === 2 && deF1.some((p) => p.code === delJersey1?.code), '"Mis premios" de F1: los mismos dos, con el mismo código', JSON.stringify(deF1).slice(0, 300));
ok((await misPremios(F2)).length === 0, '"Mis premios" de F2: nada');

const panel = (await call(`/prizes/organization/${STORE}`, { token: TIENDA })).data.prizes?.find((p) => p.prize_id === PREMIO);
ok(panel?.state === 'awarded' && panel?.votes === 3 && panel?.winners === 1 && panel?.redeemed === 0,
  'la tienda ve: entregado, 3 votos, 1 acertó, 0 cobrados', JSON.stringify(panel && { s: panel.state, v: panel.votes, w: panel.winners, r: panel.redeemed }));
ok(!JSON.stringify(panel).includes('FanLocal') && !JSON.stringify(panel).includes('example.com'), 'y nunca quién');

console.log('\n=== 8. Cobrarlo en la tienda, una sola vez ===');
const CODIGO = delJersey1?.code;
const revisar = (code, token = TIENDA, org = STORE) => call(`/prizes/organization/${org}/redeem/check`, { method: 'POST', token, body: { code } });
const cobrar = (code, token = TIENDA, org = STORE) => call(`/prizes/organization/${org}/redeem`, { method: 'POST', token, body: { code } });

const vale = await revisar(CODIGO);
ok(vale.status === 200 && vale.data.result === 'valid' && vale.data.product?.name === 'Jersey oficial' && vale.data.discount_percent === 20,
  'revisarlo: vale, y de qué es', JSON.stringify(vale.data));
ok(!JSON.stringify(vale.data).includes('FanLocal') && vale.data.user_id === undefined, 'sin decir de quién es');
const tecleado = ` ${CODIGO.toLowerCase().replace(/-/g, ' ')} `;
ok((await revisar(tecleado)).data.result === 'valid', 'escrito en minúsculas y con espacios, también', tecleado);
ok((await revisar(`CFB-${PREMIO}-ZZZZZZ`)).data.result === 'not_found', 'uno inventado no es de nadie');
ok((await revisar(CODIGO, OTRA, STORE2)).data.result === 'not_found', 'otra tienda no lo encuentra');
ok((await revisar(CODIGO)).data.result === 'valid', 'revisar no gasta nada');

const cobro = await cobrar(CODIGO);
ok(cobro.status === 201 && cobro.data.result === 'redeemed' && cobro.data.redeemed_at, 'marcarlo como usado: 201', `=${cobro.status} ${JSON.stringify(cobro.data)}`);
const dosVeces = await cobrar(CODIGO);
ok(dosVeces.status === 409 && dosVeces.data.result === 'redeemed', 'una segunda vez: 409, ya se usó', `=${dosVeces.status} ${dosVeces.data.result}`);
const codigoDelBalon = premioDeLaTienda(await misPremios(F1), STORE2)?.code;
const [a, b] = await Promise.all([cobrar(codigoDelBalon, OTRA, STORE2), cobrar(codigoDelBalon, OTRA, STORE2)]);
ok([a.status, b.status].sort().join(',') === '201,409', 'dos cobros al mismo tiempo en la otra tienda: uno pasa y el otro se entera', `${a.status},${b.status}`);
const { rows: [{ canjes }] } = await pool.query('SELECT COUNT(*)::int AS canjes FROM prediction_prize_redemptions WHERE user_id=$1', [await idDe('FanLocal')]);
ok(canjes === 2, 'en la base, un canje por premio', `=${canjes}`);
ok((await misPremios(F1)).find((p) => p.id === PREMIO)?.status === 'redeemed', 'en "Mis premios" de F1 ya dice usado');
ok((await resultadoDe(F1, M1))?.data?.prizes?.find((p) => p.id === PREMIO)?.status === 'redeemed', 'y en su aviso');
ok((await call(`/prizes/organization/${STORE}`, { token: TIENDA })).data.prizes?.find((p) => p.prize_id === PREMIO)?.redeemed === 1,
  'la tienda ve 1 cobrado');

function premioDeLaTienda(premios, tienda) { return premios.find((p) => p.store?.id === tienda); }

console.log('\n=== 9. Corregir el marcador mueve el premio; lo cobrado se queda ===');
await call(`/manage/matches/${M1}`, { method: 'PUT', token: LIGA, body: { home_score: 14, away_score: 21 } });
const corregido3 = await resultadoDe(F3, M1);
ok(corregido3?.data?.correct === true && corregido3?.data?.prizes?.length === 2, 'ahora acertó F3, y su aviso trae los premios', JSON.stringify(corregido3?.data).slice(0, 200));
ok((await resultadoDe(F1, M1))?.data?.prizes === undefined && (await misPremios(F1)).length === 0, 'F1 ya no acertó: sin premios');
const { rows: [{ siguen }] } = await pool.query('SELECT COUNT(*)::int AS siguen FROM prediction_prize_redemptions WHERE user_id=$1', [await idDe('FanLocal')]);
ok(siguen === 2, 'pero sus dos canjes siguen en la base: lo entregado no se deshace', `=${siguen}`);
const codigo3 = (await misPremios(F3)).find((p) => p.id === PREMIO)?.code;
ok(FORMA_DE_CODIGO.test(codigo3 || '') && codigo3 !== CODIGO, 'F3 tiene su propio código', codigo3);
ok((await revisar(CODIGO)).data.result === 'not_found', 'y el de F1 ya no es de un ganador');

console.log('\n=== 10. Un premio vencido ya no se cobra ===');
await pool.query("UPDATE match_events SET created_at = NOW() - INTERVAL '40 days' WHERE match_id=$1", [M1]);
const vencido = await revisar(codigo3);
ok(vencido.data.result === 'expired', 'pasados los 30 días, revisarlo dice que venció', JSON.stringify(vencido.data));
ok((await cobrar(codigo3)).status === 409, 'y cobrarlo da 409');
ok((await misPremios(F3)).find((p) => p.id === PREMIO)?.status === 'expired', 'en "Mis premios" dice vencido');

console.log('\n=== 11. Si CFBAMX le quita la verificación, sus premios se van, y vuelven ===');
await call(`/admin/organizations/${STORE}/unverify`, { method: 'PUT', token: PLAT });
ok(!(await call(`/prizes/match/${M1}`)).data.prizes?.some((p) => p.id === PREMIO), 'deja de salir en el partido');
ok(!(await misPremios(F3)).some((p) => p.id === PREMIO), 'y en "Mis premios" de quien lo ganó');
ok((await revisar(codigo3)).status === 403, 'y sus códigos no se cobran');
ok((await call(`/prizes/organization/${STORE}`, { token: TIENDA })).data.can_award === false, 'su panel dice que no puede');
await call(`/admin/organizations/${STORE}/verify`, { method: 'PUT', token: PLAT });
ok((await misPremios(F3)).some((p) => p.id === PREMIO), 'verificada otra vez: vuelve, sin que se haya borrado nada');

console.log('\n=== 12. Apagados, los premios no existen; prendidos otra vez, vuelven ===');
ok((await call(BOTON, { method: 'PUT', token: TIENDA, body: { enabled: false } })).status === 403, 'una tienda no mueve el botón: 403');
ok((await call(BOTON, { method: 'PUT', body: { enabled: false } })).status === 401, 'ni nadie sin sesión: 401');
ok((await call('/admin/switches', { token: TIENDA })).status === 403, 'ni lo lee');
ok((await call('/admin/switches/no_existe', { method: 'PUT', token: PLAT, body: { enabled: false } })).status === 404,
  'un interruptor que no existe: 404');
ok((await call(BOTON, { method: 'PUT', token: PLAT, body: { enabled: 'no' } })).status === 400, 'sin true o false: 400');

// La sección 10 dejó el final de M1 hace 40 días, fuera de la bandeja, que guarda
// 30. Se regresa a hace una hora para ver el mismo aviso con y sin premio.
await pool.query("UPDATE match_events SET created_at = NOW() - INTERVAL '1 hour' WHERE match_id=$1", [M1]);
ok((await resultadoDe(F3, M1))?.data?.prizes?.length === 2, 'prendidos, el aviso de F3 trae sus dos premios');

const filas = async () => (await pool.query(
  "SELECT COUNT(*)::int AS n FROM platform_switches WHERE switch_key='prediction_prizes'"
)).rows[0].n;
const filasAntes = await filas();
const apagar = await call(BOTON, { method: 'PUT', token: PLAT, body: { enabled: false } });
ok(apagar.status === 200 && apagar.data.enabled === false
  && apagar.data.history?.[0]?.enabled === false
  && apagar.data.history?.[0]?.changed_by_name?.toLowerCase() === `platpremios ${stamp}`,
  'el admin lo apaga, y queda quién fue', JSON.stringify(apagar.data.history?.[0]));
await call(BOTON, { method: 'PUT', token: PLAT, body: { enabled: false } });
ok(await filas() === filasAntes + 1, 'apagarlo dos veces deja una sola fila', `=${await filas()} (antes ${filasAntes})`);

ok((await call('/prizes/status')).data.enabled === false, 'el público lo ve apagado al instante');
ok((await call(`/prizes/match/${M1}`)).data.prizes?.length === 0, 'el partido ya no enseña premios');
ok((await misPremios(F3)).length === 0, '"Mis premios" llega vacío');
const avisoApagado = await resultadoDe(F3, M1);
ok(avisoApagado?.data?.correct === true && !avisoApagado?.data?.prizes, 'el aviso del resultado sigue, sin premio', JSON.stringify(avisoApagado?.data).slice(0, 200));
ok((await call(`/prizes/organization/${STORE}`, { token: TIENDA })).status === 404, 'la sección de la tienda contesta 404, como si no existiera');
ok((await revisar(codigo3)).status === 404, 'y no cobra códigos');
const { rows: [{ siguenPuestos }] } = await pool.query(
  'SELECT COUNT(*)::int AS "siguenPuestos" FROM prediction_prizes WHERE match_id=$1 AND withdrawn_at IS NULL', [M1]
);
ok(siguenPuestos === 2, 'en la base no se borró nada', `=${siguenPuestos}`);

const reprender = await call(BOTON, { method: 'PUT', token: PLAT, body: { enabled: true } });
ok(reprender.status === 200 && reprender.data.enabled === true, 'prendido otra vez');
ok((await misPremios(F3)).some((p) => p.id === PREMIO), 'vuelve todo como estaba: "Mis premios"');
ok((await call(`/prizes/match/${M1}`)).data.prizes?.some((p) => p.id === PREMIO), 'la página del partido');
ok((await resultadoDe(F3, M1))?.data?.prizes?.length === 2, 'y el aviso, con sus dos premios');
const panelAdmin = (await call('/admin/switches', { token: PLAT })).data;
const historial = panelAdmin.switches?.prediction_prizes?.history || [];
ok(historial[0]?.enabled === true && historial[1]?.enabled === false && historial[2]?.enabled === true,
  'el historial va de lo último a lo primero: prendido, apagado, prendido', JSON.stringify(historial.slice(0, 3).map((h) => h.enabled)));
ok(Number.isInteger(panelAdmin.prizes?.active) && panelAdmin.prizes.active >= 3 && panelAdmin.prizes?.stores >= 2,
  'y el panel cuenta los premios puestos y las tiendas que pueden ponerlos', JSON.stringify(panelAdmin.prizes));

// Para no sembrar tiendas de prueba en el home de la rama, se ocultan al final, y
// el interruptor se deja como estaba antes de la suite.
await call(`/admin/organizations/${STORE}/unpublish`, { method: 'PUT', token: PLAT });
await call(`/admin/organizations/${STORE2}/unpublish`, { method: 'PUT', token: PLAT });
await call(`/admin/leagues/${LEAGUE}/unpublish`, { method: 'PUT', token: PLAT });
if (!estabaPrendido) await call(BOTON, { method: 'PUT', token: PLAT, body: { enabled: false } });
ok((await call('/prizes/status')).data.enabled === estabaPrendido,
  `el interruptor queda como estaba: ${estabaPrendido ? 'prendido' : 'apagado'}`);
await pool.query("UPDATE users SET role='rep' WHERE id=$1", [idPlat]);

console.log(`\n========  ${pass} ok, ${fail} fallas  ========`);
await pool.end();
process.exit(fail ? 1 : 0);
