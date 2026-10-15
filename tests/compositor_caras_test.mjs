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

test('1 · candidatas por defecto: la declarada y su columna', () => {
  assert.deepEqual(M.faceAnchorCandidates('bottom_left'), ['bottom_left', 'top_left', 'middle_left']);
  assert.deepEqual(M.faceAnchorCandidates('top_center'), ['top_center', 'bottom_center', 'center']);
  assert.deepEqual(M.faceAnchorCandidates('middle_right'), ['middle_right', 'top_right', 'bottom_right']);
  assert.deepEqual(M.faceAnchorCandidates('nada'), []);
});

test('2 · los tokens son dato validado; ausentes o apagados no existen', () => {
  const base = style();
  assert.equal('avoidFaces' in base.layout, false);
  assert.equal('textEffect' in base, false);
  assert.equal('avoidFaces' in style({ avoid_faces: { enabled: false } }).layout, false);
  const on = style({ avoid_faces: { enabled: true } });
  assert.deepEqual(on.layout.avoidFaces, { anchors: ['bottom_left', 'top_left', 'middle_left'], marginPct: 2, keepAlign: false });
  assert.equal(style({ align: 'left', avoid_faces: { enabled: true, anchors: ['top_left'], margin_pct: 3 } }).layout.avoidFaces.keepAlign, true);
  assert.throws(() => style({ avoid_faces: { enabled: true, anchors: ['arriba'] } }), /COMPOSITOR_TOKENS_INCOMPLETE|avoid_faces\.anchors/);
  assert.throws(() => style({ avoid_faces: true }), /layout\.avoid_faces/);
  assert.throws(() => style({ avoid_faces: { enabled: true, margin_pct: 50 } }), /margin_pct/);
  const te = style({ text_effect: { kind: 'shadow', color: 'oscuro', alpha: 0.35, blur_pct: 0.6, offset_pct: 0.15 } });
  assert.deepEqual(te.textEffect, { color: 'rgba(0, 0, 0, 0.35)', blurPct: 0.6, offsetPct: 0.15 });
  assert.throws(() => style({ text_effect: { kind: 'shadow', color: 'no_existe', alpha: 0.3, blur_pct: 1, offset_pct: 0 } }), /no_existe/);
  assert.throws(() => style({ text_effect: { kind: 'shadow', color: 'oscuro', alpha: 0.3, blur_pct: 9, offset_pct: 0 } }), /layout\.text_effect/);
});

test('3a · una cara donde cae el texto ⇒ primera candidata libre', () => {
  const s = style({ avoid_faces: { enabled: true } });
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

test('3c · ninguna libre ⇒ la de menor solape, y se dice; el ancla del producto no es candidata', () => {
  const s = style({ avoid_faces: { enabled: true } });
  const ch = M.chooseOverlayAnchor({ style: s, width: W, height: H, faces: [{ x0: 0, y0: 0, x1: 1, y1: 1 }] });
  assert.ok(ch.report.overlap_pct > 0);
  assert.ok(ch.style.markers.some((m) => m.startsWith('OVERLAY_FACE_OVERLAP_UNAVOIDABLE')));
  const r = M.overlayTextRect(s, W, H, null, 'bottom_left');
  const face = { x0: r.x0 / W, y0: r.y0 / H, x1: (r.x0 + 120) / W, y1: (r.y0 + 120) / H };
  const p = M.chooseOverlayAnchor({ style: s, width: W, height: H, faces: [face], productAnchor: 'top_left' });
  assert.equal(p.report.anchor_used, 'middle_left');
});

test('3d · ninguna libre al tamaño de siempre ⇒ el menor ajuste que la libera (escalones, luego sin bajada)', () => {
  const s = style({ avoid_faces: { enabled: true } });
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

console.log(`\n${fails.length ? '✗' : '✓'} ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
