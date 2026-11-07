// Recorrido de los AVISOS DE TUS PREDICCIONES en "Mis notificaciones" —
// README, "Los avisos de tus predicciones" y "Cuándo terminó un partido".
//
// Por qué una suite y no bastan las unitarias: los avisos se calculan al leer
// y no dejan rastro en la base, así que lo único que puede fallar en silencio
// es el viaje completo — que la hora de "terminó" salga de los eventos que de
// verdad guarda manage.js, que los puntos sean los de utils/scoring.js y que
// el ranking del aviso sea el mismo número que la pestaña Ranking. Hasta aquí
// las predicciones, lo único con uso real (el concurso de ONEFA), no tenían
// ninguna prueba de punta a punta.
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
  body: { name: `${quien} ${stamp}`, email: `${quien.toLowerCase()}${stamp}@example.com`, password: 'prueba123' },
})).data.token;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
const idDe = async (quien) => (await pool.query(
  'SELECT id FROM users WHERE email=$1', [`${quien.toLowerCase()}${stamp}@example.com`]
)).rows[0]?.id;

// Mover un partido en el tiempo, con la hora de la BASE: el reloj de esta
// máquina puede ir atrasado contra Neon, y los avisos se calculan con NOW().
const moverA = (matchId, intervalo) => pool.query(
  `UPDATE matches SET match_date = to_char((NOW() + $2::interval) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
   WHERE id = $1`, [matchId, intervalo]);

// Los avisos del guardado se registran después de responder; se espera a que
// aparezca la fila.
async function esperarEvento(matchId, tipo) {
  for (let i = 0; i < 20; i++) {
    const { rows } = await pool.query('SELECT id FROM match_events WHERE match_id=$1 AND type=$2', [matchId, tipo]);
    if (rows.length > 0) return rows.length;
    await new Promise((r) => setTimeout(r, 150));
  }
  return 0;
}

const bandeja = async (token) => (await call('/notifications/mine', { token })).data.items || [];
const deTipo = (items, tipo) => items.filter((i) => i.type === tipo);

console.log('\n=== 1. Un calendario con dos jornadas, y tres aficionados que votan ===');
const LIGA = await alta('LigaPred');
const lg = await call('/leagues', { method: 'POST', token: LIGA, body: { name: `Liga Pred ${stamp}`, state: 'CIUDAD DE MEXICO' } });
const LEAGUE = lg.data.league?.id ?? lg.data.id;
const ct = await call(`/leagues/${LEAGUE}/categories`, { method: 'POST', token: LIGA, body: { name: `Pred ${stamp}` } });
const CAT = ct.data.category?.id ?? ct.data.id;
const br = await call(`/manage/categories/${CAT}/branches`, { method: 'POST', token: LIGA, body: { name: 'Varonil' } });
const BRANCH = br.data.branch?.id ?? br.data.id;
ok(!!LEAGUE && !!CAT && !!BRANCH, 'liga, categoría (sin auto-status) y rama', JSON.stringify({ LEAGUE, CAT, BRANCH }));

const crear = async (local, visita, week_label) => {
  const r = await call(`/manage/categories/${CAT}/matches`, {
    method: 'POST', token: LIGA,
    body: { home_team: `${local} ${stamp}`, away_team: `${visita} ${stamp}`, match_date_local: '2026-12-05T18:00', week_label, branch_id: BRANCH },
  });
  return r.data.match?.id ?? r.data.id;
};
const M1 = await crear('Halcones', 'Tigres', '1');
const M2 = await crear('Aguilas', 'Lobos', '1');
const M3 = await crear('Osos', 'Pumas', '2');
const M4 = await crear('Toros', 'Zorros', '2');
ok([M1, M2, M3, M4].every(Boolean), 'cuatro partidos, dos por jornada', JSON.stringify([M1, M2, M3, M4]));

const F1 = await alta('FanUno');
const F2 = await alta('FanDos');
const F3 = await alta('FanTres');
const [ID1, ID2, ID3] = [await idDe('FanUno'), await idDe('FanDos'), await idDe('FanTres')];

