import { Link } from 'react-router-dom';
import BracketImageButton from './BracketImageButton.jsx';
import { initials } from '../utils/matchDisplay.js';
import {
  mirrorColumns, roundShortName, gameStatus, seedOrigin, recordOf, bracketTitle,
  hasTiedSeeds, isSingleTable, seedOf, finalLabel, logoForSide,
} from '../utils/bracketFormat.js';

// El bracket de los playoffs de una conferencia (README, "El bracket de los
// playoffs"). Todo viene resuelto de GET /leagues/branches/:id/bracket —quién
// es cada sembrado, cómo se cruzan, quién ganó—; aquí solo se pinta.
//
// Se pinta dos veces y el CSS enseña una: en la computadora, en espejo como la
// imagen de guía (la mitad del 1 a la izquierda, la del 2 a la derecha y la
// final al centro); en el teléfono, ronda por ronda, porque siete columnas con
// nombres no caben en 360 px.
//
// `shareImage` enciende "Generar imagen" ({ league, tournament, year, context, leagueLogo });
// la vista previa del panel no lo pasa. `note` es lo que el panel dice de un
// bracket que todavía no se publica.
export default function BracketView({ bracket, shareImage = null, note = null }) {
  if (!bracket) return null;
  const cols = mirrorColumns(bracket);
  const title = bracketTitle(bracket);
  const single = isSingleTable(bracket);
  const ctx = { bracket, single };

  return (
    <section className="bracket">
      <div className="bracket-head">
        <div className="bracket-head-text">
          <div className="bracket-eyebrow">Playoffs</div>
          {title && <h3 className="bracket-title">{title}</h3>}
        </div>
        {shareImage && (
          <div className="bracket-head-action">
            <BracketImageButton bracket={bracket} header={shareImage} />
          </div>
        )}
      </div>

      {note && <p className="bracket-note">{note}</p>}

      {/* ── Computadora: en espejo ── */}
      <div
        className="bracket-tree"
        style={{ gridTemplateColumns: `repeat(${cols.left.length + 1}, minmax(0, 1fr)) minmax(0, 1.35fr) repeat(${cols.left.length + 1}, minmax(0, 1fr))` }}
      >
        {cols.left.map((col) => (
          <RoundColumn key={`l-${col.r}`} col={col} ctx={ctx} side="left" />
        ))}
        {cols.final && <FinalSide participant={cols.final.left} game={cols.final.game} ctx={ctx} side="left" />}
        {cols.final && <Center final={cols.final} champion={bracket.champion} />}
        {cols.final && <FinalSide participant={cols.final.right} game={cols.final.game} ctx={ctx} side="right" />}
        {[...cols.right].reverse().map((col) => (
          <RoundColumn key={`r-${col.r}`} col={col} ctx={ctx} side="right" />
        ))}
      </div>

      {/* ── Teléfono: una ronda debajo de otra ── */}
      <div className="bracket-list">
        {bracket.rounds.map((round, r) => (
          <div key={round.name + r} className="bracket-list-round">
            <h4 className="bracket-list-round-name">{round.name}</h4>
            {round.games.every((g) => !g.top && !g.bottom) ? (
              <PendingRound previous={bracket.rounds[r - 1]} />
            ) : (
              round.games.map((g, i) => <ListGame key={i} game={g} ctx={ctx} />)
            )}
          </div>
        ))}
        {bracket.champion && (
          <div className="bracket-list-champion">
            <span className="bracket-list-champion-label">🏆 Campeón</span>
            <TeamLogo participant={bracket.champion} size={28} />
            <strong>{bracket.champion.name}</strong>
          </div>
        )}
      </div>

      <p className="bracket-legend">
        El mejor sembrado es local. Después de cada ronda se reacomodan: el mejor sembrado que sigue vivo recibe al peor.
        {hasTiedSeeds(bracket) && ' * Siembra que no separó ningún criterio: el orden lo define la liga.'}
      </p>
    </section>
  );
}

// ── El espejo ────────────────────────────────────────────────────────────

function RoundColumn({ col, ctx, side }) {
  return (
    <div className="bracket-col">
      <div className="bracket-col-head">{roundShortName(col.round.name)}</div>
      <div className="bracket-col-body">
        {col.games.map((g, i) => (
          <div key={i} className="bracket-game">
            <TreeTeam participant={g.top} game={g} ctx={ctx} side={side} />
            <GameLine game={g} />
            <TreeTeam participant={g.bottom} game={g} ctx={ctx} side={side} placeholder={g.bye ? 'Descansa' : null} />
          </div>
        ))}
      </div>
    </div>
  );
}

function FinalSide({ participant, game, ctx, side }) {
  return (
    <div className="bracket-col">
      <div className="bracket-col-head">Final</div>
      <div className="bracket-col-body">
        <div className="bracket-game bracket-game--single">
          <TreeTeam participant={participant} game={game} ctx={ctx} side={side} />
        </div>
      </div>
    </div>
  );
}

