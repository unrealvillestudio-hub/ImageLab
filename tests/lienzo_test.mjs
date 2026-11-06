// EL LIENZO EXACTO (2026-10-31) — Sam: «las publicaciones, a lo más vertical posible»; la imagen del feed pasa a 4:5
// (1080×1350). El modelo genera en su propia tabla de tamaños (su «4:5» sale a 896×1152 [reportado]); con
// `params.canvas`, ImageLab entrega el lienzo exacto: escala hasta cubrirlo y recorta lo que sobra, centrado.
//
// QUÉ AFIRMA, y la regla se rompe a propósito al final (CC_PROTOCOL §14.2):
//   1. El bloque puro: `leerLienzo` (ausente ⇒ null; mal formado ⇒ error dicho) y `planDeLienzo` (cubre y centra).
//   2. Con `canvas`, la imagen ENTREGADA mide el lienzo, la proporción pedida al modelo es la de `aspect_ratio` y la
//      respuesta dice de dónde venía (`canvas.from`, `cropped_px`).
//   3. SIN `canvas`, nada cambia: ni la imagen ni una clave más en la respuesta.
//   4. Un lienzo mal formado es un 400 que no paga nada: ni constructor ni imagen.
//   5. El estado del lote lleva el lienzo (y uno anterior, sin lienzo, se sigue leyendo); «terminar» pasa por el mismo
//      `entregarImagen` que la llamada directa.
//
// Ejecutar:  node tests/lienzo_test.mjs     (Node ≥ 22.18)

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { run } from './_handler_harness.mjs';
import { N1, DB } from './fixtures/personas_escenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');
// Dentro del repo (y no en el tmp del sistema) para que `sharp` se resuelva y el lienzo se ajuste de verdad.
const DIR = mkdtempSync(join(ROOT, '.lienzo-test-'));
process.on('exit', () => rmSync(DIR, { recursive: true, force: true }));

let seq = 0;
const STUB = 'class GoogleAuth { constructor(_o) {} async getClient() { return { getAccessToken: async () => ({ token: "t" }) }; } }';
async function cargar(texto) {
  const patched = texto.replace("import { GoogleAuth } from 'google-auth-library';", STUB);
  assert.notEqual(patched, texto, 'import de google-auth-library');
  const f = join(DIR, `execute-${seq++}.mts`);
  writeFileSync(f, patched, 'utf8');
  Object.assign(process.env, { GOOGLE_SERVICE_ACCOUNT_KEY: '{}', GOOGLE_CLOUD_PROJECT: 'proyecto-prueba', GOOGLE_CLOUD_LOCATION: 'us-central1',
    SUPABASE_URL: 'https://db.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'k' });
  return await import(pathToFileURL(f).href);
}
const silencio = async (fn) => {
  const [l, w, e] = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = () => {};
  try { return await fn(); } finally { [console.log, console.warn, console.error] = [l, w, e]; }
};

let pass = 0;
const fails = [];
async function ok(nombre, fn) {
  try { await fn(); pass++; console.log(`  ok   ${nombre}`); }
  catch (err) { fails.push(nombre); console.log(`  FAIL ${nombre}\n       ${err.message.split('\n').join('\n       ')}`); }
}

// La imagen que «devuelve el modelo»: un PNG real de 896×1152 (el «4:5» de la tabla de Google), con una franja
// de color arriba y abajo para ver qué se recortó.
async function pngDe(w, h) {
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    px[i] = y < 10 || y >= h - 10 ? 255 : 40; px[i + 1] = 80; px[i + 2] = 120;
  }
  return (await sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()).toString('base64');
}
const MODELO_4x5 = await pngDe(896, 1152);
const respuesta = (data) => ({ status: 200, body: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data } }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 1290 } } });
const dims = async (dataUrl) => {
  const m = await sharp(Buffer.from(String(dataUrl).split(',')[1], 'base64')).metadata();
  return [m.width, m.height];
};

const a = SRC.indexOf('// ── LOTE-IMAGEN:BEGIN ──');
const b = SRC.indexOf('// ── LOTE-IMAGEN:END ──');
assert.ok(a > 0 && b > a, 'bloque LOTE-IMAGEN');
const fb = join(DIR, 'bloque.mts');
writeFileSync(fb, SRC.slice(a, b), 'utf8');
const B = await import(pathToFileURL(fb).href);

const LIENZO = { width: 1080, height: 1350 };
const conLienzo = (body, extra) => ({ ...body, params: { ...body.params, aspect_ratio: '4:5', ...extra } });

