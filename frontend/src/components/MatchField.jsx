import { imagenAjustada } from '../utils/imagenes.js';
import { initials } from '../utils/matchDisplay.js';

// Las piezas de la cancha de noche. Las comparten la portada de un partido
// (MatchHero.jsx) y su versión en chico, la tarjeta del calendario
// (MatchCard.jsx): son los mismos `.mh-*`, y la tarjeta solo les cambia la
// medida, para que la cancha sea una sola (README, "El calendario").

const YARDAS = [10, 20, 30, 40, 50, 40, 30, 20, 10];

export function Yardas() {
  return (
    <div className="mh-yards" aria-hidden="true">
      {YARDAS.map((y, i) => <span key={i} style={{ left: `${(i + 1) * 10}%` }}>{y}</span>)}
    </div>
  );
}

// El nombre rotulado es decoración: el mismo nombre, legible, va debajo del
// casco. `--len` es lo que deja que la letra llene la end zone sin salirse, sea
// "OSOS" o "AUTÉNTICOS TIGRES UANL".
export function EndZone({ lado, nombre }) {
  return (
    <div className={`mh-zone mh-zone--${lado}`} aria-hidden="true">
      <span className="mh-zone-name" style={{ '--len': Math.max((nombre || '').length, 7) }}>{nombre}</span>
    </div>
  );
}

// `pintura` sale de useTeamPaint: dice cómo se pone el logo sobre el pasto (casco,
// placa o disco). `ancho` es lo que se le pide a Cloudinary.
export function Casco({ lado, nombre, logo, pintura, ancho = 640, alt = `Logo de ${nombre}`, loading }) {
  const clase = [
    'mh-helmet',
    `mh-helmet--${lado}`,
    pintura.listo ? `is-listo mh-helmet--${pintura.forma}` : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={clase}>
      {logo
        ? <img src={imagenAjustada(logo, ancho)} alt={alt} width="320" height="320" loading={loading} />
        : <span className="mh-helmet-initials">{initials(nombre)}</span>}
    </div>
  );
}

// Al terminar, el perdedor se apaga. En vivo no: el que va abajo sigue jugando.
export function Marcador({ match, terminado }) {
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
