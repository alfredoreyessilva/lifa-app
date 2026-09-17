// Arma las tablas de posiciones de una rama y resuelve sus campeones.
//
// Es la capa que junta la base de datos con el motor puro de utils/standings.js:
// aquí se leen equipos, partidos y configuración; allá se calcula y se ordena.
// La separación es a propósito — el reglamento de desempates se prueba con
// `node --test` sin Postgres, y este archivo se queda solo con las consultas.
//
// Una rama puede tener VARIAS tablas al mismo tiempo, no una:
//
//   LFA    → 1 tabla (toda la rama)
//   ONEFA  → 1 tabla por conferencia, y NINGUNA general (no hay
//            interconferencia, así que una tabla general no significaría nada)
//   NFL    → 1 por división, 1 por conferencia, 1 general
//
// Cuáles se dibujan lo decide `branches.standings_levels`, no una regla
// adivinada por el código. Adivinar sería tentador ("si tiene conferencias,
// haz tabla por conferencia") pero se equivoca justo en el caso de ONEFA,
// donde existe la estructura pero la tabla general no tiene sentido.

import db from '../config/db.js';
import { MATCH_SCOPE_COLUMNS, MATCH_SCOPE_JOINS } from './matchScope.js';
import { MATCH_PHASE_COLUMNS, MATCH_PHASE_JOINS } from './matchPhase.js';
import { computeStandings, computeQualification } from './standings.js';
import { MATCH_IS_FINAL_SQL } from './scoring.js';

const LEVELS = ['branch', 'conference', 'group'];

function parseJsonArray(value, fallback) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

// La configuración de la rama, ya normalizada. `points_win` en NULL significa
// "sin sistema de puntos": la tabla se ordena por % de ganados, como americano.
export function standingsConfigOf(branch) {
  return {
    standings_levels: parseJsonArray(branch.standings_levels, ['branch']).filter((l) => LEVELS.includes(l)),
    tiebreakers: parseJsonArray(branch.tiebreakers, []),
    multi_team_mode: branch.tiebreaker_mode === 'restart' ? 'restart' : 'sequential',
    points_win:  branch.points_win  ?? undefined,
    points_draw: branch.points_draw ?? undefined,
    points_loss: branch.points_loss ?? undefined,
    uses_points: branch.points_win !== null && branch.points_win !== undefined,
  };
}

// Equipos inscritos en la rama, con su conferencia y grupo ya resueltos.
// La conferencia sale de branch_teams o, si el equipo se inscribió a nivel
// grupo, de la conferencia de ese grupo — el mismo COALESCE que usa
// matchScope.js para derivar la conferencia de un partido.
async function loadTeams(branchId) {
  return db.prepare(`
    SELECT
      bt.team_id,
      t.name,
      t.logo_url,
      COALESCE(bt.conference_id, g.conference_id) AS conference_id,
      cf.name AS conference_name,
      bt.group_id,
      g.name  AS group_name
    FROM branch_teams bt
    JOIN teams t ON t.id = bt.team_id
    LEFT JOIN groups g       ON g.id  = bt.group_id
    LEFT JOIN conferences cf ON cf.id = COALESCE(bt.conference_id, g.conference_id)
    WHERE bt.branch_id = ?
    ORDER BY t.name ASC
  `).all(branchId);
}

// Partidos de la rama con fase, alcance y "ya terminó" ya resueltos.
//
// `is_final` sale de MATCH_IS_FINAL_SQL (utils/scoring.js) — la MISMA regla
// que usan los rankings de predicciones. No es `status = 'finished'` a secas:
// un partido en 'scheduled' también terminó si su categoría tiene auto-status
// y ya pasó la ventana. Por eso hace falta el JOIN a categories.
//
// `is_draft` se filtra aquí y no en el motor: un borrador no existe para
// nadie más, tampoco para la tabla.
async function loadMatches(branchId) {
  return db.prepare(`
    SELECT
      m.id, m.home_team_id, m.away_team_id, m.home_score, m.away_score,
      m.status, m.match_date, m.week_label, m.is_draft,
      ${MATCH_IS_FINAL_SQL} AS is_final,
      ${MATCH_SCOPE_COLUMNS},
      ${MATCH_PHASE_COLUMNS}
    FROM matches m
    JOIN categories c ON c.id = m.category_id
    ${MATCH_SCOPE_JOINS}
    ${MATCH_PHASE_JOINS}
    WHERE m.branch_id = ? AND m.is_draft = FALSE
    ORDER BY m.match_date ASC, m.id ASC
  `).all(branchId);
}

