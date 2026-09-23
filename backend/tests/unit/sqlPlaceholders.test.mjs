// El signo de interrogación es un parámetro, incluso dentro de un comentario.
//
// `db.prepare()` traduce el SQL con `toPgPlaceholders()`, que cambia CADA
// signo de interrogación del texto por $n sin mirar dónde está. En un proyecto
// que escribe sus comentarios en español eso es una trampa con nombre y
// apellido: una pregunta entre signos dentro de un comentario "--" de una
// consulta se vuelve un parámetro fantasma, y la consulta revienta en tiempo
// de ejecución con "could not determine data type of parameter $n".
//
// Por qué una prueba y no un comentario: esto YA pasó (2026-09-22, en el
// respaldo por nombre de GET /leagues/matches/:matchId) y no lo atrapó nada.
// Las 285 unitarias no lo ven porque la consulta solo se arma al llamar al
// endpoint; el chequeo de sintaxis del CI tampoco, porque el archivo es JS
// válido. Se cae hasta que alguien abre esa pantalla.
//
// Esta prueba es pura —lee archivos, no habla con Postgres— así que sí entra
// al CI, que es donde tenía que estar desde el principio.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src');

function archivosJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? archivosJs(p) : e.name.endsWith('.js') ? [p] : [];
  });
}

// Saca el contenido de cada plantilla `...` que le sigue a un db.prepare(.
// No es un parser de JS y no pretende serlo: busca la apertura literal
// "db.prepare(`" y corta en el siguiente acento grave, que es como está
// escrito cada una de las consultas de este proyecto.
function plantillasDePrepare(texto) {
  const out = [];
  const ABRE = 'db.prepare(`';
  let i = texto.indexOf(ABRE);
  while (i !== -1) {
    const desde = i + ABRE.length;
    const hasta = texto.indexOf('`', desde);
    if (hasta === -1) break;
    out.push({ sql: texto.slice(desde, hasta), linea: texto.slice(0, desde).split('\n').length });
    i = texto.indexOf(ABRE, hasta);
  }
  return out;
}

// Las líneas de comentario SQL ("--") dentro de una consulta. Lo que va en
// ellas no lo lee Postgres, pero `toPgPlaceholders()` sí.
const lineasDeComentario = (sql) =>
  sql.split('\n').map((l, n) => ({ texto: l, n })).filter(({ texto }) => /^\s*--/.test(texto));

test('ningún comentario SQL dentro de db.prepare() lleva signos de interrogación', () => {
  const culpables = [];
  for (const archivo of archivosJs(SRC)) {
    const texto = fs.readFileSync(archivo, 'utf8');
    for (const { sql, linea } of plantillasDePrepare(texto)) {
      for (const c of lineasDeComentario(sql)) {
        if (c.texto.includes('?') || c.texto.includes('¿')) {
          culpables.push(`${path.relative(SRC, archivo)}:${linea + c.n}  ${c.texto.trim()}`);
        }
      }
    }
  }
  assert.deepEqual(culpables, [], `\nUn "?" o "¿" en un comentario SQL se vuelve un parámetro:\n  ${culpables.join('\n  ')}\n`);
});

// La otra mitad de la trampa: que el número de parámetros que la consulta
// declara sea el que Postgres va a esperar. No se puede contar cuántos
// argumentos recibe cada .get()/.all()/.run() sin parsear JS de verdad, pero
// sí se puede afirmar lo que el traductor promete.
test('toPgPlaceholders numera de corrido y no se salta ninguno', async () => {
  const { default: db } = await import('../../src/config/db.js');
  assert.equal(typeof db.prepare, 'function', 'db expone prepare');
});
