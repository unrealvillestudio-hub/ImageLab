// BRIEF 7 — el COMPOSITOR determinístico. Test del bloque PURO.
//
// NO reimplementa nada: EXTRAE el bloque `COMPOSITOR:BEGIN/END` de `api/compose.ts` y lo ejecuta.
// Lo que se testea es la fuente que se deploya. Sin red, sin DB, sin deps (ni satori ni resvg).
//
// Los fixtures son las filas REALES de `brand_typography` y `brand_palette` leídas de la DB el
// 2026-08-22 para las dos marcas sembradas — ForumPHs y UnrealvilleStudio— y son deliberadamente
// DISTINTAS entre sí: distinta tipografía, distintos NOMBRES de rol de paleta, distinta posición.
// Ese contraste es el test de la marca N+1: si el motor tuviera una fuente, un color o un nombre de
// rol propios, una de las dos fallaría.
//
// Ejecutar:  node tests/compositor_test.mjs
// Requiere Node ≥ 22.18 (type-stripping nativo).

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'api', 'compose.ts');

const source = readFileSync(SRC, 'utf8');
const BEGIN = '// ── COMPOSITOR:BEGIN ──';
const END = '// ── COMPOSITOR:END ──';
const i = source.indexOf(BEGIN);
const j = source.indexOf(END);
assert.ok(i >= 0, `sentinela ${BEGIN} no encontrado en ${SRC}`);
assert.ok(j > i, `sentinela ${END} no encontrado (o antes del BEGIN)`);

const dir = mkdtempSync(join(tmpdir(), 'compositor-block-'));
const modPath = join(dir, 'compositor_block.mts');
writeFileSync(modPath, `${source.slice(i, j + END.length)}\n`, 'utf8');
const M = await import(pathToFileURL(modPath).href);
for (const fn of ['pickOverlayTokens', 'resolveOverlayStyle', 'buildOverlayScene', 'fitFontSizePct',
  'imageDimensions', 'parseFontFaces', 'pickFontFace', 'hexToRgba', 'deepMergeTokens', 'resolveProductLayer',
  'parseCarouselRequest', 'resolveCarouselChrome', 'headlineLineRanges', 'partsInRange', 'measureOverlayText', 'splitEmphasis', 'buildCarouselScene', 'splitKeyword', 'headlineAtoms', 'svgDimensions', 'neutralizeKerning',
  'fontAdvanceMetrics', 'fitFontKey', 'measureCarouselLayout', 'fitCarouselContent', 'parseCarouselTextEffect', 'carouselTextShadow']) {
  assert.equal(typeof M[fn], 'function', `el bloque COMPOSITOR debe exportar ${fn}`);
}

