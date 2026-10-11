// Congela el golden de UNA persona: el cuerpo exacto que el handler manda hoy a Vertex en cada
// escenario `N1`. Se ejecutó UNA vez sobre `main` (fcc9bf4), antes del cambio de `personas[]`.
// No forma parte de `npm test`: volver a correrlo sobre el código nuevo invalidaría la comparación.
// RECAPTURADO el 2026-10-10 a propósito, por el ancla de rostro (`personaFaceAnchorClause`): antes de
// recapturar se comprobó que cada escenario, quitada esa cláusula, es idéntico al golden anterior
// (7 con ancla, 4 idénticos, 0 con otra diferencia).
//
// Ejecutar (sólo para regenerar a propósito, sobre `main`):  node tests/_capturar_golden_personas.mjs

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHandler, run, vertexDigest } from './_handler_harness.mjs';
import { N1, DB } from './fixtures/personas_escenarios.mjs';

const handler = await loadHandler();
const out = {};
for (const [name, body] of Object.entries(N1)) out[name] = vertexDigest(await run(handler, body, { db: DB }));
const file = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'personas_n1_golden.json');
writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log(`golden: ${Object.keys(out).length} escenarios → ${file}`);
