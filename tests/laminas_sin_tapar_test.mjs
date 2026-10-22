// 1.11.0 — EL TEXTO DE LA LÁMINA NO TAPA CARAS NI PRODUCTOS. Test del bloque PURO y del cableado.
//
// EL CASO (Sam, 2026-10-22, pieza 3c58d5a1): «todo el texto está sobre la cara o los productos, se suponía que eso
// ya estaba corregido». 1.6.x sólo protegía el overlay; la lámina componía su bloque en el centro fijo de la maqueta.
//
// QUÉ AFIRMA.
//   1. GOLDEN: sin la política, la lámina es la de 1.10.0 byte a byte (los goldens de 1.3.3 siguen valiendo). Con la
//      política y nada detectado, también. Una capa global que sólo trae la política NO declara un carrusel.
//   2. `carousel.avoid_faces` / `carousel.avoid_products` / `layout.avoid_products` son dato validado: mal escritos
//      fallan nombrando; ausentes o apagados no existen.
//   3. Colocación: una cara en el centro ⇒ la primera fila libre; un producto cuenta sólo con su token; la columna
//      sólo si la marca declara su ancho; la escena compone el bloque donde la caja dice.
//   4. Último recurso por dato: 'inset' (superficie + foto reducida, sin sombra) o 'band' (banda bajo el texto); sin
//      recurso aplicable, la que menos tapa, y se dice. Nunca se oscurece la foto entera.
//   5. Cajas: de la foto al lienzo con `cover`; el recorte del inset no sale de la foto y centra lo que hay que ver.
//   6. Overlay: `layout.avoid_products` suma los productos a las cajas que el texto no toca; sin el token, idéntico.
//   7. Cableado: la MISMA detección (productos sólo con el token), detección fallida ⇒ lámina de siempre y se dice,
//      `meta.faces` con la forma del overlay (el carril lo asienta) y `meta.carousel.avoid`.
//   8. Marca N+1: una marca inventada, de otro rubro y otro idioma, compone con el mismo código; el bloque no nombra
//      marcas ni ciudades.
//
// Ejecutar:  node tests/laminas_sin_tapar_test.mjs     (Node ≥ 22.18)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'compose.ts'), 'utf8');
const BEGIN = '// ── COMPOSITOR:BEGIN ──', END = '// ── COMPOSITOR:END ──';
const BLOCK = SRC.slice(SRC.indexOf(BEGIN), SRC.indexOf(END) + END.length);
const dir = mkdtempSync(join(tmpdir(), 'laminas-sin-tapar-'));
const mod = join(dir, 'block.mts');
writeFileSync(mod, BLOCK + '\n', 'utf8');
const M = await import(pathToFileURL(mod).href);

