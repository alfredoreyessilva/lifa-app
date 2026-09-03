import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { initials } from '../utils/matchDisplay.js';

// Barra de logos de las ligas/equipos que administras, para cambiar de
// organización sin tener que volver a /panel. Antes solo vivía dentro de
// Dashboard.jsx (la pantalla vieja); se saca aquí para poder mostrarla
// también arriba de las pantallas nuevas (Torneos, Categorías, Ramas,
// Partidos del Torneo) mientras trabajas dentro de ellas.
export default function OrgLogoBar({ selectedKind, selectedId }) {
  const { leagues, teams, organizations } = useAuth();
  const navigate = useNavigate();

  // "organizations" trae TODO (incluye type='league', que ya se muestra
  // abajo vía "leagues") — aquí solo se agregan los tipos nuevos, para no
  // duplicar logos de la misma liga dos veces.
  const otherOrgs = (organizations || []).filter((o) => !['league', 'team'].includes(o.type));

  const orgs = [
    ...leagues.map((lg) => ({ ...lg, kind: 'liga' })),
    ...teams.map((tm) => ({ ...tm, kind: 'equipo' })),
    ...otherOrgs.map((o) => ({ ...o, kind: 'organizacion' })),
  ];
  const selected = orgs.find((org) => org.kind === selectedKind && String(org.id) === String(selectedId));

  function handleLogoClick(e, org) {
    if (org === selected) {
      e.preventDefault();
      navigate('/panel');
    }
  }

  function linkFor(org) {
    if (org.kind === 'liga') return `/panel/liga/${org.id}/estructura`;
    if (org.kind === 'organizacion') return `/panel/organizacion/${org.id}?edit=1`;
    return `/panel/${org.kind}/${org.id}`;
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div className="section-head">
        <h2>Organizaciones administradas</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/registrar-liga" className="btn btn-outline btn-sm">Registrar liga</Link>
          <Link to="/registrar-organizacion" className="btn btn-outline btn-sm">Registrar organización</Link>
        </div>
      </div>
      <div className="org-logo-grid">
        {orgs.map((org) => (
          <Link
            key={`${org.kind}-${org.id}`}
            to={linkFor(org)}
            onClick={(e) => handleLogoClick(e, org)}
            className={`league-logo-btn${org === selected ? ' league-logo-btn--active' : ''}`}
            style={{ width: 72, height: 72 }}
          >
            <div className="league-logo" style={{ width: '100%', height: '100%', fontSize: 22 }}>
              {org.logo_url ? <img src={org.logo_url} alt={org.name} /> : initials(org.name)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
