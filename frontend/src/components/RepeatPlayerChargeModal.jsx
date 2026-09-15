import { useState } from 'react';
import { money, periodLabelFor } from '../utils/money.js';

const CATEGORY_LABELS = {
  mensualidad: 'Mensualidad', inscripcion: 'Inscripción', uniforme: 'Uniforme',
  torneo: 'Torneo / viaje', equipamiento: 'Equipamiento', multa: 'Multa', otro: 'Otro',
};

// "$800.00" si todos pagan igual, "$400.00–$800.00" si difieren.
function amountLabel(b) {
  const min = Number(b.min_amount), max = Number(b.max_amount);
  return min === max ? money(min) : `${money(min)}–${money(max)}`;
}

// Repite un lote de cargos anterior con nueva fecha de vencimiento. Es la
// acción de cada mes: "las cuotas de octubre igual que las de septiembre".
// Respeta el monto que tenía cada jugador y salta a los que ya se dieron de
// baja desde entonces.
export default function RepeatPlayerChargeModal({ batches, onSubmit, onCancel }) {
  const [batchId, setBatchId] = useState(batches[0]?.batch_id || '');
  const [dueDate, setDueDate] = useState('');
  const [periodLabel, setPeriodLabel] = useState(periodLabelFor());
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
        period_label: periodLabel.trim() || null,
      });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  if (batches.length === 0) {
    return (
      <div>
        <p style={{ color: 'var(--ws-ink-dim)', fontSize: 14 }}>
          Todavía no hay cargos que repetir. Genera las cuotas de este mes primero y el mes
          que entra las vuelves a crear desde aquí con un clic.
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
        <label>Cargo a repetir</label>
        <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          {batches.map((b) => (
            <option key={b.batch_id} value={b.batch_id}>
              {(CATEGORY_LABELS[b.category] || b.category)} · {b.concept} · {amountLabel(b)} · {b.player_count} jugador{Number(b.player_count) === 1 ? '' : 'es'}
            </option>
          ))}
        </select>
      </div>

      {selected && (
        <p style={{ fontSize: 12, color: 'var(--ws-ink-faint)', marginTop: -4 }}>
          Se vuelve a crear ese cargo ({amountLabel(selected)}, total {money(selected.total_amount)}) para
          los {selected.player_count} jugadores que sigan en el plantel, respetando el monto de cada uno.
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Nueva fecha de vencimiento</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Periodo (opcional)</label>
          <input value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value.toUpperCase())} placeholder="OCT-2026" />
        </div>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-accent" disabled={loading}>{loading ? 'Creando…' : 'Repetir cargos'}</button>
      </div>
    </form>
  );
}
