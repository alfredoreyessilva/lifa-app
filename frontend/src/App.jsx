import { lazy, Suspense, useLayoutEffect } from 'react';
import { Routes, Route, Link, Navigate, useLocation, useParams } from 'react-router-dom';
import TopBar from './components/TopBar.jsx';
import SponsorBar from './components/SponsorBar.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Loading from './components/Loading.jsx';
import Home from './pages/Home.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AdminRoute from './components/AdminRoute.jsx';

// Todo lo que no sea Home se carga bajo demanda (code-splitting) en vez de
// venir en el bundle principal — así la primera visita (casi siempre a "/")
// no descarga también el panel de admin, el dashboard, etc. Ver
// vite.config.js: los chunks resultantes se nombran con hash genérico, no
// con el nombre de la página, para no repetir el bloqueo de Brave Shields
// que tuvimos con PrivacyPolicy.jsx en dev.
const YearSelectPage = lazy(() => import('./pages/YearSelectPage.jsx'));
const TournamentMatchesPanel = lazy(() => import('./pages/TournamentMatchesPanel.jsx'));
const LeagueStructurePanel = lazy(() => import('./pages/LeagueStructurePanel.jsx'));
const LeaguePage = lazy(() => import('./pages/LeaguePage.jsx'));
const TournamentPage = lazy(() => import('./pages/TournamentPage.jsx'));
const CalendarPage = lazy(() => import('./pages/CalendarPage.jsx'));
const MatchPage = lazy(() => import('./pages/MatchPage.jsx'));
const PlayerCardPage = lazy(() => import('./pages/PlayerCardPage.jsx'));
const PublicRosterPage = lazy(() => import('./pages/PublicRosterPage.jsx'));
const RegisterOrganizationPage = lazy(() => import('./pages/RegisterOrganizationPage.jsx'));
const OrganizationDetailPage = lazy(() => import('./pages/OrganizationDetailPage.jsx'));
const ProductsPanel = lazy(() => import('./pages/ProductsPanel.jsx'));
const BillingLeaguePanel = lazy(() => import('./pages/BillingLeaguePanel.jsx'));
const TeamPanel = lazy(() => import('./pages/TeamPanel.jsx'));
const PlayerStatementPage = lazy(() => import('./pages/PlayerStatementPage.jsx'));
const Login = lazy(() => import('./pages/Login.jsx'));
const Register = lazy(() => import('./pages/Register.jsx'));
const RegisterLeague = lazy(() => import('./pages/RegisterLeague.jsx'));
const RegisterTeamPage = lazy(() => import('./pages/RegisterTeamPage.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Notifications = lazy(() => import('./pages/Notifications.jsx'));
const AdminPanel = lazy(() => import('./pages/AdminPanel.jsx'));
const InviteClaim = lazy(() => import('./pages/InviteClaim.jsx'));
const PoolJoinPage = lazy(() => import('./pages/PoolJoinPage.jsx'));
const TermsOfService = lazy(() => import('./pages/TermsOfService.jsx'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy.jsx'));

// Las páginas legales solo se publican cuando hay datos reales de quien
// opera el Servicio. Se llenan en un solo lugar: src/config/legal.js.
import { LEGAL_DATA_READY, PRIVACY_PUBLISHED } from './config/legal.js';

// La pantalla clásica de liga (/panel/liga/:id, modelo plano sin torneos) se
// retiró — todo lo que hacía ya vive en LeagueStructurePanel.jsx, y en
// producción ninguna liga tenía ya partidos en el modelo viejo (se verificó
// contra la base antes de quitarla). Este redirect es solo para no romper
// links/bookmarks viejos que alguien todavía tenga guardados.
function RedirectToLeagueStructure() {
  const { id } = useParams();
  return <Navigate to={`/panel/liga/${id}/estructura`} replace />;
}

// Al navegar a otra ruta, React Router conserva el scroll de la página
// anterior — así que al entrar a la MatchPage desde un calendario ya
// deslizado quedabas "al fondo". Esto reinicia el scroll arriba en cada
// cambio de ruta (no en cambios de query string, para no romper filtros).
function ScrollToTop() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  const location = useLocation();
  return (
    <>
      <ScrollToTop />
      <TopBar />
      <div className="app-layout">
        <SponsorBar />
        <main className="app-main">
          {/* La key en location.pathname hace que el ErrorBoundary se
              "resetee" solo al navegar a otra ruta, así que si una página
              llega a fallar, el usuario puede salir de ella sin tener que
              recargar toda la app a mano. TopBar, SponsorBar y footer viven
              fuera de este boundary, así que siguen visibles aunque una
              página específica truene. */}
          <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/anios" element={<YearSelectPage />} />
            <Route path="/ligas/:slug" element={<LeaguePage />} />
            <Route path="/torneos/:tournamentId" element={<TournamentPage />} />
            <Route path="/categorias/:categoryId/calendario" element={<CalendarPage />} />
            <Route path="/partidos/:matchId" element={<MatchPage />} />
            <Route path="/jugador/:playerId" element={<PlayerCardPage />} />
            {/* El roster público cuelga de la rama + el equipo, que es donde
                vive de verdad un roster. Se llega desde el partido; si la
                categoría no lo publica, el endpoint contesta 404. */}
            <Route path="/ramas/:branchId/equipos/:teamId/roster" element={<PublicRosterPage />} />
            <Route path="/panel/organizacion/:id" element={<OrganizationDetailPage />} />
            <Route path="/iniciar-sesion" element={<Login />} />
            <Route path="/crear-cuenta" element={<Register />} />
            <Route path="/invitaciones/:token" element={<InviteClaim />} />
            <Route path="/quiniela/:code" element={<PoolJoinPage />} />
            {/* Estado de cuenta de un jugador, SIN sesión: el papá lo abre
                desde WhatsApp y el token de la URL es la credencial. Va fuera
                de ProtectedRoute a propósito — exigir cuenta aquí es
                exactamente la fricción que mata el cobro. */}
            <Route path="/cuenta/:shareToken" element={<PlayerStatementPage />} />
            {/* Mientras falten los datos de src/config/legal.js, /terminos
                no existe y cae en la pantalla de "no encontrado": unos
                Términos sin saber quién los emite ni ante qué tribunales
                se reclaman no obligan a nada. El Aviso de Privacidad sí se
                queda publicado — el login con Google exige que ese link
                funcione. */}
            {LEGAL_DATA_READY && <Route path="/terminos" element={<TermsOfService />} />}
            {PRIVACY_PUBLISHED && <Route path="/privacidad" element={<PrivacyPolicy />} />}
            <Route
              path="/registrar-liga"
              element={<ProtectedRoute><RegisterLeague /></ProtectedRoute>}
            />
            <Route
              path="/registrar-organizacion"
              element={<ProtectedRoute><RegisterOrganizationPage /></ProtectedRoute>}
            />
            <Route
              path="/registrar-equipo"
              element={<ProtectedRoute><RegisterTeamPage /></ProtectedRoute>}
            />
            <Route
              path="/panel"
              element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
            />
            <Route
              path="/panel/liga/:id"
              element={<ProtectedRoute><RedirectToLeagueStructure /></ProtectedRoute>}
            />
            <Route
              path="/panel/liga/:id/estructura"
              element={<ProtectedRoute><LeagueStructurePanel /></ProtectedRoute>}
            />
            <Route
              path="/panel/liga/:id/cobranza"
              element={<ProtectedRoute><BillingLeaguePanel /></ProtectedRoute>}
            />
            <Route
              path="/panel/liga/:id/:year/torneo/:tournamentId/partidos"
              element={<ProtectedRoute><TournamentMatchesPanel /></ProtectedRoute>}
            />
            {/* Panel de trabajo del equipo. Una página, seis secciones — ver
                pages/TeamPanel.jsx. La ruta de estado de cuenta conserva su
                URL de siempre porque ya viaja dentro de notificaciones
                (data.url en routes/billing.js) y en links guardados. */}
            <Route
              path="/panel/equipo/:id"
              element={<ProtectedRoute><TeamPanel section="resumen" /></ProtectedRoute>}
            />
            <Route
              path="/panel/equipo/:id/finanzas"
              element={<ProtectedRoute><TeamPanel section="finanzas" /></ProtectedRoute>}
            />
            <Route
              path="/panel/equipo/:id/jugadores"
              element={<ProtectedRoute><TeamPanel section="jugadores" /></ProtectedRoute>}
            />
            <Route
              path="/panel/equipo/:id/estado-de-cuenta"
              element={<ProtectedRoute><TeamPanel section="liga" /></ProtectedRoute>}
            />
            <Route
              path="/panel/equipo/:id/perfil"
              element={<ProtectedRoute><TeamPanel section="perfil" /></ProtectedRoute>}
            />
            <Route
              path="/panel/equipo/:id/administradores"
              element={<ProtectedRoute><TeamPanel section="administradores" /></ProtectedRoute>}
            />
            <Route
              path="/panel/organizacion/:id/inventario"
              element={<ProtectedRoute><ProductsPanel /></ProtectedRoute>}
            />
            <Route
              path="/notificaciones"
              element={<ProtectedRoute><Notifications /></ProtectedRoute>}
            />
            <Route
              path="/admin"
              element={<AdminRoute><AdminPanel /></AdminRoute>}
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <footer className="footer">
        <div className="container">
          <img
            className="footer-logo"
            src="/cfbamx.jpg"
            alt="CFBAMX — Calendarios de Football Americano México"
          />
          {(LEGAL_DATA_READY || PRIVACY_PUBLISHED) && (
            <div className="footer-links">
              {LEGAL_DATA_READY && <Link to="/terminos">Términos de Servicio</Link>}
              {LEGAL_DATA_READY && PRIVACY_PUBLISHED && <span aria-hidden="true">·</span>}
              {PRIVACY_PUBLISHED && <Link to="/privacidad">Aviso de Privacidad</Link>}
            </div>
          )}
        </div>
      </footer>
    </>
  );
}

function NotFound() {
  return (
    <div className="container">
      <div className="empty-state">
        <h3>Página no encontrada</h3>
        <p><Link to="/" style={{ color: 'var(--flag)' }}>Volver al inicio</Link></p>
      </div>
    </div>
  );
}
