// Congela el golden de 1.13.1 (LA CARA MANDA): la elección del overlay y su escena, SIN `avoid_people`, con el compositor
// de 1.12.0 (commit 1835e62, PR #73) y con el de 1.13.0 (commit 7307254, PR #75), sobre los casos medidos a mano de
// `fixtures/la_cara_manda_casos.mjs`; y, para la figura de pie a un lado (la que 1.13.0 resolvió bien), la de 1.13.0 CON
// `avoid_people` en la forma de 20261022150000. Se ejecutó UNA vez el 2026-10-22, antes de mergear 1.13.1. No forma parte de
// `npm test`: lee los commits con `git show`, así que sólo corre dentro de un clon del repo.
//
// Ejecutar (sólo para regenerar a propósito):  node tests/_capturar_golden_cara.mjs

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { digestOverlay } from './fixtures/la_cara_manda_digest.mjs';
import { CASOS, DE_PIE, GLOBAL_HOY, globalCon, AVOID_PEOPLE_1130_LAYOUT } from './fixtures/la_cara_manda_casos.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BEGIN = '// ── COMPOSITOR:BEGIN ──', END = '// ── COMPOSITOR:END ──';
const REFS = { '1.12.0': '1835e62', '1.13.0': '7307254' };
const out = {};
for (const [version, ref] of Object.entries(REFS)) {
  const src = execFileSync('git', ['-C', ROOT, 'show', `${ref}:api/compose.ts`], { maxBuffer: 1 << 26 }).toString();
  const dir = mkdtempSync(join(tmpdir(), `golden-cara-${version}-`));
  writeFileSync(join(dir, 'block.mts'), src.slice(src.indexOf(BEGIN), src.indexOf(END) + END.length) + '\n', 'utf8');
  const M = await import(pathToFileURL(join(dir, 'block.mts')).href);
  out[version] = { ref, casos: Object.fromEntries(CASOS.map((c) => [c.id, digestOverlay(M, c, GLOBAL_HOY)])) };
  if (version === '1.13.0') {
    out['1.13.0+avoid_people'] = { ref, casos: Object.fromEntries(DE_PIE.map((c) => [c.id, digestOverlay(M, c, globalCon(AVOID_PEOPLE_1130_LAYOUT))])) };
  }
}
const file = join(ROOT, 'tests', 'fixtures', 'la_cara_manda_golden.json');
writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log(`golden: ${CASOS.length} casos × ${Object.keys(REFS).length} versiones + ${DE_PIE.length} de pie con avoid_people → ${file}`);
