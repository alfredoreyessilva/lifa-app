import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { storeOrdersRequired, storePaymentsRequired } from '../middleware/ownership.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { PARTIDO_COLUMNAS, PARTIDO_JOINS } from '../utils/partidoDelPanel.js';
import {
  ACCIONES_DE_LA_TIENDA,
  PARTIDO_PARA_PUESTO_SQL,
  PUESTO_ABIERTO_SQL,
  accionPermitida,
  estadoDelPedido,
  historiaDe,
  validarAjustes,
} from '../utils/compras.js';
import {
  cambiarCodigo,
  conexionDe,
  enlaceParaConectar,
  estadoParaConectar,
  leerEstadoParaConectar,
  reembolsar,
} from '../utils/mercadoPago.js';
import {
  cancelarYRegresar,
  comprasDisponibles,
  cuentaParaElPanel,
  datosDeVenta,
  permisoDelPedido,
  preguntarYRegistrar,
  productosDelPedido,
  renglonesDe,
} from '../utils/ventas.js';

// El panel de una tienda, en lo que toca a vender (README, "Compras en la
// vitrina" → "El panel de la tienda"): cómo vende —su Mercado Pago, su domicilio,
// sus entregas, su política de devoluciones y los partidos donde va a estar— y
// sus pedidos. Lo público y lo de quien compra está en routes/shop.js.
//
// Permisos (utils/orgRoles.js): `pedidos` para todo, que traen el dueño y el
// administrador; `cobros` para conectar o desconectar Mercado Pago, que trae solo
// el dueño y que deja fuera al admin de la plataforma.
//
// Apagadas las compras, lo que prepara una venta contesta 404, pero los pedidos
// que ya existen se siguen viendo y atendiendo: son ventas pagadas.

const router = express.Router();

const soloTiendas = (req, res, next) => {
  if (req.organization?.type !== 'store') return res.status(404).json({ error: 'Organización no encontrada' });
  return next();
};
const conTienda = [authRequired, storeOrdersRequired, soloTiendas];
const conCobros = [authRequired, storePaymentsRequired, soloTiendas];

const soloEncendidas = asyncHandler(async (req, res, next) => {
  if (!(await comprasDisponibles())) return res.status(404).json({ error: 'No encontrado' });
  return next();
});

async function cuantosPedidos(organizationId) {
  const fila = await db.prepare('SELECT COUNT(*)::int AS n FROM store_orders WHERE organization_id = ?').get(organizationId);
  return fila.n;
}

// ¿Puede esta persona conectar Mercado Pago? Un dueño de verdad: la misma regla
// que su guarda, dicha al panel para que esconda el botón.
async function puedeConectar(userId, organizationId) {
  const fila = await db.prepare(`
    SELECT 1 FROM organization_members
    WHERE organization_id = ? AND user_id = ? AND status = 'active' AND role = 'owner'
  `).get(organizationId, userId);
  return Boolean(fila);
}

// Los puestos de la tienda en partidos por venir, abiertos o ya cerrados para
// pedidos (faltan menos de 3 horas): el panel los enseña hasta que se juegan.
async function puestosDelPanel(organizationId) {
  return db.prepare(`
    SELECT s.id AS stand_id, s.note, ${PUESTO_ABIERTO_SQL} AS is_open, ${PARTIDO_COLUMNAS}
    FROM store_match_stands s
    JOIN matches m ON m.id = s.match_id
    ${PARTIDO_JOINS}
    WHERE s.organization_id = ? AND s.withdrawn_at IS NULL
      AND m.match_date IS NOT NULL
      AND m.match_date::timestamptz > NOW() - INTERVAL '12 hours'
    ORDER BY m.match_date::timestamptz ASC, m.id ASC
  `).all(organizationId);
}

// ── Cómo vende ───────────────────────────────────────────────────────────

