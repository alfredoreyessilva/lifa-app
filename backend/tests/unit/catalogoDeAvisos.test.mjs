// El catálogo de avisos (utils/catalogoDeAvisos.js) contra el código que de
// verdad los manda. README, "Notificaciones: todo lo que la app avisa".
//
// Por qué una prueba: el catálogo se escribe a mano, y una lista así se queda
// vieja en silencio. Para lo que existe —que antes de crear un aviso se vea si
// ya hay uno que lo diga— una lista que omite uno es peor que no tenerla. Esta
// prueba lee los archivos, como la de los signos de interrogación, y por eso
// corre en el CI:
//
//   1. Cada tipo que el backend escribe en `notifications` está en el catálogo,
//      y cada tipo guardado del catálogo se escribe en algún lado.
//   2. Los calculados son los que arma utils/bandeja.js; los correos, las
//      funciones send…Email de utils/email.js.
//   3. Los de organización son los de PERMISO_POR_AVISO, y todo aviso de la
//      bandeja tiene su TYPE_META en el frontend.
//   4. Los pedazos de texto de cada entrada siguen en su archivo.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATALOGO_DE_AVISOS, TEMAS, armarCatalogo, quienLoVe } from '../../src/utils/catalogoDeAvisos.js';
import { PERMISO_POR_AVISO } from '../../src/utils/bandeja.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = path.join(RAIZ, 'backend/src');
const leer = (relativo) => fs.readFileSync(path.join(RAIZ, relativo), 'utf8');

const deTipo = (como) => CATALOGO_DE_AVISOS.filter((a) => a.como === como).map((a) => a.tipo);
const ordenado = (lista) => [...lista].sort();

function archivosJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? archivosJs(p) : e.name.endsWith('.js') ? [p] : [];
  });
}

// ── Leer una llamada sin un parser de JS ──────────────────────────────────
//
// Lo justo para partir los argumentos de una llamada: brinca lo que va dentro
// de comillas y plantillas (con sus ${…}) y cuenta paréntesis, corchetes y
// llaves. No entiende expresiones regulares con paréntesis adentro; en las
// llamadas que lee esta prueba no hay ninguna.

function finDeCadena(texto, i) {
  const comilla = texto[i];
  for (let j = i + 1; j < texto.length; j++) {
    if (texto[j] === '\\') { j++; continue; }
    if (texto[j] === comilla) return j;
  }
  throw new Error('una cadena sin cerrar');
}

function finDePlantilla(texto, i) {
  for (let j = i + 1; j < texto.length; j++) {
    if (texto[j] === '\\') { j++; continue; }
    if (texto[j] === '`') return j;
    if (texto[j] === '$' && texto[j + 1] === '{') j = finDeBloque(texto, j + 1);
  }
  throw new Error('una plantilla sin cerrar');
}

// `i` apunta a un ( [ o {; regresa dónde cierra.
function finDeBloque(texto, i) {
  let profundidad = 0;
  for (let j = i; j < texto.length; j++) {
    const c = texto[j];
    if (c === "'" || c === '"') { j = finDeCadena(texto, j); continue; }
    if (c === '`') { j = finDePlantilla(texto, j); continue; }
    if (c === '/' && texto[j + 1] === '/') {
      const salto = texto.indexOf('\n', j);
      if (salto === -1) break;
      j = salto;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') profundidad++;
    else if (c === ')' || c === ']' || c === '}') {
      profundidad--;
      if (profundidad === 0) return j;
    }
  }
  throw new Error('un bloque sin cerrar');
}

// Los argumentos de la llamada cuyo paréntesis abre en `abre`, como texto.
function argumentos(texto, abre) {
  const cierre = finDeBloque(texto, abre);
  const args = [];
  let desde = abre + 1;
  let profundidad = 0;
  for (let j = abre + 1; j < cierre; j++) {
    const c = texto[j];
    if (c === "'" || c === '"') { j = finDeCadena(texto, j); continue; }
    if (c === '`') { j = finDePlantilla(texto, j); continue; }
    if (c === '(' || c === '[' || c === '{') profundidad++;
    else if (c === ')' || c === ']' || c === '}') profundidad--;
    else if (c === ',' && profundidad === 0) {
      args.push(texto.slice(desde, j).trim());
      desde = j + 1;
    }
  }
  const ultimo = texto.slice(desde, cierre).trim();
  if (ultimo) args.push(ultimo);
  return args;
}

const literal = (arg) => /^'([^'\\]*)'$/.exec(arg ?? '')?.[1] ?? /^"([^"\\]*)"$/.exec(arg ?? '')?.[1] ?? null;
const lineaDe = (texto, i) => texto.slice(0, i).split('\n').length;