const votar = (token, match_id, pick) => call('/predictions', { method: 'POST', token, body: { match_id, pick } });
// Jornada 1: F1 acierta las dos; F2 y F3, una cada uno.
for (const [token, m, pick] of [
  [F1, M1, 'home'], [F2, M1, 'away'], [F3, M1, 'home'],
  [F1, M2, 'home'], [F2, M2, 'home'], [F3, M2, 'away'],
  // F2 ya votó la jornada 2; F1 no.
  [F2, M3, 'home'], [F2, M4, 'home'],
]) {
  const v = await votar(token, m, pick);
  if (v.status !== 201) ok(false, `votar ${m}`, `=${v.status} ${JSON.stringify(v.data)}`);
}
ok(true, 'ocho votos, antes de que empiece cualquier partido');

// F1 además sigue el partido 1: debe recibir UN solo aviso de él.
const sigue = await call('/notifications/subscribe', { method: 'POST', token: F1, body: { match_id: M1, preferences: { notify_final: true } } });
ok(sigue.status === 201, 'F1 también sigue el partido 1', `=${sigue.status}`);

// Una quiniela entre F1 y F2.
const quiniela = await call('/pools', { method: 'POST', token: F1, body: { name: `Los del trabajo ${stamp}` } });
const CODE = quiniela.data.join_code;
ok((await call(`/pools/${CODE}/join`, { method: 'POST', token: F2 })).status === 200, 'F2 se une a la quiniela de F1');

console.log('\n=== 2. Se juega la jornada 1: el marcador parcial no califica a nadie ===');
await moverA(M1, '-5 hours');
await moverA(M2, '-4 hours');
const parcial = await call(`/manage/matches/${M1}`, { method: 'PUT', token: LIGA, body: { home_score: 7, away_score: 0 } });
ok(parcial.status === 200, 'la liga sube el 7–0 del primer cuarto', `=${parcial.status}`);
ok((await esperarEvento(M1, 'final_score')) === 1, 'queda la hora del marcador (final_score), como siempre');
let deF1 = await bandeja(F1);
ok(deTipo(deF1, 'prediction_result').length === 0, 'pero no llega ningún "acertaste"', JSON.stringify(deTipo(deF1, 'prediction_result')));
ok(!deF1.some((i) => i.type === 'final_score' && i.match?.id === M1), 'ni "marcador final" a quien lo sigue');

console.log('\n=== 3. Termina la jornada 1 ===');
await call(`/manage/matches/${M1}`, { method: 'PUT', token: LIGA, body: { home_score: 21, away_score: 14 } });
await call(`/manage/matches/${M2}`, { method: 'PUT', token: LIGA, body: { home_score: 10, away_score: 3 } });
for (const m of [M1, M2]) {
  const fin = await call(`/manage/matches/${m}/status`, { method: 'PATCH', token: LIGA, body: { status: 'finished' } });
  if (fin.status !== 200) ok(false, `finalizar ${m}`, `=${fin.status}`);
}
ok((await esperarEvento(M1, 'finished')) === 1 && (await esperarEvento(M2, 'finished')) === 1,
  'finalizar deja la hora en que terminó cada partido');

deF1 = await bandeja(F1);
const resultados = deTipo(deF1, 'prediction_result');
const delM1 = resultados.find((i) => i.match?.id === M1);
ok(resultados.length === 2 && delM1?.data?.correct === true && delM1?.data?.points === 1,
  'F1 recibe el resultado de sus dos predicciones: acertó', JSON.stringify(resultados.map((i) => i.data)));
ok(delM1?.match?.home_score === 21 && delM1?.is_new === true && delM1?.origin === 'prediction',
  'con el marcador final (no el parcial) y como nuevo', JSON.stringify(delM1).slice(0, 200));
ok(delM1?.data?.votes === 3 && delM1?.data?.same_pct === 67, 'y cuánta gente votó como él', JSON.stringify(delM1?.data));
ok(!deF1.some((i) => i.type === 'final_score' && i.match?.id === M1),
  'sigue el partido Y lo predijo: llega un solo aviso, el de su predicción');

const cierreDe = async (token) => deTipo(await bandeja(token), 'prediction_round')[0];
const c1 = await cierreDe(F1);
ok(c1?.data?.position === 1 && c1?.data?.participants === 3 && c1?.data?.milestone === 'first',
  'F1 cierra la jornada 1 en el 1.º de 3, con su hito', JSON.stringify(c1?.data));
