// 1.6.0 — EL TEXTO NO TAPA UNA CARA, Y SE LEE SOBRE FONDO CLARO. Test del bloque PURO y del cableado.
//
// QUÉ AFIRMA.
//   1. Candidatas por defecto: la declarada y las otras dos filas de su misma columna.
//   2. `layout.avoid_faces` y `layout.text_effect` son dato validado: mal escritos fallan nombrando; ausentes o
//      apagados no existen en el estilo.
//   3. Con una cara donde cae el texto, el bloque se va a la primera candidata libre; si la declarada ya está
//      libre, el estilo es EL MISMO objeto; si ninguna está libre, la de menor solape, y se dice.
//   4. La sombra llega al titular, a la bajada y a los tramos con énfasis; sin el token no hay sombra.
//   5. Las cajas del modelo se normalizan; lo que no es caja se descarta.
//   6. compose.ts usa la misma autenticación y el mismo endpoint de Vertex que inspect.ts, literal.
//   8. 1.6.2 — `text_effect.when: 'low_contrast'` es dato validado; la sombra se aplica sólo cuando el peor 10 % del
//      fondo bajo el texto contrasta menos que `min_contrast` y la sombra ayuda; el cableado mide el fondo YA ubicado.
//   9. 1.6.3 — letreros: las caras deciden el tamaño; entre anclas que tapan lo mismo de caras gana la que menos tapa
//      un letrero; el que queda bajo el texto se informa para desenfocarlo. El énfasis cambia de color sólo si no se
//      lee y la alternativa contrasta más. Sin los tokens, el estilo y la elección son los de 1.6.2.
//
// Ejecutar:  node tests/compositor_caras_test.mjs     (Node ≥ 22.18)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'compose.ts'), 'utf8');
const INSPECT = readFileSync(join(ROOT, 'api', 'inspect.ts'), 'utf8');
const BEGIN = '// ── COMPOSITOR:BEGIN ──', END = '// ── COMPOSITOR:END ──';
const dir = mkdtempSync(join(tmpdir(), 'compositor-caras-'));
const mod = join(dir, 'block.mts');
writeFileSync(mod, SRC.slice(SRC.indexOf(BEGIN), SRC.indexOf(END) + END.length) + '\n', 'utf8');
const M = await import(pathToFileURL(mod).href);

