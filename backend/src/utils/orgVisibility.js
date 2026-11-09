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
  'facebook_url', 'instagram_url', 'youtube_url', 'tiktok_url',
  'contact_email', 'contact_phone',
];

export function camposDeFichaSql(aliasOrganizacion = 'o') {
  return CAMPOS_DE_FICHA.map((campo) => `${aliasOrganizacion}.${campo}`).join(', ');
}

// ── La página de una organización (GET /organizations/:id) ────────────────
//
// Hasta el 2026-11-08 esa ruta respondía la fila entera, y cualquiera que
// abriera las herramientas del navegador en la vitrina de una tienda veía si
// pagaba el plan Pro y hasta cuándo (PD-46). Ahora la respuesta se arma con
// listas cerradas, como la tarjeta del jugador: una columna nueva en
// `organizations` no sale en ningún lado hasta que alguien la agregue aquí.

// Lo que ve cualquiera que pueda abrir la página: quién es y su ficha.
export const CAMPOS_DE_PAGINA = [
  'id', 'name', 'slug', 'type', 'country_id', 'country_name', 'logo_url', 'is_verified',
  ...CAMPOS_DE_FICHA,
];

// Lo que además ve quien la administra, y el admin de la plataforma: si la
// plataforma la muestra, su plan y el número que CFBAMX le cargó. El panel de
// la tienda los enseña en Perfil. `whatsapp_phone_number_id` no sale por aquí
// ni para ellos: es el id que Meta le da a ese número, solo lo lee el webhook
// del bot, y el admin lo ve en su propia lista (GET /admin/organizations).
export const CAMPOS_DE_QUIEN_ADMINISTRA = [
  'is_public', 'plan', 'plan_expires_at', 'whatsapp_display_number',
];

// ¿Tiene el plan Pro vigente? `plan='pro'` con la fecha vencida ya no es Pro, y
// sin fecha no vence. Es la misma pregunta que hace el webhook del bot antes de
// contestar (`routes/bot.js`): si fueran dos, la vitrina podría prometer un bot
// que no contesta. Una fecha que no se entiende cuenta como vencida.
export function planProVigente(org, ahora = new Date()) {
  if (org?.plan !== 'pro') return false;
  if (org.plan_expires_at === null || org.plan_expires_at === undefined) return true;
  return new Date(org.plan_expires_at).getTime() > ahora.getTime();
}

// El número al que abre "Consultar por WhatsApp" en la vitrina de una tienda, o
// null si la vitrina no lleva el botón: una tienda, con el plan Pro vigente y su
// número cargado. Lo decide el backend para que al público le llegue solo el
// número, y solo cuando el botón sale — nunca el plan.
export function whatsappDeVitrina(org, ahora = new Date()) {
  if (org?.type !== 'store' || !planProVigente(org, ahora)) return null;
  const numero = String(org.whatsapp_display_number ?? '').trim();
  return numero || null;
}

// La organización como la ve quien abre su página. `administra` lo resuelve
// quien llama, con la misma pregunta que decide si una privada existe
// (`administraOrganizacion`, en `orgMembers.js`).
export function organizacionParaQuienLaVe(org, { administra = false, ahora = new Date() } = {}) {
  const campos = administra ? [...CAMPOS_DE_PAGINA, ...CAMPOS_DE_QUIEN_ADMINISTRA] : CAMPOS_DE_PAGINA;
  const vista = {};
  for (const campo of campos) vista[campo] = org[campo] ?? null;
  vista.storefront_whatsapp = whatsappDeVitrina(org, ahora);
  return vista;
}
