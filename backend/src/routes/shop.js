import express from 'express';
import { randomBytes } from 'node:crypto';
import db from '../config/db.js';
import { authRequired, optionalAuth } from '../middleware/auth.js';
import { orderLimiter, publicStatementLimiter, quoteLimiter } from '../middleware/rateLimit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { puedeVerOrganizacion } from '../utils/orgMembers.js';
import { comisionDeCompras } from '../utils/ajustesDePlataforma.js';
import {
  HORAS_PARA_PAGAR,
  SE_PUEDE_PAGAR,
  estadoDelPedido,
  historiaDe,
  revisarCarrito,
  totalesDe,
  validarComprador,
  validarDireccion,
} from '../utils/compras.js';
import {
  abrirCobro,
  cobroDe,
  firmaDelAvisoValida,
  modoDePrueba,
} from '../utils/mercadoPago.js';
import {
  comprasDisponibles,
  datosDeVenta,
  permisoDe,
  preguntarYRegistrar,
  productosDelPedido,
  renglonesDe,
} from '../utils/ventas.js';

// Comprar en la vitrina de una tienda (README, "Compras en la vitrina"): lo
// público —si una tienda vende, revisar un carrito, crear el pedido—, lo de
// quien compró —su pedido por el link, volver a pagar, guardarlo en su cuenta,
// sus pedidos— y el aviso de Mercado Pago. El panel de la tienda está en
// routes/storeSales.js.
//
// Apagadas las compras (Panel Admin → Compras), lo que crea algo contesta 404,
// pero un pedido que ya existe se sigue viendo y sus pagos se siguen
// registrando: es una venta pagada.

const router = express.Router();

const noEncontrado = (res) => res.status(404).json({ error: 'No encontrado' });

// Una tienda que se puede ver: pública, o tuya. Para vender además tiene que
// ser pública (utils/compras.js, faltaParaVender).
async function tiendaVisible(req, organizationId) {
  const id = Number(organizationId);
  if (!Number.isInteger(id)) return null;
  const org = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(id);
  if (!org || org.type !== 'store' || org.status !== 'active') return null;
  if (!(await puedeVerOrganizacion(req.user, org))) return null;
  return org;
}

// Lo que el comprador ve de cómo vende una tienda, antes de pagar: quién vende
// —nombre, domicilio, teléfono— y su política de devoluciones, como pide PROFECO,
// y sus entregas listas.
function ventaParaElComprador(org, venta) {
  const { ajustes, entregas, puestos } = venta;
  return {
    selling: true,
    seller: {
      name: org.name,
      address: ajustes.address,
      phone: org.contact_phone,
      email: org.contact_email || null,
    },
    return_policy: ajustes.return_policy,
    deliveries: {
      pickup: entregas.includes('pickup') ? { address: ajustes.address, hours: ajustes.pickup_hours } : null,
      shipping: entregas.includes('shipping')
        ? { fee: ajustes.shipping_fee, free_from: ajustes.free_shipping_from }
        : null,
      match: entregas.includes('match') ? puestos : [],
    },
  };
}

// ── Público ──────────────────────────────────────────────────────────────

// Prendidas en Panel Admin y con las variables de Mercado Pago puestas.
router.get('/status', asyncHandler(async (req, res) => {
  res.json({ enabled: await comprasDisponibles() });
}));

// Si una tienda vende, y cómo. A una que no vende no se le dice por qué: eso es
// de su panel.
router.get('/stores/:organizationId', optionalAuth, asyncHandler(async (req, res) => {
  if (!(await comprasDisponibles())) return noEncontrado(res);
  const org = await tiendaVisible(req, req.params.organizationId);
  if (!org) return res.status(404).json({ error: 'Tienda no encontrada' });
  const venta = await datosDeVenta(org);
  if (!venta.vende) return res.json({ selling: false });
  res.json(ventaParaElComprador(org, venta));
}));

