// Diagnóstico: ¿alguien intentó registrar su liga y no pudo?
//
// Contexto: `POST /leagues` tenía 19 placeholders para 18 columnas, así que
// Postgres rechazaba el INSERT completo y la persona solo veía "Error interno
// del servidor" (ver README, "Cambios recientes"). Ya está corregido.
//
// La liga fallida NO dejó rastro en la tabla `leagues` — el INSERT nunca entró.
//
// OJO CON LO QUE ESTE SCRIPT *NO* PRUEBA. La primera versión listaba a los
// usuarios sin ninguna organización como si fueran sospechosos de haber
// fallado. Eso está mal para esta app: aquí la mayoría de las cuentas son de
// aficionados que se registran para ver un calendario o jugar la quiniela, y no
// tienen por qué administrar nada. "Cuenta sin organización" es lo normal, no
// una anomalía — presentarlo como hallazgo solo genera una lista larga de gente
// a la que no hay nada que preguntarle.
//
// DÓNDE SÍ ESTÁ LA RESPUESTA: en **Sentry**. El bug producía un 500 en
// `POST /leagues`, y el backend reporta a Sentry desde `instrument.js`. Ahí
// aparece el error real, con su fecha y su frecuencia, que es lo que de verdad
// dice cuántos intentos fallaron y cuándo. Búscalo por la ruta `/leagues`.
//
// Lo que este script sí sirve para ver, y por eso se conserva: el panorama
// (cuántas ligas y equipos existen, quién los administra) y las ligas creadas
// con su fecha, para cruzarlas contra la ventana en la que el bug estuvo vivo.
//
// ES DE SOLO LECTURA: únicamente SELECT, ningún INSERT/UPDATE/DELETE y sin
// correr migraciones (por eso usa `pg` directo y no `config/db.js`). Se puede
// correr contra producción sin riesgo.
//
// Uso, desde la carpeta `backend/`:
//   node scripts/diagnose-failed-leagues.mjs
//
// Toma DATABASE_URL de tu `.env`. Para apuntarlo a producción sin cambiar el
// `.env`, pásalo en la misma línea:
//   DATABASE_URL="postgresql://…" node scripts/diagnose-failed-leagues.mjs

import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL (revisa tu .env o pásala en la línea del comando).');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');

function table(rows, cols) {
  if (!rows.length) return '  (ninguno)';
  const widths = cols.map((c) =>
    Math.max(c.label.length, ...rows.map((r) => String(c.get(r) ?? '').length))
  );
  const line = (cells) => '  ' + cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
  return [
    line(cols.map((c) => c.label)),
    line(widths.map((w) => '-'.repeat(w))),
    ...rows.map((r) => line(cols.map((c) => c.get(r)))),
  ].join('\n');
}

try {
  // 1. Panorama general.
  const { rows: [totals] } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM users)                                   AS usuarios,
      (SELECT COUNT(*) FROM leagues)                                 AS ligas,
      (SELECT COUNT(*) FROM teams)                                   AS equipos,
      (SELECT COUNT(DISTINCT user_id) FROM organization_members
        WHERE status = 'active')                                     AS usuarios_con_organizacion
  `);

  console.log('\n=== Panorama ===\n');
  console.log(`  Usuarios registrados:            ${totals.usuarios}`);
  console.log(`  Usuarios con alguna organización: ${totals.usuarios_con_organizacion}`);
  console.log(`  Ligas existentes:                ${totals.ligas}`);
  console.log(`  Equipos existentes:              ${totals.equipos}`);

  console.log('');
  console.log('  Que la mayoría de las cuentas no administre ninguna organización es lo');
  console.log('  ESPERADO: son aficionados que entraron por el calendario o la quiniela.');
  console.log('  No es señal de que algo haya fallado, y por eso este script ya no los');
  console.log('  lista. Para saber cuántos intentos de registrar una liga tronaron de');
  console.log('  verdad, busca el 500 de POST /leagues en Sentry — ahí está la fecha y');
  console.log('  la frecuencia reales.');

  // 3. Las ligas que sí se crearon, para ubicar el hueco en el tiempo: si hay
  //    un periodo largo sin ligas nuevas y con cuentas nuevas en la lista de
  //    arriba, ahí estaba pegando el bug.
  const { rows: ligas } = await pool.query(`
    SELECT l.id, l.name, l.status, l.created_at, u.email AS dueno
      FROM leagues l
      LEFT JOIN users u ON u.id = l.owner_user_id
     ORDER BY l.created_at DESC
     LIMIT 50
  `);

  console.log('\n\n=== Ligas creadas (más recientes primero) ===');
  console.log('Compara estas fechas contra la lista de arriba para ubicar el hueco.\n');
  console.log(table(ligas, [
    { label: 'ID',     get: (r) => r.id },
    { label: 'Liga',   get: (r) => r.name },
    { label: 'Estado', get: (r) => r.status },
    { label: 'Dueño',  get: (r) => r.dueno || '(sin dueño)' },
    { label: 'Creada', get: (r) => fmt(r.created_at) },
  ]));
  console.log('');
} catch (err) {
  console.error('\nFalló la consulta:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
