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