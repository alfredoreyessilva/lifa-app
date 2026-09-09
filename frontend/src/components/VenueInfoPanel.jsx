import { useEffect } from 'react';

function isUrl(value) {
  if (!value) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export default function VenueInfoPanel({ venue, onClose, inline = false, roleLabel }) {
  useEffect(() => {
    if (inline) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, inline]);

  const hasContact = venue.address || venue.contact_phone || venue.contact_email;
  const addressIsLink = isUrl(venue.address);

  const card = (
    <div
      className={`team-profile-modal${inline ? ' team-profile-modal--inline' : ''}`}
      onClick={inline ? undefined : (e) => e.stopPropagation()}
    >

      {/* PORTADA */}
      <div
        className="team-profile-banner"
        style={venue.cover_url ? {
          backgroundImage: `url(${venue.cover_url})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        } : {}}
      >
        {roleLabel && <span className="team-profile-role">{roleLabel}</span>}
        {!inline && <button className="team-profile-close" onClick={onClose}>✕</button>}
      </div>

      <div className="team-profile-body" style={{ paddingTop: 24 }}>
        <h3 className="team-profile-name">{venue.name}</h3>
        {venue.institution && (
          <p style={{ fontSize: 13, color: 'var(--flag)', textAlign: 'center', margin: '0 0 12px', fontFamily: 'var(--font-eyebrow)', letterSpacing: '0.08em' }}>
            {venue.institution}
          </p>
        )}

        {(hasContact || venue.city) && (
          <div className="team-profile-section">
            {venue.city && (
              <div className="team-info-row">🌎 {venue.city}</div>
            )}
            {venue.address && (
              <div className="team-info-row">
                📍{' '}
                {addressIsLink
                  ? <a href={venue.address} target="_blank" rel="noopener noreferrer">Ver en Google Maps</a>
                  : venue.address}
              </div>
            )}
            {venue.contact_phone && (
              <div className="team-info-row">📞 {venue.contact_phone}</div>
            )}
            {venue.contact_email && (
              <div className="team-info-row">
                ✉️ <a href={`mailto:${venue.contact_email}`}>{venue.contact_email}</a>
              </div>
            )}
          </div>
        )}

        {!hasContact && !venue.city && (
          <p style={{ color: 'var(--ink-dim)', fontSize: 13, textAlign: 'center', margin: '8px 0 0' }}>
            Esta sede no ha agregado información de contacto.
          </p>
        )}
      </div>
    </div>
  );

  if (inline) return card;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      {card}
    </div>
  );
}
