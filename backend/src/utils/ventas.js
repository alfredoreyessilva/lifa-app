import db from '../config/db.js';
import {
  cuentaVigente,
  entregasDeLaTienda,
  esComprable,
  estadoDelPedido,
  faltaParaVender,
  PUESTO_ABIERTO_SQL,
} from './compras.js';
import { comprasEncendidas } from './interruptores.js';
import { PARTIDO_COLUMNAS, PARTIDO_JOINS } from './partidoDelPanel.js';
import {
  conexionDe,
  consultarPago,
  descifrar,
  mercadoPagoConfigurado,
  pagoCuadra,
  renglonDePago,
  renovarPermiso,
} from './mercadoPago.js';

// Las ventas de una tienda, con la base (README, "Compras en la vitrina"). Lo
// comparten routes/shop.js —quien compra y el aviso de Mercado Pago— y
// routes/storeSales.js —el panel de la tienda—, para que los dos lados digan lo
// mismo de una tienda y de un pedido. Lo que no toca la base vive en
// utils/compras.js y utils/mercadoPago.js.
//
// Ningún SQL de aquí lleva signos de interrogación en sus comentarios ni usa el
// operador de JSONB que se escribe con uno: cada uno se volvería un parámetro
// (CLAUDE.md, y la prueba sqlPlaceholders). Para saber si una talla existe se usa
// `->>` con COALESCE.

// Las compras existen con el botón prendido Y las variables de Mercado Pago.
export async function comprasDisponibles() {
  return mercadoPagoConfigurado() && (await comprasEncendidas());
}

// ── La tienda ────────────────────────────────────────────────────────────

const AJUSTES_VACIOS = {
  address: null, pickup_enabled: false, pickup_hours: null,
  shipping_enabled: false, shipping_fee: null, free_shipping_from: null,
  match_enabled: false, return_policy: null,
};

export async function ajustesDe(organizationId) {
  const fila = await db.prepare(`
    SELECT address, pickup_enabled, pickup_hours, shipping_enabled, shipping_fee,
           free_shipping_from, match_enabled, return_policy, updated_at
    FROM store_sales_settings WHERE organization_id = ?
  `).get(organizationId);
  if (!fila) return { ...AJUSTES_VACIOS };
  return {
    ...fila,
    shipping_fee: fila.shipping_fee === null ? null : Number(fila.shipping_fee),
    free_shipping_from: fila.free_shipping_from === null ? null : Number(fila.free_shipping_from),
  };
}

// La conexión con Mercado Pago que está puesta, con sus llaves cifradas. Las
// llaves nunca salen de este archivo hacia una respuesta: ver cuentaParaElPanel.
export async function cuentaDe(organizationId) {
  return db.prepare(`
    SELECT a.*, u.name AS connected_by_name
    FROM store_payment_accounts a
    LEFT JOIN users u ON u.id = a.connected_by_user_id
    WHERE a.organization_id = ? AND a.disconnected_at IS NULL
  `).get(organizationId);
}

export function cuentaParaElPanel(cuenta, ahora = new Date()) {
  if (!cuenta) return null;
  return {
    provider_user_id: cuenta.provider_user_id,
    connected_at: cuenta.connected_at,
    connected_by_name: cuenta.connected_by_name ?? null,
    expires_at: cuenta.expires_at,
    live_mode: cuenta.live_mode,
    vigente: cuentaVigente(cuenta, ahora),
  };
}

// El permiso para cobrar a nombre de la tienda, descifrado y vigente. Si vence en
// menos de una semana se renueva antes de usarse: Mercado Pago entrega otro
// permiso y otra llave para renovar, y se guardan los dos. null si no hay forma
// de cobrar: la tienda deja de vender y su panel le pide reconectar.
const RENOVAR_ANTES_MS = 7 * 24 * 3_600_000;

