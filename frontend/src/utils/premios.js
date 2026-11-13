import { catalogPrice } from './money.js';
import { formatNumber, pluralize, toNumber } from './adminPanel.js';
import { inShowcase, isActive } from './storePanel.js';

// Lo que las pantallas dicen de un premio por acertar (README, "Premios por
// acertar"): la página del partido, tu aviso del resultado, "Mis premios" y la
// sección Premios del panel de una tienda. Puro, para probarlo sin navegador:
// cuatro pantallas que lo dijeran cada una a su manera terminarían diciendo
// cosas distintas del mismo premio.

// Los mismos rangos que el backend (utils/premios.js) y los CHECK del esquema
// (regla 6: un valor que viaja se cambia en los tres lados o en ninguno).
export const DESCUENTO_MINIMO = 5;
export const DESCUENTO_MAXIMO = 100;
export const VIGENCIAS = [7, 15, 30, 60];
export const VIGENCIA_INICIAL = 30;

const ZONA = 'America/Mexico_City';

/* ---------- El premio ---------- */

// La cifra grande: "20%", o "Gratis" con el 100.
export function cifraDelPremio(premio) {
  const descuento = toNumber(premio?.discount_percent);
  return descuento >= DESCUENTO_MAXIMO ? 'Gratis' : `${descuento}%`;
}

// "20% en Jersey oficial", o "Jersey oficial gratis" con el 100.
export function textoDelPremio(premio) {
  const nombre = String(premio?.product?.name ?? '').trim() || 'un producto';
  const descuento = toNumber(premio?.discount_percent);
  if (descuento >= DESCUENTO_MAXIMO) return `${nombre} gratis`;
  return `${descuento}% en ${nombre}`;
}

// El precio de antes y el de después, como los escribe la vitrina ("$899" →
// "$719.20"), o null si el producto no tiene precio o si es gratis: ahí el
// texto del premio ya lo dice todo.
export function preciosDelPremio(premio) {
  const antes = catalogPrice(premio?.product?.price);
  const descuento = toNumber(premio?.discount_percent);
  if (!antes || descuento >= DESCUENTO_MAXIMO) return null;
  const centavos = Math.round(Number(premio.product.price) * (100 - descuento));
  return { antes, despues: catalogPrice(centavos / 100), moneda: premio.product.currency || 'MXN' };
}

// "15 dic", y con el año si no es este: un premio que vence en enero se lee en
// diciembre.
export function fechaDelPremio(iso, ahora = new Date()) {
  if (!iso) return null;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  const anio = (d) => d.toLocaleDateString('es-MX', { year: 'numeric', timeZone: ZONA });
  const conAnio = anio(fecha) !== anio(new Date(ahora));
  return fecha.toLocaleDateString('es-MX', {
    day: 'numeric', month: 'short', ...(conAnio ? { year: 'numeric' } : {}), timeZone: ZONA,
  });
}

function horaDelPremio(iso) {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA });
}

// "Vale 30 días después del partido".
export function textoDeVigencia(dias) {
  return `Vale ${pluralize(dias, 'día')} después del partido`;
}

// Cómo está el premio de quien lo ganó: lo que dice la tarjeta del aviso y "Mis
// premios". `tone` es el de `Status` (on, off, bad).
export function estadoDelGanador(premio, ahora = new Date()) {
  if (premio?.status === 'redeemed') {
    const cuando = fechaDelPremio(premio.redeemed_at, ahora);
    return { tone: 'off', label: 'Usado', detail: cuando ? `Lo usaste el ${cuando}` : 'Ya lo usaste' };
  }
  if (premio?.status === 'expired') {
    const cuando = fechaDelPremio(premio.expires_at, ahora);
    return { tone: 'off', label: 'Vencido', detail: cuando ? `Venció el ${cuando}` : 'Ya venció' };
  }
  const cuando = fechaDelPremio(premio?.expires_at, ahora);
  return { tone: 'on', label: 'Para usar', detail: cuando ? `Vence el ${cuando}` : 'Vale en la tienda' };
}

const tiempo = (iso) => (iso ? new Date(iso).getTime() : null);

