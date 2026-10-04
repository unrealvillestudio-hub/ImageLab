// LA VOZ AUTORA ENTRA SIN SER NOMBRADA (2026-10-04) — `entry: "author_voice"` exime del filtro de mención.
//
// Qué fija, sin red:
//   1. GOLDEN: sin `entry`, o con cualquier otra `entry`, el cuerpo hacia Vertex es el de `main` en los
//      11 escenarios de `personas_n1_golden.json`, y dos o más personas salen igual que sin `entry`.
//   2. La voz autora no mencionada entra (alias legacy `persona` y `personas[]`); una persona no
//      mencionada sin `entry` no entra; mezcla de nombrada y autora, en el orden de la petición.
//   3. Multimarca: una marca inventada de otro rubro y otro país; ningún literal de marca en el código.
//   4. Voseo: ninguna forma voseante en lo nuevo, con límites de palabra Unicode.
//
// NO reimplementa la lógica: extrae los bloques `C` y `PB` de `api/execute.ts` y carga el handler real.
//
// Ejecutar:  node tests/autoria_voz_test.mjs     (Node ≥ 22.18, type-stripping nativo)

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
const dir = mkdtempSync(join(tmpdir(), 'autoria-'));
const mod = join(dir, 'autoria_block.mts');
writeFileSync(mod, `${fb[0]}\n\n${block('C')}\n\n${block('PB')}\n`, 'utf8');
const M = await import(pathToFileURL(mod).href);

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`  ✓ ${name}`); };
const silence = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };
const handler = await loadHandler();
const call = async (body, db = DB) => { const restore = silence(); try { return await run(handler, body, { db }); } finally { restore(); } };

const { PERSONA_A, PERSONA_B, PERSONA_C } = PERSONAS;
const AUTORA = 'author_voice';
const autora = (p) => ({ ...p, entry: AUTORA });
// Valores de `entry` que NO son la voz autora: deben comportarse exactamente como sin `entry`.
const OTRAS_ENTRADAS = [undefined, null, '', 'named', 'self', 'Author_Voice', ' author_voice', 'author-voice'];

// ── 1 · golden ───────────────────────────────────────────────────────────────────────────────────
console.log('── 1 · golden: sin entry o con otra entry, nada se mueve ──');
const GOLDEN = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'personas_n1_golden.json'), 'utf8'));
const conEntrada = (body, entry) => {
  const p = body.params;
  const tag = (x) => (x && typeof x === 'object' ? { ...x, entry } : x);
  return { ...body, params: { ...p, ...(p.persona !== undefined ? { persona: tag(p.persona) } : {}), ...(Array.isArray(p.personas) ? { personas: p.personas.map(tag) } : {}) } };
};
await ok(`los ${Object.keys(N1).length} escenarios de una persona, con ${OTRAS_ENTRADAS.length} valores de entry ajenos, son el golden de main`, async () => {
  assert.deepEqual(Object.keys(GOLDEN).sort(), Object.keys(N1).sort());
  for (const [name, body] of Object.entries(N1)) {
    for (const entry of OTRAS_ENTRADAS) {
      assert.deepEqual(vertexDigest(await call(conEntrada(body, entry))), GOLDEN[name], `«${name}» con entry=${JSON.stringify(entry)} cambió`);
    }
  }
});

await ok('dos o más personas con otra entry: idéntico a sin entry (nombradas, no nombradas y mezcla)', async () => {
  const casos = [
    req({ copy_full: 'Teodora y Nacho prueban la escalera.', title: 'Escalera', personas: [PERSONA_A, PERSONA_B, PERSONA_C] }),
    req({ copy_full: 'Nacho revisa el pedido.', title: 'Pedido', personas: [PERSONA_A, PERSONA_B] }),
    req({ copy_full: 'Cómo elegir una broca.', title: 'Brocas', personas: [PERSONA_A, PERSONA_B] }),
    req({ title: 'Teodora y Nacho', personas: [PERSONA_A, PERSONA_B] }),
  ];
  for (const body of casos) {
    const base = vertexDigest(await call(body));
    for (const entry of OTRAS_ENTRADAS) {
      assert.deepEqual(vertexDigest(await call(conEntrada(body, entry))), base, `entry=${JSON.stringify(entry)} cambió «${body.params.title}»`);
    }
  }
});

await ok('piezas puras: sin voz autora, scenePersonas es mentionedPersonas; la constante es el eje declarado', () => {
  assert.equal(M.PERSONA_ENTRY_AUTHOR_VOICE, 'author_voice');
  const t = ['Nacho y Teodora prueban la escalera'];
  for (const entry of OTRAS_ENTRADAS) {
    const lista = [PERSONA_A, PERSONA_B, PERSONA_C].map((p) => ({ ...p, entry }));
    assert.deepEqual(M.scenePersonas(lista, t), M.mentionedPersonas(lista, t), `entry=${JSON.stringify(entry)}`);
    assert.deepEqual(M.scenePersonas(lista, ['nadie']), [], `entry=${JSON.stringify(entry)} metió a alguien no nombrado`);
    assert.equal(M.isAuthorVoiceEntry(lista[0]), false);
  }
  assert.equal(M.isAuthorVoiceEntry({ ...PERSONA_A, name: '  ', entry: AUTORA }), false, 'sin nombre no hay a quién pintar');
  assert.equal(M.personaEntersScene({ ...PERSONA_A, name: '', entry: AUTORA }, ['x']), false);
});