export async function permisoDe(cuenta) {
  if (!cuenta || cuenta.disconnected_at || !cuenta.access_token_enc) return null;
  const vence = cuenta.expires_at ? new Date(cuenta.expires_at).getTime() : null;
  if (vence === null || vence - Date.now() > RENOVAR_ANTES_MS) {
    return descifrar(cuenta.access_token_enc);
  }
  if (!cuenta.refresh_token_enc) return vence > Date.now() ? descifrar(cuenta.access_token_enc) : null;
  try {
    const nueva = conexionDe(await renovarPermiso(descifrar(cuenta.refresh_token_enc)));
    await db.prepare(`
      UPDATE store_payment_accounts
      SET access_token_enc = ?, refresh_token_enc = COALESCE(?, refresh_token_enc), expires_at = ?
      WHERE id = ? AND disconnected_at IS NULL
    `).run(nueva.access_token_enc, nueva.refresh_token_enc, nueva.expires_at, cuenta.id);
    return descifrar(nueva.access_token_enc);
  } catch (e) {
    console.error(`[ventas] No se pudo renovar el permiso de Mercado Pago de la cuenta ${cuenta.id}:`, e.message);
    return vence > Date.now() ? descifrar(cuenta.access_token_enc) : null;
  }
}

// El permiso de la cuenta con la que se abrió un pedido, aunque la tienda ya
// tenga otra: el pago vive en la cuenta donde se cobró.
export async function permisoDelPedido(pedido) {
  if (!pedido?.payment_account_id) return null;
  const cuenta = await db.prepare('SELECT * FROM store_payment_accounts WHERE id = ?').get(pedido.payment_account_id);
  return permisoDe(cuenta);
}

// Los puestos de una tienda en partidos que todavía reciben pedidos, con lo que
// el comprador necesita para elegir uno: los equipos con sus escudos, la fecha y
// la sede. Las columnas son las de los paneles (utils/partidoDelPanel.js), para
// que el partido se pinte con las mismas piezas.
export async function puestosAbiertosDe(organizationId) {
  return db.prepare(`
    SELECT s.id AS stand_id, s.note, v.address AS venue_address, ${PARTIDO_COLUMNAS}
    FROM store_match_stands s
    JOIN matches m ON m.id = s.match_id
    ${PARTIDO_JOINS}
    WHERE s.organization_id = ? AND s.withdrawn_at IS NULL
      AND ${PUESTO_ABIERTO_SQL}
    ORDER BY m.match_date::timestamptz ASC, m.id ASC
  `).all(organizationId);
}

// Lo que se puede comprar de una tienda, con lo que hace falta para cobrarlo.
export async function productosDe(organizationId) {
  return db.prepare(`
    SELECT id, organization_id, name, description, price, currency, stock, size_stock,
           size_variant, image_url, is_active, show_on_platform
    FROM products WHERE organization_id = ?
  `).all(organizationId);
}

// Todo lo que decide si una tienda vende, leído una vez.
export async function datosDeVenta(org) {
  const [ajustes, cuenta, productos, puestos] = await Promise.all([
    ajustesDe(org.id), cuentaDe(org.id), productosDe(org.id), puestosAbiertosDe(org.id),
  ]);
  const vigente = cuentaVigente(cuenta) ? cuenta : null;
  const falta = faltaParaVender({ org, ajustes, cuenta: vigente, productos, puestosAbiertos: puestos });
  return {
    ajustes,
    cuenta,
    productos,
    puestos,
    falta,
    vende: falta.length === 0,
    entregas: entregasDeLaTienda(ajustes, puestos),
    comprables: productos.filter(esComprable),
  };
}

// ── El pedido ────────────────────────────────────────────────────────────

export async function renglonesDe(orderIds) {
  if (!orderIds.length) return new Map();
  const filas = await db.prepare(`
    SELECT id, order_id, kind, mp_payment_id, data, by_side, by_user_id, created_at
    FROM store_order_events
    WHERE order_id = ANY(?::int[])
    ORDER BY order_id, id
  `).all(orderIds);
  const porPedido = new Map(orderIds.map((id) => [Number(id), []]));
  for (const f of filas) porPedido.get(Number(f.order_id))?.push(f);
  return porPedido;
}

export async function productosDelPedido(orderId) {
  return db.prepare(`
    SELECT i.id, i.product_id, i.product_name, i.product_image_url, i.size_label,
           i.unit_price, i.quantity, i.line_total,
           (SELECT s.kind FROM store_order_stock_moves s WHERE s.item_id = i.id AND s.kind <> 'back') AS stock_move,
           EXISTS (SELECT 1 FROM store_order_stock_moves s WHERE s.item_id = i.id AND s.kind = 'back') AS stock_back
    FROM store_order_items i
    WHERE i.order_id = ?
    ORDER BY i.id
  `).all(orderId);
}

export async function estadoActual(pedido) {
  const renglones = (await renglonesDe([pedido.id])).get(Number(pedido.id)) ?? [];
  return { renglones, estado: estadoDelPedido(pedido, renglones) };
}

