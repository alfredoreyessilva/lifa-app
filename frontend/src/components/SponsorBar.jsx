import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client.js';

export default function SponsorBar() {
  const [sponsors, setSponsors] = useState([]);
  const location = useLocation();
  // Evita contar la misma tanda de impresiones dos veces (StrictMode, o si
  // el usuario entra y sale varias veces del panel/admin en la misma
  // sesión sin que este componente se vuelva a montar).
  const trackedImpressions = useRef(false);

  useEffect(() => {
    api.getSponsors().then(setSponsors).catch(() => {});
  }, []);

  // No mostrar en el panel ni en admin (siempre después de los hooks)
  const hidden = location.pathname.startsWith('/panel') || location.pathname.startsWith('/admin');

  // Solo cuenta la impresión cuando la barra realmente se le muestra a
  // alguien — este componente vive montado en todas las rutas (incluidas
  // /panel y /admin, donde se oculta), así que contar en el fetch inicial
  // metería tráfico interno de dueños de liga y admins a las cifras.
  useEffect(() => {
    if (hidden || trackedImpressions.current || sponsors.length === 0) return;
    trackedImpressions.current = true;
    sponsors.forEach((s) => api.trackEvent('sponsor_impression', s.id).catch(() => {}));
  }, [hidden, sponsors]);

  if (hidden) return null;
  if (sponsors.length === 0) return null;

  return (
    <aside className="sponsor-bar">
      <div className="sponsor-bar-label">Patrocinadores</div>
      <div className="sponsor-bar-logos">
        {sponsors.map((s) => (
          <div key={s.id} className="sponsor-logo">
            {s.link_url ? (
              <a
                href={s.link_url}
                target="_blank"
                rel="noopener noreferrer"
                title={s.name || 'Patrocinador'}
                onClick={() => api.trackEvent('sponsor_click', s.id).catch(() => {})}
              >
                <img src={s.logo_url} alt={s.name || 'Patrocinador'} />
              </a>
            ) : (
              <img src={s.logo_url} alt={s.name || 'Patrocinador'} />
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