// La función declarada más cerca antes de `i`, con sus parámetros.
function funcionQueEnvuelve(texto, i) {
  let ultima = null;
  for (const m of texto.matchAll(/function\s+(\w+)\s*\(([^)]*)\)/g)) {
    if (m.index > i) break;
    ultima = { nombre: m[1], parametros: m[2].split(',').map((p) => p.split('=')[0].trim()) };
  }
  return ultima;
}

// Los tipos que un archivo escribe en `notifications`. El tipo sale de la
// columna `type` del INSERT: escrito ahí, o en el argumento del `.run()` que
// le toca a su `?`. Si ese argumento es el parámetro de la función que envuelve
// al INSERT (`notifyTeam(…, type, …)`), el tipo sale de cada llamada a esa
// función, en el mismo archivo. Lo que no llegue escrito —una variable— no se
// puede comprobar, y se dice.
function tiposEscritosEn(nombre, texto) {
  const tipos = new Map();
  const sinComprobar = [];
  const anotar = (tipo, lugar) => tipos.set(tipo, [...(tipos.get(tipo) ?? []), lugar]);
  const envolturas = [];

  let i = texto.indexOf('INSERT INTO notifications');
  while (i !== -1) {
    const lugar = `${nombre}:${lineaDe(texto, i)}`;
    const abre = texto.lastIndexOf('`', i);
    const cierra = texto.indexOf('`', i);
    const sql = /INSERT INTO notifications\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/.exec(texto.slice(abre + 1, cierra));
    if (!sql) {
      sinComprobar.push(`${lugar} (no se pudo leer el INSERT)`);
    } else {
      const columnas = sql[1].split(',').map((s) => s.trim());
      const valores = sql[2].split(',').map((s) => s.trim());
      const k = columnas.indexOf('type');
      const valor = valores[k];
      const llamada = /^\)\s*\.(?:run|get|all)\(/.exec(texto.slice(cierra + 1));
      if (literal(valor) != null) {
        anotar(literal(valor), lugar);
      } else if (valor === '?' && llamada) {
        const n = valores.slice(0, k).filter((v) => v === '?').length;
        const arg = argumentos(texto, cierra + llamada[0].length)[n];
        const funcion = funcionQueEnvuelve(texto, i);
        if (literal(arg) != null) anotar(literal(arg), lugar);
        else if (funcion?.parametros.includes(arg)) {
          envolturas.push({ funcion: funcion.nombre, indice: funcion.parametros.indexOf(arg) });
        } else sinComprobar.push(`${lugar} (el tipo llega en «${arg}»)`);
      } else {
        sinComprobar.push(`${lugar} (el tipo es «${valor}»)`);
      }
    }
    i = texto.indexOf('INSERT INTO notifications', Math.max(cierra, i + 1));
  }

  for (const { funcion, indice } of envolturas) {
    for (const m of texto.matchAll(new RegExp(`\\b${funcion}\\(`, 'g'))) {
      if (/function\s*$/.test(texto.slice(Math.max(0, m.index - 12), m.index))) continue;
      const lugar = `${nombre}:${lineaDe(texto, m.index)}`;
      const arg = argumentos(texto, m.index + funcion.length)[indice];
      if (literal(arg) != null) anotar(literal(arg), lugar);
      else sinComprobar.push(`${lugar} (${funcion} recibe el tipo en «${arg}»)`);
    }
  }
  return { tipos, sinComprobar };
}

