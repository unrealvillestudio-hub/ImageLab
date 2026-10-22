// Congela `fixtures/lugar_exacto_golden.json` con el handler de un texto fuente dado (por defecto, `main`).
// Uso: node tests/_capturar_golden_lugar.mjs [rev]      (rev por defecto: origin/main)
// No es un test: se corre una vez, sobre `main`, y el JSON se commitea.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadHandler, run, vertexDigest } from './_handler_harness.mjs';
import { DB } from './fixtures/personas_escenarios.mjs';
import { EXACTOS } from './fixtures/lugar_escenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rev = process.argv[2] ?? 'origin/main';
const handler = await loadHandler(execFileSync('git', ['show', `${rev}:api/execute.ts`], { cwd: ROOT, encoding: 'utf8' }));
const out = {};
const l = console.log, w = console.warn, e = console.error;
console.log = console.warn = console.error = () => {};
try { for (const [k, body] of Object.entries(EXACTOS)) out[k] = vertexDigest(await run(handler, body, { db: DB })); }
finally { console.log = l; console.warn = w; console.error = e; }
writeFileSync(join(ROOT, 'tests', 'fixtures', 'lugar_exacto_golden.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`golden de ${Object.keys(out).length} escenarios desde ${rev}`);
