import { useLayoutEffect, useState } from 'react';
import { formatNumber, niceScale, toNumber, topRows } from '../../utils/adminPanel.js';

// Las gráficas del Panel Admin: SVG a mano, sin librería, como MonthlyFlowChart.
//
// Se dibujan en píxeles reales, midiendo su contenedor, y no con un viewBox que se
// estira: la anterior escalaba el texto junto con el dibujo, y en un teléfono las
// etiquetas de 10 px bajaban a menos de 5.

const HEIGHT = 224;
const MARGIN = { top: 24, right: 14, bottom: 26, left: 38 };

// Se mide con un ref de función: una gráfica puede nacer sin datos, sin caja que
// medir, y recibirlos después.
function useWidth() {
  const [element, setElement] = useState(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return undefined;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width];
}

// Con el teclado se recorre igual que con el mouse, y cuenta como una sola parada
// de tabulador: treinta columnas no pueden ser treinta paradas antes de la siguiente
// sección.
function useChartCursor(count) {
  const [index, setIndex] = useState(null);

  function onKeyDown(e) {
    const last = count - 1;
    const moves = {
      ArrowRight: () => Math.min(last, (index ?? -1) + 1),
      ArrowLeft: () => Math.max(0, (index ?? count) - 1),
      Home: () => 0,
      End: () => last,
    };
    if (moves[e.key]) {
      e.preventDefault();
      setIndex(moves[e.key]());
    }
    if (e.key === 'Escape') setIndex(null);
  }

  return { index, setIndex, focusProps: { tabIndex: 0, onKeyDown, onBlur: () => setIndex(null) } };
}

// Se queda dentro de su gráfica: pegada a una orilla, se recorrería hacia adentro
// en vez de cortarse.
function ChartTooltip({ x, y, width, children }) {
  const half = 74;
  return (
    <div
      className="adm-tooltip"
      role="status"
      style={{
        left: Math.min(Math.max(x, half), Math.max(width - half, half)),
        top: Math.max(y, 54),
      }}
    >
      {children}
    </div>
  );
}

function YAxis({ scale, y, width }) {
  return scale.values.map((value) => (
    <g key={value}>
      <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(value)} y2={y(value)} className="adm-chart-grid" />
      <text x={MARGIN.left - 8} y={y(value)} dy="3.5" textAnchor="end" className="adm-chart-axis">
        {formatNumber(value)}
      </text>
    </g>
  ));
}

const monthLabel = (month) => new Date(`${month}T00:00:00`)
  .toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });

const dayLabel = (day) => new Date(`${day}T12:00:00`)
  .toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });

/* ---------- Crecimiento de usuarios ---------- */

