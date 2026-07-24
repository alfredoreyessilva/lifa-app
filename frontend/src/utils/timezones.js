// Lista de zonas horarias de América para los selectores del frontend.
// El "value" debe coincidir exactamente con backend/src/utils/timezones.js

export const TIMEZONE_GROUPS = [
  {
    label: 'México',
    options: [
      { value: 'America/Tijuana',     label: 'Pacífico — Tijuana, Baja California' },
      { value: 'America/Hermosillo',  label: 'Pacífico — Sonora' },
      { value: 'America/Mazatlan',    label: 'Pacífico — Mazatlán, Sinaloa' },
      { value: 'America/Chihuahua',   label: 'Pacífico/Montaña — Chihuahua' },
      { value: 'America/Mexico_City', label: 'Centro — CDMX, Guadalajara, Monterrey' },
      { value: 'America/Merida',      label: 'Centro — Mérida, Yucatán' },
      { value: 'America/Cancun',      label: 'Sureste — Cancún, Quintana Roo' },
    ],
  },
  {
    label: 'Estados Unidos',
    options: [
      { value: 'America/Los_Angeles', label: 'Pacífico — Los Ángeles, California' },
      { value: 'America/Denver',      label: 'Montaña — Denver, Colorado' },
      { value: 'America/Chicago',     label: 'Centro — Chicago, Texas' },
      { value: 'America/New_York',    label: 'Este — Nueva York, Florida' },
    ],
  },
  {
    label: 'Canadá',
    options: [
      { value: 'America/Vancouver', label: 'Pacífico — Vancouver' },
      { value: 'America/Edmonton',  label: 'Montaña — Edmonton' },
      { value: 'America/Winnipeg',  label: 'Centro — Winnipeg' },
      { value: 'America/Toronto',   label: 'Este — Toronto' },
      { value: 'America/Halifax',   label: 'Atlántico — Halifax' },
    ],
  },
  {
    label: 'Centroamérica',
    options: [
      { value: 'America/Guatemala',   label: 'Guatemala' },
      { value: 'America/Belize',      label: 'Belice' },
      { value: 'America/Tegucigalpa', label: 'Honduras' },
      { value: 'America/Managua',     label: 'Nicaragua' },
      { value: 'America/Costa_Rica',  label: 'Costa Rica' },
      { value: 'America/Panama',      label: 'Panamá' },
    ],
  },
  {
    label: 'Caribe',
    options: [
      { value: 'America/Havana',        label: 'Cuba' },
      { value: 'America/Santo_Domingo', label: 'República Dominicana' },
      { value: 'America/Puerto_Rico',   label: 'Puerto Rico' },
    ],
  },
  {
    label: 'Sudamérica',
    options: [
      { value: 'America/Bogota',                 label: 'Colombia' },
      { value: 'America/Lima',                   label: 'Perú' },
      { value: 'America/Caracas',                label: 'Venezuela' },
      { value: 'America/Guayaquil',               label: 'Ecuador' },
      { value: 'America/La_Paz',                 label: 'Bolivia' },
      { value: 'America/Santiago',               label: 'Chile' },
      { value: 'America/Argentina/Buenos_Aires', label: 'Argentina' },
      { value: 'America/Montevideo',             label: 'Uruguay' },
      { value: 'America/Asuncion',               label: 'Paraguay' },
      { value: 'America/Sao_Paulo',              label: 'Brasil' },
    ],
  },
];

// Lista plana, útil para validar o buscar una zona por su value
export const ALL_TIMEZONES = TIMEZONE_GROUPS.flatMap((g) => g.options);

export function getTimezoneLabel(value) {
  const found = ALL_TIMEZONES.find((tz) => tz.value === value);
  return found ? found.label : value;
}

// ── Conversión zona-explícita, SOLO para vista previa en pantalla ─────────
// Importante: estas funciones existen únicamente para que la interfaz pueda
// (a) precargar el formulario de edición mostrando la hora correcta y (b)
// calcular en vivo si un partido ya se ve "en vivo"/"finalizado" mientras el
// usuario todavía está escribiendo, sin esperar una vuelta al servidor.
// La conversión que de verdad se GUARDA nunca ocurre aquí: el frontend manda
// la fecha/hora local cruda + la zona elegida, y el backend hace la única
// conversión autoritativa (ver backend/src/utils/timezones.js). Usan el mismo
// enfoque (Intl con zona explícita) para no reintroducir el bug de fondo,
// pero viven en dos archivos porque son dos entornos de ejecución distintos.

// Dado un instante UTC (ISO) ya guardado, arma el string "YYYY-MM-DDTHH:mm"
// que espera un <input type="datetime-local">, mostrando la hora en la zona
// del partido — no en la zona del navegador de quien está editando.
export function utcIsoToLocalInputValue(isoString, timeZone) {
  if (!isoString) return '';
  const zone = timeZone || 'America/Mexico_City';
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(isoString)).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

// Dirección opuesta: string crudo de un <input type="datetime-local"> + zona
// IANA -> milisegundos UTC. Se usa solo para la vista previa en vivo del
// estado del partido (programado/en vivo/finalizado) mientras se llena el
// formulario, antes de guardar.
export function localDateTimeStringToUtcMs(localValue, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localValue || '');
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const zone = timeZone || 'America/Mexico_City';

  const asUTC = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(asUTC)).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const formattedAsUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    parts.hour === '24' ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  const offsetMs = formattedAsUTC - asUTC;
  return asUTC - offsetMs;
}

// Da el offset actual (ej. "GMT-6") de una zona horaria, útil como ayuda visual
export function getTimezoneOffset(tz) {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find((p) => p.type === 'timeZoneName');
    return offsetPart ? offsetPart.value : '';
  } catch {
    return '';
  }
}