// "Mis premios" en tres tramos: lo que todavía vale (lo que vence primero,
// arriba), lo que ya usaste y lo que venció (lo más reciente arriba). Un tramo
// vacío no sale.
export function tramosDeMisPremios(premios) {
  const lista = premios || [];
  const porVencer = (a, b) => (tiempo(a.expires_at) ?? Infinity) - (tiempo(b.expires_at) ?? Infinity);
  const masReciente = (campo) => (a, b) => (tiempo(b[campo]) ?? -Infinity) - (tiempo(a[campo]) ?? -Infinity);
  return [
    { key: 'valid', label: 'Para usar', rows: lista.filter((p) => p.status === 'valid').sort(porVencer) },
    { key: 'redeemed', label: 'Usados', rows: lista.filter((p) => p.status === 'redeemed').sort(masReciente('redeemed_at')) },
    { key: 'expired', label: 'Vencidos', rows: lista.filter((p) => p.status === 'expired').sort(masReciente('expires_at')) },
  ].filter((tramo) => tramo.rows.length > 0);
}

// La celda de Mi panel: cuántos ganaste, y cuántos todavía puedes usar. Null si
// no tienes ninguno, para que no haya una celda en cero que no le dice nada a
// quien nunca ha ganado.
export function figuraDePremios(premios) {
  const lista = premios || [];
  if (lista.length === 0) return null;
  const paraUsar = lista.filter((p) => p.status === 'valid').length;
  return {
    value: formatNumber(lista.length),
    sub: paraUsar > 0 ? `${formatNumber(paraUsar)} para usar →` : 'Ver mis premios →',
  };
}

/* ---------- El panel de la tienda ---------- */

// En qué va cada premio, como lo dice la tabla. `state` lo calcula el backend:
// abierto mientras se puede votar, en juego mientras se espera el resultado, y
// entregado cuando el partido ya calificó.
export const ESTADOS_DEL_PREMIO = {
  open: { tone: 'on', label: 'Abierto', detail: 'Se puede votar' },
  locked: { tone: 'ask', label: 'En juego', detail: 'Esperando el resultado' },
  awarded: { tone: 'off', label: 'Entregado', detail: 'El partido terminó' },
};

export const estadoDelPremio = (premio) => ESTADOS_DEL_PREMIO[premio?.state] ?? ESTADOS_DEL_PREMIO.open;

// Las celdas del marcador de Premios, que además filtran la tabla.
export const PRIZE_FILTERS = [
  { key: 'todos', label: 'Premios', test: () => true },
  { key: 'abiertos', label: 'Abiertos', test: (p) => p.state === 'open' },
  { key: 'en-juego', label: 'En juego', test: (p) => p.state === 'locked' },
  { key: 'entregados', label: 'Entregados', test: (p) => p.state === 'awarded' },
];

const horaDelPartido = (p) => (p.match_date ? new Date(p.match_date).getTime() : null);

// La tabla en tramos, como las transmisiones de un medio: lo abierto y lo que
// está en juego, lo más cercano primero y lo que no tiene fecha al final; lo
// entregado, de lo más reciente a lo más viejo. Un tramo vacío no sale.
export function tramosDelPanel(premios) {
  const lista = premios || [];
  const cercanoPrimero = (a, b) => (horaDelPartido(a) ?? Infinity) - (horaDelPartido(b) ?? Infinity) || a.prize_id - b.prize_id;
  const recientePrimero = (a, b) => (horaDelPartido(b) ?? -Infinity) - (horaDelPartido(a) ?? -Infinity) || b.prize_id - a.prize_id;
  return [
    { key: 'open', label: 'Abiertos', rows: lista.filter((p) => p.state === 'open').sort(cercanoPrimero) },
    { key: 'locked', label: 'En juego', rows: lista.filter((p) => p.state === 'locked').sort(cercanoPrimero) },
    { key: 'awarded', label: 'Entregados', rows: lista.filter((p) => p.state === 'awarded').sort(recientePrimero) },
  ].filter((tramo) => tramo.rows.length > 0);
}

// Cuántos ganaron y cuántos ya cobraron, de lo ya entregado.
export function totalesDePremios(premios) {
  const entregados = (premios || []).filter((p) => p.state === 'awarded');
  return {
    ganadores: entregados.reduce((suma, p) => suma + toNumber(p.winners), 0),
    canjeados: entregados.reduce((suma, p) => suma + toNumber(p.redeemed), 0),
  };
}

