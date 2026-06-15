import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, '../../data.sqlite'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'rep', -- 'rep' o 'admin'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leagues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  state TEXT,
  description TEXT,
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'approved', -- 'pending', 'approved'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- ej: Varonil Mayor, Femenil Flag, Sub-12, etc.
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  match_date TEXT NOT NULL, -- ISO 8601
  venue TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled, live, finished
  home_score INTEGER,
  away_score INTEGER,
  stream_url TEXT,
  week_label TEXT, -- ej "Jornada 3"
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_categories_league ON categories(league_id);
CREATE INDEX IF NOT EXISTS idx_matches_category ON matches(category_id);
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(match_date);
`);

// Migración: agregar columnas nuevas a "teams" si la tabla ya existía sin ellas
const newTeamColumns = [
  'location TEXT',
  'contact_email TEXT',
  'contact_phone TEXT',
  'facebook_url TEXT',
  'instagram_url TEXT',
  'twitter_url TEXT',
  'website_url TEXT',
  'sort_order INTEGER DEFAULT 0',
];
for (const col of newTeamColumns) {
  try {
    db.exec(`ALTER TABLE teams ADD COLUMN ${col}`);
  } catch {
    // La columna ya existe, se ignora
  }
}

export default db;
