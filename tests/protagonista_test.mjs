// LA PROTAGONISTA DE LA MARCA (2026-10-09) — `entry: "scene_protagonist"`.
//
// Qué fija, sin red:
//   1. GOLDEN: sin esa entrada, el cuerpo hacia Vertex es el de `main` en los escenarios de una persona;
//      la lista de cláusulas del motor sin protagonista es la de antes.
//   2. La protagonista no nombrada entra, con sus fotos, la redacción de protagonista en el constructor y
//      la cláusula de protagonista en el prompt final; también al editar y sin síntesis.
//   3. Con otra persona nombrada, la protagonista va primero (SUBJECT A) si el carril la manda primero.
//   4. Multimarca: una marca inventada de otro rubro y otro país; ningún literal de marca en el código.
//   5. Voseo: ninguna forma voseante en lo nuevo.
//
// NO reimplementa la lógica: extrae los bloques `C` y `PB` de `api/execute.ts` y carga el handler real.
//
// Ejecutar:  node tests/protagonista_test.mjs     (Node ≥ 22.18, type-stripping nativo)

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
const dir = mkdtempSync(join(tmpdir(), 'protagonista-'));
const mod = join(dir, 'protagonista_block.mts');
writeFileSync(mod, `${fb[0]}\n\n${block('C')}\n\n${block('PB')}\n`, 'utf8');
const M = await import(pathToFileURL(mod).href);

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`  ✓ ${name}`); };
const silence = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };
const handler = await loadHandler();
const call = async (body, db = DB) => { const restore = silence(); try { return await run(handler, body, { db }); } finally { restore(); } };

const { PERSONA_A, PERSONA_B } = PERSONAS;
const PROTA = 'scene_protagonist';
const prota = (p) => ({ ...p, entry: PROTA });
const CLAUSULA = (name) => `${name} is the protagonist of this brand's images`;

// ── 1 · golden ───────────────────────────────────────────────────────────────────────────────────
console.log('── 1 · golden: sin la entrada, nada se mueve ──');
const GOLDEN = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'personas_n1_golden.json'), 'utf8'));
await ok(`los ${Object.keys(N1).length} escenarios de una persona sin entrada son el golden de main`, async () => {
  for (const [name, body] of Object.entries(N1)) {
    assert.deepEqual(vertexDigest(await call(body)), GOLDEN[name], `«${name}» cambió`);
  }
});

await ok('engineClausesFor sin protagonista es la lista de antes; con protagonista añade UNA cláusula', () => {
  const base = { mode: 'regenerate_full', textZone: 'TZ', personaCount: 1, gaze: null, placement: '', productInScene: false, productComposited: false, angleSeed: 's' };
  const antes = M.engineClausesFor(base);
  assert.deepEqual(M.engineClausesFor({ ...base, protagonist: null }), antes);
  assert.deepEqual(M.engineClausesFor({ ...base, protagonist: '   ' }), antes);
  const con = M.engineClausesFor({ ...base, protagonist: 'Teodora Quispe' });
  assert.equal(con.length, antes.length + 1);
  assert.ok(con.some((c) => c.startsWith(CLAUSULA('Teodora Quispe'))));
  // También al editar: la identidad es lo que más se pierde al regenerar.
  const edit = M.engineClausesFor({ ...base, mode: 'edit_from_current', protagonist: 'Teodora Quispe' });
  assert.ok(edit.some((c) => c.startsWith(CLAUSULA('Teodora Quispe'))));
});

await ok('la cláusula exige UNA aparición: ni reflejo ni la propia mano en primer plano (2026-10-10)', () => {
  const c = M.sceneProtagonistClause('Teodora Quispe');
  assert.ok(c.startsWith(CLAUSULA('Teodora Quispe')));
  assert.ok(c.includes("Teodora Quispe appears exactly once: never Teodora Quispe's reflection in a mirror, window or glass"));
  assert.ok(c.includes("never Teodora Quispe's own hand in the foreground while Teodora Quispe also stands in the scene"));
  assert.ok(c.includes('if the piece speaks of a mirror, place the camera where the mirror would be'));
});