// "12 de 18": de los que ganaron, cuántos ya lo cobraron.
export function textoDeCanjes(premio) {
  if (premio?.state !== 'awarded') return null;
  const ganadores = toNumber(premio.winners);
  if (ganadores === 0) return 'Nadie acertó';
  return `${formatNumber(premio.redeemed)} de ${formatNumber(ganadores)}`;
}

// Con qué productos se puede premiar: los que están a la venta y en la vitrina,
// que es lo que pide el backend al ponerlo. Por nombre.
export function productosParaPremiar(productos) {
  return (productos || [])
    .filter((p) => isActive(p) && inShowcase(p))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { sensitivity: 'base' }));
}

// Por qué la tienda todavía no puede poner premios, o null si sí puede. Sin
// botón: publicarla y verificarla lo decide CFBAMX.
export function candadoDePremios(org) {
  if (!org) return null;
  if (org.is_public === true && org.is_verified === true) return null;
  if (org.is_verified !== true && org.is_public !== true) return 'Tu tienda todavía no está publicada ni verificada';
  if (org.is_verified !== true) return 'Tu tienda todavía no está verificada';
  return 'Tu tienda todavía no está publicada';
}

/* ---------- El formulario de un premio ---------- */

export const PREMIO_VACIO = { match_id: '', product_id: '', discount_percent: '20', valid_days: String(VIGENCIA_INICIAL) };

// Lo que está mal antes de mandar, en las palabras de la pantalla, o null.
export function validarFormularioDePremio(form) {
  if (!form?.match_id) return 'Elige el partido.';
  if (!form?.product_id) return 'Elige el producto de tu vitrina.';
  const descuento = Number(String(form.discount_percent ?? '').trim());
  if (!Number.isInteger(descuento) || descuento < DESCUENTO_MINIMO || descuento > DESCUENTO_MAXIMO) {
    return `El descuento va de ${DESCUENTO_MINIMO}% a ${DESCUENTO_MAXIMO}%, sin decimales.`;
  }
  if (!VIGENCIAS.includes(Number(form.valid_days))) return 'Elige cuántos días vale.';
  return null;
}

export function payloadDePremio(form) {
  return {
    match_id: Number(form.match_id),
    product_id: Number(form.product_id),
    discount_percent: Number(String(form.discount_percent).trim()),
    valid_days: Number(form.valid_days),
  };
}

/* ---------- Revisar un código ---------- */

// Lo que se teclea, limpio para mandarlo: mayúsculas y sin espacios en las
// orillas. Lo demás (guiones, la O por el cero) lo tolera el backend.
export const limpiarCodigo = (texto) => String(texto ?? '').trim().toUpperCase();

// Lo que la tienda ve al revisar un código. `tone` es el de `Status`.
export function resultadoDelCodigo(respuesta, ahora = new Date()) {
  const premio = respuesta ? textoDelPremio(respuesta) : null;
  switch (respuesta?.result) {
    case 'valid': {
      const vence = fechaDelPremio(respuesta.expires_at, ahora);
      return {
        tone: 'on',
        title: 'Vale',
        detail: [premio, vence && `vence el ${vence}`].filter(Boolean).join(' · '),
        canRedeem: true,
      };
    }
    case 'redeemed': {
      const cuando = respuesta.redeemed_at
        ? `${fechaDelPremio(respuesta.redeemed_at, ahora)} a las ${horaDelPremio(respuesta.redeemed_at)}`
        : null;
      return { tone: 'bad', title: 'Ya se usó', detail: [premio, cuando && `se usó el ${cuando}`].filter(Boolean).join(' · ') };
    }
    case 'expired': {
      const cuando = fechaDelPremio(respuesta.expires_at, ahora);
      return { tone: 'bad', title: 'Venció', detail: [premio, cuando && `venció el ${cuando}`].filter(Boolean).join(' · ') };
    }
    default:
      return {
        tone: 'bad',
        title: 'No es de tus premios',
        detail: 'Revisa que esté bien escrito. Un código solo vale en la tienda que puso el premio, y hasta que el partido termina.',
      };
  }
}

// El partido de un premio en una línea: "HALCONES vs TIGRES".
export const partidoDelPremio = (match) => (match ? `${match.home_team} vs ${match.away_team}` : '');
