// LA MARCA SE APLICA DESPUÉS DE GENERAR (2026-11-15) — la pasada de marca, sus motivos y su medida.
//
// Qué fija, sin red:
//   1. El plan: sin marca, nada; sin variante, MARK_NOT_AVAILABLE; dos personas con marca, MARK_MULTI_PERSONA;
//      entradas con y sin marca, MARK_UNDETERMINED; con todo, la variante por tono.
//   2. La medida (`changedPixelPct`): diferencia media de canal > 25, en porcentaje de píxeles.
//   3. El prompt de la edición: el probado, sin nombres de marca, con el ancho y el lugar del dato.
//   4. DIFERIDA (2026-11-16): la imagen sale lisa con `MARK_DEFERRED` y el plan; `mode: 'mark_pass'` edita después.
//   4b. LA CARA NO SE TOCA: de la edición sólo se pega la caja del logo sobre la ORIGINAL; un cambio sutil en la cara
//      (por debajo del umbral) no llega a la entrega; un cambio grande fuera del logo se rechaza (MARK_REJECTED_SPREAD);
//      sin cambio, MARK_NOT_VISIBLE; cada intento se asienta en el libro y no se asienta una imagen generada.
//   4c. La prenda que se escribió (`wornChoicesIn`): con el prompt final, una persona con marca en varias entradas deja
//      de ser MARK_UNDETERMINED (medido en la prueba §6 del cableado, 2026-11-16).
//   5. Sin marca en ninguna opción, la respuesta no trae `mark_pass` ni hay segunda llamada.
//   6. Regresiones inyectadas: si se entregara la edición entera, la cara cambiaría; si no se mirara la zona, el
//      caso disperso se aplicaría.
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

// ── 4 · píxeles reales ───────────────────────────────────────────────────────────────────────────
const W = 432, H = 540, TOTAL = W * H;
function textura() {
  // Textura (no un color plano): una imagen lisa se mide como placa en los bordes y dispara su segundo intento.
  const px = Buffer.alloc(W * H * 3);
  for (let i = 0; i < px.length; i += 3) { const p = i / 3, x = p % W, y = Math.floor(p / W); px[i] = (x * 7 + y * 3) % 200 + 20; px[i + 1] = (x * 3 + y * 11) % 180 + 30; px[i + 2] = (x * 13 + y * 5) % 160 + 40; }
  return px;
}
const rect = (px, x0, y0, w, h, f) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * W + x) * 3; f(px, i); } };
const LOGO_R = [270, 300, 30, 14];               // el «logo»: a la derecha de la imagen, a la altura del pecho
const CARA_R = [180, 80, 70, 90];                // la «cara»: arriba al centro
const rojo = (px, i) => { px[i] = 250; px[i + 1] = 10; px[i + 2] = 10; };
const sutil = (px, i) => { px[i] = Math.min(255, px[i] + 18); };   // por debajo del umbral (25): no se mide como cambio
const fuerte = (px, i) => { px[i] = 255 - px[i]; px[i + 1] = 255 - px[i + 1]; };
const aPng = async (px) => (await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()).toString('base64');
const BASE_PX = textura();
const BASE_IMG = await aPng(BASE_PX);
const conLogo = (extra) => { const px = Buffer.from(BASE_PX); rect(px, ...LOGO_R, rojo); if (extra) extra(px); return px; };
const H_OK = await aPng(conLogo());
const H_CARA = await aPng(conLogo((px) => rect(px, ...CARA_R, sutil)));
const H_DISPERSA = await aPng(conLogo((px) => rect(px, 20, 440, 60, 40, fuerte)));    // ~2,1 % fuera del logo
const LOGO_PNG = (await sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());
const PERSONA = { name: 'Teodora Quispe', aliases: ['Teodora'], description: 'woman in her fifties', reference_image_urls: ['https://cdn.example.invalid/p/teo_1.png'],
  wardrobe: [{ when: 'at the shop', outfit: 'work clothes', options: [{ outfit: 'a black polo shirt', mark: 'primary_logo', garment_tone: 'dark' }] }] };
const PLAN = { persona: 'Teodora Quispe', outfit: 'a black polo shirt', mark: 'primary_logo', garment_tone: 'dark', variant: MARKS.primary_logo[0] };

