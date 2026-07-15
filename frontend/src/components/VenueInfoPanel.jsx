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

export default function VenueInfoPanel({ venue, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const hasContact = venue.address || venue.contact_phone || venue.contact_email;
  const addressIsLink = isUrl(venue.address);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="team-profile-modal" onClick={(e) => e.stopPropagation()}>

        {/* PORTADA */}
        <div
          className="team-profile-banner"
          style={venue.cover_url ? {
            backgroundImage: `url(${venue.cover_url})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          } : {}}
        >
          <button className="team-profile-close" onClick={onClose}>✕</button>
        </div>

        <div className="team-profile-logo-wrap">
          <div className="team-profile-logo">
            📍
          </div>
        </div>

        <div className="team-profile-body">
          <h3 className="team-profile-name">{venue.name}</h3>
          {venue.institution && (
            <p style={{ fontSize: 13, color: 'var(--flag)', textAlign: 'center', margin: '0 0 12px', fontFamily: 'var(--font-eyebrow)', letterSpacing: '0.08em' }}>
              {venue.institution}
            </p>
          )}

          {hasContact && (
            <div className="team-profile-section">
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

          {!hasContact && (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13, textAlign: 'center', margin: '8px 0 0' }}>
              Esta sede no ha agregado información de contacto.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
