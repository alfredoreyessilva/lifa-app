// Qué va de cada lado del bracket en espejo y cómo se escribe cada cruce.
// Funciones PURAS, sin DOM: las usan la página (BracketView.jsx) y la imagen
// (bracketShareCard.js), para que las dos digan exactamente lo mismo, y por eso
// se pueden probar con node --test.
//
// Nada de esto decide quién avanza: la siembra, el reacomodo y los ganadores
// ya vienen resueltos del backend (utils/bracket.js). README, "El bracket de
// los playoffs".

import { getMatchParts } from './matchDisplay.js';
import { getMatchStatus } from './matchStatus.js';
import { scopeLabel } from './standingsFormat.js';

/**
 * El bracket en espejo, como la imagen de guía: de cada ronda antes de la
 * final, la mitad de arriba va a la izquierda (la del 1) y la de abajo a la
 * derecha (la del 2); la final, al centro.
 *
 * Cada finalista se pinta del lado de donde viene: el backend le pone a cada
 * uno de qué cruce de la ronda anterior salió (`from_game`). Arriba/abajo en la
 * final es el local, que con el reacomodo puede venir de cualquier lado.
 */
export function mirrorColumns(bracket) {
  const rounds = bracket?.rounds || [];
  const last = rounds.length - 1;
  const left = [];
  const right = [];
  rounds.slice(0, Math.max(last, 0)).forEach((round, r) => {
    const half = round.games.length / 2;
    left.push({ round, r, games: round.games.slice(0, half) });
    right.push({ round, r, games: round.games.slice(half) });
  });

  const finalRound = rounds[last];
  const game = finalRound?.games?.[0] || null;
  let a = game?.top || null;
  let b = game?.bottom || null;
  if (last > 0) {
    const half = rounds[last - 1].games.length / 2;
    const ladoDe = (p) => (p && p.from_game !== undefined && p.from_game !== null ? (p.from_game < half ? 'left' : 'right') : null);
    if (ladoDe(a) === 'right' || ladoDe(b) === 'left') [a, b] = [b, a];
  }
  return { left, right, final: finalRound ? { round: finalRound, game, left: a, right: b } : null };
}

// El escudo de un equipo según el lado del espejo donde se pinta. Un escudo
// casi siempre es un casco que mira a la derecha: del lado derecho le daría la
// espalda al centro. Ahí va el de visitante —que el equipo sube mirando al otro
// lado, justo para eso—, y sin él, el de siempre. El campeón y la lista del
// teléfono no tienen lado: van con el de siempre.
export function logoForSide(participant, side) {
  if (!participant) return null;
  if (side === 'right' && participant.away_logo_url) return participant.away_logo_url;
  return participant.logo_url || null;
}

// Cómo se dice una ronda en la cabeza de su columna, como en la imagen de
// guía ("CUARTOS", "SEMIFINAL", "FINAL"). Una fase con otro nombre se queda
// con el suyo: lo eligió la liga.
export function roundShortName(name) {
  const n = (name || '').trim();
  if (/^cuartos/i.test(n)) return 'Cuartos';
  if (/^semifinal/i.test(n)) return 'Semifinal';
  if (/^octavos/i.test(n)) return 'Octavos';
  return n;
}

/**
 * En qué va un cruce, para la línea que va entre sus dos equipos.
 *   pending   — todavía no se sabe quién lo juega
 *   bye       — uno de los dos descansa (no hubo rival)
 *   unscheduled — se sabe quién, pero no hay partido capturado
 *   scheduled — capturado, con su fecha ("8 NOV · 6:00 p.m.") o "Fecha por definir"
 *   live      — en vivo
 *   final     — terminado
 */
export function gameStatus(game, now = Date.now()) {
  if (!game) return { kind: 'pending', label: 'Por definir' };
  if (game.bye) return { kind: 'bye', label: 'Descansa' };
  if (!game.top || !game.bottom) return { kind: 'pending', label: 'Por definir' };
  const m = game.match;
  if (!m) return { kind: 'unscheduled', label: 'vs' };
  if (m.is_final) return { kind: 'final', label: 'Final' };
  const estado = getMatchStatus(m, now);
  if (estado === 'live') return { kind: 'live', label: 'En vivo' };
  // Terminado por el reloj pero sin marcador: no se sabe quién ganó, y
  // decir "Final" sin números sería raro.
  if (estado === 'finished') return { kind: 'scheduled', label: 'Sin marcador' };
  const { day, month, time, porDefinir } = getMatchParts(m.match_date, m.timezone);
  return { kind: 'scheduled', label: porDefinir ? 'Fecha por definir' : `${day} ${month} · ${time}` };
}

