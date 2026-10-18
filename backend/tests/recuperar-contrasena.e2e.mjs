// Recorrido de "¿Olvidaste tu contraseña?" (README, "Recuperar la contraseña",
// 2026-10-17) contra un backend vivo.
//
// Lo que se prueba aquí no se puede leer en el código: que el tope de intentos
// aguante peticiones simultáneas —vive en un UPDATE de Postgres, no en
// JavaScript—, que el tope por cuenta cuente lo que de verdad hay en la tabla,
// y que cambiar la contraseña cierre las sesiones de antes sin tirar el token
// que entrega, que se firma en el mismo segundo del cambio.
//
// Necesita el backend del 4100 arrancado con EMAIL_TRANSPORT=log: así el
// backend cree que puede mandar correos, no manda ninguno, y esta suite lee el
// código de la base. Sin eso, el primer paso recibe 503 y la suite lo dice.
//
// Cada petición sale con su propio X-Forwarded-For (el backend confía en un
// proxy, `trust proxy` = 1). Así esta suite no se gasta el limitador de /auth
// que comparten las demás, y el ataque del paso 6 viene, como vendría de
// verdad, de muchas IP a la vez.
//
// Se crea sus propios datos y se puede correr varias veces. Instrucciones en
// tests/README.md.
import pg from 'pg';

const API = 'http://localhost:4100/api';
const stamp = Date.now();
let pass = 0, fail = 0;
const ok = (c, l, e = '') => { if (c) { console.log(`  OK    ${l}`); pass++; } else { console.log(`  FALLA ${l} ${e}`); fail++; } };

if (process.env.PROD_DATABASE_HOST && (process.env.DATABASE_URL || '').includes(process.env.PROD_DATABASE_HOST)) {
  console.error('DATABASE_URL apunta a producción. Esta suite escribe: corre contra una rama de Neon.');
  process.exit(2);
}

// Una IP de mentira por corrida, y una distinta por cada petición del ataque.
const octeto = () => 1 + Math.floor(Math.random() * 250);
const IP_BASE = `10.${octeto()}.${octeto()}`;
let siguiente = 0;
const ipNueva = () => `${IP_BASE}.${(siguiente++ % 250) + 1}`;
// El limitador deja 20 cada 15 minutos por IP. Las secciones 0 a 8 gastan 16;
// las dos últimas salen con otra.
let IP = ipNueva();

const LIMITADOR = 'Demasiados intentos. Espera';

async function call(path, { method = 'GET', body, token, ip } = {}) {
  ip ??= IP;
  const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': ip };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  // El 429 del limitador por IP no es el 429 de un código agotado, que esta
  // suite sí espera ver.
  if (res.status === 429 && String(data.error || '').startsWith(LIMITADOR)) {
    console.log(`\n  !! ${path} recibió 429 del limitador por IP. Reinicia el backend y repite.\n`);
    process.exit(2);
  }
  return { status: res.status, data };
}

const pedir = (email, ip) => call('/auth/password-reset/request', { method: 'POST', body: { email }, ip });
const canjear = (email, code, password, ip) => call('/auth/password-reset/confirm', { method: 'POST', body: { email, code, password }, ip });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
const idDe = async (email) => (await pool.query('SELECT id FROM users WHERE email=$1', [email])).rows[0]?.id;
const usuario = async (id) => (await pool.query(
  'SELECT password_hash, password_changed_at, email_verified FROM users WHERE id=$1', [id]
)).rows[0];
// Del más reciente al más viejo, que es el orden en que el backend los lee.
const codigos = async (userId) => (await pool.query(`
  SELECT id, code, attempts, expires_at > NOW() AS vigente
  FROM password_reset_codes WHERE user_id=$1 ORDER BY created_at DESC, id DESC
`, [userId])).rows;
const otroCodigo = (code) => (code === '999999' ? '100000' : String(Number(code) + 1));

