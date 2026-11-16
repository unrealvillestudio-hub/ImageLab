// BLOQUES A MANO (2026-11-16) — `blocks` en `POST /api/compose`: titular, bajada y rol colocados a mano.
//
// EL CASO. Contrato «Bloques de texto colocados a mano» v1 (Sam, 2026-11-16): cada bloque tiene X, Y y zoom de 0,7× a
// 1,3× dentro de la zona segura; el compositor respeta esos valores y avisa si el bloque tapa una cara. El rol en
// imágenes existe, desactivado por defecto.
//
// QUÉ AFIRMA:
//   1. Validación: `blocks` ausente ⇒ null; mal formado o fuera de rango ⇒ 400 `COMPOSITOR_BLOCK_PLACE_INVALID`. El
//      rango del zoom es el de `text_scale` (`TEXT_SCALE_MIN`/`TEXT_SCALE_MAX`).
//   2. Centro → caja: x/y son el centro del bloque dentro de la ZONA SEGURA (no del lienzo); la caja queda dentro.
//   3. Acotado: un centro que dejaría el bloque fuera se acota y se dice (`TEXT_PLACE_CLAMPED: <bloque>`).
//   4. Zoom: multiplica el tamaño del bloque.
//   5. Caras: con caras detectadas, el bloque a mano NO se mueve y avisa (`TEXT_PLACED_OVER_FACE: <bloque>`); sin
//      detección no se afirma nada. Un bloque que pisa otro avisa (`TEXT_PLACED_OVERLAP: <bloque>`).
//   6. Rol: desactivado por defecto; activado, tipografía y color de la bajada de la marca, chip del velo de la marca,
//      tercio inferior izquierdo de la zona segura y esquiva caras.
//   7. Sin `blocks`, nada cambia: la escena tiene la huella que tenía en `main` antes del cambio.
//   8. El cableado del handler: se valida antes de leer dato, carrusel ⇒ 400, la escena y `meta.blocks` sólo con
//      `blocks`, la capa de video lleva los mismos bloques.
//   9. Marca N+1: otra marca sintética, mismo comportamiento estructural.
//
// Ejecutar:  node tests/bloques_a_mano_test.mjs     (Node ≥ 22.18, sin red ni dependencias)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { TYPO, PAL, tokens, TEXT, escenas } from './fixtures/bloques_escenas.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'compose.ts'), 'utf8');
const BEGIN = '// ── COMPOSITOR:BEGIN ──', END = '// ── COMPOSITOR:END ──';
const dir = mkdtempSync(join(tmpdir(), 'bloques-a-mano-'));
const mod = join(dir, 'block.mts');
writeFileSync(mod, SRC.slice(SRC.indexOf(BEGIN), SRC.indexOf(END) + END.length) + '\n', 'utf8');
const M = await import(pathToFileURL(mod).href);

