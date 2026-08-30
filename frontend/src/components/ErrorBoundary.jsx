import { Component } from 'react';

// Por defecto, si cualquier componente lanza un error no controlado durante
// el render, React desmonta TODO el árbol desde la raíz hacia abajo — en
// LIFA eso se traducía en una pantalla en blanco, con TopBar, SponsorBar y
// footer incluidos. Este ErrorBoundary atrapa esos errores dentro de su
// propio subárbol para mostrar un mensaje de "algo salió mal" en vez de
// dejar todo en blanco.
//
// Tiene que ser un class component: los ErrorBoundary de React solo
// funcionan con getDerivedStateFromError / componentDidCatch, no existe
// todavía un equivalente con hooks.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Punto único donde engancharíamos un reporte a un servicio de logging
    // (Sentry, etc.) más adelante.
    console.error('[ErrorBoundary] error atrapado:', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="container">
          <div className="empty-state">
            <h3>Algo salió mal</h3>
            <p>Ocurrió un error inesperado. Por favor recarga la página.</p>
            <button
              type="button"
              className="btn btn-outline"
              onClick={this.handleReload}
              style={{ marginTop: 16 }}
            >
              Recargar página
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