console.log('\n=== 0. El backend puede "mandar" correos ===');
const nadie = await pedir(`nadie${stamp}@example.com`);
if (nadie.status === 503) {
  console.log('\n  !! El backend contestó 503: arráncalo con EMAIL_TRANSPORT=log (ver tests/README.md).\n');
  process.exit(2);
}
ok(nadie.status === 200 && nadie.data.ok === true,
  'un correo sin cuenta recibe la misma respuesta que uno con cuenta', `=${nadie.status} ${JSON.stringify(nadie.data)}`);

console.log('\n=== 1. Una cuenta de correo y contraseña, con sesión abierta ===');
const A = `recupera${stamp}@example.com`;
const reg = await call('/auth/register', { method: 'POST', body: { name: 'Recupera', email: A, password: 'vieja123' } });
ok(reg.status === 201 && !!reg.data.token, 'cuenta creada', `=${reg.status}`);
const T0 = reg.data.token;
const AID = await idDe(A);
const antes = await usuario(AID);
ok(antes.email_verified === false && antes.password_changed_at === null,
  'nace sin verificar y sin cambio de contraseña', JSON.stringify({ v: antes.email_verified, c: antes.password_changed_at }));

// Una suscripción suya, para ver si /notifications/check la reconoce: esa ruta
// lee la sesión con optionalAuth, y antes verificaba el JWT a mano.
const lg = await call('/leagues', { method: 'POST', token: T0, body: { name: `Liga Recupera ${stamp}`, state: 'CIUDAD DE MEXICO' } });
const LEAGUE = lg.data.league?.id ?? lg.data.id;
ok(!!LEAGUE, 'una liga suya, para colgarle una suscripción', JSON.stringify(lg.data).slice(0, 120));
await pool.query('INSERT INTO push_subscriptions (user_id, league_id, in_app) VALUES ($1, $2, TRUE)', [AID, LEAGUE]);
const conSesion = await call('/notifications/check', { method: 'POST', token: T0, body: { league_id: LEAGUE } });
ok(conSesion.data.subscribed === true, 'con su token, /notifications/check la reconoce', JSON.stringify(conSesion.data));

console.log('\n=== 2. Pedir un código ===');
const p1 = await pedir(A);
ok(p1.status === 200 && p1.data.ok === true, 'la respuesta es la misma que para un correo sin cuenta', JSON.stringify(p1.data));
let filas = await codigos(AID);
ok(filas.length === 1 && /^\d{6}$/.test(filas[0].code) && filas[0].attempts === 0 && filas[0].vigente,
  'queda un código de 6 dígitos, vigente y sin intentos', JSON.stringify(filas));
const C1 = filas[0].code;

console.log('\n=== 3. Un código equivocado gasta un intento y dice cuántos quedan ===');
const mal = await canjear(A, otroCodigo(C1), 'nueva456');
ok(mal.status === 400 && /Te quedan 4 intentos/.test(mal.data.error), 'responde 400 y cuántos quedan', `=${mal.status} ${mal.data.error}`);
ok((await codigos(AID))[0].attempts === 1, 'y el intento quedó gastado en la base');
ok((await usuario(AID)).password_hash === antes.password_hash, 'la contraseña no cambió');

console.log('\n=== 4. Solo cuenta el código más reciente ===');
await pedir(A);
filas = await codigos(AID);
const C2 = filas[0].code;
ok(filas.length === 2, 'pedir otro agrega una fila, no pisa la anterior', `filas=${filas.length}`);
if (C1 === C2) {
  console.log('  (los dos códigos salieron iguales, una vez en 900 000: se salta este caso)');
} else {
  const viejo = await canjear(A, C1, 'nueva456');
  ok(viejo.status === 400 && /incorrecto/.test(viejo.data.error),
    'el código anterior, aunque no haya vencido, ya no sirve', `=${viejo.status} ${viejo.data.error}`);
}

