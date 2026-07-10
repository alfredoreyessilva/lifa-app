import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function TopBar() {
  const { user, logout } = useAuth();

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link to="/" className="brand">
            🏈 <span>CALENDARIOS DE FOOTBALL AMERICANO MEXICO</span>
          </Link>
          <Link to="/partidos" className="btn btn-outline btn-sm">📅 Partidos</Link>
        </div>

        {user ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {user.role === 'admin' ? (
              <>
                <Link to="/panel" className="btn btn-outline btn-sm">Mi panel</Link>
                <Link to="/admin" className="btn btn-outline btn-sm">Panel Admin</Link>
              </>
            ) : (
              <Link to="/panel" className="btn btn-outline btn-sm">Mi panel</Link>
            )}
            <button onClick={logout} className="btn btn-ghost btn-sm">Cerrar sesión</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <Link to="/iniciar-sesion" className="btn btn-ghost btn-sm">Iniciar sesión</Link>
            <Link to="/crear-cuenta" className="btn btn-outline btn-sm">Registrar mi liga</Link>
          </div>
        )}
      </div>
    </header>
  );
}