let pass = 0; const fails = [];
const test = (n, f) => { try { f(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fails.push(n); console.log(`  ✗ ${n}\n    ${e.message}`); } };
const invalid = (e) => e.label === 'COMPOSITOR_BLOCK_PLACE_INVALID' && e.status === 400;

const W = 1080, H = 1350;
const style = (layout, text = TEXT, extra) => M.resolveOverlayStyle({ tokens: tokens(layout, extra), typography: TYPO, palette: PAL, text });
const place = (x_pct, y_pct, zoom = 1) => ({ x_pct, y_pct, zoom });
// Coloca con el flujo del handler: separar, (el bloque automático tal cual) y colocar.
function colocar(blocksRaw, { layout = {}, text = TEXT, faces = null, extra } = {}) {
  const base = style(layout, text, extra);
  const blocks = M.parseBlocksRequest(blocksRaw);
  const split = M.splitBlocksStyle(base, blocks);
  const auto = split.auto;
  const autoRect = auto.slots.headline ? M.overlayTextRect(auto, W, H, null, auto.layout.anchor) : null;
  const roleSlot = M.roleRequested(blocks)
    ? M.roleSlotFrom(M.resolveOverlayStyle({ tokens: tokens(layout, extra), typography: TYPO, palette: PAL, text: { headline: '', subheadline: blocks.role.text } }))
    : null;
  const lay = M.layoutBlocks({ base, split, blocks, autoStyle: auto, autoRect, width: W, height: H, metrics: null, faces, roleSlot });
  return { base, blocks, split, auto, autoRect, lay };
}
const inside = (r, s) => r.x0 >= s.x0 - 0.01 && r.y0 >= s.y0 - 0.01 && r.x1 <= s.x1 + 0.01 && r.y1 <= s.y1 + 0.01;

console.log('bloques_a_mano — blocks en /api/compose');

// ── 1 · Validación ──────────────────────────────────────────────────────────────────────────────────────────────────
test('1a · ausente o null ⇒ null; bien formado ⇒ normalizado', () => {
  assert.equal(M.parseBlocksRequest(undefined), null);
  assert.equal(M.parseBlocksRequest(null), null);
  assert.deepEqual(M.parseBlocksRequest({}), { headline: null, subheadline: null, role: null });
  assert.deepEqual(M.parseBlocksRequest({ headline: { place: place(10, 20, 1.1) }, subheadline: {} }),
    { headline: { place: { x_pct: 10, y_pct: 20, zoom: 1.1 } }, subheadline: { place: null }, role: null });
  assert.deepEqual(M.parseBlocksRequest({ role: { enabled: true, text: '  Ana — Directora — Marca X  ' } }).role,
    { enabled: true, text: 'Ana — Directora — Marca X', place: null });
});

test('1b · el rango del zoom es el de text_scale (TEXT_SCALE_MIN..TEXT_SCALE_MAX, ambos incluidos)', () => {
  assert.equal(M.TEXT_SCALE_MIN, 0.7); assert.equal(M.TEXT_SCALE_MAX, 1.3);
  assert.equal(M.parseBlockPlace(place(0, 100, M.TEXT_SCALE_MIN), 'p').zoom, 0.7);
  assert.equal(M.parseBlockPlace(place(100, 0, M.TEXT_SCALE_MAX), 'p').zoom, 1.3);
  assert.match(SRC, /zoom: num\('zoom', TEXT_SCALE_MIN, TEXT_SCALE_MAX\)/, 'el zoom usa las constantes, no literales');
});

test('1c · mal formado o fuera de rango ⇒ 400 COMPOSITOR_BLOCK_PLACE_INVALID', () => {
  const malos = [
    'arriba', [], 7, { titulo: {} }, { headline: 'x' }, { headline: { place: place(10, 10), extra: 1 } },
    { headline: { place: { x_pct: 10, y_pct: 10 } } }, { headline: { place: { ...place(10, 10), w: 3 } } },
    { headline: { place: place(-1, 10) } }, { headline: { place: place(10, 100.5) } },
    { headline: { place: place(10, 10, 0.69) } }, { headline: { place: place(10, 10, 1.31) } },
    { headline: { place: { x_pct: '10', y_pct: 10, zoom: 1 } } }, { subheadline: { place: place(NaN, 10) } },
    { headline: { place: [10, 10, 1] } }, { role: 'Ana' }, { role: { enabled: 'sí', text: 'Ana' } },
    { role: { enabled: true } }, { role: { enabled: true, text: '   ' } }, { role: { enabled: true, text: 3 } },
    { role: { enabled: false, text: 'Ana', place: place(10, 10, 2) } }, { role: { enabled: true, text: 'Ana', color: 'rojo' } },
  ];
  for (const m of malos) assert.throws(() => M.parseBlocksRequest(m), invalid, JSON.stringify(m));
});

// ── 2 · Centro → caja dentro de la zona segura ───────────────────────────────────────────────────────────────────────
test('2a · la zona segura es la caja del texto (márgenes o zona segura de la plataforma), sobre la franja inferior', () => {
  const s = style({ safe_zone_pct: { top: 12, bottom: 18, left: 4, right: 4 } }, TEXT, { identity: undefined });
  const box = M.overlayTextBox(s, W, H);
  assert.deepEqual(M.blockSafeRect(s, W, H), { x0: box.left, y0: box.top, x1: W - box.right, y1: H - box.bottom });
  // Sin zona segura: el margen uniforme de la marca.
  const m = style({}, TEXT, { identity: undefined });
  const mb = M.overlayTextBox(m, W, H);
  assert.deepEqual(M.blockSafeRect(m, W, H), { x0: mb.left, y0: mb.top, x1: W - mb.right, y1: H - mb.bottom });
});

test('2b · x/y son el CENTRO del bloque en % de la zona segura, no del lienzo', () => {
  const safe = { x0: 100, y0: 200, x1: 900, y1: 1000 };
  const r = M.placeBlockRect(place(50, 50), { w: 200, h: 100 }, safe);
  assert.deepEqual(r, { rect: { x0: 400, y0: 550, x1: 600, y1: 650 }, clamped: false });
  const q = M.placeBlockRect(place(25, 75), { w: 200, h: 100 }, safe);
  assert.deepEqual(q.rect, { x0: 200, y0: 750, x1: 400, y1: 850 }, 'centro en (300, 800): 25 % y 75 % de la zona');
});

test('2c · en el flujo, el bloque a mano queda centrado en su punto y dentro de la zona segura', () => {
  const { lay, base } = colocar({ headline: { place: place(50, 40) } });
  const safe = M.blockSafeRect(base, W, H);
  const b = lay.scene.blocks[0];
  assert.ok(inside(b.rect, safe), JSON.stringify({ rect: b.rect, safe }));
  const cx = (b.rect.x0 + b.rect.x1) / 2, cy = (b.rect.y0 + b.rect.y1) / 2;
  assert.ok(Math.abs(cx - (safe.x0 + 0.5 * (safe.x1 - safe.x0))) < 0.02);
  assert.ok(Math.abs(cy - (safe.y0 + 0.4 * (safe.y1 - safe.y0))) < 0.02);
  assert.equal(lay.meta.headline.placed, 'manual');
  assert.equal(lay.meta.headline.clamped, false);
  assert.deepEqual(lay.meta.headline.rect, { x0: Math.round(b.rect.x0), y0: Math.round(b.rect.y0), x1: Math.round(b.rect.x1), y1: Math.round(b.rect.y1) });
  assert.ok(!lay.markers.some((m) => m.startsWith('TEXT_PLACE_CLAMPED')));
});

// ── 3 · Acotado ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('3 · un centro en el borde acota el bloque a la zona segura y lo dice', () => {
  const safe = { x0: 100, y0: 200, x1: 900, y1: 1000 };
  assert.deepEqual(M.placeBlockRect(place(0, 100), { w: 200, h: 100 }, safe), { rect: { x0: 100, y0: 900, x1: 300, y1: 1000 }, clamped: true });
  // Más grande que la zona: se pega al borde izquierdo/superior y cuenta como acotado.
  assert.deepEqual(M.placeBlockRect(place(50, 50), { w: 1000, h: 50 }, safe).rect.x0, 100);
  const { lay, base } = colocar({ headline: { place: place(100, 0) }, subheadline: { place: place(0, 100) } });
  const safeF = M.blockSafeRect(base, W, H);
  for (const b of lay.scene.blocks) assert.ok(inside(b.rect, safeF), JSON.stringify(b.rect));
  assert.ok(lay.markers.includes('TEXT_PLACE_CLAMPED: headline'));
  assert.ok(lay.markers.includes('TEXT_PLACE_CLAMPED: subheadline'));
  assert.equal(lay.meta.headline.clamped, true);
});