router.get('/:organizationId', ...conTienda, asyncHandler(async (req, res) => {
  const org = req.organization;
  const pedidos = await cuantosPedidos(org.id);
  if (!(await comprasDisponibles())) return res.json({ enabled: false, orders_count: pedidos });

  const venta = await datosDeVenta(org);
  const [puestos, conectar, porPreparar] = await Promise.all([
    puestosDelPanel(org.id),
    puedeConectar(req.user.id, org.id),
    contarPorPreparar(org.id),
  ]);
  res.json({
    enabled: true,
    selling: venta.vende,
    missing: venta.falta,
    deliveries: venta.entregas,
    settings: venta.ajustes,
    account: cuentaParaElPanel(venta.cuenta),
    can_connect: conectar,
    stands: puestos,
    purchasable_count: venta.comprables.length,
    orders_count: pedidos,
    to_prepare: porPreparar,
  });
}));

router.put('/:organizationId/settings', ...conTienda, soloEncendidas, asyncHandler(async (req, res) => {
  const { ajustes, error } = validarAjustes(req.body);
  if (error) return res.status(400).json({ error });
  const guardado = await db.prepare(`
    INSERT INTO store_sales_settings (
      organization_id, address, pickup_enabled, pickup_hours, shipping_enabled, shipping_fee,
      free_shipping_from, match_enabled, return_policy, updated_by_user_id, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ON CONFLICT (organization_id) DO UPDATE SET
      address = EXCLUDED.address,
      pickup_enabled = EXCLUDED.pickup_enabled,
      pickup_hours = EXCLUDED.pickup_hours,
      shipping_enabled = EXCLUDED.shipping_enabled,
      shipping_fee = EXCLUDED.shipping_fee,
      free_shipping_from = EXCLUDED.free_shipping_from,
      match_enabled = EXCLUDED.match_enabled,
      return_policy = EXCLUDED.return_policy,
      updated_by_user_id = EXCLUDED.updated_by_user_id,
      updated_at = NOW()
    RETURNING organization_id
  `).get(
    req.organization.id, ajustes.address, ajustes.pickup_enabled, ajustes.pickup_hours,
    ajustes.shipping_enabled, ajustes.shipping_fee, ajustes.free_shipping_from,
    ajustes.match_enabled, ajustes.return_policy, req.user.id,
  );
  res.json({ ok: Boolean(guardado) });
}));

// ── Mercado Pago ─────────────────────────────────────────────────────────

// El enlace a la página de Mercado Pago donde la tienda autoriza a CFBAMX. El
// `state` firmado dice qué tienda y quién, y vale 10 minutos.
router.post('/:organizationId/mercadopago/link', ...conCobros, soloEncendidas, asyncHandler(async (req, res) => {
  const estado = estadoParaConectar({ organizationId: req.organization.id, userId: req.user.id });
  res.json({ url: enlaceParaConectar({ estado }) });
}));

// Mercado Pago regresa a /mercadopago/conectar con el código; esa página lo manda
// aquí con la sesión. El `state` tiene que ser de esta tienda y de esta misma
// persona. La conexión de antes se desconecta en la misma sentencia.
router.post('/:organizationId/mercadopago/connect', ...conCobros, soloEncendidas, asyncHandler(async (req, res) => {
  const estado = leerEstadoParaConectar(req.body?.state);
  if (!estado || estado.organizationId !== req.organization.id || estado.userId !== Number(req.user.id)) {
    return res.status(400).json({ error: 'Este enlace para conectar ya no vale. Vuelve a apretar «Conectar Mercado Pago».' });
  }
  const code = String(req.body?.code ?? '').trim();
  if (!code || code.length > 300) return res.status(400).json({ error: 'Mercado Pago no mandó el código de la conexión' });

  let conexion;
  try {
    conexion = conexionDe(await cambiarCodigo(code));
  } catch (e) {
    console.error(`[storeSales] Mercado Pago no aceptó la conexión de la tienda ${req.organization.id}:`, e.message);
    return res.status(502).json({ error: 'Mercado Pago no aceptó la conexión. Vuelve a intentarlo.' });
  }
  if (!conexion.provider_user_id) return res.status(502).json({ error: 'Mercado Pago no dijo de qué cuenta es la conexión' });

  await db.prepare(`
    WITH anterior AS (
      UPDATE store_payment_accounts
      SET disconnected_at = NOW(), disconnected_by_user_id = ?, access_token_enc = NULL, refresh_token_enc = NULL
      WHERE organization_id = ? AND disconnected_at IS NULL
      RETURNING id
    )
    INSERT INTO store_payment_accounts (
      organization_id, provider_user_id, access_token_enc, refresh_token_enc,
      public_key, live_mode, expires_at, connected_by_user_id
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    FROM (SELECT COUNT(*) FROM anterior) AS desconectadas
    RETURNING id
  `).get(
    req.user.id, req.organization.id,
    req.organization.id, conexion.provider_user_id, conexion.access_token_enc, conexion.refresh_token_enc,
    conexion.public_key, conexion.live_mode, conexion.expires_at, req.user.id,
  );
  res.json({ ok: true });
}));

