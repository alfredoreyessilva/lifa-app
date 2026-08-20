import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import LogoField from '../components/LogoField.jsx';
import CharField from '../components/CharField.jsx';
import Loading from '../components/Loading.jsx';
import { required, validUrl, runValidations } from '../utils/validation.js';

// Vista + edición de una organización (medio/proveedor/tienda/clínica/marca).
// Público para ver (igual que la tarjeta del jugador); solo el owner/admin
// de esa organización ve el formulario de edición.
export default function OrganizationDetailPage() {
  const { id } = useParams();
  const { token, organizations, refreshLeagues } = useAuth();
  const navigate = useNavigate();

  const [org, setOrg] = useState(null);
  const [countries, setCountries] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isMine = (organizations || []).some((o) => String(o.id) === String(id));

  useEffect(() => {
    load();
    api.getCountries().then((d) => setCountries(d.countries)).catch(() => setCountries([]));
  }, [id]);

  async function load() {
    setError('');
    try {
      const data = await api.getOrganization(id);
      setOrg(data);
      setForm({
        name: data.name || '',
        country_id: data.country_id || '',
        logo_url: data.logo_url || '',
        description: data.description || '',
        website_url: data.website_url || '',
      });
    } catch (e) {
      setError(e.message);
    }
  }

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    const validationError = runValidations([
      () => required(form.name, 'El nombre'),
      () => validUrl(form.logo_url, 'El logo'),
      () => validUrl(form.website_url, 'El sitio web'),
    ]);
    if (validationError) { setError(validationError); return; }

    setSaving(true);
    setError('');
    try {
      const updated = await api.updateOrganization(id, {
        name: form.name.trim(),
        country_id: form.country_id || null,
        logo_url: form.logo_url || null,
        description: form.description || null,
        website_url: form.website_url || null,
      }, token);
      setOrg(updated);
      await refreshLeagues();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (error && !org) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No encontramos esta organización</h3>
          <p>{error}</p>
          <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={() => navigate('/panel')}>Volver a mi panel</button>
        </div>
      </div>
    );
  }

  if (!org || !form) return <Loading />;

  // Vista pública, para quien NO administra esta organización.
  if (!isMine) {
    return (
      <div className="container" style={{ maxWidth: 520 }}>
        <div className="player-hero">
          <div className="player-photo">
            {org.logo_url ? <img src={org.logo_url} alt={org.name} /> : <span>{org.name[0]}</span>}
          </div>
          <div>
            <div className="player-hero-eyebrow">{org.type}</div>
            <h1 className="player-hero-name" style={{ fontSize: 26 }}>{org.name}</h1>
            {org.country_name && <div className="player-hero-team"><span>{org.country_name}</span></div>}
          </div>
        </div>
        {org.description && <p style={{ marginTop: 16 }}>{org.description}</p>}
        {org.website_url && (
          <p style={{ marginTop: 10 }}>
            <a href={org.website_url} target="_blank" rel="noopener noreferrer">{org.website_url}</a>
          </p>
        )}
      </div>
    );
  }

  // Vista de edición, para el owner/admin.
  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <h1>Editar organización</h1>
      {error && <div className="form-error">{error}</div>}

      <form onSubmit={handleSave}>
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

        <button type="submit" className="btn btn-flag" disabled={saving} style={{ marginTop: 10 }}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </form>
    </div>
  );
}
