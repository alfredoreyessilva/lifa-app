import { useEffect, useLayoutEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link, Navigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Loading from '../components/Loading.jsx';
import OrganizationInfoPanel, { redesDeOrganizacion, telDeOrganizacion, initials } from '../components/OrganizationInfoPanel.jsx';
import OrganizationProfileForm from '../components/OrganizationProfileForm.jsx';
import { imagenAjustada } from '../utils/imagenes.js';
import { catalogPrice } from '../utils/money.js';
import { storeHref, whatsappStatus } from '../utils/storePanel.js';
import { mediaHref } from '../utils/mediaPanel.js';

// La página pública de una tienda —su vitrina (StoreFront, abajo)— y el
// formulario de una clínica o una marca.
//
// Solo la TIENDA tiene vista pública aquí: es donde el público ve su catálogo
// y el botón de WhatsApp, que no caben en la ficha. Sale para todos, sea o no
// tuya; si es tuya, "Administrar tienda" lleva a su panel (/panel/tienda/:id,
// README, "El panel de una tienda"), que es donde se edita desde el
// 2026-11-08. Un `?edit=1` viejo de una tienda tuya también lleva allá.
//
// A un medio, una clínica o una marca el público lo ve en su ficha
// (OrganizationInfoPanel): el home y "También transmiten" la abren encima, y
// la vista pública que vivía aquí se borró el 2026-10-30 porque ya nadie
// llegaba a ella. Quien llega por la URL sin administrarlo —el botón "Ver" del
// panel admin, un link viejo— ve la ficha. Un medio tuyo lleva a su panel
// (/panel/medio/:id, README, "El panel de un medio"), con o sin el `?edit=1` de
// antes; una clínica o una marca tuya cae directo en edición, y "Ver como
// público" le abre la ficha.
export default function OrganizationDetailPage() {
  const { id } = useParams();
  const { token, organizations, refreshLeagues } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const mine = (organizations || []).find((o) => String(o.id) === String(id));
  const isMine = Boolean(mine);
  // Se sabe por la sesión, antes de pedir nada.
  const toMediaPanel = mine?.type === 'media';
  const wantsEdit = searchParams.get('edit') === '1';
  const [showFicha, setShowFicha] = useState(false);

  const [org, setOrg] = useState(null);
  const [products, setProducts] = useState(null);
  const [productsError, setProductsError] = useState(false);
  const [error, setError] = useState('');

  // Las dos se piden CON la sesión: una organización privada no existe para el
  // público (404), y esta misma página es el panel de quien la administra
  // (README, "Organizaciones: publicar y verificar").
  useEffect(() => {
    if (toMediaPanel) return;
    load();
    // Catálogo público (ya viene filtrado por el backend: is_active Y
    // show_on_platform). Se pide para cualquier tipo de organización sin
    // problema — si no es tienda, simplemente regresa un arreglo vacío. Si
    // falla se dice que falló: un catálogo vacío diría "esta tienda no
    // publica productos", que no es lo que pasó.
    setProductsError(false);
    api.getPublicProducts(id, token)
      .then((d) => setProducts(d.products))
      .catch(() => { setProducts([]); setProductsError(true); });
  }, [id, token, toMediaPanel]);

  async function load() {
    setError('');
    try {
      setOrg(await api.getOrganization(id, token));
    } catch (e) {
      setError(e.message);
    }
  }

  if (toMediaPanel) return <Navigate to={mediaHref(id)} replace />;

  if (error && !org) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No encontramos esta organización</h3>
          <p>{error}</p>
          <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={() => navigate('/panel')}>Volver a mi panel</button>
        </div>
      </div>
    );
  }

  if (!org) return <Loading />;

  const esTienda = org.type === 'store';

  // Una tienda tuya se administra en su panel, también si llegaste con el
  // `?edit=1` que usaban los enlaces de antes.
  if (esTienda && isMine && wantsEdit) {
    return <Navigate to={storeHref(id)} replace />;
  }

  // Medio, clínica o marca, visto por quien no lo administra: su ficha, que es
  // lo que el público ve de él. Cerrarla lleva al home, donde están los medios.
  if (!esTienda && !isMine) {
    return <OrganizationInfoPanel org={org} onClose={() => navigate('/')} />;
  }

  // La vitrina de una tienda, seas o no el dueño.
  if (esTienda) {
    return <StoreFront org={org} products={products} productsError={productsError} isMine={isMine} />;
  }

  // Clínica o marca, para quien la administra: su formulario. "Ver como
  // público" le abre la ficha, con lo ya guardado.
  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Editar organización</h1>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowFicha(true)}>
          ← Ver como público
        </button>
      </div>
      {showFicha && <OrganizationInfoPanel org={org} onClose={() => setShowFicha(false)} />}
      <EstadoDePublicacion org={org} />

      {/* En la tarjeta negra, como los editores de equipo y de sede
          (.team-editor-preview, que también pasa los campos de verde a gris):
          sobre la cancha, un formulario así de largo no se despegaba del
          fondo. */}
      <OrganizationProfileForm
        org={org}
        token={token}
        className="team-editor-preview"
        style={{ padding: '24px 28px 28px' }}
        onSaved={async (saved) => { setOrg(saved); await refreshLeagues(); }}
      />
    </div>
  );
}