// ── 4 · Zoom ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('4 · el zoom multiplica el tamaño del bloque (tamaño y escalones)', () => {
  const uno = colocar({ headline: { place: place(50, 50, 1) } }).lay.scene.blocks[0];
  const gr = colocar({ headline: { place: place(50, 50, 1.3) } }).lay.scene.blocks[0];
  const ch = colocar({ headline: { place: place(50, 50, 0.7) } }).lay.scene.blocks[0];
  assert.equal(gr.style.slots.headline.sizePct, M.scaledSizePct(uno.style.slots.headline.sizePct, 1.3));
  assert.equal(ch.style.slots.headline.sizePct, M.scaledSizePct(uno.style.slots.headline.sizePct, 0.7));
  assert.deepEqual(gr.style.slots.headline.fitSmaller, uno.style.slots.headline.fitSmaller.map((v) => M.scaledSizePct(v, 1.3)));
  const h = (b) => b.rect.y1 - b.rect.y0;
  assert.ok(h(gr) > h(uno) && h(uno) > h(ch), `alto: ${h(ch)} < ${h(uno)} < ${h(gr)}`);
  assert.equal(M.zoomSlot(uno.style.slots.headline, 1), uno.style.slots.headline, 'zoom 1 ⇒ la MISMA ranura');
});

