// Cuánto vive un link de invitación, y qué contestarle a quien abre uno que ya
// no sirve (README, "Dos links distintos: la entrega y la invitación con rol").
//
// Aplica a los dos tipos por igual —la entrega de un equipo y la invitación con
// rol—: lo que los distingue es cuántos puede haber vivos a la vez, no cuánto
// duran. Eso vive en routes/invites.js.
//
// Vive aquí y no en la ruta por la misma razón que `rolDeInvitacion`: un link
// repartido por WhatsApp hace una semana no se puede volver a probar a mano, y
// la regla que decide si todavía sirve tiene que poder probarse sin Postgres.

// Los links se mandan por WhatsApp y se usan en el momento. Quien no abrió el
// suyo en una semana pide otro, y un chat viejo reenviado deja de abrir puertas.
export const VIGENCIA_DIAS = 7;

// ¿Sigue dentro de su vigencia? Es un fragmento de SQL y no una comparación en
// JavaScript a propósito: `invites.created_at` es TIMESTAMP SIN zona, y `pg` lo
// lee como hora local del proceso de Node. En Render eso es UTC y cuadra; en
// una PC en México, el mismo link caducaría seis horas antes o después.
// `LOCALTIMESTAMP` es de la misma clase que la columna, así que la resta nunca
// cruza zonas.
//
// No incluye `used_at`: un link usado y uno caducado se contestan distinto, y
// cada ruta decide cuál de las dos preguntas le toca.
export function vigenteSql(alias = 'i') {
  return `${alias}.created_at > LOCALTIMESTAMP - INTERVAL '${VIGENCIA_DIAS} days'`;
}

// Cuánto le queda, en segundos, por lo mismo: la pantalla dice "caduca en 3
// días" sin que nadie tenga que convertir una fecha sin zona.
export function segundosRestantesSql(alias = 'i') {
  return `GREATEST(0, EXTRACT(EPOCH FROM (${alias}.created_at + INTERVAL '${VIGENCIA_DIAS} days') - LOCALTIMESTAMP))::int`;
}

// Qué contestarle a un link que ya no sirve, o null si todavía sirve.
//
// `invite` es la fila con una columna `vigente` ya calculada con `vigenteSql`.
// El orden importa: un link usado hace un mes también está caducado, pero lo
// que pasó con él es que alguien lo usó, y eso es lo que se dice.
//
// El caducado tiene su propio mensaje. Antes no existía la caducidad, y decir
// "ya fue utilizada" de un link que nadie usó es decir algo que no pasó: la
// persona se queda pensando que alguien entró con su link.
export function motivoInvalido(invite) {
  if (!invite) {
    return { status: 404, error: 'Esta invitación no existe o ya no es válida' };
  }
  if (invite.used_at) {
    return { status: 410, error: 'Esta invitación ya fue utilizada' };
  }
  if (!invite.vigente) {
    return {
      status: 410,
      error: `Esta invitación caducó: los links duran ${VIGENCIA_DIAS} días. Pide que te manden otro.`,
    };
  }
  return null;
}

// La nota de "para quién" de una invitación con rol: texto libre, corto, y
// vacío es lo mismo que no ponerla. Se recorta en vez de rechazarse: es una
// ayuda para quien invita, no un dato que valga la pena devolver con un 400.
export const NOTA_MAX = 80;

export function limpiarNota(nota) {
  if (typeof nota !== 'string') return null;
  const limpia = nota.trim().replace(/\s+/g, ' ').slice(0, NOTA_MAX);
  return limpia || null;
}
