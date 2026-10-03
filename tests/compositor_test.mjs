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
  'parseCarouselRequest', 'resolveCarouselChrome', 'buildCarouselScene', 'splitKeyword', 'headlineAtoms', 'svgDimensions', 'neutralizeKerning',
  'fontAdvanceMetrics', 'fitFontKey', 'measureCarouselLayout', 'fitCarouselContent']) {
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

console.log(`\n${'─'.repeat(72)}`);
console.log(`${pass} ok · ${fails.length} fail`);
if (fails.length) { console.error('\nFALLOS:'); for (const [n, e] of fails) console.error(`  ${n}: ${e.stack}`); process.exit(1); }
console.log('\n✅ compositor_test — todo verde.\n');
