import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { getMatchStatus } from '../utils/matchStatus.js';
import { getMatchParts, initials } from '../utils/matchDisplay.js';

const PICK_LABELS = { home: 'Local', away: 'Visitante', tie: 'Empate' };

// Se coloca debajo de OrgLogoBar en Dashboard.jsx. Es un lugar temporal —
// más adelante puede que esto se mueva a su propia pantalla.
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
        <div className="board-list">
          {upcoming.map((m) => <BoardItem key={m.id} match={m} />)}
        </div>
      )}

      {past.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 16, color: 'var(--ink-dim)' }}>Partidos pasados</h3>
          </div>
          <div className="board-list">
            {past.map((m) => <BoardItem key={m.id} match={m} />)}
          </div>
        </>
      )}
    </div>
  );
}

function BoardItem({ match }) {
  const status = getMatchStatus(match);
  const { day, month, time } = getMatchParts(match.match_date, match.timezone);

  return (
    <Link to={`/partidos/${match.id}`} className="board-item">
      <div className="board-item-league">{match.league_name}</div>

      <div className="board-item-body">
        <BoardTeam name={match.home_team} logoUrl={match.home_logo_url} />
        <div className="board-item-score">
          {status === 'finished' && match.home_score !== null
            ? <><span>{match.home_score}</span><span className="match-card-score-sep">—</span><span>{match.away_score}</span></>
            : status === 'live'
              ? <span className="match-card-score-live">EN VIVO</span>
              : <span className="match-card-score-vs">{day} {month} · {time}</span>}
        </div>
        <BoardTeam name={match.away_team} logoUrl={match.away_logo_url} />
      </div>

      <div className="board-item-tags">
        {match.notified  && <span className="tag" style={{ color: 'var(--flag)', borderColor: 'var(--flag)' }}>🔔 Notificación</span>}
        {match.predicted && (
          <span className="tag" style={{ color: 'var(--field)', borderColor: 'var(--field)' }}>
            🎯 Tu predicción: {PICK_LABELS[match.myPick]}
          </span>
        )}
        {status === 'live'     && <span className="tag live">🔴 En vivo</span>}
        {status === 'finished' && <span className="tag finished">Finalizado</span>}
      </div>
    </Link>
  );
}

function BoardTeam({ name, logoUrl }) {
  return (
    <div className="match-card-team">
      <div className="match-card-logo">
        {logoUrl ? <img src={logoUrl} alt={name} /> : <span>{initials(name)}</span>}
      </div>
      <div className="match-card-team-name">{name}</div>
    </div>
  );
}
