// Estadísticas por jugada: qué es una jugada válida, cómo se deriva el down y
// cómo se suma el box score. El porqué de cada decisión está en el README,
// "Estadísticas por jugada" (decidido el 2026-09-20).
//
// Puro y sin `db`, igual que `orgRoles.js`, `rosterVisibility.js` y
// `attendance.js`. Aquí no es solo por poder probarlo sin Postgres: **aquí vive
// la aritmética de acreditación de la NCAA**, que es exactamente lo que alguien
// va a "arreglar" más adelante creyendo que encontró un bug. Cada regla rara
// lleva escrito de dónde sale.
//
// ONEFA juega con reglas NCAA, así que el criterio no se inventa ni se discute:
// está en el NCAA Football Statisticians' Manual. Los NOMBRES de la salida
// salen de SportsML 3.1 (IPTC), que es la otra mitad de la decisión — las
// columnas de `player_match_stats` NO se renombraron, y esta es la tabla de
// equivalencias que aquella decisión dejó pendiente para "el día que haga
// falta". Ese día llegó con el box score derivado, y costó veinte líneas.

// ── Los tres niveles de captura ───────────────────────────────────────────
//
// El nivel no es una preferencia: es un dato del que depende cómo se lee ese
// partido. Un partido capturado en `scoring` tiene jugadas —las ocho que
// anotaron— y derivar un box score de ahí diría que el equipo entero corrió 80
// yardas en todo el partido. Un número falso con cara de verdadero, que es la
// peor clase. Por eso el nivel viaja con la sesión y por eso existe
// `derivaBoxScore()`.
export const NIVELES_DE_CAPTURA = ['scoring', 'offense', 'full'];

export function esNivelValido(nivel) {
  return NIVELES_DE_CAPTURA.includes(nivel);
}

// Qué niveles alimentan el box score derivado. `scoring` NO: sus jugadas
// sirven para "quién anotó" y para nada más.
export function derivaBoxScore(nivel) {
  return nivel === 'offense' || nivel === 'full';
}

// ── El vocabulario ────────────────────────────────────────────────────────
//
// `config/db.js` importa las dos listas para construir sus CHECK, igual que
// hace con los roles y con los estados de asistencia: son valores que viajan
// por la API, y la regla 6 dice que se cambian en los tres lados o en ninguno.
export const TIPOS_DE_JUGADA = [
  'rush', 'pass', 'kickoff', 'punt', 'field_goal',
  'extra_point', 'two_point', 'penalty', 'kneel', 'spike',
];

export const ROLES_DE_PARTICIPANTE = [
  'passer', 'rusher', 'receiver', 'tackler', 'assist', 'sack',
  'interceptor', 'fumbler', 'recoverer', 'kicker', 'punter', 'returner',
];

// Qué participante tiene que traer cada tipo de jugada para ser válida. Es el
// punto 2 de la jugada mínima: "al menos un participante con el balón".
//
// `penalty` es la única sin nadie obligatorio, y tiene razón de ser: una jugada
// anulada por una falta antes del snap no la tocó nadie. Si se le exigiera un
// participante, el visor tendría que inventarse uno.
const CON_EL_BALON = {
  rush: ['rusher'],
  pass: ['passer'],
  kickoff: ['kicker'],
  punt: ['punter'],
  field_goal: ['kicker'],
  extra_point: ['kicker'],
  // Una conversión de dos puntos se corre o se pasa, y el visor no tiene por
  // qué declarar cuál antes de decir quién la hizo.
  two_point: ['rusher', 'passer'],
  kneel: ['rusher'],
  spike: ['passer'],
  penalty: [],
};

// ── Lo que llega del lote, ya limpio ──────────────────────────────────────
//
// El lote viene de un teléfono que capturó sin señal, así que se valida entero
// y falla explícito: una jugada mal armada ROMPE el lote en vez de guardarse a
// medias. No hay default inofensivo — una jugada sin `play_type` no es "una
// jugada de tipo desconocido", es un renglón que nadie va a poder leer después.
//
// La excepción es el DUPLICADO, que no es un error: el mismo `client_play_id`
// dos veces en un lote pasa de verdad cuando la cola junta dos capturas de la
// misma pantalla. Gana el último, igual que en el pase de lista, porque tirar
// un partido entero por un duplicado que ya sabemos resolver sería perderlo
// todo por lo de menos.
export function normalizarLoteDeJugadas(plays) {
  if (plays === undefined || plays === null) {
    return { error: 'Falta la lista de jugadas (plays)' };
  }
  if (!Array.isArray(plays)) {
    return { error: 'plays tiene que ser una lista' };
  }
  if (plays.length === 0) {
    return { error: 'El lote viene vacío' };
  }

  const porLlave = new Map();
  for (const cruda of plays) {
    const jugada = normalizarJugada(cruda);
    if (jugada.error) return jugada;
    porLlave.set(jugada.client_play_id, jugada);
  }

  return { plays: [...porLlave.values()] };
}