await ok('piezas puras: la entrada exige nombre y comparación exacta', () => {
  assert.equal(M.PERSONA_ENTRY_SCENE_PROTAGONIST, 'scene_protagonist');
  assert.equal(M.isSceneProtagonistEntry(prota(PERSONA_A)), true);
  for (const e of [undefined, null, '', 'Scene_Protagonist', ' scene_protagonist', 'scene-protagonist', 'author_voice']) {
    assert.equal(M.isSceneProtagonistEntry({ ...PERSONA_A, entry: e }), false, `entry=${JSON.stringify(e)}`);
  }
  assert.equal(M.isSceneProtagonistEntry({ ...PERSONA_A, name: '  ', entry: PROTA }), false, 'sin nombre no hay a quién pintar');
  assert.deepEqual(M.scenePersonas([prota(PERSONA_A), PERSONA_B], ['nadie']).map((p) => p.name), [PERSONA_A.name]);
  assert.equal(M.sceneProtagonistOf([PERSONA_B, prota(PERSONA_A)]).name, PERSONA_A.name);
  assert.equal(M.sceneProtagonistOf([PERSONA_B]), null);
});

// ── 2 · la protagonista entra ────────────────────────────────────────────────────────────────────
console.log('── 2 · la protagonista entra sin ser nombrada ──');
const SIN_NOMBRE = { copy_full: 'Una broca barata sale cara: se quema a los diez agujeros.', title: 'Brocas' };

await ok('NO mencionada, alias legacy `persona`: entra con sus fotos, redacción de protagonista y cláusula en el prompt final', async () => {
  const r = await call(req({ ...SIN_NOMBRE, persona: prota(PERSONA_A) }));
  const d = vertexDigest(r);
  assert.equal(r.status, 200);
  assert.equal(r.json.persona_used, true);
  assert.deepEqual(d.image_parts.map((p) => p.split('IMG:')[1]), PERSONA_A.reference_image_urls.slice(0, 3), 'viajan sus fotos de referencia');
  assert.ok(d.builder_user.includes(`PERSONA — "${PERSONA_A.name}" is a real, recurring person of this brand. They are the protagonist of every image of this brand`));
  assert.ok(!d.builder_user.includes('Whenever the piece or a directive names them'), 'a la protagonista no se le pide que la nombren');
  assert.ok(d.image_text[0].includes(CLAUSULA(PERSONA_A.name)), 'la cláusula de protagonista llega al prompt final');
});

await ok('NO mencionada en `personas[]`: entra y la cláusula viaja', async () => {
  const r = await call(req({ ...SIN_NOMBRE, personas: [prota(PERSONA_A)] }));
  assert.equal(r.json.persona_used, true);
  assert.ok(vertexDigest(r).image_text[0].includes(CLAUSULA(PERSONA_A.name)));
});

await ok('sin la entrada, la misma persona no nombrada no entra y no hay cláusula', async () => {
  const r = await call(req({ ...SIN_NOMBRE, persona: PERSONA_A }));
  const d = vertexDigest(r);
  assert.equal(r.json.persona_used, false);
  assert.ok(!d.image_text.join(' ').includes('is the protagonist of this brand'));
});

await ok('con otra persona nombrada: la protagonista es SUBJECT A cuando llega primero', async () => {
  const r = await call(req({ copy_full: `${PERSONA_B.name} revisa el pedido de brocas.`, title: 'Pedido', personas: [prota(PERSONA_A), PERSONA_B] }));
  const d = vertexDigest(r);
  assert.deepEqual(r.json.personas_used, [PERSONA_A.name, PERSONA_B.name]);
  assert.ok(d.builder_user.includes(`SUBJECT A = "${PERSONA_A.name}"`));
  assert.ok(d.image_text[0].includes(CLAUSULA(PERSONA_A.name)));
});

