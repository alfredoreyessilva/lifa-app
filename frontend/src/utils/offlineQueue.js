// La cola de lo capturado sin señal: qué se guarda, cómo se juntan dos
// capturas de lo mismo y cuándo se reintenta. El porqué está en el README,
// "Capturar sin señal" (decidido el 2026-09-20).
//
// Vive aparte de `offlineDb.js` —que es quien habla con IndexedDB— por la misma
// razón que `orgRoles.js` en el backend: aquí está la regla que decide si un
// pase de lista capturado en la cancha se pierde o no, y eso tiene que poder
// probarse sin navegador. `offlineDb.js` no se puede probar en el CI; esto sí.
//
// Todo lo de aquí es PURO: recibe listas y devuelve listas. No toca IndexedDB,
// no toca la red y no mira el reloj por su cuenta (el `ahora` se pasa).

// Cuántas veces se reintenta antes de dejar de insistir solo. No se descarta
// nunca: lo que pasa de aquí se queda en la cola, visible, para que alguien
// decida. La regla 10 otra vez — la plataforma no tira un dato por su cuenta.
export const MAX_INTENTOS = 8;

// Espera entre reintentos, en segundos: 5s, 15s, 45s… hasta 5 minutos. Empieza
// corto porque el caso común es que la señal vuelva en el estacionamiento, y
// se alarga para no quemar batería en una cancha donde no hay nada.
const ESPERAS = [5, 15, 45, 120, 300];

// Cuánto esperar DESPUÉS de que fallaran `fallos` intentos: con uno fallido,
// 5 segundos; con dos, 15; y así hasta el tope. El índice arranca en 0 porque
// se pregunta después del primer fallo, no antes del primer intento — lo recién
// capturado no espera nada (ver `pendientesListos`).
export function esperaDeIntento(fallos = 1) {
  return ESPERAS[Math.min(Math.max(fallos - 1, 0), ESPERAS.length - 1)] * 1000;
}

// ── La llave: qué cuenta como "lo mismo" ──────────────────────────────────
//
// Un pase de lista es el estado COMPLETO de un equipo en un partido, así que
// dos capturas del mismo par (partido, equipo) no son dos cosas que subir: son
// la misma, y gana la última. Por eso la cola se fusiona en vez de acumular.
//
// Esto es consecuencia directa de que el `PUT` reciba la lista entera. Con un
// endpoint por jugador habría que subir cuarenta llamadas EN ORDEN y aguantar
// que la número 19 falle; así, lo que se sube es el estado final y ya.
export function clavePendiente(pendiente) {
  if (!pendiente || !pendiente.kind) return null;
  if (pendiente.kind === 'attendance') {
    return `attendance:${pendiente.matchId}:${pendiente.teamId}`;
  }
  // Las jugadas de un partido son UN pendiente, y se acumulan dentro de él
  // (ver `unirJugadas`). Una sola llave por partido para que el lote suba
  // entero y de un golpe, que es lo que el endpoint espera.
  if (pendiente.kind === 'plays') {
    return `plays:${pendiente.matchId}`;
  }
  // Corregir y borrar van por jugada: son actos sobre una jugada que YA subió,
  // y dos correcciones de la misma se fusionan —gana la última— mientras que
  // dos correcciones de jugadas distintas no tienen nada que ver entre sí.
  if (pendiente.kind === 'play-edit' || pendiente.kind === 'play-delete') {
    return `${pendiente.kind}:${pendiente.matchId}:${pendiente.clientPlayId}`;
  }
  // Un tipo que este código no conoce no se fusiona con nada: se encola tal
  // cual, con su propia llave. Falla del lado de no perder datos.
  return `${pendiente.kind}:${pendiente.id ?? ''}`;
}

