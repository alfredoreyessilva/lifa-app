// "Servicios comerciales" del partido — accesos inspirados en cómo la NFL
// muestra Boletos/Hotel junto a cada partido. A diferencia de Boletos (que
// sí requiere que un admin capture una URL específica por partido, porque
// cada boletera es distinta), Hotel se genera 100% a partir de datos que la
// plataforma ya tiene: la ciudad de la sede (venues.city) y la fecha del
// partido. Ningún admin tiene que configurar nada partido por partido.
//
// Si en el futuro se agrega "Vuelos", debería seguir este mismo patrón:
// una función buildXxxSearchUrl(match) que regresa null cuando falta algún
// dato necesario, y un ID de proveedor/afiliado leído de una variable de
// entorno (nunca hardcodeado). Vuelos necesitará además la ciudad de
// ORIGEN del usuario, que es un dato de usuario, no de partido — por eso
// no se resuelve aquí.

const DEFAULT_TZ = 'America/Mexico_City';

// Noches por default a partir de la fecha del partido. 0 = el checkout es
// al día siguiente del partido (una sola noche, la del partido). Se deja
// como constante para poder ajustarlo fácilmente si el negocio decide que
// conviene sugerir más noches (ej. para fomentar viajes de fin de semana).
const HOTEL_NIGHTS_DEFAULT = 1;

// Convierte un objeto Date a "YYYY-MM-DD" en la zona horaria indicada.
// El locale 'en-CA' es un atajo: Intl lo formatea nativamente como
// año-mes-día, así no hay que armar el string a mano.
function toISODateInTZ(date, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// Suma días a una fecha ya en formato "YYYY-MM-DD". Trabaja en UTC a
// propósito: una vez que ya tenemos solo la fecha del calendario (sin hora
// ni zona), sumar días es aritmética simple y así se evitan los bugs
// clásicos de saltos de día por zona horaria.
function addDaysToISODate(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// Arma el link de búsqueda de hotel para un partido, o null si falta algún
// dato necesario (match.venue_city todavía no capturado, o fecha inválida).
// MatchPage.jsx debe ocultar el botón por completo cuando esto regresa null
// — nunca mostrar un link genérico o adivinado.
export function buildHotelSearchUrl(match) {
  if (!match?.venue_city || !match?.match_date) return null;

  const tz = match.timezone || match.league_timezone || DEFAULT_TZ;
  const matchDate = new Date(match.match_date);
  if (Number.isNaN(matchDate.getTime())) return null;

  const checkin  = toISODateInTZ(matchDate, tz);
  const checkout = addDaysToISODate(checkin, HOTEL_NIGHTS_DEFAULT);

  const params = new URLSearchParams({
    ss: match.venue_city,
    checkin,
    checkout,
    lang: 'es',
    selected_currency: 'MXN',
  });

  // El ID de afiliado llega después, cuando el proveedor apruebe la
  // cuenta (ver documentación de la Fase 5). Mientras tanto, el link
  // funciona igual, solo que sin generar comisión — así el botón puede
  // lanzarse a producción sin esperar el trámite administrativo.
  const affiliateId = import.meta.env.VITE_HOTEL_AFFILIATE_ID;
  if (affiliateId) params.set('aid', affiliateId);

  return `https://www.booking.com/searchresults.html?${params.toString()}`;
}
