// Calcula el estado "real" de un partido para mostrarlo en pantalla.
//
// Regla principal (nueva): si el organizador ya decidió el estado a mano
// (dándole clic a "Iniciar" o "Finalizar"), ese valor se respeta tal cual,
// para siempre — el reloj deja de opinar sobre ese partido.
//
// Solo cuando el partido sigue en "scheduled" (nadie lo ha tocado) entra en
// juego el sistema automático, y SOLO si la categoría a la que pertenece lo
// tiene activado (auto_status_enabled). Si esa categoría no lo activó, el
// partido se queda en "scheduled" indefinidamente, sin límite de tiempo,
// esperando a que alguien lo inicie o finalice a mano.
//
// match.auto_status_enabled y match.auto_status_window_hours deben venir
// incluidos en el partido (heredados de su categoría) para que esto
// funcione — si no vienen, se asume "apagado" por seguridad (nunca se activa
// solo un cálculo que nadie pidió).

export function getMatchStatus(match) {
  // Estado decidido a mano: se respeta sin cuestionarlo.
  if (match.status === 'live' || match.status === 'finished') {
    return match.status;
  }

  // Todavía en automático (nadie lo ha tocado) — pero solo calculamos algo
  // si esa categoría activó el sistema automático.
  if (!match.auto_status_enabled) {
    return 'scheduled';
  }

  const hours     = match.auto_status_window_hours || 3; // resguardo, no debería faltar
  const now       = Date.now();
  const matchTime = new Date(match.match_date).getTime();
  const endTime   = matchTime + hours * 60 * 60 * 1000;

  if (now < matchTime) return 'scheduled'; // aún no empieza
  if (now < endTime)   return 'live';      // dentro de la ventana automática
  return 'finished';                        // ya pasó la ventana automática
}

export function isMatchPast(match) {
  return Date.now() > new Date(match.match_date).getTime();
}

export function isMatchLiveOrPast(match) {
  return Date.now() >= new Date(match.match_date).getTime();
}
