import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Loading from '../components/Loading.jsx';
import useVitrina from '../components/shop/useVitrina.js';
import { OrderPill, ShopPhoto } from '../components/shop/ShopBits.jsx';
import { imagenAjustada } from '../utils/imagenes.js';
import { initials } from '../components/OrganizationInfoPanel.jsx';
import { catalogPrice } from '../utils/money.js';
import {
  ENTREGAS, RENGLONES, conTalla, cuandoEsElPartido, direccionEnTexto, dondeEsElPartido, enlaceDeWhatsApp,
  explicacionDelEstado, mensajeParaLaTienda, partidoEnTexto, porQueNoSePuedePagar, telefonoEnTexto, urlDelPedido,
} from '../utils/compras.js';
import '../components/shop/shop.css';

// La página de un pedido: /pedido/:token (README, "Compras en la vitrina" → "El
// pedido"). El link es la credencial, como el estado de cuenta del papá (regla 9):
// quien lo tiene ve su pedido, sin cuenta.
//
// Mercado Pago regresa aquí con `payment_id` en la dirección. La página se lo
// pasa al backend, que le pregunta ese pago a Mercado Pago —nunca se le cree a la
// dirección—, y luego la limpia para que recargar no vuelva a preguntar.
const MX = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' };
const cuando = (v) => (v ? new Date(v).toLocaleString('es-MX', MX) : '');

