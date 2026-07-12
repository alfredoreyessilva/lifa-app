// Este middleware corre en el Edge de Vercel ANTES de servir cualquier página.
// Solo actúa cuando detecta un bot de redes sociales (WhatsApp, Facebook, Twitter, etc.)
// pidiendo una página de partido, liga o calendario. En ese caso, responde con un HTML
// mínimo que trae los meta tags Open Graph correctos (título, descripción, imagen),
// para que el link se vea bien al compartirlo.
//
// A cualquier usuario normal (navegador real) lo deja pasar sin ningún cambio: su
// petición sigue de largo hacia la SPA de React de siempre.

export const config = {
  matcher: ['/partidos/:path*', '/ligas/:path*', '/categorias/:path*'],
};

// IMPORTANTE: define esta variable de entorno en Vercel (Project Settings > Environment Variables)
// Nombre: BACKEND_API_URL   Valor: https://lifa-backend-p0hq.onrender.com
const BACKEND_URL = process.env.BACKEND_API_URL || 'https://lifa-backend-p0hq.onrender.com';

const SITE_NAME = 'LIFA — Calendarios de Football Americano';

// Logo genérico de LIFA, se usa como respaldo si una liga no tiene logo cargado.
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

export default async function middleware(request) {
  const userAgent = request.headers.get('user-agent') || '';

  // Si no es un bot conocido, no hacemos nada: la petición sigue normal hacia la SPA.
  if (!BOT_REGEX.test(userAgent)) {
    return;
  }

  const url = new URL(request.url);
  const { pathname, searchParams } = url;

  try {
    // Caso 1: partido individual -> /partidos/:matchId
    const matchMatch = pathname.match(/^\/partidos\/([^/]+)\/?$/);
    if (matchMatch) {
      const matchId = matchMatch[1];
      const resp = await fetch(`${BACKEND_URL}/api/leagues/matches/${matchId}`);
      if (resp.ok) {
        const data = await resp.json();
        const title = `${data.home_team} vs ${data.away_team} — ${data.league_name}`;
        const description = `${data.category_name || ''} • Consulta el calendario y comparte este partido en ${SITE_NAME}.`.trim();
        const image = data.league_logo_url || DEFAULT_IMAGE;
        return new Response(buildHtml({ title, description, image, url: request.url }), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
    }

    // Caso 2: página de liga -> /ligas/:slug
    const leagueMatch = pathname.match(/^\/ligas\/([^/]+)\/?$/);
    if (leagueMatch) {
      const slug = leagueMatch[1];
      const resp = await fetch(`${BACKEND_URL}/api/leagues/${slug}`);
      if (resp.ok) {
        const data = await resp.json();
        const title = `${data.name} — ${SITE_NAME}`;
        const description = data.description || `Calendario, equipos y partidos de ${data.name}.`;
        const image = data.logo_url || DEFAULT_IMAGE;
        return new Response(buildHtml({ title, description, image, url: request.url }), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
    }

    // Caso 3: calendario de categoría -> /categorias/:categoryId/calendario
    // Puede llevar ?view=equipo&sel=NombreEquipo -> ahí usamos el logo del equipo.
    // En cualquier otro caso (completo/jornada/sede) usamos el logo de la liga.
    const calendarMatch = pathname.match(/^\/categorias\/([^/]+)\/calendario\/?$/);
    if (calendarMatch) {
      const categoryId = calendarMatch[1];
      const view = searchParams.get('view');
      const sel = searchParams.get('sel');
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

        return new Response(buildHtml({ title, description, image, url: request.url }), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
    }
  } catch (err) {
    console.error('Error generando meta tags para bots:', err);
  }

  // Si algo falla o la ruta no coincide con ninguno de los 3 casos, dejamos pasar normal.
  return;
}