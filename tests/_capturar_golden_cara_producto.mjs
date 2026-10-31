// Congela el golden de 1.23.0 (LA CARA ANTES QUE EL PRODUCTO): la salida del compositor 1.22.0 (commit ce88b3d, PR #86)
// sobre los casos medidos a mano del overlay (`fixtures/la_cara_manda_casos.mjs`, sin y con `avoid_people`) y sobre las
// combinaciones de lámina de `fixtures/cara_antes_que_producto_casos.mjs`. El test compara 1.23.0 contra esto: donde una
// colocación libra cara y producto, o 1.22.0 ya libraba la cara, la salida es IDÉNTICA. Se ejecutó UNA vez el 2026-10-31,
// antes de mergear 1.23.0. No forma parte de `npm test`: lee el commit con `git show`, así que sólo corre dentro de un clon.
//
// Ejecutar (sólo para regenerar a propósito):  node tests/_capturar_golden_cara_producto.mjs

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CASOS, GLOBAL_HOY, globalCon } from './fixtures/la_cara_manda_casos.mjs';
import { digestOverlayCara, digestLamina, COMBOS_LAMINA } from './fixtures/cara_antes_que_producto_casos.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BEGIN = '// ── COMPOSITOR:BEGIN ──', END = '// ── COMPOSITOR:END ──';
const REF = 'ce88b3d';
const src = execFileSync('git', ['-C', ROOT, 'show', `${REF}:api/compose.ts`], { maxBuffer: 1 << 26 }).toString();
const dir = mkdtempSync(join(tmpdir(), 'golden-cara-producto-'));
writeFileSync(join(dir, 'block.mts'), src.slice(src.indexOf(BEGIN), src.indexOf(END) + END.length) + '\n', 'utf8');
const M = await import(pathToFileURL(join(dir, 'block.mts')).href);
if (M.COMPOSITOR_VERSION !== '1.22.0') throw new Error(`se esperaba 1.22.0 en ${REF}; llegó ${M.COMPOSITOR_VERSION}`);
const out = { '1.22.0': { ref: REF,
  overlay: Object.fromEntries(CASOS.map((c) => [c.id, digestOverlayCara(M, c, GLOBAL_HOY)])),
  overlay_avoid_people: Object.fromEntries(CASOS.map((c) => [c.id, digestOverlayCara(M, c, globalCon())])),
  lamina: Object.fromEntries(COMBOS_LAMINA.map((k) => [k.key, digestLamina(M, k.politica, k.escena, k.textPlace)])),
} };
const file = join(ROOT, 'tests', 'fixtures', 'cara_antes_que_producto_golden.json');
writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log(`golden 1.22.0: ${CASOS.length} casos de overlay × 2 + ${COMBOS_LAMINA.length} combinaciones de lámina → ${file}`);
