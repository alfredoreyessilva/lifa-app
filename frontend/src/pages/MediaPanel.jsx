import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import OrgAdminsPanel from '../components/OrgAdminsPanel.jsx';
import MediaWorkspace, { MediaEyebrow, mediaSections, shownMedia } from '../components/media/MediaWorkspace.jsx';
import MediaOverviewSection from '../components/media/MediaOverviewSection.jsx';
import MediaBroadcastsSection from '../components/media/MediaBroadcastsSection.jsx';
import MediaScheduleSection from '../components/media/MediaScheduleSection.jsx';
import MediaProfileSection from '../components/media/MediaProfileSection.jsx';
import MediaModal from '../components/media/MediaModals.jsx';
import { Band } from '../components/admin/AdminKit.jsx';
import { annotate, broadcastGate, scheduleOf } from '../utils/mediaPanel.js';
import { organizationHref } from '../utils/dashboard.js';

// El panel de un medio. Ruta: /panel/medio/:id
//
// Una herramienta con secciones —Resumen, Transmisiones, Partidos, Perfil y
// Staff— en vez del formulario de "Editar organización" que había hasta el
// 2026-11-08 (README, "El panel de un medio"). La página pide el medio, sus
// transmisiones y lo que se juega una vez, y los reparte; cada acción abre su
// ventana aquí mismo y, al terminar, se vuelve a pedir solo lo que cambió, sin
// borrar lo anterior, para que nada parpadee.
//
// La sección va en `?seccion=` y el filtro en `?filtro=`, como en el panel de una
// tienda: el ErrorBoundary de App.jsx lleva `key={location.pathname}`, y una ruta
// por sección desmontaría el panel en cada clic.
export default function MediaPanel() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { token, organizations, refreshLeagues } = useAuth();
  // El medio como lo manda /auth/me: con tu rol, lo que puedes hacer, y si está
  // publicado y verificado.
  const media = (organizations || []).find((o) => String(o.id) === id);
  const isMedia = media?.type === 'media';

  const [org, setOrg] = useState(null);
  const [orgError, setOrgError] = useState('');
  const [rawBroadcasts, setRawBroadcasts] = useState(null);
  const [broadcastsError, setBroadcastsError] = useState('');
  const [rawSchedule, setRawSchedule] = useState(null);
  const [scheduleError, setScheduleError] = useState('');
  const [modal, setModal] = useState(null);

  // Con la sesión: un medio privado no existe para el público (404).
  const loadOrg = useCallback(() => api.getOrganization(id, token)
    .then((data) => { setOrg(data); setOrgError(''); })
    .catch((e) => setOrgError(`No se pudo cargar tu medio: ${e.message}`)), [id, token]);

  const loadBroadcasts = useCallback(() => api.getOrganizationBroadcasts(id, token)
    .then((data) => { setRawBroadcasts(data.broadcasts); setBroadcastsError(''); })
    .catch((e) => setBroadcastsError(`No se pudieron cargar tus transmisiones: ${e.message}`)), [id, token]);

  // Mientras Render despliega la ruta nueva, el frontend nuevo puede hablar con
  // el backend viejo: ahí esto contesta 404 y la sección lo dice, sin tumbar lo
  // demás.
  const loadSchedule = useCallback(() => api.getMediaUpcomingMatches(id, token)
    .then((data) => { setRawSchedule(data.matches); setScheduleError(''); })
    .catch((e) => setScheduleError(`No se pudo cargar lo que se juega: ${e.message}`)), [id, token]);

  useEffect(() => {
    setOrg(null);
    setRawBroadcasts(null);
    setRawSchedule(null);
    if (!token || !isMedia) return;
    loadOrg();
    loadBroadcasts();
    loadSchedule();
  }, [token, isMedia, loadOrg, loadBroadcasts, loadSchedule]);

  // La hora con la que se decide qué ya pasó: la de la última vez que llegaron
  // los partidos, para que todas las secciones digan lo mismo.
  const now = useMemo(() => Date.now(), [rawBroadcasts, rawSchedule]);
  const broadcasts = useMemo(() => (rawBroadcasts ? annotate(rawBroadcasts, now) : null), [rawBroadcasts, now]);
  const schedule = useMemo(() => (rawSchedule ? scheduleOf(rawSchedule, now) : null), [rawSchedule, now]);

  const sections = media ? mediaSections(media) : [];
  const requested = params.get('seccion');
  const section = sections.some((s) => s.key === requested) ? requested : 'resumen';

  // App.jsx sube al inicio solo cuando cambia la ruta, y aquí cambia la búsqueda.
  useEffect(() => { window.scrollTo(0, 0); }, [section]);

  if (!media) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No administras ningún medio con ese id</h3>
          <Link to="/panel" className="btn btn-outline" style={{ marginTop: 16 }}>Volver a mi panel</Link>
        </div>
      </div>
    );
  }
  // Una tienda tiene su panel; una clínica o una marca, su formulario. La
  // organización de una liga o un equipo no se edita por aquí.
  if (!isMedia) {
    const destino = ['league', 'team'].includes(media.type) ? '/panel' : organizationHref(media);
    return <Navigate to={destino} replace />;
  }

  const gate = broadcastGate(shownMedia(media, org));
  // Sumarse, editar un link o quitarse mueve las dos listas: la transmisión y el
  // "Transmites" del partido.
  const reloadBroadcasts = () => Promise.all([loadBroadcasts(), loadSchedule()]);

  const shared = {
    media, org, broadcasts, schedule, now, gate, orgError, broadcastsError, scheduleError, setModal, token,
  };

  return (
    <MediaWorkspace media={media} org={org} broadcasts={broadcasts} section={section}>
      {section === 'resumen' && <MediaOverviewSection {...shared} />}
      {section === 'transmisiones' && <MediaBroadcastsSection {...shared} />}
      {section === 'partidos' && <MediaScheduleSection {...shared} />}
      {section === 'perfil' && <MediaProfileSection {...shared} />}
      {section === 'staff' && (
        <>
          <Band title="Staff" eyebrow={<MediaEyebrow media={media} />} />
          <div className="adm-canvas">
            <OrgAdminsPanel
              organizationId={media.id}
              organizationName={org?.name ?? media.name}
              organizationType="media"
              entidad={media}
              token={token}
              siempreAbierto
            />
          </div>
        </>
      )}

      {modal && (
        <MediaModal
          modal={modal}
          media={media}
          org={org}
          token={token}
          onClose={() => setModal(null)}
          onBroadcastsChanged={reloadBroadcasts}
          // El nombre y el logo también viven en la sesión: la barra de esta
          // página, Mi panel y la barra de arriba los leen de ahí.
          onProfileSaved={(saved) => {
            setOrg(saved);
            refreshLeagues().catch(() => { /* lo de la sesión puede esperar a la próxima vuelta */ });
          }}
        />
      )}
    </MediaWorkspace>
  );
}
