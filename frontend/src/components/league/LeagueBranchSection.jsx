import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Band, FilterScoreboard, Identity, NoResults, RowMenu, SearchBox, SectionError, SectionLoading,
} from '../admin/AdminKit.jsx';
import { countFilters, formatNumber, matchesSearch, pluralize } from '../../utils/adminPanel.js';
import {
  CALENDAR_FILTERS, branchCalendar, branchPath, findBranch, groupTeamsByScope, hasScopeOptions, matchSearch,
  needsCapture,
} from '../../utils/leaguePanel.js';
import { groupByJornada, jornadaDateRange } from '../../utils/matchDisplay.js';
import { matchScopeLabel } from '../../utils/matchScope.js';
import { LeagueEyebrow } from './LeagueWorkspace.jsx';
import { MatchState, MatchTeams, MatchWhen, teamLogos } from './LeagueMatchBits.jsx';

const VISTAS = [
  { key: 'calendario', label: 'Calendario' },
  { key: 'equipos',    label: 'Equipos' },
  { key: 'estructura', label: 'Conferencias y grupos' },
];

// Una rama abierta: su calendario, sus equipos y cómo se divide. El marcador de
// arriba es el de su temporada y cada celda filtra el calendario, como en el
// Panel Admin: el número de "Por capturar" y el filtro "Por capturar" son un solo
// control.
export default function LeagueBranchSection({ league, tree, error, setModal, branchId }) {
  const [params, setParams] = useSearchParams();
  const now = useMemo(() => Date.now(), [tree]);
  const logos = useMemo(() => teamLogos(tree), [tree]);
  const entry = useMemo(() => (tree ? findBranch(tree, branchId) : null), [tree, branchId]);
  const calendar = useMemo(() => (entry ? branchCalendar(entry.c, entry.b, now) : []), [entry, now]);

  const rawFilter = params.get('filtro');
  const filter = CALENDAR_FILTERS.some((f) => f.key === rawFilter) ? rawFilter : 'todos';
  const rawView = params.get('vista');
  const view = VISTAS.some((v) => v.key === rawView) ? rawView : 'calendario';

  // Una celda del marcador siempre lleva al calendario, aunque se apriete desde
  // Equipos: lo que cuenta son partidos.
  function setFilter(key) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('vista');
      if (key === 'todos') next.delete('filtro');
      else next.set('filtro', key);
      return next;
    }, { replace: true });
  }

  const back = <Link to="?seccion=torneos" className="lws-crumb">Torneos</Link>;

  if (!tree || !entry) {
    return (
      <>
        <Band title={tree ? 'Rama' : 'Cargando…'} eyebrow={<LeagueEyebrow league={league}>{back}</LeagueEyebrow>} />
        <div className="adm-canvas">
          <SectionError messages={[error]} />
          {!tree ? !error && <SectionLoading /> : (
            <NoResults>
              Esa rama ya no existe. <Link to="?seccion=torneos">Ve tus torneos</Link>.
            </NoResults>
          )}
        </div>
      </>
    );
  }

  const { t, c, b } = entry;
  const filters = countFilters(CALENDAR_FILTERS, calendar, filter);

  return (
    <>
      <Band
        title={b.name}
        eyebrow={<LeagueEyebrow league={league}>{back}<span aria-hidden="true"> / </span>{branchPath(entry)}</LeagueEyebrow>}
        actions={(
          <>
            <button type="button" className="btn btn-flag btn-sm" onClick={() => setModal({ type: 'add-match', t, c, b })}>
              + Partido
            </button>
            <button type="button" className="btn btn-ws btn-sm" onClick={() => setModal({ type: 'import-matches', c, b })}>
              Subir Excel
            </button>
            <button
              type="button"
              className="btn btn-ws btn-sm"
              title="Fases, tabla de posiciones y campeones"
              onClick={() => setModal({ type: 'competition-model', b })}
            >
              Competencia
            </button>
            {/* "Sin clasificar" la crea la plataforma: no se renombra ni se borra a mano. */}
            {!b.is_placeholder && (
              <RowMenu
                label={`Más acciones de ${b.name}`}
                items={[
                  { label: 'Renombrar rama', onSelect: () => setModal({ type: 'rename-branch', b }) },
                  { divider: true, key: 'peligro' },
                  { label: 'Eliminar rama', danger: true, onSelect: () => setModal({ type: 'delete-branch', b }) },
                ]}
              />
            )}
          </>
        )}
      >
        <FilterScoreboard
          label="Filtrar el calendario"
          filters={filters}
          active={view === 'calendario' ? filter : null}
          onChange={setFilter}
        />
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[error]} />

        <nav className="lws-tabs" aria-label={`Secciones de ${b.name}`}>
          {VISTAS.map((v) => {
            const count = v.key === 'calendario' ? calendar.length
              : v.key === 'equipos' ? (b.teams || []).length
                : b.conferences.length + b.directGroups.length;
            const to = new URLSearchParams(params);
            if (v.key === 'calendario') to.delete('vista'); else to.set('vista', v.key);
            return (
              <Link
                key={v.key}
                to={`?${to.toString()}`}
                className="lws-tab"
                aria-current={v.key === view ? 'page' : undefined}
              >
                {v.label}
                <span className="lws-tab-count">{formatNumber(count)}</span>
              </Link>
            );
          })}
        </nav>

        {view === 'calendario' && (
          <BranchCalendar
            entry={entry}
            calendar={calendar}
            filter={filter}
            onClearFilter={() => setFilter('todos')}
            logos={logos}
            venues={tree.venues || []}
            setModal={setModal}
          />
        )}
        {view === 'equipos' && <BranchTeams entry={entry} teams={tree.teams || []} logos={logos} setModal={setModal} />}
        {view === 'estructura' && <BranchStructure b={b} setModal={setModal} />}
      </div>
    </>
  );
}

