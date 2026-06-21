import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { required, minLength, validEmail, runValidations } from '../utils/validation.js';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => required(name, 'El nombre'),
      () => required(email, 'El correo electrónico'),
      () => validEmail(email),
      () => required(password, 'La contraseña'),
      () => minLength(password, 6, 'La contraseña'),
    ]);
    if (validationError) {
      setError(validationError);
      return;
    }

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
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Correo electrónico</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
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