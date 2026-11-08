// Pruebas de lo que calcula el panel de una tienda (utils/storePanel.js). Los
// productos tienen la forma de GET /products/organization/:id/manage —el precio
// llega como texto, porque es NUMERIC— y la tienda la de GET /organizations/:id.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_PRODUCT, PRODUCT_FILTERS, hasContact, inShowcase, isSoldOut, joinWithAnd, lacksPhoto, planOf,
  productPayload, productToForm, profileGaps, recentlyChanged, showcaseLead, sortProducts, stockOf,
  storeAttention, storeHref, storeTotals, validateProductForm, whatsappStatus,
} from '../../src/utils/storePanel.js';
import { countFilters } from '../../src/utils/adminPanel.js';

const AHORA = new Date('2026-11-08T20:00:00Z');

const producto = (id, extra = {}) => ({
  id, organization_id: 99, name: `Producto ${id}`, description: null, price: '850', currency: 'MXN', stock: 10,
  size_variant: 'S, M, L', image_url: `https://img.test/${id}.png`, is_active: true, show_on_platform: true,
  created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z', ...extra,
});

const tienda = (extra = {}) => ({
  id: 99, type: 'store', name: 'Deportes Cancún', logo_url: 'https://img.test/logo.png',
  description: 'Uniformes y equipo de fútbol americano', contact_phone: '998 123 4567', contact_email: null,
  website_url: null, facebook_url: null, instagram_url: null, youtube_url: null, tiktok_url: null,
  plan: 'free', plan_expires_at: null, whatsapp_display_number: null, is_public: true, is_verified: false, ...extra,
});

test('un producto inactivo no está en la vitrina aunque lo hayan marcado para salir', () => {
  assert.equal(inShowcase(producto(1)), true);
  assert.equal(inShowcase(producto(2, { show_on_platform: false })), false);
  assert.equal(inShowcase(producto(3, { is_active: false })), false);
});

test('agotado es tener cero piezas registradas; sin registrar no es agotado', () => {
  assert.equal(isSoldOut(producto(1, { stock: 0 })), true);
  assert.equal(isSoldOut(producto(2, { stock: -2 })), true, 'el backend acepta negativos y eso no es tener piezas');
  assert.equal(isSoldOut(producto(3, { stock: null })), false);
  assert.equal(isSoldOut(producto(4, { stock: 3 })), false);
  assert.equal(isSoldOut(producto(5, { stock: 0, is_active: false })), false, 'lo inactivo ya no se vende');

  assert.deepEqual(stockOf(producto(6, { stock: null })), { kind: 'untracked', text: 'Sin registrar' });
  assert.deepEqual(stockOf(producto(7, { stock: 0 })), { kind: 'out', text: 'Agotado' });
  assert.deepEqual(stockOf(producto(8, { stock: 1 })), { kind: 'in', text: '1 pieza' });
  assert.deepEqual(stockOf(producto(9, { stock: 1250 })), { kind: 'in', text: '1,250 piezas' });
});

test('sin foto solo cuenta lo que el público ve', () => {
  assert.equal(lacksPhoto(producto(1, { image_url: null })), true);
  assert.equal(lacksPhoto(producto(2, { image_url: '  ' })), true);
  assert.equal(lacksPhoto(producto(3, { image_url: null, show_on_platform: false })), false);
  assert.equal(lacksPhoto(producto(4, { image_url: null, is_active: false })), false);
});

test('las celdas del marcador cuentan cada producto donde cae, y las opcionales en cero no salen', () => {
  const lista = [
    producto(1),
    producto(2, { stock: 0 }),
    producto(3, { show_on_platform: false, stock: null }),
    producto(4, { is_active: false }),
    producto(5, { image_url: null }),
  ];
  const celdas = Object.fromEntries(countFilters(PRODUCT_FILTERS, lista).map((f) => [f.key, f.count]));
  assert.deepEqual(celdas, { todos: 5, vitrina: 3, ocultos: 1, inactivos: 1, agotados: 1, sin_foto: 1 });

  const limpia = countFilters(PRODUCT_FILTERS, [producto(1), producto(2)]).map((f) => f.key);
  assert.deepEqual(limpia, ['todos', 'vitrina', 'agotados'], 'Agotados se queda en cero; Ocultos, Inactivos y Sin foto no');
});

