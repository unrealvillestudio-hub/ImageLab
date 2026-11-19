// 2026-11-19 — VOLUMEN DEL PELO, MEDIDO. Test del bloque PURO `measureHairVolume` / `parseFacesMeasure` y del cableado
// del modo `faces`.
//
// QUÉ AFIRMA.
//   1. La medida sube cuando el pelo es más ancho o más alto, y no se mueve cuando no cambia.
//   2. La caja del detector sólo es punto de partida: moverla o escalarla ±15 % cambia la medida menos de un 3 %.
//   3. Los supuestos se comprueban y fallan con nombre: fondo oscuro, pelo claro, pelo cortado arriba, caja sin cara,
//      caja que no cuadra con la cara.
//   4. `measure` mal formado falla con 400 nombrado; ausente, la respuesta del modo `faces` es la de siempre.
//
// Las imágenes son SINTÉTICAS, dibujadas aquí: ninguna foto de una persona real entra en este repo. El eje no depende
// de ninguna persona ni de ninguna marca.
//
// Ejecutar:  node tests/volumen_del_pelo_test.mjs     (Node ≥ 22.18)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'compose.ts'), 'utf8');
const BEGIN = '// ── COMPOSITOR:BEGIN ──', END = '// ── COMPOSITOR:END ──';
const dir = mkdtempSync(join(tmpdir(), 'volumen-pelo-'));
const mod = join(dir, 'block.mts');
writeFileSync(mod, SRC.slice(SRC.indexOf(BEGIN), SRC.indexOf(END) + END.length) + '\n', 'utf8');
const M = await import(pathToFileURL(mod).href);

let pass = 0; const fails = [];
const test = (n, f) => { try { f(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fails.push(n); console.log(`  ✗ ${n}\n    ${e.message}`); } };

const SKIN = [224, 172, 140], HAIR = [40, 30, 25], LIGHT_HAIR = [230, 200, 140], BG = [235, 235, 235], DARK_BG = [20, 20, 25];

/** Un retrato sintético: fondo, pelo (elipse detrás) y cara (elipse con ojos y cejas oscuros encima). */
function portrait({ W = 600, H = 800, fw = 160, hairW = 300, hairTop = 50, hair = HAIR, bg = BG, cy = 360 } = {}) {
  const rgb = new Uint8Array(W * H * 3);
  const cx = W / 2, rx = fw / 2, ry = 0.65 * fw;
  const hTop = cy - ry - hairTop, hBot = cy + ry + 0.6 * fw;
  const hcy = (hTop + hBot) / 2, hry = (hBot - hTop) / 2, hrx = hairW / 2;
  const set = (x, y, c) => { const p = (y * W + x) * 3; rgb[p] = c[0]; rgb[p + 1] = c[1]; rgb[p + 2] = c[2]; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c = bg;
    // El pelo más ancho a la altura de las mejillas (lo que mide el carril), elipse vertical alrededor de la cara.
    if (((x - cx) / hrx) ** 2 + ((y - hcy) / hry) ** 2 <= 1) c = hair;
    if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) {
      c = SKIN;
      for (const ex of [-0.35, 0.35]) {
        if (((x - (cx + ex * fw)) / (0.12 * fw)) ** 2 + ((y - (cy - 0.15 * fw)) / (0.05 * fw)) ** 2 <= 1) c = HAIR; // ojo
        if (((x - (cx + ex * fw)) / (0.15 * fw)) ** 2 + ((y - (cy - 0.27 * fw)) / (0.025 * fw)) ** 2 <= 1) c = HAIR; // ceja
      }
    }
    set(x, y, c);
  }
  // La caja del detector: de las cejas al mentón, de oreja a oreja (0..1).
  const box = { x0: (cx - rx) / W, x1: (cx + rx) / W, y0: (cy - 0.3 * fw) / H, y1: (cy + ry) / H };
  return { rgb, W, H, box };
}
const measure = (p, box = p.box, thr) => M.measureHairVolume(p.rgb, p.W, p.H, box, thr);

const ref = measure(portrait());
test('0 · la referencia sintética es válida y mide algo razonable', () => {
  assert.equal(ref.valid, true, JSON.stringify(ref));
  assert.ok(ref.width_ratio > 1.5 && ref.width_ratio < 2.4, `width_ratio ${ref.width_ratio}`);
  assert.ok(ref.height_ratio > 0.2 && ref.height_ratio < 0.45, `height_ratio ${ref.height_ratio}`);
});

test('1a · pelo un 25 % más ancho ⇒ width_ratio sube más de un 15 %', () => {
  const m = measure(portrait({ hairW: 375 }));
  assert.equal(m.valid, true, JSON.stringify(m));
  assert.ok(m.width_ratio / ref.width_ratio - 1 > 0.15, `${m.width_ratio} vs ${ref.width_ratio}`);
});
test('1b · pelo un 50 % más alto ⇒ height_ratio sube más de un 30 %', () => {
  const m = measure(portrait({ hairTop: 75 }));
  assert.equal(m.valid, true, JSON.stringify(m));
  assert.ok(m.height_ratio / ref.height_ratio - 1 > 0.3, `${m.height_ratio} vs ${ref.height_ratio}`);
});
test('1c · misma persona y mismo pelo en otro tamaño de imagen ⇒ misma medida (±3 %)', () => {
  const m = measure(portrait({ W: 900, H: 1200, fw: 240, hairW: 450, hairTop: 75, cy: 540 }));
  assert.ok(Math.abs(m.width_ratio / ref.width_ratio - 1) < 0.03, `${m.width_ratio} vs ${ref.width_ratio}`);
  assert.ok(Math.abs(m.height_ratio / ref.height_ratio - 1) < 0.03, `${m.height_ratio} vs ${ref.height_ratio}`);
});

