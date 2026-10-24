// LA COLUMNA DEL TEXTO LA PIDE UNA PERSONA (compositor 1.17.0, 2026-10-24).
//
// Sam (2026-10-24), en el editor del texto de la imagen: «incluir la opción de alinear a la izquierda o derecha
// también, me parece útil», y después: «incluye centro».
//
// LO QUE FIJA ESTE TEST:
//   1. Contrato: `text_column` = 'left' | 'center' | 'right' o nada; otro valor es 400 con etiqueta.
//   2. Golden: sin el campo, el estilo es EL MISMO objeto y la lámina es la de siempre.
//   3. Overlay: el ancla de esa columna en la fila vigente, las líneas alineadas con la columna (aunque la marca declare
//      otra alineación); la esquina de la capa de producto no se usa.
//   4. Con la política: se esquiva sólo entre las anclas de esa columna que la marca declara; con la fila pedida, el
//      ancla queda fija; si tapa, se compone igual y se dice.
//   5. Lámina: el bloque en el lado pedido con el ancho de columna de la marca (o el de por defecto), o a todo el ancho;
//      con la política, sólo colocaciones de ese lado, sin último recurso.
//   6. Cableado y marca N+1.
//
// Ejecutar:  node tests/columna_del_texto_test.mjs     (Node ≥ 22.18)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'compose.ts'), 'utf8');
const BEGIN = '// ── COMPOSITOR:BEGIN ──', END = '// ── COMPOSITOR:END ──';
const dir = mkdtempSync(join(tmpdir(), 'columna-texto-'));
const mod = join(dir, 'block.mts');
writeFileSync(mod, SRC.slice(SRC.indexOf(BEGIN), SRC.indexOf(END) + END.length) + '\n', 'utf8');
const M = await import(pathToFileURL(mod).href);

