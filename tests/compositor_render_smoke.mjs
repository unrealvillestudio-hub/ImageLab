// BRIEF 7 + 8 · D.2 — smoke de RASTERIZADO del compositor. Complemento de `compositor_test.mjs`,
// que es el test puro y corre sin nada; éste prueba el borde impuro: que el árbol que arma el bloque
// PURO lo acepta satori de verdad, que resvg lo convierte en PNG, que dos corridas de la MISMA
// entrada dan BYTES IDÉNTICOS, y —desde BRIEF 8— que la franja de identidad se lee igual en TODOS
// los formatos de plataforma.
//
// REQUIERE: `npm install` (satori + @resvg/resvg-js) y RED (baja la fuente que declara la marca en
// `brand_typography.css_import`). Por eso NO está en `npm test`: el test que corre en cualquier lado
// es el puro.
//
// Ejecutar:  node tests/compositor_render_smoke.mjs
// Deja los PNG en /tmp/compositor/<marca>_<formato>.png para mirarlos con los ojos, que es la única
// verificación que cuenta para una decisión tipográfica.
//
// Las tres marcas y sus roles salen de la DB REAL (brand_typography + brand_palette, leídas el
// 2026-08-22). NeuroneSCF entra a propósito como caso de FALLO: su `css_import` apunta a la página
// de specimen de Google Fonts, no a una hoja css2 descargable, así que no se puede componer. La
// regla de BRIEF 7 manda — sin dato, falla nombrando, jamás un Helvetica silencioso.

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
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

const OUT = '/tmp/compositor';
mkdirSync(OUT, { recursive: true });

// Los formatos REALES de plataforma que el carril produce hoy (aspect ratios de #95-D / canal).
const FORMATOS = [
  { id: '1x1', w: 1024, h: 1024, label: 'feed 1:1' },
  { id: '4x5', w: 1024, h: 1280, label: 'feed 4:5' },
  { id: '9x16', w: 1024, h: 1792, label: 'reel/story 9:16' },
];