// Desconectar borra las llaves y deja el renglón. Se puede siempre, también con
// las compras apagadas: quitarle a CFBAMX el permiso nunca debería esperar.
router.post('/:organizationId/mercadopago/disconnect', ...conCobros, asyncHandler(async (req, res) => {
  const r = await db.prepare(`
    UPDATE store_payment_accounts
    SET disconnected_at = NOW(), disconnected_by_user_id = ?, access_token_enc = NULL, refresh_token_enc = NULL
    WHERE organization_id = ? AND disconnected_at IS NULL
  `).run(req.user.id, req.organization.id);
  res.json({ ok: true, disconnected: r.changes > 0 });
}));

// ── Los partidos donde va a estar ────────────────────────────────────────

// Partidos públicos, que no son borrador, con fecha, en los próximos 30 días y a
// más de 3 horas de empezar; con su puesto, si ya lo tiene.
router.get('/:organizationId/matches', ...conTienda, soloEncendidas, asyncHandler(async (req, res) => {
  const matches = await db.prepare(`
    SELECT ${PARTIDO_COLUMNAS}, s.id AS stand_id, s.note AS stand_note
    FROM matches m
    ${PARTIDO_JOINS}
    LEFT JOIN store_match_stands s ON s.match_id = m.id AND s.organization_id = ? AND s.withdrawn_at IS NULL
    WHERE ${PARTIDO_PARA_PUESTO_SQL}
    ORDER BY m.match_date::timestamptz ASC, l.name ASC, m.id ASC
  `).all(req.organization.id);
  res.json({ matches });
}));

router.post('/:organizationId/stands', ...conTienda, soloEncendidas, asyncHandler(async (req, res) => {
  const matchId = Number(req.body?.match_id);
  if (!Number.isInteger(matchId)) return res.status(400).json({ error: 'Elige un partido' });
  const nota = String(req.body?.note ?? '').trim().replace(/\s+/g, ' ').slice(0, 140) || null;
  const puesto = await db.prepare(`
    INSERT INTO store_match_stands (organization_id, match_id, note, created_by_user_id)
    SELECT ?, m.id, ?, ?
    FROM matches m
    JOIN categories c ON c.id = m.category_id
    JOIN leagues l ON l.id = c.league_id
    WHERE m.id = ? AND ${PARTIDO_PARA_PUESTO_SQL}
    ON CONFLICT DO NOTHING
    RETURNING id
  `).get(req.organization.id, nota, req.user.id, matchId);
  if (puesto) return res.status(201).json({ stand_id: puesto.id });

  const yaEsta = await db.prepare(`
    SELECT 1 FROM store_match_stands WHERE organization_id = ? AND match_id = ? AND withdrawn_at IS NULL
  `).get(req.organization.id, matchId);
  if (yaEsta) return res.status(409).json({ error: 'Ya estás en ese partido' });
  return res.status(409).json({ error: 'Ese partido ya no recibe puestos: tiene que ser público, con fecha, en los próximos 30 días y a más de 3 horas de empezar' });
}));

router.post('/:organizationId/stands/:standId/withdraw', ...conTienda, asyncHandler(async (req, res) => {
  const r = await db.prepare(`
    UPDATE store_match_stands
    SET withdrawn_at = NOW(), withdrawn_by_user_id = ?
    WHERE id = ? AND organization_id = ? AND withdrawn_at IS NULL
  `).run(req.user.id, Number(req.params.standId), req.organization.id);
  if (!r.changes) return res.status(404).json({ error: 'Ese puesto no existe o ya lo quitaste' });
  res.json({ ok: true });
}));