function interceptor(edits, primera = BASE_IMG) {
  let llamadas = 0; let ultimo = null;
  const fn = async (u, init) => {
    if (u === LOGO_DARK || u === LOGO_LIGHT) return new Response(LOGO_PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    if (u.includes('gemini-2.5-flash-image:generateContent')) {
      const data = primera ? (llamadas === 0 ? primera : edits[Math.min(llamadas - 1, edits.length - 1)]) : edits[Math.min(llamadas, edits.length - 1)];
      llamadas++; ultimo = JSON.parse(init.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data } }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1290 } }), { status: 200 });
    }
    return undefined;
  };
  fn.count = () => llamadas;
  fn.ultimo = () => ultimo;
  return fn;
}
const handler = (await cargar(SRC)).default;
const pedido = (extra = {}) => req({ copy_full: 'Teodora Quispe muestra el nivel.', title: 'Nivel', persona: PERSONA, marks: MARKS, ...extra });
const pasada = (extra = {}) => ({ mode: 'mark_pass', brandId: 'marca-prueba', image_url: `data:image/png;base64,${BASE_IMG}`, plan: PLAN, aspect_ratio: '4:5', ...extra });
const rawDe = async (dataUrl) => sharp(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')).removeAlpha().raw().toBuffer();
const igualEn = (a, b, [x0, y0, w, h]) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * W + x) * 3; if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) return false; } return true; };

console.log('── 4 · diferida ──');
await ok('la imagen sale lisa: una sola llamada, MARK_DEFERRED con el plan y la proporción', async () => {
  const it = interceptor([H_OK]); const c = capture();
  let r; try { r = await run(handler, pedido(), { db: DB, intercept: it }); } finally { c.restore(); }
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  assert.equal(it.count(), 1, 'sólo la generación');
  assert.equal(r.json.mark_pass.applied, false); assert.equal(r.json.mark_pass.reason, 'MARK_DEFERRED');
  assert.deepEqual(r.json.mark_pass.plan, { ...PLAN, variant: { for_tone: 'dark', image_url: LOGO_DARK, width_cm: 6 } });
  assert.ok(typeof r.json.mark_pass.aspect_ratio === 'string');
  assert.ok(r.json.image_data_url.endsWith(BASE_IMG));
  assert.ok(c.lines.some((l) => l.includes('MARK_DEFERRED')));
});
await ok('sin variante del logo: MARK_NOT_AVAILABLE y ninguna edición', async () => {
  const it = interceptor([H_OK]); const c = capture();
  let r; try { r = await run(handler, pedido({ marks: undefined }), { db: DB, intercept: it }); } finally { c.restore(); }
  assert.equal(it.count(), 1);
  assert.deepEqual(r.json.mark_pass, { applied: false, reason: 'MARK_NOT_AVAILABLE' });
});
await ok('lote: al terminar tampoco se edita; sale MARK_DEFERRED', async () => {
  const M2 = await cargar(SRC);
  const estado = { v: M2.LOTE_IMAGEN_VERSION, prompt: 'P', role_clause: '', negative_prompt: 'N', aspect_ratio: '4:5', image_urls: [], psycho_id: null,
    marca: { plan: PLAN, status: null },
    respuesta: { output: 'o', preset_used: false, preset_id: null, brand: 'x', canal: 'INSTAGRAM_FEED', model: 'm', prompt_full: 'P', prompt_builder_version: null,
      prompt_builder_model: null, prompt_builder_usage: null, generation_mode: 'regenerate_full', persona_used: true, location_used: null, location_refs: 0,
      product_composited: false, product_in_scene: null, product_left_scene: null, product_staging: null, product_refs: 0, reference_images: 0, personas: null, overlay: null } };
  const respuesta = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: BASE_IMG } }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1290 } };
  const it = interceptor([H_OK], null); const c = capture();
  let r; try { r = await run(M2.default, { ...req({ title: 'x' }), lote: { modo: 'terminar', estado, respuesta } }, { db: DB, intercept: it }); } finally { c.restore(); }
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  assert.equal(it.count(), 0, 'ninguna llamada en línea');
  assert.equal(r.json.mark_pass.reason, 'MARK_DEFERRED');
});

