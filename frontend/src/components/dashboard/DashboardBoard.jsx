import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import MatchCard from '../MatchCard.jsx';
import { SectionError, SectionLoading } from '../admin/AdminKit.jsx';
import { IconCheck } from '../admin/AdminIcons.jsx';
import { formatNumber } from '../../utils/adminPanel.js';
import { BOARD_FIRST, BOARD_STEP, boardReasons } from '../../utils/dashboard.js';

// "Mi cartelera" en Mi panel: los partidos que sigues y en los que votaste
// (GET /board), partida en Próximos y Pasados. Cada uno es la tarjeta del
// calendario, y al pie, dentro de ella, por qué está aquí. README, "Mi panel".
//
// Desde el 2026-09-24 es también donde se deja de seguir un partido: la sección
// "Partidos que sigo" de Notificaciones leía lo mismo y se retiró.
export default function DashboardBoard({ board, upcoming, past, now, error, token, reload }) {
  const [leaving, setLeaving] = useState(null);
  const [failed, setFailed] = useState(null);

  async function unfollow(matchId) {
    setLeaving(matchId);
    setFailed(null);
    try {
      await api.unfollowMatch(matchId, token);
    } catch (e) {
      setFailed({
        id: matchId,
        message: e.offline ? 'Sin conexión: inténtalo cuando vuelva la señal.' : 'No se pudo dejar de seguir.',
      });
      setLeaving(null);
      return;
    }
    // Se vuelve a pedir en vez de quitarlo a mano: si también votaste en él, se
    // queda en la cartelera, solo que ya sin "Lo sigues".
    try { await reload(); } catch { /* la lista vieja sirve hasta la próxima visita */ }
    setLeaving(null);
  }

  const footerFor = (match) => (
    <BoardFoot
      match={match}
      now={now}
      onUnfollow={unfollow}
      leaving={leaving === match.id}
      error={failed?.id === match.id ? failed.message : null}
    />
  );

  return (
    <section className="dsh-section" aria-labelledby="dsh-board-title">
      <header className="dsh-head">
        <div>
          <h2 id="dsh-board-title">Mi cartelera</h2>
          <p className="dsh-head-sub">Los partidos que sigues y en los que votaste</p>
        </div>
      </header>

      {error ? <SectionError messages={[error]} />
        : !board ? <SectionLoading />
          : board.length === 0 ? (
            <div className="adm-no-results">
              <p>
                Todavía no tienes partidos aquí. Sigue un partido o a un equipo, o vota quién gana en uno
                próximo.
              </p>
              <Link to="/" className="btn btn-ws btn-sm">Ver ligas y equipos</Link>
            </div>
          ) : (
            <>
              {upcoming.length > 0 && <BoardList title="Próximos" matches={upcoming} footerFor={footerFor} />}
              {past.length > 0 && <BoardList title="Pasados" matches={past} footerFor={footerFor} />}
            </>
          )}
    </section>
  );
}

// Seis, y "Ver más" de doce en doce: quien votó la temporada de ONEFA trae más de
// 120 partidos pasados, y se pintaban todos.
function BoardList({ title, matches, footerFor }) {
  const [shown, setShown] = useState(BOARD_FIRST);
  const visible = matches.slice(0, shown);
  const left = matches.length - visible.length;

  return (
    <div className="dsh-list">
      <h3 className="dsh-subhead">
        {title} <span className="dsh-count">{formatNumber(matches.length)}</span>
      </h3>
      <div className="dsh-grid">
        {visible.map((match) => <MatchCard key={match.id} match={match} footer={footerFor(match)} />)}
      </div>
      {left > 0 && (
        <button type="button" className="btn btn-ws btn-sm dsh-more" onClick={() => setShown((n) => n + BOARD_STEP)}>
          Ver más <span className="dsh-more-left">· quedan {formatNumber(left)}</span>
        </button>
      )}
    </div>
  );
}

function BoardFoot({ match, now, onUnfollow, leaving, error }) {
  const reasons = boardReasons(match, now);
  return (
    <div className="dsh-foot">
      {match.league_name && <span className="dsh-foot-league">{match.league_name}</span>}
      {reasons.map((reason) => (
        <span key={reason.key} className={`dsh-foot-reason is-${reason.key}`}>
          {reason.key !== 'voto' && <IconCheck />}
          {reason.text}
          {reason.unfollow && (
            <button
              type="button"
              className="dsh-foot-action"
              onClick={() => onUnfollow(match.id)}
              disabled={leaving}
              aria-label={`Dejar de seguir ${match.home_team} contra ${match.away_team}`}
            >
              {leaving ? 'Quitando…' : 'Dejar de seguir'}
            </button>
          )}
        </span>
      ))}
      {error && <span className="dsh-foot-error" role="alert">{error}</span>}
    </div>
  );
}
