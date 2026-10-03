// F3 (2026-10-02) — smoke de RASTERIZADO de las láminas de carrusel (maqueta v4). Hermano de
// `compositor_render_smoke.mjs`: aquél prueba la escena de 1.2.0; éste, `buildCarouselScene`.
//
// Cuatro marcas × cinco láminas en 4:5 — portada con foto, cifra sobre superficie, cifra sobre
// superficie, pasos con foto y cierre con CTA — más dos comprobaciones: misma entrada ⇒ mismos
// BYTES, y una marca SIN `tokens.carousel` compone exactamente como 1.2.0.
//
// DE DÓNDE SALE EL DATO. Los tokens de carrusel, las funciones de color, los roles nuevos de paleta
// y los logotipos se leen del ARCHIVO DE SIEMBRA (`CAROUSEL_SEED_SQL`), no de la base: lo que se mira
// en la revisión es exactamente lo que se va a sembrar. Las filas que ya existen (tokens base de cada
// marca, brand_typography, brand_palette) son fixtures leídos de la base el 2026-10-02.
//
// REQUIERE: `npm install` y RED (fuentes de `brand_typography.css_import`). No está en `npm test`.
//
// Ejecutar:
//   CAROUSEL_SEED_SQL=/ruta/f3_seed.sql \
//   CAROUSEL_RENDER_OUT=/ruta/salida \            (opcional; por defecto /tmp/compositor/carousel)
//   CAROUSEL_BG_DIR=/ruta/fondos \                (opcional; <marca>_cover.jpg y <marca>_steps.jpg;
//                                                   sin ellos, una escena sintética)
//   node tests/compositor_carousel_smoke.mjs

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
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
const dir = mkdtempSync(join(tmpdir(), 'compositor-carousel-'));
const modPath = join(dir, 'block.mts');
writeFileSync(modPath, source.slice(i, j + '// ── COMPOSITOR:END ──'.length), 'utf8');
const M = await import(pathToFileURL(modPath).href);

const SEED = process.env.CAROUSEL_SEED_SQL;
assert.ok(SEED && existsSync(SEED), 'CAROUSEL_SEED_SQL debe apuntar al archivo de siembra F3');
const seed = readFileSync(SEED, 'utf8');
const OUT = process.env.CAROUSEL_RENDER_OUT || '/tmp/compositor/carousel';
mkdirSync(OUT, { recursive: true });
const BG_DIR = process.env.CAROUSEL_BG_DIR || '';

