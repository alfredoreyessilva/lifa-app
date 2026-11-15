import db from '../config/db.js';

// Los ajustes de la plataforma que no son prender o apagar: hoy, la comisión de
// CFBAMX por cada venta en una vitrina (README, "Compras en la vitrina" → "Panel
// Admin → Compras"). Alfredo decidió el 2026-11-14 que nace en 0 y que se cambia
// desde su panel, sin programar.
//
// Es la forma de utils/interruptores.js con un número en vez de un sí o un no:
// cada cambio es una fila nueva —quién y cuándo— y el valor es la última. Sin
// ninguna fila, el de por defecto. Es el único lugar que lee y escribe
// `platform_settings`.

export const AJUSTES = {
  purchase_fee_percent: { etiqueta: 'Comisión de CFBAMX por venta', minimo: 0, maximo: 30, porDefecto: 0 },
};

export const esAjuste = (clave) => Object.prototype.hasOwnProperty.call(AJUSTES, clave);

// Un porcentaje con hasta dos decimales, dentro de su rango.
export function validarAjuste(clave, valor) {
  if (!esAjuste(clave)) return { error: 'No existe ese ajuste' };
  const { minimo, maximo } = AJUSTES[clave];
  const n = Number(valor);
  if (valor === null || valor === undefined || valor === '' || !Number.isFinite(n)) {
    return { error: 'Escribe un número' };
  }
  if (n < minimo || n > maximo) return { error: `Va de ${minimo} a ${maximo}` };
  return { valor: Math.round(n * 100) / 100 };
}

// Como los interruptores: diez segundos de memoria, y cambiar el valor la
// actualiza en este mismo proceso.
const VIGENCIA_MS = 10_000;
const memoria = new Map();

export async function valorDeAjuste(clave) {
  if (!esAjuste(clave)) return null;
  const guardado = memoria.get(clave);
  if (guardado && Date.now() - guardado.at < VIGENCIA_MS) return guardado.valor;
  const fila = await db.prepare(
    'SELECT value FROM platform_settings WHERE setting_key = ? ORDER BY id DESC LIMIT 1'
  ).get(clave);
  const valor = fila ? Number(fila.value) : AJUSTES[clave].porDefecto;
  memoria.set(clave, { valor, at: Date.now() });
  return valor;
}

// Solo agrega la fila si el valor cambia, en la misma sentencia que lo pregunta.
export async function cambiarAjuste(clave, valor, userId) {
  if (!esAjuste(clave)) throw new Error(`No existe el ajuste ${clave}`);
  const porDefecto = AJUSTES[clave].porDefecto;
  await db.prepare(`
    INSERT INTO platform_settings (setting_key, value, changed_by_user_id)
    SELECT ?::text, ?::numeric, ?::int
    WHERE COALESCE(
      (SELECT value FROM platform_settings WHERE setting_key = ?::text ORDER BY id DESC LIMIT 1),
      ?::numeric
    ) IS DISTINCT FROM ?::numeric
  `).run(clave, valor, userId, clave, porDefecto, valor);
  memoria.set(clave, { valor: Number(valor), at: Date.now() });
}

export async function historialDeAjuste(clave, limite = 10) {
  if (!esAjuste(clave)) return [];
  const filas = await db.prepare(`
    SELECT s.value, s.changed_at, u.name AS changed_by_name
    FROM platform_settings s
    LEFT JOIN users u ON u.id = s.changed_by_user_id
    WHERE s.setting_key = ?
    ORDER BY s.id DESC
    LIMIT ?
  `).all(clave, limite);
  return filas.map((f) => ({ ...f, value: Number(f.value) }));
}

// La comisión de las compras, en porcentaje.
export const comisionDeCompras = () => valorDeAjuste('purchase_fee_percent');
