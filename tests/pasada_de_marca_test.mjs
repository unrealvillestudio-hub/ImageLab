// LA MARCA SE APLICA DESPUÉS DE GENERAR (2026-11-15) — la pasada de marca, sus motivos y su medida.
//
// Qué fija, sin red:
//   1. El plan: sin marca, nada; sin variante, MARK_NOT_AVAILABLE; dos personas con marca, MARK_MULTI_PERSONA;
//      entradas con y sin marca, MARK_UNDETERMINED; con todo, la variante por tono.
//   2. La medida (`changedPixelPct`): diferencia media de canal > 25, en porcentaje de píxeles.
//   3. El prompt de la edición: el probado, sin nombres de marca, con el ancho y el lugar del dato.
//   4. El handler real con PNG de verdad: edición al 0,3 % → se entrega la editada (`applied: true`); al 3 % →
//      un reintento → MARK_NOT_APPLIED y la imagen original; sin variante, la respuesta lo dice y no hay edición.
//   5. Sin marca en ninguna opción, la respuesta no trae `mark_pass` ni hay segunda llamada.
//   6. Regresión inyectada: si la medida no se mirara, el caso del 3 % entregaría la imagen editada.
//
// Marca y persona inventadas (otro rubro, otro país). El handler se carga DENTRO del repo para que `sharp`
// se resuelva, como en `lienzo_test`. Ejecutar: node tests/pasada_de_marca_test.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { run } from './_handler_harness.mjs';
import { DB, req } from './fixtures/personas_escenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');
const DIR = mkdtempSync(join(ROOT, '.marca-test-'));
process.on('exit', () => rmSync(DIR, { recursive: true, force: true }));
let seq = 0;
const STUB = 'class GoogleAuth { constructor(_o) {} async getClient() { return { getAccessToken: async () => ({ token: "t" }) }; } }';
async function cargar(texto) {
  const f = join(DIR, `execute-${seq++}.mts`);
  writeFileSync(f, texto.replace("import { GoogleAuth } from 'google-auth-library';", STUB), 'utf8');
  Object.assign(process.env, { GOOGLE_SERVICE_ACCOUNT_KEY: '{}', GOOGLE_CLOUD_PROJECT: 'proyecto-prueba', GOOGLE_CLOUD_LOCATION: 'us-central1',
    SUPABASE_URL: 'https://db.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'k' });
  return await import(pathToFileURL(f).href);
}
function bloques(src) {
  const block = (tag) => { const b = `// ── ${tag}:BEGIN ──`, e = `// ── ${tag}:END ──`; return src.slice(src.indexOf(b), src.indexOf(e) + e.length); };
  const fb = src.match(/const FALLBACK_NEGATIVE = '[^']*';/);
  const d = mkdtempSync(join(tmpdir(), 'marca-pb-'));
  const f = join(d, 'pb.mts');
  writeFileSync(f, `${fb[0]}\n\n${block('C')}\n\n${block('PB')}\n`, 'utf8');
  return import(pathToFileURL(f).href);
}
const M = await bloques(SRC);

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`  ✓ ${name}`); };
const capture = () => {
  const lines = []; const l = console.log, w = console.warn, e = console.error;
  console.log = console.warn = console.error = (...a) => lines.push(a.join(' '));
  return { lines, restore: () => { console.log = l; console.warn = w; console.error = e; } };
};

const LOGO_DARK = 'https://cdn.example.invalid/marks/logo_dark.png';
const LOGO_LIGHT = 'https://cdn.example.invalid/marks/logo_light.png';
const MARKS = { primary_logo: [{ for_tone: 'dark', image_url: LOGO_DARK, width_cm: 6 }, { for_tone: 'light', image_url: LOGO_LIGHT }] };
const choice = (mark, tone, outfit = 'a black polo shirt') => ({ when: 'at the shop', outfit, ...(mark ? { mark } : {}), ...(tone ? { garment_tone: tone } : {}) });

