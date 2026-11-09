import { SIN_META, TYPE_META, textoDeAviso } from './misNotificaciones.js';
import { formatNumber, pluralize, toNumber } from './adminPanel.js';

// Lo que calcula la sección Notificaciones del Panel Admin: el catálogo de todo lo
// que la app avisa (README, "Notificaciones: todo lo que la app avisa"). El
// catálogo llega armado de GET /admin/notifications (backend,
// utils/catalogoDeAvisos.js); aquí se decide cómo se lee. Funciones puras, para
// probarlas sin navegador.
//
// Los textos de muestra de los avisos calculados NO se escriben aquí: se arman con
// las mismas funciones que la bandeja (utils/misNotificaciones.js), a partir de los
// datos de muestra del catálogo. Así lo que enseña el panel es lo que lee la gente.

// Las celdas del marcador: a quién le llega cada aviso. El de un miembro nuevo le
// llega a la liga o al equipo y cuenta en las dos, así que las celdas suman más que
// "Todos".
export const NOTIFICATION_FILTERS = [
  { key: 'todos',      label: 'Todos',         test: () => true },
  { key: 'aficionado', label: 'Al aficionado', test: (a) => a.para.includes('aficionado') },
  { key: 'liga',       label: 'A la liga',     test: (a) => a.para.includes('liga') },
  { key: 'equipo',     label: 'Al equipo',     test: (a) => a.para.includes('equipo') },
  { key: 'correo',     label: 'Por correo',    test: (a) => a.canales.includes('correo') },
];

// Los avisos en el orden de sus temas. Un tema sin avisos —por el filtro o la
// búsqueda— no sale.
export function groupNotifications(avisos, temas) {
  return temas
    .map((tema) => ({ tema, avisos: avisos.filter((a) => a.tema === tema.clave) }))
    .filter((grupo) => grupo.avisos.length > 0);
}

// Ícono y etiqueta: los de la bandeja. Un correo no está en la bandeja y trae los
// suyos del catálogo.
export function notificationMeta(aviso) {
  if (aviso.como === 'correo') return { icon: aviso.icono, label: aviso.etiqueta, tone: 'cal' };
  return TYPE_META[aviso.tipo] ?? SIN_META;
}

// El aviso de muestra con la forma en que lo manda la API de la bandeja
// (GET /notifications/mine), para pintarlo con la misma tarjeta. `variante` cambia
// el texto (un guardado) o los datos (un calculado) sobre la muestra.
export function notificationPreview(aviso, variante = null, at = new Date().toISOString()) {
  const base = { key: `muestra-${aviso.tipo}`, type: aviso.tipo, at, is_new: false };
  const muestra = aviso.muestra ?? {};

  if (aviso.como === 'guardado') {
    const texto = variante ?? muestra;
    return {
      ...base,
      origin: 'organization',
      title: texto.titulo,
      body: texto.cuerpo,
      // Dos avisos no llevan a ninguna pantalla, y en la bandeja salen sin botón.
      url: muestra.boton === false ? null : '#',
      org: { name: muestra.de, logo_url: null },
    };
  }

  const match = { ...muestra.match, ...(variante?.match ?? {}) };
  const data = variante && 'data' in variante ? variante.data : (muestra.data ?? null);
  if (aviso.tema === 'predicciones') {
    return { ...base, origin: 'prediction', match, data, url: '#', scope: { league_name: match.league_name } };
  }
  return { ...base, origin: 'follow', match, data, url: '#' };
}

// Lo que dice: título y cuerpo, como en la bandeja. De un correo, su asunto.
export function notificationText(aviso) {
  if (aviso.como === 'correo') return { title: aviso.muestra?.asunto ?? '', body: aviso.muestra?.linea ?? '' };
  return textoDeAviso(notificationPreview(aviso));
}

// Los otros textos del mismo tipo: "Tu liga canceló un cargo", "No se dio"…
export function notificationVariants(aviso) {
  if (aviso.como === 'correo') return [];
  return (aviso.variantes ?? []).map((variante) => textoDeAviso(notificationPreview(aviso, variante)));
}

const DESTINO = { liga: 'La liga', equipo: 'El equipo' };

// A quién le llega, en palabras. De una liga o un equipo, la organización; quién
// de adentro lo ve va aparte (`notificationReaders`).
export function notificationAudience(aviso) {
  if (aviso.como !== 'guardado') return aviso.quien ?? '';
  const partes = aviso.para.map((p) => DESTINO[p]).filter(Boolean);
  if (partes.length < 2) return partes[0] ?? '';
  return `${partes[0]} o ${partes.slice(1).join(' o ').toLowerCase()}`;
}

// Quién lo ve dentro de la organización, con los roles que dio el backend. Si en
// la liga y en el equipo son los mismos, se dice una vez.
export function notificationReaders(aviso) {
  const lo = aviso.lo_ven;
  if (!lo) return null;
  const listas = Object.entries(lo).map(([org, roles]) => ({ org, texto: roles.join(' · ') }));
  if (listas.length === 0) return null;
  if (new Set(listas.map((l) => l.texto)).size === 1) return listas[0].texto;
  return listas.map((l) => `${DESTINO[l.org]}: ${l.texto}`).join(' — ');
}

// A cuántos le llegaron en 30 días: ligas, equipos, organizaciones o personas.
export function recipientsLabel(aviso, count) {
  if (aviso.como === 'correo') return pluralize(count, 'persona');
  if (aviso.para.length > 1) return pluralize(count, 'organización', 'organizaciones');
  return aviso.para[0] === 'liga' ? pluralize(count, 'liga') : pluralize(count, 'equipo');
}

// Por dónde sale y si ese canal está encendido en el servidor. Un estado siempre
// lleva su palabra: el punto solo no dice nada. El correo apagado va en rojo porque
// es un hueco (sin él no se puede recuperar una contraseña); el push en pausa, en
// gris, porque se apagó a propósito (README, "El push, en pausa").
export function channelStates(aviso, canales = {}) {
  return aviso.canales.map((canal) => {
    if (canal === 'push') {
      return canales.push ? { canal, tone: 'on', text: 'Push' } : { canal, tone: 'off', text: 'Push en pausa' };
    }
    if (canal === 'correo') {
      return canales.correo ? { canal, tone: 'on', text: 'Correo' } : { canal, tone: 'bad', text: 'Correo apagado' };
    }
    return { canal, tone: 'on', text: 'Bandeja' };
  });
}

// Lo que se puede contar de un calculado: a cuántas personas les puede llegar hoy.
export function reachLabel(aviso) {
  if (aviso.alcance == null) return null;
  const n = toNumber(aviso.alcance);
  return n === 1 ? '1 persona puede recibirlo' : `${formatNumber(n)} personas pueden recibirlo`;
}

// Dónde busca la caja de búsqueda: "pago" tiene que encontrar todo lo que hable de
// un pago, lo diga la etiqueta, el texto o cuándo sale.
export function notificationSearchFields(aviso, texto = notificationText(aviso)) {
  return [
    aviso.tipo,
    notificationMeta(aviso).label,
    texto.title,
    texto.body,
    aviso.cuando,
    notificationAudience(aviso),
    ...(aviso.sinRepetir ?? []),
  ];
}
