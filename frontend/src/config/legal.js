// ─────────────────────────────────────────────────────────────────────────
//  DATOS LEGALES DE QUIEN OPERA CFBAMX  —  LLENAR AQUÍ, EN UN SOLO LUGAR
// ─────────────────────────────────────────────────────────────────────────
//
// Antes estos datos estaban escritos a mano dentro de TermsOfService.jsx y
// PrivacyPolicy.jsx, como textos entre corchetes ("[Razón social...]") que se
// alcanzaban a ver en las páginas públicas. Ahora viven aquí y las dos
// páginas los leen de este archivo.
//
// PARA PUBLICAR LAS PÁGINAS LEGALES: llena los cuatro campos de abajo y
// listo. No hay nada más que tocar — ni rutas, ni el pie de página, ni
// variables de entorno en Vercel. En cuanto los cuatro tengan contenido,
// LEGAL_DATA_READY se vuelve true solo y los Términos de Servicio vuelven a
// aparecer en el sitio (ver App.jsx).
//
// No son secretos: son los datos que por ley tienen que ser públicos, así
// que van en el código y no en una variable de entorno.

export const LEGAL = {
  // Nombre de la persona física o moral que opera el Servicio, tal como
  // aparece en el RFC. Ej: "Juan Pérez García" o "Deportes Digitales S.A. de C.V."
  razonSocial: 'José Alfredo Reyes Silva',

  // Domicilio fiscal o de contacto. Es obligatorio en un Aviso de Privacidad
  // conforme a la LFPDPPP. Ej: "Av. Reforma 123, Col. Centro, CDMX, C.P. 06000"
  domicilio: 'Calle Río Hondo #8, Residencial Andalucía, Cancún, Quintana Roo, C.P. 77500',

  // Correo donde se reciben dudas y solicitudes de derechos ARCO.
  // Ej: "contacto@cfbamx.com"
  correoContacto: 'tacticalfootballmx@gmail.com',

  // Ciudad/estado cuyos tribunales resuelven controversias, para los
  // Términos de Servicio. Ej: "Ciudad de México"
  jurisdiccion: 'Cancún, Quintana Roo',
};

// true solo cuando los cuatro campos están llenos.
//
// Mientras sea false, los Términos de Servicio NO se publican: la ruta
// /terminos no existe y el enlace desaparece del pie de página. La razón es
// que unos Términos sin saber quién los emite ni ante qué tribunales se
// reclaman no obligan a nada, y publicarlos a medias es peor que no tenerlos.
export const LEGAL_DATA_READY = Object.values(LEGAL)
  .every((valor) => typeof valor === 'string' && valor.trim().length > 0);

// El Aviso de Privacidad SÍ se queda publicado aunque falten los datos, y es
// una decisión a propósito, no un descuido: el inicio de sesión con Google
// exige que el link al aviso funcione, y si /privacidad se cayera, la
// pantalla de consentimiento de Google apuntaría a un 404 y eso sí pone en
// riesgo el login de toda la app.
//
// Lo que hace mientras tanto es omitir las frases que dependen de los datos
// faltantes, en vez de enseñar corchetes vacíos. Sigue estando incompleto
// como aviso legal — llenar LEGAL de arriba es lo que lo completa.
//
// Si prefieres ocultarlo también hasta tener los datos, cambia este valor a
// LEGAL_DATA_READY y la ruta /privacidad desaparece igual que /terminos.
export const PRIVACY_PUBLISHED = true;
