import { useMemo } from 'react';
import {
  Band, FilterScoreboard, NoResults, RowMenu, SearchBox, SectionError, SectionLoading,
  TableFooter, useSectionFilter, useTableView,
} from '../admin/AdminKit.jsx';
import { countFilters, matchesSearch, pluralize } from '../../utils/adminPanel.js';
import { VENUE_FILTERS, venueUsage } from '../../utils/leaguePanel.js';
import { LeagueEyebrow } from './LeagueWorkspace.jsx';

// Las sedes son de la liga y solo de ella (`venues.league_id`). Cuántos partidos
// se juegan en cada una sale del árbol: una sede sin partidos es la que se puede
// borrar sin dejar a nadie sin cancha.
export default function LeagueVenuesSection({ league, tree, error, setModal }) {
  const [filter, setFilter] = useSectionFilter(VENUE_FILTERS, 'todas');

  const rows = useMemo(() => {
    const uso = venueUsage(tree);
    return (tree?.venues ?? []).map((v) => ({ ...v, matchCount: uso.get(v.id) ?? 0 }));
  }, [tree]);

  const active = VENUE_FILTERS.find((f) => f.key === filter);
  const view = useTableView((query) => rows
    .filter(active.test)
    .filter((v) => matchesSearch(query, [v.name, v.institution, v.city, v.address])), filter);

  return (
    <>
      <Band
        title="Sedes"
        eyebrow={<LeagueEyebrow league={league} />}
        actions={(
          <button type="button" className="btn btn-flag btn-sm" onClick={() => setModal({ type: 'add-venue' })}>
            + Sede
          </button>
        )}
      >
        <FilterScoreboard
          label="Filtrar sedes"
          filters={countFilters(VENUE_FILTERS, rows, filter)}
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
              <SearchBox value={view.query} onChange={view.setQuery} placeholder="Buscar por sede, institución o ciudad" />
            </div>

            {view.page.rows.length === 0 ? (
              <NoResults onClear={filter !== 'todas' || view.query ? () => { view.setQuery(''); setFilter('todas'); } : null}>
                {rows.length === 0 ? 'Tu liga todavía no tiene sedes. Agrega la primera con "+ Sede".' : 'Ninguna sede coincide con lo que buscas.'}
              </NoResults>
            ) : (
              <div className="adm-table-box">
                <div className="table-wrap">
                  <table className="data-table adm-table">
                    <caption className="adm-sr-only">Sedes de la liga</caption>
                    <thead>
                      <tr>
                        <th>Sede</th>
                        <th className="col-num" style={{ width: 130 }}>Partidos</th>
                        <th className="col-actions" style={{ width: 120 }}><span className="adm-sr-only">Acciones</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.page.rows.map((v) => (
                        <tr key={v.id}>
                          <td>
                            {/* Sin imagen: la portada de una sede es una foto ancha, y en
                                el cuadrito de un logo no se lee nada. */}
                            <VenueName venue={v} />
                          </td>
                          <td className={`col-num adm-num${v.matchCount === 0 ? ' adm-faint' : ''}`}>
                            {pluralize(v.matchCount, 'partido')}
                          </td>
                          <td className="col-actions">
                            <div className="adm-row-actions">
                              <button type="button" className="btn btn-ws btn-sm" onClick={() => setModal({ type: 'edit-venue', venue: v })}>
                                Editar
                              </button>
                              <RowMenu
                                label={`Más acciones de ${v.name}`}
                                items={[{
                                  label: 'Eliminar sede',
                                  danger: true,
                                  onSelect: () => setModal({ type: 'delete-venue', venue: v }),
                                }]}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TableFooter view={view} noun={view.page.total === 1 ? 'sede' : 'sedes'} />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function VenueName({ venue: v }) {
  const sub = [v.institution, v.city].filter(Boolean).join(' · ') || v.address || '';
  return (
    <span className="adm-who-text">
      <span className="adm-who-name" title={v.name}>{v.name}</span>
      {sub && <span className="adm-who-sub" title={sub}>{sub}</span>}
    </span>
  );
}
