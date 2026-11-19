// REFERENCIAS POR ATRIBUTO (2026-11-19): las fotos de referencia sirven a cualquier regla que compare a una persona
// de la escena con SU referencia. Las reglas de identidad siguen ignorando el peinado; una regla que nombra otro
// atributo (p. ej. el volumen del pelo) se juzga sólo sobre ese atributo. Origen: el vídeo de presentación de una
// persona real salió con el pelo un 29 % más ancho que su tarjeta, y la cláusula anterior impedía al juez mirarlo.
//
// NO reimplementa la lógica: extrae el bloque `INSPECCION` de `api/inspect.ts`.
// Ejecutar:  node tests/referencia_por_atributo_test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'api', 'inspect.ts'), 'utf8');
const b = '// ── INSPECCION:BEGIN ──', e = '// ── INSPECCION:END ──';
const i = src.indexOf(b), j = src.indexOf(e);
assert.ok(i >= 0 && j > i, 'bloque INSPECCION no encontrado');
const dir = mkdtempSync(join(tmpdir(), 'ref-atributo-'));
const mod = join(dir, 'b.mts');
writeFileSync(mod, src.slice(i, j + e.length), 'utf8');
const M = await import(pathToFileURL(mod).href);

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓', name); } catch (err) { fail++; console.log('  ✗', name, '—', err.message); } };

const refs = [{ name: 'Persona A', person_id: 'p-1', image_urls: ['https://x/a.jpg'] }];
const c = M.referencesClause(refs);

t('1 · la identidad sigue ignorando ropa y peinado', () => {
  assert.match(c, /same individual/);
  assert.match(c, /Ignore clothing, hairstyle/);
});
t('2 · una regla que nombra otro atributo se juzga contra la referencia de la misma persona', () => {
  assert.match(c, /explicitly names another attribute to compare with the reference/);
  assert.match(c, /volume of the hair/);
  assert.match(c, /judged on that attribute only/);
});
t('3 · ya no limita las referencias SÓLO a la identidad', () => {
  assert.doesNotMatch(c, /ONLY for rules about whether a person in the scene is that same individual/);
});
t('4 · MULTIMARCA: la cláusula no nombra personas ni marcas; la etiqueta sale del dato', () => {
  assert.match(c, /Persona A \[person_id p-1\]/);
  assert.doesNotMatch(src.slice(i, j), /Ivette|ForumPHs|NeuroneSCF|Patricia/);
});
t('5 · el prompt la incluye sólo con referencias', () => {
  const rules = [{ code: 'R-1', statement: 's' }];
  assert.match(M.buildInspectPrompt({ rules, copy: null, references: refs }).user, /volume of the hair/);
  assert.doesNotMatch(M.buildInspectPrompt({ rules, copy: null }).user, /volume of the hair/);
});
console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
