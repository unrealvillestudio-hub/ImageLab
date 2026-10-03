// MOTOR DE PERSONAS (2026-10-03) — varias personas en una imagen, con sus referencias rotuladas.
//
// Qué fija, sin red:
//   1. GOLDEN de UNA persona: el cuerpo que el handler manda a Vertex (prompt e imágenes, en orden) es
//      el MISMO que en `main` (fcc9bf4) en los 11 escenarios de `fixtures/personas_escenarios.mjs`.
//   2. Las piezas puras: personas[] con su alias legacy, mención, mirada, cláusulas por N, texto
//      permitido del lugar y el reparto del presupuesto de imágenes.
//   3. El handler real con DOS personas: qué imágenes viajan, en qué orden y cómo se rotulan.
//   4. Multimarca (ningún literal de marca en el bloque) y voseo (ninguna forma voseante en lo nuevo).
//
// La marca de los fixtures es inventada (una ferretería de Valparaíso, Chile): otro rubro y otro país.
// NO reimplementa la lógica: extrae los bloques `C` y `PB` de `api/execute.ts` y carga el handler real.
//
// Ejecutar:  node tests/personas_test.mjs     (Node ≥ 22.18, type-stripping nativo)

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
const dir = mkdtempSync(join(tmpdir(), 'personas-'));
const mod = join(dir, 'personas_block.mts');
writeFileSync(mod, `${fb[0]}\n\n${block('C')}\n\n${block('PB')}\nexport { NO_TEXT_CLAUSE };\n`, 'utf8');
const M = await import(pathToFileURL(mod).href);

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`  ✓ ${name}`); };
const { PERSONA_A, PERSONA_B, PERSONA_C, LOCATION, PRODUCT } = PERSONAS;
const silence = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };

// ── 1 · golden de una persona ────────────────────────────────────────────────────────────────────
console.log('── 1 · una persona: el cuerpo hacia Vertex no se mueve ──');
const GOLDEN = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'personas_n1_golden.json'), 'utf8'));
const handler = await loadHandler();
await ok(`los ${Object.keys(N1).length} escenarios de una persona son idénticos al golden de main`, async () => {
  assert.deepEqual(Object.keys(GOLDEN).sort(), Object.keys(N1).sort());
  const restore = silence();
  try {
    for (const [name, body] of Object.entries(N1)) {
      assert.deepEqual(vertexDigest(await run(handler, body, { db: DB })), GOLDEN[name], `el escenario «${name}» cambió`);
    }
  } finally { restore(); }
});

// ── 2 · piezas puras ─────────────────────────────────────────────────────────────────────────────
console.log('── 2 · piezas puras ──');
await ok('personas[] manda; persona es alias legacy; lista mal formada o sobre el techo = error declarado', () => {
  assert.deepEqual(M.resolvePersonas({ persona: PERSONA_A }), { personas: [PERSONA_A], source: 'persona', error: null });
  assert.deepEqual(M.resolvePersonas({ persona: PERSONA_C, personas: [PERSONA_A, PERSONA_B] }).personas, [PERSONA_A, PERSONA_B]);
  assert.deepEqual(M.resolvePersonas({}), { personas: [], source: 'none', error: null });
  assert.deepEqual(M.resolvePersonas({ personas: [] , persona: PERSONA_B }).personas, [PERSONA_B], 'lista vacía = el alias');
  assert.match(M.resolvePersonas({ personas: [PERSONA_A, { name: 'X' }] }).error, /^PERSONAS_INVALID: personas\[1\]/);
  const cuatro = [PERSONA_A, PERSONA_B, PERSONA_C, { ...PERSONA_C, name: 'Otra Persona' }];
  assert.match(M.resolvePersonas({ personas: cuatro }).error, /^PERSONAS_TOO_MANY: 4 personas; el motor acepta hasta 3/);
  assert.equal(M.MAX_PERSONAS_PER_IMAGE, 3);
  assert.equal(M.resolvePersonas({ personas: [PERSONA_A, { ...PERSONA_A, name: ' teodora quispe ' }] }).personas.length, 1, 'la misma persona dos veces cuenta una');
});