// ── 5 · Caras y solape ──────────────────────────────────────────────────────────────────────────────────────────────
test('5a · con caras detectadas, el bloque a mano no se mueve y avisa si tapa una', () => {
  const sin = colocar({ headline: { place: place(50, 50) } }, { layout: { avoid_faces: { enabled: true } } }).lay;
  const r = sin.scene.blocks[0].rect;
  const cara = { x0: (r.x0 + 10) / W, y0: (r.y0 + 5) / H, x1: (r.x0 + 60) / W, y1: (r.y0 + 40) / H };
  const con = colocar({ headline: { place: place(50, 50) } }, { layout: { avoid_faces: { enabled: true } }, faces: [cara] }).lay;
  assert.deepEqual(con.scene.blocks[0].rect, r, 'con place manda el operador: el bloque no esquiva');
  assert.ok(con.markers.includes('TEXT_PLACED_OVER_FACE: headline'));
  assert.equal(con.meta.headline.over_face, true);
  assert.equal(con.meta.faces_checked, true);
  // Una cara lejos: sin aviso.
  const lejos = colocar({ headline: { place: place(50, 50) } }, { layout: { avoid_faces: { enabled: true } }, faces: [{ x0: 0, y0: 0, x1: 0.02, y1: 0.02 }] }).lay;
  assert.ok(!lejos.markers.some((m) => m.startsWith('TEXT_PLACED_OVER_FACE')));
});

test('5b · sin detección (avoid_faces apagado) no se afirma nada sobre caras', () => {
  const { lay } = colocar({ headline: { place: place(50, 50) } });
  assert.equal(lay.meta.faces_checked, false);
  assert.equal(lay.meta.headline.over_face, false);
  assert.ok(!lay.markers.some((m) => m.startsWith('TEXT_PLACED_OVER_FACE')));
});

test('5c · un bloque que pisa otro bloque de texto avisa, y nunca es un error', () => {
  // La bajada sigue automática (abajo a la izquierda); el titular a mano, encima de ella.
  const pre = colocar({ headline: { place: place(50, 50) } });
  const a = pre.autoRect;
  const safe = M.blockSafeRect(pre.base, W, H);
  const xPct = (((a.x0 + a.x1) / 2) - safe.x0) / (safe.x1 - safe.x0) * 100;
  const yPct = (((a.y0 + a.y1) / 2) - safe.y0) / (safe.y1 - safe.y0) * 100;
  const { lay } = colocar({ headline: { place: place(Math.min(100, xPct), Math.min(100, yPct)) } });
  assert.ok(lay.markers.includes('TEXT_PLACED_OVERLAP: headline'), lay.markers.join(' | '));
  assert.equal(lay.meta.headline.overlap, true);
});

// ── Separación: qué va a mano y qué sigue automático ───────────────────────────────────────────────────────────────
test('S · el titular a mano deja la bajada sola en el bloque automático (sin filete); los dos a mano lo vacían', () => {
  const base = style({});
  const h = M.splitBlocksStyle(base, M.parseBlocksRequest({ headline: { place: place(50, 50) } }));
  assert.equal(h.auto.slots.headline, base.slots.subheadline, 'la bajada ocupa la ranura del titular del bloque automático');
  assert.equal(h.auto.slots.subheadline, null);
  assert.equal(h.auto.rule, null, 'el filete acompaña al titular');
  assert.deepEqual(h.manual.map((m) => [m.key, m.withRule]), [['headline', true]]);
  const s = M.splitBlocksStyle(base, M.parseBlocksRequest({ subheadline: { place: place(50, 50) } }));
  assert.equal(s.auto.slots.headline, base.slots.headline);
  assert.equal(s.auto.slots.subheadline, null);
  assert.equal(s.auto.rule, base.rule);
  const d = M.splitBlocksStyle(base, M.parseBlocksRequest({ headline: { place: place(20, 20) }, subheadline: { place: place(80, 80) } }));
  assert.equal(d.auto.slots.headline, null); assert.equal(d.auto.slots.subheadline, null);
  // Un place para una ranura que no se dibuja se ignora y se dice.
  const sinSub = M.splitBlocksStyle(style({}, { headline: TEXT.headline }), M.parseBlocksRequest({ subheadline: { place: place(50, 50) } }));
  assert.ok(sinSub.markers.includes('TEXT_PLACE_IGNORED: subheadline (la ranura no se dibuja: sin texto o no declarada por la marca)'));
  assert.equal(sinSub.manual.length, 0);
});

