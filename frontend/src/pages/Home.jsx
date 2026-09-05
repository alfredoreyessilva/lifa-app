import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Loading from '../components/Loading.jsx';
import TeamCard from '../components/TeamCard.jsx';
import TeamInfoPanel from '../components/TeamInfoPanel.jsx';

export default function Home() {
  const [leagues, setLeagues] = useState(null);
  const [error, setError] = useState('');

  const [teams, setTeams] = useState(null);
  const [teamsError, setTeamsError] = useState('');
  const [selectedTeam, setSelectedTeam] = useState(null);

  const [mediaOrgs, setMediaOrgs] = useState(null);
  const [mediaError, setMediaError] = useState('');

  const [storeOrgs, setStoreOrgs] = useState(null);
  const [storeError, setStoreError] = useState('');

  // Candado para que la visita se registre una sola vez. Sin esto, en
  // desarrollo (npm run dev) React.StrictMode dispara este useEffect dos
  // veces a propósito (para ayudar a detectar efectos mal hechos), y
  // contaríamos cada visita como 2. El ref sobrevive ese doble-arranque
  // porque StrictMode no destruye el componente, solo repite los efectos.
  const trackedHomeView = useRef(false);

  useEffect(() => {
    api.getLeagues().then(setLeagues).catch((e) => setError(e.message));
    api.getPublicTeams().then(setTeams).catch((e) => setTeamsError(e.message));
    api.getPublicOrganizations('media').then((d) => setMediaOrgs(d.organizations)).catch((e) => setMediaError(e.message));
    api.getPublicOrganizations('store').then((d) => setStoreOrgs(d.organizations)).catch((e) => setStoreError(e.message));
    if (!trackedHomeView.current) {
      trackedHomeView.current = true;
      api.trackEvent('home_view').catch(() => {});
    }
  }, []);

  function handleTeamClick(team) {
    setSelectedTeam((prev) => (prev?.id === team.id ? null : team));
  }

  return (
    <div className="container">
      <div className="section-head" id="ligas">
        <h2>Ligas</h2>
        {leagues && <span className="count">{leagues.length} registradas</span>}
      </div>

      {error && <div className="form-error">{error}</div>}

      {!leagues && !error && <Loading message="Cargando ligas…" />}

      {leagues && leagues.length === 0 && (
        <div className="empty-state">
          <h3>Todavía no hay ligas registradas</h3>
          <p>Muy pronto vas a encontrar aquí los calendarios de las ligas de fútbol americano de México.</p>
        </div>
      )}

      {leagues && leagues.length > 0 && (
        <div className="league-grid">
          {leagues.map((lg) => (
            <Link key={lg.id} to={`/ligas/${lg.slug}`} className="league-card">
              <div className="league-logo">
                {lg.logo_url
                  ? <img src={lg.logo_url} alt={lg.name} />
                  : initials(lg.name)}
              </div>
              <h3>{lg.name}</h3>
            </Link>
          ))}
        </div>
      )}

      <div className="section-head" id="equipos" style={{ marginTop: 28 }}>
        <h2>Equipos</h2>
        {teams && <span className="count">{teams.length} registrados</span>}
      </div>

      {teamsError && <div className="form-error">{teamsError}</div>}

      {!teams && !teamsError && <Loading message="Cargando equipos…" />}

      {teams && teams.length === 0 && (
        <div className="empty-state">
          <h3>Todavía no hay equipos registrados</h3>
          <p>En cuanto una liga publicada tenga equipos en su roster, van a aparecer aquí.</p>
        </div>
      )}

      {teams && teams.length > 0 && (
        <>
          <div className="team-grid">
            {teams.map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                isSelected={selectedTeam?.id === team.id}
                onClick={() => handleTeamClick(team)}
              />
            ))}
          </div>
          {selectedTeam && (
            <TeamInfoPanel
              team={selectedTeam}
              leagueId={selectedTeam.league_id}
              onClose={() => setSelectedTeam(null)}
            />
          )}
        </>
      )}

      <OrganizationDirectorySection
        id="medios"
        title="Medios de comunicación"
        orgs={mediaOrgs}
        error={mediaError}
        loadingMessage="Cargando medios…"
        emptyTitle="Todavía no hay medios verificados"
        emptyText="En cuanto un medio de comunicación sea verificado, va a aparecer aquí."
      />

      <OrganizationDirectorySection
        id="tiendas"
        title="Tiendas y proveedores"
        orgs={storeOrgs}
        error={storeError}
        loadingMessage="Cargando tiendas y proveedores…"
        emptyTitle="Todavía no hay tiendas ni proveedores verificados"
        emptyText="En cuanto una tienda o proveedor sea verificado, va a aparecer aquí."
      />

      <section className="hero">
        <span className="eyebrow">Temporada en curso</span>
        <h1>Conectando al Football<br />Americano de México</h1>
        <p>Encuentra los calendarios, categorías y transmisiones de las ligas de fútbol americano de todo el país.</p>
        <div className="hero-actions">
          <a href="#ligas" className="btn btn-flag">Ir al inicio</a>
        </div>
      </section>
    </div>
  );
}

// Reusado para cualquier tipo de organización que se muestre como
// directorio público en el home (medios, tiendas/proveedores, y los que
// sigan) — mismo layout, solo cambian los datos y los textos.
function OrganizationDirectorySection({ id, title, orgs, error, loadingMessage, emptyTitle, emptyText }) {
  return (
    <>
      <div className="section-head" id={id} style={{ marginTop: 28 }}>
        <h2>{title}</h2>
        {orgs && <span className="count">{orgs.length} verificados</span>}
      </div>

      {error && <div className="form-error">{error}</div>}

      {!orgs && !error && <Loading message={loadingMessage} />}

      {orgs && orgs.length === 0 && (
        <div className="empty-state">
          <h3>{emptyTitle}</h3>
          <p>{emptyText}</p>
        </div>
      )}

      {orgs && orgs.length > 0 && (
        <div className="league-grid">
          {orgs.map((org) => (
            <Link key={org.id} to={`/panel/organizacion/${org.id}`} className="league-card">
              {org.logo_url ? (
                <img src={org.logo_url} alt={org.name} style={{ width: 56, height: 56, borderRadius: '50%' }} />
              ) : (
                <div style={{
                  width: 56, height: 56, borderRadius: '50%', background: 'var(--surface)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-display)', color: 'var(--flag)',
                }}>
                  {initials(org.name)}
                </div>
              )}
              <h3>{org.name}</h3>
            </Link>
          ))}
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
