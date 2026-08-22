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

-- Catálogo simple de países. Existe desde ahora (aunque hoy el 100% de los
-- datos sean de México) porque agregarlo después, con miles de ligas/equipos
-- ya creados, sería mucho más caro que agregarlo hoy. No es una jerarquía
-- geográfica completa (sin estado/ciudad todavía) — solo lo mínimo para que
-- cualquier organización pueda declarar su país.
CREATE TABLE IF NOT EXISTS countries (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

-- Entidad general que va a ir agrupando a todos los tipos de actor de la
-- plataforma (liga, equipo, medio, proveedor de uniformes, tienda deportiva,
-- clínica, marca patrocinadora). A propósito NO reemplaza a "leagues" ni a
-- "teams" — esas tablas siguen existiendo con todos sus campos específicos.
-- "organizations" es la capa común encima: identidad, tipo, país, contacto
-- básico. La conexión real (leagues.organization_id / teams.organization_id)
-- se agrega en un paso aparte, para no mezclar la creación de la tabla con
-- la migración de datos existentes.
--
-- 'supplier' y 'store' se fusionaron en un solo tipo ('store'): la
-- distinción no describía nada verificable ("¿vendes uniformes?" no separa
-- a una tienda de un proveedor, es la misma pregunta) — la relación real
-- ("es proveedor OFICIAL de tal equipo/liga") es un caso de
-- organization_relationships (pausado), no un tipo de organización.
CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('league', 'team', 'media', 'store', 'clinic', 'brand')),
  country_id INTEGER REFERENCES countries(id) ON DELETE SET NULL,
  logo_url TEXT,
  description TEXT,
  website_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations(type);
CREATE INDEX IF NOT EXISTS idx_organizations_country ON organizations(country_id);

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
  city TEXT,
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