// ── 6 · Rol ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('6a · el rol está desactivado por defecto', () => {
  for (const raw of [{}, { role: { text: 'Ana — Directora' } }, { role: { enabled: false, text: 'Ana' } }]) {
    const b = M.parseBlocksRequest(raw);
    assert.equal(M.roleRequested(b), false, JSON.stringify(raw));
    const { lay } = colocar(raw);
    assert.equal(lay.scene.role, null);
    assert.deepEqual(lay.meta.role, { enabled: false });
  }
  assert.equal(M.roleRequested(null), false);
});

test('6b · activado: tipografía y color de la bajada, su escalón más chico, chip del velo; tercio inferior izquierdo', () => {
  const { lay, base } = colocar({ role: { enabled: true, text: 'Ana — Directora — Marca X' } });
  const r = lay.scene.role;
  assert.ok(r, 'hay placa');
  assert.equal(r.slot.family, base.slots.subheadline.family);
  assert.equal(r.slot.color, base.slots.subheadline.color);
  assert.equal(r.slot.sizePct, 2.6, 'el escalón más chico que la marca declara para la bajada');
  assert.equal(r.slot.text, 'Ana — Directora — Marca X');
  assert.equal(r.chip, M.hexToRgba(base.scrim.color, base.scrim.opacity), 'el chip es el velo de la marca');
  const safe = M.blockSafeRect(base, W, H);
  assert.equal(r.rect.x0, safe.x0);
  assert.ok(r.rect.y0 >= safe.y0 + (2 / 3) * (safe.y1 - safe.y0) - 0.01, 'en el tercio inferior');
  assert.equal(lay.meta.role.placed, 'auto');
  // Sin velo, sin chip.
  const sinVelo = colocar({ role: { enabled: true, text: 'Ana' } }, { layout: { scrim: undefined } }).lay;
  assert.equal(sinVelo.scene.role.chip, null);
});

test('6c · sin place esquiva las caras detectadas; con place manda el operador y avisa', () => {
  const lay0 = colocar({ role: { enabled: true, text: 'Ana — Directora' } }, { layout: { anchor: 'top_left', avoid_faces: { enabled: true } } }).lay;
  const r0 = lay0.scene.role.rect;
  const cara = { x0: r0.x0 / W, y0: r0.y0 / H, x1: (r0.x1 + 4) / W, y1: (r0.y1 + 4) / H };
  const lay = colocar({ role: { enabled: true, text: 'Ana — Directora' } }, { layout: { anchor: 'top_left', avoid_faces: { enabled: true } }, faces: [cara] }).lay;
  assert.notDeepEqual(lay.scene.role.rect, r0, 'se movió');
  assert.ok(!lay.markers.some((m) => m.startsWith('TEXT_PLACED_OVER_FACE')), lay.markers.join(' | '));
  const safe = M.blockSafeRect(colocar({}).base, W, H);
  const pctX = (((r0.x0 + r0.x1) / 2) - safe.x0) / (safe.x1 - safe.x0) * 100;
  const pctY = (((r0.y0 + r0.y1) / 2) - safe.y0) / (safe.y1 - safe.y0) * 100;
  const man = colocar({ role: { enabled: true, text: 'Ana — Directora', place: place(pctX, pctY) } },
    { layout: { anchor: 'top_left', avoid_faces: { enabled: true } }, faces: [cara] }).lay;
  assert.ok(man.markers.includes('TEXT_PLACED_OVER_FACE: role'));
  assert.equal(man.meta.role.placed, 'manual');
});

test('6d · rol con place: zoom sobre el escalón chico de la bajada', () => {
  const { lay } = colocar({ role: { enabled: true, text: 'Ana', place: place(50, 50, 1.3) } });
  assert.equal(lay.scene.role.slot.sizePct, M.scaledSizePct(2.6, 1.3));
  assert.equal(lay.meta.role.zoom, 1.3);
});

