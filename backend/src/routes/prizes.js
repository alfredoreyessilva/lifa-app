import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { storePrizesRequired } from '../middleware/ownership.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  MATCH_GRADABLE_AT_SQL,
  MATCH_IS_EXHIBITION_SQL,
  MATCH_VOTING_CLOSED_SQL,
  PREDICTION_CORRECT_SQL,
} from '../utils/scoring.js';
import { puedePremiar, puedePremiarSql } from '../utils/orgVisibility.js';
import { PARTIDO_COLUMNAS, PARTIDO_JOINS } from '../utils/partidoDelPanel.js';
import { premiosEncendidos } from '../utils/interruptores.js';
import {
  codigoDePremio,
  estadoDelCanje,
  estadoDelPremio,
  ganadorDeLaFirma,
  leerCodigo,
  nuevoSecreto,
  premioDelGanador,
  premioParaQuienLoVe,
  productoDe,
  validarPremio,
  venceEl,
} from '../utils/premios.js';

// Los premios por acertar (README, "Premios por acertar"): una tienda publicada
// y verificada le pone a un partido un descuento en un producto suyo, y quien
// acierta ese partido lo cobra en la tienda con un código.
//
// Quién ganó no se guarda: se pregunta cada vez con PREDICTION_CORRECT_SQL, la
// misma pregunta que reparte los puntos (regla 4). Lo único que se escribe son
// el premio y el canje.
//
// Ojo con dos cosas al tocar este archivo:
//   - `code_secret` no sale nunca: por eso las columnas van nombradas una por
//     una y no hay ningún `SELECT *` sobre `prediction_prizes`;
//   - el SQL no lleva signos de interrogación en sus comentarios: cada uno se
//     vuelve un parámetro (CLAUDE.md, y la prueba sqlPlaceholders).

const router = express.Router();

// Lo que viaja de un premio, sin su secreto.
const PREMIO_COLUMNAS = `
  pp.id, pp.match_id, pp.organization_id, pp.product_id,
  pp.product_name, pp.product_price, pp.product_currency, pp.product_image_url,
  pp.discount_percent, pp.valid_days, pp.created_at
`;

// La tienda, como sale junto a su premio: lo que ya enseña su vitrina.
const TIENDA_COLUMNAS = `
  o.name AS store_name, o.logo_url AS store_logo_url, o.is_verified AS store_is_verified
`;

// El partido como sale junto a un premio ganado.
const PARTIDO_DEL_PREMIO = `
  m.home_team, m.away_team, m.home_score, m.away_score, m.match_date, m.timezone,
  l.name AS league_name
`;

function partidoDe(fila) {
  return {
    id: fila.match_id,
    home_team: fila.home_team,
    away_team: fila.away_team,
    home_score: fila.home_score,
    away_score: fila.away_score,
    match_date: fila.match_date,
    timezone: fila.timezone,
    league_name: fila.league_name ?? null,
  };
}

// El interruptor (un botón del Panel Admin). Apagado, la tienda no tiene
// sección ni rutas: contestan como si no existieran.
const soloEncendido = asyncHandler(async (req, res, next) => {
  if (!(await premiosEncendidos())) return res.status(404).json({ error: 'No encontrado' });
  return next();
});

// El permiso `premios` solo lo trae una tienda, así que un miembro de otra
// organización ya se queda en la guarda. Esto es para el admin de la
// plataforma, que pasa todas las guardas como dueño.
function soloTiendas(req, res, next) {
  if (req.organization?.type !== 'store') return res.status(400).json({ error: 'Solo una tienda pone premios' });
  return next();
}

const DE_LA_TIENDA = [soloEncendido, authRequired, storePrizesRequired, soloTiendas];

function porQueNoPremia(tienda) {
  return tienda.is_verified
    ? 'Tu tienda todavía no está publicada. Los premios son para tiendas publicadas y verificadas por CFBAMX'
    : 'Tu tienda todavía no está verificada. Los premios son para tiendas publicadas y verificadas por CFBAMX';
}

