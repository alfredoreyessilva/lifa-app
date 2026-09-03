import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import AuthModal from './AuthModal.jsx';

export default function PoolRanking({ matchIds }) {
  const { token, user } = useAuth();
  const [pools, setPools]         = useState(null);
  const [selectedCode, setSelectedCode] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    if (!token) { setPools(null); return; }
    api.getMyPools(token).then((list) => {
      setPools(list);
      if (list.length > 0 && !selectedCode) setSelectedCode(list[0].join_code);
    }).catch(() => {});
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePoolCreatedOrJoined(pool) {
    setPools((prev) => {
      const already = (prev || []).some((p) => p.join_code === pool.join_code);
      return already ? prev : [pool, ...(prev || [])];
    });
    setSelectedCode(pool.join_code);
  }

  if (!token) {
    return (
      <div className="empty-state">
        <h3>Quiniela entre amigos</h3>
        <p>Inicia sesión para crear una quiniela con tus amigos o unirte a una con un código.</p>
        <button className="btn btn-flag" style={{ marginTop: 12 }} onClick={() => setShowAuthModal(true)}>
          Inicia sesión
        </button>
        {showAuthModal && (
          <AuthModal title="Inicia sesión" onClose={() => setShowAuthModal(false)} onSuccess={() => setShowAuthModal(false)} />
        )}
      </div>
    );
  }

  if (pools === null) return null;

  return (
    <div>
      {pools.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <select value={selectedCode || ''} onChange={(e) => setSelectedCode(e.target.value)} style={{ maxWidth: 260 }}>
              {pools.map((p) => (
                <option key={p.join_code} value={p.join_code}>
                  {p.name} ({p.member_count} {p.member_count === 1 ? 'miembro' : 'miembros'})
                </option>
              ))}
            </select>
          </div>
          {selectedCode && <PoolRankingList code={selectedCode} matchIds={matchIds} />}
        </>
      )}

      <PoolActions user={user} token={token} onDone={handlePoolCreatedOrJoined} hasPools={pools.length > 0} />
    </div>
  );
}

function PoolRankingList({ code, matchIds }) {
  const { token, user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setData(null);
    api.getPoolRanking(code, matchIds, token).then(setData).catch((e) => setError(e.message));
  }, [code, matchIds.join(','), token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function copyLink() {
    const link = `${window.location.origin}/quiniela/${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* la persona puede copiarlo a mano si esto falla */ }
  }

  if (error) return <div className="empty-state"><p>{error}</p></div>;
  if (!data) return null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-outline btn-sm" onClick={copyLink}>
          {copied ? '✓ Link copiado' : 'Invitar a esta quiniela'}
        </button>
      </div>

      {data.ranking.length === 0 ? (
        <div className="empty-state"><p>Todavía no hay nadie en esta quiniela.</p></div>
      ) : (
        <>
          <p className="ranking-note">
            1 punto por acierto · 2 puntos por acierto en fase final (playoff, semifinal, final) ·
            los partidos de scrimmage no cuentan.
          </p>
          <div className="ranking-list">
            {data.ranking.map((r, i) => (
              <div key={r.userId} className={`ranking-row${user?.id === r.userId ? ' ranking-row--me' : ''}`}>
                <div className="ranking-pos">{i + 1}</div>
                <div className="ranking-name">{r.name}{user?.id === r.userId ? ' (tú)' : ''}</div>
                <div className="ranking-detail">
                  {r.graded > 0
                    ? `${r.correct}/${r.graded} aciertos${r.accuracyPct === null ? '' : ` · ${r.accuracyPct}%`}`
                    : `${r.total} predicciones · sin calificar`}
                </div>
                <div className="ranking-pct">{r.points ?? 0}<small>pts</small></div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PoolActions({ token, onDone, hasPools }) {
  const [mode, setMode] = useState(null); // null | 'create' | 'join'
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submitCreate(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const pool = await api.createPool(name.trim(), token);
      setName(''); setMode(null);
      onDone(pool);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }

  async function submitJoin(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const pool = await api.joinPool(code.trim(), token);
      const info = await api.getPoolInfo(pool.join_code);
      setCode(''); setMode(null);
      onDone({ ...pool, member_count: info.member_count });
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }

  if (mode === 'create') {
    return (
      <form onSubmit={submitCreate} style={{ marginTop: hasPools ? 20 : 0, borderTop: hasPools ? '1px solid var(--line)' : 'none', paddingTop: hasPools ? 20 : 0 }}>
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label>Nombre de tu quiniela</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. La banda del coach" autoFocus />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-flag" disabled={loading}>{loading ? 'Creando…' : 'Crear quiniela'}</button>
          <button type="button" className="btn btn-outline" onClick={() => setMode(null)}>Cancelar</button>
        </div>
      </form>
    );
  }

  if (mode === 'join') {
    return (
      <form onSubmit={submitJoin} style={{ marginTop: hasPools ? 20 : 0, borderTop: hasPools ? '1px solid var(--line)' : 'none', paddingTop: hasPools ? 20 : 0 }}>
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label>Código de la quiniela</label>
          <input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="El que te compartieron" autoFocus />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-flag" disabled={loading}>{loading ? 'Uniéndote…' : 'Unirme'}</button>
          <button type="button" className="btn btn-outline" onClick={() => setMode(null)}>Cancelar</button>
        </div>
      </form>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: hasPools ? 20 : 0, borderTop: hasPools ? '1px solid var(--line)' : 'none', paddingTop: hasPools ? 20 : 0 }}>
      <button className="btn btn-outline btn-sm" onClick={() => setMode('create')}>+ Crear una quiniela</button>
      <button className="btn btn-outline btn-sm" onClick={() => setMode('join')}>Unirme con un código</button>
    </div>
  );
}
