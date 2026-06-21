import { useState, useEffect } from 'react';
import { required, differentFrom, validUrl, minValue, runValidations } from '../utils/validation.js';

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

function isPastDate(localInputValue) {
  const iso = localInputToISO(localInputValue);
  if (!iso) return false;
  return new Date(iso) < new Date();
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

  // Si el formulario se abre para editar un partido que ya tiene fecha pasada
  // pero quedó guardado con un estado distinto a "finished" (datos previos a
  // esta validación), lo corregimos al cargar para no dejar al usuario
  // atorado con un select bloqueado en un valor inválido.
  useEffect(() => {
    if (isPastDate(form.match_date) && form.status !== 'finished') {
      update('status', 'finished');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si la fecha elegida ya pasó, forzamos el estado a "Finalizado" — una liga que
  // registra su calendario a mitad de temporada necesita poder cargar partidos
  // anteriores, y lo más útil es asumir que ya se jugaron en vez de bloquear.
  function handleDateChange(value) {
    update('match_date', value);
    if (isPastDate(value) && form.status !== 'finished') {
      update('status', 'finished');
    }
  }

  const matchIsPast = isPastDate(form.match_date);
  const scoreRequired = form.status === 'finished';

  async function submit(e) {
    e.preventDefault();
    setError('');

    const isoDate = localInputToISO(form.match_date);
    if (!isoDate) {
      setError('Ingresa una fecha y hora válidas.');
      return;
    }

    const validationError = runValidations([
      () => required(form.home_team, 'El equipo local'),
      () => required(form.away_team, 'El equipo visitante'),
      () => differentFrom(form.home_team.trim().toLowerCase(), form.away_team.trim().toLowerCase(), 'El equipo local y el equipo visitante no pueden ser el mismo'),
      () => validUrl(form.stream_url, 'El link de transmisión'),
      () => (matchIsPast && form.status !== 'finished' ? 'Si la fecha del partido ya pasó, el estado debe ser "Finalizado"' : null),
      () => (scoreRequired ? required(form.home_score, 'El marcador local') : null),
      () => (scoreRequired ? required(form.away_score, 'El marcador visitante') : null),
      () => minValue(form.home_score, 0, 'El marcador local'),
      () => minValue(form.away_score, 0, 'El marcador visitante'),
    ]);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      await onSubmit({
        ...form,
        home_team: form.home_team.trim(),
        away_team: form.away_team.trim(),
        venue: form.venue.trim(),
        stream_url: form.stream_url.trim(),
        week_label: form.week_label.trim(),
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
        <input type="datetime-local" required value={form.match_date} onChange={(e) => handleDateChange(e.target.value)} />
        {matchIsPast && (
          <small style={{ color: 'var(--ink-dim)', display: 'block', marginTop: 4 }}>
            Esta fecha ya pasó — el partido se marcará como "Finalizado" y deberás capturar el marcador.
          </small>
        )}
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
        <label>Link de transmisión (opcional)</label>
        <input value={form.stream_url} onChange={(e) => update('stream_url', e.target.value)} placeholder="https://…" />
      </div>

      <div className="field">
        <label>Estado del partido</label>
        <select value={form.status} onChange={(e) => update('status', e.target.value)} disabled={matchIsPast}>
          <option value="scheduled">Programado</option>
          <option value="live">En vivo</option>
          <option value="finished">Finalizado</option>
        </select>
        {matchIsPast && (
          <small style={{ color: 'var(--ink-dim)', display: 'block', marginTop: 4 }}>
            No se puede cambiar: la fecha del partido ya pasó.
          </small>
        )}
      </div>

      {scoreRequired && (
        <div className="field-row">
          <div className="field">
            <label>Marcador local</label>
            <input type="number" min="0" required={scoreRequired} value={form.home_score} onChange={(e) => update('home_score', e.target.value)} />
          </div>
          <div className="field">
            <label>Marcador visitante</label>
            <input type="number" min="0" required={scoreRequired} value={form.away_score} onChange={(e) => update('away_score', e.target.value)} />
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