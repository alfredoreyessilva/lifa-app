// Respaldo de producción a un archivo en esta computadora. Es el mensual.
//
// Complementa .github/workflows/respaldo.yml. Aquel deja cada semana una rama
// de Neon, que protege de un error propio (una migración, un DELETE) pero vive
// DENTRO de Neon. Este archivo es lo que queda si algún día se pierde la
// cuenta o el proyecto. Ver "Respaldos" en el README.
//
// ES DE SOLO LECTURA contra producción: pg_dump solo lee, y además la sesión
// se abre con default_transaction_read_only. No importa config/db.js, porque
// eso correría ~150 migraciones contra la base. Lo único que escribe es el
// archivo.
//
// El archivo lleva datos personales (correos, contraseñas cifradas y, el día
// que haya padrón, CURP de menores). Por eso se guarda FUERA del repositorio,
// y el script se niega a escribir dentro de él.
//
// Cómo sabe que el respaldo sirve: los conteos de filas y pg_dump leen el
// MISMO snapshot de la base (pg_export_snapshot + --snapshot), así que los
// números cuadran exactos aunque producción reciba escrituras en medio. Con
// --probar, además, lo restaura en una base temporal de la rama
// desarrollo-local, cuenta otra vez tabla por tabla y la borra al terminar.
// Un respaldo que nunca se restauró no está probado.
//
// Uso, desde backend/:
//   node scripts/respaldo-local.mjs            respalda y verifica el archivo
//   node scripts/respaldo-local.mjs --probar   además lo restaura y compara
//
// De dónde saca cada cosa:
//   · La cadena de producción: RESPALDO_DATABASE_URL si existe; si no, la
//     línea comentada "# DATABASE_URL=" de backend/.env. En los dos casos su
//     host tiene que ser PROD_DATABASE_HOST, o no corre.
//   · pg_dump y pg_restore (versión 18 o mayor, la de Neon): PG_BIN, o
//     %LOCALAPPDATA%\Programs\pgsql18.
//   · La carpeta: RESPALDO_DIR, o Documentos\cfbamx-respaldos.
//   · La prueba de restauración: el DATABASE_URL normal, que tiene que NO ser
//     producción.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { hoyEnMexico } from '../src/utils/prodGuard.js';

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(BACKEND, '..');
const PROBAR = process.argv.includes('--probar');

// Lanza en vez de salir: process.exit() se saltaría los finally, y el de
// --probar es el que borra la base temporal de la rama de desarrollo.
class Falla extends Error {}
function morir(mensaje) {
  throw new Falla(mensaje);
}
process.on('uncaughtException', (e) => {
  console.error(e instanceof Falla ? `\n✗ ${e.message}` : e);
  process.exitCode = 1;
});

// ── Configuración ──────────────────────────────────────────────────────────

const envPath = path.join(BACKEND, '.env');
const envTexto = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
// Lo que venga en la línea del comando gana sobre el .env, como con dotenv.
const env = { ...dotenv.parse(envTexto), ...process.env };

const prodHost = (env.PROD_DATABASE_HOST || '').trim();
if (!prodHost) {
  morir('Falta PROD_DATABASE_HOST en backend/.env. Sin él no hay forma de comprobar que la cadena es la de producción.');
}