// ── Registrar un pago ────────────────────────────────────────────────────
//
// Lo que dice Mercado Pago de un pago, escrito en el pedido. Lo usan el aviso, el
// regreso de quien pagó (por si el aviso tarda) y cancelar con reembolso. Puede
// llegar dos veces, y en cualquier orden: los índices únicos de
// `store_order_events` hacen que el mismo hecho no deje dos renglones.
//
// Aprobado es especial: el renglón y la salida de existencias van en UNA sola
// sentencia (CLAUDE.md: una transacción no se reparte en varias llamadas). Si el
// renglón no se escribe —ya estaba—, las existencias no se tocan. Un segundo pago
// aprobado en el mismo pedido —alguien pagó dos veces— choca con el índice de
// "un solo pagado" y se guarda como `payment_extra`, para que la tienda
// reembolse uno.
const APROBAR_Y_DESCONTAR = `
  WITH reclamo AS (
    INSERT INTO store_order_events (order_id, kind, mp_payment_id, by_side, data)
    VALUES (?, 'payment_approved', ?, 'mercadopago', ?::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING id
  ),
  lineas AS (
    SELECT i.id AS item_id, i.product_id, i.size_label, i.quantity
    FROM store_order_items i
    WHERE i.order_id = ? AND EXISTS (SELECT 1 FROM reclamo)
  ),
  por_talla AS (
    SELECT product_id, size_label, SUM(quantity)::int AS piezas
    FROM lineas WHERE product_id IS NOT NULL
    GROUP BY product_id, size_label
  ),
  por_producto AS (
    SELECT product_id, SUM(piezas)::int AS piezas,
           COALESCE(jsonb_object_agg(size_label, piezas) FILTER (WHERE size_label IS NOT NULL), '{}'::jsonb) AS tallas
    FROM por_talla
    GROUP BY product_id
  ),
  salida AS (
    UPDATE products p SET (stock, size_stock) = (
      SELECT
        CASE WHEN p.size_stock IS NULL THEN p.stock - pp.piezas ELSE COALESCE(SUM(n.valor), 0)::int END,
        CASE WHEN p.size_stock IS NULL THEN NULL ELSE COALESCE(jsonb_object_agg(n.talla, n.valor), '{}'::jsonb) END
      FROM (
        SELECT t.key AS talla, t.value::int - COALESCE((pp.tallas ->> t.key)::int, 0) AS valor
        FROM jsonb_each_text(COALESCE(p.size_stock, '{}'::jsonb)) t
      ) n
    ), updated_at = NOW()
    FROM por_producto pp
    WHERE p.id = pp.product_id
      AND p.stock IS NOT NULL
      AND p.stock >= pp.piezas
      AND (p.size_stock IS NULL OR NOT EXISTS (
        SELECT 1 FROM jsonb_each_text(pp.tallas) t
        WHERE COALESCE((p.size_stock ->> t.key)::int, 0) < t.value::int
      ))
    RETURNING p.id
  )
  INSERT INTO store_order_stock_moves (order_id, item_id, product_id, size_label, quantity, kind)
  SELECT ?, l.item_id, l.product_id, l.size_label, l.quantity,
         CASE
           WHEN l.product_id IN (SELECT id FROM salida) THEN 'out'
           WHEN NOT EXISTS (SELECT 1 FROM products p WHERE p.id = l.product_id AND p.stock IS NOT NULL) THEN 'untracked'
           ELSE 'short'
         END
  FROM lineas l
  ON CONFLICT DO NOTHING
  RETURNING kind
`;

// Lo que se guarda de un pago: lo que la tienda y quien compró necesitan ver,
// no la respuesta entera de Mercado Pago.
function datosDelPago(pago) {
  return {
    status: pago.status ?? null,
    status_detail: pago.status_detail ?? null,
    payment_type: pago.payment_type_id ?? null,
    payment_method: pago.payment_method_id ?? null,
    amount: pago.transaction_amount ?? null,
    approved_at: pago.date_approved ?? null,
  };
}

