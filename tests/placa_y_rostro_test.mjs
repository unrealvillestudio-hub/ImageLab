// LA PLACA DE BORDE Y EL ROSTRO DE LA PERSONA RECURRENTE (2026-10-10).
//
// Qué fija, sin red:
//   1. PLACA — `measureEdgePlate` (bloque PLACA): una placa lisa en un borde se detecta; un cielo o una
//      pared con grano NO (la desviación media dentro de la banda los separa); una banda por debajo del
//      umbral no cuenta; letterbox y pillarbox nombran sus lados. Sobre píxeles sintéticos y sobre un PNG
//      real decodificado con sharp, con las mismas llamadas que `edgePlateOfImage`.
//   2. PLACA — el reintento: sólo con tiempo, la corrección nombra el borde, y el handler genera como
//      mucho DOS veces; la respuesta sólo cambia cuando hubo placa.
//   3. ROSTRO — `personaFaceAnchorClause` / `faceAnchoredNames`: cada persona con fotos que viajan lleva
//      su ancla; la protagonista no (la suya ya lo dice); sin fotos, ninguna. En `engineClausesFor`, sin
//      `anchored` la lista es la de antes.
//   4. ROSTRO — el handler: la persona nombrada con fotos lleva el ancla en el prompt final; sin persona,
//      no; al editar, también.
//   5. Multimarca y voseo en lo nuevo.
//
// NO reimplementa la lógica: extrae los bloques `C`, `PB` y `PLACA` de `api/execute.ts` y carga el handler real.
//
// Ejecutar:  node tests/placa_y_rostro_test.mjs     (Node ≥ 22.18, type-stripping nativo)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { loadHandler, run } from './_handler_harness.mjs';
import { DB, PERSONAS, req } from './fixtures/personas_escenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');
function block(tag) {
  const b = `// ── ${tag}:BEGIN ──`, e = `// ── ${tag}:END ──`;
  const i = source.indexOf(b), j = source.indexOf(e);
  assert.ok(i >= 0 && j > i, `bloque ${tag} no encontrado`);
  return source.slice(i, j + e.length);
}
const fb = source.match(/const FALLBACK_NEGATIVE = '[^']*';/);
const dir = mkdtempSync(join(tmpdir(), 'placa-rostro-'));
const mod = join(dir, 'placa_rostro_block.mts');
writeFileSync(mod, `${fb[0]}\n\n${block('C')}\n\n${block('PB')}\n\n${block('PLACA')}\n`, 'utf8');
const M = await import(pathToFileURL(mod).href);

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`  ✓ ${name}`); };
const silence = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };

// ── Píxeles sintéticos: una «foto» con grano y bandas a pedido ──────────────────────────────────────
// Generador determinista (sin Math.random): el test da lo mismo en cada corrida.
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
/** RGB de w×h: escena con grano fuerte; `bands` pinta [lado, pct, luma, grano] encima. */
function image(w, h, bands = [], seed = 7) {
  const r = rng(seed);
  const px = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 60 + ((x * 7 + y * 3) % 120) + Math.floor(r() * 40);
    const p = (y * w + x) * 3; px[p] = v; px[p + 1] = v; px[p + 2] = v;
  }
  for (const [side, pct, luma, grain] of bands) {
    const nLines = Math.round(((side === 'top' || side === 'bottom') ? h : w) * pct / 100);
    for (let k = 0; k < nLines; k++) {
      const len = (side === 'top' || side === 'bottom') ? w : h;
      for (let t = 0; t < len; t++) {
        const x = side === 'left' ? k : side === 'right' ? w - 1 - k : t;
        const y = side === 'top' ? k : side === 'bottom' ? h - 1 - k : t;
        const v = Math.max(0, Math.min(255, Math.round(luma + (r() - 0.5) * 2 * grain)));
        const p = (y * w + x) * 3; px[p] = v; px[p + 1] = v; px[p + 2] = v;
      }
    }
  }
  return px;
}

