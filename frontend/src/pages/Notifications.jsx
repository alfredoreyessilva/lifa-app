import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import { textoDeSeguimiento, EVENTO_NOTIFICACIONES_VISTAS } from '../utils/misNotificaciones.js';

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
  league_approved:   { icon: '🎉', label: 'Liga aprobada', color: 'var(--flag)' },
  league_unapproved: { icon: '⚠️', label: 'Publicación', color: 'var(--ink-dim)' },
  // Rechazo de la SOLICITUD de publicación (admin.js, decline-publish). No es
  // lo mismo que league_unapproved, que es ocultar una liga que ya era pública.
  league_publish_declined: { icon: '📝', label: 'Solicitud rechazada', color: 'var(--live)' },
  league_verified:   { icon: '⭐', label: 'Verificada', color: 'var(--paper)' },
  league_unverified: { icon: '⚠️', label: 'Verificación retirada', color: 'var(--ink-dim)' },
  team_claimed:      { icon: '🤝', label: 'Equipo reclamado', color: 'var(--flag)' },
  org_admin_claimed: { icon: '👋', label: 'Nuevo miembro', color: 'var(--flag)' },
  broadcast_added:   { icon: '🎥', label: 'Transmisión', color: 'var(--live)' },
  score_reminder:    { icon: '⏳', label: 'Marcador pendiente', color: 'var(--ink-dim)', cta: 'Ir al partido →' },
  match_not_started: { icon: '📅', label: 'Partido sin actualizar', color: 'var(--ink-dim)', cta: 'Ir al partido →' },
  billing_charge_new:       { icon: '🧾', label: 'Nuevo cargo',     color: 'var(--flag)',     cta: 'Ver estado de cuenta →' },
  billing_due_soon:         { icon: '⏰', label: 'Cargo por vencer', color: 'var(--ink-dim)', cta: 'Ver estado de cuenta →' },
  billing_overdue:          { icon: '🔴', label: 'Cargo vencido',    color: 'var(--live)',    cta: 'Ver estado de cuenta →' },
  billing_payment_recorded: { icon: '✅', label: 'Pago registrado',  color: 'var(--paper)',   cta: 'Ver estado de cuenta →' },
  // El equipo le reporta un pago a su liga (lo lee la LIGA), y el aviso de
  // vuelta si se lo rechazan (lo lee el EQUIPO).
  team_payment_reported:    { icon: '🧾', label: 'Pago por confirmar', color: 'var(--flag)', cta: 'Ir a Cobranza →' },
  billing_payment_rejected: { icon: '⚠️', label: 'Pago rechazado',     color: 'var(--live)', cta: 'Ver estado de cuenta →' },
  // Cuotas del club a sus jugadores (routes/playerBilling.js). Los dos de
  // vencimiento llegan agregados, uno por equipo y no uno por jugador —
  // ver utils/billingReminders.js.
  player_payment_reported:  { icon: '🧾', label: 'Pago por confirmar', color: 'var(--flag)',     cta: 'Ir a Finanzas →' },
  player_billing_due_soon:  { icon: '⏰', label: 'Cuotas por vencer',  color: 'var(--ink-dim)', cta: 'Ir a Finanzas →' },
  player_billing_overdue:   { icon: '🔴', label: 'Cuotas vencidas',    color: 'var(--live)',    cta: 'Ir a Finanzas →' },
  // Lo que sigues.
  upcoming:        { icon: '⏰', label: 'Próximo',        color: 'var(--flag)',     cta: 'Ver partido →' },
  live:            { icon: '🔴', label: 'En vivo',        color: 'var(--live)',     cta: 'Ver partido →' },
  final_score:     { icon: '🏆', label: 'Marcador final', color: 'var(--paper)',    cta: 'Ver partido →' },
  schedule_change: { icon: '📅', label: 'Cambio',         color: 'var(--ink-dim)', cta: 'Ver partido →' },
};

const SIN_META = { icon: '📢', label: 'Aviso', color: 'var(--ink-dim)' };

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
  return null;
}

function NotificationItem({ item }) {
  const meta = TYPE_META[item.type] || SIN_META;
  const { title, body } = item.origin === 'follow'
    ? textoDeSeguimiento(item)
    : { title: item.title, body: item.body };

  return (
    <div className={`notification-item${item.is_new ? ' notification-item--new' : ''}`}>
      <div className="notification-item-head">
        <Origen item={item} />
        <span className="notification-item-time">
          {item.is_new && <span className="notification-new-tag">Nuevo</span>}
          {formatWhen(item.at)}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
        <span style={{ fontSize: 16 }} aria-hidden="true">{meta.icon}</span>
        <span className="notification-item-title">{title}</span>
        <span
          className="tag"
          style={{
            fontSize: 10,
            padding: '2px 6px',
            color: meta.color,
            borderColor: meta.color,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {meta.label}
        </span>
      </div>

      {body && (
        <span className="notification-item-body" style={{ marginTop: 4, lineHeight: 1.4 }}>
          {body}
        </span>
      )}

      {item.url && (
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-start' }}>
          <Link to={item.url} className="btn btn-outline btn-sm" style={{ fontSize: 12, padding: '3px 10px' }}>
            {meta.cta || 'Abrir →'}
          </Link>
        </div>
      )}
    </div>
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
        if (!vigente) return null;
        setItems(data.items || []);
        // Se marca como visto DESPUÉS de traer la lista: lo que era nuevo se
        // pinta como nuevo en esta visita, y deja de contar en el balón.
        return api.markMyNotificationsSeen(token).then(() => {
          window.dispatchEvent(new Event(EVENTO_NOTIFICACIONES_VISTAS));
        });
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

  return (
    <div className="container">
      <div className="section-head">
        <h2>Mis notificaciones</h2>
      </div>

      {error && (
        <div className="empty-state" style={{ padding: '16px 20px' }}>
          <p style={{ color: 'var(--ink-dim)', margin: 0 }}>{error}</p>
        </div>
      )}

      {items === null && !error && (
        <div className="empty-state">
          <h3>Cargando…</h3>
        </div>
      )}

      {items && items.length === 0 && !error && (
        <div className="empty-state" style={{ padding: '36px 20px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, marginTop: 12 }}>
          <h3 style={{ marginBottom: 8 }}>Sin notificaciones todavía</h3>
          <p style={{ color: 'var(--ink-dim)', fontSize: 14, margin: 0 }}>
            Sigue un partido o a un equipo y aquí te llegan sus avisos. Si administras una liga o un club, aquí llegan también los suyos.
          </p>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="notification-list" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          {items.map((item) => (
            <NotificationItem key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
