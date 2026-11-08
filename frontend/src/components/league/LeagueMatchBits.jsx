import { Status } from '../admin/AdminKit.jsx';
import { fechaCorta, getMatchParts, initials } from '../../utils/matchDisplay.js';

// Cómo se escribe un partido en el panel de una liga: los dos equipos uno sobre
// otro con su marcador a la derecha, como en cualquier tabla de resultados. Lo
// usan el calendario de una rama y el Resumen.

// El escudo de cada equipo de la liga, por id. El partido trae solo el nombre y
// el id de sus equipos.
export function teamLogos(tree) {
  const map = new Map();
  for (const tm of tree?.teams ?? []) if (tm.logo_url) map.set(tm.id, tm.logo_url);
  return map;
}

const hayMarcador = (m) => m.home_score !== null && m.home_score !== undefined
  && m.away_score !== null && m.away_score !== undefined;

export function MatchTeams({ match, logos }) {
  const conMarcador = hayMarcador(match);
  const local = Number(match.home_score);
  const visita = Number(match.away_score);
  return (
    <div className="lws-match">
      <TeamLine
        name={match.home_team}
        logo={logos.get(match.home_team_id)}
        score={conMarcador ? match.home_score : null}
        lost={conMarcador && local < visita}
      />
      <TeamLine
        name={match.away_team}
        logo={logos.get(match.away_team_id)}
        score={conMarcador ? match.away_score : null}
        lost={conMarcador && visita < local}
      />
    </div>
  );
}

function TeamLine({ name, logo, score, lost }) {
  return (
    <div className={`lws-match-line${lost ? ' is-lost' : ''}`}>
      {logo
        ? <img className="lws-match-logo" src={logo} alt="" loading="lazy" />
        : <span className="lws-match-logo is-initials" aria-hidden="true">{initials(name) || '–'}</span>}
      <span className="lws-match-name" title={name}>{name}</span>
      {score !== null && <span className="lws-match-score">{score}</span>}
    </div>
  );
}

// "Sáb 6 sep" arriba y la hora abajo, en la zona del partido.
export function MatchWhen({ match }) {
  if (!match.match_date) return <span className="lws-when is-tbd">Por definir</span>;
  const { time } = getMatchParts(match.match_date, match.timezone);
  return (
    <span className="lws-when">
      <span>{fechaCorta(match.match_date, match.timezone)}</span>
      <span className="lws-when-time">{time}</span>
    </span>
  );
}

// Lo que dice la columna de estado. Amarillo solo lo que le toca a la liga.
const ESTADOS = {
  live:     { tone: 'live', text: 'En vivo' },
  played:   { tone: 'on',   text: 'Final', check: true },
  missing:  { tone: 'ask',  text: 'Falta marcador' },
  unclosed: { tone: 'ask',  text: 'Falta cerrarlo', title: 'Tiene marcador, pero nadie lo marcó como final: el calendario lo sigue enseñando como programado.' },
  upcoming: { tone: 'off',  text: 'Por jugar' },
};

export function MatchState({ match }) {
  const estado = ESTADOS[match.state] ?? ESTADOS.upcoming;
  // Un borrador no está publicado: que le falte el marcador no le pide nada a la
  // liga todavía, y no se pinta de amarillo (ver `needsCapture`).
  const tone = match.is_draft && estado.tone === 'ask' ? 'off' : estado.tone;
  return (
    <span className="lws-state">
      <Status tone={tone} check={estado.check} title={estado.title}>{estado.text}</Status>
      {match.is_draft && (
        <span className="lws-draft" title="Un borrador no sale en el calendario público hasta que lo publiques.">
          Borrador
        </span>
      )}
    </span>
  );
}
