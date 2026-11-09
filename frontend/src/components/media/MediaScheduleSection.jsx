import { useMemo, useState } from 'react';
import {
  Band, FilterScoreboard, NoResults, SearchBox, SectionError, SectionLoading, Status, useSectionFilter,
} from '../admin/AdminKit.jsx';
import { countFilters, formatNumber, matchesSearch, pluralize } from '../../utils/adminPanel.js';
import { isMine, matchContext, scheduleDays, scheduleFilters } from '../../utils/mediaPanel.js';
import { sedeDelPartido } from '../../utils/matchDisplay.js';
import { MediaEyebrow } from './MediaWorkspace.jsx';
import { BroadcastLink, GateNote, MatchTime, MediaMatch } from './MediaBits.jsx';

const COLUMNAS = 4;

// Lo que se juega en las ligas públicas, para sumarse desde aquí (README,
// "Sumarse desde el panel"): los próximos 14 días por día, y al final lo que
// todavía no tiene fecha. Cada renglón lleva "Transmitir", o "Transmites" con
// "Editar link" si ya está en el partido. Las celdas filtran por liga.
export default function MediaScheduleSection({ media, schedule, scheduleError, now, gate, setModal }) {
  const filters = useMemo(() => scheduleFilters(schedule), [schedule]);
  const [filter, setFilter] = useSectionFilter(filters, 'todos');
  const [query, setQuery] = useState('');

  const rows = schedule || [];
  const active = filters.find((f) => f.key === filter) ?? filters[0];
  const shown = rows
    .filter(active.test)
    .filter((m) => matchesSearch(query, [m.home_team, m.away_team, matchContext(m), sedeDelPartido(m)]));
  const days = scheduleDays(shown, now);

  return (
    <>
      <Band title="Partidos" eyebrow={<MediaEyebrow media={media} />}>
        <FilterScoreboard
          label="Filtrar partidos por liga"
          filters={countFilters(filters, rows, filter)}
          active={filter}
          onChange={setFilter}
          loading={!schedule}
        />
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[scheduleError]} />
        <GateNote gate={gate} />

        {!schedule ? !scheduleError && <SectionLoading /> : rows.length === 0 ? (
          <div className="adm-no-results">
            <p>
              No hay partidos por jugar en las ligas públicas en los próximos 14 días. Aquí salen en cuanto las
              ligas los publican, también los que todavía no tienen fecha.
            </p>
          </div>
        ) : (
          <>
            <p className="adm-note mws-intro">
              Lo que se juega en las ligas públicas en los próximos 14 días, y lo que todavía no tiene fecha.
              Para un partido más lejano, súmate desde su página.
            </p>
            <div className="adm-toolbar">
              <SearchBox value={query} onChange={setQuery} placeholder="Buscar por equipo, liga o sede" />
            </div>

            {shown.length === 0 ? (
              <NoResults onClear={() => { setQuery(''); setFilter('todos'); }}>
                Ningún partido coincide con lo que buscas.
              </NoResults>
            ) : (
              <div className="adm-table-box">
                <div className="table-wrap">
                  <table className="data-table adm-table mws-table mws-schedule">
                    <caption className="adm-sr-only">Partidos de las ligas públicas</caption>
                    <thead>
                      <tr>
                        <th>Partido</th>
                        <th style={{ width: 110 }}>Hora</th>
                        {/* Su ancho vive en media.css, que la pliega en un lienzo angosto. */}
                        <th className="mws-col-venue">Sede</th>
                        <th className="col-actions" style={{ width: 200 }}><span className="adm-sr-only">Transmitir</span></th>
                      </tr>
                    </thead>
                    {days.map((day) => (
                      <tbody key={day.key}>
                        <tr className="lws-group">
                          <th colSpan={COLUMNAS} scope="colgroup">
                            {day.label}
                            <span className="lws-group-sub">{pluralize(day.rows.length, 'partido')}</span>
                          </th>
                        </tr>
                        {day.rows.map((m) => (
                          <ScheduleRow
                            key={m.match_id}
                            match={m}
                            gate={gate}
                            onJoin={() => setModal({ type: 'link', match: m })}
                            onEdit={() => setModal({
                              type: 'link',
                              match: m,
                              broadcast: { id: m.broadcast_id, url: m.broadcast_url, match_id: m.match_id },
                            })}
                          />
                        ))}
                      </tbody>
                    ))}
                  </table>
                </div>
                <footer className="adm-table-foot">
                  <span>
                    {shown.length === rows.length
                      ? pluralize(rows.length, 'partido')
                      : `${formatNumber(shown.length)} de ${pluralize(rows.length, 'partido')}`}
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

function ScheduleRow({ match: m, gate, onJoin, onEdit }) {
  const sede = sedeDelPartido(m);
  const mine = isMine(m);
  return (
    <tr className={mine ? 'is-mine' : undefined}>
      <td><MediaMatch match={m} /></td>
      <td>
        <MatchTime match={m} />
        {m.stage === 'live' && <Status tone="live">En vivo</Status>}
      </td>
      <td className="mws-col-venue">
        {sede ? <span className="lws-venue" title={sede}>{sede}</span> : <span className="adm-faint">Sin sede</span>}
      </td>
      <td className="col-actions">
        {mine ? (
          <div className="mws-mine">
            <span className="mws-mine-state">
              <Status tone="on" check>Transmites</Status>
              <BroadcastLink broadcast={m} url={m.broadcast_url} quiet={!gate.on} />
            </span>
            <button
              type="button"
              className="btn btn-ws btn-sm"
              disabled={!gate.on}
              title={gate.on ? undefined : gate.sub}
              onClick={onEdit}
              aria-label={`Editar el link de ${m.home_team} contra ${m.away_team}`}
            >
              Editar link
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-flag btn-sm"
            disabled={!gate.on}
            title={gate.on ? undefined : gate.sub}
            onClick={onJoin}
            aria-label={`Transmitir ${m.home_team} contra ${m.away_team}`}
          >
            Transmitir
          </button>
        )}
      </td>
    </tr>
  );
}
