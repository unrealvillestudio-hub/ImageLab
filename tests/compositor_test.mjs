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
  'imageDimensions', 'parseFontFaces', 'pickFontFace', 'hexToRgba', 'deepMergeTokens']) {
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
  for (const rol of ['cream', 'terra', 'carbon_d', 'text_primary', 'accent_primary', 'bg_primary', 'EB Garamond', 'Bebas', 'ForumPHs', 'Unrealville']) {
    assert.ok(!block.includes(rol), `el motor nombra '${rol}': eso es instancia, no eje`);
  }
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

console.log(`\n${'─'.repeat(72)}`);
console.log(`${pass} ok · ${fails.length} fail`);
if (fails.length) { console.error('\nFALLOS:'); for (const [n, e] of fails) console.error(`  ${n}: ${e.stack}`); process.exit(1); }
console.log('\n✅ compositor_test — todo verde.\n');
