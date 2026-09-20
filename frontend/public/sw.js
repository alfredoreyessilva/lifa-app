// Service worker. Hace DOS cosas, y conviene no confundirlas:
//
//   1. Notificaciones push (lo de siempre, abajo).
//   2. Que la aplicación abra SIN SEÑAL, que es lo que pide "Capturar sin
//      señal" del README: muchas canchas no tienen internet y una captura que
//      exige conexión se vuelve papel en el segundo partido.
//
// Lo que este archivo NO hace, a propósito: **no cachea `/api/`**. Los datos
// del partido se bajan explícitamente con "Preparar partido" y viven en
// IndexedDB (ver `src/utils/offlineDb.js`), donde la pantalla sabe desde cuándo
// están ahí y puede decirlo. Una respuesta de API servida desde el cache HTTP
// se ve idéntica a una recién traída, y esa es exactamente la manera de que
// alguien pase lista contra un roster de hace tres semanas sin enterarse.

const VERSION = 'v1';
const CACHE = `cfbamx-${VERSION}`;

// Cuánto se espera a la red antes de tirar del cache. En una cancha con dos
// rayas de señal, una petición puede tardar un minuto en fallar sola; el visor
// no puede quedarse mirando una pantalla en blanco mientras tanto.
const ESPERA_RED = 3500;

self.addEventListener('install', () => {
  // Entra en cuanto se puede: si alguien ya está en la pantalla del pase de
  // lista, que el service worker nuevo la cubra sin pedirle que recargue.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Un despliegue nuevo cambia VERSION y esto tira lo viejo. Es lo que evita
    // el modo de falla clásico de un service worker: servir código de la
    // semana pasada y que nadie pueda reproducir el bug.
    const nombres = await caches.keys();
    await Promise.all(nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// "Preparar partido" manda aquí las URLs de la pantalla misma (el documento y
// sus scripts y hojas de estilo) para garantizar que estén guardadas ANTES de
// salir. Es la diferencia con un cache oportunista: esto se pide, así que se
// puede verificar en el estacionamiento y no descubrirse en la cancha.
self.addEventListener('message', (event) => {
  const { type, urls } = event.data || {};
  if (type !== 'precache' || !Array.isArray(urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Una por una y sin tumbar el conjunto: `addAll` es atómico y una sola URL
    // que falle (una fuente de Google, una extensión) dejaría al visor sin
    // nada. Aquí lo que se pueda guardar, se guarda.
    await Promise.all(urls.map((url) => cache.add(url).catch(() => {})));
    const clientes = await self.clients.matchAll();
    for (const c of clientes) c.postMessage({ type: 'precache-listo' });
  })());
});

// Busca en el cache IGNORANDO `Vary`, y eso no es un atajo: es la corrección de
// un bug que costó una pantalla en blanco.
//
// Vite emite sus scripts con `crossorigin`, así que el navegador los pide con
// cabecera `Origin`. El servidor contesta con `Vary: Origin`. Cuando este mismo
// service worker guardó el archivo (desde `cache.add`, sin `Origin`), guardó una
// variante distinta — y `caches.match` respeta `Vary`, así que **no encontraba
// el archivo que él mismo acababa de guardar**. Resultado sin señal: la
// navegación sí salía del cache, el JavaScript no, y la app abría en blanco.
//
// Aquí `Vary` no aporta nada: son archivos estáticos del mismo origen, con hash
// en el nombre, y su contenido no depende de quién los pida.
function buscarEnCache(request) {
  return caches.match(request, { ignoreVary: true });
}

function esDeLaApp(url) {
  return url.origin === self.location.origin;
}

// Los assets con hash en el nombre (`/assets/index-a1b2c3.js`) son inmutables:
// si el contenido cambia, cambia el nombre. Esos sí van cache-first, que es lo
// que hace que la app abra rápido y sin red.
function esAssetInmutable(url) {
  return url.pathname.startsWith('/assets/');
}

async function deLaRedConTiempo(request) {
  return new Promise((resolve, reject) => {
    const reloj = setTimeout(() => reject(new Error('timeout')), ESPERA_RED);
    fetch(request).then(
      (res) => { clearTimeout(reloj); resolve(res); },
      (err) => { clearTimeout(reloj); reject(err); },
    );
  });
}

async function guardar(request, response) {
  // Solo respuestas completas y propias. Una opaca (otro origen, sin CORS) se
  // guardaría como un éxito vacío y después se serviría como si fuera buena.
  if (!response || !response.ok || response.type === 'opaque') return response;
  const cache = await caches.open(CACHE);
  cache.put(request, response.clone()).catch(() => {});
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!esDeLaApp(url)) return;                  // fuentes, Cloudinary, Google: no es asunto nuestro
  if (url.pathname.startsWith('/api/')) return; // los datos van por IndexedDB, no por aquí

  if (esAssetInmutable(url)) {
    event.respondWith((async () => {
      const guardado = await buscarEnCache(request);
      if (guardado) return guardado;
      return guardar(request, await fetch(request));
    })());
    return;
  }

  // Todo lo demás —la navegación y los archivos sueltos— va a la red primero,
  // para que un despliegue nuevo gane siempre que haya señal, y cae al cache
  // cuando no la hay. Es el orden correcto: servir viejo es el plan B, no el A.
  event.respondWith((async () => {
    try {
      return await guardar(request, await deLaRedConTiempo(request));
    } catch {
      const guardado = await buscarEnCache(request);
      if (guardado) return guardado;
      // Una navegación a una ruta que nunca se visitó (React Router resuelve
      // las rutas del lado del cliente) se contesta con la última página que sí
      // se guardó: la app arranca y el router se encarga.
      if (request.mode === 'navigate') {
        const raiz = await buscarEnCache('/');
        if (raiz) return raiz;
      }
      throw new Error('sin red y sin copia local');
    }
  })());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data  = event.data.json();
  const title = data.title || 'Calendarios Football México';
  const options = {
    body:    data.body  || '',
    icon:    data.icon  || '/favicon.svg',
    badge:   '/favicon.svg',
    data:    { url: data.url || '/' },
    vibrate: [200, 100, 200],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si el sitio ya está abierto, enfocarlo
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Si no está abierto, abrir una ventana nueva
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