test('lo inactivo va al final sin mover el orden de lo demás', () => {
  const orden = sortProducts([
    producto(5), producto(4, { is_active: false }), producto(3), producto(2, { is_active: false }), producto(1),
  ]).map((p) => p.id);
  assert.deepEqual(orden, [5, 3, 1, 4, 2]);
});

test('las cifras del Resumen', () => {
  const totales = storeTotals([
    producto(1, { stock: 10 }),
    producto(2, { stock: 0, image_url: null }),
    producto(3, { stock: null, show_on_platform: false }),
    producto(4, { stock: 7, is_active: false }),
  ]);
  assert.deepEqual(totales, {
    total: 4, active: 3, inactive: 1, showcase: 2, hidden: 1, soldOut: 1, noPhoto: 1,
    attention: 1, // el agotado sin foto es UN producto por atender, no dos
    pieces: 10, tracked: 2, untracked: 1, // las 7 piezas de lo inactivo no cuentan
  });
  assert.equal(storeTotals([]).total, 0);
  assert.equal(storeTotals(null).pieces, 0);
});

test('lo último que se cambió va primero, y lo que nunca se editó cuenta desde su alta', () => {
  const orden = recentlyChanged([
    producto(1, { updated_at: '2026-11-01T10:00:00Z' }),
    producto(2, { updated_at: '2026-11-07T10:00:00Z' }),
    producto(3, { updated_at: null, created_at: '2026-11-05T10:00:00Z' }),
  ], 2).map((p) => p.id);
  assert.deepEqual(orden, [2, 3]);
});

test('el arranque de la vitrina son los primeros productos que el público ve, en su orden', () => {
  const lista = [producto(9, { is_active: false }), producto(8), producto(7, { show_on_platform: false }), producto(6), producto(5)];
  assert.deepEqual(showcaseLead(lista, 2).map((p) => p.id), [8, 6]);
});

test('el botón de WhatsApp necesita el plan Pro vigente y el número', () => {
  assert.equal(whatsappStatus(tienda(), AHORA).sub, 'Llega con el plan Pro');
  assert.equal(whatsappStatus(tienda({ plan: 'pro' }), AHORA).sub, 'Falta que CFBAMX cargue tu número');
  assert.equal(whatsappStatus(tienda({ plan: 'pro', whatsapp_display_number: '   ' }), AHORA).on, false);

  const encendido = whatsappStatus(tienda({ plan: 'pro', whatsapp_display_number: '+52 998 123 4567' }), AHORA);
  assert.deepEqual(encendido, { on: true, tone: 'on', label: 'Encendido', sub: '+52 998 123 4567' });

  const vencido = whatsappStatus(
    tienda({ plan: 'pro', plan_expires_at: '2026-11-01T06:00:00Z', whatsapp_display_number: '9981234567' }), AHORA,
  );
  assert.equal(vencido.on, false);
  assert.match(vencido.sub, /^Tu plan Pro venció el 1 nov/);
});

test('el plan dice hasta cuándo, y uno vencido ya es gratis', () => {
  assert.deepEqual(planOf(tienda(), AHORA), { label: 'Gratis', sub: null });
  assert.deepEqual(planOf(tienda({ plan: 'pro' }), AHORA), { label: 'Pro', sub: 'Sin vencimiento' });
  assert.match(planOf(tienda({ plan: 'pro', plan_expires_at: '2026-12-03T06:00:00Z' }), AHORA).sub, /^Hasta el 3 dic/);
  assert.equal(planOf(tienda({ plan: 'pro', plan_expires_at: '2026-11-01T06:00:00Z' }), AHORA).label, 'Gratis');
});

test('a un perfil le falta lo que la vitrina necesita para decir quién es y cómo encontrarla', () => {
  assert.deepEqual(profileGaps(tienda()), []);
  assert.deepEqual(
    profileGaps(tienda({ logo_url: null, description: '  ', contact_phone: null })),
    ['el logo', 'la descripción', 'una forma de contacto'],
  );
  assert.equal(hasContact(tienda({ contact_phone: null, instagram_url: 'https://instagram.com/x' })), true);
  assert.equal(
    hasContact(tienda({ contact_phone: null, plan: 'pro', whatsapp_display_number: '9981234567' })), true,
    'el botón de WhatsApp también es una forma de contacto',
  );
  assert.deepEqual(profileGaps(null), []);
  assert.equal(joinWithAnd(['el logo']), 'el logo');
  assert.equal(joinWithAnd(['el logo', 'la descripción', 'una forma de contacto']), 'el logo, la descripción y una forma de contacto');
});

