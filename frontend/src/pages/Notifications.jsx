import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';

function initials(name) {
  if (!name) return '';
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function formatWhen(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function Notifications() {
  const { token, leagues, teams } = useAuth();
  const [selected, setSelected] = useState(null);
  // Mapa "kind-id" -> lista de notificaciones (o null mientras no se ha
  // cargado todavía). Se guarda todo junto, no solo lo de la org
  // seleccionada, para poder pintar el punto de "no leído" en cada logo
  // sin tener que abrir cada una primero.
  const [notifByOrg, setNotifByOrg] = useState({});

  const orgs = [
    ...leagues.map((lg) => ({ ...lg, kind: 'liga' })),
    ...teams.map((tm) => ({ ...tm, kind: 'equipo' })),
  ];

  // Carga las notificaciones de todas las organizaciones administradas en
  // cuanto se conocen (login / refresh de leagues-teams). Cada una es
  // independiente, así que si una falla (ej. una liga recién eliminada) no
  // tumba el resto.
  useEffect(() => {
    if (!token) return;
    orgs.forEach((org) => {
      const key = `${org.kind}-${org.id}`;
      const fetcher = org.kind === 'liga' ? api.getLeagueNotifications : api.getTeamNotifications;
      fetcher(org.id, token)
        .then((data) => setNotifByOrg((prev) => ({ ...prev, [key]: data.notifications })))
        .catch(() => setNotifByOrg((prev) => ({ ...prev, [key]: [] })));
    });
    // Solo se vuelve a correr si cambia el token o la lista de orgs
    // administradas (no en cada render, ya que orgs se recalcula siempre).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, leagues.length, teams.length]);

  function handleLogoClick(org) {
    const isClosing = selected && selected.kind === org.kind && selected.id === org.id;
    setSelected(isClosing ? null : org);
    if (isClosing) return;

    const key = `${org.kind}-${org.id}`;
    const unread = (notifByOrg[key] || []).filter((n) => !n.read_at);
    if (unread.length === 0) return;

    // Se marcan como leídas al abrir la bandeja (igual que cualquier
    // notificación de app). Se actualiza el estado local de inmediato para
    // que el punto rojo desaparezca sin esperar la respuesta del servidor.
    setNotifByOrg((prev) => ({
      ...prev,
      [key]: prev[key].map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })),
    }));
    const markRead = org.kind === 'liga' ? api.markLeagueNotificationRead : api.markTeamNotificationRead;
    unread.forEach((n) => { markRead(org.id, n.id, token).catch(() => {}); });
  }

  const selectedKey = selected ? `${selected.kind}-${selected.id}` : null;
  const selectedNotifs = selectedKey ? notifByOrg[selectedKey] : null;

  return (
    <div className="container">
      <div className="section-head">
        <h2>Notificaciones</h2>
      </div>

      <div className="section-head" style={{ marginTop: 8 }}>
        <h2 style={{ fontSize: 16 }}>Organizaciones administradas</h2>
      </div>
      <div className="org-logo-grid">
        {orgs.map((org) => {
          const key = `${org.kind}-${org.id}`;
          const hasUnread = (notifByOrg[key] || []).some((n) => !n.read_at);
          return (
            <button
              key={key}
              onClick={() => handleLogoClick(org)}
              className={`league-logo-btn${selected && selected.kind === org.kind && selected.id === org.id ? ' league-logo-btn--active' : ''}`}
              style={{ width: 72, height: 72, position: 'relative' }}
            >
              {hasUnread && <span className="notification-dot" aria-label="Notificaciones sin leer" />}
              <div className="league-logo" style={{ width: '100%', height: '100%', fontSize: 22 }}>
                {org.logo_url ? <img src={org.logo_url} alt={org.name} /> : initials(org.name)}
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="section-head" style={{ marginTop: 32 }}>
          <h2>Notificaciones de {selected.name}</h2>
        </div>
      )}

      {selected && selectedNotifs === null && (
        <div className="empty-state">
          <h3>Cargando…</h3>
        </div>
      )}

      {selected && selectedNotifs && selectedNotifs.length === 0 && (
        <div className="empty-state">
          <h3>Sin notificaciones todavía</h3>
        </div>
      )}

      {selected && selectedNotifs && selectedNotifs.length > 0 && (
        <div className="notification-list" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          {selectedNotifs.map((n) => (
            <div key={n.id} className="notification-item">
              <div className="notification-item-head">
                <span className="notification-item-title">{n.title}</span>
                <span className="notification-item-time">{formatWhen(n.created_at)}</span>
              </div>
              {n.body && <span className="notification-item-body">{n.body}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="section-head" style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 16 }}>Partidos que sigo</h2>
      </div>
    </div>
  );
}
