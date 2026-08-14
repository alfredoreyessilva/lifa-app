import { useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { required, minLength, validEmail, runValidations } from '../utils/validation.js';

// Modal de Inicia sesión / Crea tu cuenta, pensado para flujos donde el
// usuario está haciendo algo (ej. suscribirse a notificaciones) y no
// queremos sacarlo de la pantalla en la que está. Al entrar o registrarse
// con éxito, se guarda la sesión (useAuth().login) y se llama a onSuccess
// con el token nuevo, para que quien abrió el modal pueda continuar de
// inmediato lo que estaba haciendo.
export default function AuthModal({ onClose, onSuccess, title }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const { login } = useAuth();

  return (
    <Modal title={mode === 'login' ? (title || 'Inicia sesión') : 'Crea tu cuenta'} onClose={onClose}>
      {mode === 'login' ? (
        <LoginForm
          onSuccess={(token, user) => { login(token, user); onSuccess?.(token); }}
          onSwitchToRegister={() => setMode('register')}
        />
      ) : (
        <RegisterForm
          onSuccess={(token, user) => { login(token, user); onSuccess?.(token); }}
          onSwitchToLogin={() => setMode('login')}
        />
      )}
    </Modal>
  );
}

function LoginForm({ onSuccess, onSwitchToRegister }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => required(email, 'El correo electrónico'),
      () => validEmail(email),
      () => required(password, 'La contraseña'),
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      const data = await api.login({ email: email.trim(), password });
      onSuccess(data.token, data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {error && <div className="form-error">{error}</div>}
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
      <div className="form-foot">
        ¿No tienes cuenta?{' '}
        <button type="button" className="btn-link" onClick={onSwitchToRegister}>
          Créala aquí
        </button>
      </div>
    </form>
  );
}

function RegisterForm({ onSuccess, onSwitchToLogin }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => required(name, 'El nombre'),
      () => required(email, 'El correo electrónico'),
      () => validEmail(email),
      () => required(password, 'La contraseña'),
      () => minLength(password, 6, 'La contraseña'),
      () => password !== passwordConfirm ? 'Las contraseñas no coinciden' : null,
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      const data = await api.register({ name: name.trim(), email: email.trim(), password });
      onSuccess(data.token, data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label>Nombre completo</label>
        <input required value={name} onChange={(e) => setName(e.target.value.toUpperCase())} />
      </div>
      <div className="field">
        <label>Correo electrónico</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label>Contraseña</label>
        <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        <small style={{ color: 'var(--ink-dim)', fontSize: 11, marginTop: 4, display: 'block' }}>
          Mínimo 6 caracteres
        </small>
      </div>
      <div className="field">
        <label>Repetir contraseña</label>
        <input type="password" required value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} />
      </div>
      <button className="btn btn-flag btn-block" disabled={loading}>
        {loading ? 'Creando cuenta…' : 'Crear cuenta'}
      </button>
      <div className="form-foot">
        ¿Ya tienes cuenta?{' '}
        <button type="button" className="btn-link" onClick={onSwitchToLogin}>
          Inicia sesión
        </button>
      </div>
    </form>
  );
}
