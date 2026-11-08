import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import CharField from './CharField.jsx';
import LogoField from './LogoField.jsx';
import { required, validEmail, validUrl, runValidations } from '../utils/validation.js';

// El perfil de un medio, una tienda, una clínica o una marca: lo que enseña su
// ficha o su vitrina (README, "Lo que enseña su ficha"). Salió de
// OrganizationDetailPage el 2026-11-08, cuando el panel de una tienda lo empezó a
// abrir en una ventana: el de un medio lo sigue enseñando en su página, dentro de
// la tarjeta negra (`className`).
//
// `onSaved` recibe la organización guardada, ya con el nombre de su país: el PUT
// regresa la fila sola, sin el JOIN del GET, y sin esto la ficha de "Ver como
// público" perdía el país en cuanto se guardaba.
export default function OrganizationProfileForm({ org, token, onSaved, onCancel, className, style }) {
  const [countries, setCountries] = useState(null);
  const [form, setForm] = useState(() => formOf(org));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getCountries().then((d) => setCountries(d.countries)).catch(() => setCountries([]));
  }, []);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    const validationError = runValidations([
      () => required(form.name, 'El nombre'),
      () => validUrl(form.logo_url, 'El logo'),
      () => validUrl(form.cover_url, 'La foto de portada'),
      () => validEmail(form.contact_email),
      () => validUrl(form.facebook_url, 'El enlace de Facebook'),
      () => validUrl(form.instagram_url, 'El enlace de Instagram'),
      () => validUrl(form.youtube_url, 'El enlace de YouTube'),
      () => validUrl(form.tiktok_url, 'El enlace de TikTok'),
      () => validUrl(form.website_url, 'El sitio web'),
    ]);
    if (validationError) { setError(validationError); return; }

    setSaving(true);
    setError('');
    try {
      const updated = await api.updateOrganization(org.id, {
        name: form.name.trim(),
        country_id: form.country_id || null,
        logo_url: form.logo_url || null,
        description: form.description || null,
        website_url: form.website_url.trim() || null,
        cover_url: form.cover_url.trim() || null,
        facebook_url: form.facebook_url.trim() || null,
        instagram_url: form.instagram_url.trim() || null,
        youtube_url: form.youtube_url.trim() || null,
        tiktok_url: form.tiktok_url.trim() || null,
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
      }, token);
      const country = (countries || []).find((c) => String(c.id) === String(updated.country_id));
      await onSaved({ ...updated, country_name: country ? country.name : null });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className={`org-profile-form${className ? ` ${className}` : ''}`} style={style}>
      <div className="field">
        <label>Nombre</label>
        <CharField max={80} value={form.name} onChange={(e) => update('name', e.target.value)} style={{ width: '100%' }} />
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

      <LogoField value={form.cover_url} onChange={(v) => update('cover_url', v)} label="Foto de portada" />

      <div className="field">
        <label>Descripción</label>
        <CharField as="textarea" max={400} rows={3} value={form.description} onChange={(e) => update('description', e.target.value)} style={{ width: '100%' }} />
      </div>

      {/* Contacto y redes: lo llena la organización para que la encuentren,
          así que es público. Se dice aquí, porque quien pone un teléfono
          tiene que saber que cualquiera lo va a ver. */}
      <h3 className="org-profile-subhead" style={{ marginTop: 20, marginBottom: 4 }}>Contacto y redes</h3>
      <p className="org-profile-note" style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 0 }}>
        Todo lo de esta sección lo ve cualquiera que abra tu organización.
      </p>

      {/* minWidth 0 en las dos columnas: un input pide su ancho natural
          (~217 px) y dentro del panel cada columna mide menos. Sin esto el
          teléfono se salía por la derecha, con el contador cortado, y las
          dos columnas quedaban de distinto ancho. */}
      <div className="field-row">
        <div className="field" style={{ minWidth: 0 }}>
          <label>Correo electrónico</label>
          <input type="email" value={form.contact_email} onChange={(e) => update('contact_email', e.target.value)} />
        </div>
        <div className="field" style={{ minWidth: 0 }}>
          <label>Número de contacto</label>
          <CharField max={20} value={form.contact_phone} onChange={(e) => update('contact_phone', e.target.value)} style={{ width: '100%' }} />
        </div>
      </div>

      <div className="field">
        <label>Facebook</label>
        <input value={form.facebook_url} onChange={(e) => update('facebook_url', e.target.value)} placeholder="https://facebook.com/…" />
      </div>

      <div className="field">
        <label>Instagram</label>
        <input value={form.instagram_url} onChange={(e) => update('instagram_url', e.target.value)} placeholder="https://instagram.com/…" />
      </div>

      <div className="field">
        <label>YouTube</label>
        <input value={form.youtube_url} onChange={(e) => update('youtube_url', e.target.value)} placeholder="https://youtube.com/@…" />
      </div>

      <div className="field">
        <label>TikTok</label>
        <input value={form.tiktok_url} onChange={(e) => update('tiktok_url', e.target.value)} placeholder="https://tiktok.com/@…" />
      </div>

      <div className="field">
        <label>Sitio web</label>
        <input value={form.website_url} onChange={(e) => update('website_url', e.target.value)} placeholder="https://…" />
      </div>

      {/* El error va junto al botón: en una ventana larga, arriba quedaba fuera
          de la vista de quien acaba de apretar "Guardar". */}
      {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}

      {onCancel ? (
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn btn-flag" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      ) : (
        <button type="submit" className="btn btn-flag" disabled={saving} style={{ marginTop: 10 }}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      )}
    </form>
  );
}

function formOf(org) {
  return {
    name: org.name || '',
    country_id: org.country_id || '',
    logo_url: org.logo_url || '',
    description: org.description || '',
    website_url: org.website_url || '',
    cover_url: org.cover_url || '',
    facebook_url: org.facebook_url || '',
    instagram_url: org.instagram_url || '',
    youtube_url: org.youtube_url || '',
    tiktok_url: org.tiktok_url || '',
    contact_email: org.contact_email || '',
    contact_phone: org.contact_phone || '',
  };
}