// El carrito contra lo que la tienda vende hoy, sin escribir nada: precios,
// existencias y totales. La pantalla lo pide al abrir el carrito y antes de pagar.
router.post('/stores/:organizationId/quote', quoteLimiter, optionalAuth, asyncHandler(async (req, res) => {
  if (!(await comprasDisponibles())) return noEncontrado(res);
  const org = await tiendaVisible(req, req.params.organizationId);
  if (!org) return res.status(404).json({ error: 'Tienda no encontrada' });
  const venta = await datosDeVenta(org);
  if (!venta.vende) return res.status(409).json({ error: 'Esta tienda no está vendiendo por ahora' });

  const forma = venta.entregas.includes(req.body?.delivery_method) ? req.body.delivery_method : null;
  const { renglones, problemas } = revisarCarrito(req.body?.items, venta.productos);
  const porcentaje = await comisionDeCompras();
  res.json({
    lines: renglones.map(sinCentavos),
    problems: problemas,
    totals: totalesPublicos(totalesDe({ renglones, formaDeEntrega: forma, ajustes: venta.ajustes, porcentajeDeComision: porcentaje })),
  });
}));

const sinCentavos = ({ unit_cents, line_cents, ...r }) => r;
const totalesPublicos = (t) => ({ subtotal: t.subtotal, shipping_fee: t.shipping_fee, total: t.total });

