import { getMatchParts, jornadaLabel, MESES } from './matchDisplay.js';

// Cómo se dice cada aviso de "Mis notificaciones" (README, "Notificaciones: la
// bandeja y el push").
//
// Los de las organizaciones traen su texto guardado. Los de lo que sigues se
// arman AQUÍ, al leer, con los datos de hoy del partido: si se corrige un
// marcador o se mueve la fecha otra vez, el aviso dice lo que vale ahora.
//
// Los de lo que sigues son cuatro: marcador final y cambio de fecha o sede
// (de `match_events`, config/db.js) más los dos que el backend calcula con la
// hora del partido (utils/bandeja.js). Los de tus predicciones, cuatro, van
// abajo. Un tipo nuevo se agrega en los tres lados o en ninguno (regla 6).

// La pantalla de notificaciones lo dispara en cuanto marca la bandeja como
// vista, para que el balón de la barra de arriba se ponga en cero sin volver a
// preguntar.
export const EVENTO_NOTIFICACIONES_VISTAS = 'cfbamx:notificaciones-vistas';

// Lo que enseña el balón de la barra de arriba.
export function etiquetaDelContador(n) {
  const num = Number(n) || 0;
  if (num <= 0) return '';
  return num > 9 ? '9+' : String(num);
}

function cuandoEs(match) {
  if (!match?.match_date) return '';
  const { day, month, time, tzLabel } = getMatchParts(match.match_date, match.timezone);
  return `${day} ${month} · ${time} (${tzLabel})`;
}

export function textoDeSeguimiento(aviso) {
  const m = aviso?.match || {};
  const cruce = `${m.home_team} vs ${m.away_team}`;
  const cuando = cuandoEs(m);

  switch (aviso?.type) {
    case 'upcoming':
      return { title: `Próximo — ${cruce}`, body: cuando ? `Empieza el ${cuando}.` : 'Empieza en una hora.' };
    case 'live':
      return { title: `En vivo — ${cruce}`, body: 'El partido ya comenzó.' };
    case 'final_score': {
      const hayMarcador = m.home_score != null && m.away_score != null;
      return {
        title: `Marcador final — ${cruce}`,
        body: hayMarcador
          ? `${m.home_team} ${m.home_score} · ${m.away_team} ${m.away_score}`
          : 'Mira el resultado en la página del partido.',
      };
    }
    case 'schedule_change': {
      const d = aviso.data || {};
      const que = d.date_changed && d.venue_changed ? 'Cambiaron la fecha y la sede.'
        : d.venue_changed ? 'Cambió la sede.'
        : 'Cambió la fecha u hora.';
      // Le quitaron la fecha: el aviso dice lo que vale hoy, igual que cuando
      // la cambiaron (README, "Partidos con fecha por definir").
      if (!cuando && d.date_changed && m.match_date == null) {
        return { title: `Cambio de programación — ${cruce}`, body: `${que} Ahora la fecha está por definir.` };
      }
      return { title: `Cambio de programación — ${cruce}`, body: cuando ? `${que} Ahora: ${cuando}.` : que };
    }
    default:
      return { title: cruce, body: '' };
  }
}

// ── Los avisos de tus predicciones ────────────────────────────────────────
//
// README, "Los avisos de tus predicciones". El backend los calcula al leer y
// manda solo los datos (utils/bandeja.js); aquí se dicen. Cuatro tipos, que se
// repiten en pages/Notifications.jsx (regla 6).

// La jornada del aviso: su etiqueta ("Jornada 4", "SEMIFINAL"), o el día de
// los partidos cuando la liga no puso jornada.
export function nombreDeJornada(jornada) {
  if (jornada?.week_label) return jornadaLabel(jornada.week_label);
  // Sin jornada ni fecha: el backend los junta en 'D:por-definir'
  // (utils/rankingPredicciones.js, jornadaDe).
  if (jornada?.key === 'D:por-definir') return 'los partidos con fecha por definir';
  const [, , mes, dia] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(jornada?.fecha || '') || [];
  return mes ? `los partidos del ${Number(dia)} ${MESES[Number(mes) - 1]}` : 'la jornada';
}

