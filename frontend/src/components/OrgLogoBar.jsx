import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { initials } from '../utils/matchDisplay.js';

// Barra de logos de las ligas/equipos que administras, para cambiar de
// organización sin tener que volver a /panel. Antes solo vivía dentro de
// Dashboard.jsx (la pantalla vieja); se saca aquí para poder mostrarla
// también arriba de las pantallas nuevas (Torneos, Categorías, Ramas,
// Partidos del Torneo) mientras trabajas dentro de ellas.
export default function OrgLogoBar({ selectedKind, selectedId }) {
  const { leagues, teams } = useAuth();
  const navigate = useNavigate();

  const orgs = [
    ...leagues.map((lg) => ({ ...lg, kind: 'liga' })),
    ...teams.map((tm) => ({ ...tm, kind: 'equipo' })),
  ];
  const selected = orgs.find((org) => org.kind === selectedKind && String(org.id) === String(selectedId));

  function handleLogoClick(e, org) {
    if (org === selected) {
      e.preventDefault();
      navigate('/panel');
    }
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div className="section-head">
        <h2>Organizaciones administradas</h2>
        <Link to="/registrar-liga" className="btn btn-outline btn-sm">Registrar liga</Link>
      </div>
      <div className="org-logo-grid">
        {orgs.map((org) => (
          <Link
            key={`${org.kind}-${org.id}`}
            to={org.kind === 'liga' ? `/panel/liga/${org.id}/torneos` : `/panel/${org.kind}/${org.id}`}
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