console.log('── 1 · el plan ──');
await ok('sin marca nada; sin variante, multi-persona e indeterminado dicen por qué; con todo, la variante por tono', () => {
  assert.deepEqual(M.markPlanFor([{ name: 'Ada', choices: [choice(null, null)] }], MARKS), { plan: null, status: null });
  assert.deepEqual(M.markPlanFor([{ name: 'Ada', choices: [choice('primary_logo', 'dark')] }], {}), { plan: null, status: 'MARK_NOT_AVAILABLE' });
  assert.deepEqual(M.markPlanFor([{ name: 'Ada', choices: [choice('otro', 'dark')] }], MARKS), { plan: null, status: 'MARK_NOT_AVAILABLE' });
  assert.equal(M.markPlanFor([{ name: 'Ada', choices: [choice('primary_logo', 'dark')] }, { name: 'Bo', choices: [choice('primary_logo', 'light')] }], MARKS).status, 'MARK_MULTI_PERSONA');
  assert.equal(M.markPlanFor([{ name: 'Ada', choices: [choice('primary_logo', 'dark'), { when: 'at home', outfit: 'a sweater' }] }], MARKS).status, 'MARK_UNDETERMINED');
  const { plan } = M.markPlanFor([{ name: 'Ada', choices: [choice('primary_logo', 'light', 'a white polo shirt')] }], MARKS);
  assert.deepEqual(plan, { persona: 'Ada', outfit: 'a white polo shirt', mark: 'primary_logo', garment_tone: 'light', variant: { for_tone: 'light', image_url: LOGO_LIGHT } });
  assert.deepEqual(M.markVariantsOf({ x: [{ for_tone: 'dark', image_url: 'ftp://no' }, { image_url: LOGO_DARK }] }, 'x'), [], 'variantes mal formadas se ignoran');
});

console.log('── 2 · la medida ──');
await ok('diferencia media de canal > 25, en % de píxeles', () => {
  const a = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const b = new Uint8Array([26, 26, 26, 25, 25, 25, 0, 0, 0, 90, 0, 0]);
  assert.equal(M.changedPixelPct(a, b, 3), 50);
  assert.throws(() => M.changedPixelPct(a, b.slice(3), 3), /MARK_DIFF_SIZE_MISMATCH/);
  assert.equal(M.MARK_DIFF_THRESHOLD, 25); assert.equal(M.MARK_DIFF_MAX_PCT, 1); assert.equal(M.MARK_MEASURE_WIDTH, 432);
});

console.log('── 3 · el prompt ──');
await ok('el probado, con el ancho y el lugar del dato y sin marcas', () => {
  const p = M.markEditPrompt({ persona: 'Ada', outfit: 'a black polo shirt', mark: 'primary_logo', garment_tone: 'dark', variant: { for_tone: 'dark', image_url: LOGO_DARK, width_cm: 6 } });
  assert.ok(p.includes("Embroider that logo onto Ada's a black polo shirt") && p.includes('about 6 cm wide') && p.includes(M.MARK_DEFAULT_PLACEMENT));
  assert.ok(p.includes('Change NOTHING else'));
  const q = M.markEditPrompt({ persona: 'Ada', outfit: 'a cap', mark: 'm', garment_tone: null, variant: { for_tone: 'x', image_url: LOGO_DARK, placement: 'on the front of the cap' } });
  assert.ok(q.includes('on the front of the cap') && q.includes('about 7 cm wide'));
});

// ── 4 · el handler con píxeles reales ────────────────────────────────────────────────────────────
async function png(w, h, patch = 0) {
  // Textura (no un color plano): una imagen lisa se mide como placa en los bordes y dispara su segundo intento.
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < px.length; i += 3) { const p = i / 3, x = p % w, y = Math.floor(p / w); px[i] = (x * 7 + y * 3) % 200 + 20; px[i + 1] = (x * 3 + y * 11) % 180 + 30; px[i + 2] = (x * 13 + y * 5) % 160 + 40; }
  let k = 0;
  for (let i = 0; i < px.length && k < patch; i += 3, k++) { px[i] = 250; px[i + 1] = 10; px[i + 2] = 10; }
  return (await sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()).toString('base64');
}
const W = 432, H = 540, TOTAL = W * H;
const BASE_IMG = await png(W, H);
const LOGO_PNG = (await sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());
const PERSONA = { name: 'Teodora Quispe', aliases: ['Teodora'], description: 'woman in her fifties', reference_image_urls: ['https://cdn.example.invalid/p/teo_1.png'],
  wardrobe: [{ when: 'at the shop', outfit: 'work clothes', options: [{ outfit: 'a black polo shirt', mark: 'primary_logo', garment_tone: 'dark' }] }] };

