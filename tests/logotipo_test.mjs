/**
 * LOGOTIPO DEL LAB — el nombre conserva su caja con una display sin minúsculas (Sam, 2026-10-26).
 * Requiere Node >= 22.18 (type stripping nativo).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tramosDeCaja } from '../src/utils/logotipo.ts';

assert.deepEqual(tramosDeCaja('ImageLab'), [
  { texto: 'I', minuscula: false }, { texto: 'mage', minuscula: true },
  { texto: 'L', minuscula: false }, { texto: 'ab', minuscula: true },
]);
assert.equal(tramosDeCaja('ImageLab').map((t) => t.texto).join(''), 'ImageLab', 'no se pierde ni se duplica una letra');
assert.deepEqual(tramosDeCaja('IID'), [{ texto: 'IID', minuscula: false }]);

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(css, /\.lt-chevron \{[^}]*animation: prompt-blink 1\.1s step-end infinite/, 'el chevron parpadea');
assert.match(css, /\.lt-logotype \{[^}]*font-family: 'Bebas Neue'/, 'el logotipo va en Bebas Neue');
assert.match(html, /family=Bebas\+Neue/, 'Bebas Neue se carga');
console.log('logotipo: OK');
