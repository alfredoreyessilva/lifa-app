// El detalle de una fila del ranking de predicciones. Función PURA, sin DOM: la
// usan la pestaña Ranking (CalendarRanking.jsx), la quiniela (PoolRanking.jsx) y
// la imagen para compartir (rankingShareCard.js), para que las tres digan
// exactamente lo mismo, y por eso se puede probar con node --test.
//
// La fracción son ACIERTOS sobre partidos calificados, no puntos, y por eso no
// tiene que coincidir con los puntos de la fila: un acierto en fase final vale 2.
// Cuántos fueron se dice aparte (README, "La fila dice aciertos"). El dato viene
// del backend: si no viene, la fila simplemente no lo menciona.
export function rankingDetail(r) {
  if (r.graded > 0) {
    const partes = [`${r.correct}/${r.graded} aciertos`];
    if (r.correctFinalPhase > 0) partes.push(`${r.correctFinalPhase} en fase final`);
    if (r.accuracyPct != null) partes.push(`${r.accuracyPct}%`);
    return partes.join(' · ');
  }
  return `${r.total} ${r.total === 1 ? 'predicción' : 'predicciones'} · sin calificar`;
}
