import { useEffect, useRef, useState } from 'react';
import { generateStandingsCard, SHARE_CARD_FORMATS } from '../utils/standingsShareCard.js';
import { scopeLabel } from '../utils/standingsFormat.js';
import Modal from './Modal.jsx';
import { IconoImagen } from './MatchIcons.jsx';

// Botón "Generar imagen" de UNA tabla de posiciones: cada conferencia o grupo
// lleva el suyo, porque una imagen con dos tablas de 18 equipos no se lee en
// un celular. Mismo mecanismo que RankingImageButton.jsx: canvas 2D en el
// navegador, dos formatos fijos (publicación / historia), compartir nativo y,
// si el navegador no puede compartir archivos, descargar.
//
// `header` es lo que la tabla no sabe de sí misma: { league, tournament, year,
// context ("categoría · rama"), leagueLogo }.
export default function StandingsImageButton({ table, usesPoints, header = {} }) {
  const [status, setStatus] = useState('idle'); // idle | generating | ready | error
  const [previewUrl, setPreviewUrl] = useState(null);
  const [blobByFormat, setBlobByFormat] = useState({});
  const [activeFormat, setActiveFormat] = useState('post');
  const [isSharing, setIsSharing] = useState(false);

  // La URL de la vista previa se suelta al cambiar de formato, al cerrar y
  // al salir de la pantalla. Se crea siempre en un evento, nunca al pintar:
  // el modo estricto de React desmonta y vuelve a montar los efectos.
  const previewRef = useRef(null);
  function showPreview(blob) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = blob ? URL.createObjectURL(blob) : null;
    setPreviewUrl(previewRef.current);
  }
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const scope = scopeLabel(table.level, table.scope_name);

  async function handleOpen() {
    setStatus('generating');
    try {
      // Las dos con la misma fecha de corte, aunque se dibujen por separado.
      const options = { usesPoints, header, date: new Date() };
      const [postBlob, storyBlob] = await Promise.all([
        generateStandingsCard(table, 'post', options),
        generateStandingsCard(table, 'story', options),
      ]);
      const blobs = { post: postBlob, story: storyBlob };
      setBlobByFormat(blobs);
      showPreview(blobs.post);
      setActiveFormat('post');
      setStatus('ready');
    } catch (err) {
      console.error('Error generando imagen de la tabla de posiciones', err);
      setStatus('error');
    }
  }

  function selectFormat(key) {
    setActiveFormat(key);
    showPreview(blobByFormat[key]);
  }

  function fileName() {
    const slug = ['posiciones', header.tournament, scope]
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
    if (isSharing) return; // candado: evita doble clic mientras hay un share en curso
    const blob = blobByFormat[activeFormat];
    const file = new File([blob], fileName(), { type: 'image/png' });
    const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    if (canShareFiles) {
      setIsSharing(true);
      try {
        const title = [header.tournament, scope].filter(Boolean).join(' · ');
        await navigator.share({
          files: [file],
          title: `Tabla de posiciones${title ? ` — ${title}` : ''}`,
          text: 'Mira la tabla de posiciones en CFBAMX',
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
    showPreview(null);
    setBlobByFormat({});
  }

  // Como en la imagen de un partido, el botón se queda en su lugar mientras
  // la imagen está abierta: la vista previa va en una ventana encima y no
  // empuja la tabla hacia abajo, que es lo que hacía cuando iba dentro de ella.
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
          : status === 'error' ? 'No se pudo generar, reintentar' : <><IconoImagen /> Generar imagen</>}
      </button>

      {status === 'ready' && (
        <Modal title="Imagen de la tabla" onClose={handleClose}>
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

            {/* La vista previa y los botones se acomodan al ancho de la ventana:
                en un celular de 320 a 360 px no caben 260 px de imagen ni los
                tres botones en un renglón, y la ventana se deslizaba de lado. */}
            {previewUrl && (
              <img
                src={previewUrl}
                alt="Vista previa de la tabla de posiciones"
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
