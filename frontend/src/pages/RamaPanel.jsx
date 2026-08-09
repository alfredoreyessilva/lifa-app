import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import MatchForm from '../components/MatchForm.jsx';
import Modal from '../components/Modal.jsx';

// Pantalla real de una Rama: Calendario (partidos), Equipos y Sedes.
// Ruta: /panel/liga/:id/:year/torneo/:tournamentId/categoria/:categoryId/rama/:branchId
//
// Equipos y Sedes aquí son de SOLO LECTURA — no se inscribe nada a mano:
// simplemente se muestran los equipos/sedes de la liga que ya aparecen
// jugando en los partidos de esta rama (el calendario es la prueba de que
// participan, como quedamos).
export default function RamaPanel() {
  const { id, year, tournamentId, categoryId, branchId } = useParams();
  const { token } = useAuth();

  const [tab, setTab] = useState('calendario');
  const [branch, setBranch] = useState(null);
  const [leagueData, setLeagueData] = useState(null);
  const [matches, setMatches] = useState(null);
  const [conferences, setConferences] = useState([]);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { type: 'create' | 'edit' | 'delete', match? }

  useEffect(() => {
    if (!token) return;
    api.getBranches(categoryId, token)
      .then((list) => setBranch(list.find((b) => String(b.id) === branchId) || null))
      .catch((e) => setError(e.message));
    api.getManageLeague(id, token).then(setLeagueData).catch((e) => setError(e.message));
  }, [id, categoryId, branchId, token]);

  function refreshMatches() {
    api.getBranchMatches(branchId, token).then(setMatches).catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (token) refreshMatches();
  }, [branchId, token]);

  // Conferencias de esta rama, cada una con sus propios grupos anidados —
  // para el selector de dos pasos del formulario de partido (Conferencia,
  // y solo si esa conferencia tiene grupos, Grupo). Una conferencia sin
  // grupos igual aparece en la lista, con groups: [] — así el partido
  // puede colgar directo de ella.
  function refreshConferences() {
    api.getConferences(branchId, token).then(async (confs) => {
      const withGroups = await Promise.all(
        confs.map((c) => api.getTestGroups(c.id, token).then((groups) => ({ id: c.id, name: c.name, groups })))
      );
      setConferences(withGroups);
    }).catch(() => setConferences([]));
  }

  useEffect(() => {
    if (token) refreshConferences();
  }, [branchId, token]);

  if (!token) {
    return <div className="container"><p>Necesitas iniciar sesión para ver esto.</p></div>;
  }

  const teams  = leagueData?.teams  || [];
  const venues = leagueData?.venues || [];
  const leagueTimezone = leagueData?.league?.timezone || 'America/Mexico_City';

  // Equipos/Sedes que de verdad aparecen jugando en esta rama, cruzados con
  // el catálogo de la liga (para tomar su logo si coincide el nombre).
  const teamNamesInBranch = new Set();
  const venueIdsInBranch = new Set();
  (matches || []).forEach((m) => {
    teamNamesInBranch.add(m.home_team);
    teamNamesInBranch.add(m.away_team);
    if (m.venue_id) venueIdsInBranch.add(m.venue_id);
  });
  const teamsInBranch = [...teamNamesInBranch].map((name) => ({
    name,
    logo_url: teams.find((t) => t.name?.toUpperCase() === name?.toUpperCase())?.logo_url || null,
  }));
  const venuesInBranch = venues.filter((v) => venueIdsInBranch.has(v.id));

  return (
    <div className="container">
      <div className="crumb">
        <Link to={`/panel/liga/${id}/${year}/torneo/${tournamentId}/categoria/${categoryId}`}>← Ramas</Link>
      </div>

      <div className="dash-header">
        <div>
          <span className="eyebrow">{branch ? branch.name : 'Cargando…'}</span>
          <h1>Rama</h1>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="tab-bar">
        <button className={`tab-btn ${tab === 'calendario' ? 'active' : ''}`} onClick={() => setTab('calendario')}>Calendario</button>
        <button className={`tab-btn ${tab === 'equipos'    ? 'active' : ''}`} onClick={() => setTab('equipos')}>Equipos</button>
        <button className={`tab-btn ${tab === 'sedes'      ? 'active' : ''}`} onClick={() => setTab('sedes')}>Sedes</button>
      </div>

      {tab === 'calendario' && (
        <>
          <div className="dash-header" style={{ marginTop: 20 }}>
            <Link to={`/panel/liga/${id}/${year}/torneo/${tournamentId}/categoria/${categoryId}/rama/${branchId}/conferencias`}>
              Conferencias y grupos →
            </Link>
            <button className="btn btn-flag" onClick={() => setModal({ type: 'create' })}>+ Crear partido</button>
          </div>

          {matches === null && <p>Cargando…</p>}
          {matches && matches.length === 0 && (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
              Esta rama todavía no tiene partidos. Crea el primero arriba.
            </p>
          )}
          {matches && matches.length > 0 && (
            <ul>
              {matches.map((m) => (
                <li key={m.id} style={{ marginBottom: 10 }}>
                  #{m.id} — {m.home_team} vs {m.away_team} — {new Date(m.match_date).toLocaleString()} — estado: <strong>{m.status}</strong>
                  {' '}
                  <button className="btn btn-ghost" onClick={() => setModal({ type: 'edit', match: m })}>Editar</button>
                  {' '}
                  <button className="btn btn-danger" onClick={() => setModal({ type: 'delete', match: m })}>Eliminar</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === 'equipos' && (
        <div className="league-grid">
          {teamsInBranch.length === 0 && (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
              Todavía no hay equipos — aparecerán aquí en cuanto crees partidos con ellos.
            </p>
          )}
          {teamsInBranch.map((t) => (
            <div key={t.name} className="league-card">
              {t.logo_url ? <img src={t.logo_url} alt={t.name} style={{ width: 56, height: 56, borderRadius: '50%' }} /> : null}
              <h3>{t.name}</h3>
            </div>
          ))}
        </div>
      )}

      {tab === 'sedes' && (
        <div className="league-grid">
          {venuesInBranch.length === 0 && (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
              Todavía no hay sedes — aparecerán aquí en cuanto asignes una sede a un partido.
            </p>
          )}
          {venuesInBranch.map((v) => (
            <div key={v.id} className="league-card">
              <h3>{v.name}</h3>
              {v.institution && <span className="state">{v.institution}</span>}
            </div>
          ))}
        </div>
      )}

      {modal?.type === 'create' && (
        <Modal title="Nuevo partido" onClose={() => setModal(null)}>
          <MatchForm
            submitLabel="Crear partido"
            teams={teams}
            venues={venues}
            groups={[]}
            conferences={conferences}
            leagueTimezone={leagueTimezone}
            token={token}
            leagueId={id}
            categoryId={categoryId}
            onVenueCreated={() => api.getManageLeague(id, token).then(setLeagueData)}
            onTeamCreated={() => api.getManageLeague(id, token).then(setLeagueData)}
            onGroupCreated={refreshConferences}
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.createMatch(categoryId, { ...payload, branch_id: branchId }, token);
              refreshMatches();
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === 'edit' && (
        <Modal title="Editar partido" onClose={() => setModal(null)}>
          <MatchForm
            initial={modal.match}
            submitLabel="Guardar cambios"
            teams={teams}
            venues={venues}
            groups={[]}
            conferences={conferences}
            leagueTimezone={leagueTimezone}
            token={token}
            leagueId={id}
            categoryId={categoryId}
            onVenueCreated={() => api.getManageLeague(id, token).then(setLeagueData)}
            onTeamCreated={() => api.getManageLeague(id, token).then(setLeagueData)}
            onGroupCreated={refreshConferences}
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.updateMatch(modal.match.id, { ...payload, branch_id: branchId }, token);
              refreshMatches();
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === 'delete' && (
        <Modal title="Eliminar partido" onClose={() => setModal(null)}>
          <p>¿Seguro que quieres eliminar <strong>{modal.match.home_team} vs {modal.match.away_team}</strong>?</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={async () => { await api.deleteMatch(modal.match.id, token); refreshMatches(); setModal(null); }}>Eliminar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
