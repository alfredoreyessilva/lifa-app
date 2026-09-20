import pg from 'pg';
import { HOY_MX } from '../utils/sqlDates.js';
import { decidirCandadoProduccion, hoyEnMexico } from '../utils/prodGuard.js';
import { TODOS_LOS_ROLES } from '../utils/orgRoles.js';

const { Pool } = pg;

// ── Candado contra escribir en producción desde local ──
//
// La regla 1 de CLAUDE.md —"nunca probar contra producción"— era hasta hoy
// solo texto. La DATABASE_URL local apunta a la base real, así que cualquier
// clic en localhost:5173 escribe filas de verdad y nada lo impide. Esto la
// convierte en mecanismo.
//
// Solo actúa con EVIDENCIA POSITIVA de que el arranque es local:
// `npm_lifecycle_event === 'dev'` (o sea, `npm run dev`) o NODE_ENV=development
// puesta a mano. Nunca por AUSENCIA de NODE_ENV, y la diferencia importa:
// Render corre `npm start` y en el repositorio no hay render.yaml que
// garantice que define NODE_ENV. Un candado que se dispara "cuando no dice
// production" tumbaría el servicio real el día que Render cambie ese default.
// El costo de equivocarse no es simétrico: de un lado se pierde una sesión
// local, del otro se cae la API.
//
// La señal es de npm y NO de node a propósito. La lectura obvia sería
// `process.execArgv.includes('--watch')`, y está MAL: el modo watch de Node
// relanza el programa en un proceso HIJO, y el hijo ve `execArgv` vacío.
// Se probó, no se supuso. (El hijo sí hereda `WATCH_REPORT_DEPENDENCIES=1`,
// pero eso es interno de Node y no hay promesa de que siga existiendo.)
// `npm_lifecycle_event` en cambio es npm quien la pone, vale 'dev' o 'start'
// según el script, y sobrevive al hijo de watch.
//
// El host de producción NO está escrito aquí: el repositorio es PÚBLICO. Sale
// de PROD_DATABASE_HOST, que vive en el .env, que sí está en .gitignore. Sin
// esa variable el candado no puede hacer nada — y entonces lo dice en voz
// alta en lugar de callarse, que es la otra forma de fallar.
//
// La salida de emergencia es ALLOW_PROD_DB con la FECHA DE HOY en México
// (ALLOW_PROD_DB=2026-09-19), no un "1". Un "1" olvidado en el .env deja el
// candado muerto para siempre y nadie se entera; una fecha deja de servir
// mañana sola. Misma idea que el resto del proyecto: que la garantía sea un
// dato, no la memoria de alguien.
//
// Lo que NO cubre, dicho de frente: `npm start` en local y los scripts de
// backend/scripts/ (que usan `pg` directo por la regla 3 y simulan por
// default). Cubre el accidente real, que es `npm run dev`.

// La decisión vive en utils/prodGuard.js, que es puro y sí lo prueba el CI.
// Aquí queda solo el efecto: avisar o negarse a arrancar.
function revisarQueNoSeaProduccion(databaseUrl) {
  const hoyMx = hoyEnMexico();
  const decision = decidirCandadoProduccion({
    databaseUrl,
    npmLifecycleEvent: process.env.npm_lifecycle_event,
    nodeEnv: process.env.NODE_ENV,
    prodHost: process.env.PROD_DATABASE_HOST,
    allowProdDb: process.env.ALLOW_PROD_DB,
    hoyMx,
  });

  if (decision.accion === 'pasar') return;

  if (decision.accion === 'avisar') {
    console.warn(decision.autorizado
      ? `[db] PRODUCCIÓN (${decision.host}) desde un arranque local, autorizado con ALLOW_PROD_DB=${hoyMx}. ` +
        'Todo lo que escribas es real.'
      : `[db] Arranque local sin PROD_DATABASE_HOST: no hay candado. Conectando a ${decision.host || '(host ilegible)'}. ` +
        'Si esa es la base real, todo lo que hagas desde localhost se escribe de verdad. ' +
        'Define PROD_DATABASE_HOST en backend/.env para que esto deje de ser un aviso y sea un candado.');
    return;
  }

  throw new Error(
    `Este arranque es local y DATABASE_URL apunta a PRODUCCIÓN (${decision.host}).\n` +
    '\n' +
    'Para cualquier prueba que escriba, crea una rama en Neon (Branches → New\n' +
    'branch, copia instantánea) y apunta DATABASE_URL ahí. Es la regla 1 de\n' +
    'CLAUDE.md y lo que exige backend/tests/README.md para las suites e2e.\n' +
    '\n' +
    'Si de verdad tienes que tocar producción desde local, pásalo en la línea de\n' +
    'comandos para esta corrida (no lo escribas en el .env, ahí se olvida\n' +
    `encendido):  $env:ALLOW_PROD_DB="${hoyMx}"; npm run dev`
  );
}