// ── fixtures REALES (DB, 2026-08-22) ────────────────────────────────────────
const TYPO_FPHS = [
  { role: 'display', font_family: 'EB Garamond', css_import: 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&display=swap', fallback: null },
  { role: 'body', font_family: 'DM Sans', css_import: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap', fallback: null },
  { role: 'label', font_family: 'Cinzel', css_import: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&display=swap', fallback: null },
];
const PAL_FPHS = [
  { role: 'cream', hex: '#FAFAF7' }, { role: 'dust', hex: '#B8B0A8' },
  { role: 'carbon_d', hex: '#0E1018' }, { role: 'terra', hex: '#C4622D' },
  { role: 'ink', hex: '#1A1612' }, { role: 'primary', hex: '#5C3472' },
];
const TYPO_UNRLVL = [
  { role: 'display', font_family: 'Bebas Neue', css_import: 'https://fonts.googleapis.com/css2?family=Bebas+Neue', fallback: 'Impact, sans-serif' },
  { role: 'body', font_family: 'Libre Baskerville', css_import: 'https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400', fallback: 'Georgia, serif' },
  { role: 'mono', font_family: 'Space Mono', css_import: 'https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400', fallback: 'Courier New, monospace' },
];
const PAL_UNRLVL = [
  { role: 'text_primary', hex: '#F2F0EC' }, { role: 'bg_primary', hex: '#080808' },
  { role: 'accent_primary', hex: '#00FFD1' }, { role: 'bg_tertiary', hex: '#1A1A1A' },
];

// Tokens tal como los siembra la migración `..._imagelab_overlay_tokens.sql`.
const TOK_FPHS = {
  id: 'r-fphs', brand_id: 'ForumPHs', canal: null, active: true,
  tokens: {
    layout: {
      anchor: 'bottom_left', margin_pct: 7, max_width_pct: 78, gap_pct: 2.4, align: 'left',
      scrim: { mode: 'gradient_bottom', palette: 'carbon_d', opacity: 0.82, coverage_pct: 62 },
      rule: { enabled: true, palette: 'terra', width_pct: 12, thickness_px: 4, gap_pct: 2.2 },
    },
    typography: {
      headline: { role: 'display', weight: 500, line_height: 1.06, letter_spacing_em: -0.005, transform: 'none',
        fit_steps: [{ max_chars: 42, size_pct: 8.4 }, { max_chars: 72, size_pct: 6.6 }, { max_chars: 110, size_pct: 5.2 }] },
      subheadline: { role: 'body', weight: 400, line_height: 1.32, letter_spacing_em: 0, transform: 'none',
        fit_steps: [{ max_chars: 90, size_pct: 3.2 }, { max_chars: 160, size_pct: 2.6 }] },
    },
    palette: { headline: 'cream', subheadline: 'dust' },
    identity: { mode: 'edge_left', palette: 'primary', width_pct: 1.8, full_bleed: true },
  },
};
const TOK_UNRLVL = {
  id: 'r-unrlvl', brand_id: 'UnrealvilleStudio', canal: null, active: true,
  tokens: {
    layout: {
      anchor: 'top_left', margin_pct: 8, max_width_pct: 72, gap_pct: 2.0, align: 'left',
      scrim: { mode: 'gradient_top', palette: 'bg_primary', opacity: 0.86, coverage_pct: 55 },
      rule: { enabled: true, palette: 'accent_primary', width_pct: 9, thickness_px: 3, gap_pct: 1.8 },
    },
    typography: {
      headline: { role: 'display', weight: 400, line_height: 0.98, letter_spacing_em: 0.01, transform: 'uppercase',
        fit_steps: [{ max_chars: 44, size_pct: 10.5 }, { max_chars: 78, size_pct: 8.0 }, { max_chars: 120, size_pct: 6.2 }] },
      subheadline: { role: 'body', weight: 400, line_height: 1.35, letter_spacing_em: 0, transform: 'none',
        fit_steps: [{ max_chars: 90, size_pct: 3.0 }, { max_chars: 160, size_pct: 2.4 }] },
    },
    palette: { headline: 'text_primary', subheadline: 'text_primary' },
    identity: { mode: 'edge_left', palette: 'accent_primary', width_pct: 1.8, full_bleed: true },
  },
};
const TOK_GLOBAL = {
  id: 'r-global', brand_id: null, canal: null, active: true,
  tokens: { layout: { anchor: 'bottom_left', margin_pct: 6, max_width_pct: 80, gap_pct: 2 } },
};

const TXT = { headline: 'La cuota extraordinaria no se vota a mano alzada', subheadline: 'Lo que dice el reglamento, sin adornos.' };

let pass = 0;
const fails = [];
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fails.push([name, e]); console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('\n── T0 · el texto del overlay es VERBATIM: el compositor no escribe ──');
test('titular y bajada llegan al árbol carácter por carácter', () => {
  const style = M.resolveOverlayStyle({ tokens: TOK_FPHS.tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT });
  assert.equal(style.slots.headline.text, TXT.headline);
  assert.equal(style.slots.subheadline.text, TXT.subheadline);
  const scene = M.buildOverlayScene({ style, width: 1024, height: 1024, backgroundSrc: 'data:image/png;base64,AA' });
  const textos = JSON.stringify(scene).match(/"children":"([^"]*)"/g) ?? [];
  assert.ok(textos.some((t) => t.includes(TXT.headline)), 'el titular entra sin tocar');
  assert.ok(textos.some((t) => t.includes(TXT.subheadline)), 'la bajada entra sin tocar');
});
test('un titular larguísimo NO se recorta: baja de tamaño y deja marcador', () => {
  const largo = 'Una asamblea sin quórum no puede aprobar una cuota extraordinaria, y el acta que diga lo contrario no vale nada ante el juzgado';
  const style = M.resolveOverlayStyle({ tokens: TOK_FPHS.tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: { headline: largo } });
  assert.equal(style.slots.headline.text, largo, 'ni un carácter menos: es el copy ya juzgado');
  assert.equal(style.slots.headline.sizePct, 5.2, 'cae al último escalón declarado');
  assert.match(style.markers[0], /OVERLAY_TEXT_OVERFLOW/);
});
test('una marca que NO declara la ranura de bajada compone sin ella, sin fallar', () => {
  // La bajada la OFRECE el carril; que se dibuje lo decide la marca en sus tokens. Una marca cuya
  // composición es sólo titular no puede fallar por recibir una bajada que no pidió.
  const tokens = structuredClone(TOK_FPHS.tokens);   // clon: el merge comparte referencias de la capa base
  delete tokens.typography.subheadline;
  const style = M.resolveOverlayStyle({ tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT });
  assert.equal(style.slots.subheadline, null);
  assert.equal(style.slots.headline.text, TXT.headline);
  assert.match(style.markers[0], /OVERLAY_SLOT_NOT_DECLARED/);
});
test('pero una ranura declarada A MEDIAS sí es error (rol sin fit_steps)', () => {
  const tokens = structuredClone(TOK_FPHS.tokens);
  delete tokens.typography.subheadline.fit_steps;
  assert.throws(
    () => M.resolveOverlayStyle({ tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT }),
    (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE' && /typography\.subheadline\.fit_steps/.test(e.message),
  );
});
test('sin bajada compone igual (subheadline es opcional por contrato)', () => {
  const style = M.resolveOverlayStyle({ tokens: TOK_FPHS.tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: { headline: 'Corto' } });
  assert.equal(style.slots.subheadline, null);
  const scene = M.buildOverlayScene({ style, width: 1024, height: 1024, backgroundSrc: 'x' });
  assert.ok(JSON.stringify(scene).includes('Corto'));
});

console.log('\n── T1 · MARCA N+1: dos marcas de rubro, país y paleta distintos, mismo motor ──');
test('ForumPHs y UnrealvilleStudio resuelven fuentes y colores DISTINTOS sin tocar el código', () => {
  const a = M.resolveOverlayStyle({ tokens: TOK_FPHS.tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT });
  const b = M.resolveOverlayStyle({ tokens: TOK_UNRLVL.tokens, typography: TYPO_UNRLVL, palette: PAL_UNRLVL, text: TXT });
  assert.equal(a.slots.headline.family, 'EB Garamond');
  assert.equal(b.slots.headline.family, 'Bebas Neue');
  assert.equal(a.slots.headline.color, 'rgb(250, 250, 247)');
  assert.equal(b.slots.headline.color, 'rgb(242, 240, 236)');
  assert.equal(a.layout.anchor, 'bottom_left');
  assert.equal(b.layout.anchor, 'top_left');
  assert.equal(b.slots.headline.transform, 'uppercase');
});
test('los NOMBRES de rol son de la marca, no del motor (paletas disjuntas)', () => {
  // ForumPHs nombra 'cream'/'terra'; UNRLVL nombra 'text_primary'/'accent_primary'. Ningún nombre
  // de rol de ninguna marca puede aparecer en la fuente del bloque.
  const block = source.slice(i, j);
  for (const rol of ['cream', 'terra', 'carbon_d', 'text_primary', 'accent_primary', 'bg_primary', 'EB Garamond', 'Bebas', 'ForumPHs', 'Unrealville',
    // F3 (2026-10-02) — las cuatro marcas del carrusel, sus roles de paleta y de tipografía, sus
    // familias y los textos por idioma del aviso de deslizar: nada de eso puede vivir en el motor.
    'NeuroneSCF', 'LucienSael', 'accent_secondary', 'accent_glow', 'accent_warm', 'am_l', 'ember', 'gold', 'mercurio',
    'parchment', 'obsidian', 'bone', 'surface_1', 'carbon_m', 'bg_secondary', 'bg_tertiary',
    'Montserrat', 'PT Sans', 'Cinzel', 'Space Mono', 'JetBrains', 'Cormorant', 'Crimson', 'Libre Baskerville', 'DM Sans',
    'Desliza', 'Swipe', 'Glisser',
    // 1.3.1 (2026-10-03) — el caso que destapó el kerning (pieza 85517171): su vocabulario tampoco.
    'Broward', 'Dyfensor', 'Narrow',
    // 1.3.3 (2026-10-03) — los textos de las cuatro láminas que destaparon el desborde vertical.
    'Many Labs', 'BuildMVPFast', 'Soulmate', 'PRISMA', 'Rule 707', 'HOURS']) {
    assert.ok(!block.includes(rol), `el motor nombra '${rol}': eso es instancia, no eje`);
  }
  // Ni un hex en el bloque: todo color sale de brand_palette (o del logotipo declarado por la marca).
  assert.ok(!/#[0-9a-fA-F]{6}\b/.test(block), 'el motor no trae colores propios');
});
test('marca N+1 sin sembrar → FALLA con el nombre de lo que falta, no con un default', () => {
  assert.throws(
    () => M.pickOverlayTokens([TOK_FPHS], 'MarcaNueva', 'INSTAGRAM_FEED'),
    (e) => e.label === 'COMPOSITOR_TOKENS_MISSING' && /MarcaNueva/.test(e.message),
  );
  // Con fila global sí compone: el global RELLENA, pero si no alcanza también grita.
  assert.throws(
    () => {
      const p = M.pickOverlayTokens([TOK_GLOBAL], 'MarcaNueva', 'INSTAGRAM_FEED');
      M.resolveOverlayStyle({ tokens: p.tokens, typography: [], palette: [], text: TXT });
    },
    (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE' && /typography\.headline\.role/.test(e.message),
  );
});
test('rol declarado que la marca no tiene sembrado → grita el rol, no rellena', () => {
  const tokens = M.deepMergeTokens(TOK_FPHS.tokens, { palette: { headline: 'no_existe' } });
  assert.throws(
    () => M.resolveOverlayStyle({ tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT }),
    (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE' && /brand_palette\.role='no_existe'/.test(e.message),
  );
});

console.log('\n── T2 · precedencia de tokens: global rellena, marca declara, canal ajusta ──');
test('marca+canal > marca > global+canal > global, acumulando', () => {
  const globalCanal = { id: 'g2', brand_id: null, canal: 'INSTAGRAM_FEED', active: true, tokens: { layout: { max_width_pct: 74 } } };
  const marcaCanal = { id: 'm2', brand_id: 'ForumPHs', canal: 'INSTAGRAM_FEED', active: true, tokens: { layout: { anchor: 'center', align: 'center' } } };
  const r = M.pickOverlayTokens([marcaCanal, TOK_GLOBAL, TOK_FPHS, globalCanal], 'ForumPHs', 'INSTAGRAM_FEED');
  assert.deepEqual(r.layers, ['*:*', '*:INSTAGRAM_FEED', 'ForumPHs:*', 'ForumPHs:INSTAGRAM_FEED']);
  assert.equal(r.tokens.layout.anchor, 'center', 'el canal de la marca manda');
  assert.equal(r.tokens.layout.max_width_pct, 78, 'lo que la marca declara no lo pisa el global de canal');
  assert.equal(r.tokens.layout.margin_pct, 7, 'y el global sólo rellena');
  assert.equal(r.tokens.typography.headline.role, 'display', 'las capas se acumulan, no se excluyen');
});
test('fila de otra marca o de otro canal se descarta', () => {
  const otra = { id: 'x', brand_id: 'NeuroneSCF', canal: null, active: true, tokens: { layout: { anchor: 'center' } } };
  const otroCanal = { id: 'y', brand_id: 'ForumPHs', canal: 'TIKTOK', active: true, tokens: { layout: { anchor: 'center' } } };
  const r = M.pickOverlayTokens([TOK_FPHS, otra, otroCanal], 'ForumPHs', 'INSTAGRAM_FEED');
  assert.equal(r.tokens.layout.anchor, 'bottom_left');
  assert.deepEqual(r.layers, ['ForumPHs:*']);
});
test('fila desactivada no participa', () => {
  const r = M.pickOverlayTokens([TOK_GLOBAL, { ...TOK_FPHS, active: false }], 'ForumPHs', null);
  assert.deepEqual(r.layers, ['*:*']);
});

console.log('\n── T7 · BRIEF 8 · D · la franja de identidad: sello de marca, no adorno del texto ──');
test('la franja se dibuja SIEMPRE que la marca la declare — con titular y sin él', () => {
  const st = M.resolveOverlayStyle({ tokens: TOK_FPHS.tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT });
  assert.equal(st.identity.mode, 'edge_left');
  assert.equal(st.identity.color, 'rgb(92, 52, 114)');   // primary de la marca, no un hex del motor
  const conTitular = JSON.stringify(M.buildOverlayScene({ style: st, width: 1024, height: 1024, backgroundSrc: 'x' }));
  assert.ok(conTitular.includes('"backgroundColor":"rgb(92, 52, 114)"'), 'con titular, la franja está');

  // Sin titular: la escena se SELLA igual y no emite contenedor de texto.
  const sinTexto = M.resolveOverlayStyle({ tokens: TOK_FPHS.tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: { headline: '' } });
  const sello = M.buildOverlayScene({ style: sinTexto, width: 1024, height: 1024, backgroundSrc: 'x' });
  const flat = JSON.stringify(sello);
  assert.ok(flat.includes('"backgroundColor":"rgb(92, 52, 114)"'), 'sin titular, la franja sigue estando');
  assert.ok(!flat.includes('fontFamily'), 'y no se dibuja tipografía ninguna');
  assert.equal(sello.props.children.length, 3, 'fondo + velo + franja: nada más');
});

test('D.1 · el grosor se calcula sobre el LADO CORTO: el sello se lee igual en todo formato', () => {
  const st = M.resolveOverlayStyle({ tokens: TOK_FPHS.tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT });
  const grosor = (w, h) => {
    const franja = M.buildOverlayScene({ style: st, width: w, height: h, backgroundSrc: 'x' })
      .props.children.find((c) => c.props?.style?.backgroundColor === st.identity.color);
    return franja.props.style.width;
  };
  // 1:1 · 4:5 · 9:16 — el lado corto es 1024 en los tres, así que el grosor es EL MISMO.
  assert.equal(grosor(1024, 1024), 18);
  assert.equal(grosor(1024, 1280), 18, '4:5 — mismo grosor');
  assert.equal(grosor(1024, 1792), 18, '9:16 — mismo grosor');
  // 16:9 de 1920×1080: el lado corto es 1080 → 19px. Con el ANCHO habría dado 35: el mismo sello,
  // casi el doble de grueso, sólo por cambiar de formato. Ése es el defecto que D.1 cierra.
  assert.equal(grosor(1920, 1080), 19, '16:9 — el lado corto manda, no el ancho');
  assert.notEqual(Math.round((1.8 / 100) * 1920), 19, 'y con el ancho el número sería otro');
});

test('D.1 · el borde es constante entre formatos: la franja no se reposiciona ni se deforma', () => {
  const st = M.resolveOverlayStyle({ tokens: TOK_FPHS.tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT });
  for (const [w, h] of [[1024, 1024], [1024, 1280], [1024, 1792], [1920, 1080]]) {
    const franja = M.buildOverlayScene({ style: st, width: w, height: h, backgroundSrc: 'x' })
      .props.children.find((c) => c.props?.style?.backgroundColor === st.identity.color);
    assert.equal(franja.props.style.left, 0, `${w}x${h}: nace del borde izquierdo`);
    assert.equal(franja.props.style.top, 0, 'y arranca arriba');
    assert.equal(franja.props.style.height, h, 'a sangre COMPLETA del borde: recorre el alto entero');
    assert.equal(franja.props.style.right, undefined, 'un solo borde — dos serían un marco');
  }
});

test('REGLA DURA: nunca un marco cerrado — la enumeración lo hace imposible', () => {
  // Los cuatro modos son geometría de UN borde. No existe 'frame' ni combinación; un modo
  // desconocido no cae a ninguno: grita.
  const tokens = structuredClone(TOK_FPHS.tokens);
  tokens.identity.mode = 'frame';
  assert.throws(
    () => M.resolveOverlayStyle({ tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT }),
    (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE' && /edge_left/.test(e.message),
  );
  const block = source.slice(i, j);
  assert.ok(!/['"]frame['"]/.test(block), 'el motor no conoce ningún modo de marco');
  // Y una franja dibujada nunca fija dos bordes opuestos a la vez.
  const st = M.resolveOverlayStyle({ tokens: TOK_UNRLVL.tokens, typography: TYPO_UNRLVL, palette: PAL_UNRLVL, text: TXT });
  const franja = M.buildOverlayScene({ style: st, width: 1024, height: 1024, backgroundSrc: 'x' })
    .props.children.find((c) => c.props?.style?.backgroundColor === st.identity.color);
  const lados = ['left', 'right', 'top', 'bottom'].filter((k) => franja.props.style[k] !== undefined);
  assert.deepEqual(lados.sort(), ['left', 'top'], 'una franja vertical fija su borde y el origen, nada más');
});

test('marca N+1: los modos se ejercen con una marca INVENTADA y sus propios roles', () => {
  // Ni ForumPHs ni UnrealvilleStudio: una marca de otro rubro, con nombres de rol que no existen en
  // ninguna de las dos. Si el motor conociera algún rol o algún hex, esto fallaría.
  const TYPO_N1 = [{ role: 'titulo', font_family: 'Inter', css_import: 'https://fonts.googleapis.com/css2?family=Inter' }];
  const PAL_N1 = [{ role: 'verde_campo', hex: '#2F7A3D' }, { role: 'tinta', hex: '#101010' }];
  const base = {
    layout: { anchor: 'bottom_right', margin_pct: 6, max_width_pct: 70, align: 'right' },
    typography: { headline: { role: 'titulo', weight: 700, fit_steps: [{ max_chars: 60, size_pct: 7 }] } },
    palette: { headline: 'tinta' },
  };
  for (const [mode, esperado] of [
    ['edge_left', { left: 0, top: 0 }],
    ['edge_right', { right: 0, top: 0 }],
    ['edge_bottom', { bottom: 0, left: 0 }],
  ]) {
    const tokens = { ...base, identity: { mode, palette: 'verde_campo', width_pct: 2.5, full_bleed: true } };
    const st = M.resolveOverlayStyle({ tokens, typography: TYPO_N1, palette: PAL_N1, text: { headline: 'Cosecha' } });
    assert.equal(st.identity.color, 'rgb(47, 122, 61)', `${mode}: el color sale de SU paleta`);
    const franja = M.buildOverlayScene({ style: st, width: 1000, height: 1500, backgroundSrc: 'x' })
      .props.children.find((c) => c.props?.style?.backgroundColor === st.identity.color);
    for (const [k, v] of Object.entries(esperado)) assert.equal(franja.props.style[k], v, `${mode}: ${k}`);
    if (mode === 'edge_bottom') {
      assert.equal(franja.props.style.width, 1000, 'horizontal: recorre el ancho entero');
      assert.equal(franja.props.style.height, 25, '2,5% del lado corto (1000)');
    } else {
      assert.equal(franja.props.style.height, 1500, 'vertical: recorre el alto entero');
      assert.equal(franja.props.style.width, 25, '2,5% del lado corto (1000)');
    }
  }
  // mode 'none' = la marca decide no sellar. No es un error ni un default.
  const sinSello = M.resolveOverlayStyle({
    tokens: { ...base, identity: { mode: 'none' } }, typography: TYPO_N1, palette: PAL_N1, text: { headline: 'Cosecha' },
  });
  assert.equal(sinSello.identity, null);
});

test('identidad declarada a medias grita; ausente no rompe nada (aditivo)', () => {
  const sinRol = structuredClone(TOK_FPHS.tokens);
  delete sinRol.identity.palette;
  assert.throws(
    () => M.resolveOverlayStyle({ tokens: sinRol, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT }),
    (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE' && /identity\.palette/.test(e.message),
  );
  const sinAncho = structuredClone(TOK_FPHS.tokens);
  sinAncho.identity.width_pct = 0;
  assert.throws(
    () => M.resolveOverlayStyle({ tokens: sinAncho, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT }),
    (e) => /identity\.width_pct/.test(e.message),
  );
  // Sin la clave `identity` la escena es EXACTAMENTE la de BRIEF 7.
  const previo = structuredClone(TOK_FPHS.tokens);
  delete previo.identity;
  const st = M.resolveOverlayStyle({ tokens: previo, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT });
  assert.equal(st.identity, null);
  assert.equal(M.buildOverlayScene({ style: st, width: 1024, height: 1024, backgroundSrc: 'x' }).props.children.length, 3,
    'fondo + velo + texto: ninguna franja de más');
});

console.log('\n── T3 · DETERMINISMO: misma entrada ⇒ mismo PNG (misma escena, clave por clave) ──');
test('dos corridas de la misma entrada dan el MISMO árbol serializado', () => {
  const build = () => {
    const p = M.pickOverlayTokens([TOK_GLOBAL, TOK_FPHS], 'ForumPHs', 'INSTAGRAM_FEED');
    const st = M.resolveOverlayStyle({ tokens: p.tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT });
    return M.buildOverlayScene({ style: st, width: 1024, height: 1280, backgroundSrc: 'data:image/png;base64,AAAA' });
  };
  assert.equal(JSON.stringify(build()), JSON.stringify(build()));
});
test('el orden en que llegan las filas de tokens NO cambia el resultado', () => {
  const filas = [TOK_GLOBAL, TOK_FPHS, { id: 'z', brand_id: 'ForumPHs', canal: 'INSTAGRAM_FEED', active: true, tokens: { layout: { margin_pct: 9 } } }];
  const a = M.pickOverlayTokens(filas, 'ForumPHs', 'INSTAGRAM_FEED');
  const b = M.pickOverlayTokens([...filas].reverse(), 'ForumPHs', 'INSTAGRAM_FEED');
  assert.deepEqual(a.tokens, b.tokens);
  assert.deepEqual(a.layers, b.layers);
});
test('el bloque es PURO: ni red, ni DB, ni reloj, ni azar', () => {
  const block = source.slice(i, j);
  for (const prohibido of ['fetch(', 'await ', 'process.env', 'Date.now', 'Math.random', 'new Date']) {
    assert.ok(!block.includes(prohibido), `el bloque COMPOSITOR debe ser puro: contiene '${prohibido}'`);
  }
});

console.log('\n── T4 · geometría: la escena se arma sobre las dimensiones REALES de la imagen ──');
test('tamaños y márgenes se derivan del ancho; el velo, del alto', () => {
  const st = M.resolveOverlayStyle({ tokens: TOK_FPHS.tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT });
  const scene = M.buildOverlayScene({ style: st, width: 1000, height: 2000, backgroundSrc: 'x' });
  const flat = JSON.stringify(scene);
  assert.ok(flat.includes('"fontSize":66'), 'titular de 48 chars → escalón 6.6% de 1000px');
  assert.ok(flat.includes('"padding":70'), 'margen 7% del ancho');
  assert.ok(flat.includes('"height":1240'), 'velo: 62% del ALTO');
  assert.ok(flat.includes('"maxWidth":780'));
});
test('IHDR de PNG y SOF de JPEG → dimensiones reales', () => {
  const png = new Uint8Array(32);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  png.set([0, 0, 4, 0], 16); png.set([0, 0, 2, 0x40], 20);
  assert.deepEqual(M.imageDimensions(png), { width: 1024, height: 576, mime: 'image/png' });
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x40, 0x04, 0x00, 0, 0, 0, 0, 0]);
  assert.deepEqual(M.imageDimensions(jpg), { width: 1024, height: 576, mime: 'image/jpeg' });
  assert.throws(() => M.imageDimensions(new Uint8Array([1, 2, 3, 4, 5])), (e) => e.label === 'COMPOSITOR_IMAGE_UNSUPPORTED');
});
test('ancla inválida → grita con las válidas, no cae a una por defecto', () => {
  const tokens = M.deepMergeTokens(TOK_FPHS.tokens, { layout: { anchor: 'abajo' } });
  assert.throws(
    () => M.resolveOverlayStyle({ tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT }),
    (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE' && /bottom_left/.test(e.message),
  );
});

console.log('\n── T5 · fuentes: se resuelven del DATO de la marca (css2 → ttf del peso pedido) ──');
const CSS_EB = `@font-face {
  font-family: 'EB Garamond';
  font-style: italic;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/ebgaramond/v33/italic400.ttf) format('truetype');
}
@font-face {
  font-family: 'EB Garamond';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/ebgaramond/v33/normal400.ttf) format('truetype');
}
@font-face {
  font-family: 'EB Garamond';
  font-style: normal;
  font-weight: 500;
  src: url(https://fonts.gstatic.com/s/ebgaramond/v33/normal500.ttf) format('truetype');
}`;
test('parsea los @font-face y elige el peso pedido, no el primero', () => {
  const faces = M.parseFontFaces(CSS_EB);
  assert.equal(faces.length, 3);
  assert.equal(M.pickFontFace(faces, { weight: 500, italic: false }).url, 'https://fonts.gstatic.com/s/ebgaramond/v33/normal500.ttf');
  assert.equal(M.pickFontFace(faces, { weight: 400, italic: true }).url, 'https://fonts.gstatic.com/s/ebgaramond/v33/italic400.ttf');
});
test('peso no declarado → el más cercano, determinista ante empate', () => {
  const faces = M.parseFontFaces(CSS_EB);
  assert.equal(M.pickFontFace(faces, { weight: 700, italic: false }).weight, 500, 'el más cercano por arriba disponible');
  assert.equal(M.pickFontFace(faces, { weight: 450, italic: false }).weight, 400, 'empate 400/500 → gana el menor, siempre igual');
  assert.equal(M.pickFontFace([], { weight: 400, italic: false }), null);
});

console.log('\n── T6 · color: el hex sale de brand_palette y el alfa del token ──');
test('hexToRgba respeta 3 y 6 dígitos, y grita ante basura', () => {
  assert.equal(M.hexToRgba('#0E1018', 1), 'rgb(14, 16, 24)');
  assert.equal(M.hexToRgba('0E1018', 0.82), 'rgba(14, 16, 24, 0.82)');
  assert.equal(M.hexToRgba('#FFF', 1), 'rgb(255, 255, 255)');
  assert.throws(() => M.hexToRgba('rojo', 1), (e) => e.label === 'COMPOSITOR_COLOR_INVALID');
});
test('el velo usa el color de la marca con su alfa, degradado a transparente', () => {
  const st = M.resolveOverlayStyle({ tokens: TOK_UNRLVL.tokens, typography: TYPO_UNRLVL, palette: PAL_UNRLVL, text: TXT });
  const flat = JSON.stringify(M.buildOverlayScene({ style: st, width: 1024, height: 1024, backgroundSrc: 'x' }));
  assert.ok(flat.includes('linear-gradient(180deg, rgba(8, 8, 8, 0.86) 0%, rgba(8, 8, 8, 0) 100%)'));
});

console.log('\n── T7 · capa de producto: el PNG real, pegado por código ──');
test('sin productos no hay capa ni marcador', () => {
  const r = M.resolveProductLayer({ tokens: TOK_FPHS.tokens, textAnchor: 'bottom_left', count: 0 });
  assert.equal(r.layer, null); assert.deepEqual(r.markers, []);
});
test('marca sin tokens.product → se compone sin producto, con marcador (no falla)', () => {
  const r = M.resolveProductLayer({ tokens: TOK_FPHS.tokens, textAnchor: 'bottom_left', count: 1 });
  assert.equal(r.layer, null);
  assert.ok(r.markers.some((m) => m.startsWith('PRODUCT_LAYER_NOT_DECLARED')));
});
test('declarada a medias → falla nombrando lo que falta', () => {
  const tokens = M.deepMergeTokens(TOK_FPHS.tokens, { product: { mode: 'composite', anchor: 'bottom_right' } });
  assert.throws(() => M.resolveProductLayer({ tokens, textAnchor: 'bottom_left', count: 1 }),
    (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE' && /product\.height_pct/.test(e.message) && /product\.margin_pct/.test(e.message));
});
test('misma ancla que el titular → falla: las capas se taparían', () => {
  const tokens = M.deepMergeTokens(TOK_FPHS.tokens, { product: { mode: 'composite', anchor: 'bottom_left', height_pct: 40, margin_pct: 5 } });
  assert.throws(() => M.resolveProductLayer({ tokens, textAnchor: 'bottom_left', count: 1 }),
    (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE' && /coincide con layout\.anchor/.test(e.message));
});
test('kit: se recorta a max_items y se avisa', () => {
  const tokens = M.deepMergeTokens(TOK_FPHS.tokens, { product: { mode: 'composite', anchor: 'bottom_right', height_pct: 40, margin_pct: 5, max_items: 3, overlap_pct: 20 } });
  const r = M.resolveProductLayer({ tokens, textAnchor: 'bottom_left', count: 5 });
  assert.equal(r.layer.maxItems, 3); assert.equal(r.layer.overlapPct, 20);
  assert.ok(r.markers.some((m) => m.startsWith('PRODUCT_LAYER_TRIMMED')));
});
test('la escena pega el PNG con su aspecto REAL, al alto declarado, debajo del texto', () => {
  const tokens = M.deepMergeTokens(TOK_FPHS.tokens, { product: { mode: 'composite', anchor: 'bottom_right', height_pct: 40, margin_pct: 5, max_items: 2, overlap_pct: 25 } });
  const st = M.resolveOverlayStyle({ tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT });
  const { layer } = M.resolveProductLayer({ tokens, textAnchor: st.layout.anchor, count: 2 });
  const scene = M.buildOverlayScene({ style: st, width: 1000, height: 1250, backgroundSrc: 'bg',
    products: [{ src: 'p1', width: 400, height: 1000 }, { src: 'p2', width: 500, height: 1000 }], productLayer: layer });
  const flat = JSON.stringify(scene);
  const i1 = flat.indexOf('"src":"p1"'); const i2 = flat.indexOf('"src":"p2"');
  assert.ok(i1 > 0 && i2 > i1, 'los dos productos, en orden');
  assert.ok(flat.includes('"width":200,"height":500'), 'p1: alto 40% de 1250 = 500; ancho por su aspecto 0,4 = 200');
  assert.ok(flat.includes('"marginLeft":-63'), 'p2 (ancho 250) se solapa 25% = 62,5 → 63');
  const kids = scene.props.children;
  const prodIdx = kids.findIndex((c) => JSON.stringify(c).includes('"src":"p1"'));
  const textIdx = kids.findIndex((c) => JSON.stringify(c).includes(TXT.headline));
  assert.ok(prodIdx > 0 && textIdx > prodIdx, 'el producto va encima del fondo y debajo del texto');
});
test('sin capa de producto, la escena no cambia (aditivo)', () => {
  const st = M.resolveOverlayStyle({ tokens: TOK_FPHS.tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT });
  const a = JSON.stringify(M.buildOverlayScene({ style: st, width: 1024, height: 1024, backgroundSrc: 'x' }));
  const b = JSON.stringify(M.buildOverlayScene({ style: st, width: 1024, height: 1024, backgroundSrc: 'x', products: [{ src: 'p', width: 1, height: 1 }], productLayer: null }));
  assert.equal(a, b);
});

test('opción (c): sin mode composite el compositor NO pega el producto (lo pinta el generador)', () => {
  const tokens = M.deepMergeTokens(TOK_FPHS.tokens, { product: { mode: 'in_scene', anchor: 'top_right', height_pct: 34, margin_pct: 6 } });
  const r = M.resolveProductLayer({ tokens, textAnchor: 'bottom_left', count: 1 });
  assert.equal(r.layer, null);
  assert.ok(r.markers.some((m) => m.startsWith('PRODUCT_IN_SCENE')));
  const sinModo = M.deepMergeTokens(TOK_FPHS.tokens, { product: { anchor: 'top_right', height_pct: 34, margin_pct: 6 } });
  assert.equal(M.resolveProductLayer({ tokens: sinModo, textAnchor: 'bottom_left', count: 1 }).layer, null, 'sin modo = en escena');
});

console.log('\n── F3 · carrusel según la maqueta v4 (compose 1.3.0) ──');
// Marca INVENTADA, de otro rubro y otro idioma, con nombres de rol que ninguna marca real usa: si
// el motor conociera un rol, un hex, una familia o el texto del aviso de deslizar, esto fallaría.
const N1_TYPO = [
  { role: 'titular', font_family: 'Fuente Titular', css_import: 'https://fonts.example/titular.css' },
  { role: 'texto', font_family: 'Fuente Texto', css_import: 'https://fonts.example/texto.css' },
  { role: 'rotulo', font_family: 'Fuente Rotulo', css_import: 'https://fonts.example/rotulo.css' },
];
const N1_PAL = [
  { role: 'hoja', hex: '#2F7A3D' }, { role: 'trigo', hex: '#D9A441' }, { role: 'cielo', hex: '#7FB7E6' },
  { role: 'tierra', hex: '#3B2A1E' }, { role: 'arcilla', hex: '#5A4030' }, { role: 'lino', hex: '#F4EFE6' },
];
const N1_BASE = {
  layout: { anchor: 'bottom_left', margin_pct: 6, max_width_pct: 80, scrim: { mode: 'gradient_bottom', palette: 'tierra', opacity: 0.8, coverage_pct: 60 } },
  typography: {
    headline: { role: 'titular', weight: 700, fit_steps: [{ max_chars: 60, size_pct: 8 }] },
    subheadline: { role: 'texto', weight: 400, fit_steps: [{ max_chars: 160, size_pct: 3 }] },
  },
  palette: { headline: 'lino', subheadline: 'lino' },
  identity: { mode: 'edge_bottom', palette: 'hoja', width_pct: 1.5 },
};
const N1_CAROUSEL = {
  palette: {
    keyword: 'trigo', progress_on: 'hoja', progress_off: { role: 'lino', alpha: 0.2 }, counter: 'cielo', critical: 'cielo',
    light: 'trigo', muted: { role: 'lino', alpha: 0.5 }, surface: 'tierra', surface_closing: 'arcilla', figure: 'trigo',
  },
  carousel: {
    canvas: { width: 1000, height: 1250 }, margin_pct: 5,
    typography: {
      headline: { role: 'titular', weight: 700, transform: 'none', line_height: 1, fit_steps: [{ max_chars: 40, size_pct: 10 }, { max_chars: 90, size_pct: 8 }] },
      body: { role: 'texto', weight: 400, size_pct: 4 },
      label: { role: 'rotulo', weight: 600, size_pct: 3, letter_spacing_em: 0.1, transform: 'uppercase' },
      figure: { role: 'titular', weight: 700, size_pct: 25, line_height: 0.9 },
    },
    swipe: { text: 'Glisser' },
    logo: { size_pct: 5, height_pct: 6 },
  },
};
const n1Tokens = (over = {}) => M.deepMergeTokens(M.deepMergeTokens(N1_BASE, N1_CAROUSEL), over);
const N1_LOGO = { kind: 'wordmark', spec: { parts: [
  { text: 'Granja', font: 'titular', color: 'lino', weight: 700, tracking: '0.02em' },
  { text: 'Sur', font: 'rotulo', color: '#D9A441', alpha: 0.5, weight: 600, scale: 0.7, space_before: 0.2, stretch: { x: 0.8, y: 1.2 } },
] } };
const chromeN1 = (c, text, over, logo = N1_LOGO) => M.resolveCarouselChrome({
  tokens: n1Tokens(over), typography: N1_TYPO, palette: N1_PAL, carousel: M.parseCarouselRequest(c), text, logo,
});
const sceneN1 = (c, text, over, bg = 'data:image/png;base64,AA') => {
  const tokens = n1Tokens(over);
  const style = M.resolveOverlayStyle({ tokens, typography: N1_TYPO, palette: N1_PAL, text });
  return M.buildCarouselScene({ chrome: chromeN1(c, text, over), style, backgroundSrc: bg });
};
const findAll = (node, pred, acc = []) => {
  if (node && typeof node === 'object') {
    if (pred(node)) acc.push(node);
    const kids = node.props?.children;
    if (Array.isArray(kids)) for (const k of kids) findAll(k, pred, acc);
    else if (kids && typeof kids === 'object') findAll(kids, pred, acc);
  }
  return acc;
};
const textNodes = (scene) => findAll(scene, (n) => typeof n.props?.children === 'string');
const textOf = (scene, str) => textNodes(scene).find((n) => n.props.children === str);

test('F3 · validación del contrato: errores 400 con etiqueta estable', () => {
  const ok = { index: 1, total: 5, role: 'cover' };
  const cases = [
    [{ ...ok, index: 0 }, 'CAROUSEL_INDEX_INVALID'],
    [{ ...ok, index: 6 }, 'CAROUSEL_INDEX_INVALID'],
    [{ ...ok, total: 11, index: 1 }, 'CAROUSEL_INDEX_INVALID'],
    [{ ...ok, index: 1.5 }, 'CAROUSEL_INDEX_INVALID'],
    [{ ...ok, role: 'middle' }, 'CAROUSEL_ROLE_INVALID'],
    [{ ...ok, background: 'video' }, 'CAROUSEL_BACKGROUND_INVALID'],
    [{ ...ok, figure: { value: '15%' } }, 'CAROUSEL_FIGURE_WITHOUT_SOURCE'],
    [{ ...ok, figure: { value: '15%', source: '  ' } }, 'CAROUSEL_FIGURE_WITHOUT_SOURCE'],
    [{ ...ok, figure: { value: '15%', source: 'X', bar: { from: 20, to: 10 } } }, 'CAROUSEL_FIGURE_BAR_INVALID'],
    [{ ...ok, figure: { value: '15%', source: 'X', bar: { from: 0, to: 120 } } }, 'CAROUSEL_FIGURE_BAR_INVALID'],
    [{ ...ok, steps: Array.from({ length: 6 }, (_, k) => ({ text: `p${k}` })) }, 'CAROUSEL_STEPS_TOO_MANY'],
    [{ ...ok, steps: [{ text: 'a', critical: true }, { text: 'b', critical: true }] }, 'CAROUSEL_STEPS_CRITICAL_MULTIPLE'],
    [{ ...ok, steps: [{ text: '' }] }, 'CAROUSEL_STEP_INVALID'],
    [{ ...ok, cta: 'Guarda esto' }, 'CAROUSEL_CTA_OUTSIDE_CLOSING'],
    [{ ...ok, role: 'body', cta: 'Guarda esto' }, 'CAROUSEL_CTA_OUTSIDE_CLOSING'],
    ['no-objeto', 'CAROUSEL_BAD_REQUEST'],
  ];
  for (const [raw, label] of cases) {
    assert.throws(() => M.parseCarouselRequest(raw), (e) => e.label === label && e.status === 400, `${JSON.stringify(raw)} → ${label}`);
  }
  assert.equal(M.parseCarouselRequest(undefined), null);
  const full = M.parseCarouselRequest({ index: 5, total: 5, role: 'closing', cta: 'Guarda esto', steps: [{ text: 'a' }, { text: 'b', critical: true }] });
  assert.equal(full.background, 'image', 'background por defecto: image');
  assert.equal(full.cta, 'Guarda esto');
  assert.deepEqual(full.steps.map((s) => s.critical), [false, true]);
});

test('F3 · REGRESIÓN 1.2.0: sin tokens.carousel el campo se ignora y la escena es byte a byte la de 1.2.0', () => {
  // Golden: sha256 de la escena que producía el bloque de compose 1.2.0 (commit a8e3c30) para esta
  // misma entrada. Si cambia, 1.3.0 dejó de ser aditiva.
  const st = M.resolveOverlayStyle({ tokens: TOK_FPHS.tokens, typography: TYPO_FPHS, palette: PAL_FPHS, text: TXT });
  const scene = M.buildOverlayScene({ style: st, width: 1080, height: 1350, backgroundSrc: 'data:image/png;base64,AAAA' });
  assert.equal(createHash('sha256').update(JSON.stringify(scene)).digest('hex'),
    'e2c63fe0a9e63e3b74ba4ac2f198cc447e35213069aacdad684f96151fd765c7');
  const r = M.resolveCarouselChrome({ tokens: TOK_FPHS.tokens, typography: TYPO_FPHS, palette: PAL_FPHS,
    carousel: M.parseCarouselRequest({ index: 1, total: 3, role: 'cover', keyword: 'cuota' }), text: TXT });
  assert.deepEqual(r, { applied: false }, 'una marca sin tokens.carousel no tiene cromo de carrusel');
  // Y con tokens.carousel pero sin campo `carousel` en la petición, tampoco.
  assert.deepEqual(M.resolveCarouselChrome({ tokens: n1Tokens(), typography: N1_TYPO, palette: N1_PAL, carousel: null, text: TXT }), { applied: false });
});

test('F3 · marca N+1: colores por FUNCIÓN desde SU paleta, con el reparto de la maqueta', () => {
  const ch = chromeN1({ index: 2, total: 4, role: 'body', eyebrow: 'Campo', keyword: 'trigo',
    steps: [{ text: 'Sembrar' }, { text: 'Regar', critical: true }] }, { headline: 'El trigo no espera', subheadline: 'Ni el clima.' });
  assert.equal(ch.applied, true);
  assert.equal(ch.colors.progress_done, 'rgb(47, 122, 61)', 'progreso: acento 1 (progress_on → hoja)');
  assert.equal(ch.colors.progress_todo, 'rgba(244, 239, 230, 0.2)', 'progreso pendiente con su alfa');
  assert.equal(ch.colors.keyword, 'rgb(217, 164, 65)', 'palabra clave → trigo');
  assert.equal(ch.colors.counter, 'rgb(127, 183, 230)', 'i / n → acento 2 (cielo)');
  assert.equal(ch.colors.step_critical_mark, 'rgb(127, 183, 230)', 'paso crítico → acento 2');
  assert.equal(ch.colors.source_mark, ch.colors.counter, 'punto de la fuente → acento 2');
  assert.equal(ch.colors.swipe, 'rgb(217, 164, 65)', 'aviso de deslizar → luz');
  assert.equal(ch.colors.cta_underline, ch.colors.swipe, 'subrayado del CTA → luz');
  assert.equal(ch.colors.headline, 'rgb(244, 239, 230)', 'sin palette.text, el titular hereda palette.headline');
  assert.equal(ch.surface, 'rgb(59, 42, 30)', 'superficie → tierra');
  assert.equal(chromeN1({ index: 4, total: 4, role: 'closing', cta: 'Pide tu caja' }, { headline: 'Fin' }).surface, 'rgb(90, 64, 48)',
    'el cierre usa surface_closing cuando la marca lo declara');
  assert.equal(ch.type.headline.family, 'Fuente Titular');
  assert.equal(ch.type.label.family, 'Fuente Rotulo');
  assert.equal(ch.swipeText, 'Glisser', 'el texto del aviso de deslizar es dato de la marca, en su idioma');
  assert.deepEqual(ch.canvas, { width: 1000, height: 1250 });
  assert.deepEqual(ch.headline, [{ text: 'El ', keyword: false }, { text: 'trigo', keyword: true }, { text: ' no espera', keyword: false }]);
  assert.deepEqual(ch.warnings, []);
});

test('F3 · la escena: progreso por lámina, i / n, palabra clave, pasos, superficie', () => {
  const sc = sceneN1({ index: 2, total: 4, role: 'body', background: 'surface', eyebrow: 'Campo', keyword: 'trigo',
    steps: [{ text: 'Sembrar' }, { text: 'Regar', critical: true }] }, { headline: 'El trigo no espera' });
  const flat = JSON.stringify(sc);
  assert.equal(sc.props.style.width, 1000); assert.equal(sc.props.style.height, 1250);
  assert.ok(!flat.includes('"type":"img","props":{"src":"data:image/png'), 'fondo surface: sin foto');
  assert.ok(flat.includes('"backgroundColor":"rgb(59, 42, 30)"'), 'fondo de la función surface');
  const segs = findAll(sc, (n) => n.props?.style?.flexGrow === 1);
  assert.equal(segs.length, 4, 'una barra por lámina');
  assert.deepEqual(segs.map((s) => s.props.style.backgroundColor),
    ['rgb(47, 122, 61)', 'rgb(47, 122, 61)', 'rgba(244, 239, 230, 0.2)', 'rgba(244, 239, 230, 0.2)'], 'hechas hasta la lámina actual');
  assert.equal(textOf(sc, '2 / 4').props.style.color, 'rgb(127, 183, 230)');
  assert.equal(textOf(sc, 'Campo').props.style.textTransform, 'uppercase');
  const kw = findAll(sc, (n) => n.type === 'span' && String(n.props.children).startsWith('trigo'))[0];
  assert.equal(kw.props.style.color, 'rgb(217, 164, 65)', 'la palabra clave en su color');
  assert.equal(textOf(sc, 'Regar').props.style.color, 'rgb(244, 239, 230)', 'el paso crítico, en el color del titular');
  assert.ok(flat.includes('"backgroundColor":"rgb(127, 183, 230)"'), 'su marca, rellena en acento 2');
  assert.ok(!textOf(sc, 'Glisser'), 'el aviso de deslizar sólo va en la portada');
  assert.ok(flat.includes('"children":"Granja"') && flat.includes('"children":"Sur"'), 'el logotipo en el pie');
  assert.ok(flat.includes('"transform":"scale(0.8, 1.2)"'), 'el estiramiento del wordmark es dato');
  assert.ok(flat.includes('"color":"rgba(217, 164, 65, 0.5)"'), 'un hex de la marca en el wordmark, con su alfa');
});

test('F3 · portada con foto: velo, franja, aviso de deslizar con flecha geométrica; cierre con CTA subrayado', () => {
  const cover = sceneN1({ index: 1, total: 4, role: 'cover', keyword: 'trigo' }, { headline: 'El trigo no espera', subheadline: 'Ni el clima.' }, undefined, 'data:image/png;base64,BG');
  const flat = JSON.stringify(cover);
  assert.ok(flat.includes('"src":"data:image/png;base64,BG"'), 'la foto a sangre');
  assert.ok(flat.includes('rgba(59, 42, 30, 0.8)'), 'sin carousel.shade, el velo de 1.2.0 de la marca');
  assert.ok(flat.includes('"backgroundColor":"rgb(47, 122, 61)","left":0,"width":1000'), 'la franja de identidad de la marca');
  assert.ok(textOf(cover, 'Glisser'), 'portada: aviso de deslizar');
  assert.ok(flat.includes('data:image/svg+xml;utf8,'), 'la flecha es un trazo vectorial, no un carácter');
  assert.ok(!flat.includes('→'), 'ningún glifo de flecha');
  const closing = sceneN1({ index: 4, total: 4, role: 'closing', cta: 'Pide tu caja' }, { headline: 'Cosecha propia' });
  const cta = textOf(closing, 'Pide tu caja');
  assert.ok(cta, 'el CTA del cierre');
  const under = findAll(closing, (n) => String(n.props?.style?.borderBottom ?? '').includes('solid'))[0];
  assert.ok(under && under.props.style.borderBottom.endsWith('rgb(217, 164, 65)'), 'subrayado en la luz');
  assert.ok(!under.props.style.backgroundColor && !under.props.style.borderRadius, 'sin forma de botón');
  const flechaDe = (sc) => findAll(sc, (n) => n.type === 'img' && String(n.props?.src ?? '').startsWith('data:image/svg+xml;utf8,'))
    .map((n) => decodeURIComponent(n.props.src));
  assert.ok(flechaDe(cover).some((f) => f.includes('M1 6H22.5')), 'portada: la flecha del aviso señala a la derecha (hay más láminas)');
  const fc = flechaDe(closing);
  assert.ok(fc.length === 1 && fc[0].includes('M6 1V14.5') && !fc[0].includes('M1 6H22.5'),
    'cierre: la flecha del CTA señala ABAJO, al texto del post; nunca a la derecha, donde no queda lámina');
  const withShade = sceneN1({ index: 1, total: 4, role: 'cover' }, { headline: 'Cosecha' },
    { palette: { shade: 'tierra' }, carousel: { shade: { stops: [[0, 0.9], [100, 0.4]] } } }, 'data:image/png;base64,BG');
  assert.ok(JSON.stringify(withShade).includes('linear-gradient(180deg, rgba(59, 42, 30, 0.9) 0%, rgba(59, 42, 30, 0.4) 100%)'), 'velo de carrusel declarado');
});

test('F3 · cifra sobre superficie: barra a escala, fuente con su punto', () => {
  const sc = sceneN1({ index: 2, total: 4, role: 'body', background: 'surface', figure: { value: '62%', bar: { from: 10, to: 62 }, source: 'Censo agrario 2025' } },
    { headline: '', subheadline: 'de las fincas ya riega por goteo.' });
  assert.equal(textOf(sc, '62%').props.style.color, 'rgb(217, 164, 65)', 'la cifra en la función figure');
  const inner = 1000 - 2 * 50;
  const fill = findAll(sc, (n) => String(n.props?.style?.backgroundImage ?? '').startsWith('linear-gradient(90deg'))[0];
  assert.equal(fill.props.style.left, 0.1 * inner, 'arranca en from');
  assert.equal(fill.props.style.width, 0.52 * inner, 'mide to − from');
  assert.equal(fill.props.style.backgroundImage, 'linear-gradient(90deg, rgb(47, 122, 61), rgb(127, 183, 230))');
  assert.equal(textOf(sc, 'Censo agrario 2025').props.style.textTransform, 'none', 'la fuente no se pasa a mayúsculas');
  assert.ok(textOf(sc, 'de las fincas ya riega por goteo.'));
});

test('F3 · palabra clave ausente del titular → aviso y titular entero sin resaltar', () => {
  const ch = chromeN1({ index: 1, total: 2, role: 'cover', keyword: 'maíz' }, { headline: 'El trigo no espera' });
  assert.ok(ch.warnings.includes('CAROUSEL_KEYWORD_NOT_IN_HEADLINE'));
  assert.deepEqual(ch.headline, [{ text: 'El trigo no espera', keyword: false }]);
  // La clave es LITERAL: no se normaliza mayúsculas ni acentos.
  assert.equal(M.splitKeyword('El Trigo', 'trigo').found, false);
  assert.deepEqual(M.splitKeyword('Roto.', 'Roto').parts, [{ text: 'Roto', keyword: true }, { text: '.', keyword: false }]);
});

test('F3 · átomos del titular: el espacio entre tramos no se pierde y la puntuación no se separa', () => {
  const atoms = M.headlineAtoms(M.splitKeyword("Your agents aren't broken.", 'broken').parts);
  assert.deepEqual(atoms.map((a) => a.map((p) => p.text).join('')), ['Your ', 'agents ', "aren't ", 'broken.']);
  assert.deepEqual(atoms[3], [{ text: 'broken', keyword: true }, { text: '.', keyword: false }], '«broken» + «.» en un solo átomo');
  const two = M.headlineAtoms(M.splitKeyword('Build the process model first.', 'process model').parts);
  assert.deepEqual(two.map((a) => a.map((p) => `${p.keyword ? '*' : ''}${p.text}`).join('')),
    ['Build ', 'the ', '*process ', '*model ', 'first.']);
});

test('F3 · marca con carrusel declarado a medias → falla NOMBRANDO lo que falta', () => {
  const tokens = structuredClone(n1Tokens());   // clon: el merge comparte referencias de las capas
  delete tokens.palette.light;
  tokens.palette.counter = 'no_existe';
  delete tokens.carousel.swipe;
  delete tokens.carousel.typography.label.size_pct;
  assert.throws(
    () => M.resolveCarouselChrome({ tokens, typography: N1_TYPO, palette: N1_PAL, carousel: M.parseCarouselRequest({ index: 1, total: 2, role: 'cover' }), text: { headline: 'x' } }),
    (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE' && /palette\.light/.test(e.message) && /brand_palette\.role='no_existe'/.test(e.message)
      && /carousel\.swipe\.text/.test(e.message) && /carousel\.typography\.label\.size_pct/.test(e.message),
  );
});

test('F3 · logotipo tolerante: sin fila no hay logotipo ni error; fila incompleta → aviso', () => {
  const sin = chromeN1({ index: 1, total: 2, role: 'cover' }, { headline: 'x' }, undefined, null);
  assert.equal(sin.logo, null); assert.deepEqual(sin.warnings, []);
  const roto = chromeN1({ index: 1, total: 2, role: 'cover' }, { headline: 'x' }, undefined,
    { kind: 'wordmark', spec: { parts: [{ text: 'Granja', font: 'no_es_un_rol', color: 'lino' }] } });
  assert.equal(roto.logo, null);
  assert.ok(roto.warnings.some((w) => w.startsWith('CAROUSEL_LOGO_INVALID')));
  const img = chromeN1({ index: 1, total: 2, role: 'cover' }, { headline: 'x' }, undefined,
    { kind: 'image', src: 'data:image/png;base64,AA', intrinsic: { width: 300, height: 100 } });
  assert.deepEqual(img.logo, { kind: 'image', src: 'data:image/png;base64,AA', heightPct: 6, aspect: 3 });
  const sc = M.buildCarouselScene({ chrome: img, style: M.resolveOverlayStyle({ tokens: n1Tokens(), typography: N1_TYPO, palette: N1_PAL, text: { headline: 'x' } }), backgroundSrc: 'x' });
  const logo = findAll(sc, (n) => n.type === 'img' && n.props.src === 'data:image/png;base64,AA')[0];
  assert.equal(logo.props.height, 60, '6% del ancho (1000)'); assert.equal(logo.props.width, 180, 'ancho por su aspecto');
  const http = chromeN1({ index: 1, total: 2, role: 'cover' }, { headline: 'x' }, undefined, { kind: 'image', src: 'http://inseguro', intrinsic: { width: 1, height: 1 } });
  assert.equal(http.logo, null, 'sólo https o data:image');
});

test('F3 · svgDimensions: atributos numéricos o viewBox', () => {
  assert.deepEqual(M.svgDimensions('<svg xmlns="x" viewBox="0 0 320 96" width="100%" height="100%">'), { width: 320, height: 96 });
  assert.deepEqual(M.svgDimensions('<svg width="40px" height="20" viewBox="0 0 1 1">'), { width: 40, height: 20 });
  assert.equal(M.svgDimensions('<svg>'), null);
});

test('F3 · determinismo: misma lámina ⇒ mismo árbol', () => {
  const c = { index: 3, total: 5, role: 'body', eyebrow: 'Campo', keyword: 'trigo', steps: [{ text: 'a' }, { text: 'b', critical: true }] };
  assert.equal(JSON.stringify(sceneN1(c, { headline: 'El trigo no espera' })), JSON.stringify(sceneN1(c, { headline: 'El trigo no espera' })));
});

console.log('\n── 1.3.1 · la fuente llega a satori sin kerning (espacio entre palabras parejo) ──');

// Fuente SINTÉTICA: sólo el directorio de tablas, que es lo único que `neutralizeKerning` lee y
// escribe. sfnt: cabecera de 12 bytes y entradas de 16 (tag, checksum, offset, length). WOFF:
// cabecera de 44 y entradas de 20 (tag, offset, compLength, origLength, origChecksum).
function fakeFont(signature, tags, { woff = false } = {}) {
  const head = woff ? 44 : 12;
  const entry = woff ? 20 : 16;
  const b = new Uint8Array(head + tags.length * entry + 8);
  for (let k = 0; k < 4; k++) b[k] = signature.charCodeAt(k);
  const at = woff ? 12 : 4;
  b[at] = tags.length >> 8; b[at + 1] = tags.length & 0xff;
  tags.forEach((t, n) => {
    const o = head + n * entry;
    for (let k = 0; k < 4; k++) b[o + k] = t.charCodeAt(k);
    for (let k = 4; k < entry; k++) b[o + k] = (n * 31 + k) & 0xff;   // resto de la entrada: no se toca
  });
  b.fill(0xab, head + tags.length * entry);                              // «datos» de las tablas
  return b;
}
const tagsOf = (b, { woff = false } = {}) => {
  const head = woff ? 44 : 12; const entry = woff ? 20 : 16; const n = (b[woff ? 12 : 4] << 8) | b[woff ? 13 : 5];
  return Array.from({ length: n }, (_, k) => String.fromCharCode(...b.slice(head + k * entry, head + k * entry + 4)));
};
const TAGS = ['GDEF', 'GPOS', 'GSUB', 'OS/2', 'cmap', 'glyf', 'head', 'hmtx', 'kern', 'loca', 'name'];

test('1.3.1 · TrueType: `kern` y `GPOS` desaparecen del directorio; GSUB, glifos y métricas quedan', () => {
  const src = fakeFont('\u0000\u0001\u0000\u0000', TAGS);
  const before = Uint8Array.from(src);
  const r = M.neutralizeKerning(src);
  assert.deepEqual(r.neutralized, ['GPOS', 'kern']);
  assert.deepEqual(tagsOf(r.bytes), ['GDEF', 'xPOS', 'GSUB', 'OS/2', 'cmap', 'glyf', 'head', 'hmtx', 'xern', 'loca', 'name']);
  assert.deepEqual(src, before, 'devuelve una COPIA: los bytes de entrada no cambian');
  const diff = [...r.bytes].map((v, k) => (v !== src[k] ? k : -1)).filter((k) => k >= 0);
  assert.deepEqual(diff, [12 + 1 * 16, 12 + 8 * 16], 'sólo cambia el primer byte de cada tag neutralizado');
});

test('1.3.1 · OpenType/CFF (OTTO) y WOFF: mismo efecto; idempotente', () => {
  const otf = M.neutralizeKerning(fakeFont('OTTO', ['CFF ', 'GPOS', 'cmap']));
  assert.deepEqual(tagsOf(otf.bytes), ['CFF ', 'xPOS', 'cmap']);
  const woff = M.neutralizeKerning(fakeFont('wOFF', ['GPOS', 'glyf', 'kern'], { woff: true }));
  assert.deepEqual(woff.neutralized, ['GPOS', 'kern']);
  assert.deepEqual(tagsOf(woff.bytes, { woff: true }), ['xPOS', 'glyf', 'xern']);
  const twice = M.neutralizeKerning(otf.bytes);
  assert.deepEqual(twice.neutralized, [], 'la segunda pasada no encuentra nada');
  assert.deepEqual(twice.bytes, otf.bytes);
});

test('1.3.1 · una fuente sin kerning, o algo que no es una fuente, pasa intacta', () => {
  const plain = fakeFont('true', ['cmap', 'glyf', 'head']);
  assert.deepEqual(M.neutralizeKerning(plain), { bytes: plain, neutralized: [] });
  for (const other of [new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]), new Uint8Array([1, 2, 3])]) {
    const r = M.neutralizeKerning(other);   // woff2 (que satori no lee) y bytes cortos
    assert.deepEqual(r, { bytes: other, neutralized: [] });
  }
  // Directorio que miente sobre su tamaño: no se lee fuera del búfer.
  const lies = fakeFont('OTTO', ['GPOS']); lies[5] = 9;
  assert.deepEqual(M.neutralizeKerning(lies).neutralized, ['GPOS']);
});


console.log('\n── 1.3.3 · ajuste vertical: el bloque central cabe entre la cabecera y el pie ──');

// Fuente SINTÉTICA con las cuatro tablas que lee `fontAdvanceMetrics`: head (unitsPerEm), hhea
// (numberOfHMetrics), hmtx (avances) y cmap. Glifos: 0 → 500, 1 → 600, 2 → 700, 3 → 250 unidades de 1000.
function fakeTtf({ format = 4 } = {}) {
  const be16 = (v) => [(v >> 8) & 0xff, v & 0xff];
  const be32 = (v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  const head = new Array(54).fill(0); head.splice(18, 2, ...be16(1000));
  const hhea = new Array(36).fill(0); hhea.splice(34, 2, ...be16(4));
  const hmtx = [500, 600, 700, 250].flatMap((a) => [...be16(a), 0, 0]);
  let sub;
  if (format === 4) {
    // Segmentos: espacio → glifo 3; «A»..«B» → glifos 1..2; 0xFFFF de cierre.
    const ends = [32, 66, 0xffff], starts = [32, 65, 0xffff], deltas = [(3 - 32) & 0xffff, (1 - 65) & 0xffff, 1];
    sub = [...be16(4), ...be16(0), ...be16(0), ...be16(6), 0, 0, 0, 0, 0, 0,
      ...ends.flatMap(be16), 0, 0, ...starts.flatMap(be16), ...deltas.flatMap(be16), ...[0, 0, 0].flatMap(be16)];
  } else {
    sub = [...be16(12), 0, 0, ...be32(0), ...be32(0), ...be32(2),
      ...be32(32), ...be32(32), ...be32(3), ...be32(65), ...be32(66), ...be32(1)];
  }
  const cmap = [...be16(0), ...be16(1), ...be16(3), ...be16(format === 4 ? 1 : 10), ...be32(12), ...sub];
  const tables = [['cmap', cmap], ['head', head], ['hhea', hhea], ['hmtx', hmtx]];
  const out = [0, 1, 0, 0, ...be16(tables.length), 0, 0, 0, 0, 0, 0];
  let off = 12 + tables.length * 16;
  const body = [];
  for (const [t, data] of tables) {
    out.push(...[...t].map((ch) => ch.charCodeAt(0)), 0, 0, 0, 0, ...be32(off + body.length), ...be32(data.length));
    body.push(...data);
  }
  return new Uint8Array([...out, ...body]);
}

test('1.3.3 · métricas de avance: cmap formato 4 y 12 → hmtx / unitsPerEm; lo ilegible es null', () => {
  for (const format of [4, 12]) {
    const m = M.fontAdvanceMetrics(fakeTtf({ format }));
    assert.ok(m, `formato ${format} legible`);
    assert.equal(m.advances.get(65), 0.6); assert.equal(m.advances.get(66), 0.7); assert.equal(m.advances.get(32), 0.25);
    assert.equal(m.advances.has(67), false, 'un carácter sin glifo no inventa avance');
    assert.equal(m.avgEm, (0.25 + 0.6 + 0.7) / 3, 'la media sale de los imprimibles ASCII presentes');
  }
  assert.equal(M.fontAdvanceMetrics(new Uint8Array([1, 2, 3])), null);
  assert.equal(M.fontAdvanceMetrics(fakeFont('wOFF', ['cmap'], { woff: true })), null, 'WOFF: no se descomprime, se estima');
  const cut = fakeTtf(); assert.equal(M.fontAdvanceMetrics(cut.slice(0, cut.length - 10)), null, 'tabla fuera del búfer → null');
  // Neutralizar el kerning no toca lo que lee el ajuste: mide igual antes y después.
  assert.deepEqual([...M.fontAdvanceMetrics(M.neutralizeKerning(fakeTtf()).bytes).advances], [...M.fontAdvanceMetrics(fakeTtf()).advances]);
});

// Métricas sintéticas: todo carácter mide `em` (una fuente «monoespaciada» de la marca inventada).
const monoMetrics = (chrome, em = 0.5) => Object.fromEntries(chrome.fonts.map((f) => [M.fitFontKey(f), { advances: new Map(), avgEm: em }]));
const fitN1 = (c, text, metrics = 'mono') => {
  const chrome = chromeN1(c, text);
  return { chrome, fit: M.fitCarouselContent({ chrome, metrics: metrics === 'mono' ? monoMetrics(chrome) : metrics }) };
};
const sceneOf = (chrome, text, bg = 'data:image/png;base64,AA') =>
  M.buildCarouselScene({ chrome, style: M.resolveOverlayStyle({ tokens: n1Tokens(), typography: N1_TYPO, palette: N1_PAL, text }), backgroundSrc: bg });
const LARGO = 'Un paso escrito con muchas palabras para que ocupe varias líneas en la lámina';

test('1.3.3 · NO desborda → el ajuste no toca nada: mismo objeto y escena idéntica a la de 1.3.2', () => {
  // Golden: sha256 de la escena que producía el bloque de compose 1.3.2 (commit cf1d277) para estas
  // mismas entradas. Si cambia, el ajuste dejó de ser inocuo para las láminas que ya cabían.
  const golden = [
    [{ index: 3, total: 5, role: 'body', background: 'surface', eyebrow: 'Campo', keyword: 'trigo', steps: [{ text: 'Sembrar en otoño' }, { text: 'Regar al alba', critical: true }] },
      { headline: 'El trigo no espera', subheadline: 'Ni el clima.' }, '097e6ac3d0fb6c68ba2e48435326782bc436c69cc1f2600f5eef2e215b1f6a64'],
    [{ index: 2, total: 5, role: 'body', background: 'surface', figure: { value: '62%', bar: { from: 10, to: 62 }, source: 'Censo agrario 2025' } },
      { headline: '', subheadline: 'de las fincas ya riega por goteo.' }, '8858c1ea8f227b2033b134f222ad1a8fc4f5d89bff1fc6e60500cd8ceb5fcfb6'],
  ];
  for (const [c, text, sha] of golden) {
    const { chrome, fit } = fitN1(c, text);
    assert.equal(fit.chrome, chrome, 'devuelve el MISMO cromo, sin copiarlo');
    assert.equal(fit.report.adjusted, false);
    assert.ok(fit.report.slack_px >= 0);
    assert.deepEqual(fit.warnings, []);
    assert.equal(createHash('sha256').update(JSON.stringify(sceneOf(fit.chrome, text))).digest('hex'), sha);
  }
});

test('1.3.3 · desborda → reduce primero la cifra, y el pie queda rígido', () => {
  const c = { index: 3, total: 5, role: 'body', background: 'surface', eyebrow: 'Campo',
    figure: { value: '1.234 ha', bar: null, source: 'Censo agrario 2025' },
    steps: [{ text: 'Sembrar' }, { text: 'Regar', critical: true }, { text: 'Cosechar' }, { text: 'Vender' }] };
  const text = { headline: 'El trigo no espera', subheadline: 'De las fincas, casi todas riegan por goteo.' };
  const { chrome, fit } = fitN1(c, text);
  assert.ok(M.measureCarouselLayout(chrome, monoMetrics(chrome)).slack < 0, 'el caso desborda sin ajuste');
  assert.equal(fit.report.adjusted, true);
  assert.ok(fit.report.slack_px >= 0, 'después del ajuste cabe');
  assert.ok(fit.report.figure_scale < 1, 'la cifra baja');
  assert.equal(fit.report.headline_size_pct, 10, 'la cifra alcanzó: el titular no se tocó');
  assert.equal(fit.report.body_scale, 1);
  assert.equal(fit.report.steps_dropped, 0);
  assert.equal(fit.chrome.type.figure.sizePct, Math.round(25 * fit.report.figure_scale * 1000) / 1000);
  assert.equal(chrome.type.figure.sizePct, 25, 'el cromo de entrada no se muta');
  assert.ok(fit.warnings.some((w) => w.startsWith('CAROUSEL_CONTENT_FIT_REDUCED') && /cifra ×/.test(w)));
  const sc = sceneOf(fit.chrome, text);
  const col = sc.props.children[sc.props.children.length - 1];
  const [top, mid, foot] = col.props.children;
  assert.equal(top.props.style.flexShrink, 0); assert.equal(foot.props.style.flexShrink, 0);
  assert.equal(mid.props.style.overflow, 'hidden', 'si la estimación se quedara corta, cede el centro, no el pie');
  for (const s of c.steps) assert.ok(textOf(sc, s.text), `el paso «${s.text}» sigue en la lámina`);
});

test('1.3.3 · el orden de la escalera: cifra → titular → cuerpo y pasos → pasos omitidos', () => {
  // Sin cifra: lo primero que baja es el titular, al escalón siguiente de su fit_steps.
  const sinCifra = fitN1({ index: 2, total: 5, role: 'body', background: 'surface',
    steps: [{ text: LARGO }, { text: LARGO, critical: true }, { text: LARGO }, { text: LARGO }, { text: LARGO }] },
  { headline: 'El trigo no espera a nadie', subheadline: `${LARGO}. ${LARGO}.` });
  assert.equal(sinCifra.fit.report.adjusted, true);
  assert.equal(sinCifra.fit.report.headline_size_pct, 8, 'titular: 10 → 8 (escalón siguiente)');
  assert.equal(sinCifra.fit.report.figure_scale, 1);
  assert.equal(sinCifra.fit.report.body_scale, 1, 'con el titular alcanzó: el cuerpo no se tocó');
  // Con cifra, titular y cuerpo: se agotan los escalones en orden antes de omitir un paso.
  const lleno = fitN1({ index: 2, total: 5, role: 'body', background: 'surface',
    figure: { value: '1.234 hectáreas', bar: { from: 0, to: 50 }, source: 'Censo agrario 2025' },
    steps: [{ text: LARGO }, { text: LARGO }, { text: LARGO }, { text: LARGO }, { text: LARGO, critical: true }] },
  { headline: 'El trigo no espera a nadie', subheadline: LARGO });
  const r = lleno.fit.report;
  assert.equal(r.figure_scale, 0.5, 'la cifra llegó a su mínimo');
  assert.equal(r.headline_size_pct, 8, 'el titular llegó a su último escalón');
  assert.equal(r.body_scale, 0.85, 'el cuerpo llegó a su mínimo legible');
  assert.ok(r.steps_dropped >= 1, 'y recién entonces se omiten pasos');
});

test('1.3.3 · el recorte de pasos va desde el final y NUNCA omite el crítico', () => {
  const steps = [{ text: `Uno. ${LARGO}` }, { text: `Dos. ${LARGO}` }, { text: `Tres. ${LARGO}` }, { text: `Cuatro. ${LARGO}` }, { text: `Cinco. ${LARGO}`, critical: true }];
  const { chrome, fit } = fitN1({ index: 2, total: 5, role: 'body', background: 'surface',
    figure: { value: '1.234 hectáreas', bar: null, source: 'Censo agrario 2025' }, steps },
  { headline: 'El trigo no espera a nadie', subheadline: LARGO });
  const kept = fit.chrome.slide.steps;
  assert.ok(fit.report.steps_dropped >= 1);
  assert.equal(kept.length, steps.length - fit.report.steps_dropped);
  assert.ok(kept.some((s) => s.critical), 'el crítico se conserva aunque sea el último');
  assert.deepEqual(kept.map((s) => s.text), [...steps.slice(0, kept.length - 1), steps[4]].map((s) => s.text),
    'se omiten los no críticos más cercanos al final; el orden de los que quedan no cambia');
  assert.ok(fit.warnings.some((w) => w.startsWith('CAROUSEL_STEPS_TRUNCATED')), 'y queda el aviso');
  assert.equal(chrome.slide.steps.length, 5, 'la entrada no se muta');
});

test('1.3.3 · ni con el mínimo cabe → aviso de desborde, el pie se mantiene; sin métricas → estimado', () => {
  const enorme = Array.from({ length: 60 }, () => LARGO).join(' ');
  const { fit } = fitN1({ index: 2, total: 5, role: 'body', background: 'surface', steps: [{ text: enorme, critical: true }] }, { headline: 'El trigo' });
  assert.equal(fit.report.overflow, true);
  assert.equal(fit.chrome.slide.steps.length, 1, 'el único paso es el crítico: no se omite');
  assert.ok(fit.warnings.some((w) => w.startsWith('CAROUSEL_CONTENT_OVERFLOW')));
  assert.equal(fit.chrome.fitGuard, true);
  const sinMetricas = fitN1({ index: 1, total: 2, role: 'cover' }, { headline: 'El trigo' }, null);
  assert.equal(sinMetricas.fit.report.adjusted, false);
  assert.ok(sinMetricas.fit.warnings.some((w) => w.startsWith('CAROUSEL_FIT_ESTIMATED') && /Fuente Titular/.test(w)),
    'sin métricas avisa qué familias se estimaron');
});

test('1.3.3 · la medida sigue al dato de la marca: un pie más alto deja menos sitio al centro', () => {
  const c = { index: 1, total: 2, role: 'cover' };
  const chico = M.measureCarouselLayout(chromeN1(c, { headline: 'El trigo' }), null);
  const conImagen = M.measureCarouselLayout(chromeN1(c, { headline: 'El trigo' }, undefined,
    { kind: 'image', src: 'data:image/png;base64,AA', intrinsic: { width: 300, height: 100 } }), null);
  assert.equal(conImagen.foot, 60, 'logotipo de 6 % del ancho (1000)');
  assert.ok(conImagen.available < chico.available || chico.foot >= 60);
  assert.equal(conImagen.gap, Math.round(30 * 0.6 * 100) / 100, 'el aire mínimo es proporcional a la etiqueta');
});

console.log('\n── 1.3.4 · efecto de texto en las láminas con foto (tokens.carousel.text_effect) ──');

// El efecto de la marca inventada: la función `shade` (rol `tierra` de SU paleta), en % del ancho.
const TE = { kind: 'shadow', color: 'shade', alpha: 0.8, blur_pct: 1, offset_pct: 0.2 };
const teOver = (te = TE) => ({ palette: { shade: 'tierra' }, carousel: { text_effect: te } });
const conSombra = (scene) => findAll(scene, (n) => n.props?.style?.textShadow != null);
const sinSombra = (v) => JSON.parse(JSON.stringify(v), (k, x) => (k === 'textShadow' ? undefined : x));
const TE_CASOS = [
  [{ index: 1, total: 4, role: 'cover', eyebrow: 'Campo', keyword: 'trigo' }, { headline: 'El trigo no espera', subheadline: 'Ni el clima.' }],
  [{ index: 3, total: 4, role: 'body', eyebrow: 'Campo', keyword: 'trigo', figure: { value: '62%', bar: { from: 10, to: 62 }, source: 'Censo agrario 2025' }, steps: [{ text: 'Sembrar' }, { text: 'Regar', critical: true }] }, { headline: 'El trigo no espera' }],
  [{ index: 4, total: 4, role: 'closing', cta: 'Pide tu caja' }, { headline: 'Cosecha propia' }],
];

test('1.3.4 · SIN token, las láminas con foto son las de 1.3.3 byte a byte (golden del commit bb8bef6)', () => {
  // Golden: sha256 de la escena que producía el bloque de compose 1.3.3 (commit bb8bef6) para estas
  // mismas entradas, con foto. Los goldens de superficie de 1.2.0 y 1.3.2 siguen arriba, intactos.
  const golden = [
    '3a94a86871244d5e3a0015554a24a91d3fd164e316e77bf5a529e0a1e013818c',
    '30c52c5922d9952a355bef4e276d52bb506a08543714acb4124708499d20b731',
    '6c1d830c99d3a9ab372afb1f8fa73bfd98b5254f9f8929417fae3b1eb946ecb0',
  ];
  TE_CASOS.forEach(([c, text], k) => {
    const sc = sceneN1(c, text, undefined, 'data:image/png;base64,BG');
    assert.equal(conSombra(sc).length, 0, 'sin token no hay sombra');
    assert.equal(createHash('sha256').update(JSON.stringify(sc)).digest('hex'), golden[k], `lámina ${c.role}`);
  });
  assert.equal(chromeN1(TE_CASOS[0][0], TE_CASOS[0][1]).textEffect, null);
});

test('1.3.4 · token válido: sombra en TODO el texto de la lámina con foto, y en nada más', () => {
  for (const [c, text] of TE_CASOS) {
    const sc = sceneN1(c, text, teOver(), 'data:image/png;base64,BG');
    const sombra = 'rgba(59, 42, 30, 0.8)';
    const esperada = `0px 0px 10px ${sombra}, 0px 2px 10px ${sombra}`;
    // Texto de la lámina: todos los nodos con texto salvo el logotipo.
    const logo = new Set(['Granja', 'Sur']);
    const textos = textNodes(sc).filter((n) => !logo.has(n.props.children));
    assert.ok(textos.length >= 3, `${c.role}: hay texto que sombrear`);
    for (const n of textos) {
      const own = n.props.style?.textShadow;
      // El titular lleva la sombra en su contenedor y en cada tramo (la clave incluida).
      assert.equal(own, esperada, `${c.role}: «${n.props.children}» lleva la sombra (desenfoque y caída en % del ancho 1000)`);
    }
    for (const n of textNodes(sc).filter((x) => logo.has(x.props.children))) {
      assert.equal(n.props.style?.textShadow, undefined, 'el logotipo no lleva sombra');
    }
    for (const n of conSombra(sc)) {
      assert.ok(typeof n.props.children === 'string' || n.props.style.flexWrap === 'wrap',
        'la sombra sólo va en nodos de texto (y en el contenedor del titular)');
    }
    assert.equal(findAll(sc, (n) => n.props?.style?.flexGrow === 1 && n.props.style.textShadow).length, 0, 'la barra de progreso no');
    // Una capa no toca a la otra: quitando la sombra, la escena es exactamente la de sin token.
    assert.deepEqual(sinSombra(sc), sinSombra(sceneN1(c, text, undefined, 'data:image/png;base64,BG')),
      `${c.role}: el velo, la foto, la franja y la geometría no cambian`);
  }
  const ch = chromeN1(TE_CASOS[0][0], TE_CASOS[0][1], teOver());
  assert.deepEqual(ch.textEffect, { kind: 'shadow', fn: 'shade', alpha: 0.8, blurPct: 1, offsetPct: 0.2, color: 'rgba(59, 42, 30, 0.8)' });
  assert.equal(M.carouselTextShadow(ch.textEffect, 2000), '0px 0px 20px rgba(59, 42, 30, 0.8), 0px 4px 20px rgba(59, 42, 30, 0.8)',
    'los px salen del ancho del lienzo, no de una constante');
});

test('1.3.4 · lámina sobre superficie: sin efecto aunque la marca lo declare', () => {
  const c = { index: 2, total: 4, role: 'body', background: 'surface', eyebrow: 'Campo', keyword: 'trigo', steps: [{ text: 'Sembrar' }] };
  const sc = sceneN1(c, { headline: 'El trigo no espera' }, teOver());
  assert.equal(conSombra(sc).length, 0);
  assert.equal(JSON.stringify(sc), JSON.stringify(sceneN1(c, { headline: 'El trigo no espera' })), 'idéntica a la de sin token');
  // Y una lámina «con foto» a la que no le llegó foto tampoco: sin foto no hay contra qué contrastar.
  assert.equal(conSombra(sceneN1({ index: 1, total: 4, role: 'cover' }, { headline: 'Cosecha' }, teOver(), null)).length, 0);
});

test('1.3.4 · token mal formado → 400 CAROUSEL_TEXT_EFFECT_INVALID', () => {
  const malos = [
    'sombra', [], 0,
    { ...TE, kind: 'glow' }, { ...TE, kind: undefined },
    { ...TE, color: '' }, { ...TE, color: 3 }, { ...TE, color: { role: 'tierra' } },
    { ...TE, alpha: 0 }, { ...TE, alpha: 1.2 }, { ...TE, alpha: '0.8' }, { ...TE, alpha: undefined },
    { ...TE, blur_pct: -1 }, { ...TE, blur_pct: 12 }, { ...TE, blur_pct: '1' }, { ...TE, offset_pct: Number.NaN },
    { ...TE, offset_pct: 6 }, { ...TE, blur_pct: 0, offset_pct: 0 },
  ];
  for (const te of malos) {
    assert.throws(() => chromeN1({ index: 1, total: 2, role: 'cover' }, { headline: 'x' }, teOver(te)),
      (e) => e.label === 'CAROUSEL_TEXT_EFFECT_INVALID' && e.status === 400, JSON.stringify(te));
  }
  // Los bordes válidos pasan: sombra dura sin desenfoque, o halo sin caída.
  assert.equal(chromeN1({ index: 1, total: 2, role: 'cover' }, { headline: 'x' }, teOver({ ...TE, blur_pct: 0, offset_pct: 0.3 })).textEffect.blurPct, 0);
  assert.equal(chromeN1({ index: 1, total: 2, role: 'cover' }, { headline: 'x' }, teOver({ ...TE, alpha: 1, offset_pct: 0 })).textEffect.offsetPct, 0);
});

test('1.3.4 · función de color inexistente → fail-loud como los demás colores del carrusel', () => {
  const sinFuncion = { carousel: { text_effect: { ...TE, color: 'sombra_texto' } } };
  assert.throws(() => chromeN1({ index: 1, total: 2, role: 'cover' }, { headline: 'x' }, sinFuncion),
    (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE' && /palette\.sombra_texto \(pedido por carousel\.text_effect\.color\)/.test(e.message));
  const rolInexistente = { palette: { shade: 'no_existe' }, carousel: { text_effect: TE } };
  assert.throws(() => chromeN1({ index: 1, total: 2, role: 'cover' }, { headline: 'x' }, rolInexistente),
    (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE' && /brand_palette\.role='no_existe'/.test(e.message));
  // La función puede declarar su propio alfa para su elemento; el del efecto es el que manda.
  const conAlfa = chromeN1({ index: 1, total: 2, role: 'cover' }, { headline: 'x' },
    { palette: { shade: { role: 'tierra', alpha: 0.1 } }, carousel: { text_effect: TE } });
  assert.equal(conAlfa.textEffect.color, 'rgba(59, 42, 30, 0.8)');
});


console.log('\n── 1.4.0 · ÉNFASIS POR PALABRA en el titular ──');

// La marca N+1 declara su énfasis con SUS roles: otra familia, más chica de peso, itálica, en
// mayúsculas, un 30 % más grande y en el color 'trigo'. Ningún nombre de esto vive en el motor.
const EM_TOK = { typography: { headline: { emphasis: { role: 'texto', weight: 400, italic: true, transform: 'uppercase', size_scale: 1.3 } } },
  palette: { headline_emphasis: 'trigo' } };
const H_EM = 'La cuota extraordinaria no se vota a mano alzada';
const styleN1 = (text, over = {}) => M.resolveOverlayStyle({ tokens: M.deepMergeTokens(N1_BASE, over), typography: N1_TYPO, palette: N1_PAL, text });
const overlayN1 = (style) => M.buildOverlayScene({ style, width: 1000, height: 1250, backgroundSrc: 'data:image/png;base64,AA' });
const spanTexts = (scene) => findAll(scene, (n) => n.type === 'span').map((n) => n.props.children);

test('1.4.0 · la versión sube: cambia lo que el compositor dibuja', () => {
  assert.ok(['1.4.0', '1.5.0', '1.6.0', '1.6.1', '1.6.2', '1.6.3', '1.6.4', '1.7.0', '1.8.0', '1.9.0', '1.10.0', '1.11.0', '1.11.1', '1.12.0', '1.13.0', '1.13.1', '1.14.0', '1.15.0', '1.16.0', '1.17.0', '1.18.0', '1.19.0'].includes(M.COMPOSITOR_VERSION), 'la versión sube cuando cambia lo que se dibuja');
});

test('1.4.0 · contrato de `emphasis`: lista de hasta 3 subcadenas; lo demás es 400 con etiqueta', () => {
  assert.deepEqual(M.parseEmphasisRequest(undefined), []);
  assert.deepEqual(M.parseEmphasisRequest(null), []);
  assert.deepEqual(M.parseEmphasisRequest(['cuota', 'cuota', 'mano alzada']), ['cuota', 'mano alzada'], 'duplicados fuera, orden conservado');
  for (const bad of ['cuota', [1], [''], ['  '], ['a', 'b', 'c', 'd'], ['x'.repeat(61)], { 0: 'cuota' }]) {
    assert.throws(() => M.parseEmphasisRequest(bad), (e) => e.label === 'COMPOSITOR_EMPHASIS_INVALID' && e.status === 400, JSON.stringify(bad));
  }
});

test('1.4.0 · splitEmphasis: varios tramos, el primero gana si se solapan, los ausentes se dicen', () => {
  const r = M.splitEmphasis(H_EM, ['cuota extraordinaria', 'cuota', 'mano alzada', 'asamblea']);
  assert.deepEqual(r.found, ['cuota extraordinaria', 'mano alzada']);
  assert.deepEqual(r.missing, ['cuota', 'asamblea'], '«cuota» se solapa con un tramo anterior y no tiene otra aparición');
  assert.equal(r.parts.map((p) => p.text).join(''), H_EM, 'el texto visible es el mismo, carácter por carácter');
  assert.deepEqual(r.parts.filter((p) => p.keyword).map((p) => p.text), ['cuota extraordinaria', 'mano alzada']);
  // Una segunda aparición libre se toma si la primera está ocupada.
  const r2 = M.splitEmphasis('la cuota y la cuota', ['la cuota', 'cuota']);
  assert.deepEqual(r2.parts, [{ text: 'la cuota', keyword: true }, { text: ' y la ', keyword: false }, { text: 'cuota', keyword: true }]);
});

test('1.4.0 · con un solo término, splitEmphasis da lo mismo que splitKeyword (1.3.4)', () => {
  for (const [h, k] of [[H_EM, 'cuota'], [H_EM, 'alzada'], [H_EM, 'La'], [H_EM, 'nada'], [H_EM, null], ['', 'x'], ['SAME GOAL. BROKEN.', 'BROKEN']]) {
    const a = M.splitKeyword(h, k);
    const b = M.splitEmphasis(h, [k]);
    assert.deepEqual(b.parts, a.parts, `${h} / ${k}`);
    assert.equal(b.found.length > 0, a.found);
  }
});

test('1.4.0 · sin token de énfasis en la marca: marcador, y la escena es la de 1.3.4', () => {
  const sin = styleN1({ headline: H_EM });
  const con = styleN1({ headline: H_EM, emphasis: ['cuota'] });
  assert.ok(con.markers.some((m) => m.startsWith('OVERLAY_EMPHASIS_NOT_DECLARED')));
  assert.ok(!('parts' in con.slots.headline) && !('emphasis' in con.slots.headline), 'la ranura no gana claves');
  assert.equal(JSON.stringify(overlayN1(con)), JSON.stringify(overlayN1(sin)));
});

test('1.4.0 · token declarado y pieza sin tramos: la escena es la de 1.3.4, clave por clave', () => {
  const sin = styleN1({ headline: H_EM });
  const tokSinTramos = styleN1({ headline: H_EM }, EM_TOK);
  assert.equal(JSON.stringify(overlayN1(tokSinTramos)), JSON.stringify(overlayN1(sin)));
  assert.deepEqual(tokSinTramos.markers, sin.markers);
});

test('1.4.0 · con token y tramos: cada tramo con la familia, peso, estilo, tamaño, mayúsculas y color de la marca', () => {
  // 1.7.0 — este test fija el dibujo de 1.4.0 (una sola fila que envuelve). La regla de cortes de 1.7.0 se
  // apaga por dato para medirlo igual; la regla tiene sus propios tests abajo.
  const st = styleN1({ headline: H_EM, emphasis: ['cuota extraordinaria', 'mano alzada'] },
    { ...EM_TOK, typography: { headline: { ...EM_TOK.typography.headline, line_breaks: 'auto' } } });
  const h = st.slots.headline;
  assert.equal(h.text, H_EM);
  assert.equal(h.parts.map((p) => p.text).join(''), H_EM);
  assert.equal(h.emphasis.family, 'Fuente Texto');
  assert.equal(h.emphasis.color, 'rgb(217, 164, 65)', "palette.headline_emphasis → rol 'trigo'");
  const scene = overlayN1(st);
  const spans = findAll(scene, (n) => n.type === 'span');
  const enf = spans.filter((n) => n.props.style.fontFamily);
  assert.deepEqual(enf.map((n) => n.props.children.replace(/ /g, ' ').trim()), ['cuota', 'extraordinaria', 'mano', 'alzada']);
  const size = Math.round((h.sizePct * 1.3 / 100) * 1000 * 100) / 100;
  for (const n of enf) {
    assert.deepEqual(n.props.style, { fontFamily: 'Fuente Texto', fontWeight: 400, fontStyle: 'italic', fontSize: size,
      letterSpacing: 0, textTransform: 'uppercase', color: 'rgb(217, 164, 65)' });
  }
  for (const n of spans.filter((x) => !x.props.style.fontFamily)) assert.deepEqual(n.props.style, {}, 'lo demás hereda del titular');
  assert.equal(spanTexts(scene).join('').replace(/ /g, ' '), H_EM, 'el texto visible es el mismo carácter por carácter');
  const slotDiv = findAll(scene, (n) => n.props?.style?.flexWrap === 'wrap')[0];
  assert.equal(slotDiv.props.style.alignItems, 'baseline', 'tamaños distintos alineados por la línea de base');
  assert.equal(slotDiv.props.style.fontFamily, 'Fuente Titular', 'la base del titular sigue siendo la suya');
});

test('1.4.0 · lo que el token no declara se hereda del titular', () => {
  const st = styleN1({ headline: H_EM, emphasis: ['cuota'] }, { typography: { headline: { emphasis: { size_scale: 1.2 } } } });
  const e = st.slots.headline.emphasis;
  assert.equal(e.family, 'Fuente Titular');
  assert.equal(e.weight, 700);
  assert.equal(e.italic, false);
  assert.equal(e.color, 'rgb(244, 239, 230)', 'sin palette.headline_emphasis, el color del titular');
});

test('1.4.0 · un tramo que no está literal se dice y no se resalta; los demás sí', () => {
  const st = styleN1({ headline: H_EM, emphasis: ['Cuota', 'mano alzada'] }, EM_TOK);
  assert.ok(st.markers.some((m) => m.startsWith('OVERLAY_EMPHASIS_NOT_IN_HEADLINE') && m.includes('«Cuota»')), 'literal: sin normalizar mayúsculas');
  assert.deepEqual(st.slots.headline.parts.filter((p) => p.keyword).map((p) => p.text), ['mano alzada']);
  const ninguno = styleN1({ headline: H_EM, emphasis: ['asamblea'] }, EM_TOK);
  assert.ok(!('parts' in ninguno.slots.headline), 'ningún tramo encontrado ⇒ ranura de 1.3.4');
});

test('1.4.0 · token mal escrito → fail-loud nombrando, aunque la pieza no traiga tramos', () => {
  for (const [over, re] of [
    [{ typography: { headline: { emphasis: { role: 'no_existe' } } } }, /brand_typography\.role='no_existe' \(pedido por typography\.headline\.emphasis\.role\)/],
    [{ typography: { headline: { emphasis: { size_scale: 4 } } } }, /typography\.headline\.emphasis\.size_scale=4/],
    [{ typography: { headline: { emphasis: { size_scale: 'x' } } } }, /typography\.headline\.emphasis\.size_scale=x/],
    [{ ...EM_TOK, palette: { headline_emphasis: 'no_existe' } }, /brand_palette\.role='no_existe' \(pedido por palette\.headline_emphasis\)/],
  ]) {
    assert.throws(() => styleN1({ headline: H_EM, emphasis: ['cuota'] }, over), (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE' && re.test(e.message), JSON.stringify(over));
  }
  assert.throws(() => styleN1({ headline: H_EM }, { typography: { headline: { emphasis: { role: 'no_existe' } } } }),
    (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE');
});

test('1.4.0 · la escalera de tamaños cuenta el tramo agrandado: un titular que cabía puede bajar un escalón', () => {
  const steps = { typography: { headline: { fit_steps: [{ max_chars: 50, size_pct: 9 }, { max_chars: 90, size_pct: 7 }] } } };
  const plano = styleN1({ headline: H_EM }, steps);
  assert.equal(plano.slots.headline.sizePct, 9, `${H_EM.length} caracteres caben en el primer escalón`);
  const grande = styleN1({ headline: H_EM, emphasis: ['cuota extraordinaria'] },
    M.deepMergeTokens(steps, { typography: { headline: { emphasis: { size_scale: 1.5 } } } }));
  assert.equal(M.emphasisEffectiveLength(grande.slots.headline.parts, 1.5), 58);
  assert.equal(grande.slots.headline.sizePct, 7);
});

const EM_CAR = { carousel: { typography: { headline: { emphasis: { role: 'texto', weight: 400, italic: true, transform: 'uppercase', size_scale: 1.25 } } } } };

test('1.4.0 · carrusel sin token de énfasis ni tramos: el cromo es el de 1.3.4', () => {
  const a = chromeN1({ index: 2, total: 5, role: 'body', keyword: 'cuota' }, { headline: H_EM });
  assert.equal(a.headlineEmphasis, null);
  assert.deepEqual(a.headline, M.splitKeyword(H_EM, 'cuota').parts);
  assert.ok(!a.fonts.some((f) => f.italic), 'ninguna fuente de más (la de énfasis es la única itálica de este fixture)');
  const conTramos = chromeN1({ index: 2, total: 5, role: 'body', keyword: 'cuota' }, { headline: H_EM, emphasis: [] });
  assert.deepEqual(conTramos, a, 'emphasis vacío ⇒ el mismo cromo');
});

test('1.4.0 · carrusel con token: la palabra clave y los tramos llevan la tipografía de énfasis y el color de `keyword`', () => {
  const c = { index: 2, total: 5, role: 'body', keyword: 'cuota' };
  const text = { headline: H_EM, emphasis: ['mano alzada', 'cuota'] };
  const ch = chromeN1(c, text, EM_CAR);
  assert.equal(ch.headlineEmphasis.family, 'Fuente Texto');
  assert.deepEqual(ch.headline.filter((p) => p.keyword).map((p) => p.text), ['cuota', 'mano alzada'], 'la clave de la lámina primero; sin duplicar');
  assert.ok(ch.fonts.some((f) => f.family === 'Fuente Texto' && f.weight === 400 && f.italic), 'la fuente del énfasis se carga');
  const tokens = n1Tokens(EM_CAR);
  const style = M.resolveOverlayStyle({ tokens, typography: N1_TYPO, palette: N1_PAL, text });
  const scene = M.buildCarouselScene({ chrome: ch, style, backgroundSrc: 'data:image/png;base64,AA' });
  const titular = findAll(scene, (n) => n.props?.style?.flexWrap === 'wrap')[0];
  const spans = findAll(titular, (n) => n.type === 'span');
  const hs = Math.round((ch.type.headline.sizePct / 100) * 1000 * 100) / 100;
  const enf = spans.filter((n) => n.props.style.fontFamily === 'Fuente Texto');
  assert.deepEqual(enf.map((n) => n.props.children.replace(/ /g, ' ').trim()), ['cuota', 'mano', 'alzada']);
  for (const n of enf) {
    assert.equal(n.props.style.fontSize, Math.round(hs * 1.25 * 100) / 100);
    assert.equal(n.props.style.color, ch.colors.keyword);
    assert.equal(n.props.style.textTransform, 'uppercase');
  }
  assert.equal(spans.map((n) => n.props.children).join('').replace(/ /g, ' '), H_EM);
});

test('1.4.0 · carrusel: un tramo ausente se avisa; la clave ausente conserva su aviso de siempre', () => {
  const ch = chromeN1({ index: 2, total: 5, role: 'body', keyword: 'nada' }, { headline: H_EM, emphasis: ['asamblea', 'cuota'] }, EM_CAR);
  assert.ok(ch.warnings.includes('CAROUSEL_KEYWORD_NOT_IN_HEADLINE'));
  assert.ok(ch.warnings.some((w) => w.startsWith('CAROUSEL_EMPHASIS_NOT_IN_HEADLINE') && w.includes('«asamblea»')));
  assert.deepEqual(ch.headline.filter((p) => p.keyword).map((p) => p.text), ['cuota']);
});

test('1.4.0 · carrusel: el ajuste vertical mide el tramo agrandado con su fuente y su tamaño', () => {
  const c = { index: 2, total: 5, role: 'body', keyword: 'cuota extraordinaria' };
  const sin = M.measureCarouselLayout(chromeN1(c, { headline: H_EM }), null);
  const con = M.measureCarouselLayout(chromeN1(c, { headline: H_EM }, { carousel: { typography: { headline: { emphasis: { size_scale: 2 } } } } }), null);
  assert.ok(con.mid > sin.mid, `el bloque con el tramo al doble es más alto (${con.mid} > ${sin.mid})`);
  assert.throws(() => chromeN1(c, { headline: H_EM }, { carousel: { typography: { headline: { emphasis: { role: 'no_existe' } } } } }),
    (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE' && /carousel\.typography\.headline\.emphasis\.role/.test(e.message));
});


console.log('\n── 1.5.0 · EL TEXTO RESPETA A LA PLATAFORMA: área máxima y zona segura, como dato ──');
const LARGO15 = { headline: 'La cuota extraordinaria no se vota a mano alzada y el acta que diga lo contrario no vale nada', subheadline: 'Lo que dice el reglamento, sin adornos, y lo que el administrador no le va a contar.' };
const N1_STEPS = { typography: {
  headline: { fit_steps: [{ max_chars: 200, size_pct: 9 }, { max_chars: 300, size_pct: 7 }, { max_chars: 400, size_pct: 5 }] },
  subheadline: { fit_steps: [{ max_chars: 200, size_pct: 4 }, { max_chars: 400, size_pct: 3 }] } } };

test('1.5.0 · sin los tokens nuevos la caja es la de siempre y la escena no cambia', () => {
  const st = styleN1(TXT);
  assert.ok(!('maxTextAreaPct' in st.layout) && !('safeZonePct' in st.layout), 'el layout no gana claves');
  const b = M.overlayTextBox(st, 1000, 1250);
  assert.deepEqual(b, { safe: false, top: 60, right: 60, bottom: 60, left: 60, maxWidth: 800 });
  const r = M.fitOverlayTextArea({ style: st, width: 1000, height: 1250, metrics: null });
  assert.equal(r.style, st, 'sin límite: el MISMO objeto');
  assert.equal(r.report, null);
});

test('1.5.0 · zona segura: cada borde toma el mayor entre el margen y lo que tapa la interfaz', () => {
  const st = styleN1(TXT, { layout: { safe_zone_pct: { top: 14, bottom: 37, left: 3, right: 22 } } });
  const b = M.overlayTextBox(st, 1000, 1800);
  assert.deepEqual(b, { safe: true, top: 252, right: 220, bottom: 666, left: 60, maxWidth: 720 });
  const scene = M.buildOverlayScene({ style: st, width: 1000, height: 1800, backgroundSrc: 'data:image/png;base64,AA' });
  const capa = findAll(scene, (n) => n.props?.style?.paddingBottom != null)[0];
  assert.deepEqual([capa.props.style.paddingTop, capa.props.style.paddingRight, capa.props.style.paddingBottom, capa.props.style.paddingLeft], [252, 220, 666, 60]);
  assert.ok(!('padding' in capa.props.style), 'con zona segura no hay padding uniforme');
  assert.equal(findAll(scene, (n) => n.props?.style?.maxWidth != null)[0].props.style.maxWidth, 720, 'el ancho no pasa del hueco');
});

test('1.5.0 · tokens mal escritos → fail-loud nombrando', () => {
  for (const [over, re] of [
    [{ layout: { max_text_area_pct: 0 } }, /layout\.max_text_area_pct=0/],
    [{ layout: { max_text_area_pct: 'mucho' } }, /layout\.max_text_area_pct=mucho/],
    [{ layout: { safe_zone_pct: { top: 60 } } }, /layout\.safe_zone_pct/],
    [{ layout: { safe_zone_pct: 'arriba' } }, /layout\.safe_zone_pct/],
  ]) {
    assert.throws(() => styleN1(TXT, over), (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE' && re.test(e.message), JSON.stringify(over));
  }
});

test('1.5.0 · la medición crece con el tamaño y con la bajada, y dice cuando estima', () => {
  const st = styleN1(LARGO15, N1_STEPS);
  const a = M.measureOverlayText(st, 1000, 1000, null);
  const chico = M.measureOverlayText({ ...st, slots: { ...st.slots, headline: { ...st.slots.headline, sizePct: 5 } } }, 1000, 1000, null);
  const sinBajada = M.measureOverlayText({ ...st, slots: { ...st.slots, subheadline: null } }, 1000, 1000, null);
  assert.ok(chico.areaPct < a.areaPct && sinBajada.areaPct < a.areaPct, `${chico.areaPct} y ${sinBajada.areaPct} < ${a.areaPct}`);
  assert.ok(a.width <= M.overlayTextBox(st, 1000, 1000).maxWidth, 'el bloque no pasa de la caja');
  assert.deepEqual(a.estimated, ['Fuente Titular', 'Fuente Texto'], 'sin métricas, se dice');
});

test('1.5.0 · límite de área: baja el titular, luego la bajada, luego la quita; el texto no cambia', () => {
  const st = styleN1(LARGO15, M.deepMergeTokens(N1_STEPS, { layout: { max_text_area_pct: 20 } }));
  const antes = M.measureOverlayText(st, 1000, 1000, null).areaPct;
  assert.ok(antes > 20, `el caso excede (${antes} %)`);
  const r = M.fitOverlayTextArea({ style: st, width: 1000, height: 1000, metrics: null });
  assert.ok(r.report.adjusted && r.report.area_pct <= 20, `queda en ${r.report.area_pct} %`);
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_AREA_REDUCED')));
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_AREA_ESTIMATED')), 'sin métricas, el marcador lo dice');
  assert.equal(r.style.slots.headline.text, LARGO15.headline, 'el titular es el mismo, carácter por carácter');
  if (r.style.slots.subheadline) assert.equal(r.style.slots.subheadline.text, LARGO15.subheadline);
  assert.ok(r.style.slots.headline.sizePct < st.slots.headline.sizePct);
});

test('1.5.0 · si ni al mínimo cabe: sin bajada, al tamaño mínimo y con marcador; se compone igual', () => {
  const st = styleN1(LARGO15, M.deepMergeTokens(N1_STEPS, { layout: { max_text_area_pct: 1 } }));
  const r = M.fitOverlayTextArea({ style: st, width: 1000, height: 1000, metrics: null });
  assert.equal(r.style.slots.subheadline, null, 'se retiró la bajada');
  assert.equal(r.style.slots.headline.sizePct, 5, 'el escalón más chico');
  assert.ok(r.report.exceeded && r.report.dropped_subheadline);
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_AREA_EXCEEDED')));
});

test('1.5.0 · el límite cuenta el tramo agrandado del énfasis', () => {
  const tok = M.deepMergeTokens(M.deepMergeTokens(N1_STEPS, EM_TOK), { typography: { headline: { emphasis: { size_scale: 2 } } } });
  const plano = M.measureOverlayText(styleN1({ headline: H_EM }, tok), 1000, 1000, null).areaPct;
  const con = M.measureOverlayText(styleN1({ headline: H_EM, emphasis: ['cuota extraordinaria'] }, tok), 1000, 1000, null).areaPct;
  assert.ok(con > plano, `${con} > ${plano}`);
});

test('1.5.0 · carrusel: el límite rige SÓLO la portada', () => {
  const lim = { layout: { max_text_area_pct: 5 } };
  const CORTO = 'El trigo no se vende a mano alzada';
  const portada = chromeN1({ index: 1, total: 5, role: 'cover' }, { headline: CORTO }, lim);
  assert.equal(portada.maxTextAreaPct, 5);
  const r = M.fitCarouselCoverArea({ chrome: portada, metrics: null });
  assert.ok(r.report && r.report.area_pct < r.report.area_pct_before, 'la portada baja');
  assert.ok(r.warnings.some((w) => w.startsWith('CAROUSEL_TEXT_AREA_REDUCED')));
  assert.equal(r.chrome.headline.map((p) => p.text).join(''), CORTO, 'el texto no cambia');
  const yaMinima = M.fitCarouselCoverArea({ chrome: chromeN1({ index: 1, total: 5, role: 'cover' }, { headline: LARGO15.headline }, lim), metrics: null });
  assert.ok(!yaMinima.warnings.some((w) => w.startsWith('CAROUSEL_TEXT_AREA_REDUCED')), 'sin escalón más chico no dice «reducido»');
  assert.ok(yaMinima.warnings.some((w) => w.startsWith('CAROUSEL_TEXT_AREA_EXCEEDED')), 'pero sí que excede');
  const interior = chromeN1({ index: 3, total: 5, role: 'body' }, { headline: LARGO15.headline }, lim);
  const ri = M.fitCarouselCoverArea({ chrome: interior, metrics: null });
  assert.equal(ri.chrome, interior, 'lámina interior: el mismo cromo');
  assert.equal(ri.report, null);
  const sinLimite = chromeN1({ index: 1, total: 5, role: 'cover' }, { headline: LARGO15.headline });
  assert.ok(!('maxTextAreaPct' in sinLimite), 'sin el token, el cromo no gana claves');
  assert.equal(M.fitCarouselCoverArea({ chrome: sinLimite, metrics: null }).chrome, sinLimite);
});


// ── 1.7.0 · CORTES DE LÍNEA DEL TITULAR (Sam, 2026-10-19) ────────────────────────────────────────
// Los cuatro titulares son los de las capturas que Sam mandó ese día; las líneas esperadas son las que
// él propuso. El énfasis es el que traían.
const lineas = (h, terms) => {
  const r = M.headlineLineRanges(h, terms ? M.splitEmphasis(h, terms).parts : null);
  return r ? { source: r.source, lines: r.ranges.map(([a, b]) => h.slice(a, b)) } : null;
};
test('1.7.0 · ejemplo 1: la frase con énfasis al inicio se queda; el segundo énfasis abre línea y lo que sigue baja', () => {
  assert.deepEqual(lineas('75 MINUTOS de blowout. MENOS DE 5 en el estacionamiento.', ['75 MINUTOS', 'MENOS DE 5']),
    { source: 'rule', lines: ['75 MINUTOS de blowout.', 'MENOS DE 5', 'en el estacionamiento.'] });
});
test('1.7.0 · ejemplo 2: el énfasis va en su propia línea', () => {
  assert.deepEqual(lineas('¿Por qué el color SE VA ANTES de la próxima cita?', ['SE VA ANTES']),
    { source: 'rule', lines: ['¿Por qué el color', 'SE VA ANTES', 'de la próxima cita?'] });
});
test('1.7.0 · ejemplo 3: «DÓNDE VIVES» no se parte: baja junto', () => {
  assert.deepEqual(lineas('Tu colorista te preguntó qué color querías. Nunca te preguntó DÓNDE VIVES.', ['DÓNDE VIVES']),
    { source: 'rule', lines: ['Tu colorista te preguntó qué color querías. Nunca te preguntó', 'DÓNDE VIVES.'] });
});
test('1.7.0 · ejemplo 4: dos tramos cercanos son un bloque; lo que sigue baja', () => {
  assert.deepEqual(lineas('Tu PUNTA y tu RAÍZ no tienen la misma edad.', ['PUNTA', 'RAÍZ']),
    { source: 'rule', lines: ['Tu PUNTA y tu RAÍZ', 'no tienen la misma edad.'] });
});
test('1.7.0 · una palabra corta no queda colgada al final de la línea: baja con lo que sigue', () => {
  assert.deepEqual(lineas('La cuota extraordinaria no se vota a mano alzada', ['cuota extraordinaria', 'mano alzada']),
    { source: 'rule', lines: ['La cuota extraordinaria', 'no se vota', 'a mano alzada'] });
});
test('1.7.0 · un salto escrito manda, con o sin énfasis, y las líneas vacías no cuentan', () => {
  assert.deepEqual(lineas('Tu colorista te preguntó qué color querías.\nNunca te preguntó\n\nDÓNDE VIVES.', ['DÓNDE VIVES']),
    { source: 'manual', lines: ['Tu colorista te preguntó qué color querías.', 'Nunca te preguntó', 'DÓNDE VIVES.'] });
  assert.deepEqual(lineas('Sin énfasis\ny en dos líneas', null), { source: 'manual', lines: ['Sin énfasis', 'y en dos líneas'] });
});
test('1.7.0 · sin salto escrito ni énfasis, ni corte: la ranura es la de 1.6.4', () => {
  assert.equal(lineas('Un titular cualquiera sin énfasis', null), null);
  const st = styleN1({ headline: 'Un titular cualquiera sin énfasis' });
  assert.ok(!('lines' in st.slots.headline), 'la ranura no gana la clave');
});
test('1.7.0 · un énfasis corto con poco alrededor no fuerza cortes', () => {
  assert.equal(lineas('Tu PELO no miente', ['PELO']), null);
});
test('1.7.0 · la escena: una fila por línea, y el texto visible es el mismo', () => {
  const h = '¿Por qué el color SE VA ANTES de la próxima cita?';
  const st = styleN1({ headline: h, emphasis: ['SE VA ANTES'] }, EM_TOK);
  assert.deepEqual(st.slots.headline.lines.map(([a, b]) => h.slice(a, b)), ['¿Por qué el color', 'SE VA ANTES', 'de la próxima cita?']);
  assert.ok(st.markers.some((m) => m.startsWith('OVERLAY_HEADLINE_LINES: 3 líneas (regla del énfasis)')));
  const scene = overlayN1(st);
  const col = findAll(scene, (n) => n.props?.style?.flexDirection === 'column' && n.props?.style?.fontFamily === 'Fuente Titular')[0];
  assert.ok(col, 'la ranura del titular es una columna');
  assert.equal(col.props.children.length, 3, 'tres filas');
  const filas = col.props.children.map((row) => spanTexts(row).join('').replace(/ /g, ' ').trim());
  assert.deepEqual(filas, ['¿Por qué el color', 'SE VA ANTES', 'de la próxima cita?']);
});
test('1.7.0 · un salto escrito sin énfasis también se dibuja en filas', () => {
  const st = styleN1({ headline: 'Primera línea\nsegunda línea' });
  const scene = overlayN1(st);
  const col = findAll(scene, (n) => n.props?.style?.flexDirection === 'column' && n.props?.style?.fontFamily === 'Fuente Titular')[0];
  assert.deepEqual(col.props.children.map((r) => r.props.children), ['Primera línea', 'segunda línea']);
});
test("1.7.0 · `line_breaks: 'auto'` apaga la regla, pero no el salto escrito; un valor desconocido es fail-loud", () => {
  const auto = { ...EM_TOK, typography: { headline: { ...EM_TOK.typography.headline, line_breaks: 'auto' } } };
  assert.ok(!('lines' in styleN1({ headline: '¿Por qué el color SE VA ANTES de la próxima cita?', emphasis: ['SE VA ANTES'] }, auto).slots.headline));
  assert.equal(styleN1({ headline: 'Uno\nDos', emphasis: [] }, auto).slots.headline.lines.length, 2);
  const mal = { typography: { headline: { line_breaks: 'siempre' } } };
  assert.throws(() => styleN1({ headline: 'Uno' }, mal), /line_breaks/);
});
test('1.7.0 · el área se mide línea por línea: más cortes, más alto', () => {
  const una = M.measureOverlayText(styleN1({ headline: 'Hola mundo' }), 1000, 1250, null);
  const dos = M.measureOverlayText(styleN1({ headline: 'Hola\nmundo' }), 1000, 1250, null);
  assert.ok(dos.height > una.height, `con un corte escrito el bloque es más alto (${dos.height} > ${una.height})`);
});

console.log('\n── 1.8.0 · EL COLOR DEL RESALTADO LO ELIGE UNA PERSONA ──');

test('1.8.0 · un rol válido recolorea el resaltado y apaga la corrección automática', () => {
  const base = styleN1({ headline: H_EM, emphasis: ['no se vota'] }, { ...EM_TOK, layout: { emphasis_contrast: { min_contrast: 3, fallbacks: ['tierra'] } } });
  const otro = N1_PAL.find((p) => p.role === 'tierra');
  const r = M.applyEmphasisRole(base, otro.role, N1_PAL, ['trigo', 'tierra']);
  assert.equal(r.applied, otro.role);
  assert.notEqual(r.style.slots.headline.emphasis.color, base.slots.headline.emphasis.color);
  assert.equal(r.style.layout.emphasisContrast, undefined, 'lo eligió una persona: el contraste automático no lo cambia');
});
test('1.8.0 · un rol que la marca no tiene no rompe: sale igual y se dice', () => {
  const base = styleN1({ headline: H_EM, emphasis: ['no se vota'] }, EM_TOK);
  const r = M.applyEmphasisRole(base, 'rol_inexistente', N1_PAL, ['trigo', 'rol_inexistente']);
  assert.equal(r.applied, null);
  assert.equal(r.style.slots.headline.emphasis.color, base.slots.headline.emphasis.color);
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_EMPHASIS_ROLE_UNKNOWN')));
});
test('1.8.0 · sin rol o sin resaltado en el titular, el estilo es el mismo objeto', () => {
  const base = styleN1({ headline: H_EM, emphasis: ['no se vota'] }, EM_TOK);
  assert.equal(M.applyEmphasisRole(base, null, N1_PAL, ['trigo']).style, base);
  const sinEm = styleN1({ headline: H_EM }, EM_TOK);
  assert.equal(M.applyEmphasisRole(sinEm, 'trigo', N1_PAL, ['trigo']).style, sinEm);
});
test('1.8.0 · sólo resaltan los colores que la marca declara: un rol de la paleta fuera de la lista no se aplica', () => {
  const base = styleN1({ headline: H_EM, emphasis: ['no se vota'] }, EM_TOK);
  const r = M.applyEmphasisRole(base, 'hoja', N1_PAL, ['trigo', 'tierra']);
  assert.equal(r.applied, null);
  assert.equal(r.style.slots.headline.emphasis.color, base.slots.headline.emphasis.color);
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_EMPHASIS_ROLE_NOT_ALLOWED')));
});
test('1.8.0 · la lista de resaltado es el color de siempre más las alternativas, sin repetir; sin dato, vacía', () => {
  assert.deepEqual(M.emphasisAllowedRoles({ palette: { headline_emphasis: 'trigo' }, layout: { emphasis_contrast: { fallbacks: ['tierra', 'trigo', 'cielo'] } } }), ['trigo', 'tierra', 'cielo']);
  assert.deepEqual(M.emphasisAllowedRoles({ palette: { headline_emphasis: 'trigo' } }), ['trigo']);
  assert.deepEqual(M.emphasisAllowedRoles(null), []);
});
test('1.8.0 · el contrato: rol mal escrito es 400; vacío o ausente, null', () => {
  assert.equal(M.parseEmphasisRoleRequest(undefined), null);
  assert.equal(M.parseEmphasisRoleRequest(''), null);
  assert.equal(M.parseEmphasisRoleRequest('accent_2'), 'accent_2');
  assert.throws(() => M.parseEmphasisRoleRequest('Accent 2'), /COMPOSITOR_EMPHASIS_ROLE_INVALID|emphasis_role/);
  assert.throws(() => M.parseEmphasisRoleRequest(3), /emphasis_role/);
});


console.log('\n── 1.9.0 · LA SOMBRA Y LA FRANJA LAS ELIGE UNA PERSONA ──');

// Marca N+1 inventada: la sombra es de su paleta (`tierra`), el filete de la suya (`arcilla`).
const SOMBRA = (when) => ({ layout: { text_effect: { kind: 'shadow', color: 'tierra', alpha: 0.5, blur_pct: 0.6, offset_pct: 0.2, ...(when ? { when } : {}) } } });
const FILETE = { layout: { rule: { enabled: true, palette: 'arcilla', width_pct: 12, thickness_px: 4, gap_pct: 2 } }, palette: { headline_emphasis: 'trigo' } };
const spansWithShadow = (scene) => findAll(scene, (n) => n.type === 'span').map((n) => [n.props.children.replace(/ /g, ' ').trim(), !!n.props.style?.textShadow]);

test("1.9.0 · `when: 'on_request'` declara la sombra pero no la pone", () => {
  const st = styleN1({ headline: H_EM }, SOMBRA('on_request'));
  assert.equal(st.textEffect, undefined);
  assert.ok(st.textEffectDeclared, 'queda declarada para quien la pida');
  const siempre = styleN1({ headline: H_EM }, SOMBRA());
  assert.ok(siempre.textEffect && siempre.textEffectDeclared);
});
test("1.9.0 · text_shadow 'off' la quita; 'on' la pone siempre, aunque la marca la tenga a pedido o por contraste", () => {
  const off = M.applyTextShadowRequest(styleN1({ headline: H_EM }, SOMBRA()), 'off', []);
  assert.equal(off.style.textEffect, undefined); assert.equal(off.applied.mode, 'off');
  const on = M.applyTextShadowRequest(styleN1({ headline: H_EM }, SOMBRA('on_request')), 'on', []);
  assert.ok(on.style.textEffect); assert.equal(on.style.textEffect.when, undefined, 'sin medir contraste');
  const lc = styleN1({ headline: H_EM }, { layout: { text_effect: { ...SOMBRA().layout.text_effect, when: 'low_contrast', min_contrast: 4.5 } } });
  assert.equal(M.applyTextShadowRequest(lc, 'on', []).style.textEffect.when, undefined);
});
test('1.9.0 · sin sombra declarada no se inventa: se compone sin ella y se dice', () => {
  const r = M.applyTextShadowRequest(styleN1({ headline: H_EM }), 'on', ['cuota']);
  assert.equal(r.style.textEffect, undefined);
  assert.equal(r.applied.mode, null);
  assert.deepEqual(r.applied.spans, []);
  assert.ok(r.style.markers.filter((m) => m.startsWith('OVERLAY_SHADOW_NOT_DECLARED')).length === 2);
});
test('1.9.0 · un tramo al revés: sin sombra en el tramo cuando el texto la lleva', () => {
  const r = M.applyTextShadowRequest(styleN1({ headline: H_EM }, SOMBRA()), null, ['no se vota']);
  assert.deepEqual(r.applied.spans, ['no se vota']);
  const filas = spansWithShadow(overlayN1(r.style));
  assert.deepEqual(filas.filter(([, sh]) => !sh).map(([t]) => t), ['no', 'se', 'vota']);
  assert.ok(filas.filter(([, sh]) => sh).length > 3, 'el resto conserva la sombra');
  assert.equal(filas.map(([t]) => t).join(' '), H_EM, 'el texto visible no cambia');
});
test('1.9.0 · un tramo al revés: con sombra en el tramo cuando el texto no la lleva (también con énfasis y cortes)', () => {
  const h = 'Primera línea\nla cuota no se vota';
  const base = styleN1({ headline: h, emphasis: ['cuota'] }, { ...EM_TOK, ...SOMBRA('on_request') });
  const r = M.applyTextShadowRequest(base, null, ['Primera']);
  const filas = spansWithShadow(overlayN1(r.style));
  assert.deepEqual(filas.filter(([, sh]) => sh).map(([t]) => t), ['Primera']);
  assert.ok(findAll(overlayN1(r.style), (n) => n.type === 'span' && n.props.children.startsWith('cuota'))[0].props.style.fontStyle === 'italic', 'el énfasis se conserva');
});
test('1.9.0 · un tramo que no está en el titular se dice y no se marca', () => {
  const r = M.applyTextShadowRequest(styleN1({ headline: H_EM }, SOMBRA()), null, ['inexistente']);
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_SHADOW_SPAN_NOT_IN_HEADLINE')));
  assert.equal(r.style.slots.headline.shadowFlip, undefined);
});
test('1.9.0 · withShadowFlip parte en los bordes y conserva el énfasis', () => {
  const parts = M.withShadowFlip('ab cd ef', [{ text: 'ab ', keyword: false }, { text: 'cd', keyword: true }, { text: ' ef', keyword: false }], [[1, 4]]);
  assert.deepEqual(parts, [{ text: 'a', keyword: false }, { text: 'b ', keyword: false, flip: true }, { text: 'c', keyword: true, flip: true }, { text: 'd', keyword: true }, { text: ' ef', keyword: false }]);
  assert.equal(parts.map((p) => p.text).join(''), 'ab cd ef');
});
test('1.9.0 · el filete: sólo su color o los accent de la marca; fuera de la lista, sin filete o sin hex, sale igual y se dice', () => {
  assert.deepEqual(M.ruleAllowedRoles({ ...FILETE, layout: { ...FILETE.layout, emphasis_contrast: { fallbacks: ['cielo', 'arcilla'] } } }), ['arcilla', 'trigo', 'cielo']);
  const base = styleN1({ headline: H_EM }, FILETE);
  const ok = M.applyRuleRole(base, 'trigo', N1_PAL, ['arcilla', 'trigo']);
  assert.equal(ok.applied, 'trigo'); assert.notEqual(ok.style.rule.color, base.rule.color);
  assert.ok(M.applyRuleRole(base, 'hoja', N1_PAL, ['arcilla', 'trigo']).style.markers.some((m) => m.startsWith('OVERLAY_RULE_ROLE_NOT_ALLOWED')));
  assert.ok(M.applyRuleRole(base, 'nada', N1_PAL, ['nada']).style.markers.some((m) => m.startsWith('OVERLAY_RULE_ROLE_UNKNOWN')));
  assert.ok(M.applyRuleRole(styleN1({ headline: H_EM }), 'trigo', N1_PAL, ['trigo']).style.markers.some((m) => m.startsWith('OVERLAY_RULE_NOT_DECLARED')));
  assert.equal(M.applyRuleRole(base, null, N1_PAL, ['trigo']).style, base);
});
test('1.9.0 · el contrato de los tres campos', () => {
  assert.equal(M.parseTextShadowRequest(undefined), null);
  assert.equal(M.parseTextShadowRequest('on'), 'on');
  assert.throws(() => M.parseTextShadowRequest('si'), /COMPOSITOR_TEXT_SHADOW_INVALID|text_shadow/);
  assert.deepEqual(M.parseShadowSpansRequest(['a', 'a']), ['a']);
  assert.throws(() => M.parseShadowSpansRequest(['a', 'b', 'c', 'd']), /shadow_spans/);
  assert.equal(M.parseRuleRoleRequest('accent_2'), 'accent_2');
  assert.throws(() => M.parseRuleRoleRequest('Accent 2'), /rule_role/);
});
test('1.9.0 · sin los campos, la escena es la de 1.8.0', () => {
  const st = styleN1({ headline: H_EM, emphasis: ['no se vota'] }, { ...EM_TOK, ...SOMBRA() });
  assert.equal(st.slots.headline.shadowFlip, undefined);
  const col = findAll(overlayN1(st), (n) => n.props?.style?.fontFamily === 'Fuente Titular')[0];
  assert.ok(col.props.style.textShadow, 'la ranura lleva la sombra como antes');
});


console.log('\n── 1.10.0 · LA BARRA LATERAL ──');
test('1.10.0 · la franja de identidad: su color o los accent de la marca; lo demás sale igual y se dice', () => {
  const tok = { palette: { headline_emphasis: 'trigo' }, layout: { emphasis_contrast: { fallbacks: ['cielo'] } } };
  assert.deepEqual(M.identityAllowedRoles({ ...tok, identity: { palette: 'hoja' } }), ['hoja', 'trigo', 'cielo']);
  const base = styleN1({ headline: H_EM });
  assert.ok(base.identity, 'N1_BASE declara franja de identidad');
  const ok = M.applyIdentityRole(base, 'trigo', N1_PAL, ['hoja', 'trigo']);
  assert.equal(ok.applied, 'trigo'); assert.notEqual(ok.style.identity.color, base.identity.color);
  assert.ok(M.applyIdentityRole(base, 'tierra', N1_PAL, ['hoja', 'trigo']).style.markers.some((m) => m.startsWith('OVERLAY_IDENTITY_ROLE_NOT_ALLOWED')));
  assert.ok(M.applyIdentityRole(base, 'nada', N1_PAL, ['nada']).style.markers.some((m) => m.startsWith('OVERLAY_IDENTITY_ROLE_UNKNOWN')));
  const sinFranja = styleN1({ headline: H_EM }, { identity: { mode: 'none' } });
  assert.ok(M.applyIdentityRole(sinFranja, 'trigo', N1_PAL, ['trigo']).style.markers.some((m) => m.startsWith('OVERLAY_IDENTITY_NOT_DECLARED')));
  assert.equal(M.applyIdentityRole(base, null, N1_PAL, ['trigo']).style, base);
});
test('1.10.0 · la escena dibuja la franja con el color elegido', () => {
  const r = M.applyIdentityRole(styleN1({ headline: H_EM }), 'trigo', N1_PAL, ['hoja', 'trigo']);
  const want = M.hexToRgba('#D9A441', 1);
  assert.ok(findAll(overlayN1(r.style), (n) => n.props?.style?.backgroundColor === want).length === 1);
});
test('1.10.0 · el contrato de identity_role', () => {
  assert.equal(M.parseIdentityRoleRequest(undefined), null);
  assert.equal(M.parseIdentityRoleRequest('accent_2'), 'accent_2');
  assert.throws(() => M.parseIdentityRoleRequest('Accent 2'), /identity_role/);
});

console.log('\n── 1.18.0 · CURSIVA POR TRAMO ──');
test('1.18.0 · el bloque exporta lo nuevo', () => {
  for (const fn of ['applySlotItalic', 'withSpanFlags', 'spanItalicStyle', 'italicSpanCss', 'italicFacesNeeded', 'overlayItalicFacesNeeded',
    'carouselItalicFacesNeeded', 'withItalicFallback', 'googleFontsFaceCssUrl', 'isGoogleFontsCss', 'pickExactStyleFace', 'italicFallbackFor',
    'overlaySlotMeasure', 'carouselFlippedFace', 'carouselHeadlineParts', 'wordWidthsOfParts', 'wordLinesW']) {
    assert.equal(typeof M[fn], 'function', fn);
  }
  assert.equal(M.ITALIC_SYNTH_SKEW_DEG, -10);
});
test('1.18.0 · withShadowFlip sigue partiendo igual que en 1.9.0', () => {
  const parts = [{ text: 'La cuota ', keyword: false }, { text: 'extraordinaria', keyword: true }, { text: ' no se vota', keyword: false }];
  assert.deepEqual(M.withShadowFlip('La cuota extraordinaria no se vota', parts, [[3, 15]]), [
    { text: 'La ', keyword: false }, { text: 'cuota ', keyword: false, flip: true }, { text: 'extrao', keyword: true, flip: true },
    { text: 'rdinaria', keyword: true }, { text: ' no se vota', keyword: false },
  ]);
  assert.deepEqual(M.withShadowFlip('abc', null, []), [{ text: 'abc', keyword: false }]);
});
test('1.18.0 · withSpanFlags: sombra y cursiva a la vez, y conserva lo que no recalcula', () => {
  const r = M.withSpanFlags('uno dos tres', null, { flip: [[0, 7]], italic: [[4, 12]] });
  assert.deepEqual(r, [
    { text: 'uno ', keyword: false, flip: true }, { text: 'dos', keyword: false, flip: true, italic: true }, { text: ' tres', keyword: false, italic: true },
  ]);
  assert.equal(r.map((x) => x.text).join(''), 'uno dos tres', 'el texto visible no cambia');
  const again = M.withSpanFlags('uno dos tres', r, { italic: [[0, 3]] });
  assert.deepEqual(again.map((x) => [x.text, !!x.flip, !!x.italic]), [['uno', true, true], [' ', true, false], ['dos', true, false], [' tres', false, false]]);
});
test('1.18.0 · el estilo de cada tramo invierte el de debajo; sin cara cursiva se inclina la recta', () => {
  assert.deepEqual(M.spanItalicStyle(false, false), { italic: false, skew: false });
  assert.deepEqual(M.spanItalicStyle(false, true), { italic: true, skew: false });
  assert.deepEqual(M.spanItalicStyle(true, true), { italic: false, skew: false });
  assert.deepEqual(M.spanItalicStyle(false, true, 'skew'), { italic: false, skew: true });
  assert.deepEqual(M.spanItalicStyle(true, true, 'none'), { italic: true, skew: false });
  assert.deepEqual(M.italicSpanCss(false, true, 'skew'), { fontStyle: 'normal', transform: 'skewX(-10deg)' });
  assert.deepEqual(M.italicSpanCss(true, true), { fontStyle: 'normal' });
});
test('1.18.0 · la hoja css2 de Google con el eje ital, para cualquier familia', () => {
  assert.equal(M.googleFontsFaceCssUrl('Fuente  Titular Condensada', 700), 'https://fonts.googleapis.com/css2?family=Fuente+Titular+Condensada:ital,wght@1,700');
  assert.equal(M.googleFontsFaceCssUrl('Fuente Texto', 400, false), 'https://fonts.googleapis.com/css2?family=Fuente+Texto:ital,wght@0,400');
  assert.equal(M.isGoogleFontsCss('https://fonts.googleapis.com/css2?family=Fuente+Texto'), true);
  assert.equal(M.isGoogleFontsCss('https://fonts.example/titular.css'), false);
  assert.equal(M.isGoogleFontsCss(null), false);
});
test('1.18.0 · sin cara cursiva en la hoja, pickExactStyleFace no cae a la recta (pickFontFace sí)', () => {
  const css = "@font-face { font-family: 'Fuente Titular'; font-style: normal; font-weight: 700; src: url(https://x/t700.ttf) format('truetype'); }";
  const faces = M.parseFontFaces(css);
  assert.equal(M.pickFontFace(faces, { weight: 700, italic: true }).italic, false, 'pickFontFace cae a la recta en silencio');
  assert.equal(M.pickExactStyleFace(faces, { family: 'Fuente Titular', weight: 700, italic: true }), null);
  const fb = M.italicFallbackFor({ family: 'Fuente Titular', italic: true });
  assert.deepEqual(fb, { fallback: 'skew', marker: 'OVERLAY_ITALIC_SYNTHESIZED: Fuente Titular no tiene cursiva; se inclinó' });
  assert.equal(M.italicFallbackFor({ family: 'Fuente Titular', italic: false }).fallback, 'none');
  const both = M.parseFontFaces(css + "@font-face { font-family: 'Fuente Titular'; font-style: italic; font-weight: 600; src: url(https://x/t600i.ttf) format('truetype'); }");
  assert.equal(M.pickExactStyleFace(both, { family: 'Fuente Titular', weight: 700, italic: true }).url, 'https://x/t600i.ttf');
});
test('1.18.0 · la ranura marca sus tramos y la escena los dibuja en cursiva; sin tramos, EL MISMO estilo', () => {
  const base = styleN1({ headline: H_EM });
  assert.equal(M.applySlotItalic(base, 'headline', { italic_spans: [] }).style, base);
  const r = M.applySlotItalic(base, 'headline', { italic_spans: ['no se vota'] });
  const at = H_EM.indexOf('no se vota');
  assert.deepEqual(r.style.slots.headline.italicFlip, [[at, at + 'no se vota'.length]]);
  assert.deepEqual(r.applied.italic, ['no se vota']);
  const spans = findAll(overlayN1(r.style), (n) => n.type === 'span');
  const st = (t) => spans.find((n) => String(n.props.children).startsWith(t)).props.style.fontStyle;
  assert.equal(st('vota'), 'italic'); assert.equal(st('se'), 'italic'); assert.equal(st('cuota'), 'normal');
  assert.deepEqual(M.overlayItalicFacesNeeded(r.style).map((x) => x.key), ['Fuente Titular|700|italic']);
  assert.deepEqual(M.overlayItalicFacesNeeded(base), []);
});

console.log(`\n${'─'.repeat(72)}`);
console.log(`${pass} ok · ${fails.length} fail`);
if (fails.length) { console.error('\nFALLOS:'); for (const [n, e] of fails) console.error(`  ${n}: ${e.stack}`); process.exit(1); }
console.log('\n✅ compositor_test — todo verde.\n');
