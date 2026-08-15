import { Link } from 'react-router-dom';
import { getMatchStatus } from '../utils/matchStatus.js';
import { getMatchParts, initials } from '../utils/matchDisplay.js';
import PredictionWidget from './PredictionWidget.jsx';

export function TeamBadge({ name, logoUrl }) {
  return (
    <div className="match-card-team">
      <div className="match-card-logo">
        {logoUrl ? <img src={logoUrl} alt={name} /> : <span>{initials(name)}</span>}
      </div>
      <div className="match-card-team-name">{name}</div>
    </div>
  );
}

// La tarjeta completa es un solo link hacia la página del partido
// (/partidos/:id), que ya trae todo junto: links de transmisión, boletos,
// ubicación, notificaciones y compartir. Se usa tanto en las listas de
// calendario (CalendarViewer) como en Mi Cartelera — misma tarjeta en los
// dos lugares, no una parecida.
export default function MatchCard({ match, isNext = false }) {
  const { day, month, time, tzLabel } = getMatchParts(match.match_date, match.timezone);
  const status      = getMatchStatus(match);
  const isFinished  = status === 'finished';
  const isLive      = status === 'live';

  // Preferimos la sede real (registrada en el panel); si el partido es viejo
  // y todavía no se le ha asignado una, mostramos el texto libre de respaldo.
  const venueLabel = match.venue_name;
  const groupLabel = match.group_name_2 ? `${match.group_name} vs ${match.group_name_2}` : match.group_name;

  return (
    <Link
      to={`/partidos/${match.id}`}
      className={`match-card-new${isNext ? ' match-card-new--next' : ''}${isLive ? ' match-card-new--live' : ''}`}
    >
      <div className="match-card-header">
        <div className="match-card-datetime">
          <span className="match-card-date">{day} {month}</span>
          <span className="match-card-time">{time}</span>
          <span className="match-card-tz">{tzLabel}</span>
        </div>
        <div className="match-card-status">
          {isNext && !isLive && <span className="tag" style={{ color: 'var(--flag)', borderColor: 'var(--flag)' }}>Próximo</span>}
          {isLive     && <span className="tag live">🔴 En vivo</span>}
          {isFinished && <span className="tag finished">Finalizado</span>}
        </div>
      </div>

      <div className="match-card-body">
        <TeamBadge name={match.home_team} logoUrl={match.home_logo_url} />
        <div className="match-card-score">
          {isFinished && match.home_score !== null
            ? <><span>{match.home_score}</span><span className="match-card-score-sep">—</span><span>{match.away_score}</span></>
            : isLive
              ? <span className="match-card-score-live">EN VIVO</span>
              : <span className="match-card-score-vs">VS</span>}
        </div>
        <TeamBadge name={match.away_team} logoUrl={match.away_logo_url} />
      </div>

      {status === 'scheduled' && (
        <PredictionWidget matchId={match.id} homeTeam={match.home_team} awayTeam={match.away_team} />
      )}

      {(venueLabel || match.week_label || groupLabel) && (
        <div className="match-card-meta">
          {match.week_label && <span>{/^\d+$/.test(match.week_label) ? `Jornada ${match.week_label}` : match.week_label}</span>}
          {groupLabel && <span>{groupLabel}</span>}
          {venueLabel && <span>{venueLabel}</span>}
        </div>
      )}
    </Link>
  );
}
