// Recorrido de las COMPRAS EN LA VITRINA — README, "Compras en la vitrina".
//
// Por qué una suite y no bastan las unitarias: lo que de verdad puede fallar en
// silencio vive en la base y en el viaje. Que crear un pedido sea una sola
// sentencia; que el renglón "pagado" y la salida de existencias vayan juntos y no
// se repitan con un aviso repetido; que la última pieza pagada dos veces deje un
// "Sin existencias" y no un número negativo; que el reembolso regrese lo que
// salió; que solo un dueño conecte Mercado Pago; que apagadas las compras un
// pedido pagado siga existiendo.
//
// Corre contra un Mercado Pago de mentira (tests/fakes/mercadoPago.mjs) que esta
// misma suite levanta en el 4200. El backend del 4100 tiene que arrancar
// apuntándole, con las variables de abajo. Las cuentas y los pedidos salen cada
// uno con su propio X-Forwarded-For (el backend confía en un proxy): la suite no
// gasta el cupo de /auth de las demás ni se topa con el de crear pedidos.
//
//   PORT=4100 MP_API_BASE=http://localhost:4200 MP_CLIENT_ID=cfbamx-pruebas \
//   MP_CLIENT_SECRET=secreto-de-pruebas MP_WEBHOOK_SECRET=avisos-de-pruebas \
//   MP_TOKEN_KEY=llave-de-pruebas SITE_URL=http://localhost:5173 \
//   API_PUBLIC_URL=http://localhost:4100 node src/server.js
//
//   MP_WEBHOOK_SECRET=avisos-de-pruebas node -r dotenv/config tests/compras.e2e.mjs
//
// La suite prende las compras con su propia cuenta de admin y al final deja el
// botón y la comisión como los encontró, y oculta sus tiendas y su liga.
import pg from 'pg';
import { mercadoPagoDeMentira } from './fakes/mercadoPago.mjs';

const API = 'http://localhost:4100/api';
const stamp = Date.now();
let pass = 0, fail = 0;
const ok = (c, l, e = '') => { if (c) { console.log(`  OK    ${l}`); pass++; } else { console.log(`  FALLA ${l} ${e}`); fail++; } };

// Una IP inventada por pedido, y una fija para lo demás de esta suite.
const base = `10.${(stamp % 200) + 20}`;
let siguienteIp = 1;
const ipNueva = () => `${base}.${Math.floor(siguienteIp / 250) + 1}.${(siguienteIp++ % 250) + 1}`;
const IP_DE_LA_SUITE = `${base}.250.250`;

