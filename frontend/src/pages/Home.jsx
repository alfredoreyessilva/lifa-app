import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import TeamNiche from '../components/TeamNiche.jsx';
import TeamInfoPanel from '../components/TeamInfoPanel.jsx';
import OrganizationInfoPanel from '../components/OrganizationInfoPanel.jsx';
import { Casco } from '../components/MatchField.jsx';
import { imagenAjustada } from '../utils/imagenes.js';
import { equiposEnOrden, largoDelNombre, regionDeLiga } from '../utils/leagueDisplay.js';
import { useTeamPaint } from '../utils/useTeamPaint.js';

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
  // La sesión viaja con la visita para que el backend reconozca el navegador
  // del admin y no cuente sus visitas (ver routes/track.js).
  const { token } = useAuth();

  useEffect(() => {
    api.getLeagues().then(setLeagues).catch((e) => setError(e.message));
    api.getPublicTeams().then(setTeams).catch((e) => setTeamsError(e.message));
    api.getPublicOrganizations('media').then((d) => setMediaOrgs(d.organizations)).catch((e) => setMediaError(e.message));
    api.getPublicOrganizations('store').then((d) => setStoreOrgs(d.organizations)).catch((e) => setStoreError(e.message));
    if (!trackedHomeView.current) {
      trackedHomeView.current = true;
      api.trackEvent('home_view', null, token).catch(() => {});
    }
  }, []);

  function handleTeamClick(team) {
    setSelectedTeam((prev) => (prev?.id === team.id ? null : team));
  }

  return (
    <div className="container hm">
      <div className="hm-panel">
        <header className="hm-cabeza">
          <h1>Conectando al Football Americano de México</h1>
          <p>Encuentra los calendarios, categorías y transmisiones de las ligas de fútbol americano de todo el país.</p>
        </header>

        <section>
          <SectionHead
            id="ligas"
            title="Ligas"
            count={leagues?.length}
            registerTo="/registrar-liga"
            registerLabel="Registrar liga"
          />

          {error && <div className="form-error">{error}</div>}

          {!leagues && !error && (
            <>
              <div className="hm-ligas-marco" aria-hidden="true">
                <div className="hm-ligas hm-apagado"><Apagados clase="hm-liga" cuantos={4} /></div>
              </div>
              <p className="hm-carga" role="status">Cargando… La primera carga puede tardar unos segundos</p>
            </>
          )}

          {leagues && leagues.length === 0 && (
            <div className="empty-state">
              <h3>Todavía no hay ligas registradas</h3>
              <p>Muy pronto vas a encontrar aquí los calendarios de las ligas de fútbol americano de México.</p>
            </div>
          )}

          {leagues && leagues.length > 0 && (
            <div className="hm-ligas-marco">
              <div className="hm-ligas">
                {leagues.map((lg) => <LeagueTile key={lg.id} league={lg} />)}
              </div>
            </div>
          )}
        </section>

        <section>
          <SectionHead
            id="equipos"
            title="Equipos"
            count={teams?.length}
            registerTo="/registrar-equipo"
            registerLabel="Registrar equipo"
          />

          {teamsError && <div className="form-error">{teamsError}</div>}

          {!teams && !teamsError && (
            <div className="hm-muro-marco" aria-hidden="true">
              <div className="hm-muro hm-apagado"><Apagados clase="hm-nicho" cuantos={24} /></div>
            </div>
          )}

          {teams && teams.length === 0 && (
            <div className="empty-state">
              <h3>Todavía no hay equipos registrados</h3>
              <p>En cuanto una liga publicada tenga equipos en su roster, o un equipo independiente decida mostrarse, van a aparecer aquí.</p>
            </div>
          )}

          {teams && teams.length > 0 && (
            <div className="hm-muro-marco">
              <div className="hm-muro" style={{ '--n': teams.length }}>
                {equiposEnOrden(teams).map((team) => (
                  <TeamNiche
                    key={team.id}
                    team={team}
                    isSelected={selectedTeam?.id === team.id}
                    onClick={() => handleTeamClick(team)}
                  />
                ))}
                <Link to="/registrar-equipo" className="hm-libre">
                  <span className="hm-libre-titulo">¿Falta tu equipo?</span>
                  <span className="hm-libre-accion">Regístralo</span>
                </Link>
              </div>
            </div>
          )}
          {selectedTeam && (
            <TeamInfoPanel
              team={selectedTeam}
              leagueId={selectedTeam.league_id}
              onClose={() => setSelectedTeam(null)}
            />
          )}
        </section>

        <div className="hm-directorio">
          <OrganizationDirectorySection
            id="medios"
            title="Medios de comunicación"
            orgs={mediaOrgs}
            error={mediaError}
            emptyTitle="Todavía no hay medios registrados"
            emptyText="En cuanto se publique un medio de comunicación, va a aparecer aquí."
            registerTo="/registrar-organizacion?tipo=media"
            registerLabel="Registrar medio"
            selectedId={selectedMedia?.id}
            onSelect={setSelectedMedia}
          />
          <OrganizationDirectorySection
            id="tiendas"
            title="Tiendas y proveedores"
            orgs={storeOrgs}
            error={storeError}
            emptyTitle="Todavía no hay tiendas ni proveedores registrados"
            emptyText="En cuanto se publique una tienda o proveedor, va a aparecer aquí."
            registerTo="/registrar-organizacion?tipo=store"
            registerLabel="Registrar tienda o proveedor"
          />
        </div>
        {selectedMedia && (
          <OrganizationInfoPanel org={selectedMedia} onClose={() => setSelectedMedia(null)} />
        )}
      </div>
    </div>
  );
}

