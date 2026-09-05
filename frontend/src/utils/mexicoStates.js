// Los 32 estados de México, para el <select> de "Estado" que aparece al
// registrar/editar una liga cuando el país elegido es México.
//
// OJO: debe quedar EXACTAMENTE igual (mismos textos, mismas mayúsculas) que
// backend/src/utils/mexicoStates.js — el backend valida "state" contra esta
// misma lista cuando el país es México. Van en mayúsculas para no
// fragmentar el conteo de "ligas por estado" contra los registros viejos
// (el campo "Estado / Región" ya forzaba mayúsculas con CharField).
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