async function call(path, { method = 'GET', body, token, ip = IP_DE_LA_SUITE } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': ip };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 429) {
    console.log(`\n  !! ${path} recibió 429: limitador de peticiones. Reinicia el backend y repite.\n`);
    await terminar(2);
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

// Mover un partido en el tiempo con la hora de la BASE: el reloj de esta máquina
// va atrasado contra Neon.
const moverA = (matchId, intervalo) => pool.query(
  `UPDATE matches SET match_date = to_char((NOW() + $2::interval) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
   WHERE id = $1`, [matchId, intervalo]);

const MP = mercadoPagoDeMentira({ puerto: 4200, secretoDeAvisos: process.env.MP_WEBHOOK_SECRET || 'avisos-de-pruebas' });
let terminando = false;
async function terminar(codigo) {
  if (terminando) return;
  terminando = true;
  await MP.cerrar().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(codigo);
}

try {
  await MP.iniciar();
} catch (e) {
  console.log(`\n  !! No se pudo levantar el Mercado Pago de mentira en el 4200 (${e.message}). ¿Quedó otra suite viva?\n`);
  await pool.end();
  process.exit(2);
}

// Lo que se pide a cada rato.
const stock = async (productId) => (await pool.query('SELECT stock, size_stock FROM products WHERE id=$1', [productId])).rows[0];
const renglones = async (orderId, kind) => (await pool.query(
  'SELECT * FROM store_order_events WHERE order_id=$1 AND kind=$2 ORDER BY id', [orderId, kind]
)).rows;
const movimientos = async (orderId) => (await pool.query(
  'SELECT kind, product_id, size_label, quantity FROM store_order_stock_moves WHERE order_id=$1 ORDER BY id', [orderId]
)).rows;
const pedidoDe = async (token, extra = '') => (await call(`/shop/orders/${token}${extra}`)).data;
const prefDe = (orderId) => [...MP.preferencias.entries()]
  .filter(([, p]) => p.cuerpo.external_reference === `cfbamx-${orderId}`)
  .map(([id, p]) => ({ id, ...p }))
  .at(-1);

console.log('\n=== 0. El botón: el admin prende las compras desde su panel ===');
await alta('PlatCompras');
const idPlat = await idDe('PlatCompras');
await pool.query("UPDATE users SET role='admin' WHERE id=$1", [idPlat]);
const PLAT = (await call('/auth/login', {
  method: 'POST', body: { email: `platcompras${stamp}@example.com`, password: 'prueba123' },
})).data.token;
ok(!!PLAT, 'una cuenta de admin de la plataforma, solo en esta rama');

const panel0 = await call('/admin/shop', { token: PLAT });
ok(panel0.status === 200 && typeof panel0.data.switch?.enabled === 'boolean', 'Panel Admin → Compras abre', `=${panel0.status} ${JSON.stringify(panel0.data).slice(0, 200)}`);
ok(panel0.data.configured === true && panel0.data.missing_variables?.length === 0,
  'el backend tiene las variables de Mercado Pago', JSON.stringify(panel0.data.missing_variables));
const estabaPrendido = panel0.data.switch?.enabled === true;
const comisionDeAntes = Number(panel0.data.fee?.percent ?? 0);
const BOTON = '/admin/switches/store_purchases';
const COMISION = '/admin/settings/purchase_fee_percent';
await call(COMISION, { method: 'PUT', token: PLAT, body: { value: 0 } });
const prender = await call(BOTON, { method: 'PUT', token: PLAT, body: { enabled: true } });
ok(prender.status === 200 && prender.data.enabled === true, 'el admin las prende: 200', `=${prender.status} ${JSON.stringify(prender.data).slice(0, 200)}`);
const estado0 = await call('/shop/status');
ok(estado0.data.enabled === true, 'y el público ya las ve prendidas', JSON.stringify(estado0.data));
if (estado0.data.enabled !== true) {
  console.log('\n  !! El backend del 4100 no tiene las compras: ¿arrancó con las variables MP_* de arriba y con el código de este árbol?\n');
  await terminar(2);
}

console.log('\n=== 1. Una liga pública con partidos donde poner un puesto ===');
const LIGA = await alta('LigaCompras');
const lg = await call('/leagues', { method: 'POST', token: LIGA, body: { name: `Liga Compras ${stamp}`, state: 'CIUDAD DE MEXICO' } });
const LEAGUE = lg.data.league?.id ?? lg.data.id;
const ct = await call(`/leagues/${LEAGUE}/categories`, { method: 'POST', token: LIGA, body: { name: `Compras ${stamp}` } });
const CAT = ct.data.category?.id ?? ct.data.id;
const br = await call(`/manage/categories/${CAT}/branches`, { method: 'POST', token: LIGA, body: { name: 'Varonil' } });
const BRANCH = br.data.branch?.id ?? br.data.id;
await call(`/admin/leagues/${LEAGUE}/publish`, { method: 'PUT', token: PLAT });
const crear = async (categoria, local, visita, branch_id = BRANCH) => {
  const r = await call(`/manage/categories/${categoria}/matches`, {
    method: 'POST', token: LIGA,
    body: { home_team: `${local} ${stamp}`, away_team: `${visita} ${stamp}`, match_date_local: '2026-12-05T18:00', week_label: '1', branch_id },
  });
  return r.data.match?.id ?? r.data.id;
};
const M_ABIERTO = await crear(CAT, 'Halcones', 'Tigres');
const M_CERRADO = await crear(CAT, 'Rayos', 'Truenos');
const M_LEJANO = await crear(CAT, 'Osos', 'Lobos');
const M_BORRADOR = await crear(CAT, 'Toros', 'Zorros');
await moverA(M_ABIERTO, '5 days');
await moverA(M_CERRADO, '2 hours');
await moverA(M_LEJANO, '40 days');
await moverA(M_BORRADOR, '5 days');
await call(`/manage/matches/${M_BORRADOR}`, { method: 'PUT', token: LIGA, body: { is_draft: true } });
ok([LEAGUE, CAT, BRANCH, M_ABIERTO, M_CERRADO, M_LEJANO, M_BORRADOR].every(Boolean), 'liga publicada con cuatro partidos',
  JSON.stringify({ LEAGUE, CAT, BRANCH, M_ABIERTO, M_CERRADO, M_LEJANO, M_BORRADOR }));

console.log('\n=== 2. Una tienda recién registrada todavía no vende ===');
const TIENDA = await alta('TiendaCompras');
const STORE = (await call('/organizations', { method: 'POST', token: TIENDA, body: { type: 'store', name: `Deportes Compras ${stamp}` } })).data.id;
const producto = async (body, token = TIENDA, org = STORE) => call(`/products/organization/${org}`, { method: 'POST', token, body });
const JERSEY = (await producto({ name: 'Jersey', price: 850, size_variant: 'S, M, L', size_stock: { S: 1, M: 2, L: 0 } })).data;
const GORRA = (await producto({ name: 'Gorra', price: 300, stock: 5 })).data;
const BALON = (await producto({ name: 'Balón', price: 650 })).data;
const ULTIMA = (await producto({ name: 'Última pieza', price: 500, stock: 1 })).data;
const CASCO = (await producto({ name: 'Casco', price: null, stock: null })).data;
ok(JERSEY.stock === 3 && JERSEY.size_stock?.M === 2, 'las existencias por talla se guardan, y el número es su suma', JSON.stringify({ stock: JERSEY.stock, size_stock: JERSEY.size_stock }));
// La ventana del producto manda null cuando un campo va vacío; hasta el 2026-11-14
// se guardaba como 0: "$0" en la vitrina y "Agotado" en el panel.
ok(CASCO.price === null && CASCO.stock === null, 'sin precio y sin existencias se guardan vacíos, no en 0', JSON.stringify({ price: CASCO.price, stock: CASCO.stock }));
const sinPrecio = await call(`/products/${GORRA.id}`, { method: 'PUT', token: TIENDA, body: { price: null } });
ok(sinPrecio.data.price === null, 'y quitarle el precio a uno lo deja a consultar');
await call(`/products/${GORRA.id}`, { method: 'PUT', token: TIENDA, body: { price: 300 } });
const tallasMal = await producto({ name: 'Short', price: 400, size_variant: 'S, M', size_stock: { S: 1 } });
ok(tallasMal.status === 400 && /todas las tallas/.test(tallasMal.data.error), 'de todas las tallas o de ninguna: 400', `=${tallasMal.status} ${tallasMal.data.error}`);
const cambioDeTallas = await call(`/products/${JERSEY.id}`, { method: 'PUT', token: TIENDA, body: { stock: 99 } });
ok(cambioDeTallas.data.stock === 3, 'un número suelto no pisa la suma de las tallas', `=${cambioDeTallas.data.stock}`);

const ADMIN_T = await alta('AdminTienda');
await pool.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'admin')", [STORE, await idDe('AdminTienda')]);
const OTRA = await alta('OtraTienda');
const STORE2 = (await call('/organizations', { method: 'POST', token: OTRA, body: { type: 'store', name: `Otra Tienda ${stamp}` } })).data.id;
const CURIOSO = await alta('Curioso');

ok((await call(`/shop/stores/${STORE}`)).status === 404, 'privada: no existe para el público');
const deLaDuena = await call(`/shop/stores/${STORE}`, { token: TIENDA });
ok(deLaDuena.status === 200 && deLaDuena.data.selling === false && !('missing' in deLaDuena.data), 'su dueña la ve, sin vender y sin decir por qué', JSON.stringify(deLaDuena.data));
const panel1 = await call(`/store-sales/${STORE}`, { token: TIENDA });
ok(panel1.status === 200 && panel1.data.selling === false, 'su panel abre y dice que no vende', `=${panel1.status}`);
ok(JSON.stringify(panel1.data.missing) === JSON.stringify(['publicada', 'verificada', 'mercado_pago', 'domicilio', 'telefono', 'politica', 'entrega']),
  'y lo que le falta, en orden', JSON.stringify(panel1.data.missing));