// ── Lo público ────────────────────────────────────────────────────────────

// El único interruptor; el frontend no tiene el suyo.
router.get('/status', asyncHandler(async (req, res) => {
  res.json({ enabled: await premiosEncendidos() });
}));

// Los premios de un partido, para su página. Sin sesión, como "También
// transmiten". Se resuelve al leer: un premio retirado, de una tienda que dejó
// de estar publicada o verificada, de un partido que volvió a borrador o que
// ahora es amistoso, no sale, sin que se borre ninguna fila. Apagado, la lista
// llega vacía y la página no enseña nada.
router.get('/match/:matchId', asyncHandler(async (req, res) => {
  const matchId = Number(req.params.matchId);
  if (!Number.isInteger(matchId) || !(await premiosEncendidos())) return res.json({ prizes: [] });
  const filas = await db.prepare(`
    SELECT ${PREMIO_COLUMNAS}, ${TIENDA_COLUMNAS}
    FROM prediction_prizes pp
    JOIN organizations o ON o.id = pp.organization_id
    JOIN matches m       ON m.id = pp.match_id
    JOIN categories c    ON c.id = m.category_id
    JOIN leagues l       ON l.id = c.league_id
    WHERE pp.match_id = ?
      AND pp.withdrawn_at IS NULL
      AND m.is_draft = FALSE
      AND l.is_public = TRUE
      AND NOT ${MATCH_IS_EXHIBITION_SQL}
      AND ${puedePremiarSql('o')}
    ORDER BY pp.created_at, pp.id
  `).all(matchId);
  res.json({ prizes: filas.map(premioParaQuienLoVe) });
}));

// Los premios que ganó una persona, con su código, cuándo vencen y si ya los
// usó. Una sola lectura para "Mis premios" y para la bandeja, que los cuelga de
// su aviso del resultado (routes/notifications.js): si fueran dos, el aviso y la
// lista podrían no coincidir. Con `matchIds`, solo los de esos partidos.
export async function premiosGanados(userId, { matchIds = null, ahora = new Date() } = {}) {
  if (matchIds && matchIds.length === 0) return [];
  if (!(await premiosEncendidos())) return [];
  const filas = await db.prepare(`
    SELECT ${PREMIO_COLUMNAS}, pp.code_secret, ${TIENDA_COLUMNAS},
           ${MATCH_GRADABLE_AT_SQL} AS gradable_at,
           r.redeemed_at,
           ${PARTIDO_DEL_PREMIO}
    FROM prediction_prizes pp
    JOIN organizations o ON o.id = pp.organization_id
    JOIN matches m       ON m.id = pp.match_id
    JOIN categories c    ON c.id = m.category_id
    LEFT JOIN leagues l  ON l.id = c.league_id
    JOIN predictions p   ON p.match_id = m.id AND p.user_id = ?
    LEFT JOIN prediction_prize_redemptions r ON r.prize_id = pp.id AND r.user_id = p.user_id
    WHERE pp.withdrawn_at IS NULL
      AND m.is_draft = FALSE
      AND NOT ${MATCH_IS_EXHIBITION_SQL}
      AND ${puedePremiarSql('o')}
      AND ${PREDICTION_CORRECT_SQL}
      ${matchIds ? 'AND pp.match_id = ANY(?::int[])' : ''}
    ORDER BY pp.id
  `).all(...(matchIds ? [userId, matchIds] : [userId]));
  return filas.map((fila) => ({
    ...premioDelGanador(fila, userId, ahora),
    match: partidoDe(fila),
  }));
}

router.get('/mine', authRequired, asyncHandler(async (req, res) => {
  res.json({ prizes: await premiosGanados(req.user.id) });
}));

// ── El panel de la tienda ─────────────────────────────────────────────────