ok(c1?.data?.correct === 2 && c1?.data?.graded === 2 && c1?.data?.points === 2, 'y su jornada: 2 de 2, +2', JSON.stringify(c1?.data));
ok(c1?.url === `/categorias/${CAT}/calendario?tab=ranking`, 'con link al ranking de su calendario', c1?.url);
const q1 = c1?.data?.pools?.[0];
ok(c1?.data?.pools?.length === 1 && q1.position === 1 && q1.members === 2,
  'y su lugar en la quiniela: 1.º de 2', JSON.stringify(c1?.data?.pools));

const c2 = await cierreDe(F2);
const c3 = await cierreDe(F3);
ok(c2?.data?.position === 2 && c3?.data?.position === 3,
  'F2 2.º (mismos aciertos que F3, pero más predicciones) y F3 3.º', JSON.stringify([c2?.data?.position, c3?.data?.position]));

const ranking = await call(`/predictions/ranking?matchIds=${[M1, M2, M3, M4].join(',')}`);
const lugarPublico = (id) => ranking.data.find((r) => r.userId === id)?.position;
ok(lugarPublico(ID1) === 1 && lugarPublico(ID2) === 2 && lugarPublico(ID3) === 3,
  'la pestaña Ranking dice exactamente los mismos lugares', JSON.stringify(ranking.data.map((r) => [r.userId, r.position])));

console.log('\n=== 4. Te falta votar ===');
await moverA(M3, '20 hours');
await moverA(M4, '26 hours');
let recordatorio = deTipo(await bandeja(F1), 'prediction_reminder')[0];
ok(recordatorio?.data?.missing === 2 && recordatorio?.match?.id === M3,
  'a 20 horas de la jornada 2, a F1 le faltan dos', JSON.stringify(recordatorio?.data));
ok(recordatorio?.url === `/categorias/${CAT}/calendario?view=jornada&sel=2`, 'con link a esa jornada', recordatorio?.url);
ok(deTipo(await bandeja(F2), 'prediction_reminder').length === 0, 'F2 ya votó todo: no le llega');
await votar(F1, M3, 'away');
recordatorio = deTipo(await bandeja(F1), 'prediction_reminder')[0];
ok(recordatorio?.data?.missing === 1, 'F1 vota uno: ahora le falta uno', JSON.stringify(recordatorio?.data));
await votar(F1, M4, 'away');
ok(deTipo(await bandeja(F1), 'prediction_reminder').length === 0, 'vota el otro: el recordatorio se quita solo');

console.log('\n=== 5. El balón ===');
const nuevas = async (token) => (await call('/notifications/mine/unread', { token })).data.unread;
ok((await nuevas(F1)) >= 3, 'el balón de F1 cuenta sus dos resultados y el cierre', `=${await nuevas(F1)}`);
await call('/notifications/mine/seen', { method: 'POST', token: F1 });
ok((await nuevas(F1)) === 0, 'y se pone en cero al abrir la bandeja', `=${await nuevas(F1)}`);
ok((await nuevas(F3)) >= 2, 'solo para F1: lo visto es de cada persona', `=${await nuevas(F3)}`);

console.log('\n=== 6. Un aviso que nace con hora del pasado también prende el balón ===');
// README, "Lo nuevo y el numerito del balón". Una jornada detenida por un
// partido jugado y sin marcador se destraba al posponerlo, y cierra con la
// hora de su último partido calificado: ANTES de que F1 abriera su bandeja.
// Con la marca sola, el balón lo daba por visto (el top 10 de ONEFA del
// 2026-09-28 se perdió igual, al desplegar los avisos de predicciones).
await moverA(M3, '-5 hours');
await moverA(M4, '-4 hours');
await call(`/manage/matches/${M3}`, { method: 'PUT', token: LIGA, body: { home_score: 3, away_score: 0 } });
const finM3 = await call(`/manage/matches/${M3}/status`, { method: 'PATCH', token: LIGA, body: { status: 'finished' } });
ok(finM3.status === 200 && (await esperarEvento(M3, 'finished')) === 1,
  'termina el partido 3; el 4 ya se jugó y no tiene marcador');
ok(!deTipo(await bandeja(F1), 'prediction_round').some((i) => i.data?.jornada?.week_label === '2'),
  'la jornada 2 no cierra: la detiene el partido 4');
const vista = await call('/notifications/mine/seen', { method: 'POST', token: F1 });
ok((await nuevas(F1)) === 0, 'F1 abre su bandeja: el balón en cero', `=${await nuevas(F1)}`);

