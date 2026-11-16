// LA OPCIÓN DE VESTUARIO PUEDE SER UN OBJETO (2026-11-15) — `{ outfit, mark?, garment_tone? }`.
//
// Qué fija, sin red:
//   1. Con sólo cadenas, todo es lo de antes: misma lista, misma opción por semilla, mismo bloque.
//   2. Opciones mixtas y todas objeto: ninguna se descarta; el texto sale de `outfit`; el bloque es el de
//      «la prenda ya elegida», nunca el «varía» (el defecto medido el 2026-11-14).
//   3. Una opción con marca se pide LISA (el logo se aplica después).
//   4. `wardrobeChoicesFor` devuelve la opción elegida entera, con la misma semilla que el bloque; al editar, nada.
//   5. El handler: `wardrobe_choices` sólo cuando alguna opción elegida lleva marca.
//   6. Regresión inyectada: con el filtro viejo (sólo cadenas), el caso 2 se pone en rojo.
//
// Persona y marca inventadas (otro rubro, otro país). Ejecutar: node tests/vestuario_con_marca_test.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { loadHandler, run } from './_handler_harness.mjs';
import { DB, req } from './fixtures/personas_escenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');
async function load(src) {
  const block = (tag) => {
    const b = `// ── ${tag}:BEGIN ──`, e = `// ── ${tag}:END ──`;
    const i = src.indexOf(b), j = src.indexOf(e);
    assert.ok(i >= 0 && j > i, `bloque ${tag} no encontrado`);
    return src.slice(i, j + e.length);
  };
  const fb = src.match(/const FALLBACK_NEGATIVE = '[^']*';/);
  const dir = mkdtempSync(join(tmpdir(), 'vestuario-marca-'));
  const mod = join(dir, 'b.mts');
  writeFileSync(mod, `${fb[0]}\n\n${block('C')}\n\n${block('PB')}\n`, 'utf8');
  return import(pathToFileURL(mod).href);
}
const M = await load(source);

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`  ✓ ${name}`); };
const silence = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };

const BASE = { name: 'Teodora Quispe', aliases: ['Teodora'], description: 'woman in her fifties, short grey hair', reference_image_urls: ['https://cdn.example.invalid/p/teo_1.png'] };
const STRINGS = [{ when: 'at the shop', outfit: 'work clothes', options: ['a denim shirt', 'a grey apron over a white tee', 'a navy boiler suit'] }];
const MIXED = [{ when: 'at the shop', outfit: 'work clothes', options: ['a denim shirt', { outfit: 'a black polo shirt', mark: 'primary_logo', garment_tone: 'dark' }, { outfit: 'a white polo shirt', mark: 'primary_logo', garment_tone: 'light' }] }];
const OBJECTS = [{ when: 'at the shop', outfit: 'work clothes', options: [{ outfit: 'a black polo shirt', mark: 'primary_logo', garment_tone: 'dark' }, { outfit: 'a white polo shirt', mark: 'primary_logo', garment_tone: 'light' }] }];

console.log('── 1 · sólo cadenas: lo de antes ──');
await ok('misma lista y misma opción por semilla que el filtro anterior', () => {
  const viejo = (e) => (Array.isArray(e?.options) ? e.options.filter((o) => typeof o === 'string' && !!o.trim()).map((o) => o.trim()) : []);
  for (const seed of ['a', 'Brocas', 'Kit|Teodora Quispe|0', 'x'.repeat(40)]) {
    assert.deepEqual(M.wardrobeOptionsOf(STRINGS[0]), viejo(STRINGS[0]));
    assert.equal(M.wardrobeOptionFor(STRINGS[0], seed), viejo(STRINGS[0])[M.seedIndex(seed, 3)]);
  }
});

console.log('── 2 · mixtas y todas objeto ──');
await ok('ninguna opción se descarta; el texto sale de outfit; basura ignorada', () => {
  assert.deepEqual(M.wardrobeOptionsOf(MIXED[0]), ['a denim shirt', 'a black polo shirt', 'a white polo shirt']);
  assert.deepEqual(M.wardrobeOptionObjectsOf({ options: [{ outfit: '  ' }, { mark: 'x' }, 7, null, [], { outfit: 'a cap', mark: ' ', garment_tone: '' }] }), [{ outfit: 'a cap' }]);
});
await ok('todas objeto: el bloque dicta la prenda elegida, nunca «varía»', () => {
  const b = M.personaWardrobeBlock({ ...BASE, wardrobe: OBJECTS }, 'regenerate_full', 'semilla');
  assert.ok(b.includes('Each line is the ONE outfit already chosen'), b);
  assert.ok(!b.includes('vary it from image to image'));
});

