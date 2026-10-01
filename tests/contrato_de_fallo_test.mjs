// CONTRATO DE FALLO PARA EL LIBRO MAYOR (2026-10-01).
//
// EL DEFECTO. Un 500 de `/api/execute` devolvía `{ error, status }` y nada más. El carril
// (content-run-stage) asentaba cada imagen fallida con `model_id='UNKNOWN'` y `rate_source='UNSEEDED'`:
// 187 filas desde el 2026-07-30 [medido en public.ops_generation_ledger el 2026-10-01]. No podía
// distinguir un rechazo del proveedor (429, que no trae consumo) de una respuesta 2xx bloqueada (que
// sí reporta `usageMetadata`), ni asentar el constructor de prompt que corrió y cobró antes del fallo.
//
// Lo que este test fija, sin red:
//   1. una respuesta 2xx sin imagen conserva su `usageMetadata` dentro del error (antes se perdía);
//   2. un rechazo HTTP del proveedor viaja con su código y sin consumo;
//   3. un timeout o una red caída es «llamada hecha, sin respuesta»: código null, sin consumo;
//   4. el cuerpo del fallo nombra el modelo, la llamada que falló y el constructor que corrió;
//   5. el CABLEADO: el handler arma TODOS sus fallos con `failurePayload`, y el constructor queda
//      declarado antes de llamarse.
//
// NO reimplementa la lógica: extrae los bloques `FALLO` y `RESPUESTA-IMAGEN` de `api/execute.ts`.
//
// Ejecutar:  node tests/contrato_de_fallo_test.mjs     (Node ≥ 22.18, type-stripping nativo)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');

function block(tag) {
  const b = `// ── ${tag}:BEGIN ──`, e = `// ── ${tag}:END ──`;
  const i = source.indexOf(b), j = source.indexOf(e);
  assert.ok(i >= 0 && j > i, `bloque ${tag} no encontrado en api/execute.ts`);
  return source.slice(i, j + e.length);
}
const modelo = source.match(/const GEMINI_IMAGE_MODEL = '[^']*';/);
assert.ok(modelo, 'no se pudo extraer GEMINI_IMAGE_MODEL');

const dir = mkdtempSync(join(tmpdir(), 'fallo-block-'));
const mod = join(dir, 'fallo_block.mts');
writeFileSync(mod, `${modelo[0]}\n\n${block('FALLO')}\n\n${block('RESPUESTA-IMAGEN')}\n` +
  'export { ProviderCallError, asProviderCallError, failurePayload, imageFromResponse, GEMINI_IMAGE_MODEL };\n', 'utf8');
const M = await import(pathToFileURL(mod).href);

// Los bloques son puros: ni red ni entorno.
for (const tag of ['FALLO', 'RESPUESTA-IMAGEN']) {
  const code = block(tag).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const efecto of ['fetch(', 'process.env', 'await ']) assert.ok(!code.includes(efecto), `${tag} contiene un efecto: ${efecto}`);
}

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const silenciar = (fn) => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };

const USAGE = { promptTokenCount: 812, candidatesTokenCount: 0, totalTokenCount: 812 };

ok('una respuesta 2xx bloqueada conserva su consumo dentro del error', () => {
  const bloqueada = { promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: USAGE };
  let err;
  try { silenciar(() => M.imageFromResponse(bloqueada, 200)); } catch (e) { err = e; }
  assert.ok(err instanceof M.ProviderCallError, 'debe lanzar ProviderCallError');
  assert.equal(err.step, 'image');
  assert.equal(err.httpStatus, 200);
  assert.deepEqual(err.usage, USAGE);
  assert.match(err.message, /blockReason=SAFETY/, 'el motivo legible no se pierde');
});

ok('una respuesta 2xx con imagen sigue devolviendo imagen y consumo, como hasta hoy', () => {
  const buena = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }], usageMetadata: USAGE };
  const r = silenciar(() => M.imageFromResponse(buena, 200));
  assert.equal(r.image_data_url, 'data:image/png;base64,AAAA');
  assert.deepEqual(r.usage, USAGE);
});

ok('timeout y red caída: llamada hecha, sin respuesta — código null y sin consumo', () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const t = M.asProviderCallError(abort, 'image', 'Gemini image timeout after 55s.');
  assert.equal(t.httpStatus, null);
  assert.equal(t.usage, null);
  assert.equal(t.message, 'Gemini image timeout after 55s.');
  const red = M.asProviderCallError(new TypeError('fetch failed'), 'prompt_builder', 'x');
  assert.equal(red.step, 'prompt_builder');
  assert.equal(red.httpStatus, null);
  // Uno ya formado se respeta tal cual: el 429 no se convierte en «sin respuesta».
  const rechazo = new M.ProviderCallError('Gemini image error 429: …', 'image', 429, null);
  assert.equal(M.asProviderCallError(rechazo, 'image', 'x'), rechazo);
});

