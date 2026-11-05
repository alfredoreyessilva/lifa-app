// Lo que rodea a un partido: cómo llegó cada equipo y qué más se juega esa
// jornada (README, "La página de un partido").
//
// Son funciones puras, como utils/standings.js: reciben lo que ya leyó
// branchStandings.js y se prueban con `node --test`, sin Postgres.
//
// **Todo se lee "a la fecha del partido".** La tabla pública responde cómo va
// la temporada HOY; esto responde cómo llegaron a ESTE juego. Con el récord de
// hoy, un partido de la Jornada 2 diría que los dos equipos llegaron 8-1, y un
// resultado de la Jornada 9 aparecería entre sus "últimos resultados".

import { hasScore } from './standings.js';

const timeOf = (m) => (m.match_date ? new Date(m.match_date).getTime() : null);

// Los partidos de antes de este. Solo se recorta por fecha: si ya se jugaron o
// no lo decide quien los usa, con la misma regla de la tabla.
//
// Uno con fecha por definir no tiene un "antes": se comparan todos los demás.
// Al revés, un partido sin fecha no se sabe si fue antes de otro que sí la
// tiene, así que no entra.
export function playedBefore(match, matches) {
  const cut = timeOf(match);
  return matches.filter((m) => {
    if (m.id === match.id) return false;
    if (cut === null) return true;
    const t = timeOf(m);
    return t !== null && t < cut;
  });
}

// Terminó, tiene marcador y es de verdad. A diferencia de la tabla, los
// playoffs SÍ cuentan: no suman al récord, pero son lo último que jugó el
// equipo. Un scrimmage no: ni la tabla ni la quiniela lo toman en serio.
function isRealResult(m) {
  return Boolean(m.is_final) && hasScore(m.home_score) && hasScore(m.away_score)
    && m.phase_type !== 'exhibition';
}

// "G", "P" o "E", como la racha de la tabla.
export function resultOf(own, other) {
  return own > other ? 'G' : own < other ? 'P' : 'E';
}

// Los últimos resultados de un equipo, del más reciente al más viejo.
export function recentResults(teamId, matches, teamsById, limit = 5) {
  return matches
    .filter((m) => (m.home_team_id === teamId || m.away_team_id === teamId) && isRealResult(m))
    .sort((a, b) => (timeOf(b) ?? 0) - (timeOf(a) ?? 0))
    .slice(0, limit)
    .map((m) => {
      const isHome = m.home_team_id === teamId;
      const own   = Number(isHome ? m.home_score : m.away_score);
      const other = Number(isHome ? m.away_score : m.home_score);
      const rival = teamsById.get(isHome ? m.away_team_id : m.home_team_id);
      return {
        match_id: m.id,
        match_date: m.match_date,
        timezone: m.timezone,
        week_label: m.week_label,
        is_home: isHome,
        // Del partido y no de la rama: el rival pudo no estar inscrito.
        opponent: isHome ? m.away_team : m.home_team,
        opponent_logo_url: rival?.logo_url ?? null,
        scored: own,
        allowed: other,
        result: resultOf(own, other),
      };
    });
}

// Lo que sabe la tabla de un equipo. El récord es el mismo en todas sus tablas
// (README, "El récord es el de toda la temporada, en cualquier tabla"); lo que
// cambia de una a otra es el lugar. Sin juegos no hay lugares que decir: entre
// equipos en 0-0 el orden es el alfabético, y "1.º" sería mentira.
export function standingOf(teamId, tables) {
  let row = null;
  const places = [];
  for (const table of tables) {
    const found = table.rows.find((r) => r.team_id === teamId);
    if (!found) continue;
    row = row || found;
    places.push({ level: table.level, scope_name: table.scope_name, rank: found.rank, of: table.rows.length });
  }
  if (!row) return null;
  return {
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    played: row.played,
    points_for: row.points_for,
    points_against: row.points_against,
    home_record: row.home_record,
    away_record: row.away_record,
    streak: row.streak,
    places: row.played > 0 ? places : [],
  };
}

// Un lado del partido. `null` si el partido no sabe de qué equipo habla, o si
// el equipo no está inscrito en la rama: ahí no hay nada que afirmar de él.
export function sideOfMatch(teamId, tables, before, teamsById) {
  if (!teamId) return null;
  const standing = standingOf(teamId, tables);
  if (!standing) return null;
  return { team_id: teamId, ...standing, recent: recentResults(teamId, before, teamsById) };
}

// Los demás partidos de la jornada, en el orden en que llegan (el de la fecha).
// Sin jornada no hay "los demás": una liga sin `week_label` no tiene con qué
// agruparlos, y juntarlos por semana sería adivinar.
export function weekMatches(match, matches, teamsById) {
  if (!match.week_label) return [];
  return matches
    .filter((m) => m.id !== match.id && m.week_label === match.week_label)
    .map((m) => {
      const home = teamsById.get(m.home_team_id);
      const away = teamsById.get(m.away_team_id);
      return {
        id: m.id,
        home_team: m.home_team,
        away_team: m.away_team,
        home_logo_url: home?.logo_url ?? null,
        away_logo_url: away?.away_logo_url ?? away?.logo_url ?? null,
        home_score: m.home_score,
        away_score: m.away_score,
        match_date: m.match_date,
        timezone: m.timezone,
        status: m.status,
        // getMatchStatus() las necesita para decir "En vivo" igual que el calendario.
        auto_status_enabled: m.auto_status_enabled,
        auto_status_window_hours: m.auto_status_window_hours,
      };
    });
}
