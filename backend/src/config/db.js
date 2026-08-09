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

CREATE TABLE IF NOT EXISTS tournaments (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  year INTEGER NOT NULL,
  logo_url TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inscripción: qué Equipo participa en qué Torneo. Es la pieza que permite
-- que un equipo (perfil independiente, con su propia liga "de origen")
-- juegue en torneos de otras ligas, y que esa participación quede como
-- registro histórico permanente aunque después el equipo cambie de liga
-- o deje de pertenecer a la de origen.
CREATE TABLE IF NOT EXISTS tournament_teams (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tournament_id, team_id)
);

-- Membresía: "este equipo es de la casa" de esta liga. A diferencia de
-- tournament_teams (un equipo invitado a UN torneo específico), ser
-- miembro de la liga hace al equipo elegible automáticamente para
-- CUALQUIER torneo de esa liga, presente o futuro, sin inscripción
-- aparte ni confirmación del equipo.
CREATE TABLE IF NOT EXISTS league_teams (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (league_id, team_id)
);

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS branches (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conferences (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
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
  // Candado a nivel de base de datos (no necesita Redis ni nada externo):
  // si el día de mañana corren dos instancias del servidor a la vez (Render
  // escalando por tráfico, o un redeploy donde la vieja y la nueva coinciden
  // un instante), la segunda instancia se ESPERA aquí hasta que la primera
  // termine todas las migraciones, en vez de correrlas ambas al mismo tiempo.
  // Es "advisory" porque no bloquea ninguna tabla real, solo actúa como una
  // bandera compartida que todas las instancias respetan.
  //
  // OJO: el candado vive en la SESIÓN de una sola conexión — por eso se pide
  // un cliente dedicado del pool (`client`) en vez de usar `exec()`/`db`, que
  // toman una conexión distinta del pool en cada llamada. Todas las
  // instrucciones de esta función corren sobre ese mismo `client`.
  const MIGRATION_LOCK_KEY = 727272; // número arbitrario, solo debe ser el mismo en todas las instancias

  const client = await getPool().connect();
  async function run(sql) {
    try {
      await client.query(sql);
    } catch {
      // mismo comportamiento de antes: si una migración puntual falla
      // (ej. ya existía), no se detiene el resto del arranque.
    }
  }

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    await run(schemaSql);

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
      await run(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS ${col}`);
    }

    // Links predeterminados de transmisión/boletos por equipo — separados entre
    // "en casa" y "de visita", porque un mismo equipo puede transmitir distinto
    // según juegue de local o visitante. Cada uno es una LISTA (jsonb), porque un
    // equipo puede compartir el mismo partido en varias plataformas a la vez.
    const newTeamLinkColumns = [
      "home_stream_links JSONB NOT NULL DEFAULT '[]'::jsonb",
      "away_stream_links JSONB NOT NULL DEFAULT '[]'::jsonb",
      "home_ticket_links JSONB NOT NULL DEFAULT '[]'::jsonb",
      "away_ticket_links JSONB NOT NULL DEFAULT '[]'::jsonb",
    ];
    for (const col of newTeamLinkColumns) {
      await run(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS ${col}`);
    }

    // Links de un partido específico — ahora son listas (varias plataformas a la
    // vez), en vez de un solo texto. Se dejan las columnas viejas stream_url /
    // tickets_url intactas (no se borran) para no perder datos históricos.
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS stream_links JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS ticket_links JSONB NOT NULL DEFAULT '[]'::jsonb`);

    // Migra automáticamente (en cada arranque del servidor) cualquier link viejo
    // de un solo texto hacia la nueva lista, mientras esta siga vacía. Así los
    // partidos ya creados (o importados por Excel, que sigue usando las columnas
    // viejas) terminan mostrándose igual con el nuevo sistema de botones.
    await run(`
      UPDATE matches
      SET stream_links = jsonb_build_array(stream_url)
      WHERE stream_url IS NOT NULL AND stream_url <> '' AND jsonb_array_length(stream_links) = 0
    `);
    await run(`
      UPDATE matches
      SET ticket_links = jsonb_build_array(tickets_url)
      WHERE tickets_url IS NOT NULL AND tickets_url <> '' AND jsonb_array_length(ticket_links) = 0
    `);

    await run(`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Mexico_City'`);
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS timezone TEXT`);
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS tickets_url TEXT`);
    await run(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS season TEXT`);
    await run(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS year INTEGER`);

    // Nueva jerarquía en construcción: categoría empieza a poder colgar de un
    // torneo. Se deja opcional (nullable) para no afectar las categorías reales
    // que hoy siguen viviendo directo bajo la liga (league_id).
    await run(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE`);

    // Estado automático del partido (opcional, apagado por defecto). Si está
    // apagado, el estado del partido lo controla el organizador a mano, sin
    // límite de tiempo. Si se prende, hay que elegir entre 1 y 3 horas —
    // nunca se activa "solo", nace apagado tanto para categorías nuevas como
    // para las que ya existían antes de este sistema.
    await run(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS auto_status_enabled BOOLEAN DEFAULT FALSE`);
    await run(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS auto_status_window_hours INTEGER`);

    // Marca la categoría/rama automática "Sin clasificar" que se crea sola
    // cuando un partido del Excel no coincide con nada real — para poder
    // bloquear su publicación hasta que alguien lo corrija, sin tener que
    // adivinar por el nombre (que el organizador podría cambiar).
    await run(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_placeholder BOOLEAN NOT NULL DEFAULT FALSE`);
    await run(`ALTER TABLE branches   ADD COLUMN IF NOT EXISTS is_placeholder BOOLEAN NOT NULL DEFAULT FALSE`);

    // Control de notificaciones ya enviadas por partido (evita reenvíos repetidos del cronjob)
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS notified_upcoming BOOLEAN NOT NULL DEFAULT FALSE`);
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS notified_live BOOLEAN NOT NULL DEFAULT FALSE`);

    // Visibilidad pública de una liga: reemplaza el viejo `status` (pending/approved).
    // Son dos controles independientes:
    //   - is_public: lo decide el admin, controla si la liga aparece en el sitio público.
    //   - publish_requested: lo decide el dueño de la liga, es solo una señal para el
    //     admin ("quiero promoción"), nunca obliga a publicar ni a mantener publicado.
    await run(`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE`);
    await run(`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS publish_requested BOOLEAN NOT NULL DEFAULT FALSE`);
    // Nota: la migración de datos que traducía el viejo `status = 'approved'` a `is_public = TRUE`
    // ya se ejecutó una sola vez cuando se lanzó este cambio. Se quitó de aquí a propósito —
    // dejarla como un UPDATE que corre en cada arranque volvía a publicar cualquier liga que
    // alguien hubiera ocultado manualmente después, cada vez que Render dormía y despertaba
    // el servidor. Si hace falta repetir ese backfill alguna vez, correrlo a mano, no aquí.

    // Relación de un partido con una sede registrada (tabla venues). Se deja la
    // columna vieja "venue" (texto libre) intacta para no perder los datos que
    // ya existen; los partidos nuevos usarán venue_id en vez de texto libre.
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS venue_id INTEGER REFERENCES venues(id) ON DELETE SET NULL`);
    await run(`CREATE INDEX IF NOT EXISTS idx_matches_venue ON matches(venue_id)`);

    // Relación de un partido con un grupo (tabla groups, propio de cada
    // categoría) — ej. "Conferencia 14 Grandes" vs "Conferencia Nacional-Norte".
    // Es una función nueva, no hay texto libre viejo que preservar aquí.
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL`);
    await run(`CREATE INDEX IF NOT EXISTS idx_matches_group ON matches(group_id)`);

    // Segundo grupo opcional, solo para partidos interconferencia (un partido
    // cruzado entre dos grupos distintos, ej. "14 Grandes" vs "Nacional-Norte")
    // — así no hace falta crear un grupo artificial para representar el cruce.
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS group_id_2 INTEGER REFERENCES groups(id) ON DELETE SET NULL`);
    await run(`CREATE INDEX IF NOT EXISTS idx_matches_group2 ON matches(group_id_2)`);

    // Relación DIRECTA de un partido con una conferencia, para el caso en
    // que esa conferencia no tenga ningún grupo adentro (el partido cuelga
    // directo de la conferencia). Cuando el partido SÍ tiene group_id, su
    // conferencia se sabe indirectamente vía group.conference_id — esta
    // columna solo se usa cuando no hay grupo que lo diga.
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS conference_id INTEGER REFERENCES conferences(id) ON DELETE SET NULL`);
    await run(`CREATE INDEX IF NOT EXISTS idx_matches_conference ON matches(conference_id)`);

    // Nueva jerarquía en construcción: el partido empieza a poder colgar de
    // una rama (branch_id), que es donde de verdad vive su calendario según
    // el modelo nuevo. Se deja opcional (nullable) para no afectar los
    // partidos reales que hoy siguen viviendo directo bajo category_id.
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE`);
    await run(`CREATE INDEX IF NOT EXISTS idx_matches_branch ON matches(branch_id)`);

    // Borrador: partidos que llegaron de una importación de Excel (o que el
    // organizador está preparando) pero que todavía no se publican — no
    // deben aparecer en ningún calendario ni cálculo público. Nace en FALSO
    // para todo lo que ya existe (nada cambia para los partidos de hoy).
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT FALSE`);
    await run(`CREATE INDEX IF NOT EXISTS idx_matches_is_draft ON matches(is_draft)`);

    // Conexión real (por id) del partido con el perfil del equipo — además
    // de home_team/away_team (el nombre en texto, que se queda igual para
    // no romper nada). Con esto, el historial de un equipo sobrevive
    // aunque después cambie de nombre o de liga: el partido sigue
    // apuntando al mismo perfil real, no solo a un texto suelto.
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS home_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL`);
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS away_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL`);
    await run(`CREATE INDEX IF NOT EXISTS idx_matches_home_team_id ON matches(home_team_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_matches_away_team_id ON matches(away_team_id)`);

    // Misma jerarquía en construcción: un grupo ahora puede colgar de una
    // conferencia (conference_id) en vez de directo de category_id. Opcional,
    // no afecta los grupos reales que hoy siguen usando category_id.
    await run(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS conference_id INTEGER REFERENCES conferences(id) ON DELETE CASCADE`);
    await run(`CREATE INDEX IF NOT EXISTS idx_groups_conference ON groups(conference_id)`);

    // Y el partido, en el modelo nuevo, puede colgar del nivel más profundo
    // que la liga haya decidido usar: rama, conferencia, grupo, o combinación.
    // group_id ya existe y ya se usa en el sistema real (categoría/grupo);
    // aquí solo se deja disponible también para partidos que cuelgan de
    // branch_id directamente, sin forzar a crear un grupo si no hace falta.

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
      await run(`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS ${col}`);
    }

    await run(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS team_name TEXT`);
    await run(`CREATE INDEX IF NOT EXISTS idx_push_team ON push_subscriptions(team_name)`);

    // Dueño directo de un equipo (representante de medios) — separado del dueño
    // de la liga. Si es NULL, el equipo todavía solo lo administra el
    // representante de la liga (o un admin).
    await run(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
    await run(`CREATE INDEX IF NOT EXISTS idx_teams_owner ON teams(owner_user_id)`);

    // Invitaciones de un solo uso para "entregar" el perfil de un equipo (y más
    // adelante, de una liga) a otra persona mediante un link que el
    // representante genera y comparte por su cuenta.
    await run(`
      CREATE TABLE IF NOT EXISTS invites (
        id SERIAL PRIMARY KEY,
        token TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL DEFAULT 'team',
        team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
        league_id INTEGER REFERENCES leagues(id) ON DELETE CASCADE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_invites_team ON invites(team_id)`);

    await run(`
      ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_league_id_match_id_key
    `);
    await run(`
      ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_unique
      UNIQUE (endpoint, league_id, match_id, team_name)
    `);

    // Corrige retroactivamente el bug de notificaciones por equipo cruzadas entre
    // ligas: antes una suscripción a "team_name" no guardaba a qué liga pertenecía,
    // así que si dos ligas tenían un equipo con el mismo nombre, sus suscriptores
    // se mezclaban. Aquí les asignamos su league_id cuando el nombre del equipo es
    // único en toda la plataforma (sin ambigüedad). Si hay más de una liga con un
    // equipo de ese nombre, se deja sin resolver automáticamente — se corrige solo
    // en cuanto la persona se vuelva a suscribir, ya con el nuevo flujo.
    await run(`
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
    `);

    // Todo equipo que ya existe hoy "vive" en su liga de origen (league_id)
    // — se les da de alta como miembros de esa liga automáticamente, para
    // que nadie quede huérfano al empezar a usar league_teams.
    await run(`
      INSERT INTO league_teams (league_id, team_id)
      SELECT league_id, id FROM teams
      ON CONFLICT (league_id, team_id) DO NOTHING
    `);
  } finally {
    // Se suelta el candado y se libera la conexión pase lo que pase (incluso
    // si algo de arriba lanzó un error), para que nunca se quede otra
    // instancia esperando un candado que ya nadie va a soltar.
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

export default db;
