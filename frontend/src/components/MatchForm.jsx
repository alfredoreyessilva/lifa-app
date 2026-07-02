import { useState, useEffect, useRef } from 'react';
import { required, differentFrom, validUrl, minValue, runValidations } from '../utils/validation.js';
import CharField from './CharField.jsx';
import TimezoneSelect from './TimezoneSelect.jsx';
import { getMatchStatus } from '../utils/matchStatus.js';

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

function initials(name) {
  return (name || '')
    .split(' ')
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function TeamCombobox({ label, value, onChange, teams }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState(value);
  const wrapRef           = useRef(null);

  useEffect(() => { setQuery(value); }, [value]);

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

function parseWeekNumber(val) {
  if (!val) return '';
  const match = /(\d+)/.exec(String(val));
  return match ? match[1] : '';
}

export default function MatchForm({ initial, onSubmit, onCancel, submitLabel, teams, leagueTimezone }) {
  const defaultTimezone = initial?.timezone || leagueTimezone || 'America/Mexico_City';

  const [form, setForm] = useState({
    home_team:   initial?.home_team   || '',
    away_team:   initial?.away_team   || '',
    match_date:  toLocalInputValue(initial?.match_date) || '',
    venue:       initial?.venue       || '',
    stream_url:  initial?.stream_url  || '',
    tickets_url: initial?.tickets_url || '',
    week_label:  parseWeekNumber(initial?.week_label),
    home_score:  initial?.home_score  ?? '',
    away_score:  initial?.away_score  ?? '',
    timezone:    defaultTimezone,
  });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Construye un objeto temporal para calcular el estado actual del partido
  function getCurrentStatus() {
    const isoDate = localInputToISO(form.match_date);
    if (!isoDate) return 'scheduled';
    return getMatchStatus({
      match_date: isoDate,
      home_score: form.home_score === '' ? null : form.home_score,
      away_score: form.away_score === '' ? null : form.away_score,
    });
  }

  // El marcador solo se pide cuando el partido ya terminó (no cuando está en vivo)
  const currentStatus   = getCurrentStatus();
  const matchIsFinished = currentStatus === 'finished';
  const matchIsLive     = currentStatus === 'live';
  const matchIsPast     = currentStatus === 'live' || currentStatus === 'finished';

  async function submit(e) {
    e.preventDefault();
    setError('');

    const isoDate = localInputToISO(form.match_date);
    if (!isoDate) { setError('Ingresa una fecha y hora válidas.'); return; }

    const validationError = runValidations([
      () => required(form.home_team, 'El equipo local'),
      () => required(form.away_team, 'El equipo visitante'),
      () => differentFrom(
        form.home_team.trim().toLowerCase(),
        form.away_team.trim().toLowerCase(),
        'El equipo local y el equipo visitante no pueden ser el mismo'
      ),
      () => validUrl(form.stream_url,  'El link de transmisión'),
      () => validUrl(form.tickets_url, 'El link de boletos'),
      // Marcador obligatorio solo cuando ya terminó (no en vivo)
      () => (matchIsFinished ? required(form.home_score, 'El marcador local')     : null),
      () => (matchIsFinished ? required(form.away_score, 'El marcador visitante') : null),
      () => minValue(form.home_score, 0, 'El marcador local'),
      () => minValue(form.away_score, 0, 'El marcador visitante'),
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      await onSubmit({
        ...form,
        home_team:   form.home_team.trim(),
        away_team:   form.away_team.trim(),
        venue:       form.venue.trim(),
        stream_url:  form.stream_url.trim(),
        tickets_url: form.tickets_url.trim(),
        week_label:  form.week_label.trim(),
        match_date:  isoDate,
        home_score:  form.home_score === '' ? null : Number(form.home_score),
        away_score:  form.away_score === '' ? null : Number(form.away_score),
        timezone:    form.timezone,
        status:      currentStatus,
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
          onChange={(e) => update('match_date', e.target.value)}
        />
        {matchIsLive && (
          <small style={{ color: 'var(--live)', display: 'block', marginTop: 4 }}>
            🔴 Este partido está en vivo ahora. Podrás capturar el marcador cuando termine.
          </small>
        )}
        {matchIsFinished && (
          <small style={{ color: 'var(--ink-dim)', display: 'block', marginTop: 4 }}>
            Este partido ya terminó — captura el marcador final.
          </small>
        )}
      </div>

      <TimezoneSelect
        label="Zona horaria de este partido"
        value={form.timezone}
        onChange={(v) => update('timezone', v)}
      />
      <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: -8, marginBottom: 16 }}>
        Por defecto usa la zona de tu liga. Cámbiala solo si este partido se juega en otra región.
      </div>

      <div className="field">
        <label>Sede (opcional)</label>
        <CharField max={40} uppercase value={form.venue} onChange={(e) => update('venue', e.target.value)} />
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
        <label>Link de boletos (opcional)</label>
        <input
          value={form.tickets_url}
          onChange={(e) => update('tickets_url', e.target.value)}
          placeholder="https://…"
        />
      </div>

      {/* Marcador — solo cuando el partido ya terminó, NO cuando está en vivo */}
      {matchIsFinished && (
        <div className="field-row">
          <div className="field">
            <label>Marcador local</label>
            <input
              type="number"
              min="0"
              required
              value={form.home_score}
              onChange={(e) => update('home_score', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Marcador visitante</label>
            <input
              type="number"
              min="0"
              required
              value={form.away_score}
              onChange={(e) => update('away_score', e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-flag" disabled={loading}>
          {loading ? 'Guardando…' : submitLabel}
        </button>
      </div>
    </form>
  );
}