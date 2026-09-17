import { useMemo, useState } from 'react';
import { money, periodLabelFor } from '../utils/money.js';

const CATEGORY_LABELS = {
  mensualidad: 'Mensualidad',
  inscripcion: 'Inscripción',
  uniforme: 'Uniforme',
  torneo: 'Torneo / viaje',
  equipamiento: 'Equipamiento',
  multa: 'Multa',
  otro: 'Otro',
};

// Genera cargos para varios jugadores de una sola vez.
//
// El monto es POR JUGADOR, no uno solo para todos: en un club real conviven la
// cuota normal, el hermano con descuento y el becado. El botón "usar la cuota
// de cada quien" llena la columna con lo que ya está guardado en la ficha de
// cada jugador — es el equivalente al "calcular por # de partidos" que ya
// existe en la cobranza de la liga.
//
// Los jugadores dados de baja no aparecen. Los becados sí, en cero: se quedan
// visibles para que el tesorero vea el plantel completo, y el backend omite
// las filas en cero al insertar.
export default function PlayerChargeForm({ members, categories, onSubmit, onCancel }) {
  const eligible = useMemo(() => members.filter((p) => p.status !== 'baja'), [members]);

  // Categorías internas del club presentes en el padrón, para el filtro. Es la
  // agrupación PROPIA del equipo (group_label), no la rama de la liga: un club
  // sin liga igual necesita cobrarle distinto a su U17 y a su infantil.
  const groups = useMemo(() => {
    const seen = new Set();
    eligible.forEach((p) => seen.add(p.group_label || 'Sin categoría'));
    return [...seen];
  }, [eligible]);

  const [groupFilter, setGroupFilter] = useState('');
  const [meta, setMeta] = useState({
    category: 'mensualidad',
    concept: `Mensualidad ${periodLabelFor()}`,
    due_date: '',
    period_label: periodLabelFor(),
    note: '',
  });

  // amounts: { [member_id]: string }. Vacío o "0" = no se le cobra.
  const [amounts, setAmounts] = useState(() => {
    const initial = {};
    eligible.forEach((p) => {
      initial[p.member_id] = p.status === 'beca' ? '0' : (p.monthly_amount != null ? String(p.monthly_amount) : '');
    });
    return initial;
  });

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const visible = groupFilter
    ? eligible.filter((p) => (p.group_label || 'Sin categoría') === groupFilter)
    : eligible;

  const items = Object.entries(amounts)
    .map(([id, value]) => ({ member_id: Number(id), amount: Number(value || 0) }))
    .filter((i) => i.amount > 0);

  const total = items.reduce((sum, i) => sum + i.amount, 0);

  function updateMeta(key, value) {
    setMeta((m) => ({ ...m, [key]: value }));
  }

  function fillWithMonthly() {
    setAmounts((prev) => {
      const next = { ...prev };
      visible.forEach((p) => {
        next[p.member_id] = p.status === 'beca' ? '0' : (p.monthly_amount != null ? String(p.monthly_amount) : '');
      });
      return next;
    });
  }

  function clearVisible() {
    setAmounts((prev) => {
      const next = { ...prev };
      visible.forEach((p) => { next[p.member_id] = ''; });
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    setError('');

    if (!meta.concept.trim()) { setError('Ponle un concepto al cargo.'); return; }
    if (!meta.due_date) { setError('Pon la fecha de vencimiento.'); return; }
    if (items.length === 0) { setError('Ningún jugador tiene monto. Llena al menos uno.'); return; }

    setLoading(true);
    try {
      await onSubmit({
        items,
        category: meta.category,
        concept: meta.concept.trim(),
        due_date: meta.due_date,
        period_label: meta.period_label.trim() || null,
        note: meta.note.trim() || null,
      });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  if (eligible.length === 0) {
    return (
      <div>
        <p style={{ color: 'var(--ws-ink-dim)', fontSize: 14 }}>
          Este equipo todavía no tiene jugadores en su plantel. Regístralos en la sección
          Jugadores y después vuelve aquí a cobrarles.
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Tipo de cargo</label>
          <select value={meta.category} onChange={(e) => updateMeta('category', e.target.value)}>
            {(categories || Object.keys(CATEGORY_LABELS)).map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Periodo (opcional)</label>
          <input value={meta.period_label} onChange={(e) => updateMeta('period_label', e.target.value.toUpperCase())}
            placeholder="SEP-2026" />
        </div>
      </div>

      <div className="field">
        <label>Concepto</label>
        <input value={meta.concept} onChange={(e) => updateMeta('concept', e.target.value)}
          placeholder="Mensualidad de septiembre" />
      </div>

      <div className="field">
        <label>Vence el</label>
        <input type="date" value={meta.due_date} onChange={(e) => updateMeta('due_date', e.target.value)} />
      </div>

      <div className="ws-toolbar" style={{ marginTop: 20, marginBottom: 8 }}>
        {groups.length > 1 && (
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}
            style={{ background: 'var(--ws-surface-2)', border: '1px solid var(--ws-line-strong)', color: 'var(--ws-ink)', padding: '8px 10px', borderRadius: 4, fontSize: 12 }}>
            <option value="">Todas las categorías ({eligible.length})</option>
            {groups.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
        <button type="button" className="btn btn-ws btn-sm" onClick={fillWithMonthly}>
          Usar la cuota de cada quien
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clearVisible}>
          Limpiar
        </button>
      </div>

      <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Jugador</th>
              <th>Categoría</th>
              <th className="col-num">Monto</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.member_id} className={p.status === 'beca' ? 'row-muted' : ''}>
                <td>
                  <div className="cell-player-name">{p.display_name}</div>
                  {p.status === 'beca' && <span className="pill is-muted">Becado</span>}
                </td>
                <td style={{ color: 'var(--ws-ink-faint)', fontSize: 12 }}>{p.group_label || '—'}</td>
                <td className="col-num">
                  <input
                    type="number" min="0" step="0.01"
                    value={amounts[p.member_id] ?? ''}
                    onChange={(e) => setAmounts((prev) => ({ ...prev, [p.member_id]: e.target.value }))}
                    placeholder="0"
                    style={{ width: 100, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--ws-line)',
      }}>
        <span style={{ fontSize: 12, color: 'var(--ws-ink-dim)' }}>
          Se generan {items.length} {items.length === 1 ? 'cargo' : 'cargos'}
        </span>
        <span className="money" style={{ fontSize: 18 }}>{money(total)}</span>
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <label>Nota interna (opcional)</label>
        <input value={meta.note} onChange={(e) => updateMeta('note', e.target.value)}
          placeholder="Solo la ves tú, no aparece en el estado de cuenta del papá" />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-accent" disabled={loading}>
          {loading ? 'Generando…' : `Generar ${items.length || ''} ${items.length === 1 ? 'cargo' : 'cargos'}`.trim()}
        </button>
      </div>
    </form>
  );
}