export async function registrarPago(pedido, pago) {
  const tipo = renglonDePago(pago?.status);
  if (!tipo) return { registrado: false, motivo: 'estado' };
  if (!pagoCuadra(pago, pedido)) {
    console.error(`[ventas] El pago ${pago?.id} no cuadra con el pedido ${pedido.id}: no se registra`);
    return { registrado: false, motivo: 'no_cuadra' };
  }
  const idDelPago = String(pago.id);
  const datos = JSON.stringify(datosDelPago(pago));

  if (tipo === 'payment_approved') {
    await db.prepare(APROBAR_Y_DESCONTAR).all(pedido.id, idDelPago, datos, pedido.id, pedido.id);
    const aprobado = await db.prepare(
      `SELECT mp_payment_id FROM store_order_events WHERE order_id = ? AND kind = 'payment_approved'`
    ).get(pedido.id);
    if (aprobado && aprobado.mp_payment_id !== idDelPago) {
      await db.prepare(`
        INSERT INTO store_order_events (order_id, kind, mp_payment_id, by_side, data)
        VALUES (?, 'payment_extra', ?, 'mercadopago', ?::jsonb)
        ON CONFLICT DO NOTHING
      `).run(pedido.id, idDelPago, datos);
      return { registrado: true, tipo: 'payment_extra' };
    }
    return { registrado: true, tipo };
  }

  await db.prepare(`
    INSERT INTO store_order_events (order_id, kind, mp_payment_id, by_side, data)
    VALUES (?, ?, ?, 'mercadopago', ?::jsonb)
    ON CONFLICT DO NOTHING
  `).run(pedido.id, tipo, idDelPago, datos);
  return { registrado: true, tipo };
}

// Pregunta un pago a Mercado Pago, con el permiso de la cuenta donde se cobró, y
// lo registra. No se le cree a nadie que diga que un pedido se pagó: ni al aviso
// ni a la dirección con la que regresa quien pagó.
export async function preguntarYRegistrar(pedido, paymentId) {
  const permiso = await permisoDelPedido(pedido);
  if (!permiso) return { registrado: false, motivo: 'sin_permiso' };
  const pago = await consultarPago(permiso, paymentId);
  return registrarPago(pedido, pago);
}

// ── Cancelar ─────────────────────────────────────────────────────────────
//
// El renglón "cancelado" y el regreso de las existencias que salieron, en una
// sola sentencia. Lo que no alcanzó o no se llevaba la cuenta no regresa: nunca
// salió.
const CANCELAR_Y_REGRESAR = `
  WITH cancelado AS (
    INSERT INTO store_order_events (order_id, kind, by_side, by_user_id, data)
    VALUES (?, 'cancelled', 'store', ?, ?::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING id
  ),
  salidas AS (
    SELECT s.item_id, s.product_id, s.size_label, s.quantity
    FROM store_order_stock_moves s
    WHERE s.order_id = ? AND s.kind = 'out' AND EXISTS (SELECT 1 FROM cancelado)
  ),
  por_talla AS (
    SELECT product_id, size_label, SUM(quantity)::int AS piezas
    FROM salidas WHERE product_id IS NOT NULL
    GROUP BY product_id, size_label
  ),
  por_producto AS (
    SELECT product_id, SUM(piezas)::int AS piezas,
           COALESCE(jsonb_object_agg(size_label, piezas) FILTER (WHERE size_label IS NOT NULL), '{}'::jsonb) AS tallas
    FROM por_talla
    GROUP BY product_id
  ),
  regreso AS (
    UPDATE products p SET (stock, size_stock) = (
      SELECT
        CASE WHEN p.size_stock IS NULL THEN p.stock + pp.piezas ELSE COALESCE(SUM(n.valor), 0)::int END,
        CASE WHEN p.size_stock IS NULL THEN NULL ELSE COALESCE(jsonb_object_agg(n.talla, n.valor), '{}'::jsonb) END
      FROM (
        SELECT t.key AS talla, t.value::int + COALESCE((pp.tallas ->> t.key)::int, 0) AS valor
        FROM jsonb_each_text(COALESCE(p.size_stock, '{}'::jsonb)) t
      ) n
    ), updated_at = NOW()
    FROM por_producto pp
    WHERE p.id = pp.product_id AND p.stock IS NOT NULL
    RETURNING p.id
  )
  INSERT INTO store_order_stock_moves (order_id, item_id, product_id, size_label, quantity, kind)
  SELECT ?, s.item_id, s.product_id, s.size_label, s.quantity, 'back'
  FROM salidas s
  ON CONFLICT DO NOTHING
`;

export async function cancelarYRegresar(pedido, userId, motivo) {
  await db.prepare(CANCELAR_Y_REGRESAR).run(pedido.id, userId, JSON.stringify({ reason: motivo || null }), pedido.id, pedido.id);
}
