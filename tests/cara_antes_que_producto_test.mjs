// 1.23.0 — LA CARA ANTES QUE EL PRODUCTO. Test del bloque PURO, con las cajas medidas a mano sobre las piezas reales del
// 2026-10-22 (`fixtures/la_cara_manda_casos.mjs`) y con láminas de una marca inventada.
//
// EL CASO (medido): la pieza b24cdc5f salió publicada el 27-oct con el titular rozando el mentón y el cuello. Ninguna
// colocación libraba cara y envases a la vez, y la elección de siempre desempataba SUMANDO los dos solapes en el mismo
// porcentaje: con las cajas medidas, 1.22.0 la compone en `top_left` tapando 75,11 % de la cara. Sam, 2026-10-31: «sí» a
// cambiar la regla. Jerarquía: la cara es inviolable; el producto, sólo si se puede; el cuerpo, sólo para desempatar.
//
// QUÉ AFIRMA.
//   1. GOLDEN: donde una colocación libra cara y producto, o 1.22.0 ya libraba la cara, la salida es IDÉNTICA a 1.22.0
//      (overlay sin y con `avoid_people`, y 48 combinaciones de lámina). Sólo cambian los casos de empate imposible.
//   2. b24cdc5f (y las otras dos del mismo empate): la cara queda libre, el producto se tapa, se dice y `meta` lleva
//      `product_overlap_pct`.
//   3. Sin producto (en la escena o en la política): ni la regla, ni el marcador, ni el campo.
//   4. Si ninguna colocación libra la cara: lo de hoy, con su marcador.
//   5. LA INVARIANTE: nunca más cara que 1.22.0, en el overlay y en la lámina.
//   6. Los letreros (1.6.3) no devuelven el texto sobre la cara.
//   7. La lámina: el 'inset' sigue primero; la fila pedida, la banda y el caso sin último recurso libran la cara.
//   8. La función pura `pickFaceFreeLeastProduct`.
//   9. Cableado y versión. 10. Marca N+1 y voseo.
//
// Ejecutar:  node tests/cara_antes_que_producto_test.mjs     (Node ≥ 22.18)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { CASOS, GLOBAL_HOY, globalCon } from './fixtures/la_cara_manda_casos.mjs';
import { composeOverlay } from './fixtures/la_cara_manda_digest.mjs';
import { digestOverlayCara, digestLamina, COMBOS_LAMINA, ESCENAS, POLITICAS, laminaTokens, laminaChrome } from './fixtures/cara_antes_que_producto_casos.mjs';
import { formasVoseantes } from './idioma_voseo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'compose.ts'), 'utf8');
const BEGIN = '// ── COMPOSITOR:BEGIN ──', END = '// ── COMPOSITOR:END ──';
const dir = mkdtempSync(join(tmpdir(), 'cara-antes-que-producto-'));
writeFileSync(join(dir, 'block.mts'), SRC.slice(SRC.indexOf(BEGIN), SRC.indexOf(END) + END.length) + '\n', 'utf8');
const M = await import(pathToFileURL(join(dir, 'block.mts')).href);
const G = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'cara_antes_que_producto_golden.json'), 'utf8'))['1.22.0'];

