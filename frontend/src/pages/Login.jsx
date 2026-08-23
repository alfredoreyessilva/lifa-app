import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { required, validEmail, runValidations } from '../utils/validation.js';
import GoogleAuthButton from '../components/GoogleAuthButton.jsx';
import EmailVerificationForm from '../components/EmailVerificationForm.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Solo se activa si el login funcionó pero la cuenta todavía no ha
  // verificado su correo — se ofrece el mismo paso de código, sin obligar
  // a nadie: se puede seguir usando la app de todos modos.
  const [needsVerification, setNeedsVerification] = useState(false);
  const { login, token, updateUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  async function onSubmit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => required(email, 'El correo electrónico'),
      () => validEmail(email),
      () => required(password, 'La contraseña'),
    ]);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      const data = await api.login({ email: email.trim(), password });
      login(data.token, data.user);
      if (data.user.email_verified || !data.emailVerificationAvailable) {
        navigate(location.state?.from || '/panel');
      } else {
        setNeedsVerification(true);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function onGoogleCredential(credential) {
    setError('');
    setLoading(true);
    try {
      const data = await api.googleAuth(credential);
      login(data.token, data.user);
      navigate(location.state?.from || '/panel');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (needsVerification) {
    return (
      <div className="container">
        <div className="form-card">
          <h2>Confirma tu correo</h2>
          <EmailVerificationForm
            email={email.trim()}
            token={token}
            onVerified={(updatedUser) => {
              updateUser(updatedUser);
              navigate(location.state?.from || '/panel');
            }}
            onSkip={() => navigate(location.state?.from || '/panel')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="form-card">
        <h2>Iniciar sesión</h2>
        {error && <div className="form-error">{error}</div>}
        <GoogleAuthButton onCredential={onGoogleCredential} onError={setError} />
        <div className="form-divider"><span>o con tu correo</span></div>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Correo electrónico</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="btn btn-flag btn-block" disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        <div className="form-foot">
          ¿No tienes cuenta? <Link to="/crear-cuenta">Créala aquí</Link>
        </div>
      </div>
    </div>
  );
}
