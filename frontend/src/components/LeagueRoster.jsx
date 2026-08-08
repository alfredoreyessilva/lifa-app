import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import TeamForm from './TeamForm.jsx';
import Modal from './Modal.jsx';
import InviteTeamModal from './InviteTeamModal.jsx';

// Roster de liga: equipos "de la casa" de una liga (tabla league_teams).
// Un equipo aquí queda elegible automáticamente para cualquier torneo de
// esta liga, presente o futuro, sin inscripción aparte (ver resolveTeamId
// en manage.js). Un mismo equipo puede ser miembro de varias ligas a la vez.
//
// Editar el perfil de un equipo e invitar/quitar su representante son
// acciones que el backend SOLO permite a la liga DUEÑA original del equipo
// (team.league_id), no a cualquier liga que lo tenga en su roster — por
// eso esos botones solo aparecen cuando isHomeLeague es cierto; si no, se
// muestra de qué liga es en vez de botones que fallarían.
//
// Se usa como pestaña dentro de TournamentsYearPanel.jsx.
export default function LeagueRoster({ leagueId, token }) {
  const [roster, setRoster] = useState(null);
  const [error, setError] = useState('');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);

  const [showCreate, setShowCreate] = useState(false);
  const [adding, setAdding] = useState(false);

  const [editingTeam, setEditingTeam] = useState(null); // equipo a editar, o null
  const [inviteTeam,  setInviteTeam]  = useState(null); // equipo a invitar, o null

  const [syncing, setSyncing] = useState(false);
  const [syncReport, setSyncReport] = useState(null);

  async function handleSyncMatches() {
    setSyncing(true);
    setSyncReport(null);
    setError('');
    try {
      const report = await api.syncRosterMatches(leagueId, token);
      setSyncReport(report);
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  function refresh() {
    api.getLeagueRoster(leagueId, token).then(setRoster).catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (leagueId && token) refresh();
  }, [leagueId, token]);

  // Busca equipos por nombre mientras escribes, con un pequeño retraso
  // para no disparar una petición por cada tecla.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(() => {
      api.searchTeams(q, token)
        .then(setResults)
        .catch((e) => setError(e.message))
        .finally(() => setSearching(false));
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [query, token]);

  const memberIds = new Set((roster || []).map((t) => t.id));

  async function handleAdd(team) {
    setError('');
    setAdding(true);
    try {
      await api.addTeamToRoster(leagueId, team.id, token);
      setQuery('');
      setResults([]);
      refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(team) {
    if (!window.confirm(`¿Quitar a "${team.name}" del roster de esta liga? Ya no será elegible automáticamente en los torneos de esta liga (sus partidos ya jugados no se borran).`)) return;
    setError('');
    try {
      await api.removeTeamFromRoster(leagueId, team.id, token);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleCreate(data) {
    const newTeam = await api.createTeam(leagueId, data, token);
    await api.addTeamToRoster(leagueId, newTeam.id, token);
    setShowCreate(false);
    refresh();
  }

  async function handleEditSubmit(data) {
    await api.updateTeam(editingTeam.id, data, token);
    setEditingTeam(null);
    refresh();
  }

  async function handleRemoveOwner(team) {
    if (!window.confirm(`¿Quitar a la persona que administra "${team.name}"? El equipo y sus datos se quedan igual, solo pierde acceso esa persona.`)) return;
    setError('');
    try {
      await api.removeTeamOwner(team.id, token);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      {error && <div className="form-error">{error}</div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Buscar equipo por nombre para agregarlo…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 240 }}
        />
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowCreate(true)}>
          + Crear equipo nuevo
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={syncing} onClick={handleSyncMatches}>
          {syncing ? 'Conectando…' : 'Conectar equipos con sus partidos'}
        </button>
      </div>

      {syncReport && (
        <div className="form-error" style={{ background: 'rgba(255,255,255,0.08)', color: 'inherit' }}>
          <p>
            {syncReport.connected > 0
              ? <>Se conectaron <strong>{syncReport.connected}</strong> partido(s) que le faltaban a algún equipo.</>
              : 'No se encontró ningún partido pendiente de conectar — todo estaba en orden.'}
          </p>
          <button type="button" className="btn btn-ghost" onClick={() => setSyncReport(null)}>Cerrar</button>
        </div>
      )}

      {query.trim().length >= 2 && (
        <div className="category-block" style={{ marginBottom: 16 }}>
          {searching && <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Buscando…</p>}
          {!searching && results.length === 0 && (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Sin resultados para "{query}".</p>
          )}
          {!searching && results.map((team) => (
            <div key={team.id} className="admin-match-row">
              <div>
                <div className="who">{team.name}</div>
                <div className="info">{team.home_league_name ? `Liga: ${team.home_league_name}` : 'Sin liga asignada'}</div>
              </div>
              <div className="row-actions">
                {memberIds.has(team.id) ? (
                  <span style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Ya es miembro</span>
                ) : (
                  <button type="button" className="btn btn-outline btn-sm" disabled={adding} onClick={() => handleAdd(team)}>
                    Agregar al roster
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {roster === null && <p>Cargando…</p>}
      {roster && roster.length === 0 && (
        <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
          Todavía no hay equipos en el roster de esta liga. Búscalos arriba o crea uno nuevo.
        </p>
      )}
      {roster && roster.length > 0 && roster.map((team) => {
        const isHomeLeague = String(team.league_id) === String(leagueId);
        return (
          <div key={team.id} className="admin-match-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {team.logo_url && (
                <div style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
                  <img src={team.logo_url} alt={team.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
              <div>
                <div className="who">{team.name}</div>
                <div className="info">
                  {isHomeLeague
                    ? (team.owner_user_id ? '👤 Con representante' : (team.location || 'Sin ubicación'))
                    : `Equipo de ${team.home_league_name || 'otra liga'}`}
                </div>
              </div>
            </div>
            <div className="row-actions">
              {isHomeLeague && (
                <>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditingTeam(team)}>
                    Editar
                  </button>
                  {team.owner_user_id ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleRemoveOwner(team)}>
                      Quitar representante
                    </button>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInviteTeam(team)}>
                      Invitar representante
                    </button>
                  )}
                </>
              )}
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--flag)' }} onClick={() => handleRemove(team)}>
                Quitar del roster
              </button>
            </div>
          </div>
        );
      })}

      {showCreate && (
        <Modal title="Crear equipo nuevo" onClose={() => setShowCreate(false)}>
          <TeamForm
            submitLabel="Crear y agregar al roster"
            onCancel={() => setShowCreate(false)}
            onSubmit={handleCreate}
          />
        </Modal>
      )}

      {editingTeam && (
        <Modal title="Editar equipo" onClose={() => setEditingTeam(null)}>
          <TeamForm
            initial={editingTeam}
            submitLabel="Guardar cambios"
            onCancel={() => setEditingTeam(null)}
            onSubmit={handleEditSubmit}
          />
        </Modal>
      )}

      {inviteTeam && (
        <InviteTeamModal
          team={inviteTeam}
          token={token}
          onClose={() => setInviteTeam(null)}
          onDone={() => { setInviteTeam(null); refresh(); }}
        />
      )}
    </div>
  );
}