export function normalizarJugada(cruda) {
  if (!cruda || typeof cruda !== 'object') {
    return { error: 'Cada jugada tiene que ser un objeto' };
  }

  // La llave la pone el cliente y nace en el celular (`crypto.randomUUID()`).
  // Es la identidad real de la jugada: `sequence` la asigna el dispositivo y
  // dos dispositivos empiezan los dos en 1, así que no identifica nada.
  const clientPlayId = String(cruda.client_play_id ?? '').trim();
  if (!clientPlayId) {
    return { error: 'Cada jugada necesita su client_play_id' };
  }
  // Se acota para que un cliente roto no llene la tabla con llaves de un mega.
  // Un UUID mide 36; 64 deja espacio para cualquier formato razonable.
  if (clientPlayId.length > 64) {
    return { error: 'El client_play_id es demasiado largo' };
  }

  if (!TIPOS_DE_JUGADA.includes(cruda.play_type)) {
    return { error: `"${cruda.play_type}" no es un tipo de jugada` };
  }

  const sequence = Number(cruda.sequence);
  if (!Number.isInteger(sequence) || sequence < 0) {
    return { error: 'Cada jugada necesita su sequence (el orden de captura)' };
  }

  const drive = Number(cruda.drive_number);
  if (!Number.isInteger(drive) || drive <= 0) {
    return { error: 'Cada jugada necesita su drive_number (la serie)' };
  }

  const offenseTeamId = Number(cruda.offense_team_id);
  if (!Number.isInteger(offenseTeamId) || offenseTeamId <= 0) {
    return { error: 'Cada jugada necesita de quién es el balón (offense_team_id)' };
  }

  if (!cruda.period || typeof cruda.period !== 'string') {
    return { error: 'Cada jugada necesita su periodo' };
  }

  // Cero es un valor, no un hueco: un pase incompleto ganó cero yardas y eso es
  // un dato. Por eso se exige presente y se rechaza `null`, en vez de dejarlo
  // caer a cero solo.
  const yards = Number(cruda.yards_gained);
  if (cruda.yards_gained === null || cruda.yards_gained === undefined || !Number.isInteger(yards)) {
    return { error: 'Cada jugada necesita sus yardas (yards_gained); cero es un valor válido' };
  }
  if (yards < -100 || yards > 109) {
    return { error: 'Esas yardas no caben en un campo' };
  }

  const participantes = normalizarParticipantes(cruda.participants, cruda.play_type);
  if (participantes.error) return participantes;

  const points = Number(cruda.points ?? 0);
  if (!Number.isInteger(points) || points < 0 || points > 8) {
    return { error: 'Los puntos de una jugada van de 0 a 8' };
  }
  // Si anotó, se dice quién: sin `scoring_team_id` no se sabe de qué lado fue
  // la anotación en una devolución o en un balón suelto recuperado en la zona.
  const scoringTeamId = points > 0 ? Number(cruda.scoring_team_id ?? offenseTeamId) : null;
  if (points > 0 && (!Number.isInteger(scoringTeamId) || scoringTeamId <= 0)) {
    return { error: 'Una jugada que anotó necesita decir qué equipo anotó' };
  }

  const down = Number(cruda.down);
  const distance = Number(cruda.distance);
  const yardLine = Number(cruda.yard_line);

  return {
    client_play_id: clientPlayId,
    sequence,
    drive_number: drive,
    period: cruda.period.slice(0, 8),
    // El reloj se captura POR SERIE, no por jugada: de 120 capturas a 10 o 15.
    // En las demás llega en nulo y no se inventa nada.
    clock: cruda.clock ? String(cruda.clock).slice(0, 8) : null,
    offense_team_id: offenseTeamId,
    // El down y la distancia SOLO se guardan si alguien corrigió el derivado.
    // Lo normal es que lleguen en nulo — se calculan al leer (regla 4).
    down: Number.isInteger(down) && down >= 1 && down <= 4 ? down : null,
    distance: Number.isInteger(distance) && distance >= 0 ? distance : null,
    yard_line: Number.isInteger(yardLine) && yardLine >= 0 && yardLine <= 100 ? yardLine : null,
    play_type: cruda.play_type,
    yards_gained: yards,
    points,
    scoring_team_id: scoringTeamId,
    notes: cruda.notes ? String(cruda.notes).slice(0, 500) : null,
    participants: participantes.participants,
  };
}

