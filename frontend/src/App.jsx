import { Routes, Route, Link } from 'react-router-dom';
import TopBar from './components/TopBar.jsx';
import SponsorBar from './components/SponsorBar.jsx';
import Home from './pages/Home.jsx';
import LeaguePage from './pages/LeaguePage.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import MatchPage from './pages/MatchPage.jsx';
import UpcomingPage from './pages/UpcomingPage.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import RegisterLeague from './pages/RegisterLeague.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AdminPanel from './pages/AdminPanel.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AdminRoute from './components/AdminRoute.jsx';

export default function App() {
  return (
    <>
      <TopBar />
      <div className="app-layout">
        <SponsorBar />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/partidos" element={<UpcomingPage />} />
            <Route path="/ligas/:slug" element={<LeaguePage />} />
            <Route path="/categorias/:categoryId/calendario" element={<CalendarPage />} />
            <Route path="/partidos/:matchId" element={<MatchPage />} />
            <Route path="/iniciar-sesion" element={<Login />} />
            <Route path="/crear-cuenta" element={<Register />} />
            <Route
              path="/registrar-liga"
              element={<ProtectedRoute><RegisterLeague /></ProtectedRoute>}
            />
            <Route
              path="/panel"
              element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
            />
            <Route
              path="/admin"
              element={<AdminRoute><AdminPanel /></AdminRoute>}
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
      <footer className="footer">
        <div className="container">CALENDARIO DE FOOTBALL AMERICANO MEXICO</div>
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