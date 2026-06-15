import { useState } from 'react';
import LogoField from './LogoField.jsx';

export default function TeamForm({ initial, onSubmit, onCancel, submitLabel }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    logo_url: initial?.logo_url || '',
    location: initial?.location || '',
    contact_email: initial?.contact_email || '',
    contact_phone: initial?.contact_phone || '',
    facebook_url: initial?.facebook_url || '',
    instagram_url: initial?.instagram_url || '',
    twitter_url: initial?.twitter_url || '',
    website_url: initial?.website_url || '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onSubmit(form);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}

      <div className="field">
        <label>Nombre del equipo</label>
        <input required value={form.name} onChange={(e) => update('name', e.target.value)} />
      </div>

      <LogoField value={form.logo_url} onChange={(url) => update('logo_url', url)} />

      <div className="field">
        <label>Ubicación (opcional)</label>
        <input value={form.location} onChange={(e) => update('location', e.target.value)} placeholder="Ej. Ciudad, Estado" />
      </div>

      <div className="field-row">
        <div className="field">
          <label>Correo de contacto (opcional)</label>
          <input type="email" value={form.contact_email} onChange={(e) => update('contact_email', e.target.value)} />
        </div>
        <div className="field">
          <label>Teléfono de contacto (opcional)</label>
          <input value={form.contact_phone} onChange={(e) => update('contact_phone', e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>Facebook (opcional)</label>
        <input value={form.facebook_url} onChange={(e) => update('facebook_url', e.target.value)} placeholder="https://facebook.com/…" />
      </div>
      <div className="field">
        <label>Instagram (opcional)</label>
        <input value={form.instagram_url} onChange={(e) => update('instagram_url', e.target.value)} placeholder="https://instagram.com/…" />
      </div>
      <div className="field">
        <label>X / Twitter (opcional)</label>
        <input value={form.twitter_url} onChange={(e) => update('twitter_url', e.target.value)} placeholder="https://x.com/…" />
      </div>
      <div className="field">
        <label>Sitio web (opcional)</label>
        <input value={form.website_url} onChange={(e) => update('website_url', e.target.value)} placeholder="https://…" />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-flag" disabled={loading}>{loading ? 'Guardando…' : submitLabel}</button>
      </div>
    </form>
  );
}
