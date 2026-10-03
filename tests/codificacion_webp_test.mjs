// CODIFICADOR WebP: POST /api/encode (2026-10-03, paquete de alt).
//
// Lo que este test fija:
//   1. la validación: image_url https obligatoria, formato desconocido → 400 con nombre propio,
//      calidad fuera de 1..100 → 400 (nunca un recorte en silencio), calidad por defecto 82;
//   2. la firma de bytes: png, jpeg y webp se reconocen; lo demás es null;
//   3. EL EFECTO, con sharp de verdad y sin red: un PNG servido por un fetch simulado sale como WebP
//      (firma RIFF/WEBP), con el MISMO ancho y alto, y más liviano que el PNG de origen;
//   4. los fallos tienen etiqueta: 405, 400, 422 (no es imagen) y 502 (descarga fallida);
//   5. MULTIMARCA: el endpoint no recibe ni nombra marca.
//
// NO reimplementa la lógica: extrae el bloque `ENCODE` de `api/encode.ts` y llama al handler real.
//
// Ejecutar:  node tests/codificacion_webp_test.mjs     (Node ≥ 22.18, type-stripping nativo)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'encode.ts'), 'utf8');

function block(source, tag) {
  const b = `// ── ${tag}:BEGIN ──`, e = `// ── ${tag}:END ──`;
  const i = source.indexOf(b), j = source.indexOf(e);
  assert.ok(i >= 0 && j > i, `bloque ${tag} no encontrado en api/encode.ts`);
  return source.slice(i, j + e.length);
}

const dir = mkdtempSync(join(tmpdir(), 'encode-block-'));
const mod = join(dir, 'encode_block.mts');
writeFileSync(mod, block(SRC, 'ENCODE'), 'utf8');
const M = await import(pathToFileURL(mod).href);

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`  ✓ ${name}`); };
const labelOf = (fn) => { try { fn(); } catch (e) { return { label: e.label, status: e.status }; } return null; };

console.log('\n── 1 · validación ──');
await ok('image_url https obligatoria; formato y calidad por defecto', () => {
  const r = M.validateEncodeRequest({ image_url: ' https://cdn.example.invalid/x.png ' });
  assert.deepEqual(r, { image_url: 'https://cdn.example.invalid/x.png', format: 'webp', quality: M.ENCODE_QUALITY_DEFAULT });
  assert.equal(M.ENCODE_QUALITY_DEFAULT, 82);
  for (const malo of [null, [], 'x', {}, { image_url: 'http://cdn.example.invalid/x.png' }, { image_url: 'ftp://x' }, { image_url: '' }]) {
    assert.deepEqual(labelOf(() => M.validateEncodeRequest(malo)), { label: 'ENCODE_BAD_REQUEST', status: 400 }, JSON.stringify(malo));
  }
});
await ok('formato desconocido → 400 ENCODE_FORMAT_UNSUPPORTED (nunca cae a otro)', () => {
  assert.deepEqual(labelOf(() => M.validateEncodeRequest({ image_url: 'https://a.invalid/x', format: 'avif' })),
    { label: 'ENCODE_FORMAT_UNSUPPORTED', status: 400 });
  assert.equal(M.validateEncodeRequest({ image_url: 'https://a.invalid/x', format: 'WEBP' }).format, 'webp');
});
await ok('calidad: entero 1..100; fuera de rango → 400, no se recorta', () => {
  assert.equal(M.validateEncodeRequest({ image_url: 'https://a.invalid/x', quality: 60 }).quality, 60);
  for (const q of [0, 101, 50.5, 'alta', -1]) {
    assert.deepEqual(labelOf(() => M.validateEncodeRequest({ image_url: 'https://a.invalid/x', quality: q })), { label: 'ENCODE_BAD_REQUEST', status: 400 }, String(q));
  }
});

console.log('\n── 2 · firma de bytes y dimensiones ──');
const PNG = await sharp({ create: { width: 64, height: 36, channels: 3, background: '#3a6ea5' } })
  .composite([{ input: Buffer.from('<svg width="64" height="36"><circle cx="20" cy="18" r="12" fill="#e5c07b"/></svg>'), top: 0, left: 0 }])
  .png({ compressionLevel: 0 }).toBuffer();
