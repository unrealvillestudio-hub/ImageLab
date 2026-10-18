// HOJA DE CONTACTO: POST /api/contact-sheet (2026-10-18).
//
// Lo que este test fija:
//   1. la validación: entre 2 y 16 URLs https, TODAS del host de SUPABASE_URL (otra cosa → 403); sin
//      SUPABASE_URL el endpoint no lee nada (500, fallo cerrado); enteros fuera de rango → 400;
//   2. la cuadrícula: lienzo y posiciones exactas, en el orden recibido;
//   3. EL EFECTO, con sharp de verdad y sin red: 8 PNG servidos por un fetch simulado salen como UN JPEG de
//      4×2 con el tamaño calculado, y cada celda conserva el color de su imagen de origen;
//   4. los fallos tienen etiqueta: 405, 400, 403, 502;
//   5. MULTIMARCA: el endpoint no recibe ni nombra marca.
//
// NO reimplementa la lógica: extrae el bloque `CONTACT` de `api/contact-sheet.ts` y llama al handler real.
//
// Ejecutar:  node tests/hoja_de_contacto_test.mjs     (Node ≥ 22.18, type-stripping nativo)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'contact-sheet.ts'), 'utf8');

function block(source, tag) {
  const b = `// ── ${tag}:BEGIN ──`, e = `// ── ${tag}:END ──`;
  const i = source.indexOf(b), j = source.indexOf(e);
  assert.ok(i >= 0 && j > i, `bloque ${tag} no encontrado en api/contact-sheet.ts`);
  return source.slice(i, j + e.length);
}

const dir = mkdtempSync(join(tmpdir(), 'contact-block-'));
const mod = join(dir, 'contact_block.mts');
writeFileSync(mod, block(SRC, 'CONTACT'), 'utf8');
const M = await import(pathToFileURL(mod).href);

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`  ✓ ${name}`); };
const labelOf = (fn) => { try { fn(); } catch (e) { return { label: e.label, status: e.status }; } return null; };

const HOST = 'proyecto.supabase.co';
const U = (i) => `https://${HOST}/storage/v1/object/public/bucket/temp/x/${i}.png`;

console.log('\n── 1 · validación ──');
await ok('host permitido desde SUPABASE_URL, en sus tres formas', () => {
  assert.equal(M.allowedHostFrom('https://proyecto.supabase.co/'), HOST);
  assert.equal(M.allowedHostFrom('proyecto.supabase.co'), HOST);
  assert.equal(M.allowedHostFrom('proyecto'), HOST);
  assert.equal(M.allowedHostFrom(''), '');
  assert.equal(M.allowedHostFrom(undefined), '');
});
await ok('2..16 URLs https del host permitido; valores por defecto', () => {
  const r = M.validateContactRequest({ image_urls: [U(1), ` ${U(2)} `] }, HOST);
  assert.deepEqual(r, { image_urls: [U(1), U(2)], cols: 2, cell_px: 512, gap_px: 8, quality: 88 });
  assert.equal(M.validateContactRequest({ image_urls: Array.from({ length: 8 }, (_, i) => U(i)) }, HOST).cols, 4);
  for (const malo of [null, [], 'x', {}, { image_urls: [U(1)] }, { image_urls: Array.from({ length: 17 }, (_, i) => U(i)) },
    { image_urls: [U(1), 'http://proyecto.supabase.co/x.png'] }, { image_urls: [U(1), 42] }]) {
    assert.deepEqual(labelOf(() => M.validateContactRequest(malo, HOST)), { label: 'CONTACT_BAD_REQUEST', status: 400 }, JSON.stringify(malo));
  }
});
await ok('otro origen → 403; sin SUPABASE_URL → 500 (no lee de ningún sitio)', () => {
  assert.deepEqual(labelOf(() => M.validateContactRequest({ image_urls: [U(1), 'https://otro.example.invalid/x.png'] }, HOST)),
    { label: 'CONTACT_ORIGIN_FORBIDDEN', status: 403 });
  assert.deepEqual(labelOf(() => M.validateContactRequest({ image_urls: [U(1), U(2)] }, '')),
    { label: 'CONTACT_NOT_CONFIGURED', status: 500 });
});
await ok('enteros fuera de rango → 400, no se recortan', () => {
  for (const extra of [{ cols: 0 }, { cols: 9 }, { cell_px: 64 }, { gap_px: 100 }, { quality: 0 }, { cols: 2.5 }]) {
    assert.deepEqual(labelOf(() => M.validateContactRequest({ image_urls: [U(1), U(2)], ...extra }, HOST)),
      { label: 'CONTACT_BAD_REQUEST', status: 400 }, JSON.stringify(extra));
  }
});

