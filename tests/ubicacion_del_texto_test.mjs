// 1.12.0 — LA UBICACIÓN DEL TEXTO LA PIDE UNA PERSONA. Test del bloque PURO y del cableado.
//
// EL CASO (Sam, 2026-10-22, mirando piezas en Arreglos): «de las 5 piezas hay algunas cuyo texto está mal ubicado. En
// el Orchestrator quiero poder solicitar … que se cambie la ubicación del texto arriba, abajo o recomponer para que no
// tape el objetivo o el producto».
//
// QUÉ AFIRMA.
//   1. Contrato: `text_place` es 'top' | 'bottom' | 'auto' o no viene; cualquier otro valor es 400 con etiqueta.
//   2. GOLDEN: sin el campo, el estilo y la lámina son EXACTAMENTE los de 1.11.1 (el mismo objeto, el mismo ajuste).
//   3. Overlay con 'top'/'bottom': el ancla de esa fila en la columna declarada; la alineación sigue a la columna; el
//      velo en degradado sigue al texto; la esquina de la capa de producto no se usa y se dice.
//   4. Con la política de caras, se esquiva sólo por columna dentro de la fila pedida; si toda la fila tapa, se
//      compone igual y se dice (`OVERLAY_TEXT_PLACE_COVERS`).
//   5. La zona segura del canal se respeta con la fila forzada.
//   6. 'auto': la elección de siempre; sin la política, el ancla declarada, y se dice.
//   7. Lámina: la fila pedida a todo el ancho; con la política, sus columnas declaradas; si tapa, se compone igual y
//      sin último recurso (`CAROUSEL_TEXT_PLACE_COVERS`). 'auto' es la elección de 1.11.x.
//   8. Cableado: el handler valida el campo, lo aplica antes de la capa de producto, lo pasa a las dos elecciones y lo
//      devuelve en `meta`.
//   9. Marca N+1: una marca inventada compone con el mismo código.
//
// Ejecutar:  node tests/ubicacion_del_texto_test.mjs     (Node ≥ 22.18)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'compose.ts'), 'utf8');
const BEGIN = '// ── COMPOSITOR:BEGIN ──', END = '// ── COMPOSITOR:END ──';
const dir = mkdtempSync(join(tmpdir(), 'ubicacion-texto-'));
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
test('1 · text_place: top | bottom | auto o nada; otro valor es 400 con etiqueta', () => {
  assert.equal(M.parseTextPlaceRequest(undefined), null);
  assert.equal(M.parseTextPlaceRequest(null), null);
  assert.equal(M.parseTextPlaceRequest(''), null);
  for (const v of ['top', 'bottom', 'auto']) assert.equal(M.parseTextPlaceRequest(v), v);
  for (const v of ['arriba', 'TOP', 'center', 3, {}]) {
    assert.throws(() => M.parseTextPlaceRequest(v), (e) => e.label === 'COMPOSITOR_TEXT_PLACE_INVALID' && e.status === 400, JSON.stringify(v));
  }
  assert.deepEqual([...M.TEXT_PLACES], ['top', 'bottom', 'auto']);
});
test('1b · las anclas de una fila: la columna declarada y luego las otras por cercanía', () => {
  assert.deepEqual(M.textPlaceRowAnchors('top', 'bottom_left'), ['top_left', 'top_center', 'top_right']);
  assert.deepEqual(M.textPlaceRowAnchors('bottom', 'top_center'), ['bottom_center', 'bottom_left', 'bottom_right']);
  assert.deepEqual(M.textPlaceRowAnchors('bottom', 'middle_right'), ['bottom_right', 'bottom_center', 'bottom_left']);
  assert.deepEqual(M.textPlaceRowAnchors('top', 'nada'), []);
});

console.log('\n── 2 · golden: sin el campo, lo de 1.11.1 ──');
test('2 · sin text_place el estilo es EL MISMO objeto y la elección de caras no cambia', () => {
  const s = style({ avoid_faces: { enabled: true }, scrim: { mode: 'gradient_bottom', palette: 'oscuro', opacity: 0.6, coverage_pct: 50 } });
  const r = M.applyTextPlace(s, null);
  assert.equal(r.style, s); assert.equal(r.applied, null);
  const face = boxAt(M.overlayTextRect(s, W, H, null, 'bottom_left'));
  const a = M.chooseOverlayAnchor({ style: s, width: W, height: H, faces: [face] });
  const b = M.chooseOverlayAnchor({ style: s, width: W, height: H, faces: [face], textPlace: null });
  assert.deepEqual(b, a);
  // 1.15.0 — la franja primero (`faceAnchorCandidates`). ⛔ NO OPERATIVO — aserto anterior: anchor === 'top_left' («otra fila de la misma columna»).
  assert.equal(a.style.layout.anchor, a.report.candidates.find((c) => c.overlap_pct === 0)?.anchor ?? a.style.layout.anchor, 'la primera candidata libre, en el orden de la franja');
  assert.deepEqual(a.report.candidates.map((c) => c.anchor).slice(0, 3), ['bottom_left', 'bottom_right', 'bottom_center'], 'primero toda la franja');
});

