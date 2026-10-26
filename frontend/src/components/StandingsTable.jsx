// Una tabla de posiciones. Solo pinta — no calcula nada: el orden, los
// récords y los desempates ya vienen resueltos del backend
// (utils/standings.js), que es el único lugar donde vive el reglamento.
//
// Dos decisiones de presentación que no son adorno:
//
//   · La columna "EN <alcance>" solo aparece en tablas de conferencia o
//     grupo, porque solo ahí significa algo distinto del récord general. En
//     la tabla de toda la rama los dos números son el mismo por definición.
//   · Un empate que el reglamento no resolvió se MARCA. La alternativa
//     (dejar el orden que salió) haría pasar por resuelto algo que no lo
//     está, y es justo el caso en el que la liga necesita intervenir.
//   · AVG (goal average) solo aparece si el reglamento de la tabla lo usa, y
//     en el teléfono se queda aunque PF y PC se escondan: es la cifra que
//     decide el empate.
//
// Cómo se escribe cada cifra vive en utils/standingsFormat.js, compartido con
// la imagen para compartir: la tabla y la imagen no pueden decir cosas
// distintas. `action` es lo que va a la derecha del nombre de la tabla (hoy,
// el botón de generar su imagen).

import { pct, recordLabel, rowQualifies, goalAverageLabel, showsGoalAverage } from '../utils/standingsFormat.js';

const SCOPE_HEADER = { conference: 'EN CONF.', group: 'EN GRUPO' };

export default function StandingsTable({ table, usesPoints, qualifyingCount = 0, action = null }) {
  const { level, scope_name, rows } = table;
  const showScope = level !== 'branch';
  const showAvg = showsGoalAverage(table);
  const anyTies = rows.some((r) => r.ties > 0);

  return (
    <div className="standings-block">
      {(scope_name || action) && (
        <div className="standings-block-head">
          {scope_name && <div className="standings-scope-name">{scope_name}</div>}
          {action && <div className="standings-block-action">{action}</div>}
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table standings-table">
          <thead>
            <tr>
              <th className="standings-pos">#</th>
              <th>Equipo</th>
              <th className="col-num">JJ</th>
              <th className="col-num">G</th>
              <th className="col-num">P</th>
              {anyTies && <th className="col-num">E</th>}
              {usesPoints
                ? <th className="col-num">PTS</th>
                : <th className="col-num" title="Porcentaje de ganados (el empate cuenta medio juego)">%</th>}
              {showScope && <th className="col-num">{SCOPE_HEADER[level]}</th>}
              <th className="col-num standings-hide-sm" title="Puntos a favor">PF</th>
              <th className="col-num standings-hide-sm" title="Puntos en contra">PC</th>
              <th className="col-num" title="Diferencia de puntos">DIF</th>
              {showAvg && <th className="col-num" title="Goal average: puntos a favor ÷ puntos en contra">AVG</th>}
              <th className="col-num">Racha</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.team_id}
                className={[
                  rowQualifies(r, qualifyingCount) ? 'standings-qualifies' : '',
                  r.played === 0 ? 'row-muted' : '',
                ].filter(Boolean).join(' ')}
              >
                <td className="standings-pos">{r.rank}</td>
                <td>
                  <div className="standings-team">
                    {r.logo_url && <img src={r.logo_url} alt="" className="standings-logo" />}
                    <span>{r.name}</span>
                    {r.qualified_as === 'wildcard' && (
                      <span
                        className="standings-wildcard"
                        title="Clasifica por lugar extra: comparado contra los del mismo lugar de las otras tablas."
                      >
                        comodín
                      </span>
                    )}
                    {r.unresolved_tie && (
                      <span
                        className="standings-flag"
                        title="El reglamento de desempates no alcanzó a separar a estos equipos. Defínelo a mano según tu reglamento."
                      >
                        empate sin resolver
                      </span>
                    )}
                  </div>
                </td>
                <td className="col-num">{r.played}</td>
                <td className="col-num">{r.wins}</td>
                <td className="col-num">{r.losses}</td>
                {anyTies && <td className="col-num">{r.ties}</td>}
                {usesPoints
                  ? <td className="col-num standings-key">{r.table_points}</td>
                  : <td className="col-num standings-key">{pct(r.win_pct)}</td>}
                {showScope && <td className="col-num">{recordLabel(r.scope_record)}</td>}
                <td className="col-num standings-hide-sm">{r.points_for}</td>
                <td className="col-num standings-hide-sm">{r.points_against}</td>
                <td className={`col-num ${r.point_diff > 0 ? 'standings-pos-diff' : r.point_diff < 0 ? 'standings-neg-diff' : ''}`}>
                  {r.point_diff > 0 ? `+${r.point_diff}` : r.point_diff}
                </td>
                {showAvg && <td className="col-num">{goalAverageLabel(r)}</td>}
                <td className="col-num">{r.streak || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