// ── 2 · la voz autora ────────────────────────────────────────────────────────────────────────────
console.log('── 2 · la voz autora entra sin ser nombrada ──');
const SIN_NOMBRE = { copy_full: 'Llevo veinte años detrás de este mostrador y aprendí que la broca barata sale cara.', title: 'Brocas' };

await ok('autora NO mencionada, alias legacy `persona`: entra con sus fotos y el constructor la describe', async () => {
  const r = await call(req({ ...SIN_NOMBRE, persona: autora(PERSONA_A) }));
  const d = vertexDigest(r);
  assert.equal(r.status, 200);
  assert.equal(r.json.persona_used, true);
  assert.deepEqual(d.image_parts.map((p) => p.split('IMG:')[1]), PERSONA_A.reference_image_urls.slice(0, 3), 'viajan sus fotos de referencia');
  assert.ok(d.builder_user.includes('PERSONA — "Teodora Quispe" is a real, recurring person of this brand. The piece is written in their own voice: they appear in the scene, and they must look exactly like this'));
  assert.ok(!d.builder_user.includes('Whenever the piece or a directive names them'), 'a la autora no se le pide que la nombren');
  assert.ok(d.builder_user.includes('PERSONA EXPRESSION') && d.builder_user.includes('PERSONA WARDROBE'));
});

await ok('autora NO mencionada en `personas[]` y en prompt_only (medición en seco): entra y se declara', async () => {
  const r = await call(req({ ...SIN_NOMBRE, personas: [autora(PERSONA_A)], prompt_only: true }));
  assert.equal(r.status, 200);
  assert.equal(r.json.persona_used, true);
  assert.equal(r.vertexImage, null, 'prompt_only no genera imagen');
  assert.ok(r.vertexText.contents[0].parts[0].text.includes('PERSONA — "Teodora Quispe"'));
});

await ok('persona NO mencionada SIN entry: no entra (la regla de mención de siempre)', async () => {
  for (const body of [req({ ...SIN_NOMBRE, persona: PERSONA_A }), req({ ...SIN_NOMBRE, personas: [PERSONA_A] })]) {
    const r = await call(body);
    const d = vertexDigest(r);
    assert.equal(r.json.persona_used, false);
    assert.deepEqual(d.image_parts, []);
    assert.ok(!d.builder_user.includes('PERSONA —'));
  }
});

await ok('autora mencionada: entra igual, con la redacción de voz autora', async () => {
  const r = await call(req({ copy_full: 'Teodora Quispe muestra cómo elegir una broca.', title: 'Brocas', persona: autora(PERSONA_A) }));
  assert.equal(r.json.persona_used, true);
  assert.ok(vertexDigest(r).builder_user.includes('The piece is written in their own voice'));
});

await ok('mezcla: nombrada + autora no nombrada + no nombrada sin entry → entran las dos primeras, en el orden de la petición', async () => {
  const body = req({ copy_full: 'Con Nacho revisamos el pedido: yo elijo las brocas.', title: 'Pedido', personas: [PERSONA_C, autora(PERSONA_A), PERSONA_B] });
  const r = await call(body);
  const d = vertexDigest(r);
  assert.deepEqual(r.json.personas_used, ['Teodora Quispe', 'Ignacio Huerta']);
  assert.ok(d.builder_user.includes('PEOPLE — exactly 2 recurring people') && d.builder_user.includes('SUBJECT A = "Teodora Quispe", SUBJECT B = "Ignacio Huerta"'));
  assert.ok(!d.builder_user.includes('Marta Lillo'), 'la no nombrada sin entry sigue fuera');
  assert.ok(d.image_text[0].includes('Images 1–2: SUBJECT A, Teodora Quispe. Image 3: SUBJECT B, Ignacio Huerta.'));
  // Sin la entrada, sólo la nombrada: el mismo cuerpo que pedir sólo a Nacho.
  const sin = await call(req({ copy_full: 'Con Nacho revisamos el pedido: yo elijo las brocas.', title: 'Pedido', personas: [PERSONA_C, PERSONA_A, PERSONA_B] }));
  assert.deepEqual(sin.json.personas_used, ['Ignacio Huerta']);
});

await ok('el techo no cambia: la voz autora cuenta dentro de MAX_PERSONAS_PER_IMAGE', async () => {
  const cuatro = [autora(PERSONA_A), PERSONA_B, PERSONA_C, { ...PERSONA_C, name: 'Otra Persona' }];
  const r = await call(req({ ...SIN_NOMBRE, personas: cuatro }));
  assert.equal(r.status, 400);
  assert.match(JSON.stringify(r.json), /PERSONAS_TOO_MANY: 4 personas/);
});

