// JUEZ VISUAL: POST /api/inspect (2026-10-02).
//
// Lo que este test fija, sin red:
//   1. el prompt incluye el código y el enunciado de CADA regla, y la cláusula de escena limpia;
//   2. el copy entra sólo cuando viene, y como contexto de coherencia;
//   3. el parser conserva sólo códigos conocidos, manda los desconocidos a `unmatched` y FALLA con
//      `INSPECT_UNPARSEABLE` ante un JSON ilegible o con otra forma (nunca un «pasa» vacío);
//   4. la validación devuelve 400 con etiqueta ante brand_id ausente, image_url inválida o reglas vacías;
//   5. el consumo sale de `usageMetadata` o es null (nunca ceros inventados);
//   6. el CABLEADO: la URL de Vertex pasa por `vertexBaseUrl`, y los bloques de endpoint y de
//      autenticación son copias literales de los de `api/execute.ts` (no pueden divergir);
//   7. MULTIMARCA: el endpoint no trae ningún texto ni código de regla fijo.
//
// NO reimplementa la lógica: extrae el bloque `INSPECCION` de `api/inspect.ts`.
//
// Ejecutar:  node tests/inspeccion_visual_test.mjs     (Node ≥ 22.18, type-stripping nativo)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const inspect = readFileSync(join(ROOT, 'api', 'inspect.ts'), 'utf8');
const execute = readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');

function block(source, tag, file) {
  const b = `// ── ${tag}:BEGIN ──`, e = `// ── ${tag}:END ──`;
  const i = source.indexOf(b), j = source.indexOf(e);
  assert.ok(i >= 0 && j > i, `bloque ${tag} no encontrado en ${file}`);
  return source.slice(i, j + e.length);
}

const pure = block(inspect, 'INSPECCION', 'api/inspect.ts');
const dir = mkdtempSync(join(tmpdir(), 'inspeccion-block-'));
const mod = join(dir, 'inspeccion_block.mts');
writeFileSync(mod, pure, 'utf8');
const M = await import(pathToFileURL(mod).href);

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const labelOf = (fn) => { try { fn(); } catch (e) { return { label: e.label, status: e.status }; } return null; };

// Reglas de PRUEBA: inventadas, sin marca. Las reales son dato de intel.watcher_rules.
const RULES = [
  { code: 'R_ALPHA', statement: 'No visible letters painted in the scene.' },
  { code: 'R_BETA', statement: 'The scene must match the topic of the copy.' },
  { code: 'r_gamma', statement: 'No more than one person in frame.' },
];
const CODES = RULES.map((r) => r.code);
const VALID = { brand_id: 'brand-x', image_url: 'https://example.test/clean.png', rules: RULES };

ok('el bloque puro no tiene efectos (ni red ni entorno ni await)', () => {
  const code = pure.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  for (const efecto of ['fetch(', 'process.env', 'await ']) assert.ok(!code.includes(efecto), `INSPECCION contiene un efecto: ${efecto}`);
});

ok('el prompt incluye el código y el enunciado de cada regla, numerados', () => {
  const { user, system } = M.buildInspectPrompt({ rules: RULES, copy: null });
  RULES.forEach((r, i) => assert.ok(user.includes(`${i + 1}. [${r.code}] ${r.statement}`), `falta la regla ${r.code}`));
  assert.equal(system, M.JUDGE_SYSTEM);
});

ok('el prompt incluye la cláusula de escena limpia', () => {
  const { user } = M.buildInspectPrompt({ rules: RULES, copy: null });
  assert.ok(user.includes(M.CLEAN_SCENE_CLAUSE));
  assert.match(M.CLEAN_SCENE_CLAUSE, /NOT present/);
  assert.match(M.CLEAN_SCENE_CLAUSE, /painted by the image generator/);
});

