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