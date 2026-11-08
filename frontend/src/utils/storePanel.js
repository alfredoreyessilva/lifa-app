// Lo que el panel de una tienda calcula con lo que le llega: en qué filtro cae
// cada producto, qué le toca atender a la tienda, qué le falta a su perfil y si
// su vitrina lleva el botón de WhatsApp. Funciones puras, porque es lo único de
// esta pantalla que se puede probar sin Postgres (tests/unit/storePanel.test.mjs).
// README, "El panel de una tienda".
//
// Dos cosas de la API que explican varias líneas de aquí:
//
// - `price` es NUMERIC y `pg` lo manda como TEXTO ("850.50"); `stock` es INTEGER
//   y llega como número. Por eso todo se lee con Number().
// - El inventario de gestión (`GET /products/organization/:id/manage`) trae
//   también lo inactivo, del más nuevo al más viejo: el mismo orden del catálogo
//   público, así que los primeros de la vitrina aquí son los primeros allá.

import { formatNumber, planStatus, pluralize } from './adminPanel.js';

const MX_DATE = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Mexico_City' };
const fecha = (value) => new Date(value).toLocaleDateString('es-MX', MX_DATE);

const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';

/* ---------- Un producto ---------- */

// `is_active` dice "esto existe y se vende"; `show_on_platform`, "y además quiero
// que salga en mi vitrina de CFBAMX" (README, "Inventario — dos listados, y por qué").
export const isActive = (p) => p.is_active !== false;
export const inShowcase = (p) => isActive(p) && p.show_on_platform !== false;

// Sin existencias registradas no es "agotado": hay tiendas que no llevan la
// cuenta. El backend acepta un número negativo, y eso tampoco es tener piezas.
export const isSoldOut = (p) => isActive(p) && hasValue(p.stock) && Number(p.stock) <= 0;

// Solo cuenta lo que el público ve: en la vitrina, un producto sin foto sale con
// un recuadro que dice "Sin foto". Fuera de ella, la foto no se enseña en ningún
// lado.
export const lacksPhoto = (p) => inShowcase(p) && !hasValue(p.image_url);

export const needsAttention = (p) => isSoldOut(p) || lacksPhoto(p);

export function stockOf(p) {
  if (!hasValue(p.stock)) return { kind: 'untracked', text: 'Sin registrar' };
  const n = Number(p.stock);
  if (n <= 0) return { kind: 'out', text: 'Agotado' };
  return { kind: 'in', text: pluralize(n, 'pieza') };
}

/* ---------- Filtros: las celdas del marcador de Productos ---------- */

export const PRODUCT_FILTERS = [
  { key: 'todos',     label: 'Productos',     test: () => true },
  { key: 'vitrina',   label: 'En tu vitrina', test: inShowcase },
  // Activos que la tienda sacó de su vitrina: siguen en su inventario.
  { key: 'ocultos',   label: 'Ocultos',       test: (p) => isActive(p) && !inShowcase(p), optional: true },
  { key: 'inactivos', label: 'Inactivos',     test: (p) => !isActive(p), optional: true },
  // Las dos que piden algo: por eso van en amarillo. "Agotados" se queda aunque
  // esté en cero, como "Sin verificar" en /admin: un cero ahí también dice algo.
  { key: 'agotados',  label: 'Agotados',      test: isSoldOut, attention: true },
  { key: 'sin_foto',  label: 'Sin foto',      test: lacksPhoto, attention: true, optional: true },
];

// Lo activo primero y lo inactivo al final; dentro, el orden del backend, del
// más nuevo al más viejo. Un producto que ya no se vende no debe empujar hacia
// abajo a los que sí.
export function sortProducts(products) {
  return [...(products || [])].sort((a, b) => Number(!isActive(a)) - Number(!isActive(b)));
}

/* ---------- Las cifras ---------- */

