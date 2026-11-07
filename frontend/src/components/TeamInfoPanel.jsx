import { useEffect } from 'react';
import SubscribeButton from './SubscribeButton.jsx';
import { useTeamPaint } from '../utils/useTeamPaint.js';

export default function TeamInfoPanel({ team, leagueId, onClose }) {
  const pintura = useTeamPaint(team.logo_url, team.brand_color, { alInstante: true });

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const hasContact = team.city || team.institution || team.maps_url || team.contact_email || team.contact_phone;
  const hasLinks   = team.facebook_url || team.instagram_url || team.twitter_url || team.website_url;

  const card = (
    <div className="team-profile-modal ficha-de-equipo" style={{ '--eq': pintura.fondo }} onClick={(e) => e.stopPropagation()}>

      {/* BANNER */}
      <div
        className="team-profile-banner"
        style={team.cover_url ? {
          backgroundImage: `url(${team.cover_url})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        } : {}}
      >
        <button className="team-profile-close" onClick={onClose}>✕</button>
      </div>

      <div className="team-profile-logo-wrap">
        <div className="team-profile-logo">
          {team.logo_url
            ? <img src={team.logo_url} alt={team.name} />
            : initials(team.name)}
        </div>
      </div>

      <div className="team-profile-body">
        <h3 className="team-profile-name">{team.name}</h3>

        {/* Misma pastilla que el equipo ve en su propio panel de trabajo
            (TeamWorkspace) — la verificación la pone únicamente el admin desde
            /admin, sobre organizations.is_verified. Si el equipo no está
            verificado no se dice nada: a diferencia de la página pública de
            liga, aquí no hay un "espacio no administrado oficialmente" que
            aclarar, porque la ficha de un equipo siempre la llenó el equipo. */}
        {team.is_verified && (
          <div className="team-profile-verified">
            <span className="pill is-ok">✓ Verificado</span>
          </div>
        )}

        {hasContact && (
          <div className="team-profile-section">
            {team.institution && (
              <div className="team-info-row">🏫 {team.institution}</div>
            )}
            {team.city && (
              <div className="team-info-row">🌎 {team.city}</div>
            )}
            {/* El backend solo acepta links de Google Maps aquí
                (isValidGoogleMapsUrl), así que no puede ser cualquier sitio. */}
            {team.maps_url && (
              <div className="team-info-row">
                📍 <a href={team.maps_url} target="_blank" rel="noopener noreferrer">Ver en Google Maps</a>
              </div>
            )}
            {team.contact_email && (
              <div className="team-info-row">
                ✉️ <a href={`mailto:${team.contact_email}`}>{team.contact_email}</a>
              </div>
            )}
            {team.contact_phone && (
              <div className="team-info-row">📞 {team.contact_phone}</div>
            )}
          </div>
        )}

        {hasLinks && (
          <div className="team-info-links">
            {team.facebook_url && (
              <a href={team.facebook_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
                Facebook
              </a>
            )}
            {team.instagram_url && (
              <a href={team.instagram_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
                Instagram
              </a>
            )}
            {team.twitter_url && (
              <a href={team.twitter_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
                X / Twitter
              </a>
            )}
            {team.website_url && (
              <a href={team.website_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
                Sitio web
              </a>
            )}
          </div>
        )}

        {!hasContact && !hasLinks && (
          <p style={{ color: 'var(--ink-dim)', fontSize: 13, textAlign: 'center', margin: '8px 0 0' }}>
            Este equipo no ha agregado información de contacto.
          </p>
        )}

        {/* Seguir al equipo — se le pasa leagueId para que el seguimiento
            quede amarrado a este equipo DE ESTA LIGA específica, y no se cruce
            con un equipo del mismo nombre en otra liga. */}
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
          <SubscribeButton
            leagueId={leagueId}
            teamName={team.name}
            label={`Seguir a ${team.name}`}
            targetName={`Partidos de ${team.name}`}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      {card}
    </div>
  );
}

function initials(name) {
  return name
    .split(' ')
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}