/* ---------- Calendario ---------- */

function BranchCalendar({ entry, calendar, filter, onClearFilter, logos, venues, setModal }) {
  const { t, c, b } = entry;
  const [query, setQuery] = useState('');
  const venueNames = useMemo(() => new Map(venues.map((v) => [v.id, v.name])), [venues]);
  const venueOf = (m) => m.venue || venueNames.get(m.venue_id) || '';

  const active = CALENDAR_FILTERS.find((f) => f.key === filter);
  const rows = calendar
    .filter(active.test)
    .filter((m) => matchSearch(query, m, [venueOf(m), matchScopeLabel(m)]));
  // En tramos de jornada, en el orden del calendario público: un partido
  // reprogramado forma su propio tramo y la jornada puede salir dos veces, que
  // es cierto.
  const groups = groupByJornada(rows);
  const conJornada = rows.some((m) => m.week_label);

  if (calendar.length === 0) {
    return (
      <div className="adm-no-results">
        <p>
          Esta rama todavía no tiene partidos. Agrégalos uno por uno con "+ Partido", o súbelos todos de un
          jalón con la plantilla de Excel.
        </p>
        <button type="button" className="btn btn-flag btn-sm" onClick={() => setModal({ type: 'add-match', t, c, b })}>
          + Partido
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="adm-toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Buscar por equipo, jornada o sede" />
      </div>

      {rows.length === 0 ? (
        <NoResults onClear={() => { setQuery(''); onClearFilter(); }}>
          Ningún partido coincide con lo que buscas.
        </NoResults>
      ) : (
        <div className="adm-table-box">
          <div className="table-wrap">
            <table className="data-table adm-table lws-cal">
              <caption className="adm-sr-only">Calendario de {b.name}</caption>
              <thead>
                <tr>
                  <th>Partido</th>
                  <th style={{ width: 120 }}>Fecha</th>
                  {/* Su ancho vive en league.css, que la pliega en un lienzo angosto. */}
                  <th className="lws-col-venue">Sede</th>
                  <th style={{ width: 150 }}>Estado</th>
                  <th className="col-actions" style={{ width: 120 }}><span className="adm-sr-only">Acciones</span></th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.key}>
                  {conJornada && (
                    <tr className="lws-group">
                      <th colSpan={5} scope="colgroup">
                        {g.label}
                        <span className="lws-group-sub">{jornadaDateRange(g.matches)}</span>
                      </th>
                    </tr>
                  )}
                  {g.matches.map((m) => (
                    <MatchRow
                      key={m.id}
                      match={m}
                      venue={venueOf(m)}
                      logos={logos}
                      onEdit={() => setModal({ type: 'edit-match', t, c, b, match: m })}
                      onStats={() => setModal({ type: 'match-stats', match: m })}
                      onDelete={() => setModal({ type: 'delete-match', match: m })}
                    />
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          <footer className="adm-table-foot">
            <span>
              {rows.length === calendar.length
                ? pluralize(rows.length, 'partido')
                : `${formatNumber(rows.length)} de ${pluralize(calendar.length, 'partido')}`}
            </span>
          </footer>
        </div>
      )}
    </>
  );
}

function MatchRow({ match: m, venue, logos, onEdit, onStats, onDelete }) {
  // La conferencia sale de sus equipos (regla 4); "a mano" es la excepción que
  // alguien guardó aparte.
  const scope = matchScopeLabel(m);
  return (
    <tr className={needsCapture(m) ? 'is-attention' : undefined}>
      <td>
        <MatchTeams match={m} logos={logos} />
        {scope && (
          <span className="lws-match-scope">
            {scope}{m.conference_is_override ? ' · conferencia a mano' : ''}
          </span>
        )}
      </td>
      <td><MatchWhen match={m} /></td>
      <td className="lws-col-venue">
        {venue ? <span className="lws-venue" title={venue}>{venue}</span> : <span className="adm-faint">Sin sede</span>}
      </td>
      <td><MatchState match={m} /></td>
      <td className="col-actions">
        <div className="adm-row-actions">
          <button type="button" className="btn btn-ws btn-sm" onClick={onEdit}>Editar</button>
          <RowMenu
            label={`Más acciones de ${m.home_team} contra ${m.away_team}`}
            items={[
              { label: 'Ver la página del partido', href: `/partidos/${m.id}` },
              { label: 'Estadísticas', onSelect: onStats },
              { divider: true, key: 'peligro' },
              { label: 'Eliminar partido', danger: true, onSelect: onDelete },
            ]}
          />
        </div>
      </td>
    </tr>
  );
}

/* ---------- Equipos de la rama ---------- */

// El reparto por conferencia es el que dice a qué conferencia pertenece cada
// partido: se declara aquí una vez por equipo, y ya no se vuelve a elegir en cada
// juego.
function BranchTeams({ entry, teams, logos, setModal }) {
  const { b } = entry;
  const [query, setQuery] = useState('');
  const enrolled = new Set((b.teams || []).map((x) => x.id));
  const available = teams.filter((x) => !enrolled.has(x.id));
  const divides = hasScopeOptions(b);
  const groups = groupTeamsByScope(b)
    .map((g) => ({ ...g, teams: g.teams.filter((tm) => matchesSearch(query, [tm.name, g.label])) }))
    .filter((g) => g.teams.length > 0);

  return (
    <>
      <div className="adm-toolbar lws-toolbar">
        {(b.teams || []).length > 0 && (
          <SearchBox value={query} onChange={setQuery} placeholder="Buscar equipo" />
        )}
        {available.length > 0 && (
          <select
            className="lws-select"
            value=""
            aria-label="Inscribir un equipo de la liga en esta rama"
            onChange={(e) => { if (e.target.value) setModal({ type: 'enroll-team', b, teamId: e.target.value }); }}
          >
            <option value="">+ Inscribir equipo…</option>
            {available.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
          </select>
        )}
      </div>

      {(b.teams || []).length === 0 ? (
        <div className="adm-no-results">
          <p>
            {teams.length === 0
              ? 'Tu liga todavía no tiene equipos. Agrégalos en Equipos y luego inscríbelos aquí.'
              : 'Ningún equipo está inscrito en esta rama. Inscríbelos con "+ Inscribir equipo…": solo los inscritos tienen roster y conferencia aquí.'}
          </p>
        </div>
      ) : groups.length === 0 ? (
        <NoResults onClear={() => setQuery('')}>Ningún equipo coincide con lo que buscas.</NoResults>
      ) : (
        <div className="adm-table-box">
          <div className="table-wrap">
            <table className="data-table adm-table lws-teams">
              <caption className="adm-sr-only">Equipos inscritos en {b.name}</caption>
              <thead>
                <tr>
                  <th>Equipo</th>
                  <th className="col-actions" style={{ width: 132 }}><span className="adm-sr-only">Acciones</span></th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.key}>
                  {divides && (
                    <tr className={`lws-group${g.missing ? ' is-attention' : ''}`}>
                      <th colSpan={2} scope="colgroup">
                        {g.label}
                        <span className="lws-group-sub">{pluralize(g.teams.length, 'equipo')}</span>
                      </th>
                    </tr>
                  )}
                  {g.teams.map((tm) => (
                    <tr key={tm.id}>
                      <td><Identity name={tm.name} logo={logos.get(tm.id) || tm.logo_url} round /></td>
                      <td className="col-actions">
                        <div className="adm-row-actions">
                          <button
                            type="button"
                            className="btn btn-ws btn-sm"
                            onClick={() => setModal({ type: 'branch-roster', b, team: tm })}
                          >
                            Roster
                          </button>
                          <RowMenu
                            label={`Más acciones de ${tm.name}`}
                            items={[
                              divides && {
                                label: g.missing ? 'Asignar conferencia' : 'Cambiar de conferencia',
                                onSelect: () => setModal({ type: 'team-scope', b, team: tm }),
                              },
                              divides && { divider: true, key: 'peligro' },
                              { label: 'Quitar de la rama', danger: true, onSelect: () => setModal({ type: 'unenroll-team', b, team: tm }) },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Conferencias y grupos ---------- */

function BranchStructure({ b, setModal }) {
  const teamsIn = (test) => (b.teams || []).filter(test).length;
  const empty = b.conferences.length === 0 && b.directGroups.length === 0;

  return (
    <>
      <div className="adm-toolbar lws-toolbar">
        <button type="button" className="btn btn-ws btn-sm" onClick={() => setModal({ type: 'add-conference', b })}>
          + Conferencia
        </button>
        <button type="button" className="btn btn-ws btn-sm" onClick={() => setModal({ type: 'add-branch-group', b })}>
          + Grupo
        </button>
      </div>

      {empty ? (
        <div className="adm-no-results">
          <p>
            Esta rama no se divide: juegan todos contra todos. Si tu liga se parte en conferencias o grupos,
            agrégalos aquí y luego dile a cada equipo el suyo en Equipos.
          </p>
        </div>
      ) : (
        <div className="adm-table-box">
          <div className="table-wrap">
            <table className="data-table adm-table lws-struct">
              <caption className="adm-sr-only">Conferencias y grupos de {b.name}</caption>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th style={{ width: 140 }}>Equipos</th>
                  <th className="col-actions" style={{ width: 56 }}><span className="adm-sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {b.conferences.map((cf) => [
                  <tr key={`c${cf.id}`}>
                    <td>
                      <span className="lws-struct-name">{cf.name}</span>
                      <span className="lws-struct-kind">
                        Conferencia{cf.groups.length > 0 ? ` · ${pluralize(cf.groups.length, 'grupo')}` : ''}
                      </span>
                    </td>
                    <td className="adm-num">{pluralize(teamsIn((tm) => tm.conference_id === cf.id), 'equipo')}</td>
                    <td className="col-actions">
                      <RowMenu
                        label={`Más acciones de ${cf.name}`}
                        items={[
                          { label: 'Agregar grupo', onSelect: () => setModal({ type: 'add-conf-group', cf }) },
                          { label: 'Renombrar conferencia', onSelect: () => setModal({ type: 'rename-conference', cf }) },
                          { divider: true, key: 'peligro' },
                          { label: 'Eliminar conferencia', danger: true, onSelect: () => setModal({ type: 'delete-conference', cf }) },
                        ]}
                      />
                    </td>
                  </tr>,
                  ...cf.groups.map((g) => (
                    <GroupRow key={`g${g.id}`} g={g} nested count={teamsIn((tm) => tm.group_id === g.id)} setModal={setModal} />
                  )),
                ])}
                {b.directGroups.map((g) => (
                  <GroupRow key={`g${g.id}`} g={g} count={teamsIn((tm) => tm.group_id === g.id)} setModal={setModal} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="adm-note">
        La conferencia se dice una vez por equipo, en Equipos, y de ahí la toman todos sus partidos. Si la cambias,
        su calendario se reacomoda solo.
      </p>
    </>
  );
}

function GroupRow({ g, nested, count, setModal }) {
  return (
    <tr className={nested ? 'is-nested' : undefined}>
      <td>
        <span className="lws-struct-name">{g.name}</span>
        <span className="lws-struct-kind">Grupo</span>
      </td>
      <td className="adm-num">{pluralize(count, 'equipo')}</td>
      <td className="col-actions">
        <RowMenu
          label={`Más acciones de ${g.name}`}
          items={[
            { label: 'Renombrar grupo', onSelect: () => setModal({ type: 'rename-group', g }) },
            { divider: true, key: 'peligro' },
            { label: 'Eliminar grupo', danger: true, onSelect: () => setModal({ type: 'delete-group', g }) },
          ]}
        />
      </td>
    </tr>
  );
}