// Mientras la API despierta (hasta 40 s, PD-03) el home enseña su forma, apagada,
// en vez de cuatro letreros de "Cargando…": para quien llega en frío, esta es la
// primera impresión.
function Apagados({ clase, cuantos }) {
  return Array.from({ length: cuantos }, (_, i) => <span key={i} className={clase} />);
}

// Una liga en el home: su end zone, pintada con el color de su logo como en su
// propia página, con el nombre rotulado y hasta dónde llega.
function LeagueTile({ league }) {
  const pintura = useTeamPaint(league.logo_url, null, { alInstante: true });
  const region = regionDeLiga(league);

  return (
    <Link
      to={`/ligas/${league.slug}`}
      className="hm-liga"
      style={{ '--home': pintura.fondo, '--home-ink': pintura.tinta, '--len': largoDelNombre(league.name) }}
    >
      <span className="hm-liga-marca">
        <Casco lado="home" nombre={league.name} logo={league.logo_url} pintura={pintura} ancho={240} alt="" />
        <span className="hm-liga-nombre">{league.name}</span>
      </span>
      <span className="hm-liga-placa" title={league.state}>{region}</span>
    </Link>
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
function OrganizationDirectorySection({ id, title, orgs, error, emptyTitle, emptyText, registerTo, registerLabel, selectedId, onSelect }) {
  return (
    <section>
      <SectionHead
        id={id}
        title={title}
        count={orgs?.length}
        registerTo={registerTo}
        registerLabel={registerLabel}
      />

      {error && <div className="form-error">{error}</div>}

      {!orgs && !error && (
        <div className="hm-orgs hm-apagado" aria-hidden="true"><Apagados clase="hm-org" cuantos={1} /></div>
      )}

      {orgs && orgs.length === 0 && (
        <div className="empty-state">
          <h3>{emptyTitle}</h3>
          <p>{emptyText}</p>
        </div>
      )}

      {orgs && orgs.length > 0 && (
        <div className="hm-orgs">
          {orgs.map((org) => {
            const content = (
              <>
                <span className="hm-org-logo">
                  {org.logo_url ? <img src={imagenAjustada(org.logo_url, 112)} alt="" /> : initials(org.name)}
                </span>
                <span className="hm-org-nombre">
                  {org.name}
                  {org.is_verified && (
                    <span className="team-card-verified" title="Verificada" aria-label="Verificada">✓</span>
                  )}
                </span>
              </>
            );
            return onSelect ? (
              <button
                key={org.id}
                type="button"
                className={`hm-org${selectedId === org.id ? ' is-activo' : ''}`}
                onClick={() => onSelect(org)}
              >
                {content}
              </button>
            ) : (
              <Link key={org.id} to={`/panel/organizacion/${org.id}`} className="hm-org">
                {content}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

// Encabezado de cada sección del home, con su botón de "Registrar…". El
// botón se ve con sesión y sin ella y siempre lleva a la misma pantalla de
// registro: si no hay sesión, es la ruta la que pide crear cuenta y después
// regresa ahí (ver ProtectedRoute), así que el home no decide nada.
function SectionHead({ id, title, count, registerTo, registerLabel }) {
  return (
    <div className="section-head home-section-head" id={id}>
      <h2>{title}{count > 0 && <span className="hm-cuenta">{count}</span>}</h2>
      <Link to={registerTo} className="btn btn-outline btn-sm">{registerLabel}</Link>
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