const JPG = await sharp(PNG).jpeg().toBuffer();
const WEBP = await sharp(PNG).webp().toBuffer();
await ok('png, jpeg y webp se reconocen; lo demás es null', () => {
  assert.equal(M.sniffEncodableMime(new Uint8Array(PNG)), 'image/png');
  assert.equal(M.sniffEncodableMime(new Uint8Array(JPG)), 'image/jpeg');
  assert.equal(M.sniffEncodableMime(new Uint8Array(WEBP)), 'image/webp');
  assert.equal(M.sniffEncodableMime(new TextEncoder().encode('<html>no</html>')), null);
  assert.equal(M.sniffEncodableMime(new Uint8Array(0)), null);
});
await ok('checkDimensions: enteros positivos dentro del tope', () => {
  assert.deepEqual(M.checkDimensions(1408, 768), { width: 1408, height: 768 });
  assert.equal(labelOf(() => M.checkDimensions(0, 10)).label, 'ENCODE_IMAGE_UNDECODABLE');
  assert.equal(labelOf(() => M.checkDimensions(undefined, 10)).label, 'ENCODE_IMAGE_UNDECODABLE');
  assert.equal(labelOf(() => M.checkDimensions(10000, 10000)).label, 'ENCODE_IMAGE_TOO_LARGE');
});

console.log('\n── 3 · el handler real, con sharp y un fetch simulado ──');
const { default: handler } = await import(pathToFileURL(join(ROOT, 'api', 'encode.ts')).href);
function fakeRes() {
  const r = { statusCode: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (s) => { r.statusCode = s; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
const servir = (bytes, status = 200) => async () => new Response(status === 200 ? bytes : 'no', { status });
const fetchReal = globalThis.fetch;
const call = async (body, method = 'POST') => { const res = fakeRes(); await handler({ method, body }, res); return res; };

await ok('PNG → WebP con el MISMO ancho y alto, y más liviano', async () => {
  globalThis.fetch = servir(PNG);
  const r = await call({ image_url: 'https://cdn.example.invalid/escena-01.png' });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.mime, 'image/webp');
  const out = Buffer.from(r.body.data_base64, 'base64');
  assert.equal(M.sniffEncodableMime(new Uint8Array(out)), 'image/webp', 'la salida es WebP de verdad');
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'webp');
  assert.deepEqual([r.body.width, r.body.height, meta.width, meta.height], [64, 36, 64, 36]);
  assert.deepEqual(r.body.source, { mime: 'image/png', bytes: PNG.length, width: 64, height: 36 });
  assert.equal(r.body.bytes, out.length);
  assert.ok(out.length < PNG.length, `webp ${out.length} B < png ${PNG.length} B`);
});
await ok('la calidad pedida viaja y se devuelve', async () => {
  globalThis.fetch = servir(PNG);
  const r = await call(JSON.stringify({ image_url: 'https://cdn.example.invalid/x.png', quality: 40 }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.quality, 40);
});
await ok('fallos con etiqueta: 405, 400, 422 no es imagen, 502 descarga fallida', async () => {
  assert.equal((await call({}, 'GET')).statusCode, 405);
  const b = await call('{no json');
  assert.deepEqual([b.statusCode, b.body.error_label], [400, 'ENCODE_BAD_REQUEST']);
  globalThis.fetch = servir(new TextEncoder().encode('<html>no</html>'));
  const u = await call({ image_url: 'https://cdn.example.invalid/x.png' });
  assert.deepEqual([u.statusCode, u.body.error_label], [422, 'ENCODE_IMAGE_UNSUPPORTED']);
  globalThis.fetch = servir(PNG, 404);
  const f = await call({ image_url: 'https://cdn.example.invalid/x.png' });
  assert.deepEqual([f.statusCode, f.body.error_label, f.body.ok], [502, 'ENCODE_IMAGE_FETCH_FAILED', false]);
});
globalThis.fetch = fetchReal;

console.log('\n── 4 · multimarca ──');
await ok('el endpoint no recibe ni nombra marca', () => {
  const sin = SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
  assert.ok(!/brand_id|brandId/.test(sin), 'sin brand_id en el código');
  assert.ok(!/NeuroneSCF|ForumPHs|LucienSael|UnrealvilleStudio/.test(sin), 'sin nombre de marca');
});

console.log(`\ncodificacion_webp: ${n} pruebas OK`);