// La vitrina: lo que el público ve de una tienda. Deja la cancha a propósito
// (README, "La vitrina de una tienda"): una placa en el verde de CFBAMX casi
// negro lleva el logo y el nombre de la tienda, y el catálogo va en blanco
// para que el color lo pongan sus productos.
function StoreFront({ org, products, productsError, isMine }) {
  useVitrina(org.name);

  const redes = redesDeOrganizacion(org);
  const whatsapp = whatsappDeLaTienda(org);
  const tieneCanales = Boolean(org.contact_phone || org.contact_email);
  const tieneContacto = Boolean(whatsapp || tieneCanales);

  return (
    <div className="storefront">
      <header className="storefront-plate">
        <div className="storefront-inner">
          {isMine && (
            <div className="storefront-owner">
              <p>
                <span className={`storefront-dot${org.is_public ? ' is-public' : ''}`} aria-hidden="true" />
                {avisoDePublicacion(org)}
              </p>
              <Link to={storeHref(org.id)} className="sf-btn sf-btn-ghost sf-btn-sm">
                Administrar tienda
              </Link>
            </div>
          )}

          {/* Proporción de banner fija, recortada al centro: una foto
              cuadrada o vertical, a su altura natural, se comía la pantalla. */}
          {org.cover_url && (
            <img className="storefront-cover" src={imagenAjustada(org.cover_url, 2000)} alt="" />
          )}

          <div className={`storefront-identity${tieneContacto ? '' : ' is-solo'}`}>
            {/* El logo entero y sobre blanco: hay logos que son un PNG
                transparente pensado para fondo claro, y en el círculo de
                antes un logo cuadrado perdía las esquinas. */}
            <div className="storefront-logo">
              {org.logo_url
                ? <img src={imagenAjustada(org.logo_url, 320)} alt="" />
                : <span aria-hidden="true">{initials(org.name) || org.name[0]}</span>}
            </div>

            <div className="storefront-heading">
              <h1>{org.name}</h1>
              {(org.is_verified || org.country_name) && (
                <div className="storefront-meta">
                  {org.is_verified && (
                    <span className="storefront-seal"><SelloVerificada />Verificada</span>
                  )}
                  {org.country_name && <span>{org.country_name}</span>}
                </div>
              )}
            </div>

            {org.description && <p className="storefront-description">{org.description}</p>}

            {/* En escritorio va a la derecha; en celular, después de la
                descripción y antes de las redes: el botón de WhatsApp es lo
                que más importa de la placa. */}
            {tieneContacto && (
              <div className="storefront-contact">
                {whatsapp && (
                  <a className="sf-btn sf-btn-primary" href={whatsapp} target="_blank" rel="noopener noreferrer">
                    Consultar por WhatsApp
                  </a>
                )}
                {tieneCanales && (
                  <dl className="storefront-channels">
                    {org.contact_phone && (
                      <div>
                        <dt>Teléfono</dt>
                        <dd><a href={telDeOrganizacion(org.contact_phone)}>{org.contact_phone}</a></dd>
                      </div>
                    )}
                    {org.contact_email && (
                      <div>
                        <dt>Correo</dt>
                        <dd><a href={`mailto:${org.contact_email}`}>{org.contact_email}</a></dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>
            )}

            {redes.length > 0 && (
              <div className="storefront-links">
                {redes.map((r) => (
                  <a key={r.key} className="sf-btn sf-btn-ghost sf-btn-sm" href={r.href} target="_blank" rel="noopener noreferrer">
                    {r.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="storefront-catalog" aria-labelledby="storefront-catalogo">
        <div className="storefront-inner">
          <div className="storefront-catalog-head">
            <h2 id="storefront-catalogo">Catálogo</h2>
            {products && products.length > 0 && (
              <span>{products.length} {products.length === 1 ? 'producto' : 'productos'}</span>
            )}
          </div>

          {productsError ? (
            <div className="storefront-empty">
              <p>No se pudo cargar el catálogo. Recarga la página para intentarlo de nuevo.</p>
            </div>
          ) : products === null ? null : products.length === 0 ? (
            <div className="storefront-empty">
              {isMine ? (
                <>
                  <p>Tu catálogo está vacío. Aquí salen los productos activos que marcaste con «Mostrar en mi vitrina».</p>
                  <Link to={storeHref(org.id, 'productos')} className="sf-btn sf-btn-dark sf-btn-sm">
                    Administrar productos
                  </Link>
                </>
              ) : (
                <p>
                  Esta tienda todavía no publica productos aquí.
                  {(tieneContacto || redes.length > 0) && ' Pregúntale directamente por lo que tiene.'}
                </p>
              )}
            </div>
          ) : (
            <ul className="storefront-grid">
              {products.map((p) => {
                const precio = catalogPrice(p.price);
                return (
                  <li key={p.id} className="storefront-product">
                    {/* Cuadrada y sin recortar: las fotos de producto son de
                        estudio, y a una prenda no se le cortan las mangas. */}
                    <div className="storefront-product-photo">
                      {p.image_url
                        ? <img src={imagenAjustada(p.image_url, 640)} alt={p.name} loading="lazy" decoding="async" />
                        : <span className="storefront-product-nophoto" aria-hidden="true">Sin foto</span>}
                    </div>
                    <h3>{p.name}</h3>
                    {p.description && <p className="storefront-product-description">{p.description}</p>}
                    <div className="storefront-product-foot">
                      {precio
                        ? <span className="storefront-price">{precio} <small>{p.currency}</small></span>
                        : <span className="storefront-price is-ask">Precio a consultar</span>}
                      {p.size_variant && <span className="storefront-variant">{p.size_variant}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

// Mientras la vitrina está abierta, el <body> deja la cancha: el fondo vive en
// el body, y la barra de arriba y el pie no son de esta página. También la
// barra del navegador del celular toma el verde de la placa en vez del de la
// cancha, y la pestaña lleva el nombre de la tienda, como las demás páginas
// públicas. Todo se regresa al salir —también al pasar a su panel—. Va en
// useLayoutEffect para que el primer cuadro ya salga sin cancha.
function useVitrina(nombre) {
  useLayoutEffect(() => {
    document.body.classList.add('is-storefront');
    const meta = document.querySelector('meta[name="theme-color"]');
    const colorAntes = meta ? meta.getAttribute('content') : null;
    const placa = getComputedStyle(document.documentElement).getPropertyValue('--sf-plate').trim();
    if (meta && placa) meta.setAttribute('content', placa);
    return () => {
      document.body.classList.remove('is-storefront');
      if (meta && colorAntes) meta.setAttribute('content', colorAntes);
    };
  }, []);

  useEffect(() => {
    document.title = `${nombre} · CFBAMX`;
    return () => { document.title = 'CFBAMX'; };
  }, [nombre]);
}

// El botón del bot de WhatsApp con IA — solo aparece si la tienda tiene el
// plan Pro activo (no vencido) y ya tiene su número configurado desde el Admin
// Panel. Lo decide el backend, que manda el número en `storefront_whatsapp`
// solo entonces, y se lee con `whatsappStatus` (utils/storePanel.js), lo mismo
// que le dice a la tienda, desde su panel, si su vitrina lo lleva.
function whatsappDeLaTienda(org) {
  const { on, sub: numero } = whatsappStatus(org);
  if (!on) return null;
  const texto = `Hola, vi ${org.name} en CFBAMX y quiero preguntar por un producto`;
  return `https://wa.me/${numero.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`;
}

// La palomita del sello va en el amarillo de CFBAMX: es la plataforma la que
// dice que confirmó quién es la tienda.
function SelloVerificada() {
  return (
    <svg className="storefront-seal-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r="8" />
      <path d="M4.6 8.3l2.2 2.2 4.6-4.8" />
    </svg>
  );
}

// Lo que solo ve quien la administra: si la plataforma la muestra. Desde su
// sesión la página se ve igual sea pública o privada, así que sin esto no
// tendría cómo saber que nadie más la ve. Sin botón, a diferencia del aviso de
// una liga: a una organización la publica únicamente el admin de la
// plataforma. Liga y equipo no pasan por aquí (tienen su propio interruptor), y
// un medio tampoco desde el 2026-11-08: su panel dice además qué le falta para
// transmitir (README, "El panel de un medio").
function EstadoDePublicacion({ org }) {
  if (org.type === 'league' || org.type === 'team') return null;
  return (
    <div
      className="form-error"
      style={{
        background: org.is_public ? 'rgba(58,141,63,0.12)' : 'rgba(255,210,63,0.12)',
        borderColor: org.is_public ? 'var(--field)' : 'var(--flag)',
        color: 'var(--ink)', marginTop: 14,
      }}
    >
      {org.is_public && '✓ '}{avisoDePublicacion(org)}
    </div>
  );
}

// El texto del aviso, aparte: la vitrina de una tienda se lo enseña a su dueño
// en su propia barra, con un punto de color en vez de la palomita.
function avisoDePublicacion(org) {
  return org.is_public
    ? 'Es pública: aparece en el home y cualquiera puede ver esta página.'
    : 'Es privada por ahora: no aparece en el home y esta página solo la ven quienes la administran. La publica el equipo de CFBAMX.';
}
