export default function Loading({ message }) {
  return (
    <div className="loading">
      {message || 'Cargando…'}
      <div style={{ marginTop: 6, fontSize: 11, letterSpacing: '0.1em', opacity: 0.7 }}>
        La primera carga puede tardar unos segundos
      </div>
    </div>
  );
}
