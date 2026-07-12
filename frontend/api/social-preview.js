// Función serverless de Vercel (Node.js). A diferencia del middleware, esta SÍ está
// garantizada para funcionar con cualquier framework, incluyendo builds estáticos de Vite,
// porque es una característica base de la plataforma (carpeta /api).
//
// vercel.json redirige internamente (rewrite) las rutas de partido, liga y calendario
// hacia esta función. Aquí revisamos si quien pide la página es un bot de redes sociales:
//   - Si es un bot -> respondemos un HTML mínimo con los meta tags Open Graph correctos.
//   - Si es una persona normal -> servimos el index.html real de la SPA, sin ningún cambio.

const BACKEND_URL = process.env.BACKEND_API_URL || 'https://lifa-backend-p0hq.onrender.com';
const SITE_NAME = 'LIFA — Calendarios de Football Americano';
const DEFAULT_IMAGE = 'https://res.cloudinary.com/dnatxlasg/image/upload/v1783883178/facebook_profile_1024_ezngmz.png';

const BOT_REGEX = /facebookexternalhit|Facebot|Twitterbot|WhatsApp|TelegramBot|LinkedInBot|Slackbot|Discordbot|Googlebot|bingbot|Pinterest|redditbot|vkShare|Applebot|SkypeUriPreview|Iframely|Embedly|W3C_Validator/i;

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml({ title, description, image, url }) {
  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description);
  const safeImage = escapeHtml(image);
  const safeUrl = escapeHtml(url);
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>${safeTitle}</title>
<meta name="description" content="${safeDesc}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />
<meta property="og:title" content="${safeTitle}" />
<meta property="og:description" content="${safeDesc}" />
<meta property="og:image" content="${safeImage}" />
<meta property="og:url" content="${safeUrl}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${safeTitle}" />
<meta name="twitter:description" content="${safeDesc}" />
<meta name="twitter:image" content="${safeImage}" />
</head>
<body>
<p>${safeTitle}</p>
</body>
</html>`;
}

async function serveRealIndexHtml(protocol, host, res) {
  const resp = await fetch(`${protocol}://${host}/index.html`);
  const html = await resp.text();
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}

export default async function handler(req, res) {
  const userAgent = req.headers['user-agent'] || '';
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'];
  const originalUrl = `${protocol}://${host}${req.url}`;

  // Si NO es un bot conocido, servimos la SPA real, sin ningún cambio para el usuario.
  if (!BOT_REGEX.test(userAgent)) {
    try {
      return await serveRealIndexHtml(protocol, host, res);
    } catch (err) {
      console.error('Error sirviendo index.html real:', err);
      return res.status(500).send('Error interno');
    }
  }

  const { type, matchId, slug, categoryId, view, sel } = req.query;

  try {
    // Caso 1: partido individual
    if (type === 'match' && matchId) {
      const resp = await fetch(`${BACKEND_URL}/api/leagues/matches/${matchId}`);
      if (resp.ok) {
        const data = await resp.json();
        const title = `${data.home_team} vs ${data.away_team} — ${data.league_name}`;
        const description = `${data.category_name || ''} • Consulta el calendario y comparte este partido en ${SITE_NAME}.`.trim();
        const image = data.league_logo_url || DEFAULT_IMAGE;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        return res.status(200).send(buildHtml({ title, description, image, url: originalUrl }));
      }
    }

    // Caso 2: página de liga
    if (type === 'league' && slug) {
      const resp = await fetch(`${BACKEND_URL}/api/leagues/${slug}`);
      if (resp.ok) {
        const data = await resp.json();
        const title = `${data.name} — ${SITE_NAME}`;
        const description = data.description || `Calendario, equipos y partidos de ${data.name}.`;
        const image = data.logo_url || DEFAULT_IMAGE;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        return res.status(200).send(buildHtml({ title, description, image, url: originalUrl }));
      }
    }

    // Caso 3: calendario de categoría (completo/jornada/sede -> logo de liga; equipo -> logo de equipo)
    if (type === 'calendar' && categoryId) {
      const teamQuery = view === 'equipo' && sel ? `?team=${encodeURIComponent(sel)}` : '';
      const resp = await fetch(`${BACKEND_URL}/api/leagues/categories/${categoryId}/share-meta${teamQuery}`);
      if (resp.ok) {
        const data = await resp.json();
        const isTeamView = view === 'equipo' && sel && data.team_logo_url;
        const title = isTeamView
          ? `${sel} — Calendario — ${data.league_name}`
          : `Calendario — ${data.league_name}`;
        const description = `${data.category_name} • ${SITE_NAME}`;
        const image = isTeamView ? data.team_logo_url : (data.league_logo_url || DEFAULT_IMAGE);
        res.setHeader('content-type', 'text/html; charset=utf-8');
        return res.status(200).send(buildHtml({ title, description, image, url: originalUrl }));
      }
    }
  } catch (err) {
    console.error('Error generando meta tags para bots:', err);
  }

  // Si algo falla o no coincide ningún caso, respaldo: servir la SPA real igual.
  try {
    return await serveRealIndexHtml(protocol, host, res);
  } catch (err) {
    return res.status(500).send('Error interno');
  }
}