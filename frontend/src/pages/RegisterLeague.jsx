import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import LogoField from '../components/LogoField.jsx';
import CharField from '../components/CharField.jsx';
import TimezoneSelect from '../components/TimezoneSelect.jsx';
import { required, validUrl, runValidations } from '../utils/validation.js';

export default function RegisterLeague() {
  const [form, setForm] = useState({
    name:          '',
    state:         '',
    logo_url:      '',
    cover_url:     '',
    description:   '',
    timezone:      'America/Mexico_City',
    facebook_url:  '',
    instagram_url: '',
    twitter_url:   '',
    youtube_url:   '',
    tiktok_url:    '',
    website_url:   '',
    whatsapp:      '',
  });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const { token, refreshLeagues } = useAuth();
  const navigate = useNavigate();

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => required(form.name, 'El nombre de la liga'),
      () => validUrl(form.logo_url,      'El logo'),
      () => validUrl(form.cover_url,     'La foto de portada'),
      () => validUrl(form.facebook_url,  'El enlace de Facebook'),
      () => validUrl(form.instagram_url, 'El enlace de Instagram'),
      () => validUrl(form.twitter_url,   'El enlace de X/Twitter'),
      () => validUrl(form.youtube_url,   'El enlace de YouTube'),
      () => validUrl(form.tiktok_url,    'El enlace de TikTok'),
      () => validUrl(form.website_url,   'El sitio web'),
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      await api.createLeague({
        ...form,
        name:        form.name.trim(),
        state:       form.state.trim(),
        description: form.description.trim(),
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
          Tu liga aparecerá de inmediato en la página de inicio.
        </p>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={onSubmit}>

          {/* Info básica */}
          <div className="field">
            <label>Nombre de la liga</label>
            <CharField required max={40} uppercase value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Ej. LIGA DE FÚTBOL AMERICANO JALISCO" />
          </div>
          <div className="field">
            <label>Estado / Región</label>
            <CharField max={40} uppercase value={form.state} onChange={(e) => update('state', e.target.value)} placeholder="Ej. JALISCO" />
          </div>
          <div className="field">
            <label>Descripción breve (opcional)</label>
            <CharField as="textarea" rows={3} max={100} uppercase value={form.description} onChange={(e) => update('description', e.target.value)} />
          </div>

          {/* Imágenes */}
          <LogoField value={form.logo_url} onChange={(url) => update('logo_url', url)} />
          <div className="field">
            <label>Foto de portada (opcional)</label>
            <LogoField value={form.cover_url} onChange={(url) => update('cover_url', url)} />
          </div>

          {/* Zona horaria */}
          <TimezoneSelect label="Zona horaria de la liga" value={form.timezone} onChange={(tz) => update('timezone', tz)} />
          <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: -8, marginBottom: 16 }}>
            Se usará solo en los partidos donde no especifiques una zona horaria distinta al crearlos o importarlos —
            útil si tu liga juega en varias sedes con horarios diferentes.
          </div>

          {/* Redes sociales */}
          <div style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--flag)', textTransform: 'uppercase', marginBottom: 12, fontFamily: 'var(--font-eyebrow)' }}>
            Redes sociales y contacto (opcional)
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

          <button className="btn btn-flag btn-block" disabled={loading}>
            {loading ? 'Registrando…' : 'Registrar liga'}
          </button>
        </form>
      </div>
    </div>
  );
}