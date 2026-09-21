// El lado del navegador de las estadísticas por jugada: el vocabulario en
// español y la derivación del down mientras se captura.
//
// **Este archivo es la mitad de una regla que vive en el backend**
// (`backend/src/utils/plays.js`), igual que pasa con `matchScope.js`. Aquí no
// se decide nada: el backend vuelve a derivar el down por su cuenta al leer, y
// el box score se calcula allá. Esto existe por una sola razón — el visor
// captura **sin señal**, y "la pantalla muestra el down derivado y deja
// corregirlo" tiene que funcionar en una cancha sin internet, donde no hay a
// quién preguntarle.
//
// Que estén los dos y no uno es la misma decisión que con las zonas horarias:
// no hay forma de compartir un módulo entre los dos paquetes, así que en vez de
// fingirlo hay una prueba que los CRUZA (`tests/unit/plays.test.mjs`) y falla
// si se separan. Es la regla 6 aplicada a lo único que no se puede centralizar.
//
// Lo que NO está aquí, y no debe estar: la acreditación (que una captura es un
// acarreo y no un pase, que se parte entre dos taqueadores). Eso vive una sola
// vez, en el backend, porque el box score se lee de allá.

export const NIVELES_DE_CAPTURA = ['scoring', 'offense', 'full'];

// Qué es cada nivel, dicho para quien va a elegirlo parado en la cancha. El
// "cuánto cuesta" va en el texto a propósito: el visor tiene que poder decidir
// con lo que ve, no después de leer el README.
export const NIVELES = {
  scoring: {
    nombre: 'Solo anotaciones',
    costo: '~8 capturas · cualquiera',
    produce: 'Quién anotó. No produce box score.',
  },
  offense: {
    nombre: 'Ataque completo',
    costo: '~120 capturas · alguien que sabe de futbol',
    produce: 'Box score de ataque.',
  },
  full: {
    nombre: 'Completo',
    costo: '~120 capturas · dos personas',
    produce: 'Box score completo, con taqueos y capturas.',
  },
};

export const TIPOS_DE_JUGADA = [
  'rush', 'pass', 'kickoff', 'punt', 'field_goal',
  'extra_point', 'two_point', 'penalty', 'kneel', 'spike',
];

// El orden es el de los botones, y es el de la frecuencia real: acarreo y pase
// son el 80% de un partido y van primero. Poner "castigo" o "spike" arriba
// costaría un toque en cada una de las ciento veinte capturas.
export const TIPOS = {
  rush: 'Acarreo',
  pass: 'Pase',
  punt: 'Despeje',
  kickoff: 'Patada de salida',
  field_goal: 'Gol de campo',
  extra_point: 'Punto extra',
  two_point: 'Conversión de 2',
  penalty: 'Castigo',
  kneel: 'Rodilla',
  spike: 'Spike',
};

export const ROLES_DE_PARTICIPANTE = [
  'passer', 'rusher', 'receiver', 'tackler', 'assist', 'sack',
  'interceptor', 'fumbler', 'recoverer', 'kicker', 'punter', 'returner',
];

export const ROLES = {
  passer: 'Pasó',
  rusher: 'Corrió',
  receiver: 'Recibió',
  tackler: 'Taqueó',
  assist: 'Asistió',
  sack: 'Capturó',
  interceptor: 'Interceptó',
  fumbler: 'Soltó el balón',
  recoverer: 'Recuperó',
  kicker: 'Pateó',
  punter: 'Despejó',
  returner: 'Devolvió',
};

// Qué papel pide cada tipo de jugada, en el orden en que la pantalla los
// pregunta. El primero es el de quien lleva el balón — el obligatorio.
export const PAPELES_POR_TIPO = {
  rush: ['rusher'],
  pass: ['passer', 'receiver'],
  kickoff: ['kicker', 'returner'],
  punt: ['punter', 'returner'],
  field_goal: ['kicker'],
  extra_point: ['kicker'],
  two_point: ['rusher'],
  kneel: ['rusher'],
  spike: ['passer'],
  penalty: [],
};

// Los papeles que solo tienen sentido con el nivel `full`: son los que exigen
// una segunda persona buscando en el montón, y por eso el nivel los enciende o
// los apaga en vez de enseñarlos siempre.
export const PAPELES_DE_DEFENSA = ['tackler', 'assist', 'sack', 'interceptor'];

// Qué participante hace válida cada jugada. Es la copia exacta de lo que el
// backend exige; aquí sirve para poder deshabilitar el botón y decir QUÉ falta
// en vez de mandar el lote y que lo rechace tres horas después, cuando vuelva
// la señal y ya nadie se acuerde de esa jugada.
const CON_EL_BALON = {
  rush: ['rusher'],
  pass: ['passer'],
  kickoff: ['kicker'],
  punt: ['punter'],
  field_goal: ['kicker'],
  extra_point: ['kicker'],
  two_point: ['rusher', 'passer'],
  kneel: ['rusher'],
  spike: ['passer'],
  penalty: [],
};