// Crear el pedido y abrir Mercado Pago. El precio, las existencias y el envío los
// pone el servidor; lo único que se le cree al navegador es qué quiere y cuántas.
// Si el total que la persona vio ya no es el de hoy, 409 con el nuevo, para que
// lo vea antes de pagar.
router.post('/stores/:organizationId/orders', orderLimiter, optionalAuth, asyncHandler(async (req, res) => {
  if (!(await comprasDisponibles())) return noEncontrado(res);
  const org = await tiendaVisible(req, req.params.organizationId);
  if (!org) return res.status(404).json({ error: 'Tienda no encontrada' });
  const venta = await datosDeVenta(org);
  if (!venta.vende) return res.status(409).json({ error: 'Esta tienda no está vendiendo por ahora' });

  const { comprador, error: errorComprador } = validarComprador(req.body?.buyer);
  if (errorComprador) return res.status(400).json({ error: errorComprador });

  const entrega = req.body?.delivery || {};
  let direccion = null;
  let puesto = null;
  // Un partido que cerró mientras la persona llenaba sus datos se dice así, aunque
  // fuera el último puesto de la tienda y la entrega en un partido ya no exista.
  if (entrega.method === 'match' && venta.ajustes.match_enabled) {
    puesto = venta.puestos.find((p) => p.stand_id === Number(entrega.stand_id));
    if (!puesto) return res.status(400).json({ error: 'Ese partido ya no recibe pedidos. Elige otro.' });
  } else if (!venta.entregas.includes(entrega.method)) {
    return res.status(400).json({ error: 'Elige cómo quieres recibir tu compra' });
  }
  if (entrega.method === 'shipping') {
    const r = validarDireccion(entrega.address);
    if (r.error) return res.status(400).json({ error: r.error });
    direccion = r.direccion;
  }

  const { renglones, problemas } = revisarCarrito(req.body?.items, venta.productos);
  if (problemas.length || renglones.length === 0) {
    return res.status(409).json({ error: 'Algo de tu carrito cambió', problems: problemas });
  }
  const porcentaje = await comisionDeCompras();
  const totales = totalesDe({ renglones, formaDeEntrega: entrega.method, ajustes: venta.ajustes, porcentajeDeComision: porcentaje });
  const esperado = req.body?.expected_total;
  if (esperado !== undefined && esperado !== null && Math.round(Number(esperado) * 100) !== totales.total_cents) {
    return res.status(409).json({ error: 'El total cambió. Revísalo antes de pagar.', totals: totalesPublicos(totales) });
  }

  const permiso = await permisoDe(venta.cuenta);
  if (!permiso) return res.status(409).json({ error: 'Esta tienda no está vendiendo por ahora' });

  // Lo que se le prometió, copiado (README, "El pedido"): una promesa se guarda
  // como se hizo.
  const prometido = {
    store: {
      name: org.name,
      logo_url: org.logo_url,
      address: venta.ajustes.address,
      phone: org.contact_phone,
      email: org.contact_email || null,
      pickup_hours: venta.ajustes.pickup_hours,
      return_policy: venta.ajustes.return_policy,
    },
    delivery: entrega.method === 'pickup'
      ? { address: venta.ajustes.address, hours: venta.ajustes.pickup_hours }
      : entrega.method === 'match'
        ? {
            note: puesto.note,
            match: {
              id: puesto.match_id,
              home_team: puesto.home_team,
              away_team: puesto.away_team,
              match_date: puesto.match_date,
              timezone: puesto.timezone,
              league_name: puesto.league_name,
              venue_name: puesto.venue_name,
              venue_address: puesto.venue_address,
              venue_city: puesto.venue_city,
            },
          }
        : { fee: totales.shipping_fee, free_from: venta.ajustes.free_shipping_from },
  };
  const token = randomBytes(24).toString('base64url');
  const items = renglones.map((r) => ({
    product_id: r.product_id,
    product_name: r.product_name,
    product_image_url: r.product_image_url,
    size_label: r.size,
    unit_price: r.unit_price,
    quantity: r.quantity,
    line_total: r.line_total,
  }));

  // El pedido, sus productos y su primer renglón, en una sola sentencia (CLAUDE.md).
  const pedido = await db.prepare(`
    WITH pedido AS (
      INSERT INTO store_orders (
        token, organization_id, user_id, buyer_name, buyer_phone, buyer_email,
        delivery_method, shipping_address, match_id, stand_id, promised,
        subtotal, shipping_fee, total, currency, fee_percent, fee_amount, payment_account_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?::jsonb, ?, ?, ?, 'MXN', ?, ?, ?)
      RETURNING *
    ),
    productos AS (
      INSERT INTO store_order_items (order_id, product_id, product_name, product_image_url, size_label, unit_price, quantity, line_total)
      SELECT pedido.id, r.product_id, r.product_name, r.product_image_url, r.size_label, r.unit_price, r.quantity, r.line_total
      FROM pedido, jsonb_to_recordset(?::jsonb) AS r(
        product_id int, product_name text, product_image_url text, size_label text,
        unit_price numeric, quantity int, line_total numeric
      )
      RETURNING id
    ),
    primero AS (
      INSERT INTO store_order_events (order_id, kind, by_side, by_user_id)
      SELECT pedido.id, 'created', 'buyer', ? FROM pedido
      RETURNING id
    )
    SELECT pedido.*, (SELECT COUNT(*) FROM productos)::int AS productos FROM pedido
  `).get(
    token, org.id, req.user?.id ?? null, comprador.name, comprador.phone, comprador.email,
    entrega.method, direccion ? JSON.stringify(direccion) : null,
    puesto ? puesto.match_id : null, puesto ? puesto.stand_id : null, JSON.stringify(prometido),
    totales.subtotal, totales.shipping_fee, totales.total, porcentaje, totales.fee_amount, venta.cuenta.id,
    JSON.stringify(items),
    req.user?.id ?? null,
  );

  const abierto = await abrirMercadoPago(pedido, permiso);
  if (abierto.error) return res.status(502).json({ error: abierto.error, token: pedido.token, order_id: pedido.id });
  res.status(201).json({ token: pedido.token, order_id: pedido.id, init_point: abierto.init_point });
}));