// ── Lo que se fusiona, y lo que se acumula ────────────────────────────────
//
// **Aquí es donde las jugadas NO se parecen al pase de lista, y es la
// diferencia más importante de este archivo.**
//
// Un pase de lista es el estado COMPLETO de un equipo: dos capturas de lo
// mismo son la misma y gana la última. Dos capturas de jugadas **no son la
// misma cosa**: son la jugada 7 y la jugada 8. Reemplazar ahí perdería el
// partido entero salvo la última jugada — y en silencio, que es lo peor.
//
// Así que el pendiente de jugadas se ACUMULA. Se unen por `client_play_id`,
// que es la identidad real, y gana la última versión de cada una: así
// corregir una jugada que todavía no sube es solo volver a capturarla, sin
// tener que saber si ya subió o no.
export function unirJugadas(previas, nuevas) {
  const porLlave = new Map();
  for (const jugada of [...(previas || []), ...(nuevas || [])]) {
    if (jugada?.client_play_id) porLlave.set(jugada.client_play_id, jugada);
  }
  // Ordenadas por captura. El backend no lo necesita —él ordena por `sequence`
  // al leer— pero que el lote viaje en orden hace legible cualquier diagnóstico
  // de "¿qué se quedó sin subir?".
  return [...porLlave.values()].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
}

// Quitar una jugada que todavía no sube es quitarla del lote, no encolar un
// borrado: nunca existió del otro lado. Se usa cuando el visor borra algo que
// capturó hace diez segundos, que es el caso común.
export function quitarJugadaDelLote(pendiente, clientPlayId) {
  if (!pendiente?.plays) return pendiente;
  return { ...pendiente, plays: pendiente.plays.filter((j) => j.client_play_id !== clientPlayId) };
}

const FUSIONES = {
  plays: (previo, nuevo) => ({ ...nuevo, plays: unirJugadas(previo.plays, nuevo.plays) }),
};

// Mete un pendiente en la cola. Si ya había uno de lo mismo, lo REEMPLAZA
// —salvo que su tipo tenga regla de fusión, como las jugadas, que se acumulan—
// y conserva su `id` y el momento en que se capturó por primera vez: lo que se
// sube es el estado final, pero "esto lleva pendiente desde las 10:32" sigue
// siendo cierto y es lo que la pantalla enseña.
//
// Los intentos se reinician a propósito: la captura cambió, así que el motivo
// por el que fallaba la anterior puede ya no aplicar.
export function encolar(cola, pendiente, ahora = Date.now()) {
  const lista = Array.isArray(cola) ? cola : [];
  const clave = clavePendiente(pendiente);
  if (!clave) return lista;

  const previo = lista.find((p) => clavePendiente(p) === clave);
  const fusionar = FUSIONES[pendiente.kind];
  const nuevo = {
    ...(previo && fusionar ? fusionar(previo, pendiente) : pendiente),
    id: previo?.id ?? `${clave}#${ahora}`,
    capturadoEn: previo?.capturadoEn ?? ahora,
    actualizadoEn: ahora,
    intentos: 0,
    ultimoError: null,
  };

  return previo
    ? lista.map((p) => (clavePendiente(p) === clave ? nuevo : p))
    : [...lista, nuevo];
}

export function quitarDeCola(cola, id) {
  return (Array.isArray(cola) ? cola : []).filter((p) => p.id !== id);
}

// Pone un pendiente **tal cual**, sin fusionarlo con el que había. Es lo que
// hace falta para QUITAR algo de un lote que se acumula: con `encolar`, un
// lote al que se le sacó una jugada se volvería a unir con el anterior y la
// jugada regresaría — el borrado no se notaría y no fallaría nada.
//
// Y si el lote se queda vacío, el pendiente desaparece: un lote sin jugadas no
// es algo que subir, y dejarlo en la cola pondría el contador en "0 sin subir"
// con un renglón atorado reintentando la nada.
export function reemplazarPendiente(cola, pendiente, ahora = Date.now()) {
  const lista = Array.isArray(cola) ? cola : [];
  const clave = clavePendiente(pendiente);
  if (!clave) return lista;

  const previo = lista.find((p) => clavePendiente(p) === clave);
  if (pendiente.kind === 'plays' && !(pendiente.plays || []).length) {
    return previo ? lista.filter((p) => clavePendiente(p) !== clave) : lista;
  }

  const nuevo = {
    ...pendiente,
    id: previo?.id ?? `${clave}#${ahora}`,
    capturadoEn: previo?.capturadoEn ?? ahora,
    actualizadoEn: ahora,
    intentos: 0,
    ultimoError: null,
  };
  return previo
    ? lista.map((p) => (clavePendiente(p) === clave ? nuevo : p))
    : [...lista, nuevo];
}