ok((await call(`/store-sales/${STORE}`)).status === 401, 'sin sesión: 401');
ok((await call(`/store-sales/${STORE}`, { token: CURIOSO })).status === 403, 'alguien de fuera: 403');
ok((await call(`/store-sales/${STORE}`, { token: OTRA })).status === 403, 'la dueña de otra tienda: 403');

console.log('\n=== 3. Cómo vende: domicilio, entregas, política y teléfono ===');
const AJUSTES = `/store-sales/${STORE}/settings`;
const sinHorario = await call(AJUSTES, { method: 'PUT', token: TIENDA, body: { pickup_enabled: true, address: 'Av. Tulum 10' } });
ok(sinHorario.status === 400 && /horario/.test(sinHorario.data.error), 'recoger sin horario: 400', `=${sinHorario.status} ${sinHorario.data.error}`);
const ajustes = await call(AJUSTES, {
  method: 'PUT', token: ADMIN_T,
  body: {
    address: 'Av. Tulum 10, Centro, Cancún', pickup_enabled: true, pickup_hours: 'Lunes a sábado, 10 a 19',
    shipping_enabled: true, shipping_fee: 150, free_shipping_from: 2000, match_enabled: true,
    return_policy: 'Cambios en 15 días con ticket y la etiqueta puesta.',
  },
});
ok(ajustes.status === 200, 'el administrador de la tienda guarda sus ajustes', `=${ajustes.status} ${ajustes.data.error}`);
await call(`/organizations/${STORE}`, { method: 'PUT', token: TIENDA, body: { contact_phone: '998 123 4567' } });
await call(`/admin/organizations/${STORE}/verify`, { method: 'PUT', token: PLAT });
await call(`/admin/organizations/${STORE}/publish`, { method: 'PUT', token: PLAT });
const panel2 = (await call(`/store-sales/${STORE}`, { token: TIENDA })).data;
ok(JSON.stringify(panel2.missing) === JSON.stringify(['mercado_pago']), 'publicada y verificada, ya solo le falta Mercado Pago', JSON.stringify(panel2.missing));

console.log('\n=== 4. Conectar Mercado Pago: solo un dueño de verdad ===');
const ENLACE = `/store-sales/${STORE}/mercadopago/link`;
ok((await call(ENLACE, { method: 'POST', token: ADMIN_T })).status === 403, 'el administrador de la tienda no conecta: 403');
ok((await call(ENLACE, { method: 'POST', token: PLAT })).status === 403, 'el admin de CFBAMX tampoco, aunque en lo demás pase como dueño: 403');
const enlace = await call(ENLACE, { method: 'POST', token: TIENDA });
const url = new URL(enlace.data.url);
const state = url.searchParams.get('state');
ok(enlace.status === 200 && url.searchParams.get('client_id') === 'cfbamx-pruebas' && url.searchParams.get('redirect_uri') === 'http://localhost:5173/mercadopago/conectar' && !!state,
  'la dueña recibe el enlace, con su state y el regreso al sitio', enlace.data.url);
const CONECTAR = `/store-sales/${STORE}/mercadopago/connect`;
const alterado = await call(CONECTAR, { method: 'POST', token: TIENDA, body: { code: 'codigo-555', state: state.replace(/^\d+/, String(STORE2)) } });
ok(alterado.status === 400, 'un state de otra tienda: 400', `=${alterado.status} ${alterado.data.error}`);
ok((await call(CONECTAR, { method: 'POST', token: OTRA, body: { code: 'codigo-555', state } })).status === 403, 'otra persona con el state robado: 403');
const conecta = await call(CONECTAR, { method: 'POST', token: TIENDA, body: { code: 'codigo-555', state } });
ok(conecta.status === 200, 'la dueña conecta su cuenta', `=${conecta.status} ${conecta.data.error}`);
const { rows: [cuenta] } = await pool.query('SELECT * FROM store_payment_accounts WHERE organization_id=$1 AND disconnected_at IS NULL', [STORE]);
ok(cuenta?.provider_user_id === '555' && !String(cuenta.access_token_enc).includes('APP_USR') && !String(cuenta.refresh_token_enc).includes('TG-'),
  'la conexión se guarda con sus llaves cifradas', JSON.stringify({ id: cuenta?.provider_user_id, enc: String(cuenta?.access_token_enc).slice(0, 12) }));
const otraVez = await call(CONECTAR, { method: 'POST', token: TIENDA, body: { code: 'codigo-555', state } });
ok(otraVez.status === 502, 'un código ya usado: Mercado Pago no lo acepta', `=${otraVez.status}`);
const panel3 = (await call(`/store-sales/${STORE}`, { token: TIENDA })).data;
ok(panel3.selling === true && panel3.account?.vigente === true && panel3.can_connect === true && JSON.stringify(panel3.deliveries) === '["pickup","shipping"]',
  'ya vende, por ahora para recoger y con envío', JSON.stringify({ selling: panel3.selling, deliveries: panel3.deliveries }));
ok((await call(`/store-sales/${STORE}`, { token: ADMIN_T })).data.can_connect === false, 'y al administrador su panel no le ofrece conectar');

console.log('\n=== 5. Los partidos donde va a estar ===');
const lista = await call(`/store-sales/${STORE}/matches`, { token: TIENDA });
const ids = (lista.data.matches || []).map((m) => m.match_id);
ok(ids.includes(M_ABIERTO), 'el partido de dentro de 5 días sí', JSON.stringify(ids.slice(0, 10)));
ok(![M_CERRADO, M_LEJANO, M_BORRADOR].some((id) => ids.includes(id)), 'a 2 horas, a 40 días o borrador, no');
const puesto = await call(`/store-sales/${STORE}/stands`, { method: 'POST', token: TIENDA, body: { match_id: M_ABIERTO, note: 'Puesto junto a la taquilla' } });
const STAND = puesto.data.stand_id;
ok(puesto.status === 201 && !!STAND, 'pone su puesto', `=${puesto.status} ${puesto.data.error}`);
ok((await call(`/store-sales/${STORE}/stands`, { method: 'POST', token: TIENDA, body: { match_id: M_ABIERTO } })).status === 409, 'dos veces en el mismo partido: 409');
ok((await call(`/store-sales/${STORE}/stands`, { method: 'POST', token: TIENDA, body: { match_id: M_CERRADO } })).status === 409, 'en uno que empieza en 2 horas: 409');

