// Registro del service worker y la descarga explícita de la pantalla.
//
// **Se registra al arrancar la app, no dentro del botón de notificaciones.**
// Hasta el 2026-09-20 el único `register()` vivía en `SubscribeButton.jsx`, así
// que un visor que nunca tocó "avisarme de este partido" simplemente no tenía
// service worker — y por lo tanto no tenía nada sin señal. Ahora se registra
// siempre; `SubscribeButton` sigue funcionando igual porque espera a
// `navigator.serviceWorker.ready`, que ahora se cumple antes.

export function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Después de `load` para no competir por ancho de banda con la primera
  // pintada: el service worker no sirve de nada en esa primera visita, sirve
  // en la siguiente.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Qué hace falta guardar para que ESTA pantalla abra sin señal: el documento y
// todo lo que descargó. Nada se escribe a mano —los nombres llevan hash y
// cambian en cada despliegue, así que una lista escrita a mano queda vieja en el
// primer deploy y nadie se entera hasta que un visor llega a la cancha.
//
// Se leen del REGISTRO DE RECURSOS del navegador y no del DOM, y eso es la
// corrección de un bug que dejó la pantalla en blanco sin señal.
//
// Mirando el DOM (`script[src]`) se ven el script y la hoja de estilo
// principales, pero **no los chunks cargados con `import()`** — y esta pantalla
// es justo uno de ellos: `App.jsx` carga cada página con `lazy()`. El visor
// preparaba el partido, se iba a la cancha, y ahí la app arrancaba y se moría
// pidiendo un chunk que nadie guardó.
//
// `performance.getEntriesByType('resource')` sí lista todo lo que de verdad se
// descargó, chunks incluidos. Se filtra a lo propio: las fuentes de Google y los
// scripts de terceros tienen su propio cache y no se pueden guardar desde aquí.
function urlsDeLaPantalla() {
  const urls = new Set(['/', window.location.href]);
  const propia = (src) => {
    try {
      return new URL(src, window.location.origin).origin === window.location.origin;
    } catch {
      return false;
    }
  };

  for (const entrada of performance.getEntriesByType('resource')) {
    // La API no se guarda aquí: los datos van a IndexedDB, donde la pantalla
    // sabe de cuándo son y puede decirlo (ver public/sw.js).
    if (!propia(entrada.name) || entrada.name.includes('/api/')) continue;
    if (!['script', 'link', 'css', 'img', 'other', 'fetch'].includes(entrada.initiatorType)) continue;
    urls.add(entrada.name);
  }

  // Y del DOM, por si algo se pintó antes de que `performance` lo registrara.
  for (const el of document.querySelectorAll('script[src], link[rel="stylesheet"], link[rel="manifest"]')) {
    const src = el.src || el.href;
    if (src && propia(src)) urls.add(src);
  }

  return [...urls];
}

// Le pide al service worker que guarde la pantalla. Devuelve `true` cuando él
// confirma; `false` si no hay service worker o si no contestó a tiempo.
//
// El resultado se usa para DECIR LA VERDAD en pantalla. Prometer captura sin
// señal y no poder cumplir es peor que no ofrecerla: el visor ya se fue a la
// cancha confiando, y ahí ya no hay forma de avisarle.
export function prepararPantalla(tiempoMax = 8000) {
  return new Promise((resolve) => {
    const sw = navigator.serviceWorker;
    if (!sw) return resolve(false);

    let listo = false;
    const alContestar = (event) => {
      if (event.data?.type !== 'precache-listo') return;
      listo = true;
      sw.removeEventListener('message', alContestar);
      resolve(true);
    };
    sw.addEventListener('message', alContestar);

    sw.ready.then((reg) => {
      const destino = reg.active || sw.controller;
      if (!destino) {
        sw.removeEventListener('message', alContestar);
        return resolve(false);
      }
      destino.postMessage({ type: 'precache', urls: urlsDeLaPantalla() });
    }).catch(() => {
      sw.removeEventListener('message', alContestar);
      resolve(false);
    });

    setTimeout(() => {
      if (listo) return;
      sw.removeEventListener('message', alContestar);
      resolve(false);
    }, tiempoMax);
  });
}