// Línea del total acumulado de usuarios, mes a mes. A propósito muestra el ACUMULADO
// (no altas por mes): es la curva que cuenta la historia de tracción que le importa
// a un patrocinador, en vez de un conteo con picos y valles que no dice nada por sí
// solo.
export function UserGrowthChart({ data }) {
  const [box, width] = useWidth();
  const cursor = useChartCursor(data.length);

  if (data.length === 0) return <p className="adm-chart-empty">Todavía no hay usuarios registrados.</p>;

  const count = data.length;
  const last = data[count - 1];
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const baseline = MARGIN.top + plotHeight;

  const scale = niceScale(Math.max(...data.map((d) => d.totalUsers)));
  const x = (i) => (count === 1 ? MARGIN.left + plotWidth / 2 : MARGIN.left + (i / (count - 1)) * plotWidth);
  const y = (value) => baseline - (value / scale.top) * plotHeight;

  const line = data.map((d, i) => `${x(i)},${y(d.totalUsers)}`).join(' ');
  const area = `${x(0)},${baseline} ${line} ${x(count - 1)},${baseline}`;

  // No más etiquetas de las que caben: el último mes siempre, que es el de hoy.
  const labelStep = Math.max(1, Math.ceil(count / (width < 420 ? 4 : 7)));
  const hovered = cursor.index != null ? data[cursor.index] : null;

  function trackPointer(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const position = (e.clientX - rect.left - MARGIN.left) / (plotWidth || 1);
    cursor.setIndex(Math.min(count - 1, Math.max(0, Math.round(position * (count - 1)))));
  }

  return (
    <div
      ref={box}
      className="adm-chart"
      role="group"
      aria-label={`Crecimiento de usuarios: de ${data[0].totalUsers} a ${last.totalUsers} entre ${monthLabel(data[0].month)} y ${monthLabel(last.month)}. Usa las flechas para recorrer los meses.`}
      {...cursor.focusProps}
    >
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          aria-hidden="true"
          onPointerMove={trackPointer}
          onPointerLeave={() => cursor.setIndex(null)}
        >
          <YAxis scale={scale} y={y} width={width} />
          <polygon points={area} className="adm-chart-area" />
          <polyline points={line} className="adm-chart-line" />

          {data.map((d, i) => {
            if (i !== count - 1 && (i % labelStep !== 0 || count - 1 - i < labelStep)) return null;
            const anchor = i === 0 ? 'start' : i === count - 1 ? 'end' : 'middle';
            return (
              <text key={d.month} x={x(i)} y={HEIGHT - 6} textAnchor={anchor} className="adm-chart-axis">
                {monthLabel(d.month)}
              </text>
            );
          })}

          {hovered && (
            <line
              x1={x(cursor.index)}
              x2={x(cursor.index)}
              y1={MARGIN.top}
              y2={baseline}
              className="adm-chart-crosshair"
            />
          )}

          {/* El último punto va marcado siempre: es el número que importa a quien solo
              mira una vez, sin pasar el mouse. */}
          <circle cx={x(count - 1)} cy={y(last.totalUsers)} r="4.5" className="adm-chart-dot" />
          <text x={x(count - 1)} y={y(last.totalUsers) - 12} textAnchor="end" className="adm-chart-end">
            {formatNumber(last.totalUsers)}
          </text>
          {hovered && cursor.index !== count - 1 && (
            <circle cx={x(cursor.index)} cy={y(hovered.totalUsers)} r="4.5" className="adm-chart-dot" />
          )}
        </svg>
      )}

      {hovered && (
        <ChartTooltip x={x(cursor.index)} y={y(hovered.totalUsers)} width={width}>
          <strong>{formatNumber(hovered.totalUsers)} usuarios</strong>
          <span>{monthLabel(hovered.month)}, +{formatNumber(hovered.newUsers)} nuevos</span>
        </ChartTooltip>
      )}

      <table className="adm-sr-only">
        <caption>Usuarios acumulados por mes</caption>
        <thead><tr><th>Mes</th><th>Total</th><th>Nuevos</th></tr></thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.month}><td>{monthLabel(d.month)}</td><td>{d.totalUsers}</td><td>{d.newUsers}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Visitas por día ---------- */

