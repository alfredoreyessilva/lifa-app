import { useState } from 'react';
import { required, maxLength, runValidations } from '../utils/validation.js';
import { api } from '../api/client.js';
import CharField from './CharField.jsx';

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
  const n = Number(v || 0);
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Alta de un cargo a uno o varios equipos. El monto es POR EQUIPO (tabla), con
// un "monto base" que rellena la columna y un botón que la calcula desde el
// calendario (cuota por partido × partidos del equipo en esa jornada/torneo).
export default function ChargeForm({ teams, categories, tournaments = [], weekLabels = [], leagueId, token, onSubmit, onCancel }) {
  const [meta, setMeta] = useState({
    category: 'campo',
    concept: CATEGORY_LABELS.campo,
    due_date: '',
    week_label: '',
    note: '',
  });
  const [baseAmount, setBaseAmount] = useState('');
  const [rows, setRows] = useState(() => {
    const r = {};
    for (const t of teams) r[t.team_id] = { selected: true, amount: '', matchCount: null };
    return r;
  });
  const [calc, setCalc] = useState({ open: false, tournamentId: '', weekLabel: '', rate: '', loading: false, error: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function updateMeta(key, value) {
    setMeta((m) => ({ ...m, [key]: value }));
  }

  function pickCategory(cat) {
    setMeta((m) => ({
      ...m,
      category: cat,
      concept: Object.values(CATEGORY_LABELS).includes(m.concept) ? (CATEGORY_LABELS[cat] || '') : m.concept,
    }));
  }

  // El monto base rellena toda fila que siga en el valor base anterior (o vacía);
  // las filas que ya editaste a mano no se tocan.
  function applyBase(v) {
    setRows((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        if (next[id].amount === baseAmount || next[id].amount === '') {
          next[id] = { ...next[id], amount: v };
        }
      }
      return next;
    });
    setBaseAmount(v);
  }

  function setRow(teamId, patch) {
    setRows((prev) => ({ ...prev, [teamId]: { ...prev[teamId], ...patch } }));
  }

  const selectedIds = teams.filter((t) => rows[t.team_id]?.selected).map((t) => t.team_id);
  const allSelected = selectedIds.length === teams.length && teams.length > 0;

  function toggleAll() {
    setRows((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) next[id] = { ...next[id], selected: !allSelected };
      return next;
    });
  }

  async function runCalc() {
    const rate = Number(calc.rate);
    if (Number.isNaN(rate) || rate <= 0) {
      setCalc((c) => ({ ...c, error: 'Pon una cuota por partido mayor a cero' }));
      return;
    }
    setCalc((c) => ({ ...c, loading: true, error: '' }));
    try {
      const { counts } = await api.getBillingMatchCounts(
        leagueId,
        { tournamentId: calc.tournamentId || undefined, weekLabel: calc.weekLabel || undefined },
        token
      );
      const byTeam = new Map(counts.map((c) => [c.team_id, c.match_count]));
      setRows((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(next)) {
          const n = byTeam.get(Number(id)) ?? 0;
          next[id] = { ...next[id], matchCount: n, amount: n > 0 ? String(rate * n) : '0' };
        }
        return next;
      });
      setCalc((c) => ({ ...c, loading: false }));
    } catch (e) {
      setCalc((c) => ({ ...c, loading: false, error: e.message }));
    }
  }

  const items = selectedIds
    .map((id) => ({ team_id: id, amount: Number(rows[id].amount) }))
    .filter((it) => it.amount > 0);
  const total = items.reduce((s, it) => s + it.amount, 0);
  const skipped = selectedIds.length - items.length;

  async function submit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => required(meta.concept, 'El concepto'),
      () => maxLength(meta.concept, 120, 'El concepto'),
      () => required(meta.due_date, 'La fecha de vencimiento'),
    ]);
    if (validationError) { setError(validationError); return; }
    if (items.length === 0) { setError('Marca al menos un equipo y ponle un monto mayor a cero'); return; }

    setLoading(true);
    try {
      await onSubmit({
        items,
        category: meta.category,
        concept: meta.concept.trim(),
        due_date: meta.due_date,
        week_label: meta.week_label.trim() || null,
        note: meta.note.trim() || null,
      });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Categoría</label>
          <select value={meta.category} onChange={(e) => pickCategory(e.target.value)}>
            {(categories || Object.keys(CATEGORY_LABELS)).map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Vence el</label>
          <input type="date" value={meta.due_date} onChange={(e) => updateMeta('due_date', e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>Concepto</label>
        <CharField max={120} value={meta.concept} onChange={(e) => updateMeta('concept', e.target.value)}
          placeholder="Renta de campo — Jornada 5" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Jornada (opcional)</label>
          <input value={meta.week_label} onChange={(e) => updateMeta('week_label', e.target.value.toUpperCase())}
            placeholder="5, FINAL…" />
        </div>
        <div className="field">
          <label>Monto base (MXN)</label>
          <input type="number" min="0" step="0.01" value={baseAmount}
            onChange={(e) => applyBase(e.target.value)} placeholder="1200" />
        </div>
      </div>

      <div className="field">
        <label>Nota interna (opcional)</label>
        <CharField as="textarea" rows={2} max={200} value={meta.note}
          onChange={(e) => updateMeta('note', e.target.value)}
          placeholder="Se puede pagar hasta el viernes previo al partido" />
      </div>

      {/* Calculadora por # de partidos */}
      <div style={{ border: '1px solid var(--line)', borderRadius: 4, padding: '10px 12px', marginBottom: 12 }}>
        <button type="button" className="btn btn-ghost btn-sm"
          onClick={() => setCalc((c) => ({ ...c, open: !c.open }))}>
          {calc.open ? '▾' : '▸'} Calcular montos por # de partidos
        </button>
        {calc.open && (
          <div style={{ marginTop: 10 }}>
            <p style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 0 }}>
              Pon una cuota por partido y llena la columna con cuota × partidos de cada equipo en el filtro elegido.
              Luego puedes ajustar cualquier monto a mano.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div className="field">
                <label>Torneo</label>
                <select value={calc.tournamentId} onChange={(e) => setCalc((c) => ({ ...c, tournamentId: e.target.value }))}>
                  <option value="">Toda la liga</option>
                  {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}{t.year ? ` ${t.year}` : ''}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Jornada</label>
                <select value={calc.weekLabel} onChange={(e) => setCalc((c) => ({ ...c, weekLabel: e.target.value }))}>
                  <option value="">Todas</option>
                  {weekLabels.map((w) => <option key={w} value={w}>{/^\d+$/.test(w) ? `Jornada ${w}` : w}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Cuota por partido</label>
                <input type="number" min="0" step="0.01" value={calc.rate}
                  onChange={(e) => setCalc((c) => ({ ...c, rate: e.target.value }))} placeholder="500" />
              </div>
            </div>
            {calc.error && <div className="form-error" style={{ marginTop: 4 }}>{calc.error}</div>}
            <button type="button" className="btn btn-outline btn-sm" disabled={calc.loading} onClick={runCalc}>
              {calc.loading ? 'Calculando…' : 'Llenar montos'}
            </button>
          </div>
        )}
      </div>

      {/* Tabla de equipos con monto por equipo */}
      <div className="field">
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Equipos ({selectedIds.length}/{teams.length})</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={toggleAll}>
            {allSelected ? 'Quitar todos' : 'Seleccionar todos'}
          </button>
        </label>
        <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 4 }}>
          {teams.map((t) => {
            const row = rows[t.team_id];
            return (
              <div key={t.team_id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                borderBottom: '1px solid var(--line)', opacity: row.selected ? 1 : 0.45,
              }}>
                <input type="checkbox" checked={row.selected}
                  onChange={() => setRow(t.team_id, { selected: !row.selected })} />
                <span style={{ flex: 1, fontSize: 13 }}>
                  {t.team_name}
                  {row.matchCount != null && (
                    <span style={{ color: 'var(--ink-dim)', fontSize: 11 }}>
                      {' '}· {row.matchCount} partido{row.matchCount === 1 ? '' : 's'}
                    </span>
                  )}
                </span>
                <input type="number" min="0" step="0.01" value={row.amount}
                  onChange={(e) => setRow(t.team_id, { amount: e.target.value })}
                  disabled={!row.selected}
                  style={{ width: 110 }} placeholder="0.00" />
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ fontSize: 13, margin: '4px 0 12px', color: 'var(--ink-dim)' }}>
        Total: <strong style={{ color: 'var(--ink)' }}>{money(total)}</strong> · {items.length} equipo{items.length === 1 ? '' : 's'}
        {skipped > 0 && <span> · {skipped} sin monto se omiten</span>}
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-flag" disabled={loading}>
          {loading ? 'Registrando…' : `Registrar cobro a ${items.length} equipo${items.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </form>
  );
}
