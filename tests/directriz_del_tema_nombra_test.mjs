// LA DIRECTRIZ DEL TEMA TAMBIÉN NOMBRA (2026-10-05) — `params.visual_directive` cuenta para la mención.
//
// Qué fija, sin red:
//   1. GOLDEN: los escenarios de una persona (`personas_n1_golden.json`) no cambian, también con una
//      directriz de tema que no nombra a nadie.
//   2. Una persona nombrada SÓLO en la directriz del tema entra: con sus fotos, en `prompt_only` y con dos
//      personas (una por la pieza y otra por la directriz).
//   3. Una persona que no nombra nadie sigue fuera.
//   4. El constructor y la escena usan la misma lista de textos (`sceneMentionTexts`) en los tres sitios.
//   5. Multimarca: una marca inventada de otro rubro y otro país; ningún literal de marca en lo nuevo.
//   6. Voseo con límites de palabra Unicode.
//
// NO reimplementa la lógica: extrae los bloques `C` y `PB` de `api/execute.ts` y carga el handler real.
//
// Ejecutar:  node tests/directriz_del_tema_nombra_test.mjs     (Node ≥ 22.18, type-stripping nativo)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { loadHandler, run, vertexDigest } from './_handler_harness.mjs';
import { N1, DB, PERSONAS, req } from './fixtures/personas_escenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');
function block(tag) {
  const b = `// ── ${tag}:BEGIN ──`, e = `// ── ${tag}:END ──`;
  const i = source.indexOf(b), j = source.indexOf(e);
  assert.ok(i >= 0 && j > i, `bloque ${tag} no encontrado`);
  return source.slice(i, j + e.length);
}
const fb = source.match(/const FALLBACK_NEGATIVE = '[^']*';/);
const dir = mkdtempSync(join(tmpdir(), 'directriz-tema-'));
const mod = join(dir, 'bloques.mts');
writeFileSync(mod, `${fb[0]}\n\n${block('C')}\n\n${block('PB')}\n`, 'utf8');
const M = await import(pathToFileURL(mod).href);

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`  ✓ ${name}`); };
const silence = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };
const handler = await loadHandler();
const call = async (body, db = DB) => { const restore = silence(); try { return await run(handler, body, { db }); } finally { restore(); } };
const { PERSONA_A, PERSONA_B, PERSONA_C } = PERSONAS;

// ── 1 · golden ───────────────────────────────────────────────────────────────────────────────────
console.log('── 1 · golden ──');
const GOLDEN = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'personas_n1_golden.json'), 'utf8'));
await ok(`los ${Object.keys(N1).length} escenarios de una persona son el golden de main`, async () => {
  for (const [name, body] of Object.entries(N1)) assert.deepEqual(vertexDigest(await call(body)), GOLDEN[name], `«${name}» cambió`);
});
await ok('con una directriz de tema que no nombra a nadie, la persona no nombrada sigue fuera y nada se mueve', async () => {
  const generica = 'Low angle, warm practical light, calm lower area.';
  for (const persona of [PERSONA_A, null]) {
    const sin = await call(req({ copy_full: 'Cómo elegir una broca.', title: 'Brocas', persona }));
    const con = await call(req({ copy_full: 'Cómo elegir una broca.', title: 'Brocas', persona, visual_directive: generica }));
    assert.equal(con.json.persona_used, false);
    assert.deepEqual(vertexDigest(con).image_parts, vertexDigest(sin).image_parts);
  }
});

// ── 2 · la directriz del tema nombra ─────────────────────────────────────────────────────────────
console.log('── 2 · la directriz del tema nombra ──');
const SET = 'Monthly counter talk recorded at the back of the shop: Teodora Quispe answers at the long worn counter.';
await ok('nombrada SÓLO en la directriz del tema: entra con sus fotos y el constructor la describe', async () => {
  const r = await call(req({ copy_full: 'Cómo elegir una broca.', title: 'Brocas', persona: PERSONA_A, visual_directive: SET }));
  const d = vertexDigest(r);
  assert.equal(r.status, 200);
  assert.equal(r.json.persona_used, true);
  assert.deepEqual(d.image_parts.map((p) => p.split('IMG:')[1]), PERSONA_A.reference_image_urls.slice(0, 3));
  assert.ok(d.builder_user.includes('PERSONA — "Teodora Quispe" is a real, recurring person of this brand. Whenever the piece or a directive names them'));
});
await ok('en prompt_only (medición en seco) también entra y no genera imagen', async () => {
  const r = await call(req({ copy_full: 'Cómo elegir una broca.', title: 'Brocas', personas: [PERSONA_A], visual_directive: SET, prompt_only: true }));
  assert.equal(r.json.persona_used, true);
  assert.equal(r.vertexImage, null);
});
await ok('dos personas: una por la pieza y otra por la directriz del tema, en el orden de la petición', async () => {
  const r = await call(req({ copy_full: 'Nacho pregunta por las brocas.', title: 'Brocas', personas: [PERSONA_A, PERSONA_B, PERSONA_C], visual_directive: SET }));
  assert.deepEqual(r.json.personas_used, ['Teodora Quispe', 'Ignacio Huerta']);
  assert.ok(vertexDigest(r).builder_user.includes('SUBJECT A = "Teodora Quispe", SUBJECT B = "Ignacio Huerta"'));
});