function interceptor(edits) {
  let llamadas = 0; let ultimo = null;
  const fn = async (u, init) => {
    if (u === LOGO_DARK || u === LOGO_LIGHT) return new Response(LOGO_PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    if (u.includes('gemini-2.5-flash-image:generateContent')) {
      const data = llamadas === 0 ? BASE_IMG : edits[Math.min(llamadas - 1, edits.length - 1)];
      llamadas++; ultimo = JSON.parse(init.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data } }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1290 } }), { status: 200 });
    }
    return undefined;
  };
  fn.count = () => llamadas;
  fn.ultimo = () => ultimo;
  return fn;
}
const H_OK = await png(W, H, Math.round(TOTAL * 0.003));
const H_MAL = await png(W, H, Math.round(TOTAL * 0.03));
const handler = (await cargar(SRC)).default;
const pedido = (extra = {}) => req({ copy_full: 'Teodora Quispe muestra el nivel.', title: 'Nivel', persona: PERSONA, marks: MARKS, ...extra });

console.log('── 4 · el handler ──');
await ok('edición al 0,3 %: se entrega la editada, con su intento y su consumo', async () => {
  const it = interceptor([H_OK]); const c = capture();
  let r; try { r = await run(handler, pedido(), { db: DB, intercept: it }); } finally { c.restore(); }
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  assert.equal(it.count(), 2, 'una generación y una edición');
  assert.equal(r.json.mark_pass.applied, true);
  assert.equal(r.json.mark_pass.attempts.length, 1);
  assert.ok(r.json.mark_pass.attempts[0].changed_pct <= 1 && r.json.mark_pass.attempts[0].usage);
  assert.ok(r.json.image_data_url.endsWith(H_OK));
  assert.match(it.ultimo().contents[0].parts.find((p) => p.text).text, /Embroider that logo onto Teodora Quispe's a black polo shirt/);
});
await ok('edición al 3 %: un reintento y MARK_NOT_APPLIED con la imagen original', async () => {
  const it = interceptor([H_MAL, H_MAL]); const c = capture();
  let r; try { r = await run(handler, pedido(), { db: DB, intercept: it }); } finally { c.restore(); }
  assert.equal(it.count(), 3, 'una generación y dos ediciones');
  assert.equal(r.json.mark_pass.applied, false); assert.equal(r.json.mark_pass.reason, 'MARK_NOT_APPLIED');
  assert.equal(r.json.mark_pass.attempts.length, 2);
  assert.ok(r.json.image_data_url.endsWith(BASE_IMG));
  assert.ok(c.lines.some((l) => l.includes('MARK_NOT_APPLIED')));
});
await ok('sin variante del logo: MARK_NOT_AVAILABLE y ninguna edición', async () => {
  const it = interceptor([H_OK]); const c = capture();
  let r; try { r = await run(handler, pedido({ marks: undefined }), { db: DB, intercept: it }); } finally { c.restore(); }
  assert.equal(it.count(), 1);
  assert.deepEqual(r.json.mark_pass, { applied: false, reason: 'MARK_NOT_AVAILABLE' });
});

await ok('lote: la pasada corre en «terminar» (la imagen llega del lote; sólo se paga la edición en línea)', async () => {
  const M2 = await cargar(SRC);
  const estado = { v: M2.LOTE_IMAGEN_VERSION, prompt: 'P', role_clause: '', negative_prompt: 'N', aspect_ratio: '4:5', image_urls: [], psycho_id: null,
    marca: { plan: { persona: 'Teodora Quispe', outfit: 'a black polo shirt', mark: 'primary_logo', garment_tone: 'dark', variant: MARKS.primary_logo[0] }, status: null },
    respuesta: { output: 'o', preset_used: false, preset_id: null, brand: 'x', canal: 'INSTAGRAM_FEED', model: 'm', prompt_full: 'P', prompt_builder_version: null,
      prompt_builder_model: null, prompt_builder_usage: null, generation_mode: 'regenerate_full', persona_used: true, location_used: null, location_refs: 0,
      product_composited: false, product_in_scene: null, product_left_scene: null, product_staging: null, product_refs: 0, reference_images: 0, personas: null, overlay: null } };
  const respuesta = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: BASE_IMG } }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1290 } };
  let edits = 0;
  const intercept = async (u) => {
    if (u === LOGO_DARK) return new Response(LOGO_PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    if (u.includes('gemini-2.5-flash-image:generateContent')) {
      edits++;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: H_OK } }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1290 } }), { status: 200 });
    }
    return undefined;
  };
  const c = capture();
  let r; try { r = await run(M2.default, { ...req({ title: 'x' }), lote: { modo: 'terminar', estado, respuesta } }, { db: DB, intercept }); } finally { c.restore(); }
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  assert.equal(edits, 1, 'sólo la edición se llama en línea');
  assert.equal(r.json.mark_pass.applied, true);
  assert.ok(r.json.image_data_url.endsWith(H_OK));
});