function tiposEscritos() {
  const tipos = new Map();
  const sinComprobar = [];
  for (const archivo of archivosJs(SRC)) {
    const nombre = path.relative(RAIZ, archivo).replaceAll('\\', '/');
    const deEste = tiposEscritosEn(nombre, fs.readFileSync(archivo, 'utf8'));
    for (const [tipo, lugares] of deEste.tipos) tipos.set(tipo, [...(tipos.get(tipo) ?? []), ...lugares]);
    sinComprobar.push(...deEste.sinComprobar);
  }
  return { tipos, sinComprobar };
}

// ── El lector, contra un archivo inventado ────────────────────────────────
//
// Sin esto, un lector que no encontrara nada pasaría las pruebas de abajo en
// cuanto el catálogo también estuviera vacío de ese lado.

test('el lector encuentra el tipo escrito, el del .run() y el de una función que lo envuelve', () => {
  const texto = `
    await db.prepare(\`
      INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
      VALUES ('league', ?, 'aviso_escrito', ?, ?, ?)
    \`).run(id, 'Un título (con paréntesis)', \`Texto \${f(a, b)}\`, null);

    await db.prepare(\`
      INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
      VALUES ('league', ?, ?, ?, ?, ?)
    \`).run(id, 'aviso_del_run', 'Título', 'Cuerpo', null);

    async function avisar(teamId, type, title, body, extra = {}) {
      await db.prepare(\`
        INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
        VALUES ('team', ?, ?, ?, ?, ?)
      \`).run(teamId, type, title, body, JSON.stringify({ teamId, ...extra }));
    }

    await avisar(equipo.id, 'aviso_envuelto', \`Hola, \${nombre}\`, 'Cuerpo');
    await avisar(equipo.id, tipoQueLlegaEnVariable, 'Título', 'Cuerpo');
  `;
  const { tipos, sinComprobar } = tiposEscritosEn('prueba.js', texto);
  assert.deepEqual(ordenado(tipos.keys()), ['aviso_del_run', 'aviso_envuelto', 'aviso_escrito']);
  assert.equal(sinComprobar.length, 1);
  assert.match(sinComprobar[0], /tipoQueLlegaEnVariable/);
});

// ── El catálogo contra el código ──────────────────────────────────────────

test('cada aviso dice lo que la pantalla necesita', () => {
  const temas = new Set(TEMAS.map((t) => t.clave));
  const vistos = new Set();
  for (const a of CATALOGO_DE_AVISOS) {
    const quien = `«${a.tipo}»`;
    assert.ok(!vistos.has(a.tipo), `${quien} está dos veces`);
    vistos.add(a.tipo);
    assert.ok(temas.has(a.tema), `${quien}: el tema «${a.tema}» no existe`);
    assert.ok(['guardado', 'calculado', 'correo'].includes(a.como), `${quien}: «como» no es válido`);
    assert.ok(a.para.length > 0 && a.para.every((p) => ['liga', 'equipo', 'aficionado', 'cuenta'].includes(p)), `${quien}: «para»`);
    assert.ok(a.canales.length > 0 && a.canales.every((c) => ['bandeja', 'push', 'correo'].includes(c)), `${quien}: «canales»`);
    assert.ok(a.cuando?.trim(), `${quien}: falta «cuando»`);
    assert.ok(Array.isArray(a.sinRepetir), `${quien}: «sinRepetir» es una lista, aunque esté vacía`);
    assert.ok(Object.keys(a.fuentes ?? {}).length > 0, `${quien}: falta en qué archivo vive`);

    if (a.como === 'guardado') {
      assert.ok(a.para.every((p) => p === 'liga' || p === 'equipo'), `${quien}: un guardado le llega a una liga o a un equipo`);
      assert.ok(a.muestra?.de && a.muestra?.titulo && a.muestra?.cuerpo, `${quien}: la muestra necesita de, titulo y cuerpo`);
    }
    if (a.como === 'calculado') {
      assert.ok(a.quien && a.muestra?.match, `${quien}: un calculado necesita quien y una muestra con su partido`);
      assert.ok(a.casilla || a.alcance === 'predicciones', `${quien}: falta de dónde sale su alcance`);
    }
    if (a.como === 'correo') {
      assert.ok(a.quien && a.etiqueta && a.icono && a.tabla && a.muestra?.asunto, `${quien}: un correo necesita quien, etiqueta, icono, tabla y asunto`);
    }
  }
  for (const t of TEMAS) {
    assert.ok(CATALOGO_DE_AVISOS.some((a) => a.tema === t.clave), `el tema «${t.clave}» no tiene avisos`);
  }
});

