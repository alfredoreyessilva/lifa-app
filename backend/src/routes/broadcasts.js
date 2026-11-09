import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isOrgMember } from '../utils/orgMembers.js';
import { isValidUrl } from '../utils/validation.js';
import { puedeTransmitir, puedeTransmitirSql, camposDeFichaSql } from '../utils/orgVisibility.js';
import { MATCH_PHASE_JOINS, MATCH_PHASE_COLUMNS } from '../utils/matchPhase.js';

const router = express.Router();

// Lo que el panel de un medio enseña de cada partido, en sus dos listas: lo que
// transmite y lo que se juega (README, "El panel de un medio"). Las mismas
// columnas en las dos, para que un partido se escriba igual en Transmisiones y
// en Partidos.
//
// Los escudos se unen por id y solo después por nombre, acotado a los miembros
// de la liga, como en GET /leagues/matches/:matchId. El NULLIF del visitante es
// el de esa misma ruta: un equipo sin logo de visitante lo guarda como cadena
// vacía. La categoría trae la ventana de su estado automático, con la que el
// panel decide si un partido ya terminó (utils/matchStatus.js).
const PARTIDO_COLUMNAS = `
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

const PARTIDO_JOINS = `
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

// Las dos lecturas del panel son del medio y del admin de la plataforma. Un id
// que no es número no llega a la consulta: Postgres contestaría con un 500.
async function administraElMedio(req, organizationId) {
  if (!Number.isInteger(organizationId)) return false;
  if (req.user.role === 'admin') return true;
  return isOrgMember(req.user.id, organizationId);
}

// Público, sin authRequired — la ficha de un partido debe poder mostrar
// quién lo transmite sin necesitar sesión, igual que la tarjeta del jugador.
//
// Solo medios publicados Y verificados, la misma regla que para sumarse. Se
// resuelve al leer: si al medio lo ocultan o le quitan la verificación, sale
// de aquí sin que se borre su fila, y vuelve si recupera las dos.
//
// Trae también lo que enseña la ficha del medio (país y CAMPOS_DE_FICHA), que
// se abre al tocar un logo sin link propio para este partido. Es lo mismo que
// el directorio del home ya muestra de un medio publicado: no destapa nada.
router.get('/match/:matchId', asyncHandler(async (req, res) => {
  const broadcasts = await db.prepare(`
    SELECT b.id, b.url, o.id AS organization_id, o.name, o.slug, o.logo_url,
           o.is_verified, ${camposDeFichaSql('o')}, c.name AS country_name
    FROM match_broadcasts b
    JOIN organizations o ON o.id = b.organization_id
    LEFT JOIN countries c ON c.id = o.country_id
    WHERE b.match_id = ? AND ${puedeTransmitirSql('o')}
    ORDER BY o.name
  `).all(req.params.matchId);
  res.json({ broadcasts });
}));

// Lo que UN medio está transmitiendo: la sección Transmisiones de su panel.
//
// Sin borradores, y se resuelve al leer (regla 4): un partido que vuelve a
// borrador sale de aquí sin que se borre su fila, y vuelve si se publica. Un
// borrador no se publica en ningún lado, y esta lista devolvía sus equipos y su
// fecha (README, "Qué partidos ve el medio"). Los de una liga privada sí salen:
// su página se abre por su link, con "También transmiten".
router.get('/organization/:organizationId', authRequired, asyncHandler(async (req, res) => {
  const organizationId = Number(req.params.organizationId);
  if (!(await administraElMedio(req, organizationId))) {
    return res.status(403).json({ error: 'No tienes permiso sobre esta organización' });
  }
  const broadcasts = await db.prepare(`
    SELECT b.id, b.url, b.created_at, ${PARTIDO_COLUMNAS}
    FROM match_broadcasts b
    JOIN matches m ON m.id = b.match_id
    ${PARTIDO_JOINS}
    WHERE b.organization_id = ? AND m.is_draft = FALSE
    ORDER BY m.match_date::timestamptz DESC NULLS FIRST, b.id DESC
  `).all(organizationId);
  res.json({ broadcasts });
}));

// Lo que se juega en las ligas públicas, para sumarse desde el panel: la
// sección Partidos (README, "Sumarse desde el panel"). Publicados, que nadie dio
// por terminados, de hace 12 horas a 14 días adelante; el panel quita al leer
// los que ya terminaron por el estado automático de su categoría. La fecha se
// guarda como texto ISO, y por eso se compara con su `::timestamptz`, como en
// routes/notifications.js.
//
// Los que no tienen fecha también, porque así se cargan los playoffs, pero solo
// si su categoría tiene un partido con fecha en los últimos 60 días o por venir:
// uno sin fecha de una temporada que ya pasó no se va a jugar.
//
// `broadcast_id` y `broadcast_url` son los de ESTE medio, si ya está en el
// partido.
router.get('/organization/:organizationId/upcoming', authRequired, asyncHandler(async (req, res) => {
  const organizationId = Number(req.params.organizationId);
  if (!(await administraElMedio(req, organizationId))) {
    return res.status(403).json({ error: 'No tienes permiso sobre esta organización' });
  }
  const matches = await db.prepare(`
    SELECT ${PARTIDO_COLUMNAS},
           b.id AS broadcast_id, b.url AS broadcast_url
    FROM matches m
    ${PARTIDO_JOINS}
    LEFT JOIN match_broadcasts b ON b.match_id = m.id AND b.organization_id = ?
    WHERE l.is_public = TRUE
      AND m.is_draft = FALSE
      AND m.status <> 'finished'
      AND (
        m.match_date::timestamptz BETWEEN NOW() - INTERVAL '12 hours' AND NOW() + INTERVAL '14 days'
        OR (m.match_date IS NULL AND EXISTS (
          SELECT 1 FROM matches m2
          WHERE m2.category_id = m.category_id
            AND m2.is_draft = FALSE
            AND m2.match_date::timestamptz >= NOW() - INTERVAL '60 days'
        ))
      )
    ORDER BY m.match_date::timestamptz ASC NULLS LAST, l.name ASC, m.id ASC
  `).all(organizationId);
  res.json({ matches });
}));