ok('el prompt pide JSON estricto con la forma {"violated":[{code,evidence}]}', () => {
  const { user } = M.buildInspectPrompt({ rules: RULES, copy: null });
  assert.ok(user.includes('{"violated":[{"code":'));
  assert.ok(user.includes('List ONLY codes from the list above'));
});

ok('el copy entra sólo cuando viene, como contexto de coherencia', () => {
  const sin = M.buildInspectPrompt({ rules: RULES, copy: null }).user;
  assert.ok(sin.includes('PIECE COPY — none provided'));
  const con = M.buildInspectPrompt({ rules: RULES, copy: { title: 'Un título', body_excerpt: 'Un extracto "con comillas"' } }).user;
  assert.ok(con.includes('Title: "Un título"'));
  assert.ok(con.includes('Body excerpt: "Un extracto \\"con comillas\\""'));
  assert.ok(con.includes('NOT drawn in the image'));
});

ok('el parser conserva sólo códigos conocidos y manda los desconocidos a unmatched', () => {
  const r = M.parseVerdict(JSON.stringify({ violated: [
    { code: 'R_ALPHA', evidence: ' letras en el cartel del fondo ' },
    { code: 'R_INVENTADO', evidence: 'x' },
    { code: 'R_INVENTADO', evidence: 'y' },
    { code: 'R_GAMMA', evidence: 'dos personas' },   // mayúsculas distintas → código canónico
    { code: 'R_ALPHA', evidence: 'duplicado' },       // repetido → se descarta
  ] }), CODES);
  assert.deepEqual(r.violated, [
    { code: 'R_ALPHA', evidence: 'letras en el cartel del fondo' },
    { code: 'r_gamma', evidence: 'dos personas' },
  ]);
  assert.deepEqual(r.unmatched, ['R_INVENTADO']);
});

ok('el parser acepta un veredicto vacío y un bloque ```json', () => {
  assert.deepEqual(M.parseVerdict('{"violated":[]}', CODES), { violated: [], unmatched: [] });
  assert.deepEqual(M.parseVerdict('```json\n{"violated":[{"code":"R_BETA","evidence":"e"}]}\n```', CODES).violated,
    [{ code: 'R_BETA', evidence: 'e' }]);
});

ok('un JSON ilegible o con otra forma es INSPECT_UNPARSEABLE (502), nunca un «pasa»', () => {
  for (const malo of ['', 'todo bien', '{"violated":', '[]', '{"ok":true}', '{"violated":"R_ALPHA"}', '{"violated":[{"evidence":"sin code"}]}', 'null']) {
    assert.deepEqual(labelOf(() => M.parseVerdict(malo, CODES)), { label: 'INSPECT_UNPARSEABLE', status: 502 }, `no falló con: ${malo}`);
  }
});

ok('validación: brand_id ausente → 400 INSPECT_BRAND_MISSING', () => {
  assert.deepEqual(labelOf(() => M.validateInspectRequest({ ...VALID, brand_id: '' })), { label: 'INSPECT_BRAND_MISSING', status: 400 });
  assert.deepEqual(labelOf(() => M.validateInspectRequest({ ...VALID, brand_id: undefined })), { label: 'INSPECT_BRAND_MISSING', status: 400 });
});

ok('validación: image_url inválida → 400 INSPECT_IMAGE_URL_INVALID', () => {
  for (const url of [undefined, '', 'no-es-url', 'ftp://example.test/a.png', 'data:image/png;base64,AAAA', 42]) {
    assert.deepEqual(labelOf(() => M.validateInspectRequest({ ...VALID, image_url: url })), { label: 'INSPECT_IMAGE_URL_INVALID', status: 400 }, `aceptó ${url}`);
  }
});

