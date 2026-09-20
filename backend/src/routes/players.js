import express from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { teamViewRequired, matchScoreRequired, branchTeamOwnerRequired, branchTeamPhotoRequired } from '../middleware/ownership.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isNonEmptyString } from '../utils/validation.js';
import { MATCH_GRADABLE_SQL, PREDICTION_CORRECT_SQL } from '../utils/scoring.js';
// Las fechas del roster son las de México, no las de UTC. Es el mismo desfase
// que ya se había cerrado en los dos libros de cobranza y que aquí seguía
// vivo: con Neon en UTC, una baja registrada después de las 18:00 hora de
// México quedaba fechada al día siguiente. No es dinero, pero sí es la
// trayectoria del jugador — y el día que se corta mal es el mismo.
import { HOY_MX } from '../utils/sqlDates.js';
import { visibilidadDeRoster, fotoSePublicaSql } from '../utils/rosterVisibility.js';

const router = express.Router();

// Mismo patrón que routes/manage.js y routes/upload.js: cada archivo define su
// propio multer en memoria (no hay una config compartida en el proyecto).
const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls)$/.test(file.originalname.toLowerCase());
    if (ok) cb(null, true);
    else cb(new Error('Solo se permiten archivos .xlsx o .xls'));
  },
});

// Columnas de la plantilla de roster, en orden. `keys` son los alias que se
// aceptan al leer el Excel de vuelta (sin distinguir mayúsculas/acentos vía
// normalización más abajo).
const ROSTER_COLUMNS = [
  { header: 'Nombre',                         width: 20, keys: ['nombre', 'first name', 'first_name'] },
  { header: 'Apellido',                       width: 20, keys: ['apellido', 'apellidos', 'last name', 'last_name'] },
  { header: 'Fecha de nacimiento (DD/MM/AAAA)', width: 26, keys: ['fecha de nacimiento', 'fecha de nacimiento (dd/mm/aaaa)', 'fecha nacimiento', 'nacimiento', 'birth date', 'birth_date'] },
  { header: 'Posición',                       width: 14, keys: ['posicion', 'posición', 'position', 'pos'] },
  { header: 'Número',                         width: 10, keys: ['numero', 'número', 'num', 'jersey', 'dorsal', 'jersey_number'] },
  { header: 'CURP',                           width: 22, keys: ['curp', 'identificacion', 'identificación', 'id'] },
  { header: 'Foto (URL)',                     width: 40, keys: ['foto (url)', 'foto', 'foto url', 'photo', 'photo_url', 'url foto'] },
];

