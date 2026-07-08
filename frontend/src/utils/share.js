// Comparte un link usando la Web Share API del celular/navegador
// (abre el menú nativo de "compartir" en WhatsApp, etc.).
// Si el dispositivo no la soporta (por ejemplo, en computadora de escritorio),
// copia el link al portapapeles como respaldo.
export async function shareLink(url, title, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled'; // el usuario cerró el menú
      // si falla por otra razón, seguimos e intentamos copiar
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch (err) {
    return 'error';
  }
}