console.log('── 4b · la pasada diferida: la cara no se toca ──');
await ok('logo limpio: se pega SÓLO la caja del logo; fuera de ella, los píxeles de la original', async () => {
  const it = interceptor([H_OK], null); const c = capture();
  let r; try { r = await run(handler, pasada(), { db: DB, intercept: it }); } finally { c.restore(); }
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  assert.equal(it.count(), 1);
  assert.equal(r.json.mark_pass.applied, true);
  assert.equal(r.json.mark_pass.attempts.length, 1); assert.equal(r.json.mark_pass.attempts[0].outcome, 'applied');
  const p = r.json.mark_pass.patch;
  assert.ok(p.x <= LOGO_R[0] && p.y <= LOGO_R[1] && p.x + p.w >= LOGO_R[0] + LOGO_R[2] && p.y + p.h >= LOGO_R[1] + LOGO_R[3], 'la caja contiene el logo');
  assert.ok(p.w * p.h < TOTAL * 0.03, 'la caja es pequeña');
  const out = await rawDe(r.json.image_data_url);
  assert.ok(igualEn(out, conLogo(), LOGO_R), 'el logo está');
  assert.ok(igualEn(out, BASE_PX, [0, 0, W, p.y]) && igualEn(out, BASE_PX, [0, p.y + p.h, W, H - p.y - p.h]), 'arriba y abajo de la caja, la original');
  assert.match(it.ultimo().contents[0].parts.find((x) => x.text).text, /Embroider that logo onto Teodora Quispe's a black polo shirt/);
});
await ok('la edición también retocó la cara (sutil, no medible): la entrega lleva la cara ORIGINAL', async () => {
  const it = interceptor([H_CARA], null); const c = capture();
  let r; try { r = await run(handler, pasada(), { db: DB, intercept: it }); } finally { c.restore(); }
  assert.equal(r.json.mark_pass.applied, true);
  const out = await rawDe(r.json.image_data_url);
  assert.ok(igualEn(out, BASE_PX, CARA_R), 'la cara es la original, píxel a píxel');
  assert.ok(igualEn(out, conLogo(), LOGO_R), 'y el logo está');
});
await ok('cambio grande fuera del logo: MARK_REJECTED_SPREAD dos veces y la original, con cada intento en el log', async () => {
  const it = interceptor([H_DISPERSA, H_DISPERSA], null); const c = capture();
  let r; try { r = await run(handler, pasada(), { db: DB, intercept: it }); } finally { c.restore(); }
  assert.equal(it.count(), 2);
  assert.equal(r.json.mark_pass.applied, false); assert.equal(r.json.mark_pass.reason, 'MARK_NOT_APPLIED');
  assert.deepEqual(r.json.mark_pass.attempts.map((a) => a.outcome), ['MARK_REJECTED_SPREAD', 'MARK_REJECTED_SPREAD']);
  assert.ok(r.json.image_data_url.endsWith(BASE_IMG));
  assert.equal(c.lines.filter((l) => l.includes('MARK_REJECTED_SPREAD')).length, 2, 'un aviso por intento');
});
await ok('sin cambio: MARK_NOT_VISIBLE; un intento que falla queda en el log con su error', async () => {
  const it = interceptor([BASE_IMG, BASE_IMG], null); const c = capture();
  let r; try { r = await run(handler, pasada(), { db: DB, intercept: it }); } finally { c.restore(); }
  assert.deepEqual(r.json.mark_pass.attempts.map((a) => a.outcome), ['MARK_NOT_VISIBLE', 'MARK_NOT_VISIBLE']);
  const falla = async (u) => (u === LOGO_DARK ? new Response(LOGO_PNG, { status: 200, headers: { 'content-type': 'image/png' } })
    : u.includes('generateContent') ? new Response('{"error":{"code":400,"message":"rechazada"}}', { status: 400 }) : undefined);
  const c2 = capture();
  let r2; try { r2 = await run(handler, pasada(), { db: DB, intercept: falla }); } finally { c2.restore(); }
  assert.deepEqual(r2.json.mark_pass.attempts.map((a) => a.outcome), ['failed', 'failed']);
  assert.ok(c2.lines.filter((l) => /intento \d: la edición falló/.test(l)).length === 2, 'el error de cada intento se escribe');
});
await ok('429 de cuota: se espera antes del segundo intento y el logo se aplica; otro error no espera', async () => {
  assert.equal(M.markQuotaWaitMs('Gemini image (multimodal) error 429: {"error":{"code":429}}', 1000), M.MARK_QUOTA_WAIT_MS);
  assert.equal(M.markQuotaWaitMs('RESOURCE_EXHAUSTED', 0), M.MARK_QUOTA_WAIT_MS);
  assert.equal(M.markQuotaWaitMs('error 400: rechazada', 0), 0, 'sólo la cuota espera');
  assert.equal(M.markQuotaWaitMs('error 429', M.MARK_START_MAX_ELAPSED_MS - M.MARK_QUOTA_WAIT_MS + 1), 0, 'sin tiempo después de esperar, no espera');
  const rapido = SRC.replace('export const MARK_QUOTA_WAIT_MS = 20_000;', 'export const MARK_QUOTA_WAIT_MS = 50;');
  assert.notEqual(rapido, SRC);
  const h = (await cargar(rapido)).default;
  let n429 = 0;
  const it = async (u) => {
    if (u === LOGO_DARK) return new Response(LOGO_PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    if (u.includes('generateContent')) {
      if (n429++ === 0) return new Response('{"error":{"code":429,"message":"Resource exhausted"}}', { status: 429 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: H_OK } }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1290 } }), { status: 200 });
    }
    return undefined;
  };
  const c = capture();
  let r; try { r = await run(h, pasada(), { db: DB, intercept: it }); } finally { c.restore(); }
  assert.equal(r.json.mark_pass.applied, true, JSON.stringify(r.json.mark_pass).slice(0, 300));
  assert.deepEqual(r.json.mark_pass.attempts.map((x) => x.outcome), ['failed', 'applied']);
  assert.ok(c.lines.some((l) => /429 de cuota: se espera 50 ms antes del intento 2/.test(l)), 'la espera queda en el log');
});
await ok('petición mal formada: 400 sin llamar al modelo', async () => {
  const it = interceptor([H_OK], null); const c = capture();
  let r; try { r = await run(handler, pasada({ plan: { persona: 'X' } }), { db: DB, intercept: it }); } finally { c.restore(); }
  assert.equal(r.status, 400); assert.equal(it.count(), 0); assert.match(r.json.error, /MARK_PASS_INVALID/);
});
await ok('libro: una fila por intento y ninguna de «imagen generada»', async () => {
  const L = await cargar(SRC);
  const rows = L.ledgerRowsFromExecute({ status: 'ok', source: 'mark_pass', image_data_url: 'data:image/png;base64,AA', model: 'm',
    mark_pass: { applied: true, attempts: [{ model: 'm', usage: { promptTokenCount: 1, candidatesTokenCount: 1290 }, outcome: 'MARK_REJECTED_SPREAD' },
      { model: 'm', usage: { promptTokenCount: 1, candidatesTokenCount: 1290 }, outcome: 'applied' }] } });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((x) => x.status), ['discarded', 'success']);
  assert.ok(rows[0].markers.includes('MARK_PASS_ATTEMPT:MARK_REJECTED_SPREAD'));
});
await ok('sin tiempo: ninguna edición, la original y MARK_NOT_APPLIED por time_budget', async () => {
  assert.equal(M.markPassAllowed(0), true); assert.equal(M.markPassAllowed(25_000), true);
  assert.equal(M.markPassAllowed(25_001), false); assert.equal(M.markPassAllowed(NaN), false);
  const sinTiempo = SRC.replace('export const MARK_START_MAX_ELAPSED_MS = 25_000;', 'export const MARK_START_MAX_ELAPSED_MS = -1;');
  assert.notEqual(sinTiempo, SRC);
  const h = (await cargar(sinTiempo)).default;
  const it = interceptor([H_OK], null); const c = capture();
  let r; try { r = await run(h, pasada(), { db: DB, intercept: it }); } finally { c.restore(); }
  assert.equal(r.status, 200);
  assert.equal(it.count(), 0);
  assert.equal(r.json.mark_pass.applied, false); assert.equal(r.json.mark_pass.error, 'time_budget');
  assert.ok(r.json.image_data_url.endsWith(BASE_IMG));
});

