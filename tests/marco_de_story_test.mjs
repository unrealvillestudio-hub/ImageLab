// EL MARCO DE STORY (1.25.0, 2026-11-21) — Sam: «las [imágenes] que no cubran el formato 9:16 de las stories se montan
// sobre un fondo de la marca que cubra el resto. Deberás diseñar al menos 5 modelos con el visual brand id de cada
// marca». Cinco modelos aprobados el mismo día: sólido, degradado, tarjeta, desenfoque y franjas.
//
// QUÉ AFIRMA, y la regla se rompe a propósito al final (CC_PROTOCOL §14.2):
//   1. El catálogo es dato y se valida con fail-loud acumulativo: un modelo a medias no se compone con huecos.
//   2. La elección es estable por pieza y rota por el catálogo; un modelo pedido que no existe es un 400.
//   3. Los colores son funciones de la paleta de la marca; una función que no resuelve falla. Ningún color en el código.
//   4. La imagen entra ENTERA (trae el titular), centrada, con su proporción; el logotipo tiene su sitio reservado.
//   5. EL LOGOTIPO NO SE PIERDE: sobre un fondo con el que no contrasta, pasa a la superficie y se dice.
//   6. El handler compone un PNG del lienzo de story sin red y sin proveedores, para una marca sintética (N+1).
//   7. Sabotaje: sin la regla del logotipo, la prueba 5 lo detecta.
//
// Ejecutar:  node tests/marco_de_story_test.mjs     (Node ≥ 22.18)

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'compose.ts'), 'utf8');
const DIR = mkdtempSync(join(ROOT, '.marco-story-test-'));
process.on('exit', () => rmSync(DIR, { recursive: true, force: true }));