// Autoasignación: el medio se agrega solo a un partido, sin que la liga
// intervenga. Requiere: (a) ser miembro de esa organización, y (b) que la
// organización sea de tipo 'media', esté publicada y esté verificada — la
// verificación certifica QUIÉN es el medio, no que tenga derechos sobre ESTE
// partido en particular (decisión consciente, ver comentario en db.js), y
// publicada porque su logo sale en la página del partido (README,
// "Organizaciones: publicar y verificar").
router.post('/', authRequired, asyncHandler(async (req, res) => {
  const { match_id, organization_id, url } = req.body;
  if (!match_id || !organization_id) {
    return res.status(400).json({ error: 'match_id y organization_id son obligatorios' });
  }
  if (url && !isValidUrl(url)) return res.status(400).json({ error: 'El link no es una dirección web válida' });

  const org = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(organization_id);
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
  if (org.type !== 'media') return res.status(400).json({ error: 'Solo organizaciones de tipo medio pueden transmitir partidos' });
  if (!puedeTransmitir(org)) {
    return res.status(403).json({
      error: org.is_verified
        ? 'Este medio todavía no está publicado'
        : 'Este medio todavía no está verificado',
    });
  }

  // Un borrador no existe para el público, y su página contesta lo mismo. Hasta
  // el 2026-11-08 esto aceptaba cualquier id: un medio verificado se sumaba a un
  // partido que nadie ve, y su lista le devolvía los equipos y la fecha (README,
  // "Qué partidos ve el medio").
  const match = await db.prepare('SELECT id FROM matches WHERE id = ? AND is_draft = FALSE').get(match_id);
  if (!match) return res.status(404).json({ error: 'Partido no encontrado' });

  const isMember = await isOrgMember(req.user.id, organization_id);
  if (req.user.role !== 'admin' && !isMember) {
    return res.status(403).json({ error: 'No tienes permiso sobre este medio' });
  }

  // Si el medio ya estaba en este partido, esto es solo una edición del link:
  // se actualiza la URL pero NO se vuelve a avisar a la liga.
  const existing = await db.prepare(
    'SELECT id FROM match_broadcasts WHERE match_id = ? AND organization_id = ?'
  ).get(match_id, organization_id);

  const broadcast = await db.prepare(`
    INSERT INTO match_broadcasts (match_id, organization_id, url)
    VALUES (?, ?, ?)
    ON CONFLICT (match_id, organization_id) DO UPDATE SET url = EXCLUDED.url
    RETURNING *
  `).get(match_id, organization_id, url || null);

  // Aviso a la bandeja de la liga (solo in-app, sin push) la primera vez que
  // este medio se suma al partido. Dice que se sumó, no que puso un enlace:
  // desde su panel se suma sin link y lo pone después.
  if (!existing) {
    const matchDetails = await db.prepare(`
      SELECT m.id, m.home_team, m.away_team, c.league_id
      FROM matches m
      JOIN categories c ON c.id = m.category_id
      WHERE m.id = ?
    `).get(match_id);

    if (matchDetails) {
      await db.prepare(`
        INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
        VALUES ('league', ?, 'broadcast_added', ?, ?, ?)
      `).run(
        matchDetails.league_id,
        'Nuevo medio transmitiendo tu partido 🎥',
        `El medio "${org.name}" se sumó a transmitir el partido ${matchDetails.home_team} vs ${matchDetails.away_team}.`,
        JSON.stringify({
          match_id: matchDetails.id,
          league_id: matchDetails.league_id,
          media_name: org.name,
          url: `/partidos/${matchDetails.id}`,
        })
      );
    }
  }

  res.status(201).json(broadcast);
}));

router.delete('/:id', authRequired, asyncHandler(async (req, res) => {
  const broadcast = await db.prepare('SELECT * FROM match_broadcasts WHERE id = ?').get(req.params.id);
  if (!broadcast) return res.status(404).json({ error: 'No encontrado' });

  const isMember = await isOrgMember(req.user.id, broadcast.organization_id);
  if (req.user.role !== 'admin' && !isMember) {
    return res.status(403).json({ error: 'No tienes permiso sobre este medio' });
  }

  await db.prepare('DELETE FROM match_broadcasts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

export default router;
