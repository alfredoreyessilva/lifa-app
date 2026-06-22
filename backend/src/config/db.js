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
  location TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  facebook_url TEXT,
  instagram_url TEXT,
  twitter_url TEXT,
  website_url TEXT,
  sort_order INTEGER DEFAULT 0
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

CREATE INDEX IF NOT EXISTS idx_categories_league ON categories(league_id);
CREATE INDEX IF NOT EXISTS idx_matches_category ON matches(category_id);
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(match_date);
`;

export async function initSchema() {
  await exec(schemaSql);
  const newTeamColumns = [
    'location TEXT', 'contact_email TEXT', 'contact_phone TEXT',
    'facebook_url TEXT', 'instagram_url TEXT', 'twitter_url TEXT',
    'website_url TEXT', 'sort_order INTEGER DEFAULT 0',
  ];
  for (const col of newTeamColumns) {
    await exec(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
  }
}

export default db;