let seq = 0;
async function loadBlock(src) {
  const i = src.indexOf('// ── COMPOSITOR:BEGIN ──');
  const j = src.indexOf('// ── COMPOSITOR:END ──');
  const f = join(DIR, `block${seq++}.mts`);
  writeFileSync(f, src.slice(i, j + '// ── COMPOSITOR:END ──'.length), 'utf8');
  return import(pathToFileURL(f).href);
}
const M = await loadBlock(SRC);

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message.split('\n')[0]}`); }
}

// Marca sintética (N+1): nombres de rol, colores y logotipo inventados; ninguno existe en el ecosistema.
const PAL = [{ role: 'fondo', hex: '#101418' }, { role: 'brasa', hex: '#C8502A' }, { role: 'hueso', hex: '#EEE8DD' }, { role: 'noche', hex: '#05070A' }];
const PALTOK = { surface: 'fondo', keyword: 'brasa', progress_on: 'brasa', shade: 'noche', text: 'hueso' };
const palBy = new Map(PAL.map((r) => [r.role, r]));
const CATALOGO = {
  canvas: { width: 1080, height: 1920 }, margin_pct: 7, logo_scale: 1.25, logo_min_contrast: 2.2, safe_zone_pct: { top: 13, bottom: 20 }, identity_canal: 'CAROUSEL',
  models: [
    { id: 'solido', kind: 'solid', background: 'surface', image_width_pct: 88, logo: 'below_image' },
    { id: 'degradado', kind: 'gradient', background: 'progress_on', background_to: 'surface', image_width_pct: 88, logo: 'below_image' },
    { id: 'tarjeta', kind: 'card', background: 'surface', accent: 'keyword', shadow: { fn: 'shade', alpha: 0.6 }, radius_pct: 3.5,
      rule_width_pct: 14, rule_height_pct: 0.35, image_width_pct: 82, logo: 'top' },
    { id: 'desenfoque', kind: 'blur', background: 'surface', veil: { fn: 'shade', alpha: 0.5 }, blur_pct: 5, image_width_pct: 92, logo: 'below_image' },
    { id: 'franjas', kind: 'bands', background: 'surface', accent: 'progress_on', band_pct: 12, image_width_pct: 100, logo: 'band_top' },
  ],
};
const label = (fn) => { try { fn(); return null; } catch (e) { return e.label ?? e.message; } };

console.log('── 1 · el catálogo es dato ──');
await test('1a · el catálogo completo se lee entero', () => {
  const t = M.resolveStoryFrameTokens({ story_frame: CATALOGO });
  assert.equal(t.models.length, 5);
  assert.deepEqual(t.canvas, { width: 1080, height: 1920 });
  assert.equal(t.identity_canal, 'CAROUSEL');
});
await test('1b · sin catálogo no hay marco, y un catálogo a medias dice TODO lo que falta', () => {
  assert.equal(label(() => M.resolveStoryFrameTokens({})), 'STORY_FRAME_NOT_DECLARED');
  const roto = structuredClone(CATALOGO);
  delete roto.logo_min_contrast;
  roto.safe_zone_pct = { top: 50, bottom: 40 };
  roto.models[1].background_to = '';
  roto.models[4].band_pct = 60;
  roto.models.push({ ...roto.models[0] });
  try { M.resolveStoryFrameTokens({ story_frame: roto }); assert.fail('debía fallar'); }
  catch (e) {
    assert.equal(e.label, 'STORY_FRAME_TOKENS_INCOMPLETE');
    for (const x of ['logo_min_contrast', 'safe_zone_pct', 'models[1].background_to', 'models[4].band_pct', "id='solido' repetido"]) assert.ok(e.message.includes(x), `falta «${x}»`);
  }
});
await test("1c · 'band_top' sólo en franjas y una clase desconocida no pasa", () => {
  const a = structuredClone(CATALOGO); a.models[0].logo = 'band_top';
  const b = structuredClone(CATALOGO); b.models[0].kind = 'collage';
  assert.equal(label(() => M.resolveStoryFrameTokens({ story_frame: a })), 'STORY_FRAME_TOKENS_INCOMPLETE');
  assert.equal(label(() => M.resolveStoryFrameTokens({ story_frame: b })), 'STORY_FRAME_TOKENS_INCOMPLETE');
});

console.log('── 2 · qué modelo lleva cada pieza ──');
const T = M.resolveStoryFrameTokens({ story_frame: CATALOGO });
await test('2a · pedido manda; desconocido es un 400', () => {
  assert.equal(M.pickStoryFrameModel(T.models, { model: 'tarjeta', seed: 'x' }).model.id, 'tarjeta');
  assert.equal(label(() => M.pickStoryFrameModel(T.models, { model: 'no-existe', seed: null })), 'STORY_FRAME_MODEL_UNKNOWN');
});
await test('2b · la misma pieza sale siempre igual y cien piezas pasan por los cinco modelos', () => {
  const a = M.pickStoryFrameModel(T.models, { model: null, seed: 'pieza-7' }).model.id;
  assert.equal(M.pickStoryFrameModel(T.models, { model: null, seed: 'pieza-7' }).model.id, a);
  const vistos = new Set();
  for (let k = 0; k < 100; k++) vistos.add(M.pickStoryFrameModel(T.models, { model: null, seed: `00000000-0000-0000-0000-${String(k).padStart(12, '0')}` }).model.id);
  assert.equal(vistos.size, 5);
});
await test('2c · la petición se valida antes de leer dato', () => {
  assert.deepEqual(M.parseStoryFrameRequest(undefined), { model: null, seed: null });
  assert.equal(label(() => M.parseStoryFrameRequest('franjas')), 'STORY_FRAME_BAD_REQUEST');
  assert.equal(label(() => M.parseStoryFrameRequest({ seed: 3 })), 'STORY_FRAME_BAD_REQUEST');
});

console.log('── 3 · los colores son de la marca ──');
await test('3a · cada ranura sale de una función de la paleta; una función que falta, falla', () => {
  const c = M.resolveStoryFrameColors(T.models[2], PALTOK, palBy);
  assert.equal(c.background, 'rgb(16, 20, 24)');
  assert.equal(c.accent, 'rgb(200, 80, 42)');
  assert.equal(c.shadow, 'rgba(5, 7, 10, 0.6)');
  assert.equal(label(() => M.resolveStoryFrameColors(T.models[1], { surface: 'fondo' }, palBy)), 'COMPOSITOR_TOKENS_INCOMPLETE');
});
await test('3b · el bloque del marco no escribe colores ni nombra marcas', () => {
  const ini = SRC.indexOf('// ── 1.25.0 · MARCO DE STORY');
  const bloque = SRC.slice(ini, SRC.indexOf('// ── COMPOSITOR:END ──'));
  assert.ok(ini > 0);
  assert.doesNotMatch(bloque, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(bloque, /rgba?\(\s*\d/);
  assert.doesNotMatch(bloque, /NeuroneSCF|UnrealvilleStudio|ForumPHs|LucienSael/i);
});

console.log('── 4 · la imagen entra entera ──');
const SZ = { top: 13 * 19.2, bottom: 1920 - 20 * 19.2 };
for (const [w, h] of [[1344, 768], [1080, 1350], [1024, 1024]]) {
  await test(`4 · ${w}×${h}: entera, con su proporción, centrada en ancho, imagen y logotipo dentro de las zonas seguras (salvo franjas)`, () => {
    for (const model of T.models) {
      const p = M.storyFramePlan({ model, canvas: T.canvas, marginPct: T.margin_pct, image: { width: w, height: h }, logoHeightPx: 120, safeZonePct: T.safe_zone_pct });
      const im = p.image;
      assert.ok(Math.abs(im.w / im.h - w / h) < 0.01, `${model.id}: proporción`);
      assert.ok(Math.abs(im.x + im.w / 2 - 540) < 0.5, `${model.id}: centrada en ancho`);
      const lg = p.logo;
      assert.ok(lg.y + lg.h <= im.y + 0.01 || lg.y >= im.y + im.h - 0.01, `${model.id}: el logotipo no pisa la imagen`);
      if (model.kind !== 'bands') {
        for (const [a, b, que] of [[im.y, im.y + im.h, 'imagen'], [lg.y, lg.y + lg.h, 'logotipo']]) {
          assert.ok(a >= SZ.top - 0.01 && b <= SZ.bottom + 0.01, `${model.id}: ${que} fuera de la zona segura (${a}..${b})`);
        }
      }
      if (model.logo === 'below_image') assert.ok(Math.abs(lg.y - (im.y + im.h + p.margin)) < 0.02, `${model.id}: el logotipo va justo debajo de la imagen`);
    }
  });
}

console.log('── 5 · el logotipo no se pierde ──');
const wordmark = (color) => ({ kind: 'wordmark', sizePct: 5, parts: [{ text: 'Nombre', color: 'rgb(238, 232, 221)', scale: 1 }, { text: 'Marca', color, scale: 1 }] });
const placeOf = (Mod, model, logo) => Mod.storyFrameLogoPlacement({ model, colors: Mod.resolveStoryFrameColors(model, PALTOK, palBy),
  ink: Mod.storyFrameWordmarkInk(logo), minContrast: T.logo_min_contrast, canvasHeight: 1920,
  centerY: (pl) => { const l = Mod.storyFramePlan({ model, canvas: T.canvas, marginPct: T.margin_pct, image: { width: 1080, height: 1080 }, logoHeightPx: 120, logoPlace: pl, safeZonePct: T.safe_zone_pct }).logo; return l.y + l.h / 2; } });
await test('5a · una parte del logotipo en el mismo acento que la franja: pasa bajo la franja y se dice', () => {
  const r = placeOf(M, T.models[4], wordmark('rgb(200, 80, 42)'));
  assert.equal(r.place, 'below_band');
  assert.equal(r.moved, true);
  assert.match(r.reason, /^STORY_FRAME_LOGO_MOVED/);
  const p = M.storyFramePlan({ model: T.models[4], canvas: T.canvas, marginPct: T.margin_pct, image: { width: 1080, height: 1350 }, logoHeightPx: 120, logoPlace: r.place });
  assert.ok(p.logo.y >= p.band, 'el logotipo queda fuera de la franja');
  assert.ok(p.logo.y + p.logo.h <= p.image.y + 0.01, 'y no pisa la imagen');
});
await test('5b · en un degradado que acaba en el acento, el color se mide a la altura del logotipo y el logotipo sube', () => {
  const alReves = { ...T.models[1], background: 'surface', background_to: 'progress_on', logo: 'bottom' };
  assert.equal(placeOf(M, alReves, wordmark('rgb(200, 80, 42)')).place, 'top');
  // El degradado del catálogo (acento arriba, oscuro abajo): bajo la imagen ya es casi la superficie y se queda.
  assert.equal(placeOf(M, T.models[1], wordmark('rgb(200, 80, 42)')).moved, false);
  assert.equal(M.storyFrameMixRgb('rgb(0, 0, 0)', 'rgb(200, 100, 50)', 0.5), 'rgb(100, 50, 25)');
});
await test('5c · un logotipo que se lee se queda donde pide el modelo; en el desenfoque no se mide', () => {
  const claro = { kind: 'wordmark', sizePct: 5, parts: [{ text: 'Marca', color: 'rgb(238, 232, 221)', scale: 1 }] };
  for (const m of T.models.filter((x) => x.kind !== 'bands')) assert.equal(placeOf(M, m, claro).moved, false, m.id);
  assert.equal(placeOf(M, T.models[3], wordmark('rgb(16, 20, 24)')).moved, false);
});

console.log('── 6 · el handler, marca N+1 ──');
await test('6a · compone un PNG de 1080×1920 sin red ni proveedores, con el modelo de la semilla', async () => {
  const f = join(DIR, 'compose_handler.mts');
  writeFileSync(f, SRC, 'utf8');
  process.env.SUPABASE_URL = 'https://db.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  const handler = (await import(pathToFileURL(f).href)).default;
  const rows = [
    { id: 'g', brand_id: null, canal: 'STORY_FRAME', active: true, tokens: { story_frame: CATALOGO } },
    { id: 'm', brand_id: 'MarcaN1', canal: 'CAROUSEL', active: true, tokens: { palette: PALTOK, carousel: { logo: { height_pct: 7 } } } },
  ];
  const fuera = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (!u.startsWith('https://db.example.invalid/rest/v1/')) { fuera.push(u); throw new Error(`red no permitida: ${u}`); }
    const table = u.slice(35).split('?')[0];
    const out = table === 'imagelab_overlay_tokens' ? rows : table === 'brand_palette' ? PAL : [];
    return new Response(JSON.stringify(out), { status: 200 });
  };
  try {
    const img = await sharp({ create: { width: 1344, height: 768, channels: 3, background: '#808890' } }).png().toBuffer();
    const out = await new Promise((resolve) => {
      const res = { setHeader() {}, status(c) { this.c = c; return this; }, json(j) { resolve({ status: this.c, json: j }); }, end() { resolve({ status: this.c }); } };
      handler({ method: 'POST', headers: {}, body: { mode: 'story_frame', brand_id: 'MarcaN1', image_data_url: `data:image/png;base64,${img.toString('base64')}`,
        story_frame: { seed: 'pieza-7' } } }, res);
    });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    assert.equal(out.json.compositor_version, '1.25.0');
    assert.equal(out.json.meta.story_frame.model, M.pickStoryFrameModel(T.models, { model: null, seed: 'pieza-7' }).model.id);
    assert.equal(out.json.meta.story_frame.chosen_by, 'seed');
    const meta = await sharp(Buffer.from(out.json.image_data_url.split(',')[1], 'base64')).metadata();
    assert.deepEqual([meta.width, meta.height], [1080, 1920]);
    assert.deepEqual(fuera, []);
  } finally { globalThis.fetch = real; }
});

console.log('── 7 · sabotaje ──');
await test('7 · sin la regla del logotipo, 5a la detecta', async () => {
  const roto = SRC.replace("  if (first.readable) return { place: model.logo, moved: false, reason: null };",
    "  if (true) return { place: model.logo, moved: false, reason: null };");
  assert.notEqual(roto, SRC, 'el sabotaje no encontró la línea');
  const S = await loadBlock(roto);
  assert.notEqual(placeOf(S, T.models[4], wordmark('rgb(200, 80, 42)')).place, 'below_band');
});

console.log(`\n${failed ? '✗' : '✓'} ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
