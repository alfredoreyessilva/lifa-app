import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

function initials(name) {
  if (!name) return '';
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

export default function Notifications() {
  const { leagues, teams } = useAuth();
  const [selected, setSelected] = useState(null);
  const orgs = [
    ...leagues.map((lg) => ({ ...lg, kind: 'liga' })),
    ...teams.map((tm) => ({ ...tm, kind: 'equipo' })),
  ];

  function handleLogoClick(org) {
    setSelected((current) => (
      current && current.kind === org.kind && current.id === org.id ? null : org
    ));
  }

  return (
    <div className="container">
      <div className="section-head">
        <h2>Notificaciones</h2>
      </div>

      <div className="section-head" style={{ marginTop: 8 }}>
        <h2 style={{ fontSize: 16 }}>Organizaciones administradas</h2>
      </div>
      <div className="org-logo-grid">
        {orgs.map((org) => (
          <button
            key={`${org.kind}-${org.id}`}
            onClick={() => handleLogoClick(org)}
            className={`league-logo-btn${selected && selected.kind === org.kind && selected.id === org.id ? ' league-logo-btn--active' : ''}`}
            style={{ width: 72, height: 72 }}
          >
            <div className="league-logo" style={{ width: '100%', height: '100%', fontSize: 22 }}>
              {org.logo_url ? <img src={org.logo_url} alt={org.name} /> : initials(org.name)}
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="section-head" style={{ marginTop: 32 }}>
          <h2>Notificaciones de {selected.name}</h2>
        </div>
      )}
      {selected && (
        <div className="empty-state">
          <h3>Sin notificaciones todavía</h3>
        </div>
      )}

      <div className="section-head" style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 16 }}>Partidos que sigo</h2>
      </div>
    </div>
  );
}
