import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { imagenAjustada } from '../utils/imagenes.js';
import {
  cuentaRegresiva, fechaLarga, initials, partirHora, rondaDelPartido,
} from '../utils/matchDisplay.js';
import { lineaDelEquipo } from '../utils/matchCompare.js';
import { matchScopeLabel } from '../utils/matchScope.js';
import { IconoAnterior, IconoMapa, IconoSiguiente } from './MatchIcons.jsx';

// La portada de un partido: la cancha de noche, vista de una end zone a la otra.
// Cada end zone va pintada del color de su equipo y con su nombre rotulado, y
// los dos cascos se encuentran en medio campo con el marcador entre ellos
// (README, "La página de un partido"). La cancha es la misma idea del fondo de
// la app, llevada a la escala de un evento.

const YARDAS = [10, 20, 30, 40, 50, 40, 30, 20, 10];

// El nombre rotulado es decoración: el mismo nombre, legible, va debajo del
// casco. `--len` es lo que deja que la letra llene la end zone sin salirse, sea
// "OSOS" o "AUTÉNTICOS TIGRES UANL".
function EndZone({ lado, nombre }) {
  return (
    <div className={`mh-zone mh-zone--${lado}`} aria-hidden="true">
      <span className="mh-zone-name" style={{ '--len': Math.max((nombre || '').length, 7) }}>{nombre}</span>
    </div>
  );
}

function Equipo({ lado, nombre, logo, pintura, datos }) {
  const clase = [
    'mh-helmet',
    `mh-helmet--${lado}`,
    pintura.listo ? `is-listo mh-helmet--${pintura.forma}` : '',
  ].filter(Boolean).join(' ');
  const linea = lineaDelEquipo(datos);

  return (
    <div className={`mh-team mh-team--${lado}`}>
      <div className={clase}>
        {logo
          ? <img src={imagenAjustada(logo, 640)} alt={`Logo de ${nombre}`} width="320" height="320" />
          : <span className="mh-helmet-initials">{initials(nombre)}</span>}
      </div>
      <p className="mh-team-name">{nombre}</p>
      <p className="mh-team-line">{linea || (lado === 'home' ? 'Local' : 'Visitante')}</p>
    </div>
  );
}

// Al terminar, el perdedor se apaga. En vivo no: el que va abajo sigue jugando.
function Marcador({ match, terminado }) {
  const local = Number(match.home_score);
  const visita = Number(match.away_score);
  return (
    <p className="mh-score" aria-label={`${match.home_team} ${local}, ${match.away_team} ${visita}`}>
      <span className={terminado && local < visita ? 'is-out' : ''}>{local}</span>
      <i aria-hidden="true" />
      <span className={terminado && visita < local ? 'is-out' : ''}>{visita}</span>
    </p>
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

// El centro de la cancha cambia con el momento del partido: antes es la hora,
// durante y después es el marcador.
function Centro({ match, status, parts }) {
  const fecha = fechaLarga(match.match_date, match.timezone || match.league_timezone);
  const hayMarcador = match.home_score !== null && match.home_score !== undefined
    && match.away_score !== null && match.away_score !== undefined;

  if (status === 'live') {
    return (
      <div className="mh-center">
        <p className="mh-live"><i aria-hidden="true" />En vivo</p>
        {hayMarcador ? <Marcador match={match} /> : <p className="mh-vs">VS</p>}
        <p className="mh-date">{fecha}</p>
      </div>
    );
  }

  if (status === 'finished') {
    return (
      <div className="mh-center">
        <p className="mh-state">Finalizado</p>
        {hayMarcador ? <Marcador match={match} terminado /> : <p className="mh-pending">Marcador por capturar</p>}
        <p className="mh-date">{fecha}</p>
      </div>
    );
  }

  if (parts.porDefinir) {
    return (
      <div className="mh-center">
        <p className="mh-vs">VS</p>
        <p className="mh-date">Fecha por definir</p>
      </div>
    );
  }

  const { cifra, sufijo } = partirHora(parts.time);
  return (
    <div className="mh-center">
      <p className="mh-date">{fecha}</p>
      <p className="mh-clock">{cifra}{sufijo && <small> {sufijo}</small>}</p>
      <p className="mh-tz">{parts.tzLabel}</p>
      <CuentaRegresiva fecha={match.match_date} />
    </div>
  );
}

export default function MatchHero({
  match, status, parts, pinturas, contexto, venueLabel, venueUrl,
  prevId, nextId, onPrev, onNext, onTouchStart, onTouchEnd, children,
}) {
  const ronda = rondaDelPartido(match);
  // Con coma y no con un separador: en un teléfono esta línea se parte, y una
  // rayita o un punto quedarían sueltos al principio del renglón.
  const detalle = [
    matchScopeLabel(match),
    [match.category_name, match.branch_name].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
  const eliminatoria = match.phase_type === 'single_elimination';
  const torneo = [match.tournament_name, match.tournament_year].filter(Boolean).join(' ');

  return (
    <header
      className={`mh${status === 'live' ? ' mh--live' : ''}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <EndZone lado="home" nombre={match.home_team} />

      <div className="mh-field">
        <div className="mh-yards" aria-hidden="true">
          {YARDAS.map((y, i) => <span key={i} style={{ left: `${(i + 1) * 10}%` }}>{y}</span>)}
        </div>

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
              ? <Link to={`/torneos/${match.tournament_id}`}>{torneo}</Link>
              : match.category_id && <Link to={`/categorias/${match.category_id}/calendario`}>{match.category_name}</Link>}
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
