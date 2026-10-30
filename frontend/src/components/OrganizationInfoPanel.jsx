import { useEffect } from 'react';
import { createPortal } from 'react-dom';

// Ficha de un medio: se abre encima de la pantalla, igual que la de un equipo
// (TeamInfoPanel). Es TODO lo que el público ve de un medio —portada, logo,
// nombre, verificada, país, descripción, contacto, redes y sitio web—: la
// vista pública que tenía su página se borró el 2026-10-30. La abren el
// directorio del home, "También transmiten" de un partido cuando el medio no
// puso link para ese partido, y su página (OrganizationDetailPage) a quien no
// lo administra, o a quien sí con "Ver como público". Sirve igual para una
// clínica o una marca. Quien la abre ya trae los datos (GET /organizations,
// GET /broadcasts/match/:id, con CAMPOS_DE_FICHA del backend): no pide nada.
//
// Va en un portal a document.body, como Modal.jsx, para no quedar anidada en la
// tarjeta del partido. Pero los eventos de React suben por el árbol de
// componentes aunque haya portal, y en el partido deslizar el dedo cambia de
// partido (onTouchStart/onTouchEnd de .match-nav, en MatchPage): por eso la
// ficha corta los toques.
export default function OrganizationInfoPanel({ org, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const hasInfo = org.country_name || org.description;
  const hasContact = org.contact_email || org.contact_phone;
  const redes = redesDeOrganizacion(org);

  const stop = (e) => e.stopPropagation();

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} onTouchStart={stop} onTouchEnd={stop}>
      <div className="team-profile-modal" onClick={stop}>

        {/* BANNER — su portada, o el degradado si no subió una */}
        <div
          className="team-profile-banner"
          style={org.cover_url ? {
            backgroundImage: `url(${org.cover_url})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          } : {}}
        >
          <button className="team-profile-close" onClick={onClose}>✕</button>
        </div>

        <div className="team-profile-logo-wrap">
          <div className="team-profile-logo">
            {org.logo_url
              ? <img src={org.logo_url} alt={org.name} />
              : initials(org.name)}
          </div>
        </div>

        <div className="team-profile-body">
          <h3 className="team-profile-name">{org.name}</h3>

          {org.is_verified && (
            <div className="team-profile-verified">
              <span className="pill is-ok">✓ Verificada</span>
            </div>
          )}

          {hasInfo && (
            <div className="team-profile-section">
              {org.country_name && (
                <div className="team-info-row">🌎 {org.country_name}</div>
              )}
              {org.description && (
                <p className="team-info-row" style={{ margin: org.country_name ? '8px 0 0' : 0, whiteSpace: 'pre-line' }}>
                  {org.description}
                </p>
              )}
            </div>
          )}

          {hasContact && <ContactoDeOrganizacion org={org} />}

          {redes.length > 0 && <RedesDeOrganizacion redes={redes} />}

          {!hasInfo && !hasContact && redes.length === 0 && (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13, textAlign: 'center', margin: '8px 0 0' }}>
              Todavía no agregó su información.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// Correo y teléfono, y los botones de sus redes. La página de una tienda
// (la vitrina, en OrganizationDetailPage) los pinta a su modo, pero con
// redesDeOrganizacion y telDeOrganizacion: la ficha y la vitrina enseñan lo
// mismo.
export function ContactoDeOrganizacion({ org }) {
  return (
    <div className="team-profile-section">
      {org.contact_email && (
        <div className="team-info-row">
          ✉️ <a href={`mailto:${org.contact_email}`}>{org.contact_email}</a>
        </div>
      )}
      {org.contact_phone && (
        <div className="team-info-row">
          📞 <a href={telDeOrganizacion(org.contact_phone)}>{org.contact_phone}</a>
        </div>
      )}
    </div>
  );
}

// El teléfono es texto libre ("998 123 4567", "+52 (998)…"): para marcar, solo
// los dígitos y el "+".
export function telDeOrganizacion(phone) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export function RedesDeOrganizacion({ redes, style }) {
  return (
    <div className="team-info-links" style={style}>
      {redes.map((r) => (
        <a key={r.key} href={r.href} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
          {r.label}
        </a>
      ))}
    </div>
  );
}

export function redesDeOrganizacion(org) {
  return [
    { key: 'facebook_url',  label: 'Facebook',  href: org.facebook_url },
    { key: 'instagram_url', label: 'Instagram', href: org.instagram_url },
    { key: 'youtube_url',   label: 'YouTube',   href: org.youtube_url },
    { key: 'tiktok_url',    label: 'TikTok',    href: org.tiktok_url },
    { key: 'website_url',   label: 'Sitio web', href: org.website_url },
  ].filter((r) => r.href);
}

export function initials(name) {
  return name
    .split(' ')
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}