// Abre un cobro de Mercado Pago a nombre de la tienda y deja su renglón. Si
// Mercado Pago no contesta, el pedido ya existe: su página trae "Pagar".
async function abrirMercadoPago(pedido, permiso) {
  const renglones = await db.prepare(`
    SELECT id, product_id, product_name, product_image_url, size_label, unit_price, quantity
    FROM store_order_items WHERE order_id = ? ORDER BY id
  `).all(pedido.id);
  try {
    const preferencia = await abrirCobro(permiso, cobroDe({ pedido, renglones }));
    await db.prepare(`
      INSERT INTO store_order_events (order_id, kind, by_side, data)
      VALUES (?, 'checkout_opened', 'buyer', ?::jsonb)
    `).run(pedido.id, JSON.stringify({ preference_id: preferencia.id ?? null }));
    const enlace = modoDePrueba() ? (preferencia.sandbox_init_point || preferencia.init_point) : preferencia.init_point;
    if (!enlace) return { error: 'Mercado Pago no devolvió a dónde pagar. Intenta de nuevo desde tu pedido.' };
    return { init_point: enlace };
  } catch (e) {
    console.error(`[shop] No se pudo abrir Mercado Pago para el pedido ${pedido.id}:`, e.message);
    return { error: 'No pudimos abrir Mercado Pago. Tu pedido quedó guardado: intenta pagar de nuevo desde su página.' };
  }
}

// ── Quien compró ─────────────────────────────────────────────────────────

async function pedidoDelLink(token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token ?? ''))) return null;
  return db.prepare('SELECT * FROM store_orders WHERE token = ?').get(token);
}

// De quién es en CFBAMX: de quien lo hizo con sesión, o de quien lo guardó en su
// cuenta abriendo el link (el renglón `claimed`). Se resuelve al leer.
function cuentaDelPedido(pedido, renglones) {
  if (pedido.user_id) return Number(pedido.user_id);
  const guardado = renglones.find((r) => r.kind === 'claimed');
  return guardado?.by_user_id ? Number(guardado.by_user_id) : null;
}

async function pedidoParaElComprador(pedido, req) {
  const [porPedido, productos, org] = await Promise.all([
    renglonesDe([pedido.id]),
    productosDelPedido(pedido.id),
    db.prepare('SELECT id, name, logo_url FROM organizations WHERE id = ?').get(pedido.organization_id),
  ]);
  const renglones = porPedido.get(Number(pedido.id)) ?? [];
  const cuenta = cuentaDelPedido(pedido, renglones);
  const estado = estadoDelPedido(pedido, renglones);

  // El partido, como está hoy: si cambió de fecha, el pedido lo sigue.
  let partidoHoy = null;
  if (pedido.match_id) {
    partidoHoy = await db.prepare(`
      SELECT m.id, m.home_team, m.away_team, m.match_date, m.timezone, m.status
      FROM matches m WHERE m.id = ?
    `).get(pedido.match_id);
  }

  // Un pedido se cobra con la cuenta de Mercado Pago con la que se hizo: ahí vive
  // su pago, y con ella se le pregunta. Si la tienda conectó otra, ese pedido ya
  // no se cobra, y su página le dice a quien compró por qué (`pay_blocked`) en vez
  // de ofrecerle un «Pagar» que siempre fallaría.
  let puedePagar = false;
  let sinCobro = null;
  if (SE_PUEDE_PAGAR.includes(estado.clave) && (await comprasDisponibles())) {
    const tienda = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(pedido.organization_id);
    const venta = tienda ? await datosDeVenta(tienda) : null;
    if (venta?.vende && venta.cuenta && Number(venta.cuenta.id) !== Number(pedido.payment_account_id)) {
      sinCobro = 'account_changed';
    } else {
      puedePagar = Boolean(venta?.vende);
    }
  }

  return {
    id: pedido.id,
    token: pedido.token,
    created_at: pedido.created_at,
    pay_until: new Date(new Date(pedido.created_at).getTime() + HORAS_PARA_PAGAR * 3_600_000).toISOString(),
    status: estado.clave,
    paid: estado.pagado,
    can_pay: puedePagar,
    pay_blocked: sinCobro,
    store: {
      id: pedido.organization_id,
      name: org?.name ?? pedido.promised?.store?.name,
      logo_url: org?.logo_url ?? pedido.promised?.store?.logo_url ?? null,
      address: pedido.promised?.store?.address ?? null,
      phone: pedido.promised?.store?.phone ?? null,
      email: pedido.promised?.store?.email ?? null,
    },
    buyer: { name: pedido.buyer_name, phone: pedido.buyer_phone, email: pedido.buyer_email },
    delivery: {
      method: pedido.delivery_method,
      address: pedido.shipping_address,
      promised: pedido.promised?.delivery ?? null,
      match_now: partidoHoy,
    },
    items: productos.map((p) => ({
      product_id: p.product_id,
      name: p.product_name,
      image_url: p.product_image_url,
      size: p.size_label,
      quantity: p.quantity,
      unit_price: Number(p.unit_price),
      line_total: Number(p.line_total),
    })),
    subtotal: Number(pedido.subtotal),
    shipping_fee: Number(pedido.shipping_fee),
    discount: Number(pedido.discount),
    total: Number(pedido.total),
    currency: pedido.currency,
    return_policy: pedido.promised?.store?.return_policy ?? null,
    history: historiaDe(renglones),
    in_account: cuenta !== null,
    mine: Boolean(req.user) && cuenta === Number(req.user.id),
  };
}

