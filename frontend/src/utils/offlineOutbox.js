// La cola de envío, viva: junta la regla pura (`offlineQueue.js`) con el
// almacén (`offlineDb.js`) y con la red, y avisa a quien esté mirando.
//
// Reintenta sola, sobrevive a recargar la página y a volver a entrar, y sube en
// cuanto vuelve la señal sin que nadie tenga que acordarse. Eso último es el
// punto entero: "lo que convierte esto en una pérdida no es que el dato viva en
// el teléfono, es que nadie se entere de que todavía vive ahí".

import { api } from '../api/client.js';
import { leerCola, escribirCola } from './offlineDb.js';
import {
  encolar, quitarDeCola, marcarFallo, pendientesListos, resumenDeCola,
} from './offlineQueue.js';

let cola = null;          // null = todavía no se lee de IndexedDB
let subiendo = false;
let reloj = null;
const mirones = new Set();

function avisar() {
  for (const fn of mirones) {
    try { fn(cola || []); } catch { /* un suscriptor roto no tumba la cola */ }
  }
}

async function persistir() {
  await escribirCola(cola || []);
  avisar();
  programarReintento();
}

export function suscribir(fn) {
  mirones.add(fn);
  if (cola) fn(cola);
  else cargar().then(() => fn(cola || []));
  return () => mirones.delete(fn);
}

export async function cargar() {
  if (cola) return cola;
  cola = await leerCola();
  avisar();
  programarReintento();
  return cola;
}

export function colaActual() {
  return cola || [];
}

// ── Quién sabe subir cada cosa ────────────────────────────────────────────
//
// Un despachador por tipo. Hoy solo hay uno; cuando entren las jugadas, entra
// otro aquí y todo lo demás —la persistencia, el backoff, el contador— ya
// funciona sin tocarse.
//
// El token se lee de localStorage y no del contexto de React a propósito: esto
// corre fuera de un componente (en el evento `online`, en un temporizador) y
// tiene que poder subir aunque nadie tenga abierta la pantalla que capturó.
function tokenActual() {
  try {
    return localStorage.getItem('lifa_token');
  } catch {
    return null;
  }
}

const DESPACHADORES = {
  attendance: async (p) => {
    const token = tokenActual();
    if (!token) throw new Error('La sesión se cerró: vuelve a entrar para subir esto');
    // El `PUT` recibe la lista COMPLETA y es idempotente, así que reintentarlo
    // es gratis — subir dos veces lo mismo deja exactamente el mismo estado.
    return api.saveMatchAttendance(p.matchId, { teamId: p.teamId, entries: p.entries }, token);
  },
};

// ── Meter algo a la cola ──────────────────────────────────────────────────
//
// Se guarda PRIMERO y se intenta después. Al revés —intentar y encolar solo si
// falla— pierde la captura cuando la petición se queda colgada y el visor cierra
// la pestaña: lo que estaba en vuelo no estaba en ningún lado.
export async function agregarPendiente(pendiente) {
  await cargar();
  cola = encolar(cola, pendiente);
  await persistir();
  subirPendientes();
  return cola;
}

// ── Subir ─────────────────────────────────────────────────────────────────

export async function subirPendientes() {
  if (subiendo) return;
  await cargar();
  if (!cola.length) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    programarReintento();
    return;
  }

  subiendo = true;
  try {
    for (const pendiente of pendientesListos(cola)) {
      const despachar = DESPACHADORES[pendiente.kind];
      if (!despachar) {
        // Un tipo sin despachador no se borra: se marca y se queda. Borrarlo
        // sería tirar una captura porque el código no la entendió.
        cola = marcarFallo(cola, pendiente.id, 'Esta versión de la app no sabe subir esto');
        continue;
      }
      try {
        await despachar(pendiente);
        cola = quitarDeCola(cola, pendiente.id);
      } catch (e) {
        cola = marcarFallo(cola, pendiente.id, e.message);
      }
    }
  } finally {
    subiendo = false;
    await persistir();
  }
}

// Un solo temporizador, y solo mientras haya algo que subir: un `setInterval`
// permanente despierta el teléfono cada tantos segundos toda la temporada.
function programarReintento() {
  if (reloj) { clearTimeout(reloj); reloj = null; }
  const { reintentando } = resumenDeCola(cola || []);
  if (reintentando === 0) return;
  reloj = setTimeout(() => { reloj = null; subirPendientes(); }, 10000);
}

// Forzar un intento de lo que ya se rindió: es lo único que la persona puede
// pedirle a una captura atorada, y por eso los intentos se ponen en cero.
export async function reintentarTodo() {
  await cargar();
  cola = (cola || []).map((p) => ({ ...p, intentos: 0, ultimoIntento: null }));
  await persistir();
  return subirPendientes();
}

// ── Enganches del navegador ───────────────────────────────────────────────

let enganchado = false;

export function escucharLaRed() {
  if (enganchado || typeof window === 'undefined') return;
  enganchado = true;

  window.addEventListener('online', () => { subirPendientes(); });

  // Volver a la pestaña es la otra señal de vida: el teléfono pudo haber
  // recuperado internet con la app en segundo plano y sin disparar `online`.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') subirPendientes();
  });

  // Salir con algo sin subir tiene que doler un poco. El navegador enseña su
  // propio texto —no se puede personalizar— pero el aviso aparece, que es lo
  // que hace falta.
  window.addEventListener('beforeunload', (e) => {
    if (!(cola || []).length) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // Y se intenta de inmediato al arrancar: quien vuelve del campo abre la app y
  // lo suyo sube en ese momento, no en el siguiente reintento. Sin esto, el
  // contador rojo se quedaba diez segundos en pantalla sin razón.
  cargar().then(() => subirPendientes());
}
