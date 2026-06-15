import { useState } from 'react';

export default function TeamCard({ team }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="team-card" onClick={() => setOpen((o) => !o)}>
        <div className="league-logo">
          {team.logo_url ? <img src={team.logo_url} alt={team.name} /> : initials(team.name)}
        </div>
        <h4>{team.name}</h4>
      </button>

      {open && (
        <div className="team-info-card">
          <div className="league-logo">
            {team.logo_url ? <img src={team.logo_url} alt={team.name} /> : initials(team.name)}
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h3>{team.name}</h3>
            {team.location && <div className="team-info-row">📍 {team.location}</div>}
            {team.contact_email && <div className="team-info-row">✉️ <a href={`mailto:${team.contact_email}`}>{team.contact_email}</a></div>}
            {team.contact_phone && <div className="team-info-row">📞 {team.contact_phone}</div>}

            {(team.facebook_url || team.instagram_url || team.twitter_url || team.website_url) && (
              <div className="team-info-links">
                {team.facebook_url && <a href={team.facebook_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">Facebook</a>}
                {team.instagram_url && <a href={team.instagram_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">Instagram</a>}
                {team.twitter_url && <a href={team.twitter_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">X / Twitter</a>}
                {team.website_url && <a href={team.website_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">Sitio web</a>}
              </div>
            )}

            {!team.location && !team.contact_email && !team.contact_phone && !team.facebook_url && !team.instagram_url && !team.twitter_url && !team.website_url && (
              <p style={{ color: 'var(--ink-dim)', fontSize: 13, margin: 0 }}>Este equipo no ha agregado información de contacto.</p>
            )}
          </div>
          <button className="btn btn-ghost btn-sm close-btn" onClick={() => setOpen(false)}>Cerrar</button>
        </div>
      )}
    </>
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
