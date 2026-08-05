import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import TournamentForm from '../components/TournamentForm.jsx';
import Modal from '../components/Modal.jsx';
import LeagueRoster from '../components/LeagueRoster.jsx';

// Lista y crea los Torneos de una liga para un año específico, y también
// (pestaña aparte) el roster de equipos "de la casa" de la liga.
// Ruta: /panel/liga/:id/:year
//
// Se llega aquí navegando de forma real: clic en el logo de la liga en
// /panel → selector de año (LeagueYearPicker, /panel/liga/:id/anio) →
// se elige un año → aquí.
export default function TournamentsYearPanel() {
  const { id, year } = useParams();
  const { token, leagues } = useAuth();
  const league = leagues.find((lg) => String(lg.id) === id);

  const [tab, setTab] = useState('torneos'); // 'torneos' | 'roster'

  const [tournaments, setTournaments] = useState(null);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  function refresh() {
    api.getTournaments(id, year, token).then(setTournaments).catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (token) refresh();
  }, [id, year, token]);

  if (!token) {
    return <div className="container"><p>Necesitas iniciar sesión para ver esto.</p></div>;
  }

  if (!league) {
    return <div className="container"><p>No administras ninguna liga con ese id.</p></div>;
  }

  return (
    <div className="container">
      <div className="dash-header">
        <div>
          <span className="eyebrow">{league.name}</span>
          <h1>{tab === 'torneos' ? `Torneos ${year}` : 'Equipos de la liga'}</h1>
        </div>
        {tab === 'torneos' && (
          <button className="btn btn-flag" onClick={() => setShowCreate(true)}>+ Crear torneo</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          type="button"
          className={tab === 'torneos' ? 'btn btn-flag btn-sm' : 'btn btn-outline btn-sm'}
          onClick={() => setTab('torneos')}
        >
          Torneos
        </button>
        <button
          type="button"
          className={tab === 'roster' ? 'btn btn-flag btn-sm' : 'btn btn-outline btn-sm'}
          onClick={() => setTab('roster')}
        >
          Equipos de la liga
        </button>
      </div>

      {tab === 'torneos' && (
        <>
          {error && <div className="form-error">{error}</div>}

          {tournaments === null && <p>Cargando…</p>}
          {tournaments && tournaments.length === 0 && (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
              Todavía no has creado ningún torneo para {year}. Crea el primero para empezar.
            </p>
          )}
          {tournaments && tournaments.length > 0 && (
            <div className="league-grid">
              {tournaments.map((t) => (
                <Link key={t.id} to={`/panel/liga/${id}/${year}/torneo/${t.id}`} className="league-card">
                  <h3>{t.name}</h3>
                  <span className="state">{t.year}</span>
                </Link>
              ))}
            </div>
          )}

          {showCreate && (
            <Modal title="Nuevo torneo" onClose={() => setShowCreate(false)}>
              <TournamentForm
                submitLabel="Crear torneo"
                onCancel={() => setShowCreate(false)}
                onSubmit={async (data) => {
                  await api.createTournament(id, { ...data, year }, token);
                  refresh();
                  setShowCreate(false);
                }}
              />
            </Modal>
          )}
        </>
      )}

      {tab === 'roster' && (
        <LeagueRoster leagueId={id} token={token} />
      )}
    </div>
  );
}