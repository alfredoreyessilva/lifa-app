import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Band, FilterScoreboard, NoResults, RowMenu, SearchBox, SectionError, SectionLoading, useSectionFilter,
} from '../admin/AdminKit.jsx';
import { countFilters, formatNumber, matchesSearch, pluralize } from '../../utils/adminPanel.js';
import {
  BROADCAST_FILTERS, broadcastGroups, hasLink, lacksLink, matchContext, mediaHref,
} from '../../utils/mediaPanel.js';
import { MatchWhen } from '../league/LeagueMatchBits.jsx';
import { MediaEyebrow } from './MediaWorkspace.jsx';
import { BroadcastLink, GateNote, MediaMatch } from './MediaBits.jsx';

const COLUMNAS = 4;

// Lo que el medio transmite: cada partido donde está, con su link. Es lo que el
// público ve de él en "También transmiten" (README, "Transmisiones"). Las celdas
// del marcador filtran la tabla, como en /admin.
export default function MediaBroadcastsSection({ media, broadcasts, broadcastsError, gate, setModal }) {
  // Sin poder transmitir, "Sin link" se cuenta pero no va en amarillo: no está en su
  // mano ponerlo (utils/mediaPanel.js, `pendingLinks`).
  const filters = gate.on ? BROADCAST_FILTERS : BROADCAST_FILTERS.map((f) => ({ ...f, attention: false }));
  const [filter, setFilter] = useSectionFilter(filters, 'todas');
  const [query, setQuery] = useState('');

  const rows = broadcasts || [];
  const active = filters.find((f) => f.key === filter);
  const shown = useMemo(() => rows
    .filter(active.test)
    .filter((b) => matchesSearch(query, [b.home_team, b.away_team, matchContext(b), b.venue_name || b.venue])),
  [rows, active, query]);
  const groups = broadcastGroups(shown);

  return (
    <>
      <Band
        title="Transmisiones"
        eyebrow={<MediaEyebrow media={media} />}
        actions={gate.on && (
          <Link to={mediaHref(media.id, 'partidos')} className="btn btn-flag btn-sm">+ Transmitir un partido</Link>
        )}
      >
        <FilterScoreboard
          label="Filtrar transmisiones"
          filters={countFilters(filters, rows, filter)}
          active={filter}
          onChange={setFilter}
          loading={!broadcasts}
        />
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[broadcastsError]} />

        {!broadcasts ? !broadcastsError && <SectionLoading /> : rows.length === 0 ? (
          <div className="adm-no-results">
            <p>
              Todavía no transmites ningún partido. Cuando te sumes a uno, tu logo sale en «También transmiten»
              en la página del partido, y abre tu transmisión si le pones el link.
            </p>
            {gate.on && (
              <Link to={mediaHref(media.id, 'partidos')} className="btn btn-flag btn-sm">Ver lo que se juega</Link>
            )}
          </div>
        ) : (
          <>
            <GateNote gate={gate} broadcasts />
            <div className="adm-toolbar">
              <SearchBox value={query} onChange={setQuery} placeholder="Buscar por equipo, liga o sede" />
            </div>

            {shown.length === 0 ? (
              <NoResults onClear={() => { setQuery(''); setFilter('todas'); }}>
                {filter === 'sin-link' && !query
                  ? 'Todas tus transmisiones por venir ya tienen link.'
                  : 'Ninguna transmisión coincide con lo que buscas.'}
              </NoResults>
            ) : (
              <div className="adm-table-box">
                <div className="table-wrap">
                  <table className="data-table adm-table mws-table">
                    <caption className="adm-sr-only">Tus transmisiones</caption>
                    <thead>
                      <tr>
                        <th>Partido</th>
                        <th style={{ width: 120 }}>Fecha</th>
                        <th style={{ width: 150 }}>Link</th>
                        <th className="col-actions" style={{ width: 150 }}><span className="adm-sr-only">Acciones</span></th>
                      </tr>
                    </thead>
                    {groups.map((g) => (
                      <tbody key={g.key}>
                        <tr className="lws-group">
                          <th colSpan={COLUMNAS} scope="colgroup">
                            {g.label}
                            <span className="lws-group-sub">{pluralize(g.rows.length, 'partido')}</span>
                          </th>
                        </tr>
                        {g.rows.map((b) => (
                          <BroadcastRow
                            key={b.id}
                            broadcast={b}
                            gate={gate}
                            onEdit={() => setModal({ type: 'link', match: b, broadcast: b })}
                            onRemove={() => setModal({ type: 'remove', broadcast: b })}
                          />
                        ))}
                      </tbody>
                    ))}
                  </table>
                </div>
                <footer className="adm-table-foot">
                  <span>
                    {shown.length === rows.length
                      ? pluralize(rows.length, 'transmisión', 'transmisiones')
                      : `${formatNumber(shown.length)} de ${pluralize(rows.length, 'transmisión', 'transmisiones')}`}
                  </span>
                </footer>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

// Una fila, un botón: "Editar link" a la vista, y lo demás en "⋯", con dejar de
// transmitir al final y en rojo. Lo que viene sin link lleva el filo amarillo.
// Sin poder transmitir, el link no se cambia (el backend contesta 403), pero
// dejar de transmitir sí: para quitarse solo hace falta administrar el medio.
function BroadcastRow({ broadcast: b, gate, onEdit, onRemove }) {
  return (
    <tr className={lacksLink(b) && gate.on ? 'is-attention' : undefined}>
      <td><MediaMatch match={b} /></td>
      <td><MatchWhen match={b} /></td>
      <td><BroadcastLink broadcast={b} quiet={!gate.on} /></td>
      <td className="col-actions">
        <div className="adm-row-actions">
          <button
            type="button"
            className="btn btn-ws btn-sm"
            onClick={onEdit}
            disabled={!gate.on}
            title={gate.on ? undefined : gate.sub}
          >
            {hasLink(b) ? 'Editar link' : 'Poner link'}
          </button>
          <RowMenu
            label={`Más acciones de ${b.home_team} contra ${b.away_team}`}
            items={[
              { label: 'Ver la página del partido', href: `/partidos/${b.match_id}` },
              hasLink(b) && { label: 'Abrir tu transmisión', href: b.url.trim() },
              { divider: true, key: 'peligro' },
              { label: 'Dejar de transmitir', danger: true, onSelect: onRemove },
            ]}
          />
        </div>
      </td>
    </tr>
  );
}
