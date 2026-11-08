import { Link } from 'react-router-dom';
import {
  Band, ScoreCell, Scoreboard, SectionError, SectionLoading, Status,
} from '../admin/AdminKit.jsx';
import { hasContact, planOf, whatsappStatus } from '../../utils/storePanel.js';
import { StoreEyebrow } from './StoreWorkspace.jsx';

const CANALES = [
  ['contact_phone', 'Teléfono'],
  ['contact_email', 'Correo'],
  // Con espacio que no se parte: "Sitio" y "web" en dos renglones no se leen.
  ['website_url', 'Sitio web'],
];
const REDES = [
  ['facebook_url', 'Facebook'],
  ['instagram_url', 'Instagram'],
  ['youtube_url', 'YouTube'],
  ['tiktok_url', 'TikTok'],
];

const tiene = (org, key) => String(org?.[key] ?? '').trim() !== '';

// Lo que la tienda enseña de sí misma y quién lo ve. Publicarla y verificarla lo
// decide CFBAMX (README, "Organizaciones: publicar y verificar"); el plan Pro y el
// número de WhatsApp también los carga CFBAMX desde /admin. Aquí se dicen, sin
// botón: la tienda no tiene nada que apretar para cambiarlos.
export default function StoreProfileSection({ store, org, orgError, setModal }) {
  const plan = org ? planOf(org) : null;
  const whatsapp = org ? whatsappStatus(org) : null;

  return (
    <>
      <Band
        title="Perfil"
        eyebrow={<StoreEyebrow store={store} />}
        actions={(
          <>
            <Link to={`/panel/organizacion/${store.id}`} className="btn btn-ws btn-sm">Ver mi página</Link>
            <button type="button" className="btn btn-flag btn-sm" disabled={!org} onClick={() => setModal({ type: 'profile' })}>
              Editar perfil
            </button>
          </>
        )}
      >
        <Scoreboard label="La tienda en el sitio">
          <ScoreCell
            label="En el sitio"
            small
            value={org?.is_public ? <Status tone="on">Pública</Status> : <Status>Privada</Status>}
            loading={!org}
          />
          <ScoreCell
            label="Verificación"
            small
            value={org?.is_verified ? <Status tone="on" check>Verificada</Status> : <Status>Sin verificar</Status>}
            loading={!org}
          />
          <ScoreCell label="Plan" small value={plan?.label} sub={plan?.sub} loading={!org} />
          <ScoreCell
            label="Botón de WhatsApp"
            small
            value={whatsapp ? <Status tone={whatsapp.tone}>{whatsapp.label}</Status> : null}
            sub={whatsapp?.sub}
            loading={!org}
          />
        </Scoreboard>
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[orgError]} />

        {!org ? !orgError && <SectionLoading /> : (
          <div className="adm-board lws-board">
            <section className="adm-cell">
              <h2>Quién la ve</h2>
              <p className="lws-cell-text">
                {org.is_public
                  ? 'Tu tienda es pública: sale en el home, en «Tiendas y proveedores», y cualquiera puede abrir tu página.'
                  : 'Tu tienda es privada por ahora: no sale en el home y tu página solo la ven quienes la administran. La publica el equipo de CFBAMX.'}
              </p>
              <p className="lws-cell-text">
                {org.is_verified
                  ? 'Lleva la palomita de verificada: CFBAMX confirmó quién es.'
                  : 'Todavía no lleva la palomita de verificada. La pone el equipo de CFBAMX cuando confirma quién es la tienda.'}
              </p>
              <p className="lws-cell-text">
                {whatsapp.on
                  ? `Tu página lleva el botón «Consultar por WhatsApp», que abre una conversación al ${whatsapp.sub}.`
                  : 'El botón «Consultar por WhatsApp» sale en tu página con el plan Pro y el número de tu tienda, que carga CFBAMX.'}
              </p>
            </section>

            <section className="adm-cell">
              <h2>Lo que publica</h2>
              <dl className="adm-facts lws-facts">
                <div><dt>Nombre</dt><dd>{org.name}</dd></div>
                <div>
                  <dt>País</dt>
                  <dd>{org.country_name || <span className="adm-faint">Sin país</span>}</dd>
                </div>
                <Fact label="Logo" on={tiene(org, 'logo_url')} missing="Sin logo" ask />
                <Fact label="Portada" on={tiene(org, 'cover_url')} missing="Sin portada" />
                <Fact label="Descripción" on={tiene(org, 'description')} missing="Sin descripción" ask />
                <List label="Contacto" org={org} items={CANALES} empty="Ninguno" ask={!hasContact(org)} />
                <List label="Redes" org={org} items={REDES} empty="Ninguna" />
              </dl>
            </section>
          </div>
        )}
      </div>
    </>
  );
}

// Lo que falta va en amarillo solo si le toca a la tienda llenarlo: sin logo o sin
// descripción, la vitrina no dice quién es. Una portada es opcional.
function Fact({ label, on, missing, ask }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{on ? 'Sí' : <span className={ask ? 'sws-missing' : 'adm-faint'}>{missing}</span>}</dd>
    </div>
  );
}

// Sin teléfono, correo ni sitio, el contacto falta solo si tampoco hay redes ni
// botón de WhatsApp: es la misma cuenta del Resumen (`hasContact`).
function List({ label, org, items, empty, ask }) {
  const names = items.filter(([key]) => tiene(org, key)).map(([, name]) => name);
  return (
    <div>
      <dt>{label}</dt>
      <dd>{names.length ? names.join(' · ') : <span className={ask ? 'sws-missing' : 'adm-faint'}>{empty}</span>}</dd>
    </div>
  );
}
