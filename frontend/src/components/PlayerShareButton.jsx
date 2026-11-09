import { useState } from 'react';
import Modal from './Modal.jsx';
import { generatePlayerCard, SHARE_CARD_FORMATS } from '../utils/playerShareCard.js';

// Mismo patrón que ShareImageButton.jsx (partidos), adaptado a jugador.
// v1 a propósito NO tiene: selector de plantilla, subida de foto, ni IA.
export default function PlayerShareButton({ player, team, stats }) {
  const [status, setStatus] = useState('idle'); // idle | generating | ready | error
  const [previewUrl, setPreviewUrl] = useState(null);
  const [blobByFormat, setBlobByFormat] = useState({});
  const [activeFormat, setActiveFormat] = useState('post');
  const [isSharing, setIsSharing] = useState(false);

  async function handleOpen() {
    setStatus('generating');
    try {
      const [postBlob, storyBlob] = await Promise.all([
        generatePlayerCard(player, team, stats, 'post'),
        generatePlayerCard(player, team, stats, 'story'),
      ]);
      const blobs = { post: postBlob, story: storyBlob };
      setBlobByFormat(blobs);
      setPreviewUrl(URL.createObjectURL(blobs.post));
      setActiveFormat('post');
      setStatus('ready');
    } catch (err) {
      console.error('Error generando imagen del jugador', err);
      setStatus('error');
    }
  }

  function selectFormat(key) {
    setActiveFormat(key);
    setPreviewUrl(URL.createObjectURL(blobByFormat[key]));
  }

  function fileName() {
    const slug = `${player.first_name}-${player.last_name}`
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-');
    return `${slug}-${activeFormat}.png`;
  }

  function handleDownload() {
    const blob = blobByFormat[activeFormat];
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Se retrasa la revocación, como en las otras imágenes: si se revoca de
    // inmediato, algunos navegadores cancelan la descarga en silencio.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleNativeShare() {
    if (isSharing) return; // candado: evita doble clic mientras hay un share en curso
    const blob = blobByFormat[activeFormat];
    const file = new File([blob], fileName(), { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      setIsSharing(true);
      try {
        await navigator.share({
          files: [file],
          title: `${player.first_name} ${player.last_name}`,
          text: 'Mira esta tarjeta de jugador en CFBAMX',
        });
      } catch {
        // Varios navegadores rechazan como AbortError sin haber mostrado
        // nunca el panel nativo. Como no se puede distinguir desde JS,
        // siempre caemos a descargar para que el usuario no se quede sin nada.
        handleDownload();
      } finally {
        setIsSharing(false);
      }
    } else {
      handleDownload();
    }
  }

  function handleClose() {
    setStatus('idle');
    setPreviewUrl(null);
    setBlobByFormat({});
  }

  // Como en la imagen de un partido, el botón se queda en su lugar y la vista
  // previa va en una ventana encima: dentro de la ficha empujaba hacia abajo
  // las estadísticas. La imagen y los botones se acomodan al ancho de la
  // ventana, para que en un celular angosto no se deslice de lado.
  return (
    <>
      <button
        className="btn btn-outline btn-sm"
        type="button"
        onClick={handleOpen}
        disabled={status === 'generating'}
      >
        {status === 'generating'
          ? 'Generando imagen…'
          : status === 'error' ? 'No se pudo generar, reintentar' : '🖼️ Generar imagen'}
      </button>

      {status === 'ready' && (
        <Modal title="Imagen del jugador" onClose={handleClose}>
          <div className="share-image-panel">
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
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
                style={{ width: '100%', maxWidth: 260, borderRadius: 12, border: '1px solid var(--line-strong)' }}
              />
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
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
        </Modal>
      )}
    </>
  );
}
