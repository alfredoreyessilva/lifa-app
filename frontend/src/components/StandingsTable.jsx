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

const pct = (v) => (v === 1 ? '1.000' : v.toFixed(3).replace(/^0/, ''));

function recordLabel(rec) {
  if (!rec) return '—';
  const base = `${rec.wins}-${rec.losses}`;
  return rec.ties ? `${base}-${rec.ties}` : base;
}

const SCOPE_HEADER = { conference: 'EN CONF.', group: 'EN GRUPO' };

export default function StandingsTable({ table, usesPoints, qualifyingCount = 0 }) {
  const { level, scope_name, rows } = table;
  const showScope = level !== 'branch';
  const anyTies = rows.some((r) => r.ties > 0);

  return (
    <div className="standings-block">
      {scope_name && <div className="standings-scope-name">{scope_name}</div>}

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
              <th className="col-num">Racha</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.team_id}
                className={[
                  (qualifyingCount && r.rank <= qualifyingCount) || r.qualified_as === 'wildcard'
                    ? 'standings-qualifies' : '',
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
                <td className="col-num">{r.streak || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