/** Bloque dollar-quoted `$tag$ … $tag$` de la siembra. */
function dq(tag) {
  const open = `$${tag}$`;
  const a = seed.indexOf(open);
  assert.ok(a >= 0, `la siembra no trae el bloque ${open}`);
  const b = seed.indexOf(open, a + open.length);
  return seed.slice(a + open.length, b).trim();
}
/** Filas nuevas de brand_palette: ('Marca', 'rol', 'Nombre', '#HEX', 'uso'). */
function seededPalette(brand) {
  const out = [];
  for (const m of seed.matchAll(/\('([^']+)', '([^']+)', '[^']*', '(#[0-9A-Fa-f]{6})'/g)) if (m[1] === brand) out.push({ role: m[2], hex: m[3] });
  return out;
}

// ── fixtures REALES (DB, 2026-10-02): lo que ya existe y la siembra no toca ─────────────────
const T = (role, font_family, css_import) => ({ role, font_family, css_import });
const P = (o) => Object.entries(o).map(([role, hex]) => ({ role, hex }));
const SCRIM_CAROUSEL = { layout: { scrim: { mode: 'gradient_bottom', opacity: 0.84, coverage_pct: 62 }, anchor: 'bottom_left', max_width_pct: 80 } };
const BASE = {
  UnrealvilleStudio: {
    typography: [
      T('display', 'Bebas Neue', 'https://fonts.googleapis.com/css2?family=Bebas+Neue'),
      T('body', 'Libre Baskerville', 'https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400'),
      T('mono', 'Space Mono', 'https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400'),
    ],
    palette: P({ accent_primary: '#00FFD1', accent_secondary: '#FFB020', bg_primary: '#080808', bg_secondary: '#0F0F0F', bg_tertiary: '#1A1A1A', text_primary: '#F2F0EC' }),
    tokens: {
      layout: { rule: { enabled: true, gap_pct: 2.2, palette: 'accent_primary', width_pct: 12, thickness_px: 4 }, align: 'left',
        scrim: { mode: 'gradient_top', opacity: 0.86, palette: 'bg_primary', coverage_pct: 55 }, anchor: 'top_left', gap_pct: 2, margin_pct: 8, max_width_pct: 72 },
      palette: { headline: 'text_primary', subheadline: 'text_primary' },
      identity: { mode: 'edge_left', palette: 'accent_primary', width_pct: 1.8, full_bleed: true },
      typography: {
        headline: { role: 'display', weight: 400, fit_steps: [{ size_pct: 10.5, max_chars: 44 }, { size_pct: 8, max_chars: 78 }, { size_pct: 6.2, max_chars: 120 }], transform: 'uppercase', line_height: 0.98, letter_spacing_em: 0.01 },
        subheadline: { role: 'body', weight: 400, fit_steps: [{ size_pct: 3, max_chars: 90 }, { size_pct: 2.4, max_chars: 160 }], transform: 'none', line_height: 1.35, letter_spacing_em: 0 },
      },
    },
  },
  NeuroneSCF: {
    typography: [
      T('headline', 'PT Sans Narrow', 'https://fonts.googleapis.com/css2?family=PT+Sans+Narrow:wght@400;700&display=swap'),
      T('body', 'Montserrat', 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600&display=swap'),
    ],
    palette: P({ accent: '#0076A8', accent_3: '#7CC6A4', accent_warm: '#C4622D', neutral: '#FAFAFA', primary: '#000000', pro: '#003A70' }),
    tokens: {
      layout: { rule: { enabled: true, gap_pct: 2.2, palette: 'accent_warm', width_pct: 12, thickness_px: 4 }, align: 'left',
        scrim: { mode: 'gradient_bottom', opacity: 0.84, palette: 'primary', coverage_pct: 60 }, anchor: 'bottom_left', gap_pct: 2.2, margin_pct: 7, max_width_pct: 76, text_zone_pct: 40 },
      palette: { headline: 'neutral', subheadline: 'neutral' },
      identity: { mode: 'edge_left', palette: 'accent_warm', width_pct: 1.8, full_bleed: true },
      typography: {
        headline: { role: 'headline', weight: 700, fit_steps: [{ size_pct: 8.6, max_chars: 42 }, { size_pct: 6.7, max_chars: 72 }, { size_pct: 5.3, max_chars: 110 }], transform: 'none', line_height: 1.05, letter_spacing_em: -0.005 },
        subheadline: { role: 'body', weight: 400, fit_steps: [{ size_pct: 3.1, max_chars: 90 }, { size_pct: 2.5, max_chars: 160 }], transform: 'none', line_height: 1.32, letter_spacing_em: 0 },
      },
    },
  },
  LucienSael: {
    typography: [
      T('display', 'Cormorant Garamond', 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,600;1,300;1,600&display=swap'),
      T('body', 'Crimson Pro', 'https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;500&display=swap'),
      T('mono', 'JetBrains Mono', 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400&display=swap'),
    ],
    palette: P({ ash: '#4A4A45', bone: '#EDE8DF', carbon: '#1C1C1A', ember: '#D4622A', gold: '#B8922A', mercurio: '#8D989C', obsidian: '#0D0D0B', parchment: '#C4BDB0', smoke: '#2E2E2B' }),
    tokens: {
      layout: { rule: { enabled: true, gap_pct: 2.2, palette: 'ember', width_pct: 12, thickness_px: 4 }, align: 'left',
        scrim: { mode: 'gradient_bottom', opacity: 0.85, palette: 'obsidian', coverage_pct: 58 }, anchor: 'bottom_left', gap_pct: 2.2, margin_pct: 8, max_width_pct: 74 },
      palette: { headline: 'bone', subheadline: 'parchment' },
      identity: { mode: 'edge_left', palette: 'ember', width_pct: 1.8, full_bleed: true },
      typography: {
        headline: { role: 'display', weight: 500, fit_steps: [{ size_pct: 8.8, max_chars: 42 }, { size_pct: 6.8, max_chars: 72 }, { size_pct: 5.4, max_chars: 110 }], transform: 'none', line_height: 1.04, letter_spacing_em: 0 },
        subheadline: { role: 'body', weight: 400, fit_steps: [{ size_pct: 3, max_chars: 90 }, { size_pct: 2.5, max_chars: 160 }], transform: 'none', line_height: 1.3, letter_spacing_em: 0 },
      },
    },
  },
  ForumPHs: {
    typography: [
      T('display', 'EB Garamond', 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&display=swap'),
      T('body', 'DM Sans', 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap'),
      T('editorial', 'Cormorant Garamond', 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&display=swap'),
      T('label', 'Cinzel', 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&display=swap'),
    ],
    palette: P({ accent: '#5C3472', accent_2: '#C4622D', accent_3: '#5FB49C', am_d: '#3A1F4A', am_l: '#EAD9F5', carbon: '#1C2233', carbon_d: '#0E1018', cream: '#FAFAF7', dust: '#B8B0A8', parch: '#F0EDE8', primary: '#5C3472', stone: '#6B6460', terra: '#C4622D' }),
    tokens: {
      layout: { rule: { enabled: true, gap_pct: 2.2, palette: 'terra', width_pct: 12, thickness_px: 4 }, align: 'left',
        scrim: { mode: 'gradient_bottom', opacity: 0.82, palette: 'carbon_d', coverage_pct: 62 }, anchor: 'bottom_left', gap_pct: 2.4, margin_pct: 7, max_width_pct: 78 },
      palette: { headline: 'cream', subheadline: 'dust' },
      identity: { mode: 'edge_left', palette: 'primary', width_pct: 1.8, full_bleed: true },
      typography: {
        headline: { role: 'display', weight: 500, fit_steps: [{ size_pct: 8.4, max_chars: 42 }, { size_pct: 6.6, max_chars: 72 }, { size_pct: 5.2, max_chars: 110 }], transform: 'none', line_height: 1.06, letter_spacing_em: -0.005 },
        subheadline: { role: 'body', weight: 400, fit_steps: [{ size_pct: 3.2, max_chars: 90 }, { size_pct: 2.6, max_chars: 160 }], transform: 'none', line_height: 1.32, letter_spacing_em: 0 },
      },
    },
  },
};

// ── el contenido: las láminas de la maqueta v4 (y, donde la maqueta trae una sola cifra, otra del
// mismo artículo) ────────────────────────────────────────────────────────────────────────────
const SLIDES = {
  UnrealvilleStudio: [
    { bg: 'cover', text: { headline: "Your agents aren't broken.", subheadline: 'They never agreed on the job.' }, c: { role: 'cover', eyebrow: 'Field Notes', keyword: 'broken' } },
    { text: { headline: '', subheadline: 'of multi-agent LLM systems fail in production. As a baseline.' }, c: { role: 'body', background: 'surface', eyebrow: 'The baseline', figure: { value: '41–86.7%', bar: { from: 41, to: 86.7 }, source: 'arXiv 2604.16339' } } },
    { text: { headline: '', subheadline: 'of those failures come from specification and coordination. Not the model.' }, c: { role: 'body', background: 'surface', eyebrow: 'The cause', figure: { value: '79%', bar: { from: 0, to: 79 }, source: 'Same study' } } },
    { bg: 'steps', text: { headline: 'Same goal. Three versions.' }, c: { role: 'body', eyebrow: 'The mechanism', keyword: 'Three', steps: [{ text: 'Agent A reads it as speed' }, { text: 'Agent B reads it as accuracy' }, { text: 'Neither knows the other exists', critical: true }] } },
    { text: { headline: 'Build the process model first.', subheadline: 'Code for anything with one right answer. The LLM for ambiguity.' }, c: { role: 'closing', background: 'surface', eyebrow: 'The fix', keyword: 'process model', cta: 'Full breakdown in Field Notes · link in bio' } },
  ],
  NeuroneSCF: [
    { bg: 'cover', text: { headline: 'Más antifrizz, y el frizz vuelve igual.', subheadline: 'El problema no está en la superficie.' }, c: { role: 'cover', eyebrow: 'Hair Intelligence', keyword: 'vuelve' } },
    { text: { headline: '', subheadline: 'de humedad relativa promedio en South Florida, casi todo el año.' }, c: { role: 'body', background: 'surface', eyebrow: 'El clima', figure: { value: '74%', bar: { from: 0, to: 74 }, source: 'Fuente pendiente' } } },
    { text: { headline: '', subheadline: 'la fibra dañada absorbe humedad atmosférica de forma significativamente mayor que la sana.' }, c: { role: 'body', background: 'surface', eyebrow: 'El estudio', figure: { value: 'Jul 2026', bar: null, source: 'International Journal of Cosmetic Science' } } },
    { bg: 'steps', text: { headline: 'Una puerta abierta.' }, c: { role: 'body', eyebrow: 'El mecanismo', keyword: 'abierta', steps: [{ text: 'La escama se levanta' }, { text: 'Entra agua del aire' }, { text: 'El córtex se hincha: frizz', critical: true }] } },
    { text: { headline: 'Primero, tu porosidad.', subheadline: 'Diagnosticarla antes de elegir rutina.' }, c: { role: 'closing', background: 'surface', eyebrow: 'El paso que falta', keyword: 'porosidad', cta: 'Guarda este post · link en la bio' } },
  ],
  LucienSael: [
    { bg: 'cover', text: { headline: 'The default was never neutral.', subheadline: 'Someone chose it. Tested it. Shipped it.' }, c: { role: 'cover', eyebrow: 'Writing', keyword: 'neutral' } },
    { text: { headline: '', subheadline: 'a user who didn’t open the app was treated as a bug, not a preference.' }, c: { role: 'body', background: 'surface', eyebrow: 'The record', figure: { value: '20 years', bar: null, source: 'Lucien Sael, Writing' } } },
    { text: { headline: '', subheadline: 'screens deep: where the cancellation was filed as retention best practice.' }, c: { role: 'body', background: 'surface', eyebrow: 'The exit', figure: { value: '4', bar: { from: 0, to: 80 }, source: 'Lucien Sael, Writing' } } },
    { bg: 'steps', text: { headline: 'How the exit disappears.' }, c: { role: 'body', eyebrow: 'The exit', keyword: 'disappears', steps: [{ text: 'Four screens deep' }, { text: 'A discount before you finish' }, { text: 'Filed as best practice', critical: true }] } },
    { text: { headline: 'Brussels is calling an old debt.', subheadline: 'The full essay is on Writing.' }, c: { role: 'closing', background: 'surface', eyebrow: 'The debt', keyword: 'debt', cta: 'Full essay · link in bio' } },
  ],
  ForumPHs: [
    { bg: 'cover', text: { headline: 'El perito no pregunta por su cuota.', subheadline: 'Pregunta por el edificio.' }, c: { role: 'cover', eyebrow: 'Sin tecnicismos', keyword: 'cuota' } },
    { text: { headline: '', subheadline: 'del valor de su apartamento depende de cómo se administra el edificio.' }, c: { role: 'body', background: 'surface', eyebrow: 'El dato', figure: { value: '15%', bar: { from: 0, to: 15 }, source: 'Lonja de Propiedad Raíz de Medellín y Antioquia' } } },
    { text: { headline: '', subheadline: 'menos vale un departamento mal administrado frente a uno con administración profesional.' }, c: { role: 'body', background: 'surface', eyebrow: 'El otro dato', figure: { value: 'hasta 25%', bar: { from: 0, to: 25 }, source: 'Neivor, México' } } },
    { bg: 'steps', text: { headline: 'Lo que mira un perito.' }, c: { role: 'body', eyebrow: 'Lo que se mira', keyword: 'perito', steps: [{ text: 'Finanzas y fondo de reserva' }, { text: 'Fachada y amenities' }, { text: 'Morosidad entre vecinos', critical: true }] } },
    { text: { headline: 'Lleve tres preguntas.', subheadline: 'Fondo de reserva, mora y reparaciones pendientes.' }, c: { role: 'closing', background: 'surface', eyebrow: 'Antes de la asamblea', keyword: 'preguntas', cta: 'Guarde este post para su próxima asamblea' } },
  ],
};

// ── transporte del smoke ────────────────────────────────────────────────────
function syntheticBg(w, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6b7f95"/><stop offset="100%" stop-color="#20262e"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.72}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.2}" fill="#c9b79c" opacity="0.55"/></svg>`;
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng());
}
function background(brand, kind) {
  for (const ext of ['jpg', 'png']) {
    const p = join(BG_DIR, `${brand}_${kind}.${ext}`);
    if (BG_DIR && existsSync(p)) return readFileSync(p);
  }
  return syntheticBg(900, 900);
}
const fontCache = new Map();
async function fontBytes(cssUrl, weight, italic) {
  const key = `${cssUrl}|${weight}|${italic}`;
  if (fontCache.has(key)) return fontCache.get(key);
  const css = await (await fetch(cssUrl, { headers: { 'User-Agent': 'Mozilla/4.0 (compatible)' } })).text();
  const face = M.pickFontFace(M.parseFontFaces(css), { weight, italic });
  assert.ok(face, `sin @font-face descargable en ${cssUrl}`);
  // Igual que `loadFont` en el handler (1.3.1): la fuente llega a satori sin kerning. `raw` queda a
  // mano para el control del espaciado entre palabras (abajo).
  const raw = new Uint8Array(await (await fetch(face.url)).arrayBuffer());
  const out = { data: Buffer.from(M.neutralizeKerning(raw).bytes), raw: Buffer.from(raw), weight: face.weight, style: face.italic ? 'italic' : 'normal' };
  fontCache.set(key, out);
  return out;
}
function logoFor(brand) {
  if (seed.includes(`$wm_${brand}$`)) return { kind: 'wordmark', spec: JSON.parse(dq(`wm_${brand}`)) };
  if (seed.includes(`$src_${brand}$`)) {
    const src = dq(`src_${brand}`);
    const comma = src.indexOf(',');
    const bytes = new Uint8Array(Buffer.from(src.slice(comma + 1), 'base64'));
    const intrinsic = src.startsWith('data:image/svg+xml')
      ? M.svgDimensions(Buffer.from(bytes).toString('utf8'))
      : (({ width, height }) => ({ width, height }))(M.imageDimensions(bytes));
    return { kind: 'image', src, intrinsic };
  }
  return null;
}

async function render(brand, slide, k, total, tokensOverride, { kerning = false, svgOnly = false } = {}) {
  const base = BASE[brand];
  const carouselRow = {
    ...SCRIM_CAROUSEL,
    palette: JSON.parse(dq(`pal_${brand}`)),
    carousel: JSON.parse(dq(`car_${brand}`)),
  };
  const rows = [
    { id: 'base', brand_id: brand, canal: null, active: true, tokens: base.tokens },
    { id: 'car', brand_id: brand, canal: 'CAROUSEL', active: true, tokens: tokensOverride ?? carouselRow },
  ];
  const picked = M.pickOverlayTokens(rows, brand, 'CAROUSEL');
  const palette = [...base.palette, ...seededPalette(brand)];
  const style = M.resolveOverlayStyle({ tokens: picked.tokens, typography: base.typography, palette, text: slide.text });
  const carousel = M.parseCarouselRequest({ index: k + 1, total, ...slide.c });
  const chrome = M.resolveCarouselChrome({ tokens: picked.tokens, typography: base.typography, palette, carousel, text: slide.text, logo: logoFor(brand) });
  const bgBytes = slide.bg ? background(brand, slide.bg) : null;
  const bgSrc = bgBytes ? `data:${M.imageDimensions(new Uint8Array(bgBytes)).mime};base64,${bgBytes.toString('base64')}` : null;
  if (!chrome.applied) return { chrome, style, bgSrc };
  const fonts = [];
  for (const f of chrome.fonts) {
    const b = await fontBytes(f.cssImport, f.weight, f.italic);
    fonts.push({ name: f.family, data: kerning ? b.raw : b.data, weight: b.weight, style: b.style });
  }
  const scene = M.buildCarouselScene({ chrome, style, backgroundSrc: bgSrc });
  const svg = await satori(scene, { width: chrome.canvas.width, height: chrome.canvas.height, fonts, embedFont: !svgOnly });
  if (svgOnly) return { svg, chrome, style };
  return { png: Buffer.from(new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng()), chrome, style };
}

console.log('\n── F3 · cuatro marcas × cinco láminas (4:5), con los datos del archivo de siembra ──');
for (const brand of Object.keys(SLIDES)) {
  const slides = SLIDES[brand];
  for (const [k, slide] of slides.entries()) {
    const a = await render(brand, slide, k, slides.length);
    const b = await render(brand, slide, k, slides.length);
    assert.equal(Buffer.compare(a.png, b.png), 0, 'DETERMINISMO: misma entrada ⇒ mismos BYTES');
    assert.deepEqual([a.png[0], a.png[1], a.png[2], a.png[3]], [0x89, 0x50, 0x4e, 0x47], 'es un PNG');
    const dims = M.imageDimensions(new Uint8Array(a.png));
    assert.deepEqual([dims.width, dims.height], [a.chrome.canvas.width, a.chrome.canvas.height], 'todas las láminas salen del lienzo de la marca');
    const out = join(OUT, `${brand}_${k + 1}_${slide.c.role}${slide.c.figure ? '_cifra' : ''}${slide.c.steps ? '_pasos' : ''}.png`);
    writeFileSync(out, a.png);
    console.log(`  ok   ${brand.padEnd(18)} ${k + 1}/${slides.length} ${slide.c.role.padEnd(7)} ${(slide.c.background ?? 'image').padEnd(7)} ` +
      `logo=${a.chrome.logo?.kind ?? '∅'} avisos=${a.chrome.warnings.length} → ${out}`);
    assert.deepEqual(a.chrome.warnings, [], `${brand} lámina ${k + 1}: sin avisos (${a.chrome.warnings.join(' | ')})`);
  }
}

console.log('\n── F3 · sin tokens.carousel la lámina es la de 1.2.0 (el campo se ignora) ──');
{
  const brand = 'ForumPHs';
  const slide = SLIDES[brand][0];
  const r = await render(brand, slide, 0, 5, SCRIM_CAROUSEL);
  assert.equal(r.chrome.applied, false, 'sin tokens.carousel no hay cromo');
  const scene = M.buildOverlayScene({ style: r.style, width: 900, height: 900, backgroundSrc: r.bgSrc });
  assert.ok(JSON.stringify(scene).includes(slide.text.headline), 'compone el titular como siempre');
  console.log('  ok   ForumPHs sin tokens.carousel → applied=false, escena de 1.2.0');
}

// ── 1.3.1 · el espacio entre palabras del titular es el de la fuente ─────────────────────────
// Defecto medido en producción (pieza NeuroneSCF 85517171, compose 1.3.0): «COLOR  DURA»,
// «BROWARD  QUE», «SENTARTE  EN». Causa: satori ubica cada palabra con el avance SIN kerning y la
// dibuja CON kerning; el sobrante cae antes de la palabra siguiente. Se mide en el SVG sin fuentes
// embebidas (cada palabra es un <text> con x y ancho): entre dos <text> seguidos del titular, en la
// misma línea, el hueco tiene que ser ≤ 1 px — lo que redondea la caja de cada átomo al píxel.
// Corre con los titulares REALES de esa pieza y con el titular de portada de las cuatro marcas.
const PIEZA_85517171 = [
  '¿Por qué tu color dura menos en Broward que en la foto del salón?',
  'El problema empezó antes de sentarte en la silla',
  'El agua dura mantiene la cutícula abierta',
  'Dyfensor Hair Restructuring Serum',
  'Tu cabello no está fallando',
];
function headlineGaps(svg, sizePx) {
  const runs = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)]
    .map((m) => ({ x: +m[1], y: +m[2], w: +m[3], size: +m[4], s: m[5] }))
    .filter((r) => Math.abs(r.size - sizePx) < 0.01);
  const gaps = [];
  for (let k = 0; k + 1 < runs.length; k++) {
    if (runs[k].y === runs[k + 1].y) gaps.push({ after: runs[k].s, gap: runs[k + 1].x - runs[k].x - runs[k].w });
  }
  return { runs, gaps };
}
console.log('\n── 1.3.1 · espacio entre palabras del titular (≤ 1 px de sobrante) ──');
{
  const casos = [
    ...PIEZA_85517171.map((h, k) => ({ brand: 'NeuroneSCF', slide: { bg: 'cover', text: { headline: h }, c: { role: k ? 'body' : 'cover', keyword: k === 4 ? 'fallando' : undefined } }, k })),
    ...Object.keys(SLIDES).map((brand) => ({ brand, slide: SLIDES[brand][0], k: 0 })),
  ];
  let controlMax = 0;
  for (const { brand, slide, k } of casos) {
    const r = await render(brand, slide, k, 5, undefined, { svgOnly: true });
    const size = Math.round((r.chrome.type.headline.sizePct / 100) * r.chrome.canvas.width * 100) / 100;
    const { runs, gaps } = headlineGaps(r.svg, size);
    const words = slide.text.headline.trim().split(/\s+/).length;
    assert.ok(runs.length >= words, `${brand}: el titular «${slide.text.headline}» se lee en el SVG (${runs.length} tramos, ${words} palabras)`);
    const worst = gaps.reduce((a, b) => (b.gap > a.gap ? b : a), { after: '∅', gap: 0 });
    assert.ok(gaps.every((g) => g.gap > -0.01 && g.gap < 1.001),
      `${brand}: hueco de ${worst.gap.toFixed(2)} px después de «${worst.after}» en «${slide.text.headline}» (máximo 1 px)`);
    const ctl = headlineGaps((await render(brand, slide, k, 5, undefined, { svgOnly: true, kerning: true })).svg, size).gaps;
    const ctlMax = Math.max(0, ...ctl.map((g) => g.gap));
    controlMax = Math.max(controlMax, ctlMax);
    console.log(`  ok   ${brand.padEnd(18)} «${slide.text.headline}» — ${gaps.length} huecos en línea, sobrante máx ${worst.gap.toFixed(2)} px (con kerning: ${ctlMax.toFixed(2)} px)`);
  }
  // CONTROL: la medición SABE ver el defecto. Si esto falla, satori ya mide con kerning y
  // `neutralizeKerning` puede retirarse — revisar antes de tocar nada.
  assert.ok(controlMax > 5, `control: con kerning el sobrante máximo debía superar 5 px y fue ${controlMax.toFixed(2)} px`);
  console.log(`  ok   control: con la fuente original (kerning) el sobrante llega a ${controlMax.toFixed(2)} px`);
}

console.log(`\n✅ compositor_carousel_smoke — ${Object.keys(SLIDES).length} marcas × 5 láminas, reproducibles, en ${OUT}\n`);