const publica = await call(`/shop/stores/${STORE}`);
ok(publica.status === 200 && publica.data.selling === true, 'el público ve que vende, sin sesión', JSON.stringify(publica.data).slice(0, 200));
ok(publica.data.seller?.address === 'Av. Tulum 10, Centro, Cancún' && publica.data.seller?.phone === '998 123 4567' && /15 días/.test(publica.data.return_policy),
  'con quién vende, dónde y su política, antes de pagar', JSON.stringify(publica.data.seller));
ok(publica.data.deliveries?.pickup?.hours && publica.data.deliveries?.shipping?.fee === 150 && publica.data.deliveries?.match?.[0]?.stand_id === STAND && publica.data.deliveries.match[0].note === 'Puesto junto a la taquilla',
  'y sus tres entregas, con el partido y su nota', JSON.stringify(publica.data.deliveries).slice(0, 300));

console.log('\n=== 6. Revisar un carrito ===');
const COTIZAR = `/shop/stores/${STORE}/quote`;
const malo = await call(COTIZAR, {
  method: 'POST',
  body: { items: [{ product_id: JERSEY.id, size: 'L', quantity: 1 }, { product_id: JERSEY.id, quantity: 1 }, { product_id: CASCO.id, quantity: 1 }, { product_id: GORRA.id, quantity: 11 }] },
});
const problema = (id, talla) => malo.data.problems?.find((p) => p.product_id === id && (p.size ?? null) === talla)?.problema;
ok(problema(JERSEY.id, 'L') === 'sin_existencias' && problema(JERSEY.id, null) === 'talla' && problema(CASCO.id, null) === 'no_disponible' && problema(GORRA.id, null) === 'cantidad',
  'dice qué no se puede cobrar: L agotada, sin talla, a consultar y 11 piezas', JSON.stringify(malo.data.problems));
const bueno = await call(COTIZAR, { method: 'POST', body: { items: [{ product_id: JERSEY.id, size: 'M', quantity: 1 }, { product_id: GORRA.id, quantity: 2 }], delivery_method: 'shipping' } });
ok(bueno.data.problems?.length === 0 && bueno.data.totals?.subtotal === 1450 && bueno.data.totals?.shipping_fee === 150 && bueno.data.totals?.total === 1600,
  'con envío: 850 + 600 + 150 = 1,600', JSON.stringify(bueno.data.totals));
const gratis = await call(COTIZAR, { method: 'POST', body: { items: [{ product_id: JERSEY.id, size: 'M', quantity: 2 }, { product_id: GORRA.id, quantity: 2 }], delivery_method: 'shipping' } });
ok(gratis.data.totals?.shipping_fee === 0 && gratis.data.totals?.total === 2300, 'desde 2,000 el envío es gratis', JSON.stringify(gratis.data.totals));
ok(!JSON.stringify(bueno.data).includes('_cents'), 'sin las cuentas internas');

console.log('\n=== 7. Comprar sin cuenta: recoger en la tienda ===');
const PEDIR = `/shop/stores/${STORE}/orders`;
const pedir = (body, token) => call(PEDIR, { method: 'POST', body, token, ip: ipNueva() });
const ana = { name: 'Ana Prueba', phone: '998 765 4321', email: '' };
const sinNombre = await pedir({ items: [{ product_id: GORRA.id, quantity: 1 }], buyer: { phone: '9987654321' }, delivery: { method: 'pickup' } });
ok(sinNombre.status === 400 && /nombre/.test(sinNombre.data.error), 'sin nombre: 400', `=${sinNombre.status} ${sinNombre.data.error}`);
const otroTotal = await pedir({ items: [{ product_id: GORRA.id, quantity: 1 }], buyer: ana, delivery: { method: 'pickup' }, expected_total: 250 });
ok(otroTotal.status === 409 && otroTotal.data.totals?.total === 300, 'si el total que vio ya no es el de hoy: 409 con el de hoy', `=${otroTotal.status} ${JSON.stringify(otroTotal.data)}`);
const p1 = await pedir({ items: [{ product_id: JERSEY.id, size: 'M', quantity: 1 }, { product_id: GORRA.id, quantity: 1 }], buyer: ana, delivery: { method: 'pickup' }, expected_total: 1150 });
const T1 = p1.data.token;
const O1 = p1.data.order_id;
ok(p1.status === 201 && /^[A-Za-z0-9_-]{32}$/.test(T1 || '') && p1.data.init_point?.startsWith('http://localhost:4200/checkout/'),
  'el pedido se crea y abre Mercado Pago', `=${p1.status} ${JSON.stringify(p1.data)}`);
const pref1 = prefDe(O1);
ok(pref1?.vendedor === 555 && pref1.cuerpo.items.map((i) => `${i.quantity}×${i.title}@${i.unit_price}`).join('|') === '1×Jersey · M@850|1×Gorra@300',
  'el cobro es a nombre de la tienda, con sus productos al precio de hoy', JSON.stringify(pref1?.cuerpo.items));
ok(pref1?.cuerpo.notification_url === `http://localhost:4100/api/shop/mercadopago/webhook?pedido=${O1}` && pref1?.cuerpo.back_urls?.success === `http://localhost:5173/pedido/${T1}` && !('marketplace_fee' in (pref1?.cuerpo || {})),
  'avisa al backend, regresa a la página del pedido y sin comisión', JSON.stringify({ n: pref1?.cuerpo.notification_url, b: pref1?.cuerpo.back_urls }));
