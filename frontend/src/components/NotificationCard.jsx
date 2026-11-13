import { Link } from 'react-router-dom';
import { SIN_META, TYPE_META, textoDeAviso } from '../utils/misNotificaciones.js';
import { estadoDelGanador, textoDelPremio } from '../utils/premios.js';
import { imagenAjustada } from '../utils/imagenes.js';

// Una tarjeta de "Mis notificaciones" (README, "Notificaciones: la bandeja y el
// push"). Vive aparte porque la usan dos pantallas: la bandeja, y el catálogo
// de avisos del Panel Admin, que enseña cada aviso tal como lo ve quien lo
// recibe (README, "Notificaciones: todo lo que la app avisa"). Con `preview`
// es una muestra: el botón se pinta igual, pero no lleva a ningún lado.

function initials(name) {
  if (!name) return '';
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function formatWhen(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatHora(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

// De quién es el aviso: la organización (con su logo) o la liga del partido
// que sigues.
function Origen({ item }) {
  if (item.origin === 'organization' && item.org) {
    return (
      <span className="notification-origin">
        <span className="notification-origin-logo">
          {item.org.logo_url ? <img src={item.org.logo_url} alt="" /> : initials(item.org.name)}
        </span>
        {item.org.name}
      </span>
    );
  }
  if (item.origin === 'follow') {
    return (
      <span className="notification-origin">
        <span className="notification-origin-logo">🏈</span>
        {item.match?.league_name ? `Sigues · ${item.match.league_name}` : 'Sigues'}
      </span>
    );
  }
  if (item.origin === 'prediction') {
    return (
      <span className="notification-origin">
        <span className="notification-origin-logo">🎯</span>
        {item.scope?.league_name ? `Tus predicciones · ${item.scope.league_name}` : 'Tus predicciones'}
      </span>
    );
  }
  return null;
}

// Lo que ganaste con este acierto (README, "Premios por acertar"): va dentro del
// aviso del resultado, no en uno aparte. Uno por premio, con el código a la
// vista mientras vale, porque es lo que se enseña en la tienda. El enlace lleva
// a "Mis premios", donde siguen después de que el aviso sale de la bandeja.
function PremiosDelAviso({ prizes, preview }) {
  return (
    <div className="nt-prizes">
      <ul>
        {prizes.map((premio) => {
          const estado = estadoDelGanador(premio);
          return (
            <li key={premio.id} className={`nt-prize is-${premio.status}`}>
              <span className="nt-prize-photo" aria-hidden="true">
                {premio.product?.image_url ? <img src={imagenAjustada(premio.product.image_url, 120)} alt="" /> : '🎁'}
              </span>
              <span className="nt-prize-text">
                <strong>Ganaste {textoDelPremio(premio)}</strong>
                <span className="nt-prize-meta">
                  {premio.store?.name}{premio.store?.is_verified ? ' ✓' : ''} · {estado.detail}
                </span>
                {premio.status === 'valid' && premio.code && (
                  <code className="nt-prize-code" aria-label={`Tu código: ${premio.code}`}>{premio.code}</code>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {preview
        ? <span className="nt-prize-link">Ver mis premios →</span>
        : <Link to="/premios" className="nt-prize-link">Ver mis premios →</Link>}
    </div>
  );
}

export default function NotificationCard({ item, indice = 0, preview = false }) {
  const meta = TYPE_META[item.type] || SIN_META;
  const { title, body, icon } = textoDeAviso(item);
  const clases = [
    'nt-card',
    `nt-card--${meta.tone}`,
    item.is_new ? 'nt-card--new' : '',
    item.type === 'live' ? 'nt-card--live' : '',
  ].filter(Boolean).join(' ');
  const boton = meta.cta || 'Abrir →';

  return (
    <article className={clases} style={{ '--nt-i': Math.min(indice, 12) }}>
      <div className="nt-card-icon" aria-hidden="true">{icon || meta.icon}</div>
      <div className="nt-card-main">
        <div className="nt-card-top">
          <span className="nt-card-label">{meta.label}</span>
          {item.is_new && <span className="nt-card-new">Nuevo</span>}
          <span className="nt-card-time" title={formatWhen(item.at)}>{formatHora(item.at)}</span>
        </div>
        <h3 className="nt-card-title">{title}</h3>
        {body && <p className="nt-card-body">{body}</p>}
        {item.data?.prizes?.length > 0 && <PremiosDelAviso prizes={item.data.prizes} preview={preview} />}
        <div className="nt-card-foot">
          <Origen item={item} />
          {item.url && (preview
            ? <span className="nt-card-cta">{boton}</span>
            : <Link to={item.url} className="nt-card-cta">{boton}</Link>)}
        </div>
      </div>
    </article>
  );
}