await moverA(M4, '3 days');
const cierre2 = deTipo(await bandeja(F1), 'prediction_round').find((i) => i.data?.jornada?.week_label === '2');
ok(!!cierre2 && new Date(cierre2.at) < new Date(vista.data.seen_at),
  'la liga pospone el 4: la jornada 2 cierra con una hora anterior a la marca de F1',
  JSON.stringify({ at: cierre2?.at, seen_at: vista.data.seen_at }));
ok(cierre2?.is_new === true, 'y la bandeja lo pinta como nuevo', JSON.stringify(cierre2).slice(0, 200));
ok((await nuevas(F1)) === 1, 'el balón lo cuenta, y solo a él: el resultado del 3 ya estaba', `=${await nuevas(F1)}`);
await call('/notifications/mine/seen', { method: 'POST', token: F1 });
ok((await nuevas(F1)) === 0, 'al abrir la bandeja otra vez, vuelve a cero', `=${await nuevas(F1)}`);

console.log('\n=== 7. Un partido con fecha por definir ===');
// README, "Partidos con fecha por definir". Sin fecha es match_date en NULL;
// se puede votar mientras siga programado, y cierra al marcarlo En vivo.
const crearSinFecha = (body) => call(`/manage/categories/${CAT}/matches`, {
  method: 'POST', token: LIGA,
  body: { home_team: `Cuervos ${stamp}`, away_team: `Linces ${stamp}`, branch_id: BRANCH, ...body },
});
const sinFecha = await crearSinFecha({ match_date_local: null, week_label: '3' });
const M5 = sinFecha.data.id;
ok(sinFecha.status === 201 && sinFecha.data.match_date === null, 'la liga crea un partido con fecha por definir', `=${sinFecha.status} ${JSON.stringify(sinFecha.data).slice(0, 120)}`);
ok((await crearSinFecha({ match_date_local: '' })).status === 400, 'una fecha vacía sigue siendo error (no es "por definir")');
ok((await crearSinFecha({})).status === 400, 'y también no mandar la fecha');

const detalle5 = (await call(`/leagues/matches/${M5}`)).data;
ok(detalle5.match_date === null && detalle5.prev_match_id === M4 && detalle5.next_match_id === null,
  'en las flechas va al final: su jornada no tiene ningún partido con fecha', JSON.stringify({ prev: detalle5.prev_match_id, next: detalle5.next_match_id }));
// Uno de la jornada 1 sin fecha va detrás del último de la jornada 1 que sí la tiene.
const M6 = (await crearSinFecha({ match_date_local: null, week_label: '1' })).data.id;
const detalle6 = (await call(`/leagues/matches/${M6}`)).data;
ok(detalle6.prev_match_id === M2 && detalle6.next_match_id === M4,
  'otro de la jornada 1 sin fecha va justo después del último de la jornada 1', JSON.stringify({ prev: detalle6.prev_match_id, next: detalle6.next_match_id }));

ok((await votar(F1, M5, 'home')).status === 201, 'sin fecha se puede votar');
ok((await call('/notifications/mine', { token: F1 })).status === 200, 'y la bandeja de quien lo votó sigue respondiendo');

const conFecha = await call(`/manage/matches/${M5}`, { method: 'PUT', token: LIGA, body: { match_date_local: '2026-12-12T18:00' } });
ok(conFecha.status === 200 && conFecha.data.match_date === '2026-12-13T00:00:00.000Z', 'al editar se le pone fecha', JSON.stringify(conFecha.data.match_date));
const otraVez = await call(`/manage/matches/${M5}`, { method: 'PUT', token: LIGA, body: { match_date_local: null } });
ok(otraVez.status === 200 && otraVez.data.match_date === null, 'y se le puede volver a quitar', JSON.stringify(otraVez.data.match_date));
// Los dos avisos se escriben después de responder: se espera a que estén los dos.
let cambios = 0;
for (let i = 0; i < 20 && cambios < 2; i++) {
  cambios = (await pool.query(`SELECT COUNT(*)::int AS n FROM match_events WHERE match_id=$1 AND type='schedule_change'`, [M5])).rows[0].n;
  if (cambios < 2) await new Promise((r) => setTimeout(r, 150));
}
ok(cambios === 2, 'ponerle y quitarle la fecha deja un aviso de cambio de programación cada uno', `=${cambios}`);
const sinTocar = await call(`/manage/matches/${M5}`, { method: 'PUT', token: LIGA, body: { home_score: 0, away_score: 0 } });
ok(sinTocar.status === 200 && sinTocar.data.match_date === null, 'una edición que no manda la fecha no se la inventa', JSON.stringify(sinTocar.data.match_date));
const soloZona = await call(`/manage/matches/${M5}`, { method: 'PUT', token: LIGA, body: { timezone: 'America/Tijuana' } });
ok(soloZona.status === 200 && soloZona.data.match_date === null && soloZona.data.timezone === 'America/Tijuana',
  'cambiar solo la zona tampoco', JSON.stringify([soloZona.status, soloZona.data.match_date, soloZona.data.timezone]));