// Sus premios, con el partido escrito como en el panel de un medio
// (utils/partidoDelPanel.js), en qué va cada uno y sus tres conteos: quién votó
// el partido, quién acertó y quién ya cobró. Nunca quiénes: la tienda ve
// números, no personas (README, "El código y el canje").
async function premiosDeLaTienda(organizationId, { prizeId = null } = {}) {
  const filas = await db.prepare(`
    SELECT pp.id AS prize_id, pp.product_id, pp.product_name, pp.product_price,
           pp.product_currency, pp.product_image_url, pp.discount_percent, pp.valid_days,
           pp.created_at AS prize_created_at,
           ${PARTIDO_COLUMNAS},
           ${MATCH_VOTING_CLOSED_SQL} AS voting_closed,
           ${MATCH_GRADABLE_AT_SQL} AS gradable_at,
           ${MATCH_IS_EXHIBITION_SQL} AS exhibition,
           (SELECT COUNT(*) FROM predictions p WHERE p.match_id = m.id) AS votes,
           (SELECT COUNT(*) FROM predictions p WHERE p.match_id = m.id AND ${PREDICTION_CORRECT_SQL}) AS winners,
           (SELECT COUNT(*) FROM prediction_prize_redemptions r WHERE r.prize_id = pp.id) AS redeemed
    FROM prediction_prizes pp
    JOIN matches m ON m.id = pp.match_id
    ${PARTIDO_JOINS}
    WHERE pp.organization_id = ?
      AND pp.withdrawn_at IS NULL
      AND m.is_draft = FALSE
      ${prizeId ? 'AND pp.id = ?' : ''}
    ORDER BY m.match_date::timestamptz DESC NULLS FIRST, pp.id DESC
  `).all(...(prizeId ? [organizationId, prizeId] : [organizationId]));

  return filas.map((fila) => {
    const {
      prize_id: id, product_id: productId, product_name: _n, product_price: _p, product_currency: _c,
      product_image_url: _i, discount_percent: descuento, valid_days: dias, prize_created_at: creado,
      voting_closed: votacionCerrada, gradable_at: gradableAt, exhibition,
      votes, winners, redeemed, ...partido
    } = fila;
    const vence = venceEl(gradableAt, dias);
    return {
      ...partido,
      prize_id: id,
      discount_percent: Number(descuento),
      valid_days: Number(dias),
      product: { id: productId, ...productoDe(fila) },
      created_at: creado,
      state: estadoDelPremio({ votacionCerrada, gradableAt }),
      votes: Number(votes),
      // Un amistoso no tiene ganadores aunque alguien haya atinado: no reparte
      // puntos (utils/scoring.js). Pasa si la liga lo vuelve amistoso después.
      winners: exhibition ? 0 : Number(winners),
      redeemed: Number(redeemed),
      expires_at: vence ? vence.toISOString() : null,
    };
  });
}

router.get('/organization/:organizationId', ...DE_LA_TIENDA, asyncHandler(async (req, res) => {
  res.json({
    can_award: puedePremiar(req.organization),
    prizes: await premiosDeLaTienda(req.organization.id),
  });
}));

