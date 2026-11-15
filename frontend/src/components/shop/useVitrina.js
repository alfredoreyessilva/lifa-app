import { useEffect, useLayoutEffect } from 'react';

// Mientras una página de la tienda está abierta —su vitrina, la compra, un
// pedido— el <body> deja la cancha: el fondo vive en el body, y la barra de
// arriba y el pie no son de esta página. También la barra del navegador del
// celular toma el verde de la placa en vez del de la cancha, y la pestaña lleva
// el título de la página. Todo se regresa al salir. Va en useLayoutEffect para
// que el primer cuadro ya salga sin cancha (README, "La vitrina de una tienda").
export default function useVitrina(titulo) {
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
    if (!titulo) return undefined;
    document.title = `${titulo} · CFBAMX`;
    return () => { document.title = 'CFBAMX'; };
  }, [titulo]);
}
