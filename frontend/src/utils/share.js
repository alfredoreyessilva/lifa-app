// Candado a nivel de módulo: si dos botones (o dos clics rápidos) llaman a
// shareLink() mientras navigator.share() del primero todavía no resuelve,
// el navegador lanza "InvalidStateError: An earlier share has not yet
// completed". Ese error no es un AbortError, así que caía al fallback y
// solo copiaba el link en vez de abrir el menú nativo. Este guard evita
// una segunda llamada a navigator.share() mientras la anterior sigue en
// curso, sin importar desde qué componente se dispare.
let isNativeShareInProgress = false;

// Comparte un link usando la Web Share API del celular/navegador
// (abre el menú nativo de "compartir" en WhatsApp, etc.).
// Si el dispositivo no la soporta (por ejemplo, en computadora de escritorio),
// copia el link al portapapeles como respaldo.
export async function shareLink(url, title, text) {
  console.log('[shareLink] click detectado. navigator.share existe:', !!navigator.share);
  if (navigator.share) {
    if (isNativeShareInProgress) {
      console.log('[shareLink] ya hay un share en curso, se ignora este clic');
      return 'busy'; // ya hay un share en curso, ignoramos el clic
    }
    isNativeShareInProgress = true;
    const startedAt = performance.now();
    try {
      console.log('[shareLink] llamando navigator.share()…', { title, text, url });
      await navigator.share({ title, text, url });
      console.log('[shareLink] navigator.share resuelto OK en', Math.round(performance.now() - startedAt), 'ms');
      return 'shared';
    } catch (err) {
      const elapsed = Math.round(performance.now() - startedAt);
      console.log('[shareLink] navigator.share lanzó error en', elapsed, 'ms:', err.name, err.message);
      // Antes, si err.name era 'AbortError', regresábamos de inmediato sin
      // copiar el link, asumiendo que el usuario vio el panel nativo y le
      // dio "cancelar" a propósito. En la práctica, varios navegadores
      // (Brave con sus Shields de privacidad, algunos entornos de
      // escritorio sin apps de "compartir" instaladas, WebViews, etc.)
      // rechazan la promesa como AbortError sin haber mostrado NUNCA el
      // panel — el usuario no canceló nada, el navegador simplemente no
      // pudo compartir. Distinguir un caso del otro no es confiable desde
      // JS, así que ahora SIEMPRE caemos al respaldo de copiar el link,
      // sin importar el motivo del rechazo. Si el usuario sí canceló a
      // propósito, lo peor que pasa es que el link queda copiado de más
      // en su portapapeles — no rompe nada.
    } finally {
      isNativeShareInProgress = false;
    }
  }
  try {
    console.log('[shareLink] usando fallback de clipboard.writeText()');
    await navigator.clipboard.writeText(url);
    console.log('[shareLink] clipboard.writeText OK');
    return 'copied';
  } catch (err) {
    console.log('[shareLink] clipboard.writeText también falló:', err.name, err.message);
    return 'error';
  }
}