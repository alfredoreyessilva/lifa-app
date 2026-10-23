import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Con `signupReason`, quien llega sin sesión no va al login sino a CREAR
// cuenta, y se lleva a dónde iba (`from`) para continuar ahí en cuanto la
// tenga. Es lo que pasa con los botones de "Registrar…" del home: quien los
// toca sin sesión casi siempre es alguien nuevo. Crear cuenta e Iniciar
// sesión se pasan ese estado entre sí, así que quien ya tenía cuenta puede
// cambiarse al login sin perder el destino.
export default function ProtectedRoute({ children, signupReason }) {
  const { token, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="container"><div className="loading">Cargando…</div></div>;
  if (!token && signupReason) {
    const from = location.pathname + location.search;
    return <Navigate to="/crear-cuenta" replace state={{ from, reason: signupReason }} />;
  }
  if (!token) return <Navigate to="/iniciar-sesion" replace />;

  return children;
}
