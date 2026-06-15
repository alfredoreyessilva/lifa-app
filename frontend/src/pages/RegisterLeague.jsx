import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import LogoField from '../components/LogoField.jsx';

export default function RegisterLeague() {
  const [name, setName] = useState('');
  const [state, setState] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { token, refreshLeagues } = useAuth();
  const navigate = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.createLeague({ name, state, logo_url: logoUrl, description }, token);
      await refreshLeagues();
      navigate('/panel');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <div className="form-card">
        <h2>Registrar el calendario de mi liga</h2>
        <p style={{ color: 'var(--ink-dim)', fontSize: 13, marginTop: -12, marginBottom: 20 }}>
          Tu liga aparecerá de inmediato en la página de inicio. Después podrás agregar categorías y partidos desde tu panel.
        </p>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Nombre de la liga</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Liga de Fútbol Americano de Jalisco" />
          </div>
          <div className="field">
            <label>Estado / Región</label>
            <input value={state} onChange={(e) => setState(e.target.value)} placeholder="Ej. Jalisco" />
          </div>
          <LogoField value={logoUrl} onChange={setLogoUrl} />
          <div className="field">
            <label>Descripción breve (opcional)</label>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <button className="btn btn-flag btn-block" disabled={loading}>
            {loading ? 'Registrando…' : 'Registrar liga'}
          </button>
        </form>
      </div>
    </div>
  );
}
