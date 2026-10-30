import { useEffect } from 'react';
import { createPortal } from 'react-dom';

// Ficha de un medio: se abre encima de la pantalla, igual que la de un equipo
// (TeamInfoPanel), en vez de mandar a su página. La abren el directorio del
// home y "También transmiten" de un partido, cuando el medio no puso link para
// ese partido. Muestra lo mismo que su página le enseña al público —logo,
// nombre, verificada, país, descripción y sitio web—, y quien la abre ya trae
// esos datos (GET /organizations, GET /broadcasts/match/:id): no pide nada.
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

  const stop = (e) => e.stopPropagation();

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} onTouchStart={stop} onTouchEnd={stop}>
      <div className="team-profile-modal" onClick={stop}>

        {/* BANNER — una organización no tiene portada, va el degradado */}
        <div className="team-profile-banner">
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

          {org.website_url && (
            <div className="team-info-links">
              <a href={org.website_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
                Sitio web
              </a>
            </div>
          )}

          {!hasInfo && !org.website_url && (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13, textAlign: 'center', margin: '8px 0 0' }}>
              Todavía no agregó una descripción ni su sitio web.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
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
