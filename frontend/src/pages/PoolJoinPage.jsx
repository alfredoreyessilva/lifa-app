import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Loading from '../components/Loading.jsx';
import AuthModal from '../components/AuthModal.jsx';

export default function PoolJoinPage() {
  const { code } = useParams();
  const { token, user } = useAuth();
  const [pool, setPool]   = useState(null);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    api.getPoolInfo(code).then(setPool).catch((e) => setError(e.message));
  }, [code]);

  async function join(authToken) {
    setJoining(true);
    setError('');
    try {
      await api.joinPool(code, authToken || token);
      setJoined(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setJoining(false);
    }
  }

  if (error) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No pudimos abrir esta quiniela</h3>
          <p>{error}</p>
          <Link to="/" className="btn btn-outline" style={{ marginTop: 16 }}>Volver al inicio</Link>
        </div>
      </div>
    );
  }

  if (!pool) return <div className="container"><Loading /></div>;

  if (joined) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>¡Ya estás en "{pool.name}"!</h3>
          <p>Ve al calendario que quieras comparar y abre la pestaña "Quiniela entre amigos" para ver el ranking.</p>
          <div style={{ marginTop: 16 }}>
            <Link to="/" className="btn btn-flag">Ir al inicio</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="empty-state" style={{ maxWidth: 440, margin: '40px auto', textAlign: 'center' }}>
        <h3 style={{ marginBottom: 4 }}>Te invitaron a la quiniela</h3>
        <p style={{ fontSize: 22, fontFamily: 'var(--font-display)', margin: '4px 0' }}>{pool.name}</p>
        <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
          {pool.member_count} {pool.member_count === 1 ? 'miembro' : 'miembros'} hasta ahora
        </p>

        {user ? (
          <div style={{ marginTop: 20 }}>
            <p style={{ fontSize: 13 }}>Sesión iniciada como <strong>{user.name}</strong>.</p>
            <button className="btn btn-flag" onClick={() => join()} disabled={joining} style={{ marginTop: 8 }}>
              {joining ? 'Uniéndote…' : 'Unirme a esta quiniela'}
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 20 }}>
            <button className="btn btn-flag" onClick={() => setShowAuthModal(true)}>
              Inicia sesión para unirte
            </button>
          </div>
        )}

        {showAuthModal && (
          <AuthModal
            title="Inicia sesión para unirte"
            onClose={() => setShowAuthModal(false)}
            onSuccess={(newToken) => { setShowAuthModal(false); join(newToken); }}
          />
        )}
      </div>
    </div>
  );
}
