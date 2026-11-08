import { useMemo } from 'react';
import {
  Band, FilterScoreboard, Identity, NoResults, RowMenu, SearchBox, SectionError, SectionLoading, Status,
  TableFooter, useSectionFilter, useTableView,
} from '../admin/AdminKit.jsx';
import { countFilters, matchesSearch } from '../../utils/adminPanel.js';
import { TEAM_FILTERS, teamBranches } from '../../utils/leaguePanel.js';
import { puede } from '../../utils/permisos.js';
import { LeagueEyebrow } from './LeagueWorkspace.jsx';

// Los equipos de la liga (`league_teams`): los mismos que ve el público en la
// página de la liga. Inscribirlos en una rama se hace dentro de la rama.
export default function LeagueTeamsSection({ league, tree, error, setModal }) {
  const [filter, setFilter] = useSectionFilter(TEAM_FILTERS, 'todos');

  const rows = useMemo(() => {
    const ramas = teamBranches(tree);
    return (tree?.teams ?? []).map((tm) => {
      const suyas = ramas.get(tm.id) ?? [];
      // "COLEGIAL UNIVERSITARIO Varonil", como lo dice la página de un partido: dos
      // categorías pueden tener cada una su "Varonil".
      return { ...tm, branchCount: suyas.length, branchNames: suyas.map(({ c, b }) => `${c.name} ${b.name}`) };
    });
  }, [tree]);

  const active = TEAM_FILTERS.find((f) => f.key === filter);
  const view = useTableView((query) => rows
    .filter(active.test)
    .filter((tm) => matchesSearch(query, [tm.name, tm.institution, tm.city, tm.location])), filter);
  const canHandOver = puede(league, 'entregar_equipos');

  return (
    <>
      <Band
        title="Equipos"
        eyebrow={<LeagueEyebrow league={league} />}
        actions={(
          <button type="button" className="btn btn-flag btn-sm" onClick={() => setModal({ type: 'add-team' })}>
            + Equipo
          </button>
        )}
      >
        <FilterScoreboard
          label="Filtrar equipos"
          filters={countFilters(TEAM_FILTERS, rows, filter)}
          active={filter}
          onChange={setFilter}
          loading={!tree}
        />
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[error]} />

        {!tree ? !error && <SectionLoading /> : (
          <>
            <div className="adm-toolbar">
              <SearchBox value={view.query} onChange={view.setQuery} placeholder="Buscar por equipo, institución o ciudad" />
            </div>

            {view.page.rows.length === 0 ? (
              <NoResults onClear={filter !== 'todos' || view.query ? () => { view.setQuery(''); setFilter('todos'); } : null}>
                {rows.length === 0 ? 'Tu liga todavía no tiene equipos. Agrega el primero con "+ Equipo".' : 'Ningún equipo coincide con lo que buscas.'}
              </NoResults>
            ) : (
              <div className="adm-table-box">
                <div className="table-wrap">
                  <table className="data-table adm-table">
                    <caption className="adm-sr-only">Equipos de la liga</caption>
                    <thead>
                      <tr>
                        <th>Equipo</th>
                        <th className="adm-col-owner" style={{ width: '24%' }}>Juega en</th>
                        <th style={{ width: 190 }}>Administración</th>
                        <th className="col-actions" style={{ width: 120 }}><span className="adm-sr-only">Acciones</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.page.rows.map((tm) => (
                        <TeamRow key={tm.id} team={tm} canHandOver={canHandOver} setModal={setModal} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <TableFooter view={view} noun={view.page.total === 1 ? 'equipo' : 'equipos'} />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function TeamRow({ team: tm, canHandOver, setModal }) {
  const where = [tm.institution, tm.city].filter(Boolean).join(' · ');
  // Entregar es de una sola vía. A un equipo que ya se administra solo no se le
  // ofrece cancelar la entrega ni eliminarlo: el backend contesta 409, y
  // ofrecerlo sería prometer algo que no se puede (README, "Quién puede eliminar
  // un equipo"). Sacarlo de la liga es otra cosa, su participación, y no está
  // construido.
  const handedOver = Boolean(tm.owner_user_id);
  return (
    <tr>
      <td><Identity name={tm.name} sub={where || null} logo={tm.logo_url} round /></td>
      <td className="adm-col-owner">
        {tm.branchCount === 0
          ? <span className="adm-faint">Sin inscribir</span>
          : <span className="adm-cell-clip" title={tm.branchNames.join(', ')}>{tm.branchNames.join(' · ')}</span>}
      </td>
      <td>
        {handedOver ? (
          <Status
            tone="on"
            check
            title="Su acceso lo reparten sus dueños desde su propio panel. Su participación en tus torneos no cambia."
          >
            Se administra solo
          </Status>
        ) : <Status>Sin entregar</Status>}
      </td>
      <td className="col-actions">
        <div className="adm-row-actions">
          <button type="button" className="btn btn-ws btn-sm" onClick={() => setModal({ type: 'edit-team', team: tm })}>
            Editar
          </button>
          {handedOver ? <span className="lws-more-spacer" aria-hidden="true" /> : (
            <RowMenu
              label={`Más acciones de ${tm.name}`}
              items={[
                canHandOver && { label: 'Entregar perfil', onSelect: () => setModal({ type: 'invite-team', team: tm }) },
                canHandOver && {
                  label: 'Cancelar entrega',
                  onSelect: () => setModal({ type: 'remove-team-owner', team: tm }),
                },
                canHandOver && { divider: true, key: 'peligro' },
                { label: 'Eliminar equipo', danger: true, onSelect: () => setModal({ type: 'delete-team', team: tm }) },
              ]}
            />
          )}
        </div>
      </td>
    </tr>
  );
}