await ok('mención: sólo las nombradas, en el orden de la petición', () => {
  const t = ['Nacho y Teodora prueban la escalera'];
  assert.deepEqual(M.mentionedPersonas([PERSONA_A, PERSONA_B, PERSONA_C], t).map((p) => p.name), ['Teodora Quispe', 'Ignacio Huerta']);
  assert.deepEqual(M.mentionedPersonas([PERSONA_A, PERSONA_B], ['nadie']), []);
});

await ok('mirada como dato: defecto camera-de-siempre con una, each_other con dos; valor ajeno = error', () => {
  assert.deepEqual(M.resolveGaze(undefined, 1), { gaze: null, error: null });
  assert.deepEqual(M.resolveGaze(undefined, 0), { gaze: null, error: null });
  assert.deepEqual(M.resolveGaze(null, 2), { gaze: 'each_other', error: null });
  assert.deepEqual(M.resolveGaze('camera', 2), { gaze: 'camera', error: null });
  assert.match(M.resolveGaze('al cielo', 2).error, /^GAZE_INVALID/);
  assert.equal(M.gazeClause(null, 1), M.PERSONA_GAZE_CLAUSE, 'sin dato y con una, la constante de siempre');
  assert.ok(M.gazeClause('each_other', 2).includes('look at each other') && M.gazeClause('each_other', 2).includes('never to the camera'));
  assert.ok(M.gazeClause('camera', 2).startsWith('Each person looks into the camera'));
  assert.ok(M.gazeClause('subject_of_scene', 1).includes('not at the camera'));
  for (const g of M.PERSONA_GAZES) assert.ok(M.gazeClause(g, 2).includes('Never a vacant'), `«${g}» conserva el «nunca perdida»`);
});

await ok('luz, encuadre e identidad: con 0 o 1 persona, las constantes literales; con 2, en plural', () => {
  for (const k of [0, 1]) {
    assert.equal(M.lightingCoherenceClause(k), M.LIGHTING_COHERENCE_CLAUSE);
    assert.equal(M.subjectFramingClause(k), M.SUBJECT_FRAMING_CLAUSE);
    assert.equal(M.personaIdentityOnlyClause(k), M.PERSONA_IDENTITY_ONLY_CLAUSE);
  }
  assert.ok(M.lightingCoherenceClause(2).includes('each person gets a gentle key light') && !M.lightingCoherenceClause(2).includes('the person gets'));
  assert.ok(M.subjectFramingClause(2).startsWith('Frame tightly around the 2 people') && M.subjectFramingClause(3).includes('none cropped out'));
  assert.ok(!M.subjectFramingClause(2).includes('the person is the subject'), 'con dos, ninguna es «la» persona');
  assert.ok(M.personaIdentityOnlyClause(2).includes('each person'));
});

await ok('texto permitido en escena: sin dato, la cláusula de siempre; con dato, la excepción literal', () => {
  assert.equal(M.noTextClause(null), M.NO_TEXT_CLAUSE);
  assert.equal(M.noTextClause([]), M.NO_TEXT_CLAUSE);
  const c = M.noTextClause(['ON AIR']);
  assert.ok(c.startsWith(M.NO_TEXT_CLAUSE + '. Single exception') && c.includes('"ON AIR" may appear exactly as written'));
  assert.deepEqual(M.normalizeAllowedSceneText([' ON  AIR ', 'ON AIR', '', 7, 'x'.repeat(41), 'con "comillas"', 'ABIERTO']), ['ON AIR', 'ABIERTO']);
  assert.equal(M.normalizeAllowedSceneText('ON AIR').length, 0, 'sólo una lista');
  const spec = M.mergeVisualSpec(null, null, null, null);
  assert.equal(M.composeVisualPrompt(spec, 'c'), M.composeVisualPrompt(spec, 'c', { allowedSceneText: [] }), 'sin dato, el prompt base no cambia');
  assert.ok(M.composeVisualPrompt(spec, 'c', { allowedSceneText: ['ABIERTO'] }).includes('"ABIERTO" may appear'));
});

