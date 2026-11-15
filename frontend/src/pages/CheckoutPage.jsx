import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Loading from '../components/Loading.jsx';
import useCarrito from '../components/shop/useCarrito.js';
import useVitrina from '../components/shop/useVitrina.js';
import { ShopPhoto } from '../components/shop/ShopBits.jsx';
import { LEGAL_DATA_READY } from '../config/legal.js';
import { imagenAjustada } from '../utils/imagenes.js';
import { initials } from '../components/OrganizationInfoPanel.jsx';
import { catalogPrice } from '../utils/money.js';
import { MEXICO_STATES } from '../utils/mexicoStates.js';
import {
  ENTREGAS, carritoParaElServidor, conTalla, cuandoEsElPartido, dondeEsElPartido, partidoEnTexto,
  piezasDelCarrito, problemaDelCarrito, revisarComprador, revisarDireccion, textoDelEnvio,
} from '../utils/compras.js';
import '../components/shop/shop.css';

// La compra en la vitrina de una tienda: /panel/organizacion/:id/compra (README,
// "Compras en la vitrina" → "La compra"). Una sola página, de arriba abajo:
// cómo quieres comprar —sin cuenta, o con la tuya, que da confianza—, tus datos,
// cómo lo recibes y el resumen, con quién vende y su política de devoluciones
// antes de pagar, como pide PROFECO. "Pagar con Mercado Pago" crea el pedido y
// se va a Mercado Pago; el precio, el envío y las existencias los pone el servidor.
const DIRECCION_VACIA = { street: '', neighborhood: '', postal_code: '', city: '', state: '', references: '' };

