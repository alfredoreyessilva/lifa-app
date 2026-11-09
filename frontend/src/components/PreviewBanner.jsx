// El aviso de la vista previa de una liga sin publicar (README, "La vista
// previa de una liga sin publicar"). Va donde quien la administra ve algo que
// el público todavía no: desde su sesión la página se ve igual que siempre, y
// sin el aviso no tendría cómo saber que nadie más la ve — mandaría el link y a
// los demás les saldría "No encontramos esta liga".
//
// Quién lo ve lo decide el backend (`preview: true` en la respuesta), no esta
// pantalla: el admin de la plataforma no trae en su sesión las ligas que revisa.
// Va en el azul informativo de los paneles y no en amarillo: es un mensaje de la
// herramienta, no parte de la página que verá el público.
export default function PreviewBanner({ children }) {
  return (
    <aside className="preview-banner">
      <span className="preview-banner-tag">Vista previa</span>
      <p className="preview-banner-text">
        {children || 'Esta liga todavía no es pública: el público no ve esta página hasta que CFBAMX la publique.'}
      </p>
    </aside>
  );
}
