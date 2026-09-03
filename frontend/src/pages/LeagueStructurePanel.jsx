import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import Modal from '../components/Modal.jsx';
import OrgLogoBar from '../components/OrgLogoBar.jsx';
import TournamentForm from '../components/TournamentForm.jsx';
import CategoryForm from '../components/CategoryForm.jsx';
import TeamForm from '../components/TeamForm.jsx';
import VenueForm from '../components/VenueForm.jsx';
import EditLeagueForm from '../components/EditLeagueForm.jsx';
import MatchForm from '../components/MatchForm.jsx';
import ExcelImport from '../components/ExcelImport.jsx';
import InviteTeamModal from '../components/InviteTeamModal.jsx';
import TeamRosterModal from '../components/TeamRosterModal.jsx';
import BranchRosterModal from '../components/BranchRosterModal.jsx';
import MatchStatsModal from '../components/MatchStatsModal.jsx';
import { getTimezoneLabel } from '../utils/timezones.js';

// Panel unificado de una liga: TODO en una sola página, sin salir a ninguna
// otra pantalla. Acordeón Torneo → Categoría → Rama → (Conferencia) → Grupo
// con los partidos de cada rama, más Equipos y Sedes de la liga. Cada acción
// (crear / editar / borrar en cualquier nivel) se hace con un modal aquí
// mismo y se refresca en el lugar.
//
// Está construido sobre el molde del panel viejo (/panel/liga/:id) pero es
// código nuevo y separado: solo trabaja el modelo de torneos. Lo que quedó
// en el modelo viejo (categorías sin torneo) se avisa arriba con un link a
// la pantalla clásica, nunca se mezcla aquí.
// Ruta: /panel/liga/:id/estructura
export default function LeagueStructurePanel() {
  const { id } = useParams();
  const { token, leagues, refreshLeagues } = useAuth();
  const sidebarLeague = leagues.find((lg) => String(lg.id) === id);

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(() => loadExpanded(id));
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(null);
  const [visibilityBusy, setVisibilityBusy] = useState(false);

  function refresh() {
    return api.getLeagueTree(id, token).then(setData).catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (token) refresh();
  }, [id, token]);

  useEffect(() => {
    saveExpanded(id, expanded);
  }, [id, expanded]);

  const q = query.trim().toLowerCase();
  const isOpen = (key) => (q ? true : !!expanded[key]);
  const toggle = (key) => setExpanded((p) => ({ ...p, [key]: !p[key] }));
  const open = (key) => setExpanded((p) => ({ ...p, [key]: true }));

  const allKeys = useMemo(() => {
    if (!data) return [];
    const keys = ['sec:equipos', 'sec:sedes'];
    for (const t of data.tournaments) {
      keys.push(`t${t.id}`);
      for (const c of t.categories) {
        keys.push(`c${c.id}`);
        for (const b of c.branches) {
          keys.push(`b${b.id}`);
          for (const cf of b.conferences) keys.push(`f${cf.id}`);
        }
      }
    }
    return keys;
  }, [data]);

  function closeAndRefresh() {
    setModal(null);
    return refresh();
  }

  async function setVisibility(fn) {
    setVisibilityBusy(true);
    try { await fn(); await refresh(); }
    catch (e) { setError(e.message); }
    finally { setVisibilityBusy(false); }
  }

  if (!token) {
    return <div className="container"><p>Necesitas iniciar sesión para ver esto.</p></div>;
  }
  if (!sidebarLeague) {
    return <div className="container"><p>No administras ninguna liga con ese id.</p></div>;
  }

  const league = data?.league;
  const teams  = data?.teams  || [];
  const venues = data?.venues || [];
  const leagueTimezone = league?.timezone || 'America/Mexico_City';
  const tournaments = data?.tournaments || [];
  const legacy = data?.legacy || { categories: 0, matches: 0 };

  return (
    <div className="container">
      <OrgLogoBar selectedKind="liga" selectedId={id} />

      <div className="dash-header">
        <div>
          <span className="eyebrow">{sidebarLeague.name}</span>
          <h1>Liga</h1>
          {league?.timezone && (
            <span style={{ fontSize: 11, color: 'var(--ink-dim)', display: 'block', marginTop: 2 }}>
              🕐 {getTimezoneLabel(league.timezone)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to={`/ligas/${league?.slug || ''}`} className="btn btn-outline btn-sm">Ver mi página</Link>
          <button className="btn btn-outline btn-sm" onClick={() => setModal({ type: 'edit-league' })}>Editar liga</button>
          <button className="btn btn-flag btn-sm" onClick={() => setModal({ type: 'add-tournament' })}>+ Torneo</button>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {league && (
        <div
          className="form-error"
          style={{
            background: league.is_public ? 'rgba(58,141,63,0.12)' : 'rgba(255,210,63,0.12)',
            borderColor: league.is_public ? 'var(--field)' : 'var(--flag)',
            color: 'var(--ink)', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
          }}
        >
          <span>
            {league.is_public
              ? '✓ Tu liga es pública — cualquiera puede verla en el sitio.'
              : league.publish_requested
                ? '⏳ Ya solicitaste aparecer en el panel de ligas. Un administrador va a revisarlo.'
                : 'Tu liga es privada por ahora — puedes usar todas las herramientas sin que nadie más la vea.'}
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            {league.is_public && (
              <button className="btn btn-ghost btn-sm" disabled={visibilityBusy}
                onClick={() => setVisibility(() => api.unpublishOwnLeague(id, token))}>
                Ocultar mi liga
              </button>
            )}
            {!league.is_public && !league.publish_requested && (
              <button className="btn btn-flag btn-sm" disabled={visibilityBusy}
                onClick={() => setVisibility(() => api.requestPublishLeague(id, token))}>
                Solicitar aparecer en el panel de ligas
              </button>
            )}
            {!league.is_public && league.publish_requested && (
              <button className="btn btn-ghost btn-sm" disabled={visibilityBusy}
                onClick={() => setVisibility(() => api.cancelPublishRequest(id, token))}>
                Cancelar solicitud
              </button>
            )}
          </span>
        </div>
      )}

      {legacy.matches > 0 && (
        <div className="form-error" style={{ background: 'rgba(255,210,63,0.1)', borderColor: 'var(--flag)', color: 'var(--ink)' }}>
          Tienes <strong>{legacy.matches} partido{legacy.matches === 1 ? '' : 's'}</strong> en el calendario anterior
          (categorías sin torneo). Ese calendario se administra en la pantalla clásica.{' '}
          <Link to={`/panel/liga/${id}`} style={{ color: 'var(--flag)', fontWeight: 700 }}>Abrir pantalla clásica →</Link>
        </div>
      )}

      <div className="tree-toolbar">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar torneo, categoría, rama, grupo, equipo…"
        />
        <button className="btn btn-outline btn-sm" onClick={() => setExpanded(Object.fromEntries(allKeys.map((k) => [k, true])))}>Expandir todo</button>
        <button className="btn btn-outline btn-sm" onClick={() => setExpanded({})}>Colapsar todo</button>
      </div>

      {data === null && <p>Cargando…</p>}

      {data && (
        <div className="tree">
          {/* ── Equipos de la liga ── */}
          <Section
            kind="Equipos"
            name={`Equipos (${teams.length})`}
            open={isOpen('sec:equipos')}
            onToggle={() => toggle('sec:equipos')}
            actions={<button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'add-team' })}>+ Equipo</button>}
          />
          {isOpen('sec:equipos') && (teams.length === 0
            ? <Empty pad={28}>Sin equipos. Agrega el primero.</Empty>
            : teams.map((tm) => (
              <div key={`tm${tm.id}`} className="tree-row" style={{ paddingLeft: 28 }}>
                {tm.logo_url && <img src={tm.logo_url} alt="" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }} />}
                <span className="tree-name">{tm.name}</span>
                <span className="tree-badge">{tm.owner_user_id ? '👤 con representante' : 'sin representante'}</span>
                <span className="tree-spacer" />
                <span className="tree-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'edit-team', team: tm })}>Editar</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'team-roster', team: tm })}>Roster</button>
                  {tm.owner_user_id
                    ? <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'remove-team-owner', team: tm })}>Quitar rep.</button>
                    : <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'invite-team', team: tm })}>Invitar rep.</button>}
                  <IconBtn danger title="Eliminar equipo" onClick={() => setModal({ type: 'delete-team', team: tm })}>🗑</IconBtn>
                </span>
              </div>
            )))}

          {/* ── Sedes de la liga ── */}
          <Section
            kind="Sedes"
            name={`Sedes (${venues.length})`}
            open={isOpen('sec:sedes')}
            onToggle={() => toggle('sec:sedes')}
            actions={<button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'add-venue' })}>+ Sede</button>}
          />
          {isOpen('sec:sedes') && (venues.length === 0
            ? <Empty pad={28}>Sin sedes. Agrega la primera.</Empty>
            : venues.map((v) => (
              <div key={`v${v.id}`} className="tree-row" style={{ paddingLeft: 28 }}>
                <span className="tree-name">{v.name}</span>
                <span className="tree-badge">{v.institution || v.address || 'sin más detalles'}</span>
                <span className="tree-spacer" />
                <span className="tree-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'edit-venue', venue: v })}>Editar</button>
                  <IconBtn danger title="Eliminar sede" onClick={() => setModal({ type: 'delete-venue', venue: v })}>🗑</IconBtn>
                </span>
              </div>
            )))}

          {/* ── Torneos ── */}
          {tournaments.length === 0 && (
            <Empty pad={12}>Esta liga todavía no tiene torneos. Crea el primero con "+ Torneo".</Empty>
          )}

          {tournaments.map((t) => {
            if (!tournamentMatches(t, q)) return null;
            const key = `t${t.id}`;
            const opened = isOpen(key);
            return (
              <div key={key}>
                <div className="tree-row">
                  <Caret open={opened} onClick={() => toggle(key)} />
                  <span className="tree-kind">Torneo</span>
                  <span className="tree-name"><Highlight text={t.name} q={q} /></span>
                  <span className="tree-badge">
                    {t.year} · {t.categories.length === 0 ? 'sin categorías' : `${t.categories.length} categoría${t.categories.length === 1 ? '' : 's'}`}
                  </span>
                  <span className="tree-spacer" />
                  <span className="tree-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => { setModal({ type: 'add-category', t }); open(key); }}>+ categoría</button>
                    <IconBtn title="Renombrar torneo" onClick={() => setModal({ type: 'rename-tournament', t })}>✎</IconBtn>
                    <IconBtn danger title="Eliminar torneo" onClick={() => setModal({ type: 'delete-tournament', t })}>🗑</IconBtn>
                  </span>
                </div>

                {opened && t.categories.map((c) => {
                  if (!categoryMatches(c, q)) return null;
                  const ckey = `c${c.id}`;
                  const copened = isOpen(ckey);
                  return (
                    <div key={ckey}>
                      <div className={`tree-row${c.is_placeholder ? ' is-dim' : ''}`} style={{ paddingLeft: 28 }}>
                        <Caret open={copened} onClick={() => toggle(ckey)} />
                        <span className="tree-kind">Categoría</span>
                        <span className="tree-name"><Highlight text={c.name} q={q} /></span>
                        <span className="tree-badge">
                          {c.branches.length === 0 ? 'sin ramas' : `${c.branches.length} rama${c.branches.length === 1 ? '' : 's'}`}
                        </span>
                        <span className="tree-spacer" />
                        <span className="tree-actions">
                          <button className="btn btn-ghost btn-sm" onClick={() => { setModal({ type: 'add-branch', c }); open(ckey); }}>+ rama</button>
                          {!c.is_placeholder && (
                            <>
                              <IconBtn title="Renombrar categoría" onClick={() => setModal({ type: 'rename-category', c })}>✎</IconBtn>
                              <IconBtn danger title="Eliminar categoría" onClick={() => setModal({ type: 'delete-category', c })}>🗑</IconBtn>
                            </>
                          )}
                        </span>
                      </div>

                      {copened && c.branches.map((b) => (
                        <BranchBlock
                          key={`b${b.id}`}
                          t={t} c={c} b={b} q={q}
                          open={isOpen(`b${b.id}`)}
                          onToggle={() => toggle(`b${b.id}`)}
                          isOpen={isOpen}
                          onToggleKey={toggle}
                          openKey={open}
                          teams={teams}
                          setModal={setModal}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <TreeModal
          modal={modal}
          token={token}
          leagueId={id}
          league={league}
          leagueTimezone={leagueTimezone}
          teams={teams}
          venues={venues}
          onClose={() => setModal(null)}
          onDone={closeAndRefresh}
          onRefresh={refresh}
          onLeagueChanged={() => { refreshLeagues(); refresh(); setModal(null); }}
        />
      )}
    </div>
  );
}

/* ---------- Rama: bloque con su calendario, equipos y estructura ---------- */

function BranchBlock({ t, c, b, q, open, onToggle, isOpen, onToggleKey, openKey, teams, setModal }) {
  if (!branchMatches(b, q)) return null;
  const bkey = `b${b.id}`;
  const enrolledIds = new Set((b.teams || []).map((x) => x.id));
  const availableToEnroll = teams.filter((x) => !enrolledIds.has(x.id));

  return (
    <div>
      <div className={`tree-row${b.is_placeholder ? ' is-dim' : ''}`} style={{ paddingLeft: 56 }}>
        <Caret open={open} onClick={onToggle} />
        <span className="tree-kind">Rama</span>
        <span className="tree-name"><Highlight text={b.name} q={q} /></span>
        <span className="tree-badge">
          {(b.matches || []).length} partido{(b.matches || []).length === 1 ? '' : 's'} · {(b.teams || []).length} equipo{(b.teams || []).length === 1 ? '' : 's'}
        </span>
        <span className="tree-spacer" />
        <span className="tree-actions">
          <button className="btn btn-flag btn-sm" onClick={() => { setModal({ type: 'add-match', t, c, b }); openKey(bkey); }}>+ partido</button>
          <button className="btn btn-outline btn-sm" onClick={() => { setModal({ type: 'import-matches', c, b }); openKey(bkey); }}>📥 Excel</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setModal({ type: 'add-conference', b }); openKey(bkey); }}>+ conf.</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setModal({ type: 'add-branch-group', b }); openKey(bkey); }}>+ grupo</button>
          {!b.is_placeholder && (
            <>
              <IconBtn title="Renombrar rama" onClick={() => setModal({ type: 'rename-branch', b })}>✎</IconBtn>
              <IconBtn danger title="Eliminar rama" onClick={() => setModal({ type: 'delete-branch', b })}>🗑</IconBtn>
            </>
          )}
        </span>
      </div>

      {open && (
        <>
          {/* Estructura interna: conferencias y grupos */}
          {b.conferences.map((cf) => {
            const fkey = `f${cf.id}`;
            const fopen = isOpen(fkey);
            return (
              <div key={fkey}>
                <div className="tree-row" style={{ paddingLeft: 84 }}>
                  <Caret open={fopen} onClick={() => onToggleKey(fkey)} leaf={cf.groups.length === 0} />
                  <span className="tree-kind">Conferencia</span>
                  <span className="tree-name"><Highlight text={cf.name} q={q} /></span>
                  <span className="tree-badge">{cf.groups.length === 0 ? 'sin grupos' : `${cf.groups.length} grupo${cf.groups.length === 1 ? '' : 's'}`}</span>
                  <span className="tree-spacer" />
                  <span className="tree-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => { setModal({ type: 'add-conf-group', cf }); openKey(fkey); }}>+ grupo</button>
                    <IconBtn title="Renombrar conferencia" onClick={() => setModal({ type: 'rename-conference', cf })}>✎</IconBtn>
                    <IconBtn danger title="Eliminar conferencia" onClick={() => setModal({ type: 'delete-conference', cf })}>🗑</IconBtn>
                  </span>
                </div>
                {fopen && cf.groups.map((g) => (
                  <GroupRow key={`g${g.id}`} g={g} q={q} paddingLeft={112}
                    onRename={() => setModal({ type: 'rename-group', g })}
                    onDelete={() => setModal({ type: 'delete-group', g })} />
                ))}
              </div>
            );
          })}
          {b.directGroups.map((g) => (
            <GroupRow key={`g${g.id}`} g={g} q={q} paddingLeft={84}
              onRename={() => setModal({ type: 'rename-group', g })}
              onDelete={() => setModal({ type: 'delete-group', g })} />
          ))}

          {/* Equipos inscritos en la rama */}
          <div className="tree-row" style={{ paddingLeft: 84, alignItems: 'flex-start' }}>
            <span className="tree-caret is-leaf">▸</span>
            <span className="tree-kind">Equipos</span>
            <div style={{ flex: 1 }}>
              {(b.teams || []).length === 0
                ? <span style={{ fontSize: 13, color: 'var(--ink-dim)' }}>Sin equipos inscritos.</span>
                : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {b.teams.map((tm) => (
                      <span key={tm.id} className="tree-chip">
                        {tm.name}
                        <button className="tree-chip-btn" title="Ver roster" onClick={() => setModal({ type: 'branch-roster', b, team: tm })}>roster</button>
                        <button className="tree-chip-btn is-danger" title="Quitar de la rama" onClick={() => setModal({ type: 'unenroll-team', b, team: tm })}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
              {availableToEnroll.length > 0 && (
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) setModal({ type: 'enroll-team', b, teamId: e.target.value }); }}
                  style={{ marginTop: 8, background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '6px 10px', borderRadius: 4, fontSize: 13 }}
                >
                  <option value="">+ Inscribir equipo…</option>
                  {availableToEnroll.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
                </select>
              )}
            </div>
          </div>

          {/* Calendario */}
          <BranchMatches t={t} c={c} b={b} setModal={setModal} />
        </>
      )}
    </div>
  );
}

function BranchMatches({ t, c, b, setModal }) {
  const matches = b.matches || [];
  const groupName = (gid) => {
    if (!gid) return null;
    for (const cf of b.conferences) {
      const g = cf.groups.find((x) => x.id === gid);
      if (g) return `${cf.name} — ${g.name}`;
    }
    const dg = b.directGroups.find((x) => x.id === gid);
    return dg ? dg.name : null;
  };

  if (matches.length === 0) {
    return <Empty pad={84}>Sin partidos. Agrégalos con "+ partido" o "📥 Excel".</Empty>;
  }

  return matches.map((m) => (
    <div key={`m${m.id}`} className="tree-row" style={{ paddingLeft: 84 }}>
      <span className="tree-caret is-leaf">▸</span>
      <span className="tree-name" style={{ whiteSpace: 'normal' }}>
        {m.home_team} <span style={{ color: 'var(--ink-dim)' }}>vs</span> {m.away_team}
        {m.is_draft && <span className="tree-badge" style={{ marginLeft: 6, color: 'var(--flag)' }}>borrador</span>}
      </span>
      <span className="tree-badge">
        {fmtDate(m.match_date, m.timezone)}
        {m.week_label ? ` · ${/^\d+$/.test(m.week_label) ? 'J' + m.week_label : m.week_label}` : ''}
        {groupName(m.group_id) ? ` · ${groupName(m.group_id)}` : ''}
        {m.status === 'live' ? ' · EN VIVO' : m.status === 'finished' ? ' · final' : ''}
      </span>
      <span className="tree-spacer" />
      <span className="tree-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'edit-match', t, c, b, match: m })}>Editar</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'match-stats', match: m })}>Stats</button>
        <IconBtn danger title="Eliminar partido" onClick={() => setModal({ type: 'delete-match', match: m })}>🗑</IconBtn>
      </span>
    </div>
  ));
}

/* ---------- piezas de UI ---------- */

function Section({ kind, name, open, onToggle, actions }) {
  return (
    <div className="tree-row">
      <Caret open={open} onClick={onToggle} />
      <span className="tree-kind">{kind}</span>
      <span className="tree-name">{name}</span>
      <span className="tree-spacer" />
      <span className="tree-actions">{actions}</span>
    </div>
  );
}

function Caret({ open, onClick, leaf }) {
  if (leaf) return <span className="tree-caret is-leaf">▸</span>;
  return (
    <button type="button" className={`tree-caret${open ? ' is-open' : ''}`} onClick={onClick} aria-label={open ? 'Colapsar' : 'Expandir'}>▸</button>
  );
}

function IconBtn({ children, onClick, title, danger }) {
  return (
    <button type="button" className={`tree-icon-btn${danger ? ' is-danger' : ''}`} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

function Empty({ children, pad = 12 }) {
  return <div className="tree-row" style={{ paddingLeft: pad }}><span style={{ fontSize: 13, color: 'var(--ink-dim)' }}>{children}</span></div>;
}

function GroupRow({ g, q, paddingLeft, onRename, onDelete }) {
  return (
    <div className="tree-row" style={{ paddingLeft }}>
      <span className="tree-caret is-leaf">▸</span>
      <span className="tree-kind">Grupo</span>
      <span className="tree-name"><Highlight text={g.name} q={q} /></span>
      <span className="tree-spacer" />
      <span className="tree-actions">
        <IconBtn title="Renombrar grupo" onClick={onRename}>✎</IconBtn>
        <IconBtn danger title="Eliminar grupo" onClick={onDelete}>🗑</IconBtn>
      </span>
    </div>
  );
}

function Highlight({ text, q }) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q);
  if (i === -1) return text;
  return (<>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>);
}

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
function fmtDate(iso, tz) {
  if (!iso) return 'sin fecha';
  const d = new Date(iso);
  const zone = tz || 'America/Mexico_City';
  const day = d.toLocaleString('es-MX', { timeZone: zone, day: 'numeric' });
  const mi = Number(d.toLocaleString('en-US', { timeZone: zone, month: 'numeric' })) - 1;
  const time = d.toLocaleTimeString('es-MX', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
  return `${day} ${MESES[mi]} ${time}`;
}

/* ---------- filtros de búsqueda ---------- */

function groupMatches(g, q) { return !q || g.name.toLowerCase().includes(q); }
function conferenceMatches(cf, q) { return !q || cf.name.toLowerCase().includes(q) || cf.groups.some((g) => groupMatches(g, q)); }
function branchMatches(b, q) {
  return !q
    || b.name.toLowerCase().includes(q)
    || b.conferences.some((cf) => conferenceMatches(cf, q))
    || b.directGroups.some((g) => groupMatches(g, q))
    || (b.teams || []).some((tm) => tm.name.toLowerCase().includes(q))
    || (b.matches || []).some((m) => `${m.home_team} ${m.away_team}`.toLowerCase().includes(q));
}
function categoryMatches(c, q) { return !q || c.name.toLowerCase().includes(q) || c.branches.some((b) => branchMatches(b, q)); }
function tournamentMatches(t, q) {
  return !q || t.name.toLowerCase().includes(q) || String(t.year).includes(q) || t.categories.some((c) => categoryMatches(c, q));
}

/* ---------- expandido persistido por liga ---------- */

const skey = (leagueId) => `lifa:tree-expanded:${leagueId}`;
function loadExpanded(leagueId) {
  try { const raw = localStorage.getItem(skey(leagueId)); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}
function saveExpanded(leagueId, expanded) {
  try { localStorage.setItem(skey(leagueId), JSON.stringify(expanded)); } catch { /* ignore */ }
}

/* ---------- modales ---------- */

function TreeModal({ modal, token, leagueId, league, leagueTimezone, teams, venues, onClose, onDone, onRefresh, onLeagueChanged }) {
  const { type } = modal;

  // Liga
  if (type === 'edit-league') {
    return (
      <Modal title="Editar liga" onClose={onClose}>
        <EditLeagueForm
          league={league || { id: Number(leagueId) }}
          onCancel={onClose}
          onSubmit={async (payload) => { await api.updateLeague(leagueId, payload, token); onLeagueChanged(); }}
        />
      </Modal>
    );
  }

  // Equipos de la liga
  if (type === 'add-team') {
    return (
      <Modal title="Nuevo equipo" onClose={onClose}>
        <TeamForm submitLabel="Crear equipo" onCancel={onClose}
          onSubmit={async (payload) => { await api.createTeam(leagueId, payload, token); onDone(); }} />
      </Modal>
    );
  }
  if (type === 'edit-team') {
    return (
      <Modal title="Editar equipo" onClose={onClose}>
        <TeamForm initial={modal.team} submitLabel="Guardar cambios" onCancel={onClose}
          onSubmit={async (payload) => { await api.updateTeam(modal.team.id, payload, token); onDone(); }} />
      </Modal>
    );
  }
  if (type === 'delete-team') {
    return (
      <ConfirmModal title={`Eliminar equipo "${modal.team.name}"`}
        body="El equipo y sus datos se eliminan. Los partidos donde aparezca por nombre no se borran, pero pierden el vínculo al equipo."
        confirmLabel="Eliminar equipo" onClose={onClose}
        onConfirm={async () => { await api.deleteTeam(modal.team.id, token); onDone(); }} />
    );
  }
  if (type === 'remove-team-owner') {
    return (
      <ConfirmModal title="Quitar representante"
        body={`La persona que administra ${modal.team.name} deja de tener acceso. El equipo y sus datos se quedan igual.`}
        confirmLabel="Quitar representante" onClose={onClose}
        onConfirm={async () => { await api.removeTeamOwner(modal.team.id, token); onDone(); }} />
    );
  }
  if (type === 'invite-team') {
    return <InviteTeamModal team={modal.team} token={token} onClose={onClose} onDone={onDone} />;
  }
  if (type === 'team-roster') {
    return <TeamRosterModal team={modal.team} token={token} onClose={onClose} />;
  }

  // Sedes
  if (type === 'add-venue') {
    return (
      <Modal title="Nueva sede" onClose={onClose}>
        <VenueForm submitLabel="Crear sede" onCancel={onClose}
          onSubmit={async (payload) => { await api.createVenue(leagueId, payload, token); onDone(); }} />
      </Modal>
    );
  }
  if (type === 'edit-venue') {
    return (
      <Modal title="Editar sede" onClose={onClose}>
        <VenueForm initial={modal.venue} submitLabel="Guardar cambios" onCancel={onClose}
          onSubmit={async (payload) => { await api.updateVenue(modal.venue.id, payload, token); onDone(); }} />
      </Modal>
    );
  }
  if (type === 'delete-venue') {
    return (
      <ConfirmModal title={`Eliminar sede "${modal.venue.name}"`}
        body="Los partidos que la usen se quedan sin sede, no se eliminan."
        confirmLabel="Eliminar sede" onClose={onClose}
        onConfirm={async () => { await api.deleteVenue(modal.venue.id, token); onDone(); }} />
    );
  }

  // Torneos
  if (type === 'add-tournament') {
    return (
      <Modal title="Nuevo torneo" onClose={onClose}>
        <TournamentForm submitLabel="Crear torneo" onCancel={onClose}
          onSubmit={async (data) => { await api.createTournament(leagueId, data, token); onDone(); }} />
      </Modal>
    );
  }
  if (type === 'rename-tournament') {
    return (
      <Modal title={`Editar torneo — ${modal.t.name}`} onClose={onClose}>
        <TournamentForm initial={modal.t} submitLabel="Guardar cambios" onCancel={onClose}
          onSubmit={async (data) => { await api.updateTournament(modal.t.id, data, token); onDone(); }} />
      </Modal>
    );
  }
  if (type === 'delete-tournament') {
    return (
      <TypeNameConfirmModal title={`Eliminar torneo "${modal.t.name}"`}
        body={`Esto borra el torneo ${modal.t.name} (${modal.t.year}) y, con él, todas sus categorías, ramas, conferencias, grupos y partidos — para siempre.`}
        name={modal.t.name} confirmLabel="Eliminar torneo para siempre" onClose={onClose}
        onConfirm={async () => { await api.deleteTournament(modal.t.id, token); onDone(); }} />
    );
  }

  // Categorías
  if (type === 'add-category') {
    return (
      <Modal title={`Nueva categoría — ${modal.t.name}`} onClose={onClose}>
        <CategoryForm submitLabel="Crear categoría" onCancel={onClose}
          onSubmit={async (data) => { await api.createCategoryForTournament(modal.t.id, data, token); onDone(); }} />
      </Modal>
    );
  }
  if (type === 'rename-category') {
    return (
      <Modal title={`Editar categoría — ${modal.c.name}`} onClose={onClose}>
        <CategoryForm initial={modal.c} submitLabel="Guardar cambios" onCancel={onClose}
          onSubmit={async (data) => { await api.updateCategory(modal.c.id, data, token); onDone(); }} />
      </Modal>
    );
  }
  if (type === 'delete-category') {
    return (
      <ConfirmModal title={`Eliminar categoría "${modal.c.name}"`}
        body="Esto borra la categoría y, con ella, todas sus ramas, conferencias, grupos y partidos. No se puede deshacer."
        confirmLabel="Eliminar categoría" onClose={onClose}
        onConfirm={async () => { await api.deleteCategory(modal.c.id, token); onDone(); }} />
    );
  }

  // Ramas
  if (type === 'add-branch') {
    return <BranchAddModal onClose={onClose}
      onSubmit={async (name) => { await api.createBranch(modal.c.id, { name }, token); onDone(); }} />;
  }
  if (type === 'rename-branch') {
    return <PromptModal title={`Renombrar rama — ${modal.b.name}`} label="Nombre de la rama" initial={modal.b.name}
      submitLabel="Guardar" onClose={onClose}
      onSubmit={async (name) => { await api.updateBranch(modal.b.id, { name }, token); onDone(); }} />;
  }
  if (type === 'delete-branch') {
    return (
      <TypeNameConfirmModal title={`Eliminar rama "${modal.b.name}"`}
        body="Esto borra la rama y, con ella, todas sus conferencias, grupos y partidos — para siempre."
        name={modal.b.name} confirmLabel="Eliminar rama para siempre" onClose={onClose}
        onConfirm={async () => { await api.deleteBranch(modal.b.id, token); onDone(); }} />
    );
  }

  // Conferencias
  if (type === 'add-conference') {
    return <PromptModal title={`Nueva conferencia — ${modal.b.name}`} label="Nombre de la conferencia"
      placeholder="Ej. Conferencia Norte" submitLabel="Agregar" onClose={onClose}
      onSubmit={async (name) => { await api.createConference(modal.b.id, { name }, token); onDone(); }} />;
  }
  if (type === 'rename-conference') {
    return <PromptModal title={`Renombrar conferencia — ${modal.cf.name}`} label="Nombre de la conferencia"
      initial={modal.cf.name} submitLabel="Guardar" onClose={onClose}
      onSubmit={async (name) => { await api.updateConference(modal.cf.id, { name }, token); onDone(); }} />;
  }
  if (type === 'delete-conference') {
    return (
      <ConfirmModal title={`Eliminar conferencia "${modal.cf.name}"`}
        body="Esto borra la conferencia y sus grupos. Los partidos que apunten a ella quedan sin conferencia, no se eliminan."
        confirmLabel="Eliminar conferencia" onClose={onClose}
        onConfirm={async () => { await api.deleteConference(modal.cf.id, token); onDone(); }} />
    );
  }

  // Grupos
  if (type === 'add-branch-group') {
    return <PromptModal title={`Nuevo grupo — ${modal.b.name}`} label="Nombre del grupo" placeholder="Ej. Grupo A"
      submitLabel="Agregar" onClose={onClose}
      onSubmit={async (name) => { await api.createBranchGroup(modal.b.id, { name }, token); onDone(); }} />;
  }
  if (type === 'add-conf-group') {
    return <PromptModal title={`Nuevo grupo — ${modal.cf.name}`} label="Nombre del grupo" placeholder="Ej. Grupo A"
      submitLabel="Agregar" onClose={onClose}
      onSubmit={async (name) => { await api.createTestGroup(modal.cf.id, { name }, token); onDone(); }} />;
  }
  if (type === 'rename-group') {
    return <PromptModal title={`Renombrar grupo — ${modal.g.name}`} label="Nombre del grupo" initial={modal.g.name}
      submitLabel="Guardar" onClose={onClose}
      onSubmit={async (name) => { await api.updateGroup(modal.g.id, { name }, token); onDone(); }} />;
  }
  if (type === 'delete-group') {
    return (
      <ConfirmModal title={`Eliminar grupo "${modal.g.name}"`}
        body="Los partidos que tengan este grupo asignado se quedan sin grupo, no se eliminan."
        confirmLabel="Eliminar grupo" onClose={onClose}
        onConfirm={async () => { await api.deleteGroup(modal.g.id, token); onDone(); }} />
    );
  }

  // Equipos de la rama
  if (type === 'enroll-team') {
    return (
      <ConfirmModal title="Inscribir equipo a la rama"
        body="El equipo queda inscrito en esta rama y puedes capturarle su roster."
        confirmLabel="Inscribir" onClose={onClose}
        onConfirm={async () => { await api.enrollTeamInBranch(modal.b.id, modal.teamId, token); onDone(); }} />
    );
  }
  if (type === 'unenroll-team') {
    return (
      <ConfirmModal title={`Quitar "${modal.team.name}" de la rama`}
        body="El equipo deja de estar inscrito en esta rama. Su roster de esta rama se elimina; sus partidos no."
        confirmLabel="Quitar de la rama" onClose={onClose}
        onConfirm={async () => { await api.removeTeamFromBranch(modal.b.id, modal.team.id, token); onDone(); }} />
    );
  }
  if (type === 'branch-roster') {
    return <BranchRosterModal branchId={modal.b.id} team={modal.team} token={token} onClose={onClose} />;
  }

  // Partidos
  if (type === 'add-match' || type === 'edit-match') {
    const isEdit = type === 'edit-match';
    return (
      <Modal title={isEdit ? 'Editar partido' : `Nuevo partido — ${modal.b.name}`} onClose={onClose}>
        <MatchForm
          initial={isEdit ? modal.match : undefined}
          submitLabel={isEdit ? 'Guardar cambios' : 'Crear partido'}
          teams={teams}
          venues={venues}
          groups={[]}
          conferences={modal.b.conferences}
          leagueTimezone={leagueTimezone}
          token={token}
          leagueId={leagueId}
          categoryId={modal.c.id}
          onVenueCreated={onRefresh}
          onTeamCreated={onRefresh}
          onGroupCreated={onRefresh}
          onCancel={onClose}
          onSubmit={async (payload) => {
            if (isEdit) await api.updateMatch(modal.match.id, { ...payload, branch_id: modal.b.id }, token);
            else await api.createMatch(modal.c.id, { ...payload, branch_id: modal.b.id }, token);
            onDone();
          }}
        />
      </Modal>
    );
  }
  if (type === 'delete-match') {
    return (
      <ConfirmModal title="Eliminar partido"
        body={`¿Eliminar ${modal.match.home_team} vs ${modal.match.away_team}?`}
        confirmLabel="Eliminar partido" onClose={onClose}
        onConfirm={async () => { await api.deleteMatch(modal.match.id, token); onDone(); }} />
    );
  }
  if (type === 'match-stats') {
    return <MatchStatsModal match={modal.match} token={token} onClose={onClose} />;
  }
  if (type === 'import-matches') {
    const branchGroups = [
      ...modal.b.directGroups,
      ...modal.b.conferences.flatMap((cf) => cf.groups),
    ];
    return (
      <Modal title={`Subir calendario — ${modal.c.name} / ${modal.b.name}`} onClose={onClose}>
        <ExcelImport
          categoryId={modal.c.id}
          branchId={modal.b.id}
          categoryName={`${modal.c.name}_${modal.b.name}`}
          teams={teams}
          venues={venues}
          groups={branchGroups}
          onCancel={onClose}
          onDone={onDone}
        />
      </Modal>
    );
  }

  return null;
}

function PromptModal({ title, label, placeholder, initial, submitLabel, onClose, onSubmit }) {
  const [value, setValue] = useState(initial || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true); setError('');
    try { await onSubmit(value.trim()); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label>{label}</label>
          <input type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} autoFocus />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-flag" disabled={busy || !value.trim()}>{busy ? 'Guardando…' : submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

const BRANCH_OPTIONS = ['Varonil', 'Femenil', 'Mixto'];
function BranchAddModal({ onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create(value) {
    if (!value.trim()) return;
    setBusy(true); setError('');
    try { await onSubmit(value.trim()); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Modal title="Nueva rama" onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label>Rama</label>
        <div className="pill-group">
          {BRANCH_OPTIONS.map((b) => (
            <button key={b} type="button" className="pill-btn" disabled={busy} onClick={() => create(b)}>+ {b}</button>
          ))}
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); create(name); }}>
        <div className="field">
          <label>…o un nombre distinto</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Juvenil A" />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-flag" disabled={busy || !name.trim()}>{busy ? 'Guardando…' : 'Agregar rama'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmModal({ title, body, confirmLabel, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true); setError('');
    try { await onConfirm(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Modal title={title} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      <p style={{ color: 'var(--ink-dim)', fontSize: 14 }}>{body}</p>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={go}>{busy ? 'Aplicando…' : confirmLabel}</button>
      </div>
    </Modal>
  );
}

function TypeNameConfirmModal({ title, body, name, confirmLabel, onClose, onConfirm }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true); setError('');
    try { await onConfirm(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Modal title={title} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      <p style={{ color: 'var(--ink-dim)', fontSize: 14, marginBottom: 16 }}>{body}</p>
      <div className="field">
        <label>Escribe <strong>{name}</strong> para confirmar</label>
        <input type="text" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-danger" disabled={busy || value !== name} onClick={go}>
          {busy ? 'Eliminando…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
