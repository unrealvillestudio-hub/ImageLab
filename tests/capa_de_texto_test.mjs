// 1.24.0 — LA CAPA DE TEXTO PARA VIDEO (`output: 'text_layer'`).
//
// EL CASO. Contrato de VideoLab v1.0.0 (VideoLab#5, 2026-11-07): el texto sobre el video lo hace el compositor de
// ImageLab, sin duplicar reglas de marca. VideoLab necesita la capa SIN la foto de fondo (PNG con alfa) para ponerla
// sobre un video que se mueve; las decisiones (zona segura, caras, producto, contraste, tamaños) se toman igual que
// siempre, sobre la imagen limpia.
//
// QUÉ AFIRMA, y la regla se rompe a propósito al final (CC_PROTOCOL §14.2):
//   1. `parseOutputRequest`: ausente ⇒ 'image'; 'text_layer' se acepta; cualquier otra cosa es un 400 con su nombre.
//   2. La escena con `omitBackground` es la MISMA escena sin la foto: mismo velo, mismo sello, mismo texto, mismas
//      posiciones. Ni un nodo más, ni uno distinto.
//   3. Sin `omitBackground`, la escena es byte a byte la de antes (la foto es el primer nodo).
//   4. El handler: la capa se arma con el MISMO estilo final que la imagen; la respuesta sólo suma claves con
//      `text_layer`; con carrusel, 400.
//   5. Marca N+1: dos marcas sintéticas, de tokens distintos, dan el mismo resultado estructural.
//
// Ejecutar:  node tests/capa_de_texto_test.mjs     (Node ≥ 22.18, sin red ni dependencias)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = readFileSync(join(ROOT, 'api', 'compose.ts'), 'utf8');

async function cargarBloque(source) {
  const i = source.indexOf('// ── COMPOSITOR:BEGIN ──');
  const j = source.indexOf('// ── COMPOSITOR:END ──');
  assert.ok(i >= 0 && j > i, 'centinelas del bloque COMPOSITOR');
  const dir = mkdtempSync(join(tmpdir(), 'capa-texto-'));
  const file = join(dir, 'bloque.mts');
  writeFileSync(file, `${source.slice(i, j + '// ── COMPOSITOR:END ──'.length)}\n`, 'utf8');
  return import(pathToFileURL(file).href);
}

const M = await cargarBloque(SOURCE);

// Dos marcas SINTÉTICAS (test de la marca N+1): otra tipografía, otros nombres de rol, otra posición.
const MARCAS = [
  {
    typo: [{ role: 'titular', font_family: 'Fuente Uno', css_import: 'https://example.invalid/uno.css', fallback: null },
           { role: 'cuerpo', font_family: 'Fuente Dos', css_import: 'https://example.invalid/dos.css', fallback: null }],
    pal: [{ role: 'claro', hex: '#FAFAF7' }, { role: 'oscuro', hex: '#0E1018' }, { role: 'acento', hex: '#C4622D' }],
    tokens: {
      layout: { anchor: 'bottom_left', margin_pct: 7, max_width_pct: 78, gap_pct: 2.4, align: 'left',
        scrim: { mode: 'gradient_bottom', palette: 'oscuro', opacity: 0.8, coverage_pct: 60 } },
      typography: {
        headline: { role: 'titular', weight: 500, line_height: 1.06, letter_spacing_em: 0, transform: 'none',
          fit_steps: [{ max_chars: 60, size_pct: 7 }] },
        subheadline: { role: 'cuerpo', weight: 400, line_height: 1.3, letter_spacing_em: 0, transform: 'none',
          fit_steps: [{ max_chars: 120, size_pct: 3 }] },
      },
      palette: { headline: 'claro', subheadline: 'claro' },
      identity: { mode: 'edge_left', palette: 'acento', width_pct: 1.8, full_bleed: true },
    },
  },
  {
    typo: [{ role: 'display', font_family: 'Fuente Tres', css_import: 'https://example.invalid/tres.css', fallback: null },
           { role: 'texto', font_family: 'Fuente Cuatro', css_import: 'https://example.invalid/cuatro.css', fallback: null }],
    pal: [{ role: 'blanco', hex: '#F2F0EC' }, { role: 'negro', hex: '#080808' }],
    tokens: {
      layout: { anchor: 'top_left', margin_pct: 8, max_width_pct: 72, gap_pct: 2, align: 'left',
        scrim: { mode: 'gradient_top', palette: 'negro', opacity: 0.86, coverage_pct: 55 } },
      typography: {
        headline: { role: 'display', weight: 400, line_height: 1, letter_spacing_em: 0.01, transform: 'uppercase',
          fit_steps: [{ max_chars: 60, size_pct: 9 }] },
        subheadline: { role: 'texto', weight: 400, line_height: 1.35, letter_spacing_em: 0, transform: 'none',
          fit_steps: [{ max_chars: 120, size_pct: 3 }] },
      },
      palette: { headline: 'blanco', subheadline: 'blanco' },
    },
  },
];
const TXT = { headline: 'Lo que el producto hace en treinta segundos', subheadline: 'Sin adornos.' };
const FOTO = 'data:image/png;base64,AA';

