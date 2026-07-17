// Calcula el estado de un partido en tiempo real
// según la hora actual vs la hora programada.
// Se usa tanto en la vista pública como en el panel.

const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000; // 3 horas en milisegundos

export function getMatchStatus(match) {
  const now       = Date.now();
  const matchTime = new Date(match.match_date).getTime();
  const endTime   = matchTime + LIVE_WINDOW_MS;

  // El estado depende exclusivamente del horario (fecha + ventana de 3h).
  // Tener marcador capturado NO significa que el partido ya terminó — el
  // marcador es solo un dato, no debe adelantar ni forzar el estado.
  if (now < matchTime)  return 'scheduled'; // aún no empieza
  if (now < endTime)    return 'live';      // dentro de la ventana de 3h
  return 'finished';                         // ya pasaron las 3h
}

export function isMatchPast(match) {
  return Date.now() > new Date(match.match_date).getTime();
}

export function isMatchLiveOrPast(match) {
  return Date.now() >= new Date(match.match_date).getTime();
}