CREATE TABLE IF NOT EXISTS page_views (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- El voto de "¿quién gana?" de una persona sobre un partido. A propósito
-- no hay UPDATE permitido desde la app (ver routes/predictions.js) — una
-- vez que alguien vota, queda fijo para siempre, como una quiniela de
-- papel. UNIQUE(match_id, user_id) además impide votar dos veces.
CREATE TABLE IF NOT EXISTS predictions (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pick TEXT NOT NULL CHECK (pick IN ('home', 'away', 'tie')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(match_id, user_id)
);

-- Quiniela privada: un grupo de personas, sin partidos amarrados — se
-- puede usar para comparar en el ranking de CUALQUIER calendario (no solo
-- el que estaba abierto cuando se creó). join_code es lo que va en el
-- link que se comparte para invitar (a diferencia de la tabla invites,
-- este código sirve para que se una cualquiera que lo tenga, muchas veces,
-- no es de un solo uso).
CREATE TABLE IF NOT EXISTS pools (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  join_code TEXT UNIQUE NOT NULL,
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Quién pertenece a cada quiniela y desde cuándo. joined_at importa: solo
-- las predicciones hechas DESDE que alguien se unió cuentan para el
-- ranking de esa quiniela (ver routes/pools.js).
CREATE TABLE IF NOT EXISTS pool_members (
  id SERIAL PRIMARY KEY,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(pool_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_categories_league ON categories(league_id);
CREATE INDEX IF NOT EXISTS idx_matches_category ON matches(category_id);
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(match_date);
CREATE INDEX IF NOT EXISTS idx_venues_league ON venues(league_id);
CREATE INDEX IF NOT EXISTS idx_groups_category ON groups(category_id);
CREATE INDEX IF NOT EXISTS idx_push_league ON push_subscriptions(league_id);
CREATE INDEX IF NOT EXISTS idx_push_match  ON push_subscriptions(match_id);
CREATE INDEX IF NOT EXISTS idx_page_views_event_date ON page_views(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id);
CREATE INDEX IF NOT EXISTS idx_predictions_user  ON predictions(user_id);
CREATE INDEX IF NOT EXISTS idx_pool_members_pool ON pool_members(pool_id);
CREATE INDEX IF NOT EXISTS idx_pool_members_user ON pool_members(user_id);
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
      // Logo alterno, solo se usa cuando el equipo aparece como visitante en
      // un partido (ej. para que dos cascos queden viendo de frente uno al
      // otro). Si no se define, se usa el logo normal — ver las consultas
      // que arman home_logo_url/away_logo_url para partidos.
      'away_logo_url TEXT',
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

    // Un grupo puede colgar directo de una Rama (sin Conferencia) — ambos
    // niveles son opcionales e independientes entre sí. group_id en un
    // partido apunta a esta misma tabla sin importar cuál de los dos usó.
    await run(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE`);
    await run(`CREATE INDEX IF NOT EXISTS idx_groups_branch ON groups(branch_id)`);

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
      // Marca si la liga es administrada oficialmente por sus dueños reales.
      // La pone únicamente el admin desde /admin — no la puede tocar el
      // representante de la liga.
      'is_verified BOOLEAN NOT NULL DEFAULT FALSE',
    ];
    for (const col of newLeagueColumns) {
      await run(`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS ${col}`);
    }

    await run(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS team_name TEXT`);
    await run(`CREATE INDEX IF NOT EXISTS idx_push_team ON push_subscriptions(team_name)`);

    // Quién hizo la suscripción. NULL en las suscripciones anónimas viejas
    // (de antes de exigir sesión para suscribirse) — se dejan como están,
    // sin migrarlas, ya que no hay forma confiable de saber de quién eran.
    await run(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
    await run(`CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id)`);

    // Dueño directo de un equipo (representante de medios) — separado del dueño
    // de la liga. Si es NULL, el equipo todavía solo lo administra el
    // representante de la liga (o un admin).
    await run(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
    await run(`CREATE INDEX IF NOT EXISTS idx_teams_owner ON teams(owner_user_id)`);

    // Conexión de una liga/equipo con su fila general en "organizations".
    // Nullable a propósito: nace vacía en ambas tablas, y un paso aparte
    // (más abajo, con guardas WHERE organization_id IS NULL) crea la
    // organización correspondiente y llena esta columna — así la creación
    // de la columna y la migración de datos quedan separadas, y esta parte
    // nunca puede fallar por datos, solo por estructura.
    await run(`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL`);
    await run(`CREATE INDEX IF NOT EXISTS idx_leagues_organization ON leagues(organization_id)`);

    await run(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL`);
    await run(`CREATE INDEX IF NOT EXISTS idx_teams_organization ON teams(organization_id)`);

    // Backfill: por cada liga que todavía no tenga organization_id, crea su
    // organización (type='league') reusando el mismo slug (leagues.slug ya es
    // único, así que es seguro reutilizarlo) y enlázala. Doblemente seguro
    // de repetir: tanto el INSERT como el UPDATE están protegidos con
    // "organization_id IS NULL", así que en cualquier arranque posterior,
    // una vez migradas, no vuelven a tocarse.
    await run(`
      WITH new_league_orgs AS (
        INSERT INTO organizations (name, slug, type, logo_url, description, website_url, status, created_at)
        SELECT l.name, l.slug, 'league', l.logo_url, l.description, l.website_url, 'active', l.created_at
        FROM leagues l
        WHERE l.organization_id IS NULL
        RETURNING id, slug
      )
      UPDATE leagues l
      SET organization_id = new_league_orgs.id
      FROM new_league_orgs
      WHERE l.slug = new_league_orgs.slug AND l.organization_id IS NULL
    `);

    // Mismo backfill para equipos. A diferencia de las ligas, "teams" no
    // tiene columna slug ni created_at propia, así que se genera un slug
    // simple y estable ('team-<id>') solo para cumplir la restricción UNIQUE
    // de organizations.slug — no se usa para navegación pública todavía.
    await run(`
      WITH new_team_orgs AS (
        INSERT INTO organizations (name, slug, type, logo_url, website_url, status, created_at)
        SELECT t.name, 'team-' || t.id, 'team', t.logo_url, t.website_url, 'active', CURRENT_TIMESTAMP
        FROM teams t
        WHERE t.organization_id IS NULL
        RETURNING id, slug
      )
      UPDATE teams t
      SET organization_id = new_team_orgs.id
      FROM new_team_orgs
      WHERE new_team_orgs.slug = 'team-' || t.id AND t.organization_id IS NULL
    `);

    // Quién pertenece a cada organización y con qué rol. Esto generaliza el
    // "un solo owner_user_id" que hoy vive suelto en leagues y teams: una
    // organización podrá tener varias personas (owner, admin, editor), no
    // solo una. owner_user_id en leagues/teams NO se borra en este paso —
    // sigue funcionando exactamente igual que hoy mientras se completa la
    // migración de ownership.js en los siguientes pasos.
    await run(`
      CREATE TABLE IF NOT EXISTS organization_members (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'editor')),
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(organization_id, user_id)
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id)`);

    // Backfill: cada dueño actual de una liga o equipo (owner_user_id) se
    // da de alta como 'owner' de la organización correspondiente. ON CONFLICT
    // DO NOTHING (por la restricción UNIQUE de arriba) lo vuelve seguro de
    // repetir en cada arranque: la primera vez los crea, después no hace nada.
    await run(`
      INSERT INTO organization_members (organization_id, user_id, role)
      SELECT l.organization_id, l.owner_user_id, 'owner'
      FROM leagues l
      WHERE l.organization_id IS NOT NULL AND l.owner_user_id IS NOT NULL
      ON CONFLICT (organization_id, user_id) DO NOTHING
    `);
    await run(`
      INSERT INTO organization_members (organization_id, user_id, role)
      SELECT t.organization_id, t.owner_user_id, 'owner'
      FROM teams t
      WHERE t.organization_id IS NOT NULL AND t.owner_user_id IS NOT NULL
      ON CONFLICT (organization_id, user_id) DO NOTHING
    `);

    // Identidad de un jugador, independiente de si tiene cuenta de usuario o
    // no. user_id nace en NULL porque normalmente el jugador lo da de alta
    // un equipo/liga/estadístico, no el jugador mismo — más adelante puede
    // "reclamar" su perfil y ahí se llena user_id. UNIQUE(user_id) permite
    // muchos jugadores sin cuenta (NULL no choca con NULL en Postgres), pero
    // evita que una misma cuenta termine detrás de dos perfiles de jugador.
    await run(`
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        birth_date DATE,
        position TEXT,
        jersey_number INTEGER,
        photo_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_players_user ON players(user_id)`);

    // Historial de qué jugador estuvo en qué equipo y cuándo. Separada de
    // "players" a propósito: un jugador puede pasar por varios equipos a lo
    // largo del tiempo sin perder registro de los anteriores (end_date se
    // llena al cambiarlo de equipo, no se borra la fila). tournament_id es
    // opcional porque no todo roster se arma alrededor de un torneo
    // específico; season queda como texto libre ("2025", "2025-2026") para
    // no atarse todavía a un formato único de temporada.
    await run(`
      CREATE TABLE IF NOT EXISTS player_team_memberships (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        tournament_id INTEGER REFERENCES tournaments(id) ON DELETE SET NULL,
        season TEXT,
        jersey_number INTEGER,
        position TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        start_date DATE NOT NULL DEFAULT CURRENT_DATE,
        end_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_player_memberships_player ON player_team_memberships(player_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_player_memberships_team ON player_team_memberships(team_id)`);

    // Corrección: el roster de un jugador no vive solo a nivel equipo — vive
    // a nivel equipo + rama (categoría se deriva de branches.category_id,
    // no hace falta duplicarla aquí). Nullable a propósito, igual que
    // organization_id en la semana 1: nace vacía, las filas de prueba de la
    // semana 3 se quedan sin rama (se descartaron, no importa), y todo
    // roster nuevo desde ahora se crea siempre con branch_id.
    await run(`ALTER TABLE player_team_memberships ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE`);
    await run(`CREATE INDEX IF NOT EXISTS idx_player_memberships_branch ON player_team_memberships(branch_id)`);

    // Estadísticas de UN jugador en UN partido — acumulado por partido, no
    // jugada por jugada (eso es un salto de complejidad grande que hoy no
    // se justifica: no está resuelto quién ni cómo va a capturar los datos,
    // y agregar esa capa más adelante no obliga a rehacer esta tabla, solo
    // a sumar una nueva encima). 16 columnas fijas, cubren lo básico de
    // ataque, defensa y equipos especiales. UNIQUE(player_id, match_id)
    // evita capturar dos veces al mismo jugador en el mismo partido.
    await run(`
      CREATE TABLE IF NOT EXISTS player_match_stats (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        pass_completions INTEGER NOT NULL DEFAULT 0,
        pass_attempts INTEGER NOT NULL DEFAULT 0,
        pass_yards INTEGER NOT NULL DEFAULT 0,
        pass_td INTEGER NOT NULL DEFAULT 0,
        interceptions_thrown INTEGER NOT NULL DEFAULT 0,
        rush_attempts INTEGER NOT NULL DEFAULT 0,
        rush_yards INTEGER NOT NULL DEFAULT 0,
        rush_td INTEGER NOT NULL DEFAULT 0,
        receptions INTEGER NOT NULL DEFAULT 0,
        receiving_yards INTEGER NOT NULL DEFAULT 0,
        receiving_td INTEGER NOT NULL DEFAULT 0,
        tackles INTEGER NOT NULL DEFAULT 0,
        sacks INTEGER NOT NULL DEFAULT 0,
        interceptions_def INTEGER NOT NULL DEFAULT 0,
        field_goals_made INTEGER NOT NULL DEFAULT 0,
        extra_points_made INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(player_id, match_id)
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_player_match_stats_player ON player_match_stats(player_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_player_match_stats_match ON player_match_stats(match_id)`);

    // Inscripción explícita: "este equipo participa en esta rama". Antes
    // era una conclusión implícita (se detectaba porque el equipo ya tenía
    // partidos programados ahí) — ahora es una decisión que toma la liga,
    // ANTES de programar partidos o subir roster. Solo la liga inscribe
    // equipos (no hay auto-inscripción — se decidió explícitamente no
    // construirla). team_id puede repetirse en varias ramas de la misma
    // categoría (poco común) pero no dos veces en la misma rama.
    await run(`
      CREATE TABLE IF NOT EXISTS branch_teams (
        id SERIAL PRIMARY KEY,
        branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(branch_id, team_id)
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_branch_teams_branch ON branch_teams(branch_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_branch_teams_team ON branch_teams(team_id)`);

    // Mismo patrón que leagues.is_verified: lo pone únicamente el admin
    // desde /admin, nunca el dueño de la organización. Para "medio" es lo
    // que habilita dos cosas — aparecer en el directorio público del home,
    // y poder autoasignarse a partidos como transmisor. La verificación
    // certifica QUIÉN es el medio, no le da derechos sobre un partido en
    // particular — eso es una decisión consciente, no un descuido.
    await run(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE`);
    await run(`CREATE INDEX IF NOT EXISTS idx_organizations_verified ON organizations(is_verified)`);

    // Qué medio (verificado) transmite qué partido. Se autoasigna el medio
    // mismo, sin que la liga intervenga — la verificación (arriba) es el
    // único filtro. url es opcional: si el medio transmite cada partido en
    // un canal distinto, aquí va ese link específico; si no, el perfil del
    // medio (su website_url) sirve como referencia general. Independiente
    // de match.stream_links, que sigue siendo el link predeterminado del
    // equipo local — esto se muestra ADEMÁS, no lo reemplaza.
    await run(`
      CREATE TABLE IF NOT EXISTS match_broadcasts (
        id SERIAL PRIMARY KEY,
        match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(match_id, organization_id)
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_match_broadcasts_match ON match_broadcasts(match_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_match_broadcasts_org ON match_broadcasts(organization_id)`);

    // Fusión de tipos: 'supplier' se une a 'store' (ver comentario junto al
    // CREATE TABLE de organizations). Primero se migran los datos, luego se
    // reemplaza el CHECK constraint — en ese orden, porque si se reemplaza
    // primero el CHECK, la migración de datos fallaría al toparse con filas
    // 'supplier' que el nuevo CHECK ya no permite.
    await run(`UPDATE organizations SET type = 'store' WHERE type = 'supplier'`);
    await run(`ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_type_check`);
    await run(`ALTER TABLE organizations ADD CONSTRAINT organizations_type_check CHECK (type IN ('league', 'team', 'media', 'store', 'clinic', 'brand'))`);

    // Backfill: cualquier equipo que YA tenga un partido programado en una
    // rama (vía home_team_id/away_team_id) queda inscrito automáticamente
    // ahí — así no se pierde nada de lo que ya está armado. Solo alcanza a
    // los partidos ya conectados con sus equipos (home_team_id/away_team_id
    // no nulos); los que todavía usan solo el nombre en texto no se pueden
    // inferir con certeza, así que esos simplemente no generan inscripción
    // automática (se inscriben a mano desde la pestaña "Equipos" de la rama).
    await run(`
      INSERT INTO branch_teams (branch_id, team_id)
      SELECT DISTINCT m.branch_id, m.home_team_id
      FROM matches m
      WHERE m.branch_id IS NOT NULL AND m.home_team_id IS NOT NULL
      ON CONFLICT (branch_id, team_id) DO NOTHING
    `);
    await run(`
      INSERT INTO branch_teams (branch_id, team_id)
      SELECT DISTINCT m.branch_id, m.away_team_id
      FROM matches m
      WHERE m.branch_id IS NOT NULL AND m.away_team_id IS NOT NULL
      ON CONFLICT (branch_id, team_id) DO NOTHING
    `);

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

    // Ciudad de la sede — habilita accesos comerciales automáticos ligados al
    // partido (por ahora: botón de Hotel; a futuro, Vuelos) sin que un admin
    // tenga que configurar nada partido por partido. Como las sedes NO se
    // comparten entre ligas (venues.league_id), cada liga captura la ciudad
    // de sus propias sedes una sola vez, y todos sus partidos —pasados,
    // presentes y futuros— la heredan automáticamente vía venue_id.
    //
    // Se agrega nullable a propósito: ya existen sedes creadas antes de este
    // campo, así que un NOT NULL inmediato rompería la migración. El campo
    // se vuelve obligatorio a nivel de aplicación para sedes NUEVAS (ver
    // validateVenueFields en manage.js) desde ahora; la restricción NOT NULL
    // a nivel de base de datos se agrega en un paso aparte, una vez que las
    // sedes existentes se hayan completado (backfill).
    await run(`ALTER TABLE venues ADD COLUMN IF NOT EXISTS city TEXT`);

    // Siembra base de países. ON CONFLICT (code) DO NOTHING la vuelve segura
    // de correr en cada arranque: la primera vez los crea, después no hace
    // nada. Lista corta a propósito — se puede ampliar cuando haga falta,
    // sin que eso cuente como una migración especial.
    await run(`
      INSERT INTO countries (code, name) VALUES
        ('MX', 'México'),
        ('US', 'Estados Unidos'),
        ('CA', 'Canadá'),
        ('GT', 'Guatemala'),
        ('CO', 'Colombia'),
        ('AR', 'Argentina'),
        ('ES', 'España')
      ON CONFLICT (code) DO NOTHING
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