// El pedido, con su link. Si trae el `payment_id` con el que regresa Mercado
// Pago, primero se le pregunta ese pago: si Render estaba dormido (PD-03) y el
// aviso tarda, quien pagó igual ve su pago. Nunca se le cree a la dirección.
router.get('/orders/:token', publicStatementLimiter, optionalAuth, asyncHandler(async (req, res) => {
  const pedido = await pedidoDelLink(req.params.token);
  if (!pedido) return res.status(404).json({ error: 'No encontramos este pedido' });
  const pago = String(req.query.payment_id ?? req.query.collection_id ?? '').trim();
  if (/^\d{1,30}$/.test(pago)) {
    try {
      await preguntarYRegistrar(pedido, pago);
    } catch (e) {
      console.error(`[shop] No se pudo preguntar el pago ${pago} del pedido ${pedido.id}:`, e.message);
    }
  }
  res.json(await pedidoParaElComprador(pedido, req));
}));

// Abrir Mercado Pago otra vez: sin pagar, sin vencer, y con la tienda vendiendo.
router.post('/orders/:token/pay', orderLimiter, optionalAuth, asyncHandler(async (req, res) => {
  if (!(await comprasDisponibles())) return noEncontrado(res);
  const pedido = await pedidoDelLink(req.params.token);
  if (!pedido) return res.status(404).json({ error: 'No encontramos este pedido' });
  const vista = await pedidoParaElComprador(pedido, req);
  const cambioDeCuenta = 'Esta tienda cambió su forma de cobrar. Haz tu pedido de nuevo desde su vitrina.';
  if (vista.pay_blocked === 'account_changed') return res.status(409).json({ error: cambioDeCuenta });
  if (!vista.can_pay) return res.status(409).json({ error: 'Este pedido ya no se puede pagar' });
  const tienda = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(pedido.organization_id);
  const venta = await datosDeVenta(tienda);
  // El cobro se abre solo con la cuenta con la que se hizo el pedido: si la tienda
  // conectó otra, el aviso del pago se le preguntaría a la vieja, que ya no tiene
  // llaves, y el pago nunca quedaría registrado.
  const permiso = venta.cuenta && venta.cuenta.id === pedido.payment_account_id ? await permisoDe(venta.cuenta) : null;
  if (!permiso) return res.status(409).json({ error: cambioDeCuenta });
  const abierto = await abrirMercadoPago(pedido, permiso);
  if (abierto.error) return res.status(502).json({ error: abierto.error });
  res.json({ init_point: abierto.init_point });
}));

// Guardar en tu cuenta un pedido que hiciste sin sesión. El link es la
// credencial: quien lo tiene ya lo ve. No se juntan pedidos por correo (README,
// "El pedido").
router.post('/orders/:token/claim', authRequired, asyncHandler(async (req, res) => {
  const pedido = await pedidoDelLink(req.params.token);
  if (!pedido) return res.status(404).json({ error: 'No encontramos este pedido' });
  const renglones = (await renglonesDe([pedido.id])).get(Number(pedido.id)) ?? [];
  const cuenta = cuentaDelPedido(pedido, renglones);
  if (cuenta === Number(req.user.id)) return res.json({ ok: true });
  if (cuenta !== null) return res.status(409).json({ error: 'Este pedido ya está guardado en otra cuenta' });
  await db.prepare(`
    INSERT INTO store_order_events (order_id, kind, by_side, by_user_id)
    VALUES (?, 'claimed', 'buyer', ?)
    ON CONFLICT DO NOTHING
  `).run(pedido.id, req.user.id);
  res.json({ ok: true });
}));

