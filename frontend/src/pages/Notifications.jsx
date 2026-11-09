import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import { textoDeSeguimiento, textoDePrediccion, EVENTO_NOTIFICACIONES_VISTAS } from '../utils/misNotificaciones.js';

// "Mis notificaciones": UNA bandeja por persona (README, "Notificaciones: la
// bandeja y el push"). Junta los avisos de las organizaciones que administras
// —solo los que tu rol puede leer, eso lo decide el backend— con los de los
// partidos y equipos que sigues.
//
// Reemplaza a la cuadrícula de logos (había que entrar a cada organización
// para ver sus avisos) y a "Partidos que sigo", que duplicaba "Mi cartelera".

function initials(name) {
  if (!name) return '';
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function formatWhen(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Ícono, etiqueta y texto del botón de cada tipo. Los de organización traen su
// título y cuerpo guardados; los de seguimiento se arman al leer
// (utils/misNotificaciones.js). Los cuatro últimos son los de `match_events`
// más los dos que el backend calcula — un tipo nuevo va en los tres lados.
const TYPE_META = {
  league_approved:   { icon: '🎉', label: 'Liga aprobada', tone: 'oro' },
  league_unapproved: { icon: '⚠️', label: 'Publicación', tone: 'gris' },
  // Rechazo de la SOLICITUD de publicación (admin.js, decline-publish). No es
  // lo mismo que league_unapproved, que es ocultar una liga que ya era pública.
  league_publish_declined: { icon: '📝', label: 'Solicitud rechazada', tone: 'rojo' },
  league_verified:   { icon: '⭐', label: 'Verificada', tone: 'cal' },
  league_unverified: { icon: '⚠️', label: 'Verificación retirada', tone: 'gris' },
  team_claimed:      { icon: '🤝', label: 'Equipo reclamado', tone: 'oro' },
  org_admin_claimed: { icon: '👋', label: 'Nuevo miembro', tone: 'oro' },
  broadcast_added:   { icon: '🎥', label: 'Transmisión', tone: 'rojo' },
  score_reminder:    { icon: '⏳', label: 'Marcador pendiente', tone: 'gris', cta: 'Ir al partido →' },
  match_not_started: { icon: '📅', label: 'Partido sin actualizar', tone: 'gris', cta: 'Ir al partido →' },
  billing_charge_new:       { icon: '🧾', label: 'Nuevo cargo',     tone: 'oro',     cta: 'Ver estado de cuenta →' },
  billing_due_soon:         { icon: '⏰', label: 'Cargo por vencer', tone: 'gris', cta: 'Ver estado de cuenta →' },
  billing_overdue:          { icon: '🔴', label: 'Cargo vencido',    tone: 'rojo',    cta: 'Ver estado de cuenta →' },
  billing_payment_recorded: { icon: '✅', label: 'Pago registrado',  tone: 'cal',   cta: 'Ver estado de cuenta →' },
  // El equipo le reporta un pago a su liga (lo lee la LIGA), y el aviso de
  // vuelta si se lo rechazan (lo lee el EQUIPO).
  team_payment_reported:    { icon: '🧾', label: 'Pago por confirmar', tone: 'oro', cta: 'Ir a Cobranza →' },
  billing_payment_rejected: { icon: '⚠️', label: 'Pago rechazado',     tone: 'rojo', cta: 'Ver estado de cuenta →' },
  // Cuotas del club a sus jugadores (routes/playerBilling.js). Los dos de
  // vencimiento llegan agregados, uno por equipo y no uno por jugador —
  // ver utils/billingReminders.js.
  player_payment_reported:  { icon: '🧾', label: 'Pago por confirmar', tone: 'oro',     cta: 'Ir a Finanzas →' },
  player_billing_due_soon:  { icon: '⏰', label: 'Cuotas por vencer',  tone: 'gris', cta: 'Ir a Finanzas →' },
  player_billing_overdue:   { icon: '🔴', label: 'Cuotas vencidas',    tone: 'rojo',    cta: 'Ir a Finanzas →' },
  // Lo que sigues.
  upcoming:        { icon: '⏰', label: 'Próximo',        tone: 'oro',     cta: 'Ver partido →' },
  live:            { icon: '🔴', label: 'En vivo',        tone: 'rojo',     cta: 'Ver partido →' },
  final_score:     { icon: '🏆', label: 'Marcador final', tone: 'cal',    cta: 'Ver partido →' },
  schedule_change: { icon: '📅', label: 'Cambio',         tone: 'gris', cta: 'Ver partido →' },
  // Tus predicciones (utils/bandeja.js › avisosDePrediccion). El del resultado
  // cambia de ícono según acertaste, así que su texto lo trae.
  prediction_result:   { icon: '🎯', label: 'Tu predicción', tone: 'cal',   cta: 'Ver partido →' },
  prediction_round:    { icon: '🏅', label: 'Ranking',       tone: 'oro',    cta: 'Ver ranking →' },
  prediction_reminder: { icon: '🗳️', label: 'Por votar',     tone: 'oro',    cta: 'Votar →' },
  // La liga agregó partidos a un calendario donde votas (README, "Partidos
  // nuevos para predecir").
  prediction_new_matches: { icon: '📣', label: 'Partidos nuevos', tone: 'oro', cta: 'Votar →' },
};

const SIN_META = { icon: '📢', label: 'Aviso', tone: 'gris' };

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

// Los de organización traen su texto guardado; los de lo que sigues y los de
// tus predicciones se arman al leer, con los datos de hoy.
function textoDe(item) {
  if (item.origin === 'follow') return textoDeSeguimiento(item);
  if (item.origin === 'prediction') return textoDePrediccion(item);
  return { title: item.title, body: item.body };
}

// Los avisos se agrupan por día, como una crónica: "Hoy", "Ayer" y luego la
// fecha. La lista ya viene ordenada del más nuevo al más viejo.
function etiquetaDeDia(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'Antes';
  const hoy = new Date();
  const inicio = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((inicio(hoy) - inicio(date)) / 86400000);
  if (dias === 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  return date.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
}

function agruparPorDia(items) {
  const grupos = [];
  for (const item of items) {
    const dia = etiquetaDeDia(item.at);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.items.push(item);
    else grupos.push({ dia, items: [item] });
  }
  return grupos;
}

function formatHora(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function NotificationItem({ item, indice }) {
  const meta = TYPE_META[item.type] || SIN_META;
  const { title, body, icon } = textoDe(item);
  const clases = [
    'nt-card',
    `nt-card--${meta.tone}`,
    item.is_new ? 'nt-card--new' : '',
    item.type === 'live' ? 'nt-card--live' : '',
  ].filter(Boolean).join(' ');

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
        <div className="nt-card-foot">
          <Origen item={item} />
          {item.url && (
            <Link to={item.url} className="nt-card-cta">
              {meta.cta || 'Abrir →'}
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

export default function Notifications() {
  const { token } = useAuth();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return undefined;
    let vigente = true;
    setError('');
    api.getMyNotifications(token)
      .then((data) => {
        if (!vigente) return;
        setItems(data.items || []);
        // Se marca como visto DESPUÉS de traer la lista: lo que era nuevo se
        // pinta como nuevo en esta visita, y deja de contar en el balón.
        //
        // Va en su propia cadena: colgada de la de arriba, si marcarla fallaba
        // (se fue la señal justo después de cargar), el catch de abajo ponía
        // "No se pudieron cargar tus notificaciones" encima de la lista ya
        // cargada. No hay nada que avisar: el evento que pone el balón en cero
        // sale solo si el servidor guardó la marca, y lo nuevo vuelve a salir
        // como nuevo en la próxima visita, que es cuando se vuelve a marcar.
        api.markMyNotificationsSeen(token)
          .then(() => window.dispatchEvent(new Event(EVENTO_NOTIFICACIONES_VISTAS)))
          .catch(() => {});
      })
      .catch((err) => {
        if (!vigente) return;
        setError(err.offline
          ? 'Sin conexión: no se pudieron cargar tus notificaciones.'
          : (err.message || 'No se pudieron cargar tus notificaciones.'));
        setItems((prev) => prev ?? []);
      });
    return () => { vigente = false; };
  }, [token]);

  // Es una pantalla del aficionado, no un panel de trabajo: va en la noche de
  // la cancha (la placa de la página de un partido), no en el panel negro.
  const nuevos = items ? items.filter((i) => i.is_new).length : 0;
  let indice = 0;

  return (
    <div className="container">
      <div className="nt-page">
        <header className="nt-hero">
          <span className="nt-hero-eyebrow">Tu bandeja</span>
          <h1 className="nt-hero-title">Mis notificaciones</h1>
          <p className="nt-hero-sub">
            {items === null && !error && 'Revisando lo que pasó en la cancha…'}
            {items && nuevos > 0 && <><strong>{nuevos}</strong> {nuevos === 1 ? 'aviso nuevo' : 'avisos nuevos'} desde tu última visita</>}
            {items && items.length > 0 && nuevos === 0 && 'Estás al día. Esto es lo más reciente.'}
            {items && items.length === 0 && !error && 'Todavía no hay jugadas que contarte.'}
          </p>
        </header>

        {error && <div className="nt-aviso">{error}</div>}

        {items === null && !error && (
          <div className="nt-list" aria-busy="true">
            {[0, 1, 2].map((n) => <div key={n} className="nt-skeleton" />)}
          </div>
        )}

        {items && items.length === 0 && !error && (
          <div className="nt-empty">
            <div className="nt-empty-ball" aria-hidden="true">🏈</div>
            <h3>Sin notificaciones todavía</h3>
            <ul>
              <li><span aria-hidden="true">⭐</span> Sigue un partido o a un equipo y aquí te llegan sus avisos.</li>
              <li><span aria-hidden="true">🎯</span> Predice quién gana y entérate de si acertaste y en qué lugar vas.</li>
              <li><span aria-hidden="true">🏟️</span> Si administras una liga o un club, aquí llegan también los suyos.</li>
            </ul>
            <Link to="/" className="nt-card-cta">Explorar ligas y equipos →</Link>
          </div>
        )}

        {items && items.length > 0 && agruparPorDia(items).map((grupo) => (
          <section key={grupo.dia} className="nt-day">
            <h2 className="nt-day-title"><span>{grupo.dia}</span></h2>
            <div className="nt-list">
              {grupo.items.map((item) => (
                <NotificationItem key={item.key} item={item} indice={indice++} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