ok('validación: reglas vacías → 400 INSPECT_RULES_EMPTY; reglas mal formadas → 400 INSPECT_RULES_INVALID', () => {
  for (const rules of [undefined, [], 'R_ALPHA']) {
    assert.deepEqual(labelOf(() => M.validateInspectRequest({ ...VALID, rules })), { label: 'INSPECT_RULES_EMPTY', status: 400 });
  }
  for (const rules of [[{ code: 'A' }], [{ statement: 's' }], [{ code: ' ', statement: 's' }], [{ code: 'A', statement: 's' }, { code: 'A', statement: 't' }], [null]]) {
    assert.deepEqual(labelOf(() => M.validateInspectRequest({ ...VALID, rules })), { label: 'INSPECT_RULES_INVALID', status: 400 });
  }
});

ok('validación: un cuerpo válido se normaliza', () => {
  const v = M.validateInspectRequest({ ...VALID, copy: { title: ' T ', body_excerpt: null }, piece_id: 'p-1' });
  assert.equal(v.brand_id, 'brand-x');
  assert.equal(v.image_url, 'https://example.test/clean.png');
  assert.deepEqual(v.rules, RULES);
  assert.deepEqual(v.copy, { title: 'T', body_excerpt: null });
  assert.equal(v.piece_id, 'p-1');
  assert.equal(M.validateInspectRequest(VALID).copy, null);
  assert.deepEqual(labelOf(() => M.validateInspectRequest(null)), { label: 'INSPECT_BAD_REQUEST', status: 400 });
  assert.deepEqual(labelOf(() => M.validateInspectRequest({ ...VALID, copy: 'texto' })), { label: 'INSPECT_BAD_REQUEST', status: 400 });
});

ok('el consumo sale de usageMetadata o es null (nunca ceros inventados)', () => {
  assert.deepEqual(M.usageFromResponse({ usageMetadata: { promptTokenCount: 1290, candidatesTokenCount: 41, totalTokenCount: 1331 } }),
    { input_tokens: 1290, output_tokens: 41 });
  assert.deepEqual(M.usageFromResponse({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 } }),
    { input_tokens: 10, output_tokens: 12 });
  assert.equal(M.usageFromResponse({}), null);
  assert.equal(M.usageFromResponse({ usageMetadata: { promptTokenCount: 10 } }), null);
});

ok('el esquema de respuesta restringe code a los códigos recibidos', () => {
  const s = M.buildResponseSchema(CODES);
  assert.deepEqual(s.properties.violated.items.properties.code.enum, CODES);
});

ok('el tipo de imagen sale de sus bytes', () => {
  assert.equal(M.sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'application/octet-stream'), 'image/png');
  assert.equal(M.sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), null), 'image/jpeg');
  assert.equal(M.sniffImageMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), null), 'image/webp');
  assert.equal(M.sniffImageMime(new Uint8Array([0x3c, 0x68, 0x74, 0x6d]), 'text/html'), null);
});

ok('CABLEADO: la URL de Vertex pasa por vertexBaseUrl y ningún host se arma a mano', () => {
  const ev = block(inspect, 'ENDPOINT-VERTEX', 'api/inspect.ts');
  const fuera = inspect.replace(ev, '');
  assert.ok(!/\$\{GCP_LOCATION\(\)\}-aiplatform/.test(fuera), 'hay una URL que arma el host regional a mano');
  assert.ok(/vertexBaseUrl\(GCP_LOCATION\(\), GCP_PROJECT\(\)\)/.test(fuera), 'la URL del juez debe pasar por vertexBaseUrl');
  assert.match(inspect, /process\.env\.IMAGELAB_INSPECT_MODEL/);
});

ok('CABLEADO: endpoint y autenticación son copias literales de api/execute.ts', () => {
  assert.equal(block(inspect, 'ENDPOINT-VERTEX', 'api/inspect.ts'), block(execute, 'ENDPOINT-VERTEX', 'api/execute.ts'),
    'el bloque ENDPOINT-VERTEX de api/inspect.ts divergió del de api/execute.ts');
  const auth = block(inspect, 'AUTH-VERTEX', 'api/inspect.ts').split('\n').slice(1, -1).join('\n');
  assert.ok(auth.length > 200 && execute.includes(auth), 'la autenticación de api/inspect.ts divergió de la de api/execute.ts');
});