test('cada tipo que el backend escribe en notifications está en el catálogo, y al revés', () => {
  const { tipos, sinComprobar } = tiposEscritos();
  assert.deepEqual(sinComprobar, [], 'estos avisos no dicen su tipo escrito y no se pueden comprobar');

  const catalogo = new Set(deTipo('guardado'));
  const faltan = [...tipos.keys()].filter((t) => !catalogo.has(t)).map((t) => `${t} (${tipos.get(t).join(', ')})`);
  assert.deepEqual(faltan, [], 'se escriben en notifications y no están en utils/catalogoDeAvisos.js');

  const nadieLoManda = [...catalogo].filter((t) => !tipos.has(t));
  assert.deepEqual(nadieLoManda, [], 'están en el catálogo y nadie los escribe');
});

test('los avisos calculados son los que arma la bandeja', () => {
  const texto = leer('backend/src/utils/bandeja.js');
  const calculados = new Set([...texto.matchAll(/type: '([a-z_]+)'/g)].map((m) => m[1]));
  // "Cambio de fecha o sede" no se escribe así: sale de `evento.type`. Su
  // casilla del menú de Seguir sí lo nombra.
  const casillas = /const CASILLA_POR_AVISO = \{([\s\S]*?)\};/.exec(texto);
  assert.ok(casillas, 'no se encontró CASILLA_POR_AVISO en utils/bandeja.js');
  for (const m of casillas[1].matchAll(/^\s*([a-z_]+):/gm)) calculados.add(m[1]);

  assert.deepEqual(ordenado(deTipo('calculado')), ordenado(calculados));
});

