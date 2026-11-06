// Lo que la página de una liga dice de ella (README, "La página de una liga").
// Funciones PURAS: reciben lo que manda la API y regresan lo que se pinta, para
// probarlas con node --test y sin navegador.

// El orden es el de quien viene a contactar a la liga: primero lo directo y lo
// oficial, y después las redes.
const CONTACTOS = [
  ['whatsapp', 'WhatsApp'],
  ['website_url', 'Sitio web'],
  ['facebook_url', 'Facebook'],
  ['instagram_url', 'Instagram'],
  ['twitter_url', 'X'],
  ['youtube_url', 'YouTube'],
  ['tiktok_url', 'TikTok'],
];

function esLinkWeb(valor) {
  try {
    const { protocol } = new URL(valor);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// wa.me necesita el número con su lada de país, y el formulario de la liga
// pide diez dígitos ("Ej. 5512345678"). Sin el 52, "55 5541 1027" se vuelve un
// número de Brasil. Un número incompleto no lleva a ninguna parte: mejor no
// enseñar el botón.
export function linkDeWhatsApp(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;
  if (/^https?:/i.test(texto)) return esLinkWeb(texto) ? texto : null;
  const digitos = texto.replace(/\D/g, '');
  if (digitos.length < 10) return null;
  return `https://wa.me/${digitos.length === 10 ? `52${digitos}` : digitos}`;
}

// Los links se validan al guardar, pero esto se pinta como `href` en una página
// pública: lo que no sea http(s) no sale, aunque haya llegado a la base.
export function contactosDeLiga(league) {
  return CONTACTOS
    .map(([key, label]) => {
      const valor = String(league?.[key] ?? '').trim();
      const href = key === 'whatsapp' ? linkDeWhatsApp(valor) : esLinkWeb(valor) ? valor : null;
      return { key, label, href };
    })
    .filter((contacto) => contacto.href);
}

// `state` es un texto: "NACIONAL", "YUCATÁN", o la lista de estados de una liga
// mexicana separada por comas. Doce estados no caben en un renglón: se dice
// cuántos son, y la lista completa queda en el `title`.
export function regionDeLiga(league) {
  const estados = String(league?.state ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return estados.length > 3 ? `${estados.length} estados` : estados.join(', ');
}

// Los torneos llegan del más antiguo al más reciente, y aquí lo primero que se
// viene a buscar es la temporada que corre: la más reciente va al frente, y las
// anteriores se quedan disponibles sin competir con ella. Dos torneos del mismo
// año son los dos la temporada vigente (un Apertura y un Clausura).
export function calendariosDeLiga(torneos) {
  const anio = (torneo) => Number(torneo.year) || 0;
  const orden = [...(torneos ?? [])].sort((a, b) => anio(b) - anio(a));
  const ultimo = orden.length ? anio(orden[0]) : 0;
  return {
    vigentes: orden.filter((torneo) => anio(torneo) === ultimo),
    anteriores: orden.filter((torneo) => anio(torneo) !== ultimo),
  };
}

// Por abecedario, con los acentos en su lugar: el ORDER BY de la API manda
// "ÁGUILAS" después de "ZORROS". Es el mismo orden del filtro "Equipo" del
// calendario.
export function equiposEnOrden(equipos) {
  return [...(equipos ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

// Cuántas letras tiene que acomodar el nombre en un renglón: el CSS mide la
// letra con esto. Un nombre largo se puede ir a dos renglones, pero su palabra
// más larga no se puede partir, así que ella pone el piso. Con el 3 de abajo,
// "LFA" y "PFL" no crecen más que los demás.
export function largoDelNombre(nombre) {
  const texto = String(nombre ?? '').trim();
  const palabraMasLarga = Math.max(0, ...texto.split(/\s+/).map((p) => p.length));
  return Math.max(3, palabraMasLarga, Math.ceil(texto.length / 2));
}

// De lado, la portada y el texto se reparten el ancho. Dos cosas no caben así:
// una portada más ancha que 2:1, que se haría tira (la de Facebook es 2.6:1), y
// un texto largo, que estira el encabezado y deja a la portada nadando en su
// columna. Esas van apiladas: la portada de orilla a orilla y el texto debajo.
export function encabezadoApilado({ proporcion, nombre, descripcion }) {
  return proporcion > 2
    || largoDelNombre(nombre) > 12
    || String(descripcion ?? '').length > 120;
}
