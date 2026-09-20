// La capa local: IndexedDB. Aquí viven el partido preparado y la cola de lo
// capturado sin señal. El porqué está en el README, "Capturar sin señal".
//
// **IndexedDB y no `localStorage`**: localStorage es chico (unos 5 MB), es
// SÍNCRONO —bloquea la pantalla mientras escribe, justo cuando alguien está
// marcando cuarenta jugadores— y ya carga el token de sesión. No es dependencia
// nueva: es API del navegador.
//
// La REGLA de la cola (qué se fusiona, cuándo se reintenta) no está aquí: está
// en `offlineQueue.js`, que es puro y sí lo alcanza el CI. Esto es nada más el
// almacén.
//
// Todo falla suave: si IndexedDB no existe, está bloqueado (modo privado en
// algunos navegadores) o la transacción revienta, estas funciones devuelven
// vacío en vez de tronar. La pantalla tiene que seguir funcionando con señal
// aunque el modo sin señal no esté disponible — al revés sería cambiar un
// problema de un visor por una app rota para todos.

const DB = 'cfbamx-offline';
const VERSION = 1;

// Un almacén por cosa: lo preparado (que se puede volver a bajar) y lo
// capturado (que NO se puede volver a obtener de ningún lado). Separarlos es lo
// que permite limpiar lo primero sin tocar lo segundo.
const PARTIDOS = 'partidos';
const PENDIENTES = 'pendientes';

let promesa = null;

function abrir() {
  if (promesa) return promesa;
  promesa = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req;
    try {
      req = indexedDB.open(DB, VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PARTIDOS)) db.createObjectStore(PARTIDOS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PENDIENTES)) db.createObjectStore(PENDIENTES, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return promesa;
}

async function conTienda(nombre, modo, fn) {
  const db = await abrir();
  if (!db) return modo === 'readonly' ? null : false;
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(nombre, modo);
    } catch {
      return resolve(modo === 'readonly' ? null : false);
    }
    const tienda = tx.objectStore(nombre);
    let resultado = modo === 'readonly' ? null : true;
    try {
      const req = fn(tienda);
      if (req) req.onsuccess = () => { resultado = req.result; };
    } catch {
      return resolve(modo === 'readonly' ? null : false);
    }
    tx.oncomplete = () => resolve(resultado);
    tx.onerror = () => resolve(modo === 'readonly' ? null : false);
    tx.onabort = () => resolve(modo === 'readonly' ? null : false);
  });
}

// ── El partido preparado ──────────────────────────────────────────────────
//
// Lo que baja "Preparar partido": el partido, los rosters vigentes a esa fecha
// y el pase de lista como iba. Se guarda entero y de un golpe, con la fecha en
// que se bajó — la pantalla la enseña, porque un roster preparado hace tres
// semanas puede haber cambiado y quien va a la cancha tiene derecho a saberlo.

export function clavePartido(matchId, teamId) {
  return `${matchId}:${teamId}`;
}

export async function guardarPartido(matchId, teamId, datos) {
  return conTienda(PARTIDOS, 'readwrite', (t) => t.put({
    id: clavePartido(matchId, teamId),
    matchId: Number(matchId),
    teamId: Number(teamId),
    preparadoEn: Date.now(),
    datos,
  }));
}

export async function leerPartido(matchId, teamId) {
  return conTienda(PARTIDOS, 'readonly', (t) => t.get(clavePartido(matchId, teamId)));
}

export async function olvidarPartido(matchId, teamId) {
  return conTienda(PARTIDOS, 'readwrite', (t) => t.delete(clavePartido(matchId, teamId)));
}

// ── La cola ───────────────────────────────────────────────────────────────
//
// Se lee y se escribe ENTERA. Son unas cuantas capturas, no un historial, y
// leerla completa es lo que deja que `offlineQueue.js` —que es puro— decida
// sobre una lista en memoria sin saber que IndexedDB existe.

export async function leerCola() {
  const filas = await conTienda(PENDIENTES, 'readonly', (t) => t.getAll());
  return Array.isArray(filas) ? filas : [];
}

export async function escribirCola(cola) {
  const db = await abrir();
  if (!db) return false;
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(PENDIENTES, 'readwrite');
    } catch {
      return resolve(false);
    }
    const tienda = tx.objectStore(PENDIENTES);
    // Se reemplaza el contenido completo en UNA transacción: si algo falla a
    // medias, no queda media cola. Es la misma idea que el `PUT` del pase de
    // lista, que manda la lista entera en una sola sentencia.
    tienda.clear();
    for (const pendiente of cola) tienda.put(pendiente);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

// ¿Se puede guardar algo aquí? La pantalla lo pregunta antes de ofrecer
// "Preparar partido": prometer captura sin señal y no poder cumplir es peor que
// no ofrecerla, porque el visor ya se fue a la cancha confiando.
export async function hayAlmacenLocal() {
  return (await abrir()) !== null;
}
