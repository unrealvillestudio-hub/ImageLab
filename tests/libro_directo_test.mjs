// LIBRO-DIRECTO (2026-10-20) — toda llamada a Vertex de ImageLab queda en el libro UNA sola vez.
//
// Lo que este test fija, sin red (fetch se sustituye):
//   1. el bloque LIBRO-DIRECTO es idéntico en api/execute.ts, api/inspect.ts y api/compose.ts;
//   2. asentar o no asentar lo decide `ledger_by_caller === true` y nada más;
//   3. las filas: imagen (entregada, fallida, descartada), constructor de prompt, inspección y caras,
//      con las unidades del carril (`tokens_in` con entrada y salida) y sin precio inventado;
//   4. los argumentos del RPC: lab, source_app, proveedor, marca o su ausencia (LEDGER_SIN_MARCA);
//   5. un fallo del RPC, de la red o del entorno NO lanza: la respuesta sale igual;
//   6. sobre el handler real de /api/execute: con la bandera no hay ni una llamada al RPC y la respuesta
//      es idéntica a la de sin bandera; sin la bandera, se asienta; con el RPC caído, responde igual.
//
// NO reimplementa la lógica: extrae el bloque de api/execute.ts y ejecuta el handler con el arnés.
//
// Ejecutar:  node tests/libro_directo_test.mjs     (Node ≥ 22.18, type-stripping nativo)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { loadHandler, run } from './_handler_harness.mjs';
import { ESCENARIOS_EXITO } from './fixtures/prompt_de_fallo_escenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, 'api', f), 'utf8');
const SRC = { 'execute.ts': read('execute.ts'), 'inspect.ts': read('inspect.ts'), 'compose.ts': read('compose.ts') };

const B = '// ── LIBRO-DIRECTO:BEGIN ──', E = '// ── LIBRO-DIRECTO:END ──';
const block = (f) => {
  const s = SRC[f]; const i = s.indexOf(B), j = s.indexOf(E);
  assert.ok(i >= 0 && j > i, `bloque LIBRO-DIRECTO no encontrado en api/${f}`);
  return s.slice(i, j + E.length);
};
const dir = mkdtempSync(join(tmpdir(), 'libro-directo-'));
const modFile = join(dir, 'libro_block.mts');
writeFileSync(modFile, block('execute.ts') + '\n');
const L = await import(pathToFileURL(modFile).href);

const SECRETO = 'sb-clave-de-prueba-que-no-debe-salir-0123456789';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Ejecuta con la consola capturada y un fetch de fixture que registra cada llamada. */
async function conRed(responder, fn) {
  const real = globalThis.fetch;
  const calls = [];
  const logs = [];
  const l = console.log, e = console.error, w = console.warn;
  console.log = console.warn = console.error = (...a) => logs.push(a.map(String).join(' '));
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return responder(String(url), init); };
  try { return { r: await fn(), calls, logs }; }
  finally { globalThis.fetch = real; console.log = l; console.error = e; console.warn = w; }
}
const rpcCalls = (calls) => calls.filter((c) => c.url.endsWith('/rest/v1/rpc/ops_log_generation'));
const argsOf = (c) => JSON.parse(c.init.body);

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`  ✓ ${name}`); };

console.log('\n── LIBRO-DIRECTO ──');

await ok('las tres copias del bloque son idénticas', () => {
  assert.equal(block('inspect.ts'), block('execute.ts'), 'api/inspect.ts divergió de api/execute.ts');
  assert.equal(block('compose.ts'), block('execute.ts'), 'api/compose.ts divergió de api/execute.ts');
});

await ok('MULTIBRAND: el bloque no lleva literal de marca, de canal ni de modelo', () => {
  const b = block('execute.ts');
  assert.doesNotMatch(b, /gemini-|imagen-|ForumPHs|NeuroneSCF|LucienSael|UnrealvilleStudio|INSTAGRAM|FACEBOOK|LINKEDIN/i);
});

await ok('decide asentar sólo por `ledger_by_caller === true`', () => {
  assert.equal(L.ledgerByCaller({ ledger_by_caller: true }), true);
  for (const v of [false, 'true', 1, null, undefined]) assert.equal(L.ledgerByCaller({ ledger_by_caller: v }), false, String(v));
  assert.equal(L.ledgerByCaller(null), false);
  assert.equal(L.ledgerByCaller({}), false);
});