function normalizarParticipantes(lista, playType) {
  if (lista !== undefined && lista !== null && !Array.isArray(lista)) {
    return { error: 'participants tiene que ser una lista' };
  }

  const vistos = new Set();
  const participants = [];
  for (const p of lista || []) {
    const playerId = Number(p?.player_id);
    if (!Number.isInteger(playerId) || playerId <= 0) {
      return { error: 'Cada participante necesita un player_id válido' };
    }
    if (!ROLES_DE_PARTICIPANTE.includes(p?.role)) {
      return { error: `"${p?.role}" no es un papel en una jugada` };
    }
    // El mismo jugador con el mismo papel dos veces es el duplicado que la
    // tabla ya impide con su UNIQUE. Se resuelve aquí y en silencio para que el
    // lote no se caiga por eso; el mismo jugador con DOS papeles distintos sí
    // es normal (el que corrió y recuperó su propio balón suelto).
    const llave = `${playerId}:${p.role}`;
    if (vistos.has(llave)) continue;
    vistos.add(llave);
    participants.push({
      player_id: playerId,
      role: p.role,
      yards: Number.isInteger(Number(p?.yards)) ? Number(p.yards) : null,
    });
  }

  // El punto 2 de la jugada mínima. Se revisa al final porque el mensaje tiene
  // que decir qué falta, no solo que algo falta.
  const obligatorios = CON_EL_BALON[playType] || [];
  if (obligatorios.length && !participants.some((p) => obligatorios.includes(p.role))) {
    return { error: `Una jugada de tipo "${playType}" necesita decir quién llevó el balón (${obligatorios.join(' o ')})` };
  }

  return { participants };
}

// ── El down no se captura, se deriva ──────────────────────────────────────
//
// Dentro de una serie, si se sabe dónde empezó y cuántas yardas ganó cada
// jugada, se sabe en qué down va: 1 y 10 desde la 25, ganó 4 → 2 y 6. Es la
// regla 4 aplicada a la captura, y es la diferencia entre teclear cuatro campos
// por jugada y confirmar uno.
//
// `yard_line` son **las yardas que faltan para la zona de anotación rival**
// (0–100), no la numeración pintada en el campo. Se eligió así porque es la que
// hace que "1 y gol" salga solo: lo que falta por ganar nunca puede ser más que
// lo que falta para anotar.
//
// Lo que rompe la cadena son las penalizaciones y los cambios de posesión que
// nadie anotó. Cuando pasa, esto lo DICE (`cadena_rota`) en vez de inventar un
// quinto down: la pantalla muestra el derivado y deja corregirlo, y el visor no
// captura el down — lo desmiente cuando se desvía.
//
// Recibe las jugadas de UNA serie, ya ordenadas por `sequence`.
export function derivarDowns(jugadasDeLaSerie) {
  const jugadas = Array.isArray(jugadasDeLaSerie) ? jugadasDeLaSerie : [];

  let yardLine = null;
  let down = null;
  let distance = null;
  let rota = false;

  return jugadas.map((jugada) => {
    // Una corrección manda sobre todo lo anterior y REARRANCA la cadena: el
    // visor vio el campo y este código no. Es también cómo se sale de una
    // cadena rota sin tener que empezar otra serie.
    const corregida = jugada.down != null;
    if (corregida) {
      down = jugada.down;
      distance = jugada.distance != null ? jugada.distance : 10;
      rota = false;
    }
    if (jugada.yard_line != null) {
      yardLine = jugada.yard_line;
      if (!corregida && down == null) {
        down = 1;
        distance = Math.min(10, yardLine);
      }
    }

    // Lo que no consume down. Un kickoff y un punto extra no son primer down de
    // nada, y ponerles uno es peor que dejarlo vacío.
    const sinDown = jugada.play_type === 'kickoff'
      || jugada.play_type === 'extra_point'
      || jugada.play_type === 'two_point';

    const fila = {
      client_play_id: jugada.client_play_id,
      down: sinDown ? null : down,
      distance: sinDown ? null : distance,
      yard_line: yardLine,
      // De dónde salió el número: es lo que la pantalla necesita para pintar el
      // derivado distinto del confirmado.
      derivado: !corregida && !sinDown && down != null,
      cadena_rota: rota && !sinDown,
    };

    // Y ahora se avanza el estado para la siguiente jugada.
    if (yardLine != null) yardLine = Math.max(0, Math.min(100, yardLine - jugada.yards_gained));

    if (sinDown) return fila;

    // Una penalización no consume down por sí sola: mueve el balón y la cadena
    // sigue donde estaba. Que además haya dado primero y diez es cosa del
    // árbitro, y para eso está la corrección.
    if (jugada.play_type === 'penalty') {
      if (distance != null) distance = Math.max(0, distance - jugada.yards_gained);
      return fila;
    }

    if (down == null || distance == null) return fila;

    if (jugada.yards_gained >= distance) {
      down = 1;
      distance = yardLine != null ? Math.min(10, yardLine) : 10;
      rota = false;
    } else if (down >= 4) {
      // Quinto down. No existe: pasó algo que nadie capturó. Se dice y se deja
      // de contar hasta que alguien corrija o hasta que empiece otra serie.
      down = null;
      distance = null;
      rota = true;
    } else {
      down += 1;
      distance -= jugada.yards_gained;
    }

    return fila;
  });
}

