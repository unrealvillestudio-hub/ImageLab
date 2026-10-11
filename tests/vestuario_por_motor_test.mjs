// LA PRENDA LA ELIGE EL MOTOR (2026-10-11).
//
// Qué fija, sin red:
//   1. Sin `options` ni `reference_outfit`, el bloque de vestuario y la lista de cláusulas son los de antes.
//   2. Con `options`, cada entrada lleva UNA prenda, elegida por la semilla: determinista para la misma
//      pieza, distinta entre piezas, y todas las opciones salen en un lote de semillas.
//   3. Con `reference_outfit`, el bloque dice «nunca» y el motor repone la cláusula literal (no al editar).
//   4. El handler: la semilla de la pieza llega al constructor y la cláusula al prompt final.
//   5. Multimarca y voseo en lo nuevo.
//
// NO reimplementa la lógica: extrae los bloques `C` y `PB` de `api/execute.ts` y carga el handler real.
//
// Ejecutar:  node tests/vestuario_por_motor_test.mjs     (Node ≥ 22.18, type-stripping nativo)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { loadHandler, run } from './_handler_harness.mjs';
import { DB, PERSONAS, req } from './fixtures/personas_escenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');
function block(tag) {
  const b = `// ── ${tag}:BEGIN ──`, e = `// ── ${tag}:END ──`;
  const i = source.indexOf(b), j = source.indexOf(e);
  assert.ok(i >= 0 && j > i, `bloque ${tag} no encontrado`);
  return source.slice(i, j + e.length);
}
const fb = source.match(/const FALLBACK_NEGATIVE = '[^']*';/);
const dir = mkdtempSync(join(tmpdir(), 'vestuario-'));
const mod = join(dir, 'vestuario_block.mts');
writeFileSync(mod, `${fb[0]}\n\n${block('C')}\n\n${block('PB')}\n`, 'utf8');
const M = await import(pathToFileURL(mod).href);

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`  ✓ ${name}`); };
const silence = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };

// Una persona inventada de otro rubro y otro país (marca N+1).
const BASE = { name: 'Ada Nwosu', description: 'woman in her forties, close-cropped hair', reference_image_urls: ['https://cdn.example.invalid/ada1.png'] };
const CATALOGO = [
  { when: 'at the workshop', outfit: 'work clothes, varied', options: ['a denim work shirt', 'a grey canvas apron over a white tee', 'a navy boiler suit', 'a rust-coloured overshirt'] },
  { when: 'at the market', outfit: 'everyday clothes', options: ['a mustard knit sweater', 'a striped linen shirt'] },
  { when: 'any setting', outfit: 'small earrings' },
];
const REF = 'the red turtleneck and the long silver pendant of the reference photos';

// ── 1 · sin dato nuevo, lo de antes ──────────────────────────────────────────────────────────────
console.log('── 1 · sin dato nuevo, nada cambia ──');
await ok('sin opciones: el bloque es el de siempre, con y sin semilla', () => {
  const p = { ...BASE, wardrobe: CATALOGO.map(({ when, outfit }) => ({ when, outfit })) };
  const antes = `${M.PERSONA_IDENTITY_ONLY_CLAUSE}. Choose Ada Nwosu's outfit by the setting of the scene, and vary it from image to image:\n` +
    '- at the workshop: work clothes, varied\n- at the market: everyday clothes\n- any setting: small earrings';
  assert.equal(M.personaWardrobeBlock(p, 'regenerate_full'), antes);
  assert.equal(M.personaWardrobeBlock(p, 'regenerate_full', 'semilla'), antes);
  assert.equal(M.personaWardrobeBlock(BASE, 'regenerate_full', 'x'), `${M.PERSONA_IDENTITY_ONLY_CLAUSE}.`);
});
await ok('engineClausesFor sin `outfitAvoid`: la lista de antes', () => {
  const base = { mode: 'regenerate_full', textZone: '', personaCount: 1, gaze: null, placement: '', productInScene: false, productComposited: false, angleSeed: 's' };
  assert.deepEqual(M.engineClausesFor({ ...base, outfitAvoid: null }), M.engineClausesFor(base));
  assert.deepEqual(M.engineClausesFor({ ...base, outfitAvoid: [] }), M.engineClausesFor(base));
});

// ── 2 · con opciones ─────────────────────────────────────────────────────────────────────────────
console.log('── 2 · la prenda la elige el motor ──');
const P = { ...BASE, wardrobe: CATALOGO };
await ok('cada entrada lleva UNA prenda de sus opciones; sin opciones, su `outfit`', () => {
  const b = M.personaWardrobeBlock(P, 'regenerate_full', 'Pieza uno');
  assert.match(b, /Each line is the ONE outfit already chosen for this image/);
  const lines = b.split('\n').slice(1);
  assert.equal(lines.length, 3);
  assert.ok(CATALOGO[0].options.some((o) => lines[0] === `- at the workshop: ${o}`), lines[0]);
  assert.ok(CATALOGO[1].options.some((o) => lines[1] === `- at the market: ${o}`), lines[1]);
  assert.equal(lines[2], '- any setting: small earrings');
  assert.ok(!b.includes('vary it from image to image'), 'ya no se le pide al constructor que varíe');
});
await ok('determinista para la misma pieza; las cuatro opciones salen en 40 piezas', () => {
  assert.equal(M.personaWardrobeBlock(P, 'regenerate_full', 'Pieza uno'), M.personaWardrobeBlock(P, 'regenerate_full', 'Pieza uno'));
  const vistas = new Set();
  for (let k = 0; k < 40; k++) vistas.add(M.wardrobeOptionFor(CATALOGO[0], `Pieza ${k}|Ada Nwosu|0`));
  assert.deepEqual([...vistas].sort(), [...CATALOGO[0].options].sort());
});
await ok('opciones basura se ignoran; una lista vacía cae en `outfit`', () => {
  assert.deepEqual(M.wardrobeOptionsOf({ options: ['  a ', '', 3, null, 'b'] }), ['a', 'b']);
  assert.equal(M.wardrobeOptionFor({ outfit: ' x ', options: [] }, 's'), 'x');
  assert.equal(M.wardrobeOptionFor({ outfit: 'x', options: 'no' }, 's'), 'x');
});
await ok('al editar no se dicta ropa', () => {
  assert.equal(M.personaWardrobeBlock(P, 'edit_from_current', 's'), 'Keep the clothing of the current image unless a directive asks to change it.');
});