let pool;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'Falta la variable de entorno DATABASE_URL. Define la cadena de conexión de Postgres (Neon) antes de iniciar el servidor.'
      );
    }
    // Se revisa aquí y no al importar el módulo: en ESM los imports se
    // evalúan ANTES del cuerpo de server.js, o sea antes de dotenv.config(),
    // y ahí process.env todavía no tiene lo del .env. getPool() corre cuando
    // initSchema() pide la primera conexión, que ya es después.
    revisarQueNoSeaProduccion(process.env.DATABASE_URL);

    // Tamaño y tiempos del pool explícitos, no los de fábrica de `pg`:
    //  - `max`: Render (plan gratuito) corre una sola instancia, así que 10
    //    conexiones alcanzan de sobra y quedan muy por debajo del límite de
    //    Neon. Si algún día hay varias instancias, bajar este número o usar
    //    el endpoint con pooler de Neon — configurable con PG_POOL_MAX para
    //    no tener que tocar el código.
    //  - `connectionTimeoutMillis`: el default de `pg` es 0 = esperar para
    //    siempre. Con Neon durmiéndose tras inactividad, eso deja peticiones
    //    colgadas sin respuesta; mejor fallar en 10s con un error claro.
    //  - `idleTimeoutMillis`: cerramos nosotros las conexiones ociosas antes
    //    de que Neon las corte de su lado.
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // No es decorativo, pero tampoco manda: cuando DATABASE_URL trae
      // ?sslmode=..., `pg` parsea la cadena y PISA este objeto
      // (Object.assign en connection-parameters.js), así que el valor real
      // sale de la URL. Solo se usa si la cadena viene SIN sslmode — y ahí
      // `true` es lo que evita conectar sin validar el certificado.
      //
      // Decía `false`, que pedía justo lo contrario. No tenía efecto porque
      // sslmode=require se traduce hoy a verify-full, pero en pg v9 ese mismo
      // `require` pasa a significar "cifra y no valides" (semántica libpq):
      // la validación se habría apagado sola en un `npm update`, sin que
      // cambiara una línea. Por eso la URL dice verify-full y esto dice true.
      ssl: { rejectUnauthorized: true },
      max: Number(process.env.PG_POOL_MAX) || 10,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });

    // Sin este manejador, un error en una conexión *ociosa* (típico cuando
    // Neon duerme y corta del otro lado) se emite como evento 'error' sin
    // escucha en el Pool, y eso tira el proceso entero de Node. Con esto solo
    // se descarta esa conexión: el pool abre otra en la siguiente consulta.
    pool.on('error', (err) => {
      console.error('[db] Error en conexión ociosa del pool:', err.message);
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
  league_id INTEGER REFERENCES leagues(id) ON DELETE CASCADE,
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
  // si corren dos instancias del servidor a la vez (Render escalando por
  // tráfico, o un redeploy donde la vieja y la nueva coinciden un instante),
  // la segunda se ESPERA aquí hasta que la primera termine, en vez de correr
  // las migraciones ambas al mismo tiempo. Es "advisory" porque no bloquea
  // ninguna tabla real, solo es una bandera que todas las instancias respetan.
  //
  // ── Por qué de TRANSACCIÓN y no de sesión ──
  //
  // La primera versión usaba pg_advisory_lock(), que vive en la SESIÓN. Eso es
  // incompatible con el endpoint que usamos de Neon: la cadena de conexión
  // apunta al **pooler** (PgBouncer en modo transacción), donde "sesión" no
  // significa una conexión propia — el pooler reparte conexiones de servidor
  // entre clientes al terminar cada transacción. Resultado real, visto en la
  // base: el lock quedó tomado en una conexión que después volvió al pool y
  // siguió atendiendo consultas normales de la app, ociosa y con el candado
  // puesto. La siguiente migración se habría quedado esperando **para
  // siempre**, y con ella el arranque del servidor.
  //
  // pg_advisory_xact_lock() se suelta solo al terminar la transacción, pase lo
  // que pase — commit, rollback, o que se caiga el proceso. No hay forma de
  // filtrarlo, y el pooler mantiene la misma conexión de servidor durante toda
  // la transacción, que es justo lo que este candado necesita.
  const MIGRATION_LOCK_KEY = 727272; // número arbitrario, solo debe ser el mismo en todas las instancias

  const client = await getPool().connect();

  // Cada migración va dentro de su propio SAVEPOINT. Sin esto, meter todo en
  // una transacción cambiaría el comportamiento: en Postgres, UNA instrucción
  // fallida aborta la transacción entera y todas las siguientes revientan con
  // "current transaction is aborted". Con savepoint, una migración que falla
  // (porque ya se había aplicado, típicamente) se deshace sola y el resto
  // sigue igual que antes.
  async function run(sql) {
    try {
      // Las tres instrucciones viajan en UN solo mensaje, no en tres. No es
      // microoptimización: son ~150 migraciones y cada viaje de ida y vuelta a
      // Neon cuesta ~100ms, así que separarlas le sumaba medio minuto a cada
      // arranque en frío. Se puede porque ninguna migración lleva parámetros
      // (todas son SQL literal), que es lo que habilita el protocolo simple.
      await client.query(`SAVEPOINT paso; ${sql}; RELEASE SAVEPOINT paso;`);
    } catch {
      // mismo comportamiento de antes: si una migración puntual falla
      // (ej. ya existía), no se detiene el resto del arranque. El SAVEPOINT ya
      // se creó aunque la instrucción de en medio reventara, así que deshacer
      // hasta él deja la transacción sana para la migración siguiente.
      await client.query('ROLLBACK TO SAVEPOINT paso').catch(() => {});
    }
  }

  try {
    await client.query('BEGIN');

    // Si otra instancia está migrando, aquí se espera. El tope evita que un
    // candado atorado cuelgue el arranque en silencio: prefiere fallar con un
    // error que se vea en los logs a quedarse esperando sin decir nada.
    await client.query("SET LOCAL lock_timeout = '60s'");
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);

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
    // Fase 3 — más control de avisos ya enviados por partido:
    //   notified_final         → push del marcador final ya se mandó a los seguidores.
    //   reminded_missing_score → ya se avisó a la liga que un partido FINALIZADO no tiene marcador.
    //   reminded_not_started   → ya se avisó a la liga que un partido PROGRAMADO pasó su fecha sin tocarse.
    // Los dos "reminded_*" son de una sola vez (decisión de producto): se marcan TRUE al enviar
    // y el cronjob nunca vuelve a mirar ese partido. La consulta del cron además se limita a
    // partidos de los últimos 2 días, para que al desplegar esto no se dispare un aluvión de
    // avisos históricos ni se escanee la tabla completa en cada corrida.
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS notified_final BOOLEAN NOT NULL DEFAULT FALSE`);
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS reminded_missing_score BOOLEAN NOT NULL DEFAULT FALSE`);
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS reminded_not_started BOOLEAN NOT NULL DEFAULT FALSE`);

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

    // CURP / documento de identidad del jugador. Opcional (nullable): muchos
    // jugadores se dan de alta sin él y se completa después. Se usa además
    // como clave para no duplicar a un jugador al re-subir la plantilla de
    // roster (si dos filas traen el mismo CURP, la segunda se omite).
    await run(`ALTER TABLE players ADD COLUMN IF NOT EXISTS curp TEXT`);

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

    // Verificación de correo: no bloquea nada de lo que ya existe (login por
    // contraseña sigue funcionando igual). DEFAULT TRUE a propósito: así
    // ninguna cuenta ya creada antes de este cambio queda marcada de la nada
    // como "sin verificar" — el registro nuevo (routes/auth.js) inserta
    // explícitamente FALSE para las cuentas que sí deben verificar, y el
    // login con Google inserta explícitamente TRUE (Google ya lo confirmó).
    await run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE`);

    // Identidad de Google (el "sub" del token), solo para cuentas creadas o
    // vinculadas con "Continuar con Google". NULL para cuentas normales.
    await run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE`);

    // Nullable desde ahora: una cuenta creada solo con Google no tiene
    // contraseña propia. Las cuentas existentes conservan su hash intacto.
    await run(`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`);

    // Códigos de un solo uso para confirmar que el dueño de la cuenta
    // controla ese correo. Tabla aparte (no una columna en "users") porque
    // puede haber varios códigos pedidos en el tiempo (reenvíos) y así el
    // histórico no se pisa — solo el más reciente y no vencido cuenta al
    // verificar (ver routes/auth.js).
    await run(`
      CREATE TABLE IF NOT EXISTS email_verification_codes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_codes(user_id)`);

    // Inventario por organización — hoy pensado para type='store', pero no
    // se restringe a nivel de esquema por si a futuro una 'clinic' quiere
    // listar paquetes/servicios con el mismo shape. La relación es 1
    // organization -> N products, igual que organization -> N teams.
    await run(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        price NUMERIC,
        currency TEXT NOT NULL DEFAULT 'MXN',
        stock INTEGER,
        size_variant TEXT,
        image_url TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_products_org ON products(organization_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_products_org_active ON products(organization_id, is_active)`);

    // Separado de is_active a propósito: is_active dice "esto existe y se
    // vende" (lo consulta el bot de WhatsApp, que debe ver TODO el
    // inventario activo para atender cualquier pregunta del cliente, sea
    // o no del nicho). show_on_platform dice "esto aparece en el
    // directorio público de CFBAMX" — para tiendas que venden más allá
    // de fútbol americano y no quieren mostrar ahí lo que no aplica.
    // Default TRUE: no le agrega fricción a la mayoría de tiendas (donde
    // casi todo su catálogo SÍ es del nicho); solo desactivan lo que no.
    await run(`ALTER TABLE products ADD COLUMN IF NOT EXISTS show_on_platform BOOLEAN NOT NULL DEFAULT TRUE`);

    // Plan y datos de WhatsApp por organización. Por ahora el cobro es
    // manual (transferencia/PayPal fuera de la plataforma) y un admin
    // activa/renueva el plan a mano desde /admin — por eso plan_expires_at
    // es una fecha simple y no hay tabla de facturación todavía. Cuando se
    // integre un cobro automático (Stripe/Conekta), este mismo campo es el
    // que esa integración va a actualizar; no hace falta cambiar el resto
    // del código que ya lo consulta (ej. el gate del webhook del bot).
    await run(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'`);
    await run(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMP`);
    await run(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id TEXT`);
    await run(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS whatsapp_display_number TEXT`);

    // Notificaciones dentro de la app (pantalla "Notificaciones"), separadas
    // de push_subscriptions: aquéllas son suscripciones a avisos push del
    // navegador sobre partidos; esta tabla es la bandeja propia de cada
    // organización administrada (liga o equipo) dentro de la plataforma.
    // recipient_type/recipient_id apuntan a leagues.id o teams.id según el
    // caso — mismo criterio de "kind" que ya usa Notifications.jsx en el
    // frontend (liga/equipo), para poder listar ambos tipos sin dos tablas.
    // "data" queda como JSONB libre para que futuros tipos de notificación
    // (además de 'team_claimed') puedan cargar lo que necesiten sin volver
    // a alterar el esquema.
    await run(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        recipient_type TEXT NOT NULL CHECK (recipient_type IN ('league', 'team')),
        recipient_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        data JSONB,
        read_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_type, recipient_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread ON notifications(recipient_type, recipient_id) WHERE read_at IS NULL`);

    // Siembra base de países.
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

    // Soporte para preferencias granulares de notificación y modo in-app sin push
    await run(`ALTER TABLE push_subscriptions ALTER COLUMN endpoint DROP NOT NULL`).catch(() => {});
    await run(`ALTER TABLE push_subscriptions ALTER COLUMN p256dh DROP NOT NULL`).catch(() => {});
    await run(`ALTER TABLE push_subscriptions ALTER COLUMN auth DROP NOT NULL`).catch(() => {});
    await run(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS in_app BOOLEAN DEFAULT TRUE`);
    await run(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN DEFAULT FALSE`);
    await run(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS notify_upcoming BOOLEAN DEFAULT TRUE`);
    await run(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS notify_live BOOLEAN DEFAULT TRUE`);
    await run(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS notify_final BOOLEAN DEFAULT TRUE`);
    await run(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS notify_changes BOOLEAN DEFAULT TRUE`);
    await run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_push_user_sub
      ON push_subscriptions (user_id, COALESCE(league_id, 0), COALESCE(match_id, 0), COALESCE(team_name, ''))
      WHERE user_id IS NOT NULL
    `);

    // Impresiones/clics por patrocinador (eventos 'sponsor_impression' y
    // 'sponsor_click' en track.js), para poder mostrarle a cada patrocinador
    // cuánta gente vio su logo y cuánta le dio clic. NULL para el resto de
    // eventos (ej. 'home_view'), que no están ligados a un patrocinador.
    await run(`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS sponsor_id INTEGER REFERENCES sponsors(id) ON DELETE CASCADE`);
    await run(`CREATE INDEX IF NOT EXISTS idx_page_views_sponsor ON page_views(sponsor_id, event_type)`);

    // Identificador anónimo por navegador (generado y guardado en
    // localStorage desde el cliente, ver api/client.js) para poder contar
    // visitantes ÚNICOS y no solo el total de vistas. No es un dato
    // personal — es un id al azar sin dueño conocido, igual de anónimo que
    // el resto de esta tabla — por eso puede quedar NULL para quien tenga
    // localStorage bloqueado, sin que se le rechace el evento.
    await run(`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS visitor_id TEXT`);
    await run(`CREATE INDEX IF NOT EXISTS idx_page_views_visitor ON page_views(event_type, visitor_id)`);

    // País de la liga — por ahora solo se usa para exigir un estado de la
    // lista fija de México (ver MEXICO_STATES en routes/leagues.js); el
    // resto de países sigue sin selector de estado. Las ligas ya existentes
    // se asumen de México (hoy el 100% de los datos lo son, mismo criterio
    // que se usó para "organizations").
    await run(`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS country_id INTEGER REFERENCES countries(id) ON DELETE SET NULL`);
    await run(`
      UPDATE leagues SET country_id = (SELECT id FROM countries WHERE code = 'MX')
      WHERE country_id IS NULL
    `);

    // Varios estados por liga (arreglo jsonb, mismo patrón que
    // home_stream_links) — una liga real casi siempre opera en más de un
    // estado, así que un solo texto se quedaba corto. Solo se llena cuando
    // el país es México (ver MEXICO_STATES en routes/leagues.js); el resto
    // de países sigue sin selector, así que queda como arreglo vacío.
    await run(`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS states JSONB NOT NULL DEFAULT '[]'::jsonb`);
    // El "state" de texto libre que ya tenían las ligas (escrito a mano
    // desde siempre, ej. "Nacional", "CDMX") NO se migra a "states": no es
    // confiable contra la lista fija de MEXICO_STATES, así que casi
    // ninguna liga tendría un estado real seleccionado si lo copiáramos
    // tal cual. Solo se migra cuando ese texto coincide EXACTO con un
    // estado válido de la lista.
    await run(`
      UPDATE leagues
      SET states = jsonb_build_array(state)
      WHERE jsonb_array_length(states) = 0
        AND country_id = (SELECT id FROM countries WHERE code = 'MX')
        AND state IN (
          'AGUASCALIENTES', 'BAJA CALIFORNIA', 'BAJA CALIFORNIA SUR', 'CAMPECHE',
          'CHIAPAS', 'CHIHUAHUA', 'CIUDAD DE MÉXICO', 'COAHUILA', 'COLIMA', 'DURANGO',
          'ESTADO DE MÉXICO', 'GUANAJUATO', 'GUERRERO', 'HIDALGO', 'JALISCO', 'MICHOACÁN',
          'MORELOS', 'NAYARIT', 'NUEVO LEÓN', 'OAXACA', 'PUEBLA', 'QUERÉTARO', 'QUINTANA ROO',
          'SAN LUIS POTOSÍ', 'SINALOA', 'SONORA', 'TABASCO', 'TAMAULIPAS', 'TLAXCALA',
          'VERACRUZ', 'YUCATÁN', 'ZACATECAS'
        )
    `);
    // Limpia lo que alcanzó a quedar mal de una versión anterior de esta
    // misma migración, que copiaba "state" a "states" sin validar contra la
    // lista — deja cualquier arreglo con al menos un valor inválido en
    // blanco otra vez, para que se vea como "sin estado seleccionado" en
    // vez de un valor a medias que además rompe la validación al editar.
    await run(`
      UPDATE leagues
      SET states = '[]'::jsonb
      WHERE jsonb_array_length(states) > 0
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(states) AS elem
          WHERE elem NOT IN (
            'AGUASCALIENTES', 'BAJA CALIFORNIA', 'BAJA CALIFORNIA SUR', 'CAMPECHE',
            'CHIAPAS', 'CHIHUAHUA', 'CIUDAD DE MÉXICO', 'COAHUILA', 'COLIMA', 'DURANGO',
            'ESTADO DE MÉXICO', 'GUANAJUATO', 'GUERRERO', 'HIDALGO', 'JALISCO', 'MICHOACÁN',
            'MORELOS', 'NAYARIT', 'NUEVO LEÓN', 'OAXACA', 'PUEBLA', 'QUERÉTARO', 'QUINTANA ROO',
            'SAN LUIS POTOSÍ', 'SINALOA', 'SONORA', 'TABASCO', 'TAMAULIPAS', 'TLAXCALA',
            'VERACRUZ', 'YUCATÁN', 'ZACATECAS'
          )
        )
    `);

    // ─────────────────────────────────────────────────────────────────────────
    // Cobranza liga → equipos ("estado de cuenta"). Libro append-only por
    // (liga, equipo): la liga registra cargos (renta de campo, arbitraje,
    // transmisión, inscripción, multas…) y los pagos que recibe. El saldo NO
    // se guarda: se calcula sumando movimientos (ver routes/billing.js).
    //
    // Reglas del libro:
    //  - Un movimiento no se edita ni se borra nunca.
    //  - Un cargo/pago mal hecho se "cancela": se marca status='void' (solo
    //    para que deje de disparar recordatorios) y se inserta una fila
    //    'adjustment' que revierte el monto (direction 'credit'/'debit').
    //  - 'batch_id' agrupa los cargos creados en un mismo alta en bloque, para
    //    poder repetirlos la jornada siguiente con un clic.
    // ─────────────────────────────────────────────────────────────────────────
    await run(`
      CREATE TABLE IF NOT EXISTS team_ledger_entries (
        id SERIAL PRIMARY KEY,
        league_id  INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        team_id    INTEGER NOT NULL REFERENCES teams(id)   ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN ('charge', 'payment', 'adjustment')),
        category   TEXT,
        concept    TEXT NOT NULL,
        amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
        currency   TEXT NOT NULL DEFAULT 'MXN',
        due_date   DATE,
        week_label TEXT,
        status     TEXT NOT NULL DEFAULT 'open',
        direction  TEXT CHECK (direction IN ('credit', 'debit')),
        payment_method TEXT,
        reference  TEXT,
        proof_url  TEXT,
        note       TEXT,
        batch_id   TEXT,
        reverses_entry_id  INTEGER REFERENCES team_ledger_entries(id) ON DELETE SET NULL,
        created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by_side    TEXT NOT NULL DEFAULT 'league' CHECK (created_by_side IN ('league', 'team')),
        voided_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        voided_at  TIMESTAMP,
        reminded_due_soon        BOOLEAN NOT NULL DEFAULT FALSE,
        overdue_reminder_count   INTEGER NOT NULL DEFAULT 0,
        last_overdue_reminder_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_ledger_team   ON team_ledger_entries(team_id, created_at)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_ledger_league ON team_ledger_entries(league_id, status)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_ledger_batch  ON team_ledger_entries(batch_id)`);
    await run(`
      CREATE INDEX IF NOT EXISTS idx_ledger_due
      ON team_ledger_entries(due_date)
      WHERE kind = 'charge' AND status = 'open'
    `);

    // Interruptor por liga para los recordatorios automáticos de cobranza
    // (cargo por vencer / vencido). Nace apagado: la liga lo prende cuando ya
    // cargó a sus equipos y quiere que la plataforma les recuerde sola.
    await run(`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS billing_reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE`);

    // Equipos independientes: un equipo ya no depende de pertenecer a una
    // liga para existir en la plataforma (ej. equipos que buscan
    // representación de medios/proveedores sin afiliarse a ninguna liga
    // todavía). league_id se queda como está para todo equipo que ya tenga
    // una liga de origen — solo se vuelve opcional para los que se registren
    // sin una (ver POST /manage/teams). El CREATE TABLE de arriba ya no
    // exige NOT NULL para bases nuevas; este ALTER es para las que ya
    // existían con la restricción vieja.
    await run(`ALTER TABLE teams ALTER COLUMN league_id DROP NOT NULL`);

    // "¿Aparece en el home?" para un equipo INDEPENDIENTE es decisión propia
    // del equipo, sin aprobación de nadie de por medio — mismo criterio que
    // products.show_on_platform, no el de leagues.is_public/publish_requested
    // (esos sí pasan por un admin). Un equipo que SÍ tiene liga sigue
    // apareciendo exactamente igual que hoy (por ser miembro del roster de
    // una liga pública, ver /leagues/all-teams) sin que este campo le afecte
    // en nada. Nace en FALSO: un equipo independiente nuevo no aparece en el
    // home hasta que su representante lo pida expresamente desde su panel —
    // no se le limita ninguna otra función de la plataforma por seguir así.
    await run(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS show_on_platform BOOLEAN NOT NULL DEFAULT FALSE`);
    await run(`CREATE INDEX IF NOT EXISTS idx_teams_show_on_platform ON teams(show_on_platform) WHERE league_id IS NULL`);

    // Invitaciones de tipo 'org_admin': a diferencia de 'team' (que
    // REEMPLAZA al representante en teams.owner_user_id), esta agrega a
    // quien la reclama como un miembro más de organization_members — así
    // una liga o equipo puede tener varios administradores con acceso
    // simultáneo, no solo un dueño único. organization_id apunta a la
    // organización (de la liga o del equipo, ambas ya tienen una) que se
    // está invitando a administrar.
    await run(`ALTER TABLE invites ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE`);
    await run(`CREATE INDEX IF NOT EXISTS idx_invites_organization ON invites(organization_id)`);

    // ─────────────────────────────────────────────────────────────────────────
    // Aquí vivían `player_ledger_entries` y `team_player_accounts`: la primera
    // versión de la cobranza equipo → jugador, cuando el cliente del club era
    // una fila en `players`. Las reemplazaron `club_members` y
    // `club_ledger_entries` más abajo — ver "SEPARACIÓN DE FONDO".
    //
    // Sus CREATE se quitaron de aquí a propósito: mientras estuvieran, cada
    // arranque del servidor volvía a crear las tablas vacías después de
    // borrarlas, y nunca se acababa de limpiar. Una base nueva ya no las tiene.
    //
    // En una base que YA las tenga siguen ahí, con sus datos, hasta que alguien
    // corra scripts/cleanup-legacy-club-padron.mjs — que simula por defecto y
    // avisa si encuentra movimientos que no sean de prueba. No se dropean desde
    // aquí porque una tabla de dinero no se borra como efecto secundario de
    // reiniciar un servidor.
    // ─────────────────────────────────────────────────────────────────────────

    // Interruptor por equipo para los recordatorios automáticos de cuotas,
    // equivalente a leagues.billing_reminders_enabled. Nace apagado: el club
    // lo prende cuando ya cargó sus cuotas y quiere que la plataforma le
    // avise sola de los vencidos.
    await run(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS player_billing_reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE`);

    // Color de marca del club, para que su panel de trabajo se sienta suyo y
    // no una pantalla genérica. Nullable: en NULL el panel usa el amarillo de
    // CFBAMX (--flag). Es solo acento de UI — no se usa en el sitio público.
    await run(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS brand_color TEXT`);

    // ─────────────────────────────────────────────────────────────────────────
    // SEPARACIÓN DE FONDO: el cliente del club deja de ser un `players`.
    //
    // La versión anterior ya decía que el padrón del club es independiente del
    // roster de torneo, y en cuanto a FILAS lo era: importar del roster creaba
    // una persona nueva, no reusaba la misma. Pero las dos poblaciones seguían
    // viviendo en la tabla `players`, y eso traía tres problemas reales:
    //
    //   1. Nada en la fila decía a qué mundo pertenecía. La separación existía
    //      solo porque ninguna consulta los cruzaba — un acuerdo tácito, no una
    //      regla que la base impusiera.
    //   2. `GET /players/:id/card` es público y servía CUALQUIER fila de
    //      `players`, así que los clientes del padrón —nombre, fecha de
    //      nacimiento, CURP, foto, en buena parte menores de edad— eran
    //      consultables adivinando un id. Ya se cortó en players.js, pero la
    //      causa de raíz era compartir tabla.
    //   3. `players.first_name`/`last_name` son NOT NULL, y eso le imponía al
    //      club una formalidad que no tiene: cuando registra a alguien puede
    //      conocerlo nada más por su apodo, y el tesorero tenía que inventarle
    //      un apellido para poder guardarlo.
    //
    // Son dos cosas distintas y ahora lo son también en el esquema:
    //
    //   players        → quién puede jugar en qué rama de qué torneo. Lo arma
    //                    la liga, sirve para elegibilidad, y pide datos
    //                    formales (nombre, apellido, CURP) porque de eso
    //                    depende que un partido no se proteste.
    //   club_members   → a quién le cobra el club. Lo arma el club, es su
    //                    relación comercial con una familia, y admite el nivel
    //                    de informalidad que esa relación tiene de verdad.
    //
    // Las tablas viejas (`team_player_accounts`, `player_ledger_entries`) ya no
    // se crean aquí, pero tampoco se dropean desde una migración: una tabla de
    // dinero no se borra como efecto secundario de reiniciar un servidor. En
    // una base que ya las tenga siguen ahí hasta que alguien corra
    // scripts/cleanup-legacy-club-padron.mjs, que simula por defecto.
    // ─────────────────────────────────────────────────────────────────────────
    await run(`
      CREATE TABLE IF NOT EXISTS club_members (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,

        -- UN solo campo de nombre, a diferencia de players.first_name/last_name.
        -- Es lo que el club escriba: "Juan Pérez", "El Güero", "Sofía (hija de
        -- Marta)". Lo único obligatorio de una persona aquí.
        display_name TEXT NOT NULL,

        -- Todo lo demás de identidad es opcional de verdad. Un club puede
        -- cobrarle a alguien de quien solo sabe el apodo y el teléfono de su mamá.
        birth_date    DATE,
        curp          TEXT,
        photo_url     TEXT,
        position      TEXT,
        jersey_number INTEGER,

        -- La relación comercial con este club.
        monthly_amount NUMERIC(12,2),
        status TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'baja', 'beca')),
        group_label TEXT,
        tutor_name  TEXT,
        tutor_phone TEXT,
        tutor_email TEXT,
        note        TEXT,

        -- Link del estado de cuenta público que el papá abre sin tener cuenta.
        share_token TEXT UNIQUE NOT NULL,

        joined_date      DATE,
        last_reminded_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_club_members_team ON club_members(team_id)`);

    // El libro de cuotas del club. Misma forma que player_ledger_entries
    // (append-only, cancelación por reversa, saldo calculado) pero colgado de
    // club_members, no de players: así el dinero del club no puede quedar
    // atado a una fila del roster de torneo ni desaparecer si la liga mueve a
    // alguien de rama.
    await run(`
      CREATE TABLE IF NOT EXISTS club_ledger_entries (
        id SERIAL PRIMARY KEY,
        team_id   INTEGER NOT NULL REFERENCES teams(id)        ON DELETE CASCADE,
        member_id INTEGER NOT NULL REFERENCES club_members(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN ('charge', 'payment', 'adjustment')),
        category   TEXT,
        concept    TEXT NOT NULL,
        amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
        currency   TEXT NOT NULL DEFAULT 'MXN',
        due_date   DATE,
        period_label TEXT,
        status     TEXT NOT NULL DEFAULT 'open',
        direction  TEXT CHECK (direction IN ('credit', 'debit')),
        payment_method TEXT,
        reference  TEXT,
        proof_url  TEXT,
        note       TEXT,
        batch_id   TEXT,
        reverses_entry_id  INTEGER REFERENCES club_ledger_entries(id) ON DELETE SET NULL,
        created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        -- 'player' y no 'member' a propósito: es el mismo valor que ya viaja en
        -- la API y que lee el frontend (TeamOverviewSection distingue el
        -- movimiento que reportó el papá). Renombrarlo aquí sería un cambio de
        -- contrato disfrazado de migración.
        created_by_side    TEXT NOT NULL DEFAULT 'team' CHECK (created_by_side IN ('team', 'player')),
        provider            TEXT,
        provider_payment_id TEXT,
        fee_amount          NUMERIC(12,2),
        voided_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        voided_at  TIMESTAMP,
        reminded_due_soon        BOOLEAN NOT NULL DEFAULT FALSE,
        overdue_reminder_count   INTEGER NOT NULL DEFAULT 0,
        last_overdue_reminder_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_club_ledger_team   ON club_ledger_entries(team_id, created_at)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_club_ledger_member ON club_ledger_entries(member_id, created_at)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_club_ledger_batch  ON club_ledger_entries(batch_id)`);
    await run(`
      CREATE INDEX IF NOT EXISTS idx_club_ledger_due
      ON club_ledger_entries(due_date)
      WHERE kind = 'charge' AND status = 'open' AND due_date IS NOT NULL
    `);

    // La primera versión de la tabla salió con CHECK (... IN ('team','member')),
    // y el código escribe 'player' — así que todo pago reportado desde el link
    // público reventaba contra el constraint. `CREATE TABLE IF NOT EXISTS` no
    // corrige una tabla que ya existe, así que el constraint se rehace aquí.
    // El par DROP IF EXISTS + ADD sí es idempotente (ADD por sí solo no lo es).
    await run(`ALTER TABLE club_ledger_entries DROP CONSTRAINT IF EXISTS club_ledger_entries_created_by_side_check`);
    await run(`
      ALTER TABLE club_ledger_entries
      ADD CONSTRAINT club_ledger_entries_created_by_side_check
      CHECK (created_by_side IN ('team', 'player'))
    `);

    // ── Ciclo de mensualidad automática ──────────────────────────────────
    //
    // Reemplaza al botón "Repetir el mes pasado", que le volvía a cobrar a
    // quien ya estaba de baja y no impedía generar el mismo mes dos veces.
    // El club define UNA fecha (el día en que se paga) y el cargo nace solo,
    // cinco días antes, para todo miembro activo con cuota definida.
    await run(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS monthly_charge_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
    await run(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS monthly_charge_day INTEGER`);

    // Fecha en que el club encendió el ciclo. Es el candado contra generar
    // meses retroactivos: nunca se genera un periodo cuya fecha de pago sea
    // anterior a esta. Sin él, un club que lleva un año en la app y prende el
    // interruptor hoy recibiría doce meses de cargos inventados.
    await run(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS monthly_charge_started_on DATE`);

    // 1–28 y no 1–31: elimina de raíz el caso borde de febrero y de los meses
    // de 30 días. "El último día del mes" no existe en esta versión.
    // DROP + ADD porque ADD por sí solo no es idempotente (mismo idiom que arriba).
    await run(`ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_monthly_charge_day_check`);
    await run(`
      ALTER TABLE teams
      ADD CONSTRAINT teams_monthly_charge_day_check
      CHECK (monthly_charge_day IS NULL OR (monthly_charge_day BETWEEN 1 AND 28))
    `);

    // Identidad del cargo que generó el ciclo: 'mensualidad:OCT-2026'.
    // NULL en todo lo que capturó un humano.
    //
    // El índice parcial de abajo es la ÚNICA garantía de que no se cobre dos
    // veces el mismo mes. No se confía al código porque el cron y el panel
    // pueden generar a la vez: con el índice, la segunda sentencia salta las
    // filas en conflicto; con una comprobación en JS habría ventana de carrera.
    //
    // Dos decisiones de la forma del índice:
    //
    //  1. El predicado es INMUTABLE (auto_cycle_key nunca cambia), así que una
    //     fila jamás sale del índice. Cancelar un cargo automático impide que
    //     se regenere — que es lo correcto para dinero: cancelar la mensualidad
    //     de octubre significa "esta persona no debe octubre", y el robot no le
    //     gana al humano. Si se filtrara por status, el cargo cancelado saldría
    //     del índice y la siguiente corrida lo reviviría.
    //  2. La columna nace NULL en el 100% de las filas existentes, así que el
    //     índice se crea sobre CERO filas y no puede fallar por duplicados
    //     históricos. Importa porque run() se traga los errores de cada
    //     migración (ver el SAVEPOINT de initSchema): un índice que fallara
    //     aquí no aparecería en ningún log y nadie se enteraría.
    //
    // Sin CONCURRENTLY a propósito: no puede correr dentro de un bloque de
    // transacción, y initSchema() envuelve todo en BEGIN.
    await run(`ALTER TABLE club_ledger_entries ADD COLUMN IF NOT EXISTS auto_cycle_key TEXT`);
    await run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_club_ledger_auto_cycle
      ON club_ledger_entries (team_id, member_id, auto_cycle_key)
      WHERE auto_cycle_key IS NOT NULL
    `);

    // ── La conferencia/grupo deja de capturarse partido por partido ──
    //
    // Hasta aquí, cada partido guardaba a mano su conference_id/group_id: el
    // mismo dato se volvía a elegir en cada juego (en ONEFA, 133 partidos =
    // cientos de selecciones repetidas). Pero eso es dato DERIVADO: el hecho
    // estable es "este equipo juega en esta conferencia", y la pertenencia
    // del partido es consecuencia de qué equipos lo juegan.
    //
    // Se registra entonces en branch_teams, que ya es la tabla que dice qué
    // equipos participan en cada rama. Queda naturalmente separado por
    // temporada sin trabajo extra: una rama cuelga de categoría -> torneo, y
    // el torneo tiene año, así que cambiar a un equipo de conferencia el año
    // que entra NO reescribe a qué conferencia perteneció el año pasado.
    await run(`ALTER TABLE branch_teams ADD COLUMN IF NOT EXISTS conference_id INTEGER REFERENCES conferences(id) ON DELETE SET NULL`);
    await run(`ALTER TABLE branch_teams ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL`);
    await run(`CREATE INDEX IF NOT EXISTS idx_branch_teams_conference ON branch_teams(conference_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_branch_teams_group ON branch_teams(group_id)`);

    // Excepción explícita: "este partido va en ESTA conferencia aunque sus
    // equipos digan otra cosa". Nace en NULL para todo lo que ya existe, así
    // que hoy no cambia nada — es la válvula de escape para un partido que de
    // verdad no sigue la regla (una final, un amistoso contra un invitado).
    //
    // Es columna NUEVA a propósito, en vez de reutilizar matches.conference_id:
    // esa columna vieja guarda lo que se capturó a mano durante la temporada
    // (incluidos los errores de dedo) y se conserva intacta como respaldo, no
    // se pisa ni se borra. Pasa a ser el ÚLTIMO recurso cuando no hay de dónde
    // derivar — ver resolveScopeSql() en utils/matchScope.js.
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS conference_override_id INTEGER REFERENCES conferences(id) ON DELETE SET NULL`);
    await run(`CREATE INDEX IF NOT EXISTS idx_matches_conference_override ON matches(conference_override_id)`);

    // ── Tabla de posiciones y modelo de competencia ──────────────────────
    //
    // Tres piezas que se agregan juntas porque una sin las otras no sirve:
    //
    //   1. `phases`  — qué se está jugando (regular, playoffs, amistoso). Sin
    //                  esto no se puede calcular una tabla: no se sabe qué
    //                  juegos cuentan.
    //   2. `titles`  — A QUÉ NIVEL se corona campeón esta rama. Es lo que
    //                  permite que NFL (campeón de división + de conferencia
    //                  + Super Bowl), ONEFA (dos campeones de conferencia y
    //                  NINGÚN campeón general) y LFA (un solo campeón) usen
    //                  el mismo modelo sin casos especiales.
    //   3. Configuración de la tabla en `branches` — en qué niveles se dibuja
    //                  y con qué reglamento de desempates.
    //
    // La jerarquía completa queda alineada con el modelo estándar de la
    // industria (Sportradar, SportMonks, IPTC SportsML):
    //   Liga → Torneo(año) → Categoría → Rama → [Conferencia] → [Grupo]
    //   con FASE como eje transversal y posiciones colgando de cualquier
    //   nivel — que es justo lo que SportsML resolvió en su versión 2.1.

    // Una fase del calendario de una rama. Cuelga de la rama (no de la
    // categoría) porque la rama es donde vive el calendario: los partidos ya
    // tienen branch_id.
    await run(`
      CREATE TABLE IF NOT EXISTS phases (
        id SERIAL PRIMARY KEY,
        branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'round_robin'
          CHECK (type IN (
            'round_robin', 'double_round_robin', 'groups', 'swiss',
            'single_elimination', 'double_elimination', 'series', 'exhibition'
          )),
        counts_for_standings BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_phases_branch ON phases(branch_id)`);

    // El partido apunta a su fase. Nullable A PROPÓSITO y para siempre: si
    // está en NULL, la fase se deriva de `week_label` ('PLAYOFF', 'FINAL',
    // 'SCRIMMAGE'…), que es donde vivía este dato hasta ahora. Así ninguna
    // liga tiene que migrar nada para que su tabla salga bien desde el primer
    // día — ver utils/matchPhase.js, mismo patrón que utils/matchScope.js.
    await run(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS phase_id INTEGER REFERENCES phases(id) ON DELETE SET NULL`);
    await run(`CREATE INDEX IF NOT EXISTS idx_matches_phase ON matches(phase_id)`);

    // Configuración de la tabla de posiciones, por rama.
    //
    // `standings_levels` — en qué niveles se dibuja tabla. Nace en ["branch"]
    //   (una sola tabla general) porque es el caso más común y el que no
    //   sorprende a nadie. Una liga con conferencias agrega "conference", una
    //   con grupos agrega "group".
    //
    // `tiebreakers` — la lista ORDENADA de criterios de desempate. Nace por
    //   juegos ganados (ganados → entre sí → diferencia de puntos), que es el
    //   orden más común en las ligas de esta app. Es configurable por rama
    //   porque no existe un orden universal: ONEFA y la NFL juegan el mismo
    //   deporte y ordenan distinto (una por ganados, la otra por porcentaje).
    //   Ver el catálogo completo en utils/standings.js.
    //
    // `tiebreaker_mode` — qué hacer cuando empatan TRES o más. 'restart'
    //   reinicia el reglamento desde el primer criterio en cuanto uno se
    //   separa, porque al irse ese equipo el universo "entre sí" ya son otros
    //   partidos. 'sequential' sigue con el criterio siguiente. No es un
    //   detalle: dan órdenes distintos sobre los mismos partidos.
    //
    // `points_win/draw/loss` — nullable. En NULL (el default) la tabla se
    //   ordena por % de ganados, como en americano. Con valores, se ordena por
    //   puntos, como en fútbol.
    await run(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS standings_levels JSONB NOT NULL DEFAULT '["branch"]'::jsonb`);
    await run(`
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS tiebreakers JSONB NOT NULL
      DEFAULT '["wins","h2h_wins","point_diff","points_for"]'::jsonb
    `);
    await run(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS tiebreaker_mode TEXT NOT NULL DEFAULT 'restart'`);
    // Reglamento propio por NIVEL de tabla, cuando el de la rama no alcanza.
    //
    // Hace falta porque una competencia con estructura no usa un solo
    // reglamento para todas sus tablas. En la NFL, por ejemplo, el empate
    // dentro de una división y el empate por un wild card NO se resuelven
    // igual: el segundo criterio de uno es el récord de división y el del
    // otro el de conferencia. Con una sola lista por rama, una de las dos
    // tablas sale mal por construcción.
    //
    // Es un mapa { nivel: { tiebreakers[], multi_team_mode } } y es OPCIONAL:
    // el nivel que no aparezca usa el reglamento de la rama. Así las ligas de
    // una sola tabla —la enorme mayoría— no se enteran de que esto existe.
    await run(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS tiebreakers_by_level JSONB`);
    await run(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS points_win INTEGER`);
    await run(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS points_draw INTEGER`);
    await run(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS points_loss INTEGER`);

    // El título: "en esta rama se corona campeón a este nivel".
    //
    //   scope      — dónde: toda la rama, cada conferencia, o cada grupo.
    //   decided_by — cómo: 'standings' (el primer lugar de la tabla, como el
    //                campeón de división de NFL) o 'match' (el ganador del
    //                partido decisivo de una fase, como una final).
    //
    // Los tres casos que pediste, con las mismas dos columnas:
    //   NFL   → 3 filas: (group, standings) + (conference, match) + (branch, match)
    //   ONEFA → 2 filas (conference, match), y NINGUNA con scope='branch'.
    //           Esa ausencia ES la representación de "no hay interconferencia":
    //           no hay campeón general porque nadie declaró ese título.
    //   LFA   → 1 fila: (branch, match).
    await run(`
      CREATE TABLE IF NOT EXISTS titles (
        id SERIAL PRIMARY KEY,
        branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('branch', 'conference', 'group')),
        decided_by TEXT NOT NULL DEFAULT 'match' CHECK (decided_by IN ('standings', 'match')),
        phase_id INTEGER REFERENCES phases(id) ON DELETE SET NULL,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_titles_branch ON titles(branch_id)`);

    // El campeón NO se guarda cuando sale solo: se deriva al leer (primer
    // lugar de la tabla, o ganador del partido de la fase final), igual que
    // la conferencia de un partido. Esta tabla guarda ÚNICAMENTE la
    // excepción: "el campeón es este otro, aunque los números digan lo
    // contrario" — un desempate por sorteo, una sanción, un título compartido.
    // Mismo papel que matches.conference_override_id.
    await run(`
      CREATE TABLE IF NOT EXISTS title_overrides (
        id SERIAL PRIMARY KEY,
        title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
        scope_id INTEGER,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        note TEXT,
        created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Un solo override por (título, alcance concreto). Van como DOS índices
    // parciales y no como un UNIQUE normal porque en Postgres dos NULL se
    // consideran distintos entre sí: un UNIQUE(title_id, scope_id) dejaría
    // meter varios campeones de rama (donde scope_id siempre es NULL).
    await run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_title_overrides_scoped
      ON title_overrides(title_id, scope_id) WHERE scope_id IS NOT NULL
    `);
    await run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_title_overrides_whole
      ON title_overrides(title_id) WHERE scope_id IS NULL
    `);

    // Clasificación: quién avanza de una fase a la siguiente. Es OTRA cosa
    // que el desempate — responde "grupos de 4, pasa el primero de cada uno",
    // el wild card de NFL, o los 8 mejores terceros del Mundial.
    //
    //   top_n       — cuántos avanzan de CADA tabla del alcance.
    //   plus_best_n — cuántos más, comparando entre sí a los que quedaron en
    //                 el MISMO lugar de tablas distintas.
    //   of_rank     — qué lugar se compara (3 = los mejores terceros).
    //
    // Esa segunda parte compara equipos que quizá nunca jugaron entre sí, así
    // que no puede usar "entre sí" y aplica criterios generales — que es
    // exactamente por qué FIFA cambia de reglamento al rankear terceros.
    await run(`
      CREATE TABLE IF NOT EXISTS phase_qualifications (
        id SERIAL PRIMARY KEY,
        phase_id INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
        from_scope TEXT NOT NULL DEFAULT 'branch'
          CHECK (from_scope IN ('branch', 'conference', 'group')),
        top_n INTEGER NOT NULL DEFAULT 1,
        plus_best_n INTEGER NOT NULL DEFAULT 0,
        of_rank INTEGER,
        target_phase_id INTEGER REFERENCES phases(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_phase_qual_phase ON phase_qualifications(phase_id)`);

    // ── Los nombres reales de los sistemas de competencia ────────────────
    //
    // La primera versión de `phases.type` usaba 'regular' / 'knockout' /
    // 'placement', que describen el PAPEL de la fase dentro del torneo, no
    // cómo se juega — y encima mezclaban ese papel con si la fase cuenta para
    // la tabla, que ya es una columna aparte. Ahora el tipo dice el SISTEMA DE
    // COMPETENCIA por su nombre (todos contra todos, eliminación directa,
    // sistema suizo…), que es un concepto que no le pertenece a ningún
    // deporte. Ver utils/matchPhase.js.
    //
    // El CHECK se rehace (DROP + ADD es idempotente; ADD solo, no) y los
    // valores viejos se traducen antes, para que ninguna fila quede fuera del
    // constraint nuevo.
    await run(`
      UPDATE phases SET type = CASE type
        WHEN 'regular'   THEN 'round_robin'
        WHEN 'knockout'  THEN 'single_elimination'
        WHEN 'placement' THEN 'single_elimination'
        ELSE type
      END
      WHERE type IN ('regular', 'knockout', 'placement')
    `);
    await run(`ALTER TABLE phases DROP CONSTRAINT IF EXISTS phases_type_check`);
    await run(`
      ALTER TABLE phases ADD CONSTRAINT phases_type_check CHECK (type IN (
        'round_robin', 'double_round_robin', 'groups', 'swiss',
        'single_elimination', 'double_elimination', 'series', 'exhibition'
      ))
    `);
    await run(`ALTER TABLE phases ALTER COLUMN type SET DEFAULT 'round_robin'`);

    // Las ramas que todavía traen el default VIEJO de desempates pasan al
    // nuevo (ganados en vez de porcentaje). La guarda por igualdad exacta es
    // lo que hace esto seguro de repetir y respetuoso: si una liga ya
    // reordenó sus criterios, su lista no coincide con la vieja y no se toca.
    await run(`
      UPDATE branches
      SET tiebreakers     = '["wins","h2h_wins","point_diff","points_for"]'::jsonb,
          tiebreaker_mode = 'restart'
      WHERE tiebreakers = '["win_pct","h2h_win_pct","scope_win_pct","common_win_pct","point_diff","points_for"]'::jsonb
        AND tiebreaker_mode = 'sequential'
    `);

    // Historial de conversación del bot de WhatsApp (routes/bot.js). La tabla
    // faltaba: bot.js se escribió asumiéndola y nunca se creó aquí, así que en
    // cuanto llegara el primer mensaje real el SELECT habría tronado con
    // "relation bot_messages does not exist" — y como el webhook no alcanza a
    // responder 200, Meta reintenta el mismo mensaje una y otra vez. No se
    // había notado porque el bot todavía no está conectado (falta el número de
    // WhatsApp y la llave de Anthropic), así que este código nunca se ejecutó.
    //
    // `role` solo acepta los dos valores que la API de Claude entiende. Si
    // algún día se renombran, hay que cambiarlos aquí Y en bot.js: un CHECK
    // "mejorado" por su cuenta es exactamente lo que tiró los pagos del papá
    // en la fase A de la separación del padrón.
    //
    // Nota de privacidad: aquí quedan el teléfono y la conversación completa
    // de CLIENTES de la tienda — gente sin cuenta en la plataforma. No hay
    // borrado por antigüedad todavía, así que la tabla crece sin límite.
    await run(`
      CREATE TABLE IF NOT EXISTS bot_messages (
        id              SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        wa_from         TEXT NOT NULL,
        role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content         TEXT NOT NULL,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // El índice es exactamente la consulta de los últimos 10 turnos de bot.js.
    await run(`
      CREATE INDEX IF NOT EXISTS idx_bot_messages_conversacion
        ON bot_messages(organization_id, wa_from, created_at DESC)
    `);

    // ── Bitácora de corridas del cron, y candado de las fases diarias ──
    //
    // `POST /api/notifications/trigger` hace dos trabajos con cadencias
    // incompatibles: los avisos de partido necesitan correr cada pocos minutos
    // (su ventana es de una hora) y la cobranza necesita correr una vez al
    // día. Como el cron es externo al repositorio y su frecuencia no se
    // conoce, hoy una de las dos mitades está mal servida y no se sabe cuál.
    //
    // Esta tabla resuelve la mitad diaria sin tocar nada afuera: la corrida
    // de cobranza RECLAMA el día insertando su fila, y quien no gane la
    // reclamación se salta esas fases. Que el cron llame cada 15 minutos o
    // una vez al día deja de importar.
    //
    // La garantía es de la BASE, no del código — mismo criterio que
    // idx_club_ledger_auto_cycle: dos llamadas simultáneas del cron no pueden
    // colarse las dos, porque la segunda choca contra el UNIQUE y su
    // ON CONFLICT DO NOTHING la deja sin fila que devolver. Con una
    // comprobación en JS habría ventana de carrera de verdad.
    //
    // `ran_on` es la fecha en México (HOY_MX), no CURRENT_DATE: con Neon en
    // UTC, el día se cortaría a las 18:00 hora local y la corrida de la tarde
    // contaría como del día siguiente.
    //
    // `finished_at` NULL con `started_at` viejo = corrida que se cayó a medias
    // (el proceso murió sin poder soltar su reclamación). La siguiente llamada
    // la retoma; sin eso, un reinicio a media corrida dejaría el día bloqueado
    // hasta la medianoche.
    await run(`
      CREATE TABLE IF NOT EXISTS cron_runs (
        id          SERIAL PRIMARY KEY,
        phase       TEXT NOT NULL,
        ran_on      DATE NOT NULL,
        started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ,
        result      JSONB,
        UNIQUE (phase, ran_on)
      )
    `);

    // ── El latido del cron ──
    //
    // La tabla nació guardando solo la corrida DIARIA de cobranza (una fila
    // por día). Estas dos columnas le agregan el otro uso: contar CADA llamada
    // al endpoint, que es lo que contesta la pregunta abierta del README —
    // "nadie sabe cada cuánto corre el cron" — sin entrar al panel de nadie.
    //
    // Son dos formas de fila en la misma tabla, y el discriminante es `phase`:
    //
    //   phase='trigger'   una fila por día, `calls` se incrementa en cada
    //                     llamada y `last_call_at` es la más reciente.
    //                     `finished_at`/`result` no se usan.
    //   phase='cobranza'  una fila por día, la reclamación del bloque diario.
    //                     `calls` se queda en 0; lo que importa es
    //                     `started_at`/`finished_at`/`result`.
    //
    // Una fila por día y no una por llamada: con el cron cada 15 minutos serían
    // ~35 mil filas al año para responder algo que un contador contesta igual.
    await run(`ALTER TABLE cron_runs ADD COLUMN IF NOT EXISTS calls INTEGER NOT NULL DEFAULT 0`);
    await run(`ALTER TABLE cron_runs ADD COLUMN IF NOT EXISTS last_call_at TIMESTAMPTZ`);

    // ── El alta de un jugador se fecha en México, no en UTC ──
    //
    // `start_date` nació con DEFAULT CURRENT_DATE, que se evalúa en la zona
    // del servidor de Postgres — y Neon corre en UTC. Consecuencia: un alta
    // capturada después de las 18:00 hora de México nacía fechada al día
    // siguiente. Es el mismo desfase que se cerró en los dos libros de
    // cobranza el 2026-09-19 (ver utils/sqlDates.js); al roster le faltaban
    // estos tres lugares: los dos UPDATE de routes/players.js y este DEFAULT.
    //
    // La tabla de arriba NO se toca (regla 8: el esquema se agrega, no se
    // edita). Este ALTER corre en cada arranque y es idempotente, así que
    // deja igual a una base nueva y a la que ya existe.
    //
    // Las filas ya escritas se quedan como están: una fecha mal cortada del
    // pasado no se sabe distinguir de una buena, y aquí se resuelve al leer,
    // no se migra (regla 4).
    await run(`
      ALTER TABLE player_team_memberships
        ALTER COLUMN start_date SET DEFAULT ${HOY_MX}
    `);

    // ── Los roles de una organización dejan de ser tres ──
    //
    // El CHECK original aceptaba solo owner/admin/editor. El modelo decidido
    // el 2026-09-19 (README, "Roles y fronteras de información") suma tesorero,
    // editor de roster y coach, y le da a 'editor' un significado concreto: el
    // VISOR que toma marcadores en la cancha.
    //
    // El CREATE TABLE de arriba NO se toca (regla 8). Y no migra ni una fila:
    // el CHECK nuevo es un SUPERCONJUNTO del viejo, así que todo lo ya escrito
    // lo cumple — al 2026-09-19 solo había filas 'owner' y 'admin'.
    //
    // La lista sale de utils/orgRoles.js y no se escribe a mano aquí: es un
    // valor que viaja por la API, y la regla 6 dice que se cambia en los tres
    // lados o en ninguno. Importándola, no hay forma de que la base acepte un
    // rol que el código no conoce, ni al revés.
    //
    // Qué roles valen para cada TIPO de organización no cabe en este CHECK —el
    // tipo vive en `organizations`, otra tabla— y por eso se valida al invitar.
    await run(`ALTER TABLE organization_members DROP CONSTRAINT IF EXISTS organization_members_role_check`);
    await run(`
      ALTER TABLE organization_members
        ADD CONSTRAINT organization_members_role_check
        CHECK (role IN (${TODOS_LOS_ROLES.map((r) => `'${r}'`).join(', ')}))
    `);

    // ─────────────────────────────────────────────────────────────────────────
    // Paso 4 del modelo de roles (README, "Roles y fronteras de información"):
    // la invitación dice con qué rol entra quien la reclame.
    //
    // Hasta aquí no lo decía. `routes/invites.js` escribía 'admin' a secas en
    // las de organización, y las de equipo no daban de alta a nadie — solo
    // llenaban `teams.owner_user_id`. El rol se elige al GENERAR el link y no
    // al reclamarlo, porque quien invita es quien sabe a qué viene la persona;
    // quien lo reclama solo prueba que el link llegó a sus manos.
    //
    // Nace NULL y lo ya escrito se queda NULL (regla 8: el esquema se agrega,
    // no se edita). El claim lee una invitación sin rol con el default que
    // tenía antes —'admin' las de organización, 'owner' las de equipo—, así
    // que un link repartido ayer vale exactamente lo mismo después de
    // desplegar esto. Por eso no lleva backfill: no hay nada que reparar.
    //
    // Mismo criterio que el CHECK de arriba: la lista sale de utils/orgRoles.js
    // y no se escribe a mano (regla 6). Qué roles valen para CADA TIPO de
    // organización sigue sin caber en un CHECK —el tipo vive en otra tabla— y
    // se valida al invitar, en routes/invites.js.
    await run(`ALTER TABLE invites ADD COLUMN IF NOT EXISTS role TEXT`);
    await run(`ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check`);
    await run(`
      ALTER TABLE invites
        ADD CONSTRAINT invites_role_check
        CHECK (role IS NULL OR role IN (${TODOS_LOS_ROLES.map((r) => `'${r}'`).join(', ')}))
    `);

    // ─────────────────────────────────────────────────────────────────────────
    // Roster público: la liga decide al crear la categoría (README, "Roster
    // público y pase de lista", 2026-09-20).
    //
    // Las dos nacen APAGADAS, y ese default es la decisión de verdad: es lo que
    // va a quedar en la mayoría de las categorías, y es la única respuesta que
    // no lastima a nadie si la pregunta se contesta a las prisas. Publicar el
    // nombre, el número y la cara de un menor en una página abierta no le
    // aporta nada a la competencia.
    //
    //   roster_public   si el roster de esa categoría sale en público
    //   roster_photos   si además puede salir la foto
    //
    // NOT NULL con default: una categoría que ya existía queda en FALSE, que es
    // exactamente lo que hoy hace el sistema (no publica ningún roster), así que
    // esto no cambia nada de lo ya escrito.
    await run(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS roster_public BOOLEAN NOT NULL DEFAULT FALSE`);
    await run(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS roster_photos BOOLEAN NOT NULL DEFAULT FALSE`);

    // El veto del equipo sobre las caras de sus jugadores. La categoría fija el
    // techo; esto solo puede BAJARLO — no existe la operación contraria, y por
    // eso la foto se publica únicamente si las dos están de acuerdo:
    //
    //     categories.roster_photos AND COALESCE(branch_teams.show_photos, TRUE)
    //
    // Nullable a propósito: NULL significa "sigue a la categoría", así que un
    // equipo que nunca tocó nada no bloquea a su liga, y un FALSE explícito es
    // una decisión que alguien tomó. Son tres estados y no dos, y por eso no
    // lleva NOT NULL DEFAULT.
    //
    // Va en `branch_teams` porque es exactamente una fila por rama + equipo:
    // el consentimiento de las familias es de ESE roster, no del equipo para
    // siempre ni de la categoría entera.
    await run(`ALTER TABLE branch_teams ADD COLUMN IF NOT EXISTS show_photos BOOLEAN`);

    await client.query('COMMIT');
  } catch (err) {
    // El ROLLBACK suelta el candado por sí solo (es de transacción). Se
    // registra el error en vez de tragárselo: una migración que no se aplicó
    // tiene que verse en los logs del arranque.
    await client.query('ROLLBACK').catch(() => {});
    console.error('[db] Falló la migración del esquema:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

export default db;
