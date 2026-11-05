import { Link } from 'react-router-dom';
import TeamMark from './TeamMark.jsx';
import { filasCaraACara } from '../utils/matchCompare.js';
import { jornadaLabel } from '../utils/matchDisplay.js';

const RESULTADO = { G: 'Ganó', P: 'Perdió', E: 'Empató' };

// Una columna de "Cómo llegan". Local y visitante, porque en esa lista "vs"
// y "en" dicen dónde se jugó cada partido.
function Trayectoria({ nombre, logo, lado }) {
  const resultados = lado?.recent || [];
  return (
    <div className="mp-recent">
      <h3 className="mp-recent-team"><TeamMark name={nombre} logoUrl={logo} size={30} />{nombre}</h3>
      {resultados.length === 0 ? (
        <p className="mp-note">Es su primer partido de la temporada.</p>
      ) : (
        <ol className="mp-recent-list">
          {resultados.map((r) => (
            <li key={r.match_id}>
              <Link to={`/partidos/${r.match_id}`} className="mp-recent-row">
                <span className={`mp-chip mp-chip--${r.result}`} title={RESULTADO[r.result]}>{r.result}</span>
                <span className="mp-recent-rival">
                  <small>{r.is_home ? 'vs' : 'en'}</small> {r.opponent}
                </span>
                <span className="mp-recent-score">{r.scored}-{r.allowed}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Las tres secciones que salen de GET /leagues/matches/:id/context. Cada una se
// pinta solo si tiene algo: un equipo que no está inscrito en la rama, una
// primera jornada o dos que nunca se han visto simplemente no llevan la suya.
export default function MatchCompare({ match, contexto, terminado }) {
  const home = contexto?.home;
  const away = contexto?.away;
  const filas = filasCaraACara(home, away);
  const previos = contexto?.head_to_head || [];
  const hayTrayectoria = (home?.recent?.length || 0) + (away?.recent?.length || 0) > 0;

  return (
    <>
      {filas.length > 0 && (
        <section className="mp-sec">
          <h2 className="mp-title">Cara a cara</h2>
          <table className="mp-tape">
            <caption className="mp-sr">
              {terminado ? 'Cómo llegó cada equipo a este partido' : 'Cómo llega cada equipo a este partido'}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="mp-tape-team mp-tape-team--home">
                  <span className="mp-tape-who">
                    <TeamMark name={match.home_team} logoUrl={match.home_logo_url} size={34} />
                    <span>{match.home_team}</span>
                  </span>
                </th>
                <td />
                <th scope="col" className="mp-tape-team mp-tape-team--away">
                  <span className="mp-tape-who">
                    <TeamMark name={match.away_team} logoUrl={match.away_logo_url} size={34} />
                    <span>{match.away_team}</span>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.key}>
                  <td className={f.lead === 'home' ? 'is-lead is-lead--home' : ''}>{f.home}</td>
                  <th scope="row">{f.label}</th>
                  <td className={f.lead === 'away' ? 'is-lead is-lead--away' : ''}>{f.away}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {hayTrayectoria && (
        <section className="mp-sec">
          <h2 className="mp-title">{terminado ? 'Cómo llegaron' : 'Cómo llegan'}</h2>
          <div className="mp-recents">
            <Trayectoria nombre={match.home_team} logo={match.home_logo_url} lado={home} />
            <Trayectoria nombre={match.away_team} logo={match.away_logo_url} lado={away} />
          </div>
        </section>
      )}

      {previos.length > 0 && (
        <section className="mp-sec">
          <h2 className="mp-title">Antes se enfrentaron</h2>
          <ul className="mp-h2h">
            {previos.map((p) => (
              <li key={p.id}>
                <Link to={`/partidos/${p.id}`} className="mp-h2h-row">
                  <span className="mp-h2h-game">
                    <span>{p.home_team}</span>
                    <b>{p.home_score}-{p.away_score}</b>
                    <span>{p.away_team}</span>
                  </span>
                  <small>
                    {[p.tournament_name, p.tournament_year].filter(Boolean).join(' ')}
                    {p.week_label ? `, ${jornadaLabel(p.week_label)}` : ''}
                  </small>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