// ── 3 · la ropa de las fotos ─────────────────────────────────────────────────────────────────────
console.log('── 3 · la ropa de las fotos ──');
await ok('el bloque dice «nunca», con y sin opciones', () => {
  assert.ok(M.personaWardrobeBlock({ ...P, wardrobe_reference_outfit: REF }, 'regenerate_full', 's').endsWith(`\nNever the outfit of the reference photos: ${REF}.`));
  assert.equal(M.personaWardrobeBlock({ ...BASE, wardrobe_reference_outfit: REF }, 'regenerate_full'), `${M.PERSONA_IDENTITY_ONLY_CLAUSE}.\nNever the outfit of the reference photos: ${REF}.`);
});
await ok('la cláusula del motor se repone al regenerar y no al editar', () => {
  const base = { mode: 'regenerate_full', textZone: '', personaCount: 1, gaze: null, placement: '', productInScene: false, productComposited: false, angleSeed: 's' };
  const avoid = M.referenceOutfitsOf([{ ...BASE, wardrobe_reference_outfit: REF }, { ...BASE, name: 'Otra', wardrobe_reference_outfit: '  ' }]);
  assert.deepEqual(avoid, [{ name: 'Ada Nwosu', outfit: REF }]);
  const con = M.engineClausesFor({ ...base, outfitAvoid: avoid });
  assert.ok(con.includes(M.personaReferenceOutfitClause('Ada Nwosu', REF)));
  assert.equal(con.length, M.engineClausesFor(base).length + 1);
  const edit = M.engineClausesFor({ ...base, mode: 'edit_from_current', outfitAvoid: avoid });
  assert.deepEqual(edit, M.engineClausesFor({ ...base, mode: 'edit_from_current' }));
});

// ── 4 · el handler ───────────────────────────────────────────────────────────────────────────────
console.log('── 4 · el handler ──');
const handler = await loadHandler();
const call = async (body) => { const restore = silence(); try { return await run(handler, body, { db: DB }); } finally { restore(); } };
const textoImagen = (r) => (r.vertexImage?.contents?.[0]?.parts ?? []).filter((p) => typeof p.text === 'string').map((p) => p.text).join(' ');
const { PERSONA_A } = PERSONAS;
const conVestuario = { ...PERSONA_A, wardrobe: CATALOGO, wardrobe_reference_outfit: REF };
await ok('la prenda elegida llega al constructor y la cláusula al prompt final', async () => {
  const r = await call(req({ copy_full: 'Teodora Quispe muestra cómo elegir una broca.', title: 'Brocas', persona: conVestuario }));
  const user = r.vertexText?.contents?.[0]?.parts?.[0]?.text ?? '';
  const esperado = M.personaWardrobeBlock(conVestuario, 'regenerate_full', 'Brocas');
  assert.ok(user.includes(`PERSONA WARDROBE:\n${esperado}`), 'la semilla de la pieza es la del handler (título)');
  assert.ok(textoImagen(r).includes(M.personaReferenceOutfitClause(PERSONA_A.name, REF)));
});
await ok('la misma pieza viste igual en dos corridas (determinista)', async () => {
  const a = await call(req({ copy_full: 'Teodora Quispe muestra cómo elegir una broca.', title: 'Brocas', persona: conVestuario }));
  const b = await call(req({ copy_full: 'Teodora Quispe muestra cómo elegir una broca.', title: 'Brocas', persona: conVestuario }));
  assert.equal(a.vertexText?.contents?.[0]?.parts?.[0]?.text, b.vertexText?.contents?.[0]?.parts?.[0]?.text);
});

// ── 5 · multimarca y voseo ───────────────────────────────────────────────────────────────────────
console.log('── 5 · multimarca y voseo ──');
const nuevo = source.slice(source.indexOf('LA PRENDA LA ELIGE EL MOTOR'), source.indexOf('export function referenceOutfitsOf')) +
  source.slice(source.indexOf('export function personaWardrobeBlock'), source.indexOf('// ── LA PRENDA LA ELIGE EL MOTOR'));
await ok('lo nuevo no nombra marcas ni personas', () => {
  assert.ok(nuevo.length > 1500);
  for (const lit of ['Neurone', 'Patricia', 'Lucien', 'ForumPHs', 'Unrealville', 'salon']) assert.ok(!nuevo.includes(lit), lit);
});
await ok('lo nuevo no usa formas voseantes', () => {
  assert.ok(!/\b(decidí|tenés|podés|querés|hacé|mirá|fijate|usá|poné|sabés|elegí)\b/i.test(nuevo));
});

console.log(`\n${n} ok · 0 fail`);