const lugar = (n) => `${n}.º`;
const puntos = (n) => `${n} ${n === 1 ? 'punto' : 'puntos'}`;
const conMayuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ": PLAYOFFS (4) y SEMIFINAL (2)": las jornadas de lo que te falta votar, con
// cuántos de cada una. Con una sola no hace falta (va en el título), y con más
// de tres se dice solo cuántas son: una liga que sube media temporada de golpe
// no cabe en una línea.
function repartoPorJornada(jornadas) {
  if (jornadas.length < 2) return '';
  if (jornadas.length > 3) return ` de ${jornadas.length} jornadas`;
  const partes = jornadas.map((j) => `${nombreDeJornada(j.jornada)} (${Number(j.missing) || 0})`);
  return `: ${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

function tituloDeHito(hito, dondeTexto, empatados) {
  switch (hito) {
    case 'first':      return empatados > 0 ? `Compartes el 1.º lugar${dondeTexto}` : `¡Vas 1.º${dondeTexto}!`;
    case 'top3':       return `¡Entraste al top 3${dondeTexto}!`;
    case 'top10':      return `¡Entraste al top 10${dondeTexto}!`;
    case 'lost_first': return `Te quitaron el 1.º lugar${dondeTexto}`;
    default:           return null;
  }
}

function cambioDeLugar(cambio) {
  if (cambio == null) return '';
  if (cambio > 0) return ` · subiste ${cambio}`;
  if (cambio < 0) return ` · bajaste ${-cambio}`;
  return ' · mismo lugar';
}

export function textoDePrediccion(aviso) {
  const m = aviso?.match || {};
  const d = aviso?.data || {};
  const cruce = `${m.home_team} vs ${m.away_team}`;

  switch (aviso?.type) {
    case 'prediction_result': {
      const hayMarcador = m.home_score != null && m.away_score != null;
      const marcador = hayMarcador
        ? `${m.home_team} ${m.home_score} · ${m.away_team} ${m.away_score}.`
        : 'Mira el resultado en la página del partido.';
      const tuVoto = d.pick === 'home' ? m.home_team : d.pick === 'away' ? m.away_team : 'el empate';
      const resultado = d.correct
        ? ` +${puntos(d.points)}${d.points === 2 ? ' (fase final)' : ''}.`
        : ` Tu voto: ${tuVoto}.`;
      // Cuánta gente votó igual. Acertarle a lo que casi nadie vio venir es
      // lo que se presume; lo demás se dice sin adjetivos.
      let gente = '';
      if (d.votes > 1 && d.same_pct != null) {
        gente = d.correct && d.same_pct <= 25
          ? ` Solo el ${d.same_pct}% lo vio venir.`
          : ` El ${d.same_pct}% votó como tú.`;
      }
      return {
        icon: d.correct ? '✅' : '❌',
        title: `${d.correct ? 'Acertaste' : 'No se dio'} — ${cruce}`,
        body: `${marcador}${resultado}${gente}`,
      };
    }

    case 'prediction_round': {
      const jornada = nombreDeJornada(d.jornada);
      const quinielas = Array.isArray(d.pools) ? d.pools : [];
      const hitoDeQuiniela = quinielas.find((q) => q.milestone);
      const titulo =
        tituloDeHito(d.milestone, ' en el ranking', d.tied) ||
        (hitoDeQuiniela && tituloDeHito(hitoDeQuiniela.milestone, ` en ${hitoDeQuiniela.name}`, hitoDeQuiniela.tied)) ||
        `Cerró ${d.jornada?.week_label ? 'la ' : ''}${jornada}`;

      const lineas = [];
      const nombre = jornada.charAt(0).toUpperCase() + jornada.slice(1);
      lineas.push(d.voted > 0
        ? `${nombre}: acertaste ${d.correct} de ${d.graded} · +${puntos(d.points)}.`
        : `No votaste ${d.jornada?.week_label ? 'la ' : ''}${jornada}.`);
      const empate = d.tied > 0 ? ` (empatado con ${d.tied} más)` : '';
      lineas.push(`Vas ${lugar(d.position)} de ${d.participants}${empate}${cambioDeLugar(d.change)} · ${puntos(d.total_points)} en total.`);
      for (const q of quinielas) {
        lineas.push(`En ${q.name}: ${lugar(q.position)} de ${q.members}${cambioDeLugar(q.change)}.`);
      }
      return { title: titulo, body: lineas.join('\n') };
    }

    case 'prediction_reminder': {
      const jornada = nombreDeJornada(d.jornada);
      const cuando = cuandoEs(m);
      const n = Number(d.missing) || 0;
      return {
        title: `Te falta votar — ${jornada.charAt(0).toUpperCase() + jornada.slice(1)}`,
        body: n === 1
          ? `Te falta 1 partido: ${cruce}${cuando ? `, el ${cuando}` : ''}.`
          : `Te faltan ${n} partidos. El primero empieza el ${cuando}.`,
      };
    }

    // La liga agregó partidos a un calendario donde votas (README, "Partidos
    // nuevos para predecir"). El número es lo que todavía puedes votar: baja
    // conforme votas, y el backend quita el aviso cuando llega a cero. El
    // partido del aviso es el primero que te falta.
    case 'prediction_new_matches': {
      const faltan = Number(d.missing) || 0;
      const agregados = Math.max(Number(d.added) || 0, faltan);
      const jornadas = Array.isArray(d.jornadas) ? d.jornadas : [];
      const unaJornada = jornadas.length === 1 ? conMayuscula(nombreDeJornada(jornadas[0].jornada)) : null;
      const cuando = cuandoEs(m);
      const elPartido = `${cruce}, ${cuando ? `el ${cuando}` : 'con fecha por definir'}`;
      const reparto = repartoPorJornada(jornadas);

      let body;
      if (agregados === 1) body = `${elPartido}.`;
      else if (faltan === 1) body = `Se agregaron ${agregados} partidos y te falta 1: ${elPartido}.`;
      else if (faltan === agregados) body = `Se agregaron ${agregados} partidos${reparto}. Haz tus predicciones antes de que empiecen.`;
      else body = `Se agregaron ${agregados} partidos y te faltan ${faltan}${reparto}.`;

      return {
        title: `${faltan === 1 ? 'Partido nuevo' : 'Partidos nuevos'} para predecir${unaJornada ? ` — ${unaJornada}` : ''}`,
        body,
      };
    }

    default:
      return { title: cruce, body: '' };
  }
}
