import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import OrganizationInfoPanel from './OrganizationInfoPanel.jsx';

const itemStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 64, textDecoration: 'none' };

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
    <div style={{ marginTop: 14, textAlign: 'center' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--ink-dim)', textTransform: 'uppercase', marginBottom: 8 }}>
        También transmiten
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
        {broadcasts.map((b) => (
          b.url ? (
            <a
              key={b.id}
              href={b.url}
              target="_blank"
              rel="noopener noreferrer"
              style={itemStyle}
            >
              <BroadcasterLogo b={b} />
            </a>
          ) : (
            // Sin link propio para este partido: el logo abre la ficha del
            // medio aquí mismo, la misma que en el home, en vez de mandar a
            // su página.
            <button
              key={b.id}
              type="button"
              onClick={() => setSelected(b)}
              style={{ ...itemStyle, background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}
            >
              <BroadcasterLogo b={b} />
            </button>
          )
        ))}
      </div>
      {selected && <OrganizationInfoPanel org={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function BroadcasterLogo({ b }) {
  return (
    <>
      <div style={{
        width: 44, height: 44, borderRadius: '50%', overflow: 'hidden',
        background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '2px solid var(--flag)', fontSize: 14, color: 'var(--flag)',
      }}>
        {b.logo_url ? <img src={b.logo_url} alt={b.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : b.name[0]}
      </div>
      <span style={{ fontSize: 11, color: 'var(--ink-dim)', textAlign: 'center', lineHeight: 1.2 }}>{b.name}</span>
    </>
  );
}
