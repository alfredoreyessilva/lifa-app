import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import LogoField from '../components/LogoField.jsx';
import CharField from '../components/CharField.jsx';
import { required, validUrl, runValidations } from '../utils/validation.js';

export default function RegisterLeague() {
  const [name, setName]               = useState('');
  const [state, setState]             = useState('');
  const [logoUrl, setLogoUrl]         = useState('');
  const [description, setDescription] = useState('');
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(false);
  const { token, refreshLeagues }     = useAuth();
  const navigate                      = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => required(name, 'El nombre de la liga'),
      () => validUrl(logoUrl, 'El logo'),
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      await api.createLeague({
        name:        name.trim(),
        state:       state.trim(),
        logo_url:    logoUrl.trim(),
        description: description.trim(),
      }, token);
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
            <CharField
              required
              max={40}
              uppercase
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. LIGA DE FÚTBOL AMERICANO JALISCO"
            />
          </div>
          <div className="field">
            <label>Estado / Región</label>
            <CharField
              max={40}
              uppercase
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="Ej. JALISCO"
            />
          </div>
          <LogoField value={logoUrl} onChange={setLogoUrl} />
          <div className="field">
            <label>Descripción breve (opcional)</label>
            <CharField
              as="textarea"
              rows={3}
              max={100}
              uppercase
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <button className="btn btn-flag btn-block" disabled={loading}>
            {loading ? 'Registrando…' : 'Registrar liga'}
          </button>
        </form>
      </div>
    </div>
  );
}
