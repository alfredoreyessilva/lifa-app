import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatNumber, leagueHasRequest, prizesSwitch } from '../utils/adminPanel.js';
import {
  IconBell, IconClock, IconGift, IconLeague, IconOrganization, IconOverview, IconSponsor, IconUsers,
} from '../components/admin/AdminIcons.jsx';
import AdminOverviewSection from '../components/admin/AdminOverviewSection.jsx';
import AdminLeaguesSection from '../components/admin/AdminLeaguesSection.jsx';
import AdminOrganizationsSection from '../components/admin/AdminOrganizationsSection.jsx';
import AdminUsersSection from '../components/admin/AdminUsersSection.jsx';
import AdminSponsorsSection from '../components/admin/AdminSponsorsSection.jsx';
import AdminPrizesSection from '../components/admin/AdminPrizesSection.jsx';
import AdminNotificationsSection from '../components/admin/AdminNotificationsSection.jsx';
import AdminCronSection, { CRON_STATES } from '../components/admin/AdminCronSection.jsx';
import '../components/admin/admin.css';

// La sección vive en `?seccion=` y no en la ruta: el ErrorBoundary de App.jsx lleva
// `key={location.pathname}`, y una ruta por sección desmontaría el panel entero en
// cada clic, con sus datos.
const SECTIONS = [
  { key: 'resumen',        label: 'Resumen',        icon: IconOverview },
  { key: 'ligas',          label: 'Ligas',          icon: IconLeague },
  { key: 'organizaciones', label: 'Organizaciones', icon: IconOrganization },
  { key: 'usuarios',       label: 'Usuarios',       icon: IconUsers },
  { key: 'patrocinadores', label: 'Patrocinadores', icon: IconSponsor },
  { key: 'premios',        label: 'Premios',        icon: IconGift },
  { key: 'notificaciones', label: 'Notificaciones', icon: IconBell },
  { key: 'cron',           label: 'Cron',           icon: IconClock },
];

const SOURCES = {
  stats:         (token) => api.adminGetStats(token),
  cron:          (token) => api.adminGetCron(token),
  notifications: (token) => api.adminGetNotifications(token),
  switches:      (token) => api.adminGetSwitches(token),
  sponsors:      () => api.getSponsors(),
  leagues:       (token) => api.adminGetLeagues(token),
  organizations: (token) => api.adminGetOrganizations(token),
  users:         (token) => api.adminGetUsers(token),
};

// Todo se pide al abrir el panel y se queda aquí: moverse entre secciones es
// instantáneo, y los avisos de la barra lateral dicen lo mismo que las tablas.
// Recargar una fuente no borra la anterior, así que la tabla no parpadea después de
// publicar una liga.
function useAdminData(token) {
  const [data, setData] = useState({});
  const [errors, setErrors] = useState({});

  const reload = useCallback(async (source) => {
    try {
      const value = await SOURCES[source](token);
      setData((current) => ({ ...current, [source]: value }));
      setErrors((current) => ({ ...current, [source]: '' }));
    } catch (e) {
      setErrors((current) => ({ ...current, [source]: e.message }));
    }
  }, [token]);

  useEffect(() => {
    Object.keys(SOURCES).forEach(reload);
  }, [reload]);

  return { data, errors, reload };
}

export default function AdminPanel() {
  const { token } = useAuth();
  const [params] = useSearchParams();
  const { data, errors, reload } = useAdminData(token);

  const requested = params.get('seccion');
  const section = SECTIONS.some((s) => s.key === requested) ? requested : 'resumen';

  // App.jsx sube al inicio solo cuando cambia la ruta, y aquí cambia la búsqueda.
  useEffect(() => { window.scrollTo(0, 0); }, [section]);

  return (
    <div className="adm">
      <AdminRail section={section} data={data} />

      <div className="adm-main">
        {section === 'resumen' && <AdminOverviewSection data={data} errors={errors} />}
        {section === 'ligas' && (
          <AdminLeaguesSection
            leagues={data.leagues}
            error={errors.leagues}
            reload={() => reload('leagues')}
            token={token}
          />
        )}
        {section === 'organizaciones' && (
          <AdminOrganizationsSection
            organizations={data.organizations}
            error={errors.organizations}
            reload={() => reload('organizations')}
            token={token}
          />
        )}
        {section === 'usuarios' && (
          <AdminUsersSection
            users={data.users}
            error={errors.users}
            reload={() => reload('users')}
            token={token}
          />
        )}
        {section === 'patrocinadores' && (
          <AdminSponsorsSection
            sponsors={data.sponsors}
            stats={data.stats}
            error={errors.sponsors || errors.stats}
            reload={() => Promise.all([reload('sponsors'), reload('stats')])}
            token={token}
          />
        )}
        {section === 'premios' && (
          <AdminPrizesSection
            data={data.switches}
            error={errors.switches}
            reload={() => reload('switches')}
            token={token}
          />
        )}
        {section === 'notificaciones' && (
          <AdminNotificationsSection catalog={data.notifications} error={errors.notifications} />
        )}
        {section === 'cron' && (
          <AdminCronSection cron={data.cron} error={errors.cron} reload={() => reload('cron')} />
        )}
      </div>
    </div>
  );
}

// Lo único amarillo de la barra es lo que espera a Alfredo. En el teléfono la barra
// se desliza de lado, y la sección elegida se trae a la vista para que nunca quede
// escondida a la derecha.
//
// Premios lleva un punto verde solo mientras están prendidos: desde cualquier
// sección se ve que hay algo encendido para toda la plataforma. Apagados, que es
// como nacen, la barra no dice nada.
function AdminRail({ section, data }) {
  const current = useRef(null);

  useEffect(() => {
    if (window.matchMedia('(max-width: 900px)').matches) {
      current.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }, [section]);

  const requests = data.leagues?.filter(leagueHasRequest).length ?? 0;
  const unverified = data.organizations?.filter((org) => !org.is_verified).length ?? 0;
  const cronState = data.cron ? CRON_STATES[data.cron.estado] ?? CRON_STATES.sin_señal : null;
  const prizesOn = data.switches ? prizesSwitch(data.switches).enabled : false;

  const badges = { ligas: requests, organizaciones: unverified };

  return (
    <aside className="adm-rail">
      <div className="adm-rail-inner">
        <div className="adm-rail-title">
          <strong>Panel de control</strong>
          <span>Administrador</span>
        </div>
        <nav className="adm-nav" aria-label="Secciones del panel">
          {SECTIONS.map(({ key, label, icon: Icon }) => (
            <Link
              key={key}
              ref={key === section ? current : null}
              to={key === 'resumen' ? '/admin' : `/admin?seccion=${key}`}
              aria-current={key === section ? 'page' : undefined}
            >
              <Icon />
              <span>{label}</span>
              {badges[key] > 0 && (
                <span className="adm-nav-badge" aria-label={`${badges[key]} por atender`}>
                  {formatNumber(badges[key])}
                </span>
              )}
              {key === 'premios' && prizesOn && (
                <span
                  className="adm-nav-dot is-on"
                  role="img"
                  aria-label="Prendidos"
                  title="Prendidos"
                />
              )}
              {key === 'cron' && cronState && (
                <span
                  className={`adm-nav-dot is-${cronState.tone}`}
                  role="img"
                  aria-label={cronState.text}
                  title={cronState.text}
                />
              )}
            </Link>
          ))}
        </nav>
      </div>
    </aside>
  );
}
