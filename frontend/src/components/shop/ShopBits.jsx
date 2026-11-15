import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { imagenAjustada } from '../../utils/imagenes.js';
import { ESTADOS, etiquetaDelEstado, PIEZAS_POR_RENGLON } from '../../utils/compras.js';

// Las piezas chicas que comparten la vitrina, el carrito, la compra y la página
// de un pedido (README, "Compras en la vitrina"). Van en el blanco de la vitrina:
// una compra es de la tienda, no de la cancha.

// Una capa encima de la página, en un portal. Cierra con Escape y con un clic
// afuera, no deja desplazar la página de abajo, y regresa el foco a donde estaba.
export function ShopLayer({ onClose, className, labelledBy, children }) {
  const panel = useRef(null);
  // Quien la abre pasa una función nueva en cada render; la capa se monta una vez.
  const cerrar = useRef(onClose);
  cerrar.current = onClose;

  useEffect(() => {
    const antes = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector('button, [href], input, select, textarea')?.focus();
    const onKey = (e) => { if (e.key === 'Escape') cerrar.current(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      antes?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="shop-overlay" onClick={onClose}>
      <div
        ref={panel}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function CloseButton({ onClick, label = 'Cerrar' }) {
  return (
    <button type="button" className="shop-close" aria-label={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

// La foto del producto: cuadrada, sin recortar, como en la vitrina.
export function ShopPhoto({ url, name, size = 320, className = '' }) {
  return (
    <span className={`shop-photo ${className}`}>
      {url ? <img src={imagenAjustada(url, size)} alt={name || ''} loading="lazy" decoding="async" /> : <span>Sin foto</span>}
    </span>
  );
}

// − 1 + : de 1 hasta `max` (10, o las piezas que haya).
export function QtyStepper({ value, max = PIEZAS_POR_RENGLON, onChange, label = 'Cantidad', small }) {
  return (
    <span className={`shop-qty${small ? ' is-small' : ''}`} role="group" aria-label={label}>
      <button type="button" aria-label="Una menos" disabled={value <= 1} onClick={() => onChange(value - 1)}>−</button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label="Una más" disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </span>
  );
}

// El estado de un pedido, con su palabra y su color (README, "El pedido").
export function OrderPill({ status, method }) {
  const tono = ESTADOS[status]?.tone ?? 'off';
  return <span className={`shop-pill is-${tono}`}>{etiquetaDelEstado(status, method)}</span>;
}

// La bolsa de las compras, para el botón del carrito.
export function BagIcon({ size = 18 }) {
  return (
    <svg className="shop-bag" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M5 8h14l-1.2 11.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z" />
      <path d="M9 10V7a3 3 0 0 1 6 0v3" />
    </svg>
  );
}
