import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Loading from '../components/Loading.jsx';
import TeamCard from '../components/TeamCard.jsx';
import TeamInfoPanel from '../components/TeamInfoPanel.jsx';
import OrganizationInfoPanel from '../components/OrganizationInfoPanel.jsx';

export default function Home() {
  const [leagues, setLeagues] = useState(null);
  const [error, setError] = useState('');

  const [teams, setTeams] = useState(null);
  const [teamsError, setTeamsError] = useState('');
  const [selectedTeam, setSelectedTeam] = useState(null);

  const [mediaOrgs, setMediaOrgs] = useState(null);
  const [mediaError, setMediaError] = useState('');
  const [selectedMedia, setSelectedMedia] = useState(null);

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
      <SectionHead
        id="ligas"
        title="Ligas"
        count={leagues && `${leagues.length} registradas`}
        registerTo="/registrar-liga"
        registerLabel="Registrar liga"
      />

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

      <SectionHead
        id="equipos"
        title="Equipos"
        count={teams && `${teams.length} registrados`}
        registerTo="/registrar-equipo"
        registerLabel="Registrar equipo"
        style={{ marginTop: 28 }}
      />

      {teamsError && <div className="form-error">{teamsError}</div>}

      {!teams && !teamsError && <Loading message="Cargando equipos…" />}

      {teams && teams.length === 0 && (
        <div className="empty-state">
          <h3>Todavía no hay equipos registrados</h3>
          <p>En cuanto una liga publicada tenga equipos en su roster, o un equipo independiente decida mostrarse, van a aparecer aquí.</p>
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
        emptyTitle="Todavía no hay medios registrados"
        emptyText="En cuanto se publique un medio de comunicación, va a aparecer aquí."
        registerTo="/registrar-organizacion?tipo=media"
        registerLabel="Registrar medio"
        selectedId={selectedMedia?.id}
        onSelect={setSelectedMedia}
      />
      {selectedMedia && (
        <OrganizationInfoPanel org={selectedMedia} onClose={() => setSelectedMedia(null)} />
      )}

      <OrganizationDirectorySection
        id="tiendas"
        title="Tiendas y proveedores"
        orgs={storeOrgs}
        error={storeError}
        loadingMessage="Cargando tiendas y proveedores…"
        emptyTitle="Todavía no hay tiendas ni proveedores registrados"
        emptyText="En cuanto se publique una tienda o proveedor, va a aparecer aquí."
        registerTo="/registrar-organizacion?tipo=store"
        registerLabel="Registrar tienda o proveedor"
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
//
// Aquí sale lo PUBLICADO, verificado o no: desde el 2026-10-29 son dos botones
// del admin (README, "Organizaciones: publicar y verificar"), así que la
// verificación se dice en cada tarjeta con la palomita, como en Equipos.
//
// Con `onSelect`, tocar una tarjeta abre su ficha encima del home, como la de
// un equipo: así van los medios, cuya página no le enseña al público nada que
// no quepa en la ficha. Sin él, la tarjeta lleva a su página: así van las
// tiendas, que ahí tienen su catálogo y el botón de WhatsApp.
function OrganizationDirectorySection({ id, title, orgs, error, loadingMessage, emptyTitle, emptyText, registerTo, registerLabel, selectedId, onSelect }) {
  return (
    <>
      <SectionHead
        id={id}
        title={title}
        count={orgs && `${orgs.length} registrados`}
        registerTo={registerTo}
        registerLabel={registerLabel}
        style={{ marginTop: 28 }}
      />

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
          {orgs.map((org) => {
            const content = (
              <>
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
                <h3>
                  {org.name}
                  {org.is_verified && (
                    <span className="team-card-verified" title="Verificada" aria-label="Verificada">✓</span>
                  )}
                </h3>
              </>
            );
            return onSelect ? (
              <button
                key={org.id}
                type="button"
                className={`league-card${selectedId === org.id ? ' league-card--selected' : ''}`}
                onClick={() => onSelect(org)}
              >
                {content}
              </button>
            ) : (
              <Link key={org.id} to={`/panel/organizacion/${org.id}`} className="league-card">
                {content}
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

// Encabezado de cada sección del home, con su botón de "Registrar…". El
// botón se ve con sesión y sin ella y siempre lleva a la misma pantalla de
// registro: si no hay sesión, es la ruta la que pide crear cuenta y después
// regresa ahí (ver ProtectedRoute), así que el home no decide nada.
function SectionHead({ id, title, count, registerTo, registerLabel, style }) {
  return (
    <div className="section-head home-section-head" id={id} style={style}>
      <h2>{title}</h2>
      <div className="home-section-actions">
        {count && <span className="count">{count}</span>}
        <Link to={registerTo} className="btn btn-flag btn-sm">{registerLabel}</Link>
      </div>
    </div>
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