console.log('\n── 3 · overlay: la fila pedida ──');
test('3a · top sin la política: el ancla de arriba en la columna declarada; el estilo de entrada no se muta', () => {
  const s = style();
  const r = M.applyTextPlace(s, 'top');
  assert.equal(r.style.layout.anchor, 'top_left'); assert.equal(r.style.layout.align, 'left');
  assert.equal('avoidFaces' in r.style.layout, false);
  assert.deepEqual(r.applied, { requested: 'top', anchor_declared: 'bottom_left', anchor_forced: 'top_left', row_candidates: ['top_left'] });
  assert.equal(s.layout.anchor, 'bottom_left');
  assert.deepEqual(r.style.markers, s.markers);
  const rect = M.overlayTextRect(r.style, W, H, null, r.style.layout.anchor);
  assert.ok(rect.y1 < H / 2, 'el bloque queda en la mitad de arriba');
});
test('3b · bottom con ancla declarada arriba al centro: abajo al centro', () => {
  const r = M.applyTextPlace(style({ anchor: 'top_center' }), 'bottom');
  assert.equal(r.style.layout.anchor, 'bottom_center'); assert.equal(r.style.layout.align, 'center');
});
test('3c · el velo en degradado sigue al texto; uno sólido no se toca', () => {
  const g = M.applyTextPlace(style({ scrim: { mode: 'gradient_bottom', palette: 'oscuro', opacity: 0.6, coverage_pct: 50 } }), 'top');
  assert.equal(g.style.scrim.mode, 'gradient_top');
  assert.ok(g.style.markers.some((m) => m.startsWith('OVERLAY_SCRIM_FOLLOWS_TEXT')));
  const g2 = M.applyTextPlace(style({ scrim: { mode: 'gradient_bottom', palette: 'oscuro', opacity: 0.6, coverage_pct: 50 } }), 'bottom');
  assert.equal(g2.style.scrim.mode, 'gradient_bottom'); assert.equal(g2.style.markers.length, 0);
  const so = M.applyTextPlace(style({ scrim: { mode: 'solid', palette: 'oscuro', opacity: 0.4 } }), 'top');
  assert.equal(so.style.scrim.mode, 'solid');
});
test('3d · la esquina de la capa de producto no se usa: la siguiente columna de la fila, y se dice', () => {
  const r = M.applyTextPlace(style(), 'top', 'top_left');
  assert.equal(r.style.layout.anchor, 'top_center'); assert.equal(r.style.layout.align, 'center');
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_PLACE_COLUMN_MOVED')));
});
test('3e · una alineación declarada por la marca se respeta', () => {
  const r = M.applyTextPlace(style({ anchor: 'bottom_center', align: 'left' }), 'top', 'top_center');
  assert.equal(r.style.layout.anchor, 'top_left'); assert.equal(r.style.layout.align, 'left');
});