await ok('la marca de la petición: brand_id o brandId; vacía o "NULL" = sin marca', () => {
  assert.equal(L.ledgerBrandOf({ brand_id: ' M1 ' }), 'M1');
  assert.equal(L.ledgerBrandOf({ brandId: 'M2' }), 'M2');
  assert.equal(L.ledgerBrandOf({ brand_id: '', brandId: 'M3' }), 'M3');
  assert.equal(L.ledgerBrandOf({ brand_id: 'null' }), null);
  assert.equal(L.ledgerBrandOf({ prompt: 'x' }), null);
});

await ok('imagen entregada: tokens_in con promptTokenCount / candidatesTokenCount, la tarifa la pone la base', () => {
  const rows = L.ledgerRowsFromExecute({ image_data_url: 'data:image/png;base64,AA', model: 'modelo-imagen',
    usage: { promptTokenCount: 10, candidatesTokenCount: 1290 }, status: 'ok' });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { output_type: 'image', model_id: 'modelo-imagen', input_units: 10, output_units: 1290,
    status: 'success', unpriced: null, markers: [] });
  const a = L.ledgerRpcArgs(rows[0], { brandId: 'M1', brandNote: null, platform: 'CANAL_X', pieceId: null, durationMs: 1234 });
  assert.equal(a.p_lab, 'imagelab');
  assert.equal(a.p_source_app, 'imagelab-directo');
  assert.equal(a.p_provider, 'google');
  assert.equal(a.p_unit_type, 'tokens_in');
  assert.equal(a.p_model_id, 'modelo-imagen');
  assert.equal(a.p_brand_id, 'M1');
  assert.equal(a.p_job_id, null);
  assert.equal(a.p_platform, 'CANAL_X');
  assert.equal(a.p_duration_ms, 1234);
  assert.equal(a.p_error_msg, null);
  assert.ok(!('p_cost_usd' in a) && !('p_rate_source' in a), 'con consumo, el precio lo resuelve la base');
});

await ok('imagen entregada sin conteo de salida: USAGE_UNREPORTED con la marca, costo cero declarado', () => {
  const [r] = L.ledgerRowsFromExecute({ image_data_url: 'data:x', model: 'm', usage: null });
  assert.equal(r.unpriced, 'USAGE_UNREPORTED');
  const [r2] = L.ledgerRowsFromExecute({ image_data_url: 'data:x', model: 'm', usage: { promptTokenCount: 5 } });
  assert.equal(r2.unpriced, 'USAGE_UNREPORTED');
  assert.ok(r2.markers.some((m) => m.startsWith('LEDGER_USAGE_MISSING')));
  const a = L.ledgerRpcArgs(r2, { brandId: 'M1', brandNote: null, platform: null, pieceId: null, durationMs: 1 });
  assert.equal(a.p_cost_usd, 0);
  assert.equal(a.p_rate_source, 'USAGE_UNREPORTED');
});

await ok('imagen fallida: con consumo se precia como fallida; rechazo sin consumo = NOT_BILLED; no llamada = sin fila', () => {
  const [bloq] = L.ledgerRowsFromExecute({ status: 'error', model: 'm', provider_called: true, provider_http_status: 200,
    usage: { promptTokenCount: 40, candidatesTokenCount: 0 } });
  assert.equal(bloq.status, 'failed'); assert.equal(bloq.unpriced, null); assert.equal(bloq.input_units, 40);
  const [rech] = L.ledgerRowsFromExecute({ status: 'error', model: 'm', provider_called: true, provider_http_status: 429, usage: null });
  assert.equal(rech.unpriced, 'NOT_BILLED:PROVIDER_HTTP_429');
  const [tout] = L.ledgerRowsFromExecute({ status: 'error', model: 'm', provider_called: true, provider_http_status: null, usage: null });
  assert.equal(tout.unpriced, 'USAGE_UNREPORTED');
  assert.deepEqual(L.ledgerRowsFromExecute({ status: 'error', model: 'm', provider_called: false, prompt_builder_model: null }), []);
});

