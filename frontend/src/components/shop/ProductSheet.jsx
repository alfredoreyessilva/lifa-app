import { useState } from 'react';
import { catalogPrice } from '../../utils/money.js';
import { existenciasDe, maximoDePiezas, tallasParaElegir } from '../../utils/compras.js';
import { CloseButton, QtyStepper, ShopLayer, ShopPhoto } from './ShopBits.jsx';

// La ventana de un producto, al apretar "Comprar" en la vitrina (README, "El
// carrito"): la foto entera, el precio, la talla y cuántas. "Agregar al carrito"
// se queda en la vitrina; "Comprar ahora" lo agrega y va directo a pagar.
//
// Una talla agotada se ve pero no se elige: saber que existe ayuda a volver.
export default function ProductSheet({ product, storeName, onAdd, onClose }) {
  const tallas = tallasParaElegir(product.size_variant);
  const disponibles = tallas.filter((t) => (existenciasDe(product, t) ?? 1) > 0);
  const [talla, setTalla] = useState(disponibles.length === 1 && tallas.length > 1 ? disponibles[0] : null);
  const [cantidad, setCantidad] = useState(1);
  const [error, setError] = useState('');

  const tope = maximoDePiezas(product, tallas.length ? talla : null);
  const hay = existenciasDe(product, tallas.length ? talla : null);
  const precio = catalogPrice(product.price);

  function agregar(comprarAhora) {
    if (tallas.length && !talla) {
      setError('Elige una talla');
      return;
    }
    onAdd(product, tallas.length ? talla : null, Math.min(cantidad, tope), { comprarAhora });
  }

  return (
    <ShopLayer onClose={onClose} className="shop-sheet" labelledBy="shop-sheet-title">
      <CloseButton onClick={onClose} />
      <ShopPhoto url={product.image_url} name={product.name} size={720} className="shop-sheet-photo" />
      <div className="shop-sheet-body">
        <h2 id="shop-sheet-title">{product.name}</h2>
        <p className="shop-sheet-price">{precio} <small>MXN</small></p>
        {product.description && <p className="shop-sheet-description">{product.description}</p>}

        {tallas.length > 0 && (
          <fieldset className="shop-sizes">
            <legend>Talla</legend>
            <div>
              {tallas.map((t) => {
                const agotada = (existenciasDe(product, t) ?? 1) <= 0;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={talla === t}
                    disabled={agotada}
                    title={agotada ? 'Agotada' : undefined}
                    onClick={() => { setTalla(t); setError(''); setCantidad((c) => Math.min(c, maximoDePiezas(product, t))); }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        <div className="shop-sheet-qty">
          <span>Cantidad</span>
          <QtyStepper value={Math.min(cantidad, Math.max(1, tope))} max={Math.max(1, tope)} onChange={setCantidad} />
          {hay !== null && hay > 0 && hay <= 5 && (
            <span className="shop-sheet-stock">{hay === 1 ? 'Queda 1' : `Quedan ${hay}`}</span>
          )}
        </div>

        {error && <p className="shop-error" role="alert">{error}</p>}

        <div className="shop-sheet-actions">
          <button type="button" className="sf-btn sf-btn-dark" onClick={() => agregar(false)}>Agregar al carrito</button>
          <button type="button" className="sf-btn sf-btn-primary" onClick={() => agregar(true)}>Comprar ahora</button>
        </div>
        <p className="shop-fine">
          Precio con IVA incluido. Pagas con Mercado Pago y el dinero le llega directo a {storeName}.
        </p>
      </div>
    </ShopLayer>
  );
}
