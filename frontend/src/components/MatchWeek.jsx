import { useState } from 'react';
import { Link } from 'react-router-dom';
import TeamMark from './TeamMark.jsx';
import { getMatchParts, jornadaLabel } from '../utils/matchDisplay.js';
import { getMatchStatus } from '../utils/matchStatus.js';

const VISIBLES = 6;

// Lo de la derecha de cada renglón: el marcador si ya hay, y si no, cuándo es.
function Cuando({ partido, status }) {
  const { day, month, time, porDefinir } = getMatchParts(partido.match_date, partido.timezone);
  const hayMarcador = partido.home_score !== null && partido.away_score !== null;

  if (status !== 'scheduled' && hayMarcador) {
    return (
      <span className="mp-week-score">
        <b>{partido.home_score}</b>
        <b>{partido.away_score}</b>
      </span>
    );
  }
  if (status === 'live') return <span className="mp-week-live">En vivo</span>;
  if (porDefinir) return <span className="mp-week-when">Por definir</span>;
  return <span className="mp-week-when">{day} {month}<br />{time}</span>;
}

// La jornada completa, para pasar a otro partido sin regresar al calendario.
// Tiene el lugar que tenía "Ver calendario completo", que se queda abajo.
export default function MatchWeek({ match, contexto }) {
  const [todos, setTodos] = useState(false);
  const partidos = contexto?.week || [];
  const calendario = match.tournament_id
    ? `/torneos/${match.tournament_id}`
    : match.category_id ? `/categorias/${match.category_id}/calendario` : null;

  if (partidos.length === 0 && !calendario) return null;

  const visibles = todos ? partidos : partidos.slice(0, VISIBLES);

  return (
    <section className="mp-sec">
      <h2 className="mp-title">{partidos.length > 0 ? `También en ${jornadaLabel(match.week_label)}` : 'Calendario'}</h2>

      {partidos.length > 0 && (
        <ul className="mp-week">
          {visibles.map((p) => (
            <li key={p.id}>
              <Link to={`/partidos/${p.id}`} className="mp-week-row">
                <span className="mp-week-teams">
                  <span><TeamMark name={p.home_team} logoUrl={p.home_logo_url} size={22} />{p.home_team}</span>
                  <span><TeamMark name={p.away_team} logoUrl={p.away_logo_url} size={22} />{p.away_team}</span>
                </span>
                <Cuando partido={p} status={getMatchStatus(p)} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mp-week-foot">
        {partidos.length > VISIBLES && !todos && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTodos(true)}>
            Ver los {partidos.length}
          </button>
        )}
        {calendario && <Link to={calendario} className="btn btn-outline btn-sm">Ver calendario completo</Link>}
      </div>
    </section>
  );
}