test('lo que le toca a la tienda lleva a donde se arregla, ya filtrado', () => {
  const items = storeAttention(tienda({ logo_url: null }), [
    producto(1, { stock: 0 }),
    producto(2, { stock: 0, show_on_platform: false }),
    producto(3, { image_url: null }),
  ]);
  assert.deepEqual(items.map((i) => i.key), ['agotados', 'sin_foto', 'perfil']);
  assert.equal(items[0].text, '2 productos agotados');
  assert.equal(items[0].where, '1 sigue a la vista en tu vitrina');
  assert.equal(items[0].to, '/panel/tienda/99?seccion=productos&filtro=agotados');
  assert.equal(items[1].text, '1 producto de tu vitrina no tiene foto');
  assert.equal(items[2].text, 'A tu perfil le falta el logo');
  assert.equal(items[2].to, '/panel/tienda/99?seccion=perfil');

  const uno = storeAttention(tienda(), [producto(1, { stock: 0 })]);
  assert.equal(uno[0].text, '1 producto agotado');
  assert.equal(uno[0].where, 'Sigue a la vista en tu vitrina');
  const ninguno = storeAttention(tienda(), [producto(1, { stock: 0, show_on_platform: false })]);
  assert.equal(ninguno[0].where, null, 'si ninguno está en la vitrina, no se dice que sí');

  assert.deepEqual(storeAttention(tienda(), [producto(1)]), []);
});

test('la sección y el filtro viajan en la dirección', () => {
  assert.equal(storeHref(7), '/panel/tienda/7');
  assert.equal(storeHref(7, 'resumen'), '/panel/tienda/7');
  assert.equal(storeHref(7, 'perfil'), '/panel/tienda/7?seccion=perfil');
  assert.equal(storeHref(7, 'productos', 'sin_foto'), '/panel/tienda/7?seccion=productos&filtro=sin_foto');
});

test('el formulario de un producto: vacío es NULL, y el precio que llega como texto se respeta', () => {
  const form = productToForm(producto(1, { price: '850.50', stock: 0, description: null, show_on_platform: false }));
  assert.equal(form.price, '850.50');
  assert.equal(form.stock, 0, 'cero piezas no se vuelve vacío');
  assert.equal(form.description, '');
  assert.equal(form.show_on_platform, false);

  assert.deepEqual(productPayload({ ...EMPTY_PRODUCT, name: '  Jersey Hellfish  ', price: '850', stock: '0' }), {
    name: 'Jersey Hellfish', description: null, price: 850, currency: 'MXN', stock: 0,
    size_variant: null, image_url: null, show_on_platform: true,
  });
  assert.deepEqual(
    productPayload({ ...form, price: '', stock: '' }),
    { ...productPayload(form), price: null, stock: null },
  );
});

test('el formulario dice qué está mal antes de mandarlo', () => {
  assert.equal(validateProductForm({ ...EMPTY_PRODUCT }), 'Escribe el nombre del producto.');
  assert.equal(validateProductForm({ ...EMPTY_PRODUCT, name: '   ' }), 'Escribe el nombre del producto.');
  assert.equal(validateProductForm({ ...EMPTY_PRODUCT, name: 'Polo', price: '-1' }), 'El precio tiene que ser un número, de 0 en adelante.');
  assert.equal(validateProductForm({ ...EMPTY_PRODUCT, name: 'Polo', stock: '2.5' }), 'Las existencias son un número entero, de 0 en adelante.');
  assert.equal(validateProductForm({ ...EMPTY_PRODUCT, name: 'Polo', stock: -3 }), 'Las existencias son un número entero, de 0 en adelante.');
  assert.equal(validateProductForm({ ...EMPTY_PRODUCT, name: 'Polo', price: '0', stock: 0 }), null);
  assert.equal(validateProductForm(productToForm(producto(1))), null);
});
