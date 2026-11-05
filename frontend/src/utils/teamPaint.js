// La pintura de un equipo: de qué color va su end zone en la página de un
// partido (README, "La página de un partido").
//
// `teams.brand_color` manda, pero de 217 equipos solo uno lo capturó. En cambio
// todos tienen logo, y casi todos los logos son cascos: el color del equipo ya
// está ahí. Se lee en el navegador al abrir la página (regla 4): nadie captura
// nada, y si un equipo cambia de logo, su cancha cambia sola.
//
// Funciones PURAS: reciben pixeles y regresan colores, para probarlas con
// node --test y sin navegador. El canvas vive en useTeamPaint.js.

// Sin logo, o con uno que no se pudo leer: el verde de la cancha, ya de noche.
export const PINTURA_NEUTRA = Object.freeze({ fondo: '#1f4a30', tinta: '#ffffff' });

// Lo que no dice nada del equipo: los grises del metal, el blanco del casco y
// el negro de la careta.
const SATURACION_MINIMA = 0.3;
const LUZ_MINIMA = 0.1;
const LUZ_MAXIMA = 0.9;

const limitar = (n, min, max) => Math.min(max, Math.max(min, n));

function aHsl(r, g, b) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: h * 60, s, l };
}

function aHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
      : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c]
          : h < 300 ? [x, 0, c]
            : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function deHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function esHex(valor) {
  return typeof valor === 'string' && /^#[0-9a-f]{6}$/i.test(valor.trim());
}

// Lee un logo ya reducido a un cuadro de `lado` × `lado` (RGBA, como el de
// getImageData) y dice dos cosas:
//
//   color  el tono que más pesa, o null si el logo es puro blanco y negro.
//   forma  cómo se pone sobre el pasto, según sus esquinas y cuánto ocupa:
//            casco  fondo transparente: va directo y a todo lo que da.
//            placa  casi todo lleno, con las esquinas redondeadas vacías: los
//                   logos de la LFA. Va directo, pero más chico: a tamaño de
//                   casco un cuadro lleno pesa el doble.
//            disco  con fondo propio, un JPG sobre negro o sobre blanco: sin
//                   recortarlo en un círculo se vería el cuadro de la foto.
//
// El peso es la saturación al cuadrado para que un filo suavizado no le gane al
// color de verdad: en el casco blanco de TECOS, el rosa que queda entre el rojo
// y el blanco ocupa casi tantos pixeles como el rojo.
export function leerLogo(pixeles, lado) {
  const cubetas = new Map();
  let llenos = 0;
  for (let i = 0; i < pixeles.length; i += 4) {
    if (pixeles[i + 3] < 128) continue;
    llenos += 1;
    const r = pixeles[i];
    const g = pixeles[i + 1];
    const b = pixeles[i + 2];
    const { h, s, l } = aHsl(r, g, b);
    if (s < SATURACION_MINIMA || l < LUZ_MINIMA || l > LUZ_MAXIMA) continue;
    const llave = Math.round(h / 20) % 18;
    const c = cubetas.get(llave) || { peso: 0, r: 0, g: 0, b: 0 };
    const peso = s * s;
    c.peso += peso;
    c.r += r * peso;
    c.g += g * peso;
    c.b += b * peso;
    cubetas.set(llave, c);
  }

  let mejor = null;
  for (const c of cubetas.values()) if (!mejor || c.peso > mejor.peso) mejor = c;

  const color = mejor
    ? `#${[mejor.r, mejor.g, mejor.b]
      .map((v) => Math.round(v / mejor.peso).toString(16).padStart(2, '0')).join('')}`
    : null;

  const alfaDe = (fila, columna) => pixeles[(fila * lado + columna) * 4 + 3];
  const fin = lado - 1;
  const esquinasVacias = [alfaDe(0, 0), alfaDe(0, fin), alfaDe(fin, 0), alfaDe(fin, fin)].every((a) => a < 200);
  const lleno = llenos / (pixeles.length / 4) > 0.85;

  return { color, forma: !esquinasVacias ? 'disco' : lleno ? 'placa' : 'casco' };
}

function luminancia(hex) {
  const { r, g, b } = deHex(hex);
  const canal = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

export function contraste(a, b) {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

const TINTA_CLARA = '#ffffff';
const TINTA_OSCURA = '#15120a';

// El nombre va pintado en la que más se lea: un amarillo lleva letra oscura,
// como la end zone de Zorros en su propia portada.
export function tintaSobre(fondo) {
  return contraste(fondo, TINTA_CLARA) >= contraste(fondo, TINTA_OSCURA) ? TINTA_CLARA : TINTA_OSCURA;
}

// El color tal como sale de un casco trae el brillo del metal: un dorado queda
// en mostaza, y un azul claro de filo, lavado. Aquí se lleva al tono con que se
// pintaría una cancha. Los amarillos se quedan claros porque oscurecidos se
// vuelven café, y un color casi gris no se satura o saldría rojo.
export function pinturaDeZona(hex) {
  const { r, g, b } = deHex(hex);
  const { h, s, l } = aHsl(r, g, b);
  const amarillo = h >= 36 && h <= 70;
  let fondo;
  if (s < 0.12) fondo = aHex(h, s, limitar(l, 0.12, 0.3));
  else if (amarillo) fondo = aHex(h, Math.max(s, 0.8), limitar(l, 0.47, 0.55));
  else fondo = aHex(h, Math.max(s, 0.55), limitar(l, 0.26, 0.45));
  return { fondo, tinta: tintaSobre(fondo) };
}