// ── Los pedidos ──────────────────────────────────────────────────────────

const PEDIDO_DE_LA_LISTA = `
  SELECT o.id, o.token, o.created_at, o.buyer_name, o.delivery_method, o.total, o.currency, o.match_id, o.promised,
         (SELECT COALESCE(SUM(i.quantity), 0) FROM store_order_items i WHERE i.order_id = o.id)::int AS pieces,
         (SELECT i.product_name FROM store_order_items i WHERE i.order_id = o.id ORDER BY i.id LIMIT 1) AS first_item,
         EXISTS (SELECT 1 FROM store_order_stock_moves s WHERE s.order_id = o.id AND s.kind = 'short') AS stock_short,
         mt.match_date AS match_date_now
  FROM store_orders o
  LEFT JOIN matches mt ON mt.id = o.match_id
`;

async function contarPorPreparar(organizationId) {
  const pedidos = await db.prepare('SELECT id, created_at FROM store_orders WHERE organization_id = ?').all(organizationId);
  const porPedido = await renglonesDe(pedidos.map((p) => p.id));
  return pedidos.filter((p) => estadoDelPedido(p, porPedido.get(Number(p.id)) ?? []).clave === 'paid').length;
}

function pedidoDeLaLista(p, renglones) {
  const estado = estadoDelPedido(p, renglones);
  return {
    id: p.id,
    created_at: p.created_at,
    buyer_name: p.buyer_name,
    delivery_method: p.delivery_method,
    total: Number(p.total),
    currency: p.currency,
    pieces: p.pieces,
    first_item: p.first_item,
    stock_short: p.stock_short,
    match_date: p.match_date_now ?? p.promised?.delivery?.match?.match_date ?? null,
    status: estado.clave,
    extra_payments: estado.pagos_repetidos,
  };
}

router.get('/:organizationId/orders', ...conTienda, asyncHandler(async (req, res) => {
  const pedidos = await db.prepare(`${PEDIDO_DE_LA_LISTA} WHERE o.organization_id = ? ORDER BY o.created_at DESC LIMIT 500`)
    .all(req.organization.id);
  const porPedido = await renglonesDe(pedidos.map((p) => p.id));
  res.json({ orders: pedidos.map((p) => pedidoDeLaLista(p, porPedido.get(Number(p.id)) ?? [])) });
}));

async function pedidoDeLaTienda(req) {
  const pedido = await db.prepare('SELECT * FROM store_orders WHERE id = ? AND organization_id = ?')
    .get(Number(req.params.orderId), req.organization.id);
  return pedido || null;
}

// Un pedido con lo que la tienda necesita para entregarlo: quién compró y cómo
// encontrarlo, qué compró y qué pasó con sus existencias, la entrega, el pago y
// la historia, y qué puede hacer con él ahora.
async function detalleParaLaTienda(pedido) {
  const [porPedido, productos] = await Promise.all([renglonesDe([pedido.id]), productosDelPedido(pedido.id)]);
  const renglones = porPedido.get(Number(pedido.id)) ?? [];
  const estado = estadoDelPedido(pedido, renglones);
  let partidoHoy = null;
  if (pedido.match_id) {
    partidoHoy = await db.prepare('SELECT id, home_team, away_team, match_date, timezone, status FROM matches WHERE id = ?')
      .get(pedido.match_id);
  }
  const acciones = Object.keys(ACCIONES_DE_LA_TIENDA)
    .filter((accion) => accionPermitida(estado.clave, accion, pedido.delivery_method) === null);
  const aprobado = renglones.find((r) => r.kind === 'payment_approved');
  return {
    id: pedido.id,
    token: pedido.token,
    created_at: pedido.created_at,
    status: estado.clave,
    actions: acciones,
    buyer: { name: pedido.buyer_name, phone: pedido.buyer_phone, email: pedido.buyer_email },
    delivery: {
      method: pedido.delivery_method,
      address: pedido.shipping_address,
      promised: pedido.promised?.delivery ?? null,
      match_now: partidoHoy,
    },
    items: productos.map((p) => ({
      id: p.id,
      product_id: p.product_id,
      name: p.product_name,
      image_url: p.product_image_url,
      size: p.size_label,
      quantity: p.quantity,
      unit_price: Number(p.unit_price),
      line_total: Number(p.line_total),
      stock: p.stock_move,
      stock_back: p.stock_back,
    })),
    subtotal: Number(pedido.subtotal),
    shipping_fee: Number(pedido.shipping_fee),
    discount: Number(pedido.discount),
    total: Number(pedido.total),
    fee_amount: Number(pedido.fee_amount),
    payment: aprobado
      ? { mp_payment_id: aprobado.mp_payment_id, type: aprobado.data?.payment_type ?? null, approved_at: aprobado.data?.approved_at ?? aprobado.created_at }
      : null,
    extra_payments: renglones.filter((r) => r.kind === 'payment_extra').map((r) => r.mp_payment_id),
    history: historiaDe(renglones),
  };
}