let pass = 0; const fails = [];
const test = (n, f) => { try { f(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fails.push(n); console.log(`  ✗ ${n}\n    ${e.message}`); } };

const area = (r, b) => {
  const w = Math.min(r.x1, b.x1) - Math.max(r.x0, b.x0), h = Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
};
const px = (c, b, m = 0) => ({ x0: b.x0 * c.w - m, y0: b.y0 * c.h - m, x1: b.x1 * c.w + m, y1: b.y1 * c.h + m });
const rectOf = (c, st) => M.overlayTextRect(st, c.w, c.h, null, st.layout.anchor);
// El margen de la cara de la capa global (`avoid_faces.margin_pct: 2`): «librar la cara» es no tocarla CON su margen.
const margenCara = (c) => (2 / 100) * Math.min(c.w, c.h);
const CON = globalCon();
// Donde ninguna colocación libra cara y envases y 1.22.0 tocaba la cara (o su margen): las únicas que cambian.
//   m5 b24cdc5f — 1.22.0 tapaba 75,11 % de la cara (la pieza del 27-oct).
//   m8 fe9847d5 — tapaba 14,8 % de la cara.
//   m7 f0955319 — tocaba el margen de la cara, no la caja: el titular rozaba el mentón.
const CAMBIAN = new Set(['b24cdc5f', 'fe9847d5', 'f0955319']);

console.log('\n── 1 · golden: donde se puede, lo de 1.22.0 ──');
test('1a · overlay sin avoid_people: cada pieza que no es empate imposible compone EXACTAMENTE como 1.22.0', () => {
  let n = 0;
  for (const c of CASOS.filter((x) => !CAMBIAN.has(x.id))) { assert.deepEqual(digestOverlayCara(M, c, GLOBAL_HOY), G.overlay[c.id], `${c.tira} ${c.id}`); n++; }
  assert.equal(n, 8);
});
test('1b · overlay con avoid_people: ídem', () => {
  for (const c of CASOS.filter((x) => !CAMBIAN.has(x.id))) assert.deepEqual(digestOverlayCara(M, c, CON), G.overlay_avoid_people[c.id], `${c.tira} ${c.id}`);
});
test('1c · precondición: en las que cambian, 1.22.0 tocaba la cara y ninguna colocación libraba cara y producto', () => {
  for (const id of CAMBIAN) {
    const c = CASOS.find((x) => x.id === id);
    const g = G.overlay[id];
    assert.ok(g.face_covered_pct > 0 || id === 'f0955319', `${id}: ${g.face_covered_pct}`);
    const r = composeOverlay(M, c, GLOBAL_HOY);
    assert.ok(r.report.candidates.every((k) => k.overlap_pct > 0), `${id}: alguna ancla libraba todo`);
  }
});
test('1d · lámina: toda combinación cambia sólo si 1.22.0 tapaba la cara, y entonces la libra', () => {
  let iguales = 0, cambian = 0;
  for (const k of COMBOS_LAMINA) {
    const hoy = digestLamina(M, k.politica, k.escena, k.textPlace);
    const antes = G.lamina[k.key];
    if (antes.face_area_px === 0 || hoy.warnings.indexOf('CAROUSEL_PRODUCT_COVERED_TO_FREE_FACE') < 0) {
      assert.deepEqual(hoy, antes, k.key); iguales++;
    } else {
      assert.equal(hoy.face_area_px, 0, k.key); cambian++;
    }
  }
  assert.equal(iguales + cambian, 48);
  assert.deepEqual({ iguales, cambian }, { iguales: 38, cambian: 10 }, "medido el 2026-10-31 contra 1.22.0");
});

console.log('\n── 2 · b24cdc5f: la cara libre, el producto tapado, y se dice ──');
test('2a · b24cdc5f con las cajas medidas: el titular no toca la cara ni su margen; tapa los envases', () => {
  const c = CASOS.find((x) => x.id === 'b24cdc5f');
  for (const g of [GLOBAL_HOY, CON]) {
    const r = composeOverlay(M, c, g);
    const t = rectOf(c, r.style);
    assert.equal(area(t, px(c, c.face, margenCara(c))), 0, 'toca la cara');
    assert.ok(c.products.some((p) => area(t, px(c, p)) > 0), 'precondición: tapa los envases');
    assert.equal(r.style.layout.anchor, 'bottom_left');
    assert.equal(r.style.slots.headline.sizePct, 5.3);
    assert.equal(G.overlay[c.id].anchor, 'top_left', 'precondición: 1.22.0 iba arriba, sobre la cara');
    assert.equal(G.overlay[c.id].face_covered_pct, 75.11);
  }
});
test('2b · marcador nuevo y product_overlap_pct en meta; sin el marcador de cara tapada', () => {
  for (const id of CAMBIAN) {
    const c = CASOS.find((x) => x.id === id);
    const r = composeOverlay(M, c, GLOBAL_HOY);
    const m = r.style.markers.find((x) => x.startsWith('OVERLAY_PRODUCT_COVERED_TO_FREE_FACE'));
    assert.ok(m, id);
    assert.ok(m.includes('la cara manda') && m.includes(r.style.layout.anchor) && m.includes(`${r.report.product_overlap_pct} %`), m);
    assert.equal(r.style.markers.some((x) => x.startsWith('OVERLAY_FACE_OVERLAP_UNAVOIDABLE')), false, id);
    assert.ok(r.report.product_overlap_pct > 0, id);
    // product_overlap_pct = % de la caja del texto sobre los envases (con su margen de 1 %), medido aparte.
    const t = rectOf(c, r.style);
    const pm = (1 / 100) * Math.min(c.w, c.h);
    const inter = c.products.reduce((s, p) => s + area(t, px(c, p, pm)), 0);
    assert.equal(r.report.product_overlap_pct, Math.round((10000 * inter) / ((t.x1 - t.x0) * (t.y1 - t.y0))) / 100, id);
  }
});
test('2c · con avoid_people el cuerpo sigue sólo desempatando: el aviso del cuerpo nombra la regla nueva', () => {
  const c = CASOS.find((x) => x.id === 'b24cdc5f');
  const r = composeOverlay(M, c, CON);
  const m = r.style.markers.find((x) => x.startsWith('OVERLAY_BODY_UNAVOIDABLE'));
  assert.ok(m && m.includes('la elección de 1.23.0: la cara antes que el producto'), m);
  assert.ok(r.report.product_overlap_pct > 0 && r.report.body_overlap_pct > 0);
});

console.log('\n── 3 · sin producto ──');
test('3a · la escena sin envases: la regla no aplica; ni marcador ni campo', () => {
  for (const c0 of CASOS) {
    const c = { ...c0, products: [] };
    const r = composeOverlay(M, c, GLOBAL_HOY);
    assert.equal(r.style.markers.some((x) => x.startsWith('OVERLAY_PRODUCT_COVERED_TO_FREE_FACE')), false, c.id);
    assert.equal('product_overlap_pct' in r.report, false, c.id);
  }
});
test('3b · la marca sin avoid_products: los envases no cuentan, ni la regla; idéntico al estilo sin envases', () => {
  const { avoid_products: _p, ...layoutSin } = GLOBAL_HOY.layout;
  const SIN = { ...GLOBAL_HOY, layout: layoutSin };
  for (const c of CASOS) {
    const a = composeOverlay(M, c, SIN);
    const b = composeOverlay(M, { ...c, products: [] }, SIN);
    assert.deepEqual(a.scene, b.scene, c.id);
    assert.equal('product_overlap_pct' in a.report, false, c.id);
  }
});
test('3c · la lámina sin envases o sin la política de productos: idéntica a 1.22.0 en todas sus combinaciones', () => {
  let n = 0;
  for (const k of COMBOS_LAMINA.filter((x) => x.escena === 'sin_producto' || x.politica === 'sin_producto_en_la_politica')) {
    assert.deepEqual(digestLamina(M, k.politica, k.escena, k.textPlace), G.lamina[k.key], k.key); n++;
  }
  assert.equal(n, 21);
});

console.log('\n── 4 · si nada libra la cara, lo de hoy ──');
test('4a · overlay: la cara ocupa todo; la elección y el marcador de 1.22.0', () => {
  const c = { ...CASOS.find((x) => x.id === 'b24cdc5f'), face: { x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.98 } };
  const r = composeOverlay(M, c, GLOBAL_HOY);
  assert.ok(r.style.markers.some((x) => x.startsWith('OVERLAY_FACE_OVERLAP_UNAVOIDABLE')));
  assert.equal(r.style.markers.some((x) => x.startsWith('OVERLAY_PRODUCT_COVERED_TO_FREE_FACE')), false);
  assert.equal('product_overlap_pct' in r.report, false);
});
test('4b · lámina: la cara ocupa todo; el último recurso y el aviso de 1.22.0', () => {
  for (const k of COMBOS_LAMINA.filter((x) => x.escena === 'cara_toda')) {
    assert.deepEqual(digestLamina(M, k.politica, k.escena, k.textPlace), G.lamina[k.key], k.key);
  }
});

console.log('\n── 5 · la invariante: nunca más cara que 1.22.0 ──');
test('5a · overlay, sin y con avoid_people: la cara bajo el texto nunca crece', () => {
  for (const c of CASOS) {
    assert.ok(digestOverlayCara(M, c, GLOBAL_HOY).face_covered_pct <= G.overlay[c.id].face_covered_pct, c.id);
    assert.ok(digestOverlayCara(M, c, CON).face_covered_pct <= G.overlay_avoid_people[c.id].face_covered_pct, c.id);
  }
});
test('5b · lámina: la cara bajo el bloque nunca crece', () => {
  for (const k of COMBOS_LAMINA) assert.ok(digestLamina(M, k.politica, k.escena, k.textPlace).face_area_px <= G.lamina[k.key].face_area_px, k.key);
});
test('5c · ahora, ninguna pieza medida tapa la cara (con o sin avoid_people)', () => {
  for (const c of CASOS) for (const g of [GLOBAL_HOY, CON]) {
    assert.equal(area(rectOf(c, composeOverlay(M, c, g).style), px(c, c.face)), 0, `${c.tira} ${c.id}`);
  }
});

console.log('\n── 6 · los letreros no devuelven el texto a la cara ──');
test('6a · un letrero justo donde va el texto: se busca otra ancla que libre la cara, nunca una que la tape', () => {
  const c = CASOS.find((x) => x.id === 'b24cdc5f');
  // Sin letreros, el texto va a la colocación que libra la cara; el letrero se pone EXACTAMENTE ahí.
  const t = rectOf(c, composeOverlay(M, c, GLOBAL_HOY).style);
  const letrero = { x0: t.x0 / c.w, y0: t.y0 / c.h, x1: t.x1 / c.w, y1: t.y1 / c.h };
  const r = M.chooseOverlayAnchor({ style: composeStyleSinElegir(c), width: c.w, height: c.h, metrics: null,
    faces: [c.face], products: c.products, signs: [letrero], people: [] });
  assert.equal(area(rectOf(c, r.style), px(c, c.face, margenCara(c))), 0, `${r.style.layout.anchor} toca la cara`);
  assert.ok(r.style.markers.some((x) => x.startsWith('OVERLAY_PRODUCT_COVERED_TO_FREE_FACE')));
});

console.log('\n── 7 · la lámina ──');
const lam = (politica, escena, textPlace = null) => {
  const tok = laminaTokens(M, POLITICAS[politica]);
  return M.chooseCarouselPlacement({ chrome: laminaChrome(M, tok), faces: ESCENAS[escena].faces, products: ESCENAS[escena].products,
    avoid: M.resolveCarouselAvoid(tok), textPlace });
};
const blockFaceArea = (r, escena) => {
  const rect = M.carouselBlockRect(r.fit.chrome, null).rect;
  return ESCENAS[escena].faces.reduce((s, f) => s + area(rect, { x0: f.x0 * 1000, y0: f.y0 * 1250, x1: f.x1 * 1000, y1: f.y1 * 1250 }), 0);
};
test("7a · el 'inset' sigue primero: libra la cara Y el producto, idéntico a 1.22.0", () => {
  const r = lam('inset', 'cara_y_envase');
  assert.equal(r.report.fallback, 'inset');
  assert.deepEqual(digestLamina(M, 'inset', 'cara_y_envase', null), G.lamina['inset|cara_y_envase|auto']);
  assert.equal(r.warnings.some((w) => w.startsWith('CAROUSEL_PRODUCT_COVERED_TO_FREE_FACE')), false);
});
test('7b · sin último recurso: libra la cara, tapa el producto, se dice y meta lleva product_overlap_pct', () => {
  const r = lam('sin_recurso', 'cara_y_envase');
  assert.ok(G.lamina['sin_recurso|cara_y_envase|auto'].face_area_px > 0, 'precondición: 1.22.0 tapaba la cara');
  assert.equal(blockFaceArea(r, 'cara_y_envase'), 0);
  assert.deepEqual(r.warnings.map((w) => w.split(':')[0]), ['CAROUSEL_PRODUCT_COVERED_TO_FREE_FACE']);
  assert.ok(r.report.product_overlap_pct > 0);
  const cand = r.report.candidates.find((k) => k.placement === r.report.placement_used && k.column_pct === r.report.column_pct);
  if (r.report.headline_size_pct == null) assert.equal(r.report.product_overlap_pct, cand.product_overlap_pct);
});
test('7c · con banda: la banda va bajo la colocación que libra la cara', () => {
  const r = lam('banda', 'cara_y_envase');
  assert.equal(r.report.fallback, 'band');
  assert.equal(blockFaceArea(r, 'cara_y_envase'), 0);
  assert.ok(r.warnings.some((w) => w.startsWith('CAROUSEL_BAND_FOR_SUBJECT')) && r.warnings.some((w) => w.startsWith('CAROUSEL_PRODUCT_COVERED_TO_FREE_FACE')));
  assert.ok(r.report.product_overlap_pct > 0);
});
test('7d · con la fila pedida: dentro de esa fila, la columna que libra la cara; si ninguna, lo de 1.22.0', () => {
  const abajo = lam('sin_recurso', 'cara_y_envase', 'bottom');
  assert.ok(abajo.report.placement_used.startsWith('bottom'));
  assert.equal(blockFaceArea(abajo, 'cara_y_envase'), 0);
  assert.ok(abajo.warnings.some((w) => w.startsWith('CAROUSEL_TEXT_PLACE_COVERS')) && abajo.warnings.some((w) => w.startsWith('CAROUSEL_PRODUCT_COVERED_TO_FREE_FACE')));
  // Arriba, ninguna columna de esa fila libra la cara: lo de 1.22.0, sin el aviso nuevo.
  assert.deepEqual(digestLamina(M, 'sin_recurso', 'cara_y_envase', 'top'), G.lamina['sin_recurso|cara_y_envase|top']);
});

console.log('\n── 8 · la función pura ──');
test('8a · pickFaceFreeLeastProduct: la que libra la cara y menos producto tapa; a igualdad, la primera; si ninguna, null', () => {
  const cara = [{ x0: 0, y0: 0, x1: 10, y1: 10 }], prod = [{ x0: 20, y0: 0, x1: 40, y1: 10 }];
  const a = { id: 'a', rect: { x0: 5, y0: 0, x1: 15, y1: 10 } };   // toca la cara
  const b = { id: 'b', rect: { x0: 15, y0: 0, x1: 30, y1: 10 } };  // 100 px² de producto
  const c = { id: 'c', rect: { x0: 12, y0: 0, x1: 25, y1: 10 } };  // 50 px²
  const d = { id: 'd', rect: { x0: 11, y0: 0, x1: 25, y1: 10 } };  // 50 px², después
  assert.equal(M.pickFaceFreeLeastProduct([a, b, c, d], cara, prod).id, 'c');
  assert.equal(M.pickFaceFreeLeastProduct([a], cara, prod), null);
  assert.equal(M.pickFaceFreeLeastProduct([], cara, prod), null);
  assert.equal(M.rectOverlapArea({ x0: 0, y0: 0, x1: 10, y1: 10 }, [{ x0: 10, y0: 0, x1: 20, y1: 10 }]), 0, 'tocar el borde no es tapar');
});

console.log('\n── 9 · cableado y versión ──');
test('9a · el informe llega a meta en los dos caminos, y la versión es 1.23.0', () => {
  assert.match(SRC, /faceMeta = \{ \.\.\.faceMeta, \.\.\.\(ch\.report \?\? \{\}\) \};/);
  assert.match(SRC, /avoidMeta = pick\.report;/);
  assert.match(SRC, /COMPOSITOR_VERSION = '1\.(2[3-9]|[3-9]\d)\.\d+'/);
  assert.ok(SRC.includes('//   1.23.0 (2026-10-31) — LA CARA ANTES QUE EL PRODUCTO'));
});

console.log('\n── 10 · marca N+1 y voseo ──');
const bloqueNuevo = () => SRC.slice(SRC.indexOf('// ── 1.23.0 · LA CARA ANTES QUE EL PRODUCTO'), SRC.indexOf('/** Candidatas por defecto:'))
  + SRC.slice(SRC.indexOf('//   1.23.0 (2026-10-31)'), SRC.indexOf("export const COMPOSITOR_VERSION = '"));
test('10a · el bloque nuevo y su historia no nombran marcas, ciudades, personas ni clientes', () => {
  const b = bloqueNuevo();
  assert.ok(b.length > 2000);
  for (const w of ['LucienSael', 'Lucien', 'NeuroneSCF', 'Neurone', 'ForumPHs', 'Unrealville', 'Patricia', 'Miami', 'Panam', 'Broward', 'Florida']) {
    assert.equal(b.includes(w), false, `nombra «${w}»`);
  }
});
test('10b · ni el código nuevo, ni este test, ni sus casos, ni la captura vosean', () => {
  assert.deepEqual(formasVoseantes(bloqueNuevo()), [], 'compose.ts');
  for (const f of ['tests/cara_antes_que_producto_test.mjs', 'tests/fixtures/cara_antes_que_producto_casos.mjs', 'tests/_capturar_golden_cara_producto.mjs']) {
    assert.deepEqual(formasVoseantes(readFileSync(join(ROOT, f), 'utf8')), [], f);
  }
});

function composeStyleSinElegir(c) {
  // El estilo que llega a `chooseOverlayAnchor` en el handler (tokens → estilo → límite de área), con los letreros
  // encendidos en la capa global como en producción.
  return composeOverlayStyle(c, GLOBAL_HOY);
}
function composeOverlayStyle(c, g) {
  return composeOverlay({ ...M, chooseOverlayAnchor: (a) => ({ style: a.style, report: null }), avoidOrphanLines: null }, c, g).style;
}

console.log(`\n${pass} ok · ${fails.length} fallos`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