// Los 30 días van todos, con hueco en los que no hubo visitas (ver `fillDays`): un mes
// con cinco días sueltos tiene que verse como un mes con cinco días sueltos.
export function DailyVisitsChart({ days }) {
  const [box, width] = useWidth();
  const cursor = useChartCursor(days.length);

  const total = days.reduce((sum, d) => sum + d.count, 0);
  if (total === 0) return <p className="adm-chart-empty">Sin visitas registradas en estos 30 días.</p>;

  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const baseline = MARGIN.top + plotHeight;
  const peak = Math.max(...days.map((d) => d.count));
  const peakIndex = days.findIndex((d) => d.count === peak);

  const scale = niceScale(peak);
  const slot = plotWidth / days.length;
  const barWidth = Math.max(2, Math.min(14, slot - 2));
  const center = (i) => MARGIN.left + slot * i + slot / 2;
  const y = (value) => baseline - (value / scale.top) * plotHeight;

  // Redondeada del lado del dato y cuadrada en la base, para que todas salgan de la
  // misma línea.
  function column(i, value) {
    const left = center(i) - barWidth / 2;
    const top = y(value);
    const radius = Math.min(3, barWidth / 2, baseline - top);
    return `M${left} ${baseline} V${top + radius} Q${left} ${top} ${left + radius} ${top} `
      + `H${left + barWidth - radius} Q${left + barWidth} ${top} ${left + barWidth} ${top + radius} V${baseline} Z`;
  }

  const hovered = cursor.index != null ? days[cursor.index] : null;
  const labelEvery = width < 420 ? 10 : 7;

  function trackPointer(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const index = Math.floor((e.clientX - rect.left - MARGIN.left) / (slot || 1));
    cursor.setIndex(Math.min(days.length - 1, Math.max(0, index)));
  }

  return (
    <div
      ref={box}
      className="adm-chart"
      role="group"
      aria-label={`Visitas a Home por día: ${total} en 30 días, con un máximo de ${peak} el ${dayLabel(days[peakIndex].day)}. Usa las flechas para recorrer los días.`}
      {...cursor.focusProps}
    >
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          aria-hidden="true"
          onPointerMove={trackPointer}
          onPointerLeave={() => cursor.setIndex(null)}
        >
          <YAxis scale={scale} y={y} width={width} />

          {days.map((d, i) => d.count > 0 && (
            <path
              key={d.day}
              d={column(i, d.count)}
              className={`adm-chart-bar${cursor.index === i ? ' is-hovered' : ''}`}
            />
          ))}

          {/* Sin dato no hay columna, pero sí tiene que notarse que el día existe. */}
          {hovered && hovered.count === 0 && (
            <line
              x1={center(cursor.index)}
              x2={center(cursor.index)}
              y1={MARGIN.top}
              y2={baseline}
              className="adm-chart-crosshair"
            />
          )}

          {/* Una sola cifra sobre las columnas: la del día más alto. */}
          <text x={center(peakIndex)} y={y(peak) - 7} textAnchor="middle" className="adm-chart-end">
            {formatNumber(peak)}
          </text>

          {days.map((d, i) => {
            const fromEnd = days.length - 1 - i;
            if (fromEnd % labelEvery !== 0) return null;
            return (
              <text
                key={d.day}
                x={i === days.length - 1 ? width - MARGIN.right : center(i)}
                y={HEIGHT - 6}
                textAnchor={i === days.length - 1 ? 'end' : 'middle'}
                className="adm-chart-axis"
              >
                {dayLabel(d.day)}
              </text>
            );
          })}
        </svg>
      )}

      {hovered && (
        <ChartTooltip x={center(cursor.index)} y={y(hovered.count)} width={width}>
          <strong>{hovered.count === 1 ? '1 visita' : `${formatNumber(hovered.count)} visitas`}</strong>
          <span>{dayLabel(hovered.day)}</span>
        </ChartTooltip>
      )}

      <table className="adm-sr-only">
        <caption>Visitas a Home por día</caption>
        <thead><tr><th>Día</th><th>Visitas</th></tr></thead>
        <tbody>
          {days.map((d) => <tr key={d.day}><td>{dayLabel(d.day)}</td><td>{d.count}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Ligas por estado ---------- */

const STATES_SHOWN = 8;

// Ranking de ligas por estado: el alcance geográfico que le importa a un
// patrocinador, en qué regiones ya hay presencia real.
export function LeaguesByStateChart({ data }) {
  const [expanded, setExpanded] = useState(false);

  if (data.length === 0) return <p className="adm-chart-empty">Todavía no hay ligas registradas.</p>;

  const max = Math.max(...data.map((d) => toNumber(d.count)), 1);
  const hidden = data.length - STATES_SHOWN;

  return (
    <>
      <ol className="adm-rank">
        {topRows(data, STATES_SHOWN, expanded).map((d) => (
          <li key={d.state}>
            <span className="adm-rank-name" title={d.state}>{d.state}</span>
            <span className="adm-rank-track">
              <span className="adm-rank-bar" style={{ '--share': toNumber(d.count) / max }} />
              <span className="adm-rank-value">{formatNumber(d.count)}</span>
            </span>
          </li>
        ))}
      </ol>
      {hidden > 0 && (
        <button type="button" className="adm-text-button" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Ver menos' : `Ver los ${data.length} estados`}
        </button>
      )}
    </>
  );
}

/* ---------- Medidor ---------- */

// Una proporción contra su límite: qué parte de los usuarios predice.
export function Meter({ value, max, label }) {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      className="adm-meter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}