// Agrupa por serie y deriva cada una por separado. Es lo que consume la ruta.
//
// **El orden sale de `sequence`, nunca de `created_at`.** El `created_at` de
// una jugada capturada sin señal es el momento en que se SUBIÓ, no el momento
// en que pasó: un partido entero puede llegar con el mismo segundo. Queda
// escrito porque ordenar por fecha es lo primero que alguien va a intentar, se
// ve razonable en un partido capturado en vivo, y sale revuelto justo en el que
// se capturó sin señal — sin que nada falle a la vista.
export function derivarDownsDelPartido(jugadas) {
  const porSerie = new Map();
  for (const jugada of jugadas || []) {
    const serie = jugada.drive_number;
    if (!porSerie.has(serie)) porSerie.set(serie, []);
    porSerie.get(serie).push(jugada);
  }

  const derivadas = new Map();
  for (const [, deLaSerie] of porSerie) {
    const ordenadas = [...deLaSerie].sort((a, b) => a.sequence - b.sequence);
    for (const fila of derivarDowns(ordenadas)) derivadas.set(fila.client_play_id, fila);
  }
  return derivadas;
}

// ── El box score se suma, no se guarda ────────────────────────────────────
//
// Los nombres son los de SportsML. Son los mismos dieciséis conteos que tiene
// `player_match_stats`, que NO se renombró: la cascada entrega una sola forma
// venga de donde venga el dato, y esta es la tabla de equivalencias que aquella
// decisión dejó escrita para el día que hiciera falta.
export const EQUIVALENCIAS_SPORTSML = {
  pass_completions: 'passes-completions',
  pass_attempts: 'passes-attempts',
  pass_yards: 'passes-yards',
  pass_td: 'passes-touchdowns',
  interceptions_thrown: 'passes-interceptions',
  rush_attempts: 'rushes-attempts',
  rush_yards: 'rushes-yards',
  rush_td: 'rushes-touchdowns',
  receptions: 'receptions-total',
  receiving_yards: 'receptions-yards',
  receiving_td: 'receptions-touchdowns',
  tackles: 'tackles-total',
  sacks: 'sacks-total',
  interceptions_def: 'interceptions-total',
  field_goals_made: 'field-goals-made',
  extra_points_made: 'extra-points-made',
};

export const CONTEOS = Object.values(EQUIVALENCIAS_SPORTSML);

// Lo que solo puede saber una captura jugada por jugada. Va APARTE y no
// mezclado con los dieciséis, porque la otra rama de la cascada —los totales
// tecleados a mano— no tiene de dónde sacarlo, y un cero ahí diría "no pasó"
// cuando lo cierto es "no se capturó". Son dos cosas distintas y la diferencia
// se conserva.
export const EXTRAS = ['fumbles-total', 'fumbles-recovered', 'punts-total', 'returns-total', 'returns-yards'];

