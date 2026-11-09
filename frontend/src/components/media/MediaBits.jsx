import { Status } from '../admin/AdminKit.jsx';
import { IconExternal } from '../admin/AdminIcons.jsx';
import { MatchTeams } from '../league/LeagueMatchBits.jsx';
import { getMatchParts, plataformaDe } from '../../utils/matchDisplay.js';
import { hasLink, matchContext } from '../../utils/mediaPanel.js';

// Cómo se escribe un partido en el panel de un medio: los dos escudos uno sobre
// otro, como en el calendario de una rama, y debajo de dónde es (liga, torneo y
// ronda), porque un medio ve partidos de varias ligas a la vez.
export function MediaMatch({ match }) {
  const context = matchContext(match);
  return (
    <>
      <MatchTeams match={match} />
      {context && <span className="lws-match-scope" title={context}>{context}</span>}
    </>
  );
}

// La hora sola, en la zona del partido: el día ya lo dice el tramo de arriba.
export function MatchTime({ match }) {
  if (!match.match_date) return <span className="lws-when is-tbd">Por definir</span>;
  const { time, tzLabel } = getMatchParts(match.match_date, match.timezone || match.league_timezone);
  return (
    <span className="lws-when">
      <span>{time}</span>
      <span className="lws-when-time">{tzLabel}</span>
    </span>
  );
}

// El link de una transmisión por su plataforma: "YouTube", "Facebook" o el
// dominio, como el botón "Ver partido en…" de la página del partido. Sin link,
// en amarillo solo si el partido viene y el medio puede ponérselo (`quiet` cuando
// no puede transmitir): a uno ya jugado ya no le urge.
export function BroadcastLink({ broadcast, url = broadcast?.url, quiet = false }) {
  if (!hasLink({ url })) {
    const ask = !quiet && broadcast?.stage !== 'past';
    return <Status tone={ask ? 'ask' : 'off'}>Sin link</Status>;
  }
  return (
    <a className="mws-link" href={url.trim()} target="_blank" rel="noopener noreferrer" title={url}>
      {plataformaDe(url.trim())}
      <IconExternal />
    </a>
  );
}

// Por qué todavía no puede sumarse a un partido. Sin botón: publicarlo y
// verificarlo lo decide CFBAMX (README, "Organizaciones: publicar y verificar").
//
// En Transmisiones dice lo otro que pasa, y que el backend ya resuelve al leer:
// un medio al que le quitaron la verificación, o que ocultaron, deja de salir en
// "También transmiten" de sus partidos, y POST /broadcasts le contesta 403 también
// para cambiar un link. Sus filas siguen ahí y vuelven solas.
export function GateNote({ gate, broadcasts = false }) {
  if (gate.on) return null;
  return (
    <div className="mws-gate" role="note">
      <Status tone="off">Todavía no puedes transmitir</Status>
      {broadcasts ? (
        <p>
          {gate.sub}. Mientras tanto, tu logo no sale en «También transmiten» de estos partidos y sus links no
          se pueden cambiar. Vuelven solos en cuanto CFBAMX te publique y te verifique.
        </p>
      ) : (
        <p>
          {gate.sub}. Para sumarse a un partido, un medio tiene que estar publicado y verificado: así su logo en
          la página del partido dice quién es de verdad. Mientras, puedes ver lo que se juega.
        </p>
      )}
    </div>
  );
}