const enVivo = await call(`/manage/matches/${M5}/status`, { method: 'PATCH', token: LIGA, body: { status: 'live' } });
const tarde = await votar(F2, M5, 'away');
ok(enVivo.status === 200 && tarde.status === 400, 'en cuanto lo marcan En vivo, ya no se vota aunque no tenga fecha', `=${tarde.status} ${JSON.stringify(tarde.data)}`);

console.log('\n=== 8. Un acierto en fase final vale doble, y la fila lo dice ===');
// README, "La fila dice aciertos": la fracción son aciertos, no puntos, y el
// conteo de fase final tiene que salir igual en el ranking público y en la
// quiniela, porque los dos pintan la misma fila.
const M7 = await crear('Jaguares', 'Coyotes', 'PLAYOFF');
ok((await votar(F1, M7, 'home')).status === 201 && (await votar(F2, M7, 'away')).status === 201,
  'F1 y F2 votan un partido de playoff, cada uno por un lado');
await moverA(M7, '-5 hours');
await call(`/manage/matches/${M7}`, { method: 'PUT', token: LIGA, body: { home_score: 28, away_score: 7 } });
const finM7 = await call(`/manage/matches/${M7}/status`, { method: 'PATCH', token: LIGA, body: { status: 'finished' } });
ok(finM7.status === 200, 'termina el playoff: gana el local', `=${finM7.status}`);

const conPlayoff = [M1, M2, M3, M4, M7];
const publico = (await call(`/predictions/ranking?matchIds=${conPlayoff.join(',')}`)).data;
const filaDe = (filas, id) => filas.find((r) => r.userId === id);
const pub1 = filaDe(publico, ID1);
const pub2 = filaDe(publico, ID2);
ok(pub1?.correct === 3 && pub1?.graded === 4 && pub1?.points === 4 && pub1?.correctFinalPhase === 1,
  'F1 acertó el playoff: 3 de 4 aciertos, 4 puntos, 1 en fase final', JSON.stringify(pub1));
ok(pub2?.correct === 2 && pub2?.graded === 4 && pub2?.points === 2 && pub2?.correctFinalPhase === 0,
  'F2 lo falló: sus puntos siguen siendo sus aciertos, y 0 en fase final', JSON.stringify(pub2));
ok(publico.every((r) => r.points === r.correct + r.correctFinalPhase),
  'en todas las filas, los puntos son los aciertos más los de fase final', JSON.stringify(publico.map((r) => [r.points, r.correct, r.correctFinalPhase])));

const enQuiniela = (await call(`/pools/${CODE}/ranking?matchIds=${conPlayoff.join(',')}`, { token: F1 })).data.ranking;
const qui1 = filaDe(enQuiniela, ID1);
const qui2 = filaDe(enQuiniela, ID2);
ok(qui1?.correctFinalPhase === 1 && qui1?.points === pub1.points && qui1?.correct === pub1.correct,
  'la quiniela dice lo mismo de F1', JSON.stringify(qui1));
ok(qui2?.correctFinalPhase === 0 && qui2?.points === pub2.points && qui2?.correct === pub2.correct,
  'y lo mismo de F2', JSON.stringify(qui2));
const sinPartidos = (await call(`/pools/${CODE}/ranking`, { token: F1 })).data.ranking;
ok(sinPartidos.length === 2 && sinPartidos.every((r) => r.correctFinalPhase === 0),
  'una quiniela sin partidos todavía manda el conteo en 0, no vacío', JSON.stringify(sinPartidos));

console.log(`\n========  ${pass} ok, ${fail} fallas  ========`);
await pool.end();
process.exit(fail ? 1 : 0);