console.log('\n=== 5. Agotado o vencido, ni el código correcto entrega la cuenta ===');
await pool.query('UPDATE password_reset_codes SET attempts = 5 WHERE id = $1', [filas[0].id]);
const agotado = await canjear(A, C2, 'nueva456');
ok(agotado.status === 429 && /Demasiados intentos con ese código/.test(agotado.data.error),
  'con los 5 intentos gastados, el correcto recibe 429', `=${agotado.status} ${agotado.data.error}`);

await pedir(A);
filas = await codigos(AID);
const C3 = filas[0].code;
await pool.query("UPDATE password_reset_codes SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1", [filas[0].id]);
const vencido = await canjear(A, C3, 'nueva456');
ok(vencido.status === 400 && /venció/.test(vencido.data.error), 'uno vencido dice que venció', `=${vencido.status} ${vencido.data.error}`);
ok((await usuario(AID)).password_hash === antes.password_hash, 'y la contraseña sigue sin cambiar');

console.log('\n=== 6. Veinte intentos a la vez, desde veinte IP, consiguen cinco comparaciones ===');
await pedir(A);
filas = await codigos(AID);
const C4 = filas[0].code;
// Veinte códigos equivocados distintos, ninguno el bueno.
const equivocados = Array.from({ length: 20 }, (_, i) => String(100000 + ((Number(C4) - 100000 + 1 + i) % 900000)));
const rafaga = await Promise.all(equivocados.map((c) => canjear(A, c, 'nueva456', ipNueva())));
const incorrectos = rafaga.filter((r) => r.status === 400 && /incorrecto/.test(r.data.error)).length;
const frenados = rafaga.filter((r) => r.status === 429).length;
ok(incorrectos === 5 && frenados === 15,
  'cinco se comparan y quince se frenan sin comparar', `incorrectos=${incorrectos} frenados=${frenados} ${JSON.stringify(rafaga.map((r) => r.status))}`);
ok((await codigos(AID))[0].attempts === 5, 'la base registra cinco intentos, no veinte', `=${(await codigos(AID))[0].attempts}`);

console.log('\n=== 7. El tope por cuenta: el sexto código de la hora no sale ===');
ok((await codigos(AID)).length === 4, 'van cuatro códigos esta hora');
await pedir(A);
filas = await codigos(AID);
const C5 = filas[0].code;
ok(filas.length === 5, 'el quinto sí se crea', `filas=${filas.length}`);
const sexto = await pedir(A);
filas = await codigos(AID);
ok(sexto.status === 200 && sexto.data.ok === true, 'el sexto recibe la misma respuesta de siempre', JSON.stringify(sexto.data));
ok(filas.length === 5 && filas[0].code === C5, 'pero no crea ningún código: el vigente sigue siendo el quinto', `filas=${filas.length}`);

console.log('\n=== 8. Canjear el código cambia la contraseña y cierra las sesiones de antes ===');
const bueno = await canjear(A, C5, 'nueva456');
ok(bueno.status === 200 && !!bueno.data.token && bueno.data.user?.email === A,
  'responde como /login: con token y usuario', `=${bueno.status} ${JSON.stringify(bueno.data).slice(0, 160)}`);
const T1 = bueno.data.token;
const despues = await usuario(AID);
ok(despues.password_hash !== antes.password_hash, 'la contraseña cambió');
ok(despues.password_changed_at !== null, 'y quedó la hora del cambio');
ok(despues.email_verified === true && bueno.data.user?.email_verified === true,
  'el correo quedó verificado: el código probó lo mismo que la verificación');
ok((await codigos(AID)).length === 0, 'los códigos de recuperación se borraron');
const { rows: verificacion } = await pool.query('SELECT id FROM email_verification_codes WHERE user_id=$1', [AID]);
ok(verificacion.length === 0, 'y los de verificación también', `filas=${verificacion.length}`);

const viejo = await call('/auth/me', { token: T0 });
ok(viejo.status === 401 && /Tu contraseña cambió/.test(viejo.data.error),
  'el token de antes del cambio ya no entra', `=${viejo.status} ${viejo.data.error}`);
