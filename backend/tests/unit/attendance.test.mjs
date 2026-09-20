// Pruebas del pase de lista (utils/attendance.js).
//
// Lo que se fija aquí son las cuatro formas en que esto se rompe en silencio, y
// las cuatro terminan igual: la liga castigando a alguien por un dato que la
// plataforma inventó.
//
//   1. "Sin pasar lista" no puede convertirse en "faltó". Son dos cosas
//      distintas y de esa diferencia cuelga todo.
//   2. Un estado que no existe rompe la petición, no se guarda como ausente.
//   3. La lista viene completa: vacía significa "borra todo", no "no hagas
//      nada" — es como se desmarca a alguien.
//   4. El acumulado nunca sale negativo ni se convierte en un porcentaje.
//
// La consulta de SQL no se puede ejecutar aquí (eso es lo que el CI no
// alcanza), así que de ella se fija lo único que sí se puede: que siga pidiendo
// las tres condiciones que la hacen correcta.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ESTADOS_ASISTENCIA,
  esEstadoValido,
  normalizarPaseDeLista,
  resumenDeAsistencia,
  rosterDelPartidoSql,
} from '../../src/utils/attendance.js';

// ── 1 y 2. Los estados que existen, y los que no ──────────────────────────

test('existen exactamente dos estados, y el tercero es la ausencia de fila', () => {
  assert.deepEqual(ESTADOS_ASISTENCIA, ['present', 'absent']);
  assert.ok(!ESTADOS_ASISTENCIA.includes('unmarked'), '"sin pasar lista" NO se guarda');
  assert.ok(!ESTADOS_ASISTENCIA.includes('justified'), 'un justificado es una decisión de la liga, no un hecho');
});

test('los valores son seguros de interpolar en el SQL del CHECK', () => {
  // config/db.js los mete literales dentro de CHECK (status IN (...)).
  for (const estado of ESTADOS_ASISTENCIA) {
    assert.match(estado, /^[a-z_]+$/, `"${estado}" no es un identificador simple`);
  }
});

test('esEstadoValido falla cerrado', () => {
  assert.ok(esEstadoValido('present'));
  assert.ok(esEstadoValido('absent'));
  for (const malo of ['PRESENT', 'presente', '', null, undefined, 0, 1, true, 'unmarked']) {
    assert.ok(!esEstadoValido(malo), `${JSON.stringify(malo)} no debería ser un estado`);
  }
});

test('un estado desconocido ROMPE la petición, no se guarda como ausente', () => {
  const r = normalizarPaseDeLista([{ player_id: 1, status: 'justificado' }]);
  assert.ok(r.error, 'se guardó en vez de rechazarse');
  assert.match(r.error, /justificado/);
});

// ── 3. La lista viene completa ────────────────────────────────────────────

test('una lista vacía es válida: significa "nadie marcado"', () => {
  const r = normalizarPaseDeLista([]);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.playerIds, []);
  assert.deepEqual(r.statuses, []);
});

test('no mandar lista NO es lo mismo que mandarla vacía', () => {
  // Una lista vacía borra; que falte el campo es una petición mal armada, y
  // tratarla como vacía borraría un pase de lista completo por un bug del que
  // llama.
  assert.ok(normalizarPaseDeLista(undefined).error);
  assert.ok(normalizarPaseDeLista(null).error);
  assert.ok(normalizarPaseDeLista('present').error);
  assert.ok(normalizarPaseDeLista({ player_id: 1 }).error);
});

test('el último gana si el mismo jugador viene dos veces', () => {
  // Pasa de verdad con la cola sin señal, que puede reintentar juntando dos
  // capturas de la misma pantalla.
  const r = normalizarPaseDeLista([
    { player_id: 7, status: 'absent' },
    { player_id: 9, status: 'present' },
    { player_id: 7, status: 'present' },
  ]);
  assert.deepEqual(r.playerIds, [7, 9]);
  assert.deepEqual(r.statuses, ['present', 'present']);
});

test('un player_id que no es un id rompe la petición', () => {
  for (const malo of [undefined, null, 0, -3, 1.5, 'siete', {}]) {
    const r = normalizarPaseDeLista([{ player_id: malo, status: 'present' }]);
    assert.ok(r.error, `${JSON.stringify(malo)} pasó como player_id`);
  }
});

