import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import MatchCard from '../components/MatchCard.jsx';
import { getMatchStatus } from '../utils/matchStatus.js';

function initials(name) {
  if (!name) return '';
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function formatWhen(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const TYPE_META = {
  league_approved:   { icon: '🎉', label: 'Liga aprobada', color: 'var(--flag)' },
  league_unapproved: { icon: '⚠️', label: 'Publicación', color: 'var(--ink-dim)' },
  league_verified:   { icon: '⭐', label: 'Verificada', color: 'var(--field)' },
  league_unverified: { icon: '⚠️', label: 'Verificación retirada', color: 'var(--ink-dim)' },
  team_claimed:      { icon: '🤝', label: 'Equipo reclamado', color: 'var(--flag)' },
  broadcast_added:   { icon: '🎥', label: 'Transmisión', color: 'var(--live)' },
  score_reminder:    { icon: '⏳', label: 'Marcador pendiente', color: 'var(--ink-dim)' },
  match_not_started: { icon: '📅', label: 'Partido sin actualizar', color: 'var(--ink-dim)' },
};

function OrgNotificationItem({ notification }) {
  const meta = TYPE_META[notification.type] || { icon: '📢', label: 'Aviso', color: 'var(--ink-dim)' };

  let dataObj = notification.data;
  if (typeof dataObj === 'string') {
    try {
      dataObj = JSON.parse(dataObj);
    } catch {}
  }

  const targetUrl = dataObj?.url;

  return (
    <div className="notification-item" style={{ position: 'relative' }}>
      <div className="notification-item-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16 }}>{meta.icon}</span>
          <span className="notification-item-title">{notification.title}</span>
          <span
            className="tag"
            style={{
              fontSize: 10,
              padding: '2px 6px',
              color: meta.color,
              borderColor: meta.color,
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}
          >
            {meta.label}
          </span>
        </div>
        <span className="notification-item-time">{formatWhen(notification.created_at)}</span>
      </div>

      {notification.body && (
        <span className="notification-item-body" style={{ marginTop: 4, lineHeight: 1.4 }}>
          {notification.body}
        </span>
      )}

      {targetUrl && (
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-start' }}>
          <Link to={targetUrl} className="btn btn-outline btn-sm" style={{ fontSize: 12, padding: '3px 10px' }}>
            Ir a la publicación →
          </Link>
        </div>
      )}
    </div>
  );
}

export default function Notifications() {
  const { token, leagues, teams } = useAuth();
  const [selected, setSelected] = useState(null);
  const [notifByOrg, setNotifByOrg] = useState({});

  // Partidos que sigue el usuario
  const [followedMatches, setFollowedMatches] = useState(null);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [unfollowingId, setUnfollowingId] = useState(null);

  const orgs = [
    ...leagues.map((lg) => ({ ...lg, kind: 'liga' })),
    ...teams.map((tm) => ({ ...tm, kind: 'equipo' })),
  ];

  // 1. Carga notificaciones de organizaciones administradas
  useEffect(() => {
    if (!token) return;
    orgs.forEach((org) => {
      const key = `${org.kind}-${org.id}`;
      const fetcher = org.kind === 'liga' ? api.getLeagueNotifications : api.getTeamNotifications;
      fetcher(org.id, token)
        .then((data) => setNotifByOrg((prev) => ({ ...prev, [key]: data.notifications })))
        .catch(() => setNotifByOrg((prev) => ({ ...prev, [key]: [] })));
    });
  }, [token, leagues.length, teams.length]);

  // 2. Carga los partidos seguidos por el usuario
  useEffect(() => {
    if (!token) {
      setFollowedMatches([]);
      return;
    }
    setLoadingMatches(true);
    api.getFollowedMatches(token)
      .then((data) => {
        setFollowedMatches(data.matches || []);
      })
      .catch(() => {
        setFollowedMatches([]);
      })
      .finally(() => {
        setLoadingMatches(false);
      });
  }, [token]);

  function handleLogoClick(org) {
    const isClosing = selected && selected.kind === org.kind && selected.id === org.id;
    setSelected(isClosing ? null : org);
    if (isClosing) return;

    const key = `${org.kind}-${org.id}`;
    const unread = (notifByOrg[key] || []).filter((n) => !n.read_at);
    if (unread.length === 0) return;

    setNotifByOrg((prev) => ({
      ...prev,
      [key]: prev[key].map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })),
    }));
    const markRead = org.kind === 'liga' ? api.markLeagueNotificationRead : api.markTeamNotificationRead;
    unread.forEach((n) => { markRead(org.id, n.id, token).catch(() => {}); });
  }

  async function handleUnfollow(matchId, e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setUnfollowingId(matchId);
    try {
      await api.unfollowMatch(matchId, token);
      setFollowedMatches((prev) => (prev || []).filter((m) => m.id !== matchId));
    } catch (err) {
      console.error('Error al dejar de seguir partido:', err);
    } finally {
      setUnfollowingId(null);
    }
  }

  const selectedKey = selected ? `${selected.kind}-${selected.id}` : null;
  const selectedNotifs = selectedKey ? notifByOrg[selectedKey] : null;

  const upcomingMatches = (followedMatches || []).filter((m) => getMatchStatus(m) !== 'finished');
  const pastMatches = (followedMatches || []).filter((m) => getMatchStatus(m) === 'finished');

  return (
    <div className="container">
      <div className="section-head">
        <h2>Notificaciones</h2>
      </div>

      {/* Organizaciones administradas */}
      {orgs.length > 0 && (
        <>
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
                <OrgNotificationItem key={n.id} notification={n} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Partidos que sigo */}
      <div className="section-head" style={{ marginTop: 36 }}>
        <h2 style={{ fontSize: 16 }}>Partidos que sigo</h2>
        {followedMatches && followedMatches.length > 0 && (
          <span className="count">{followedMatches.length}</span>
        )}
      </div>

      {!token ? (
        <div className="empty-state" style={{ padding: '36px 20px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, marginTop: 12 }}>
          <p style={{ color: 'var(--paper)', fontSize: 15, marginBottom: 12 }}>
            Inicia sesión para ver los partidos que sigues y gestionar tus avisos.
          </p>
          <Link to="/iniciar-sesion" className="btn btn-primary btn-sm">
            Iniciar sesión
          </Link>
        </div>
      ) : loadingMatches ? (
        <div className="empty-state" style={{ padding: '36px 20px' }}>
          <h3>Cargando partidos…</h3>
        </div>
      ) : followedMatches && followedMatches.length === 0 ? (
        <div className="empty-state" style={{ padding: '36px 20px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, marginTop: 12 }}>
          <p style={{ color: 'var(--ink-dim)', fontSize: 14, margin: 0 }}>
            Todavía no sigues ningún partido. Haz clic en <strong>"Avisarme"</strong> en el calendario de cualquier partido para recibir alertas y verlos aquí.
          </p>
        </div>
      ) : (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {upcomingMatches.length > 0 && (
            <div>
              <div className="match-grid">
                {upcomingMatches.map((match) => (
                  <div key={match.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <MatchCard match={match} isNext={getMatchStatus(match) === 'scheduled'} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                      <span style={{ fontSize: 12, color: 'var(--flag)', fontWeight: 600 }}>🔔 Alertas activadas</span>
                      <button
                        type="button"
                        onClick={(e) => handleUnfollow(match.id, e)}
                        disabled={unfollowingId === match.id}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--ink-dim)',
                          fontSize: 12,
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          padding: '2px 6px',
                        }}
                      >
                        {unfollowingId === match.id ? 'Cancelando…' : 'Dejar de seguir'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pastMatches.length > 0 && (
            <div>
              <div className="section-head" style={{ marginBottom: 12 }}>
                <h3 style={{ fontSize: 14, color: 'var(--ink-dim)' }}>Partidos finalizados</h3>
              </div>
              <div className="match-grid">
                {pastMatches.map((match) => (
                  <div key={match.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <MatchCard match={match} />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 4px' }}>
                      <button
                        type="button"
                        onClick={(e) => handleUnfollow(match.id, e)}
                        disabled={unfollowingId === match.id}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--ink-dim)',
                          fontSize: 12,
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          padding: '2px 6px',
                        }}
                      >
                        {unfollowingId === match.id ? 'Cancelando…' : 'Quitar de la lista'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
