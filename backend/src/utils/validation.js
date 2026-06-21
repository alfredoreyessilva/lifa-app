// Helpers de validación reutilizables para las rutas del backend.
// El frontend ya valida estos mismos casos antes de enviar, pero el
// backend debe repetir las validaciones de coherencia críticas porque
// cualquiera puede llamar a la API directamente sin pasar por la UI.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  if (!value) return true; // los campos de email en este proyecto son opcionales; usar required aparte si no lo es
  return EMAIL_RE.test(String(value).trim());
}

export function isValidUrl(value) {
  if (!value) return true; // opcional por defecto
  try {
    const url = new URL(String(value).trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}