// Los alcances concretos de un nivel: para 'conference', cada conferencia que
// tenga equipos; para 'group', cada grupo. Se derivan de los equipos
// inscritos y no de las tablas `conferences`/`groups` a propósito — una
// conferencia creada pero sin equipos no debe producir una tabla vacía.
function scopesOf(level, teams) {
  if (level === 'branch') return [{ id: null, name: null }];

  const key  = level === 'conference' ? 'conference_id' : 'group_id';
  const name = level === 'conference' ? 'conference_name' : 'group_name';

  const seen = new Map();
  for (const t of teams) {
    if (t[key] && !seen.has(t[key])) seen.set(t[key], { id: t[key], name: t[name] });
  }
  return [...seen.values()];
}

function teamsInScope(level, scopeId, teams) {
  if (level === 'branch') return teams;
  const key = level === 'conference' ? 'conference_id' : 'group_id';
  return teams.filter((t) => t[key] === scopeId);
}

/**
 * Todas las tablas de una rama, más sus títulos con el campeón resuelto.
 * `publicOnly` recorta lo que solo le sirve al panel de la liga.
 */
export async function buildBranchStandings(branchId, { publicOnly = false } = {}) {
  const branch = await db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId);
  if (!branch) return null;

  const config = standingsConfigOf(branch);

  const [teams, matches, phases, titles, overrides, quals] = await Promise.all([
    loadTeams(branchId),
    loadMatches(branchId),
    db.prepare('SELECT * FROM phases WHERE branch_id = ? ORDER BY sort_order ASC, id ASC').all(branchId),
    db.prepare(`
      SELECT ti.*, ph.name AS phase_name
      FROM titles ti
      LEFT JOIN phases ph ON ph.id = ti.phase_id
      WHERE ti.branch_id = ?
      ORDER BY ti.sort_order ASC, ti.id ASC
    `).all(branchId),
    db.prepare(`
      SELECT tov.*, t.name AS team_name, t.logo_url AS team_logo_url
      FROM title_overrides tov
      JOIN titles ti ON ti.id = tov.title_id
      JOIN teams  t  ON t.id  = tov.team_id
      WHERE ti.branch_id = ?
    `).all(branchId),
    // Reglas de clasificación a la siguiente fase ("pasa el primero de cada
    // grupo"). Cuelgan de la fase DESDE la que se clasifica.
    db.prepare(`
      SELECT q.* FROM phase_qualifications q
      JOIN phases ph ON ph.id = q.phase_id
      WHERE ph.branch_id = ?
    `).all(branchId),
  ]);

  // Una tabla por cada (nivel configurado × alcance con equipos).
  const tables = [];
  for (const level of config.standings_levels) {
    for (const scope of scopesOf(level, teams)) {
      const scopeTeams = teamsInScope(level, scope.id, teams);
      if (!scopeTeams.length) continue;

      const scopeIds = new Set(scopeTeams.map((t) => t.team_id));
      // "Dentro del alcance" para el criterio scope_*: ambos equipos de esta
      // misma tabla. Un juego contra alguien de otra conferencia cuenta para
      // el récord general pero no para el récord de conferencia — que es
      // precisamente la distinción que usa el desempate de NFL.
      const inScope = (m) => scopeIds.has(m.home_team_id) && scopeIds.has(m.away_team_id);

      // Cuántos de esta tabla avanzan, si la liga lo configuró. Se marca en
      // la tabla (una barra al lado del lugar) para que el corte se vea sin
      // tener que contar renglones.
      const rule = quals.find((q) => q.from_scope === level);

      tables.push({
        level,
        scope_id: scope.id,
        scope_name: scope.name,
        qualifying_count: rule ? rule.top_n : 0,
        rows: computeStandings({ teams: scopeTeams, matches, config, inScope }),
      });
    }
  }

  markWildcards(tables, quals);

  const resolved = titles.map((title) =>
    resolveTitle({ title, tables, teams, matches, overrides }));

  return {
    branch: {
      id: branch.id,
      name: branch.name,
      category_id: branch.category_id,
      ...config,
    },
    phases: publicOnly ? phases.map(({ id, name, type }) => ({ id, name, type })) : phases,
    tables,
    titles: resolved,
  };
}