await ok('presupuesto: con una persona, la regla de siempre; con dos, el límite del modelo repartido', () => {
  const A = PERSONA_A.reference_image_urls, B = PERSONA_B.reference_image_urls, C = PERSONA_C.reference_image_urls;
  const L = LOCATION.reference_image_urls, X = PRODUCT.items.map((i) => i.image_url);
  // Una persona (regla de siempre): 3, o 2 con lugar o producto; lugar 1; producto 2; sin presupuesto.
  let r = M.allocateReferences({ personaRefs: [A], locationRefs: [], productRefs: [] });
  assert.deepEqual(r.persona, [A.slice(0, 3)]); assert.equal(r.budget, null);
  r = M.allocateReferences({ personaRefs: [A], locationRefs: L, productRefs: X });
  assert.deepEqual([r.persona[0].length, r.location.length, r.product.length], [2, 1, 2], 'hoy viajan 5 con una persona');
  // Dos personas, sin nada más: A 2, B 1 (la sobra va a A primero).
  assert.equal(M.MODEL_MAX_INPUT_IMAGES, 3);
  r = M.allocateReferences({ personaRefs: [A, B], locationRefs: [], productRefs: [] });
  assert.deepEqual(r.persona.map((x) => x.length), [2, 1]); assert.equal(r.budget, 3); assert.equal(r.over_budget, false);
  // Dos personas y lugar: una cada una y el lugar.
  r = M.allocateReferences({ personaRefs: [A, B], locationRefs: L, productRefs: [] });
  assert.deepEqual([r.persona.map((x) => x.length), r.location.length], [[1, 1], 1]);
  // Dos personas, lugar y producto: el lugar cede (se describe en texto); el producto no.
  r = M.allocateReferences({ personaRefs: [A, B], locationRefs: L, productRefs: X });
  assert.deepEqual([r.persona.map((x) => x.length), r.location.length, r.product.length], [[1, 1], 0, 1]);
  assert.deepEqual(r.dropped, { persona: 4, location: 2, product: 1 });
  // Tres personas y producto: el producto viaja igual y se declara el exceso.
  r = M.allocateReferences({ personaRefs: [A, B, C], locationRefs: [], productRefs: X });
  assert.deepEqual([r.persona.map((x) => x.length), r.product.length, r.over_budget], [[1, 1, 1], 1, true]);
  // Una persona sin fotos no gasta presupuesto.
  r = M.allocateReferences({ personaRefs: [A, []], locationRefs: L, productRefs: [] });
  assert.deepEqual([r.persona.map((x) => x.length), r.location.length], [[2, 0], 1], 'la plaza de B vuelve a A');
  assert.deepEqual(r.persona[0], A.slice(0, 2));
  r = M.allocateReferences({ personaRefs: [A, []], locationRefs: [], productRefs: [] });
  assert.deepEqual(r.persona.map((x) => x.length), [2, 0], 'sin lugar, la sobra vuelve a A');
});

