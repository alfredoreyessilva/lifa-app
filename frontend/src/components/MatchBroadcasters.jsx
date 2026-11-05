import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import OrganizationInfoPanel from './OrganizationInfoPanel.jsx';

// Fila de medios (publicados y verificados: el backend ya filtra al leer) que
// se autoasignaron a este partido — se muestra ADEMÁS del botón "Ver
// partido"/"Ver en vivo" (el link predeterminado del equipo local), no lo
// reemplaza. Si nadie se autoasignó todavía, no se renderiza nada — no hay
// hueco vacío que mostrar.
export default function MatchBroadcasters({ matchId }) {
  const [broadcasts, setBroadcasts] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.getMatchBroadcasts(matchId).then((d) => setBroadcasts(d.broadcasts)).catch(() => setBroadcasts([]));
  }, [matchId]);

  if (!broadcasts || broadcasts.length === 0) return null;

  return (
    <section className="mp-sec">
      <h2 className="mp-title">También transmiten</h2>
      <div className="mp-media">
        {broadcasts.map((b) => (
          b.url ? (
            <a key={b.id} href={b.url} target="_blank" rel="noopener noreferrer" className="mp-media-item">
              <BroadcasterLogo b={b} />
            </a>
          ) : (
            // Sin link propio para este partido: el logo abre la ficha del
            // medio aquí mismo, la misma que en el home, en vez de mandar a
            // su página.
            <button key={b.id} type="button" onClick={() => setSelected(b)} className="mp-media-item">
              <BroadcasterLogo b={b} />
            </button>
          )
        ))}
      </div>
      {selected && <OrganizationInfoPanel org={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

function BroadcasterLogo({ b }) {
  return (
    <>
      <span className="mp-media-logo">
        {b.logo_url ? <img src={b.logo_url} alt="" /> : b.name[0]}
      </span>
      <span className="mp-media-name">{b.name}</span>
    </>
  );
}
