// Modo ONEFA: la plantilla completa de la competencia de ONEFA, para aplicarla
// de un clic desde ⚙ competencia. README, "Modo ONEFA".
//
// Es función PURA: recibe la estructura de la rama (conferencias y sus grupos)
// y lo que se eligió en pantalla, y devuelve el plan — qué tablas, qué
// desempate, qué fases, quién clasifica y qué título. Escribirlo en la base es
// trabajo de la ruta (routes/manage.js), en una sola sentencia.
//
// ── Por qué este sí lleva el nombre de una liga ──
//
// Los preconfigurados de desempate (utils/standings.js) se nombran por lo que
// hacen, porque un reglamento suelto no le pertenece a nadie. Esto es otra
// cosa: la competencia entera de una liga en particular. Lo pidió Alfredo el
// 2026-10-25, y por eso solo se ofrece en esa liga.
//
// El formato es el de 2026 (Claro Sports), que reemplaza al art. 14 del
// reglamento 2024: 14 Grandes clasifica a 8 por su tabla, y Nacional a los 2
// primeros de cada grupo más los 2 mejores terceros. Cuartos, semifinales y
// final; un campeón por conferencia y ninguno general.

import { TIEBREAKER_PRESETS } from './standings.js';

// ONEFA se reconoce por su id y no por el nombre ni el slug: esos dos los
// puede editar la liga, y el botón desaparecería sin que nadie supiera por qué.
// Comprobado el 2026-10-25 en desarrollo-local, que es copia de producción.
export const ONEFA_LEAGUE_ID = 13;

// Cómo clasifica cada conferencia. Se elige en pantalla, una por conferencia.
export const ONEFA_CHOICES = {
  table: {
    label: 'Los 8 primeros de la tabla de la conferencia',
  },
  groups: {
    label: 'Los 2 primeros de cada grupo + los 2 mejores terceros',
  },
};

// Los nombres de las fases son también la forma de unirlas en la sentencia que
// las crea (la clasificación y el título apuntan a una fase por su nombre).
const REGULAR = 'Temporada regular';
const CUARTOS = 'Cuartos de final';
const SEMIS   = 'Semifinales';
const FINAL   = 'Final';

// Los mejores terceros se comparan por récord y, si empatan, por goal
// average: el reglamento no lo dice, y es el criterio con que ONEFA cierra
// cualquier empate (art. 13). Decidido por Alfredo el 2026-10-25.
const CROSS_TIEBREAKERS = ['win_pct', 'goal_average'];

// Por default, una conferencia con tres grupos clasifica por grupos (es la
// Nacional: Norte, Bajío y Centro) y cualquier otra por su tabla. Si 14
// Grandes llegara a tener dados de alta sus grupos pares y nones, la pantalla
// deja cambiarlo antes de aplicar.
export function defaultChoice(conference) {
  return (conference.groups || []).length === 3 ? 'groups' : 'table';
}

// El modo solo se aplica sobre una rama sin fases ni títulos. Borrar una fase
// le quita la fase a sus partidos y borrar un título se lleva los campeones
// puestos a mano, así que reemplazarlos no es una decisión que tome un botón.
export function blockedReason({ phases = 0, titles = 0 } = {}) {
  if (!phases && !titles) return null;
  const partes = [];
  if (phases) partes.push(`${phases} fase${phases === 1 ? '' : 's'}`);
  if (titles) partes.push(`${titles} título${titles === 1 ? '' : 's'}`);
  return `Esta rama ya tiene ${partes.join(' y ')}. El Modo ONEFA solo se aplica sobre una rama sin fases ni títulos: quítalos en sus pestañas, o ajusta la configuración a mano.`;
}

/**
 * El plan del Modo ONEFA para una rama.
 *
 * @param {object[]} conferences  [{ id, name, groups: [{ id, name }] }]
 * @param {object}   choices      { [conference_id]: 'table' | 'groups' } — lo que
 *                                no venga toma defaultChoice()
 * @returns {{ plan } | { error }}
 */
export function planOnefaMode({ conferences = [], choices = {} } = {}) {
  if (!conferences.length) {
    return { error: 'El Modo ONEFA necesita que la rama tenga conferencias' };
  }

  // Las llaves llegan como texto desde el JSON del body.
  const elegidas = new Map(Object.entries(choices || {}).map(([k, v]) => [String(k), v]));
  const propias = new Set(conferences.map((c) => String(c.id)));
  const ajena = [...elegidas.keys()].find((k) => !propias.has(k));
  if (ajena) return { error: `La conferencia ${ajena} no es de esta rama` };

  const hasGroups = conferences.some((c) => (c.groups || []).length > 0);

  const qualifications = [];
  for (const c of conferences) {
    const choice = elegidas.get(String(c.id)) ?? defaultChoice(c);
    if (!ONEFA_CHOICES[choice]) {
      return { error: `Clasificación desconocida para ${c.name}: ${choice}` };
    }
    if (choice === 'groups' && (c.groups || []).length < 2) {
      return { error: `${c.name} no tiene grupos: solo puede clasificar por la tabla de la conferencia` };
    }
    qualifications.push(choice === 'groups'
      ? {
        phase: REGULAR, target: CUARTOS, conference_id: c.id, choice,
        from_scope: 'group', top_n: 2, plus_best_n: 2, of_rank: 3,
        cross_tiebreakers: CROSS_TIEBREAKERS,
      }
      : {
        phase: REGULAR, target: CUARTOS, conference_id: c.id, choice,
        from_scope: 'conference', top_n: 8, plus_best_n: 0, of_rank: null,
        cross_tiebreakers: null,
      });
  }

  const preset = TIEBREAKER_PRESETS.dominante_o_en_contra;
  return {
    plan: {
      // Sin tabla general: no hay juegos entre conferencias, y una tabla que
      // mezcla equipos que nunca se enfrentaron no significa nada.
      standings: {
        standings_levels: hasGroups ? ['conference', 'group'] : ['conference'],
        tiebreakers: preset.tiebreakers,
        tiebreaker_mode: preset.multi_team_mode,
      },
      phases: [
        { name: REGULAR, type: hasGroups ? 'groups' : 'round_robin', counts_for_standings: true,  sort_order: 1 },
        { name: CUARTOS, type: 'single_elimination',                 counts_for_standings: false, sort_order: 2 },
        { name: SEMIS,   type: 'single_elimination',                 counts_for_standings: false, sort_order: 3 },
        { name: FINAL,   type: 'single_elimination',                 counts_for_standings: false, sort_order: 4 },
      ],
      qualifications,
      titles: [
        { name: 'Campeón de conferencia', scope: 'conference', decided_by: 'match', phase: FINAL, sort_order: 1 },
      ],
    },
  };
}