function filaVacia(conExtras) {
  const fila = {};
  for (const nombre of CONTEOS) fila[nombre] = 0;
  if (conExtras) for (const nombre of EXTRAS) fila[nombre] = 0;
  return fila;
}

// Suma el box score a partir de las jugadas. Devuelve un renglón por jugador
// que participó en alguna, más el total de puntos por equipo.
//
// **Las reglas raras son de la NCAA y están escritas a propósito.** Las tres
// que nadie adivinaría solo:
//
//   1. Una CAPTURA no es un intento de pase. La yarda perdida se le carga al
//      pasador como ACARREO. (En la NFL es al revés y se descuenta de las
//      yardas de pase; por eso los quarterbacks colegiales tienen totales de
//      carrera horribles, y por eso alguien va a creer que esto está mal.) Y la
//      captura se parte entre quienes la hicieron: dos taqueadores son media
//      captura cada uno.
//   2. Un pase tirado a propósito al suelo (*intentional grounding*) tampoco es
//      intento de pase: es un acarreo con la pérdida hasta el punto de la
//      falta. Se captura como `rush` del pasador, así que aquí no hay nada que
//      programar — queda dicho para que nadie lo "arregle" después.
//   3. Una conversión de dos puntos NO entra en los totales individuales de
//      pase, acarreo ni recepción. Se cuenta como puntos y nada más.
export function boxScoreDerivado(jugadas, { conExtras = true } = {}) {
  const jugadores = new Map();
  const puntosPorEquipo = new Map();

  const de = (playerId) => {
    if (!jugadores.has(playerId)) jugadores.set(playerId, { player_id: playerId, ...filaVacia(conExtras) });
    return jugadores.get(playerId);
  };

  for (const jugada of jugadas || []) {
    const participantes = jugada.participants || [];
    const tipo = jugada.play_type;
    const yardas = Number(jugada.yards_gained) || 0;
    const puntos = Number(jugada.points) || 0;

    if (puntos > 0 && jugada.scoring_team_id) {
      puntosPorEquipo.set(jugada.scoring_team_id, (puntosPorEquipo.get(jugada.scoring_team_id) || 0) + puntos);
    }

    const sacks = participantes.filter((p) => p.role === 'sack');
    const capturada = sacks.length > 0;
    const receptores = participantes.filter((p) => p.role === 'receiver');
    const interceptado = participantes.some((p) => p.role === 'interceptor');
    // Regla 3 de arriba: los dos puntos se cuentan como puntos y nada más.
    const cuentaIndividual = tipo !== 'two_point';
    // El touchdown de esta jugada se acredita a quien la llevó. El punto extra
    // y los dos puntos tienen su propio conteo y no son touchdowns de nadie.
    const td = puntos === 6;

    for (const p of participantes) {
      const fila = de(p.player_id);
      // `yards` del participante existe para repartir una jugada entre dos
      // (la devolución después de la recepción). Si no viene, son las de la
      // jugada completa.
      const suyas = p.yards != null ? p.yards : yardas;

      switch (p.role) {
        case 'passer':
          // Regla 1: si lo capturaron, esto NO fue un pase. Es un acarreo con
          // la pérdida, y así lo manda el manual de la NCAA.
          if (capturada) {
            if (cuentaIndividual) {
              fila['rushes-attempts'] += 1;
              fila['rushes-yards'] += yardas;
            }
            break;
          }
          if (cuentaIndividual && (tipo === 'pass' || tipo === 'spike')) {
            fila['passes-attempts'] += 1;
            // Es completo si hubo receptor. El `spike` nunca lo es, y un pase
            // interceptado tampoco: se completó, pero al equipo contrario.
            if (tipo === 'pass' && receptores.length > 0 && !interceptado) {
              fila['passes-completions'] += 1;
              fila['passes-yards'] += yardas;
              if (td) fila['passes-touchdowns'] += 1;
            }
            if (interceptado) fila['passes-interceptions'] += 1;
          }
          break;

        case 'rusher':
          if (cuentaIndividual && (tipo === 'rush' || tipo === 'kneel')) {
            fila['rushes-attempts'] += 1;
            fila['rushes-yards'] += suyas;
            if (td) fila['rushes-touchdowns'] += 1;
          }
          break;

        case 'receiver':
          // Si lo capturaron no hubo recepción, aunque alguien esté marcado
          // como receptor pretendido.
          if (cuentaIndividual && tipo === 'pass' && !capturada && !interceptado) {
            fila['receptions-total'] += 1;
            fila['receptions-yards'] += suyas;
            if (td) fila['receptions-touchdowns'] += 1;
          }
          break;

        // Solo y asistido suman los dos al total de taqueos, que es como la
        // NCAA reporta "total tackles". Se guardan con papel distinto en la
        // tabla, así que separarlos después es una consulta, no una migración.
        case 'tackler':
        case 'assist':
          fila['tackles-total'] += 1;
          break;

        case 'sack':
          // Regla 1, segunda mitad: la captura se parte entre quienes la
          // hicieron; con dos taqueadores es media para cada uno. El manual
          // dice que la yarda impar la decide el estadístico oficial, y aquí el
          // número se parte parejo — quien quiera el reparto exacto lo tiene en
          // las filas, que es donde el dato crudo sigue vivo.
          fila['sacks-total'] += 1 / sacks.length;
          break;

        case 'interceptor':
          fila['interceptions-total'] += 1;
          break;

        case 'kicker':
          if (tipo === 'field_goal' && puntos > 0) fila['field-goals-made'] += 1;
          if (tipo === 'extra_point' && puntos > 0) fila['extra-points-made'] += 1;
          break;

        default:
          break;
      }

      if (!conExtras) continue;
      if (p.role === 'fumbler') fila['fumbles-total'] += 1;
      if (p.role === 'recoverer') fila['fumbles-recovered'] += 1;
      if (p.role === 'punter' && tipo === 'punt') fila['punts-total'] += 1;
      if (p.role === 'returner') {
        fila['returns-total'] += 1;
        fila['returns-yards'] += suyas;
      }
    }
  }

  // Las medias capturas se quedan con un decimal: 1.5 capturas es un número
  // real, y la columna entera de `player_match_stats` no lo sabe expresar. Es
  // una de las cosas que solo la captura por jugada puede decir.
  for (const fila of jugadores.values()) {
    fila['sacks-total'] = Math.round(fila['sacks-total'] * 10) / 10;
  }

  return {
    players: [...jugadores.values()],
    points_by_team: Object.fromEntries(puntosPorEquipo),
  };
}

