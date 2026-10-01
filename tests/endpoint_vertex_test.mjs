// ENDPOINT VERTEX: LA UBICACIÓN `global` NO LLEVA PREFIJO DE REGIÓN (2026-10-01).
//
// Lo que este test fija, sin red:
//   1. una región arma `{region}-aiplatform.googleapis.com`, igual que antes del cambio;
//   2. `global` arma `aiplatform.googleapis.com` (NO `global-aiplatform...`, que no existe);
//   3. una ubicación vacía falla fuerte en vez de armar una URL rota;
//   4. el CABLEADO: ninguna URL de Vertex de `api/execute.ts` arma el host a mano.
//
// NO reimplementa la lógica: extrae el bloque `ENDPOINT-VERTEX` de `api/execute.ts`.
//
// Ejecutar:  node tests/endpoint_vertex_test.mjs     (Node ≥ 22.18, type-stripping nativo)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');

const b = '// ── ENDPOINT-VERTEX:BEGIN ──', e = '// ── ENDPOINT-VERTEX:END ──';
const i = source.indexOf(b), j = source.indexOf(e);
assert.ok(i >= 0 && j > i, 'bloque ENDPOINT-VERTEX no encontrado en api/execute.ts');

const dir = mkdtempSync(join(tmpdir(), 'endpoint-vertex-'));
const mod = join(dir, 'endpoint_block.mts');
writeFileSync(mod, source.slice(i, j + e.length));
const { vertexBaseUrl } = await import(pathToFileURL(mod).href);

let ok = 0;
function test(name, fn) { fn(); ok++; console.log(`  ✓ ${name}`); }

test('una región conserva el host regional de siempre', () => {
  assert.equal(vertexBaseUrl('us-central1', 'p-1'),
    'https://us-central1-aiplatform.googleapis.com/v1/projects/p-1/locations/us-central1');
});

test('`global` usa el host sin prefijo', () => {
  assert.equal(vertexBaseUrl('global', 'p-1'),
    'https://aiplatform.googleapis.com/v1/projects/p-1/locations/global');
});

test('espacios alrededor de la ubicación no rompen el host', () => {
  assert.equal(vertexBaseUrl(' global ', 'p-1'),
    'https://aiplatform.googleapis.com/v1/projects/p-1/locations/global');
});

test('una ubicación vacía falla fuerte', () => {
  assert.throws(() => vertexBaseUrl('', 'p-1'), /VERTEX_LOCATION_EMPTY/);
  assert.throws(() => vertexBaseUrl(undefined, 'p-1'), /VERTEX_LOCATION_EMPTY/);
});

test('ninguna URL de Vertex arma el host a mano', () => {
  const fuera = source.slice(0, i) + source.slice(j + e.length);
  assert.ok(!/\$\{GCP_LOCATION\(\)\}-aiplatform/.test(fuera),
    'hay una URL que arma `${GCP_LOCATION()}-aiplatform` fuera del bloque: con `global` sería un host inexistente');
  assert.ok((fuera.match(/vertexBaseUrl\(GCP_LOCATION\(\), GCP_PROJECT\(\)\)/g) ?? []).length >= 2,
    'las URLs de texto e imagen deben pasar por vertexBaseUrl');
});

console.log(`\nendpoint_vertex: ${ok} pruebas OK`);