ok('el cuerpo del fallo de imagen: modelo, código del proveedor, consumo y el constructor que ya cobró', () => {
  const builder = { version: '3', model: 'modelo-de-texto', usage: { promptTokenCount: 2100, candidatesTokenCount: 230 } };
  const p = M.failurePayload(new M.ProviderCallError('Gemini image error 429: …', 'image', 429, null), builder);
  assert.equal(p.status, 'error');
  assert.equal(p.model, M.GEMINI_IMAGE_MODEL);
  assert.equal(p.provider_called, true);
  assert.equal(p.provider_http_status, 429);
  assert.equal(p.usage, null);
  assert.equal(p.prompt_builder_called, true);
  assert.equal(p.prompt_builder_failed, false);
  assert.equal(p.prompt_builder_model, 'modelo-de-texto');
  assert.deepEqual(p.prompt_builder_usage, builder.usage);
});

ok('un fallo del CONSTRUCTOR no se atribuye a la imagen, que nunca se llamó', () => {
  const builder = { version: '3', model: 'modelo-de-texto', usage: null };
  const p = M.failurePayload(new M.ProviderCallError('PROMPT_BUILDER_TIMEOUT after 55s.', 'prompt_builder', null, null), builder);
  assert.equal(p.provider_called, false, 'la imagen no se llamó');
  assert.equal(p.provider_http_status, null);
  assert.equal(p.prompt_builder_called, true);
  assert.equal(p.prompt_builder_failed, true);
  assert.equal(p.prompt_builder_http_status, null, 'timeout: sin respuesta');
  // Un constructor que respondió 2xx sin texto SÍ reporta consumo, y viaja.
  const vacio = M.failurePayload(new M.ProviderCallError('PROMPT_BUILDER_EMPTY', 'prompt_builder', 200, { promptTokenCount: 900 }), builder);
  assert.deepEqual(vacio.prompt_builder_usage, { promptTokenCount: 900 });
  assert.equal(vacio.prompt_builder_http_status, 200);
});

ok('un fallo antes de toda llamada paga lo dice: nada se llamó', () => {
  const p = M.failurePayload(new Error('IMAGE_FETCH_FAILED 400: https://x'), null);
  assert.equal(p.provider_called, false);
  assert.equal(p.prompt_builder_called, false);
  assert.equal(p.usage, null);
  assert.equal(p.prompt_builder_usage, null);
});

// ── el cableado, sobre el handler sin comentarios (CC_PROTOCOL §14.1) ─────────────────────────
const sinComentarios = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const handler = sinComentarios.slice(sinComentarios.indexOf('export default async function handler'));

ok('TODO fallo del handler sale por failurePayload: ni un `{ error: … }` suelto de 400 o 500', () => {
  const sueltos = handler.match(/res\.status\((?:400|500)\)\.json\(\{\s*error/g) ?? [];
  // Los dos «Invalid JSON» son anteriores a toda lógica y no llegan al carril con un cuerpo válido;
  // se cuentan para que un tercero no entre sin que alguien lo decida.
  assert.equal(sueltos.length, 2, `fallos sin contrato: ${sueltos.length}`);
  assert.ok((handler.match(/failurePayload\(/g) ?? []).length >= 5, 'faltan llamadas a failurePayload');
  assert.match(handler, /res\.status\(500\)\.json\(failurePayload\(err, builder\)\)/, 'el catch final no pasa el constructor');
});

ok('el constructor se declara antes del try y se nombra ANTES de llamarlo', () => {
  const iDecl = handler.indexOf('let builder:');
  const iTry = handler.indexOf('try {', iDecl);
  assert.ok(iDecl >= 0 && iTry > iDecl, '`builder` debe vivir fuera del try');
  const iPre = handler.indexOf('builder = { version: v.version, model: v.model_id, usage: null }');
  const iCall = handler.indexOf('await vertexGenerateText(');
  assert.ok(iPre >= 0 && iCall > iPre, 'el constructor debe quedar nombrado antes de la llamada');
});

ok('las llamadas pagas lanzan ProviderCallError, no Error a secas', () => {
  for (const marca of ['PROMPT_BUILDER_MODEL_ERROR', 'Gemini image error', 'Gemini image (multimodal) error']) {
    const linea = sinComentarios.split('\n').find((l) => l.includes(marca));
    assert.ok(linea && /new ProviderCallError\(/.test(linea), `${marca} no lanza ProviderCallError`);
  }
  assert.equal((sinComentarios.match(/return imageFromResponse\(data, res\.status\)/g) ?? []).length, 2,
    'las dos llamadas de imagen deben leer el consumo antes de buscar la imagen');
});

console.log(`\ncontrato de fallo: ${n} comprobaciones OK`);
