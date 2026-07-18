import pg from 'pg';

const { Pool } = pg;

let pool;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'Falta la variable de entorno DATABASE_URL. Define la cadena de conexión de Postgres (Neon) antes de iniciar el servidor.'
      );
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function prepare(sql) {
  const pgSql = toPgPlaceholders(sql);
  return {
    async get(...params) {
      const { rows } = await getPool().query(pgSql, params);
      return rows[0] || undefined;
    },
    async all(...params) {
      const { rows } = await getPool().query(pgSql, params);
      return rows;
    },
    async run(...params) {
      let finalSql = pgSql;
      const isInsert = /^\s*INSERT/i.test(pgSql);
      if (isInsert && !/RETURNING/i.test(pgSql)) {
        finalSql = `${pgSql} RETURNING id`;
      }
      const result = await getPool().query(finalSql, params);
      return {
        lastInsertRowid: result.rows[0]?.id,
        changes: result.rowCount,
      };
    },
  };
}

async function exec(sql) {
  await getPool().query(sql);
}

const db = { prepare, exec };

const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'rep',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leagues (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  state TEXT,
  description TEXT,
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'approved',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  logo_url TEXT,
  cover_url TEXT,
  location TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  facebook_url TEXT,
  instagram_url TEXT,
  twitter_url TEXT,
  website_url TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS venues (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  institution TEXT,
  cover_url TEXT,
  address TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  match_date TEXT NOT NULL,
  venue TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  home_score INTEGER,
  away_score INTEGER,
  stream_url TEXT,
  week_label TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sponsors (
  id SERIAL PRIMARY KEY,
  name TEXT,
  logo_url TEXT NOT NULL,
  link_url TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  league_id INTEGER REFERENCES leagues(id) ON DELETE CASCADE,
  match_id  INTEGER REFERENCES matches(id)  ON DELETE CASCADE,
  team_name TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(endpoint, league_id, match_id, team_name)
);

CREATE INDEX IF NOT EXISTS idx_categories_league ON categories(league_id);
CREATE INDEX IF NOT EXISTS idx_matches_category ON matches(category_id);
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(match_date);
CREATE INDEX IF NOT EXISTS idx_venues_league ON venues(league_id);
CREATE INDEX IF NOT EXISTS idx_groups_category ON groups(category_id);
CREATE INDEX IF NOT EXISTS idx_push_league ON push_subscriptions(league_id);
CREATE INDEX IF NOT EXISTS idx_push_match  ON push_subscriptions(match_id);
`;

export async function initSchema() {
  await exec(schemaSql);

  const newTeamColumns = [
    'location TEXT',
    'contact_email TEXT',
    'contact_phone TEXT',
    'facebook_url TEXT',
    'instagram_url TEXT',
    'twitter_url TEXT',
    'website_url TEXT',
    'sort_order INTEGER DEFAULT 0',
    'cover_url TEXT',
  ];
  for (const col of newTeamColumns) {
    await exec(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
  }

  await exec(`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Mexico_City'`).catch(() => {});
  await exec(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS timezone TEXT`).catch(() => {});
  await exec(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS tickets_url TEXT`).catch(() => {});
  await exec(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS season TEXT`).catch(() => {});
  await exec(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS year INTEGER`).catch(() => {});

  // Control de notificaciones ya enviadas por partido (evita reenvíos repetidos del cronjob)
  await exec(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS notified_upcoming BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => {});
  await exec(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS notified_live BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => {});

  // Relación de un partido con una sede registrada (tabla venues). Se deja la
  // columna vieja "venue" (texto libre) intacta para no perder los datos que
  // ya existen; los partidos nuevos usarán venue_id en vez de texto libre.
  await exec(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS venue_id INTEGER REFERENCES venues(id) ON DELETE SET NULL`).catch(() => {});
  await exec(`CREATE INDEX IF NOT EXISTS idx_matches_venue ON matches(venue_id)`).catch(() => {});

  // Relación de un partido con un grupo (tabla groups, propio de cada
  // categoría) — ej. "Conferencia 14 Grandes" vs "Conferencia Nacional-Norte".
  // Es una función nueva, no hay texto libre viejo que preservar aquí.
  await exec(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL`).catch(() => {});
  await exec(`CREATE INDEX IF NOT EXISTS idx_matches_group ON matches(group_id)`).catch(() => {});

  // Segundo grupo opcional, solo para partidos interconferencia (un partido
  // cruzado entre dos grupos distintos, ej. "14 Grandes" vs "Nacional-Norte")
  // — así no hace falta crear un grupo artificial para representar el cruce.
  await exec(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS group_id_2 INTEGER REFERENCES groups(id) ON DELETE SET NULL`).catch(() => {});
  await exec(`CREATE INDEX IF NOT EXISTS idx_matches_group2 ON matches(group_id_2)`).catch(() => {});

  const newLeagueColumns = [
    'cover_url TEXT',
    'facebook_url TEXT',
    'instagram_url TEXT',
    'twitter_url TEXT',
    'youtube_url TEXT',
    'tiktok_url TEXT',
    'website_url TEXT',
    'whatsapp TEXT',
  ];
  for (const col of newLeagueColumns) {
    await exec(`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
  }

  await exec(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS team_name TEXT`).catch(() => {});
  await exec(`CREATE INDEX IF NOT EXISTS idx_push_team ON push_subscriptions(team_name)`).catch(() => {});

  await exec(`
    ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_league_id_match_id_key
  `).catch(() => {});
  await exec(`
    ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_unique
    UNIQUE (endpoint, league_id, match_id, team_name)
  `).catch(() => {});

  // Corrige retroactivamente el bug de notificaciones por equipo cruzadas entre
  // ligas: antes una suscripción a "team_name" no guardaba a qué liga pertenecía,
  // así que si dos ligas tenían un equipo con el mismo nombre, sus suscriptores
  // se mezclaban. Aquí les asignamos su league_id cuando el nombre del equipo es
  // único en toda la plataforma (sin ambigüedad). Si hay más de una liga con un
  // equipo de ese nombre, se deja sin resolver automáticamente — se corrige solo
  // en cuanto la persona se vuelva a suscribir, ya con el nuevo flujo.
  await exec(`
    UPDATE push_subscriptions ps
    SET league_id = sub.league_id
    FROM (
      SELECT UPPER(name) AS uname, MIN(league_id) AS league_id, COUNT(DISTINCT league_id) AS league_count
      FROM teams
      GROUP BY UPPER(name)
    ) sub
    WHERE ps.team_name IS NOT NULL
      AND ps.league_id IS NULL
      AND UPPER(ps.team_name) = sub.uname
      AND sub.league_count = 1
  `).catch(() => {});
}

export default db;