// ── 1 · la medida ────────────────────────────────────────────────────────────────────────────────
console.log('── 1 · la placa se mide ──');
await ok('una escena con grano y sin bandas: sin placa', () => {
  assert.equal(M.measureEdgePlate(image(120, 200), 120, 200, 3), null);
});
await ok('placa lisa abajo (24 %): se detecta, sólo abajo, con su porcentaje', () => {
  const p = M.measureEdgePlate(image(120, 200, [['bottom', 24, 200, 0]]), 120, 200, 3);
  assert.deepEqual(p.sides, ['bottom']);
  assert.equal(p.pct.bottom, 24);
  assert.equal(M.edgePlateSize(p), 24);
});
await ok('letterbox (negro arriba y abajo) y pillarbox (gris a los lados) nombran sus lados', () => {
  assert.deepEqual(M.measureEdgePlate(image(120, 200, [['top', 15, 0, 0], ['bottom', 15, 0, 0]]), 120, 200, 3).sides, ['top', 'bottom']);
  assert.deepEqual(M.measureEdgePlate(image(200, 120, [['left', 10, 128, 0], ['right', 10, 128, 0]]), 200, 120, 3).sides, ['left', 'right']);
});
await ok('un cielo con grano (desviación por línea ~2–3) cuenta como banda pero NO como placa', () => {
  // La medida de las 103: los cielos tienen media ≥ 1,6; las placas ≤ 0,6.
  assert.equal(M.measureEdgePlate(image(120, 200, [['top', 25, 190, 5]]), 120, 200, 3), null);
});
await ok('una placa casi lisa (grano mínimo, como la compresión) sí cuenta', () => {
  const p = M.measureEdgePlate(image(120, 200, [['bottom', 20, 230, 1]]), 120, 200, 3);
  assert.deepEqual(p?.sides, ['bottom']);
});
await ok(`por debajo de ${'EDGE_PLATE_MIN_PCT'} (3 %) no es placa: un borde liso fino es parte de una foto`, () => {
  assert.equal(M.EDGE_PLATE_MIN_PCT, 5);
  assert.equal(M.measureEdgePlate(image(120, 200, [['bottom', 3, 255, 0]]), 120, 200, 3), null);
});
await ok('canales: gris (1), RGB (3) y RGBA (4) miden lo mismo; una entrada imposible lanza', () => {
  const w = 60, h = 100;
  const rgb = image(w, h, [['bottom', 30, 250, 0]]);
  const gray = new Uint8Array(w * h), rgba = new Uint8Array(w * h * 4);
  for (let k = 0; k < w * h; k++) { gray[k] = rgb[k * 3]; rgba.set([rgb[k * 3], rgb[k * 3 + 1], rgb[k * 3 + 2], 255], k * 4); }
  const a = M.measureEdgePlate(rgb, w, h, 3), b = M.measureEdgePlate(gray, w, h, 1), c = M.measureEdgePlate(rgba, w, h, 4);
  assert.deepEqual(a, b); assert.deepEqual(a, c);
  assert.throws(() => M.measureEdgePlate(new Uint8Array(10), w, h, 3), /EDGE_PLATE_INPUT/);
});
await ok('PNG REAL: sharp lo decodifica como en el handler y la medida es la misma que sobre los píxeles', async () => {
  const w = 96, h = 168;
  const px = image(w, h, [['bottom', 30, 235, 0]]);
  const png = await sharp(Buffer.from(px), { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const p = M.measureEdgePlate(new Uint8Array(data.buffer, data.byteOffset, data.length), info.width, info.height, info.channels);
  assert.deepEqual(p, M.measureEdgePlate(px, w, h, 3));
  assert.deepEqual(p.sides, ['bottom']);
  // El handler decodifica con esas mismas llamadas.
  assert.ok(source.includes("sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })"));
});

// ── 2 · el reintento ─────────────────────────────────────────────────────────────────────────────
console.log('── 2 · el reintento ──');
await ok('sólo con tiempo: hasta el tope sí, después no; un valor raro no reintenta', () => {
  assert.equal(M.edgePlateRetryAllowed(0), true);
  assert.equal(M.edgePlateRetryAllowed(M.EDGE_PLATE_RETRY_MAX_ELAPSED_MS), true);
  assert.equal(M.edgePlateRetryAllowed(M.EDGE_PLATE_RETRY_MAX_ELAPSED_MS + 1), false);
  assert.equal(M.edgePlateRetryAllowed(Number.NaN), false);
  assert.equal(M.edgePlateRetryAllowed(-1), false);
});
await ok('la corrección nombra el borde que salió liso', () => {
  const c = M.edgePlateRetryClause({ sides: ['top', 'bottom'], pct: { top: 15, bottom: 15, left: 0, right: 0 }, width: 1, height: 1 });
  assert.match(c, /along the top and bottom edge/);
  assert.match(c, /no empty strip reserved for text/);
});
await ok('edgePlateSize: 0 sin placa, la peor con placa', () => {
  assert.equal(M.edgePlateSize(null), 0);
  assert.equal(M.edgePlateSize({ sides: ['top', 'bottom'], pct: { top: 8, bottom: 15, left: 0, right: 0 }, width: 1, height: 1 }), 15);
});
await ok('el handler genera como mucho DOS veces y declara la placa sólo cuando la hubo', () => {
  const h = source.slice(source.indexOf('const generar = (correction'), source.indexOf('const plateTrace'));
  assert.equal((h.match(/await generar\(/g) ?? []).length, 2, 'una llamada inicial y un único reintento');
  assert.ok(h.includes('edgePlateRetryAllowed(elapsed)'), 'el reintento depende del tiempo gastado');
  assert.ok(source.includes('const plateTrace = medida1.plate ? { edge_plate: edgePlate, discarded_attempts: discardedAttempts } : {};'));
  assert.ok(source.includes('...plateTrace,'), 'la traza viaja en la respuesta');
});
await ok('una imagen que no se puede medir NO cambia la respuesta (arnés: «AAAA» no es un PNG)', async () => {
  const restore = silence();
  let r;
  try { r = await run(await loadHandler(), req({ copy_full: 'Cómo elegir una broca.', title: 'Brocas', persona: null }), { db: DB }); }
  finally { restore(); }
  assert.equal(r.status, 200);
  assert.ok(!('edge_plate' in r.json) && !('discarded_attempts' in r.json));
});

// ── 3 · el ancla de rostro (puro) ────────────────────────────────────────────────────────────────
console.log('── 3 · el ancla de rostro ──');
const { PERSONA_A, PERSONA_B } = PERSONAS;
const ANCLA = (name) => `${name} has the exact face of ${name}'s reference photos`;
await ok('la cláusula ancla la cara, la edad y la complexión, y las fotos mandan sobre la descripción', () => {
  const c = M.personaFaceAnchorClause('  Ada Nwosu ');
  assert.ok(c.startsWith(ANCLA('Ada Nwosu')));
  assert.match(c, /same apparent age/); assert.match(c, /same build/);
  assert.match(c, /Never a younger, slimmer or more generic-looking version of Ada Nwosu/);
  assert.match(c, /the photos decide$/);
});
await ok('faceAnchoredNames: con fotos que viajan sí; sin fotos no; la protagonista no', () => {
  const prota = { ...PERSONA_B, entry: 'scene_protagonist' };
  assert.deepEqual(M.faceAnchoredNames([PERSONA_A, prota], [['u1'], ['u2']]), [PERSONA_A.name]);
  assert.deepEqual(M.faceAnchoredNames([PERSONA_A, PERSONA_B], [[], ['u2']]), [PERSONA_B.name]);
  assert.deepEqual(M.faceAnchoredNames([], []), []);
});
await ok('engineClausesFor: sin `anchored`, la lista de antes; con él, el ancla tras la protagonista y antes de la mirada', () => {
  const base = { mode: 'regenerate_full', textZone: '', personaCount: 1, gaze: null, placement: '', productInScene: false, productComposited: false, angleSeed: 's' };
  const antes = M.engineClausesFor(base);
  assert.deepEqual(M.engineClausesFor({ ...base, anchored: null }), antes);
  assert.deepEqual(M.engineClausesFor({ ...base, anchored: [] }), antes);
  const con = M.engineClausesFor({ ...base, anchored: ['Ada Nwosu'] });
  assert.equal(con.length, antes.length + 1);
  const i = con.findIndex((c) => c.startsWith(ANCLA('Ada Nwosu')));
  assert.ok(i > 0 && con[i + 1] === antes[i], 'va justo antes de la cláusula que sigue (la mirada)');
  const edit = M.engineClausesFor({ ...base, mode: 'edit_from_current', anchored: ['Ada Nwosu'] });
  assert.ok(edit.some((c) => c.startsWith(ANCLA('Ada Nwosu'))), 'también al editar');
});

// ── 4 · el ancla en el handler ───────────────────────────────────────────────────────────────────
console.log('── 4 · el ancla en el prompt final ──');
const handler = await loadHandler();
const call = async (body) => { const restore = silence(); try { return await run(handler, body, { db: DB }); } finally { restore(); } };
const textoImagen = (r) => (r.vertexImage?.contents?.[0]?.parts ?? []).filter((p) => typeof p.text === 'string').map((p) => p.text).join(' ');
await ok('persona nombrada con fotos: el prompt final lleva su ancla', async () => {
  const r = await call(req({ copy_full: 'Teodora Quispe muestra cómo elegir una broca.', title: 'Brocas', persona: PERSONA_A }));
  assert.ok(textoImagen(r).includes(ANCLA(PERSONA_A.name)));
});
await ok('sin persona en la escena: ninguna ancla', async () => {
  const r = await call(req({ copy_full: 'Cómo elegir una broca.', title: 'Brocas', persona: PERSONA_A }));
  assert.ok(!textoImagen(r).includes('has the exact face of'));
});
await ok('protagonista: su cláusula, sin ancla duplicada', async () => {
  const r = await call(req({ copy_full: 'Cómo elegir una broca.', title: 'Brocas', persona: { ...PERSONA_A, entry: 'scene_protagonist' } }));
  const t = textoImagen(r);
  assert.ok(t.includes(`${PERSONA_A.name} is the protagonist of this brand's images`));
  assert.ok(!t.includes(ANCLA(PERSONA_A.name)));
});
await ok('al editar: la persona nombrada conserva el ancla', async () => {
  const r = await call(req({ copy_full: 'Teodora sonríe.', title: 'Sonrisa', persona: PERSONA_A, generation_mode: 'edit_from_current',
    source_image_url: 'https://cdn.example.invalid/actual.png', visual_directives: ['más luz'] }));
  assert.ok(textoImagen(r).includes(ANCLA(PERSONA_A.name)));
});

// ── 5 · multimarca y voseo ───────────────────────────────────────────────────────────────────────
console.log('── 5 · multimarca y voseo ──');
const nuevo = block('PLACA') + source.slice(source.indexOf('EL ROSTRO DE LA PERSONA RECURRENTE'), source.indexOf('/** ¿Entra la persona en la escena?'));
assert.ok(nuevo.length > 2000, 'el tramo nuevo se extrajo');
await ok('lo nuevo no nombra marcas, personas ni canales', () => {
  for (const lit of ['Neurone', 'NeuroneSCF', 'Patricia', 'Lucien', 'ForumPHs', 'Unrealville', 'INSTAGRAM', 'BLOG_']) {
    assert.ok(!nuevo.includes(lit), `literal de instancia en lo nuevo: ${lit}`);
  }
});
await ok('lo nuevo no usa formas voseantes', () => {
  assert.ok(!/\b(decidí|tenés|podés|querés|hacé|mirá|fijate|usá|poné|sabés)\b/i.test(nuevo));
});

console.log(`\n${n} ok · 0 fail`);
