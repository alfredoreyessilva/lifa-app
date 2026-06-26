import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function AdminRoute({ children }) {
  const { token, user, loading } = useAuth();

  if (loading) return <div className="container"><div className="loading">Cargando…</div></div>;
  if (!token) return <Navigate to="/iniciar-sesion" replace />;
  if (user?.role !== 'admin') return <Navigate to="/panel" replace />;

  return children;
}
