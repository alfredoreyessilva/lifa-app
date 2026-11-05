import { usePrediction } from './PredictionWidget.jsx';
import TeamMark from './TeamMark.jsx';

function Opcion({ etiqueta, logo, disabled, onClick, lado }) {
  return (
    <button type="button" className={`mp-pick mp-pick--${lado}`} disabled={disabled} onClick={onClick}>
      {lado !== 'tie' && <TeamMark name={etiqueta} logoUrl={logo} size={64} />}
      <span>{etiqueta}</span>
    </button>
  );
}

// "¿Quién gana?" en la página del partido. Son los mismos votos que el widget
// de las tarjetas del calendario (usePrediction), con espacio para enseñarlos.
//
// `abierta` es lo que ya decidía la pantalla: se vota mientras el partido está
// programado. Mientras se puede votar, el resultado se ve solo después de votar,
// para que no empuje el voto de nadie. Ya cerrada la votación no hay voto que
// empujar, y lo que opinó la afición es parte de la historia del partido.
export default function MatchPoll({ match, abierta }) {
  const { summary, working, pick, authModal } = usePrediction(match.id);

  if (!summary) return null;
  if (!abierta && summary.total === 0) return null;

  const pct = (n) => (summary.total === 0 ? 0 : Math.round((n / summary.total) * 100));
  const opciones = [
    { key: 'home', etiqueta: match.home_team, pct: pct(summary.home) },
    { key: 'tie', etiqueta: 'Empate', pct: pct(summary.tie) },
    { key: 'away', etiqueta: match.away_team, pct: pct(summary.away) },
  ];
  const verResultado = !abierta || Boolean(summary.myPick);
  const miVoto = opciones.find((o) => o.key === summary.myPick);

  return (
    <section className="mp-sec">
      <h2 className="mp-title">{abierta ? '¿Quién gana?' : 'Así votó la afición'}</h2>
      {match.week_label === 'SCRIMMAGE' && <p className="mp-note">Es un scrimmage: no cuenta para el ranking.</p>}

      {verResultado ? (
        <div className="mp-poll">
          <div
            className="mp-poll-bar"
            role="img"
            aria-label={opciones.map((o) => `${o.etiqueta} ${o.pct}%`).join(', ')}
          >
            {opciones.filter((o) => o.pct > 0).map((o) => (
              <i key={o.key} className={`mp-poll-seg mp-poll-seg--${o.key}`} style={{ flexGrow: o.pct }} />
            ))}
          </div>
          <ul className="mp-poll-legend">
            {opciones.map((o) => (
              <li key={o.key} className={`mp-poll-item mp-poll-item--${o.key}`}>
                <b>{o.pct}%</b>
                <span>{o.etiqueta}</span>
              </li>
            ))}
          </ul>
          <p className="mp-poll-total">
            {summary.total} {summary.total === 1 ? 'voto' : 'votos'}
            {miVoto && `. Votaste por ${miVoto.key === 'tie' ? 'el empate' : miVoto.etiqueta}.`}
          </p>
        </div>
      ) : (
        <>
          <div className="mp-poll-picks">
            <Opcion lado="home" etiqueta={match.home_team} logo={match.home_logo_url} disabled={working} onClick={() => pick('home')} />
            <Opcion lado="tie" etiqueta="Empate" disabled={working} onClick={() => pick('tie')} />
            <Opcion lado="away" etiqueta={match.away_team} logo={match.away_logo_url} disabled={working} onClick={() => pick('away')} />
          </div>
          <p className="mp-note">Tu voto es definitivo: no se puede cambiar.</p>
        </>
      )}

      {authModal}
    </section>
  );
}