// "áéíóú" -> "aeiou", minúsculas, sin espacios de sobra. Para comparar
// encabezados/valores del Excel de forma tolerante.
function norm(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Parsea la fecha de nacimiento de una celda: puede venir como Date (si Excel
// la guardó como fecha) o como texto DD/MM/AAAA o AAAA-MM-DD. Devuelve
// 'YYYY-MM-DD' o null si no se pudo.
function parseBirthDate(value) {
  if (value instanceof Date && !isNaN(value)) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  let m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(raw);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(raw);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

// Baja una imagen (logo) por URL y devuelve { buffer, extension } para
// ExcelJS, o null si falla o no hay URL. Nunca lanza.
async function fetchImageForXlsx(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    const extension = /png/i.test(type) ? 'png' : /jpe?g/i.test(type) || /jpg/i.test(url) ? 'jpeg' : 'png';
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, extension };
  } catch {
    return null;
  }
}

// Ramas donde está inscrito un equipo, con su contexto completo (torneo →
// categoría → rama) y cuántos jugadores lleva en cada una.
//
// Existe porque el roster siempre vivió a nivel rama y la única forma de
// llegar a él era el panel de la LIGA: el representante del equipo tenía
// permiso por API (branchTeamOwnerRequired) pero ninguna pantalla desde donde
// entrar. Esto es lo que le da al club la lista de "tus planteles" en su
// propio panel, sin pasar por la liga.
router.get('/teams/:id/branches', authRequired, teamViewRequired, asyncHandler(async (req, res) => {
  const branches = await db.prepare(`
    SELECT b.id AS branch_id, b.name AS branch_name,
           c.id AS category_id, c.name AS category_name, c.season, c.year,
           tn.id AS tournament_id, tn.name AS tournament_name, tn.year AS tournament_year,
           (
             SELECT COUNT(*)::int
             FROM player_team_memberships ptm
             WHERE ptm.branch_id = b.id AND ptm.team_id = ? AND ptm.end_date IS NULL
           ) AS roster_count
    FROM branch_teams bt
    JOIN branches b   ON b.id = bt.branch_id
    JOIN categories c ON c.id = b.category_id
    LEFT JOIN tournaments tn ON tn.id = c.tournament_id
    WHERE bt.team_id = ?
    ORDER BY tn.year DESC NULLS LAST, tn.name ASC, c.sort_order ASC, b.sort_order ASC
  `).all(req.team.id, req.team.id);

  res.json({ branches });
}));

// Roster de un equipo DENTRO DE UNA RAMA específica — el reemplazo correcto
// de los dos endpoints obsoletos de arriba. branchTeamOwnerRequired ya
// valida que el equipo esté inscrito en la rama antes de llegar aquí.
router.get('/branches/:branchId/teams/:teamId/roster', authRequired, branchTeamOwnerRequired, asyncHandler(async (req, res) => {
  const roster = await db.prepare(`
    SELECT p.id, p.first_name, p.last_name, p.birth_date, p.photo_url, p.curp,
           ptm.id AS membership_id, ptm.jersey_number,
           COALESCE(ptm.position, p.position) AS position, ptm.season, ptm.start_date
    FROM player_team_memberships ptm
    JOIN players p ON p.id = ptm.player_id
    WHERE ptm.team_id = ? AND ptm.branch_id = ? AND ptm.end_date IS NULL
    ORDER BY ptm.jersey_number NULLS LAST, p.last_name
  `).all(req.team.id, req.branch.id);

  // En qué estado está la publicación de ESTE roster: los dos interruptores de
  // la categoría, el veto del equipo y la conclusión ya resuelta. Viaja con el
  // roster y no en un endpoint aparte porque es la misma pantalla la que lo
  // pinta, y pedirlo dos veces era pedirle dos cosas al mismo botón.
  const inscripcion = await db.prepare(
    'SELECT show_photos FROM branch_teams WHERE branch_id = ? AND team_id = ?'
  ).get(req.branch.id, req.team.id);

  res.json({ roster, visibility: visibilidadDeRoster(req.category, inscripcion) });
}));

// El veto del equipo sobre las caras de sus jugadores. Tres estados, no dos:
//
//   null   sigue a la categoría (como nace)
//   false  este equipo NO publica fotos, aunque su categoría las permita
//   true   este equipo las publica SI su categoría las permite — nunca por su
//          cuenta: encender aquí no enciende nada si el techo está abajo
//
// Por eso el cuerpo acepta `null` explícito y no solo un booleano: volver a
// "sigue a la categoría" tiene que ser posible, y no es lo mismo que apagar.
router.put('/branches/:branchId/teams/:teamId/photos', authRequired, branchTeamPhotoRequired, asyncHandler(async (req, res) => {
  const { show_photos } = req.body;
  if (show_photos !== null && typeof show_photos !== 'boolean') {
    return res.status(400).json({ error: 'show_photos tiene que ser true, false o null' });
  }

  await db.prepare('UPDATE branch_teams SET show_photos = ? WHERE branch_id = ? AND team_id = ?')
    .run(show_photos, req.branch.id, req.team.id);

  res.json({ visibility: visibilidadDeRoster(req.category, { show_photos }) });
}));

// Agrega un jugador nuevo y lo da de alta en el roster de este equipo, en
// ESTA rama específica — branch_id ya no se pregunta, se toma del contexto
// (la URL), tal como se decidió: "se sobreentiende que se subió en esa
// rama de esa categoría".
router.post('/branches/:branchId/teams/:teamId/roster', authRequired, branchTeamOwnerRequired, asyncHandler(async (req, res) => {
  const { first_name, last_name, birth_date, position, jersey_number, photo_url, curp, season } = req.body;

  if (!isNonEmptyString(first_name) || !isNonEmptyString(last_name)) {
    return res.status(400).json({ error: 'Nombre y apellido son obligatorios' });
  }

  const player = await db.prepare(`
    INSERT INTO players (first_name, last_name, birth_date, position, jersey_number, photo_url, curp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(first_name.trim(), last_name.trim(), birth_date || null, position || null, jersey_number || null, photo_url || null, curp ? String(curp).trim().toUpperCase() : null);

  // tournament_id se toma del contexto (rama -> categoría -> torneo): el
  // roster "vive dentro de un torneo", así que se guarda explícito además
  // del branch_id.
  const membership = await db.prepare(`
    INSERT INTO player_team_memberships (player_id, team_id, branch_id, tournament_id, season, jersey_number, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(player.id, req.team.id, req.branch.id, req.category.tournament_id || null, season || null, jersey_number || null, position || null);

  res.status(201).json({ player, membership });
}));

// Mueve a un jugador YA EXISTENTE (dado de alta antes, en otra rama u otro
// equipo) al roster de este equipo, en esta rama. Cierra su membresía
// activa anterior (donde sea que estuviera) y abre una nueva aquí — mismo
// patrón de historial que el traspaso de abajo.
router.post('/branches/:branchId/teams/:teamId/roster/:playerId/move', authRequired, branchTeamOwnerRequired, asyncHandler(async (req, res) => {
  const playerId = Number(req.params.playerId);
  const { season, jersey_number, position } = req.body;

  const player = await db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });

  await db.prepare(`
    UPDATE player_team_memberships
    SET end_date = ${HOY_MX}, status = 'ended'
    WHERE player_id = ? AND end_date IS NULL
  `).run(playerId);

  const membership = await db.prepare(`
    INSERT INTO player_team_memberships (player_id, team_id, branch_id, tournament_id, season, jersey_number, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(playerId, req.team.id, req.branch.id, req.category.tournament_id || null, season || null, jersey_number || null, position || null);

  res.status(201).json({ player, membership });
}));

// ─────────────────────────────────────────────────────────────────────────────
// ROSTER POR PLANTILLA DE EXCEL
//
// Flujo real de la liga: se le manda al equipo un Excel con el membrete de la
// liga (logo de liga, logo de equipo, y de qué torneo/categoría/rama es el
// roster); el equipo lo regresa lleno y la liga (o el dirigente del equipo, si
// ya lo administra) lo vuelve a subir aquí mismo. El alta uno-por-uno de arriba
// sigue existiendo para los equipos que prefieren capturarlos a mano.
// ─────────────────────────────────────────────────────────────────────────────

// Descarga la plantilla .xlsx ya personalizada para este equipo en esta rama.
router.get('/branches/:branchId/teams/:teamId/roster/template', authRequired, branchTeamOwnerRequired, asyncHandler(async (req, res) => {
  const tournament = req.category.tournament_id
    ? await db.prepare('SELECT name, logo_url FROM tournaments WHERE id = ?').get(req.category.tournament_id)
    : null;

  const [leagueImg, teamImg] = await Promise.all([
    fetchImageForXlsx(req.league.logo_url),
    fetchImageForXlsx(req.team.logo_url),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'CFBAMX';
  const ws = wb.addWorksheet('Roster');

  // Membrete: logos en la esquina + datos de contexto. La tabla llenable
  // arranca en la fila HEADER_ROW.
  const HEADER_ROW = 9;

  ROSTER_COLUMNS.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  if (leagueImg) {
    const id = wb.addImage(leagueImg);
    ws.addImage(id, { tl: { col: 0.1, row: 0.1 }, ext: { width: 90, height: 90 } });
  }
  if (teamImg) {
    const id = wb.addImage(teamImg);
    ws.addImage(id, { tl: { col: 1.1, row: 0.1 }, ext: { width: 90, height: 90 } });
  }

  const infoRows = [
    ['Liga', req.league.name],
    ['Torneo', tournament?.name || '—'],
    ['Categoría', req.category.name],
    ['Rama', req.branch.name],
    ['Equipo', req.team.name],
  ];
  infoRows.forEach(([label, value], i) => {
    const r = ws.getRow(i + 2);
    const labelCell = r.getCell(3);
    const valueCell = r.getCell(4);
    labelCell.value = label;
    labelCell.font = { bold: true, color: { argb: 'FF666666' } };
    valueCell.value = value;
    valueCell.font = { bold: true };
  });

  ws.getRow(HEADER_ROW - 1).getCell(1).value = 'Llena una fila por jugador. Nombre y Apellido son obligatorios.';
  ws.getRow(HEADER_ROW - 1).getCell(1).font = { italic: true, color: { argb: 'FF888888' } };

  const headerRow = ws.getRow(HEADER_ROW);
  ROSTER_COLUMNS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3A8D3F' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const exampleRow = ws.getRow(HEADER_ROW + 1);
  ['Juan', 'Pérez', '15/03/2001', 'QB', 12, '', ''].forEach((v, i) => {
    const cell = exampleRow.getCell(i + 1);
    cell.value = v;
    cell.font = { color: { argb: 'FFAAAAAA' }, italic: true };
  });

  // Solo ASCII en el nombre de archivo, para no romper el header Content-Disposition.
  const safe = (s) => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'roster';
  const filename = `roster_${safe(req.team.name)}_${safe(req.branch.name)}.xlsx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}));

// Sube la plantilla llena. Solo agrega los jugadores que NO estén ya en el
// roster activo de esta rama (compara por CURP si viene, si no por
// nombre+apellido). Nunca borra a nadie.
router.post('/branches/:branchId/teams/:teamId/roster/import', authRequired, branchTeamOwnerRequired, xlsxUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  // Fila real de Excel (1-based) para un índice del grid: sheet_to_json empieza
  // a contar desde la primera fila con contenido, no siempre desde la 1.
  const sheetStartRow = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']).s.r : 0;
  const excelRow = (i) => sheetStartRow + i + 1;

  // Localiza la fila de encabezados (la que trae "nombre" y "apellido"), para
  // saltarnos el membrete de arriba.
  const headerIdx = grid.findIndex((row) =>
    Array.isArray(row) &&
    row.some((c) => norm(c) === 'nombre') &&
    row.some((c) => norm(c) === 'apellido')
  );
  if (headerIdx === -1) {
    return res.status(400).json({ error: 'No se encontró la fila de encabezados (Nombre, Apellido, …). ¿Es la plantilla de roster?' });
  }

  const headerCells = grid[headerIdx].map(norm);
  // Índice de cada columna conocida dentro del Excel (según sus alias).
  const colIndex = {};
  ROSTER_COLUMNS.forEach((col) => {
    const idx = headerCells.findIndex((h) => col.keys.some((k) => norm(k) === h));
    colIndex[col.header] = idx;
  });

  const cell = (row, header) => {
    const idx = colIndex[header];
    if (idx === undefined || idx < 0) return '';
    return row[idx] ?? '';
  };

  // Roster activo actual, para deduplicar.
  const current = await db.prepare(`
    SELECT p.first_name, p.last_name, p.curp
    FROM player_team_memberships ptm
    JOIN players p ON p.id = ptm.player_id
    WHERE ptm.team_id = ? AND ptm.branch_id = ? AND ptm.end_date IS NULL
  `).all(req.team.id, req.branch.id);

  const nameKey = (f, l) => `${norm(f)}|${norm(l)}`;
  const existingCurps = new Set(current.filter((p) => p.curp).map((p) => norm(p.curp)));
  const existingNames = new Set(current.map((p) => nameKey(p.first_name, p.last_name)));

  const imported = [];
  const skipped = [];
  const warnings = [];
  const seenNumbers = new Set();

  for (let i = headerIdx + 1; i < grid.length; i++) {
    const row = grid[i];
    const rowN = excelRow(i);
    if (!Array.isArray(row) || row.every((c) => String(c ?? '').trim() === '')) continue;

    const firstName = String(cell(row, 'Nombre')).trim();
    const lastName = String(cell(row, 'Apellido')).trim();

    // Ignora la fila de ejemplo de la plantilla si quedó sin editar (coincide
    // exacta con el ejemplo que genera la plantilla).
    if (norm(firstName) === 'juan' && norm(lastName) === 'perez'
      && norm(cell(row, 'Posición')) === 'qb'
      && String(cell(row, 'Número')).trim() === '12') {
      continue;
    }

    if (!firstName || !lastName) {
      skipped.push({ row: rowN, reason: 'Faltan nombre o apellido' });
      continue;
    }

    const curpRaw = String(cell(row, 'CURP')).trim().toUpperCase();
    const curp = curpRaw || null;

    if (curp && existingCurps.has(norm(curp))) {
      warnings.push({ row: rowN, reason: `"${firstName} ${lastName}" (CURP ${curp}) ya está en el roster de esta rama — se omitió` });
      continue;
    }
    if (!curp && existingNames.has(nameKey(firstName, lastName))) {
      warnings.push({ row: rowN, reason: `"${firstName} ${lastName}" ya está en el roster de esta rama — se omitió` });
      continue;
    }

    const birthDate = parseBirthDate(cell(row, 'Fecha de nacimiento (DD/MM/AAAA)'));
    if (!birthDate && String(cell(row, 'Fecha de nacimiento (DD/MM/AAAA)')).trim()) {
      warnings.push({ row: rowN, reason: `La fecha de nacimiento de "${firstName} ${lastName}" no se entendió (usa DD/MM/AAAA) — se importó sin fecha` });
    }

    const position = String(cell(row, 'Posición')).trim() || null;
    const numRaw = String(cell(row, 'Número')).trim();
    const jerseyNumber = numRaw && Number.isFinite(Number(numRaw)) ? Math.trunc(Number(numRaw)) : null;
    const photoUrl = String(cell(row, 'Foto (URL)')).trim() || null;

    if (jerseyNumber != null) {
      if (seenNumbers.has(jerseyNumber)) {
        warnings.push({ row: rowN, reason: `El número ${jerseyNumber} está repetido en la plantilla` });
      }
      seenNumbers.add(jerseyNumber);
    }

    const player = await db.prepare(`
      INSERT INTO players (first_name, last_name, birth_date, position, jersey_number, photo_url, curp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `).get(firstName, lastName, birthDate, position, jerseyNumber, photoUrl, curp);

    await db.prepare(`
      INSERT INTO player_team_memberships (player_id, team_id, branch_id, tournament_id, jersey_number, position)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(player.id, req.team.id, req.branch.id, req.category.tournament_id || null, jerseyNumber, position);

    imported.push(player.id);
    if (curp) existingCurps.add(norm(curp));
    existingNames.add(nameKey(firstName, lastName));
  }

  res.status(201).json({
    imported: imported.length,
    skipped: skipped.length,
    skippedRows: skipped,
    warnings: warnings.length,
    warningRows: warnings,
  });
}));

// Edita datos sueltos de un jugador del roster (foto, CURP, fecha de
// nacimiento, posición, número). Requiere que el jugador tenga membresía
// activa en este equipo + rama.
router.patch('/branches/:branchId/teams/:teamId/roster/:playerId', authRequired, branchTeamOwnerRequired, asyncHandler(async (req, res) => {
  const playerId = Number(req.params.playerId);
  const membership = await db.prepare(`
    SELECT * FROM player_team_memberships
    WHERE player_id = ? AND team_id = ? AND branch_id = ? AND end_date IS NULL
  `).get(playerId, req.team.id, req.branch.id);
  if (!membership) return res.status(404).json({ error: 'Ese jugador no está en el roster de esta rama' });

  const { photo_url, curp, birth_date, position, jersey_number } = req.body;

  await db.prepare(`
    UPDATE players SET
      photo_url  = COALESCE(?, photo_url),
      curp       = COALESCE(?, curp),
      birth_date = COALESCE(?, birth_date),
      position   = COALESCE(?, position)
    WHERE id = ?
  `).run(
    photo_url === undefined ? null : (photo_url || null),
    curp === undefined ? null : (curp ? String(curp).trim().toUpperCase() : null),
    birth_date === undefined ? null : (birth_date || null),
    position === undefined ? null : (position || null),
    playerId,
  );

  if (jersey_number !== undefined || position !== undefined) {
    await db.prepare(`
      UPDATE player_team_memberships SET
        jersey_number = COALESCE(?, jersey_number),
        position      = COALESCE(?, position)
      WHERE id = ?
    `).run(
      jersey_number === undefined || jersey_number === '' ? null : Number(jersey_number),
      position === undefined ? null : (position || null),
      membership.id,
    );
  }

  const player = await db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  res.json({ player });
}));

// Quita a un jugador del roster de ESTA rama. Dos casos distintos, porque
// confundirlos ensucia el historial del jugador:
//
//   Por default (baja): cierra la membresía (`end_date = HOY_MX`,
//     `status = 'ended'`), igual que hace "mover". El jugador desaparece del
//     roster —todas las consultas filtran `end_date IS NULL`— pero el paso por
//     este equipo queda asentado en su trayectoria (`GET /:id/card`). Esto es
//     lo correcto cuando de verdad jugó aquí y ya no.
//
//   Con `?hard=true` (me equivoqué): borra la fila de la membresía. Es para el
//     alta mal hecha —un nombre repetido, el equipo equivocado— que no debería
//     dejar rastro en la trayectoria de nadie. Además, si al jugador no le
//     queda NINGUNA otra referencia, se borra también su fila en `players`:
//     si no, quedaría un jugador sin ninguna membresía, invisible en la app y
//     sin forma de llegar a él (justo lo que dejó el botón "Roster" viejo del
//     panel de la liga, ver README).
//
// El borrado de la fila del jugador NO es un DELETE directo a propósito: sigue
// habiendo tablas que apuntan a `players(id)` con ON DELETE CASCADE, así que se
// exige que esté limpio en todas. Si tiene aunque sea una estadística de partido
// o una membresía en otra rama, el jugador se queda y la respuesta lo dice
// (`player_deleted: false`).
//
// Ya NO se revisa el padrón ni el libro de cuotas del club: desde la separación
// (`club_members` / `club_ledger_entries`, ver README) el dinero del club no
// cuelga de `players`, así que borrar a alguien del roster de torneo no puede
// tocar la cobranza de ningún club, ni al revés. Esa comprobación existía
// justamente porque las dos poblaciones compartían tabla.
//
// Siempre acotado a este equipo + esta rama: un jugador puede estar dado de alta
// en otra rama por separado, y eso no se toca.
router.delete('/branches/:branchId/teams/:teamId/roster/:playerId', authRequired, branchTeamOwnerRequired, asyncHandler(async (req, res) => {
  const playerId = Number(req.params.playerId);
  const hard = req.query.hard === 'true' || req.query.hard === '1';

  const membership = await db.prepare(`
    SELECT * FROM player_team_memberships
    WHERE player_id = ? AND team_id = ? AND branch_id = ? AND end_date IS NULL
  `).get(playerId, req.team.id, req.branch.id);
  if (!membership) return res.status(404).json({ error: 'Ese jugador no está en el roster de esta rama' });

  if (!hard) {
    await db.prepare(`
      UPDATE player_team_memberships
      SET end_date = ${HOY_MX}, status = 'ended'
      WHERE id = ?
    `).run(membership.id);
    return res.json({ removed: 'membership_closed', player_deleted: false });
  }

  await db.prepare('DELETE FROM player_team_memberships WHERE id = ?').run(membership.id);

  // Las condiciones van en el propio DELETE (no en un SELECT previo) para que
  // Postgres las evalúe en el mismo momento del borrado.
  const { changes } = await db.prepare(`
    DELETE FROM players p
     WHERE p.id = ?
       AND p.user_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM player_team_memberships m WHERE m.player_id = p.id)
       AND NOT EXISTS (SELECT 1 FROM player_match_stats     s WHERE s.player_id = p.id)
  `).run(playerId);

  res.json({ removed: 'membership_deleted', player_deleted: changes > 0 });
}));

const STAT_FIELDS = [
  'pass_completions', 'pass_attempts', 'pass_yards', 'pass_td', 'interceptions_thrown',
  'rush_attempts', 'rush_yards', 'rush_td',
  'receptions', 'receiving_yards', 'receiving_td',
  'tackles', 'sacks', 'interceptions_def',
  'field_goals_made', 'extra_points_made',
];

// Todas las estadísticas capturadas de un partido, para mostrar la tabla
// completa (ambos equipos) de una sola vez.
router.get('/matches/:id/stats', authRequired, matchScoreRequired, asyncHandler(async (req, res) => {
  const stats = await db.prepare(`
    SELECT s.*, p.first_name, p.last_name
    FROM player_match_stats s
    JOIN players p ON p.id = s.player_id
    WHERE s.match_id = ?
    ORDER BY s.team_id, p.last_name
  `).all(req.match.id);
  res.json({ stats });
}));

// Crea o actualiza (upsert) la estadística de UN jugador en UN partido.
// team_id tiene que ser el equipo local o visitante YA CONECTADO a este
// partido (home_team_id / away_team_id) — si el partido todavía no está
// conectado con sus equipos, se pide sincronizar primero (botón "Conectar
// equipos con sus partidos" en el panel de la liga) en vez de dejar
// capturar estadísticas de un equipo sin confirmar que de verdad jugó ahí.
router.put('/matches/:id/stats/:playerId', authRequired, matchScoreRequired, asyncHandler(async (req, res) => {
  const match = req.match;
  const playerId = Number(req.params.playerId);
  const { team_id } = req.body;

  if (!team_id) return res.status(400).json({ error: 'team_id es obligatorio' });
  if (!match.home_team_id && !match.away_team_id) {
    return res.status(400).json({ error: 'Este partido todavía no está conectado con sus equipos. Sincronízalo primero desde el panel de la liga.' });
  }
  if (Number(team_id) !== match.home_team_id && Number(team_id) !== match.away_team_id) {
    return res.status(400).json({ error: 'Ese equipo no es local ni visitante en este partido' });
  }

  const player = await db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });

  // Arma las 16 columnas a partir del body, con 0 por default para las que
  // no vengan — así el formulario del frontend puede mandar solo las que
  // aplican a la posición del jugador (ej. un RB no manda pass_yards).
  const values = STAT_FIELDS.map((f) => Number(req.body[f] || 0));

  const stat = await db.prepare(`
    INSERT INTO player_match_stats (player_id, match_id, team_id, ${STAT_FIELDS.join(', ')})
    VALUES (?, ?, ?, ${STAT_FIELDS.map(() => '?').join(', ')})
    ON CONFLICT (player_id, match_id) DO UPDATE SET
      team_id = EXCLUDED.team_id,
      ${STAT_FIELDS.map((f) => `${f} = EXCLUDED.${f}`).join(', ')}
    RETURNING *
  `).get(playerId, match.id, team_id, ...values);

  res.json({ stat });
}));

// Tarjeta del jugador: identidad + trayectoria + estadísticas acumuladas +
// (si el jugador ya reclamó su perfil, es decir tiene user_id) sus stats de
// predicciones y participación en quinielas. Público, sin authRequired —
// una tarjeta de jugador debe poder verse igual que cualquier partido o
// liga hoy, no solo por quien administra su equipo.
router.get('/:id/card', asyncHandler(async (req, res) => {
  const playerId = Number(req.params.id);

  // Solo los campos que la tarjeta pinta, nunca `SELECT *`: en `players` también
  // viven `curp` y `birth_date`, que no tienen por qué salir en una página
  // pública. `user_id` se lee pero NO se responde — sirve nada más para saber si
  // esta persona ya reclamó su perfil.
  const row = await db.prepare(`
    SELECT id, first_name, last_name, position, jersey_number, photo_url, user_id
    FROM players WHERE id = ?
  `).get(playerId);
  if (!row) return res.status(404).json({ error: 'Jugador no encontrado' });

  const trajectory = await db.prepare(`
    SELECT ptm.id AS membership_id, ptm.season, ptm.position, ptm.jersey_number,
           ptm.start_date, ptm.end_date,
           t.id AS team_id, t.name AS team_name, t.logo_url AS team_logo_url
    FROM player_team_memberships ptm
    JOIN teams t ON t.id = ptm.team_id
    WHERE ptm.player_id = ?
    ORDER BY ptm.start_date DESC
  `).all(playerId);

  // Una tarjeta pública existe SOLO para quien ha estado en el roster de algún
  // torneo. Sin este corte, cualquier fila de `players` era consultable
  // adivinando el id — incluidos los clientes del padrón de un club, que se
  // capturan para cobrarles y no para publicarlos, y que en buena parte son
  // menores de edad. Se responde 404 y no 403 a propósito: desde afuera no se
  // debe poder distinguir "existe pero no te lo muestro" de "no existe".
  if (trajectory.length === 0) return res.status(404).json({ error: 'Jugador no encontrado' });

  // ── ¿Sale la foto? ──
  //
  // La cara es el dato más expuesto de los cuatro por mucho —el nombre y el
  // número identifican a alguien dentro de una cancha, una cara lo identifica
  // en la calle— y no se queda en esta página: el frontend la mete en una
  // imagen para compartir en redes (utils/playerShareCard.js). Así que la
  // decisión de publicarla se aplica AQUÍ, en la respuesta, y no al pintarla:
  // lo que el backend no manda no se puede compartir.
  //
  // BOOL_AND y no BOOL_OR: se pide el permiso de TODOS los rosters en los que
  // este jugador está hoy. Si juega en dos ramas y una de ellas dijo que no,
  // gana el que dijo que no — un veto que se puede saltar entrando por otra
  // rama no es un veto.
  //
  // Sin filas (un jugador que ya no está en ningún roster activo, o cuyas
  // membresías vienen de antes de que existiera `branch_id`) BOOL_AND devuelve
  // NULL, que no es `true`: falla cerrado, como el resto de esta regla.
  const permisoFoto = await db.prepare(`
    SELECT BOOL_AND(${fotoSePublicaSql('c', 'bt')}) AS publica
    FROM player_team_memberships ptm
    JOIN branches b      ON b.id = ptm.branch_id
    JOIN categories c    ON c.id = b.category_id
    JOIN branch_teams bt ON bt.branch_id = ptm.branch_id AND bt.team_id = ptm.team_id
    WHERE ptm.player_id = ? AND ptm.end_date IS NULL
  `).get(playerId);

  // `user_id` se queda fuera de la respuesta, y la foto solo entra si la
  // dejaron entrar.
  const { user_id: claimedByUserId, photo_url: fotoCruda, ...player } = row;
  if (permisoFoto?.publica === true) player.photo_url = fotoCruda;

  const statsRow = await db.prepare(`
    SELECT
      COUNT(*) AS games_played,
      COALESCE(SUM(pass_completions), 0)   AS pass_completions,
      COALESCE(SUM(pass_attempts), 0)      AS pass_attempts,
      COALESCE(SUM(pass_yards), 0)         AS pass_yards,
      COALESCE(SUM(pass_td), 0)            AS pass_td,
      COALESCE(SUM(interceptions_thrown),0)AS interceptions_thrown,
      COALESCE(SUM(rush_attempts), 0)      AS rush_attempts,
      COALESCE(SUM(rush_yards), 0)         AS rush_yards,
      COALESCE(SUM(rush_td), 0)            AS rush_td,
      COALESCE(SUM(receptions), 0)         AS receptions,
      COALESCE(SUM(receiving_yards), 0)    AS receiving_yards,
      COALESCE(SUM(receiving_td), 0)       AS receiving_td,
      COALESCE(SUM(tackles), 0)            AS tackles,
      COALESCE(SUM(sacks), 0)              AS sacks,
      COALESCE(SUM(interceptions_def), 0)  AS interceptions_def,
      COALESCE(SUM(field_goals_made), 0)   AS field_goals_made,
      COALESCE(SUM(extra_points_made), 0)  AS extra_points_made
    FROM player_match_stats
    WHERE player_id = ?
  `).get(playerId);

  // Predicciones y quinielas solo existen si el jugador ya reclamó su
  // perfil (`players.user_id` lleno) — un jugador dado de alta por su equipo,
  // sin cuenta propia todavía, simplemente no tiene esta parte de la
  // tarjeta (queda en null, no en 0 — son cosas distintas: "no aplica" vs
  // "aplica pero en cero").
  let predictions = null;
  let pools = null;
  if (claimedByUserId) {
    const predRow = await db.prepare(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE ${MATCH_GRADABLE_SQL}) AS graded,
        COUNT(*) FILTER (WHERE ${PREDICTION_CORRECT_SQL}) AS correct
      FROM predictions p
      JOIN matches m ON m.id = p.match_id
      JOIN categories c ON c.id = m.category_id
      WHERE p.user_id = ?
    `).get(claimedByUserId);
    const total = Number(predRow.total);
    const graded = Number(predRow.graded);
    const correct = Number(predRow.correct);
    predictions = {
      total, graded, correct,
      pending: total - graded,
      accuracyPct: graded > 0 ? Math.round((correct / graded) * 100) : null,
    };

    const poolRow = await db.prepare('SELECT COUNT(*) AS total FROM pool_members WHERE user_id = ?').get(claimedByUserId);
    pools = { participations: Number(poolRow.total) };
  }

  res.json({
    player,
    trajectory,
    stats: {
      gamesPlayed: Number(statsRow.games_played),
      passCompletions: Number(statsRow.pass_completions),
      passAttempts: Number(statsRow.pass_attempts),
      passYards: Number(statsRow.pass_yards),
      passTd: Number(statsRow.pass_td),
      interceptionsThrown: Number(statsRow.interceptions_thrown),
      rushAttempts: Number(statsRow.rush_attempts),
      rushYards: Number(statsRow.rush_yards),
      rushTd: Number(statsRow.rush_td),
      receptions: Number(statsRow.receptions),
      receivingYards: Number(statsRow.receiving_yards),
      receivingTd: Number(statsRow.receiving_td),
      tackles: Number(statsRow.tackles),
      sacks: Number(statsRow.sacks),
      interceptionsDef: Number(statsRow.interceptions_def),
      fieldGoalsMade: Number(statsRow.field_goals_made),
      extraPointsMade: Number(statsRow.extra_points_made),
    },
    predictions,
    pools,
  });
}));

export default router;