const { rows: [creado] } = await pool.query('SELECT o.*, (SELECT COUNT(*)::int FROM store_order_items WHERE order_id=o.id) AS n FROM store_orders o WHERE o.id=$1', [O1]);
ok(creado?.n === 2 && Number(creado.total) === 1150 && creado.user_id === null && creado.buyer_phone === '9987654321' && creado.promised?.store?.return_policy?.includes('15 días'),
  'en la base: el pedido sin cuenta, sus dos productos y la copia de lo prometido', JSON.stringify({ n: creado?.n, total: creado?.total }));
let v1 = await pedidoDe(T1);
ok(v1.status === 'unpaid' && v1.can_pay === true && v1.items?.length === 2 && v1.delivery?.promised?.hours === 'Lunes a sábado, 10 a 19',
  'con su link: esperando pago, con lo que compró y dónde recogerlo', JSON.stringify({ s: v1.status, pay: v1.can_pay }));
ok((await call('/shop/orders/no-existe-este-token-de-pedido')).status === 404, 'un link inventado: 404');

console.log('\n=== 8. Se paga: las existencias bajan una sola vez ===');
const pago1 = MP.pagar(pref1.id, 'approved');
ok(await MP.avisar(pago1.id) === 200, 'Mercado Pago avisa del pago aprobado: 200');
v1 = await pedidoDe(T1);
ok(v1.status === 'paid' && v1.paid === true && v1.can_pay === false, 'el pedido está pagado', JSON.stringify({ s: v1.status }));
let jersey = await stock(JERSEY.id);
ok(jersey.size_stock?.M === 1 && jersey.stock === 2, 'del jersey M salió una pieza, y el número sigue siendo la suma', JSON.stringify(jersey));
ok((await stock(GORRA.id)).stock === 4, 'de las gorras, una');
ok(await MP.avisar(pago1.id) === 200, 'el mismo aviso otra vez: 200');
jersey = await stock(JERSEY.id);
ok(jersey.size_stock?.M === 1 && (await stock(GORRA.id)).stock === 4 && (await renglones(O1, 'payment_approved')).length === 1,
  'y no descuenta dos veces ni deja dos "pagado"', JSON.stringify(jersey));
ok(await MP.avisar(pago1.id, { firma: 'mala' }) === 401, 'un aviso con la firma mala: 401');
ok(await MP.avisar(pago1.id, { firma: 'sin' }) === 200, 'uno sin firma se atiende, preguntándole a Mercado Pago');
const mov1 = await movimientos(O1);
ok(mov1.length === 2 && mov1.every((m) => m.kind === 'out'), 'cada producto con su salida escrita', JSON.stringify(mov1));

console.log('\n=== 9. Envío a domicilio con OXXO: pendiente, luego pagado ===');
const direccion = { street: 'Calle 5 #12', neighborhood: 'SM 23', postal_code: '77500', city: 'Cancún', state: 'QUINTANA ROO' };
const sinCP = await pedir({ items: [{ product_id: BALON.id, quantity: 1 }], buyer: ana, delivery: { method: 'shipping', address: { ...direccion, postal_code: '775' } } });
ok(sinCP.status === 400 && /5 dígitos/.test(sinCP.data.error), 'un código postal incompleto: 400', `=${sinCP.status} ${sinCP.data.error}`);
const p2 = await pedir({ items: [{ product_id: BALON.id, quantity: 1 }], buyer: ana, delivery: { method: 'shipping', address: direccion } });
const T2 = p2.data.token, O2 = p2.data.order_id;
ok(p2.status === 201 && prefDe(O2)?.cuerpo.items.at(-1)?.title === 'Envío a domicilio', 'con el envío como un renglón más del cobro', `=${p2.status}`);
const pago2 = MP.pagar(prefDe(O2).id, 'pending');
await MP.avisar(pago2.id);
ok((await pedidoDe(T2)).status === 'awaiting', 'ficha de OXXO sin pagar: pago pendiente');
MP.cambiarEstado(pago2.id, 'approved');
await MP.avisar(pago2.id);
const v2 = await pedidoDe(T2);
ok(v2.status === 'paid' && v2.delivery?.address?.postal_code === '77500', 'pagó en OXXO: pagado, con su dirección', JSON.stringify({ s: v2.status }));
ok((await movimientos(O2))[0]?.kind === 'untracked', 'el balón no lleva cuenta de existencias: no se toca');

console.log('\n=== 10. Rechazado, otra vez, y el regreso de Mercado Pago ===');
const p3 = await pedir({ items: [{ product_id: GORRA.id, quantity: 1 }], buyer: ana, delivery: { method: 'pickup' } });
const T3 = p3.data.token, O3 = p3.data.order_id;
await MP.avisar(MP.pagar(prefDe(O3).id, 'rejected').id);
const v3 = await pedidoDe(T3);
ok(v3.status === 'rejected' && v3.can_pay === true, 'rechazado: se puede volver a pagar', JSON.stringify({ s: v3.status }));
const otraVezPagar = await call(`/shop/orders/${T3}/pay`, { method: 'POST', ip: ipNueva() });
ok(otraVezPagar.status === 200 && otraVezPagar.data.init_point && prefDe(O3)?.id !== undefined, 'abre Mercado Pago otra vez', `=${otraVezPagar.status} ${otraVezPagar.data.error}`);
const pago3 = MP.pagar(prefDe(O3).id, 'approved');
// Sin aviso: Render dormido. La página del pedido pregunta con el payment_id de la dirección.
ok((await pedidoDe(T3, `?payment_id=${pago3.id}`)).status === 'paid', 'sin aviso, el regreso con su payment_id lo deja pagado');
const pagoAjeno = MP.pagar(pref1.id, 'approved');
const v3b = await pedidoDe(T3, `?payment_id=${pagoAjeno.id}`);
ok(v3b.status === 'paid' && (await renglones(O3, 'payment_extra')).length === 0, 'un payment_id de otro pedido no se le cuelga a este');

