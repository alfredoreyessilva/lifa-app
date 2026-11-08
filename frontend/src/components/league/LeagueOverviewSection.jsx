import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Band, ScoreCell, Scoreboard, SectionError, SectionLoading, Status,
} from '../admin/AdminKit.jsx';
import { IconChevronRight } from '../admin/AdminIcons.jsx';
import { formatNumber, pluralize } from '../../utils/adminPanel.js';
import {
  VISIBILITY, branchName, branchesOf, leagueAttention, leagueTotals, resultsFeed, upcomingFeed, visibilityOf,
} from '../../utils/leaguePanel.js';
import { fechaCorta } from '../../utils/matchDisplay.js';
import { etiquetaDeMiRol, puede, puedeAlguno } from '../../utils/permisos.js';
import { LeagueEyebrow, sectionHref } from './LeagueWorkspace.jsx';
import { MatchState, MatchTeams, MatchWhen, teamLogos } from './LeagueMatchBits.jsx';

// La primera pantalla del panel de una liga contesta, en este orden: qué te toca
// resolver, qué se está jugando o sigue, y qué fue lo último. Es lo que la liga
// abre un sábado: capturar el marcador del partido que acaba de terminar está a
// un clic de aquí.
export default function LeagueOverviewSection({ league, tree, error, setModal }) {
  // useMemo antes de cualquier salida: el visor y el tesorero no traen árbol.
  const now = useMemo(() => Date.now(), [tree]);
  const logos = useMemo(() => teamLogos(tree), [tree]);

  if (!puede(league, 'estructura')) return <RoleOverview league={league} />;

  const totals = tree ? leagueTotals(tree, now) : null;
  const attention = tree ? leagueAttention(tree, now) : [];
  const next = tree ? upcomingFeed(tree, now) : [];
  const results = tree ? resultsFeed(tree, now) : [];
  const visibility = visibilityOf(tree?.league);
  const severalBranches = tree ? branchesOf(tree).length > 1 : false;
  const nextDated = next.find((row) => row.match.state === 'upcoming');

  return (
    <>
      <Band title="Resumen" eyebrow={<LeagueEyebrow league={league} />}>
        <Scoreboard label="La liga en cifras">
          <ScoreCell
            label="Jugados"
            value={formatNumber(totals?.played)}
            sub={totals ? `de ${pluralize(totals.matches, 'partido')}` : null}
            loading={!totals}
          />
          <ScoreCell
            label="Por jugar"
            value={formatNumber((totals?.upcoming ?? 0) + (totals?.live ?? 0))}
            sub={totals?.live ? `${formatNumber(totals.live)} en vivo`
              : nextDated ? `Sigue el ${fechaCorta(nextDated.match.match_date, nextDated.match.timezone)}` : null}
            loading={!totals}
          />
          <ScoreCell
            label="Equipos"
            value={formatNumber(totals?.teams)}
            sub={totals?.handedOver ? `${formatNumber(totals.handedOver)} se administran solos` : null}
            loading={!totals}
          />
          <ScoreCell label="Sedes" value={formatNumber(totals?.venues)} loading={!totals} />
          <ScoreCell
            label="En el sitio"
            small
            value={visibility
              ? <Status tone={VISIBILITY[visibility].tone}>{VISIBILITY[visibility].label}</Status>
              : '—'}
            loading={!totals}
          />
        </Scoreboard>
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[error]} />

        {!tree ? !error && <SectionLoading /> : (
          <>
            {attention.length > 0 && (
              <section className="adm-attention" aria-label="Lo que te toca">
                {attention.map((item) => (
                  <Link key={item.key} to={item.to} className="adm-attention-row is-ask">
                    <span className="adm-status-dot" aria-hidden="true" />
                    <span className="adm-attention-text">
                      {item.text}
                      <span className="lws-attention-where">{item.where}</span>
                    </span>
                    <span className="adm-attention-go">Revisar <IconChevronRight /></span>
                  </Link>
                ))}
              </section>
            )}

            {totals.tournaments === 0 ? (
              <div className="adm-no-results">
                <p>
                  Tu liga todavía no tiene torneos. Empieza por uno: adentro van sus categorías, sus ramas y el
                  calendario de cada rama.
                </p>
                <Link className="btn btn-flag btn-sm" to={sectionHref(league.id, 'torneos')}>Ir a Torneos</Link>
              </div>
            ) : (
              <div className="adm-board lws-board">
                <section className="adm-cell">
                  <h2>En vivo y próximos</h2>
                  <p className="adm-cell-sub">Lo que se está jugando y lo que sigue, de todas tus ramas</p>
                  <Feed
                    rows={next}
                    logos={logos}
                    severalBranches={severalBranches}
                    setModal={setModal}
                    empty="No hay partidos por jugar con fecha."
                  />
                </section>
                <section className="adm-cell">
                  <h2>Últimos resultados</h2>
                  <p className="adm-cell-sub">Los marcadores más recientes</p>
                  <Feed
                    rows={results}
                    logos={logos}
                    severalBranches={severalBranches}
                    setModal={setModal}
                    empty="Todavía no hay marcadores capturados."
                  />
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Feed({ rows, logos, severalBranches, setModal, empty }) {
  if (rows.length === 0) return <p className="lws-feed-empty">{empty}</p>;
  return (
    <ul className="lws-feed">
      {rows.map(({ match, t, c, b }) => (
        <li key={match.id} className="lws-feed-row">
          <span className="lws-feed-when">
            <MatchWhen match={match} />
            {match.state === 'live' && <MatchState match={match} />}
          </span>
          <span className="lws-feed-match">
            <MatchTeams match={match} logos={logos} />
            {severalBranches && <span className="lws-feed-branch">{branchName({ t, c, b })}</span>}
          </span>
          <button
            type="button"
            className="btn btn-ws btn-sm"
            onClick={() => setModal({ type: 'edit-match', t, c, b, match })}
            aria-label={`Editar ${match.home_team} contra ${match.away_team}`}
          >
            Editar
          </button>
        </li>
      ))}
    </ul>
  );
}

// El visor y el tesorero de liga entran aquí y no administran la estructura: el
// servidor les negaría el árbol. Se les dice dónde está lo suyo (README, "Los
// roles"), igual que el resumen corto del coach en el panel de un equipo.
function RoleOverview({ league }) {
  return (
    <>
      <Band title="Resumen" eyebrow={<LeagueEyebrow league={league} />}>
        <Scoreboard label="Tu lugar en la liga">
          <ScoreCell label="Tu rol aquí" small value={etiquetaDeMiRol(league) || '—'} />
        </Scoreboard>
      </Band>
      <div className="adm-canvas">
        <div className="lws-role">
          <h2>Lo tuyo en esta liga</h2>
          {puedeAlguno(league, 'marcadores', 'estadisticas') && (
            <p>
              Está en la página de cada partido: ahí cambias el marcador, el estado, la fecha, la hora, la sede y
              los links con "✎ Editar partido", y anotas las estadísticas en "Estadísticas". Los avisos de "Falta
              capturar un marcador" te llevan directo.
            </p>
          )}
          {puede(league, 'cobranza_liga') && (
            <p>La cobranza de la liga está en <Link to={sectionHref(league.id, 'cobranza')}>Cobranza</Link>.</p>
          )}
          <Link to={`/ligas/${league.slug}`} className="btn btn-ws btn-sm">Ver el calendario de la liga</Link>
        </div>
      </div>
    </>
  );
}