// Marca a los que avanzan por lugar EXTRA (wild card, "mejores terceros").
//
// Los directos no hace falta marcarlos aquí: son los primeros `top_n` de cada
// tabla y la tabla ya los pinta con `qualifying_count`. Los extra no se ven
// de la posición —son el 3º de un grupo que sí pasa y el 3º de otro que no—
// así que hay que decirlo renglón por renglón.
function markWildcards(tables, quals) {
  for (const rule of quals) {
    if (!(rule.plus_best_n > 0)) continue;

    const delNivel = tables.filter((t) => t.level === rule.from_scope);
    if (delNivel.length < 2) continue; // con una sola tabla no hay nada que comparar

    const clasificados = computeQualification({
      tables: delNivel.map((t) => ({ key: `${t.level}-${t.scope_id}`, rows: t.rows })),
      rule,
    });

    const extra = new Set(clasificados.filter((c) => c.qualified_as === 'wildcard').map((c) => c.team_id));
    for (const t of delNivel) {
      for (const row of t.rows) if (extra.has(row.team_id)) row.qualified_as = 'wildcard';
    }
  }
}

// Resuelve el campeón (o campeones, uno por conferencia/grupo) de un título.
//
// Precedencia, igual de explícita que en matchScope.js:
//   1. override — la liga lo fijó a mano. Manda siempre.
//   2. derivado — primer lugar de la tabla, o ganador del partido decisivo.
//   3. nada — todavía no se puede saber. Se responde `null`, no un placeholder:
//      un título sin campeón definido es información, no un hueco que llenar.
function resolveTitle({ title, tables, teams, matches, overrides }) {
  const level = title.scope;
  const scopes = scopesOf(level, teams);
  const byTeam = new Map(teams.map((t) => [t.team_id, t]));

  const winners = scopes.map((scope) => {
    const override = overrides.find((o) =>
      o.title_id === title.id && (o.scope_id ?? null) === (scope.id ?? null));
    if (override) {
      return {
        scope_id: scope.id, scope_name: scope.name,
        team_id: override.team_id, team_name: override.team_name,
        logo_url: override.team_logo_url,
        source: 'override', note: override.note || null,
      };
    }

    const found = title.decided_by === 'standings'
      ? championFromStandings({ title, tables, scope })
      : championFromMatch({ title, scope, teams, matches, level });

    if (!found) return { scope_id: scope.id, scope_name: scope.name, team_id: null, source: null };

    const team = byTeam.get(found.team_id);
    return {
      scope_id: scope.id, scope_name: scope.name,
      team_id: found.team_id,
      team_name: team?.name || null,
      logo_url: team?.logo_url || null,
      source: found.source,
      note: found.note || null,
    };
  });

  return { ...title, winners };
}

// Campeón por tabla: el primer lugar, pero SOLO si ya está decidido. Si la
// tabla todavía tiene un empate que el reglamento no resolvió, no se corona a
// nadie — sería inventar un campeón por el orden en que quedaron en el array.
function championFromStandings({ title, tables, scope }) {
  const table = tables.find((t) =>
    t.level === title.scope && (t.scope_id ?? null) === (scope.id ?? null));
  if (!table) return null;

  const first = table.rows[0];
  if (!first || first.unresolved_tie) return null;
  if (first.played === 0) return null;

  return { team_id: first.team_id, source: 'standings' };
}

// Campeón por partido: el ganador del ÚLTIMO juego terminado de la fase del
// título dentro de ese alcance. "Último" por fecha, no por id — la captura no
// siempre es cronológica.
//
// Si la fase tiene un solo partido (una final) es ese; si tiene varios (las
// dos finales de conferencia de NFL van en la misma fase), cada alcance toma
// el suyo porque se filtra por los equipos de ese alcance.
// Ya se jugó y tiene marcador. Mismo criterio que usa la tabla
// (countsForStandings), menos la parte de la fase: un partido de final NO
// cuenta para la tabla, pero sí corona campeón — es justo su razón de ser.
function countsAsPlayed(m) {
  return Boolean(m.is_final)
    && m.home_score !== null && m.home_score !== undefined
    && m.away_score !== null && m.away_score !== undefined;
}

function championFromMatch({ title, scope, teams, matches, level }) {
  if (!title.phase_id) return null;

  const scopeTeams = teamsInScope(level, scope.id, teams);
  const scopeIds = new Set(scopeTeams.map((t) => t.team_id));

  const candidates = matches.filter((m) =>
    m.phase_id === title.phase_id
    && countsAsPlayed(m)
    && scopeIds.has(m.home_team_id)
    && scopeIds.has(m.away_team_id));

  if (!candidates.length) return null;

  const last = candidates.reduce((a, b) =>
    String(b.match_date).localeCompare(String(a.match_date)) > 0 ? b : a);

  // Una final empatada no corona a nadie. En americano no debería pasar
  // (hay tiempo extra), pero si el marcador quedó así capturado, decirlo es
  // mejor que elegir al local en silencio.
  if (Number(last.home_score) === Number(last.away_score)) return null;

  return {
    team_id: Number(last.home_score) > Number(last.away_score) ? last.home_team_id : last.away_team_id,
    source: 'match',
  };
}