console.log('\n=== 11. Con cuenta, y entregar en un partido ===');
const ROSA = await alta('Compradora');
const p4 = await pedir({ items: [{ product_id: JERSEY.id, size: 'S', quantity: 1 }], buyer: { name: 'Rosa Prueba', phone: '9981112233' }, delivery: { method: 'match', stand_id: STAND } }, ROSA);
const T4 = p4.data.token, O4 = p4.data.order_id;
ok(p4.status === 201, 'una compra con sesión, para recoger en el partido', `=${p4.status} ${p4.data.error}`);
const v4 = await pedidoDe(T4);
// La liga guarda los nombres de los equipos en mayúsculas.
ok(v4.delivery?.promised?.match?.home_team === `HALCONES ${stamp}` && v4.delivery?.promised?.note === 'Puesto junto a la taquilla' && v4.in_account === true,
  'el pedido dice qué partido, la nota del puesto, y que está en una cuenta', JSON.stringify(v4.delivery?.promised).slice(0, 200));
const mios = await call('/shop/mine', { token: ROSA });
ok(mios.data.orders?.length === 1 && mios.data.orders[0].id === O4 && mios.data.orders[0].status === 'unpaid', 'sale en sus pedidos', JSON.stringify(mios.data.orders?.map((o) => o.id)));
await moverA(M_ABIERTO, '2 hours');
const tarde = await pedir({ items: [{ product_id: GORRA.id, quantity: 1 }], buyer: ana, delivery: { method: 'match', stand_id: STAND } });
ok(tarde.status === 400 && /ya no recibe pedidos/.test(tarde.data.error), 'a 2 horas del partido, ese puesto ya no recibe pedidos', `=${tarde.status} ${tarde.data.error}`);
await moverA(M_ABIERTO, '5 days');

const PEDRO = await alta('Comprador2');
ok((await call(`/shop/orders/${T1}/claim`, { method: 'POST', token: PEDRO })).status === 200, 'quien abre el link con su sesión guarda el pedido en su cuenta');
ok((await call('/shop/mine', { token: PEDRO })).data.orders?.some((o) => o.id === O1), 'y le sale en sus pedidos');
ok((await call(`/shop/orders/${T1}/claim`, { method: 'POST', token: ROSA })).status === 409, 'otra persona ya no se lo lleva: 409');
ok((await call(`/shop/orders/${T4}/claim`, { method: 'POST', token: PEDRO })).status === 409, 'ni un pedido hecho con sesión de otra: 409');
ok((await call(`/shop/orders/${T1}`, { token: PEDRO })).data.mine === true, 'y su página dice que es suyo');

console.log('\n=== 12. La última pieza, pagada dos veces ===');
const p5 = await pedir({ items: [{ product_id: ULTIMA.id, quantity: 1 }], buyer: ana, delivery: { method: 'pickup' } });
const p6 = await pedir({ items: [{ product_id: ULTIMA.id, quantity: 1 }], buyer: { name: 'Beto Prueba', phone: '9984445566' }, delivery: { method: 'pickup' } });
ok(p5.status === 201 && p6.status === 201, 'dos pedidos de la última pieza: la pieza no se aparta al pedir');
await MP.avisar(MP.pagar(prefDe(p5.data.order_id).id, 'approved').id);
await MP.avisar(MP.pagar(prefDe(p6.data.order_id).id, 'approved').id);
ok((await stock(ULTIMA.id)).stock === 0, 'quedan 0, no -1');
ok((await movimientos(p5.data.order_id))[0]?.kind === 'out' && (await movimientos(p6.data.order_id))[0]?.kind === 'short',
  'el primero se la lleva y el segundo queda "Sin existencias"');
const detalle6 = await call(`/store-sales/${STORE}/orders/${p6.data.order_id}`, { token: TIENDA });
ok(detalle6.data.status === 'paid' && detalle6.data.items?.[0]?.stock === 'short', 'la tienda lo ve en su pedido, para decidir', JSON.stringify(detalle6.data.items?.[0]));

console.log('\n=== 13. Pagado dos veces: pago repetido ===');
const p7 = await pedir({ items: [{ product_id: BALON.id, quantity: 1 }], buyer: ana, delivery: { method: 'pickup' } });
const pref7 = prefDe(p7.data.order_id).id;
const pagoA = MP.pagar(pref7, 'approved');
const pagoB = MP.pagar(pref7, 'approved');
await MP.avisar(pagoA.id);
await MP.avisar(pagoB.id);
const d7 = await call(`/store-sales/${STORE}/orders/${p7.data.order_id}`, { token: TIENDA });
ok(d7.data.status === 'paid' && d7.data.payment?.mp_payment_id === String(pagoA.id) && JSON.stringify(d7.data.extra_payments) === JSON.stringify([String(pagoB.id)]),
  'un solo "pagado", y el segundo pago se ve como repetido para reembolsarlo', JSON.stringify({ p: d7.data.payment, x: d7.data.extra_payments }));
const lista7 = (await call(`/store-sales/${STORE}/orders`, { token: TIENDA })).data.orders?.find((o) => o.id === p7.data.order_id);
ok(lista7?.extra_payments === 1, 'y en la tabla');

console.log('\n=== 14. Vencido ===');
const p8 = await pedir({ items: [{ product_id: GORRA.id, quantity: 1 }], buyer: ana, delivery: { method: 'pickup' } });
await pool.query("UPDATE store_orders SET created_at = created_at - INTERVAL '73 hours' WHERE id=$1", [p8.data.order_id]);
const v8 = await pedidoDe(p8.data.token);
ok(v8.status === 'expired' && v8.can_pay === false, 'sin pagar a las 72 horas: vencido, sin escribir nada', JSON.stringify({ s: v8.status }));
ok((await call(`/shop/orders/${p8.data.token}/pay`, { method: 'POST', ip: ipNueva() })).status === 409, 'y ya no se paga: 409');

console.log('\n=== 15. La tienda atiende sus pedidos ===');
const listaT = await call(`/store-sales/${STORE}/orders`, { token: TIENDA });
const estados = Object.fromEntries((listaT.data.orders || []).map((o) => [o.id, o.status]));
ok(estados[O1] === 'paid' && estados[O2] === 'paid' && estados[O4] === 'unpaid' && estados[p8.data.order_id] === 'expired',
  'su tabla con el estado de cada pedido', JSON.stringify(estados));
ok((await call(`/store-sales/${STORE}`, { token: TIENDA })).data.to_prepare >= 5, 'y cuántos le toca preparar');
const d1 = await call(`/store-sales/${STORE}/orders/${O1}`, { token: ADMIN_T });
ok(d1.status === 200 && d1.data.buyer?.phone === '9987654321' && JSON.stringify(d1.data.actions) === '["ready","delivered","cancel"]',
  'el administrador abre un pedido: el WhatsApp de quien compró y lo que puede hacer', JSON.stringify(d1.data.actions));
