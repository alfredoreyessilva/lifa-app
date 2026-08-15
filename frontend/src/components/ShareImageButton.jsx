import { useState } from 'react';
import { generateMatchCard, SHARE_CARD_FORMATS } from '../utils/matchShareCard.js';

// Botón "Generar imagen" para la ficha de partido. Vive junto al botón de
// compartir link que ya existe en MatchPage — es una segunda forma de
// compartir, no una pantalla nueva.
//
// v1 a propósito NO tiene: selector de plantilla, subida de foto, ni IA.
// Un solo template (GAME_PREVIEW), dos formatos fijos (post / story).
export default function ShareImageButton({ match, dateParts }) {
  const [status, setStatus] = useState('idle'); // idle | generating | ready | error
  const [previewUrl, setPreviewUrl] = useState(null);
  const [blobByFormat, setBlobByFormat] = useState({});
  const [activeFormat, setActiveFormat] = useState('post');

  async function handleOpen() {
    setStatus('generating');
    try {
      const [postBlob, storyBlob] = await Promise.all([
        generateMatchCard(match, 'post', dateParts),
        generateMatchCard(match, 'story', dateParts),
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
    const blob = blobByFormat[activeFormat];
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName();
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleNativeShare() {
    const blob = blobByFormat[activeFormat];
    const file = new File([blob], fileName(), { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: `${match.home_team} vs ${match.away_team}`,
          text: 'Mira este partido en LIFA',
        });
      } catch (err) {
        if (err.name !== 'AbortError') console.error(err);
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
        <button className="btn btn-flag btn-sm" type="button" onClick={handleNativeShare}>
          Compartir
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
