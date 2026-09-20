import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import TeamForm from './TeamForm.jsx';
import { initials } from '../utils/matchDisplay.js';
import { puede } from '../utils/permisos.js';

// El perfil público del equipo: lo que ve cualquiera en CFBAMX. Es el
// contenido que antes ERA todo el panel del equipo (Dashboard.jsx); ahora es
// una sección más, porque administrar un club es bastante más que editar su
// logo y sus redes.
export default function TeamProfileSection({ team, token, onChange }) {
  const [mode, setMode] = useState('view');
  const [error, setError] = useState('');
  const [countries, setCountries] = useState([]);
  const isIndependent = !team.league_id;
  // El perfil lo VE cualquiera que pueda ver el panel —un coach incluido, que
  // para eso existe ese rol— y lo EDITA quien tiene 'perfil'. Por eso esta
  // pestaña no se esconde: lo que desaparece es el botón de editar. Esconderle
  // el equipo entero a un coach le dejaría un panel vacío.
  const puedeEditar = puede(team, 'perfil');

  useEffect(() => {
    if (!isIndependent) return;
    api.getCountries().then((d) => setCountries(d.countries)).catch(() => setCountries([]));
  }, [isIndependent]);

  return (
    <div>
      {error && <div className="form-error">{error}</div>}

      {isIndependent && puedeEditar && (
        <div
          className="form-error"
          style={{
            background: team.show_on_platform ? 'rgba(74,222,128,0.10)' : 'rgba(255,210,63,0.10)',
            borderColor: team.show_on_platform ? 'var(--positive)' : 'var(--flag)',
            color: 'var(--ws-ink)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 12,
          }}
        >
          <span>
            {team.show_on_platform
              ? 'Tu equipo aparece en el home de CFBAMX.'
              : 'Tu equipo es privado por ahora — puedes usar todas las herramientas sin que nadie más lo vea.'}
          </span>
          <button
            className={`btn btn-sm ${team.show_on_platform ? 'btn-ghost' : 'btn-accent'}`}
            onClick={async () => {
              setError('');
              try {
                await api.updateTeam(team.id, { show_on_platform: !team.show_on_platform }, token);
                await onChange();
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            {team.show_on_platform ? 'Ocultar del home' : 'Mostrar en el home'}
          </button>
        </div>
      )}

      {mode === 'view' || !puedeEditar ? (
        <TeamProfileView team={team} onEdit={puedeEditar ? () => setMode('edit') : null} />
      ) : (
        <TeamForm
          key={team.id}
          initial={team}
          independent={isIndependent}
          countries={countries}
          submitLabel="Guardar cambios"
          onCancel={() => setMode('view')}
          onSubmit={async (payload) => {
            setError('');
            try {
              await api.updateTeam(team.id, payload, token);
              await onChange();
              setMode('view');
            } catch (e) {
              setError(e.message);
              throw e;
            }
          }}
        />
      )}
    </div>
  );
}

// Vista de solo lectura del equipo — lo que ve el representante por defecto,
// antes de entrar a editar. Reutiliza las mismas clases del preview de
// TeamForm para que se vea igual de un lado y del otro.
function TeamProfileView({ team, onEdit }) {
  const hasContact = team.location || team.contact_email || team.contact_phone;
  const hasLinks = team.facebook_url || team.instagram_url || team.twitter_url || team.website_url;
  const sectionLabelStyle = {
    fontSize: 11, letterSpacing: '0.15em', color: 'var(--accent)',
    textTransform: 'uppercase', marginBottom: 10, fontFamily: 'var(--font-eyebrow)',
  };

  return (
    <div>
      <p style={{ color: 'var(--ws-ink-dim)', fontSize: 13, marginBottom: 16 }}>
        {onEdit
          ? 'Así se ve el perfil de tu equipo en CFBAMX. Entra a editar para cambiar el logo, el color del club, contacto, redes o los links de transmisión y boletos.'
          : 'Así se ve el perfil de tu equipo en CFBAMX. Tu rol lo consulta, no lo edita.'}
      </p>

      <div className="team-editor-preview">
        <div className="team-profile-banner">
          {team.cover_url && <img src={team.cover_url} alt="Portada" className="team-editor-cover-img" />}
        </div>

        <div className="team-profile-logo-wrap">
          <div className="team-profile-logo">
            {team.logo_url ? <img src={team.logo_url} alt={team.name} /> : <span>{initials(team.name)}</span>}
          </div>
        </div>

        <div className="team-profile-body">
          <h2 style={{ textAlign: 'center', fontFamily: 'var(--font-display)', marginBottom: 16 }}>{team.name}</h2>

          {hasContact && (
            <div className="team-profile-section" style={{ textAlign: 'left', marginBottom: 16 }}>
              <div style={sectionLabelStyle}>Información de contacto</div>
              {team.location && <div className="team-info-row">📍 {team.location}</div>}
              {team.contact_email && <div className="team-info-row">✉️ {team.contact_email}</div>}
              {team.contact_phone && <div className="team-info-row">📞 {team.contact_phone}</div>}
            </div>
          )}

          {hasLinks && (
            <div className="team-profile-section" style={{ textAlign: 'left', marginBottom: 16 }}>
              <div style={sectionLabelStyle}>Redes y sitio web</div>
              <div className="team-info-links">
                {team.facebook_url && <a href={team.facebook_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">Facebook</a>}
                {team.instagram_url && <a href={team.instagram_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">Instagram</a>}
                {team.twitter_url && <a href={team.twitter_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">X / Twitter</a>}
                {team.website_url && <a href={team.website_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">Sitio web</a>}
              </div>
            </div>
          )}

          <div className="team-profile-section" style={{ textAlign: 'left', marginBottom: 8 }}>
            <div style={sectionLabelStyle}>Links predeterminados de transmisión y boletos</div>
            <LinkGroupView label="Transmisión — en casa" links={team.home_stream_links} />
            <LinkGroupView label="Transmisión — de visita" links={team.away_stream_links} />
            <LinkGroupView label="Boletos — en casa" links={team.home_ticket_links} />
            <LinkGroupView label="Boletos — de visita" links={team.away_ticket_links} />
            {!team.home_stream_links?.length && !team.away_stream_links?.length
              && !team.home_ticket_links?.length && !team.away_ticket_links?.length && (
              <div style={{ fontSize: 12, color: 'var(--ws-ink-faint)' }}>Todavía no has agregado ningún link.</div>
            )}
          </div>

          <div style={{ textAlign: 'center', marginTop: 20 }}>
            {/* Sin `onEdit` esta vista es de solo lectura — es como entra un
                coach, que ve el equipo y no lo cambia. */}
            {onEdit && <button className="btn btn-accent" onClick={onEdit}>Editar perfil del equipo</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkGroupView({ label, links }) {
  if (!links || links.length === 0) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--ws-ink-dim)', marginBottom: 4 }}>{label}</div>
      {links.map((url, i) => (
        <div key={i} style={{ fontSize: 13 }}>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{url}</a>
        </div>
      ))}
    </div>
  );
}
