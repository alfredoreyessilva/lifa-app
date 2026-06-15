import { Routes, Route, Link } from 'react-router-dom';
import TopBar from './components/TopBar.jsx';
import Home from './pages/Home.jsx';
import LeaguePage from './pages/LeaguePage.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import RegisterLeague from './pages/RegisterLeague.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

export default function App() {
  return (
    <>
      <TopBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/ligas/:slug" element={<LeaguePage />} />
        <Route path="/categorias/:categoryId/calendario" element={<CalendarPage />} />
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
        <Route path="*" element={<NotFound />} />
      </Routes>
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