console.log('\n── 2 · cuadrícula ──');
await ok('8 celdas en 4×2: lienzo y posiciones exactas, en orden', () => {
  const l = M.contactLayout(8, 4, 512, 8);
  assert.deepEqual([l.width, l.height, l.rows], [4 * 512 + 5 * 8, 2 * 512 + 3 * 8, 2]);
  assert.deepEqual(l.cells[0], { left: 8, top: 8 });
  assert.deepEqual(l.cells[3], { left: 8 + 3 * 520, top: 8 });
  assert.deepEqual(l.cells[4], { left: 8, top: 8 + 520 });
  assert.deepEqual(M.contactLayout(3, 4, 100, 0), { width: 300, height: 100, rows: 1, cells: [{ left: 0, top: 0 }, { left: 100, top: 0 }, { left: 200, top: 0 }] });
});

console.log('\n── 3 · el handler real, con sharp y un fetch simulado ──');
process.env.SUPABASE_URL = `https://${HOST}`;
const { default: handler } = await import(pathToFileURL(join(ROOT, 'api', 'contact-sheet.ts')).href);
function fakeRes() {
  const r = { statusCode: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (s) => { r.statusCode = s; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
const COLORES = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#808080', '#000000'];
const PNGS = await Promise.all(COLORES.map((c) => sharp({ create: { width: 300, height: 300, channels: 3, background: c } }).png().toBuffer()));
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url) => {
  const i = Number(String(url).match(/\/(\d+)\.png$/)?.[1]);
  return Number.isInteger(i) && PNGS[i] ? new Response(PNGS[i], { status: 200 }) : new Response('no', { status: 404 });
};
const call = async (body, method = 'POST') => { const res = fakeRes(); await handler({ method, body }, res); return res; };

await ok('8 PNG → UN JPEG 4×2 del tamaño calculado; cada celda conserva su color', async () => {
  const r = await call({ image_urls: COLORES.map((_, i) => U(i)), cols: 4, cell_px: 128, gap_px: 4 });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.ok, r.body.mime, r.body.cols, r.body.rows, r.body.cells], [true, 'image/jpeg', 4, 2, 8]);
  const out = Buffer.from(r.body.data_base64, 'base64');
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.deepEqual([meta.width, meta.height, r.body.width, r.body.height], [4 * 128 + 5 * 4, 2 * 128 + 3 * 4, 4 * 128 + 5 * 4, 2 * 128 + 3 * 4]);
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const o = (y * info.width + x) * info.channels; return [data[o], data[o + 1], data[o + 2]]; };
  const centro = (i) => px(4 + (i % 4) * 132 + 64, 4 + Math.floor(i / 4) * 132 + 64);
  const cerca = (a, b) => a.every((v, k) => Math.abs(v - b[k]) < 24);
  assert.ok(cerca(centro(0), [255, 0, 0]), `celda 0 ${centro(0)}`);
  assert.ok(cerca(centro(2), [0, 0, 255]), `celda 2 ${centro(2)}`);
  assert.ok(cerca(centro(7), [0, 0, 0]), `celda 7 ${centro(7)}`);
});
await ok('fallos con etiqueta: 405, 400, 403 y 502', async () => {
  assert.equal((await call({}, 'GET')).statusCode, 405);
  const b = await call('{no json');
  assert.deepEqual([b.statusCode, b.body.error_label], [400, 'CONTACT_BAD_REQUEST']);
  const o = await call({ image_urls: [U(0), 'https://otro.example.invalid/1.png'] });
  assert.deepEqual([o.statusCode, o.body.error_label], [403, 'CONTACT_ORIGIN_FORBIDDEN']);
  const f = await call({ image_urls: [U(0), U(99)] });
  assert.deepEqual([f.statusCode, f.body.error_label, f.body.ok], [502, 'CONTACT_IMAGE_FETCH_FAILED', false]);
});
globalThis.fetch = fetchReal;

console.log('\n── 4 · multimarca ──');
await ok('el endpoint no recibe ni nombra marca', () => {
  const sin = SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
  assert.ok(!/brand_id|brandId/.test(sin), 'sin brand_id en el código');
  assert.ok(!/NeuroneSCF|ForumPHs|LucienSael|UnrealvilleStudio/.test(sin), 'sin nombre de marca');
});

console.log(`\nhoja_de_contacto: ${n} pruebas OK`);
