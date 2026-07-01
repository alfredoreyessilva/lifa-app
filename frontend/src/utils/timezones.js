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