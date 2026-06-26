import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client.js';

export default function SponsorBar() {
  const [sponsors, setSponsors] = useState([]);
  const location = useLocation();

  // No mostrar en el panel ni en admin
  const hidden = location.pathname.startsWith('/panel') || location.pathname.startsWith('/admin');
  if (hidden) return null;

  useEffect(() => {
    api.getSponsors().then(setSponsors).catch(() => {});
  }, []);

  if (sponsors.length === 0) return null;

  return (
    <aside className="sponsor-bar">
      <div className="sponsor-bar-label">Patrocinadores</div>
      <div className="sponsor-bar-logos">
        {sponsors.map((s) => (
          <div key={s.id} className="sponsor-logo">
            {s.link_url ? (
              <a href={s.link_url} target="_blank" rel="noopener noreferrer" title={s.name || 'Patrocinador'}>
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
