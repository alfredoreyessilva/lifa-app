// Helpers de validación reutilizables para formularios del frontend.
// Cada función regresa un string con el mensaje de error si algo está
// mal, o null si el valor es válido — así se pueden encadenar fácil
// con un primer-error-gana sin anidar muchos if/else en cada componente.

export function required(value, fieldLabel) {
  if (value === null || value === undefined) return `${fieldLabel} es obligatorio`;
  if (typeof value === 'string' && value.trim() === '') return `${fieldLabel} es obligatorio`;
  return null;
}

export function minLength(value, min, fieldLabel) {
  if (value && value.trim().length < min) {
    return `${fieldLabel} debe tener al menos ${min} caracteres`;
  }
  return null;
}

export function maxLength(value, max, fieldLabel) {
  if (value && value.trim().length > max) {
    return `${fieldLabel} no puede tener más de ${max} caracteres`;
  }
  return null;
}

export function validEmail(value) {
  if (!value) return null; // usar required() aparte si el campo es obligatorio
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(value.trim())) return 'El correo no tiene un formato válido';
  return null;
}

export function validUrl(value, fieldLabel = 'El enlace') {
  if (!value || value.trim() === '') return null; // usar required() aparte si es obligatorio
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return `${fieldLabel} debe ser una dirección web válida (debe empezar con http:// o https://)`;
    }
    return null;
  } catch {
    return `${fieldLabel} no es una dirección web válida (revisa que empiece con http:// o https://)`;
  }
}

export function notFutureLessThan(value, minDate, fieldLabel) {
  // No usado actualmente, reservado por si se necesita una fecha mínima distinta a "hoy".
  if (!value) return null;
  if (new Date(value) < new Date(minDate)) return `${fieldLabel} no puede ser anterior a la fecha mínima permitida`;
  return null;
}

export function notPastDate(value, fieldLabel) {
  if (!value) return null;
  const inputDate = new Date(value);
  const now = new Date();
  if (inputDate < now) {
    return `${fieldLabel} no puede ser una fecha que ya pasó`;
  }
  return null;
}

export function differentFrom(value, otherValue, fieldLabel) {
  if (value && otherValue && String(value) === String(otherValue)) {
    return fieldLabel;
  }
  return null;
}

export function minValue(value, min, fieldLabel) {
  if (value === '' || value === null || value === undefined) return null;
  if (Number(value) < min) return `${fieldLabel} no puede ser menor a ${min}`;
  return null;
}

/**
 * Corre una lista de validaciones en orden y regresa el primer mensaje
 * de error encontrado, o null si todas pasan.
 * Uso:
 *   const error = runValidations([
 *     () => required(name, 'El nombre'),
 *     () => maxLength(name, 80, 'El nombre'),
 *   ]);
 */
export function runValidations(validators) {
  for (const validate of validators) {
    const error = validate();
    if (error) return error;
  }
  return null;
}