// Qué le falta a esta jugada para poder guardarse, en una frase. `null` es
// "ya se puede".
export function faltaParaGuardar(borrador) {
  if (!borrador?.play_type) return 'Escoge qué pasó en la jugada';
  const obligatorios = CON_EL_BALON[borrador.play_type] || [];
  if (obligatorios.length && !(borrador.participants || []).some((p) => obligatorios.includes(p.role))) {
    return `Falta quién llevó el balón (${obligatorios.map((r) => ROLES[r].toLowerCase()).join(' o ')})`;
  }
  // Cero es un valor y por eso se pregunta por `null`, no por falsy: un pase
  // incompleto ganó cero yardas y eso es un dato, no un hueco.
  if (borrador.yards_gained === null || borrador.yards_gained === undefined || borrador.yards_gained === '') {
    return 'Faltan las yardas (cero también cuenta)';
  }
  if (borrador.points > 0 && !borrador.scoring_team_id) return 'Falta decir qué equipo anotó';
  return null;
}

// ── El down se deriva ─────────────────────────────────────────────────────
//
// Copia de `derivarDowns` del backend. `yard_line` son las yardas que faltan
// para la zona de anotación rival (0–100), no la numeración pintada en el
// campo: así "1 y gol" sale solo.
//
// Si esto se separa de su gemela, la prueba de cruce lo dice.
export function derivarDowns(jugadasDeLaSerie) {
  const jugadas = Array.isArray(jugadasDeLaSerie) ? jugadasDeLaSerie : [];

  let yardLine = null;
  let down = null;
  let distance = null;
  let rota = false;

  return jugadas.map((jugada) => {
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

    const sinDown = jugada.play_type === 'kickoff'
      || jugada.play_type === 'extra_point'
      || jugada.play_type === 'two_point';

    const fila = {
      client_play_id: jugada.client_play_id,
      down: sinDown ? null : down,
      distance: sinDown ? null : distance,
      yard_line: yardLine,
      derivado: !corregida && !sinDown && down != null,
      cadena_rota: rota && !sinDown,
    };

    if (yardLine != null) yardLine = Math.max(0, Math.min(100, yardLine - jugada.yards_gained));

    if (sinDown) return fila;

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

// **Dónde va a estar la siguiente jugada.** Es lo que la pantalla enseña arriba
// mientras se captura, y sale de derivar la serie completa y quedarse con el
// estado DESPUÉS de la última. Se calcula con una jugada de mentira al final:
// derivar ya sabe avanzar el estado, así que no hace falta repetir la
// aritmética — y repetirla sería la forma más segura de que las dos versiones
// se separaran.
export function siguienteDown(jugadasDeLaSerie) {
  const sonda = { client_play_id: '__sonda__', sequence: Number.MAX_SAFE_INTEGER, play_type: 'rush', yards_gained: 0, down: null, distance: null, yard_line: null };
  const filas = derivarDowns([...(jugadasDeLaSerie || [])].sort((a, b) => a.sequence - b.sequence).concat(sonda));
  return filas[filas.length - 1];
}

// Cómo se lee "2 y 6" — y cómo se lee cuando no se puede saber.
//
// **No saber el down todavía y haberlo perdido son cosas distintas**, y se
// dicen distinto. Una serie recién abierta no sabe nada porque nadie ha
// capturado nada, y eso es normal: decirle "algo no se capturó" al visor que
// acaba de abrir la pantalla es una falsa alarma en el peor momento. Perder la
// cadena a media serie sí es un aviso, y pide que alguien corrija.
export function textoDeDown({ down, distance, yard_line: yardLine, cadena_rota: rota } = {}) {
  if (rota) return 'Down desconocido — algo no se capturó';
  if (down == null) return 'Empieza la serie';
  const cuantos = ['', '1º', '2º', '3º', '4º'][down] || `${down}º`;
  // "1 y gol": cuando lo que falta por ganar es llegar a la zona, no diez.
  if (yardLine != null && distance != null && distance >= yardLine) return `${cuantos} y gol`;
  return distance != null ? `${cuantos} y ${distance}` : cuantos;
}

// La llave de una jugada nace AQUÍ, en el celular, y no del lado del servidor:
// se captura sin señal y `sequence` la asigna el dispositivo, así que dos
// teléfonos empiezan los dos en 1 y `sequence` no identifica nada.
export function nuevaLlaveDeJugada() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Respaldo para un navegador viejo o un contexto sin `crypto`: lo único que
  // se necesita es que no se repita en este teléfono.
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