ok('MULTIMARCA: el endpoint no trae reglas fijas; las reglas son las del cuerpo', () => {
  // Los únicos «códigos» del prompt son los que llegaron: con otras reglas, otro prompt.
  const otras = [{ code: 'Z1', statement: 'Otra regla de otra marca.' }];
  const u = M.buildInspectPrompt({ rules: otras, copy: null }).user;
  assert.ok(u.includes('1. [Z1] Otra regla de otra marca.'));
  for (const r of RULES) assert.ok(!u.includes(r.code), `el prompt arrastra ${r.code} sin que llegara`);
  assert.equal((u.match(/^\d+\. \[/gm) ?? []).length, 1, 'el prompt sólo debe numerar las reglas recibidas');
});

// ── meta.edge_bands (2026-10-03): medida determinista de bandas de borde ─────────────────────
// Imágenes SINTÉTICAS generadas aquí: una escena con textura (nunca uniforme por fila ni por columna)
// y bandas pintadas encima. Sin red y sin archivos.
function scene(w, h, paint = () => null) {
  const px = new Uint8Array(w * h * 4);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 0xff;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4;
    const c = paint(x, y) ?? [rnd(), (x * 7 + y * 3) & 0xff, rnd()];
    px[p] = c[0]; px[p + 1] = c[1]; px[p + 2] = c[2]; px[p + 3] = 255;
  }
  return px;
}
// PNG mínimo (RGBA, sin filtro) con zlib de Node: para probar la decodificación REAL de punta a punta.
const { deflateSync } = await import('node:zlib');
function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function png(px, w, h) {
  const chunk = (type, data) => {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (1 + w * 4) + 1);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const { createRequire } = await import('node:module');
const { Resvg } = createRequire(join(ROOT, 'package.json'))('@resvg/resvg-js');

ok('bandas: escena sin franjas → 0 en los cuatro bordes', () => {
  const b = M.measureEdgeBands(scene(160, 90), 160, 90);
  assert.deepEqual([b.top_px, b.bottom_px, b.left_px, b.right_px], [0, 0, 0, 0]);
  assert.deepEqual(b.mean_luma, { top: null, bottom: null, left: null, right: null });
  assert.equal(b.width, 160); assert.equal(b.height, 90);
});

ok('bandas: franjas negras de N px arriba y abajo → N (con ruido de compresión ≤ 2 niveles)', () => {
  for (const N of [1, 7, 12]) {
    const w = 160, h = 90;
    const px = scene(w, h, (x, y) => (y < N || y >= h - N ? [(x + y) % 3, (x * y) % 2, 0] : null));
    const b = M.measureEdgeBands(px, w, h);
    assert.equal(b.top_px, N, `arriba ${N}`); assert.equal(b.bottom_px, N, `abajo ${N}`);
    assert.equal(b.left_px, 0); assert.equal(b.right_px, 0);
    assert.ok(b.mean_luma.top < 3 && b.mean_luma.bottom < 3, 'luma media de la franja ≈ negro');
  }
});

ok('bandas: franja blanca lateral → medida, del lado en que está', () => {
  const w = 120, h = 80;
  const b = M.measureEdgeBands(scene(w, h, (x) => (x >= w - 9 ? [255, 255, 255] : null)), w, h);
  assert.deepEqual([b.top_px, b.bottom_px, b.left_px, b.right_px], [0, 0, 0, 9]);
  assert.equal(b.mean_luma.right, 255);
  const l = M.measureEdgeBands(scene(w, h, (x) => (x < 5 ? [250, 250, 250] : null)), w, h);
  assert.equal(l.left_px, 5);
});

ok('bandas: un salto de media > 6 entre filas uniformes corta la banda', () => {
  const w = 100, h = 60;
  // 6 filas negras y debajo 4 filas grises lisas: la banda negra mide 6, no 10.
  const b = M.measureEdgeBands(scene(w, h, (x, y) => (y < 6 ? [0, 0, 0] : y < 10 ? [128, 128, 128] : null)), w, h);
  assert.equal(b.top_px, 6);
  // Y un degradado liso que cambia ≤ 6 por fila SÍ se cuenta: la medida no distingue una franja de un
  // fondo liso hasta el borde (cielo, pared de estudio). Lo declara el contrato: mide, no decide.
  const g = M.measureEdgeBands(scene(w, h, (x, y) => (y < 8 ? [y * 5, y * 5, y * 5] : null)), w, h);
  assert.equal(g.top_px, 8);
});

ok('bandas: decodificación REAL (PNG → resvg → píxeles) da la misma medida que los píxeles de origen', () => {
  const w = 96, h = 54, N = 6;
  const px = scene(w, h, (x, y) => (y < N || y >= h - N ? [0, 0, 0] : null));
  const r = M.decodeRaster(png(px, w, h), Resvg);
  assert.equal(r.width, w); assert.equal(r.height, h);
  assert.deepEqual([...r.pixels.slice(0, 64)], [...px.slice(0, 64)], 'píxel a píxel');
  const out = M.edgeBandsOrNull(() => M.decodeRaster(png(px, w, h), Resvg));
  assert.equal(out.error, null);
  assert.deepEqual([out.edge_bands.top_px, out.edge_bands.bottom_px, out.edge_bands.left_px, out.edge_bands.right_px], [N, N, 0, 0]);
});

ok('bandas: imagen no decodificable → edge_bands null con motivo, sin lanzar', () => {
  const casos = [
    ['bytes basura', () => M.decodeRaster(new TextEncoder().encode('no es una imagen'), Resvg)],
    ['webp (sin decodificador)', () => M.decodeRaster(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]), Resvg)],
    // Cabecera PNG válida y datos rotos: resvg no avisa, devuelve un lienzo transparente.
    ['png con datos rotos', () => M.decodeRaster(new Uint8Array([...png(scene(8, 8), 8, 8).slice(0, 33), 1, 2, 3, 4, 5, 6]), Resvg)],
    ['el decodificador lanza', () => { throw new Error('boom'); }],
  ];
  for (const [nombre, decode] of casos) {
    const out = M.edgeBandsOrNull(decode);
    assert.equal(out.edge_bands, null, nombre);
    assert.ok(typeof out.error === 'string' && out.error.length > 0, `${nombre}: el motivo viaja`);
  }
});