export function storeTotals(products) {
  const list = products || [];
  const active = list.filter(isActive);
  const tracked = active.filter((p) => hasValue(p.stock));
  return {
    total: list.length,
    active: active.length,
    inactive: list.length - active.length,
    showcase: list.filter(inShowcase).length,
    hidden: active.filter((p) => !inShowcase(p)).length,
    soldOut: list.filter(isSoldOut).length,
    noPhoto: list.filter(lacksPhoto).length,
    attention: list.filter(needsAttention).length,
    pieces: tracked.reduce((sum, p) => sum + Math.max(0, Number(p.stock) || 0), 0),
    tracked: tracked.length,
    untracked: active.length - tracked.length,
  };
}

// Lo que se cambió al último, para volver a él sin buscarlo. Un producto que
// nunca se editó tiene `updated_at` igual a su alta.
export function recentlyChanged(products, limit = 5) {
  const when = (p) => Date.parse(p.updated_at || p.created_at || 0) || 0;
  return [...(products || [])].sort((a, b) => when(b) - when(a)).slice(0, limit);
}

// Los primeros que ve quien abre la vitrina, en su orden.
export const showcaseLead = (products, limit = 4) => (products || []).filter(inShowcase).slice(0, limit);

/* ---------- La tienda ---------- */

// Lo que la vitrina enseña para encontrarla fuera de CFBAMX.
const CONTACT_FIELDS = [
  'contact_phone', 'contact_email', 'website_url', 'facebook_url', 'instagram_url', 'youtube_url', 'tiktok_url',
];

// El botón "Consultar por WhatsApp" de la vitrina: plan Pro vigente Y el número de
// la tienda cargado. Es la misma regla que el webhook del bot (README, "El bot"),
// y la página pública la lee de aquí. El número lo carga CFBAMX desde /admin.
export function whatsappStatus(org, now = new Date()) {
  const { active, expires } = planStatus(org || {}, now);
  const number = String(org?.whatsapp_display_number ?? '').trim();
  if (active && number) return { on: true, tone: 'on', label: 'Encendido', sub: number };
  if (active) return { on: false, tone: 'off', label: 'Apagado', sub: 'Falta que CFBAMX cargue tu número' };
  if (org?.plan === 'pro' && expires) {
    return { on: false, tone: 'off', label: 'Apagado', sub: `Tu plan Pro venció el ${fecha(expires)}` };
  }
  return { on: false, tone: 'off', label: 'Apagado', sub: 'Llega con el plan Pro' };
}

export function planOf(org, now = new Date()) {
  const { active, expires } = planStatus(org || {}, now);
  if (active) return { label: 'Pro', sub: expires ? `Hasta el ${fecha(expires)}` : 'Sin vencimiento' };
  if (org?.plan === 'pro' && expires) return { label: 'Gratis', sub: `El Pro venció el ${fecha(expires)}` };
  return { label: 'Gratis', sub: null };
}

export const hasContact = (org) => Boolean(org) && (
  CONTACT_FIELDS.some((key) => hasValue(org[key])) || whatsappStatus(org).on
);

// Lo que le falta al perfil para que la vitrina diga quién es y cómo encontrarla.
// La portada no está: una vitrina sin portada se ve completa.
export function profileGaps(org) {
  if (!org) return [];
  const gaps = [];
  if (!hasValue(org.logo_url)) gaps.push('el logo');
  if (!hasValue(org.description)) gaps.push('la descripción');
  if (!hasContact(org)) gaps.push('una forma de contacto');
  return gaps;
}