// ── 3 · piezas puras y cableado ──────────────────────────────────────────────────────────────────
console.log('── 3 · piezas puras y cableado ──');
await ok('sceneMentionTexts: pieza, directriz del tema y directrices de la pieza, en ese orden', () => {
  assert.deepEqual(M.sceneMentionTexts('c', 't', 'h', 'd', ['x', 'y']), ['c', 't', 'h', 'd', 'x', 'y']);
  assert.deepEqual(M.scenePersonas([PERSONA_A], M.sceneMentionTexts('nada', null, null, SET, [])), [PERSONA_A]);
  assert.deepEqual(M.scenePersonas([PERSONA_A], M.sceneMentionTexts('nada', null, null, null, [])), []);
});
const sinComentarios = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/**')).join('\n');
await ok('los tres sitios que deciden quién entra usan sceneMentionTexts con la directriz del tema', () => {
  const c = sinComentarios(source);
  assert.equal((c.match(/sceneMentionTexts\(input\.copyFull, input\.title, input\.imageHook, input\.domainDirective, directives\)/g) ?? []).length, 2);
  assert.equal((c.match(/sceneMentionTexts\(params\.copy_full, params\.title, params\.image_hook, params\.visual_directive, directives\)/g) ?? []).length, 1);
  assert.equal((c.match(/scenePersonas\([^)]*\[params\.copy_full|personaEntersScene\(input\.persona, \[/g) ?? []).length, 0, 'ninguna lista de textos escrita a mano');
});

// ── 4 · multimarca ───────────────────────────────────────────────────────────────────────────────
console.log('── 4 · multimarca ──');
const nuevo = source.slice(source.indexOf('// ── LA DIRECTRIZ DEL TEMA TAMBIÉN NOMBRA'), source.indexOf('/** Las personas que entran en la escena'));
await ok('el código nuevo no nombra marcas ni personas reales', () => {
  assert.ok(nuevo.length > 500, 'no se encontró el bloque nuevo');
  const MARCAS = /(?<!\p{L})(NeuroneSCF|ForumPHs|LucienSael|UnrealvilleStudio|SamPublisher|D7Herbal|VivoseMask|VizosCosmetics|DiamondDetails|PatriciaOsorio|Patricia|Clara|Lucien|Irja|podcast)(?!\p{L})/iu;
  const hit = nuevo.split('\n').find((l) => MARCAS.test(l));
  assert.equal(hit, undefined, `literal de marca en: ${hit}`);
});

// ── 5 · voseo ────────────────────────────────────────────────────────────────────────────────────
console.log('── 5 · voseo ──');
await ok('sin voseo en lo nuevo y en este test', () => {
  const VOSEO = /(?<!\p{L})(querés|podés|tenés|sabés|hacés|decís|sos|vos|mirá|fijate|andá|vení|poné|usá|hacé|decí|tené|agregá|revisá|probá|dejá|sacá|cambiá|tomá|pasá|llamá|acordate|fijá|corré|elegí|decidí|confirmá|verificá|asegurate)(?!\p{L})/iu;
  for (const t of [nuevo, readFileSync(fileURLToPath(import.meta.url), 'utf8')]) {
    const hit = t.split('\n').filter((l) => !l.includes('VOSEO')).find((l) => VOSEO.test(l));
    assert.equal(hit, undefined, `voseo en: ${hit}`);
  }
  assert.equal(VOSEO.test('nervosísimo'), false);
  assert.equal(VOSEO.test('¿vos querés?'), true);
});

console.log(`\n✅ directriz_del_tema_nombra_test — ${n} bloques OK`);