// Dónde puede poner un premio: lo que se juega en las ligas públicas en los
// próximos 30 días y todavía se puede votar, sin amistosos. Es la lista de
// "Sumarse desde el panel" de un medio (routes/broadcasts.js), con dos cambios:
// 30 días en vez de 14, porque un premio que se anuncia antes junta más votos, y
// el candado del voto en vez de "nadie lo dio por terminado". Los que no tienen
// fecha, solo de una temporada viva, como allá. `prize_id` es el premio que ESTA
// tienda ya tiene en el partido, si tiene.
router.get('/organization/:organizationId/matches', ...DE_LA_TIENDA, asyncHandler(async (req, res) => {
  const matches = await db.prepare(`
    SELECT ${PARTIDO_COLUMNAS},
           pp.id AS prize_id
    FROM matches m
    ${PARTIDO_JOINS}
    LEFT JOIN prediction_prizes pp
      ON pp.match_id = m.id AND pp.organization_id = ? AND pp.withdrawn_at IS NULL
    WHERE l.is_public = TRUE
      AND m.is_draft = FALSE
      AND NOT ${MATCH_VOTING_CLOSED_SQL}
      AND NOT ${MATCH_IS_EXHIBITION_SQL}
      AND (
        m.match_date::timestamptz <= NOW() + INTERVAL '30 days'
        OR (m.match_date IS NULL AND EXISTS (
          SELECT 1 FROM matches m2
          WHERE m2.category_id = m.category_id
            AND m2.is_draft = FALSE
            AND m2.match_date::timestamptz >= NOW() - INTERVAL '60 days'
        ))
      )
    ORDER BY m.match_date::timestamptz ASC NULLS LAST, l.name ASC, m.id ASC
  `).all(req.organization.id);
  res.json({ matches });
}));

// Por qué no se puso un premio, cuando el INSERT no devolvió fila. Se pregunta
// después y no antes a propósito: el INSERT ya decidió en una sola sentencia
// (un partido que empieza entre la pregunta y la escritura no se cuela), y esto
// solo pone en palabras lo que pasó.
async function porQueNoSePuso(organizationId, premio) {
  const [producto, partido, vigente] = await Promise.all([
    db.prepare('SELECT organization_id, is_active, show_on_platform FROM products WHERE id = ?').get(premio.product_id),
    db.prepare(`
      SELECT m.is_draft, l.is_public AS league_is_public,
             ${MATCH_VOTING_CLOSED_SQL} AS voting_closed,
             ${MATCH_IS_EXHIBITION_SQL} AS exhibition
      FROM matches m
      JOIN categories c ON c.id = m.category_id
      JOIN leagues l    ON l.id = c.league_id
      WHERE m.id = ?
    `).get(premio.match_id),
    db.prepare(
      'SELECT id FROM prediction_prizes WHERE match_id = ? AND organization_id = ? AND withdrawn_at IS NULL'
    ).get(premio.match_id, organizationId),
  ]);
  if (!producto || producto.organization_id !== organizationId) {
    return { status: 404, error: 'Ese producto no es de tu tienda' };
  }
  if (!producto.is_active || !producto.show_on_platform) {
    return { status: 400, error: 'Ese producto no está a la venta en tu vitrina. Muéstralo en tu vitrina para premiar con él' };
  }
  if (!partido || partido.is_draft || !partido.league_is_public) {
    return { status: 404, error: 'Partido no encontrado' };
  }
  if (partido.exhibition) {
    return { status: 400, error: 'Es un amistoso: no reparte puntos ni avisa su resultado, así que nadie ganaría el premio' };
  }
  if (partido.voting_closed) {
    return { status: 400, error: 'Ese partido ya no se puede votar: un premio se pone antes de que empiece' };
  }
  if (vigente) {
    return { status: 409, error: 'Tu tienda ya tiene un premio en este partido. Retíralo para poner otro' };
  }
  return { status: 409, error: 'No se pudo poner el premio. Vuelve a intentarlo' };
}