await ok('sin tiempo: ninguna edición, imagen sin logo y MARK_NOT_APPLIED por time_budget (la pieza no se pierde)', async () => {
  assert.equal(M.markPassAllowed(0), true); assert.equal(M.markPassAllowed(25_000), true);
  assert.equal(M.markPassAllowed(25_001), false); assert.equal(M.markPassAllowed(NaN), false);
  const sinTiempo = SRC.replace('export const MARK_START_MAX_ELAPSED_MS = 25_000;', 'export const MARK_START_MAX_ELAPSED_MS = -1;');
  assert.notEqual(sinTiempo, SRC);
  const h = (await cargar(sinTiempo)).default;
  const it = interceptor([H_OK]); const c = capture();
  let r; try { r = await run(h, pedido(), { db: DB, intercept: it }); } finally { c.restore(); }
  assert.equal(r.status, 200);
  assert.equal(it.count(), 1, 'sólo la generación');
  assert.equal(r.json.mark_pass.applied, false); assert.equal(r.json.mark_pass.error, 'time_budget');
  assert.ok(r.json.image_data_url.endsWith(BASE_IMG));
});

console.log('── 5 · sin marca ──');
await ok('sin opción con marca: ni mark_pass ni segunda llamada', async () => {
  const it = interceptor([H_OK]); const c = capture();
  let r; try { r = await run(handler, pedido({ persona: { ...PERSONA, wardrobe: [{ when: 'at the shop', outfit: 'work clothes', options: ['a denim shirt'] }] } }), { db: DB, intercept: it }); } finally { c.restore(); }
  assert.equal(it.count(), 1);
  assert.ok(!('mark_pass' in r.json) && !('wardrobe_choices' in r.json));
});

console.log('── 6 · regresión inyectada ──');
await ok('si la medida no se mirara, el 3 % se entregaría editado', async () => {
  const roto = SRC.replace('if (pct <= MARK_DIFF_MAX_PCT) {', 'if (true) {');
  assert.notEqual(roto, SRC, 'la inyección encontró su punto');
  const h = (await cargar(roto)).default;
  const it = interceptor([H_MAL]); const c = capture();
  let r; try { r = await run(h, pedido(), { db: DB, intercept: it }); } finally { c.restore(); }
  assert.equal(r.json.mark_pass.applied, true, 'el caso 4 se pondría en rojo');
});

await ok('multimarca: el bloque nuevo no nombra marcas reales', () => {
  const i = SRC.indexOf('// ── LA MARCA SE APLICA DESPUÉS DE GENERAR'), j = SRC.indexOf('/** Las opciones elegidas de una persona en esta imagen');
  const nuevo = SRC.slice(i, j).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(i > 0 && j > i && !/ForumPHs|NeuroneSCF|UnrealvilleStudio|SamPublisher|polo/i.test(nuevo));
});

console.log(`\npasada_de_marca: ${n} en verde`);
