import { Routes, Route, Link, useLocation } from 'react-router-dom';
import TopBar from './components/TopBar.jsx';
import SponsorBar from './components/SponsorBar.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Home from './pages/Home.jsx';
import YearSelectPage from './pages/YearSelectPage.jsx';
import TournamentMatchesPanel from './pages/TournamentMatchesPanel.jsx';
import LeagueStructurePanel from './pages/LeagueStructurePanel.jsx';
import LeaguePage from './pages/LeaguePage.jsx';
import TournamentPage from './pages/TournamentPage.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import MatchPage from './pages/MatchPage.jsx';
import PlayerCardPage from './pages/PlayerCardPage.jsx';
import RegisterOrganizationPage from './pages/RegisterOrganizationPage.jsx';
import OrganizationDetailPage from './pages/OrganizationDetailPage.jsx';
import ProductsPanel from './pages/ProductsPanel.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import RegisterLeague from './pages/RegisterLeague.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Notifications from './pages/Notifications.jsx';
import AdminPanel from './pages/AdminPanel.jsx';
import InviteClaim from './pages/InviteClaim.jsx';
import PoolJoinPage from './pages/PoolJoinPage.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AdminRoute from './components/AdminRoute.jsx';

export default function App() {
  const location = useLocation();
  return (
    <>
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
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/anios" element={<YearSelectPage />} />
            <Route path="/ligas/:slug" element={<LeaguePage />} />
            <Route path="/torneos/:tournamentId" element={<TournamentPage />} />
            <Route path="/categorias/:categoryId/calendario" element={<CalendarPage />} />
            <Route path="/partidos/:matchId" element={<MatchPage />} />
            <Route path="/jugador/:playerId" element={<PlayerCardPage />} />
            <Route path="/panel/organizacion/:id" element={<OrganizationDetailPage />} />
            <Route path="/iniciar-sesion" element={<Login />} />
            <Route path="/crear-cuenta" element={<Register />} />
            <Route path="/invitaciones/:token" element={<InviteClaim />} />
            <Route path="/quiniela/:code" element={<PoolJoinPage />} />
            <Route
              path="/registrar-liga"
              element={<ProtectedRoute><RegisterLeague /></ProtectedRoute>}
            />
            <Route
              path="/registrar-organizacion"
              element={<ProtectedRoute><RegisterOrganizationPage /></ProtectedRoute>}
            />
            <Route
              path="/panel"
              element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
            />
            <Route
              path="/panel/liga/:id"
              element={<ProtectedRoute><Dashboard kind="liga" /></ProtectedRoute>}
            />
            <Route
              path="/panel/liga/:id/estructura"
              element={<ProtectedRoute><LeagueStructurePanel /></ProtectedRoute>}
            />
            <Route
              path="/panel/liga/:id/:year/torneo/:tournamentId/partidos"
              element={<ProtectedRoute><TournamentMatchesPanel /></ProtectedRoute>}
            />
            <Route
              path="/panel/equipo/:id"
              element={<ProtectedRoute><Dashboard kind="equipo" /></ProtectedRoute>}
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
          </ErrorBoundary>
        </main>
      </div>
      <footer className="footer">
        <div className="container">CALENDARIOS DE FOOTBALL AMERICANO MÉXICO</div>
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