// ── 3 · multimarca ───────────────────────────────────────────────────────────────────────────────
console.log('── 3 · multimarca ──');
// Marca INVENTADA de otro rubro y otro país: un taller de cerámica de Oaxaca, México, cuya cara es su ceramista.
const TALLER = 'TallerCeramicaOaxaca';
const DB_TALLER = {
  brands: [{ id: TALLER, display_name: 'Barro Negro Studio', imagelab_visual_identity: 'warm adobe walls, black clay', imagelab_compliance_rules: null, imagelab_industry: 'ceramics workshop', default_negative_prompt: 'cartoon' }],
  imagelab_overlay_tokens: [{ tokens: { layout: { text_zone_pct: 25, anchor: 'top_left' } } }],
  imagelab_prompt_builder_versions: DB.imagelab_prompt_builder_versions,
};
const ROSALBA = { name: 'Rosalba Méndez', aliases: ['Rosalba'], description: 'woman in her sixties, grey braid, clay on her hands', reference_image_urls: ['https://cdn.example.invalid/o/rosalba_1.png'] };
await ok('marca N+1 (taller de cerámica, México): su protagonista entra sin nombrarse y lleva la cláusula', async () => {
  const body = { brandId: TALLER, stage: { labId: 'imagelab', label: 'ImageLab', description: 'x', order: 3 }, previousOutputs: {},
    params: { canal: 'INSTAGRAM_FEED', subject: 's', copy_full: 'El barro negro se pule con cuarzo antes de hornearlo.', title: 'Pulido', personas: [{ ...ROSALBA, entry: PROTA }] } };
  const r = await call(body, DB_TALLER);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.personas_used, ['Rosalba Méndez']);
  assert.ok(vertexDigest(r).image_text[0].includes(CLAUSULA('Rosalba Méndez')));
});

const nuevo = source.slice(source.indexOf('// ── LA PROTAGONISTA DE LA MARCA'), source.indexOf('/** ¿Entra la persona en la escena?'));
const sinComentarios = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/**')).join('\n');
await ok('el código nuevo no nombra marcas ni personas reales; el valor vive en una constante', () => {
  assert.ok(nuevo.length > 800, 'no se encontró el bloque nuevo');
  const codigo = sinComentarios(nuevo);
  for (const lit of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'SamPublisher', 'D7Herbal', 'VivoseMask', 'VizosCosmetics', 'DiamondDetails', 'PatriciaOsorio', 'Lucien', 'Patricia', 'Irja', 'brand_id']) {
    assert.ok(!codigo.includes(lit), `literal «${lit}» en el código nuevo`);
  }
  assert.equal((source.match(/'scene_protagonist'/g) ?? []).length, 1, 'el literal aparece una sola vez: en la constante');
});

// ── 4 · voseo ────────────────────────────────────────────────────────────────────────────────────
console.log('── 4 · voseo ──');
await ok('sin voseo en lo nuevo (bloque y este test)', () => {
  const VOSEO = /(?<!\p{L})(querés|podés|tenés|sabés|hacés|decís|sos|vos|mirá|fijate|andá|vení|poné|usá|hacé|decí|tené|agregá|revisá|probá|dejá|sacá|cambiá|tomá|pasá|llamá|acordate|fijá|corré|elegí|decidí|confirmá|verificá|asegurate)(?!\p{L})/iu;
  for (const t of [nuevo, readFileSync(fileURLToPath(import.meta.url), 'utf8')]) {
    const hit = t.split('\n').filter((l) => !l.includes('VOSEO')).find((l) => VOSEO.test(l));
    assert.equal(hit, undefined, `voseo en: ${hit}`);
  }
});

console.log(`\n✅ protagonista_test — ${n} bloques OK`);