await ok('rol de las imágenes con dos personas: por posición y por rol, en el orden en que viajan', () => {
  const c = M.imageRoleClause({ hasSource: false, personaName: 'Teodora Quispe', personaRefs: 2,
    personas: [{ name: 'Teodora Quispe', refs: 1 }, { name: 'Ignacio Huerta', refs: 1 }], locationName: 'Mostrador del puerto', locationRefs: 1 });
  assert.ok(c.startsWith(`${M.REFERENCE_PHOTOS_CLAUSE}.`));
  assert.ok(c.includes('Image 1: SUBJECT A, Teodora Quispe. Image 2: SUBJECT B, Ignacio Huerta. Image 3: BACKGROUND, the real place "Mostrador del puerto"'));
  assert.ok(c.includes('exactly 2 different people — SUBJECT A (Teodora Quispe), SUBJECT B (Ignacio Huerta) — each one exactly once'));
  assert.ok(c.includes('never merge, swap, blend or duplicate them'));
  const e = M.imageRoleClause({ hasSource: true, personaName: 'x', personaRefs: 3,
    personas: [{ name: 'Teodora Quispe', refs: 2 }, { name: 'Ignacio Huerta', refs: 1 }], productNames: ['Alicate'], productRefs: 1 });
  assert.ok(e.includes('The FIRST attached image is the current version') && e.includes('Images 2–3: SUBJECT A, Teodora Quispe. Image 4: SUBJECT B, Ignacio Huerta. Image 5: PRODUCT'));
  const sinFoto = M.imageRoleClause({ hasSource: false, personaName: 'a', personaRefs: 1,
    personas: [{ name: 'Teodora Quispe', refs: 2 }, { name: 'Marta Lillo', refs: 0 }] });
  assert.ok(sinFoto.includes('Marta Lillo has no photo: follow the written description') && !sinFoto.includes('SUBJECT B, Marta'));
  // Con una sola persona en `personas`, la redacción de siempre.
  assert.equal(M.imageRoleClause({ hasSource: false, personaName: 'P', personaRefs: 2, personas: [{ name: 'P', refs: 2 }] }),
    M.imageRoleClause({ hasSource: false, personaName: 'P', personaRefs: 2 }));
});

await ok('mensaje del constructor: dos nombradas = bloque PEOPLE y una sección por persona; una = el de siempre', () => {
  const base = { basePrompt: 'B', copyFull: 'Teodora y Nacho conversan en el Mostrador del puerto', mode: 'regenerate_full' };
  const dos = M.buildBuilderUserMessage({ ...base, persona: PERSONA_A, personas: [PERSONA_A, PERSONA_B] });
  assert.ok(dos.includes('PEOPLE — exactly 2 recurring people') && dos.includes('SUBJECT A = "Teodora Quispe", SUBJECT B = "Ignacio Huerta"'));
  assert.ok(dos.includes('PERSONA A — "Teodora Quispe"') && dos.includes('PERSONA B — "Ignacio Huerta"'));
  assert.ok(dos.includes('PERSONA A EXPRESSION') && dos.includes('PERSONA B WARDROBE') && dos.includes('navy apron over a checked shirt'));
  const una = M.buildBuilderUserMessage({ ...base, copyFull: 'Teodora sola', persona: PERSONA_A, personas: [PERSONA_A, PERSONA_B] });
  assert.equal(una, M.buildBuilderUserMessage({ ...base, copyFull: 'Teodora sola', persona: PERSONA_A }), 'una nombrada: el mensaje de siempre');
  const conLetrero = M.buildBuilderUserMessage({ ...base, location: { ...LOCATION, allowed_scene_text: ['ABIERTO'] } });
  assert.ok(conLetrero.includes('ALLOWED SCENE TEXT — this place shows "ABIERTO"'));
  assert.ok(!M.buildBuilderUserMessage({ ...base, location: LOCATION }).includes('ALLOWED SCENE TEXT'));
});

await ok('cláusulas del motor con dos personas: plural, mirada entre ellas y excepción de texto', () => {
  const l = M.engineClausesFor({ mode: 'regenerate_full', textZone: '', personaCount: 2, gaze: 'each_other', placement: '',
    productInScene: false, productComposited: false, angleSeed: '', allowedSceneText: ['ABIERTO'] });
  assert.ok(l[0].includes('"ABIERTO" may appear'));
  assert.equal(l[3], M.lightingCoherenceClause(2));
  assert.ok(l.includes(M.subjectFramingClause(2)) && l.includes(M.personaIdentityOnlyClause(2)) && l.includes(M.gazeClause('each_other', 2)));
  assert.ok(!l.includes(M.PERSONA_GAZE_CLAUSE) && !l.includes(M.SUBJECT_FRAMING_CLAUSE));
});

