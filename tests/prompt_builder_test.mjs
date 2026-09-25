// BRIEF-IMG-01 fase 2 — el constructor de prompt.
//
// NO reimplementa la lógica: extrae los bloques `C:BEGIN/END` y `PB:BEGIN/END` de `api/execute.ts`
// y los ejecuta. El bloque PB usa las cláusulas del motor, que viven en C: por eso van los dos.
//
// Ejecutar:  node tests/prompt_builder_test.mjs     (Node ≥ 22.18, type-stripping nativo)

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
const fb = source.match(/const FALLBACK_NEGATIVE = '[^']*';/);
assert.ok(fb, 'no se pudo extraer FALLBACK_NEGATIVE');

const dir = mkdtempSync(join(tmpdir(), 'pb-block-'));
const mod = join(dir, 'pb_block.mts');
writeFileSync(mod, `${fb[0]}\n\n${block('C')}\n\n${block('PB')}\nexport { NO_TEXT_CLAUSE, DISTINCT_SUBJECTS_CLAUSE };\n`, 'utf8');
const M = await import(pathToFileURL(mod).href);

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };

// 1 · Sin copy entero no hay síntesis: el camino de hoy queda intacto.
ok('shouldSynthesize exige copy_full no vacío', () => {
  assert.equal(M.shouldSynthesize({}), false);
  assert.equal(M.shouldSynthesize({ copy_full: '   ' }), false);
  assert.equal(M.shouldSynthesize(null), false);
  assert.equal(M.shouldSynthesize({ copy_full: 'texto' }), true);
});

// 2 · Las directrices se ACUMULAN en orden; sólo se quitan vacías y repeticiones consecutivas.
ok('normalizeDirectives conserva el orden y no pisa', () => {
  assert.deepEqual(M.normalizeDirectives(['a', '', 'b', 'b', 'a', null, 3]), ['a', 'b', 'a']);
  assert.deepEqual(M.normalizeDirectives('no-array'), []);
});

// 3 · La persona entra SÓLO si se la nombra, por nombre o alias, palabra completa.
const PERSONA = { name: 'Nombre Persona', aliases: ['Alias'], description: 'descripcion fisica', reference_image_urls: ['https://x/a.png'] };
ok('personaMentioned: nombre, alias, palabra completa, sin mayúsculas', () => {
  assert.equal(M.personaMentioned(PERSONA, ['aquí aparece nombre persona mirando']), true);
  assert.equal(M.personaMentioned(PERSONA, ['el ALIAS mira']), true);
  assert.equal(M.personaMentioned(PERSONA, ['Aliasing no es el alias']), true);   // «alias» suelto sí
  assert.equal(M.personaMentioned(PERSONA, ['Aliasing solamente']), false);        // subcadena no
  assert.equal(M.personaMentioned(PERSONA, ['nadie']), false);
  assert.equal(M.personaMentioned(null, ['Nombre Persona']), false);
});

// 4 · El mensaje lleva el copy ENTERO (más allá del carácter 180) y TODAS las directrices, en orden.
ok('buildBuilderUserMessage lleva el copy entero y las directrices acumuladas', () => {
  const copy = 'x'.repeat(200) + ' FINAL_DEL_COPY';
  const msg = M.buildBuilderUserMessage({
    basePrompt: 'BASE', copyFull: copy, title: 'T', imageHook: 'H',
    directives: ['primera', 'segunda', 'tercera'], persona: null, mode: 'regenerate_full',
  });
  assert.ok(msg.includes('FINAL_DEL_COPY'), 'el copy llega entero, no sus 180 primeros caracteres');
  assert.ok(msg.indexOf('1. primera') < msg.indexOf('2. segunda') && msg.indexOf('2. segunda') < msg.indexOf('3. tercera'));
  assert.ok(msg.includes('BASE') && msg.includes('PIECE — TITLE:\nT') && msg.includes('never drawn):\nH'));
  assert.ok(!msg.includes('PERSONA'), 'sin persona no hay bloque de persona');
});

ok('buildBuilderUserMessage añade la persona sólo si se la nombra', () => {
  const sin = M.buildBuilderUserMessage({ basePrompt: 'B', copyFull: 'nada', persona: PERSONA });
  const con = M.buildBuilderUserMessage({ basePrompt: 'B', copyFull: 'nada', directives: ['pon a Nombre Persona detrás'], persona: PERSONA });
  assert.ok(!sin.includes('PERSONA'));
  assert.ok(con.includes('PERSONA') && con.includes('descripcion fisica') && con.includes('reference photo'));
});

// 5 · Las cláusulas del motor sobreviven a la síntesis, literales y en su orden.
ok('enforceEngineClauses repone las cláusulas que falten, en orden', () => {
  const C = [M.NO_TEXT_CLAUSE, M.DISTINCT_SUBJECTS_CLAUSE];
  const out = M.enforceEngineClauses('A scene of a chessboard.', C);
  assert.ok(out.indexOf(M.NO_TEXT_CLAUSE) === 0);
  assert.ok(out.indexOf(M.DISTINCT_SUBJECTS_CLAUSE) > 0 && out.endsWith('A scene of a chessboard.'));
  const ya = `${M.NO_TEXT_CLAUSE}. ${M.DISTINCT_SUBJECTS_CLAUSE}. Escena.`;
  assert.equal(M.enforceEngineClauses(ya, C), ya, 'si ya están, no se duplican');
});

// 6 · El rol de las imágenes se dice en lenguaje natural y distingue editar de referenciar.
ok('imageRoleClause', () => {
  assert.equal(M.imageRoleClause({ hasSource: false, personaName: null, personaRefs: 0 }), '');
  assert.ok(M.imageRoleClause({ hasSource: true, personaName: null, personaRefs: 0 }).startsWith('The FIRST attached image'));
  const both = M.imageRoleClause({ hasSource: true, personaName: 'P', personaRefs: 2 });
  assert.ok(both.includes('The other attached image(s) show P'));
  assert.ok(M.imageRoleClause({ hasSource: false, personaName: 'P', personaRefs: 1 }).startsWith('The attached image(s) show P'));
});

// 7 · MULTIMARCA: el bloque no nombra marcas ni personas reales.
ok('el bloque PB no contiene literales de marca', () => {
  const pb = block('PB');
  for (const lit of ['Lucien', 'LucienSael', 'Neurone', 'ForumPHs', 'Unrealville', 'Patricia']) {
    assert.ok(!pb.includes(lit), `literal de marca en PB: ${lit}`);
  }
});

console.log(`\n✅ prompt_builder_test — ${n} bloques OK`);