// ── La otra rama de la cascada ────────────────────────────────────────────
//
// Los dieciséis contadores de `player_match_stats`, traducidos a los mismos
// nombres. No se suma nada: se renombra, que es todo lo que esa tabla necesita
// para que la pantalla lea igual las dos ramas.
//
// Los extras van en `null` y no en cero, y esa es toda la diferencia que
// importa: un cero diría "no hubo balones sueltos" cuando lo cierto es "esta
// captura no los registra".
export function boxScoreDeTotales(filas) {
  return (filas || []).map((fila) => {
    const salida = { player_id: fila.player_id };
    for (const [columna, nombre] of Object.entries(EQUIVALENCIAS_SPORTSML)) {
      salida[nombre] = Number(fila[columna]) || 0;
    }
    for (const nombre of EXTRAS) salida[nombre] = null;
    return salida;
  });
}

// ── Quién gana en la cascada ──────────────────────────────────────────────
//
// Un partido tiene UN box score, no dos. La pregunta se contesta al leer y las
// dos ramas nunca se mezclan ni se suman entre sí: "¿hay una sesión buena con
// un nivel que derive?" → las jugadas; si no → los totales tecleados a mano.
//
// `scoring` es el caso que obliga a preguntar por el NIVEL y no solo por "¿hay
// jugadas?": un partido con ocho jugadas de anotación sí tiene jugadas, y
// derivar de ahí daría un box score falso con cara de verdadero.
export function fuenteDelBoxScore(sesiones) {
  const buena = (sesiones || []).find((s) => s.is_authoritative && derivaBoxScore(s.capture_level));
  if (buena) return { source: 'plays', session_id: buena.id, capture_level: buena.capture_level };

  // Se dice qué nivel hay aunque no derive, porque la pantalla tiene que poder
  // explicar por qué el box score viene de los totales habiendo jugadas.
  const autoritativa = (sesiones || []).find((s) => s.is_authoritative);
  return {
    source: 'totals',
    session_id: autoritativa?.id ?? null,
    capture_level: autoritativa?.capture_level ?? null,
  };
}