export default function CheckoutPage() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const cart = useCarrito(id);

  const [org, setOrg] = useState(null);
  const [venta, setVenta] = useState(undefined);
  const [error, setError] = useState('');
  const [modo, setModo] = useState(null);
  const [comprador, setComprador] = useState({ name: '', phone: '', email: '' });
  const [forma, setForma] = useState(null);
  const [direccion, setDireccion] = useState(DIRECCION_VACIA);
  const [puesto, setPuesto] = useState(null);
  const [cotizacion, setCotizacion] = useState(null);
  const [errores, setErrores] = useState({});
  const [pagando, setPagando] = useState(false);
  const [aviso, setAviso] = useState('');

  useVitrina(org ? `Tu compra en ${org.name}` : 'Tu compra');

  useEffect(() => {
    let vigente = true;
    api.getOrganization(id, token).then((o) => { if (vigente) setOrg(o); }).catch((e) => { if (vigente) setError(e.message); });
    api.getShopStore(id, token)
      .then((v) => { if (vigente) setVenta(v); })
      .catch(() => { if (vigente) setVenta(null); });
    return () => { vigente = false; };
  }, [id, token]);

  // Con sesión, el nombre y el correo ya los sabemos.
  useEffect(() => {
    if (!user) return;
    setComprador((c) => ({ ...c, name: c.name || user.name || '', email: c.email || user.email || '' }));
  }, [user]);

  const entregas = useMemo(() => {
    if (!venta?.selling) return [];
    return ['pickup', 'shipping', 'match'].filter((f) => (f === 'match' ? venta.deliveries.match?.length : venta.deliveries[f]));
  }, [venta]);

  useEffect(() => {
    if (entregas.length === 1) setForma(entregas[0]);
  }, [entregas]);

  // El servidor revisa el carrito con la entrega elegida: precios de hoy, envío y total.
  const clave = JSON.stringify(carritoParaElServidor(cart.carrito));
  useEffect(() => {
    if (!venta?.selling || cart.carrito.length === 0) return undefined;
    let vigente = true;
    api.quoteCart(id, { items: carritoParaElServidor(cart.carrito), delivery_method: forma }, token)
      .then((c) => { if (vigente) setCotizacion(c); })
      .catch((e) => { if (vigente) setAviso(e.offline ? 'Sin conexión: no pudimos revisar tu carrito.' : e.message); });
    return () => { vigente = false; };
  }, [clave, forma, venta, id, token]);

  if (error) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No encontramos esta tienda</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }
  if (!org || venta === undefined) return <Loading />;

  const vitrina = `/panel/organizacion/${id}`;
  const conDatos = Boolean(token) || modo === 'sin-cuenta';
  const problemas = cotizacion?.problems ?? [];
  const totales = cotizacion?.totals;

  async function pagar() {
    const faltan = { ...revisarComprador(comprador) };
    if (!forma) faltan.forma = 'Elige cómo quieres recibir tu compra';
    if (forma === 'shipping') Object.assign(faltan, revisarDireccion(direccion));
    if (forma === 'match' && !puesto) faltan.puesto = 'Elige el partido';
    setErrores(faltan);
    if (Object.keys(faltan).length) {
      setAviso('Revisa lo marcado antes de pagar.');
      return;
    }
    setAviso('');
    setPagando(true);
    try {
      const r = await api.createOrder(id, {
        items: carritoParaElServidor(cart.carrito),
        buyer: comprador,
        delivery: {
          method: forma,
          ...(forma === 'shipping' ? { address: direccion } : {}),
          ...(forma === 'match' ? { stand_id: puesto } : {}),
        },
        expected_total: totales?.total,
      }, token);
      cart.vaciar();
      window.location.assign(r.init_point);
    } catch (e) {
      setPagando(false);
      if (e.status === 502 && e.data?.token) {
        // El pedido quedó guardado: su página trae "Pagar", y dice por qué no se abrió.
        cart.vaciar();
        navigate(`/pedido/${e.data.token}`, { state: { aviso: e.data.error } });
        return;
      }
      if (e.status === 409 && e.data?.totals) {
        setCotizacion((c) => ({ ...c, totals: e.data.totals }));
        setAviso('El total cambió mientras comprabas. Revísalo y vuelve a apretar «Pagar».');
        return;
      }
      if (e.status === 409 && e.data?.problems) {
        setCotizacion((c) => ({ ...c, problems: e.data.problems }));
      }
      setAviso(e.offline ? 'Sin conexión: tu pedido no se hizo. Vuelve a intentarlo.' : e.message);
    }
  }

  const entrar = () => navigate('/iniciar-sesion', {
    state: { from: location.pathname, reason: 'comprar con tu cuenta', next: 'con tu compra' },
  });

  return (
    <div className="storefront shop-page">
      <header className="storefront-plate shop-plate">
        <div className="storefront-inner shop-plate-inner">
          <Link to={vitrina} className="shop-back">← Volver a la tienda</Link>
          <div className="shop-plate-store">
            <span className="shop-plate-logo">
              {org.logo_url ? <img src={imagenAjustada(org.logo_url, 160)} alt="" /> : initials(org.name) || org.name[0]}
            </span>
            <div>
              <span className="shop-plate-eyebrow">Tu compra en</span>
              <h1>{org.name}</h1>
            </div>
          </div>
        </div>
      </header>

      <div className="storefront-inner">
        {!venta?.selling ? (
          <div className="storefront-empty shop-gap">
            <p>Esta tienda no está vendiendo por ahora. Puedes preguntarle directamente por lo que tiene.</p>
            <Link to={vitrina} className="sf-btn sf-btn-dark sf-btn-sm">Ver la tienda</Link>
          </div>
        ) : cart.carrito.length === 0 ? (
          <div className="storefront-empty shop-gap">
            <p>Tu carrito está vacío.</p>
            <Link to={vitrina} className="sf-btn sf-btn-dark sf-btn-sm">Ver el catálogo</Link>
          </div>
        ) : (
          <div className="shop-checkout">
            <div className="shop-checkout-main">
              {!token && (
                <section className="shop-step" aria-labelledby="shop-paso-cuenta">
                  <h2 id="shop-paso-cuenta">¿Cómo quieres comprar?</h2>
                  <div className="shop-options">
                    <button
                      type="button"
                      className="shop-option"
                      aria-pressed={modo === 'sin-cuenta'}
                      onClick={() => setModo('sin-cuenta')}
                    >
                      <strong>Seguir sin cuenta</strong>
                      <span>Te pedimos tu nombre y tu WhatsApp, y sigues tu pedido con su link.</span>
                    </button>
                    <button type="button" className="shop-option" onClick={entrar}>
                      <strong>Entrar o crear cuenta</strong>
                      <span>Tus pedidos quedan en tu cuenta, en un solo lugar. Regresas aquí mismo.</span>
                    </button>
                  </div>
                </section>
              )}

              {conDatos && (
                <>
                  <section className="shop-step" aria-labelledby="shop-paso-datos">
                    <h2 id="shop-paso-datos">Tus datos</h2>
                    {token && user && <p className="shop-step-sub">Compras con tu cuenta, {user.name}.</p>}
                    <div className="shop-fields">
                      <Campo id="shop-nombre" label="Nombre" error={errores.name}>
                        <input
                          id="shop-nombre"
                          autoComplete="name"
                          value={comprador.name}
                          onChange={(e) => setComprador({ ...comprador, name: e.target.value })}
                        />
                      </Campo>
                      <Campo id="shop-whatsapp" label="WhatsApp" hint="Por aquí te escribe la tienda" error={errores.phone}>
                        <input
                          id="shop-whatsapp"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          placeholder="998 123 4567"
                          value={comprador.phone}
                          onChange={(e) => setComprador({ ...comprador, phone: e.target.value })}
                        />
                      </Campo>
                      <Campo id="shop-correo" label="Correo (opcional)" error={errores.email} wide>
                        <input
                          id="shop-correo"
                          type="email"
                          autoComplete="email"
                          value={comprador.email}
                          onChange={(e) => setComprador({ ...comprador, email: e.target.value })}
                        />
                      </Campo>
                    </div>
                  </section>

                  <section className="shop-step" aria-labelledby="shop-paso-entrega">
                    <h2 id="shop-paso-entrega">¿Cómo lo recibes?</h2>
                    {errores.forma && <p className="shop-error">{errores.forma}</p>}
                    <div className="shop-options is-list">
                      {entregas.map((f) => (
                        <label key={f} className={`shop-option is-radio${forma === f ? ' is-on' : ''}`}>
                          <input type="radio" name="shop-entrega" checked={forma === f} onChange={() => setForma(f)} />
                          <span className="shop-option-text">
                            <strong>{ENTREGAS[f].label}</strong>
                            {f === 'pickup' && <span>{venta.deliveries.pickup.address} · {venta.deliveries.pickup.hours} · Sin costo</span>}
                            {f === 'shipping' && <span>A todo México · {textoDelEnvio(venta.deliveries.shipping)}</span>}
                            {f === 'match' && <span>La tienda va a estar en {venta.deliveries.match.length === 1 ? 'un partido' : `${venta.deliveries.match.length} partidos`}. Sin costo.</span>}
                          </span>
                        </label>
                      ))}
                    </div>

                    {forma === 'shipping' && (
                      <div className="shop-fields shop-address">
                        <Campo id="shop-calle" label="Calle y número" error={errores.street} wide>
                          <input id="shop-calle" autoComplete="address-line1" value={direccion.street} onChange={(e) => setDireccion({ ...direccion, street: e.target.value })} />
                        </Campo>
                        <Campo id="shop-colonia" label="Colonia" error={errores.neighborhood}>
                          <input id="shop-colonia" autoComplete="address-line2" value={direccion.neighborhood} onChange={(e) => setDireccion({ ...direccion, neighborhood: e.target.value })} />
                        </Campo>
                        <Campo id="shop-cp" label="Código postal" error={errores.postal_code}>
                          <input id="shop-cp" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={direccion.postal_code} onChange={(e) => setDireccion({ ...direccion, postal_code: e.target.value.replace(/\D/g, '') })} />
                        </Campo>
                        <Campo id="shop-ciudad" label="Ciudad o municipio" error={errores.city}>
                          <input id="shop-ciudad" autoComplete="address-level2" value={direccion.city} onChange={(e) => setDireccion({ ...direccion, city: e.target.value })} />
                        </Campo>
                        <Campo id="shop-estado" label="Estado" error={errores.state}>
                          <select id="shop-estado" value={direccion.state} onChange={(e) => setDireccion({ ...direccion, state: e.target.value })}>
                            <option value="">Elige…</option>
                            {MEXICO_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </Campo>
                        <Campo id="shop-referencias" label="Referencias (opcional)" hint="Entre qué calles, color de la casa…" wide>
                          <input id="shop-referencias" value={direccion.references} onChange={(e) => setDireccion({ ...direccion, references: e.target.value })} />
                        </Campo>
                      </div>
                    )}

                    {forma === 'match' && (
                      <fieldset className="shop-stands">
                        <legend>¿En qué partido lo recoges?</legend>
                        {errores.puesto && <p className="shop-error">{errores.puesto}</p>}
                        {venta.deliveries.match.map((s) => (
                          <label key={s.stand_id} className={`shop-stand${puesto === s.stand_id ? ' is-on' : ''}`}>
                            <input type="radio" name="shop-puesto" checked={puesto === s.stand_id} onChange={() => setPuesto(s.stand_id)} />
                            <span className="shop-stand-text">
                              <strong>{partidoEnTexto(s)}</strong>
                              <span>{cuandoEsElPartido(s)}</span>
                              {dondeEsElPartido(s) && <span>{dondeEsElPartido(s)}</span>}
                              {s.note && <span className="shop-stand-note">{s.note}</span>}
                            </span>
                          </label>
                        ))}
                        <p className="shop-fine">Se puede pedir hasta 3 horas antes del partido.</p>
                      </fieldset>
                    )}
                  </section>
                </>
              )}
            </div>

            <aside className="shop-summary" aria-label="Resumen de tu compra">
              <h2>Resumen</h2>
              <ul className="shop-summary-lines">
                {cart.carrito.map((r) => {
                  const hoy = cotizacion?.lines?.find((l) => l.product_id === r.product_id && (l.size ?? null) === (r.size ?? null));
                  const problema = problemas.find((p) => p.product_id === r.product_id && (p.size ?? null) === (r.size ?? null));
                  return (
                    <li key={`${r.product_id}|${r.size ?? ''}`}>
                      <ShopPhoto url={hoy?.product_image_url ?? r.image_url} name={r.name} size={120} />
                      <span className="shop-summary-name">
                        {conTalla(hoy?.product_name ?? r.name, r.size)}
                        <small>{r.quantity} × {catalogPrice(hoy?.unit_price ?? r.price) ?? '—'}</small>
                        {problema && <small className="shop-line-problem">{problemaDelCarrito(problema)}</small>}
                      </span>
                      <span className="shop-summary-amount">{hoy ? catalogPrice(hoy.line_total) : '…'}</span>
                    </li>
                  );
                })}
              </ul>
              <dl className="shop-totals">
                <div><dt>Subtotal · {piezasDelCarrito(cart.carrito)} {piezasDelCarrito(cart.carrito) === 1 ? 'pieza' : 'piezas'}</dt><dd>{totales ? catalogPrice(totales.subtotal) : '…'}</dd></div>
                <div><dt>Envío</dt><dd>{!forma ? 'Elige la entrega' : forma !== 'shipping' ? 'Sin costo' : totales ? (totales.shipping_fee > 0 ? catalogPrice(totales.shipping_fee) : 'Gratis') : '…'}</dd></div>
                <div className="is-total"><dt>Total</dt><dd>{totales ? `${catalogPrice(totales.total) ?? '$0'} MXN` : '…'}</dd></div>
              </dl>

              {problemas.length > 0 && (
                <p className="shop-error" role="alert">
                  Algo de tu carrito cambió. <Link to={vitrina}>Regresa a la tienda</Link> para ajustarlo.
                </p>
              )}
              {aviso && <p className="shop-error" role="alert">{aviso}</p>}

              <button
                type="button"
                className="sf-btn sf-btn-primary shop-wide"
                disabled={!conDatos || pagando || problemas.length > 0 || !totales}
                onClick={pagar}
              >
                {pagando ? 'Abriendo Mercado Pago…' : 'Pagar con Mercado Pago'}
              </button>
              <p className="shop-fine">
                Pagas con tarjeta, en OXXO o con tu saldo de Mercado Pago. El pago llega directo a {org.name}: CFBAMX no lo recibe.
              </p>

              <div className="shop-seller">
                <h3>Quién te vende</h3>
                <p>
                  <strong>{venta.seller.name}</strong><br />
                  {venta.seller.address}<br />
                  Tel. {venta.seller.phone}{venta.seller.email && <> · {venta.seller.email}</>}
                </p>
                <h3>Cambios y devoluciones</h3>
                <p className="shop-policy">{venta.return_policy}</p>
                <p className="shop-fine">
                  La tienda te entrega, te da la factura y atiende cambios y garantías.
                  {LEGAL_DATA_READY && <> Al pagar aceptas los <Link to="/terminos">Términos de CFBAMX</Link>.</>}
                </p>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function Campo({ id, label, hint, error, wide, children }) {
  return (
    <div className={`shop-field${wide ? ' is-wide' : ''}${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <span className="shop-field-error">{error}</span> : hint && <span className="shop-field-hint">{hint}</span>}
    </div>
  );
}