// Un intento que falló. NO se borra: se anota el error y se pospone.
export function marcarFallo(cola, id, mensaje, ahora = Date.now()) {
  return (Array.isArray(cola) ? cola : []).map((p) => (
    p.id === id
      ? { ...p, intentos: (p.intentos || 0) + 1, ultimoError: mensaje || 'No se pudo subir', ultimoIntento: ahora }
      : p
  ));
}

// Qué toca subir ahora: lo que nunca se ha intentado, o lo que ya cumplió su
// espera. Lo que pasó de MAX_INTENTOS deja de reintentarse solo — sigue en la
// cola y la pantalla lo dice, pero ya no se insiste sin que alguien lo pida.
export function pendientesListos(cola, ahora = Date.now()) {
  return (Array.isArray(cola) ? cola : []).filter((p) => {
    const intentos = p.intentos || 0;
    if (intentos >= MAX_INTENTOS) return false;
    if (!p.ultimoIntento) return true;
    // `intentos` ya cuenta el fallo recién anotado, así que esto pregunta
    // "¿pasó la espera que toca después de N fallos?".
    return ahora - p.ultimoIntento >= esperaDeIntento(intentos);
  });
}

// ── Lo que la pantalla enseña ─────────────────────────────────────────────
//
// "Lo que convierte esto en una pérdida no es que el dato viva en el teléfono,
// es que nadie se entere de que todavía vive ahí." Por eso el resumen distingue
// lo que sigue intentándose de lo que ya se rindió: son dos avisos distintos y
// piden dos cosas distintas de la persona.
export function resumenDeCola(cola, ahora = Date.now()) {
  const lista = Array.isArray(cola) ? cola : [];
  const atorados = lista.filter((p) => (p.intentos || 0) >= MAX_INTENTOS);
  return {
    total: lista.length,
    atorados: atorados.length,
    reintentando: lista.length - atorados.length,
    // El más viejo es el que importa para el aviso: dice desde cuándo hay algo
    // que solo vive en este teléfono.
    desde: lista.length ? Math.min(...lista.map((p) => p.capturadoEn || ahora)) : null,
  };
}

// ── El contador de la pantalla de captura ─────────────────────────────────
//
// "47 jugadas sin subir", no "1 captura sin subir". Un pendiente de jugadas
// son ciento veinte cosas, y el número que le importa al visor es cuántas
// JUGADAS viven todavía nada más en este teléfono — que es de lo único que
// depende que se pierdan o no.
//
// Cuenta también las correcciones y los borrados, porque son capturas suyas
// que tampoco han llegado: si la pantalla dijera "0 sin subir" con una
// corrección atorada, estaría diciendo una mentira tranquilizadora.
export function jugadasSinSubir(cola, matchId) {
  const mias = (Array.isArray(cola) ? cola : []).filter((p) => (
    Number(p.matchId) === Number(matchId)
    && (p.kind === 'plays' || p.kind === 'play-edit' || p.kind === 'play-delete')
  ));
  const jugadas = mias.reduce((n, p) => n + (p.kind === 'plays' ? (p.plays?.length || 0) : 1), 0);
  return {
    jugadas,
    atoradas: mias.filter((p) => (p.intentos || 0) >= MAX_INTENTOS).length,
    desde: mias.length ? Math.min(...mias.map((p) => p.capturadoEn || Date.now())) : null,
  };
}

export function textoDeJugadasSinSubir(cola, matchId) {
  const { jugadas, atoradas } = jugadasSinSubir(cola, matchId);
  if (jugadas === 0) return null;
  const texto = `${jugadas} ${jugadas === 1 ? 'jugada sin subir' : 'jugadas sin subir'}`;
  return atoradas > 0 ? `${texto} — no han podido subir` : texto;
}

// El texto del contador, en español y en singular/plural correcto. Va aquí y no
// en el componente porque es lo único de este archivo que alguien va a querer
// cambiar sin tocar la lógica.
export function textoDeCola(cola) {
  const { total, atorados } = resumenDeCola(cola);
  if (total === 0) return null;
  const cosa = total === 1 ? 'captura sin subir' : 'capturas sin subir';
  if (atorados > 0) {
    return `${total} ${cosa} — ${atorados} no ha${atorados === 1 ? '' : 'n'} podido subir`;
  }
  return `${total} ${cosa}`;
}
