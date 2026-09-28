import { getLocalPartsInZone } from './timezones.js';

// El ORDEN del ranking de predicciones, en un solo lugar. Los PUNTOS viven en
// utils/scoring.js (SQL); aquí vive lo que se hace con ellos: ordenar, poner
// el lugar y repetir el ranking jornada por jornada para los avisos de "Mis
// notificaciones" (README, "Los avisos de tus predicciones").
//
// Antes el orden estaba copiado en routes/predictions.js y routes/pools.js, y
// cada lista pintaba su lugar con `i + 1`. Ahora los dos rankings y los avisos
// usan estas funciones, porque un aviso que dice "vas 4.º" tiene que dar
// exactamente el número que se ve en la pestaña Ranking.
//
// Todo aquí es PURO: recibe filas ya calificadas por la base y no habla con
// Postgres.

// Puntos → aciertos → calificadas → total. El ganador se define por PUNTOS;
// los desempates finos (rachas, sorpresas) los resuelve quien organice un
// concurso leyendo la tabla — aquí solo se rompe el empate con datos que ya
// hay, para dar un orden estable.
export function compararRanking(a, b) {
  return (
    b.points - a.points ||
    b.correct - a.correct ||
    b.graded - a.graded ||
    b.total - a.total
  );
}

// Ordena y pone `position`: 1 más los que van ESTRICTAMENTE arriba. Un empate
// exacto en los cuatro criterios comparte lugar. Con `i + 1`, dos personas
// empatadas salían 3.º y 4.º en un orden que la base no garantiza, y un aviso
// podía decir 3.º mientras la lista decía 4.º.
export function conPosiciones(filas) {
  const ordenadas = [...filas].sort(compararRanking);
  let posicion = 0;
  return ordenadas.map((fila, i) => {
    if (i === 0 || compararRanking(ordenadas[i - 1], fila) !== 0) posicion = i + 1;
    return { ...fila, position: posicion };
  });
}

// El % de aciertos, solo sobre lo ya calificado. No interviene en el orden.
export const porcentaje = (correct, graded) => (graded > 0 ? Math.round((correct / graded) * 100) : null);

// ── La jornada ────────────────────────────────────────────────────────────
//
// Es `week_label`, tal cual: el calendario agrupa y filtra por el valor exacto
// (CalendarViewer, "Ver por jornada"), y el link del aviso lo usa de filtro.
// Si un partido no tiene, su fecha en la zona del partido: los que se juegan
// el mismo día van juntos.
const ZONA_POR_DEFECTO = 'America/Mexico_City';

export function jornadaDe(partido) {
  const etiqueta = partido.week_label == null ? '' : String(partido.week_label);
  if (etiqueta.trim()) return { key: `J:${etiqueta}`, week_label: etiqueta, fecha: null };
  const { year, month, day } = getLocalPartsInZone(partido.match_date, partido.timezone || ZONA_POR_DEFECTO);
  const fecha = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { key: `D:${fecha}`, week_label: null, fecha };
}

const ms = (v) => (v == null ? null : new Date(v).getTime());

// Los partidos que cuentan: los amistosos no reparten puntos ni aparecen en
// el ranking (utils/scoring.js, MATCH_IS_EXHIBITION_SQL).
const oficiales = (partidos) => partidos.filter((p) => !p.exhibition);

/**
 * La tabla de un alcance tal como estaba en `momento`: las predicciones hechas
 * hasta entonces y los puntos de lo que ya calificaba.
 *
 * @param {object} p
 * @param {Array}  p.partidos     { id, gradable_at, exhibition }
 * @param {Array}  p.predicciones { user_id, match_id, created_at, correct, points }
 * @param {Date}   p.momento
 * @param {Array}  [p.miembros]   ids de una quiniela: solo ellos, y todos aunque no hayan votado
 * @returns {Array<{ userId, total, graded, correct, points, position }>}
 */
