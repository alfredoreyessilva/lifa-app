import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import { etiquetaDelContador, EVENTO_NOTIFICACIONES_VISTAS } from '../utils/misNotificaciones.js';

// Cuántos avisos nuevos hay en "Mis notificaciones". Se pregunta al abrir la
// app, al cambiar de página y al volver a la pestaña — nunca con un
// temporizador: una consulta con la app abierta pero quieta despertaría a Neon
// sin que nadie la esté usando (README, "Lo nuevo y el numerito del balón").
function useNotificacionesNuevas(token) {
  const { pathname } = useLocation();
  const [nuevas, setNuevas] = useState(0);
  const enLaBandeja = pathname === '/notificaciones';

  useEffect(() => {
    if (!token) {
      setNuevas(0);
      return undefined;
    }
    // En la bandeja misma no se pregunta: ella la marca como vista y avisa con
    // el evento de abajo. Preguntar aquí podría ganarle a esa marca y volver a
    // pintar el número que se acaba de leer.
    if (enLaBandeja) return undefined;

    let vigente = true;
    const preguntar = () => {
      api.getMyUnreadCount(token)
        .then((r) => { if (vigente) setNuevas(Number(r?.unread) || 0); })
        // Sin señal se queda el último número conocido: es mejor que un cero
        // que diga "no hay nada" cuando no se sabe.
        .catch(() => {});
    };
    preguntar();

    const alVolver = () => {
      if (document.visibilityState === 'visible') preguntar();
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      vigente = false;
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [token, pathname, enLaBandeja]);

  useEffect(() => {
    const aCero = () => setNuevas(0);
    window.addEventListener(EVENTO_NOTIFICACIONES_VISTAS, aCero);
    return () => window.removeEventListener(EVENTO_NOTIFICACIONES_VISTAS, aCero);
  }, []);

  return enLaBandeja ? 0 : nuevas;
}

// Publica el alto real de la barra en --topbar-h, para que lo que se pega
// debajo de ella al deslizar (el encabezado de jornada del calendario) sepa
// dónde pararse. Se mide en vez de fijarse: el alto cambia entre escritorio y
// celular, y con la marca larga partida en dos renglones.
function useAltoDeLaBarra(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const publicar = () => {
      document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`);
    };
    publicar();
    const observer = new ResizeObserver(publicar);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}

export default function TopBar() {
  const { user, token, logout } = useAuth();
  const nuevas = useNotificacionesNuevas(user ? token : null);
  const etiqueta = etiquetaDelContador(nuevas);
  const barra = useRef(null);
  useAltoDeLaBarra(barra);

  return (
    <header className="topbar" ref={barra}>
      <div className="topbar-inner">
        <Link to="/" className="brand">
          🏈 <span>CALENDARIOS DE FOOTBALL AMERICANO MEXICO</span>
        </Link>

        {user ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Link
              to="/notificaciones"
              className="btn btn-outline btn-sm topbar-bell"
              aria-label={etiqueta ? `Mis notificaciones: ${etiqueta} nuevas` : 'Mis notificaciones'}
              title={etiqueta ? `${etiqueta} notificaciones nuevas` : 'Mis notificaciones'}
              style={{ display: 'flex', alignItems: 'center', padding: '6px 10px' }}
            >
              <img src="/favicon.svg" alt="" style={{ width: 18, height: 18 }} />
              {etiqueta && <span className="topbar-badge" aria-hidden="true">{etiqueta}</span>}
            </Link>
            {user.role === 'admin' ? (
              <>
                <Link to="/panel" className="btn btn-outline btn-sm">Mi panel</Link>
                <Link to="/admin" className="btn btn-outline btn-sm">Panel Admin</Link>
              </>
            ) : (
              <>
                <Link to="/panel" className="btn btn-outline btn-sm">Mi panel</Link>
              </>
            )}
            <button onClick={logout} className="btn btn-ghost btn-sm">Cerrar sesión</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <Link to="/iniciar-sesion" className="btn btn-ghost btn-sm">Iniciar sesión</Link>
          </div>
        )}
      </div>
    </header>
  );
}