test('los correos son las funciones send…Email de utils/email.js', () => {
  const texto = leer('backend/src/utils/email.js');
  const funciones = [...texto.matchAll(/export async function (send\w*Email)\(/g)].map((m) => m[1]);
  assert.ok(funciones.length > 0);
  assert.deepEqual(ordenado(deTipo('correo')), ordenado(funciones));
});

test('los avisos de una organización son exactamente los que tienen permiso en la bandeja', () => {
  // Un tipo sin permiso lo leen solo los dueños (falla cerrado). El catálogo
  // dice quién lo ve con esa misma tabla, así que tienen que ser los mismos.
  assert.deepEqual(ordenado(deTipo('guardado')), ordenado(Object.keys(PERMISO_POR_AVISO)));
});

test('cada aviso de la bandeja tiene su ícono y su etiqueta en el frontend', () => {
  const texto = leer('frontend/src/utils/misNotificaciones.js');
  const bloque = /export const TYPE_META = \{([\s\S]*?)\n\};/.exec(texto);
  assert.ok(bloque, 'no se encontró TYPE_META en frontend/src/utils/misNotificaciones.js');
  const claves = [...bloque[1].matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map((m) => m[1]);

  // Sin TYPE_META, la bandeja lo enseña como "📢 Aviso".
  const deLaBandeja = [...deTipo('guardado'), ...deTipo('calculado')];
  assert.deepEqual(ordenado(claves), ordenado(deLaBandeja));
});

test('los pedazos de texto de cada aviso siguen en su archivo', () => {
  const faltan = [];
  for (const a of CATALOGO_DE_AVISOS) {
    for (const [archivo, pedazos] of Object.entries(a.fuentes)) {
      const texto = leer(archivo);
      for (const pedazo of pedazos) {
        if (!texto.includes(pedazo)) faltan.push(`${a.tipo}: «${pedazo}» ya no está en ${archivo}`);
      }
    }
  }
  assert.deepEqual(faltan, [], 'si el texto cambió en el código, cámbialo también en utils/catalogoDeAvisos.js');
});

// ── Lo que se calcula al armar la respuesta ───────────────────────────────

test('quién lo ve sale de los permisos, con la etiqueta de cada rol', () => {
  const aviso = (tipo) => CATALOGO_DE_AVISOS.find((a) => a.tipo === tipo);
  assert.deepEqual(quienLoVe(aviso('billing_overdue')), { equipo: ['Dueño', 'Administrador', 'Tesorero'] });
  assert.deepEqual(quienLoVe(aviso('team_payment_reported')), { liga: ['Dueño', 'Administrador', 'Tesorero de liga'] });
  assert.deepEqual(quienLoVe(aviso('score_reminder')), { liga: ['Dueño', 'Administrador', 'Editor de partidos (Visor)'] });
  // El coach y el editor de roster no leen cuotas: llevan nombres del padrón.
  assert.deepEqual(quienLoVe(aviso('player_billing_overdue')), { equipo: ['Dueño', 'Administrador', 'Tesorero'] });
  assert.deepEqual(quienLoVe(aviso('org_admin_claimed')), {
    liga: ['Dueño', 'Administrador'],
    equipo: ['Dueño', 'Administrador'],
  });
});

test('el catálogo junta los envíos, el alcance y lo que la base tiene de más', () => {
  const r = armarCatalogo({
    envios: [
      { tipo: 'billing_charge_new', total: 12, ultimos_30: 3, destinatarios_30: 2, ultimo: '2026-11-08T18:00:00.000Z' },
      { tipo: 'aviso_viejo', total: '4', ultimos_30: '0', destinatarios_30: '0', ultimo: null },
    ],
    codigos: { password_reset_codes: { total: 2, ultimos_30: 2, destinatarios_30: 1, ultimo: '2026-11-01T10:00:00.000Z' } },
    seguidores: { notify_upcoming: 17, notify_live: 34 },
    predicen: 38,
    canales: { push: false, correo: true },
  });

  const de = (tipo) => r.avisos.find((a) => a.tipo === tipo);
  assert.deepEqual(r.canales, { bandeja: true, push: false, correo: true });
  assert.equal(r.avisos.length, CATALOGO_DE_AVISOS.length);
  assert.deepEqual(r.temas, TEMAS);

  // Guardado: lo que salió, y cero cuando nunca salió.
  assert.deepEqual(de('billing_charge_new').envios, { total: 12, ultimos_30: 3, destinatarios_30: 2, ultimo: '2026-11-08T18:00:00.000Z' });
  assert.deepEqual(de('league_unverified').envios, { total: 0, ultimos_30: 0, destinatarios_30: 0, ultimo: null });
  assert.equal(de('billing_charge_new').alcance, null);
  assert.deepEqual(de('billing_charge_new').lo_ven, { equipo: ['Dueño', 'Administrador', 'Tesorero'] });

  // Calculado: no se cuenta, porque no se guarda; se dice a cuántos les puede llegar.
  assert.equal(de('upcoming').envios, null);
  assert.equal(de('upcoming').alcance, 17);
  assert.equal(de('final_score').alcance, 0);
  assert.equal(de('prediction_round').alcance, 38);
  assert.equal(de('upcoming').lo_ven, null);

  // Correo: se cuenta con sus códigos.
  assert.equal(de('sendPasswordResetEmail').envios.total, 2);
  assert.equal(de('sendVerificationEmail').envios.total, 0);

  // La pantalla no recibe los pedazos de texto, solo en qué archivos vive.
  assert.equal(de('billing_charge_new').fuentes, undefined);
  assert.deepEqual(de('billing_charge_new').archivos, ['backend/src/routes/billing.js']);

  // Lo que la base tiene y el catálogo no.
  assert.deepEqual(r.desconocidos, [{ tipo: 'aviso_viejo', total: 4, ultimos_30: 0, destinatarios_30: 0, ultimo: null }]);
});
