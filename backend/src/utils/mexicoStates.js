// Los 32 estados de México. Es la única lista contra la que se valida
// "state" cuando la liga elige México como país (ver routes/leagues.js) —
// para el resto de países se sigue aceptando texto libre, como antes.
//
// OJO: debe quedar EXACTAMENTE igual (mismos textos, mismas mayúsculas) que
// frontend/src/utils/mexicoStates.js — el <select> del formulario manda uno
// de estos strings tal cual, y en mayúsculas para no fragmentar el conteo
// de "ligas por estado" contra los registros viejos (el campo "Estado /
// Región" ya forzaba mayúsculas con CharField antes de este cambio).
export const MEXICO_STATES = [
  'AGUASCALIENTES',
  'BAJA CALIFORNIA',
  'BAJA CALIFORNIA SUR',
  'CAMPECHE',
  'CHIAPAS',
  'CHIHUAHUA',
  'CIUDAD DE MÉXICO',
  'COAHUILA',
  'COLIMA',
  'DURANGO',
  'ESTADO DE MÉXICO',
  'GUANAJUATO',
  'GUERRERO',
  'HIDALGO',
  'JALISCO',
  'MICHOACÁN',
  'MORELOS',
  'NAYARIT',
  'NUEVO LEÓN',
  'OAXACA',
  'PUEBLA',
  'QUERÉTARO',
  'QUINTANA ROO',
  'SAN LUIS POTOSÍ',
  'SINALOA',
  'SONORA',
  'TABASCO',
  'TAMAULIPAS',
  'TLAXCALA',
  'VERACRUZ',
  'YUCATÁN',
  'ZACATECAS',
];
