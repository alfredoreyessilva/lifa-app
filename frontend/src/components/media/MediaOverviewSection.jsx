import { Link } from 'react-router-dom';
import {
  Band, ScoreCell, Scoreboard, SectionError, SectionLoading, Status,
} from '../admin/AdminKit.jsx';
import { IconChevronRight } from '../admin/AdminIcons.jsx';
import { formatNumber } from '../../utils/adminPanel.js';
import {
  broadcastTotals, comingFigure, hasLink, lastBroadcasts, mediaAttention, mediaHref, nextBroadcasts, upcomingToJoin,
} from '../../utils/mediaPanel.js';
import { MatchWhen } from '../league/LeagueMatchBits.jsx';
import { MediaEyebrow } from './MediaWorkspace.jsx';
import { BroadcastLink, GateNote, MediaMatch } from './MediaBits.jsx';

// La primera pantalla del panel de un medio contesta, en este orden: qué te toca
// resolver, qué vas a transmitir y qué se juega pronto que todavía no
// transmites. Es lo que abre un medio el jueves para armar su fin de semana.
export default function MediaOverviewSection({
  media, org, broadcasts, schedule, gate, orgError, broadcastsError, scheduleError, setModal,
}) {
  const totals = broadcasts ? broadcastTotals(broadcasts) : null;
  const coming = comingFigure(totals);
  const ready = Boolean(org && broadcasts);

  return (
    <>
      <Band
        title="Resumen"
        eyebrow={<MediaEyebrow media={media} />}
        actions={gate.on && (
          <Link to={mediaHref(media.id, 'partidos')} className="btn btn-flag btn-sm">+ Transmitir un partido</Link>
        )}
      >
        <Scoreboard label="El medio en cifras">
          <ScoreCell label="Próximas" value={coming.value} sub={coming.sub} loading={!totals} />
          <ScoreCell
            label="Sin link"
            value={formatNumber(totals?.noLink)}
            attention={gate.on && totals?.noLink > 0}
            loading={!totals}
          />
          <ScoreCell label="Transmitidas" value={formatNumber(totals?.past)} loading={!totals} />
          <ScoreCell
            label="Para transmitir"
            small
            value={<Status tone={gate.tone}>{gate.label}</Status>}
            sub={gate.on ? null : gate.sub}
          />
        </Scoreboard>
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[orgError, broadcastsError]} />

        {!ready ? !(orgError || broadcastsError) && <SectionLoading /> : (
          <>
            <Attention items={mediaAttention(org, broadcasts)} />
            <GateNote gate={gate} />

            <div className="adm-board lws-board">
              <section className="adm-cell">
                <h2>Tus próximas transmisiones</h2>
                <p className="adm-cell-sub">Lo que vas a transmitir, de lo más cercano a lo más lejano</p>
                <Coming broadcasts={broadcasts} totals={totals} media={media} gate={gate} setModal={setModal} />
              </section>

              <section className="adm-cell">
                <h2>Se juega pronto</h2>
                <p className="adm-cell-sub">Lo que viene en las ligas públicas y todavía no transmites</p>
                <Soon media={media} schedule={schedule} error={scheduleError} gate={gate} setModal={setModal} />
              </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Attention({ items }) {
  if (items.length === 0) return null;
  return (
    <section className="adm-attention" aria-label="Lo que te toca">
      {items.map((item) => (
        <Link key={item.key} to={item.to} className="adm-attention-row is-ask">
          <span className="adm-status-dot" aria-hidden="true" />
          <span className="adm-attention-text">
            {item.text}
            {item.where && <span className="lws-attention-where">{item.where}</span>}
          </span>
          <span className="adm-attention-go">Revisar <IconChevronRight /></span>
        </Link>
      ))}
    </section>
  );
}

// Lo que viene y, si no hay nada, lo último que transmitió: es casi toda la
// semana de un medio, y una columna vacía no decía nada de él.
function Coming({ broadcasts, totals, media, gate, setModal }) {
  const rows = nextBroadcasts(broadcasts, 5);
  const last = rows.length === 0 ? lastBroadcasts(broadcasts, 3) : [];
  const toAll = totals.total > 0 && (
    <Link to={mediaHref(media.id, 'transmisiones')} className="mws-more">
      {totals.total === 1 ? 'Ver tu transmisión' : `Ver tus ${formatNumber(totals.total)} transmisiones`}
      <IconChevronRight />
    </Link>
  );

  if (rows.length === 0) {
    return (
      <>
        <p className="lws-feed-empty">
          No tienes transmisiones por venir.
          {gate.on && <> <Link to={mediaHref(media.id, 'partidos')}>Súmate a un partido</Link>.</>}
        </p>
        {last.length > 0 && (
          <>
            <h3 className="mws-subhead">Lo último que transmitiste</h3>
            <BroadcastFeed rows={last} gate={gate} setModal={setModal} />
          </>
        )}
        {toAll}
      </>
    );
  }
  return (
    <>
      <BroadcastFeed rows={rows} gate={gate} setModal={setModal} />
      {toAll}
    </>
  );
}

// El link va debajo del partido y no a su lado: en media columna, con el link y
// el botón a la derecha, los nombres se cortaban en "BORREGOS…".
function BroadcastFeed({ rows, gate, setModal }) {
  return (
    <ul className="lws-feed mws-feed">
      {rows.map((b) => (
        <li key={b.id} className="lws-feed-row">
          <span className="lws-feed-when">
            <MatchWhen match={b} />
            {b.stage === 'live' && <Status tone="live">En vivo</Status>}
          </span>
          <span className="lws-feed-match">
            <MediaMatch match={b} />
            <span className="mws-feed-link"><BroadcastLink broadcast={b} quiet={!gate.on} /></span>
          </span>
          <button
            type="button"
            className="btn btn-ws btn-sm"
            disabled={!gate.on}
            title={gate.on ? undefined : gate.sub}
            onClick={() => setModal({ type: 'link', match: b, broadcast: b })}
            aria-label={`Editar el link de ${b.home_team} contra ${b.away_team}`}
          >
            {hasLink(b) ? 'Editar link' : 'Poner link'}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Soon({ media, schedule, error, gate, setModal }) {
  if (error) return <p className="lws-feed-empty">{error}</p>;
  if (!schedule) return <p className="lws-feed-empty">Cargando…</p>;
  const rows = upcomingToJoin(schedule, 5);
  if (rows.length === 0) {
    return (
      <p className="lws-feed-empty">
        {schedule.length === 0
          ? 'No hay partidos por jugar en las ligas públicas en los próximos 14 días.'
          : 'Ya transmites todo lo que se juega en los próximos 14 días.'}
      </p>
    );
  }
  return (
    <>
      <ul className="lws-feed mws-feed">
        {rows.map((m) => (
          <li key={m.match_id} className="lws-feed-row">
            <span className="lws-feed-when">
              <MatchWhen match={m} />
              {m.stage === 'live' && <Status tone="live">En vivo</Status>}
            </span>
            <span className="lws-feed-match">
              <MediaMatch match={m} />
            </span>
            <button
              type="button"
              className="btn btn-flag btn-sm"
              disabled={!gate.on}
              title={gate.on ? undefined : gate.sub}
              onClick={() => setModal({ type: 'link', match: m })}
              aria-label={`Transmitir ${m.home_team} contra ${m.away_team}`}
            >
              Transmitir
            </button>
          </li>
        ))}
      </ul>
      <Link to={mediaHref(media.id, 'partidos')} className="mws-more">
        {schedule.length === 1 ? 'Ver el partido' : `Ver los ${formatNumber(schedule.length)} partidos`}
        <IconChevronRight />
      </Link>
    </>
  );
}