let pass = 0; const fails = [];
const test = (n, f) => { try { f(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fails.push(n); console.log(`  ✗ ${n}\n    ${e.message}`); } };

// ── Marca INVENTADA (otro rubro, otro idioma): el eje no depende de ninguna marca real ──
const TYPO = [{ role: 'titular', font_family: 'Fuente A' }, { role: 'cuerpo', font_family: 'Fuente B' }, { role: 'rotulo', font_family: 'Fuente C' }];
const PAL = [
  { role: 'claro', hex: '#FAFAFA' }, { role: 'oscuro', hex: '#101010' }, { role: 'acento', hex: '#2F7A3D' },
  { role: 'trigo', hex: '#D9A441' }, { role: 'tierra', hex: '#3B2A1E' }, { role: 'arcilla', hex: '#5A4030' },
];
const tokens = (layout = {}, extra = {}) => ({
  layout: { anchor: 'bottom_left', margin_pct: 7, max_width_pct: 70, ...layout },
  typography: {
    headline: { role: 'titular', fit_steps: [{ max_chars: 400, size_pct: 6 }] },
    subheadline: { role: 'cuerpo', fit_steps: [{ max_chars: 400, size_pct: 3.4 }] },
  },
  palette: { headline: 'claro', subheadline: 'claro' },
  ...extra,
});
const TEXT = { headline: 'La cosecha no espera a nadie', subheadline: 'Ni el clima.' };
const style = (layout, extra) => M.resolveOverlayStyle({ tokens: tokens(layout, extra), typography: TYPO, palette: PAL, text: TEXT });
const W = 768, H = 1344;
const boxAt = (r) => ({ x0: (r.x0 + 10) / W, y0: (r.y0 + 10) / H, x1: (r.x0 + 110) / W, y1: (r.y0 + 110) / H });

console.log('\n── 1 · contrato ──');
test("1 · text_column: left | center | right o nada; otro valor es 400 con etiqueta", () => {
  for (const v of [undefined, null, '']) assert.equal(M.parseTextColumnRequest(v), null);
  for (const v of ['left', 'center', 'right']) assert.equal(M.parseTextColumnRequest(v), v);
  for (const v of ['izquierda', 'LEFT', 'top', 3, {}]) {
    assert.throws(() => M.parseTextColumnRequest(v), (e) => e.label === 'COMPOSITOR_TEXT_COLUMN_INVALID' && e.status === 400, JSON.stringify(v));
  }
  assert.deepEqual([...M.TEXT_COLUMNS], ['left', 'center', 'right']);
  assert.deepEqual(M.textColumnAnchors('right', 'flex-end'), ['bottom_right', 'middle_right', 'top_right']);
  assert.deepEqual(M.textColumnAnchors('center', 'flex-start'), ['top_center', 'center', 'bottom_center']);
});

console.log('\n── 2 · golden ──');
test('2 · sin text_column el estilo es EL MISMO objeto', () => {
  const s = style({ avoid_faces: { enabled: true } });
  const r = M.applyTextColumn(s, null, null);
  assert.equal(r.style, s); assert.equal(r.applied, null);
});

console.log('\n── 3 · overlay ──');
test('3a · derecha: el ancla de la derecha en la fila declarada, alineado a la derecha; la entrada no se muta', () => {
  const s = style();
  const r = M.applyTextColumn(s, 'right', null);
  assert.equal(r.style.layout.anchor, 'bottom_right'); assert.equal(r.style.layout.align, 'right');
  assert.deepEqual(r.applied, { requested: 'right', anchor_before: 'bottom_left', anchor_forced: 'bottom_right', candidates: ['bottom_right'] });
  assert.equal(s.layout.anchor, 'bottom_left');
  const rect = M.overlayTextRect(r.style, W, H, null, r.style.layout.anchor);
  assert.ok(rect.x1 > W / 2, 'el bloque queda del lado derecho');
});
test('3b · centro con la fila pedida arriba: arriba al centro, centrado', () => {
  const p = M.applyTextPlace(style(), 'top');
  const r = M.applyTextColumn(p.style, 'center', 'top');
  assert.equal(r.style.layout.anchor, 'top_center'); assert.equal(r.style.layout.align, 'center');
});
test('3c · la alineación de la columna manda sobre la que declara la marca: la pidió una persona', () => {
  const r = M.applyTextColumn(style({ anchor: 'bottom_center', align: 'left' }), 'right', null);
  assert.equal(r.style.layout.align, 'right');
});
test('3d · la esquina de la capa de producto no se usa: la siguiente fila de la columna, y se dice', () => {
  const r = M.applyTextColumn(style(), 'right', null, 'bottom_right');
  assert.equal(r.style.layout.anchor, 'middle_right');
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_COLUMN_ROW_MOVED')));
});

console.log('\n── 4 · con la política ──');
test('4a · se esquiva sólo entre las anclas de esa columna que la marca declara', () => {
  const s = style({ avoid_faces: { enabled: true, anchors: ['top_left', 'top_right', 'bottom_right', 'bottom_center'] } });
  const r = M.applyTextColumn(s, 'right', null);
  assert.deepEqual(r.style.layout.avoidFaces.anchors, ['bottom_right', 'top_right']);
  const face = boxAt(M.overlayTextRect(r.style, W, H, null, 'bottom_right'));
  const ch = M.chooseOverlayAnchor({ style: r.style, width: W, height: H, faces: [face], textColumn: 'right' });
  assert.equal(ch.report.anchor_used, 'top_right', ch.style.markers.join(' | '));
  assert.equal(ch.style.layout.align, 'right');
  assert.equal(ch.report.overlap_pct, 0);
});
test('4b · con la fila también pedida, el ancla queda fija; si tapa, se compone igual y se dice', () => {
  const s = style({ avoid_faces: { enabled: true } });
  const p = M.applyTextPlace(s, 'bottom');
  const r = M.applyTextColumn(p.style, 'left', 'bottom');
  assert.deepEqual(r.style.layout.avoidFaces.anchors, ['bottom_left']);
  const face = boxAt(M.overlayTextRect(r.style, W, H, null, 'bottom_left'));
  const ch = M.chooseOverlayAnchor({ style: r.style, width: W, height: H, faces: [face], textPlace: 'bottom', textColumn: 'left' });
  assert.equal(ch.report.anchor_used, 'bottom_left');
  assert.ok(ch.report.overlap_pct > 0);
  assert.ok(ch.style.markers.some((m) => /^OVERLAY_TEXT_COLUMN_COVERS: se pidió el texto a la izquierda/.test(m)), ch.style.markers.join(' | '));
});

console.log('\n── 5 · la lámina ──');
const N1_CAROUSEL = {
  palette: {
    keyword: 'trigo', progress_on: 'acento', progress_off: { role: 'claro', alpha: 0.2 }, counter: 'trigo', critical: 'trigo',
    light: 'trigo', muted: { role: 'claro', alpha: 0.5 }, surface: 'tierra', surface_closing: 'arcilla', figure: 'trigo',
  },
  carousel: {
    canvas: { width: 1000, height: 1250 }, margin_pct: 5,
    typography: {
      headline: { role: 'titular', weight: 700, transform: 'none', line_height: 1, fit_steps: [{ max_chars: 40, size_pct: 10 }, { max_chars: 90, size_pct: 8 }] },
      body: { role: 'cuerpo', weight: 400, size_pct: 4 },
      label: { role: 'rotulo', weight: 600, size_pct: 3, letter_spacing_em: 0.1, transform: 'uppercase' },
      figure: { role: 'titular', weight: 700, size_pct: 25, line_height: 0.9 },
    },
    swipe: { text: 'Glisser' },
    logo: { size_pct: 5, height_pct: 6 },
  },
};
const cTokens = (over = {}) => M.deepMergeTokens(M.deepMergeTokens(tokens(), N1_CAROUSEL), over);
const BODY = { index: 2, total: 5, role: 'body', eyebrow: 'Campo' };
const BTEXT = { headline: 'El trigo no espera a nadie', subheadline: 'Ni el clima ni la lluvia esperan.' };
const chrome = (over) => M.resolveCarouselChrome({ tokens: cTokens(over), typography: TYPO, palette: PAL, carousel: M.parseCarouselRequest(BODY), text: BTEXT });
const CW = 1000, CH = 1250;
const rectAt = (ch, block) => M.carouselBlockRect(block ? { ...ch, block } : ch, null).rect;
const boxOn = (r) => ({ x0: (r.x0 + 40) / CW, y0: (r.y0 + 20) / CH, x1: (r.x0 + 140) / CW, y1: (r.y0 + 120) / CH });
const POLICY = { carousel: { avoid_faces: { enabled: true, fallback: ['inset'] }, avoid_products: { enabled: true } } };

test('5a · sin la política: el lado pedido con el ancho por defecto; centro, todo el ancho; nada pedido, lo de siempre', () => {
  const ch = chrome();
  assert.deepEqual(M.fitCarouselAtPlace({ chrome: ch, textColumn: null }), M.fitCarouselContent({ chrome: ch }));
  assert.deepEqual(M.fitCarouselAtPlace({ chrome: ch, textColumn: 'center' }), M.fitCarouselContent({ chrome: ch }));
  const d = M.fitCarouselAtPlace({ chrome: ch, textColumn: 'right' });
  assert.deepEqual(d.chrome.block, { place: 'center', side: 'right', columnPct: M.CAROUSEL_TEXT_COLUMN_PCT_DEFAULT });
  const i = M.fitCarouselAtPlace({ chrome: ch, textColumn: 'left', textPlace: 'top', columnPct: 55 });
  assert.deepEqual(i.chrome.block, { place: 'top', side: 'left', columnPct: 55 });
  assert.ok(rectAt(d.chrome).x0 > rectAt(i.chrome).x0, 'la derecha queda a la derecha de la izquierda');
});
test('5b · con la política: sólo colocaciones del lado pedido; nada que tape ⇒ ahí, sin avisos', () => {
  const pol = M.deepMergeTokens(POLICY, { carousel: { avoid_faces: { column_pct: 55 } } });
  const pick = M.chooseCarouselPlacement({ chrome: chrome(pol), faces: [], avoid: M.resolveCarouselAvoid(cTokens(pol)), textColumn: 'right' });
  assert.equal(pick.fit.chrome.block.side, 'right'); assert.equal(pick.fit.chrome.block.columnPct, 55);
  assert.deepEqual(pick.warnings, []);
  assert.equal(pick.report.text_column, 'right');
  assert.ok(pick.report.candidates.every((c) => c.placement.endsWith('_right')), pick.report.candidates.map((c) => c.placement).join(', '));
});
test('5c · todo el lado tapa ⇒ se compone igual en ese lado, sin inset, y se dice', () => {
  const pol = M.deepMergeTokens(POLICY, { carousel: { avoid_faces: { column_pct: 55 } } });
  const face = { x0: 0.45, y0: 0, x1: 1, y1: 1 };
  const pick = M.chooseCarouselPlacement({ chrome: chrome(pol), faces: [face], avoid: M.resolveCarouselAvoid(cTokens(pol)), textColumn: 'right' });
  assert.equal(pick.fit.chrome.block.side, 'right');
  assert.equal(pick.report.fallback, null); assert.equal(pick.fit.chrome.inset, undefined);
  assert.match(pick.warnings[0], /^CAROUSEL_TEXT_COLUMN_COVERS: se pidió el texto a la derecha/);
});
test('5d · centro con la política: sólo colocaciones a todo el ancho', () => {
  const pol = M.deepMergeTokens(POLICY, { carousel: { avoid_faces: { column_pct: 55 } } });
  const ch = chrome(pol);
  const face = boxOn(rectAt(ch));
  const pick = M.chooseCarouselPlacement({ chrome: ch, faces: [face], avoid: M.resolveCarouselAvoid(cTokens(pol)), textColumn: 'center' });
  assert.ok(pick.report.candidates.every((c) => !c.placement.includes('_')), pick.report.candidates.map((c) => c.placement).join(', '));
  assert.equal(pick.fit.chrome.block?.side ?? null, null);
});

console.log('\n── 6 · cableado y marca N+1 ──');
test('6a · el handler valida el campo, lo aplica después de la fila y antes de la capa de producto, y lo pasa a las dos elecciones', () => {
  assert.match(SRC, /const textColumnIn = parseTextColumnRequest\(body\.text_column\);/);
  const i = SRC.indexOf('const columnApplied = applyTextColumn(placeApplied.style, textColumnIn, textPlaceIn, prodAnchorIn);');
  assert.ok(i > SRC.indexOf('const placeApplied = applyTextPlace(style, textPlaceIn, prodAnchorIn);'));
  assert.ok(i < SRC.indexOf('const prodPick = resolveProductLayer({ tokens: picked.tokens, textAnchor: oStyle.slots.headline'));
  assert.match(SRC, /textPlace: textPlaceIn, textColumn: textColumnIn \}\);/);
  assert.match(SRC, /slideIndex: carouselIn!\.index, textPlace: textPlaceIn, textColumn: textColumnIn,/);
  assert.match(SRC, /\.\.\.\(columnApplied\.applied \? \{ text_column: \{/);
  assert.match(SRC, /\.\.\.\(textColumnIn \? \{ text_column: \{ requested: textColumnIn,/);
  assert.match(SRC, /COMPOSITOR_VERSION = '1\.(1[7-9]|[2-9]\d)\.\d+'/);
});
test('6b · el bloque nuevo no nombra marcas ni ciudades', () => {
  const ini = SRC.indexOf('// ── 1.17.0 · LA COLUMNA DEL TEXTO');
  const blk = SRC.slice(ini, SRC.indexOf('/**\n * 1.6.3 — ¿Se lee el énfasis?', ini));
  assert.ok(blk.length > 500);
  for (const lit of ['ForumPHs', 'NeuroneSCF', 'UnrealvilleStudio', 'LucienSael', 'Panam', 'Miami', 'Madrid']) assert.equal(blk.includes(lit), false, lit);
});

console.log(`\n${fails.length ? '✗' : '✓'} ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