await ok('intentos descartados: una fila `discarded` por intento, con su consumo', () => {
  const rows = L.ledgerRowsFromExecute({ image_data_url: 'data:x', model: 'm', usage: { promptTokenCount: 1, candidatesTokenCount: 2 },
    discarded_attempts: [{ model: 'm', usage: { promptTokenCount: 3, candidatesTokenCount: 4 }, reason: 'EDGE_PLATE' }] });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].status, 'discarded');
  assert.equal(rows[1].output_units, 4);
  assert.equal(rows[1].duration_ms, 0);
  assert.deepEqual(rows[1].markers, ['IMAGE_ATTEMPT_DISCARDED:EDGE_PLATE']);
});

await ok('constructor de prompt: image_prompt en éxito, en prompt_only y en fallo del constructor', () => {
  const ok1 = L.ledgerRowsFromExecute({ image_data_url: 'data:x', model: 'm', usage: { promptTokenCount: 1, candidatesTokenCount: 2 },
    prompt_builder_model: 'modelo-texto', prompt_builder_version: '1.2', prompt_builder_usage: { promptTokenCount: 900, candidatesTokenCount: 300 } });
  const b = ok1.find((r) => r.output_type === 'image_prompt');
  assert.deepEqual(b, { output_type: 'image_prompt', model_id: 'modelo-texto', input_units: 900, output_units: 300,
    status: 'success', unpriced: null, markers: ['prompt_builder v1.2'] });
  const solo = L.ledgerRowsFromExecute({ prompt_full: 'x', prompt_builder_model: 'modelo-texto', prompt_builder_version: '1.2',
    prompt_builder_usage: { promptTokenCount: 9, candidatesTokenCount: 3 }, status: 'ok' });
  assert.deepEqual(solo.map((r) => r.output_type), ['image_prompt']);
  const falla = L.ledgerRowsFromExecute({ status: 'error', model: 'm', provider_called: false, prompt_builder_model: 'modelo-texto',
    prompt_builder_called: true, prompt_builder_failed: true, prompt_builder_http_status: 503, prompt_builder_usage: null });
  assert.deepEqual(falla.map((r) => [r.output_type, r.status, r.unpriced]), [['image_prompt', 'failed', 'NOT_BILLED:PROVIDER_HTTP_503']]);
});

await ok('inspección y caras: image_inspect por tokens; caras como `estructura`, igual que el carril', () => {
  const insp = L.ledgerCallRow({ outputType: 'image_inspect', model: 'modelo-juez', usage: { input_tokens: 2000, output_tokens: 80 }, ok: true });
  assert.deepEqual(insp, { output_type: 'image_inspect', model_id: 'modelo-juez', input_units: 2000, output_units: 80,
    status: 'success', unpriced: null, markers: [] });
  const caras = L.ledgerCallRow({ outputType: 'image_overlay_faces', model: 'modelo-caras', usage: { input_tokens: 500, output_tokens: 20 },
    ok: true, httpStatus: 200, billable: 'estructura', durationMs: 1400 });
  const a = L.ledgerRpcArgs(caras, { brandId: 'M1', brandNote: null, platform: null, pieceId: null, durationMs: 9 });
  assert.equal(a.p_billable, 'estructura');
  assert.equal(a.p_output_type, 'image_overlay_faces');
  assert.equal(a.p_duration_ms, 1400, 'la duración de la fila manda sobre la de la petición');
  const sinModelo = L.ledgerCallRow({ outputType: 'image_inspect', model: '', usage: null, ok: false, httpStatus: 500 });
  assert.equal(sinModelo.model_id, 'UNKNOWN');
  assert.equal(sinModelo.unpriced, 'NOT_BILLED:PROVIDER_HTTP_500');
});

await ok('piece_id sólo si es UUID (el RPC lo castea)', () => {
  assert.equal(L.ledgerPieceId({ piece_id: '0b7c2a6e-1f3d-4c1b-9a51-6d0e2f4a8b90' }), '0b7c2a6e-1f3d-4c1b-9a51-6d0e2f4a8b90');
  assert.equal(L.ledgerPieceId({ piece_id: 'pieza-1' }), null);
  assert.equal(L.ledgerPieceId({}), null);
});