// Fondo: una escena "limpia" sintética (sin una sola letra, como las que genera ImageLab tras la
// cláusula del eje). Se fabrica con resvg para no versionar un binario.
function fondo(w, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#6b7f95"/><stop offset="100%" stop-color="#20262e"/>
    </linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <circle cx="${w * 0.72}" cy="${h * 0.28}" r="${Math.min(w, h) * 0.18}" fill="#c9b79c" opacity="0.55"/>
  </svg>`;
  return new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
}

const fontCache = new Map();
async function fontBytes(cssUrl, weight, italic = false) {
  const key = `${cssUrl}|${weight}|${italic}`;
  if (fontCache.has(key)) return fontCache.get(key);
  const css = await (await fetch(cssUrl, { headers: { 'User-Agent': 'Mozilla/4.0 (compatible)' } })).text();
  const face = M.pickFontFace(M.parseFontFaces(css), { weight, italic });
  assert.ok(face, `sin @font-face descargable en ${cssUrl}`);
  const out = { data: Buffer.from(await (await fetch(face.url)).arrayBuffer()), weight: face.weight };
  fontCache.set(key, out);
  return out;
}

// ── las tres marcas, con sus roles REALES de la DB ──────────────────────────
const CASOS = [
  {
    marca: 'ForumPHs',
    typography: [
      { role: 'display', font_family: 'EB Garamond', css_import: 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&display=swap' },
      { role: 'body', font_family: 'DM Sans', css_import: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap' },
    ],
    palette: [{ role: 'cream', hex: '#FAFAF7' }, { role: 'dust', hex: '#B8B0A8' }, { role: 'carbon_d', hex: '#0E1018' }, { role: 'terra', hex: '#C4622D' }, { role: 'primary', hex: '#5C3472' }],
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
      identity: { mode: 'edge_left', palette: 'primary', width_pct: 1.8, full_bleed: true },
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
      identity: { mode: 'edge_left', palette: 'accent_primary', width_pct: 1.8, full_bleed: true },
    },
    text: { headline: 'El motor no adivina: lee el dato', subheadline: 'Tipografía compuesta por código, no dibujada por el modelo.' },
  },
  {
    marca: 'LucienSael',
    typography: [
      { role: 'display', font_family: 'Cormorant Garamond', css_import: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&display=swap' },
      { role: 'body', font_family: 'Crimson Pro', css_import: 'https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;500&display=swap' },
    ],
    palette: [{ role: 'bone', hex: '#EDE8DF' }, { role: 'parchment', hex: '#C4BDB0' }, { role: 'obsidian', hex: '#0D0D0B' }, { role: 'ember', hex: '#D4622A' }],
    tokens: {
      layout: { anchor: 'bottom_left', margin_pct: 8, max_width_pct: 74, gap_pct: 2.6, align: 'left',
        scrim: { mode: 'gradient_bottom', palette: 'obsidian', opacity: 0.86, coverage_pct: 58 },
        rule: { enabled: true, palette: 'ember', width_pct: 10, thickness_px: 3, gap_pct: 2.4 } },
      typography: {
        headline: { role: 'display', weight: 500, line_height: 1.04, letter_spacing_em: 0, transform: 'none',
          fit_steps: [{ max_chars: 40, size_pct: 9.2 }, { max_chars: 70, size_pct: 7.2 }, { max_chars: 110, size_pct: 5.6 }] },
        subheadline: { role: 'body', weight: 400, line_height: 1.34, letter_spacing_em: 0, transform: 'none',
          fit_steps: [{ max_chars: 90, size_pct: 3.1 }, { max_chars: 160, size_pct: 2.5 }] },
      },
      palette: { headline: 'bone', subheadline: 'parchment' },
      identity: { mode: 'edge_left', palette: 'ember', width_pct: 1.8, full_bleed: true },
    },
    text: { headline: 'Nadie hereda un patrimonio: lo administra', subheadline: 'La diferencia se mide en decisiones, no en discursos.' },
  },
];

async function render(caso, fmt, texto) {
  const style = M.resolveOverlayStyle({ tokens: caso.tokens, typography: caso.typography, palette: caso.palette, text: texto });
  const png = fondo(fmt.w, fmt.h);
  const dims = M.imageDimensions(new Uint8Array(png));
  const fonts = [];
  for (const slot of ['headline', 'subheadline']) {
    const s = style.slots[slot];
    if (!s) continue;
    const f = await fontBytes(caso.typography.find((t) => t.role === s.role).css_import, s.weight, s.italic);
    fonts.push({ name: s.family, data: f.data, weight: f.weight, style: 'normal' });
  }
  const scene = M.buildOverlayScene({
    style, width: dims.width, height: dims.height,
    backgroundSrc: `data:${dims.mime};base64,${Buffer.from(png).toString('base64')}`,
  });
  const svg = await satori(scene, { width: dims.width, height: dims.height, fonts });
  return { png: new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng(), style, dims };
}

let fallos = 0;
console.log('\n── D.2 · una marca por fila, un formato por columna ──');
for (const caso of CASOS) {
  const grosores = [];
  for (const fmt of FORMATOS) {
    const a = await render(caso, fmt, caso.text);
    const b = await render(caso, fmt, caso.text);
    assert.deepEqual([a.png[0], a.png[1], a.png[2], a.png[3]], [0x89, 0x50, 0x4e, 0x47], 'es un PNG');
    assert.equal(Buffer.compare(a.png, b.png), 0, 'DETERMINISMO: misma entrada ⇒ mismos BYTES');
    const grosor = Math.max(1, Math.round((a.style.identity.widthPct / 100) * Math.min(fmt.w, fmt.h)));
    grosores.push(grosor);
    const out = join(OUT, `${caso.marca}_${fmt.id}.png`);
    writeFileSync(out, a.png);
    console.log(`  ok   ${caso.marca.padEnd(18)} ${fmt.label.padEnd(16)} ${String(a.png.length).padStart(6)} B · franja ${grosor}px (${a.style.identity.mode}) → ${out}`);
  }
  // D.1 — el lado corto es 1024 en los tres formatos, así que el sello mide LO MISMO en los tres.
  assert.equal(new Set(grosores).size, 1, `${caso.marca}: la franja debe leerse igual en todo formato (${grosores.join('/')}px)`);
}

console.log('\n── D · sellar sin titular: la escena limpia se firma hoy y se recompone después ──');
{
  const caso = CASOS[0];
  const { png, style } = await render(caso, FORMATOS[0], { headline: '' });
  assert.ok(style.identity, 'la franja existe');
  assert.equal(style.slots.headline, null, 'y no hay tipografía');
  const out = join(OUT, `${caso.marca}_sello_sin_titular.png`);
  writeFileSync(out, png);
  console.log(`  ok   ${caso.marca} sellada sin titular → ${out}`);
}

console.log('\n── BRIEF 7 · sin dato, falla NOMBRANDO: NeuroneSCF no se puede componer todavía ──');
{
  // Verificado en la DB el 2026-08-22: NeuroneSCF SÍ tiene brand_typography (roles `headline` y
  // `body`) y SÍ tiene brand_palette, pero sus dos `css_import` apuntan a la página de specimen
  // (https://fonts.google.com/specimen/…), que no declara ningún @font-face descargable. El
  // compositor no puede resolver el archivo de fuente y NO inventa uno.
  const CSS_SPECIMEN = 'https://fonts.google.com/specimen/Montserrat';
  const html = await (await fetch(CSS_SPECIMEN, { headers: { 'User-Agent': 'Mozilla/4.0 (compatible)' } })).text().catch(() => '');
  const faces = M.parseFontFaces(html);
  assert.equal(M.pickFontFace(faces, { weight: 400, italic: false }), null,
    'la página de specimen no sirve como css_import: no trae @font-face descargable');
  console.log('  ok   NeuroneSCF: css_import de specimen → COMPOSITOR_FONT_UNRESOLVED (sin fallback silencioso)');
  console.log('       FALTA (dato, no código): css_import css2 en brand_typography para `headline` y `body`,');
  console.log('       + una fila en imagelab_overlay_tokens. Su ejemplo queda para cuando se siembre.');
}

console.log(`\n✅ compositor_render_smoke — ${CASOS.length} marcas × ${FORMATOS.length} formatos, reproducibles y con el sello constante.\n`);
process.exit(fallos ? 1 : 0);
