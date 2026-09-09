import { useState } from 'react';

const CATEGORY_LABELS = {
  campo: 'Renta de campo',
  arbitraje: 'Arbitraje',
  transmision: 'Transmisión',
  inscripcion: 'Inscripción',
  multa: 'Multa',
  fianza: 'Fianza',
  otro: 'Otro',
};

function money(v) {
  const n = Number(v);
  return Number.isNaN(n) ? v : `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

// "$500.00" si todos pagan igual, "$500.00–$2,500.00" si difieren.
function amountLabel(b) {
  const min = Number(b.min_amount), max = Number(b.max_amount);
  return min === max ? money(min) : `${money(min)}–${money(max)}`;
}

// Repite un lote de cargos anterior (misma categoría / concepto / monto,
// mismos equipos) con una nueva fecha de vencimiento.
export default function RepeatChargeModal({ batches, onSubmit, onCancel }) {
  const [batchId, setBatchId] = useState(batches[0]?.batch_id || '');
  const [dueDate, setDueDate] = useState('');
  const [weekLabel, setWeekLabel] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const selected = batches.find((b) => b.batch_id === batchId);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!batchId) { setError('Elige un lote para repetir'); return; }
    if (!dueDate) { setError('Pon la nueva fecha de vencimiento'); return; }

    setLoading(true);
    try {
      await onSubmit({
        source_batch_id: batchId,
        due_date: dueDate,
        week_label: weekLabel.trim() || null,
      });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  if (batches.length === 0) {
    return (
      <div>
        <p style={{ color: 'var(--ink-dim)', fontSize: 14 }}>
          Todavía no hay lotes de cobros para repetir. Registra un cobro en bloque primero.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cerrar</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}

      <div className="field">
        <label>Lote a repetir</label>
        <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          {batches.map((b) => (
            <option key={b.batch_id} value={b.batch_id}>
              {(CATEGORY_LABELS[b.category] || b.category)} · {b.concept} · {amountLabel(b)} · {b.team_count} equipo{Number(b.team_count) === 1 ? '' : 's'}
            </option>
          ))}
        </select>
      </div>

      {selected && (
        <p style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: -4 }}>
          Se recrea ese lote ({amountLabel(selected)}, total {money(selected.total_amount)}) para los {selected.team_count} equipos
          que sigan en la liga, respetando el monto de cada uno.
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Nueva fecha de vencimiento</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Jornada (opcional)</label>
          <input value={weekLabel} onChange={(e) => setWeekLabel(e.target.value.toUpperCase())} placeholder="6" />
        </div>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-flag" disabled={loading}>{loading ? 'Creando…' : 'Repetir cargos'}</button>
      </div>
    </form>
  );
}
