import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { required, minLength, validEmail, runValidations } from '../utils/validation.js';

export default function Register() {
  const [name,            setName]            = useState('');
  const [email,           setEmail]           = useState('');
  const [password,        setPassword]        = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error,           setError]           = useState('');
  const [loading,         setLoading]         = useState(false);
  const { login }    = useAuth();
  const navigate     = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => required(name,     'El nombre'),
      () => required(email,    'El correo electrónico'),
      () => validEmail(email),
      () => required(password, 'La contraseña'),
      () => minLength(password, 6, 'La contraseña'),
      () => password !== passwordConfirm ? 'Las contraseñas no coinciden' : null,
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      const data = await api.register({ name: name.trim(), email: email.trim(), password });
      login(data.token, data.user);
      navigate('/registrar-liga');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <div className="form-card">
        <h2>Crear cuenta de representante</h2>
        <p style={{ color: 'var(--ink-dim)', fontSize: 13, marginTop: -12, marginBottom: 20 }}>
          Crea una cuenta para registrar y administrar el calendario de tu liga.
        </p>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Nombre completo</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
            />
          </div>
          <div className="field">
            <label>Correo electrónico</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <small style={{ color: 'var(--ink-dim)', fontSize: 11, marginTop: 4, display: 'block' }}>
              Mínimo 6 caracteres
            </small>
          </div>
          <div className="field">
            <label>Repetir contraseña</label>
            <input
              type="password"
              required
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              style={{
                borderColor: passwordConfirm && password !== passwordConfirm
                  ? 'var(--live)'
                  : undefined,
              }}
            />
            {passwordConfirm && password !== passwordConfirm && (
              <small style={{ color: 'var(--live)', fontSize: 11, marginTop: 4, display: 'block' }}>
                Las contraseñas no coinciden
              </small>
            )}
            {passwordConfirm && password === passwordConfirm && (
              <small style={{ color: '#4caf50', fontSize: 11, marginTop: 4, display: 'block' }}>
                ✓ Las contraseñas coinciden
              </small>
            )}
          </div>
          <button className="btn btn-flag btn-block" disabled={loading}>
            {loading ? 'Creando cuenta…' : 'Crear cuenta'}
          </button>
        </form>
        <div className="form-foot">
          ¿Ya tienes cuenta? <Link to="/iniciar-sesion">Inicia sesión</Link>
        </div>
      </div>
    </div>
  );
}