const nuevo = await call('/auth/me', { token: T1 });
ok(nuevo.status === 200 && nuevo.data.user?.id === AID,
  'el que se entregó al cambiarla sí: no nace revocado aunque se firmó en el mismo segundo', `=${nuevo.status}`);

const checkViejo = await call('/notifications/check', { method: 'POST', token: T0, body: { league_id: LEAGUE } });
ok(checkViejo.status === 200 && checkViejo.data.subscribed === false,
  'optionalAuth tampoco reconoce el token viejo: la puerta lateral quedó cerrada', JSON.stringify(checkViejo.data));
const checkNuevo = await call('/notifications/check', { method: 'POST', token: T1, body: { league_id: LEAGUE } });
ok(checkNuevo.data.subscribed === true, 'y con el nuevo la suscripción sigue ahí', JSON.stringify(checkNuevo.data));

const conVieja = await call('/auth/login', { method: 'POST', body: { email: A, password: 'vieja123' } });
ok(conVieja.status === 401, 'la contraseña vieja ya no entra', `=${conVieja.status}`);
const conNueva = await call('/auth/login', { method: 'POST', body: { email: A, password: 'nueva456' } });
ok(conNueva.status === 200 && !!conNueva.data.token, 'la nueva sí', `=${conNueva.status}`);
const repetido = await canjear(A, C5, 'otra789');
ok(repetido.status === 400 && /No hay ningún código pendiente/.test(repetido.data.error),
  'el mismo código no se canjea dos veces', `=${repetido.status} ${repetido.data.error}`);

console.log('\n=== 9. Sin la caché: un cambio que este proceso no hizo ===');
IP = ipNueva();
// La caché la actualiza el propio cambio, así que el paso 8 no prueba la
// lectura de la base. Aquí la hora se escribe directo en la tabla, como la
// escribiría otra instancia del backend. Va un minuto adelante para que el
// token quede antes del cambio sin depender de los relojes (el de esta PC va
// segundos detrás de Neon).
const B = `otra${stamp}@example.com`;
const regB = await call('/auth/register', { method: 'POST', body: { name: 'Otra', email: B, password: 'vieja123' } });
const TB = regB.data.token;
await pool.query("UPDATE users SET password_changed_at = NOW() + INTERVAL '1 minute' WHERE email = $1", [B]);
const meB = await call('/auth/me', { token: TB });
ok(meB.status === 401 && /Tu contraseña cambió/.test(meB.data.error),
  'el backend lo lee de la base y saca el token', `=${meB.status} ${meB.data.error}`);

console.log('\n=== 10. Una cuenta de Google también puede ponerse contraseña ===');
const G = `google${stamp}@example.com`;
const { rows: [{ id: GID }] } = await pool.query(`
  INSERT INTO users (name, email, password_hash, role, email_verified, google_id)
  VALUES ('GOOGLE', $1, NULL, 'rep', TRUE, $2) RETURNING id
`, [G, `e2e-google-${stamp}`]);
const sinContrasena = await call('/auth/login', { method: 'POST', body: { email: G, password: 'loquesea1' } });
ok(sinContrasena.status === 401 && /Google/.test(sinContrasena.data.error),
  'sin contraseña, el login le dice que entre con Google', sinContrasena.data.error);
await pedir(G);
const [codigoG] = await codigos(GID);
const canjeG = await canjear(G, codigoG?.code, 'google123');
ok(canjeG.status === 200, 'canjea el código como cualquier cuenta', `=${canjeG.status} ${canjeG.data.error || ''}`);
const loginG = await call('/auth/login', { method: 'POST', body: { email: G, password: 'google123' } });
ok(loginG.status === 200, 'y ya entra también con contraseña', `=${loginG.status}`);

// Lo único que no se va con la cuenta de prueba: la suscripción cuelga de una
// liga que se queda, como todo lo que crean las suites.
await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND league_id = $2', [AID, LEAGUE]);

console.log(`\n========  ${pass} ok, ${fail} fallas  ========`);
await pool.end();
process.exit(fail ? 1 : 0);