export default function OrderPage() {
  const { token: orderToken } = useParams();
  const { token } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // La compra manda aquí el aviso de que Mercado Pago no abrió.
  const [aviso, setAviso] = useState(() => location.state?.aviso ?? '');

  useVitrina(order ? `Pedido ${order.id}` : 'Tu pedido');

  const cargar = useCallback(async (paymentId) => {
    try {
      setOrder(await api.getOrder(orderToken, { paymentId }, token));
      setError('');
    } catch (e) {
      setError(e.status === 404 ? 'No encontramos este pedido. Revisa que el link esté completo.' : (e.offline ? 'Sin conexión: no pudimos cargar tu pedido.' : e.message));
    }
  }, [orderToken, token]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const pago = params.get('payment_id') || params.get('collection_id');
    cargar(pago || undefined).then(() => {
      if (location.search) navigate(location.pathname, { replace: true });
    });
    // Solo al abrir: después, la dirección ya va limpia.
  }, [orderToken, token]);

  if (error && !order) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No encontramos este pedido</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }
  if (!order) return <Loading message="Buscando tu pedido…" />;

  const url = urlDelPedido(order.token, window.location.origin);
  const aLaTienda = enlaceDeWhatsApp(order.store.phone, mensajeParaLaTienda(order, url));
  const envio = order.history.find((h) => h.kind === 'shipped');
  const partido = order.delivery.promised?.match;
  const partidoHoy = order.delivery.match_now;
  const sinCobro = porQueNoSePuedePagar(order);
  const cuentaCambiada = Boolean(sinCobro) && order.pay_blocked === 'account_changed';

  async function pagar() {
    setBusy(true);
    setAviso('');
    try {
      const r = await api.payOrder(order.token, token);
      window.location.assign(r.init_point);
    } catch (e) {
      setBusy(false);
      setAviso(e.offline ? 'Sin conexión: vuelve a intentarlo.' : e.message);
    }
  }

  async function guardar() {
    setBusy(true);
    setAviso('');
    try {
      await api.claimOrder(order.token, token);
      await cargar();
    } catch (e) {
      setAviso(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="storefront shop-page">
      <header className="storefront-plate shop-plate">
        <div className="storefront-inner shop-plate-inner">
          <Link to={`/panel/organizacion/${order.store.id}`} className="shop-back">← Ir a la tienda</Link>
          <div className="shop-plate-store">
            <span className="shop-plate-logo">
              {order.store.logo_url ? <img src={imagenAjustada(order.store.logo_url, 160)} alt="" /> : initials(order.store.name) || order.store.name[0]}
            </span>
            <div>
              <span className="shop-plate-eyebrow">{order.store.name}</span>
              <h1>Pedido {order.id}</h1>
            </div>
          </div>
        </div>
      </header>

      <div className="storefront-inner shop-order">
        <section className={`shop-status is-${order.status}`} aria-live="polite">
          <OrderPill status={order.status} method={order.delivery.method} />
          {/* Con la cuenta cambiada, «págalo» ya no aplica: su aviso toma ese lugar. */}
          <p>{cuentaCambiada ? sinCobro : explicacionDelEstado(order.status, order.delivery.method)}</p>
          {order.status === 'shipped' && envio && (
            <p className="shop-status-detail">
              {envio.carrier && <>Paquetería: <strong>{envio.carrier}</strong></>}
              {envio.tracking && <> · Guía: <strong>{envio.tracking}</strong></>}
            </p>
          )}
          {sinCobro && !cuentaCambiada && <p className="shop-status-detail">{sinCobro}</p>}
          <div className="shop-status-actions">
            {order.can_pay && (
              <button type="button" className="sf-btn sf-btn-primary" disabled={busy} onClick={pagar}>
                {busy ? 'Abriendo Mercado Pago…' : 'Pagar con Mercado Pago'}
              </button>
            )}
            {cuentaCambiada && (
              <Link to={`/panel/organizacion/${order.store.id}`} className="sf-btn sf-btn-primary">Hacer mi pedido de nuevo</Link>
            )}
            {/* Con otra cuenta, «revisar» le preguntaría a la de antes, que ya no contesta. */}
            {order.status === 'awaiting' && !cuentaCambiada && (
              <button type="button" className="sf-btn sf-btn-dark sf-btn-sm" onClick={() => cargar()}>Ya pagué: revisar</button>
            )}
            {aLaTienda && (
              <a className="sf-btn sf-btn-dark sf-btn-sm" href={aLaTienda} target="_blank" rel="noopener noreferrer">
                Avisar a la tienda por WhatsApp
              </a>
            )}
          </div>
          {aviso && <p className="shop-error" role="alert">{aviso}</p>}
        </section>

        <div className="shop-order-grid">
          <section className="shop-card" aria-labelledby="shop-lo-que">
            <h2 id="shop-lo-que">Lo que compraste</h2>
            <ul className="shop-summary-lines">
              {order.items.map((i, n) => (
                <li key={`${i.product_id}-${i.size}-${n}`}>
                  <ShopPhoto url={i.image_url} name={i.name} size={120} />
                  <span className="shop-summary-name">
                    {conTalla(i.name, i.size)}
                    <small>{i.quantity} × {catalogPrice(i.unit_price)}</small>
                  </span>
                  <span className="shop-summary-amount">{catalogPrice(i.line_total)}</span>
                </li>
              ))}
            </ul>
            <dl className="shop-totals">
              <div><dt>Subtotal</dt><dd>{catalogPrice(order.subtotal)}</dd></div>
              <div><dt>Envío</dt><dd>{order.shipping_fee > 0 ? catalogPrice(order.shipping_fee) : 'Sin costo'}</dd></div>
              <div className="is-total"><dt>Total</dt><dd>{catalogPrice(order.total)} MXN</dd></div>
            </dl>
          </section>

          <section className="shop-card" aria-labelledby="shop-entrega">
            <h2 id="shop-entrega">{ENTREGAS[order.delivery.method]?.label}</h2>
            {order.delivery.method === 'pickup' && (
              <p>{order.delivery.promised?.address}<br /><span className="shop-dim">{order.delivery.promised?.hours}</span></p>
            )}
            {order.delivery.method === 'shipping' && (
              <p>
                {direccionEnTexto(order.delivery.address)}
                {order.delivery.address?.references && <><br /><span className="shop-dim">{order.delivery.address.references}</span></>}
              </p>
            )}
            {order.delivery.method === 'match' && partido && (
              <p>
                <strong>{partidoEnTexto(partidoHoy ?? partido)}</strong><br />
                {cuandoEsElPartido({ ...partido, ...(partidoHoy ?? {}) })}<br />
                {dondeEsElPartido(partido) && <span className="shop-dim">{dondeEsElPartido(partido)}<br /></span>}
                {order.delivery.promised?.note && <span className="shop-stand-note">{order.delivery.promised.note}</span>}
              </p>
            )}
            <p className="shop-dim">A nombre de {order.buyer.name} · WhatsApp {telefonoEnTexto(order.buyer.phone)}</p>

            <h2>La tienda</h2>
            <p>
              <strong>{order.store.name}</strong><br />
              {order.store.address && <>{order.store.address}<br /></>}
              {order.store.phone && <a href={`tel:${order.store.phone.replace(/\s/g, '')}`}>Tel. {order.store.phone}</a>}
            </p>
            {order.return_policy && (
              <>
                <h2>Cambios y devoluciones</h2>
                <p className="shop-policy">{order.return_policy}</p>
              </>
            )}
          </section>
        </div>

        <section className="shop-card" aria-labelledby="shop-historia">
          <h2 id="shop-historia">Lo que ha pasado</h2>
          <ol className="shop-history">
            {order.history.map((h, n) => (
              <li key={`${h.kind}-${n}`}>
                <span>{RENGLONES[h.kind] ?? h.kind}{h.kind === 'cancelled' && h.reason ? `: ${h.reason}` : ''}</span>
                <time dateTime={h.at}>{cuando(h.at)}</time>
              </li>
            ))}
          </ol>
        </section>

        <div className="shop-account">
          {order.mine ? (
            <p>Este pedido está en <Link to="/pedidos">Mis pedidos</Link>.</p>
          ) : token && !order.in_account ? (
            <button type="button" className="sf-btn sf-btn-dark sf-btn-sm" disabled={busy} onClick={guardar}>Guardar en mis pedidos</button>
          ) : !token && !order.in_account ? (
            <p>
              Guarda este link: es tu pedido. O <Link to="/iniciar-sesion" state={{ from: location.pathname, reason: 'guardar este pedido en tu cuenta', next: 'con tu pedido' }}>entra a tu cuenta</Link> para tenerlo en Mis pedidos.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
