// Función serverless de Vercel (Node.js) — mismo patrón que social-preview.js.
// Genera el sitemap.xml al vuelo, consultando qué ligas/torneos/calendarios/
// partidos son públicos ahora mismo. No es un archivo estático: como el
// contenido cambia todos los días (partidos nuevos, resultados), un archivo
// fijo se quedaría desactualizado casi de inmediato.

const BACKEND_URL = process.env.BACKEND_API_URL || 'https://lifa-backend-p0hq.onrender.com';
const SITE_URL = 'https://calendariosfbamx.vercel.app';

function escapeXml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry(loc, lastmod) {
  const lastmodTag = lastmod ? `<lastmod>${lastmod}</lastmod>` : '';
  return `<url><loc>${escapeXml(loc)}</loc>${lastmodTag}</url>`;
}

export default async function handler(req, res) {
  try {
    const resp = await fetch(`${BACKEND_URL}/api/leagues/sitemap-data`);
    if (!resp.ok) throw new Error(`Backend respondió ${resp.status}`);
    const data = await resp.json();

    const urls = [
      urlEntry(`${SITE_URL}/`),
      ...data.leagueSlugs.map((slug) => urlEntry(`${SITE_URL}/ligas/${slug}`)),
      ...data.tournamentIds.map((id) => urlEntry(`${SITE_URL}/torneos/${id}`)),
      ...data.categoryIds.map((id) => urlEntry(`${SITE_URL}/categorias/${id}/calendario`)),
      ...data.matches.map((m) => urlEntry(
        `${SITE_URL}/partidos/${m.id}`,
        m.matchDate ? new Date(m.matchDate).toISOString().slice(0, 10) : null,
      )),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;

    res.setHeader('content-type', 'application/xml; charset=utf-8');
    // El sitemap no necesita estar al segundo — cachearlo 1 hora en el borde
    // de Vercel evita pegarle al backend en cada visita de Googlebot.
    res.setHeader('cache-control', 's-maxage=3600, stale-while-revalidate');
    return res.status(200).send(xml);
  } catch (err) {
    console.error('Error generando sitemap.xml:', err);
    return res.status(500).send('Error generando el sitemap');
  }
}
