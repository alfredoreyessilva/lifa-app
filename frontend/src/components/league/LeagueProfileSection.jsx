import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import {
  Band, ScoreCell, Scoreboard, SectionError, SectionLoading, Status,
} from '../admin/AdminKit.jsx';
import { VISIBILITY, visibilityOf } from '../../utils/leaguePanel.js';
import { getTimezoneLabel } from '../../utils/timezones.js';
import { LeagueEyebrow } from './LeagueWorkspace.jsx';

const CONTACTOS = [
  ['whatsapp', 'WhatsApp'],
  ['facebook_url', 'Facebook'],
  ['instagram_url', 'Instagram'],
  ['twitter_url', 'X'],
  ['youtube_url', 'YouTube'],
  ['tiktok_url', 'TikTok'],
  // Con espacio que no se parte: "Sitio" y "web" en dos renglones no se leen.
  ['website_url', 'Sitio web'],
];

// Lo que la liga enseña de sí misma y quién lo ve. Publicar la decide CFBAMX a
// pedido de la liga; ocultarse, la liga sola (README, "Organizaciones: publicar
// y verificar").
export default function LeagueProfileSection({ league, tree, error, setModal, token, refresh }) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const info = tree?.league;
  const visibility = visibilityOf(info);

  async function run(action) {
    setBusy(true);
    setActionError('');
    try {
      await action();
      await refresh();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const estados = String(info?.state ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const contactos = CONTACTOS.filter(([key]) => info?.[key]).map(([, label]) => label);
  // "Centro — CDMX, Guadalajara, Monterrey": la zona en grande y sus ciudades
  // abajo, como cualquier otra cifra del marcador.
  const [zona, ciudades] = info ? getTimezoneLabel(info.timezone || 'America/Mexico_City').split(' — ') : [];

  return (
    <>
      <Band
        title="Perfil"
        eyebrow={<LeagueEyebrow league={league} />}
        actions={(
          <>
            <Link to={`/ligas/${info?.slug || league.slug}`} className="btn btn-ws btn-sm">Ver mi página</Link>
            <button type="button" className="btn btn-flag btn-sm" onClick={() => setModal({ type: 'edit-league' })}>
              Editar perfil
            </button>
          </>
        )}
      >
        <Scoreboard label="La liga en el sitio">
          <ScoreCell
            label="En el sitio"
            small
            value={visibility ? <Status tone={VISIBILITY[visibility].tone}>{VISIBILITY[visibility].label}</Status> : '—'}
            loading={!info}
          />
          <ScoreCell
            label="Verificación"
            small
            value={info?.is_verified ? <Status tone="on" check>Verificada</Status> : <Status>Sin verificar</Status>}
            loading={!info}
          />
          <ScoreCell label="Zona horaria" small value={zona || '—'} sub={ciudades || null} loading={!info} />
        </Scoreboard>
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[error, actionError]} />

        {!info ? !error && <SectionLoading /> : (
          <div className="adm-board lws-board">
            <section className="adm-cell">
              <h2>Quién la ve</h2>
              {visibility === 'publica' && (
                <>
                  <p className="lws-cell-text">
                    Tu liga es pública: cualquiera puede ver su página, sus calendarios y sus resultados en el sitio.
                  </p>
                  <button type="button" className="btn btn-ws btn-sm" disabled={busy} onClick={() => run(() => api.unpublishOwnLeague(league.id, token))}>
                    {busy ? 'Un momento…' : 'Ocultar mi liga'}
                  </button>
                </>
              )}
              {visibility === 'solicitud' && (
                <>
                  <p className="lws-cell-text">
                    Ya pediste aparecer en el panel de ligas. Un administrador de CFBAMX lo va a revisar; mientras
                    tanto puedes usar todas las herramientas.
                  </p>
                  <button type="button" className="btn btn-ws btn-sm" disabled={busy} onClick={() => run(() => api.cancelPublishRequest(league.id, token))}>
                    {busy ? 'Un momento…' : 'Cancelar solicitud'}
                  </button>
                </>
              )}
              {visibility === 'privada' && (
                <>
                  <p className="lws-cell-text">
                    Tu liga es privada por ahora: puedes usar todas las herramientas sin que nadie más la vea. Cuando
                    esté lista, pide aparecer en el panel de ligas.
                  </p>
                  <button type="button" className="btn btn-flag btn-sm" disabled={busy} onClick={() => run(() => api.requestPublishLeague(league.id, token))}>
                    {busy ? 'Un momento…' : 'Solicitar aparecer en el panel de ligas'}
                  </button>
                </>
              )}
            </section>

            <section className="adm-cell">
              <h2>Lo que publica</h2>
              <dl className="adm-facts lws-facts">
                <div><dt>Nombre</dt><dd>{info.name}</dd></div>
                <div>
                  <dt>Estados</dt>
                  <dd title={estados.join(', ')}>
                    {estados.length === 0 ? <span className="adm-faint">Sin estado</span>
                      : estados.length > 3 ? `${estados.length} estados` : estados.join(', ')}
                  </dd>
                </div>
                <div>
                  <dt>Descripción</dt>
                  <dd>{info.description ? 'Sí' : <span className="adm-faint">Sin descripción</span>}</dd>
                </div>
                <div>
                  <dt>Portada</dt>
                  <dd>{info.cover_url ? 'Sí' : <span className="adm-faint">Sin portada</span>}</dd>
                </div>
                <div>
                  <dt>Contactos</dt>
                  <dd>{contactos.length ? contactos.join(' · ') : <span className="adm-faint">Ninguno</span>}</dd>
                </div>
              </dl>
            </section>
          </div>
        )}
      </div>
    </>
  );
}