test('2 · la caja sólo es punto de partida: moverla o escalarla ±15 % cambia la medida menos de un 3 %', () => {
  const p = portrait();
  const b = p.box, w = b.x1 - b.x0, h = b.y1 - b.y0;
  const variants = [
    { ...b, x0: b.x0 + 0.15 * w, x1: b.x1 + 0.15 * w },
    { ...b, x0: b.x0 - 0.15 * w, x1: b.x1 - 0.15 * w },
    { x0: b.x0 - 0.075 * w, x1: b.x1 + 0.075 * w, y0: b.y0 - 0.075 * h, y1: b.y1 + 0.075 * h },
    { x0: b.x0 + 0.075 * w, x1: b.x1 - 0.075 * w, y0: b.y0 + 0.075 * h, y1: b.y1 - 0.075 * h },
    { ...b, y0: b.y0 + 0.1 * h, y1: b.y1 + 0.1 * h },
  ];
  for (const v of variants) {
    const m = measure(p, v);
    assert.equal(m.valid, true, JSON.stringify({ v, m }));
    assert.ok(Math.abs(m.width_ratio / ref.width_ratio - 1) < 0.03, `ancho ${m.width_ratio} vs ${ref.width_ratio} con ${JSON.stringify(v)}`);
    assert.ok(Math.abs(m.height_ratio / ref.height_ratio - 1) < 0.03, `alto ${m.height_ratio} vs ${ref.height_ratio} con ${JSON.stringify(v)}`);
  }
});
test('2b · PURO: los mismos píxeles y la misma caja dan exactamente la misma medida', () => {
  const p = portrait();
  assert.deepEqual(measure(p), measure(p));
});

test('3a · fondo oscuro ⇒ DARK_BACKGROUND, no válida', () => {
  const m = measure(portrait({ bg: DARK_BG }));
  assert.equal(m.valid, false); assert.ok(m.issues.includes('DARK_BACKGROUND'), JSON.stringify(m));
});
test('3b · pelo claro ⇒ HAIR_NOT_DARK, no válida', () => {
  const m = measure(portrait({ hair: LIGHT_HAIR }));
  assert.equal(m.valid, false); assert.ok(m.issues.includes('HAIR_NOT_DARK'), JSON.stringify(m));
});
test('3c · el pelo toca el borde superior ⇒ hair_top_clipped y height_ratio null; el ancho se sigue midiendo', () => {
  const m = measure(portrait({ cy: 180, hairTop: 120 }));
  assert.equal(m.hair_top_clipped, true); assert.equal(m.height_ratio, null);
  assert.ok(m.width_ratio > 1.5, JSON.stringify(m));
});
test('3d · una caja sobre el fondo ⇒ NO_FACE_SKIN', () => {
  const m = measure(portrait(), { x0: 0.02, x1: 0.1, y0: 0.02, y1: 0.1 });
  assert.equal(m.valid, false); assert.deepEqual(m.issues, ['NO_FACE_SKIN']);
});
test('3e · una caja casi del tamaño de la imagen ⇒ BOX_MISMATCH', () => {
  const p = portrait();
  const m = measure(p, { x0: 0.02, x1: 0.98, y0: p.box.y0, y1: p.box.y1 });
  assert.equal(m.valid, false); assert.ok(m.issues.includes('BOX_MISMATCH'), JSON.stringify(m));
});
test('3f · dark_threshold es dato: el mismo pelo claro se mide si quien llama sube el umbral', () => {
  const p = portrait({ hair: [120, 100, 80] });
  assert.ok(measure(p).issues.includes('HAIR_NOT_DARK'));
  assert.equal(measure(p, p.box, 140).valid, true);
});

test('4a · parseFacesMeasure: ausente ⇒ null; true ⇒ umbral por defecto; mal formado ⇒ 400 nombrado', () => {
  assert.equal(M.parseFacesMeasure(undefined), null);
  assert.deepEqual(M.parseFacesMeasure({ hair_volume: true }), { hairVolume: { darkThreshold: M.HAIR_DARK_DEFAULT } });
  assert.deepEqual(M.parseFacesMeasure({ hair_volume: { dark_threshold: 100 } }), { hairVolume: { darkThreshold: 100 } });
  for (const bad of ['x', [1], { otra: 1 }, { hair_volume: 'si' }, { hair_volume: { dark_threshold: 0 } }, { hair_volume: { dark_threshold: 'a' } }]) {
    assert.throws(() => M.parseFacesMeasure(bad), (e) => e.label === 'COMPOSITOR_MEASURE_INVALID' && e.status === 400, JSON.stringify(bad));
  }
});
test('4b · cableado: `measure` se valida antes de bajar la imagen, y sin él la respuesta lleva las cajas de siempre', () => {
  const i = SRC.indexOf("if (body.mode === 'faces')");
  const block = SRC.slice(i, SRC.indexOf('\n    return;\n  }', i));
  assert.ok(block.indexOf('parseFacesMeasure(body.measure)') < block.indexOf('fetchBytes('), 'measure se valida antes del fetch');
  assert.match(block, /let facesOut: Array<Record<string, unknown>> = facesForContract\(fc\.faces\);/);
  assert.match(block, /if \(measureIn\?\.hairVolume\)/);
  assert.match(block, /faces: facesOut,/);
});

console.log(`\n${pass} ok, ${fails.length} fallan`);
if (fails.length) process.exit(1);
