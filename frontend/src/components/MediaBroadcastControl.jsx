import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// Se muestra solo si el usuario administra al menos un medio verificado —
// nadie más ve este bloque. Reusa la navegación que ya existe para
// encontrar el partido (calendario, liga, etc.) en vez de construir una
// pantalla de búsqueda aparte; el medio simplemente llega al partido como
// cualquier usuario y se autoasigna ahí mismo.
//
// Si la cuenta administra VARIOS medios verificados, se pregunta con cuál
// de ellos transmite (selector) — nunca se asume uno solo.
export default function MediaBroadcastControl({ matchId, onChange }) {
  const { token, organizations } = useAuth();
  const myVerifiedMedia = (organizations || []).filter((o) => o.type === 'media' && o.is_verified);

  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [url, setUrl] = useState('');
  const [mine, setMine] = useState(null); // broadcasts de MIS medios en este partido, o null mientras carga
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (myVerifiedMedia.length === 0) return;
    api.getMatchBroadcasts(matchId).then((d) => {
      const myOrgIds = new Set(myVerifiedMedia.map((o) => String(o.id)));
      setMine(d.broadcasts.filter((b) => myOrgIds.has(String(b.organization_id))));
    }).catch(() => setMine([]));
  }, [matchId, organizations]);

  // Medios que TODAVÍA no están asignados a este partido — de estos se
  // elige. Se recalcula cada vez que "mine" cambia (recién cargado, recién
  // asignado, recién quitado), y el selector se mantiene sincronizado con
  // la primera opción disponible en vez de quedarse en un valor que ya no
  // aparece en la lista.
  const availableToAssign = myVerifiedMedia.filter(
    (o) => !(mine || []).some((b) => String(b.organization_id) === String(o.id))
  );

  useEffect(() => {
    if (availableToAssign.length > 0 && !availableToAssign.some((o) => String(o.id) === String(selectedOrgId))) {
      setSelectedOrgId(availableToAssign[0].id);
    }
  }, [mine, myVerifiedMedia.length]);

  if (myVerifiedMedia.length === 0) return null;

  async function refreshMine() {
    const d = await api.getMatchBroadcasts(matchId);
    const myOrgIds = new Set(myVerifiedMedia.map((o) => String(o.id)));
    setMine(d.broadcasts.filter((b) => myOrgIds.has(String(b.organization_id))));
  }

  async function handleAssign(e) {
    e.preventDefault();
    if (!selectedOrgId) return;
    setSaving(true);
    setError('');
    try {
      await api.createBroadcast({ match_id: matchId, organization_id: Number(selectedOrgId), url: url || null }, token);
      setUrl('');
      await refreshMine();
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(broadcastId) {
    await api.deleteBroadcast(broadcastId, token);
    await refreshMine();
    onChange?.();
  }

  return (
    <div style={{ marginTop: 16, padding: 14, background: 'rgba(0,0,0,0.15)', borderRadius: 12, textAlign: 'left' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--flag)', textTransform: 'uppercase', marginBottom: 8 }}>
        Panel de medio
      </div>

      {mine === null ? (
        <p style={{ fontSize: 13, color: 'var(--ink-dim)' }}>Cargando…</p>
      ) : mine.length > 0 ? (
        <div style={{ marginBottom: 10 }}>
          {mine.map((b) => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, marginBottom: 6 }}>
              <span>Transmitiendo como <strong>{b.name}</strong></span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleRemove(b.id)}>Quitar</button>
            </div>
          ))}
        </div>
      ) : null}

      {error && <div className="form-error">{error}</div>}

      {availableToAssign.length === 0 ? (
        mine && mine.length > 0 && (
          <p style={{ fontSize: 12, color: 'var(--ink-dim)' }}>Ya asignaste todos tus medios verificados a este partido.</p>
        )
      ) : (
        <form onSubmit={handleAssign} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {availableToAssign.length > 1 && (
            <select value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)}>
              {availableToAssign.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <input
            placeholder="Link de tu transmisión (opcional)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{ flex: 1, minWidth: 180 }}
          />
          <button type="submit" className="btn btn-flag btn-sm" disabled={saving}>
            {saving
              ? 'Guardando…'
              : availableToAssign.length > 1
                ? '+ Transmitir este partido'
                : `+ Transmitir como ${availableToAssign[0].name}`}
          </button>
        </form>
      )}
    </div>
  );
}