export function tablaAl({ partidos, predicciones, momento, miembros = null }) {
  const corte = momento.getTime();
  const porId = new Map(oficiales(partidos).map((p) => [p.id, p]));
  const porUsuario = new Map();
  const fila = (userId) => {
    if (!porUsuario.has(userId)) porUsuario.set(userId, { userId, total: 0, graded: 0, correct: 0, points: 0 });
    return porUsuario.get(userId);
  };
  const soloMiembros = miembros ? new Set(miembros) : null;
  if (soloMiembros) for (const id of soloMiembros) fila(id);

  for (const pr of predicciones) {
    const partido = porId.get(pr.match_id);
    if (!partido) continue;
    if (soloMiembros && !soloMiembros.has(pr.user_id)) continue;
    if (ms(pr.created_at) > corte) continue;
    const f = fila(pr.user_id);
    f.total += 1;
    const calificado = partido.gradable_at != null && ms(partido.gradable_at) <= corte;
    if (!calificado) continue;
    f.graded += 1;
    if (pr.correct) {
      f.correct += 1;
      f.points += Number(pr.points) || 0;
    }
  }
  return conPosiciones([...porUsuario.values()]);
}

/**
 * Los cortes de un alcance: una jornada CIERRA cuando todos sus partidos ya
 * jugados son calificables. Uno pospuesto a una fecha futura no la detiene;
 * uno jugado y sin marcador sí, igual que detiene la tabla de posiciones. La
 * hora del corte es el `gradable_at` más tardío de la jornada.
 *
 * @returns {Array<{ jornada, at: Date, partidos: number[] }>} en orden de hora
 */
export function cortesDeJornada({ partidos, ahora }) {
  const ahoraMs = ahora.getTime();
  const grupos = new Map();
  for (const p of oficiales(partidos)) {
    const jornada = jornadaDe(p);
    if (!grupos.has(jornada.key)) grupos.set(jornada.key, { jornada, partidos: [] });
    grupos.get(jornada.key).partidos.push(p);
  }

  const cortes = [];
  for (const { jornada, partidos: dela } of grupos.values()) {
    const jugados = dela.filter((p) => ms(p.match_date) <= ahoraMs);
    if (jugados.some((p) => p.gradable_at == null)) continue;
    const calificados = dela.filter((p) => p.gradable_at != null);
    if (calificados.length === 0) continue;
    const at = Math.max(...calificados.map((p) => ms(p.gradable_at)));
    cortes.push({ jornada, at: new Date(at), partidos: calificados.map((p) => p.id) });
  }
  return cortes.sort((a, b) => a.at - b.at);
}

/**
 * El ranking repetido en cada corte. Cada corte trae su tabla completa y
 * cuántos participaban: en el calendario, quienes tenían al menos una
 * predicción que cuenta; en una quiniela, sus miembros.
 */
export function repasoPorJornada({ partidos, predicciones, ahora, miembros = null }) {
  return cortesDeJornada({ partidos, ahora }).map((corte) => {
    const tabla = tablaAl({ partidos, predicciones, momento: corte.at, miembros });
    const participantes = miembros ? tabla.length : tabla.filter((f) => f.total > 0).length;
    return { ...corte, tabla: new Map(tabla.map((f) => [f.userId, f])), participantes };
  });
}

// ── Los hitos ─────────────────────────────────────────────────────────────
//
// Se avisa al SUBIR a uno de estos lugares (el mejor que se cruzó), y solo si
// hay más participantes que el umbral: un top 10 entre ocho personas no es
// nada. Aparte, que te quiten el primer lugar. Bajar del top 10 o del top 3 no
// se avisa (decisión del 2026-09-27).
const UMBRALES = [
  { lugar: 1,  hito: 'first' },
  { lugar: 3,  hito: 'top3' },
  { lugar: 10, hito: 'top10' },
];

export function hitoEntre(antes, ahora, participantes) {
  if (ahora == null) return null;
  for (const { lugar, hito } of UMBRALES) {
    if (ahora <= lugar && (antes == null || antes > lugar) && participantes > lugar) return hito;
  }
  if (antes === 1 && ahora > 1) return 'lost_first';
  return null;
}