// Poner un premio. Todo lo que tiene que ser cierto se pregunta en la misma
// sentencia que escribe: el partido público, sin borrador ni amistoso y todavía
// votable; el producto de esta tienda, a la venta y en su vitrina. De ahí sale
// también la copia del producto. Un premio vigente de la misma tienda en el
// mismo partido lo frena el índice único parcial.
router.post('/organization/:organizationId', ...DE_LA_TIENDA, asyncHandler(async (req, res) => {
  const { error, premio } = validarPremio(req.body);
  if (error) return res.status(400).json({ error });
  const tienda = req.organization;
  if (!puedePremiar(tienda)) return res.status(403).json({ error: porQueNoPremia(tienda) });

  const creado = await db.prepare(`
    INSERT INTO prediction_prizes (
      match_id, organization_id, product_id,
      product_name, product_price, product_currency, product_image_url,
      discount_percent, valid_days, code_secret, created_by_user_id
    )
    SELECT m.id, pr.organization_id, pr.id,
           pr.name, pr.price, pr.currency, pr.image_url,
           ?::int, ?::int, ?::text, ?::int
    FROM matches m
    JOIN categories c ON c.id = m.category_id
    JOIN leagues l    ON l.id = c.league_id
    JOIN products pr  ON pr.id = ? AND pr.organization_id = ?
    WHERE m.id = ?
      AND l.is_public = TRUE
      AND m.is_draft = FALSE
      AND NOT ${MATCH_VOTING_CLOSED_SQL}
      AND NOT ${MATCH_IS_EXHIBITION_SQL}
      AND pr.is_active = TRUE
      AND pr.show_on_platform = TRUE
    ON CONFLICT (match_id, organization_id) WHERE withdrawn_at IS NULL DO NOTHING
    RETURNING id
  `).get(
    premio.discount_percent, premio.valid_days, nuevoSecreto(), req.user.id,
    premio.product_id, tienda.id,
    premio.match_id,
  );
  if (!creado) {
    const { status, error: motivo } = await porQueNoSePuso(tienda.id, premio);
    return res.status(status).json({ error: motivo });
  }
  const [prize] = await premiosDeLaTienda(tienda.id, { prizeId: creado.id });
  res.status(201).json({ prize });
}));

// Retirarlo, mientras se pueda votar: después es una promesa a quien votó
// contando con él. No borra la fila (`withdrawn_at`). El candado va en la misma
// sentencia que escribe, con la misma regla que el voto.
router.post('/organization/:organizationId/:prizeId/withdraw', ...DE_LA_TIENDA, asyncHandler(async (req, res) => {
  const prizeId = Number(req.params.prizeId);
  if (!Number.isInteger(prizeId)) return res.status(404).json({ error: 'Premio no encontrado' });
  const retirado = await db.prepare(`
    UPDATE prediction_prizes pp
    SET withdrawn_at = NOW(), withdrawn_by_user_id = ?
    FROM matches m
    WHERE pp.id = ?
      AND pp.organization_id = ?
      AND pp.withdrawn_at IS NULL
      AND m.id = pp.match_id
      AND NOT ${MATCH_VOTING_CLOSED_SQL}
    RETURNING pp.id
  `).get(req.user.id, prizeId, req.organization.id);
  if (retirado) return res.json({ ok: true, id: retirado.id });

  const vigente = await db.prepare(
    'SELECT id FROM prediction_prizes WHERE id = ? AND organization_id = ? AND withdrawn_at IS NULL'
  ).get(prizeId, req.organization.id);
  if (!vigente) return res.status(404).json({ error: 'Premio no encontrado' });
  return res.status(409).json({
    error: 'Ya no se puede retirar: la votación de ese partido cerró, y el premio es una promesa a quien votó',
  });
}));

// ── El canje ──────────────────────────────────────────────────────────────

