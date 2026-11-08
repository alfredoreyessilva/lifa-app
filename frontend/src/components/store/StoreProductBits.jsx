import { catalogPrice } from '../../utils/money.js';
import { imagenAjustada } from '../../utils/imagenes.js';
import { inShowcase, isActive, stockOf } from '../../utils/storePanel.js';
import { Status } from '../admin/AdminKit.jsx';

// Lo que dice de un producto cada renglón del panel —en Productos y en el
// Resumen—, dicho siempre igual: su foto, su precio, sus existencias y dónde sale.

// La foto entera sobre el gris claro del recuadro de la vitrina, como allá: es una
// foto de estudio, y a una prenda no se le cortan las mangas.
export function ProductThumb({ product, size = 'md' }) {
  return (
    <span className={`sws-thumb is-${size}`}>
      {product.image_url ? (
        <img src={imagenAjustada(product.image_url, size === 'lg' ? 240 : 120)} alt="" loading="lazy" decoding="async" />
      ) : (
        <svg className="sws-thumb-none" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="14" rx="2" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="m4.5 17.5 4.8-4.6 3.2 3 2.7-2.4 4.3 4" />
        </svg>
      )}
    </span>
  );
}

// "$1,650 MXN", con la misma cifra que la vitrina (`catalogPrice`). Sin precio,
// lo que dice la vitrina: que se consulta.
export function ProductPrice({ product }) {
  const precio = catalogPrice(product.price);
  if (!precio) return <span className="adm-faint">A consultar</span>;
  return (
    <span className="sws-price">
      {precio} <small>{product.currency || 'MXN'}</small>
    </span>
  );
}

// Agotado va en amarillo solo si se vende: en un producto inactivo ya no le toca
// a nadie.
export function ProductStock({ product }) {
  const stock = stockOf(product);
  if (stock.kind === 'out') {
    return isActive(product)
      ? <Status tone="ask">Agotado</Status>
      : <span className="adm-faint">Agotado</span>;
  }
  if (stock.kind === 'untracked') return <span className="adm-faint">{stock.text}</span>;
  return <span className="adm-num">{stock.text}</span>;
}

// Dos preguntas distintas, en dos renglones: si se vende, y si sale en la vitrina.
export function ProductPlacement({ product }) {
  const visible = inShowcase(product);
  return (
    <span className="adm-state">
      {isActive(product) ? <Status tone="on">Activo</Status> : <Status>Inactivo</Status>}
      <span className={`sws-where${visible ? ' is-on' : ''}`}>{visible ? 'En tu vitrina' : 'Fuera de tu vitrina'}</span>
    </span>
  );
}

// La foto con el nombre y su talla o variante. En una tabla angosta, el precio y
// las existencias pierden su columna y bajan aquí (`.sws-who-meta`).
export function ProductIdentity({ product }) {
  const sub = product.size_variant || firstLine(product.description);
  return (
    <div className="adm-who sws-who">
      <ProductThumb product={product} />
      <span className="adm-who-text">
        <span className="adm-who-name" title={product.name}>{product.name}</span>
        {sub && <span className="adm-who-sub" title={sub}>{sub}</span>}
        <span className="sws-who-meta">
          <ProductPrice product={product} />
          <span aria-hidden="true">·</span>
          <ProductStock product={product} />
        </span>
      </span>
    </div>
  );
}

function firstLine(text) {
  const line = String(text ?? '').split('\n').map((s) => s.trim()).find(Boolean);
  return line || null;
}
