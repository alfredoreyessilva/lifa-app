import { useState } from 'react';
import StandingsTable from './StandingsTable.jsx';

// La vista completa de posiciones de una rama: los campeones arriba, y
// abajo las tablas del nivel que se esté viendo.
//
// Una rama puede tener VARIOS niveles de tabla a la vez (por grupo, por
// conferencia, y general) porque así son las competencias reales: hay ligas
// que publican los tres. Se muestran como pestañas y no todas apiladas —
// apiladas, la pantalla de una liga con 8 grupos sería un muro de tablas
// donde no se encuentra nada.
//
// Si la liga configuró un solo nivel (el caso más común), no hay pestañas:
// se ve la tabla y ya.

const LEVEL_LABEL = { branch: 'General', conference: 'Por conferencia', group: 'Por grupo' };

// De dónde salió el campeón. Importa decirlo: no es lo mismo "ganó la final"
// que "lo puso la liga a mano", y quien lee la tabla tiene derecho a saberlo.
const SOURCE_LABEL = {
  standings: 'primer lugar de la tabla',
  match: 'ganó el partido decisivo',
  override: 'definido por la liga',
};

export default function StandingsView({ data, emptyText }) {
  const levels = [...new Set((data?.tables || []).map((t) => t.level))];
  const [level, setLevel] = useState(null);

  if (!data || !data.tables?.length) {
    return (
      <div className="empty-state">
        <h3>Sin tabla de posiciones</h3>
        <p>{emptyText || 'Esta rama todavía no tiene equipos inscritos o no tiene configurada su tabla.'}</p>
      </div>
    );
  }

  const activeLevel = level && levels.includes(level) ? level : levels[0];
  const tables = data.tables.filter((t) => t.level === activeLevel);
  const usesPoints = Boolean(data.branch?.uses_points);

  // Campeones ya decididos. Un título todavía sin campeón no se muestra como
  // un hueco vacío — simplemente no aparece hasta que exista.
  const decided = (data.titles || [])
    .map((t) => ({ ...t, winners: (t.winners || []).filter((w) => w.team_id) }))
    .filter((t) => t.winners.length);

  return (
    <div className="standings-view">
      {decided.length > 0 && (
        <div className="standings-champions">
          {decided.map((title) => (
            <div key={title.id} className="standings-champion-group">
              <div className="standings-champion-title">{title.name}</div>
              <div className="standings-champion-list">
                {title.winners.map((w) => (
                  <div key={`${title.id}-${w.scope_id ?? 'all'}`} className="standings-champion">
                    {w.logo_url && <img src={w.logo_url} alt="" className="standings-champion-logo" />}
                    <div>
                      <div className="standings-champion-team">{w.team_name}</div>
                      <div className="standings-champion-meta">
                        {w.scope_name ? `${w.scope_name} · ` : ''}
                        {SOURCE_LABEL[w.source] || ''}
                        {w.note ? ` · ${w.note}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {levels.length > 1 && (
        <div className="tab-bar tab-bar--panel">
          {levels.map((l) => (
            <button
              key={l}
              className={`tab-btn ${l === activeLevel ? 'active' : ''}`}
              onClick={() => setLevel(l)}
            >
              {LEVEL_LABEL[l] || l}
            </button>
          ))}
        </div>
      )}

      {tables.map((t) => (
        <StandingsTable
          key={`${t.level}-${t.scope_id ?? 'all'}`}
          table={t}
          usesPoints={usesPoints}
          qualifyingCount={t.qualifying_count || 0}
        />
      ))}

      <p className="standings-legend">
        JJ jugados · G ganados · P perdidos{usesPoints ? ' · PTS puntos de tabla' : ' · % de ganados (el empate vale medio juego)'} ·
        PF puntos a favor · PC en contra · DIF diferencia.
        {' '}Solo cuentan los partidos de fases de temporada regular con marcador final.
        {tables.some((t) => t.qualifying_count > 0) && ' La barra amarilla marca a los que clasifican.'}
      </p>
    </div>
  );
}
