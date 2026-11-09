// Cómo se lee el contexto de un partido en pantalla (GET
// /leagues/matches/:id/context). Funciones PURAS: aquí no se calcula ningún
// récord —eso ya viene resuelto del backend, con el motor de la tabla—, solo se
// decide cómo se escribe y qué renglones se enseñan.

import { recordLabel } from './standingsFormat.js';
import { jornadaLabel } from './matchDisplay.js';

export function ordinal(n) {
  return `${n}.º`;
}

const RACHAS = { G: ['ganado', 'ganados'], P: ['perdido', 'perdidos'], E: ['empatado', 'empatados'] };

// "G3" → "3 ganados"
export function rachaLabel(streak) {
  const m = /^([GPE])(\d+)$/.exec(streak || '');
  if (!m) return '—';
  const n = Number(m[2]);
  return `${n} ${RACHAS[m[1]][n === 1 ? 0 : 1]}`;
}

const porPartido = (puntos, jugados) => (jugados ? puntos / jugados : null);
const unDecimal = (n) => (n === null ? '—' : n.toFixed(1));
const pctDe = (r) => (r.played ? (r.wins + r.ties / 2) / r.played : null);

// Quién lleva ventaja en un renglón. Nadie, si empatan o a uno le falta el dato.
function ventaja(a, b, mejor) {
  if (a === null || b === null || a === b) return null;
  return mejor(a, b) === a ? 'home' : 'away';
}
const mayor = Math.max;
const menor = Math.min;

const NIVELES = {
  branch: { propio: 'Lugar en la tabla' },
  conference: { propio: 'Lugar en su conferencia' },
  group: { propio: 'Lugar en su grupo' },
};

// Un renglón por tabla en la que estén los dos. En la misma tabla se comparan
// ("Lugar en NACIONAL: 3.º contra 5.º"). En tablas distintas no hay ventaja que
// marcar: ser 2.º de un grupo no es mejor ni peor que ser 3.º de otro, así que
// cada uno lleva el nombre de la suya.
function filasDeLugar(home, away) {
  const filas = [];
  for (const nivel of Object.keys(NIVELES)) {
    const a = home.places?.find((p) => p.level === nivel);
    const b = away.places?.find((p) => p.level === nivel);
    if (!a || !b) continue;
    if (a.scope_name === b.scope_name) {
      filas.push({
        key: `lugar-${nivel}`,
        label: a.scope_name ? `Lugar en ${a.scope_name}` : NIVELES[nivel].propio,
        home: ordinal(a.rank),
        away: ordinal(b.rank),
        lead: ventaja(a.rank, b.rank, menor),
      });
    } else {
      filas.push({
        key: `lugar-${nivel}`,
        label: NIVELES[nivel].propio,
        home: `${ordinal(a.rank)} en ${a.scope_name}`,
        away: `${ordinal(b.rank)} en ${b.scope_name}`,
        lead: null,
      });
    }
  }
  return filas;
}

// Los renglones de "Cara a cara". Si ninguno de los dos ha jugado no hay nada
// que comparar y la sección no se pinta: una tabla de ceros no informa.
export function filasCaraACara(home, away) {
  if (!home || !away || (!home.played && !away.played)) return [];

  const anotadosA = porPartido(home.points_for, home.played);
  const anotadosB = porPartido(away.points_for, away.played);
  const permitidosA = porPartido(home.points_against, home.played);
  const permitidosB = porPartido(away.points_against, away.played);

  return [
    {
      key: 'record',
      label: 'Récord',
      home: recordLabel(home),
      away: recordLabel(away),
      lead: ventaja(pctDe(home), pctDe(away), mayor),
    },
    ...filasDeLugar(home, away),
    {
      key: 'anotados',
      label: 'Puntos anotados por partido',
      home: unDecimal(anotadosA),
      away: unDecimal(anotadosB),
      lead: ventaja(anotadosA, anotadosB, mayor),
    },
    {
      key: 'permitidos',
      label: 'Puntos permitidos por partido',
      home: unDecimal(permitidosA),
      away: unDecimal(permitidosB),
      lead: ventaja(permitidosA, permitidosB, menor),
    },
    { key: 'local', label: 'De local', home: recordLabel(home.home_record), away: recordLabel(away.home_record), lead: null },
    { key: 'visita', label: 'De visitante', home: recordLabel(home.away_record), away: recordLabel(away.away_record), lead: null },
    { key: 'racha', label: 'Racha', home: rachaLabel(home.streak), away: rachaLabel(away.streak), lead: null },
  ];
}

// El renglón chico debajo de un enfrentamiento anterior: "ONEFA 2025, Jornada
// 3". La coma va solo entre dos cosas que existen: un partido de una categoría
// sin torneo (el modelo viejo) decía ", Jornada 3".
export function detalleDelEnfrentamiento(p) {
  return [
    [p?.tournament_name, p?.tournament_year].filter(Boolean).join(' '),
    p?.week_label ? jornadaLabel(p.week_label) : null,
  ].filter(Boolean).join(', ');
}

// La línea corta debajo de cada casco: "7-2, 2.º en BAJÍO". Toma el lugar de la
// tabla más específica, que es la última: `standings_levels` va de la general
// al grupo. Sin juegos no dice nada: "0-0" debajo de un casco parece un dato.
export function lineaDelEquipo(lado) {
  if (!lado || !lado.played) return '';
  const record = recordLabel(lado);
  const lugar = lado.places?.[lado.places.length - 1];
  if (!lugar) return record;
  return lugar.scope_name ? `${record}, ${ordinal(lugar.rank)} en ${lugar.scope_name}` : `${record}, ${ordinal(lugar.rank)}`;
}