// ── 7 · Sin blocks nada cambia ──────────────────────────────────────────────────────────────────────────────────────
// Huella capturada con el bloque COMPOSITOR de `main` (63262cb, antes del cambio) sobre las mismas escenas.
const HUELLA_MAIN = 'af62688caa9df9f54d9e57bede9486f66fca5a26a805fd9ff45dc1f024562bc2';
test('7a · sin blocks, la escena es la de main: misma huella, nodo por nodo', () => {
  assert.equal(createHash('sha256').update(JSON.stringify(escenas(M))).digest('hex'), HUELLA_MAIN);
});

test('7b · sin blocks: split devuelve EL MISMO estilo; placed vacío o nulo no agrega nodos', () => {
  const s = style({});
  const sp = M.splitBlocksStyle(s, null);
  assert.equal(sp.auto, s); assert.equal(sp.manual.length, 0);
  const sp2 = M.splitBlocksStyle(s, M.parseBlocksRequest({ headline: {}, role: { enabled: false, text: '' } }));
  assert.equal(sp2.auto, s, 'blocks sin place ⇒ el mismo estilo');
  const a = JSON.stringify(M.buildOverlayScene({ style: s, width: W, height: H, backgroundSrc: 'x' }));
  assert.equal(JSON.stringify(M.buildOverlayScene({ style: s, width: W, height: H, backgroundSrc: 'x', placed: null })), a);
  assert.equal(JSON.stringify(M.buildOverlayScene({ style: s, width: W, height: H, backgroundSrc: 'x', placed: { blocks: [], role: null } })), a);
});

test('7c · con blocks, la escena suma un nodo absoluto por bloque en su caja; el automático ya no lo lleva', () => {
  const { lay, auto } = colocar({ headline: { place: place(50, 30) }, role: { enabled: true, text: 'Ana' } });
  const sc = M.buildOverlayScene({ style: auto, width: W, height: H, backgroundSrc: 'x', placed: lay.scene });
  const kids = sc.props.children;
  // Cada bloque a mano va en un contenedor del tamaño del lienzo, con su esquina en la caja (márgenes).
  const abs = kids.filter((k) => k.props?.style?.position === 'absolute' && k.props.children?.[0]?.props?.style?.marginLeft != null);
  assert.equal(abs.length, 2, 'titular a mano + rol');
  assert.deepEqual([abs[0].props.style.width, abs[0].props.style.height], [W, H]);
  assert.equal(abs[0].props.children[0].props.style.marginLeft, lay.scene.blocks[0].rect.x0);
  assert.equal(abs[0].props.children[0].props.style.marginTop, lay.scene.blocks[0].rect.y0);
  assert.equal(abs[1].props.children[0].props.style.backgroundColor, lay.scene.role.chip);
  const txt = JSON.stringify(sc);
  assert.equal(txt.split(TEXT.headline).length - 1, 1, 'el titular se dibuja una sola vez');
  assert.equal(txt.split(TEXT.subheadline).length - 1, 1, 'la bajada se dibuja una sola vez');
  // Los dos a mano: el bloque automático no emite contenedor y los bloques igual se dibujan.
  const d = colocar({ headline: { place: place(50, 20) }, subheadline: { place: place(50, 80) } });
  const sd = JSON.stringify(M.buildOverlayScene({ style: d.auto, width: W, height: H, backgroundSrc: 'x', placed: d.lay.scene }));
  assert.ok(sd.includes(TEXT.headline) && sd.includes(TEXT.subheadline));
});

test('7d · unionRect envuelve todo el texto dibujado (capa de video)', () => {
  assert.equal(M.unionRect([null, undefined]), null);
  assert.deepEqual(M.unionRect([{ x0: 10, y0: 20, x1: 30, y1: 40 }, null, { x0: 5, y0: 25, x1: 50, y1: 35 }]), { x0: 5, y0: 20, x1: 50, y1: 40 });
});