// Mis pedidos: los que hiciste con sesión y los que guardaste.
router.get('/mine', authRequired, asyncHandler(async (req, res) => {
  const pedidos = await db.prepare(`
    SELECT o.id, o.token, o.created_at, o.total, o.currency, o.delivery_method, o.organization_id,
           org.name AS store_name, org.logo_url AS store_logo_url
    FROM store_orders o
    JOIN organizations org ON org.id = o.organization_id
    WHERE o.user_id = ?
       OR EXISTS (
         SELECT 1 FROM store_order_events e
         WHERE e.order_id = o.id AND e.kind = 'claimed' AND e.by_user_id = ?
       )
    ORDER BY o.created_at DESC
    LIMIT 100
  `).all(req.user.id, req.user.id);
  const ids = pedidos.map((p) => p.id);
  const porPedido = await renglonesDe(ids);
  const productos = ids.length
    ? await db.prepare(`
        SELECT order_id, product_name, product_image_url, size_label, quantity
        FROM store_order_items WHERE order_id = ANY(?::int[]) ORDER BY id
      `).all(ids)
    : [];
  res.json({
    orders: pedidos.map((p) => ({
      id: p.id,
      token: p.token,
      created_at: p.created_at,
      total: Number(p.total),
      currency: p.currency,
      delivery_method: p.delivery_method,
      store: { id: p.organization_id, name: p.store_name, logo_url: p.store_logo_url },
      status: estadoDelPedido(p, porPedido.get(Number(p.id)) ?? []).clave,
      items: productos
        .filter((i) => Number(i.order_id) === Number(p.id))
        .map((i) => ({ name: i.product_name, image_url: i.product_image_url, size: i.size_label, quantity: i.quantity })),
    })),
  });
}));

// ── El aviso de Mercado Pago ─────────────────────────────────────────────
//
// Mercado Pago avisa aquí cada cambio de un pago, a la dirección que se le dio al
// abrir el cobro (`?pedido=<id>`). Si el aviso trae firma y no cuadra, 401. Con
// o sin firma, no se le cree: se le pregunta el pago a Mercado Pago con el
// permiso de la tienda, y solo se registra si su referencia, su moneda y su monto
// son los del pedido (utils/ventas.js). Un 500 hace que Mercado Pago lo reintente.
router.post('/mercadopago/webhook', asyncHandler(async (req, res) => {
  const tipo = String(req.query.type ?? req.query.topic ?? req.body?.type ?? req.body?.topic ?? '');
  const dataId = req.query['data.id'] ?? req.query.data?.id ?? req.body?.data?.id
    ?? (tipo === 'payment' ? req.query.id : undefined);
  const firma = req.get('x-signature');
  if (firma && !firmaDelAvisoValida({ xSignature: firma, xRequestId: req.get('x-request-id'), dataId })) {
    return res.status(401).json({ error: 'Firma inválida' });
  }
  if (tipo !== 'payment' || !/^\d{1,30}$/.test(String(dataId ?? ''))) return res.sendStatus(200);

  const pedidoId = Number(req.query.pedido);
  if (!Number.isInteger(pedidoId)) return res.sendStatus(200);
  const pedido = await db.prepare('SELECT * FROM store_orders WHERE id = ?').get(pedidoId);
  if (!pedido) return res.sendStatus(200);
  try {
    await preguntarYRegistrar(pedido, String(dataId));
  } catch (e) {
    console.error(`[shop] El aviso del pago ${dataId} del pedido ${pedido.id} no se pudo registrar:`, e.message);
    return res.status(500).json({ error: 'No se pudo registrar' });
  }
  res.sendStatus(200);
}));

export default router;