test('un player_id numérico en texto sí pasa (viene así de un formulario)', () => {
  const r = normalizarPaseDeLista([{ player_id: '7', status: 'present' }]);
  assert.deepEqual(r.playerIds, [7]);
});

// ── 4. El acumulado ───────────────────────────────────────────────────────

test('las tres cifras van separadas, y sin porcentaje', () => {
  const r = resumenDeAsistencia({ convocables: 10, presentes: 6, ausentes: 2 });
  assert.deepEqual(r, { convocables: 10, presentes: 6, ausentes: 2, sin_marcar: 2 });
  assert.ok(!('porcentaje' in r), 'un porcentaje ya es una interpretación, y esa es de la liga');
});

test('sin_marcar nunca es negativo', () => {
  // Una fila de asistencia sobrevive a que saquen a alguien del roster, así que
  // marcadas > convocables es un estado real, no un imposible.
  const r = resumenDeAsistencia({ convocables: 2, presentes: 3, ausentes: 1 });
  assert.equal(r.sin_marcar, 0);
});

test('un equipo sin partidos todavía no le debe nada a nadie', () => {
  assert.deepEqual(resumenDeAsistencia(), { convocables: 0, presentes: 0, ausentes: 0, sin_marcar: 0 });
  assert.deepEqual(resumenDeAsistencia({ convocables: 4 }), { convocables: 4, presentes: 0, ausentes: 0, sin_marcar: 4 });
});

test('los conteos que llegan como texto de Postgres se suman como números', () => {
  // COUNT(*) vuelve como string en pg. Sumarlos como texto daría "00".
  const r = resumenDeAsistencia({ convocables: '5', presentes: '2', ausentes: '1' });
  assert.equal(r.sin_marcar, 2);
});

// ── La consulta: que no se le caiga una de las tres condiciones ───────────

test('la lista se corta por end_date y NUNCA por start_date', () => {
  const sql = rosterDelPartidoSql();
  assert.match(sql, /ptm\.end_date IS NULL/);
  assert.match(sql, /ptm\.end_date >= partido\.fecha/);
  // start_date solo puede aparecer para DESEMPATAR dos membresías, jamás en el
  // WHERE: es la fecha en que se tecleó la fila, no la que alguien declaró.
  assert.equal(/WHERE[\s\S]*ptm\.start_date\s*[<>=]/.test(sql), false,
    'start_date volvió a filtrar: eso vacía la lista de una liga que capturó tarde');
  assert.match(sql, /ORDER BY ptm\.player_id, \(ptm\.end_date IS NULL\) DESC, ptm\.start_date DESC/);
});

test('quien ya tiene fila de asistencia aparece pase lo que pase', () => {
  assert.match(rosterDelPartidoSql(), /EXISTS \(\s*SELECT 1 FROM match_attendance/);
});

test('la fecha del partido se corta en hora de México', () => {
  assert.match(rosterDelPartidoSql(), /AT TIME ZONE 'America\/Mexico_City'/);
});

test('nadie aparece dos veces', () => {
  assert.match(rosterDelPartidoSql(), /DISTINCT ON \(ptm\.player_id\)/);
});

test('por default no salen ni la foto ni la asistencia', () => {
  // El default es el de la pantalla pública. Si alguna vez se invierte, la
  // asistencia —faltas de gente que en buena parte es menor de edad— se
  // publicaría sin que nadie lo decida.
  const sql = rosterDelPartidoSql();
  assert.equal(/SELECT[\s\S]*pl\.photo_url/.test(sql), false, 'la foto salió sin pedirla');
  assert.equal(sql.includes('a.status'), false, 'la asistencia salió sin pedirla');
  assert.equal(sql.includes('marked_by'), false);
});

test('cada columna sensible sale solo cuando se pide', () => {
  assert.match(rosterDelPartidoSql({ conFoto: true }), /pl\.photo_url/);
  assert.equal(rosterDelPartidoSql({ conFoto: true }).includes('a.status'), false);

  const conLista = rosterDelPartidoSql({ conAsistencia: true });
  assert.match(conLista, /a\.status, a\.marked_at, u\.name AS marked_by/);
  assert.match(conLista, /LEFT JOIN match_attendance a/);
  assert.equal(/SELECT[\s\S]*pl\.photo_url/.test(conLista), false);
});
