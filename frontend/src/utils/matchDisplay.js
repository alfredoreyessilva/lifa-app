// Funciones para mostrar fecha/hora, zona horaria e iniciales de equipo.
// Se usan tanto en el calendario (CalendarPage) como en el detalle de partido (MatchPage).

export const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
export const DEFAULT_TZ = 'America/Mexico_City';

export const TZ_LABELS = {
  'America/Tijuana':                'Hora Pacífico MX',
  'America/Hermosillo':             'Hora Sonora',
  'America/Mazatlan':               'Hora Pacífico MX',
  'America/Chihuahua':              'Hora Chihuahua',
  'America/Mexico_City':            'Hora Centro MX',
  'America/Merida':                 'Hora Centro MX',
  'America/Cancun':                 'Hora Cancún',
  'America/Los_Angeles':            'Hora Pacífico EE.UU.',
  'America/Denver':                 'Hora Montaña EE.UU.',
  'America/Chicago':                'Hora Centro EE.UU.',
  'America/New_York':               'Hora Este EE.UU.',
  'America/Vancouver':              'Hora Pacífico CA',
  'America/Edmonton':               'Hora Montaña CA',
  'America/Winnipeg':               'Hora Centro CA',
  'America/Toronto':                'Hora Este CA',
  'America/Halifax':                'Hora Atlántico CA',
  'America/Guatemala':              'Hora Guatemala',
  'America/Belize':                 'Hora Belice',
  'America/Tegucigalpa':            'Hora Honduras',
  'America/Managua':                'Hora Nicaragua',
  'America/Costa_Rica':             'Hora Costa Rica',
  'America/Panama':                 'Hora Panamá',
  'America/Havana':                 'Hora Cuba',
  'America/Santo_Domingo':          'Hora R. Dominicana',
  'America/Puerto_Rico':            'Hora Puerto Rico',
  'America/Bogota':                 'Hora Colombia',
  'America/Lima':                   'Hora Perú',
  'America/Caracas':                'Hora Venezuela',
  'America/Guayaquil':              'Hora Ecuador',
  'America/La_Paz':                 'Hora Bolivia',
  'America/Santiago':               'Hora Chile',
  'America/Argentina/Buenos_Aires': 'Hora Argentina',
  'America/Montevideo':             'Hora Uruguay',
  'America/Asuncion':               'Hora Paraguay',
  'America/Sao_Paulo':              'Hora Brasil',
};

export function getMatchParts(isoString, tz) {
  const zone       = tz || DEFAULT_TZ;
  const date       = new Date(isoString);
  const dayStr     = date.toLocaleString('es-MX', { timeZone: zone, day: 'numeric' });
  const monthIndex = Number(date.toLocaleString('en-US', { timeZone: zone, month: 'numeric' })) - 1;
  const time       = date.toLocaleTimeString('es-MX', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
  const tzLabel    = TZ_LABELS[zone] || zone;
  return { day: dayStr, month: MESES[monthIndex], time, tzLabel };
}

export function initials(name) {
  return (name || '')
    .split(' ')
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

// Arma el texto que acompaña a la imagen del partido al compartir (botón
// "Generar imagen" → "Compartir"). Incluye lo que ya tenga cargado el
// partido — nada se inventa — y omite cualquier dato que no exista.
//
// Reglas de contenido (acordadas en conversación de producto):
// - Si el partido ya finalizó y tiene marcador, se muestra el resultado.
// - Si no ha finalizado y tiene links de transmisión, se listan TODOS los
//   que haya (sin distinguir si son del equipo local o visitante — el
//   partido los guarda ya mezclados en un solo arreglo, sin ese detalle).
// - Siempre cierra con el link a la ficha del partido dentro de la app.
export function buildMatchShareText(match, dateParts, status) {
  const lines = [];

  lines.push(`${match.home_team} vs ${match.away_team} — CFBAMX`);
  lines.push(`📅 ${dateParts.day} ${dateParts.month} · ${dateParts.time} (${dateParts.tzLabel})`);

  const metaParts = [];
  if (match.league_name) metaParts.push(match.league_name);
  if (match.tournament_name) metaParts.push(match.tournament_name);
  if (match.week_label) {
    metaParts.push(/^\d+$/.test(match.week_label) ? `Jornada ${match.week_label}` : match.week_label);
  }
  if (match.venue_name) metaParts.push(match.venue_name);
  if (metaParts.length) lines.push(`🏈 ${metaParts.join(' · ')}`);

  const hasScore = status === 'finished' && match.home_score != null && match.away_score != null;
  if (hasScore) {
    lines.push('');
    lines.push(`Resultado final: ${match.home_team} ${match.home_score} - ${match.away_score} ${match.away_team}`);
  }

  if ((match.stream_links || []).length > 0) {
    lines.push('');
    if (status === 'live') lines.push('🔴 En vivo ahora:');
    else if (status === 'finished') lines.push('📺 Repetición:');
    else lines.push('📺 Míralo aquí:');
    for (const url of match.stream_links) lines.push(url);
  }

  lines.push('');
  lines.push('Más detalles del partido:');
  lines.push(`${window.location.origin}/partidos/${match.id}`);

  return lines.join('\n');
}