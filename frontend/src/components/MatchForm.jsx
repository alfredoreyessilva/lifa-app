import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { required, differentFrom, validUrl, minValue, runValidations } from '../utils/validation.js';
import Modal from './Modal.jsx';
import VenueForm from './VenueForm.jsx';
import TeamForm from './TeamForm.jsx';
import GroupForm from './GroupForm.jsx';
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

// Selector de equipo (obligatorio, de la lista ya registrada) + botón para
// crear uno nuevo sin salir del formulario del partido — mismo patrón que el
// selector de sedes.
function TeamSelect({ label, value, onChange, teams, onCreateNew }) {
  const selectedTeam = (teams || []).find(
    (t) => t.name.toLowerCase() === (value || '').toLowerCase()
  );

  return (
    <div className="field">
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
        <select required value={value || ''} onChange={(e) => onChange(e.target.value)} style={{ flex: 1 }}>
          <option value="">— Selecciona un equipo —</option>
          {(teams || []).map((t) => (
            <option key={t.id} value={t.name}>{t.name}</option>
          ))}
        </select>
      </div>
      <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 6 }} onClick={onCreateNew}>
        + Crear equipo
      </button>
    </div>
  );
}

function parseWeekNumber(val) {
  if (!val) return '';
  const match = /(\d+)/.exec(String(val));
  return match ? match[1] : '';
}

