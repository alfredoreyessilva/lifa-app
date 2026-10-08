// Las reglas puras del playbook del equipo (routes/playbook.js). Viven aparte
// porque la ruta importa `db`, y lo que importa `db` no se puede probar sin
// Postgres; esto sí lo alcanza el CI.

// El título de una imagen del playbook: texto libre y corto, y vacío es lo
// mismo que no ponerlo. Se recorta en vez de rechazarse, igual que la nota de
// una invitación (utils/invitaciones.js): es una etiqueta para encontrar la
// jugada, no un dato que amerite un 400. El campo del frontend ya corta en el
// mismo largo, así que esto solo actúa si alguien llama a la API directo.
//
// Vacío se vuelve NULL y no cadena vacía: una cadena vacía es justo lo que
// `COALESCE` no se salta (el logo de visitante, 2026-10-04).
export const TITULO_MAX = 120;

export function limpiarTitulo(titulo) {
  if (typeof titulo !== 'string') return null;
  const limpio = titulo.trim().replace(/\s+/g, ' ').slice(0, TITULO_MAX).trim();
  return limpio || null;
}