// Qué es este código para esta tienda. Lee el premio —tiene que ser suyo, y su
// partido ya tiene que haber terminado—, calcula sus ganadores con la misma
// pregunta que reparte los puntos y busca cuál tiene esa firma. A la tienda
// nunca le llega quién es: solo si vale, si ya se usó o si venció.
async function resolverCodigo(organizationId, texto) {
  const leido = leerCodigo(texto);
  if (!leido) return { result: 'not_found' };

  const fila = await db.prepare(`
    SELECT ${PREMIO_COLUMNAS}, pp.code_secret,
           ${MATCH_GRADABLE_AT_SQL} AS gradable_at,
           ${MATCH_IS_EXHIBITION_SQL} AS exhibition,
           ${PARTIDO_DEL_PREMIO}
    FROM prediction_prizes pp
    JOIN matches m      ON m.id = pp.match_id
    JOIN categories c   ON c.id = m.category_id
    LEFT JOIN leagues l ON l.id = c.league_id
    WHERE pp.id = ?
      AND pp.organization_id = ?
      AND pp.withdrawn_at IS NULL
      AND m.is_draft = FALSE
  `).get(leido.prizeId, organizationId);
  if (!fila || fila.exhibition || !fila.gradable_at) return { result: 'not_found' };

  const ganadores = await db.prepare(`
    SELECT p.user_id
    FROM predictions p
    JOIN matches m    ON m.id = p.match_id
    JOIN categories c ON c.id = m.category_id
    WHERE p.match_id = ? AND ${PREDICTION_CORRECT_SQL}
  `).all(fila.match_id);
  const userId = ganadorDeLaFirma(fila, leido.firma, ganadores.map((g) => g.user_id));
  if (userId === null) return { result: 'not_found' };

  const canje = await db.prepare(
    'SELECT redeemed_at FROM prediction_prize_redemptions WHERE prize_id = ? AND user_id = ?'
  ).get(fila.id, userId);
  const vence = venceEl(fila.gradable_at, fila.valid_days);
  const redeemedAt = canje?.redeemed_at ? new Date(canje.redeemed_at) : null;
  const result = estadoDelCanje({ redeemedAt, vence });
  return {
    result,
    userId,
    prizeId: fila.id,
    vista: {
      result,
      code: codigoDePremio(fila, userId),
      prize_id: fila.id,
      discount_percent: Number(fila.discount_percent),
      product: productoDe(fila),
      match: partidoDe(fila),
      expires_at: vence ? vence.toISOString() : null,
      redeemed_at: redeemedAt ? redeemedAt.toISOString() : null,
    },
  };
}

const NO_ENCONTRADO = { result: 'not_found', error: 'No encontramos ese código entre los premios de tu tienda' };

// Revisar un código sin escribir nada: lo que la tienda ve antes de entregar.
router.post('/organization/:organizationId/redeem/check', ...DE_LA_TIENDA, asyncHandler(async (req, res) => {
  if (!puedePremiar(req.organization)) return res.status(403).json({ error: porQueNoPremia(req.organization) });
  const revisado = await resolverCodigo(req.organization.id, req.body?.code);
  if (revisado.result === 'not_found') return res.json(NO_ENCONTRADO);
  res.json(revisado.vista);
}));

// Marcarlo como usado. Una sola vez: el UNIQUE (prize_id, user_id) decide, y si
// dos personas de la tienda lo cobran al mismo tiempo, la segunda se entera de
// que ya se usó.
router.post('/organization/:organizationId/redeem', ...DE_LA_TIENDA, asyncHandler(async (req, res) => {
  if (!puedePremiar(req.organization)) return res.status(403).json({ error: porQueNoPremia(req.organization) });
  const revisado = await resolverCodigo(req.organization.id, req.body?.code);
  if (revisado.result === 'not_found') return res.status(404).json(NO_ENCONTRADO);
  if (revisado.result === 'expired') return res.status(409).json({ ...revisado.vista, error: 'Ese premio ya venció' });
  if (revisado.result === 'redeemed') return res.status(409).json({ ...revisado.vista, error: 'Ese código ya se usó' });

  const canje = await db.prepare(`
    INSERT INTO prediction_prize_redemptions (prize_id, user_id, redeemed_by_user_id)
    VALUES (?, ?, ?)
    ON CONFLICT (prize_id, user_id) DO NOTHING
    RETURNING redeemed_at
  `).get(revisado.prizeId, revisado.userId, req.user.id);
  if (!canje) {
    const otraVez = await resolverCodigo(req.organization.id, req.body?.code);
    return res.status(409).json({ ...otraVez.vista, error: 'Ese código ya se usó' });
  }
  res.status(201).json({
    ...revisado.vista,
    result: 'redeemed',
    redeemed_at: new Date(canje.redeemed_at).toISOString(),
  });
}));

export default router;
