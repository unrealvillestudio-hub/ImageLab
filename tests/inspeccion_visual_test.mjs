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

console.log(`\ninspeccion_visual: ${n} pruebas OK`);
