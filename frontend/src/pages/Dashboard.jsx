import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import TeamForm from '../components/TeamForm.jsx';
import OrgAdminsPanel from '../components/OrgAdminsPanel.jsx';
import OrgLogoBar from '../components/OrgLogoBar.jsx';
import MiCartelera from '../components/MiCartelera.jsx';
import PredictionStats from '../components/PredictionStats.jsx';

// La liga ya no tiene panel aquí — su espacio de trabajo es
// LeagueStructurePanel.jsx (/panel/liga/:id/estructura). Este archivo ahora
// solo sirve "Mi panel" (sin kind) y el panel de equipo.
export default function Dashboard({ kind }) {
  const { teams, token, refreshLeagues } = useAuth();
  const { id } = useParams();
  const selectedTeam = kind === 'equipo' ? teams.find((tm) => String(tm.id) === id) : null;

  return (
    <div className="container">
      <div className="dashboard-panel">
        <OrgLogoBar selectedKind={kind} selectedId={id} />

        {/* Contenido personal ("de aficionado"): solo en "Mi panel" (sin liga ni
            equipo seleccionado). Al entrar a un equipo, la página es el
            espacio de trabajo de ESA organización y nada más. */}
        {!kind && <PredictionStats />}
        {!kind && <MiCartelera />}

        {selectedTeam && (
          <TeamOnlyPanel teams={[selectedTeam]} token={token} onChange={refreshLeagues} />
        )}
      </div>
    </div>
  );
}

