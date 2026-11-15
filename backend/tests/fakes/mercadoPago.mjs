// Un Mercado Pago de mentira para la suite compras.e2e.mjs (README, "Compras en la
// vitrina"). Corre dentro del proceso de la suite, en su propio puerto, y el
// backend de pruebas le habla porque arranca con MP_API_BASE apuntando aquí.
//
// Imita solo lo que el backend usa —las cinco llamadas de utils/mercadoPago.js— y
// lo que la suite necesita para mover un pago: crearlo con el estado que quiera,
// cambiárselo y mandar el aviso firmado a la dirección que el backend le dio al
// abrir el cobro, como lo haría Mercado Pago. También sirve para el navegador:
// el `init_point` es una página que "paga" y regresa a la página del pedido.
//
// Lo que NO es: Mercado Pago. Las reglas de verdad —qué tarjetas pasan, cuánto
// tarda OXXO, qué contesta un reembolso parcial— se prueban con las credenciales
// de prueba de Mercado Pago, una vez, a mano.
import http from 'node:http';
import { firmarAviso } from '../../src/utils/mercadoPago.js';

export function mercadoPagoDeMentira({ puerto = 4200, secretoDeAvisos }) {
  const vendedores = new Map();   // permiso → id de la cuenta del vendedor
  const renovadores = new Map();  // llave para renovar → id de la cuenta
  const codigosUsados = new Set();
  const preferencias = new Map(); // id → { cuerpo, vendedor }
  const pagos = new Map();        // id → pago
  const reembolsos = new Map();   // llave de idempotencia → reembolso
  const avisos = [];              // lo que se le mandó al backend
  let siguiente = 1000;

  const nuevoPermiso = (vendedor) => {
    const permiso = `APP_USR-${vendedor}-${siguiente++}`;
    const renovar = `TG-${vendedor}-${siguiente++}`;
    vendedores.set(permiso, vendedor);
    renovadores.set(renovar, vendedor);
    return {
      access_token: permiso, refresh_token: renovar, user_id: vendedor, public_key: `APP_USR-pk-${vendedor}`,
      expires_in: 15_552_000, live_mode: false, token_type: 'bearer', scope: 'offline_access read write',
    };
  };

  const json = (res, status, datos) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(datos));
  };
  const leerCuerpo = (req) => new Promise((resolver) => {
    let crudo = '';
    req.on('data', (c) => { crudo += c; });
    req.on('end', () => { try { resolver(crudo ? JSON.parse(crudo) : {}); } catch { resolver({}); } });
  });
  const vendedorDe = (req) => vendedores.get(String(req.headers.authorization ?? '').replace(/^Bearer /, ''));

  // Manda el aviso de un pago a la dirección que dio el backend, firmado como
  // Mercado Pago. `firma`: 'buena', 'mala' o 'sin'.
  async function avisar(pagoId, { firma = 'buena' } = {}) {
    const pago = pagos.get(String(pagoId));
    const destino = new URL(pago.notification_url);
    destino.searchParams.set('data.id', String(pago.id));
    destino.searchParams.set('type', 'payment');
    const requestId = `req-${siguiente++}`;
    const headers = { 'Content-Type': 'application/json', 'x-request-id': requestId };
    if (firma === 'buena') headers['x-signature'] = firmarAviso({ dataId: pago.id, xRequestId: requestId, secreto: secretoDeAvisos });
    if (firma === 'mala') headers['x-signature'] = firmarAviso({ dataId: pago.id, xRequestId: requestId, secreto: 'otra-clave' });
    const respuesta = await fetch(destino, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'payment.updated', api_version: 'v1', data: { id: String(pago.id) }, type: 'payment', live_mode: false }),
    });
    avisos.push({ pago: pago.id, firma, status: respuesta.status });
    return respuesta.status;
  }

  // Un pago nuevo de una preferencia. `monto` permite uno que no cuadra.
  function pagar(preferenciaId, estado = 'approved', { monto, tipo = 'credit_card', referencia } = {}) {
    const pref = preferencias.get(preferenciaId);
    if (!pref) throw new Error(`No existe la preferencia ${preferenciaId}`);
    const total = pref.cuerpo.items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const id = String(siguiente++);
    const pago = {
      id: Number(id),
      status: estado,
      status_detail: estado === 'approved' ? 'accredited' : estado === 'pending' ? 'pending_waiting_payment' : 'cc_rejected_other_reason',
      external_reference: referencia ?? pref.cuerpo.external_reference,
      currency_id: 'MXN',
      transaction_amount: monto ?? Math.round(total * 100) / 100,
      payment_type_id: estado === 'pending' ? 'ticket' : tipo,
      payment_method_id: estado === 'pending' ? 'oxxo' : 'visa',
      date_approved: estado === 'approved' ? new Date().toISOString() : null,
      collector_id: pref.vendedor,
      vendedor: pref.vendedor,
      notification_url: pref.cuerpo.notification_url,
      back_url: pref.cuerpo.back_urls?.success,
      marketplace_fee: pref.cuerpo.marketplace_fee ?? null,
    };
    pagos.set(id, pago);
    return pago;
  }

  function cambiarEstado(pagoId, estado) {
    const pago = pagos.get(String(pagoId));
    pago.status = estado;
    if (estado === 'approved') pago.date_approved = new Date().toISOString();
    return pago;
  }

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${puerto}`);
    try {
      if (req.method === 'POST' && url.pathname === '/oauth/token') {
        const cuerpo = await leerCuerpo(req);
        if (cuerpo.grant_type === 'authorization_code') {
          const m = /^codigo-(\d+)$/.exec(String(cuerpo.code ?? ''));
          if (!m || codigosUsados.has(cuerpo.code)) return json(res, 400, { message: 'invalid_grant', error: 'invalid_grant' });
          codigosUsados.add(cuerpo.code);
          return json(res, 200, nuevoPermiso(Number(m[1])));
        }
        if (cuerpo.grant_type === 'refresh_token') {
          const vendedor = renovadores.get(cuerpo.refresh_token);
          if (!vendedor) return json(res, 400, { message: 'invalid_grant', error: 'invalid_grant' });
          renovadores.delete(cuerpo.refresh_token);
          return json(res, 200, nuevoPermiso(vendedor));
        }
        return json(res, 400, { message: 'unsupported_grant_type' });
      }

      if (req.method === 'POST' && url.pathname === '/checkout/preferences') {
        const vendedor = vendedorDe(req);
        if (!vendedor) return json(res, 401, { message: 'invalid_token' });
        const cuerpo = await leerCuerpo(req);
        const id = `pref-${siguiente++}`;
        preferencias.set(id, { cuerpo, vendedor });
        const enlace = `http://localhost:${puerto}/checkout/${id}`;
        return json(res, 201, { id, init_point: enlace, sandbox_init_point: enlace, ...cuerpo });
      }

      // La página de pago, para el navegador: paga con el resultado que diga la
      // dirección, avisa al backend y regresa a la página del pedido.
      const pagina = /^\/checkout\/(pref-\d+)$/.exec(url.pathname);
      if (req.method === 'GET' && pagina) {
        const resultado = url.searchParams.get('resultado');
        const pref = preferencias.get(pagina[1]);
        if (!pref) return json(res, 404, { message: 'not_found' });
        if (!resultado) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(`<!doctype html><meta charset="utf-8"><title>Mercado Pago de mentira</title>
            <h1>Mercado Pago de mentira</h1><p>${pref.cuerpo.items.map((i) => `${i.quantity} × ${i.title}`).join('<br>')}</p>
            <p><a href="?resultado=approved">Pagar con tarjeta</a> · <a href="?resultado=pending">Pagar en OXXO</a> ·
            <a href="?resultado=rejected">Tarjeta rechazada</a> · <a href="${pref.cuerpo.back_urls?.failure}">Volver sin pagar</a></p>`);
        }
        const pago = pagar(pagina[1], resultado);
        await avisar(pago.id).catch(() => {});
        const regreso = new URL(pref.cuerpo.back_urls.success);
        regreso.searchParams.set('payment_id', String(pago.id));
        regreso.searchParams.set('status', pago.status);
        regreso.searchParams.set('external_reference', pago.external_reference);
        res.writeHead(302, { Location: regreso.toString() });
        return res.end();
      }

      const reembolso = /^\/v1\/payments\/(\d+)\/refunds$/.exec(url.pathname);
      if (req.method === 'POST' && reembolso) {
        const pago = pagos.get(reembolso[1]);
        if (!pago || pago.vendedor !== vendedorDe(req)) return json(res, 404, { message: 'Payment not found' });
        const llave = req.headers['x-idempotency-key'] || `sin-llave-${siguiente++}`;
        if (reembolsos.has(llave)) return json(res, 201, reembolsos.get(llave));
        if (pago.status !== 'approved') return json(res, 400, { message: 'Payment not approved' });
        pago.status = 'refunded';
        const hecho = { id: siguiente++, payment_id: pago.id, amount: pago.transaction_amount, status: 'approved' };
        reembolsos.set(llave, hecho);
        avisar(pago.id).catch(() => {});
        return json(res, 201, hecho);
      }

      const consulta = /^\/v1\/payments\/(\d+)$/.exec(url.pathname);
      if (req.method === 'GET' && consulta) {
        const pago = pagos.get(consulta[1]);
        // Con el permiso de otra cuenta, Mercado Pago contesta que no existe.
        if (!pago || pago.vendedor !== vendedorDe(req)) return json(res, 404, { message: 'Payment not found' });
        const { vendedor, notification_url, back_url, ...publico } = pago;
        return json(res, 200, publico);
      }

      return json(res, 404, { message: 'not_found' });
    } catch (e) {
      return json(res, 500, { message: e.message });
    }
  });

  return {
    url: `http://localhost:${puerto}`,
    iniciar: () => new Promise((resolver, rechazar) => {
      servidor.once('error', rechazar);
      servidor.listen(puerto, () => resolver());
    }),
    cerrar: () => new Promise((resolver) => servidor.close(() => resolver())),
    pagar,
    cambiarEstado,
    avisar,
    preferencias,
    pagos,
    reembolsos,
    avisos,
    permisosDe: (vendedor) => [...vendedores.entries()].filter(([, v]) => v === vendedor).map(([p]) => p),
  };
}
