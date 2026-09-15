import { moneyShort, monthLabel } from '../utils/money.js';

// Cobranza por mes. SVG a mano, sin librería de gráficas — la app no tiene
// ninguna instalada y no vale la pena traer uno de 50 KB para seis barras
// (mismo criterio que UserGrowthChart en AdminPanel.jsx).
//
// Decisiones de lectura:
//  - Serie única, un solo color: el acento del club. Sin leyenda — el título
//    de la sección ya dice qué es.
//  - Las barras SIEMPRE arrancan en cero. Cortar la base exagera diferencias
//    y en una gráfica de dinero eso es mentir.
//  - El monto va escrito encima de cada barra, en tinta de texto y no en el
//    color de la serie: así la cifra se lee aunque el club haya elegido un
//    color de marca con poco contraste, y el dato nunca depende del color.
//  - Los meses sin cobranza se dibujan en cero en vez de omitirse, para que
//    el eje de tiempo sea continuo y no se vea un mes malo como si no
//    existiera.

const VIEW_W = 720;
const VIEW_H = 200;
const PAD_X = 8;
const PAD_TOP = 28;   // espacio para el monto encima de la barra
const PAD_BOTTOM = 26; // espacio para la etiqueta del mes
const MAX_BAR_W = 56;
const MONTHS_SHOWN = 6;

// Rellena los meses faltantes con cero, hacia atrás desde el mes actual.
function fillMonths(data) {
  const byMonth = new Map((data || []).map((d) => [d.month, Number(d.total || 0)]));
  const out = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let i = MONTHS_SHOWN - 1; i >= 0; i--) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ month: key, total: byMonth.get(key) || 0 });
  }
  return out;
}

export default function MonthlyFlowChart({ data }) {
  const months = fillMonths(data);
  const max = Math.max(...months.map((m) => m.total), 0);

  if (max <= 0) {
    return (
      <div className="ws-chart">
        <p style={{ color: 'var(--ws-ink-faint)', fontSize: 13, margin: 0, textAlign: 'center' }}>
          Todavía no hay pagos confirmados en los últimos seis meses.
        </p>
      </div>
    );
  }

  const plotH = VIEW_H - PAD_TOP - PAD_BOTTOM;
  const baseline = VIEW_H - PAD_BOTTOM;
  const slotW = (VIEW_W - PAD_X * 2) / months.length;
  const barW = Math.min(MAX_BAR_W, slotW - 12);

  return (
    <div className="ws-chart">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={`Cobranza por mes: ${months.map((m) => `${monthLabel(m.month)} ${moneyShort(m.total)}`).join(', ')}`}
      >
        {/* Línea base. No hay rejilla horizontal: con seis barras etiquetadas
            una por una, las líneas de referencia solo agregarían ruido. */}
        <line
          className="ws-chart-grid"
          x1={PAD_X} y1={baseline} x2={VIEW_W - PAD_X} y2={baseline}
        />

        {months.map((m, i) => {
          const h = max > 0 ? (m.total / max) * plotH : 0;
          const x = PAD_X + i * slotW + (slotW - barW) / 2;
          const y = baseline - h;
          return (
            <g key={m.month}>
              {/* rx redondea las cuatro esquinas, pero la barra está anclada a
                  la línea base, así que abajo el redondeo queda tapado. */}
              {h > 0 && (
                <rect
                  className="ws-chart-bar"
                  x={x} y={y} width={barW} height={h} rx="4"
                  tabIndex={0}
                  aria-label={`${monthLabel(m.month)}: ${moneyShort(m.total)}`}
                >
                  <title>{`${monthLabel(m.month)} — ${moneyShort(m.total)}`}</title>
                </rect>
              )}
              <text
                className="ws-chart-axis"
                x={x + barW / 2} y={y - 8}
                textAnchor="middle"
                style={{ fill: 'var(--ws-ink)', fontWeight: 600 }}
              >
                {m.total > 0 ? moneyShort(m.total) : ''}
              </text>
              <text
                className="ws-chart-axis"
                x={x + barW / 2} y={baseline + 16}
                textAnchor="middle"
              >
                {monthLabel(m.month)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
