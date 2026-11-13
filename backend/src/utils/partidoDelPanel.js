import { MATCH_PHASE_JOINS, MATCH_PHASE_COLUMNS } from './matchPhase.js';

// Cómo llega un partido a los paneles de un medio y de una tienda: lo que el
// medio transmite y lo que se juega (README, "El panel de un medio"), y los
// partidos donde una tienda pone un premio (README, "Premios por acertar"). Las
// mismas columnas en todas esas listas, para que un partido se escriba igual en
// cualquiera de ellas: el frontend las pinta con las mismas piezas
// (`MediaMatch` y `MatchTime`, components/media/MediaBits.jsx).
//
// Vivían en routes/broadcasts.js hasta el 2026-11-11; salieron cuando la tienda
// las necesitó también. Son texto de SQL y nada más, como los fragmentos de
// utils/scoring.js: la consulta la arma cada ruta.
//
// Los escudos se unen por id y solo después por nombre, acotado a los miembros
// de la liga, como en GET /leagues/matches/:matchId. El NULLIF del visitante es
// el de esa misma ruta: un equipo sin logo de visitante lo guarda como cadena
// vacía. La categoría trae la ventana de su estado automático, con la que el
// panel decide si un partido ya terminó (utils/matchStatus.js).
export const PARTIDO_COLUMNAS = `
  m.id AS match_id, m.home_team, m.away_team, m.home_team_id, m.away_team_id,
  m.match_date, m.timezone, m.status, m.home_score, m.away_score, m.week_label, m.venue,
  c.name AS category_name,
  c.auto_status_enabled      AS auto_status_enabled,
  c.auto_status_window_hours AS auto_status_window_hours,
  br.name AS branch_name,
  l.id AS league_id, l.name AS league_name, l.slug AS league_slug,
  l.logo_url AS league_logo_url, l.timezone AS league_timezone,
  tr.name AS tournament_name, tr.year AS tournament_year,
  th.logo_url AS home_logo_url,
  COALESCE(NULLIF(ta.away_logo_url, ''), ta.logo_url) AS away_logo_url,
  v.name AS venue_name, v.city AS venue_city,
  ${MATCH_PHASE_COLUMNS}
`;

export const PARTIDO_JOINS = `
  JOIN categories c         ON c.id = m.category_id
  JOIN leagues l            ON l.id = c.league_id
  LEFT JOIN tournaments tr  ON tr.id = c.tournament_id
  LEFT JOIN branches br     ON br.id = m.branch_id
  LEFT JOIN teams th        ON th.id = COALESCE(m.home_team_id, (
    SELECT lt.team_id FROM league_teams lt
    JOIN teams t ON t.id = lt.team_id
    WHERE lt.league_id = l.id AND UPPER(t.name) = UPPER(m.home_team) LIMIT 1
  ))
  LEFT JOIN teams ta        ON ta.id = COALESCE(m.away_team_id, (
    SELECT lt.team_id FROM league_teams lt
    JOIN teams t ON t.id = lt.team_id
    WHERE lt.league_id = l.id AND UPPER(t.name) = UPPER(m.away_team) LIMIT 1
  ))
  LEFT JOIN venues v        ON v.id = m.venue_id
  ${MATCH_PHASE_JOINS}
`;
