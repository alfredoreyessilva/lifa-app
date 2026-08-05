import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import TeamForm from './TeamForm.jsx';
import Modal from './Modal.jsx';

// Roster de liga: equipos "de la casa" de una liga (tabla league_teams).
// Un equipo aquí queda elegible automáticamente para cualquier torneo de
// esta liga, presente o futuro, sin inscripción aparte (ver resolveTeamId
// en manage.js). Un mismo equipo puede ser miembro de varias ligas a la vez.
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
      </div>

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
      {roster && roster.length > 0 && roster.map((team) => (
        <div key={team.id} className="admin-match-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {team.logo_url && (
              <div style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
                <img src={team.logo_url} alt={team.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}
            <div>
              <div className="who">{team.name}</div>
              <div className="info">{team.location || 'Sin ubicación'}</div>
            </div>
          </div>
          <div className="row-actions">
            <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--flag)' }} onClick={() => handleRemove(team)}>
              Quitar
            </button>
          </div>
        </div>
      ))}

      {showCreate && (
        <Modal title="Crear equipo nuevo" onClose={() => setShowCreate(false)}>
          <TeamForm
            submitLabel="Crear y agregar al roster"
            onCancel={() => setShowCreate(false)}
            onSubmit={handleCreate}
          />
        </Modal>
      )}
    </div>
  );
}