import { useEffect, useRef, useState } from 'react';
import { generateBracketCard, SHARE_CARD_FORMATS } from '../utils/bracketShareCard.js';
import { bracketTitle } from '../utils/bracketFormat.js';

// Botón "Generar imagen" de UN bracket (una conferencia). Mismo mecanismo que
// StandingsImageButton.jsx: canvas 2D en el navegador, publicación e historia,
// compartir nativo y, si el navegador no puede compartir archivos, descargar.
//
// `header` es lo que el bracket no sabe de sí mismo: { tournament, context
// ("categoría · rama"), leagueLogo }.
export default function BracketImageButton({ bracket, header = {} }) {
  const [status, setStatus] = useState('idle'); // idle | generating | ready | error
  const [previewUrl, setPreviewUrl] = useState(null);
  const [blobByFormat, setBlobByFormat] = useState({});
  const [activeFormat, setActiveFormat] = useState('post');
  const [isSharing, setIsSharing] = useState(false);

  // La URL de la vista previa se suelta al cambiar de formato, al cerrar y al
  // salir de la pantalla, y se crea siempre en un evento: el modo estricto de
  // React desmonta y vuelve a montar los efectos.
  const previewRef = useRef(null);
  function showPreview(blob) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = blob ? URL.createObjectURL(blob) : null;
    setPreviewUrl(previewRef.current);
  }
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const scope = bracketTitle(bracket);

  async function handleOpen() {
    setStatus('generating');
    try {
      const options = { header, date: new Date() };
      const [postBlob, storyBlob] = await Promise.all([
        generateBracketCard(bracket, 'post', options),
        generateBracketCard(bracket, 'story', options),
      ]);
      const blobs = { post: postBlob, story: storyBlob };
      setBlobByFormat(blobs);
      showPreview(blobs.post);
      setActiveFormat('post');
      setStatus('ready');
    } catch (err) {
      console.error('Error generando imagen del bracket', err);
      setStatus('error');
    }
  }

  function selectFormat(key) {
    setActiveFormat(key);
    showPreview(blobByFormat[key]);
  }

  function fileName() {
    const slug = ['bracket', header.tournament, scope]
      .filter(Boolean).join('-')
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
    if (isSharing) return;
    const blob = blobByFormat[activeFormat];
    const file = new File([blob], fileName(), { type: 'image/png' });
    const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    if (canShareFiles) {
      setIsSharing(true);
      try {
        const title = [header.tournament, scope].filter(Boolean).join(' · ');
        await navigator.share({
          files: [file],
          title: `Playoffs${title ? ` — ${title}` : ''}`,
          text: 'Mira el bracket de los playoffs en CFBAMX',
        });
      } catch {
        // Varios navegadores rechazan como AbortError sin haber mostrado el
        // panel nativo; como no se distingue desde JS, se descarga.
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
    showPreview(null);
    setBlobByFormat({});
  }

  if (status === 'idle' || status === 'generating') {
    return (
      <button className="btn btn-outline btn-sm" type="button" onClick={handleOpen} disabled={status === 'generating'}>
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

  return (
    <div className="bracket-image-panel">
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
          alt="Vista previa del bracket"
          style={{ maxWidth: 260, borderRadius: 12, border: '1px solid var(--line-strong)' }}
        />
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-flag btn-sm" type="button" onClick={handleNativeShare} disabled={isSharing}>
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
