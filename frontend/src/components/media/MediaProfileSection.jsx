import { useState } from 'react';
import {
  Band, ScoreCell, Scoreboard, SectionError, SectionLoading, Status,
} from '../admin/AdminKit.jsx';
import OrganizationInfoPanel from '../OrganizationInfoPanel.jsx';
import { hasFollowLinks } from '../../utils/mediaPanel.js';
import { MediaEyebrow } from './MediaWorkspace.jsx';

const REDES = [
  ['facebook_url', 'Facebook'],
  ['instagram_url', 'Instagram'],
  ['youtube_url', 'YouTube'],
  ['tiktok_url', 'TikTok'],
  // Con espacio que no se parte: "Sitio" y "web" en dos renglones no se leen.
  ['website_url', 'Sitio web'],
];
const CONTACTO = [
  ['contact_phone', 'Teléfono'],
  ['contact_email', 'Correo'],
];

const tiene = (org, key) => String(org?.[key] ?? '').trim() !== '';

// Lo que el medio enseña de sí mismo y quién lo ve. Su ficha es TODO lo que el
// público ve de un medio: la abren el directorio del home y "También transmiten"
// cuando no puso link para ese partido (README, "Lo que enseña su ficha").
// Publicarlo y verificarlo lo decide CFBAMX: aquí se dice, sin botón.
export default function MediaProfileSection({ media, org, orgError, gate, setModal }) {
  const [ficha, setFicha] = useState(false);

  return (
    <>
      <Band
        title="Perfil"
        eyebrow={<MediaEyebrow media={media} />}
        actions={(
          <>
            <button type="button" className="btn btn-ws btn-sm" disabled={!org} onClick={() => setFicha(true)}>
              Ver como público
            </button>
            <button type="button" className="btn btn-flag btn-sm" disabled={!org} onClick={() => setModal({ type: 'profile' })}>
              Editar perfil
            </button>
          </>
        )}
      >
        <Scoreboard label="El medio en el sitio">
          <ScoreCell
            label="En el sitio"
            small
            value={org?.is_public ? <Status tone="on">Público</Status> : <Status>Privado</Status>}
            loading={!org}
          />
          <ScoreCell
            label="Verificación"
            small
            value={org?.is_verified ? <Status tone="on" check>Verificado</Status> : <Status>Sin verificar</Status>}
            loading={!org}
          />
          <ScoreCell
            label="Para transmitir"
            small
            value={<Status tone={gate.tone}>{gate.label}</Status>}
            sub={gate.on ? null : gate.sub}
          />
        </Scoreboard>
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[orgError]} />

        {!org ? !orgError && <SectionLoading /> : (
          <div className="adm-board lws-board">
            <section className="adm-cell">
              <h2>Quién te ve</h2>
              <p className="lws-cell-text">
                {org.is_public
                  ? 'Tu medio es público: sale en el home, en «Medios de comunicación», y cualquiera puede abrir su ficha.'
                  : 'Tu medio es privado por ahora: no sale en el home y su ficha solo la ven quienes lo administran. Lo publica el equipo de CFBAMX.'}
              </p>
              <p className="lws-cell-text">
                {org.is_verified
                  ? 'Lleva la palomita de verificado: CFBAMX confirmó quién es.'
                  : 'Todavía no lleva la palomita de verificado. La pone el equipo de CFBAMX cuando confirma quién es el medio.'}
              </p>
              <p className="lws-cell-text">
                {gate.on
                  ? 'Puede sumarse a transmitir cualquier partido publicado: su logo sale en «También transmiten», en la página del partido, y abre tu transmisión si le pones el link.'
                  : 'Para sumarse a transmitir un partido tiene que ser público y estar verificado: así su logo en la página del partido dice quién es de verdad.'}
              </p>
            </section>

            <section className="adm-cell">
              <h2>Lo que publica tu ficha</h2>
              <dl className="adm-facts lws-facts">
                <div><dt>Nombre</dt><dd>{org.name}</dd></div>
                <div>
                  <dt>País</dt>
                  <dd>{org.country_name || <span className="adm-faint">Sin país</span>}</dd>
                </div>
                <Fact label="Logo" on={tiene(org, 'logo_url')} missing="Sin logo" ask />
                <Fact label="Portada" on={tiene(org, 'cover_url')} missing="Sin portada" />
                <Fact label="Descripción" on={tiene(org, 'description')} missing="Sin descripción" ask />
                <List label="Dónde seguirte" org={org} items={REDES} empty="Ninguno" ask={!hasFollowLinks(org)} />
                <List label="Contacto" org={org} items={CONTACTO} empty="Ninguno" />
              </dl>
            </section>
          </div>
        )}
      </div>

      {ficha && org && <OrganizationInfoPanel org={org} onClose={() => setFicha(false)} />}
    </>
  );
}

// Lo que falta va en amarillo solo si le toca al medio llenarlo: sin logo o sin
// descripción, su ficha no dice quién es. Una portada es opcional.
function Fact({ label, on, missing, ask }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{on ? 'Sí' : <span className={ask ? 'mws-missing' : 'adm-faint'}>{missing}</span>}</dd>
    </div>
  );
}

function List({ label, org, items, empty, ask }) {
  const names = items.filter(([key]) => tiene(org, key)).map(([, name]) => name);
  return (
    <div>
      <dt>{label}</dt>
      <dd>{names.length ? names.join(' · ') : <span className={ask ? 'mws-missing' : 'adm-faint'}>{empty}</span>}</dd>
    </div>
  );
}
