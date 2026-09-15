import { useRef, useState } from 'react';
import { money } from '../utils/money.js';

const METHOD_LABELS = {
  transferencia: 'Transferencia / SPEI',
  efectivo: 'Efectivo',
  deposito: 'Depósito en banco',
  otro: 'Otro',
};

// Quien pagó reporta su pago con comprobante. Sirve a los dos niveles del mismo
// problema, porque es exactamente el mismo problema:
//
//   el papá  → a su club   (desde /cuenta/:token, sin sesión)
//   el club  → a su liga   (desde su panel, con sesión)
//
// Por eso la subida del comprobante y el envío entran como funciones
// (`uploadProof`, `submitPayment`): quien lo usa decide a qué endpoint van. Sin
// eso habría dos formularios casi idénticos y el de arriba se quedaría atrás
// cada vez que se toque el de abajo.
//
// El pago NO baja el saldo hasta que lo confirman del otro lado, y eso se dice
// aquí con todas sus letras — si quien paga cree que ya quedó y no es así, el
// mecanismo pierde toda su confianza.
export default function ReportPaymentForm({
  methods,
  suggestedAmount,
  receiverLabel = 'tu club',
  uploadProof,
  submitPayment,
  onCancel,
  onDone,
}) {
  const [form, setForm] = useState({
    amount: suggestedAmount > 0 ? String(suggestedAmount) : '',
    payment_method: 'transferencia',
    reference: '',
    proof_url: '',
    note: '',
  });
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const { url } = await uploadProof(file);
      update('proof_url', url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError('');

    const amount = Number(form.amount);
    if (!form.amount || Number.isNaN(amount) || amount <= 0) {
      setError('Escribe cuánto pagaste.');
      return;
    }

    setLoading(true);
    try {
      await submitPayment({
        amount,
        payment_method: form.payment_method,
        reference: form.reference.trim() || null,
        proof_url: form.proof_url || null,
        note: form.note.trim() || null,
      });
      await onDone();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}

      <p style={{ fontSize: 13, color: 'var(--ws-ink-dim)', marginTop: 0 }}>
        {receiverLabel === 'tu club' ? 'Tu club' : 'Tu liga'} revisa el pago y lo confirma.
        Mientras tanto tu saldo se queda igual
        {suggestedAmount > 0 && <> — hoy debes {money(suggestedAmount)}</>}.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>¿Cuánto pagaste?</label>
          <input type="number" min="0" step="0.01" inputMode="decimal"
            value={form.amount} onChange={(e) => update('amount', e.target.value)} placeholder="800" />
        </div>
        <div className="field">
          <label>¿Cómo pagaste?</label>
          <select value={form.payment_method} onChange={(e) => update('payment_method', e.target.value)}>
            {(methods || Object.keys(METHOD_LABELS)).map((m) => (
              <option key={m} value={m}>{METHOD_LABELS[m] || m}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Referencia o folio (opcional)</label>
        <input value={form.reference} onChange={(e) => update('reference', e.target.value)}
          placeholder="El número que te dio tu banco" />
      </div>

      <div className="field">
        <label>Comprobante</label>
        {form.proof_url ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img src={form.proof_url} alt="Comprobante"
              style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--ws-line)' }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => update('proof_url', '')}>
              Cambiar
            </button>
          </div>
        ) : (
          <>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
            <button type="button" className="btn btn-ws btn-block" disabled={uploading}
              onClick={() => fileRef.current?.click()}>
              {uploading ? 'Subiendo…' : 'Subir captura del pago'}
            </button>
            <small style={{ color: 'var(--ws-ink-faint)' }}>
              La captura de tu transferencia. Ayuda a que te lo confirmen más rápido.
            </small>
          </>
        )}
      </div>

      <div className="field">
        <label>Nota para {receiverLabel} (opcional)</label>
        <input value={form.note} onChange={(e) => update('note', e.target.value)}
          placeholder="Pagué la mensualidad de octubre" />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-accent" disabled={loading || uploading}>
          {loading ? 'Enviando…' : 'Reportar mi pago'}
        </button>
      </div>
    </form>
  );
}
