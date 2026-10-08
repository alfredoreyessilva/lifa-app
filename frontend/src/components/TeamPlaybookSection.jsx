import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client.js';
import Loading from './Loading.jsx';
import Modal from './Modal.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import { fmtDate } from '../utils/money.js';
import { puede } from '../utils/permisos.js';
import { imagenAjustada } from '../utils/imagenes.js';

// El playbook del equipo: las imágenes de jugadas que sube su cuerpo técnico
// (README, "Playbook del equipo"). Lo abren el dueño, el administrador y el
// coach —el permiso `playbook`— y los tres pueden lo mismo: subir, ponerle
// título, cambiarlo y borrar, también lo que subió otro. Por eso adentro no hay
// botones que dependan de quién mira: quien llega a esta pestaña ya puede todo
// lo que hay en ella.

// Los mismos topes que pone el backend (utils/playbook.js y routes/playbook.js).
// Aquí sirven para avisar antes de subir, no para proteger: el backend vuelve a
// recortar el título y a rechazar el archivo pesado.
const TITULO_MAX = 120;
const MAX_MB = 8;

// La cuadrícula pinta cada imagen a unos 300 px y se pide al doble por las
// pantallas de alta densidad. La pantalla completa, al tope con que se guardó.
const ANCHO_MINIATURA = 640;
const ANCHO_COMPLETA = 2000;

const tituloDe = (image) => image.title || 'Sin título';

// Si Cloudinary no puede entregar la versión ajustada, se cae a la original en
// vez de dejar el cuadro roto. La comparación evita un ciclo si la original
// tampoco carga.
function usarOriginal(e, original) {
  if (original && e.currentTarget.src !== original) e.currentTarget.src = original;
}

