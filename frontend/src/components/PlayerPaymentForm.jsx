import { useState } from 'react';
import { required, minValue, maxLength, runValidations } from '../utils/validation.js';
import CharField from './CharField.jsx';
import LogoField from './LogoField.jsx';
import { money } from '../utils/money.js';

const METHOD_LABELS = {
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  deposito: 'Depósito',
  otro: 'Otro',
};

// El club registra un pago que YA recibió de un jugador (efectivo en la
// práctica, transferencia que ya vio en su cuenta). Nace confirmado y baja el
// saldo de inmediato — a diferencia del que reporta el papá desde su link
// público, que nace pendiente y espera revisión.
export default function PlayerPaymentForm({ playerName, methods, suggestedAmount, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    amount: suggestedAmount != null && suggestedAmount > 0 ? String(suggestedAmount) : '',
    payment_method: 'transferencia',
    reference: '',
    proof_url: '',
    note: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => required(form.amount, 'El monto'),
      () => minValue(form.amount, 0.01, 'El monto'),
      () => maxLength(form.reference, 80, 'La referencia'),
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      await onSubmit({
        amount: Number(form.amount),
        payment_method: form.payment_method,
        reference: form.reference.trim() || null,
        proof_url: form.proof_url.trim() || null,
        note: form.note.trim() || null,
      });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}

      <p style={{ fontSize: 13, color: 'var(--ws-ink-dim)', marginTop: 0 }}>
        Registra un pago recibido de <strong>{playerName}</strong>. Se aplica de inmediato a su estado de cuenta.
        {suggestedAmount > 0 && <> Debe {money(suggestedAmount)}.</>}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Monto (MXN)</label>
          <input type="number" min="0" step="0.01" value={form.amount}
            onChange={(e) => update('amount', e.target.value)} placeholder="800" />
        </div>
        <div className="field">
          <label>Método</label>
          <select value={form.payment_method} onChange={(e) => update('payment_method', e.target.value)}>
            {(methods || Object.keys(METHOD_LABELS)).map((m) => (
              <option key={m} value={m}>{METHOD_LABELS[m] || m}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Referencia / folio (opcional)</label>
        <input value={form.reference} onChange={(e) => update('reference', e.target.value)}
          placeholder="Folio de la transferencia" />
      </div>

      <LogoField value={form.proof_url} onChange={(v) => update('proof_url', v)} label="Comprobante (opcional)" />

      <div className="field">
        <label>Nota (opcional)</label>
        <CharField as="textarea" rows={2} max={200} value={form.note}
          onChange={(e) => update('note', e.target.value)}
          placeholder="Abono parcial, el resto queda pendiente" />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-accent" disabled={loading}>{loading ? 'Registrando…' : 'Registrar pago'}</button>
      </div>
    </form>
  );
}
