import { useEffect } from 'react';

// Color de marca del club en el panel de trabajo.
//
// El acento lo elige cada equipo (teams.brand_color), así que el texto que va
// ENCIMA de ese color no se puede fijar a mano: sobre el amarillo de CFBAMX
// tiene que ser negro, sobre un guinda o un azul marino tiene que ser blanco.
// Esto se calcula una vez y se expone como --accent-ink.

function parseHex(hex) {
  const clean = String(hex || '').trim().replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

// Luminancia relativa (WCAG). Se usa el umbral 0.55 en vez del 0.5 ingenuo
// porque el amarillo y el verde se perciben más claros de lo que sugiere un
// promedio simple de canales, y son justo los dos colores más probables en
// un club de football americano.
function readableInk(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return '#1a1300';
  const srgb = [rgb.r, rgb.g, rgb.b].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  return luminance > 0.55 ? '#1a1300' : '#ffffff';
}

function isValidHexColor(hex) {
  return parseHex(hex) !== null;
}

// Variables en línea para el contenedor del workspace. Si el club no eligió
// color, no se devuelve nada y todo hereda el amarillo de CFBAMX de :root —
// así ningún panel queda sin acento por no haber configurado el color.
function accentVars(brandColor) {
  if (!isValidHexColor(brandColor)) return undefined;
  return { '--accent': brandColor, '--accent-ink': readableInk(brandColor) };
}

// Aplica el acento del club a :root mientras el panel esté montado.
//
// No basta con ponerlo en el contenedor del workspace: los modales se montan
// con createPortal en document.body (ver components/Modal.jsx), o sea FUERA de
// ese árbol, así que var(--accent) ahí resolvía al amarillo de :root y los
// botones del modal salían de otro color que el resto del panel.
//
// Se restaura al desmontar para que salir del panel de un equipo no le deje su
// color pintado al resto de la app.
export function useAccentColor(brandColor) {
  useEffect(() => {
    const vars = accentVars(brandColor);
    if (!vars) return undefined;

    const root = document.documentElement;
    const previous = Object.keys(vars).map((k) => [k, root.style.getPropertyValue(k)]);
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));

    return () => {
      previous.forEach(([k, v]) => {
        if (v) root.style.setProperty(k, v);
        else root.style.removeProperty(k);
      });
    };
  }, [brandColor]);
}
