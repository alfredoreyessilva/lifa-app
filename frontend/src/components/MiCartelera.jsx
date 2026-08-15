import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { getMatchStatus } from '../utils/matchStatus.js';
import MatchCard from './MatchCard.jsx';

const PICK_LABELS = { home: 'Local', away: 'Visitante', tie: 'Empate' };

// Se coloca debajo de OrgLogoBar en Dashboard.jsx. Es un lugar temporal —
// más adelante puede que esto se mueva a su propia pantalla.
//
// Cada partido se pinta con el mismo MatchCard que usa el calendario (para
// que se vea idéntico), y debajo se agrega un renglón chico con las
// etiquetas propias de la cartelera (por qué está aquí: notificación y/o
// predicción) — eso no es parte de MatchCard porque no aplica en el
// calendario normal.
export default function MiCartelera() {
  const { token } = useAuth();
  const [board, setBoard]   = useState(null);
  const [error, setError]   = useState('');

  useEffect(() => {
    api.getBoard(token).then(setBoard).catch((e) => setError(e.message));
  }, [token]);

  if (error) return null; // no tiene sentido tronar el panel entero por esto
  if (!board) return null; // cargando, sin parpadeo de "vacío" mientras tanto

  if (board.length === 0) {
    return (
      <div style={{ marginBottom: 24 }}>
        <div className="section-head">
          <h2>Mi cartelera</h2>
        </div>
        <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
          Todavía no tienes partidos aquí. Pide que te avisen de un partido, o vota quién gana en uno próximo.
        </p>
      </div>
    );
  }

  const upcoming = board
    .filter((m) => getMatchStatus(m) !== 'finished')
    .sort((a, b) => new Date(a.match_date) - new Date(b.match_date));
  const past = board
    .filter((m) => getMatchStatus(m) === 'finished')
    .sort((a, b) => new Date(b.match_date) - new Date(a.match_date));

  return (
    <div style={{ marginBottom: 24 }}>
      <div className="section-head">
        <h2>Mi cartelera</h2>
        <span className="count">{board.length}</span>
      </div>

      {upcoming.length > 0 && (
        <div className="match-grid">
          {upcoming.map((m) => <BoardItem key={m.id} match={m} />)}
        </div>
      )}

      {past.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 16, color: 'var(--ink-dim)' }}>Partidos pasados</h3>
          </div>
          <div className="match-grid">
            {past.map((m) => <BoardItem key={m.id} match={m} />)}
          </div>
        </>
      )}
    </div>
  );
}

function BoardItem({ match }) {
  return (
    <div>
      <MatchCard match={match} />
      <div className="board-item-tags">
        {match.league_name && <span className="tag">{match.league_name}</span>}
        {match.notified  && <span className="tag" style={{ color: 'var(--flag)', borderColor: 'var(--flag)' }}>🔔 Notificación</span>}
        {match.predicted && (
          <span className="tag" style={{ color: 'var(--field)', borderColor: 'var(--field)' }}>
            🎯 Tu predicción: {PICK_LABELS[match.myPick]}
          </span>
        )}
      </div>
    </div>
  );
}