export default function MatchForm({
  initial, onSubmit, onCancel, submitLabel, teams, venues, groups,
  leagueTimezone, token, leagueId, categoryId, onVenueCreated, onTeamCreated, onGroupCreated,
}) {
  const defaultTimezone = initial?.timezone || leagueTimezone || 'America/Mexico_City';

  const [form, setForm] = useState({
    home_team:   initial?.home_team   || '',
    away_team:   initial?.away_team   || '',
    match_date:  toLocalInputValue(initial?.match_date) || '',
    venue_id:    initial?.venue_id    || null,
    group_id:    initial?.group_id    || null,
    group_id_2:  initial?.group_id_2  || null,
    stream_url:  initial?.stream_url  || '',
    tickets_url: initial?.tickets_url || '',
    week_label:  parseWeekNumber(initial?.week_label),
    home_score:  initial?.home_score  ?? '',
    away_score:  initial?.away_score  ?? '',
    timezone:    defaultTimezone,
  });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  // Copia local de las sedes disponibles: empieza igual a la prop `venues`,
  // pero cuando se crea una sede nueva desde aquí se agrega de inmediato,
  // sin depender de que el componente padre vuelva a cargar sus datos.
  const [localVenues, setLocalVenues] = useState(venues || []);
  useEffect(() => { setLocalVenues(venues || []); }, [venues]);
  const [showVenueModal, setShowVenueModal] = useState(false);
  const [venueError, setVenueError] = useState('');

  // Mismo patrón para equipos: copia local + saber si se está creando el
  // equipo local o el visitante (para saber a cuál campo asignar el resultado).
  const [localTeams, setLocalTeams] = useState(teams || []);
  useEffect(() => { setLocalTeams(teams || []); }, [teams]);
  const [creatingTeamFor, setCreatingTeamFor] = useState(null); // 'home' | 'away' | null
  const [teamError, setTeamError] = useState('');

  // Mismo patrón para grupos (opcional) — propios de esta categoría.
  const [localGroups, setLocalGroups] = useState(groups || []);
  useEffect(() => { setLocalGroups(groups || []); }, [groups]);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupError, setGroupError] = useState('');

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

  // El marcador solo se pide cuando el partido ya terminó según el horario
  // (nunca al revés: tener marcador no adelanta el estado). Si el partido ya
  // tenía marcador capturado de antes, lo seguimos mostrando aunque el
  // horario recalculado diga que todavía está en vivo, para no "esconder"
  // un dato que ya existía y que el representante podría necesitar corregir.
  const currentStatus   = getCurrentStatus();
  const matchIsFinished = currentStatus === 'finished';
  const matchIsLive     = currentStatus === 'live';
  const matchIsPast     = currentStatus === 'live' || currentStatus === 'finished';
  const hadScoreAlready = initial?.home_score !== null && initial?.home_score !== undefined
                       && initial?.away_score !== null && initial?.away_score !== undefined;
  const showScoreFields = matchIsFinished || hadScoreAlready;

  async function handleCreateVenue(payload) {
    setVenueError('');
    try {
      const venue = await api.createVenue(leagueId, payload, token);
      setLocalVenues((prev) => [...prev, venue]);
      update('venue_id', venue.id);
      setShowVenueModal(false);
      if (onVenueCreated) onVenueCreated();
    } catch (e) {
      setVenueError(e.message);
      throw e;
    }
  }

  async function handleCreateTeam(payload) {
    setTeamError('');
    try {
      const team = await api.createTeam(leagueId, payload, token);
      setLocalTeams((prev) => [...prev, team]);
      if (creatingTeamFor === 'home') update('home_team', team.name);
      if (creatingTeamFor === 'away') update('away_team', team.name);
      setCreatingTeamFor(null);
      if (onTeamCreated) onTeamCreated();
    } catch (e) {
      setTeamError(e.message);
      throw e;
    }
  }

  async function handleCreateGroup(payload) {
    setGroupError('');
    try {
      const group = await api.createGroup(categoryId, payload, token);
      setLocalGroups((prev) => [...prev, group]);
      update('group_id', group.id);
      setShowGroupModal(false);
      if (onGroupCreated) onGroupCreated();
    } catch (e) {
      setGroupError(e.message);
      throw e;
    }
  }

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
        venue_id:    form.venue_id || null,
        group_id:    form.group_id || null,
        group_id_2:  form.group_id_2 || null,
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
    <>
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}

      <div className="field-row">
        <TeamSelect
          label="Equipo local"
          value={form.home_team}
          onChange={(v) => update('home_team', v)}
          teams={localTeams}
          onCreateNew={() => setCreatingTeamFor('home')}
        />
        <TeamSelect
          label="Equipo visitante"
          value={form.away_team}
          onChange={(v) => update('away_team', v)}
          teams={localTeams}
          onCreateNew={() => setCreatingTeamFor('away')}
        />
      </div>
      {teamError && <div className="form-error">{teamError}</div>}
      {initial?.home_team && !localTeams.some((t) => t.name.toLowerCase() === initial.home_team.toLowerCase()) && (
        <small style={{ color: 'var(--flag)', display: 'block', marginTop: -8, marginBottom: 12 }}>
          El equipo local “{initial.home_team}” ya no coincide con ningún equipo registrado. Selecciónalo de nuevo arriba (o créalo).
        </small>
      )}
      {initial?.away_team && !localTeams.some((t) => t.name.toLowerCase() === initial.away_team.toLowerCase()) && (
        <small style={{ color: 'var(--flag)', display: 'block', marginTop: -8, marginBottom: 12 }}>
          El equipo visitante “{initial.away_team}” ya no coincide con ningún equipo registrado. Selecciónalo de nuevo arriba (o créalo).
        </small>
      )}

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
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={form.venue_id || ''}
            onChange={(e) => update('venue_id', e.target.value ? Number(e.target.value) : null)}
            style={{ flex: 1 }}
          >
            <option value="">— Sin sede —</option>
            {localVenues.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowVenueModal(true)}>
            + Crear sede
          </button>
        </div>
        {initial?.venue && !form.venue_id && (
          <small style={{ color: 'var(--flag)', display: 'block', marginTop: 4 }}>
            Este partido tenía la sede escrita como texto: “{initial.venue}”. Selecciona arriba la sede correspondiente (o créala) para migrarlo.
          </small>
        )}
      </div>

      <div className="field">
        <label>Grupo (opcional)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={form.group_id || ''}
            onChange={(e) => update('group_id', e.target.value ? Number(e.target.value) : null)}
            style={{ flex: 1 }}
          >
            <option value="">— Sin grupo —</option>
            {localGroups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowGroupModal(true)}>
            + Crear grupo
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 4 }}>
          Solo úsalo si esta categoría se divide en conferencias/grupos (ej. "Conferencia 14 Grandes").
        </div>
      </div>

      {form.group_id && localGroups.length > 1 && (
        <div className="field">
          <label>Segundo grupo (opcional — solo para partidos interconferencia)</label>
          <select
            value={form.group_id_2 || ''}
            onChange={(e) => update('group_id_2', e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— Ninguno (partido normal dentro del grupo) —</option>
            {localGroups.filter((g) => g.id !== form.group_id).map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 4 }}>
            Úsalo solo si este partido es un cruce entre dos conferencias distintas (ej. "14 Grandes" vs "Nacional-Norte").
          </div>
        </div>
      )}

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

      {/* Marcador — se pide cuando el horario dice que el partido ya terminó,
          o si ya tenía un marcador capturado de antes (para poder editarlo). */}
      {showScoreFields && (
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

    {showVenueModal && (
      <Modal title="Nueva sede" onClose={() => setShowVenueModal(false)}>
        {venueError && <div className="form-error">{venueError}</div>}
        <VenueForm
          submitLabel="Crear sede"
          onCancel={() => setShowVenueModal(false)}
          onSubmit={handleCreateVenue}
        />
      </Modal>
    )}

    {creatingTeamFor && (
      <Modal title="Nuevo equipo" onClose={() => setCreatingTeamFor(null)}>
        {teamError && <div className="form-error">{teamError}</div>}
        <TeamForm
          submitLabel="Crear equipo"
          onCancel={() => setCreatingTeamFor(null)}
          onSubmit={handleCreateTeam}
        />
      </Modal>
    )}

    {showGroupModal && (
      <Modal title="Nuevo grupo" onClose={() => setShowGroupModal(false)}>
        {groupError && <div className="form-error">{groupError}</div>}
        <GroupForm
          submitLabel="Crear grupo"
          onCancel={() => setShowGroupModal(false)}
          onSubmit={handleCreateGroup}
        />
      </Modal>
    )}
    </>
  );
}