// ── 3 · el handler real con dos personas ──────────────────────────────────────────────────────────
console.log('── 3 · el handler con dos personas ──');
const SET = { ...LOCATION, allowed_scene_text: ['ABIERTO'] };
await ok('dos nombradas + lugar con letrero: A, B y el lugar, rotulados; mirada entre ellas; excepción del letrero', async () => {
  const restore = silence();
  let r;
  try {
    r = await run(handler, req({ copy_full: 'Teodora Quispe y Nacho conversan en el Mostrador del puerto.', title: 'Charla',
      personas: [PERSONA_A, PERSONA_B], location: SET }), { db: DB });
  } finally { restore(); }
  const d = vertexDigest(r);
  assert.equal(d.status, 200);
  assert.deepEqual(d.image_parts.map((p) => p.split('IMG:')[1]), [PERSONA_A.reference_image_urls[0], PERSONA_B.reference_image_urls[0], LOCATION.reference_image_urls[0]]);
  const text = d.image_text.join(' ');
  assert.ok(text.includes('Image 1: SUBJECT A, Teodora Quispe. Image 2: SUBJECT B, Ignacio Huerta. Image 3: BACKGROUND'));
  assert.ok(text.includes('look at each other') && text.includes('"ABIERTO" may appear') && text.includes('Frame tightly around the 2 people'));
  assert.ok(d.builder_user.includes('PEOPLE — exactly 2') && d.builder_user.includes('ALLOWED SCENE TEXT'));
  assert.deepEqual(r.json.personas_used, ['Teodora Quispe', 'Ignacio Huerta']);
  assert.deepEqual([r.json.persona_refs, r.json.reference_budget, r.json.gaze, r.json.reference_images], [[1, 1], 3, 'each_other', 3]);
  assert.equal(r.json.persona_used, true);
});

await ok('dos nombradas sin lugar ni producto: A con 2 fotos y B con 1, sin síntesis también', async () => {
  const restore = silence();
  let r;
  try { r = await run(handler, req({ title: 'Teodora y Nacho', personas: [PERSONA_A, PERSONA_B] }), { db: DB }); } finally { restore(); }
  const d = vertexDigest(r);
  assert.deepEqual(d.image_parts.map((p) => p.split('IMG:')[1]), [...PERSONA_A.reference_image_urls.slice(0, 2), PERSONA_B.reference_image_urls[0]]);
  assert.ok(d.image_text[0].includes('Images 1–2: SUBJECT A, Teodora Quispe. Image 3: SUBJECT B, Ignacio Huerta.'));
  assert.equal(d.builder_user, null, 'sin copy entero no hay constructor');
});

await ok('personas[] con una sola nombrada: el camino de una persona, con la clave nueva en la respuesta', async () => {
  const restore = silence();
  let r, legacy;
  try {
    r = await run(handler, req({ copy_full: 'Nacho revisa el pedido.', title: 'Pedido', personas: [PERSONA_A, PERSONA_B] }), { db: DB });
    legacy = await run(handler, req({ copy_full: 'Nacho revisa el pedido.', title: 'Pedido', persona: PERSONA_B }), { db: DB });
  } finally { restore(); }
  const a = vertexDigest(r), b = vertexDigest(legacy);
  assert.deepEqual([a.image_parts, a.image_text, a.builder_user], [b.image_parts, b.image_text, b.builder_user]);
  assert.deepEqual(r.json.personas_used, ['Ignacio Huerta']);
  assert.ok(!('personas_used' in legacy.json), 'con el alias legacy, la respuesta de siempre');
});

