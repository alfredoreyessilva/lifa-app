import { useState } from 'react';
import { generateRankingCard, SHARE_CARD_FORMATS } from '../utils/rankingShareCard.js';

// Botón "Generar imagen" para la pestaña "Ranking de predicciones".
// Mismo mecanismo que ShareImageButton.jsx (partido) y PlayerShareButton.jsx
// (jugador): canvas 2D en el navegador, dos formatos fijos (post / story),
// compartir nativo con fallback a descargar. Genera el Top 10 del ranking
// que se está viendo.
//
// `header` describe el encabezado de la imagen: { league, tournament,
// context ("categoría · rama"), poolName }. `tournament` (o `title` como
// respaldo) es el texto resaltado.
export default function RankingImageButton({ ranking, header = {} }) {
  const heroLabel = header.tournament || header.title || 'CFBAMX';
  const [status, setStatus] = useState('idle'); // idle | generating | ready | error
  const [previewUrl, setPreviewUrl] = useState(null);
  const [blobByFormat, setBlobByFormat] = useState({});
  const [activeFormat, setActiveFormat] = useState('post');
  const [isSharing, setIsSharing] = useState(false);

  async function handleOpen() {
    setStatus('generating');
    try {
      const [postBlob, storyBlob] = await Promise.all([
        generateRankingCard(ranking, 'post', header),
        generateRankingCard(ranking, 'story', header),
      ]);
      const blobs = { post: postBlob, story: storyBlob };
      setBlobByFormat(blobs);
      setPreviewUrl(URL.createObjectURL(blobs.post));
      setActiveFormat('post');
      setStatus('ready');
    } catch (err) {
      console.error('Error generando imagen del ranking', err);
      setStatus('error');
    }
  }

  function selectFormat(key) {
    setActiveFormat(key);
    setPreviewUrl(URL.createObjectURL(blobByFormat[key]));
  }

  function fileName() {
    const slug = `ranking-${heroLabel}`
      .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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
    // Se retrasa la revocación: si se revoca de inmediato, algunos
    // navegadores cancelan la descarga en silencio.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleNativeShare() {
    if (isSharing) return; // candado: evita doble clic mientras hay un share en curso
    const blob = blobByFormat[activeFormat];
    const file = new File([blob], fileName(), { type: 'image/png' });
    const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    if (canShareFiles) {
      setIsSharing(true);
      try {
        await navigator.share({
          files: [file],
          title: `Ranking de predicciones${header.tournament || header.title ? ` — ${header.tournament || header.title}` : ''}`,
          text: 'Mira el ranking de predicciones en CFBAMX',
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
