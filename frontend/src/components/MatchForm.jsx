import { useState } from 'react';

function toLocalInputValue(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convierte el valor de un input datetime-local ("YYYY-MM-DDTHH:mm") a ISO string,
// sin depender de new Date(string) que puede dar Invalid Date en algunos navegadores/locales.
function localInputToISO(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const d = new Date(year, month - 1, day, hour, minute);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function MatchForm({ initial, onSubmit, onCancel, submitLabel }) {
  const [form, setForm] = useState({
    home_team: initial?.home_team || '',
    away_team: initial?.away_team || '',
    match_date: toLocalInputValue(initial?.match_date) || '',
    venue: initial?.venue || '',
    stream_url: initial?.stream_url || '',
    week_label: initial?.week_label || '',
    status: initial?.status || 'scheduled',
    home_score: initial?.home_score ?? '',
    away_score: initial?.away_score ?? '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const isoDate = localInputToISO(form.match_date);
    if (!isoDate) {
      setError('Ingresa una fecha y hora válidas.');
      setLoading(false);
      return;
    }

    try {
      await onSubmit({
        ...form,
        match_date: isoDate,
        home_score: form.home_score === '' ? null : Number(form.home_score),
        away_score: form.away_score === '' ? null : Number(form.away_score),
      });
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}

      <div className="field-row">
        <div className="field">
          <label>Equipo local</label>
          <input required value={form.home_team} onChange={(e) => update('home_team', e.target.value)} />
        </div>
        <div className="field">
          <label>Equipo visitante</label>
          <input required value={form.away_team} onChange={(e) => update('away_team', e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>Fecha y hora</label>
        <input type="datetime-local" required value={form.match_date} onChange={(e) => update('match_date', e.target.value)} />
      </div>

      <div className="field">
        <label>Sede (opcional)</label>
        <input value={form.venue} onChange={(e) => update('venue', e.target.value)} />
      </div>

      <div className="field">
        <label>Jornada / etiqueta (opcional)</label>
        <input value={form.week_label} onChange={(e) => update('week_label', e.target.value)} placeholder="Ej. Jornada 4" />
      </div>

      <div className="field">
        <label>Link de transmisión</label>
        <input value={form.stream_url} onChange={(e) => update('stream_url', e.target.value)} placeholder="https://…" />
      </div>

      <div className="field">
        <label>Estado del partido</label>
        <select value={form.status} onChange={(e) => update('status', e.target.value)}>
          <option value="scheduled">Programado</option>
          <option value="live">En vivo</option>
          <option value="finished">Finalizado</option>
        </select>
      </div>

      {form.status === 'finished' && (
        <div className="field-row">
          <div className="field">
            <label>Marcador local</label>
            <input type="number" min="0" value={form.home_score} onChange={(e) => update('home_score', e.target.value)} />
          </div>
          <div className="field">
            <label>Marcador visitante</label>
            <input type="number" min="0" value={form.away_score} onChange={(e) => update('away_score', e.target.value)} />
          </div>
        </div>
      )}

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-flag" disabled={loading}>{loading ? 'Guardando…' : submitLabel}</button>
      </div>
    </form>
  );
}
