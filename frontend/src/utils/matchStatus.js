// Calcula el estado de un partido en tiempo real
// según la hora actual vs la hora programada.
// Se usa tanto en la vista pública como en el panel.

const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000; // 3 horas en milisegundos

export function getMatchStatus(match) {
  const now       = Date.now();
  const matchTime = new Date(match.match_date).getTime();
  const endTime   = matchTime + LIVE_WINDOW_MS;

  // Si ya tiene marcador capturado, siempre es finalizado
  if (match.home_score !== null && match.home_score !== undefined &&
      match.away_score !== null && match.away_score !== undefined) {
    return 'finished';
  }

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