console.log('── 4c · la prenda que se escribió ──');
await ok('con el prompt final, la marca en varias entradas se resuelve; sin coincidencia positiva, la regla de antes', () => {
  const polo = { outfit: 'a well-fitted short-sleeve pique polo shirt in black, slim dark trousers', mark: 'primary_logo', garment_tone: 'dark' };
  const ch = [{ when: 'assembly', ...polo }, { when: 'office', outfit: 'a pale-blue cotton shirt, long sleeves rolled to the forearm' },
    { when: 'hair', outfit: 'a sleek low ponytail at the nape' }];
  const per = [{ name: 'Ada', choices: ch }];
  assert.equal(M.markPlanFor(per, MARKS).status, 'MARK_UNDETERMINED', 'sin prompt, como antes');
  // Redacción REAL del constructor (2026-11-16): «, slim dark trousers» → «and slim dark trousers».
  const conPolo = 'She wears a well-fitted short-sleeve pique polo shirt in black and slim dark trousers, tiny silver studs. A sleek low ponytail at the nape.';
  assert.equal(M.markPlanFor(per, MARKS, conPolo).plan?.outfit, polo.outfit);
  const sinPolo = 'She wears a pale-blue cotton shirt with long sleeves rolled to the forearm; a sleek low ponytail at the nape.';
  assert.equal(M.markPlanFor(per, MARKS, sinPolo).status, 'MARK_UNDETERMINED', 'vistió otra prenda: sin logo (nunca un logo en otra prenda)');
  assert.equal(M.markPlanFor(per, MARKS, sinPolo).plan, null);
  // Otro polo con marca de otro color NO cuenta como escrito por compartir «polo»: el de jade pide sus propias palabras.
  const jade = { outfit: 'a well-fitted short-sleeve pique polo shirt in jade with a thin carbon-navy tipped collar and cuffs, slim dark trousers', mark: 'primary_logo', garment_tone: 'dark' };
  assert.deepEqual(M.wornChoicesIn([jade, polo], conPolo).map((c) => c.outfit), [polo.outfit]);
  assert.deepEqual(M.wornChoicesIn(ch, null), [], 'sin prompt, ninguna escrita');
});

