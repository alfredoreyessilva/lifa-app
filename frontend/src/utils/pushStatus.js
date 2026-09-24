import { api } from '../api/client.js';

// Si el push está encendido. El interruptor vive SOLO en el backend
// (PUSH_NOTIFICATIONS, ver README "El push, en pausa"); el frontend lo pregunta
// en vez de tener su propia variable, para que no se pueda encender el botón y
// olvidar el backend.
//
// Se pregunta una vez por carga de la app. Si la pregunta falla se responde
// "apagado" —no ofrecer el canal es el lado seguro— y se vuelve a preguntar la
// siguiente vez que alguien lo necesite.
let pendiente = null;

export function pushDisponible() {
  if (!pendiente) {
    pendiente = api.getPushStatus()
      .then((r) => Boolean(r?.enabled))
      .catch(() => {
        pendiente = null;
        return false;
      });
  }
  return pendiente;
}
