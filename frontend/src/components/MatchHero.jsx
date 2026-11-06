import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { imagenAjustada } from '../utils/imagenes.js';
import {
  centroDelPartido, cuentaRegresiva, detalleDelPartido, rondaDelPartido, torneoDelPartido,
} from '../utils/matchDisplay.js';
import { lineaDelEquipo } from '../utils/matchCompare.js';
import { Casco, EndZone, Marcador, Yardas } from './MatchField.jsx';
import { IconoAnterior, IconoMapa, IconoSiguiente } from './MatchIcons.jsx';

// La portada de un partido: la cancha de noche, vista de una end zone a la otra.
// Cada end zone va pintada del color de su equipo y con su nombre rotulado, y
// los dos cascos se encuentran en medio campo con el marcador entre ellos
// (README, "La página de un partido"). La cancha es la misma idea del fondo de
// la app, llevada a la escala de un evento.

function Equipo({ lado, nombre, logo, pintura, datos }) {
  const linea = lineaDelEquipo(datos);

  return (
    <div className={`mh-team mh-team--${lado}`}>
      <Casco lado={lado} nombre={nombre} logo={logo} pintura={pintura} />
      <p className="mh-team-name">{nombre}</p>
      <p className="mh-team-line">{linea || (lado === 'home' ? 'Local' : 'Visitante')}</p>
    </div>
  );
}

// Falta mucho: basta con moverla cada medio minuto. La última hora lleva los
// segundos, porque ahí la cuenta es lo que se viene a ver.
function CuentaRegresiva({ fecha }) {
  const [ahora, setAhora] = useState(() => Date.now());
  const falta = cuentaRegresiva(fecha, ahora);
  const ultimaHora = Boolean(falta) && falta.dias === 0 && falta.horas === 0;
  const activa = Boolean(falta);

  useEffect(() => {
    if (!activa) return undefined;
    const id = setInterval(() => setAhora(Date.now()), ultimaHora ? 1000 : 30000);
    return () => clearInterval(id);
  }, [activa, ultimaHora]);

  if (!falta) return null;
  const partes = ultimaHora
    ? [[falta.minutos, 'min'], [falta.segundos, 's']]
    : falta.dias > 0
      ? [[falta.dias, falta.dias === 1 ? 'día' : 'días'], [falta.horas, 'h'], [falta.minutos, 'min']]
      : [[falta.horas, 'h'], [falta.minutos, 'min']];

  return (
    <p className="mh-countdown">
      Faltan
      {partes.map(([n, unidad]) => <span key={unidad}><b>{n}</b> {unidad}</span>)}
    </p>
  );
}

function Centro({ match, status, parts }) {
  const centro = centroDelPartido(match, status, parts);

  if (centro.momento === 'live') {
    return (
      <div className="mh-center">
        <p className="mh-live"><i aria-hidden="true" />En vivo</p>
        {centro.hayMarcador ? <Marcador match={match} /> : <p className="mh-vs">VS</p>}
        <p className="mh-date">{centro.fecha}</p>
      </div>
    );
  }

  if (centro.momento === 'finished') {
    return (
      <div className="mh-center">
        <p className="mh-state">Finalizado</p>
        {centro.hayMarcador ? <Marcador match={match} terminado /> : <p className="mh-pending">Marcador por capturar</p>}
        <p className="mh-date">{centro.fecha}</p>
      </div>
    );
  }

  if (centro.momento === 'porDefinir') {
    return (
      <div className="mh-center">
        <p className="mh-vs">VS</p>
        <p className="mh-date">{centro.fecha}</p>
      </div>
    );
  }

  return (
    <div className="mh-center">
      <p className="mh-date">{centro.fecha}</p>
      <p className="mh-clock">{centro.cifra}{centro.sufijo && <small> {centro.sufijo}</small>}</p>
      <p className="mh-tz">{centro.zona}</p>
      <CuentaRegresiva fecha={match.match_date} />
    </div>
  );
}

export default function MatchHero({
  match, status, parts, pinturas, contexto, venueLabel, venueUrl,
  prevId, nextId, onPrev, onNext, onTouchStart, onTouchEnd, children,
}) {
  const ronda = rondaDelPartido(match);
  const detalle = detalleDelPartido(match);
  const eliminatoria = match.phase_type === 'single_elimination';
  const torneo = torneoDelPartido(match);

  return (
    <header
      className={`mh${status === 'live' ? ' mh--live' : ''}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <EndZone lado="home" nombre={match.home_team} />

      <div className="mh-field">
        <Yardas />

        <div className="mh-bar">
          {/* El breadcrumb solo cuelga del nivel más alto que se conoce: si el
              partido es de un Torneo, el siguiente nivel clicable es el Torneo,
              nunca la Categoría. Es TournamentPage la que decide, con su
              navegación inteligente, si hace falta pedir categoría o rama. Solo
              en el modelo viejo, sin torneo, el destino es el calendario de la
              categoría. */}
          <nav className="mh-crumb" aria-label="Migas de pan">
            {match.league_logo_url && (
              <img src={imagenAjustada(match.league_logo_url, 72)} alt="" className="mh-league-logo" />
            )}
            <Link to="/">Inicio</Link>
            {match.league_slug && <Link to={`/ligas/${match.league_slug}`}>{match.league_name}</Link>}
            {match.tournament_id
              ? <Link to={`/torneos/${match.tournament_id}`} state={{ partido: match.id }}>{torneo}</Link>
              : match.category_id && <Link to={`/categorias/${match.category_id}/calendario`} state={{ partido: match.id }}>{match.category_name}</Link>}
          </nav>

          {/* Partido anterior y siguiente del mismo calendario. También con las
              flechas del teclado y, en celular, deslizando el dedo. */}
          {(prevId || nextId) && (
            <div className="mh-arrows">
              <button type="button" onClick={onPrev} disabled={!prevId} aria-label="Partido anterior"><IconoAnterior /></button>
              <button type="button" onClick={onNext} disabled={!nextId} aria-label="Partido siguiente"><IconoSiguiente /></button>
            </div>
          )}
        </div>

        <h1 className="mp-sr">{match.home_team} contra {match.away_team}</h1>

        {(ronda || detalle) && (
          <p className={`mh-round${eliminatoria ? ' mh-round--final' : ''}`}>
            {ronda && <strong>{ronda}</strong>}
            {detalle && <span>{detalle}</span>}
          </p>
        )}

        <div className="mh-duel">
          <Equipo lado="home" nombre={match.home_team} logo={match.home_logo_url} pintura={pinturas.home} datos={contexto?.home} />
          <Centro match={match} status={status} parts={parts} />
          <Equipo lado="away" nombre={match.away_team} logo={match.away_logo_url} pintura={pinturas.away} datos={contexto?.away} />
        </div>

        {venueLabel && (
          <p className="mh-venue">
            <IconoMapa />
            {venueUrl
              ? <a href={venueUrl} target="_blank" rel="noopener noreferrer">{venueLabel}</a>
              : <span>{venueLabel}</span>}
          </p>
        )}

        {children}
      </div>

      <EndZone lado="away" nombre={match.away_team} />
    </header>
  );
}
