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
// etiquetas propias de la cartelera (por qué está aquí: lo sigues y/o lo
// predijiste) — eso no es parte de MatchCard porque no aplica en el
// calendario normal.
//
// Desde el 2026-09-24 es también donde se deja de seguir un partido: la
// sección "Partidos que sigo" de Notificaciones leía lo mismo y se retiró
// (README, "Notificaciones").
export default function MiCartelera() {
  const { token } = useAuth();
  const [board, setBoard]   = useState(null);
  const [error, setError]   = useState('');
  const [dejando, setDejando] = useState(null);
  const [aviso, setAviso]   = useState('');

  function cargar() {
    return api.getBoard(token).then(setBoard).catch((e) => setError(e.message));
  }

  useEffect(() => {
    cargar();
  }, [token]);

  async function dejarDeSeguir(matchId) {
    setDejando(matchId);
    setAviso('');
    try {
      await api.unfollowMatch(matchId, token);
      // Se vuelve a pedir en vez de quitarlo a mano: si también lo predijiste,
      // se queda en la cartelera, solo que ya sin "Siguiendo".
      await cargar();
    } catch (e) {
      setAviso(e.offline ? 'Sin conexión: inténtalo cuando vuelva la señal.' : 'No se pudo dejar de seguir.');
    } finally {
      setDejando(null);
    }
  }

  if (error) return null; // no tiene sentido tronar el panel entero por esto
  if (!board) return null; // cargando, sin parpadeo de "vacío" mientras tanto

  if (board.length === 0) {
    return (
      <div style={{ marginBottom: 24 }}>
        <div className="section-head">
          <h2>Mi cartelera</h2>
        </div>
        <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
          Todavía no tienes partidos aquí. Sigue un partido o a un equipo, o vota quién gana en uno próximo.
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

      {aviso && <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>{aviso}</p>}

      {upcoming.length > 0 && (
        <div className="match-grid">
          {upcoming.map((m) => (
            <BoardItem key={m.id} match={m} onUnfollow={dejarDeSeguir} unfollowing={dejando === m.id} />
          ))}
        </div>
      )}

      {past.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 16, color: 'var(--ink-dim)' }}>Partidos pasados</h3>
          </div>
          <div className="match-grid">
            {past.map((m) => (
              <BoardItem key={m.id} match={m} onUnfollow={dejarDeSeguir} unfollowing={dejando === m.id} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BoardItem({ match, onUnfollow, unfollowing }) {
  return (
    <div>
      <MatchCard match={match} />
      <div className="board-item-tags">
        {match.league_name && <span className="tag">{match.league_name}</span>}
        {/* Lo sigues directo: se deja desde aquí. Por su equipo: se deja desde
            la página del equipo, porque ese seguimiento cubre todos sus
            partidos y no solo este. */}
        {match.followed_directly && (
          <>
            <span className="tag" style={{ color: 'var(--flag)', borderColor: 'var(--flag)' }}>✓ Siguiendo</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onUnfollow(match.id)}
              disabled={unfollowing}
              style={{ fontSize: 11, padding: '2px 8px' }}
            >
              {unfollowing ? 'Quitando…' : 'Dejar de seguir'}
            </button>
          </>
        )}
        {!match.followed_directly && match.followed_team && (
          <span className="tag" style={{ color: 'var(--flag)', borderColor: 'var(--flag)' }}>
            ✓ Sigues a {match.followed_team}
          </span>
        )}
        {match.predicted && (
          <span className="tag" style={{ color: 'var(--field)', borderColor: 'var(--field)' }}>
            🎯 Tu predicción: {PICK_LABELS[match.myPick]}
          </span>
        )}
      </div>
    </div>
  );
}
