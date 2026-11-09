import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import { EVENTO_NOTIFICACIONES_VISTAS } from '../utils/misNotificaciones.js';
import NotificationCard from '../components/NotificationCard.jsx';

// "Mis notificaciones": UNA bandeja por persona (README, "Notificaciones: la
// bandeja y el push"). Junta los avisos de las organizaciones que administras
// —solo los que tu rol puede leer, eso lo decide el backend— con los de los
// partidos y equipos que sigues.
//
// Reemplaza a la cuadrícula de logos (había que entrar a cada organización
// para ver sus avisos) y a "Partidos que sigo", que duplicaba "Mi cartelera".

// Los avisos se agrupan por día, como una crónica: "Hoy", "Ayer" y luego la
// fecha. La lista ya viene ordenada del más nuevo al más viejo.
function etiquetaDeDia(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'Antes';
  const hoy = new Date();
  const inicio = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((inicio(hoy) - inicio(date)) / 86400000);
  if (dias === 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  return date.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
}

function agruparPorDia(items) {
  const grupos = [];
  for (const item of items) {
    const dia = etiquetaDeDia(item.at);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.items.push(item);
    else grupos.push({ dia, items: [item] });
  }
  return grupos;
}

export default function Notifications() {
  const { token } = useAuth();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return undefined;
    let vigente = true;
    setError('');
    api.getMyNotifications(token)
      .then((data) => {
        if (!vigente) return;
        setItems(data.items || []);
        // Se marca como visto DESPUÉS de traer la lista: lo que era nuevo se
        // pinta como nuevo en esta visita, y deja de contar en el balón.
        //
        // Va en su propia cadena: colgada de la de arriba, si marcarla fallaba
        // (se fue la señal justo después de cargar), el catch de abajo ponía
        // "No se pudieron cargar tus notificaciones" encima de la lista ya
        // cargada. No hay nada que avisar: el evento que pone el balón en cero
        // sale solo si el servidor guardó la marca, y lo nuevo vuelve a salir
        // como nuevo en la próxima visita, que es cuando se vuelve a marcar.
        api.markMyNotificationsSeen(token)
          .then(() => window.dispatchEvent(new Event(EVENTO_NOTIFICACIONES_VISTAS)))
          .catch(() => {});
      })
      .catch((err) => {
        if (!vigente) return;
        setError(err.offline
          ? 'Sin conexión: no se pudieron cargar tus notificaciones.'
          : (err.message || 'No se pudieron cargar tus notificaciones.'));
        setItems((prev) => prev ?? []);
      });
    return () => { vigente = false; };
  }, [token]);

  // Es una pantalla del aficionado, no un panel de trabajo: va en la noche de
  // la cancha (la placa de la página de un partido), no en el panel negro.
  const nuevos = items ? items.filter((i) => i.is_new).length : 0;
  let indice = 0;

  return (
    <div className="container">
      <div className="nt-page">
        <header className="nt-hero">
          <span className="nt-hero-eyebrow">Tu bandeja</span>
          <h1 className="nt-hero-title">Mis notificaciones</h1>
          <p className="nt-hero-sub">
            {items === null && !error && 'Revisando lo que pasó en la cancha…'}
            {items && nuevos > 0 && <><strong>{nuevos}</strong> {nuevos === 1 ? 'aviso nuevo' : 'avisos nuevos'} desde tu última visita</>}
            {items && items.length > 0 && nuevos === 0 && 'Estás al día. Esto es lo más reciente.'}
            {items && items.length === 0 && !error && 'Todavía no hay jugadas que contarte.'}
          </p>
        </header>

        {error && <div className="nt-aviso">{error}</div>}

        {items === null && !error && (
          <div className="nt-list" aria-busy="true">
            {[0, 1, 2].map((n) => <div key={n} className="nt-skeleton" />)}
          </div>
        )}

        {items && items.length === 0 && !error && (
          <div className="nt-empty">
            <div className="nt-empty-ball" aria-hidden="true">🏈</div>
            <h3>Sin notificaciones todavía</h3>
            <ul>
              <li><span aria-hidden="true">⭐</span> Sigue un partido o a un equipo y aquí te llegan sus avisos.</li>
              <li><span aria-hidden="true">🎯</span> Predice quién gana y entérate de si acertaste y en qué lugar vas.</li>
              <li><span aria-hidden="true">🏟️</span> Si administras una liga o un club, aquí llegan también los suyos.</li>
            </ul>
            <Link to="/" className="nt-card-cta">Explorar ligas y equipos →</Link>
          </div>
        )}

        {items && items.length > 0 && agruparPorDia(items).map((grupo) => (
          <section key={grupo.dia} className="nt-day">
            <h2 className="nt-day-title"><span>{grupo.dia}</span></h2>
            <div className="nt-list">
              {grupo.items.map((item) => (
                <NotificationCard key={item.key} item={item} indice={indice++} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