console.log('\n── 1 · el bloque puro ──');
await ok('leerLienzo: ausente ⇒ null; entero en rango ⇒ el lienzo; lo demás ⇒ IMAGELAB_CANVAS_INVALIDO', () => {
  assert.deepEqual(B.leerLienzo(undefined), { lienzo: null });
  assert.deepEqual(B.leerLienzo(null), { lienzo: null });
  assert.deepEqual(B.leerLienzo({ width: 1080, height: 1350 }), { lienzo: { width: 1080, height: 1350 } });
  for (const malo of [{ width: 1080 }, { width: '1080', height: 'x' }, { width: 10, height: 10 }, { width: 9000, height: 1350 }, [1080, 1350], 'grande', { width: 1080.5, height: 1350 }]) {
    assert.match(B.leerLienzo(malo).error ?? '', /^IMAGELAB_CANVAS_INVALIDO/, JSON.stringify(malo));
  }
});
await ok('planDeLienzo: el «4:5» del modelo (896×1152) llega a 1080×1350 recortando 39 px de alto, centrado', () => {
  const p = B.planDeLienzo(896, 1152, LIENZO);
  assert.deepEqual([p.scaleW, p.scaleH, p.left, p.top, p.cropped_px], [1080, 1389, 0, 19, 39]);
  assert.ok(p.cropped_px / p.scaleH < 0.03, 'menos de un 3 % del alto');
});
await ok('planDeLienzo: una imagen cuadrada perdería un 20 % del ancho (por eso se pide 4:5 al modelo, no 1:1)', () => {
  const p = B.planDeLienzo(1024, 1024, LIENZO);
  assert.deepEqual([p.scaleW, p.scaleH, p.left, p.top, p.cropped_px], [1350, 1350, 135, 0, 270]);
});
await ok('planDeLienzo: el 9:16 del modelo (768×1344) al lienzo del reel (1080×1920)', () => {
  const p = B.planDeLienzo(768, 1344, { width: 1080, height: 1920 });
  assert.equal(p.scaleW, 1097); assert.equal(p.scaleH, 1920); assert.equal(p.top, 0); assert.equal(p.left, 8);
});
await ok('leerEstadoDeImagen: un estado sin lienzo se lee como antes; con lienzo mal formado, no', () => {
  const base = { v: B.LOTE_IMAGEN_VERSION, prompt: 'p', role_clause: '', negative_prompt: 'n', aspect_ratio: '4:5', image_urls: [], psycho_id: null,
    respuesta: { output: 'o', canal: 'C', model: 'm', prompt_full: 'p', generation_mode: 'regenerate_full', preset_used: false, persona_used: false,
      product_composited: false, location_refs: 0, product_refs: 0, reference_images: 0 } };
  assert.equal(B.leerEstadoDeImagen(base).ok, true);
  assert.equal(B.leerEstadoDeImagen({ ...base, canvas: LIENZO }).ok, true);
  const malo = B.leerEstadoDeImagen({ ...base, canvas: { width: 1 } });
  assert.equal(malo.ok, false); assert.match(malo.error, /canvas/);
});

const H = (await cargar(SRC)).default;

console.log('\n── 2 · con lienzo, la imagen entregada mide el lienzo ──');
await ok('896×1152 del modelo ⇒ 1080×1350 entregada; al modelo se le pidió 4:5; la respuesta dice de dónde venía', async () => {
  const r = await silencio(() => run(H, conLienzo(N1.copy_persona_locacion_producto, { canvas: LIENZO }), { db: DB, image: respuesta(MODELO_4x5) }));
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  assert.equal(r.vertexImage.generationConfig.imageConfig.aspectRatio, '4:5');
  assert.deepEqual(await dims(r.json.image_data_url), [1080, 1350]);
  assert.deepEqual(r.json.canvas, { applied: true, width: 1080, height: 1350, from: { width: 896, height: 1152 }, cropped_px: 39 });
  assert.match(r.json.image_data_url, /^data:image\/png;base64,/);
});
await ok('si el modelo ya entrega el lienzo exacto, la imagen no se toca', async () => {
  const exacta = await pngDe(1080, 1350);
  const r = await silencio(() => run(H, conLienzo(N1.copy_persona_locacion_producto, { canvas: LIENZO }), { db: DB, image: respuesta(exacta) }));
  assert.equal(r.json.image_data_url, `data:image/png;base64,${exacta}`);
  assert.equal(r.json.canvas.cropped_px, 0);
});
await ok('una imagen ilegible no se tira: se entrega la del modelo y `canvas.applied = false` lo dice', async () => {
  const r = await silencio(() => run(H, conLienzo(N1.copy_persona_locacion_producto, { canvas: LIENZO }), { db: DB }));
  assert.equal(r.status, 200);
  assert.equal(r.json.canvas.applied, false);
  assert.match(r.json.image_data_url, /AAAA$/);
});