function Center({ final, champion }) {
  const status = gameStatus(final.game);
  return (
    <div className="bracket-col bracket-center">
      <div className="bracket-col-head">&nbsp;</div>
      <div className="bracket-col-body bracket-center-body">
        <div className="bracket-trophy" aria-hidden="true">🏆</div>
        <div className="bracket-center-label">Campeón</div>
        {champion ? (
          <div className="bracket-champion">
            <TeamLogo participant={champion} size={56} />
            <div className="bracket-champion-name">{champion.name}</div>
          </div>
        ) : (
          <div className="bracket-champion bracket-champion--tbd">Por definir</div>
        )}
        <div className={`bracket-center-status bracket-status--${status.kind}`}>
          {final.game?.match
            ? <Link to={`/partidos/${final.game.match.id}`}>{finalLabel(status, { link: true })}</Link>
            : finalLabel(status)}
        </div>
      </div>
    </div>
  );
}

function teamState(participant, game) {
  if (!participant || !game?.winner_team_id) return '';
  return participant.team_id === game.winner_team_id ? 'is-winner' : 'is-loser';
}

function TreeTeam({ participant, game, ctx, side, placeholder = null }) {
  if (!participant) {
    return <div className="bracket-team is-tbd">{placeholder || '?'}</div>;
  }
  const seed = seedOf(ctx.bracket, participant);
  const origen = seedOrigin(seed, { singleTable: ctx.single });
  return (
    <div className={`bracket-team ${teamState(participant, game)}`} title={[participant.name, origen, recordOf(seed)].filter(Boolean).join(' · ')}>
      <span className="bracket-seed">{participant.seed ?? '–'}{seed?.tied ? '*' : ''}</span>
      {participant.score !== null && participant.score !== undefined && (
        <span className="bracket-score">{participant.score}</span>
      )}
      <TeamLogo participant={participant} size={44} side={side} />
      <span className="bracket-team-name">{participant.name}</span>
    </div>
  );
}

// La línea entre los dos equipos de un cruce: "vs", su fecha, "En vivo" o
// "Final". Si el partido ya está capturado, liga a su página.
function GameLine({ game }) {
  const status = gameStatus(game);
  if (status.kind === 'bye') return <div className="bracket-line bracket-status--bye">&nbsp;</div>;
  const texto = status.kind === 'unscheduled' || status.kind === 'pending' ? 'vs' : status.label;
  return (
    <div className={`bracket-line bracket-status--${status.kind}`}>
      {game.match ? <Link to={`/partidos/${game.match.id}`}>{texto}</Link> : texto}
    </div>
  );
}

// ── Ronda por ronda ──────────────────────────────────────────────────────

function ListGame({ game, ctx }) {
  const status = gameStatus(game);
  return (
    <div className="bracket-list-game">
      <ListTeam participant={game.top} game={game} ctx={ctx} />
      <ListTeam participant={game.bottom} game={game} ctx={ctx} placeholder={game.bye ? 'Descansa: pasa directo' : 'Por definir'} />
      <div className={`bracket-list-status bracket-status--${status.kind}`}>
        {game.match ? (
          <Link to={`/partidos/${game.match.id}`}>{status.kind === 'unscheduled' ? 'Ver partido' : status.label} →</Link>
        ) : (
          // Se sabe quién juega, pero la liga todavía no lo pone en el
          // calendario: para la afición, la fecha es lo que falta.
          status.kind === 'unscheduled' ? 'Fecha por confirmar' : status.label
        )}
      </div>
    </div>
  );
}

function ListTeam({ participant, game, ctx, placeholder = 'Por definir' }) {
  if (!participant) return <div className="bracket-list-team is-tbd">{placeholder}</div>;
  const seed = seedOf(ctx.bracket, participant);
  const origen = seedOrigin(seed, { singleTable: ctx.single });
  return (
    <div className={`bracket-list-team ${teamState(participant, game)}`}>
      <span className="bracket-seed">{participant.seed ?? '–'}{seed?.tied ? '*' : ''}</span>
      <TeamLogo participant={participant} size={28} />
      <span className="bracket-list-team-text">
        <span className="bracket-list-team-name">{participant.name}</span>
        {(origen || seed) && (
          <span className="bracket-list-team-meta">{[recordOf(seed), origen].filter(Boolean).join(' · ')}</span>
        )}
      </span>
      {participant.score !== null && participant.score !== undefined && (
        <span className="bracket-score">{participant.score}</span>
      )}
    </div>
  );
}

// Una ronda que todavía no se arma: se reacomoda hasta que termina la anterior.
function PendingRound({ previous }) {
  const ya = previous?.advanced || [];
  return (
    <div className="bracket-list-pending">
      <p>Se arma cuando termine la ronda anterior{previous ? ` (${previous.name})` : ''}: el mejor sembrado que siga vivo recibe al peor.</p>
      {ya.length > 0 && (
        <p className="bracket-list-pending-ya">Ya avanzaron: {ya.map((p) => p.name).join(', ')}.</p>
      )}
    </div>
  );
}

// `side` solo lo pasa el espejo: el lado derecho lleva el logo de visitante.
function TeamLogo({ participant, size, side = null }) {
  const src = logoForSide(participant, side);
  if (src) {
    return <img src={src} alt="" className="bracket-logo" style={{ width: size, height: size }} loading="lazy" />;
  }
  return (
    <span className="bracket-logo bracket-logo--initials" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      {initials(participant?.name || '')}
    </span>
  );
}
