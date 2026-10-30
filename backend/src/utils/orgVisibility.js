// Qué se ve de una organización en público, y qué le pide la plataforma a un
// medio para transmitir. El porqué está en el README, "Organizaciones: publicar
// y verificar" (2026-10-29): publicar y verificar son dos botones del admin,
// como en las ligas, y hasta ese día `is_verified` hacía las dos cosas.
//
//   organizations.is_public     la plataforma la muestra: directorio y página
//   organizations.is_verified   se confirmó quién es: la insignia
//
// Puro y sin `db`, por lo mismo que `rosterVisibility.js`: es la regla que
// decide si una página abre para cualquiera, así que tiene que poder probarse
// sin Postgres. Quién administra la organización lo resuelve quien llama
// (`puedeVerOrganizacion`, en `orgMembers.js`).
//
// Las tres FALLAN CERRADO: una fila a medias, o un campo que llegó como
// `undefined`, responde "privada" y "no transmite".

// Los tipos que se publican con `organizations.is_public`. Liga y equipo quedan
// fuera a propósito: una liga se publica con `leagues.is_public`, y un equipo
// independiente decide solo si sale en el home con `teams.show_on_platform`.
// Para ellos esta columna no se lee.
export const TIPOS_PUBLICABLES = ['media', 'store', 'clinic', 'brand'];

// ¿Esta organización no existe para el público? Solo una de los tipos
// publicables puede estar privada: a una liga o a un equipo no se les oculta
// por aquí.
export function esPrivadaAlPublico(org) {
  return TIPOS_PUBLICABLES.includes(org?.type) && org?.is_public !== true;
}

// ¿Puede este medio sumarse a transmitir un partido, y salir en "También
// transmiten"? Publicado Y verificado: la verificación es el candado contra
// quien se registra con el nombre de un medio que no es, y un medio privado con
// su logo en la página de un partido sería un medio privado a la vista.
export function puedeTransmitir(org) {
  return org?.type === 'media' && org?.is_public === true && org?.is_verified === true;
}

// La misma regla, del lado de Postgres, para la lectura pública de quién
// transmite un partido. Se resuelve al leer (regla 4): ocultar un medio o
// quitarle la verificación lo saca de los partidos sin borrar sus filas de
// `match_broadcasts`, y vuelve en cuanto recupera las dos.
export function puedeTransmitirSql(aliasOrganizacion = 'o') {
  const o = aliasOrganizacion;
  return `(${o}.type = 'media' AND ${o}.is_public AND ${o}.is_verified)`;
}

// Lo que enseña la ficha pública de una organización además de logo, nombre y
// palomita: lo que ella misma llenó en su página para que la encuentren. Una
// sola lista para las dos lecturas que arman la ficha —el directorio del home y
// "También transmiten" de un partido—: dos listas a mano se separan, y la que
// se queda atrás deja la ficha a medias sin que nadie lo note.
export const CAMPOS_DE_FICHA = [
  'description', 'website_url', 'cover_url',
  'facebook_url', 'instagram_url', 'tiktok_url',
  'contact_email', 'contact_phone',
];

export function camposDeFichaSql(aliasOrganizacion = 'o') {
  return CAMPOS_DE_FICHA.map((campo) => `${aliasOrganizacion}.${campo}`).join(', ');
}
