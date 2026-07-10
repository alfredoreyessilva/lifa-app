import { Link } from 'react-router-dom';
import { getMatchStatus } from '../utils/matchStatus.js';
import { getMatchParts, initials } from '../utils/matchDisplay.js';
import { shareLink } from '../utils/share.js';
import { useState } from 'react';

export default function CrossLeagueMatchCard({ match }) {
  const { day, month, time, tzLabel } = getMatchParts(match.match_date, match.timezone || match.league_timezone);
  const status      = getMatchStatus(match);
  const isFinished  = status === 'finished';
  const isLive      = status === 'live';
  const [shareState, setShareState] = useState('idle');

  async function handleShare() {
    const url = `${window.location.origin}/partidos/${match.id}`;
    const result = await shareLink(
      url,
      `${match.home_team} vs ${match.away_team}`,
      'Mira este partido en LIFA'
    );
    if (result === 'copied') {
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 2000);
    }
  }

  return (
    <div className={`match-card-new${isLive ? ' match-card-new--live' : ''}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 12, color: 'var(--ink-dim)', fontFamily: 'var(--font-eyebrow)', letterSpacing: '0.05em' }}>
        {match.league_logo_url && (
          <img src={match.league_logo_url} alt={match.league_name} style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
        )}
        <span>{match.league_name}{match.category_name ? ` · ${match.category_name}` : ''}</span>
      </div>

      <div className="match-card-header">
        <div className="match-card-datetime">
          <span className="match-card-date">{day} {month}</span>
          <span className="match-card-time">{time}</span>
          <span className="match-card-tz">{tzLabel}</span>
        </div>
        <div className="match-card-status">
          {isLive     && <span className="tag live">🔴 En vivo</span>}
          {isFinished && <span className="tag finished">Finalizado</span>}
        </div>
      </div>

      <Link to={`/partidos/${match.id}`} className="match-card-body" style={{ textDecoration: 'none', color: 'inherit' }}>
        <div className="match-card-team">
          <div className="match-card-logo">
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
          <div className="match-card-logo">
            {match.away_logo_url ? <img src={match.away_logo_url} alt={match.away_team} /> : <span>{initials(match.away_team)}</span>}
          </div>
          <div className="match-card-team-name">{match.away_team}</div>
        </div>
      </Link>

      {(match.venue || match.week_label) && (
        <div className="match-card-meta">
          {match.week_label && <span>{/^\d+$/.test(match.week_label) ? `Jornada ${match.week_label}` : match.week_label}</span>}
          {match.venue && <span>{match.venue}</span>}
        </div>
      )}

      <div className="match-card-actions">
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
          {shareState === 'copied' ? '✓ Link copiado' : '🔗 Compartir'}
        </button>
      </div>
    </div>
  );
}