// Funciones para mostrar fecha/hora, zona horaria, jornadas e iniciales de equipo.
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

// Sin fecha (match_date en null) es "fecha por definir" (README, "Partidos con
// fecha por definir"): se devuelven las partes vacías con `porDefinir`, y cada
// pantalla lo dice a su manera. `new Date(null)` daría el 31 de diciembre de
// 1969, que es lo que se veía si alguien se saltaba esta revisión.
export function getMatchParts(isoString, tz) {
  if (!isoString) return { day: '', month: '', time: '', tzLabel: '', porDefinir: true };
  const zone       = tz || DEFAULT_TZ;
  const date       = new Date(isoString);
  const dayStr     = date.toLocaleString('es-MX', { timeZone: zone, day: 'numeric' });
  const monthIndex = Number(date.toLocaleString('en-US', { timeZone: zone, month: 'numeric' })) - 1;
  const time       = date.toLocaleTimeString('es-MX', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
  const tzLabel    = TZ_LABELS[zone] || zone;
  return { day: dayStr, month: MESES[monthIndex], time, tzLabel, porDefinir: false };
}

// El orden del calendario cuando hay partidos con fecha por definir (README,
// "Partidos con fecha por definir"). Los que tienen fecha se quedan como
// llegan —el backend ya los manda en orden de fecha—, y cada uno sin fecha va
// justo después del último con fecha de su jornada. Si su jornada no tiene
// ninguno con fecha, o no tiene jornada, va al final: por número de jornada y
// luego por id, así que un calendario todo sin fechas sale en orden de jornada.
//
// Las flechas de partido anterior y siguiente (GET /leagues/matches/:id)
// hacen lo mismo en SQL; si cambia aquí, cambia allá.
export function ordenarCalendario(matches) {
  if (!matches.some((m) => !m.match_date)) return matches;

  const ultimoDeJornada = new Map();
  for (const m of matches) {
    if (!m.match_date || !m.week_label) continue;
    const prev = ultimoDeJornada.get(m.week_label);
    if (!prev || m.match_date > prev) ultimoDeJornada.set(m.week_label, m.match_date);
  }
  const clave = (m) => m.match_date || (m.week_label && ultimoDeJornada.get(m.week_label)) || null;
  const numero = (m) => (/^\d+$/.test(m.week_label || '') ? Number(m.week_label) : Infinity);

  // sort es estable: dos con fecha a la misma hora se quedan como llegaron.
  return [...matches].sort((a, b) => {
    const ka = clave(a);
    const kb = clave(b);
    if (ka !== kb) {
      if (ka == null) return 1;
      if (kb == null) return -1;
      return ka < kb ? -1 : 1;
    }
    if (!a.match_date !== !b.match_date) return a.match_date ? -1 : 1;
    if (a.match_date) return 0;
    const porNumero = numero(a) - numero(b);
    return (Number.isNaN(porNumero) ? 0 : porNumero) || a.id - b.id;
  });
}

// "3" → "Jornada 3"; "SEMIFINAL" se queda como está. Un partido sin jornada
// solo llega aquí cuando la lista mezcla partidos con y sin ella.
export function jornadaLabel(weekLabel) {
  if (!weekLabel) return 'Sin jornada';
  return /^\d+$/.test(weekLabel) ? `Jornada ${weekLabel}` : weekLabel;
}

// Parte el calendario en tramos consecutivos de la misma jornada, para que
// en la cuadrícula de dos columnas el último partido de una jornada no quede
// junto al primero de la siguiente. NO reordena: la lista llega en orden de
// fecha y así se queda, porque es como la afición busca "qué sigue". Si un
// partido reprogramado cae entre otras jornadas, forma su propio tramo con su
// etiqueta — la misma jornada puede aparecer dos veces, y es cierto.
export function groupByJornada(matches) {
  const groups = [];
  for (const m of acomodarEmpates(matches)) {
    const week = m.week_label || null;
    const last = groups[groups.length - 1];
    if (last && last.week === week) last.matches.push(m);
    else groups.push({ key: `${groups.length}-${week ?? ''}`, week, label: jornadaLabel(week), matches: [m] });
  }
  return groups;
}

// Partidos a la misma hora exacta no tienen orden entre sí (el backend ordena
// solo por fecha y el empate sale como caiga), así que dentro del empate va
// primero el que sigue la jornada de antes y al final el que abre la de
// después. Sin esto, el último de la Jornada 2 de ONEFA y un scrimmage a la
// misma hora partían la jornada en dos tramos.
function acomodarEmpates(matches) {
  const week = (m) => m?.week_label || null;
  // Sin fecha no empata con nadie (NaN !== NaN): su lugar ya lo decidió
  // ordenarCalendario.
  const time = (m) => (m.match_date ? new Date(m.match_date).getTime() : NaN);
  const out = [];
  let i = 0;
  while (i < matches.length) {
    let j = i + 1;
    while (j < matches.length && time(matches[j]) === time(matches[i])) j++;
    const prev = out.length ? week(out[out.length - 1]) : undefined;
    const next = j < matches.length ? week(matches[j]) : undefined;
    const rank = (m) => (week(m) === prev ? 0 : week(m) === next ? 2 : 1);
    // sort es estable: los que no se mueven conservan su orden.
    const tie = matches.slice(i, j).sort((a, b) =>
      rank(a) - rank(b) || (rank(a) === 1 ? String(week(a)).localeCompare(String(week(b))) : 0));
    out.push(...tie);
    i = j;
  }
  return out;
}

// "12–14 SEP", "30 AGO – 2 SEP" o "12 SEP" si todo es el mismo día. Cada
// partido se lee en su propia zona horaria, igual que en su tarjeta. Los de
// fecha por definir no mueven el rango; si ninguno tiene fecha, lo dice.
export function jornadaDateRange(allMatches) {
  if (allMatches.length === 0) return '';
  const matches = allMatches.filter((m) => m.match_date);
  if (matches.length === 0) return 'Fecha por definir';
  let first = matches[0];
  let last  = matches[0];
  for (const m of matches) {
    if (new Date(m.match_date) < new Date(first.match_date)) first = m;
    if (new Date(m.match_date) > new Date(last.match_date)) last = m;
  }
  const a = getMatchParts(first.match_date, first.timezone);
  const b = getMatchParts(last.match_date, last.timezone);
  if (a.month !== b.month) return `${a.day} ${a.month} – ${b.day} ${b.month}`;
  if (a.day !== b.day) return `${a.day}–${b.day} ${a.month}`;
  return `${a.day} ${a.month}`;
}

// "Viernes 6 de noviembre", en la zona del partido, como en su tarjeta. El año
// solo se dice si no es el de hoy: la LFA tiene temporadas cargadas de años
// pasados, y ahí "Domingo 7 de junio" no alcanza.
export function fechaLarga(isoString, tz, ahora = Date.now()) {
  if (!isoString) return '';
  const timeZone = tz || DEFAULT_TZ;
  const partes = new Intl.DateTimeFormat('es-MX', {
    timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).formatToParts(new Date(isoString));
  const de = (tipo) => partes.find((p) => p.type === tipo)?.value || '';
  const dia = de('weekday');
  const fecha = `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${de('day')} de ${de('month')}`;
  const anioDeHoy = new Intl.DateTimeFormat('es-MX', { timeZone, year: 'numeric' }).format(new Date(ahora));
  return de('year') === anioDeHoy ? fecha : `${fecha} de ${de('year')}`;
}

// Qué partido es dentro de la competencia. Casi siempre, su jornada. La fase
// solo manda cuando la etiqueta no dice nada: ONEFA captura sus playoffs como
// "PLAYOFF" y la fase es la que sabe que son los cuartos de final; en cambio, la
// LFA captura "FINAL" y su fase se llama "Postemporada", que dice menos.
export function rondaDelPartido(match) {
  const etiqueta = (match.week_label || '').trim();
  const generica = !etiqueta || etiqueta.toUpperCase() === 'PLAYOFF';
  if (generica && match.phase_name && match.phase_type === 'single_elimination') return match.phase_name;
  return etiqueta ? jornadaLabel(etiqueta) : (match.phase_name || '');
}

// "6:00 p.m." → la cifra y el resto, para que la hora se escriba grande como un
// marcador sin que el "p.m." pese lo mismo.
export function partirHora(time) {
  const m = /^(\d{1,2}:\d{2})\s*(.*)$/.exec(time || '');
  return m ? { cifra: m[1], sufijo: m[2] } : { cifra: time || '', sufijo: '' };
}

// Cuánto falta para que empiece, o null si ya pasó la hora o no hay fecha.
export function cuentaRegresiva(isoString, ahora = Date.now()) {
  if (!isoString) return null;
  const faltan = new Date(isoString).getTime() - ahora;
  if (!(faltan > 0)) return null;
  const segundos = Math.floor(faltan / 1000);
  return {
    dias: Math.floor(segundos / 86400),
    horas: Math.floor(segundos / 3600) % 24,
    minutos: Math.floor(segundos / 60) % 60,
    segundos: segundos % 60,
  };
}

const PLATAFORMAS = [
  [/(^|\.)youtube\.com$|^youtu\.be$/, 'YouTube'],
  [/(^|\.)facebook\.com$|^fb\.watch$/, 'Facebook'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)twitch\.tv$/, 'Twitch'],
  [/^(x|twitter)\.com$/, 'X'],
  [/(^|\.)eventbrite\.[a-z.]+$/, 'Eventbrite'],
];

// Dónde abre un link de transmisión, para que el botón lo diga: "Ver partido en
// YouTube". Lo que no se reconoce se nombra por su dominio.
export function plataformaDe(url) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'link';
  }
  const conocida = PLATAFORMAS.find(([patron]) => patron.test(host));
  return conocida ? conocida[1] : host;
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
  lines.push(dateParts.porDefinir
    ? '📅 Fecha por definir'
    : `📅 ${dateParts.day} ${dateParts.month} · ${dateParts.time} (${dateParts.tzLabel})`);

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