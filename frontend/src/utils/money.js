// Formato de dinero y fechas para las pantallas de cobranza.
//
// Estas mismas cuatro líneas estaban copiadas en BillingLeaguePanel.jsx,
// TeamStatementPanel.jsx y (del lado del backend) en routes/billing.js y
// utils/billingReminders.js. Aquí quedan una sola vez para el frontend; el
// backend mantiene su propia copia porque no comparten bundle.

// Valor absoluto: el signo lo pone quien llama (con "−"/"+" o con una clase
// de color), no el formateador — así "Debe $800" no se lee "Debe -$800".
export function money(value) {
  const n = Number(value || 0);
  return `$${Math.abs(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Sin centavos, para las cifras grandes de los KPIs, donde ".00" solo agrega
// ruido visual.
export function moneyShort(value) {
  const n = Number(value || 0);
  return `$${Math.abs(n).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
}

export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

// "hace 3 días" para la columna de último recordatorio. El tesorero no
// necesita la fecha exacta, necesita saber si ya le insistió esta semana.
export function timeAgo(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'hace 1 mes' : `hace ${months} meses`;
}

// Clase de color para un saldo. Negativo = debe (amarillo de bandera),
// positivo = saldo a favor (verde), cero = al corriente (gris callado).
// Mismo criterio semántico que ya usaba BillingLeaguePanel.
export function balanceClass(value) {
  const n = Number(value || 0);
  if (n < 0) return 'is-owed';
  if (n > 0) return 'is-positive';
  return 'is-zero';
}

export function balanceText(value) {
  const n = Number(value || 0);
  if (n < 0) return `Debe ${money(n)}`;
  if (n > 0) return `A favor ${money(n)}`;
  return 'Al corriente';
}

// Etiqueta de periodo por defecto para la mensualidad: "SEP-2026".
const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
export function periodLabelFor(date = new Date()) {
  return `${MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

export function monthLabel(yyyymm) {
  const [y, m] = String(yyyymm || '').split('-');
  const idx = Number(m) - 1;
  if (!MONTHS[idx]) return yyyymm;
  return `${MONTHS[idx]} ${String(y).slice(2)}`;
}