await ok('errores declarados: más de 3 personas, persona mal formada, mirada ajena', async () => {
  const restore = silence();
  try {
    const muchas = await run(handler, req({ copy_full: 'x', personas: [PERSONA_A, PERSONA_B, PERSONA_C, { ...PERSONA_C, name: 'Cuarta' }] }), { db: DB });
    assert.equal(muchas.status, 400); assert.match(muchas.json.error, /PERSONAS_TOO_MANY/); assert.equal(muchas.vertexImage, null);
    const mala = await run(handler, req({ copy_full: 'x', personas: [{ name: 'Sin descripción' }] }), { db: DB });
    assert.equal(mala.status, 400); assert.match(mala.json.error, /PERSONAS_INVALID/);
    const mirada = await run(handler, req({ copy_full: 'Teodora y Nacho', personas: [PERSONA_A, PERSONA_B], gaze: 'arriba' }), { db: DB });
    assert.equal(mirada.status, 400); assert.match(mirada.json.error, /GAZE_INVALID/);
  } finally { restore(); }
});

await ok('dos personas y producto en escena: el producto viaja con su foto y el lugar cede', async () => {
  const restore = silence();
  let r;
  try {
    r = await run(handler, req({ copy_full: 'Teodora le muestra el kit a Nacho en el Mostrador del puerto.', title: 'Kit',
      personas: [PERSONA_A, PERSONA_B], location: LOCATION, product: PRODUCT }), { db: DB });
  } finally { restore(); }
  const d = vertexDigest(r);
  assert.deepEqual(d.image_parts.map((p) => p.split('IMG:')[1]), [PERSONA_A.reference_image_urls[0], PERSONA_B.reference_image_urls[0], PRODUCT.items[0].image_url]);
  assert.ok(d.image_text.join(' ').includes('Image 3: PRODUCT, the real packaging (Llave inglesa 10")'));
  assert.deepEqual(r.json.references_dropped, { persona: 4, location: 2, product: 1 });
});

// ── 4 · multimarca y voseo ───────────────────────────────────────────────────────────────────────
console.log('── 4 · multimarca y voseo ──');
const nuevo = source.slice(source.indexOf('// ── VARIAS PERSONAS EN UNA IMAGEN'), source.indexOf('export interface PromptBuilderInput'));
const textoPermitido = source.slice(source.indexOf('// ── TEXTO PERMITIDO EN ESCENA'), source.indexOf('// ── BRIEF-N06 · LA CLÁUSULA DE SUJETOS DISTINTOS'));
await ok('el código nuevo no nombra marcas, personas reales ni textos de un set', () => {
  assert.ok(nuevo.length > 2000 && textoPermitido.length > 500, 'no se encontraron los bloques nuevos');
  const sinComentarios = (nuevo + textoPermitido).split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  for (const lit of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'Patricia', 'Clara', 'Lucien', 'Irja', 'ON AIR', 'podcast', 'Neurone']) {
    assert.ok(!sinComentarios.includes(lit), `literal «${lit}» en el código nuevo`);
  }
});

await ok('sin voseo en lo nuevo (comentarios, cadenas y tests)', () => {
  const VOSEO = /(?<!\p{L})(querés|podés|tenés|sabés|hacés|decís|sos|vos|mirá|fijate|andá|vení|poné|usá|hacé|decí|tené|agregá|revisá|probá|dejá|sacá|cambiá|tomá|pasá|llamá|elegí vos|acordate|fijá|corré|escribí vos)(?!\p{L})/iu;
  const propios = [nuevo, textoPermitido, readFileSync(fileURLToPath(import.meta.url), 'utf8'),
    readFileSync(join(ROOT, 'tests', '_handler_harness.mjs'), 'utf8'), readFileSync(join(ROOT, 'tests', 'fixtures', 'personas_escenarios.mjs'), 'utf8')];
  for (const t of propios) {
    const lineas = t.split('\n').filter((l) => !l.includes('const VOSEO'));
    const hit = lineas.find((l) => VOSEO.test(l));
    assert.equal(hit, undefined, `voseo en: ${hit}`);
  }
});

console.log(`\n✅ personas_test — ${n} bloques OK`);