const ROW = L.ledgerCallRow({ outputType: 'image', model: 'm', usage: { promptTokenCount: 1, candidatesTokenCount: 2 }, ok: true });
process.env.SUPABASE_URL = 'proyecto';
process.env.SUPABASE_SERVICE_ROLE_KEY = SECRETO;

await ok('con `ledger_by_caller: true` no hay red: ni marca ni RPC', async () => {
  const { r, calls } = await conRed(() => json([]), () => L.ledgerRecordDirect({ ledger_by_caller: true, brand_id: 'M1' }, [ROW], { tag: 't' }));
  assert.deepEqual(r, { skipped: true, written: 0, failed: 0 });
  assert.equal(calls.length, 0);
});

await ok('sin la bandera: verifica la marca y llama al RPC con service_role', async () => {
  const { r, calls, logs } = await conRed((u) => u.includes('/rest/v1/brands?') ? json([{ id: 'M1' }]) : json('uuid'),
    () => L.ledgerRecordDirect({ brand_id: 'M1' }, [ROW], { tag: 't', platform: 'CANAL_X', durationMs: 5 }));
  assert.deepEqual(r, { skipped: false, written: 1, failed: 0 });
  assert.match(calls[0].url, /^https:\/\/proyecto\.supabase\.co\/rest\/v1\/brands\?id=eq\.M1&select=id&limit=1$/);
  const rpc = rpcCalls(calls);
  assert.equal(rpc.length, 1);
  assert.equal(rpc[0].init.headers.Authorization, `Bearer ${SECRETO}`);
  const a = argsOf(rpc[0]);
  assert.equal(a.p_brand_id, 'M1');
  assert.equal(a.p_platform, 'CANAL_X');
  assert.equal(a.p_error_msg, null);
  assert.ok(!logs.join('\n').includes(SECRETO), 'la clave no sale en los logs');
});

await ok('sin marca: asienta igual con p_brand_id null y LEDGER_SIN_MARCA (sin consultar brands)', async () => {
  const { calls } = await conRed(() => json('uuid'), () => L.ledgerRecordDirect({ mode: 'direct', prompt: 'x' }, [ROW], { tag: 't' }));
  assert.equal(calls.length, 1);
  const a = argsOf(rpcCalls(calls)[0]);
  assert.equal(a.p_brand_id, null);
  assert.match(a.p_error_msg, /^LEDGER_SIN_MARCA: /);
});

await ok('marca que no existe en brands: p_brand_id null y LEDGER_SIN_MARCA', async () => {
  const { calls } = await conRed((u) => u.includes('/brands?') ? json([]) : json('uuid'),
    () => L.ledgerRecordDirect({ brand_id: 'NO-EXISTE' }, [ROW], { tag: 't' }));
  const a = argsOf(rpcCalls(calls)[0]);
  assert.equal(a.p_brand_id, null);
  assert.match(a.p_error_msg, /LEDGER_SIN_MARCA: la marca "NO-EXISTE"/);
});

await ok('brands no se puede leer: se conserva la marca y se dice que no se verificó', async () => {
  const { calls } = await conRed((u) => u.includes('/brands?') ? json({ message: 'x' }, 503) : json('uuid'),
    () => L.ledgerRecordDirect({ brand_id: 'M1' }, [ROW], { tag: 't' }));
  const a = argsOf(rpcCalls(calls)[0]);
  assert.equal(a.p_brand_id, 'M1');
  assert.match(a.p_error_msg, /^LEDGER_MARCA_NO_VERIFICADA/);
});

await ok('un fallo del RPC (HTTP o red) o del entorno NO lanza', async () => {
  const http = await conRed((u) => u.includes('/brands?') ? json([{ id: 'M1' }]) : json({ message: 'boom' }, 500),
    () => L.ledgerRecordDirect({ brand_id: 'M1' }, [ROW, ROW], { tag: 't' }));
  assert.deepEqual(http.r, { skipped: false, written: 0, failed: 2 });
  assert.ok(http.logs.some((x) => x.includes('ops_log_generation 500')));
  const red = await conRed(() => { throw new Error('red caída'); }, () => L.ledgerRecordDirect({ brand_id: 'M1' }, [ROW], { tag: 't' }));
  assert.equal(red.r.written, 0);
  assert.ok(!red.logs.join('\n').includes(SECRETO));
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = '';
  const env = await conRed(() => json('uuid'), () => L.ledgerRecordDirect({ brand_id: 'M1' }, [ROW], { tag: 't' }));
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  assert.equal(env.calls.length, 0);
  assert.ok(env.logs.some((x) => x.includes('LEDGER_ENV_MISSING')));
});