let prodUrl = env.RESPALDO_DATABASE_URL;
if (!prodUrl) {
  const linea = envTexto.split(/\r?\n/).find((l) => /^#\s*DATABASE_URL=/.test(l));
  prodUrl = linea ? linea.replace(/^#\s*DATABASE_URL=/, '').trim() : '';
}
if (!prodUrl) {
  morir('No encontré la cadena de producción: ni RESPALDO_DATABASE_URL ni una línea "# DATABASE_URL=" en backend/.env.');
}

// Desarma una cadena de Neon en variables PG*. pg_dump recibe la contraseña
// por PGPASSWORD y no en la línea de comando, donde la vería cualquier lista
// de procesos. El host va DIRECTO, sin "-pooler": el pooler está en modo
// transacción, y ni pg_dump ni un snapshot exportado sobreviven ahí.
function conexion(url, etiqueta) {
  let u;
  try { u = new URL(url); } catch { morir(`La cadena de ${etiqueta} no se puede leer.`); }
  return {
    hostOriginal: u.hostname,
    host: u.hostname.replace('-pooler', ''),
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1) || 'neondb',
  };
}

const prod = conexion(prodUrl, 'producción');
if (prod.hostOriginal !== prodHost) {
  morir(`La cadena apunta a ${prod.hostOriginal}, que no es PROD_DATABASE_HOST. No se respalda algo que no es producción.`);
}

const pgBin = env.PG_BIN || path.join(env.LOCALAPPDATA || os.homedir(), 'Programs', 'pgsql18');
const exe = (nombre) => path.join(pgBin, process.platform === 'win32' ? `${nombre}.exe` : nombre);
for (const nombre of ['pg_dump', 'pg_restore']) {
  if (!fs.existsSync(exe(nombre))) {
    morir(`No encontré ${exe(nombre)}. Pon la carpeta de binarios de PostgreSQL 18 en PG_BIN (ver "Respaldos" en el README).`);
  }
}

const carpeta = path.resolve(env.RESPALDO_DIR || path.join(os.homedir(), 'Documents', 'cfbamx-respaldos'));
const relativo = path.relative(REPO, carpeta);
if (!relativo.startsWith('..') && !path.isAbsolute(relativo)) {
  morir(`${carpeta} está dentro del repositorio. El respaldo lleva datos personales y el repo es público: elige una carpeta fuera (RESPALDO_DIR).`);
}
fs.mkdirSync(carpeta, { recursive: true });

// libpq en Windows no encuentra los certificados raíz del sistema, así que
// "verify-full" fallaría y lo fácil sería bajar a "require", que cifra pero no
// comprueba con quién habla. En vez de eso se le pasan las raíces que trae
// Node, que son las de Mozilla, las mismas con las que el backend verifica a
// Neon.
const raices = path.join(os.tmpdir(), `cfbamx-raices-${process.pid}.pem`);
fs.writeFileSync(raices, tls.rootCertificates.join('\n'));
process.on('exit', () => { try { fs.unlinkSync(raices); } catch { /* ya no está */ } });

function entornoPg(c, database = c.database) {
  return {
    ...process.env,
    PGHOST: c.host,
    PGPORT: c.port,
    PGUSER: c.user,
    PGPASSWORD: c.password,
    PGDATABASE: database,
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: raices,
    PGAPPNAME: 'cfbamx-respaldo-local',
  };
}

function clientePg(c, database = c.database) {
  return new pg.Client({
    host: c.host,
    port: Number(c.port),
    user: c.user,
    password: c.password,
    database,
    ssl: { rejectUnauthorized: true, servername: c.host },
    application_name: 'cfbamx-respaldo-local',
  });
}

function correr(nombre, args, entorno) {
  const r = spawnSync(exe(nombre), args, { env: entorno, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) morir(`No se pudo correr ${nombre}: ${r.error.message}`);
  if (r.status !== 0) morir(`${nombre} terminó con código ${r.status}:\n${(r.stderr || '').trim()}`);
  return r.stdout;
}

// Cuenta todas las tablas de public. Los nombres salen del catálogo y van
// escapados; nada de aquí viene de afuera.
async function contarTablas(cliente) {
  const { rows } = await cliente.query(`
    SELECT c.relname AS tabla
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY 1`);
  const conteos = new Map();
  for (const { tabla } of rows) {
    const r = await cliente.query(`SELECT count(*)::bigint AS n FROM public.${cliente.escapeIdentifier(tabla)}`);
    conteos.set(tabla, Number(r.rows[0].n));
  }
  return conteos;
}

const miles = (n) => n.toLocaleString('es-MX');

// ── 1. Respaldar ───────────────────────────────────────────────────────────

const hoy = hoyEnMexico();
let destino = path.join(carpeta, `cfbamx-produccion-${hoy}.dump`);
if (fs.existsSync(destino)) {
  // No se pisa un respaldo que ya existe: el de hoy temprano puede ser el
  // bueno.
  const hora = new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' }).replace(':', '');
  destino = path.join(carpeta, `cfbamx-produccion-${hoy}-${hora}.dump`);
}
// Se escribe con otro nombre y se renombra solo si todo salió bien: un
// archivo a medias nunca debe parecer un respaldo.
const parcial = `${destino}.parcial`;

console.log(`Respaldando producción (${prod.host.replace(/^[^.]+/, 'ep-…')}) en ${destino}`);

const origen = clientePg(prod);
await origen.connect();
let conteos;
try {
  await origen.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const { rows: [{ version }] } = await origen.query("SELECT current_setting('server_version_num')::int AS version");
  const versionDump = Number((correr('pg_dump', ['--version'], process.env).match(/(\d+)\.\d+/) || [])[1]);
  if (!(versionDump >= Math.floor(version / 10000))) {
    morir(`pg_dump ${versionDump} es más viejo que el servidor (${Math.floor(version / 10000)}). pg_dump tiene que ser de la misma versión o más nuevo.`);
  }

  const { rows: [{ snapshot }] } = await origen.query('SELECT pg_export_snapshot() AS snapshot');
  conteos = await contarTablas(origen);

  correr('pg_dump', [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    `--snapshot=${snapshot}`,
    '--file', parcial,
  ], { ...entornoPg(prod), PGOPTIONS: '-c default_transaction_read_only=on' });
} finally {
  await origen.query('ROLLBACK').catch(() => {});
  await origen.end();
}

// ── 2. Verificar el archivo ────────────────────────────────────────────────

const indice = correr('pg_restore', ['--list', parcial], process.env);
const conDatos = new Set(
  [...indice.matchAll(/ TABLE DATA public (\S+) /g)].map((m) => m[1]),
);
const faltan = [...conteos.keys()].filter((t) => !conDatos.has(t));
if (faltan.length > 0) {
  morir(`El archivo no trae los datos de ${faltan.length} tabla(s): ${faltan.join(', ')}. Se deja como ${parcial} para revisarlo.`);
}
fs.renameSync(parcial, destino);

const total = [...conteos.values()].reduce((a, b) => a + b, 0);
const tamano = fs.statSync(destino).size;
console.log(`✓ ${path.basename(destino)} — ${(tamano / 1024 / 1024).toFixed(1)} MB, ${conteos.size} tablas, ${miles(total)} filas`);
for (const tabla of ['predictions', 'matches', 'teams', 'leagues', 'users', 'team_ledger_entries', 'club_ledger_entries']) {
  if (conteos.has(tabla)) console.log(`    ${tabla.padEnd(22)} ${miles(conteos.get(tabla))}`);
}

// ── 3. Probar que se restaura (--probar) ───────────────────────────────────

if (PROBAR) {
  const devUrl = env.DATABASE_URL;
  if (!devUrl) morir('Para --probar hace falta DATABASE_URL (la rama desarrollo-local).');
  const dev = conexion(devUrl, 'desarrollo');
  if (dev.hostOriginal === prodHost || dev.host === prod.host) {
    morir('DATABASE_URL es producción. La prueba de restauración crea y borra una base: nunca ahí.');
  }

  const base = `prueba_respaldo_${Date.now()}`;
  console.log(`\nProbando la restauración en la base temporal ${base} de la rama de desarrollo…`);

  const admin = clientePg(dev);
  await admin.connect();
  await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(base)}`);
  try {
    correr('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', base, destino], entornoPg(dev, base));

    const restaurada = clientePg(dev, base);
    await restaurada.connect();
    let conteosRestaurados;
    try {
      conteosRestaurados = await contarTablas(restaurada);
    } finally {
      await restaurada.end();
    }

    const distintas = [...conteos.entries()].filter(([t, n]) => conteosRestaurados.get(t) !== n);
    if (distintas.length > 0 || conteosRestaurados.size !== conteos.size) {
      for (const [t, n] of distintas) console.error(`    ${t}: producción ${n}, restaurada ${conteosRestaurados.get(t) ?? 'no existe'}`);
      morir('La restauración NO cuadra con producción. El archivo se queda, pero no está probado.');
    }
    console.log(`✓ Restaurado y comparado: las ${conteos.size} tablas tienen exactamente las mismas filas que producción.`);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(base)} WITH (FORCE)`).catch((e) => {
      console.error(`  ⚠ No se pudo borrar la base temporal ${base}: ${e.message}. Bórrala a mano en la rama de desarrollo.`);
    });
    await admin.end();
  }
}
