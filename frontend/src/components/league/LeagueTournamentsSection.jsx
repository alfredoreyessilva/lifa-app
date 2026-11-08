import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Band, RowMenu, ScoreCell, Scoreboard, SectionError, SectionLoading,
} from '../admin/AdminKit.jsx';
import { IconChevronRight } from '../admin/AdminIcons.jsx';
import { formatNumber, pluralize } from '../../utils/adminPanel.js';
import { branchSummary, leagueTotals } from '../../utils/leaguePanel.js';
import { LeagueEyebrow } from './LeagueWorkspace.jsx';

// Los torneos de la liga, con sus categorías y sus ramas, sin los partidos: una
// rama se abre en su propia vista (`?rama=`). Antes era un acordeón que, abierto,
// eran 210 renglones de ONEFA con un muro de botones cada uno.
//
// Cada renglón lleva un solo control a la vista: la rama se abre, y lo demás
// (agregar adentro, editar, eliminar) va en su menú "⋯".
export default function LeagueTournamentsSection({ league, tree, error, setModal }) {
  const now = useMemo(() => Date.now(), [tree]);
  const totals = tree ? leagueTotals(tree, now) : null;
  const tournaments = tree?.tournaments ?? [];

  return (
    <>
      <Band
        title="Torneos"
        eyebrow={<LeagueEyebrow league={league} />}
        actions={(
          <button type="button" className="btn btn-flag btn-sm" onClick={() => setModal({ type: 'add-tournament' })}>
            + Torneo
          </button>
        )}
      >
        <Scoreboard label="La estructura de la liga">
          <ScoreCell label="Torneos" value={formatNumber(totals?.tournaments)} loading={!totals} />
          <ScoreCell label="Categorías" value={formatNumber(totals?.categories)} loading={!totals} />
          <ScoreCell label="Ramas" value={formatNumber(totals?.branches)} loading={!totals} />
          <ScoreCell
            label="Partidos"
            value={formatNumber(totals?.matches)}
            sub={totals ? `${formatNumber(totals.played)} jugados` : null}
            loading={!totals}
          />
        </Scoreboard>
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[error]} />

        {!tree ? !error && <SectionLoading /> : tournaments.length === 0 ? (
          <div className="adm-no-results">
            <p>
              Esta liga todavía no tiene torneos. Un torneo es una temporada: adentro van sus categorías
              (Juvenil, Mayor…), cada categoría con sus ramas, y cada rama con su calendario.
            </p>
            <button type="button" className="btn btn-flag btn-sm" onClick={() => setModal({ type: 'add-tournament' })}>
              + Torneo
            </button>
          </div>
        ) : (
          <div className="lws-outline">
            {tournaments.map((t) => (
              <Tournament key={t.id} t={t} now={now} setModal={setModal} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Tournament({ t, now, setModal }) {
  return (
    <section className="lws-tourney" aria-label={`${t.name} ${t.year}`}>
      <header className="lws-tourney-head">
        {t.logo_url && <img className="lws-tourney-logo" src={t.logo_url} alt="" loading="lazy" />}
        <h2>
          {t.name}{' '}
          <span className="lws-tourney-year">{t.year}</span>
        </h2>
        <span className="lws-tourney-meta">
          {t.categories.length === 0 ? 'Sin categorías' : pluralize(t.categories.length, 'categoría')}
        </span>
        <RowMenu
          label={`Más acciones de ${t.name}`}
          items={[
            { label: 'Agregar categoría', onSelect: () => setModal({ type: 'add-category', t }) },
            { label: 'Editar torneo', onSelect: () => setModal({ type: 'rename-tournament', t }) },
            { divider: true, key: 'peligro' },
            { label: 'Eliminar torneo', danger: true, onSelect: () => setModal({ type: 'delete-tournament', t }) },
          ]}
        />
      </header>

      {t.categories.length === 0 ? (
        <div className="lws-empty-row">
          <span>Un torneo se divide en categorías: Juvenil, Intermedia, Mayor…</span>
          <button type="button" className="btn btn-ws btn-sm" onClick={() => setModal({ type: 'add-category', t })}>
            + Categoría
          </button>
        </div>
      ) : t.categories.map((c) => (
        <div key={c.id} className={`lws-cat${c.is_placeholder ? ' is-placeholder' : ''}`}>
          <div className="lws-cat-head">
            <h3>{c.name}</h3>
            <span className="lws-cat-meta">
              {c.is_placeholder
                ? 'Lo que el Excel no supo acomodar'
                : c.roster_public ? 'Roster público' : 'Roster privado'}
            </span>
            <RowMenu
              label={`Más acciones de ${c.name}`}
              items={[
                { label: 'Agregar rama', onSelect: () => setModal({ type: 'add-branch', c }) },
                // "Sin clasificar" la crea la plataforma: no se renombra ni se borra a mano.
                !c.is_placeholder && { label: 'Editar categoría', onSelect: () => setModal({ type: 'rename-category', c }) },
                !c.is_placeholder && { divider: true, key: 'peligro' },
                !c.is_placeholder && { label: 'Eliminar categoría', danger: true, onSelect: () => setModal({ type: 'delete-category', c }) },
              ]}
            />
          </div>

          {c.branches.length === 0 ? (
            <div className="lws-empty-row">
              <span>Sin ramas. Una rama es Varonil, Femenil o Mixto, y cada una lleva su calendario.</span>
              <button type="button" className="btn btn-ws btn-sm" onClick={() => setModal({ type: 'add-branch', c })}>
                + Rama
              </button>
            </div>
          ) : c.branches.map((b) => <BranchRow key={b.id} c={c} b={b} now={now} />)}
        </div>
      ))}
    </section>
  );
}

// La rama entera es el enlace: el renglón dice cómo va su temporada sin abrirla.
function BranchRow({ c, b, now }) {
  const s = branchSummary(c, b, now);
  const share = s.matches > 0 ? s.played / s.matches : 0;
  return (
    <Link to={`?seccion=torneos&rama=${b.id}`} className={`lws-branch${b.is_placeholder ? ' is-placeholder' : ''}`}>
      <span className="lws-branch-name">{b.name}</span>
      <span className="lws-branch-facts">
        {pluralize(s.teams, 'equipo')} · {pluralize(s.matches, 'partido')}
      </span>
      <span className="lws-branch-progress" title={`${s.played} de ${s.matches} jugados`}>
        <span className="adm-meter" aria-hidden="true">
          <span style={{ width: `${Math.round(share * 100)}%` }} />
        </span>
        <span className="lws-branch-played">{formatNumber(s.played)} jugados</span>
      </span>
      <span className="lws-branch-flags">
        {s.toCapture > 0 && <span className="lws-flag">{formatNumber(s.toCapture)} por capturar</span>}
        {s.drafts > 0 && <span className="lws-flag">{pluralize(s.drafts, 'borrador', 'borradores')}</span>}
        {s.unassigned > 0 && <span className="lws-flag">{formatNumber(s.unassigned)} sin conferencia</span>}
      </span>
      <span className="lws-branch-go" aria-hidden="true"><IconChevronRight /></span>
    </Link>
  );
}