export default function TeamPlaybookSection({ team, token }) {
  const [images, setImages] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [viendo, setViendo] = useState(null);
  const inputRef = useRef(null);

  // La pestaña ya no aparece sin el permiso, pero la ruta se puede escribir a
  // mano: a ese rol no se le pide nada al backend, que contestaría 403.
  const tieneAcceso = puede(team, 'playbook');

  useEffect(() => {
    if (!tieneAcceso) return;
    setImages(null);
    setError('');
    api.getTeamPlaybook(team.id, token)
      .then((d) => setImages(d.images))
      .catch((e) => setError(e.message));
  }, [team.id, token, tieneAcceso]);

  if (!tieneAcceso) {
    return (
      <p style={{ color: 'var(--ws-ink-dim)', fontSize: 13 }}>
        El playbook lo ven el dueño, el administrador y el coach del equipo. Tu rol no tiene acceso.
      </p>
    );
  }

  function elegirArchivos() {
    inputRef.current?.click();
  }

  function alElegir(e) {
    const files = Array.from(e.target.files || []);
    // Se limpia para que volver a elegir el mismo archivo dispare el cambio.
    e.target.value = '';
    if (files.length > 0) setModal({ type: 'subir', files });
  }

  // Cada imagen entra a la lista en cuanto sube, no al final: si la tercera de
  // cinco falla, las dos primeras ya están en el playbook y se ven.
  function alSubir(image) {
    setImages((prev) => [image, ...(prev || [])]);
  }

  function alGuardarTitulo(image) {
    setImages((prev) => prev.map((i) => (i.id === image.id ? image : i)));
    setModal(null);
  }

  async function borrar(image) {
    try {
      await api.deletePlaybookImage(team.id, image.id, token);
    } catch (e) {
      // Si alguien más ya la borró, el resultado es el que se pidió.
      if (e.status !== 404) throw e;
    }
    setImages((prev) => prev.filter((i) => i.id !== image.id));
    setModal(null);
  }

  return (
    <div>
      {error && <div className="form-error">{error}</div>}

      <div className="ws-toolbar">
        <button className="btn btn-accent" onClick={elegirArchivos}>+ Subir imágenes</button>
      </div>
      <p style={{ color: 'var(--ws-ink-dim)', fontSize: 12, margin: '0 0 16px' }}>
        Lo ven y lo editan el dueño, el administrador y el coach del equipo. La liga no lo ve.
      </p>
      {/* Sin `capture`: en el celular eso abre directo la cámara, y las jugadas
          casi siempre ya están en la galería. */}
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={alElegir} />

      {images === null ? (
        !error && <Loading />
      ) : images.length === 0 ? (
        <div className="empty-teach">
          <div className="empty-teach-icon">📋</div>
          <h3>Arma el playbook del equipo</h3>
          <p>
            Sube fotos del pizarrón o capturas de tus jugadas y ponles título. Las ve todo el cuerpo
            técnico, y cualquiera de ellos las puede renombrar o borrar.
          </p>
          <button className="btn btn-accent" onClick={elegirArchivos}>Subir la primera</button>
        </div>
      ) : (
        <div className="playbook-grid">
          {images.map((image, i) => (
            <div key={image.id} className="playbook-card">
              <button
                type="button"
                className="playbook-thumb"
                onClick={() => setViendo(i)}
                aria-label={`Ver en pantalla completa: ${tituloDe(image)}`}
              >
                <img
                  src={imagenAjustada(image.image_url, ANCHO_MINIATURA)}
                  alt=""
                  loading="lazy"
                  onError={(e) => usarOriginal(e, image.image_url)}
                />
              </button>
              <div className="playbook-card-body">
                <div className={`playbook-card-title${image.title ? '' : ' is-empty'}`}>{tituloDe(image)}</div>
                <div className="playbook-card-meta">
                  {image.uploaded_by_name ? `${image.uploaded_by_name} · ` : ''}{fmtDate(image.created_at)}
                </div>
                <div className="playbook-card-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'titulo', image })}>
                    {image.title ? 'Editar título' : 'Ponerle título'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'borrar', image })}>
                    Borrar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal?.type === 'subir' && (
        <SubirImagenes
          files={modal.files}
          team={team}
          token={token}
          onSubida={alSubir}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === 'titulo' && (
        <EditarTitulo
          image={modal.image}
          team={team}
          token={token}
          onGuardado={alGuardarTitulo}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === 'borrar' && (
        <ConfirmDialog
          title="Borrar imagen"
          message="Se borra del playbook para todo el equipo, aunque la haya subido otra persona. No se puede deshacer."
          detail={(
            <>
              <strong>{tituloDe(modal.image)}</strong>
              <div style={{ fontSize: 12, color: 'var(--ws-ink-dim)', marginTop: 4 }}>
                {modal.image.uploaded_by_name ? `Subida por ${modal.image.uploaded_by_name} · ` : ''}
                {fmtDate(modal.image.created_at)}
              </div>
            </>
          )}
          confirmLabel="Borrar"
          danger
          onConfirm={() => borrar(modal.image)}
          onClose={() => setModal(null)}
        />
      )}

      {viendo !== null && images?.[viendo] && (
        <PantallaCompleta
          images={images}
          index={viendo}
          onIndex={setViendo}
          onClose={() => setViendo(null)}
        />
      )}
    </div>
  );
}

// Subir una o varias imágenes. Con una sola se le puede poner título de una
// vez; con varias, el título se pone después desde cada imagen — pedir cinco
// títulos en un mismo formulario es la forma de que nadie ponga ninguno.
function SubirImagenes({ files, team, token, onSubida, onClose }) {
  const [titulo, setTitulo] = useState('');
  const [subiendo, setSubiendo] = useState(null);
  const [hechas, setHechas] = useState(0);
  const [error, setError] = useState('');

  // Lo que no se puede subir se dice antes de intentarlo y con su motivo: un
  // 413 después de esperar a que suba una foto pesada es la peor forma de
  // enterarse.
  const { validas, rechazadas } = useMemo(() => {
    const ok = [];
    const fuera = [];
    for (const file of files) {
      if (!/^image\//.test(file.type)) fuera.push({ file, motivo: 'no es una imagen' });
      else if (file.size > MAX_MB * 1024 * 1024) fuera.push({ file, motivo: `pesa más de ${MAX_MB} MB` });
      else ok.push(file);
    }
    return { validas: ok, rechazadas: fuera };
  }, [files]);

  // Las vistas previas son URLs locales del navegador y se sueltan al cerrar.
  // Se crean DENTRO del efecto, junto con su limpieza, y no en un useMemo: el
  // modo estricto de React desmonta y vuelve a montar cada efecto en
  // desarrollo, y con useMemo la limpieza soltaba las URLs que la pantalla
  // seguía usando (la vista previa salía rota, ERR_FILE_NOT_FOUND).
  const [previas, setPrevias] = useState([]);
  useEffect(() => {
    const urls = validas.map((f) => URL.createObjectURL(f));
    setPrevias(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [validas]);

  const una = validas.length === 1;

  // De una en una y empezando por la que falló, no desde el principio: volver
  // a darle "Subir" después de un error no duplica las que ya subieron.
  async function subir(e) {
    e.preventDefault();
    setError('');
    for (let i = hechas; i < validas.length; i++) {
      setSubiendo({ actual: i + 1, total: validas.length });
      try {
        const { image } = await api.uploadPlaybookImage(team.id, validas[i], una ? titulo.trim() : '', token);
        onSubida(image);
        setHechas(i + 1);
      } catch (err) {
        setSubiendo(null);
        const motivo = /[.!?]$/.test(err.message) ? err.message : `${err.message}.`;
        setError(validas.length > 1
          ? `No se pudo subir la ${i + 1} de ${validas.length}: ${motivo}${i > 0 ? ' Las anteriores ya están en el playbook.' : ''}`
          : err.message);
        return;
      }
    }
    onClose();
  }

  let etiqueta = 'Subir';
  if (subiendo) etiqueta = subiendo.total > 1 ? `Subiendo ${subiendo.actual} de ${subiendo.total}…` : 'Subiendo…';
  else if (hechas > 0) etiqueta = 'Reintentar';

  return (
    // Mientras sube, tocar fuera no cierra: se perdería el aviso si algo falla.
    <Modal title={validas.length > 1 ? `Subir ${validas.length} imágenes` : 'Subir imagen'} onClose={subiendo ? () => {} : onClose}>
      <form onSubmit={subir}>
        {una && (
          <>
            {previas[0] && <img className="playbook-preview" src={previas[0]} alt="" />}
            <div className="field" style={{ marginTop: 16, marginBottom: 0 }}>
              <label htmlFor="playbook-titulo">Título (opcional)</label>
              <input
                id="playbook-titulo"
                type="text"
                value={titulo}
                maxLength={TITULO_MAX}
                placeholder="Ej. Spread derecha, pase rápido"
                onChange={(e) => setTitulo(e.target.value)}
                autoFocus
              />
            </div>
          </>
        )}

        {validas.length > 1 && (
          <>
            <div className="playbook-previews">
              {previas.map((u) => <img key={u} src={u} alt="" />)}
            </div>
            <p className="playbook-note">Les pones título después, desde cada imagen.</p>
          </>
        )}

        {rechazadas.length > 0 && (
          <div className="playbook-rejected">
            {rechazadas.map(({ file, motivo }, i) => (
              <div key={`${file.name}-${i}`}>No se puede subir <strong>{file.name}</strong>: {motivo}.</div>
            ))}
          </div>
        )}

        {error && <div className="form-error" style={{ marginTop: 12, marginBottom: 0 }}>{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={!!subiendo}>Cancelar</button>
          <button type="submit" className="btn btn-accent" disabled={!!subiendo || validas.length === 0}>
            {etiqueta}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditarTitulo({ image, team, token, onGuardado, onClose }) {
  const [titulo, setTitulo] = useState(image.title || '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError('');
    try {
      const { image: editada } = await api.renamePlaybookImage(team.id, image.id, titulo.trim(), token);
      onGuardado(editada);
    } catch (err) {
      setError(err.message);
      setGuardando(false);
    }
  }

  return (
    <Modal title={image.title ? 'Editar título' : 'Ponerle título'} onClose={guardando ? () => {} : onClose}>
      <form onSubmit={guardar}>
        <img
          className="playbook-preview"
          src={imagenAjustada(image.image_url, ANCHO_MINIATURA)}
          alt=""
          onError={(e) => usarOriginal(e, image.image_url)}
        />
        <div className="field" style={{ marginTop: 16, marginBottom: 0 }}>
          <label htmlFor="playbook-titulo-editar">Título</label>
          <input
            id="playbook-titulo-editar"
            type="text"
            value={titulo}
            maxLength={TITULO_MAX}
            placeholder="Ej. Spread derecha, pase rápido"
            onChange={(e) => setTitulo(e.target.value)}
            autoFocus
          />
        </div>
        <p className="playbook-note">Déjalo vacío para quitárselo.</p>

        {error && <div className="form-error" style={{ marginTop: 12, marginBottom: 0 }}>{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="submit" className="btn btn-accent" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// La imagen en pantalla completa. Va en un portal, como el Modal, para que
// cubra también la barra de arriba y no herede nada del panel.
//
// Cierra con la ✕, con Esc o tocando fuera de la imagen; las flechas (en
// pantalla y en el teclado) pasan a la jugada de al lado. El acercamiento con
// dos dedos es el del navegador: no se le quita.
function PantallaCompleta({ images, index, onIndex, onClose }) {
  const image = images[index];
  const hayVarias = images.length > 1;

  useEffect(() => {
    function alTeclear(e) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && hayVarias) onIndex((index + 1) % images.length);
      else if (e.key === 'ArrowLeft' && hayVarias) onIndex((index - 1 + images.length) % images.length);
    }
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [index, images.length, hayVarias, onClose, onIndex]);

  // La página de atrás no se desliza mientras esto está abierto.
  useEffect(() => {
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = antes; };
  }, []);

  const ir = (paso) => (e) => {
    e.stopPropagation();
    onIndex((index + paso + images.length) % images.length);
  };

  return createPortal(
    <div className="playbook-lightbox" role="dialog" aria-modal="true" aria-label={tituloDe(image)} onClick={onClose}>
      <div className="playbook-lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <div className={`playbook-lightbox-title${image.title ? '' : ' is-empty'}`}>{tituloDe(image)}</div>
        {hayVarias && <div className="playbook-lightbox-count">{index + 1} / {images.length}</div>}
        <button type="button" className="playbook-lightbox-close" onClick={onClose} aria-label="Cerrar" autoFocus>✕</button>
      </div>

      <img
        key={image.id}
        className="playbook-lightbox-img"
        src={imagenAjustada(image.image_url, ANCHO_COMPLETA)}
        alt={tituloDe(image)}
        onClick={(e) => e.stopPropagation()}
        onError={(e) => usarOriginal(e, image.image_url)}
      />

      {hayVarias && (
        <>
          <button type="button" className="playbook-lightbox-nav is-prev" onClick={ir(-1)} aria-label="Imagen anterior">‹</button>
          <button type="button" className="playbook-lightbox-nav is-next" onClick={ir(1)} aria-label="Imagen siguiente">›</button>
        </>
      )}
    </div>,
    document.body
  );
}
