// Lógica de calificación de predicciones, compartida por todos los rankings
// (calendario, quiniela, tarjeta de jugador) para que todos usen exactamente
// el mismo criterio.
//
// REGLA CLAVE: una predicción NO reparte ni descuenta puntos hasta que el
// partido terminó DE VERDAD. Tener marcador capturado no basta — mientras el
// partido está EN VIVO el organizador va subiendo el marcador parcial, y ese
// marcador no debe calificar a nadie todavía.
//
// Un partido está "terminado" cuando:
//   - el organizador le dio "Finalizar" a mano (matches.status = 'finished'), o
//   - su categoría tiene el auto-status activado y ya pasó la ventana de juego
//     (mismo cálculo que getMatchStatus() en frontend/src/utils/matchStatus.js).
// Un partido 'live', o 'scheduled' sin auto-status, o todavía dentro de la
// ventana automática, NO cuenta aunque ya tenga marcador.
//
// Las consultas que usen estos fragmentos deben tener en el FROM:
//   JOIN matches m ON ...
//   JOIN categories c ON c.id = m.category_id
export const MATCH_IS_FINAL_SQL = `
  (
    m.status = 'finished'
    OR (
      m.status = 'scheduled'
      AND COALESCE(c.auto_status_enabled, FALSE) = TRUE
      AND NOW() >= (m.match_date::timestamptz + (COALESCE(c.auto_status_window_hours, 3) || ' hours')::interval)
    )
  )
`;

// El partido ya se puede calificar: terminó y tiene marcador capturado.
export const MATCH_GRADABLE_SQL = `(${MATCH_IS_FINAL_SQL} AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL)`;

// La predicción `p` acertó (el partido ya es calificable y el pick coincide
// con el resultado).
export const PREDICTION_CORRECT_SQL = `(
  ${MATCH_GRADABLE_SQL} AND (
    (p.pick = 'home' AND m.home_score > m.away_score) OR
    (p.pick = 'away' AND m.away_score > m.home_score) OR
    (p.pick = 'tie'  AND m.home_score = m.away_score)
  )
)`;

// Puntos que vale este renglón de predicción: 0 si no acertó (o el partido
// aún no termina), 2 por acierto en fase final y 1 en cualquier otro caso.
export const PREDICTION_POINTS_SQL = `
  CASE WHEN ${PREDICTION_CORRECT_SQL}
    THEN (CASE WHEN m.week_label IN ('PLAYOFF', 'SEMIFINAL', 'FINAL') THEN 2 ELSE 1 END)
    ELSE 0 END
`;
