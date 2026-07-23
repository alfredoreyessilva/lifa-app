import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Loading from '../components/Loading.jsx';

export default function InviteClaim() {
  const { token: inviteToken } = useParams();
  const { token, user, refreshLeagues } = useAuth();
  const [invite, setInvite]   = useState(null);
  const [error, setError]     = useState('');
  const [claimed, setClaimed] = useState(false);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    api.getInvite(inviteToken).then(setInvite).catch((e) => setError(e.message));
  }, [inviteToken]);

  // Caso: la persona YA tiene sesión iniciada en este navegador (por ejemplo,
  // es alguien que ya administraba otro equipo y ahora le pasan uno más).
  async function handleClaimWithSession() {
    setClaiming(true);
    setError('');
    try {
      await api.claimInvite(inviteToken, token);
      await refreshLeagues();
      setClaimed(true);
    } catch (e) {
      setError(e.message);
      setClaiming(false);
    }
  }

  if (error) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No pudimos abrir esta invitación</h3>
          <p>{error}</p>
          <Link to="/" className="btn btn-outline" style={{ marginTop: 16 }}>Volver al inicio</Link>
        </div>
      </div>
    );
  }

  if (!invite) return <div className="container"><Loading /></div>;

  if (claimed) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>¡Listo! Ya administras {invite.team_name}</h3>
          <p>Desde tu panel puedes editar el logo, contacto, redes y links de transmisión de tu equipo.</p>
          <div style={{ marginTop: 16 }}>
            <Link to="/panel" className="btn btn-flag">Ir a mi panel</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="empty-state" style={{ maxWidth: 440, margin: '40px auto', textAlign: 'center' }}>
        {invite.team_logo_url && (
          <div style={{ width: 80, height: 80, borderRadius: '50%', overflow: 'hidden', margin: '0 auto 16px' }}>
            <img src={invite.team_logo_url} alt={invite.team_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        )}
        <h3 style={{ marginBottom: 4 }}>Vas a administrar el equipo</h3>
        <p style={{ fontSize: 22, fontFamily: 'var(--font-display)', margin: '4px 0' }}>{invite.team_name}</p>
        {invite.league_name && <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>{invite.league_name}</p>}

        {user ? (
          <div style={{ marginTop: 20 }}>
            <p style={{ fontSize: 13 }}>Sesión iniciada como <strong>{user.name}</strong>.</p>
            <button className="btn btn-flag" onClick={handleClaimWithSession} disabled={claiming} style={{ marginTop: 8 }}>
              {claiming ? 'Asignando…' : 'Aceptar y administrar este equipo'}
            </button>
          </div>
        ) : (
          <InviteAuthForms inviteToken={inviteToken} onClaimed={() => setClaimed(true)} />
        )}
      </div>
    </div>
  );
}

// Mini login/registro embebido aquí mismo, para que la persona no tenga que
// salirse de la invitación. En cuanto entra o se registra, se usa ESE token
// recién obtenido para reclamar de inmediato (no el del contexto, que aún
// tardaría un instante en actualizarse).
function InviteAuthForms({ inviteToken, onClaimed }) {
  const { login } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function update(key, value) { setForm((f) => ({ ...f, [key]: value })); }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = mode === 'login'
        ? await api.login({ email: form.email, password: form.password })
        : await api.register(form);
      login(data.token, data.user);
      await api.claimInvite(inviteToken, data.token);
      onClaimed();
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 20, textAlign: 'left' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'center' }}>
        <button type="button" className={`btn btn-sm ${mode === 'login' ? 'btn-flag' : 'btn-outline'}`} onClick={() => setMode('login')}>
          Ya tengo cuenta
        </button>
        <button type="button" className={`btn btn-sm ${mode === 'register' ? 'btn-flag' : 'btn-outline'}`} onClick={() => setMode('register')}>
          Crear cuenta
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {mode === 'register' && (
        <div className="field">
          <label>Nombre</label>
          <input required value={form.name} onChange={(e) => update('name', e.target.value)} />
        </div>
      )}
      <div className="field">
        <label>Correo</label>
        <input required type="email" value={form.email} onChange={(e) => update('email', e.target.value)} />
      </div>
      <div className="field">
        <label>Contraseña</label>
        <input required type="password" value={form.password} onChange={(e) => update('password', e.target.value)} />
      </div>

      <button className="btn btn-flag" disabled={loading} style={{ width: '100%', marginTop: 8 }}>
        {loading ? 'Un momento…' : mode === 'login' ? 'Iniciar sesión y aceptar' : 'Crear cuenta y aceptar'}
      </button>
    </form>
  );
}
