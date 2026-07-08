import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Loading from '../components/Loading.jsx';
import SubscribeButton from '../components/SubscribeButton.jsx';
import { getMatchStatus } from '../utils/matchStatus.js';
import { getMatchParts, initials } from '../utils/matchDisplay.js';
import { shareLink } from '../utils/share.js';

export default function MatchPage() {
  const { matchId } = useParams();
  const [match, setMatch]         = useState(null);
  const [error, setError]         = useState('');
  const [shareState, setShareState] = useState('idle');

  useEffect(() => {
    setMatch(null);
    setError('');
    api.getMatch(matchId).then(setMatch).catch((e) => setError(e.message));
  }, [matchId]);

  useEffect(() => {
    if (match) {
      document.title = `${match.home_team} vs ${match.away_team} · LIFA`;
    }
    return () => { document.title = 'LIFA'; };
  }, [match]);

  async function handleShare() {
    const result = await shareLink(
      window.location.href,
      `${match.home_team} vs ${match.away_team}`,
      'Mira este partido en LIFA'
    );
    if (result === 'copied') {
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 2000);
    }
  }

  if (error) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No encontramos este partido</h3>
          <p>{error}</p>
          <Link to="/" className="btn btn-outline" style={{ marginTop: 16 }}>Volver al inicio</Link>
        </div>
      </div>
    );
  }

  if (!match) return <div className="container"><Loading /></div>;

  const { day, month, time, tzLabel } = getMatchParts(match.match_date, match.timezone || match.league_timezone);
  const status        = getMatchStatus(match);
  const isFinished     = status === 'finished';
  const isLive         = status === 'live';
  const isScheduled    = status === 'scheduled';
  const categoryLabel  = [match.season, match.year].filter(Boolean).join(' ');

  return (
    <div className="container">
      <div className="crumb">
        <Link to="/">Inicio</Link>
        {match.league_slug && <> / <Link to={`/ligas/${match.league_slug}`}>{match.league_name}</Link></>}
        {match.category_id && <> / <Link to={`/categorias/${match.category_id}/calendario`}>{match.category_name}</Link></>}
        {' '}/ {match.home_team} vs {match.away_team}
      </div>

      <div
        className={`match-card-new${isLive ? ' match-card-new--live' : ''}`}
        style={{ maxWidth: 520, margin: '24px auto' }}
      >
        <div className="match-card-header">
          <div className="match-card-datetime">
            <span className="match-card-date">{day} {month}</span>
            <span className="match-card-time">{time}</span>
            <span className="match-card-tz">{tzLabel}</span>
          </div>
          <div className="match-card-status">
            {isLive      && <span className="tag live">🔴 En vivo</span>}
            {isFinished  && <span className="tag finished">Finalizado</span>}
            {isScheduled && !isLive && <span className="tag">Programado</span>}
          </div>
        </div>

        <div className="match-card-body">
          <div className="match-card-team">
            <div className="match-card-logo" style={{ width: 64, height: 64 }}>
              {match.home_logo_url ? <img src={match.home_logo_url} alt={match.home_team} /> : <span>{initials(match.home_team)}</span>}
            </div>
            <div className="match-card-team-name">{match.home_team}</div>
          </div>
          <div className="match-card-score">
            {isFinished && match.home_score !== null
              ? <><span>{match.home_score}</span><span className="match-card-score-sep">—</span><span>{match.away_score}</span></>
              : isLive
                ? <span className="match-card-score-live">EN VIVO</span>
                : <span className="match-card-score-vs">VS</span>}
          </div>
          <div className="match-card-team">
            <div className="match-card-logo" style={{ width: 64, height: 64 }}>
              {match.away_logo_url ? <img src={match.away_logo_url} alt={match.away_team} /> : <span>{initials(match.away_team)}</span>}
            </div>
            <div className="match-card-team-name">{match.away_team}</div>
          </div>
        </div>

        {(match.venue || match.week_label || categoryLabel) && (
          <div className="match-card-meta">
            {match.week_label && <span>{/^\d+$/.test(match.week_label) ? `Jornada ${match.week_label}` : match.week_label}</span>}
            {match.venue && <span>{match.venue}</span>}
            {categoryLabel && <span>{categoryLabel}</span>}
          </div>
        )}

        <div className="match-card-actions" style={{ marginTop: 16 }}>
          {match.stream_url && (
            <a href={match.stream_url} target="_blank" rel="noopener noreferrer" className="btn btn-flag btn-sm">
              {isLive ? '🔴 Ver en vivo' : 'Ver partido'}
            </a>
          )}
          {match.tickets_url && (
            <a href={match.tickets_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
              Comprar boletos
            </a>
          )}
          <button className="btn btn-outline btn-sm" type="button" onClick={handleShare}>
            {shareState === 'copied' ? '✓ Link copiado' : '🔗 Compartir partido'}
          </button>
        </div>

        {isScheduled && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
            <SubscribeButton matchId={match.id} label="Avisarme de este partido" />
          </div>
        )}

        {match.category_id && (
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <Link to={`/categorias/${match.category_id}/calendario`} className="btn btn-outline btn-sm">
              Ver calendario completo →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}