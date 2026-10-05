// Congela el golden de la RESPUESTA DE ÉXITO de `/api/execute`: el cuerpo JSON exacto (byte a byte,
// `image_data_url` incluido) y el cuerpo exacto que el handler manda a Vertex, en cada escenario de
// `ESCENARIOS_EXITO`. Se ejecutó UNA vez sobre `main` (ca19c85), antes del cambio del prompt del fallo.
// No forma parte de `npm test`: volver a correrlo sobre el código nuevo invalidaría la comparación.
//
// Ejecutar (sólo para regenerar a propósito, con el `api/execute.ts` de `main` en el árbol):
//   node tests/_capturar_golden_exito.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHandler, run } from './_handler_harness.mjs';
import { ESCENARIOS_EXITO } from './fixtures/prompt_de_fallo_escenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');
const sha = (s) => createHash('sha256').update(s).digest('hex');

const handler = await loadHandler(source);
const l = console.log, w = console.warn, e = console.error;
console.log = console.warn = console.error = () => {};
const out = {};
try {
  for (const esc of ESCENARIOS_EXITO) {
    const r = await run(handler, esc.body, { db: esc.db });
    out[esc.nombre] = {
      status: r.status,
      respuesta_sha256: sha(JSON.stringify(r.json)),
      vertex_imagen_sha256: sha(JSON.stringify(r.vertexImage)),
      vertex_texto_sha256: sha(JSON.stringify(r.vertexText)),
    };
  }
} finally { console.log = l; console.warn = w; console.error = e; }

const file = join(ROOT, 'tests', 'fixtures', 'respuesta_exito_golden.json');
writeFileSync(file, JSON.stringify({ _origen: 'main ca19c85 (2026-10-05), antes del prompt del fallo', escenarios: out }, null, 2) + '\n', 'utf8');
console.log(`golden de éxito: ${Object.keys(out).length} escenarios → ${file}`);
