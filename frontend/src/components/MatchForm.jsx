import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client.js';
import { required, differentFrom, validUrl, minValue, runValidations } from '../utils/validation.js';
import Modal from './Modal.jsx';
import VenueForm from './VenueForm.jsx';
import TeamForm from './TeamForm.jsx';
import GroupForm from './GroupForm.jsx';
import TimezoneSelect from './TimezoneSelect.jsx';
import LinkListField from './LinkListField.jsx';
import { utcIsoToLocalInputValue } from '../utils/timezones.js';

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

// Valida cada URL de una lista reutilizando el validador de un solo link.
function linksValid(links, label) {
  for (const url of (links || [])) {
    const error = validUrl(url, label);
    if (error) return error;
  }
  return null;
}

export default function MatchForm({
  initial, onSubmit, onCancel, submitLabel, teams, venues, groups,
  leagueTimezone, token, leagueId, categoryId, onVenueCreated, onTeamCreated, onGroupCreated,
  // Nuevo: cuando el formulario NO recibe una Categoría/Rama ya decidida
  // (como pasa en la pantalla "Partidos del Torneo"), se le puede pasar
  // tournamentId + pickCategoryAndBranch=true para que el propio formulario
  // muestre los selects y decida a dónde va el partido. Cuando se usa así,
  // category_id y branch_id viajan DENTRO del payload que recibe onSubmit
  // (en vez de que el componente padre ya los conozca de antemano).
  tournamentId, pickCategoryAndBranch,
}) {
  const defaultTimezone = initial?.timezone || leagueTimezone || 'America/Mexico_City';

  // Selector de Categoría/Rama (solo cuando pickCategoryAndBranch=true).
  const [pickedCategoryId, setPickedCategoryId] = useState(initial?.category_id || '');
  const [pickedBranchId,   setPickedBranchId]   = useState(initial?.branch_id   || '');
  const [pickerCategories, setPickerCategories] = useState(null);
  const [pickerBranches,   setPickerBranches]   = useState(null);

  useEffect(() => {
    if (!pickCategoryAndBranch || !tournamentId) return;
    api.getCategoriesForTournament(tournamentId, token).then(setPickerCategories).catch(() => setPickerCategories([]));
  }, [pickCategoryAndBranch, tournamentId, token]);

  useEffect(() => {
    if (!pickCategoryAndBranch || !pickedCategoryId) { setPickerBranches(null); return; }
    api.getBranches(pickedCategoryId, token).then(setPickerBranches).catch(() => setPickerBranches([]));
  }, [pickCategoryAndBranch, pickedCategoryId, token]);

  const skipFirstCategoryReset = useRef(true);
  useEffect(() => {
    if (skipFirstCategoryReset.current) { skipFirstCategoryReset.current = false; return; }
    setPickedBranchId('');
  }, [pickedCategoryId]);

  const [form, setForm] = useState({
    home_team:   initial?.home_team   || '',
    away_team:   initial?.away_team   || '',
    match_date:  utcIsoToLocalInputValue(initial?.match_date, defaultTimezone) || '',
    venue_id:    initial?.venue_id    || null,
    group_id:    initial?.group_id    || null,
    group_id_2:  initial?.group_id_2  || null,
    stream_links: initial?.stream_links || [],
    ticket_links: initial?.ticket_links || [],
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

  // Junta sin repetir los links ya puestos con los nuevos que llegan del equipo.
  function mergeLinks(existing, extra) {
    const set = new Set(existing);
    for (const url of (extra || [])) { if (url) set.add(url); }
    return Array.from(set);
  }

  // Auto-relleno de links: solo al ARMAR un partido nuevo (no al editar uno ya
  // existente, para no pisar lo que el representante ya haya guardado). Se
  // dispara una sola vez por cada equipo elegido (no en cada letra que escriba
  // el buscador), y el resultado queda editable de inmediato.
  const appliedHomeTeamRef = useRef(null);
  const appliedAwayTeamRef = useRef(null);

  useEffect(() => {
    if (initial) return;
    if (!form.home_team || appliedHomeTeamRef.current === form.home_team) return;
    appliedHomeTeamRef.current = form.home_team;
    const team = (localTeams || []).find((t) => t.name.toLowerCase() === form.home_team.toLowerCase());
    if (!team) return;
    setForm((f) => ({
      ...f,
      stream_links: mergeLinks(f.stream_links, team.home_stream_links),
      ticket_links: mergeLinks(f.ticket_links, team.home_ticket_links),
    }));
  }, [form.home_team, localTeams, initial]);

  useEffect(() => {
    if (initial) return;
    if (!form.away_team || appliedAwayTeamRef.current === form.away_team) return;
    appliedAwayTeamRef.current = form.away_team;
    const team = (localTeams || []).find((t) => t.name.toLowerCase() === form.away_team.toLowerCase());
    if (!team) return;
    setForm((f) => ({
      ...f,
      stream_links: mergeLinks(f.stream_links, team.away_stream_links),
      ticket_links: mergeLinks(f.ticket_links, team.away_ticket_links),
    }));
  }, [form.away_team, localTeams, initial]);

  // Marcador: se puede capturar o corregir en cualquier momento, sin
  // importar el estado del partido — estado y estadísticas son cosas
  // separadas a propósito (ver ruta PATCH /matches/:id/status).
  const showScoreFields = true;

  // Estado manual (nuevo) — independiente del cálculo por reloj de arriba.
  // Solo aplica a un partido que ya existe (uno nuevo todavía no tiene id
  // para poder guardarle un estado antes de haberse creado). Los botones
  // llaman directo a la ruta PATCH /matches/:id/status, sin pasar por el
  // botón "Guardar" del resto del formulario — cambia al instante.
  const [manualStatus, setManualStatus] = useState(initial?.status || 'scheduled');
  const [manualStatusSaving, setManualStatusSaving] = useState(false);
  const [manualStatusError, setManualStatusError] = useState('');

  async function handleManualStatusChange(newStatus) {
    if (!initial?.id) return;
    setManualStatusError('');
    setManualStatusSaving(true);
    try {
      await api.updateMatchStatus(initial.id, newStatus, token);
      setManualStatus(newStatus);
    } catch (e) {
      setManualStatusError(e.message);
    } finally {
      setManualStatusSaving(false);
    }
  }

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

    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(form.match_date || '')) {
      setError('Ingresa una fecha y hora válidas.');
      return;
    }

    const validationError = runValidations([
      () => required(form.home_team, 'El equipo local'),
      () => required(form.away_team, 'El equipo visitante'),
      () => differentFrom(
        form.home_team.trim().toLowerCase(),
        form.away_team.trim().toLowerCase(),
        'El equipo local y el equipo visitante no pueden ser el mismo'
      ),
      () => linksValid(form.stream_links, 'El link de transmisión'),
      () => linksValid(form.ticket_links, 'El link de boletos'),
      () => minValue(form.home_score, 0, 'El marcador local'),
      () => minValue(form.away_score, 0, 'El marcador visitante'),
      () => (pickCategoryAndBranch && !pickedCategoryId ? 'Elige a qué categoría pertenece este partido' : null),
      () => (pickCategoryAndBranch && !pickedBranchId   ? 'Elige a qué rama pertenece este partido'      : null),
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
        stream_links: (form.stream_links || []).filter((u) => u && u.trim()),
        ticket_links: (form.ticket_links || []).filter((u) => u && u.trim()),
        week_label:  form.week_label.trim(),
        match_date_local: form.match_date,
        home_score:  form.home_score === '' ? null : Number(form.home_score),
        away_score:  form.away_score === '' ? null : Number(form.away_score),
        timezone:    form.timezone,
        ...(pickCategoryAndBranch ? { category_id: pickedCategoryId, branch_id: pickedBranchId } : {}),
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

      {initial?.id && (
        <div className="field" style={{ background: 'rgba(255,255,255,0.06)', padding: '12px 16px', borderRadius: 10, marginBottom: 16 }}>
          <label>Estado del partido (nuevo — independiente de "Guardar")</label>
          {manualStatusError && <div className="form-error">{manualStatusError}</div>}
          <div className="pill-group">
            {[
              { value: 'scheduled', label: 'Programado' },
              { value: 'live',      label: 'Iniciado' },
              { value: 'finished',  label: 'Finalizado' },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`pill-btn${manualStatus === opt.value ? ' pill-btn--active' : ''}`}
                disabled={manualStatusSaving || manualStatus === opt.value}
                onClick={() => handleManualStatusChange(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {pickCategoryAndBranch && (
        <div className="field-row">
          <div className="field">
            <label>Categoría</label>
            <select
              required
              value={pickedCategoryId}
              onChange={(e) => setPickedCategoryId(e.target.value)}
            >
              <option value="">— Elige una categoría —</option>
              {(pickerCategories || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Rama</label>
            <select
              required
              value={pickedBranchId}
              onChange={(e) => setPickedBranchId(e.target.value)}
              disabled={!pickedCategoryId}
            >
              <option value="">
                {pickedCategoryId ? '— Elige una rama —' : 'Primero elige una categoría'}
              </option>
              {(pickerBranches || []).map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}

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

      <LinkListField
        label="Links de transmisión (opcional)"
        links={form.stream_links}
        onChange={(v) => update('stream_links', v)}
        hint="Se sugieren solos según los equipos elegidos arriba — puedes agregar, quitar o editar los que quieras para este partido en específico."
      />

      <LinkListField
        label="Links de boletos (opcional)"
        links={form.ticket_links}
        onChange={(v) => update('ticket_links', v)}
      />

      {/* Marcador — se puede capturar o corregir en cualquier momento, sin
          importar el estado del partido. No es obligatorio. */}
      {showScoreFields && (
        <div className="field-row">
          <div className="field">
            <label>Marcador local</label>
            <input
              type="number"
              min="0"
              value={form.home_score}
              onChange={(e) => update('home_score', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Marcador visitante</label>
            <input
              type="number"
              min="0"
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
