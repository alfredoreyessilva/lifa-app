// Cómo se dice en pantalla cuánto le queda a un link de invitación.
//
// El backend manda los SEGUNDOS que le quedan (`seconds_left`) y no una fecha:
// `invites.created_at` es TIMESTAMP sin zona y convertirlo aquí lo correría
// seis horas en una PC en México. Con segundos no hay zona que cruzar.
//
// Redondea a lo que una persona entiende de un vistazo: días mientras quede
// al menos uno, horas el último día, y "menos de una hora" al final. Un link
// recién generado dice "7 días" y no "6", por eso los días se redondean.
export function caducaEn(segundos) {
  if (segundos == null || Number.isNaN(Number(segundos))) return '';
  const s = Number(segundos);
  if (s <= 0) return 'ya caducó';
  if (s < 3600) return 'caduca en menos de una hora';
  if (s < 86400) {
    const horas = Math.ceil(s / 3600);
    return `caduca en ${horas} hora${horas === 1 ? '' : 's'}`;
  }
  const dias = Math.round(s / 86400);
  return `caduca en ${dias} día${dias === 1 ? '' : 's'}`;
}

// El link completo de una invitación, tal como se manda por WhatsApp.
export function linkDeInvitacion(token, origen = window.location.origin) {
  return `${origen}/invitaciones/${token}`;
}

// El link de WhatsApp con el mensaje ya armado. El link de la invitación va al
// final y en su propia línea: copiarlo y pegarlo a mano es donde llega
// cortado, y un link sin su código abre "Página no encontrada" (le pasó a una
// de las invitaciones de GRIZZLIES, 2026-09).
export function enlaceWhatsApp(mensaje, link) {
  return `https://wa.me/?text=${encodeURIComponent(`${mensaje}\n${link}`)}`;
}

// El mensaje de una invitación con rol. Lo mandan el modal recién generado y
// la lista de pendientes, y tiene que decir lo mismo en los dos lados.
export function mensajeDeInvitacion(organizacion, rol) {
  return `Te invito a ${organizacion} en CFBAMX como ${rol}. Abre este link para aceptar (sirve una sola vez):`;
}