// ── 8 · Cableado del handler ────────────────────────────────────────────────────────────────────────────────────────
test('8 · handler: valida antes de leer dato; carrusel ⇒ 400; escena, capa y meta.blocks sólo con blocks', () => {
  const parse = SRC.indexOf('const blocksIn = parseBlocksRequest(body.blocks);');
  assert.ok(parse > 0 && parse < SRC.indexOf('const [tokenRows, typography, palette] = await Promise.all(['), 'se valida antes de leer dato');
  assert.match(SRC, /if \(blocksIn && carouselIn\) \{\s*throw new CompositorError\('COMPOSITOR_BLOCK_PLACE_INVALID'/);
  assert.equal((SRC.match(/\.\.\.\(blocksLay \? \{ placed: blocksLay\.scene \} : \{\}\),/g) ?? []).length, 2, 'la imagen y la capa de video llevan los mismos bloques');
  assert.match(SRC, /\.\.\.\(blocksLay \? \{ blocks: blocksLay\.meta \} : \{\}\),/);
  assert.match(SRC, /const blocksLay = blocksSplit \? layoutBlocks\(/);
  assert.match(SRC, /const oStyle = blocksSplit \? blocksSplit\.auto : columnApplied\.style;/);
  // La detección de caras de siempre sigue igual; la de los bloques es una rama aparte.
  assert.match(SRC, /if \(finalStyle\.layout\.avoidFaces && finalStyle\.slots\.headline\) wantFaceCheck = true;/);
  assert.match(SRC, /else if \(finalStyle\.layout\.avoidFaces && blocksWantFaces\) wantFaceCheck = true;/);
});

test('8b · el código no nombra marcas ni colores: el chip y la tipografía del rol salen de los tokens', () => {
  const ini = SRC.indexOf('// ── BLOQUES A MANO (2026-11-16)');
  const bloque = SRC.slice(ini, SRC.indexOf('// ── COMPOSITOR:END ──'));
  assert.ok(ini > 0);
  assert.doesNotMatch(bloque, /#[0-9a-fA-F]{3,6}\b/, 'sin hex en el código');
  assert.doesNotMatch(bloque, /rgba?\(\s*\d/, 'sin colores literales');
  assert.doesNotMatch(bloque, /NeuroneSCF|UnrealvilleStudio|ForumPHs/i);
});

// ── 9 · Marca N+1 ───────────────────────────────────────────────────────────────────────────────────────────────────
test('9 · otra marca sintética (otra tipografía, otra ancla, zona segura): mismo comportamiento estructural', () => {
  const TYPO2 = [{ role: 'display', font_family: 'Fuente Tres', css_import: 'https://example.invalid/t.css', fallback: null },
    { role: 'texto', font_family: 'Fuente Cuatro', css_import: 'https://example.invalid/c.css', fallback: null }];
  const PAL2 = [{ role: 'blanco', hex: '#F2F0EC' }, { role: 'negro', hex: '#080808' }];
  const tok2 = { layout: { anchor: 'top_right', margin_pct: 8, max_width_pct: 70, align: 'right', safe_zone_pct: { top: 14, bottom: 20, left: 5, right: 5 } },
    typography: { headline: { role: 'display', fit_steps: [{ max_chars: 400, size_pct: 8 }] }, subheadline: { role: 'texto', fit_steps: [{ max_chars: 400, size_pct: 3 }] } },
    palette: { headline: 'blanco', subheadline: 'blanco' } };
  const base = M.resolveOverlayStyle({ tokens: tok2, typography: TYPO2, palette: PAL2, text: TEXT });
  const blocks = M.parseBlocksRequest({ headline: { place: place(0, 0, 1.2) }, role: { enabled: true, text: 'Luis — Socio' } });
  const split = M.splitBlocksStyle(base, blocks);
  const roleSlot = M.roleSlotFrom(M.resolveOverlayStyle({ tokens: tok2, typography: TYPO2, palette: PAL2, text: { headline: '', subheadline: 'Luis — Socio' } }));
  const lay = M.layoutBlocks({ base, split, blocks, autoStyle: split.auto, autoRect: M.overlayTextRect(split.auto, W, H, null, split.auto.layout.anchor),
    width: W, height: H, metrics: null, faces: null, roleSlot });
  const safe = M.blockSafeRect(base, W, H);
  assert.equal(lay.scene.blocks[0].rect.x0, safe.x0); assert.equal(lay.scene.blocks[0].rect.y0, safe.y0);
  assert.ok(lay.markers.includes('TEXT_PLACE_CLAMPED: headline'));
  assert.equal(lay.scene.role.slot.family, 'Fuente Cuatro');
  assert.equal(lay.scene.role.chip, null, 'esta marca no declara velo: sin chip');
  assert.ok(inside(lay.scene.role.rect, safe));
});

console.log(`\n${fails.length ? '✗' : '✓'} ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
