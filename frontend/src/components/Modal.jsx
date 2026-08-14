import { createPortal } from 'react-dom';

// Se monta directo en document.body (portal), no adentro de quien lo abre.
// Es clave cuando el modal se abre desde algo que a su vez está dentro de
// un <Link> (ej. el widget de predicciones en la tarjeta de un partido en
// una lista) — si el modal viviera anidado ahí, un clic dentro del modal
// podía "filtrarse" hacia el link de la tarjeta y disparar una navegación
// no deseada. Con el portal, el modal queda fuera de ese árbol por completo.
export default function Modal({ title, onClose, children }) {
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>,
    document.body
  );
}