// El día en que se jugó un cruce: "6 NOV". La imagen lo escribe en vez de "Final",
// que entre siete marcadores ya no dice nada y se confunde con la ronda.
export function playedDay(game) {
  const { day, month, porDefinir } = getMatchParts(game?.match?.match_date, game?.match?.timezone);
  return porDefinir ? '' : `${day} ${month}`;
}

// Lo que va bajo el campeón, al centro: en qué va la final. No es la línea de
// un cruce cualquiera —ahí "vs" tiene sentido, aquí no—. En la página la final
// ya jugada es una liga para verla (`link`); en la imagen solo dice "Final".
export function finalLabel(status, { link = false } = {}) {
  switch (status?.kind) {
    case 'final': return link ? 'Ver la final' : 'Final';
    case 'live': return 'Final · En vivo';
    case 'scheduled': return `Final · ${status.label}`;
    case 'unscheduled': return 'Final';
    default: return 'Final por definir';
  }
}

// De dónde viene un sembrado: "1.º de BAJÍO", "Comodín · 3.º de NORTE". Con
// una sola tabla (14 Grandes) basta el lugar.
export function seedOrigin(seed, { singleTable = false } = {}) {
  if (!seed) return '';
  const lugar = seed.table_rank ? `${seed.table_rank}.º` : '';
  const tabla = !singleTable && seed.table_name ? ` de ${seed.table_name}` : '';
  const base = `${lugar}${tabla}`.trim();
  return seed.qualified_as === 'wildcard' ? `Comodín${base ? ` · ${base}` : ''}` : base;
}

export function recordOf(seed) {
  if (!seed) return '';
  const base = `${seed.wins ?? 0}-${seed.losses ?? 0}`;
  return seed.ties ? `${base}-${seed.ties}` : base;
}

// El nombre del bracket: "Conferencia NACIONAL". Sin conferencia (una regla de
// toda la rama), sin nombre: es el único de la rama.
export function bracketTitle(bracket) {
  return bracket?.title ? scopeLabel('conference', bracket.title) : '';
}

// Si alguna siembra quedó sin decidir por ningún criterio: la leyenda solo
// explica el asterisco cuando aparece.
export function hasTiedSeeds(bracket) {
  return (bracket?.seeds || []).some((s) => s.tied);
}

// Cuántas tablas alimentan el bracket: con una sola, el origen de cada
// sembrado es solo su lugar.
export function isSingleTable(bracket) {
  return new Set((bracket?.seeds || []).map((s) => s.table_name)).size <= 1;
}

// Lo que la vista previa del panel dice de un bracket que todavía no se ve.
export function publishNote(bracket) {
  if (!bracket || bracket.ready) return '';
  const n = bracket.regular_pending || 0;
  if (!n) return 'Todavía no se publica: no hay partidos de temporada regular con marcador.';
  return `Todavía no se publica: falta${n === 1 ? '' : 'n'} ${n} partido${n === 1 ? '' : 's'} de temporada regular con marcador. Así quedaría si terminara hoy.`;
}

// El aviso del panel cuando hay partidos de playoffs que no caben en ningún
// cruce: el público no los ve en el bracket, y la liga tiene que saberlo.
export function unplacedNote(matches = []) {
  const n = matches.length;
  if (!n) return '';
  const ids = matches.map((m) => `#${m.id}`).join(', ');
  return n === 1
    ? `Un partido de eliminación directa entre equipos de este bracket no cabe en ningún cruce (partido ${ids}). No sale en el bracket: revisa sus equipos, o elígele la fase de su ronda para que corrija el cruce.`
    : `${n} partidos de eliminación directa entre equipos de este bracket no caben en ningún cruce (partidos ${ids}). No salen en el bracket: revisa sus equipos, o elígeles la fase de su ronda para que corrijan el cruce.`;
}

// El sembrado de un participante, para su origen y su récord.
export function seedOf(bracket, participant) {
  if (!participant) return null;
  return (bracket?.seeds || []).find((s) => s.team_id === participant.team_id) || null;
}
