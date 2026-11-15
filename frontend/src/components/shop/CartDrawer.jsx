import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { catalogPrice } from '../../utils/money.js';
import {
  carritoParaElServidor, conTalla, maximoDePiezas, piezasDelCarrito, problemaDelCarrito,
} from '../../utils/compras.js';
import { BagIcon, CloseButton, QtyStepper, ShopLayer, ShopPhoto } from './ShopBits.jsx';

// El carrito de una tienda, como panel a la derecha (en el teléfono, a todo lo
// ancho). Lo que guarda el navegador no se le cree: cada vez que cambia, el
// servidor lo revisa (`/quote`) y la pantalla enseña el precio de hoy y lo que ya
// no se puede cobrar, renglón por renglón (README, "El carrito").
export default function CartDrawer({ org, cart, token, products, onClose, onCheckout }) {
  const { carrito, cambiarCantidad, quitar } = cart;
  const [revision, setRevision] = useState(null);
  const [error, setError] = useState('');
  const clave = JSON.stringify(carritoParaElServidor(carrito));

  useEffect(() => {
    if (!carrito.length) { setRevision(null); return undefined; }
    let vigente = true;
    const espera = setTimeout(() => {
      api.quoteCart(org.id, { items: carritoParaElServidor(carrito) }, token)
        .then((r) => { if (vigente) { setRevision(r); setError(''); } })
        .catch((e) => {
          if (vigente) setError(e.offline ? 'Sin conexión: no pudimos revisar tu carrito.' : e.message);
        });
    }, 250);
    return () => { vigente = false; clearTimeout(espera); };
    // `clave` resume el carrito: qué y cuántas, que es lo único que cambia la revisión.
  }, [clave, org.id, token]);

  const problemas = revision?.problems ?? [];
  const deHoy = (r) => revision?.lines?.find((l) => l.product_id === r.product_id && (l.size ?? null) === (r.size ?? null));
  const problemaDe = (r) => problemas.find((p) => p.product_id === r.product_id && (p.size ?? null) === (r.size ?? null));
  const piezas = piezasDelCarrito(carrito);
  const listo = carrito.length > 0 && revision && problemas.length === 0;

  return (
    <ShopLayer onClose={onClose} className="shop-drawer" labelledBy="shop-drawer-title">
      <header className="shop-drawer-head">
        <div>
          <h2 id="shop-drawer-title">Tu carrito</h2>
          <p>{org.name}</p>
        </div>
        <CloseButton onClick={onClose} />
      </header>

      {carrito.length === 0 ? (
        <div className="shop-drawer-empty">
          <BagIcon size={28} />
          <p>Tu carrito está vacío.</p>
          <button type="button" className="sf-btn sf-btn-dark sf-btn-sm" onClick={onClose}>Ver el catálogo</button>
        </div>
      ) : (
        <>
          <ul className="shop-lines">
            {carrito.map((r) => {
              const hoy = deHoy(r);
              const problema = problemaDe(r);
              const producto = products?.find((p) => p.id === r.product_id);
              const tope = producto ? Math.max(1, maximoDePiezas(producto, r.size)) : 10;
              return (
                <li key={`${r.product_id}|${r.size ?? ''}`} className={problema ? 'has-problem' : undefined}>
                  <ShopPhoto url={hoy?.product_image_url ?? r.image_url} name={r.name} size={160} />
                  <div className="shop-line-main">
                    <span className="shop-line-name">{conTalla(hoy?.product_name ?? r.name, r.size)}</span>
                    <span className="shop-line-price">{catalogPrice(hoy?.unit_price ?? r.price) ?? '—'}</span>
                    {problema && <span className="shop-line-problem">{problemaDelCarrito(problema)}</span>}
                    <div className="shop-line-actions">
                      <QtyStepper
                        small
                        value={r.quantity}
                        max={tope}
                        label={`Cantidad de ${r.name}`}
                        onChange={(n) => cambiarCantidad(r, n)}
                      />
                      <button type="button" className="shop-link" onClick={() => quitar(r)}>Quitar</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <footer className="shop-drawer-foot">
            {error && <p className="shop-error" role="alert">{error}</p>}
            {problemas.length > 0 && (
              <p className="shop-error" role="alert">Quita o cambia lo marcado para seguir con tu compra.</p>
            )}
            <div className="shop-total-row">
              <span>Subtotal · {piezas === 1 ? '1 pieza' : `${piezas} piezas`}</span>
              <strong>{revision ? catalogPrice(revision.totals?.subtotal) ?? '$0' : '…'}</strong>
            </div>
            <p className="shop-fine">El envío se suma cuando eliges cómo recibir tu compra.</p>
            <button type="button" className="sf-btn sf-btn-primary shop-wide" disabled={!listo} onClick={onCheckout}>
              Continuar con la compra
            </button>
          </footer>
        </>
      )}
    </ShopLayer>
  );
}

// La barra de abajo, mientras el carrito tiene algo: en el teléfono es la única
// forma de verlo sin regresar arriba.
export function CartBar({ cart, onOpen }) {
  const piezas = piezasDelCarrito(cart.carrito);
  if (piezas === 0) return null;
  return (
    <div className="shop-bar" role="region" aria-label="Tu carrito">
      <div className="storefront-inner shop-bar-inner">
        <span className="shop-bar-text">
          <BagIcon />
          {piezas === 1 ? '1 pieza en tu carrito' : `${piezas} piezas en tu carrito`}
        </span>
        <button type="button" className="sf-btn sf-btn-primary sf-btn-sm" onClick={onOpen}>Ver carrito</button>
      </div>
    </div>
  );
}
