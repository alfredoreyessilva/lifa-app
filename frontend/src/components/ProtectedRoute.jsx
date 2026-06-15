import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function ProtectedRoute({ children }) {
  const { token, loading } = useAuth();

  if (loading) return <div className="container"><div className="loading">Cargando…</div></div>;
  if (!token) return <Navigate to="/iniciar-sesion" replace />;

  return children;
}