console.log('\n── 4 · con la política: se esquiva sólo por columna ──');
test('4a · una cara en arriba-izquierda ⇒ otra columna de arriba, nunca otra fila', () => {
  const s = style({ avoid_faces: { enabled: true } });
  const p = M.applyTextPlace(s, 'top');
  assert.deepEqual(p.style.layout.avoidFaces.anchors, ['top_left', 'top_center', 'top_right']);
  const face = { x0: 0, y0: 0, x1: 0.3, y1: 0.4 };
  const ch = M.chooseOverlayAnchor({ style: p.style, width: W, height: H, faces: [face], textPlace: 'top' });
  assert.match(ch.report.anchor_used, /^top_/);
  assert.equal(ch.report.overlap_pct, 0, ch.style.markers.join(' | '));
  assert.ok(!ch.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_PLACE_COVERS')));
});
test('4b · toda la fila tapa ⇒ se compone igual en esa fila, y se dice', () => {
  const s = style({ avoid_faces: { enabled: true }, avoid_products: { enabled: true } });
  const p = M.applyTextPlace(s, 'bottom');
  const prod = { x0: 0, y0: 0.55, x1: 1, y1: 1 };
  const ch = M.chooseOverlayAnchor({ style: p.style, width: W, height: H, faces: [], products: [prod], textPlace: 'bottom' });
  assert.match(ch.report.anchor_used, /^bottom_/);
  assert.ok(ch.report.overlap_pct > 0);
  assert.ok(ch.style.markers.some((m) => /^OVERLAY_TEXT_PLACE_COVERS: se pidió el texto abajo/.test(m)), ch.style.markers.join(' | '));
});

console.log('\n── 5 · la zona segura del canal ──');
test('5 · con la fila forzada, la caja del texto queda dentro de la zona segura', () => {
  const zone = { top: 14, right: 22, bottom: 37, left: 6 };
  for (const place of ['top', 'bottom']) {
    const r = M.applyTextPlace(style({ safe_zone_pct: zone }), place);
    const rect = M.overlayTextRect(r.style, W, H, null, r.style.layout.anchor);
    assert.ok(rect.y0 >= (zone.top / 100) * H - 0.5, `${place}: arriba de la zona (${rect.y0})`);
    assert.ok(rect.y1 <= H - (zone.bottom / 100) * H + 0.5, `${place}: abajo de la zona (${rect.y1})`);
    assert.ok(rect.x0 >= (zone.left / 100) * W - 0.5, `${place}: izquierda de la zona`);
  }
});

console.log('\n── 6 · auto ──');
test("6 · 'auto' con la política: el mismo objeto; sin ella, el ancla declarada y se dice", () => {
  const con = style({ avoid_faces: { enabled: true } });
  const a = M.applyTextPlace(con, 'auto');
  assert.equal(a.style, con); assert.equal(a.applied.requested, 'auto');
  const sin = style();
  const b = M.applyTextPlace(sin, 'auto');
  assert.equal(b.style.layout.anchor, 'bottom_left');
  assert.ok(b.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_PLACE_AUTO_WITHOUT_POLICY')));
});

console.log('\n── 7 · la lámina de carrusel ──');
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

test('7a · sin la política: sin campo o con auto, el ajuste de siempre; top/bottom, esa fila a todo el ancho', () => {
  const ch = chrome();
  const base = M.fitCarouselContent({ chrome: ch });
  assert.deepEqual(M.fitCarouselAtPlace({ chrome: ch }), base);
  assert.deepEqual(M.fitCarouselAtPlace({ chrome: ch, textPlace: 'auto' }), base);
  for (const p of ['top', 'bottom']) {
    const f = M.fitCarouselAtPlace({ chrome: ch, textPlace: p });
    assert.deepEqual(f.chrome.block, { place: p, side: null, columnPct: 100 });
  }
  const top = rectAt(M.fitCarouselAtPlace({ chrome: ch, textPlace: 'top' }).chrome);
  const bot = rectAt(M.fitCarouselAtPlace({ chrome: ch, textPlace: 'bottom' }).chrome);
  assert.ok(top.y0 < bot.y0, 'arriba queda por encima de abajo');
});
test("7b · con la política: sin campo y con 'auto', la elección de 1.11.x (igual, valor por valor)", () => {
  const ch = chrome(POLICY);
  const avoid = M.resolveCarouselAvoid(cTokens(POLICY));
  const face = boxOn(rectAt(ch));
  const a = M.chooseCarouselPlacement({ chrome: ch, faces: [face], avoid });
  const b = M.chooseCarouselPlacement({ chrome: ch, faces: [face], avoid, textPlace: 'auto' });
  assert.deepEqual(b, a);
  assert.equal(a.report.placement_declared, 'center');
  assert.equal('text_place' in a.report, false);
});
test('7c · top pedido y nada que tape: arriba, sin moverse y sin avisos', () => {
  const ch = chrome(POLICY);
  const pick = M.chooseCarouselPlacement({ chrome: ch, faces: [], avoid: M.resolveCarouselAvoid(cTokens(POLICY)), textPlace: 'top' });
  assert.equal(pick.report.placement_declared, 'top'); assert.equal(pick.report.placement_used, 'top');
  assert.equal(pick.report.moved, false); assert.deepEqual(pick.warnings, []);
  assert.equal(pick.report.text_place, 'top');
  assert.equal(pick.fit.chrome.block.place, 'top');
});
test('7d · una cara en la fila pedida con columnas declaradas ⇒ una columna de esa fila, nunca otra fila', () => {
  const pol = M.deepMergeTokens(POLICY, { carousel: { avoid_faces: { column_pct: 55 } } });
  const ch = chrome(pol);
  const full = rectAt(ch, { place: 'bottom', side: null, columnPct: 100 });
  const face = { x0: 0.05, y0: (full.y0 + 10) / CH, x1: 0.4, y1: (full.y1 - 10) / CH };
  const pick = M.chooseCarouselPlacement({ chrome: ch, faces: [face], avoid: M.resolveCarouselAvoid(cTokens(pol)), textPlace: 'bottom' });
  assert.equal(pick.report.placement_used, 'bottom_right', pick.report.reason);
  assert.equal(pick.report.overlap_pct, 0);
  assert.ok(pick.report.candidates.every((c) => c.placement.startsWith('bottom')), 'sólo se prueba la fila pedida');
});
test('7e · toda la fila tapa ⇒ se compone igual en esa fila, sin inset, y se dice', () => {
  const ch = chrome(POLICY);
  const full = rectAt(ch, { place: 'top', side: null, columnPct: 100 });
  const face = { x0: 0, y0: Math.max(0, (full.y0 - 30) / CH), x1: 1, y1: (full.y1 + 30) / CH };
  const pick = M.chooseCarouselPlacement({ chrome: ch, faces: [face], avoid: M.resolveCarouselAvoid(cTokens(POLICY)), textPlace: 'top' });
  assert.equal(pick.report.placement_used, 'top');
  assert.equal(pick.report.fallback, null); assert.equal(pick.fit.chrome.inset, undefined);
  assert.ok(pick.report.overlap_pct > 0);
  assert.match(pick.warnings[0], /^CAROUSEL_TEXT_PLACE_COVERS: se pidió el texto arriba/);
  // Sin pedido, la misma cara habría ido a la fila libre o al último recurso: el pedido manda.
  const libre = M.chooseCarouselPlacement({ chrome: ch, faces: [face], avoid: M.resolveCarouselAvoid(cTokens(POLICY)) });
  assert.notEqual(libre.report.placement_used, 'top');
});

console.log('\n── 8 · cableado ──');
test('8a · el handler valida text_place con el resto del contrato y lo aplica antes de la capa de producto', () => {
  assert.match(SRC, /const textPlaceIn = parseTextPlaceRequest\(body\.text_place\);/);
  const i = SRC.indexOf('const placeApplied = applyTextPlace(style, textPlaceIn, prodAnchorIn);');
  assert.ok(i > 0);
  assert.ok(i < SRC.indexOf('const prodPick = resolveProductLayer({ tokens: picked.tokens, textAnchor: oStyle.slots.headline ? oStyle.layout.anchor : null'));
  assert.match(SRC, /const areaFit = fitOverlayTextArea\(\{ style: oStyle,/);
});
test('8b · la fila llega a las dos elecciones y vuelve en meta', () => {
  assert.match(SRC, /chooseCarouselPlacement\(\{ chrome: area\.chrome, metrics, avoid, slideIndex: carouselIn!\.index, textPlace: textPlaceIn,/);
  assert.match(SRC, /signs: fc\.signs, products: fc\.products,\s*textPlace: textPlaceIn(, textColumn: textColumnIn)? \}\);/);
  assert.match(SRC, /\.\.\.\(placeApplied\.applied \? \{ text_place: \{ \.\.\.placeApplied\.applied, anchor_used: finalStyle\.layout\.anchor \} \} : \{\}\),/);
  assert.match(SRC, /\.\.\.\(textPlaceIn \? \{ text_place: \{ requested: textPlaceIn, placement_used: fit\.chrome\.block\?\.place \?\? 'center',/);
});
test('8c · la versión sube a 1.12.0 (o a una posterior)', () => {
  assert.match(SRC, /COMPOSITOR_VERSION = '1\.(1(2\.0|3\.[01]|4\.0|5\.0|6\.0|7\.0|8\.0|9\.0)|2[0-2]\.0)'/);
});

console.log('\n── 9 · marca N+1 ──');
test('9 · el bloque nuevo no nombra marcas ni ciudades', () => {
  const ini = SRC.indexOf('// ── 1.12.0 · LA UBICACIÓN DEL TEXTO');
  const blk = SRC.slice(ini, SRC.indexOf('/**\n * 1.6.3 — ¿Se lee el énfasis?', ini));
  assert.ok(blk.length > 500);
  assert.ok(!/neurone|forum|unrealville|panam|miami/i.test(blk));
});

console.log(`\n${pass} ok · ${fails.length} fallos`);
if (fails.length) { console.log('FALLOS:\n  ' + fails.join('\n  ')); process.exit(1); }