function TeamOnlyPanel({ teams, token, onChange }) {
  const [selectedTeamId, setSelectedTeamId] = useState(teams[0]?.id ?? null);
  const [mode, setMode] = useState('view'); // 'view' | 'edit'
  const [error, setError] = useState('');
  const [statement, setStatement] = useState(null);
  const [countries, setCountries] = useState([]);
  const team = teams.find((t) => t.id === selectedTeamId) || teams[0];
  const isIndependent = !team?.league_id;

  // Un equipo independiente no tiene relación de cobranza con ninguna liga
  // — no tiene sentido pedir su "estado de cuenta" (ver GET
  // /billing/teams/:id/statement, es siempre liga -> equipo).
  useEffect(() => {
    if (!team?.id || !token || isIndependent) { setStatement(null); return; }
    setStatement(null);
    api.getTeamStatement(team.id, token).then(setStatement).catch(() => setStatement(null));
  }, [team?.id, token, isIndependent]);

  useEffect(() => {
    if (!isIndependent) return;
    api.getCountries().then((d) => setCountries(d.countries)).catch(() => setCountries([]));
  }, [isIndependent]);

  function selectTeam(id) {
    setSelectedTeamId(id);
    setMode('view');
  }

  const balance = statement ? Number(statement.balance || 0) : null;

  return (
    <div>
      <div className="dash-header">
        <div>
          <span className="eyebrow">Panel de representante de equipo</span>
          <h1>{team.name}</h1>
          <span style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
            {isIndependent ? 'Equipo independiente (sin liga)' : team.league_name}
            {team.is_verified && (
              <span style={{ marginLeft: 8, color: 'var(--field)' }}>✓ Verificado</span>
            )}
          </span>
          {statement && (
            <div style={{ fontSize: 13, marginTop: 6 }}>
              <span style={{ color: balance < 0 ? 'var(--flag)' : balance > 0 ? 'var(--field)' : 'var(--ink-dim)', fontWeight: 600 }}>
                {balance < 0
                  ? `Debes $${Math.abs(balance).toLocaleString('es-MX', { minimumFractionDigits: 2 })} a la liga`
                  : balance > 0
                    ? `Saldo a favor $${balance.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
                    : 'Al corriente con la liga'}
              </span>
              {' · '}
              <Link to={`/panel/equipo/${team.id}/estado-de-cuenta`} style={{ color: 'var(--flag)' }}>
                Ver estado de cuenta
              </Link>
            </div>
          )}
        </div>
        {teams.length > 1 && (
          <select
            value={selectedTeamId || ''}
            onChange={(e) => selectTeam(Number(e.target.value))}
            style={{ background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '10px 12px', borderRadius: 4 }}
          >
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {isIndependent && (
        <div className="form-error" style={{ background: team.show_on_platform ? 'rgba(58,141,63,0.12)' : 'rgba(255,210,63,0.12)', borderColor: team.show_on_platform ? 'var(--field)' : 'var(--flag)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span>
            {team.show_on_platform
              ? '✓ Tu equipo aparece en el home de LIFA App.'
              : 'Tu equipo es privado por ahora — puedes usar todas las herramientas sin que nadie más lo vea.'}
          </span>
          <button
            className={`btn btn-sm ${team.show_on_platform ? 'btn-ghost' : 'btn-flag'}`}
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

      {team.organization_id && (
        <OrgAdminsPanel organizationId={team.organization_id} organizationName={team.name} token={token} />
      )}

      {mode === 'view' ? (
        <TeamProfileView team={team} onEdit={() => setMode('edit')} />
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
  const hasLinks   = team.facebook_url || team.instagram_url || team.twitter_url || team.website_url;
  const sectionLabelStyle = { fontSize: 11, letterSpacing: '0.15em', color: 'var(--flag)', textTransform: 'uppercase', marginBottom: 10, fontFamily: 'var(--font-eyebrow)' };

  return (
    <div>
      <p style={{ color: 'var(--ink-dim)', fontSize: 13, marginBottom: 16 }}>
        Así se ve el perfil de tu equipo. Dale clic a "Editar" para cambiar el logo, contacto, redes o los links de transmisión/boletos.
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
              {team.location      && <div className="team-info-row">📍 {team.location}</div>}
              {team.contact_email && <div className="team-info-row">✉️ {team.contact_email}</div>}
              {team.contact_phone && <div className="team-info-row">📞 {team.contact_phone}</div>}
            </div>
          )}

          {hasLinks && (
            <div className="team-profile-section" style={{ textAlign: 'left', marginBottom: 16 }}>
              <div style={sectionLabelStyle}>Redes y sitio web</div>
              <div className="team-info-links">
                {team.facebook_url  && <a href={team.facebook_url}  target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">Facebook</a>}
                {team.instagram_url && <a href={team.instagram_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">Instagram</a>}
                {team.twitter_url   && <a href={team.twitter_url}   target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">X / Twitter</a>}
                {team.website_url   && <a href={team.website_url}   target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">Sitio web</a>}
              </div>
            </div>
          )}

          <div className="team-profile-section" style={{ textAlign: 'left', marginBottom: 8 }}>
            <div style={sectionLabelStyle}>Links predeterminados de transmisión y boletos</div>
            <LinkGroupView label="Transmisión — en casa"  links={team.home_stream_links} />
            <LinkGroupView label="Transmisión — de visita" links={team.away_stream_links} />
            <LinkGroupView label="Boletos — en casa"       links={team.home_ticket_links} />
            <LinkGroupView label="Boletos — de visita"     links={team.away_ticket_links} />
            {!team.home_stream_links?.length && !team.away_stream_links?.length && !team.home_ticket_links?.length && !team.away_ticket_links?.length && (
              <div style={{ fontSize: 12, color: 'var(--ink-dim)' }}>Todavía no has agregado ningún link.</div>
            )}
          </div>

          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <button className="btn btn-flag" onClick={onEdit}>✏️ Editar perfil del equipo</button>
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
      <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 4 }}>{label}</div>
      {links.map((url, i) => (
        <div key={i} style={{ fontSize: 13 }}>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--flag)' }}>{url}</a>
        </div>
      ))}
    </div>
  );
}

function initials(name) {
  return (name || '')
    .split(' ')
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

