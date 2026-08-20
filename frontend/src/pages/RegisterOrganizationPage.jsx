import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import LogoField from '../components/LogoField.jsx';
import CharField from '../components/CharField.jsx';
import { required, validUrl, runValidations } from '../utils/validation.js';

// Primera pantalla de verdad de "Registrar organización" — el README viejo
// la mencionaba pero nunca existió en el código; esta es la real. Dos
// pasos en una sola página: elegir tipo, luego llenar el formulario (los 5
// tipos comparten los mismos campos, así que un solo formulario alcanza).
export default function RegisterOrganizationPage() {
  const [types, setTypes] = useState(null);
  const [countries, setCountries] = useState(null);
  const [selectedType, setSelectedType] = useState(null);
  const [form, setForm] = useState({
    name: '', country_id: '', logo_url: '', description: '', website_url: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { token, refreshLeagues } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    api.getOrganizationTypes().then((d) => setTypes(d.types)).catch((e) => setError(e.message));
    api.getCountries().then((d) => setCountries(d.countries)).catch(() => setCountries([]));
  }, []);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => required(form.name, 'El nombre'),
      () => validUrl(form.logo_url, 'El logo'),
      () => validUrl(form.website_url, 'El sitio web'),
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      const org = await api.createOrganization({
        type: selectedType,
        name: form.name.trim(),
        country_id: form.country_id || null,
        logo_url: form.logo_url || null,
        description: form.description || null,
        website_url: form.website_url || null,
      }, token);
      await refreshLeagues(); // también trae "organizations" fresco en el contexto
      navigate('/panel');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Paso 1: elegir tipo
  if (!selectedType) {
    return (
      <div className="container" style={{ maxWidth: 520 }}>
        <h1>Registrar organización</h1>
        <p style={{ color: 'var(--ink-dim)', fontSize: 14, marginBottom: 20 }}>
          ¿Qué tipo de organización quieres registrar?
        </p>
        {error && <div className="form-error">{error}</div>}
        {!types ? (
          <div className="loading">Cargando…</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {types.map((t) => (
              <button
                key={t.value}
                type="button"
                className="btn btn-outline"
                style={{ textAlign: 'left', padding: '14px 16px' }}
                onClick={() => setSelectedType(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <p style={{ color: 'var(--ink-dim)', fontSize: 12, marginTop: 20 }}>
          ¿Buscas registrar una liga? <a href="/registrar-liga">Ese formulario está aquí</a>.
        </p>
      </div>
    );
  }

  // Paso 2: formulario, ya con el tipo elegido
  const typeLabel = types.find((t) => t.value === selectedType)?.label || selectedType;

  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <button type="button" className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }} onClick={() => setSelectedType(null)}>
        ← Cambiar tipo
      </button>
      <h1>Registrar {typeLabel.toLowerCase()}</h1>

      {error && <div className="form-error">{error}</div>}

      <form onSubmit={onSubmit}>
        <div className="field">
          <label>Nombre</label>
          <CharField max={80} value={form.name} onChange={(e) => update('name', e.target.value)} />
        </div>

        <div className="field">
          <label>País</label>
          <select value={form.country_id} onChange={(e) => update('country_id', e.target.value)}>
            <option value="">Selecciona…</option>
            {(countries || []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <LogoField value={form.logo_url} onChange={(v) => update('logo_url', v)} label="Logo" />

        <div className="field">
          <label>Descripción</label>
          <CharField as="textarea" max={400} value={form.description} onChange={(e) => update('description', e.target.value)} />
        </div>

        <div className="field">
          <label>Sitio web</label>
          <input value={form.website_url} onChange={(e) => update('website_url', e.target.value)} placeholder="https://…" />
        </div>

        <button type="submit" className="btn btn-flag" disabled={loading} style={{ marginTop: 10 }}>
          {loading ? 'Guardando…' : `Registrar ${typeLabel.toLowerCase()}`}
        </button>
      </form>
    </div>
  );
}