ok('bandas: dimensiones por cabecera — PNG (IHDR) y JPEG (SOF tras otros segmentos)', () => {
  assert.deepEqual(M.rasterDimensions(png(scene(7, 5), 7, 5)), { width: 7, height: 5, mime: 'image/png' });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc4, 0x00, 0x02,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x40, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(M.rasterDimensions(jpeg), { width: 1344, height: 720, mime: 'image/jpeg' });
  assert.equal(M.rasterDimensions(new Uint8Array([1, 2, 3])), null);
});

ok('CABLEADO: el handler mide ANTES del modelo, nunca lanza por la medida, y sólo AÑADE meta', () => {
  const h = inspect.slice(inspect.indexOf('export default async function handler'));
  const mide = h.indexOf('edgeBandsOrNull(');
  const juez = h.indexOf('callJudge(');
  assert.ok(mide > 0 && juez > mide, 'la medida va antes de la llamada al juez');
  assert.ok(/meta: \{ edge_bands: bands\.edge_bands/.test(h), 'la respuesta 200 lleva meta.edge_bands');
  for (const campo of ['ok: true,', 'violated: verdict.violated,', 'unmatched: verdict.unmatched,', 'evaluated_codes: codes,', 'model,', 'usage: trace.usage,']) {
    assert.ok(h.includes(campo), `el campo existente sigue igual: ${campo}`);
  }
});

console.log(`\ninspeccion_visual: ${n} pruebas OK`);