// ── sobre el handler real de /api/execute ─────────────────────────────────────────────────────────
const handler = await loadHandler();
const silencio = async (fn) => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {};
  try { return await fn(); } finally { console.log = l; console.warn = w; console.error = e; } };
const rpcHits = (r) => r.fetched.filter((u) => u.includes('/rest/v1/rpc/ops_log_generation')).length;
const sinImagen = (j) => Object.fromEntries(Object.entries(j ?? {}).filter(([k]) => k !== 'image_data_url'));

const conConstructor = ESCENARIOS_EXITO.find((e) => e.nombre.startsWith('carril|') && e.body?.params?.copy_full);
assert.ok(conConstructor, 'falta un escenario del carril con copy_full en las fixtures');
const ESC = [ESCENARIOS_EXITO.find((e) => e.nombre === 'direct|solo_texto'), conConstructor];

for (const esc of ESC) {
  await ok(`handler ${esc.nombre}: con la bandera no hay RPC y la respuesta es idéntica a la de sin bandera`, async () => {
    const con = await silencio(() => run(handler, { ...esc.body, ledger_by_caller: true }, { db: esc.db }));
    const sin = await silencio(() => run(handler, esc.body, { db: esc.db }));
    assert.equal(rpcHits(con), 0, 'con ledger_by_caller ImageLab no debe asentar');
    assert.equal(con.status, 200);
    assert.equal(sin.status, con.status);
    assert.deepEqual(sinImagen(sin.json), sinImagen(con.json), 'el asiento no debe cambiar la respuesta');
    const esperadas = 1 + (sin.vertexText ? 1 : 0);
    assert.equal(rpcHits(sin), esperadas, `sin la bandera se asientan ${esperadas} llamadas (imagen${sin.vertexText ? ' + constructor' : ''})`);
  });
}

await ok('handler: con el RPC caído la respuesta sale igual (200 con la imagen)', async () => {
  const esc = ESC[1];
  const db = { ...esc.db, 'rpc/ops_log_generation': () => { throw new Error('RPC caído'); } };
  const r = await silencio(() => run(handler, esc.body, { db }));
  assert.equal(r.status, 200);
  assert.ok(typeof r.json?.image_data_url === 'string' && r.json.image_data_url.startsWith('data:'));
});

await ok('handler: un fallo de imagen sin la bandera asienta la llamada fallida y responde el mismo 500', async () => {
  const esc = ESC[0];
  const BLOQ = { status: 200, body: { promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: { promptTokenCount: 12 } } };
  const sin = await silencio(() => run(handler, esc.body, { db: esc.db, image: BLOQ }));
  const con = await silencio(() => run(handler, { ...esc.body, ledger_by_caller: true }, { db: esc.db, image: BLOQ }));
  assert.equal(sin.status, 500);
  assert.deepEqual(sin.json, con.json);
  assert.equal(rpcHits(sin), 1);
  assert.equal(rpcHits(con), 0);
});

await ok('CABLEADO: inspect y compose asientan sólo una llamada hecha y por el bloque', () => {
  const i = SRC['inspect.ts'].slice(SRC['inspect.ts'].indexOf('export default async function handler'));
  assert.match(i, /if \(!trace\.called\) return;/);
  assert.match(i, /outputType: 'image_inspect'/);
  assert.ok((i.match(/await asentar\((true|false)\)/g) ?? []).length === 2, 'inspect asienta en el éxito y en el fallo');
  const c = SRC['compose.ts'].slice(SRC['compose.ts'].indexOf('export default async function handler'));
  assert.match(c, /if \(fc\.called\) \{[\s\S]*?outputType: 'image_overlay_faces'[\s\S]*?billable: 'estructura'/);
});

console.log(`\n✓ ${n} comprobaciones del libro directo`);
