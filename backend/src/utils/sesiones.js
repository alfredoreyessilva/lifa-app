// Cuándo deja de servir una sesión. El porqué está en el README, "Recuperar la
// contraseña" (2026-10-17): al cambiar la contraseña se cierran TODAS las
// sesiones abiertas, y como el token no se guarda en ningún lado, cerrarlas
// quiere decir rechazar el que se firmó antes del cambio.
//
// Vive en un archivo propio, puro y sin importar `db`, por la misma razón que
// `rosterVisibility.js`: decide quién sigue dentro de una cuenta, así que tiene
// que poder probarse sin Postgres — y eso es lo único que el CI alcanza.

// El segundo en que cambió la contraseña, o null si nunca ha cambiado.
//
// AL SEGUNDO y no al milisegundo: el `iat` del JWT viene en segundos, y el
// token que se entrega al cambiar la contraseña se firma en ese mismo segundo.
// Comparado al milisegundo, nacería revocado.
export function segundoDelCambio(passwordChangedAt) {
  if (passwordChangedAt == null) return null;
  return Math.floor(new Date(passwordChangedAt).getTime() / 1000);
}

// ¿Este token sigue sirviendo? Sin cambio de contraseña, sí: ninguna sesión de
// antes de este cambio se cae por él. Con cambio, solo el firmado en el mismo
// segundo o después.
//
// FALLA CERRADO: un token sin `iat` numérico, o una hora de cambio que no se
// pudo leer (NaN), no pasa. Del lado que se equivoque, que sea pidiéndole a
// alguien que vuelva a entrar, nunca dejando dentro a quien ya se sacó.
export function tokenSigueVigente(iat, segundo) {
  if (segundo === null || segundo === undefined) return true;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return false;
  return iat >= segundo;
}
