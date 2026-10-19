// EL MODELO DE CADA ROL ES DATO (2026-10-19) — MULTIBRAND_RULE.md §11.
//
// Lo que este test fija, sin red (fetch se sustituye):
//   1. el bloque MODELO-POR-ROL es idéntico en api/inspect.ts y api/compose.ts;
//   2. con fila activa, el rol usa su modelo, su ubicación y sus parámetros;
//   3. sin fila (200 y []), falla con MODEL_ROLE_UNSEEDED: nunca un modelo inventado;
//   4. sólo si la tabla no se pudo consultar (entorno, red, 5xx) cae al alias legacy, y lo dice en el log;
//   5. la caché dura LAB_MODEL_TTL_MS: un UPDATE de la fila manda sin desplegar;
//   6. la cabecera de calibración no existe en producción;
//   7. BARRERA: ningún literal de modelo nuevo en api/. La lista de abajo es la deuda que queda, exacta;
//      un literal más hace fallar el test. Es la barrera que le faltó a §11 en agosto.
//
// NO reimplementa la lógica: extrae el bloque de api/inspect.ts.
//
// Ejecutar:  node tests/modelo_por_rol_test.mjs     (Node ≥ 22.18, type-stripping nativo)

import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, 'api', f), 'utf8');
const inspect = read('inspect.ts');
const compose = read('compose.ts');

const B = '// ── MODELO-POR-ROL:BEGIN ──', E = '// ── MODELO-POR-ROL:END ──';
const block = (src, f) => {
  const i = src.indexOf(B), j = src.indexOf(E);
  assert.ok(i >= 0 && j > i, `bloque MODELO-POR-ROL no encontrado en api/${f}`);
  return src.slice(i, j + E.length);
};

const dir = mkdtempSync(join(tmpdir(), 'modelo-por-rol-'));
const mod = join(dir, 'modelo_block.mts');
writeFileSync(mod, block(inspect, 'inspect.ts') + '\n');
const M = await import(pathToFileURL(mod).href);

const LEGACY = { model: 'legacy-modelo', generationParams: { thinkingConfig: { thinkingBudget: 0 } } };
const ENV = { SUPABASE_URL: 'proyecto', SUPABASE_SERVICE_ROLE_KEY: 'llave' };

let calls = [];
let warns = [];
const origWarn = console.warn;
function stubFetch(responder) {
  calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return responder(String(url)); };
}
const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
function setEnv(env) { globalThis.process.env.SUPABASE_URL = env.SUPABASE_URL; globalThis.process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY; }

let ok = 0;
async function test(name, fn) {
  M.resetLabModelCache(); warns = [];
  console.warn = (...a) => warns.push(a.join(' '));
  try { await fn(); } finally { console.warn = origWarn; }
  ok++; console.log(`  ✓ ${name}`);
}

await test('las dos copias del bloque son idénticas', () => {
  assert.equal(block(compose, 'compose.ts'), block(inspect, 'inspect.ts'),
    'el bloque MODELO-POR-ROL de api/compose.ts divergió del de api/inspect.ts');
});

