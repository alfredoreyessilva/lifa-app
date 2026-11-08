import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import OrgAdminsPanel from '../components/OrgAdminsPanel.jsx';
import LeagueWorkspace, { LeagueEyebrow, leagueSections } from '../components/league/LeagueWorkspace.jsx';
import LeagueModal from '../components/league/LeagueModals.jsx';
import LeagueOverviewSection from '../components/league/LeagueOverviewSection.jsx';
import LeagueTournamentsSection from '../components/league/LeagueTournamentsSection.jsx';
import LeagueBranchSection from '../components/league/LeagueBranchSection.jsx';
import LeagueTeamsSection from '../components/league/LeagueTeamsSection.jsx';
import LeagueVenuesSection from '../components/league/LeagueVenuesSection.jsx';
import LeagueProfileSection from '../components/league/LeagueProfileSection.jsx';
import { Band, SectionError } from '../components/admin/AdminKit.jsx';
import { puede } from '../utils/permisos.js';

// El panel de una liga. Ruta: /panel/liga/:id/estructura
//
// Una herramienta con secciones —Resumen, Torneos, Equipos, Sedes, Staff y
// Perfil, más Cobranza en su propia ruta— en vez del acordeón de una sola página
// que había hasta el 2026-11-07 (README, "El panel de una liga"). La página pide
// el árbol una vez y lo reparte; cada acción abre su ventana aquí mismo y, al
// terminar, se vuelve a pedir el árbol sin borrar el anterior, para que nada
// parpadee.
//
// La sección va en `?seccion=` y la rama abierta en `?rama=`: ver
// components/league/LeagueWorkspace.jsx.
export default function LeagueStructurePanel() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { token, leagues, refreshLeagues } = useAuth();
  const sidebarLeague = leagues.find((lg) => String(lg.id) === id);
  // El árbol de la liga es de quien la administra. Al visor y al tesorero de
  // liga no se les pide: el servidor les contestaría "No tienes permiso sobre
  // esta liga", y lo suyo está en otro lado. El Resumen les dice dónde.
  const administraLaLiga = puede(sidebarLeague, 'estructura');

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);

  function refresh() {
    return api.getLeagueTree(id, token)
      .then((tree) => { setData(tree); setError(''); })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    setData(null);
    if (token && administraLaLiga) refresh();
  }, [id, token, administraLaLiga]); // eslint-disable-line react-hooks/exhaustive-deps

  const sections = sidebarLeague ? leagueSections(sidebarLeague) : [];
  const branchId = params.get('rama');
  const requested = branchId ? 'torneos' : params.get('seccion');
  const section = sections.some((s) => s.key === requested && s.key !== 'cobranza') ? requested : 'resumen';

  // App.jsx sube al inicio solo cuando cambia la ruta, y aquí cambia la búsqueda.
  useEffect(() => { window.scrollTo(0, 0); }, [section, branchId]);

  if (!token) {
    return <div className="container"><p>Necesitas iniciar sesión para ver esto.</p></div>;
  }
  if (!sidebarLeague) {
    return <div className="container"><p>No administras ninguna liga con ese id.</p></div>;
  }

  const closeAndRefresh = () => { setModal(null); return refresh(); };
  const shared = { league: sidebarLeague, tree: data, error, setModal, token, refresh };

  return (
    <LeagueWorkspace league={sidebarLeague} tree={administraLaLiga ? data : null} section={section}>
      {section === 'resumen' && <LeagueOverviewSection {...shared} />}
      {section === 'torneos' && (branchId
        ? <LeagueBranchSection {...shared} branchId={branchId} />
        : <LeagueTournamentsSection {...shared} />)}
      {section === 'equipos' && <LeagueTeamsSection {...shared} />}
      {section === 'sedes' && <LeagueVenuesSection {...shared} />}
      {section === 'perfil' && <LeagueProfileSection {...shared} />}
      {section === 'staff' && (
        <>
          <Band title="Staff" eyebrow={<LeagueEyebrow league={sidebarLeague} />} />
          <div className="adm-canvas">
            <SectionError messages={[error]} />
            {(data?.league?.organization_id ?? sidebarLeague.organization_id) ? (
              <OrgAdminsPanel
                organizationId={data?.league?.organization_id ?? sidebarLeague.organization_id}
                organizationName={sidebarLeague.name}
                organizationType="league"
                entidad={sidebarLeague}
                token={token}
                siempreAbierto
              />
            ) : (
              <p className="adm-note">
                Esta liga todavía no tiene una organización enlazada, así que no se puede invitar a nadie a
                su staff. Avísanos para revisarlo.
              </p>
            )}
          </div>
        </>
      )}

      {modal && (
        <LeagueModal
          modal={modal}
          token={token}
          leagueId={id}
          league={data?.league}
          leagueTimezone={data?.league?.timezone || 'America/Mexico_City'}
          teams={data?.teams || []}
          venues={data?.venues || []}
          onClose={() => setModal(null)}
          onDone={closeAndRefresh}
          onRefresh={refresh}
          onLeagueChanged={() => { refreshLeagues(); refresh(); setModal(null); }}
        />
      )}
    </LeagueWorkspace>
  );
}
