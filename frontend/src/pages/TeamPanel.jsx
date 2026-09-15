import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import TeamWorkspace from '../components/TeamWorkspace.jsx';
import TeamOverviewSection from '../components/TeamOverviewSection.jsx';
import TeamFinancesSection from '../components/TeamFinancesSection.jsx';
import TeamRosterSection from '../components/TeamRosterSection.jsx';
import TeamLeagueStatementSection from '../components/TeamLeagueStatementSection.jsx';
import TeamProfileSection from '../components/TeamProfileSection.jsx';
import OrgAdminsPanel from '../components/OrgAdminsPanel.jsx';

// Panel de trabajo de un equipo. Una sola página que resuelve el equipo y el
// permiso una vez, y monta la sección que pide la ruta — en vez de seis
// páginas repitiendo la misma comprobación.
//
// Ojo: esto es solo la comprobación de la UI (no mostrarle a alguien un panel
// que no es suyo). El permiso de verdad lo aplica el backend en cada endpoint
// con teamOwnerRequired; aquí no se decide nada de seguridad.
export default function TeamPanel({ section = 'resumen' }) {
  const { id } = useParams();
  const { teams, token, refreshLeagues } = useAuth();
  const navigate = useNavigate();

  const team = (teams || []).find((t) => String(t.id) === String(id));

  if (!token) {
    return <div className="container"><p>Necesitas iniciar sesión para ver esto.</p></div>;
  }

  if (!team) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No tienes permiso para ver este panel</h3>
          <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={() => navigate('/panel')}>
            Volver a mi panel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="dashboard-panel">
        <TeamWorkspace team={team}>
          {section === 'resumen' && <TeamOverviewSection team={team} token={token} />}
          {section === 'finanzas' && <TeamFinancesSection team={team} token={token} />}
          {section === 'jugadores' && <TeamRosterSection team={team} token={token} />}
          {section === 'liga' && <TeamLeagueStatementSection team={team} token={token} />}
          {section === 'perfil' && (
            <TeamProfileSection team={team} token={token} onChange={refreshLeagues} />
          )}
          {section === 'administradores' && (
            team.organization_id ? (
              <OrgAdminsPanel
                organizationId={team.organization_id}
                organizationName={team.name}
                token={token}
              />
            ) : (
              <p style={{ color: 'var(--ws-ink-dim)', fontSize: 13 }}>
                Este equipo todavía no tiene una organización enlazada, así que no se le pueden
                invitar administradores. Avísanos para revisarlo.
              </p>
            )
          )}
        </TeamWorkspace>
      </div>
    </div>
  );
}