console.log('── 5 · sin marca ──');
await ok('sin opción con marca: ni mark_pass ni segunda llamada', async () => {
  const it = interceptor([H_OK]); const c = capture();
  let r; try { r = await run(handler, pedido({ persona: { ...PERSONA, wardrobe: [{ when: 'at the shop', outfit: 'work clothes', options: ['a denim shirt'] }] } }), { db: DB, intercept: it }); } finally { c.restore(); }
  assert.equal(it.count(), 1);
  assert.ok(!('mark_pass' in r.json) && !('wardrobe_choices' in r.json));
});

console.log('── 6 · regresiones inyectadas ──');
await ok('si se entregara la edición entera, la cara retocada llegaría a la entrega', async () => {
  const roto = SRC.replace("const final = await sharp(antesBytes).composite([{ input: editada, left: caja.x, top: caja.y }]).png().toBuffer();",
    'const final = despuesBytes;');
  assert.notEqual(roto, SRC, 'la inyección encontró su punto');
  const h = (await cargar(roto)).default;
  const it = interceptor([H_CARA], null); const c = capture();
  let r; try { r = await run(h, pasada(), { db: DB, intercept: it }); } finally { c.restore(); }
  const out = await rawDe(r.json.image_data_url);
  assert.equal(igualEn(out, BASE_PX, CARA_R), false, 'el caso 4b se pondría en rojo');
});
await ok('si no se mirara la zona, el caso disperso se aplicaría', async () => {
  const roto = SRC.replace('if (pct > MARK_DIFF_MAX_PCT || !parche.ok) {', 'if (false) {');
  assert.notEqual(roto, SRC, 'la inyección encontró su punto');
  const h = (await cargar(roto)).default;
  const it = interceptor([H_DISPERSA], null); const c = capture();
  let r; try { r = await run(h, pasada(), { db: DB, intercept: it }); } catch { r = { json: { mark_pass: { applied: true } } }; } finally { c.restore(); }
  assert.notEqual(r.json.mark_pass.reason, 'MARK_NOT_APPLIED', 'el caso disperso dejaría de rechazarse');
});

await ok('multimarca: el bloque nuevo no nombra marcas reales', () => {
  const i = SRC.indexOf('// ── LA MARCA SE APLICA DESPUÉS DE GENERAR'), j = SRC.indexOf('/** Las opciones elegidas de una persona en esta imagen');
  const nuevo = SRC.slice(i, j).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(i > 0 && j > i && !/ForumPHs|NeuroneSCF|UnrealvilleStudio|SamPublisher|polo/i.test(nuevo));
});

console.log(`\npasada_de_marca: ${n} en verde`);
