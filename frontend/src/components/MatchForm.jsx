import { useState, useEffect, useRef } from 'react';
import { required, differentFrom, validUrl, minValue, runValidations } from '../utils/validation.js';

function toLocalInputValue(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

function initials(name) {
  return (name || '')
    .split(' ')
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

// ── Combobox de equipo con sugerencias y logo ────────────────────────────────
function TeamCombobox({ label, value, onChange, teams }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const wrapRef = useRef(null);

  // Sincroniza el input si el valor cambia externamente
  useEffect(() => { setQuery(value); }, [value]);

  // Cierra al hacer clic fuera
  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = (teams || []).filter((t) =>
    t.name.toLowerCase().includes((query || '').toLowerCase())
  );

  function handleInput(e) {
    setQuery(e.target.value);
    onChange(e.target.value);
    setOpen(true);
  }

  function select(team) {
    setQuery(team.name);
    onChange(team.name);
    setOpen(false);
  }

  const selectedTeam = (teams || []).find(
    (t) => t.name.toLowerCase() === (query || '').toLowerCase()
  );

  return (
    <div className="field team-combobox-wrap" ref={wrapRef}>
      <label>{label}</label>
      <div className="team-combobox-input-row">
        {/* minilogo si hay coincidencia exacta */}
        {selectedTeam?.logo_url && (
          <div className="team-combobox-logo">
            <img src={selectedTeam.logo_url} alt={selectedTeam.name} />
          </div>
        )}
        {selectedTeam && !selectedTeam.logo_url && (
          <div className="team-combobox-logo team-combobox-logo--initials">
            {initials(selectedTeam.name)}
          </div>
        )}
        <input
          required
          value={query}
          onChange={(e) => { e.target.value = e.target.value.toUpperCase(); handleInput(e); }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
          placeholder="Nombre del equipo"
        />
      </div>

      {open && filtered.length > 0 && (
        <ul className="team-combobox-list">
          {filtered.map((team) => (
            <li
              key={team.id}
              className="team-combobox-item"
              onMouseDown={(e) => { e.preventDefault(); select(team); }}
            >
              <div className="team-combobox-item-logo">
                {team.logo_url
                  ? <img src={team.logo_url} alt={team.name} />
                  : <span>{initials(team.name)}</span>}
              </div>
              <span>{team.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Extrae el número de jornada de valores como "Jornada 4", "4", "" → "4" o ""
function parseWeekNumber(val) {
  if (!val) return '';
  const match = /(\d+)/.exec(String(val));
  return match ? match[1] : '';
}

// ── Formulario principal ─────────────────────────────────────────────────────
export default function MatchForm({ initial, onSubmit, onCancel, submitLabel, teams }) {
  const [form, setForm] = useState({
    home_team:  initial?.home_team  || '',
    away_team:  initial?.away_team  || '',
    match_date: toLocalInputValue(initial?.match_date) || '',
    venue:      initial?.venue      || '',
    stream_url: initial?.stream_url || '',
    week_label: parseWeekNumber(initial?.week_label),
    status:     initial?.status     || 'scheduled',
    home_score: initial?.home_score ?? '',
    away_score: initial?.away_score ?? '',
  });
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  useEffect(() => {
    if (isPastDate(form.match_date) && form.status !== 'finished') {
      update('status', 'finished');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDateChange(value) {
    update('match_date', value);
    if (isPastDate(value) && form.status !== 'finished') {
      update('status', 'finished');
    }
  }

  const matchIsPast   = isPastDate(form.match_date);
  const scoreRequired = form.status === 'finished';

  async function submit(e) {
    e.preventDefault();
    setError('');

    const isoDate = localInputToISO(form.match_date);
    if (!isoDate) { setError('Ingresa una fecha y hora válidas.'); return; }

    const validationError = runValidations([
      () => required(form.home_team, 'El equipo local'),
      () => required(form.away_team, 'El equipo visitante'),
      () => differentFrom(form.home_team.trim().toLowerCase(), form.away_team.trim().toLowerCase(), 'El equipo local y el equipo visitante no pueden ser el mismo'),
      () => validUrl(form.stream_url, 'El link de transmisión'),
      () => (matchIsPast && form.status !== 'finished' ? 'Si la fecha del partido ya pasó, el estado debe ser "Finalizado"' : null),
      () => (scoreRequired ? required(form.home_score, 'El marcador local')     : null),
      () => (scoreRequired ? required(form.away_score, 'El marcador visitante') : null),
      () => minValue(form.home_score, 0, 'El marcador local'),
      () => minValue(form.away_score, 0, 'El marcador visitante'),
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      await onSubmit({
        ...form,
        home_team:  form.home_team.trim(),
        away_team:  form.away_team.trim(),
        venue:      form.venue.trim(),
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
        <TeamCombobox
          label="Equipo local"
          value={form.home_team}
          onChange={(v) => update('home_team', v)}
          teams={teams}
        />
        <TeamCombobox
          label="Equipo visitante"
          value={form.away_team}
          onChange={(v) => update('away_team', v)}
          teams={teams}
        />
      </div>

      <div className="field">
        <label>Fecha y hora</label>
        <input
          type="datetime-local"
          required
          value={form.match_date}
          onChange={(e) => handleDateChange(e.target.value)}
        />
        {matchIsPast && (
          <small style={{ color: 'var(--ink-dim)', display: 'block', marginTop: 4 }}>
            Esta fecha ya pasó — el partido se marcará como "Finalizado" y deberás capturar el marcador.
          </small>
        )}
      </div>

      <div className="field">
        <label>Sede (opcional)</label>
        <input value={form.venue} onChange={(e) => update('venue', e.target.value.toUpperCase())} />
      </div>

      <div className="field">
        <label>Jornada (opcional)</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--ink-dim)', fontSize: 14, whiteSpace: 'nowrap' }}>Jornada</span>
          <select
            value={form.week_label}
            onChange={(e) => update('week_label', e.target.value)}
            style={{ width: 90 }}
          >
            <option value="">—</option>
            {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={String(n)}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Link de transmisión (opcional)</label>
        <input
          value={form.stream_url}
          onChange={(e) => update('stream_url', e.target.value)}
          placeholder="https://…"
        />
      </div>

      <div className="field">
        <label>Estado del partido</label>
        <select
          value={form.status}
          onChange={(e) => update('status', e.target.value)}
          disabled={matchIsPast}
        >
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
            <input
              type="number" min="0"
              required={scoreRequired}
              value={form.home_score}
              onChange={(e) => update('home_score', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Marcador visitante</label>
            <input
              type="number" min="0"
              required={scoreRequired}
              value={form.away_score}
              onChange={(e) => update('away_score', e.target.value)}
            />
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
