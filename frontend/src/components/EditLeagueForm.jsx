import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import CharField from './CharField.jsx';
import LogoField from './LogoField.jsx';
import TimezoneSelect from './TimezoneSelect.jsx';
import { MEXICO_STATES } from '../utils/mexicoStates.js';
import { runValidations } from '../utils/validation.js';

const DEFAULT_TZ = 'America/Mexico_City';

// Formulario para editar la info de la liga (nombre, logo, portada,
// descripción, zona horaria, redes sociales). Antes vivía solo dentro de
// Dashboard.jsx (la pantalla vieja); se saca aquí para poder usarlo
// también desde la pestaña "Liga" del flujo nuevo (TournamentsYearPanel.jsx).
export default function EditLeagueForm({ league, onSubmit, onCancel }) {
  const [countries, setCountries] = useState(null);
  const [form, setForm] = useState({
    name:          league.name,
    country_id:    league.country_id    || '',
    state:         league.state         || '',
    // Se filtra contra MEXICO_STATES por si quedó algo del texto libre
    // viejo (escrito a mano, ej. "Nacional") que nunca fue un estado real
    // de la lista — si se colara, bloquearía guardar sin que se note por qué.
    states:        Array.isArray(league.states) ? league.states.filter((s) => MEXICO_STATES.includes(s)) : [],
    logo_url:      league.logo_url      || '',
    cover_url:     league.cover_url     || '',
    description:   league.description   || '',
    timezone:      league.timezone      || DEFAULT_TZ,
    facebook_url:  league.facebook_url  || '',
    instagram_url: league.instagram_url || '',
    twitter_url:   league.twitter_url   || '',
    youtube_url:   league.youtube_url   || '',
    tiktok_url:    league.tiktok_url    || '',
    website_url:   league.website_url   || '',
    whatsapp:      league.whatsapp      || '',
  });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getCountries().then((d) => setCountries(d.countries)).catch(() => setCountries([]));
  }, []);

  function update(key, value) { setForm((f) => ({ ...f, [key]: value })); }

  function toggleState(s) {
    setForm((f) => ({
      ...f,
      states: f.states.includes(s) ? f.states.filter((x) => x !== s) : [...f.states, s],
    }));
  }

  const selectedCountry = countries?.find((c) => String(c.id) === String(form.country_id));
  const isMexico = selectedCountry?.code === 'MX';

  async function submit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => (isMexico && form.states.length === 0 ? 'Selecciona al menos un estado' : null),
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try { await onSubmit(form); }
    catch (e) { setError(e.message); setLoading(false); }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}

      <div className="field">
        <label>Nombre</label>
        <CharField required max={40} uppercase value={form.name} onChange={(e) => update('name', e.target.value)} />
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
      <div className="field">
        {isMexico ? (
          <>
            <label>Estados en los que opera la liga</label>
            <div className="state-checkbox-grid">
              {MEXICO_STATES.map((s) => (
                <label key={s} className="state-checkbox">
                  <input type="checkbox" checked={form.states.includes(s)} onChange={() => toggleState(s)} />
                  {s}
                </label>
              ))}
            </div>
          </>
        ) : (
          <>
            <label>Estado / Región (opcional)</label>
            <CharField max={40} uppercase value={form.state} onChange={(e) => update('state', e.target.value)} />
          </>
        )}
      </div>
      <div className="field">
        <label>Descripción</label>
        <CharField as="textarea" rows={3} max={100} uppercase value={form.description} onChange={(e) => update('description', e.target.value)} />
      </div>

      <LogoField value={form.logo_url} onChange={(url) => update('logo_url', url)} />

      <div className="field">
        <label>Foto de portada (opcional)</label>
        <LogoField value={form.cover_url} onChange={(url) => update('cover_url', url)} />
      </div>

      <TimezoneSelect label="Zona horaria de la liga" value={form.timezone} onChange={(tz) => update('timezone', tz)} />

      <div style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--flag)', textTransform: 'uppercase', margin: '16px 0 12px', fontFamily: 'var(--font-eyebrow)' }}>
        Redes sociales y contacto
      </div>
      <div className="field">
        <label>WhatsApp</label>
        <input value={form.whatsapp} onChange={(e) => update('whatsapp', e.target.value)} placeholder="Ej. 5512345678 o https://wa.me/521..." />
      </div>
      <div className="field">
        <label>Facebook</label>
        <input value={form.facebook_url} onChange={(e) => update('facebook_url', e.target.value)} placeholder="https://facebook.com/..." />
      </div>
      <div className="field">
        <label>Instagram</label>
        <input value={form.instagram_url} onChange={(e) => update('instagram_url', e.target.value)} placeholder="https://instagram.com/..." />
      </div>
      <div className="field">
        <label>X / Twitter</label>
        <input value={form.twitter_url} onChange={(e) => update('twitter_url', e.target.value)} placeholder="https://x.com/..." />
      </div>
      <div className="field">
        <label>YouTube</label>
        <input value={form.youtube_url} onChange={(e) => update('youtube_url', e.target.value)} placeholder="https://youtube.com/..." />
      </div>
      <div className="field">
        <label>TikTok</label>
        <input value={form.tiktok_url} onChange={(e) => update('tiktok_url', e.target.value)} placeholder="https://tiktok.com/..." />
      </div>
      <div className="field">
        <label>Sitio web</label>
        <input value={form.website_url} onChange={(e) => update('website_url', e.target.value)} placeholder="https://..." />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-flag" disabled={loading}>{loading ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
    </form>
  );
}