await test('con fila activa, el rol usa su modelo, su ubicación y sus parámetros', async () => {
  setEnv(ENV);
  stubFetch(() => json([{ model_id: 'modelo-de-la-fila', location: 'global', generation_params: { thinkingConfig: { thinkingLevel: 'MINIMAL' } } }]));
  const m = await M.resolveLabModel('imagelab', 'visual_inspection', LEGACY);
  assert.deepEqual(m, { model: 'modelo-de-la-fila', location: 'global',
    generationParams: { thinkingConfig: { thinkingLevel: 'MINIMAL' } }, source: 'ops_lab_models' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/proyecto\.supabase\.co\/rest\/v1\/ops_lab_models\?/);
  assert.match(calls[0].url, /lab=eq\.imagelab&role=eq\.visual_inspection&active=eq\.true/);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer llave');
  assert.equal(warns.length, 0);
});

await test('sin fila, falla con MODEL_ROLE_UNSEEDED y no inventa un modelo', async () => {
  setEnv(ENV);
  stubFetch(() => json([]));
  await assert.rejects(M.resolveLabModel('imagelab', 'face_detection', LEGACY),
    (e) => e instanceof M.ModelRoleError && e.label === 'MODEL_ROLE_UNSEEDED');
});

await test('dos filas activas, o una sin model_id, también fallan', () => {
  assert.throws(() => M.labModelFromRows([{ model_id: 'a' }, { model_id: 'b' }], 'imagelab', 'r'), /MODEL_ROLE_AMBIGUOUS/);
  assert.throws(() => M.labModelFromRows([{ model_id: '  ' }], 'imagelab', 'r'), /MODEL_ROLE_INVALID/);
  assert.deepEqual(M.labModelFromRows([{ model_id: 'a', location: null, generation_params: null }], 'imagelab', 'r').generationParams, {});
});

await test('un 5xx de la tabla cae al alias legacy y lo dice en el log', async () => {
  setEnv(ENV);
  stubFetch(() => json({ message: 'caída' }, 503));
  const m = await M.resolveLabModel('imagelab', 'visual_inspection', LEGACY);
  assert.deepEqual(m, { model: 'legacy-modelo', location: null, generationParams: LEGACY.generationParams, source: 'legacy_alias' });
  assert.ok(warns.some((w) => w.includes('MODEL_ROLE_LEGACY_ALIAS') && w.includes('503')));
});

await test('un error de red, o el entorno sin Supabase, también caen al alias legacy', async () => {
  setEnv(ENV);
  stubFetch(() => { throw new Error('ECONNRESET'); });
  assert.equal((await M.resolveLabModel('imagelab', 'visual_inspection', LEGACY)).source, 'legacy_alias');
  M.resetLabModelCache();
  setEnv({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' });
  stubFetch(() => json([{ model_id: 'no-debe-llamarse' }]));
  assert.equal((await M.resolveLabModel('imagelab', 'visual_inspection', LEGACY)).source, 'legacy_alias');
  assert.equal(calls.length, 0, 'sin entorno no se consulta nada');
});

await test('la caché dura LAB_MODEL_TTL_MS: después, el UPDATE de la fila manda', async () => {
  setEnv(ENV);
  let modelo = 'antes';
  stubFetch(() => json([{ model_id: modelo }]));
  const t = 1_000_000;
  assert.equal((await M.resolveLabModel('imagelab', 'r', LEGACY, null, t)).model, 'antes');
  modelo = 'despues';
  assert.equal((await M.resolveLabModel('imagelab', 'r', LEGACY, null, t + M.LAB_MODEL_TTL_MS - 1)).model, 'antes');
  assert.equal(calls.length, 1, 'dentro del TTL no se vuelve a consultar');
  assert.equal((await M.resolveLabModel('imagelab', 'r', LEGACY, null, t + M.LAB_MODEL_TTL_MS)).model, 'despues');
});

await test('el alias legacy no se guarda en caché: la próxima llamada vuelve a la tabla', async () => {
  setEnv(ENV);
  let caida = true;
  stubFetch(() => (caida ? json({}, 500) : json([{ model_id: 'de-la-tabla' }])));
  assert.equal((await M.resolveLabModel('imagelab', 'r', LEGACY)).source, 'legacy_alias');
  caida = false;
  assert.equal((await M.resolveLabModel('imagelab', 'r', LEGACY)).model, 'de-la-tabla');
});

await test('la calibración no existe en producción', () => {
  assert.equal(M.calibrationFromHeaders({ 'x-lab-model': 'candidato' }, 'production'), null);
  assert.deepEqual(M.calibrationFromHeaders({ 'x-lab-model': 'candidato-1.0 ;rm' }, 'preview'), { model: 'candidato-1.0rm', params: null });
  assert.deepEqual(M.calibrationFromHeaders({ 'x-lab-model': 'c', 'x-lab-model-params': '{"a":1}' }, 'preview'), { model: 'c', params: { a: 1 } });
  assert.equal(M.calibrationFromHeaders({}, 'preview'), null);
});

await test('con calibración, el modelo cambia y la ubicación sigue siendo la de la fila', async () => {
  setEnv(ENV);
  stubFetch(() => json([{ model_id: 'fila', location: 'global', generation_params: { p: 1 } }]));
  const m = await M.resolveLabModel('imagelab', 'r', LEGACY, { model: 'candidato', params: null });
  assert.deepEqual(m, { model: 'candidato', location: 'global', generationParams: { p: 1 }, source: 'calibration_header' });
});

await test('los parámetros del modelo se fusionan sobre los del rol', () => {
  assert.deepEqual(M.mergeGenerationConfig({ temperature: 0, responseMimeType: 'application/json' }, { thinkingConfig: { thinkingBudget: 0 } }),
    { temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } });
});

await test('CABLEADO: inspector y caras resuelven su rol y no fijan parámetros del modelo', () => {
  assert.match(inspect, /resolveLabModel\('imagelab', INSPECT_ROLE,/);
  assert.match(compose, /resolveLabModel\('imagelab', FACES_ROLE,/);
  assert.doesNotMatch(inspect, /process\.env\.IMAGELAB_INSPECT_MODEL/);
  assert.doesNotMatch(compose, /process\.env\.IMAGELAB_FACES_MODEL/);
  for (const [f, src] of [['inspect.ts', inspect], ['compose.ts', compose]]) {
    const fuera = src.replace(block(src, f), '');
    assert.equal((fuera.match(/thinkingConfig: \{ thinkingBudget/g) ?? []).length, 1,
      `api/${f}: thinkingBudget sólo puede aparecer en su alias legacy; el parámetro es dato de la fila`);
  }
});

// La deuda que queda, EXACTA. Para retirar una entrada: el rol pasa a leerse de ops_lab_models (PR 3).
// Para añadir una: no se añade. Un modelo nuevo es una fila de ops_lab_models, no un literal.
const DEUDA = {
  'compose.ts': ['gemini-2.5-flash'],        // alias legacy de face_detection
  'inspect.ts': ['gemini-2.5-flash'],        // alias legacy de visual_inspection
  'execute.ts': ['gemini-2.5-flash-image', 'gemini-2.5-flash-image', 'gemini-2.5-flash-image'],  // image_generation, aún sin tabla
};

await test('BARRERA: ningún literal de modelo nuevo en api/', () => {
  const lit = /['"`]((?:gemini|claude|imagen)-[a-z0-9.\-]+)['"`]/g;
  for (const f of readdirSync(join(ROOT, 'api')).filter((x) => x.endsWith('.ts'))) {
    const encontrados = [...read(f).matchAll(lit)].map((m) => m[1]).sort();
    assert.deepEqual(encontrados, [...(DEUDA[f] ?? [])].sort(),
      `api/${f}: los literales de modelo deben ser exactamente la deuda declarada. Un modelo nuevo es una fila de ops_lab_models (MULTIBRAND §11).`);
  }
});

console.log(`✓ ${ok} pruebas`);
