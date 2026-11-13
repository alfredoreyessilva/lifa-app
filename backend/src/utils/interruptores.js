import db from '../config/db.js';

// Los interruptores de la plataforma: lo que Alfredo prende y apaga desde el
// Panel Admin (README, "Premios por acertar" → "El interruptor"). Hasta el
// 2026-11-12 el de los premios iba a ser una variable de Render, como el push;
// lo pidió como un botón, para no tener que entrar a Render a prender algo que
// decide él.
//
// Toca la base, como utils/pushNotifier.js: es el único lugar que lee y escribe
// `platform_switches`, para que el botón y lo que obedece al botón no puedan
// decir cosas distintas.
//
// Cada cambio es una fila nueva —quién y cuándo— y el estado es la última. Sin
// ninguna fila, APAGADO: falla cerrado, igual que un interruptor desconocido.

export const INTERRUPTORES = {
  prediction_prizes: 'Premios por acertar',
};

export const esInterruptor = (clave) => Object.prototype.hasOwnProperty.call(INTERRUPTORES, clave);

// Se pregunta en cada página de partido y en cada bandeja: diez segundos de
// memoria le ahorran a la base una consulta por petición. Apretar el botón
// actualiza la memoria de este mismo proceso, así que en Render —una sola
// instancia— el cambio se ve al instante; con varias, a los diez segundos.
const VIGENCIA_MS = 10_000;
const memoria = new Map();

export async function interruptorEncendido(clave) {
  if (!esInterruptor(clave)) return false;
  const guardado = memoria.get(clave);
  if (guardado && Date.now() - guardado.at < VIGENCIA_MS) return guardado.encendido;
  const fila = await db.prepare(
    'SELECT enabled FROM platform_switches WHERE switch_key = ? ORDER BY id DESC LIMIT 1'
  ).get(clave);
  const encendido = fila?.enabled === true;
  memoria.set(clave, { encendido, at: Date.now() });
  return encendido;
}

// Prender o apagar. Solo agrega la fila si cambia el estado, en la misma
// sentencia que lo pregunta: apretar "Prender" con los premios ya prendidos (otra
// pestaña vieja, por ejemplo) no deja un segundo "lo prendió". Dos peticiones en
// el mismo instante sí podrían dejar dos filas iguales, y no importa: el estado
// es la última y las dos dicen lo mismo.
export async function cambiarInterruptor(clave, encendido, userId) {
  if (!esInterruptor(clave)) throw new Error(`No existe el interruptor ${clave}`);
  await db.prepare(`
    INSERT INTO platform_switches (switch_key, enabled, changed_by_user_id)
    SELECT ?::text, ?::boolean, ?::int
    WHERE (
      SELECT enabled FROM platform_switches WHERE switch_key = ?::text ORDER BY id DESC LIMIT 1
    ) IS DISTINCT FROM ?::boolean
  `).run(clave, encendido, userId, clave, encendido);
  memoria.set(clave, { encendido, at: Date.now() });
}

// Quién lo movió y cuándo, de lo más reciente a lo más viejo. Lo enseña el
// Panel Admin; la primera fila es el estado de ahora, leído sin la memoria.
export async function historialDeInterruptor(clave, limite = 10) {
  if (!esInterruptor(clave)) return [];
  return db.prepare(`
    SELECT s.enabled, s.changed_at, u.name AS changed_by_name
    FROM platform_switches s
    LEFT JOIN users u ON u.id = s.changed_by_user_id
    WHERE s.switch_key = ?
    ORDER BY s.id DESC
    LIMIT ?
  `).all(clave, limite);
}

// El de los premios por acertar (README, "Premios por acertar").
export const premiosEncendidos = () => interruptorEncendido('prediction_prizes');
