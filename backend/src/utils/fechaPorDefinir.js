// Partidos con fecha por definir (README, "Partidos con fecha por definir").
//
// Sin fecha es `matches.match_date` en NULL, y nada más: no hay bandera aparte
// ni fecha de relleno. Aquí vive lo que hay que decidir con esa regla y se
// puede probar sin Postgres: cómo se lee la fecha de una fila del Excel y
// cuándo un partido sigue por jugarse.

import { zonedTimeToUtcISO } from './timezones.js';

// Lo que una liga escribe en la celda de Fecha cuando todavía no la tiene. Se
// compara sin acentos ni mayúsculas y sin puntos, para que "Por Definir",
// "POR DEFINIR." o "T.B.D." caigan igual.
const SIN_FECHA = new Set(['por definir', 'pendiente', 'tbd', 'tba', 'por confirmar', 'sin fecha', 'pd']);

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

export function diceSinFecha(texto) {
  return SIN_FECHA.has(normalizar(texto));
}

/**
 * La fecha de una fila del Excel de calendario.
 *
 * @param {object} p
 * @param {string} p.fechaRaw  el texto de la celda Fecha, ya recortado
 * @param {string} p.horaRaw   el texto de la celda Hora, ya recortado
 * @param {Date|null} p.celdaFecha  la celda Fecha cuando el Excel la guardó
 *                                  como fecha de verdad (`cellDates: true`)
 * @param {string} p.timezone  la zona con la que se interpreta la hora
 * @returns {{ matchDate: string|null, aviso: string|null }}
 *   `matchDate` en ISO UTC, o null si el partido queda con fecha por definir.
 *   `aviso` dice por qué, cuando el Excel traía algo que no se usó.
 */
export function fechaDeFilaDelExcel({ fechaRaw, horaRaw, celdaFecha, timezone }) {
  let y = null, mo = null, d = null;

  // Mismo criterio que antes de este cambio: los componentes del Date que
  // armó la librería del Excel, leídos como vienen.
  if (celdaFecha instanceof Date && !Number.isNaN(celdaFecha.getTime())) {
    y = celdaFecha.getFullYear(); mo = celdaFecha.getMonth() + 1; d = celdaFecha.getDate();
  }
  if (y === null && fechaRaw) {
    const dmy = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/.exec(fechaRaw);
    if (dmy) { d = Number(dmy[1]); mo = Number(dmy[2]); y = Number(dmy[3]); }
  }
  if (y === null && fechaRaw) {
    const ymd = /^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/.exec(fechaRaw);
    if (ymd) { y = Number(ymd[1]); mo = Number(ymd[2]); d = Number(ymd[3]); }
  }

  if (y === null) {
    // Sin fecha. Si la celda traía algo que no es "por definir", se dice qué
    // no se entendió: el partido se importa igual, pero sin ese aviso nadie
    // sabría que la fecha se perdió.
    const avisos = [];
    if (fechaRaw && !diceSinFecha(fechaRaw)) {
      avisos.push(`La fecha "${fechaRaw}" no se entendió — el partido se importó con fecha por definir`);
    }
    if (horaRaw && !diceSinFecha(horaRaw)) {
      avisos.push(`Sin fecha no se guarda la hora "${horaRaw}" — el partido quedó con fecha por definir`);
    }
    return { matchDate: null, aviso: avisos.length ? avisos.join('. ') : null };
  }

  // Una fecha que no existe (31/02, 15/13) también es "no se entendió": antes
  // se corría en silencio al mes siguiente.
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return { matchDate: null, aviso: `La fecha "${fechaRaw}" no existe en el calendario — el partido se importó con fecha por definir` };
  }

  let hour = 0, minute = 0;
  if (horaRaw) {
    const t = /^(\d{1,2}):(\d{2})/.exec(horaRaw);
    if (t) { hour = Number(t[1]); minute = Number(t[2]); }
  }
  return { matchDate: zonedTimeToUtcISO(y, mo, d, hour, minute, timezone), aviso: null };
}

/**
 * ¿El partido todavía no se juega? Con fecha, lo dice la fecha. Sin fecha, lo
 * dice su estado: uno programado sigue pendiente; uno que ya marcaron En vivo
 * o Finalizado, no — aunque nadie le haya puesto fecha.
 */
export function sigueSinJugarse(match, ahoraMs = Date.now()) {
  if (!match) return false;
  if (match.match_date == null || match.match_date === '') {
    return match.status !== 'live' && match.status !== 'finished';
  }
  return new Date(match.match_date).getTime() > ahoraMs;
}
