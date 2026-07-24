// Lista de zonas horarias IANA válidas para América.
// Se usa para validar que el valor recibido del frontend sea uno real
// y no un texto arbitrario que rompería el cálculo de fechas.

export const AMERICA_TIMEZONES = [
  // México
  'America/Tijuana',        // Pacífico (Baja California)
  'America/Hermosillo',     // Sonora (sin horario de verano)
  'America/Mazatlan',       // Pacífico
  'America/Chihuahua',      // Pacífico/Montaña
  'America/Mexico_City',    // Centro
  'America/Merida',         // Centro (Yucatán)
  'America/Cancun',         // Sureste (Quintana Roo)

  // Estados Unidos
  'America/Los_Angeles',    // Pacífico EE.UU.
  'America/Denver',         // Montaña EE.UU.
  'America/Chicago',        // Centro EE.UU.
  'America/New_York',       // Este EE.UU.

  // Canadá
  'America/Vancouver',
  'America/Edmonton',
  'America/Winnipeg',
  'America/Toronto',
  'America/Halifax',

  // Centroamérica
  'America/Guatemala',
  'America/Belize',
  'America/Tegucigalpa',
  'America/Managua',
  'America/Costa_Rica',
  'America/Panama',

  // Caribe
  'America/Havana',
  'America/Santo_Domingo',
  'America/Puerto_Rico',

  // Sudamérica
  'America/Bogota',
  'America/Lima',
  'America/Caracas',
  'America/Guayaquil',
  'America/La_Paz',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/Montevideo',
  'America/Asuncion',
  'America/Sao_Paulo',
];

export function isValidTimezone(tz) {
  return AMERICA_TIMEZONES.includes(tz);
}

// ── Conversión de hora local <-> UTC, zona-explícita ──────────────────────
// Esta es la ÚNICA lógica del proyecto que debe convertir entre "hora de
// pared en una zona IANA" y "instante UTC real". Antes existían varias
// versiones improvisadas de esto (en la importación de Excel, en el
// formulario manual de partidos, y en el precargado del formulario al
// editar) — cada una usando la zona horaria AMBIENTE de quien ejecutaba el
// código (el servidor o el navegador) en vez de la zona EXPLÍCITA del dato,
// lo cual producía el mismo tipo de desfase en tres lugares distintos.
//
// Regla del proyecto: cualquier conversión LOCAL -> UTC pasa por aquí, y
// solo se ejecuta en el backend (nunca en el navegador), porque es el único
// entorno que no depende de en qué zona horaria esté físicamente el
// dispositivo de quien está capturando el partido.

// Convierte año/mes/día/hora/minuto (hora de pared, sin zona) EN una zona
// IANA específica, al instante UTC real que representa.
export function zonedTimeToUtcISO(year, month, day, hour, minute, timeZone) {
  const asUTC = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
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
  return new Date(asUTC - offsetMs).toISOString();
}

// Parsea el string crudo que entrega un input <input type="datetime-local">
// ("YYYY-MM-DDTHH:mm...") a sus componentes numéricos, SIN construir ningún
// objeto Date todavía (para no involucrar ninguna zona horaria ambiente).
export function parseLocalDateTimeString(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  return { year, month, day, hour, minute };
}

// Atajo: string crudo de un <input type="datetime-local"> + zona IANA -> ISO UTC.
export function localDateTimeStringToUtcISO(localValue, timeZone) {
  const parts = parseLocalDateTimeString(localValue);
  if (!parts) return null;
  return zonedTimeToUtcISO(parts.year, parts.month, parts.day, parts.hour, parts.minute, timeZone);
}

// Dirección inversa: dado un instante UTC ya guardado, ¿qué hora de pared
// (año/mes/día/hora/minuto) representa en una zona IANA específica? Se usa
// para RE-interpretar la misma hora de pared en una zona nueva cuando alguien
// edita solo la zona horaria de un partido sin tocar la fecha/hora.
export function getLocalPartsInZone(isoString, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(isoString)).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    year:   Number(parts.year),
    month:  Number(parts.month),
    day:    Number(parts.day),
    hour:   parts.hour === '24' ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
  };
}
