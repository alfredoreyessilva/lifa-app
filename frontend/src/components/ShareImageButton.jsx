import { useState } from 'react';
import { generateMatchCard, SHARE_CARD_FORMATS } from '../utils/matchShareCard.js';
import { buildMatchShareText } from '../utils/matchDisplay.js';

// Botón "Generar imagen" para la ficha de partido. Vive junto al botón de
// compartir link que ya existe en MatchPage — es una segunda forma de
// compartir, no una pantalla nueva.
//
// v1 a propósito NO tiene: selector de plantilla, subida de foto, ni IA.
// Un solo template (GAME_PREVIEW), dos formatos fijos (post / story).
export default function ShareImageButton({ match, dateParts, matchStatus }) {
  const [status, setStatus] = useState('idle'); // idle | generating | ready | error
  const [previewUrl, setPreviewUrl] = useState(null);
  const [blobByFormat, setBlobByFormat] = useState({});
  const [activeFormat, setActiveFormat] = useState('post');
  const [isSharing, setIsSharing] = useState(false);

  async function handleOpen() {
    setStatus('generating');
    try {
      const [postBlob, storyBlob] = await Promise.all([
        generateMatchCard(match, 'post', dateParts, matchStatus),
        generateMatchCard(match, 'story', dateParts, matchStatus),
      ]);
      const blobs = { post: postBlob, story: storyBlob };
      setBlobByFormat(blobs);
      setPreviewUrl(URL.createObjectURL(blobs.post));
      setActiveFormat('post');
      setStatus('ready');
    } catch (err) {
      console.error('Error generando imagen del partido', err);
      setStatus('error');
    }
  }

  function selectFormat(key) {
    setActiveFormat(key);
    setPreviewUrl(URL.createObjectURL(blobByFormat[key]));
  }

  function fileName() {
    const slug = `${match.home_team}-vs-${match.away_team}`
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-');
    return `${slug}-${activeFormat}.png`;
  }

  async function handleDownload() {
    console.log('[compartir] handleDownload() ejecutándose');
    const blob = blobByFormat[activeFormat];
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    console.log('[compartir] click de descarga disparado, nombre:', fileName());
    // Se retrasa la revocación: si se revoca de inmediato, algunos
    // navegadores (Firefox, y a veces Chrome de escritorio) cancelan la
    // descarga en silencio porque todavía no la habían iniciado.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleNativeShare() {
    if (isSharing) return; // candado: evita doble clic mientras hay un share en curso
    console.log('[compartir] click detectado');
    const blob = blobByFormat[activeFormat];
    console.log('[compartir] blob listo:', !!blob, blob && blob.size);
    const file = new File([blob], fileName(), { type: 'image/png' });
    const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    console.log('[compartir] navigator.share existe:', !!navigator.share);
    console.log('[compartir] navigator.canShare existe:', !!navigator.canShare);
    console.log('[compartir] canShare({files}) resultado:', canShareFiles);
    if (canShareFiles) {
      setIsSharing(true);
      const startedAt = performance.now();
      try {
        console.log('[compartir] llamando navigator.share con archivo…');
        await navigator.share({
          files: [file],
          title: `${match.home_team} vs ${match.away_team}`,
          text: buildMatchShareText(match, dateParts, matchStatus),
        });
        console.log('[compartir] navigator.share resuelto OK en', Math.round(performance.now() - startedAt), 'ms');
      } catch (err) {
        const elapsed = Math.round(performance.now() - startedAt);
        console.log('[compartir] navigator.share lanzó error en', elapsed, 'ms:', err.name, err.message);
        // Antes, si el navegador rechazaba con AbortError, no hacíamos
        // nada más — asumiendo que el usuario vio el panel nativo y le
        // dio "cancelar". En la práctica, varios navegadores (Brave con
        // sus Shields de privacidad, ciertos entornos de escritorio,
        // WebViews) rechazan como AbortError sin haber mostrado NUNCA el
        // panel. Como no hay forma confiable de distinguir un caso del
        // otro desde JS, ahora SIEMPRE caemos a descargar la imagen si
        // compartir falla, para que el usuario nunca se quede sin nada.
        console.log('[compartir] fallback: descargando la imagen en su lugar');
        handleDownload();
      } finally {
        setIsSharing(false);
      }
    } else {
      console.log('[compartir] no se puede compartir archivo, usando handleDownload()');
      handleDownload();
    }
  }

  function handleClose() {
    setStatus('idle');
    setPreviewUrl(null);
    setBlobByFormat({});
  }

  if (status === 'idle' || status === 'generating') {
    return (
      <button
        className="btn btn-outline btn-sm"
        type="button"
        onClick={handleOpen}
        disabled={status === 'generating'}
      >
        {status === 'generating' ? 'Generando imagen…' : '🖼️ Generar imagen'}
      </button>
    );
  }

  if (status === 'error') {
    return (
      <button className="btn btn-outline btn-sm" type="button" onClick={handleOpen}>
        No se pudo generar, reintentar
      </button>
    );
  }

  // status === 'ready' → mini panel de previsualización
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: 16,
        background: 'rgba(0,0,0,0.15)',
        borderRadius: 16,
        marginTop: 12,
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', gap: 8 }}>
        {Object.keys(SHARE_CARD_FORMATS).map((key) => (
          <button
            key={key}
            type="button"
            className={`btn btn-sm ${activeFormat === key ? 'btn-flag' : 'btn-outline'}`}
            onClick={() => selectFormat(key)}
          >
            {SHARE_CARD_FORMATS[key].label}
          </button>
        ))}
      </div>

      {previewUrl && (
        <img
          src={previewUrl}
          alt="Vista previa"
          style={{ maxWidth: 260, borderRadius: 12, border: '1px solid var(--line-strong)' }}
        />
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn btn-flag btn-sm"
          type="button"
          onClick={handleNativeShare}
          disabled={isSharing}
        >
          {isSharing ? 'Compartiendo…' : 'Compartir'}
        </button>
        <button className="btn btn-outline btn-sm" type="button" onClick={handleDownload}>
          Descargar
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={handleClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