console.log('\n── 3 · sin lienzo, nada cambia ──');
await ok('la misma petición sin `canvas`: la imagen del modelo tal cual y ninguna clave `canvas`', async () => {
  const r = await silencio(() => run(H, conLienzo(N1.copy_persona_locacion_producto, {}), { db: DB, image: respuesta(MODELO_4x5) }));
  assert.equal(r.status, 200);
  assert.equal(r.json.image_data_url, `data:image/png;base64,${MODELO_4x5}`);
  assert.ok(!('canvas' in r.json));
});
await ok('y la petición de siempre (sin `aspect_ratio` ni `canvas`) es idéntica con y sin este cambio', async () => {
  const antes = (await cargar(execSourceSinLienzo())).default;
  const r1 = await silencio(() => run(antes, N1.copy_persona_locacion_producto, { db: DB, image: respuesta(MODELO_4x5) }));
  const r2 = await silencio(() => run(H, N1.copy_persona_locacion_producto, { db: DB, image: respuesta(MODELO_4x5) }));
  assert.deepEqual(r2.vertexImage, r1.vertexImage);
  const sinTiempo = (j) => { const { duration_ms, ...resto } = j ?? {}; return resto; };
  assert.deepEqual(sinTiempo(r2.json), sinTiempo(r1.json));
});

console.log('\n── 4 · lo mal formado no paga nada ──');
await ok('`canvas` mal formado ⇒ 400 IMAGELAB_CANVAS_INVALIDO, sin constructor ni imagen', async () => {
  const r = await silencio(() => run(H, conLienzo(N1.copy_persona_locacion_producto, { canvas: { width: 1080 } }), { db: DB }));
  assert.equal(r.status, 400);
  assert.match(r.json.error, /^IMAGELAB_CANVAS_INVALIDO/);
  assert.equal(r.vertexImage, null); assert.equal(r.vertexText, null);
});

console.log('\n── 5 · el lote ──');
await ok('el estado lleva el lienzo sólo si se pidió, y «terminar» entrega por el mismo `entregarImagen`', () => {
  assert.match(SRC, /\.\.\.\(lienzoIn\.lienzo \? \{ canvas: lienzoIn\.lienzo \} : \{\}\),/);
  const term = SRC.slice(SRC.indexOf('async function terminarImagenDelLote'), SRC.indexOf('async function terminarImagenDelLote') + 4000);
  assert.match(term, /entregarImagen\(/);
});

console.log('\n── 6 · la regla, rota a propósito ──');
await ok('sin el ajuste en `entregarImagen`, la imagen sale 896×1152: el test lo ve', async () => {
  const roto = SRC.replace('  if (e.canvas) {\n    const aj = await ajustarAlLienzo', '  if (false) {\n    const aj = await ajustarAlLienzo');
  assert.notEqual(roto, SRC, 'el punto de sabotaje existe');
  const Hr = (await cargar(roto)).default;
  const r = await silencio(() => run(Hr, conLienzo(N1.copy_persona_locacion_producto, { canvas: LIENZO }), { db: DB, image: respuesta(MODELO_4x5) }));
  assert.deepEqual(await dims(r.json.image_data_url), [896, 1152]);
});

// La fuente sin el lienzo: el handler de antes de este cambio, reconstruido quitando lo que añade (sin `canvas`,
// todo lo añadido es inerte; esta reconstrucción lo demuestra comparando contra un handler que no lo tiene).
function execSourceSinLienzo() {
  let s = SRC;
  s = s.replace(/  \/\/ 2026-10-31 — el lienzo se valida ANTES de pagar el constructor[^\n]*\n  const lienzoIn = leerLienzo\(body\.params\?\.canvas\);\n  if \('error' in lienzoIn\)[^\n]*\n/, '');
  s = s.replace(/      \/\/ 2026-10-31 — sólo si se pidió[^\n]*\n      \.\.\.\(lienzoIn\.lienzo \? \{ canvas: lienzoIn\.lienzo \} : \{\}\),\n/, '');
  assert.ok(!s.includes('lienzoIn'), 'la reconstrucción quitó el lienzo del handler');
  return s;
}

console.log(`\n${pass} pasaron · ${fails.length} fallaron`);
if (fails.length) process.exit(1);