let fallos = 0;
function caso(nombre, fn) {
  try { fn(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.error(`  MAL ${nombre}\n      ${e.message}`); }
}

console.log('capa_de_texto — 1.24.0');

caso('1 · parseOutputRequest: ausente ⇒ image; text_layer se acepta; otro valor ⇒ 400 nombrado', () => {
  assert.equal(M.parseOutputRequest(undefined), 'image');
  assert.equal(M.parseOutputRequest(''), 'image');
  assert.equal(M.parseOutputRequest('image'), 'image');
  assert.equal(M.parseOutputRequest('text_layer'), 'text_layer');
  assert.throws(() => M.parseOutputRequest('video'), (e) => e.label === 'COMPOSITOR_OUTPUT_INVALID' && e.status === 400);
  assert.throws(() => M.parseOutputRequest(1), (e) => e.label === 'COMPOSITOR_OUTPUT_INVALID');
});

MARCAS.forEach((m, k) => {
  const style = M.resolveOverlayStyle({ tokens: m.tokens, typography: m.typo, palette: m.pal, text: TXT });
  const normal = M.buildOverlayScene({ style, width: 1080, height: 1920, backgroundSrc: FOTO });
  const capa = M.buildOverlayScene({ style, width: 1080, height: 1920, backgroundSrc: FOTO, omitBackground: true });

  caso(`2 · marca sintética ${k + 1}: la capa es la misma escena sin la foto`, () => {
    const hijos = normal.props.children;
    assert.equal(hijos[0].type, 'img');
    assert.equal(hijos[0].props.src, FOTO);
    assert.deepEqual(capa.props.children, hijos.slice(1));
    assert.deepEqual(capa.props.style, normal.props.style);
    assert.ok(!JSON.stringify(capa).includes(FOTO), 'la foto no aparece en la capa');
    assert.ok(JSON.stringify(capa).includes(TXT.headline), 'el titular sí');
  });

  caso(`3 · marca sintética ${k + 1}: sin omitBackground, la escena de siempre`, () => {
    const explicito = M.buildOverlayScene({ style, width: 1080, height: 1920, backgroundSrc: FOTO, omitBackground: false });
    assert.deepEqual(explicito, normal);
  });
});

caso('4 · handler: la capa usa el MISMO estilo final, la misma foto decidida y el mismo producto', () => {
  const m = SOURCE.match(/const layerScene = buildOverlayScene\(\{([\s\S]*?)\}\);/);
  assert.ok(m, 'no se arma la capa en el handler');
  for (const parte of ['style: finalStyle', 'products: productImgs', 'productLayer: prodPick.layer', 'omitBackground: true']) {
    assert.ok(m[1].includes(parte), `la capa no recibe ${parte}`);
  }
});

caso('4 · handler: sin text_layer la respuesta no suma claves; con carrusel, 400', () => {
  assert.match(SOURCE, /\.\.\.\(layerOut \?\? \{\}\)/);
  assert.match(SOURCE, /let layerOut: Record<string, unknown> \| null = null;\s+if \(outputIn === 'text_layer'\)/);
  assert.match(SOURCE, /outputIn === 'text_layer' && carouselIn\) \{\s+throw new CompositorError\('COMPOSITOR_OUTPUT_INVALID'/);
});

// 5 · la regla se rompe a propósito: con la foto devuelta a la capa, el caso 2 tiene que fallar.
const roto = SOURCE.replace("if (!args.omitBackground) children.push({", "children.push({");
const R = await cargarBloque(roto);
caso('5 · regla rota a propósito: si la capa conservara la foto, el caso 2 lo ve', () => {
  assert.notEqual(roto, SOURCE);
  const style = R.resolveOverlayStyle({ tokens: MARCAS[0].tokens, typography: MARCAS[0].typo, palette: MARCAS[0].pal, text: TXT });
  const normal = R.buildOverlayScene({ style, width: 1080, height: 1920, backgroundSrc: FOTO });
  const capa = R.buildOverlayScene({ style, width: 1080, height: 1920, backgroundSrc: FOTO, omitBackground: true });
  assert.throws(() => assert.deepEqual(capa.props.children, normal.props.children.slice(1)));
  assert.ok(JSON.stringify(capa).includes(FOTO));
});
if (fallos) { console.error(`\n${fallos} caso(s) en rojo`); process.exit(1); }
console.log('\ncapa_de_texto: todo en verde');
