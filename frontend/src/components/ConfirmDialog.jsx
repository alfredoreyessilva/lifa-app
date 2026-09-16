import { useState } from 'react';
import Modal from './Modal.jsx';

// Confirmación de una acción delicada, sobre el Modal que ya existe.
//
// Reemplaza a window.confirm en las acciones contables. No es cosmético: el
// confirm del navegador no puede mostrar QUÉ se está cancelando (concepto,
// monto, fecha), no puede pedir una razón que quede asentada en el libro, y
// en un panel que maneja dinero se lee como software improvisado.
//
// `reason`: si se pasa un `reasonLabel`, el diálogo pide un motivo y lo manda
// en onConfirm(reason). El motivo se guarda en el movimiento de cancelación,
// así que dentro de seis meses se puede saber por qué se revirtió un cargo.
// `checkbox`: si se pasa un `checkboxLabel`, el diálogo muestra una casilla y
// manda su estado como segundo argumento, onConfirm(reason, checked). Es para
// la acción que tiene dos variantes y no ameritan dos botones — hoy, quitar a
// un jugador del roster: por default se le da de baja (queda el paso por el
// equipo en su historial) y con la casilla se borra sin dejar rastro, para el
// alta mal capturada. Los cuatro llamadores que ya existían no la pasan, así
// que para ellos no cambia nada.
export default function ConfirmDialog({
  title,
  message,
  detail,
  warning,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  reasonLabel,
  reasonRequired = false,
  checkboxLabel,
  checkboxHint,
  onConfirm,
  onClose,
}) {
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    if (reasonRequired && !reason.trim()) {
      setError('Escribe el motivo para dejarlo asentado.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await onConfirm(reason.trim() || null, checked);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="confirm-body">
        <p style={{ margin: 0 }}>{message}</p>

        {detail && <div className="confirm-detail">{detail}</div>}

        {reasonLabel && (
          <div className="field" style={{ marginTop: 16 }}>
            <label>{reasonLabel}</label>
            <input
              type="text"
              value={reason}
              maxLength={200}
              placeholder="Ej. se capturó dos veces"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}

        {checkboxLabel && (
          <label className="confirm-check">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span>
              {checkboxLabel}
              {checkboxHint && <em className="confirm-check-hint">{checkboxHint}</em>}
            </span>
          </label>
        )}
        {warning && <div className="confirm-warn">{warning}</div>}
      </div>

      {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={loading}>{cancelLabel}</button>
        <button
          className={`btn ${danger ? 'btn-danger' : 'btn-accent'}`}
          onClick={handleConfirm}
          disabled={loading}
        >
          {loading ? 'Procesando…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