let pass = 0; const fails = [];
const test = (n, f) => { try { f(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fails.push(n); console.log(`  ✗ ${n}\n    ${e.message}`); } };
const sha = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

// ── Marca INVENTADA (la misma de compositor_test.mjs): otro rubro, otro idioma, roles que ninguna marca real usa ──
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
const chromeN1 = (c, text, over) => M.resolveCarouselChrome({
  tokens: n1Tokens(over), typography: N1_TYPO, palette: N1_PAL, carousel: M.parseCarouselRequest(c), text, logo: N1_LOGO,
});
const styleN1 = (text, over) => M.resolveOverlayStyle({ tokens: n1Tokens(over), typography: N1_TYPO, palette: N1_PAL, text });
const sceneOf = (chrome, text, over, bg = 'data:image/png;base64,BG') => M.buildCarouselScene({ chrome, style: styleN1(text, over), backgroundSrc: bg });

// Los tres casos con foto de compositor_test.mjs (1.3.4) y sus goldens del commit bb8bef6 (1.3.3).
const TE_CASOS = [
  [{ index: 1, total: 4, role: 'cover', eyebrow: 'Campo', keyword: 'trigo' }, { headline: 'El trigo no espera', subheadline: 'Ni el clima.' }],
  [{ index: 3, total: 4, role: 'body', eyebrow: 'Campo', keyword: 'trigo', figure: { value: '62%', bar: { from: 10, to: 62 }, source: 'Censo agrario 2025' }, steps: [{ text: 'Sembrar' }, { text: 'Regar', critical: true }] }, { headline: 'El trigo no espera' }],
  [{ index: 4, total: 4, role: 'closing', cta: 'Pide tu caja' }, { headline: 'Cosecha propia' }],
];
const GOLDEN_133 = [
  '3a94a86871244d5e3a0015554a24a91d3fd164e316e77bf5a529e0a1e013818c',
  '30c52c5922d9952a355bef4e276d52bb506a08543714acb4124708499d20b731',
  '6c1d830c99d3a9ab372afb1f8fa73bfd98b5254f9f8929417fae3b1eb946ecb0',
];

const POLICY = { carousel: { avoid_faces: { enabled: true, margin_pct: 2 }, avoid_products: { enabled: true, margin_pct: 1 } } };
const avoidOf = (over) => M.resolveCarouselAvoid(n1Tokens(over));
const BODY = { index: 2, total: 5, role: 'body', eyebrow: 'Campo' };
const BODY_TEXT = { headline: 'El trigo no espera a nadie', subheadline: 'Ni el clima ni la lluvia esperan.' };
const W = 1000, H = 1250;
// Una caja (0..1 del lienzo) justo sobre la caja del bloque en una colocación dada.
const boxOn = (rect) => ({ x0: (rect.x0 + 40) / W, y0: (rect.y0 + 20) / H, x1: (rect.x0 + 140) / W, y1: (rect.y0 + 120) / H });
const rectAt = (chrome, block) => M.carouselBlockRect(block ? { ...chrome, block } : chrome, null).rect;

const findAll = (node, pred, acc = []) => {
  if (node && typeof node === 'object') {
    if (pred(node)) acc.push(node);
    const kids = node.props?.children;
    if (Array.isArray(kids)) for (const k of kids) findAll(k, pred, acc);
    else if (kids && typeof kids === 'object') findAll(kids, pred, acc);
  }
  return acc;
};

console.log('\n── 1 · golden: sin la política, la lámina de siempre ──');
test('1a · sin tokens, la escena con foto es la de 1.3.3 byte a byte', () => {
  TE_CASOS.forEach(([c, text], k) => {
    const ch = chromeN1(c, text);
    assert.equal(M.resolveCarouselAvoid(n1Tokens()), null, 'sin token no hay política');
    assert.equal('block' in ch || 'inset' in ch || 'band' in ch, false);
    assert.equal(sha(sceneOf(ch, text)), GOLDEN_133[k], `lámina ${c.role}`);
  });
});
test('1b · con la política y nada detectado, el ajuste y la escena son los de siempre', () => {
  const avoid = avoidOf(POLICY);
  TE_CASOS.forEach(([c, text], k) => {
    const ch = chromeN1(c, text, POLICY);
    const pick = M.chooseCarouselPlacement({ chrome: ch, faces: [], products: [], avoid });
    assert.equal(pick.report.moved, false); assert.equal(pick.report.fallback, null); assert.deepEqual(pick.warnings, []);
    assert.deepEqual(pick.fit, M.fitCarouselContent({ chrome: ch }), 'el mismo ajuste que sin la política');
    assert.equal(sha(sceneOf(pick.fit.chrome, text, POLICY)), GOLDEN_133[k], `lámina ${c.role}`);
  });
});
test('1c · con la política y una cara FUERA del bloque, la escena tampoco cambia', () => {
  const ch = chromeN1(BODY, BODY_TEXT, POLICY);
  const pick = M.chooseCarouselPlacement({ chrome: ch, faces: [{ x0: 0.92, y0: 0.02, x1: 0.99, y1: 0.08 }], avoid: avoidOf(POLICY) });
  assert.equal(pick.report.moved, false);
  assert.equal(sha(sceneOf(pick.fit.chrome, BODY_TEXT, POLICY)), sha(sceneOf(M.fitCarouselContent({ chrome: ch }).chrome, BODY_TEXT, POLICY)));
});
test('1d · la política sola (capa global) no declara un carrusel: la marca sin cromo compone como 1.2.0', () => {
  assert.equal(M.carouselChromeDeclared({ avoid_faces: { enabled: true }, avoid_products: { enabled: true } }), false);
  assert.equal(M.carouselChromeDeclared({ canvas: { width: 1, height: 1 } }), true);
  assert.equal(M.carouselChromeDeclared(undefined), false);
  const sinCromo = M.deepMergeTokens(N1_BASE, POLICY);
  assert.deepEqual(M.resolveCarouselChrome({ tokens: sinCromo, typography: N1_TYPO, palette: N1_PAL,
    carousel: M.parseCarouselRequest(BODY), text: BODY_TEXT }), { applied: false });
  assert.match(SRC, /const carouselOn = !!carouselIn && carouselChromeDeclared\(carouselTokens\);/);
});

console.log('\n── 2 · los tokens son dato validado ──');
test('2a · ausentes o apagados no existen; encendidos, con sus valores por defecto', () => {
  assert.equal(avoidOf({ carousel: { avoid_faces: { enabled: false } } }), null);
  const a = avoidOf({ carousel: { avoid_faces: { enabled: true } } });
  assert.deepEqual(a, { marginPct: 2, products: null, placements: ['center', 'bottom', 'top'], columnPcts: [], fallback: [], insetMinPct: 25, bandAlpha: null, insetAlternate: false });
  const c = avoidOf({ carousel: { avoid_faces: { enabled: true, column_pct: 55, fallback: ['inset', 'band'], band: { alpha: 0.9 } }, avoid_products: { enabled: true } } });
  assert.deepEqual(c.placements, ['center', 'bottom', 'top', 'center_left', 'bottom_left', 'top_left', 'center_right', 'bottom_right', 'top_right']);
  assert.deepEqual(c.products, { marginPct: 1 });
  assert.equal(c.bandAlpha, 0.9);
  assert.deepEqual(c.columnPcts, [55]);
  assert.deepEqual(avoidOf({ carousel: { avoid_faces: { enabled: true, column_pct: [60, 50, 60] } } }).columnPcts, [60, 50], 'una lista, sin repetidos y en su orden');
});
test('2b · mal escritos fallan nombrando lo que falta', () => {
  const bad = [
    [{ avoid_faces: true }, /carousel\.avoid_faces/],
    [{ avoid_faces: { enabled: true, margin_pct: 40 } }, /margin_pct/],
    [{ avoid_faces: { enabled: true, placements: ['arriba'] } }, /placements: arriba/],
    [{ avoid_faces: { enabled: true, placements: ['top_left'] } }, /column_pct/],
    [{ avoid_faces: { enabled: true, column_pct: 10 } }, /column_pct=10/],
    [{ avoid_faces: { enabled: true, column_pct: [60, 'ancho'] } }, /column_pct=/],
    [{ avoid_faces: { enabled: true, column_pct: [] } }, /column_pct=\[\]/],
    [{ avoid_faces: { enabled: true, fallback: ['oscurecer'] } }, /fallback: oscurecer/],
    [{ avoid_faces: { enabled: true, fallback: 'band' } }, /band\.alpha/],
    [{ avoid_faces: { enabled: true, inset_min_pct: 99 } }, /inset_min_pct/],
    [{ avoid_products: { enabled: true } }, /avoid_products pide carousel\.avoid_faces/],
    [{ avoid_faces: { enabled: true }, avoid_products: 'sí' }, /carousel\.avoid_products/],
  ];
  for (const [carousel, re] of bad) {
    assert.throws(() => avoidOf({ carousel }), (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE' && re.test(e.message), JSON.stringify(carousel));
  }
  assert.ok(!/oscurec/i.test([...SRC.matchAll(/CAROUSEL_FALLBACKS = new Set\(\[([^\]]*)\]/g)].map((m) => m[1]).join('')), 'no existe un modo que oscurezca la foto');
});

console.log('\n── 3 · la colocación ──');
test('3a · una cara donde cae el bloque ⇒ la primera fila libre (abajo), y la escena lo compone allí', () => {
  const ch = chromeN1(BODY, BODY_TEXT, POLICY);
  const face = boxOn(rectAt(ch));
  const pick = M.chooseCarouselPlacement({ chrome: ch, faces: [face], avoid: avoidOf(POLICY) });
  assert.equal(pick.report.placement_used, 'bottom'); assert.equal(pick.report.moved, true); assert.equal(pick.report.overlap_pct, 0);
  assert.ok(pick.report.candidates[0].face_overlap_pct > 0, 'el centro tapaba la cara');
  assert.match(pick.warnings[0], /^CAROUSEL_BLOCK_MOVED_FOR_SUBJECT: en el centro el texto tapaba una cara o un producto/);
  const r = M.carouselBlockRect(pick.fit.chrome, null).rect;
  assert.ok(r.y0 >= face.y1 * H + 0.02 * W, 'el bloque queda debajo de la cara, con el margen');
  // La escena: el espaciador va antes del bloque y el bloque guarda el aire mínimo abajo.
  const sc = sceneOf(pick.fit.chrome, BODY_TEXT, POLICY);
  const layout = sc.props.children[sc.props.children.length - 1].props.children;
  assert.equal(layout.length, 4); assert.equal(layout[1].props.style.flexGrow, 1);
  assert.ok(layout[2].props.style.marginBottom > 0);
});
test('3b · un producto cuenta sólo con su token', () => {
  const ch = chromeN1(BODY, BODY_TEXT, POLICY);
  const prod = boxOn(rectAt(ch));
  const con = M.chooseCarouselPlacement({ chrome: ch, faces: [], products: [prod], avoid: avoidOf(POLICY) });
  assert.equal(con.report.moved, true); assert.ok(con.report.candidates[0].product_overlap_pct > 0); assert.equal(con.report.products, 1);
  const soloCaras = { carousel: { avoid_faces: { enabled: true } } };
  const sin = M.chooseCarouselPlacement({ chrome: chromeN1(BODY, BODY_TEXT, soloCaras), faces: [], products: [prod], avoid: avoidOf(soloCaras) });
  assert.equal(sin.report.moved, false); assert.equal(sin.report.products, null);
});
test('3c · abajo y arriba ocupados ⇒ arriba si está libre; centro y abajo ⇒ arriba', () => {
  const ch = chromeN1(BODY, BODY_TEXT, POLICY);
  const faces = [boxOn(rectAt(ch)), boxOn(rectAt(ch, { place: 'bottom', side: null, columnPct: 100 }))];
  const pick = M.chooseCarouselPlacement({ chrome: ch, faces, avoid: avoidOf(POLICY) });
  assert.equal(pick.report.placement_used, 'top');
  const sc = sceneOf(pick.fit.chrome, BODY_TEXT, POLICY);
  const layout = sc.props.children[sc.props.children.length - 1].props.children;
  assert.equal(layout[2].props.style.flexGrow, 1, 'el espaciador va después del bloque'); assert.ok(layout[1].props.style.marginTop > 0);
});
test('3d · columna: sólo si la marca declara su ancho; el bloque se mide y se compone a ese ancho', () => {
  const pol = { carousel: { avoid_faces: { enabled: true, column_pct: 55 }, avoid_products: { enabled: true } } };
  const ch = chromeN1(BODY, BODY_TEXT, pol);
  // Tres caras: una sobre cada fila a todo el ancho, todas en la mitad izquierda.
  const faces = ['center', 'bottom', 'top'].map((p) => { const r = rectAt(ch, p === 'center' ? null : { place: p, side: null, columnPct: 100 }); return { x0: 0.06, y0: (r.y0 + 10) / H, x1: 0.4, y1: (r.y1 - 10) / H }; });
  const pick = M.chooseCarouselPlacement({ chrome: ch, faces, avoid: avoidOf(pol) });
  assert.match(pick.report.placement_used, /_right$/, pick.report.reason);
  const m = M.measureCarouselLayout(pick.fit.chrome, null);
  assert.ok(m.blockWidth < 0.6 * W && m.midWidth <= m.blockWidth);
  const sc = sceneOf(pick.fit.chrome, BODY_TEXT, pol);
  const layout = sc.props.children[sc.props.children.length - 1].props.children;
  const blk = layout.find((n) => n.props?.style?.width === m.blockWidth);
  assert.ok(blk && blk.props.style.marginLeft > 0, 'la columna derecha empuja el bloque');
  assert.equal(pick.report.column_pct, 55);
  // Con dos anchos, el segundo sólo se prueba si el primero no libra: una cara que llega hasta el 57 % del ancho.
  const pol2 = { carousel: { avoid_faces: { enabled: true, column_pct: [70, 50] } } };
  const ch2 = chromeN1(BODY, BODY_TEXT, pol2);
  const wall = ['center', 'bottom', 'top'].map((p) => { const r = rectAt(ch2, p === 'center' ? null : { place: p, side: null, columnPct: 100 }); return { x0: 0.6, y0: (r.y0 + 10) / H, x1: 0.95, y1: (r.y1 - 10) / H }; });
  const p2 = M.chooseCarouselPlacement({ chrome: ch2, faces: wall, avoid: avoidOf(pol2) });
  assert.equal(p2.report.placement_used, 'center_left', p2.report.reason);
  const cl = p2.report.candidates.filter((c) => c.placement === 'center_left');
  assert.deepEqual(cl.map((c) => [c.column_pct, c.overlap_pct > 0]), [[70, true], [50, false]], 'primero el ancho declarado primero');
  assert.equal(p2.report.column_pct, 50);
  assert.match(p2.warnings[0], /se compone en center_left \(columna 50 %\)/);
  // Sin column_pct, las mismas caras no tienen columna a la que ir.
  const sinCol = M.chooseCarouselPlacement({ chrome: chromeN1(BODY, BODY_TEXT, POLICY), faces, avoid: avoidOf(POLICY) });
  assert.ok(!/_/.test(sinCol.report.placement_used));
});
test('3e · la columna más estrecha alarga el bloque; la medida a todo el ancho no cambia', () => {
  const ch = chromeN1(BODY, BODY_TEXT, POLICY);
  const full = M.measureCarouselLayout(ch, null);
  const col = M.measureCarouselLayout({ ...ch, block: { place: 'center', side: 'left', columnPct: 50 } }, null);
  assert.ok(col.mid > full.mid); assert.equal(col.top, full.top); assert.equal(col.foot, full.foot);
  assert.equal(full.blockWidth, 900); assert.ok(full.midWidth > 0 && full.midWidth <= 900);
});

console.log('\n── 4 · el último recurso es dato ──');
const everywhere = [{ x0: 0, y0: 0, x1: 1, y1: 1 }];
test("4a · 'inset': superficie + foto reducida bajo el texto; sin sombra; la foto entera no se oscurece", () => {
  const pol = M.deepMergeTokens(POLICY, { carousel: { avoid_faces: { fallback: ['inset'] }, text_effect: { kind: 'shadow', color: 'tierra', alpha: 0.4, blur_pct: 0.6, offset_pct: 0.1 } } });
  const ch = chromeN1(BODY, BODY_TEXT, M.deepMergeTokens(pol, { palette: { tierra: 'tierra' } }));
  const pick = M.chooseCarouselPlacement({ chrome: ch, faces: everywhere, avoid: avoidOf(pol) });
  assert.equal(pick.report.fallback, 'inset'); assert.equal(pick.report.placement_used, 'top'); assert.equal(pick.report.overlap_pct, 0);
  assert.match(pick.warnings[0], /^CAROUSEL_PHOTO_INSET_FOR_SUBJECT: /);
  const ins = pick.fit.chrome.inset;
  const r = M.carouselBlockRect(pick.fit.chrome, null).rect;
  assert.ok(ins.y0 > r.y1 && ins.y1 < H && ins.x0 > 0 && ins.x1 < W, 'la foto va en el hueco, debajo del texto');
  const sc = sceneOf(pick.fit.chrome, BODY_TEXT, pol, 'data:image/png;base64,FOTO');
  const imgs = findAll(sc, (n) => n.type === 'img' && n.props.src === 'data:image/png;base64,FOTO');
  assert.equal(imgs.length, 1); assert.equal(imgs[0].props.style.top, ins.y0); assert.equal(imgs[0].props.width, Math.round((ins.x1 - ins.x0) * 100) / 100);
  assert.equal(sc.props.children[0].props.style.backgroundColor, ch.surface, 'el fondo es la superficie de la marca');
  assert.equal(findAll(sc, (n) => n.props?.style?.textShadow).length, 0, 'sobre la superficie no hay sombra');
  assert.equal(findAll(sc, (n) => /linear-gradient\(180deg/.test(String(n.props?.style?.backgroundImage ?? ''))).length, 0, 'sin velo sobre la foto');
});
test("4b · 'inset' que no cabe ⇒ el siguiente recurso ('band'): banda de superficie sólo bajo el texto", () => {
  const pol = M.deepMergeTokens(POLICY, { carousel: { avoid_faces: { fallback: ['inset', 'band'], inset_min_pct: 80, band: { alpha: 0.88 } } } });
  const ch = chromeN1(BODY, BODY_TEXT, pol);
  const pick = M.chooseCarouselPlacement({ chrome: ch, faces: everywhere, avoid: avoidOf(pol) });
  assert.equal(pick.report.fallback, 'band');
  assert.match(pick.warnings[0], /^CAROUSEL_BAND_FOR_SUBJECT: /);
  const b = pick.fit.chrome.band;
  assert.equal(b.color, 'rgba(59, 42, 30, 0.88)', 'la superficie de la marca con el alfa del token');
  assert.ok(b.y1 - b.y0 < 0.5 * H, 'una banda, no la foto entera');
  const sc = sceneOf(pick.fit.chrome, BODY_TEXT, pol);
  const bands = findAll(sc, (n) => n.props?.style?.backgroundColor === b.color);
  assert.equal(bands.length, 1); assert.equal(bands[0].props.style.width, W); assert.equal(bands[0].props.style.top, b.y0);
});
test("4a bis · 1.11.1 · con `inset_alternate`, las láminas pares llevan el texto abajo y la foto arriba; las impares, como en 1.11.0", () => {
  const pol = M.deepMergeTokens(POLICY, { carousel: { avoid_faces: { fallback: ['inset'], inset_alternate: true } } });
  const ch = chromeN1(BODY, BODY_TEXT, pol);
  const avoid = avoidOf(pol);
  assert.equal(avoid.insetAlternate, true);
  const par = M.chooseCarouselPlacement({ chrome: ch, faces: everywhere, avoid, slideIndex: 4 });
  assert.equal(par.report.fallback, 'inset'); assert.equal(par.report.inset_text, 'bottom'); assert.equal(par.report.placement_used, 'bottom');
  assert.match(par.warnings[0], /el texto abajo sobre la superficie de la marca y la foto reducida arriba/);
  const rp = M.carouselBlockRect(par.fit.chrome, null).rect;
  assert.ok(par.fit.chrome.inset.y1 < rp.y0, 'la foto va arriba del texto');
  const impar = M.chooseCarouselPlacement({ chrome: ch, faces: everywhere, avoid, slideIndex: 5 });
  assert.equal(impar.report.inset_text, 'top');
  const ri = M.carouselBlockRect(impar.fit.chrome, null).rect;
  assert.ok(impar.fit.chrome.inset.y0 > ri.y1, 'la foto va debajo del texto');
  // Sin el token, idéntico a 1.11.0 aunque la lámina sea par.
  const antes = M.chooseCarouselPlacement({ chrome: chromeN1(BODY, BODY_TEXT, M.deepMergeTokens(POLICY, { carousel: { avoid_faces: { fallback: ['inset'] } } })),
    faces: everywhere, avoid: avoidOf(M.deepMergeTokens(POLICY, { carousel: { avoid_faces: { fallback: ['inset'] } } })), slideIndex: 4 });
  assert.equal(antes.report.inset_text, 'top');
  // Mal escrito, falla nombrando.
  assert.throws(() => avoidOf(M.deepMergeTokens(POLICY, { carousel: { avoid_faces: { inset_alternate: 'si' } } })), /inset_alternate/);
});
test('4a ter · 1.11.1 · el cableado pasa el número de la lámina a la colocación', () => {
  assert.match(SRC, /chooseCarouselPlacement\(\{ chrome: area\.chrome, metrics, avoid, slideIndex: carouselIn!\.index,/);
});
test('4c · sin último recurso aplicable: la colocación que menos tapa, y se dice', () => {
  const ch = chromeN1(BODY, BODY_TEXT, POLICY);
  const pick = M.chooseCarouselPlacement({ chrome: ch, faces: everywhere, avoid: avoidOf(POLICY) });
  assert.equal(pick.report.fallback, null); assert.ok(pick.report.overlap_pct > 0);
  assert.match(pick.warnings[0], /^CAROUSEL_SUBJECT_OVERLAP_UNAVOIDABLE: /);
  assert.equal(pick.fit.chrome.inset, undefined); assert.equal(pick.fit.chrome.band, undefined);
});
test('3f · ninguna colocación libra al tamaño de siempre ⇒ el titular baja de escalón antes del último recurso', () => {
  const pol = M.deepMergeTokens(POLICY, { carousel: { avoid_faces: { fallback: ['inset'] } } });
  const largo = { headline: 'El trigo no espera' };
  const ch = chromeN1(BODY, largo, pol);
  assert.equal(ch.type.headline.sizePct, 10); assert.deepEqual(ch.fitLadder.headline, [8]);
  // Una cara en cada fila, justo donde llega el bloque a 10 % pero no a 8 %: la franja de 8 % es más baja.
  const at = (st) => M.carouselBlockRect(st, null).rect;
  const small = { ...ch, type: { ...ch.type, headline: { ...ch.type.headline, sizePct: 8 } }, fitLadder: { headline: [] } };
  const rBig = at(ch), rSmall = at(small);
  assert.ok(rSmall.y1 < rBig.y1);
  const face = { x0: 0.1, y0: (rSmall.y1 + 25) / H, x1: 0.3, y1: (rBig.y1 + 60) / H };
  const faces = [face, { x0: 0.1, y0: 0, x1: 0.95, y1: (rBig.y0 + 5) / H }, { x0: 0.1, y0: (H - 200) / H, x1: 0.95, y1: 1 }];
  const pick = M.chooseCarouselPlacement({ chrome: ch, faces, avoid: avoidOf(pol) });
  assert.equal(pick.report.fallback, null, pick.report.reason); assert.equal(pick.report.headline_size_pct, 8);
  assert.match(pick.warnings[0], /^CAROUSEL_TEXT_REDUCED_FOR_SUBJECT: .*titular 10→8 %/);
  assert.equal(pick.fit.chrome.type.headline.sizePct, 8);
});
test('3g · mover el texto nunca cuesta contenido: una colocación que omite pasos no cuenta como libre', () => {
  const pol = { carousel: { avoid_faces: { enabled: true, column_pct: 40, placements: ['center_left'] } } };
  const steps = { ...BODY, steps: [
    { text: 'Sembrar en otoño temprano, cuando la tierra todavía guarda el calor del verano' },
    { text: 'Regar con medida cada semana y nunca a pleno sol del mediodía', critical: true },
    { text: 'Cosechar sin prisa, espiga por espiga, cuando el grano ya suena seco' },
    { text: 'Guardar en seco, lejos de la humedad y de la luz directa del sol' },
    { text: 'Moler sólo lo que se va a usar en la semana para que no pierda sabor' }] };
  const ch = chromeN1(steps, BODY_TEXT, pol);
  const base = M.fitCarouselContent({ chrome: ch });
  assert.equal(base.report.steps_dropped, 0, 'a todo el ancho caben');
  const narrow = M.fitCarouselContent({ chrome: { ...ch, block: { place: 'center', side: 'left', columnPct: 40 } } });
  assert.ok(narrow.report.steps_dropped > 0, 'en la columna estrecha no caben');
  // Una cara a la derecha, a la altura del bloque: la columna izquierda la libraría, pero omitiendo pasos.
  const r = rectAt(ch);
  const face = { x0: 0.75, y0: (r.y0 + 20) / H, x1: 0.92, y1: (r.y0 + 160) / H };
  const pick = M.chooseCarouselPlacement({ chrome: ch, faces: [face], avoid: avoidOf(pol) });
  assert.ok(pick.report.candidates.some((c) => c.placement === 'center_left' && c.overlap_pct === 0), 'la columna sí libraba la cara');
  assert.notEqual(pick.report.placement_used, 'center_left', pick.report.reason);
  assert.equal(pick.fit.report.steps_dropped, 0);
});
test('3h · una palabra más ancha que su columna no cabe: esa colocación no es libre', () => {
  const pol = { carousel: { avoid_faces: { enabled: true, column_pct: 30, placements: ['center_left'] } } };
  const text = { headline: 'Cosechadoras nuevas', subheadline: 'Ni el clima.' };
  const ch = chromeN1(BODY, text, pol);
  const col = M.measureCarouselLayout({ ...ch, block: { place: 'center', side: 'left', columnPct: 30 } }, null);
  assert.equal(col.wordOverflow, true, 'a 30 % la palabra larga no entra');
  assert.equal(M.measureCarouselLayout(ch, null).wordOverflow, false, 'a todo el ancho, sí');
  const r = rectAt(ch);
  const face = { x0: 0.8, y0: (r.y0 + 10) / H, x1: 0.95, y1: (r.y0 + 80) / H };
  const pick = M.chooseCarouselPlacement({ chrome: ch, faces: [face], avoid: avoidOf(pol) });
  assert.notEqual(pick.report.placement_used, 'center_left', pick.report.reason);
});
test('4d · determinismo: la misma entrada da la misma elección', () => {
  const ch = chromeN1(BODY, BODY_TEXT, POLICY);
  const f = [boxOn(rectAt(ch))];
  assert.equal(JSON.stringify(M.chooseCarouselPlacement({ chrome: ch, faces: f, avoid: avoidOf(POLICY) })),
    JSON.stringify(M.chooseCarouselPlacement({ chrome: ch, faces: f, avoid: avoidOf(POLICY) })));
});

console.log('\n── 5 · cajas y recorte ──');
test('5a · de la foto al lienzo con cover: misma proporción ⇒ igual; foto más ancha ⇒ se recorta a los lados', () => {
  const b = [{ x0: 0.2, y0: 0.3, x1: 0.4, y1: 0.5 }];
  assert.deepEqual(M.coverMapBoxes(b, 800, 1000, 1080, 1350), b);
  const wide = M.coverMapBoxes([{ x0: 0.5, y0: 0.5, x1: 0.6, y1: 0.6 }, { x0: 0, y0: 0, x1: 0.1, y1: 0.1 }], 2000, 1000, 1000, 1000);
  assert.equal(wide.length, 1, 'lo que queda fuera del lienzo se descarta');
  assert.deepEqual(wide[0], { x0: 0.5, y0: 0.5, x1: 0.7, y1: 0.6 });
  assert.deepEqual(M.coverMapBoxes(b, 0, 0, 10, 10), []);
});
test('5b · el recorte del inset tiene la proporción del hueco, centra lo que hay que ver y no sale de la foto', () => {
  const r = M.insetCropRect(1080, 1350, 900, 450, [{ x0: 0.1, y0: 0.05, x1: 0.3, y1: 0.2 }]);
  assert.equal(r.width, 1080); assert.equal(r.height, 540); assert.equal(r.left, 0); assert.equal(r.top, 0, 'arriba: no sale de la foto');
  const c = M.insetCropRect(1000, 1000, 100, 100, []);
  assert.deepEqual(c, { left: 0, top: 0, width: 1000, height: 1000 });
  const m = M.insetCropRect(1000, 2000, 500, 500, [{ x0: 0.4, y0: 0.5, x1: 0.6, y1: 0.6 }]);
  assert.deepEqual(m, { left: 0, top: 600, width: 1000, height: 1000 }, 'centrado en la unión (y = 0,55 · 2000)');
  // La unión no cabe (un envase alto en un hueco apaisado): se conserva su parte de arriba, con un respiro.
  const alto = M.insetCropRect(1000, 1000, 1000, 400, [{ x0: 0.55, y0: 0.25, x1: 0.75, y1: 0.73 }]);
  assert.deepEqual(alto, { left: 0, top: 234, width: 1000, height: 400 });
  assert.ok(alto.top <= 250, 'la tapa del envase queda dentro');
});

console.log('\n── 6 · overlay: `layout.avoid_products` ──');
const OV_TYPO = [{ role: 'titular', font_family: 'Fuente A' }, { role: 'cuerpo', font_family: 'Fuente B' }];
const OV_PAL = [{ role: 'claro', hex: '#FAFAFA' }, { role: 'oscuro', hex: '#000000' }];
const ovStyle = (layout) => M.resolveOverlayStyle({ tokens: {
  layout: { anchor: 'bottom_left', margin_pct: 7, max_width_pct: 76, ...layout },
  typography: { headline: { role: 'titular', fit_steps: [{ max_chars: 400, size_pct: 6 }] }, subheadline: { role: 'cuerpo', fit_steps: [{ max_chars: 400, size_pct: 3.4 }] } },
  palette: { headline: 'claro', subheadline: 'claro' },
}, typography: OV_TYPO, palette: OV_PAL, text: { headline: 'El daño de hoy empezó hace meses.', subheadline: 'La punta no miente.' } });
test('6a · dato validado: ausente o apagado no existe; pide avoid_faces', () => {
  assert.equal('avoidProducts' in ovStyle({ avoid_faces: { enabled: true } }).layout, false);
  assert.equal('avoidProducts' in ovStyle({ avoid_faces: { enabled: true }, avoid_products: { enabled: false } }).layout, false);
  assert.deepEqual(ovStyle({ avoid_faces: { enabled: true }, avoid_products: { enabled: true } }).layout.avoidProducts, { marginPct: 1 });
  assert.throws(() => ovStyle({ avoid_products: { enabled: true } }), /avoid_products pide layout\.avoid_faces/);
  assert.throws(() => ovStyle({ avoid_faces: { enabled: true }, avoid_products: { enabled: true, margin_pct: 30 } }), /avoid_products\.margin_pct/);
  assert.throws(() => ovStyle({ avoid_faces: { enabled: true }, avoid_products: true }), /layout\.avoid_products/);
});
test('6b · un producto donde cae el texto mueve el ancla sólo con el token; sin token, idéntico', () => {
  const Wv = 768, Hv = 1344;
  const sin = ovStyle({ avoid_faces: { enabled: true } });
  const r = M.overlayTextRect(sin, Wv, Hv, null, 'bottom_left');
  const prod = { x0: (r.x0 + 10) / Wv, y0: (r.y0 + 10) / Hv, x1: (r.x0 + 120) / Wv, y1: (r.y0 + 80) / Hv };
  const a = M.chooseOverlayAnchor({ style: sin, width: Wv, height: Hv, faces: [], products: [prod] });
  assert.equal(a.style, sin, 'sin el token, el mismo objeto');
  assert.equal('products' in a.report, false);
  const con = ovStyle({ avoid_faces: { enabled: true }, avoid_products: { enabled: true } });
  const b = M.chooseOverlayAnchor({ style: con, width: Wv, height: Hv, faces: [], products: [prod] });
  assert.equal(b.report.moved, true); assert.equal(b.report.products, 1);
  assert.ok(b.style.markers.some((m) => /^OVERLAY_ANCHOR_MOVED_FOR_FACE: en bottom_left el texto tapaba una cara o un producto/.test(m)));
  // Con caras y sin productos, el texto de los marcadores es el de 1.6.x.
  const c = M.chooseOverlayAnchor({ style: sin, width: Wv, height: Hv, faces: [prod] });
  assert.ok(c.style.markers.some((m) => /tapaba una cara \(/.test(m)));
});

console.log('\n── 7 · cableado ──');
test('7a · la MISMA detección: productos sólo con el token; sin él, la petición de 1.6.3', () => {
  assert.match(SRC, /FACES_PROMPT \+ \(opts\.signs \? SIGNS_PROMPT : ''\) \+ \(opts\.products \? PRODUCTS_PROMPT : ''\)/);
  assert.match(SRC, /const schemaKeys = \['faces', \.\.\.\(opts\.signs \? \['signs'\] : \[\]\), \.\.\.\(opts\.products \? \['products'\] : \[\]\)\];/);
  assert.match(SRC, /detectFaces\(slideBytes, slideDims\.mime, \{ products: !!avoid\.products,/);
  assert.match(SRC, /detectFaces\(cleanBytes, dims\.mime, \{ signs: wantSigns, products: wantProducts,/);
  assert.deepEqual(M.parseFaceBoxes('{"faces":[],"products":[{"box_2d":[100,200,300,400]}]}', 'products'), [{ x0: 0.2, y0: 0.1, x1: 0.4, y1: 0.3 }]);
});
test('7b · detección fallida ⇒ el ajuste de siempre y se dice; sin política, ni se llama', () => {
  const h = SRC.slice(SRC.indexOf('const avoid = resolveCarouselAvoid(picked.tokens);'), SRC.indexOf('const scene = buildCarouselScene({ chrome: fit.chrome, style, backgroundSrc });'));
  assert.ok(h.length > 0);
  assert.match(h, /if \(avoid && slideBytes && slideDims\) \{/);
  // 1.12.0 — sin `text_place`, `fitCarouselAtPlace` ES `fitCarouselContent` (lo prueba ubicacion_del_texto_test.mjs).
  assert.match(h, /CAROUSEL_FACE_CHECK_UNAVAILABLE: \$\{fc\.error \?\? 'sin respuesta'\}; \$\{rowIn \? `se compone en la fila pedida \(\$\{rowIn\}\)` : 'se compone en el centro de la maqueta, como siempre'\}/);
  assert.equal((h.match(/fit = fitCarouselAtPlace\(\{ chrome: area\.chrome, metrics, textPlace: textPlaceIn \}\);/g) ?? []).length, 2, 'detección fallida y sin política: el ajuste de siempre');
  assert.match(h, /coverMapBoxes\(fc\.faces, slideDims\.width, slideDims\.height, cw, ch\)/);
  assert.match(h, /await ledgerRecordDirect\(body, \[ledgerCallRow\(\{ outputType: 'image_overlay_faces'/);
});
test('7c · meta: `meta.faces` con la forma del overlay (el carril lo asienta) y `meta.carousel.avoid`', () => {
  assert.match(SRC, /\.\.\.\(slideFaceMeta \? \{ faces: slideFaceMeta \} : \{\}\),/);
  assert.match(SRC, /slideFaceMeta = \{ model: fc\.model, model_source: fc\.model_source \?\? null, provider_called: fc\.called, provider_http_status: fc\.http_status,/);
  assert.match(SRC, /\.\.\.\(avoidMeta \? \{ avoid: avoidMeta \} : \{\}\),/);
  assert.match(SRC, /identity: style\.identity && backgroundSrc && !fit\.chrome\.inset/);
});

console.log('\n── 8 · marca N+1 ──');
test('8a · el bloque nuevo no nombra marcas, ciudades ni personas', () => {
  const nuevo = BLOCK.slice(BLOCK.indexOf('// ── 1.11.0 · EL TEXTO DE LA LÁMINA NO TAPA CARAS NI PRODUCTOS'));
  for (const w of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'Patricia', 'Miami', 'Panamá', 'Broward', 'Humit']) {
    assert.ok(!nuevo.includes(w), `el eje nombra '${w}'`);
  }
});

console.log(`\n${fails.length ? '✗' : '✓'} ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
