import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import TournamentForm from '../components/TournamentForm.jsx';
import Modal from '../components/Modal.jsx';

// Lista y crea los Torneos de una liga para un año específico.
// Ruta: /panel/liga/:id/:year
//
// A propósito, todavía NO está conectada desde ningún clic real de "mi
// panel" — se llega escribiendo la URL a mano, igual que hicimos con
// /anios y /torneo-test al principio. El siguiente paso (aparte) conecta
// el clic del logo de la liga para que llegue aquí de forma natural.
export default function TournamentsYearPanel() {
  const { id, year } = useParams();
  const { token, leagues } = useAuth();
  const league = leagues.find((lg) => String(lg.id) === id);

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
          <h1>Torneos {year}</h1>
        </div>
        <button className="btn btn-flag" onClick={() => setShowCreate(true)}>+ Crear torneo</button>
      </div>

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
            <div key={t.id} className="league-card">
              <h3>{t.name}</h3>
              <span className="state">{t.year}</span>
            </div>
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
    </div>
  );
}
