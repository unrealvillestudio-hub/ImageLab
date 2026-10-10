// Congela el golden de la franja y el encuadre POR CANAL: el cuerpo exacto que el handler manda a
// Vertex en cada (forma × canal × base sin dato activo), y la lista de cláusulas del motor para una
// rejilla de argumentos. Se ejecutó UNA vez sobre `main` (35eccca), antes del cambio.
// No forma parte de `npm test`: volver a correrlo sobre el código nuevo invalidaría la comparación.
// RECAPTURADO el 2026-10-10 a propósito, por el ancla de rostro (`personaFaceAnchorClause`): antes de
// recapturar se comprobó que cada corrida del handler, quitada esa cláusula, da el hash anterior
// (96 con ancla, 48 idénticas, 0 con otra diferencia). Las 128 listas del motor no cambian.
//
// Ejecutar (sólo para regenerar a propósito, con el `api/execute.ts` de `main` en el árbol):
//   node tests/_capturar_golden_canal.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadHandler, run, vertexDigest } from './_handler_harness.mjs';
import { GOLDEN_DBS, CANALES, FORMAS, req } from './fixtures/canal_layout_escenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');

// 1 · el handler
const handler = await loadHandler(source);
const quiet = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };
const handlerOut = {};
/** Los cuerpos enteros pesan 1,9 MB: se guarda el sha256 de cada uno, que es igual de exacto. */
const digestHash = (d) => createHash('sha256').update(JSON.stringify(d)).digest('hex');
const restore = quiet();
try {
  for (const [db, DB] of Object.entries(GOLDEN_DBS)) {
    for (const canal of CANALES) {
      for (const [forma, params] of Object.entries(FORMAS)) {
        handlerOut[`${db}|${canal ?? '∅'}|${forma}`] = digestHash(vertexDigest(await run(handler, req(canal, params), { db: DB })));
      }
    }
  }
} finally { restore(); }

// 2 · las cláusulas del motor (bloques C y PB, puros)
function block(tag) {
  const b = `// ── ${tag}:BEGIN ──`, e = `// ── ${tag}:END ──`;
  return source.slice(source.indexOf(b), source.indexOf(e) + e.length);
}
const fb = source.match(/const FALLBACK_NEGATIVE = '[^']*';/);
const dir = mkdtempSync(join(tmpdir(), 'golden-canal-'));
const mod = join(dir, 'blocks.mts');
writeFileSync(mod, `${fb[0]}\n\n${block('C')}\n\n${block('PB')}\n`, 'utf8');
const M = await import(pathToFileURL(mod).href);
const engineOut = {};
for (const mode of ['regenerate_full', 'edit_from_current']) {
  for (const personaCount of [0, 1, 2, 3]) {
    for (const textZone of ['', 'TEXTZONE']) {
      for (const placement of ['', 'PLACEMENT']) {
        for (const productInScene of [false, true]) {
          for (const gaze of [null, 'each_other']) {
            const args = { mode, textZone, personaCount, gaze, placement, productInScene, productComposited: !productInScene, angleSeed: 'semilla', allowedSceneText: personaCount === 3 ? ['ABIERTO'] : null };
            engineOut[JSON.stringify(args)] = digestHash(M.engineClausesFor(args));
          }
        }
      }
    }
  }
}

const file = join(ROOT, 'tests', 'fixtures', 'canal_layout_golden.json');
writeFileSync(file, JSON.stringify({ handler: handlerOut, engine: engineOut }, null, 1) + '\n');
console.log(`golden: ${Object.keys(handlerOut).length} corridas del handler y ${Object.keys(engineOut).length} listas del motor → ${file}`);