console.log('── 3 · con marca, lisa ──');
await ok('la opción con marca se pide sin logo; la de cadena, tal cual', () => {
  assert.equal(M.plainGarmentText('a black polo shirt'), 'a black polo shirt (plain fabric: no logo, emblem, print or lettering on it)');
  const seeds = Array.from({ length: 40 }, (_, i) => `s${i}`);
  const textos = new Set(seeds.map((s) => M.wardrobeOptionFor(MIXED[0], s)));
  assert.ok(textos.has('a denim shirt'));
  assert.ok(textos.has(M.plainGarmentText('a black polo shirt')) && textos.has(M.plainGarmentText('a white polo shirt')));
  assert.ok(![...textos].includes('a black polo shirt'), 'una prenda con marca nunca se pide sin «lisa»');
});

console.log('── 4 · la opción elegida, entera ──');
await ok('misma semilla que el bloque; al editar, nada', () => {
  const p = { ...BASE, wardrobe: MIXED };
  for (const seed of ['a', 'b', 'c', 'd']) {
    const [c] = M.wardrobeChoicesFor(p, 'regenerate_full', seed);
    const linea = M.personaWardrobeBlock(p, 'regenerate_full', seed).split('\n').find((l) => l.startsWith('- at the shop: '));
    assert.equal(linea, `- at the shop: ${c.mark ? M.plainGarmentText(c.outfit) : c.outfit}`);
    assert.equal(c.when, 'at the shop');
  }
  assert.deepEqual(M.wardrobeChoicesFor(p, 'edit_from_current', 'a'), []);
  assert.deepEqual(M.wardrobeChoicesFor({ ...BASE, wardrobe: [{ when: 'x', outfit: 'y' }] }, 'regenerate_full', 'a'), []);
});

console.log('── 5 · el handler ──');
const handler = await loadHandler();
await ok('wardrobe_choices sólo cuando la opción elegida lleva marca', async () => {
  const restore = silence();
  try {
    const conMarca = await run(handler, req({ copy_full: 'Teodora Quispe muestra el nivel.', title: 'Nivel', persona: { ...BASE, wardrobe: OBJECTS } }), { db: DB });
    assert.equal(conMarca.status, 200);
    const [c] = conMarca.json.wardrobe_choices['Teodora Quispe'];
    assert.equal(c.mark, 'primary_logo'); assert.ok(['dark', 'light'].includes(c.garment_tone));
    const sinMarca = await run(handler, req({ copy_full: 'Teodora Quispe muestra el nivel.', title: 'Nivel', persona: { ...BASE, wardrobe: STRINGS } }), { db: DB });
    assert.ok(!('wardrobe_choices' in sinMarca.json));
  } finally { restore(); }
});

console.log('── 6 · regresión inyectada ──');
await ok('con el filtro viejo (sólo cadenas), todas-objeto vuelve a «varía»', async () => {
  const viejo = "export function wardrobeOptionsOf(entry: { options?: unknown } | null | undefined): string[] {\n  return Array.isArray(entry?.options) ? (entry!.options as unknown[]).filter((o): o is string => typeof o === 'string' && !!o.trim()).map((o) => o.trim()) : [];\n}";
  const nuevo = "export function wardrobeOptionsOf(entry: { options?: unknown } | null | undefined): string[] {\n  return wardrobeOptionObjectsOf(entry).map((o) => o.outfit);\n}";
  assert.ok(source.includes(nuevo), 'la inyección encontró su punto');
  const R = await load(source.replace(nuevo, viejo));
  assert.ok(R.personaWardrobeBlock({ ...BASE, wardrobe: OBJECTS }, 'regenerate_full', 'semilla').includes('vary it from image to image'), 'el caso 2 se pondría en rojo');
});

await ok('multimarca: el bloque nuevo no nombra marcas reales', () => {
  const i = source.indexOf('// ── LA OPCIÓN PUEDE SER UN OBJETO'), j = source.indexOf('/** La cláusula del motor: la persona no lleva la ropa de sus fotos.');
  const nuevo = source.slice(i, j).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(i > 0 && j > i && !/ForumPHs|NeuroneSCF|UnrealvilleStudio|SamPublisher|polo/i.test(nuevo));
});

console.log(`\nvestuario_con_marca: ${n} en verde`);
