// BRIEF 7 — smoke de RASTERIZADO del compositor. Complemento de `compositor_test.mjs`, que es el
// test puro y corre sin nada; éste prueba el borde impuro: que el árbol que arma el bloque PURO lo
// acepta satori de verdad, que resvg lo convierte en PNG, y que dos corridas de la MISMA entrada
// producen BYTES IDÉNTICOS (el determinismo que pide el brief, medido sobre el archivo final).
//
// REQUIERE: `npm install` (satori + @resvg/resvg-js) y RED (baja la fuente declarada por la marca
// en `brand_typography.css_import`). Por eso NO está en `npm test`: el test que corre en cualquier
// lado es el puro.
//
// Ejecutar:  node tests/compositor_render_smoke.mjs
// Deja el PNG en /tmp/compositor_smoke_<marca>.png para mirarlo con los ojos, que es la única
// verificación que cuenta para una decisión tipográfica.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'api', 'compose.ts'), 'utf8');
const i = source.indexOf('// ── COMPOSITOR:BEGIN ──');
const j = source.indexOf('// ── COMPOSITOR:END ──');
const dir = mkdtempSync(join(tmpdir(), 'compositor-render-'));
const modPath = join(dir, 'block.mts');
writeFileSync(modPath, source.slice(i, j + '// ── COMPOSITOR:END ──'.length), 'utf8');
const M = await import(pathToFileURL(modPath).href);

// Fondo: una escena "limpia" sintética (sin una sola letra, como las que va a generar ImageLab
// tras la cláusula del eje). Se fabrica con resvg para no versionar un binario.
function fondo(w, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#6b7f95"/><stop offset="100%" stop-color="#20262e"/>
    </linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <circle cx="${w * 0.72}" cy="${h * 0.3}" r="${w * 0.18}" fill="#c9b79c" opacity="0.55"/>
  </svg>`;
  return new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
}

async function fontBytes(cssUrl, weight, italic = false) {
  const css = await (await fetch(cssUrl, { headers: { 'User-Agent': 'Mozilla/4.0 (compatible)' } })).text();
  const face = M.pickFontFace(M.parseFontFaces(css), { weight, italic });
  assert.ok(face, `sin @font-face descargable en ${cssUrl}`);
  return { data: Buffer.from(await (await fetch(face.url)).arrayBuffer()), weight: face.weight };
}

const CASOS = [
  {
    marca: 'ForumPHs',
    typography: [
      { role: 'display', font_family: 'EB Garamond', css_import: 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&display=swap' },
      { role: 'body', font_family: 'DM Sans', css_import: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap' },
    ],
    palette: [{ role: 'cream', hex: '#FAFAF7' }, { role: 'dust', hex: '#B8B0A8' }, { role: 'carbon_d', hex: '#0E1018' }, { role: 'terra', hex: '#C4622D' }],
    tokens: {
      layout: { anchor: 'bottom_left', margin_pct: 7, max_width_pct: 78, gap_pct: 2.4, align: 'left',
        scrim: { mode: 'gradient_bottom', palette: 'carbon_d', opacity: 0.82, coverage_pct: 62 },
        rule: { enabled: true, palette: 'terra', width_pct: 12, thickness_px: 4, gap_pct: 2.2 } },
      typography: {
        headline: { role: 'display', weight: 500, line_height: 1.06, letter_spacing_em: -0.005, transform: 'none',
          fit_steps: [{ max_chars: 42, size_pct: 8.4 }, { max_chars: 72, size_pct: 6.6 }, { max_chars: 110, size_pct: 5.2 }] },
        subheadline: { role: 'body', weight: 400, line_height: 1.32, letter_spacing_em: 0, transform: 'none',
          fit_steps: [{ max_chars: 90, size_pct: 3.2 }, { max_chars: 160, size_pct: 2.6 }] },
      },
      palette: { headline: 'cream', subheadline: 'dust' },
    },
    text: { headline: 'La cuota extraordinaria no se vota a mano alzada', subheadline: 'Lo que exige el reglamento, sin adornos.' },
  },
  {
    marca: 'UnrealvilleStudio',
    typography: [
      { role: 'display', font_family: 'Bebas Neue', css_import: 'https://fonts.googleapis.com/css2?family=Bebas+Neue' },
      { role: 'body', font_family: 'Libre Baskerville', css_import: 'https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400' },
    ],
    palette: [{ role: 'text_primary', hex: '#F2F0EC' }, { role: 'bg_primary', hex: '#080808' }, { role: 'accent_primary', hex: '#00FFD1' }],
    tokens: {
      layout: { anchor: 'top_left', margin_pct: 8, max_width_pct: 72, gap_pct: 2.0, align: 'left',
        scrim: { mode: 'gradient_top', palette: 'bg_primary', opacity: 0.86, coverage_pct: 55 },
        rule: { enabled: true, palette: 'accent_primary', width_pct: 9, thickness_px: 3, gap_pct: 1.8 } },
      typography: {
        headline: { role: 'display', weight: 400, line_height: 0.98, letter_spacing_em: 0.01, transform: 'uppercase',
          fit_steps: [{ max_chars: 44, size_pct: 10.5 }, { max_chars: 78, size_pct: 8.0 }, { max_chars: 120, size_pct: 6.2 }] },
        subheadline: { role: 'body', weight: 400, line_height: 1.35, letter_spacing_em: 0, transform: 'none',
          fit_steps: [{ max_chars: 90, size_pct: 3.0 }, { max_chars: 160, size_pct: 2.4 }] },
      },
      palette: { headline: 'text_primary', subheadline: 'text_primary' },
    },
    text: { headline: 'El motor no adivina: lee el dato', subheadline: 'Tipografía compuesta por código, no dibujada por el modelo.' },
  },
];

for (const caso of CASOS) {
  const style = M.resolveOverlayStyle({ tokens: caso.tokens, typography: caso.typography, palette: caso.palette, text: caso.text });
  const png = fondo(1024, 1280);
  const dims = M.imageDimensions(new Uint8Array(png));
  assert.deepEqual([dims.width, dims.height], [1024, 1280]);

  const fonts = [];
  for (const slot of ['headline', 'subheadline']) {
    const s = style.slots[slot];
    const f = await fontBytes(caso.typography.find((t) => t.role === s.role).css_import, s.weight, s.italic);
    fonts.push({ name: s.family, data: f.data, weight: f.weight, style: 'normal' });
  }

  const render = async () => {
    const scene = M.buildOverlayScene({
      style, width: dims.width, height: dims.height,
      backgroundSrc: `data:${dims.mime};base64,${Buffer.from(png).toString('base64')}`,
    });
    const svg = await satori(scene, { width: dims.width, height: dims.height, fonts });
    return new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
  };

  const a = await render();
  const b = await render();
  assert.ok(a.length > 5000, 'el PNG compuesto tiene contenido');
  assert.deepEqual([a[0], a[1], a[2], a[3]], [0x89, 0x50, 0x4e, 0x47], 'es un PNG');
  assert.equal(Buffer.compare(a, b), 0, 'DETERMINISMO: misma entrada ⇒ mismos BYTES');
  const out = `/tmp/compositor_smoke_${caso.marca}.png`;
  writeFileSync(out, a);
  console.log(`  ok   ${caso.marca}: ${a.length} bytes, idéntico entre corridas → ${out}`);
}

console.log('\n✅ compositor_render_smoke — satori + resvg rasterizan la escena, y el PNG es reproducible.\n');
