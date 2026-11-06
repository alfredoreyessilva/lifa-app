import { Link } from 'react-router-dom';
import { getMatchStatus } from '../utils/matchStatus.js';
import {
  centroDelPartido, fechaCorta, getMatchParts, rondaDelPartido, sedeDelPartido,
} from '../utils/matchDisplay.js';
import { matchScopeLabel } from '../utils/matchScope.js';
import { useTeamPaint } from '../utils/useTeamPaint.js';
import { Casco, EndZone, Marcador, Yardas } from './MatchField.jsx';
import { IconoMapa } from './MatchIcons.jsx';
import PredictionWidget from './PredictionWidget.jsx';

function Equipo({ lado, nombre, logo, pintura }) {
  return (
    <div className="mc-team">
      <Casco lado={lado} nombre={nombre} logo={logo} pintura={pintura} ancho={240} alt="" loading="lazy" />
      <p className="mc-team-name">{nombre}</p>
    </div>
  );
}

// Lo que va entre los cascos es lo mismo que en la portada, y se decide igual
// (centroDelPartido): antes del juego la hora, durante y después el marcador.
function Centro({ match, status, parts, isNext }) {
  const centro = centroDelPartido(match, status, parts);
  const fecha = parts.porDefinir ? centro.fecha : fechaCorta(match.match_date, match.timezone);
  const linea = fecha && <p className="mc-date">{fecha}</p>;

  if (centro.momento === 'live') {
    return (
      <div className="mc-center">
        <p className="mh-live"><i aria-hidden="true" />En vivo</p>
        {centro.hayMarcador ? <Marcador match={match} /> : <p className="mc-vs">VS</p>}
        {linea}
      </div>
    );
  }

  if (centro.momento === 'finished') {
    return (
      <div className="mc-center">
        <p className="mc-state">Finalizado</p>
        {centro.hayMarcador
          ? <Marcador match={match} terminado />
          : <p className="mc-pending">Marcador por capturar</p>}
        {linea}
      </div>
    );
  }

  if (centro.momento === 'porDefinir') {
    return (
      <div className="mc-center">
        <p className="mc-vs">VS</p>
        {linea}
      </div>
    );
  }

  return (
    <div className="mc-center">
      {isNext && <p className="mc-state mc-state--next">Próximo</p>}
      {linea}
      <p className="mh-clock">{centro.cifra}{centro.sufijo && <small> {centro.sufijo}</small>}</p>
      <p className="mc-tz">{centro.zona}</p>
    </div>
  );
}

// La portada de la página del partido, en chico: la cancha de noche con la
// proporción de un campo real y una end zone del color de cada equipo. Debajo,
// en una placa, lo que no es del duelo: a qué pertenece, dónde se juega y el
// "¿Quién gana?". Se usa en el calendario (CalendarViewer) y en Mi Cartelera:
// la misma tarjeta en los dos lugares, no una parecida.
//
// La cancha y su placa son un solo link hacia /partidos/:id. El voto va afuera:
// un botón dentro de un link no es HTML válido, y en cada clic había que
// detener la navegación a mano.
//
// `onAbrir` avisa antes de abrir el partido: con eso el calendario recuerda a qué
// tarjeta regresar. El id de la tarjeta es a donde llega.
export default function MatchCard({ match, isNext = false, onAbrir }) {
  const parts = getMatchParts(match.match_date, match.timezone);
  const status = getMatchStatus(match);
  const local = useTeamPaint(match.home_logo_url, match.home_brand_color, { alInstante: true });
  const visita = useTeamPaint(match.away_logo_url, match.away_brand_color, { alInstante: true });

  const ronda = rondaDelPartido(match);
  const alcance = matchScopeLabel(match);
  const sede = sedeDelPartido(match);
  const clase = ['mc', isNext && 'mc--next', status === 'live' && 'mc--live'].filter(Boolean).join(' ');
  const pintura = {
    '--home': local.fondo,
    '--home-ink': local.tinta,
    '--away': visita.fondo,
    '--away-ink': visita.tinta,
  };

  return (
    <article id={`partido-${match.id}`} className={clase} style={pintura}>
      <Link to={`/partidos/${match.id}`} className="mc-link" onClick={() => onAbrir?.(match.id)}>
        <div className="mh">
          <EndZone lado="home" nombre={match.home_team} />
          <div className="mh-field">
            <Yardas />
            <div className="mc-duel">
              <Equipo lado="home" nombre={match.home_team} logo={match.home_logo_url} pintura={local} />
              <Centro match={match} status={status} parts={parts} isNext={isNext} />
              <Equipo lado="away" nombre={match.away_team} logo={match.away_logo_url} pintura={visita} />
            </div>
          </div>
          <EndZone lado="away" nombre={match.away_team} />
        </div>

        {(ronda || alcance || sede) && (
          <div className="mc-meta">
            {ronda && <span className="mc-ronda">{ronda}</span>}
            {alcance && <span>{alcance}</span>}
            {sede && <span className="mc-sede"><IconoMapa />{sede}</span>}
          </div>
        )}
      </Link>

      {status === 'scheduled' && (
        <PredictionWidget matchId={match.id} homeTeam={match.home_team} awayTeam={match.away_team} weekLabel={match.week_label} />
      )}
    </article>
  );
}
