// Pruebas de cómo se le pide a Cloudinary una imagen más chica
// (utils/imagenes.js).
//
// Lo que importa no es la cadena exacta sino las dos promesas: que una URL de
// Cloudinary salga con el tamaño puesto en su lugar, y que todo lo demás salga
// intacto. Una URL mal armada es una imagen rota en el playbook.

import test from 'node:test';
import assert from 'node:assert/strict';

import { imagenAjustada } from '../../src/utils/imagenes.js';

const ORIGINAL = 'https://res.cloudinary.com/demo/image/upload/v1696800000/lifa-app/playbook/abc123.jpg';

test('a una URL de Cloudinary se le pone el tamaño justo después de /upload/', () => {
  assert.equal(
    imagenAjustada(ORIGINAL, 640),
    'https://res.cloudinary.com/demo/image/upload/c_limit,w_640,q_auto,f_auto/v1696800000/lifa-app/playbook/abc123.jpg',
  );
});

test('también sin versión en la URL', () => {
  assert.equal(
    imagenAjustada('https://res.cloudinary.com/demo/image/upload/lifa-app/playbook/abc.png', 2000),
    'https://res.cloudinary.com/demo/image/upload/c_limit,w_2000,q_auto,f_auto/lifa-app/playbook/abc.png',
  );
});

test('una URL que ya trae transformación no se toca: no se apilan dos', () => {
  const transformada = imagenAjustada(ORIGINAL, 640);
  assert.equal(imagenAjustada(transformada, 2000), transformada);
});

test('lo que no es Cloudinary sale intacto', () => {
  for (const url of [
    'https://example.com/image/upload/v1/foto.jpg',
    'http://res.cloudinary.com/demo/image/upload/v1/foto.jpg',
    'https://res.cloudinary.com/demo/video/upload/v1/clip.mp4',
    '/uploads/foto.jpg',
  ]) {
    assert.equal(imagenAjustada(url, 640), url);
  }
});

test('sin URL o sin ancho válido, devuelve lo que recibió', () => {
  assert.equal(imagenAjustada(null, 640), null);
  assert.equal(imagenAjustada(undefined, 640), undefined);
  assert.equal(imagenAjustada(ORIGINAL, 0), ORIGINAL);
  assert.equal(imagenAjustada(ORIGINAL, undefined), ORIGINAL);
});