let pass = 0; const fails = [];
const test = (n, f) => { try { f(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fails.push(n); console.log(`  ✗ ${n}\n    ${e.message}`); } };

// Marca ficticia: el eje no depende de ninguna marca real.
const TYPO = [{ role: 'titular', font_family: 'Fuente A' }, { role: 'cuerpo', font_family: 'Fuente B' }];
const PAL = [{ role: 'claro', hex: '#FAFAFA' }, { role: 'oscuro', hex: '#000000' }, { role: 'acento', hex: '#0076A8' }];
const tokens = (layout = {}, extra = {}) => ({
  layout: { anchor: 'bottom_left', margin_pct: 7, max_width_pct: 76, ...layout },
  typography: {
    headline: { role: 'titular', fit_steps: [{ max_chars: 400, size_pct: 6 }], emphasis: { role: 'titular', weight: 700, size_scale: 1.1 } },
    subheadline: { role: 'cuerpo', fit_steps: [{ max_chars: 400, size_pct: 3.4 }] },
  },
  palette: { headline: 'claro', subheadline: 'claro', headline_emphasis: 'acento' },
  ...extra,
});
const TEXT = { headline: 'El daño de hoy empezó hace meses y recién se ve.', subheadline: 'La punta no miente.', emphasis: ['recién se ve'] };
const style = (layout, extra) => M.resolveOverlayStyle({ tokens: tokens(layout, extra), typography: TYPO, palette: PAL, text: TEXT });
const W = 768, H = 1344;

// 1.15.0 — un ancla de franja prueba primero toda su franja. ⛔ NO OPERATIVO — asertos anteriores (la declarada y su
// columna): bottom_left → ['bottom_left', 'top_left', 'middle_left']; top_center → ['top_center', 'bottom_center', 'center'].
test('1 · candidatas por defecto: toda la franja, la franja opuesta y por último el medio; el medio conserva su columna', () => {
  assert.deepEqual(M.faceAnchorCandidates('bottom_left'),
    ['bottom_left', 'bottom_right', 'bottom_center', 'top_left', 'top_right', 'top_center', 'middle_left', 'middle_right', 'center']);
  assert.deepEqual(M.faceAnchorCandidates('top_center'),
    ['top_center', 'top_left', 'top_right', 'bottom_center', 'bottom_left', 'bottom_right', 'center', 'middle_left', 'middle_right']);
  assert.deepEqual(M.faceAnchorCandidates('middle_right'), ['middle_right', 'top_right', 'bottom_right']);
  assert.deepEqual(M.faceAnchorCandidates('nada'), []);
});

test('2 · los tokens son dato validado; ausentes o apagados no existen', () => {
  const base = style();
  assert.equal('avoidFaces' in base.layout, false);
  assert.equal('textEffect' in base, false);
  assert.equal('avoidFaces' in style({ avoid_faces: { enabled: false } }).layout, false);
  const on = style({ avoid_faces: { enabled: true } });
  assert.deepEqual(on.layout.avoidFaces, { anchors: M.faceAnchorCandidates('bottom_left'), marginPct: 2, keepAlign: false });
  assert.equal(style({ align: 'left', avoid_faces: { enabled: true, anchors: ['top_left'], margin_pct: 3 } }).layout.avoidFaces.keepAlign, true);
  assert.throws(() => style({ avoid_faces: { enabled: true, anchors: ['arriba'] } }), /COMPOSITOR_TOKENS_INCOMPLETE|avoid_faces\.anchors/);
  assert.throws(() => style({ avoid_faces: true }), /layout\.avoid_faces/);
  assert.throws(() => style({ avoid_faces: { enabled: true, margin_pct: 50 } }), /margin_pct/);
  const te = style({ text_effect: { kind: 'shadow', color: 'oscuro', alpha: 0.35, blur_pct: 0.6, offset_pct: 0.15 } });
  assert.deepEqual(te.textEffect, { color: 'rgba(0, 0, 0, 0.35)', blurPct: 0.6, offsetPct: 0.15 });
  assert.throws(() => style({ text_effect: { kind: 'shadow', color: 'no_existe', alpha: 0.3, blur_pct: 1, offset_pct: 0 } }), /no_existe/);
  assert.throws(() => style({ text_effect: { kind: 'shadow', color: 'oscuro', alpha: 0.3, blur_pct: 9, offset_pct: 0 } }), /layout\.text_effect/);
});

// 1.15.0 — 3a, 3c, 3d y 9b fijan las candidatas de antes (la columna) para seguir probando lo que prueban; el orden
// por defecto nuevo (la franja primero) lo prueba 3f.
test('3a · una cara donde cae el texto ⇒ primera candidata libre', () => {
  const s = style({ avoid_faces: { enabled: true, anchors: ['top_left', 'middle_left'] } });
  const r = M.overlayTextRect(s, W, H, null, 'bottom_left');
  // Una cara justo sobre el bloque declarado.
  const face = { x0: r.x0 / W, y0: r.y0 / H, x1: (r.x0 + 120) / W, y1: (r.y0 + 120) / H };
  const ch = M.chooseOverlayAnchor({ style: s, width: W, height: H, faces: [face] });
  assert.equal(ch.report.anchor_declared, 'bottom_left');
  assert.equal(ch.report.anchor_used, 'top_left');
  assert.equal(ch.style.layout.anchor, 'top_left');
  assert.equal(ch.style.layout.align, 'left');
  assert.ok(ch.style.markers.some((m) => m.startsWith('OVERLAY_ANCHOR_MOVED_FOR_FACE')));
  assert.equal(s.layout.anchor, 'bottom_left', 'el estilo de entrada no se muta');
});

test('3b · la declarada libre ⇒ el MISMO objeto; sin token ⇒ el mismo objeto', () => {
  const s = style({ avoid_faces: { enabled: true } });
  const lejos = { x0: 0.9, y0: 0.0, x1: 0.99, y1: 0.05 };
  assert.equal(M.chooseOverlayAnchor({ style: s, width: W, height: H, faces: [lejos] }).style, s);
  assert.equal(M.chooseOverlayAnchor({ style: s, width: W, height: H, faces: [] }).style, s);
  const sin = style();
  const r = M.chooseOverlayAnchor({ style: sin, width: W, height: H, faces: [{ x0: 0, y0: 0, x1: 1, y1: 1 }] });
  assert.equal(r.style, sin); assert.equal(r.report, null);
});

test('3f · 1.15.0 · con el orden por defecto, una cara en el ancla de abajo lleva el texto al otro lado de LA MISMA franja', () => {
  // Lienzo apaisado y bloque angosto: los dos lados de la franja no se pisan.
  const WW = 1344, HH = 768;
  const s = style({ max_width_pct: 40, avoid_faces: { enabled: true } });
  const r = M.overlayTextRect(s, WW, HH, null, 'bottom_left');
  const cara = { x0: r.x0 / WW, y0: (r.y0 - 40) / HH, x1: (r.x0 + 160) / WW, y1: (r.y0 + 120) / HH };
  const ch = M.chooseOverlayAnchor({ style: s, width: WW, height: HH, faces: [cara] });
  assert.equal(ch.report.anchor_used, 'bottom_right', 'se queda en la franja de abajo');
  assert.ok(!['top_left', 'middle_left'].includes(ch.style.layout.anchor), 'no sube por la columna');
});

test('3c · ninguna libre ⇒ la de menor solape, y se dice; el ancla del producto no es candidata', () => {
  const s = style({ avoid_faces: { enabled: true, anchors: ['top_left', 'middle_left'] } });
  const ch = M.chooseOverlayAnchor({ style: s, width: W, height: H, faces: [{ x0: 0, y0: 0, x1: 1, y1: 1 }] });
  assert.ok(ch.report.overlap_pct > 0);
  assert.ok(ch.style.markers.some((m) => m.startsWith('OVERLAY_FACE_OVERLAP_UNAVOIDABLE')));
  const r = M.overlayTextRect(s, W, H, null, 'bottom_left');
  const face = { x0: r.x0 / W, y0: r.y0 / H, x1: (r.x0 + 120) / W, y1: (r.y0 + 120) / H };
  const p = M.chooseOverlayAnchor({ style: s, width: W, height: H, faces: [face], productAnchor: 'top_left' });
  assert.equal(p.report.anchor_used, 'middle_left');
});

test('3d · ninguna libre al tamaño de siempre ⇒ el menor ajuste que la libera (escalones, luego sin bajada)', () => {
  const s = style({ avoid_faces: { enabled: true, anchors: ['top_left', 'middle_left'] } });
  const full = M.overlayTextRect(s, W, H, null, 'bottom_left');
  // La cara toca SÓLO la parte alta del bloque declarado, y las otras anclas están tapadas por otra cara.
  const caraArriba = { x0: full.x0 / W, y0: (full.y0 - 200) / H, x1: (full.x0 + 100) / W, y1: (full.y0 + 25) / H };
  const tapaResto = { x0: 0, y0: 0, x1: 1, y1: (full.y0 - 220) / H };
  const ch = M.chooseOverlayAnchor({ style: s, width: W, height: H, faces: [caraArriba, tapaResto] });
  assert.equal(ch.report.overlap_pct, 0, 'queda libre');
  assert.ok(ch.report.reduced.length > 0, 'con un ajuste');
  assert.ok(ch.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_REDUCED_FOR_FACE')));
  assert.equal(s.slots.subheadline !== null, true, 'el estilo de entrada no se muta');
});

test('3e · 1.6.1 · sin ancla libre en ningún escalón ⇒ el menor solape entre ancla × escalón', () => {
  const s = style({ avoid_faces: { enabled: true, anchors: ['top_left'] } });
  const top = M.overlayTextRect(s, W, H, null, 'top_left');
  const soloTitular = { ...s, slots: { ...s.slots, subheadline: null } };
  const tit = M.overlayTextRect(soloTitular, W, H, null, 'top_left');
  // Una cara que cubre la bajada entera y roza la última línea del titular: con bajada tapa mucho; sin bajada, poco
  // pero no cero. Nada queda libre: debe elegirse «sin bajada», el menor solape.
  const cara = { x0: 0, y0: (tit.y1 - 8) / H, x1: 1, y1: (top.y1 + 5) / H };
  const abajo = { x0: 0, y0: (top.y1 + 80) / H, x1: 1, y1: 1 };   // la declarada (abajo) tampoco queda libre
  const r = M.chooseOverlayAnchor({ style: s, width: W, height: H, faces: [cara, abajo] });
  const base = r.report.candidates.find((c) => c.anchor === 'top_left').overlap_pct;
  assert.ok(r.report.overlap_pct > 0, 'no queda libre');
  assert.ok(r.report.overlap_pct < base, `el escalón baja el solape (${r.report.overlap_pct} < ${base})`);
  assert.deepEqual(r.report.reduced, ['sin bajada']);
  assert.equal(r.style.slots.subheadline, null);
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_FACE_OVERLAP_UNAVOIDABLE')));
});

test('7 · 1.6.1 · se pide el rostro (no la cabeza) y la respuesta conserva las cajas', () => {
  assert.match(SRC, /tightly around the FACE ONLY/);
  assert.match(SRC, /boxes: fc\.faces/);
  assert.match(SRC, /COMPOSITOR_VERSION = '1\.(6\.[1234]|7\.0|8\.0|9\.0|10\.0|11\.[01]|12\.0|13\.[01]|14\.0|15\.0|16\.0|17\.0|18\.0|19\.0)'/);
});

test('4 · la sombra llega al titular, a la bajada y a los tramos con énfasis; sin token, ninguna', () => {
  const te = style({ text_effect: { kind: 'shadow', color: 'oscuro', alpha: 0.35, blur_pct: 0.6, offset_pct: 0.15 } });
  const scene = JSON.stringify(M.buildOverlayScene({ style: te, width: W, height: H, backgroundSrc: 'data:,' }));
  const sh = M.overlayTextShadow(te.textEffect, W);
  assert.equal(sh, '0px 0px 4.61px rgba(0, 0, 0, 0.35), 0px 1.15px 4.61px rgba(0, 0, 0, 0.35)');
  assert.ok((scene.match(/"textShadow"/g) ?? []).length >= 3, 'titular, bajada y tramo con énfasis');
  const sin = JSON.stringify(M.buildOverlayScene({ style: style(), width: W, height: H, backgroundSrc: 'data:,' }));
  assert.equal(sin.includes('textShadow'), false);
});

test('5 · cajas del modelo: 0..1000 → 0..1; lo que no es caja se descarta', () => {
  assert.deepEqual(M.parseFaceBoxes('{"faces":[{"box_2d":[290,330,450,560]}]}'), [{ x0: 0.33, y0: 0.29, x1: 0.56, y1: 0.45 }]);
  assert.deepEqual(M.parseFaceBoxes('{"faces":[{"box_2d":[1,2,3]},{"box_2d":[500,500,400,600]},{"x":1}]}'), []);
  assert.deepEqual(M.parseFaceBoxes('no es json'), []);
  assert.deepEqual(M.parseFaceBoxes('{"faces":[]}'), []);
});

test('6 · compose.ts usa la misma autenticación y el mismo endpoint de Vertex que inspect.ts', () => {
  const block = (src, name) => { const b = `// ── ${name}:BEGIN ──`, e = `// ── ${name}:END ──`; return src.slice(src.indexOf(b), src.indexOf(e) + e.length); };
  for (const name of ['ENDPOINT-VERTEX', 'AUTH-VERTEX']) {
    assert.ok(SRC.includes(`// ── ${name}:BEGIN ──`), `${name} en compose.ts`);
    assert.equal(block(SRC, name), block(INSPECT, name), `${name} divergió de inspect.ts`);
  }
  assert.match(SRC, /if \(finalStyle\.layout\.avoidFaces && finalStyle\.slots\.headline\)/, 'la detección sólo corre con el token y titular');
  assert.match(SRC, /OVERLAY_FACE_CHECK_UNAVAILABLE/, 'un fallo de la detección no tumba la composición');
  assert.match(SRC, /\.\.\.\(faceMeta \? \{ faces: faceMeta \} : \{\}\)/, 'el consumo viaja en meta.faces');
});

test('8a · 1.6.2 · when/min_contrast son dato validado; sin `when` la sombra es la de siempre', () => {
  const fx = { kind: 'shadow', color: 'oscuro', alpha: 0.35, blur_pct: 0.6, offset_pct: 0.15 };
  assert.equal(style({ text_effect: fx }).textEffect.when, undefined, 'sin when ⇒ idéntico a 1.6.1');
  const low = style({ text_effect: { ...fx, when: 'low_contrast', min_contrast: 3 } }).textEffect;
  assert.equal(low.when, 'low_contrast'); assert.equal(low.minContrast, 3); assert.equal(low.shadowHex, '#000000');
  assert.throws(() => style({ text_effect: { ...fx, when: 'low_contrast' } }), /min_contrast/);
  assert.throws(() => style({ text_effect: { ...fx, when: 'low_contrast', min_contrast: 40 } }), /min_contrast/);
  assert.throws(() => style({ text_effect: { ...fx, when: 'a veces' } }), /text_effect\.when/);
  // La capa global no puede nombrar un rol que la marca N+1 quizá no tenga: admite un hex literal.
  const hx = style({ text_effect: { ...fx, color: '#1A1A1A', when: 'low_contrast', min_contrast: 3 } }).textEffect;
  assert.equal(hx.shadowHex, '#1A1A1A'); assert.equal(hx.color, 'rgba(26, 26, 26, 0.35)');
  assert.throws(() => style({ text_effect: { ...fx, color: 'rol_que_no_existe' } }), /rol_que_no_existe/);
});

test('8b · 1.6.2 · texto claro: fondo claro ⇒ sombra; fondo oscuro ⇒ sin sombra; texto oscuro ⇒ la sombra oscura no ayuda', () => {
  const L = (rgb) => M.relLuminanceRgb(rgb, rgb, rgb);
  const claro = Array(90).fill(L(40)).concat(Array(10).fill(L(235)));   // 10 % del área muy clara
  const oscuro = Array(100).fill(L(40));
  const base = { textHexes: ['#FAFAFA'], minContrast: 3, shadowHex: '#000000' };
  const a = M.decideTextEffect({ ...base, bgLuminances: claro });
  assert.equal(a.apply, true, a.reason); assert.ok(a.contrast < 3);
  const b = M.decideTextEffect({ ...base, bgLuminances: oscuro });
  assert.equal(b.apply, false, b.reason); assert.ok(b.contrast >= 3);
  const c = M.decideTextEffect({ ...base, textHexes: ['#101010'], bgLuminances: oscuro });
  assert.equal(c.apply, false, 'texto oscuro sobre fondo oscuro: una sombra oscura no ayuda');
  const d = M.decideTextEffect({ ...base, bgLuminances: [] });
  assert.equal(d.apply, true, 'sin muestras no se decide a ciegas: se aplica la sombra declarada');
  // La media no decide: con 90 % oscuro, la media daría contraste alto; el peor 10 % lo baja.
  const media = claro.reduce((x, y) => x + y, 0) / claro.length;
  assert.ok(M.contrastRatio(M.relLuminanceHex('#FAFAFA'), media) >= 3, 'la media habría dicho «se lee»');
  assert.equal(M.contrastRatio(1, 0), 21);
});

test('8d · 1.6.2 · la decisión lee los colores TAL COMO quedan en las ranuras (rgb(), no hex)', () => {
  const st = style({ text_effect: { kind: 'shadow', color: 'oscuro', alpha: 0.35, blur_pct: 0.6, offset_pct: 0.15, when: 'low_contrast', min_contrast: 3 } });
  const hexes = ['headline', 'subheadline'].flatMap((s) => st.slots[s] ? [st.slots[s].color, ...(st.slots[s].emphasis?.color ? [st.slots[s].emphasis.color] : [])] : []);
  assert.ok(hexes.length >= 2 && hexes.some((c) => /^rgb/.test(c)), 'las ranuras traen rgb()');
  const r = M.decideTextEffect({ textHexes: hexes, bgLuminances: Array(50).fill(M.relLuminanceRgb(235, 235, 235)), minContrast: 3, shadowHex: st.textEffect.shadowHex });
  assert.equal(r.apply, true, r.reason);
  assert.equal(M.relLuminanceHex('rgba(250, 250, 250, 0.5)'), M.relLuminanceHex('#FAFAFA'));
  assert.doesNotMatch(SRC, /filter\(\(c\) => \/\^#\?\[0-9a-fA-F\]/, 'el cableado no descarta los rgb()');
});

test('8c · 1.6.2 · cableado: se mide el bloque YA ubicado y la decisión viaja en meta.text_effect', () => {
  const i = SRC.indexOf("finalStyle.textEffect?.when === 'low_contrast'");
  assert.ok(i > SRC.indexOf('chooseOverlayAnchor({ style: finalStyle'), 'después de elegir el ancla');
  assert.ok(i < SRC.indexOf('const scene = buildOverlayScene({\n      style: finalStyle'), 'antes de dibujar');
  assert.match(SRC, /overlayTextRect\(finalStyle, dims\.width, dims\.height, areaMetrics, finalStyle\.layout\.anchor\)/);
  assert.match(SRC, /\.\.\.\(textEffectMeta \? \{ text_effect: textEffectMeta \} : \{\}\)/);
  assert.match(SRC, /OVERLAY_CONTRAST_UNMEASURED/);
  // Se mide lo que el texto tendrá DETRÁS (foto + velo), no la foto limpia: el velo ya cambia el contraste.
  assert.match(SRC, /buildOverlayScene\(\{ style: backgroundOnlyStyle\(finalStyle\)/);
  assert.match(SRC, /sampleRegionLuminance\(underBytes, rect/);
});

test('8e · 1.6.2 · el fondo sin texto conserva velo y franja y no dibuja ninguna ranura', () => {
  const st = style({ scrim: { mode: 'gradient_bottom', opacity: 0.8, palette: 'oscuro', coverage_pct: 60 } });
  const bg = M.backgroundOnlyStyle(st);
  assert.deepEqual(Object.values(bg.slots), Object.values(bg.slots).map(() => null));
  assert.equal(bg.scrim, st.scrim, 'el velo queda');
  assert.ok(st.slots.headline, 'el estilo original no se toca');
  const scene = JSON.stringify(M.buildOverlayScene({ style: bg, width: W, height: H, backgroundSrc: 'data:,' }));
  assert.ok(scene.includes('linear-gradient'), 'el velo se dibuja');
  assert.equal(scene.includes(TEXT.headline), false, 'sin titular');
});

test('9a · 1.6.3 · avoid_scene_text y emphasis_contrast son dato validado; ausentes no existen', () => {
  const base = style({ avoid_faces: { enabled: true } });
  assert.equal('avoidSceneText' in base.layout, false);
  assert.equal('emphasisContrast' in base.layout, false);
  const on = style({ avoid_faces: { enabled: true }, avoid_scene_text: { enabled: true, blur_pct: 0.6 }, emphasis_contrast: { min_contrast: 3, fallbacks: ['oscuro'] } });
  assert.deepEqual(on.layout.avoidSceneText, { marginPct: 1, blurPct: 0.6 });
  assert.deepEqual(on.layout.emphasisContrast, { minContrast: 3, fallbacks: [{ role: 'oscuro', hex: '#000000' }] });
  assert.throws(() => style({ avoid_scene_text: { enabled: true } }), /pide layout\.avoid_faces/);
  assert.throws(() => style({ avoid_faces: { enabled: true }, avoid_scene_text: { enabled: true, blur_pct: 9 } }), /blur_pct/);
  assert.throws(() => style({ emphasis_contrast: { min_contrast: 3, fallbacks: ['no_existe'] } }), /no_existe/);
  assert.throws(() => style({ emphasis_contrast: { min_contrast: 3 } }), /emphasis_contrast/);
  assert.equal('avoidSceneText' in style({ avoid_faces: { enabled: true }, avoid_scene_text: { enabled: false } }).layout, false);
});

test('9b · 1.6.3 · las caras deciden; entre anclas igual de libres gana la que no tapa el letrero', () => {
  const st = style({ avoid_faces: { enabled: true, margin_pct: 0, anchors: ['top_left', 'middle_left'] }, avoid_scene_text: { enabled: true, margin_pct: 0, blur_pct: 0.5 } });
  const rect = (a) => M.overlayTextRect(st, W, H, null, a);
  const r = rect('bottom_left');
  const sign = { x0: r.x0 / W, y0: r.y0 / H, x1: (r.x0 + 40) / W, y1: (r.y0 + 40) / H };   // letrero bajo el ancla declarada
  const out = M.chooseOverlayAnchor({ style: st, width: W, height: H, faces: [], signs: [sign] });
  assert.notEqual(out.style.layout.anchor, 'bottom_left', 'se movió por el letrero');
  assert.equal(out.report.sign_overlap_pct, 0);
  assert.ok(out.style.markers.some((m) => m.startsWith('OVERLAY_ANCHOR_MOVED_FOR_SIGN')));
  // Una cara manda: si la única ancla sin cara es la del letrero, se queda ahí y el letrero se informa para desenfocar.
  const faceTop = M.overlayTextRect(st, W, H, null, 'top_left'), faceMid = M.overlayTextRect(st, W, H, null, 'middle_left');
  const faces = [faceTop, faceMid].map((q) => ({ x0: q.x0 / W, y0: q.y0 / H, x1: q.x1 / W, y1: q.y1 / H }));
  const out2 = M.chooseOverlayAnchor({ style: st, width: W, height: H, faces, signs: [sign] });
  assert.equal(out2.style.layout.anchor, 'bottom_left');
  assert.ok(out2.report.sign_overlap_pct > 0);
  assert.equal(out2.report.signs_under_text.length, 1);
  // Sin el token, los letreros no cuentan: la elección es la de 1.6.2.
  const st0 = style({ avoid_faces: { enabled: true, margin_pct: 0 } });
  const out3 = M.chooseOverlayAnchor({ style: st0, width: W, height: H, faces: [], signs: [sign] });
  assert.equal(out3.style, st0, 'mismo objeto');
  assert.equal('signs' in out3.report, false);
});

test('9c · 1.6.3 · el énfasis cambia sólo si no se lee y la alternativa contrasta más', () => {
  const L = (v) => M.relLuminanceRgb(v, v + 20, Math.min(255, v + 60));
  const cielo = Array(100).fill(L(170));                       // cielo claro
  const azul = 'rgb(0, 149, 212)';                              // un azul medio de marca
  const fb = [{ role: 'marino', hex: '#003A70' }, { role: 'claro', hex: '#FAFAFA' }];
  const a = M.decideEmphasisColor({ currentColor: azul, fallbacks: fb, bgLuminances: cielo, minContrast: 3 });
  assert.equal(a.changed, true, a.reason); assert.equal(a.role, 'marino'); assert.ok(a.contrast_after > a.contrast_before);
  const noche = Array(100).fill(L(10));
  const b = M.decideEmphasisColor({ currentColor: azul, fallbacks: fb, bgLuminances: noche, minContrast: 3 });
  assert.equal(b.changed, false, 'sobre fondo oscuro el azul se lee');
  const c = M.decideEmphasisColor({ currentColor: azul, fallbacks: [{ role: 'igual', hex: '#0095D4' }], bgLuminances: cielo, minContrast: 3 });
  assert.equal(c.changed, false, 'una alternativa que no contrasta más no se usa');
  assert.equal(M.decideEmphasisColor({ currentColor: azul, fallbacks: fb, bgLuminances: [], minContrast: 3 }).changed, false);
  // La mediana decide, no el peor 10 %: mitad cielo claro, un 15 % de pelo oscuro. El marino gana aunque el pelo
  // lo castigue en su peor 10 %.
  const mezcla = Array(70).fill(L(170)).concat(Array(15).fill(L(120)), Array(15).fill(L(8)));
  const d = M.decideEmphasisColor({ currentColor: azul, fallbacks: fb, bgLuminances: mezcla, minContrast: 3 });
  assert.equal(d.changed, true, d.reason); assert.equal(d.role, 'marino');
  const st = style({ emphasis_contrast: { min_contrast: 3, fallbacks: ['oscuro'] } });
  const st2 = M.withEmphasisColor(st, 'rgb(0, 0, 0)');
  assert.equal(st2.slots.headline.emphasis.color, 'rgb(0, 0, 0)');
  assert.notEqual(st.slots.headline.emphasis.color, 'rgb(0, 0, 0)', 'no muta el original');
});

test('9e · 1.6.4 · con min_contrast_vs_text, la alternativa tiene que separarse del titular', () => {
  // El caso medido en 5b842958: titular crema, énfasis terracota sobre fondo oscuro (2,83 < 3).
  const oscuro = Array(100).fill(0.04);
  const crema = 'rgba(250, 250, 247, 1)', terracota = 'rgba(196, 98, 45, 1)';
  const fb = [{ role: 'terracota_claro', hex: '#F5E0D4' }, { role: 'lavanda', hex: '#EAD9F5' }, { role: 'violeta', hex: '#5C3472' }, { role: 'jade', hex: '#5FB49C' }];
  const sin = M.decideEmphasisColor({ currentColor: terracota, fallbacks: fb, bgLuminances: oscuro, minContrast: 3 });
  assert.equal(sin.role, 'terracota_claro', 'sin el token, idéntico a 1.6.3: gana el más claro');
  const con = M.decideEmphasisColor({ currentColor: terracota, fallbacks: fb, bgLuminances: oscuro, minContrast: 3, textColor: crema, minContrastVsText: 2 });
  assert.equal(con.changed, true, con.reason); assert.equal(con.role, 'jade');
  assert.ok(con.contrast_after >= 3);
  // Ninguna se separa: no cambia, y lo dice.
  const nada = M.decideEmphasisColor({ currentColor: terracota, fallbacks: fb.slice(0, 2), bgLuminances: oscuro, minContrast: 3, textColor: crema, minContrastVsText: 2 });
  assert.equal(nada.changed, false); assert.match(nada.reason, /se separe del titular/);
  // Token validado: fuera de rango es fail-loud; presente, viaja en el estilo.
  assert.throws(() => style({ emphasis_contrast: { min_contrast: 3, fallbacks: ['oscuro'], min_contrast_vs_text: 0 } }), /min_contrast_vs_text/);
  assert.equal(style({ emphasis_contrast: { min_contrast: 3, fallbacks: ['oscuro'], min_contrast_vs_text: 2 } }).layout.emphasisContrast.minContrastVsText, 2);
  assert.equal('minContrastVsText' in style({ emphasis_contrast: { min_contrast: 3, fallbacks: ['oscuro'] } }).layout.emphasisContrast, false);
  assert.match(SRC, /textColor: finalStyle\.slots\.headline!\.color, minContrastVsText: ec\.minContrastVsText/);
});

test('9d · 1.6.3 · cableado: una detección para caras y letreros, desenfoque antes de medir, énfasis antes que la sombra', () => {
  assert.match(SRC, /detectFaces\(cleanBytes, dims\.mime, \{ signs: wantSigns,/);
  assert.match(SRC, /FACES_PROMPT \+ \(opts\.signs \? SIGNS_PROMPT : ''\)/, 'sin el token, la petición es la de 1.6.2');
  const iBlur = SRC.indexOf('await blurRegions(cleanBytes, signsUnder');
  const iUnder = SRC.indexOf('backgroundSrc: bgSrc, products: productImgs');
  const iEm = SRC.indexOf('decideEmphasisColor({ currentColor');
  const iTe = SRC.indexOf('decideTextEffect({ textHexes');
  assert.ok(iBlur > 0 && iBlur < iUnder && iUnder < iEm && iEm < iTe, 'orden: desenfoque → fondo sin texto → énfasis → sombra');
  assert.match(SRC, /\.\.\.\(emphasisContrastMeta \? \{ emphasis_contrast: emphasisContrastMeta \} : \{\}\)/);
});

console.log(`\n${fails.length ? '✗' : '✓'} ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