// "el logo, la descripción y una forma de contacto".
export function joinWithAnd(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/* ---------- Dónde vive cada cosa ---------- */

// La sección va en `?seccion=` y el filtro en `?filtro=`, como en /admin y en el
// panel de una liga: una ruta por sección desmontaría la página en cada clic.
export function storeHref(id, section = 'resumen', filter = null) {
  const params = new URLSearchParams();
  if (section && section !== 'resumen') params.set('seccion', section);
  if (filter) params.set('filtro', filter);
  const query = params.toString();
  return `/panel/tienda/${id}${query ? `?${query}` : ''}`;
}

/* ---------- Lo que le toca a la tienda ---------- */

// Lo que sale arriba del Resumen. Cada renglón lleva a donde se arregla, ya
// filtrado. No decide nada por la tienda: cuenta lo que su vitrina enseña.
export function storeAttention(org, products) {
  const items = [];
  const id = org?.id;
  const list = products || [];

  const soldOut = list.filter(isSoldOut);
  if (soldOut.length > 0) {
    const n = soldOut.length;
    const visible = soldOut.filter(inShowcase).length;
    let where = null;
    if (visible === n) where = n === 1 ? 'Sigue a la vista en tu vitrina' : 'Siguen a la vista en tu vitrina';
    else if (visible > 0) where = `${formatNumber(visible)} ${visible === 1 ? 'sigue' : 'siguen'} a la vista en tu vitrina`;
    items.push({
      key: 'agotados',
      text: n === 1 ? '1 producto agotado' : `${formatNumber(n)} productos agotados`,
      where,
      to: storeHref(id, 'productos', 'agotados'),
    });
  }

  const noPhoto = list.filter(lacksPhoto).length;
  if (noPhoto > 0) {
    items.push({
      key: 'sin_foto',
      text: noPhoto === 1 ? '1 producto de tu vitrina no tiene foto' : `${formatNumber(noPhoto)} productos de tu vitrina no tienen foto`,
      where: 'Ahí sale un recuadro que dice «Sin foto»',
      to: storeHref(id, 'productos', 'sin_foto'),
    });
  }

  const gaps = profileGaps(org);
  if (gaps.length > 0) {
    items.push({
      key: 'perfil',
      text: `A tu perfil le falta ${joinWithAnd(gaps)}`,
      where: 'Es lo primero que ve quien abre tu tienda',
      to: storeHref(id, 'perfil'),
    });
  }

  return items;
}

/* ---------- El formulario de un producto ---------- */

export const EMPTY_PRODUCT = {
  name: '',
  description: '',
  price: '',
  currency: 'MXN',
  stock: '',
  size_variant: '',
  image_url: '',
  show_on_platform: true,
};

export function productToForm(p) {
  return {
    name: p.name || '',
    description: p.description || '',
    price: p.price ?? '',
    currency: p.currency || 'MXN',
    stock: p.stock ?? '',
    size_variant: p.size_variant || '',
    image_url: p.image_url || '',
    show_on_platform: p.show_on_platform !== false,
  };
}

const text = (value) => String(value ?? '').trim();

// El backend vuelve a validar (`validateProductFields`); esto es para decirlo
// antes de mandar, con palabras de la pantalla.
export function validateProductForm(form) {
  if (!text(form.name)) return 'Escribe el nombre del producto.';
  const price = text(form.price);
  if (price && (Number.isNaN(Number(price)) || Number(price) < 0)) {
    return 'El precio tiene que ser un número, de 0 en adelante.';
  }
  const stock = text(form.stock);
  if (stock && (!Number.isInteger(Number(stock)) || Number(stock) < 0)) {
    return 'Las existencias son un número entero, de 0 en adelante.';
  }
  return null;
}

// Lo que viaja en POST y PUT. Vacío es NULL: "sin precio" sale en la vitrina como
// "Precio a consultar" y "sin existencias" como "Sin registrar", que no es cero.
export function productPayload(form) {
  const price = text(form.price);
  const stock = text(form.stock);
  return {
    name: text(form.name),
    description: text(form.description) || null,
    price: price === '' ? null : Number(price),
    currency: text(form.currency) || 'MXN',
    stock: stock === '' ? null : Number(stock),
    size_variant: text(form.size_variant) || null,
    image_url: text(form.image_url) || null,
    show_on_platform: form.show_on_platform !== false,
  };
}