ok((await call(`/store-sales/${STORE2}/orders/${O1}`, { token: OTRA })).status === 404, 'otra tienda no lo encuentra por la suya: 404');
ok((await call(`/store-sales/${STORE}/orders/${O1}`, { token: OTRA })).status === 403, 'ni por la de esta: 403');
const ACCION = (orden, accion) => `/store-sales/${STORE}/orders/${orden}/${accion}`;
ok((await call(ACCION(O2, 'ready'), { method: 'POST', token: TIENDA })).status === 409, 'un envío no se marca "listo": 409');
ok((await call(ACCION(O2, 'shipped'), { method: 'POST', token: TIENDA, body: {} })).status === 400, 'enviado sin paquetería: 400');
const envio = await call(ACCION(O2, 'shipped'), { method: 'POST', token: TIENDA, body: { carrier: 'Estafeta', tracking: '1234567890' } });
ok(envio.status === 200 && envio.data.status === 'shipped', 'enviado, con su guía', `=${envio.status} ${envio.data.error}`);
ok((await pedidoDe(T2)).history?.find((h) => h.kind === 'shipped')?.tracking === '1234567890', 'quien compró ve la paquetería y la guía');
ok((await call(ACCION(O2, 'delivered'), { method: 'POST', token: TIENDA })).data.status === 'delivered', 'y entregado');
ok((await call(ACCION(O1, 'ready'), { method: 'POST', token: ADMIN_T })).data.status === 'ready', 'el administrador marca listo el de recoger');
ok((await call(ACCION(O1, 'ready'), { method: 'POST', token: ADMIN_T })).status === 409 && (await renglones(O1, 'ready')).length === 1,
  'dos veces no deja dos renglones');
ok((await call(ACCION(O4, 'ready'), { method: 'POST', token: TIENDA })).status === 409, 'uno sin pagar no se marca: 409');
ok((await call(ACCION(O1, 'borrar'), { method: 'POST', token: TIENDA })).status === 404, 'una acción que no existe: 404');

console.log('\n=== 16. Cancelar y reembolsar ===');
const gorraAntes = (await stock(GORRA.id)).stock;
const cancela = await call(ACCION(O3, 'cancel'), { method: 'POST', token: TIENDA, body: { reason: 'Se manchó en bodega' } });
ok(cancela.status === 200 && cancela.data.status === 'refunded', 'cancelado y reembolsado por Mercado Pago', `=${cancela.status} ${cancela.data.status} ${cancela.data.error}`);
ok(MP.reembolsos.size === 1 && [...MP.reembolsos.keys()][0] === `cfbamx-${O3}-cancelar`, 'un reembolso, con su llave para no repetirlo');
ok((await stock(GORRA.id)).stock === gorraAntes + 1 && (await movimientos(O3)).some((m) => m.kind === 'back'), 'y la gorra regresó a las existencias');
ok((await call(ACCION(O3, 'cancel'), { method: 'POST', token: TIENDA })).status === 409 && MP.reembolsos.size === 1, 'cancelar otra vez: 409, sin otro reembolso');
ok((await call(ACCION(O2, 'cancel'), { method: 'POST', token: TIENDA })).status === 409, 'lo que ya se entregó no se cancela desde aquí');
ok((await pedidoDe(T3)).history?.some((h) => h.kind === 'cancelled' && h.reason === 'Se manchó en bodega'), 'quien compró ve que se canceló, y por qué');

console.log('\n=== 17. La comisión ===');
ok((await call(COMISION, { method: 'PUT', token: PLAT, body: { value: 31 } })).status === 400, 'más de 30%: 400');
ok((await call(COMISION, { method: 'PUT', token: TIENDA, body: { value: 5 } })).status === 403, 'una tienda no la mueve: 403');
ok((await call(COMISION, { method: 'PUT', token: PLAT, body: { value: 5 } })).data.value === 5, 'el admin la pone en 5%');
const p9 = await pedir({ items: [{ product_id: BALON.id, quantity: 1 }], buyer: ana, delivery: { method: 'pickup' } });
const { rows: [o9] } = await pool.query('SELECT fee_percent, fee_amount FROM store_orders WHERE id=$1', [p9.data.order_id]);
ok(Number(o9.fee_percent) === 5 && Number(o9.fee_amount) === 32.5 && prefDe(p9.data.order_id)?.cuerpo.marketplace_fee === 32.5,
  'el pedido guarda la que le tocó, y viaja a Mercado Pago', JSON.stringify(o9));
await call(COMISION, { method: 'PUT', token: PLAT, body: { value: 0 } });

console.log('\n=== 18. Apagadas: nadie compra, y lo pagado sigue ===');
await call(BOTON, { method: 'PUT', token: PLAT, body: { enabled: false } });
ok((await call('/shop/status')).data.enabled === false, 'el público las ve apagadas');
ok((await call(`/shop/stores/${STORE}`)).status === 404 && (await call(COTIZAR, { method: 'POST', body: { items: [] } })).status === 404,
  'la tienda y el carrito: 404');
ok((await pedir({ items: [{ product_id: GORRA.id, quantity: 1 }], buyer: ana, delivery: { method: 'pickup' } })).status === 404, 'pedir: 404');
ok((await call(`/shop/orders/${p9.data.token}/pay`, { method: 'POST', ip: ipNueva() })).status === 404, 'pagar uno pendiente: 404');
ok((await pedidoDe(T1)).status === 'ready', 'un pedido ya hecho se sigue viendo con su link');
await MP.avisar(MP.pagar(prefDe(p9.data.order_id).id, 'approved').id);
ok((await pedidoDe(p9.data.token)).status === 'paid', 'y un pago que llega se sigue registrando');
const apagadoPanel = await call(`/store-sales/${STORE}`, { token: TIENDA });
ok(apagadoPanel.status === 200 && apagadoPanel.data.enabled === false && apagadoPanel.data.orders_count >= 9, 'el panel dice que están apagadas, y cuántos pedidos tiene', JSON.stringify(apagadoPanel.data));
ok((await call(`/store-sales/${STORE}/orders`, { token: TIENDA })).status === 200, 'la tienda sigue viendo sus pedidos');
ok((await call(ACCION(p9.data.order_id, 'ready'), { method: 'POST', token: TIENDA })).status === 200, 'y los sigue atendiendo');
ok((await call(AJUSTES, { method: 'PUT', token: TIENDA, body: {} })).status === 404 && (await call(`/store-sales/${STORE}/matches`, { token: TIENDA })).status === 404,
  'pero no prepara ventas nuevas: 404');