// ── 3 · multimarca ───────────────────────────────────────────────────────────────────────────────
console.log('── 3 · multimarca ──');
// Marca INVENTADA de otro rubro y otro país: una cooperativa lechera de Tromsø, Noruega, en inglés.
const COOP = 'CooperativaLecheraArtica';
const DB_COOP = {
  brands: [{ id: COOP, display_name: 'Arctic Dairy Co-op', imagelab_visual_identity: 'cold blue morning light, steel tanks', imagelab_compliance_rules: null, imagelab_industry: 'dairy cooperative', default_negative_prompt: 'cartoon' }],
  imagelab_overlay_tokens: [{ tokens: { layout: { text_zone_pct: 25, anchor: 'top_left' } } }],
  imagelab_prompt_builder_versions: DB.imagelab_prompt_builder_versions,
};
const SOLVEIG = { name: 'Solveig Aas', aliases: ['Solveig'], description: 'woman in her forties, red knitted hat, rubber boots', reference_image_urls: ['https://cdn.example.invalid/n/solveig_1.png'] };
await ok('marca N+1 (cooperativa lechera, Noruega, en inglés): su autora entra en primera persona sin nombrarse', async () => {
  const body = { brandId: COOP, stage: { labId: 'imagelab', label: 'ImageLab', description: 'x', order: 3 }, previousOutputs: {},
    params: { canal: 'INSTAGRAM_FEED', subject: 's', copy_full: 'I milk at four because my cows do not read the calendar.', title: 'Four a.m.', personas: [{ ...SOLVEIG, entry: AUTORA }] } };
  const r = await call(body, DB_COOP);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.personas_used, ['Solveig Aas']);
  assert.ok(vertexDigest(r).builder_user.includes('PERSONA — "Solveig Aas"'));
  const sin = await call({ ...body, params: { ...body.params, personas: [SOLVEIG] } }, DB_COOP);
  assert.deepEqual(sin.json.personas_used, [], 'sin entry, la misma marca sigue la regla de mención');
});

const nuevo = source.slice(source.indexOf('// ── LA VOZ AUTORA ENTRA SIN SER NOMBRADA'), source.indexOf('/** La mirada efectiva.'));
const sinComentarios = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/**')).join('\n');
await ok('el código nuevo no nombra marcas ni personas reales', () => {
  assert.ok(nuevo.length > 800, 'no se encontró el bloque nuevo');
  const codigo = sinComentarios(nuevo);
  for (const lit of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'SamPublisher', 'D7Herbal', 'VivoseMask', 'VizosCosmetics', 'DiamondDetails', 'PatriciaOsorio', 'Lucien', 'Patricia', 'Irja', 'brand_id', "'self'"]) {
    assert.ok(!codigo.includes(lit), `literal «${lit}» en el código nuevo`);
  }
  assert.ok(codigo.includes("PERSONA_ENTRY_AUTHOR_VOICE = 'author_voice'"), 'el valor vive en una constante con nombre funcional');
  assert.equal((source.match(/'author_voice'/g) ?? []).length, 1, 'el literal aparece una sola vez: en la constante');
});

// ── 4 · voseo ────────────────────────────────────────────────────────────────────────────────────
console.log('── 4 · voseo ──');
await ok('sin voseo en lo nuevo (bloque, redacción del constructor y este test)', () => {
  const VOSEO = /(?<!\p{L})(querés|podés|tenés|sabés|hacés|decís|sos|vos|mirá|fijate|andá|vení|poné|usá|hacé|decí|tené|agregá|revisá|probá|dejá|sacá|cambiá|tomá|pasá|llamá|acordate|fijá|corré|elegí|decidí|confirmá|verificá|asegurate)(?!\p{L})/iu;
  const lineasNuevas = [nuevo, source.slice(source.indexOf('// La voz autora no tiene por qué'), source.indexOf('PERSONA EXPRESSION:\\n${personaExpressionBlock(input.persona)}')),
    readFileSync(fileURLToPath(import.meta.url), 'utf8')];
  for (const t of lineasNuevas) {
    assert.ok(t.length > 100, 'tramo no encontrado');
    // Las líneas que DEFINEN o PRUEBAN el patrón se excluyen: contienen el patrón (CC_PROTOCOL §14.1).
    const hit = t.split('\n').filter((l) => !l.includes('VOSEO')).find((l) => VOSEO.test(l));
    assert.equal(hit, undefined, `voseo en: ${hit}`);
  }
  // El límite Unicode importa: el pronombre dentro de una palabra con tilde no cuenta.
  assert.equal(VOSEO.test('nervosísimo'), false);
  assert.equal(VOSEO.test('¿vos querés?'), true);
});

console.log(`\n✅ autoria_voz_test — ${n} bloques OK`);
