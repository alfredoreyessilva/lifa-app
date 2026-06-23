import { useEffect } from 'react';

export default function TeamInfoPanel({ team, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const hasContact = team.location || team.contact_email || team.contact_phone;
  const hasLinks = team.facebook_url || team.instagram_url || team.twitter_url || team.website_url;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="team-profile-modal" onClick={(e) => e.stopPropagation()}>

        <div className="team-profile-banner">
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

          {hasContact && (
            <div className="team-profile-section">
              {team.location && (
                <div className="team-info-row">📍 {team.location}</div>
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
        </div>
      </div>
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