ok((await call(`/store-sales/${STORE}/mercadopago/disconnect`, { method: 'POST', token: ADMIN_T })).status === 403, 'desconectar tampoco es del administrador: 403');
const desconecta = await call(`/store-sales/${STORE}/mercadopago/disconnect`, { method: 'POST', token: TIENDA });
ok(desconecta.status === 200 && desconecta.data.disconnected === true, 'la dueña desconecta, también apagadas');
const { rows: [vieja] } = await pool.query('SELECT access_token_enc, refresh_token_enc, disconnected_at, disconnected_by_user_id FROM store_payment_accounts WHERE id=$1', [cuenta.id]);
ok(vieja.access_token_enc === null && vieja.refresh_token_enc === null && vieja.disconnected_at && vieja.disconnected_by_user_id === await idDe('TiendaCompras'),
  'las llaves se borran y el renglón se queda, con quién y cuándo');
await call(BOTON, { method: 'PUT', token: PLAT, body: { enabled: true } });
const sinCuenta = (await call(`/store-sales/${STORE}`, { token: TIENDA })).data;
ok(sinCuenta.selling === false && JSON.stringify(sinCuenta.missing) === '["mercado_pago"]' && (await call(`/shop/stores/${STORE}`)).data.selling === false,
  'prendidas otra vez, sin Mercado Pago ya no vende', JSON.stringify(sinCuenta.missing));

console.log('\n=== 18b. Otra cuenta: lo que quedó sin pagar se queda con la suya ===');
// El pedido de Rosa (sección 11) sigue sin pagar y se hizo con la cuenta de
// antes, que ya no tiene llaves: con la nueva no se cobra, porque su pago se le
// preguntaría a la vieja. Su página no le ofrece un «Pagar» que siempre fallaría.
const state2 = new URL((await call(ENLACE, { method: 'POST', token: TIENDA })).data.url).searchParams.get('state');
const reconecta = await call(CONECTAR, { method: 'POST', token: TIENDA, body: { code: 'codigo-556', state: state2 } });
ok(reconecta.status === 200 && (await call(`/shop/stores/${STORE}`)).data.selling === true, 'la dueña conecta otra cuenta y vuelve a vender', `=${reconecta.status} ${reconecta.data.error}`);
const v4b = await pedidoDe(T4);
ok(v4b.status === 'unpaid' && v4b.can_pay === false && v4b.pay_blocked === 'account_changed',
  'un pedido sin pagar de la cuenta de antes ya no ofrece pagar, y dice por qué', JSON.stringify({ s: v4b.status, can: v4b.can_pay, por: v4b.pay_blocked }));
const pagar4 = await call(`/shop/orders/${T4}/pay`, { method: 'POST', ip: ipNueva() });
ok(pagar4.status === 409 && /cambió su forma de cobrar/.test(pagar4.data.error), 'pagarlo de todos modos: 409', `=${pagar4.status} ${pagar4.data.error}`);
const p10 = await pedir({ items: [{ product_id: BALON.id, quantity: 1 }], buyer: ana, delivery: { method: 'pickup' } });
const v10 = await pedidoDe(p10.data.token);
ok(p10.status === 201 && v10.can_pay === true && v10.pay_blocked === null, 'uno nuevo se cobra con la cuenta nueva', `=${p10.status} ${p10.data.error}`);

console.log('\n=== 19. El Panel Admin cuenta, y no ve a nadie ===');
const panelFinal = (await call('/admin/shop', { token: PLAT })).data;
ok(panelFinal.counts?.orders >= 9 && panelFinal.counts?.paid_30d >= 7 && panelFinal.counts?.trusted_stores >= 1,
  'pedidos, pagados en 30 días y tiendas que pueden vender', JSON.stringify(panelFinal.counts));
ok(!JSON.stringify(panelFinal).includes('Ana Prueba') && !JSON.stringify(panelFinal).includes('9987654321'), 'sin un solo dato de quien compró');
const historial = panelFinal.switch?.history || [];
ok(historial[0]?.enabled === true && historial[1]?.enabled === false, 'el historial del botón: prendido, apagado…', JSON.stringify(historial.slice(0, 3).map((h) => h.enabled)));
ok((await call(BOTON, { method: 'PUT', token: TIENDA, body: { enabled: false } })).status === 403, 'solo el admin mueve el botón');

// Para no sembrar tiendas de prueba en el home de la rama, se ocultan al final, y
// el botón y la comisión se dejan como estaban antes de la suite.
await call(`/admin/organizations/${STORE}/unpublish`, { method: 'PUT', token: PLAT });
await call(`/admin/organizations/${STORE2}/unpublish`, { method: 'PUT', token: PLAT });
await call(`/admin/leagues/${LEAGUE}/unpublish`, { method: 'PUT', token: PLAT });
await call(COMISION, { method: 'PUT', token: PLAT, body: { value: comisionDeAntes } });
if (!estabaPrendido) await call(BOTON, { method: 'PUT', token: PLAT, body: { enabled: false } });
const alFinal = (await call('/admin/shop', { token: PLAT })).data;
ok(alFinal.switch?.enabled === estabaPrendido && Number(alFinal.fee?.percent) === comisionDeAntes,
  `el botón queda ${estabaPrendido ? 'prendido' : 'apagado'} y la comisión en ${comisionDeAntes}%, como estaban`);
await pool.query("UPDATE users SET role='rep' WHERE id=$1", [idPlat]);

console.log(`\n========  ${pass} ok, ${fail} fallas  ========`);
await terminar(fail ? 1 : 0);