router.get('/:organizationId/orders/:orderId', ...conTienda, asyncHandler(async (req, res) => {
  const pedido = await pedidoDeLaTienda(req);
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json(await detalleParaLaTienda(pedido));
}));

// Marcar listo, enviado o entregado, o cancelar con reembolso. Cada uno deja su
// renglón, una sola vez (índice único): dos clics no dejan dos.
router.post('/:organizationId/orders/:orderId/:action', ...conTienda, asyncHandler(async (req, res) => {
  const accion = req.params.action;
  if (!Object.prototype.hasOwnProperty.call(ACCIONES_DE_LA_TIENDA, accion)) {
    return res.status(404).json({ error: 'Esa acción no existe' });
  }
  const pedido = await pedidoDeLaTienda(req);
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
  const renglones = (await renglonesDe([pedido.id])).get(Number(pedido.id)) ?? [];
  const estado = estadoDelPedido(pedido, renglones);
  const motivo = accionPermitida(estado.clave, accion, pedido.delivery_method);
  if (motivo) return res.status(409).json({ error: motivo });

  if (accion === 'cancel') {
    // Primero el reembolso: si Mercado Pago no lo hace, el pedido no se cancela.
    const permiso = await permisoDelPedido(pedido);
    if (!permiso) {
      return res.status(409).json({ error: 'Para reembolsar desde aquí hace falta la cuenta de Mercado Pago con la que se cobró. Reembolsa desde tu Mercado Pago.' });
    }
    try {
      await reembolsar(permiso, estado.pago, `cfbamx-${pedido.id}-cancelar`);
    } catch (e) {
      console.error(`[storeSales] Mercado Pago no reembolsó el pedido ${pedido.id}:`, e.message);
      return res.status(502).json({ error: 'Mercado Pago no hizo el reembolso. Vuelve a intentarlo, o hazlo desde tu Mercado Pago.' });
    }
    const razon = String(req.body?.reason ?? '').trim().slice(0, 300);
    await cancelarYRegresar(pedido, req.user.id, razon);
    try {
      await preguntarYRegistrar(pedido, estado.pago);
    } catch (e) {
      // El aviso de Mercado Pago lo va a registrar igual.
      console.error(`[storeSales] No se pudo preguntar el reembolso del pedido ${pedido.id}:`, e.message);
    }
    return res.json(await detalleParaLaTienda(pedido));
  }

  let datos = null;
  if (accion === 'shipped') {
    const carrier = String(req.body?.carrier ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const tracking = String(req.body?.tracking ?? '').trim().slice(0, 80);
    if (!carrier) return res.status(400).json({ error: 'Escribe la paquetería' });
    datos = JSON.stringify({ carrier, tracking: tracking || null });
  }
  await db.prepare(`
    INSERT INTO store_order_events (order_id, kind, by_side, by_user_id, data)
    VALUES (?, ?, 'store', ?, ?::jsonb)
    ON CONFLICT DO NOTHING
  `).run(pedido.id, ACCIONES_DE_LA_TIENDA[accion], req.user.id, datos);
  res.json(await detalleParaLaTienda(pedido));
}));

export default router;
