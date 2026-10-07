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

// 2026-10-03 (motor de personas) — la lista de cláusulas que se reponen sobre la síntesis salió del
// handler a `engineClausesFor` (bloque PB). Las comprobaciones que antes leían esa lista en la FUENTE
// del handler ahora la EJECUTAN (CC_PROTOCOL §14.3: un test pegado a la arquitectura se hace
// independiente, no se relaja). Y se comprueba que el handler la usa.
const ENGINE_ARGS = { mode: 'regenerate_full', textZone: 'TEXTZONE', personaCount: 1, gaze: null, placement: 'PLACEMENT',
  productInScene: true, productComposited: false, angleSeed: 's' };
const engine = (over = {}) => M.engineClausesFor({ ...ENGINE_ARGS, ...over });
assert.match(source, /enforceEngineClauses\(synth\.text, engineClausesFor\(\{/, 'el handler no repone las cláusulas con engineClausesFor');

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
  assert.ok(M.imageRoleClause({ hasSource: false, personaName: 'P', personaRefs: 1 }).includes('The attached image(s) show P'));
});

// 6b · LOCACIÓN y PRODUCTO (2026-09-27)
ok('imageRoleClause con locación nombra las imágenes por posición', () => {
  const all = M.imageRoleClause({ hasSource: true, personaName: 'P', personaRefs: 3, locationName: 'Lugar X', locationRefs: 2 });
  assert.ok(all.includes('Attached images 2 to 4 show P'));
  assert.ok(all.includes('Attached images 5 to 6 show the real place "Lugar X"'));
  const solo = M.imageRoleClause({ hasSource: false, personaName: null, personaRefs: 0, locationName: 'Lugar X', locationRefs: 1 });
  assert.ok(solo.includes('Attached image 1 show the real place "Lugar X"'));
  assert.ok(solo.includes('Do not copy any person'));
  // sin locación, la redacción de siempre (compatibilidad)
  assert.equal(M.imageRoleClause({ hasSource: true, personaName: 'P', personaRefs: 2, locationName: 'L', locationRefs: 0 }),
    M.imageRoleClause({ hasSource: true, personaName: 'P', personaRefs: 2 }));
});
ok('buildBuilderUserMessage lleva la locación y el aviso de producto sólo si llegan', () => {
  const base = M.buildBuilderUserMessage({ basePrompt: 'B', copyFull: 'c' });
  assert.ok(!base.includes('LOCATION') && !base.includes('PRODUCT:'));
  const con = M.buildBuilderUserMessage({ basePrompt: 'B', copyFull: 'c',
    location: { name: 'Lugar X', description: 'desc del lugar', reference_image_urls: ['https://x/1.jpg'] }, productComposited: true });
  assert.ok(con.includes('LOCATION — the scene takes place at "Lugar X"'));
  assert.ok(con.includes('desc del lugar'));
  assert.ok(con.includes(M.PRODUCT_COMPOSITED_CLAUSE));
});
ok('la cláusula de producto sobrevive a la síntesis (enforceEngineClauses)', () => {
  const out = M.enforceEngineClauses('una escena', [M.PRODUCT_COMPOSITED_CLAUSE]);
  assert.ok(out.startsWith(M.PRODUCT_COMPOSITED_CLAUSE));
});

// 6c · OPCIÓN (c) — el producto se pinta en la escena, a su tamaño real
ok('productSizeLine da cm y caras; sin medida, pide proporción con la mano', () => {
  assert.equal(M.productSizeLine({ name: 'P', height_cm: 24, width_cm: 8.5 }), '"P": about 24 cm tall and 8.5 cm wide (about 1.3× the height of an adult face)');
  assert.ok(M.productSizeLine({ name: 'P' }).includes('relative to a human hand'));
});
ok('buildBuilderUserMessage: con producto en escena manda tamaño y NO la cláusula de pegado', () => {
  const msg = M.buildBuilderUserMessage({ basePrompt: 'B', copyFull: 'c', productComposited: true,
    product: { name: 'Kit', items: [{ name: 'P1', image_url: 'https://x/p1.png', height_cm: 24, width_cm: 8.5 }] } });
  assert.ok(msg.includes('PRODUCT — the real packaging of "P1" appears in the scene'));
  assert.ok(msg.includes('about 24 cm tall'));
  assert.ok(!msg.includes(M.PRODUCT_COMPOSITED_CLAUSE));
});
ok('imageRoleClause: anti-collage siempre que hay referencias, y producto por posición', () => {
  const c = M.imageRoleClause({ hasSource: false, personaName: 'P', personaRefs: 2, locationName: 'L', locationRefs: 1, productNames: ['X'], productRefs: 1 });
  assert.ok(c.startsWith(M.REFERENCE_PHOTOS_CLAUSE));
  assert.ok(c.includes('Attached images 1 to 2 show P'));
  assert.ok(c.includes('Attached image 3 show the real place "L"'));
  assert.ok(c.includes('Attached image 4 show the real product packaging (X)'));
  const soloPersona = M.imageRoleClause({ hasSource: false, personaName: 'P', personaRefs: 1 });
  assert.ok(soloPersona.includes(M.REFERENCE_PHOTOS_CLAUSE) && soloPersona.includes('The attached image(s) show P'));
  assert.equal(M.imageRoleClause({ hasSource: false, personaName: null, personaRefs: 0 }), '');
});

ok('encuadre: el sujeto manda y la locación es fondo; la cláusula sólo al generar desde cero', () => {
  assert.ok(M.SUBJECT_FRAMING_CLAUSE.includes('no large empty area'));
  const msg = M.buildBuilderUserMessage({ basePrompt: 'B', copyFull: 'c',
    location: { name: 'L', description: 'd', reference_image_urls: ['https://x/l.jpg'] } });
  assert.ok(msg.includes('It is the BACKDROP') && !msg.includes('architecture, materials, colours and layout'));
  const c = M.imageRoleClause({ hasSource: false, personaName: 'P', personaRefs: 1, locationName: 'L', locationRefs: 1 });
  assert.ok(c.includes('frame the subject, not the room'));
  assert.ok(engine().includes(M.SUBJECT_FRAMING_CLAUSE), 'al generar desde cero, el encuadre se repone');
  assert.ok(!engine({ mode: 'edit_from_current' }).includes(M.SUBJECT_FRAMING_CLAUSE), 'al editar, no');
});

ok('la expresión de la persona sigue el tono del gancho, sólo cuando la persona sale', () => {
  const persona = { name: 'P', description: 'd', reference_image_urls: ['https://x/p.jpg'] };
  const con = M.buildBuilderUserMessage({ basePrompt: 'B', copyFull: 'con P', imageHook: 'Tu cabello dañado', persona });
  assert.ok(con.includes('PERSONA EXPRESSION') && con.includes(M.PERSONA_EXPRESSION_CLAUSE));
  const sin = M.buildBuilderUserMessage({ basePrompt: 'B', copyFull: 'sin nombre', imageHook: 'x', persona });
  assert.ok(!sin.includes('PERSONA EXPRESSION'), 'si la persona no se nombra no hay gesto que dictar');
});

ok('zona de texto: sale del dato de la marca, y sin dato no hay cláusula', () => {
  const c = M.textZoneClause({ anchor: 'bottom_left', text_zone_pct: 40 });
  assert.ok(c.startsWith('The lower 40% of the frame will carry text') && c.includes('upper 60%'));
  assert.ok(c.includes('raised to shoulder or face height'), 'la altura del envase viaja con la franja');
  assert.ok(M.textZoneClause({ anchor: 'top_right', text_zone_pct: 30 }).startsWith('The upper 30%'));
  assert.equal(M.textZoneClause({ anchor: 'bottom_left' }), '', 'sin porcentaje declarado, nada');
  assert.equal(M.textZoneClause({ anchor: 'center', text_zone_pct: 40 }), '', 'anclaje sin lado, nada');
  assert.equal(M.textZoneClause(null), '');
  const l = engine();
  assert.equal(l.indexOf('TEXTZONE'), l.indexOf(M.SUBJECT_FRAMING_CLAUSE) + 1, 'la zona de texto va pegada al encuadre');
  assert.ok(!engine({ textZone: '' }).includes(''), 'sin zona declarada, no hay cláusula vacía');
});

ok('gesto: el catálogo de la persona manda; sin catálogo, la regla general', () => {
  const persona = { name: 'P', description: 'd', reference_image_urls: ['https://x/p.jpg'],
    expressions: [{ when: 'she holds a product', face: 'warm smile' }], expression_avoid: ['forced grin'] };
  const b = M.personaExpressionBlock(persona);
  assert.ok(b.includes("Pick P's facial expression from this catalog") && b.includes('- when she holds a product: warm smile') && b.includes('Never: forced grin.'));
  assert.equal(M.personaExpressionBlock({ name: 'P', description: 'd' }), `${M.PERSONA_EXPRESSION_CLAUSE}.`);
  const msg = M.buildBuilderUserMessage({ basePrompt: 'B', copyFull: 'con P', imageHook: 'h', persona });
  assert.ok(msg.includes('- when she holds a product: warm smile'));
});
ok('luz por capas: fuente, temperatura y grano compartidos, sin aplanar; se repone siempre', () => {
  const L = M.LIGHTING_COHERENCE_CLAUSE;
  assert.ok(L.includes('never flat') && L.includes('key light on the face') && L.includes('same light direction, color temperature'));
  assert.ok(L.includes('film grain') && L.includes('depth and perspective'));
  assert.ok(!L.includes('same direction, color temperature, intensity'), 'la intensidad pareja es lo que aplanaba');
  const l = engine();
  assert.ok(l[2].startsWith('The image is ONE single photograph') && l[3] === M.LIGHTING_COHERENCE_CLAUSE, 'la luz va detrás del encuadre único');
  assert.equal(engine({ personaCount: 0 })[3], M.LIGHTING_COHERENCE_CLAUSE, 'se repone siempre, con o sin persona');
});

ok('vestuario: las fotos son identidad, no ropa; el catálogo de la persona manda', () => {
  const persona = { name: 'P', description: 'd', reference_image_urls: ['https://x/p.jpg'],
    wardrobe: [{ when: 'outdoors', outfit: 'white linen shirt' }, { when: '', outfit: 'x' }] };
  const b = M.personaWardrobeBlock(persona, 'regenerate_full');
  assert.ok(b.startsWith(M.PERSONA_IDENTITY_ONLY_CLAUSE) && b.includes('- outdoors: white linen shirt') && !b.includes('- : x'));
  assert.equal(M.personaWardrobeBlock({ name: 'P', description: 'd' }, null), `${M.PERSONA_IDENTITY_ONLY_CLAUSE}.`);
  assert.ok(M.personaWardrobeBlock(persona, 'edit_from_current').startsWith('Keep the clothing of the current image'));
  const msg = M.buildBuilderUserMessage({ basePrompt: 'B', copyFull: 'con P', imageHook: 'h', persona });
  assert.ok(msg.includes('PERSONA WARDROBE') && msg.includes('white linen shirt'));
  const sin = M.buildBuilderUserMessage({ basePrompt: 'B', copyFull: 'sin nombre', imageHook: 'h', persona });
  assert.ok(!sin.includes('PERSONA WARDROBE'), 'si la persona no sale, no hay ropa que dictar');
  assert.ok(M.imageRoleClause({ hasSource: false, personaName: 'P', personaRefs: 1 }).includes('never copy their clothing or pose'));
});

ok('lugar del producto: sale de la franja de texto de la marca, y se repone con la identidad', () => {
  const abajo = { anchor: 'bottom_left', text_zone_pct: 40 };
  // 2026-10-07 — antes un envase con persona iba SIEMPRE en la mano y un kit podía ir en la mano.
  // Ahora el kit nunca, y el envase rota por semilla entre mano, en uso y sobre superficie.
  assert.ok(M.productPlacementClause(abajo, false).includes('raised surface in the upper part'));
  assert.ok(M.productPlacementClause(abajo, true, 3).includes('NEVER held'), 'kit de varios artículos: nunca en la mano');
  assert.ok(!M.productPlacementClause(abajo, true, 3).includes('holds them up'), 'kit: la salida «she holds them up» ya no existe');
  assert.ok(M.productPlacementClause(abajo, true, 1, { kind: 'kit', seed: 'x' }).includes('NEVER held'), 'kit con foto de grupo (1 artículo): nunca en la mano');
  assert.ok(M.productPlacementClause(abajo, true, 1, { kind: 'product', seed: 'x' }).length > 0, 'un envase: alguna puesta en escena');
  assert.ok(M.productPlacementClause({ anchor: 'top_right', text_zone_pct: 30 }, true).includes('lower part of the frame'));
  assert.equal(M.productPlacementClause({ anchor: 'bottom_left' }, true), '', 'sin franja declarada, nada');
  const l = engine();
  assert.equal(l.indexOf('PLACEMENT'), l.indexOf(M.PERSONA_IDENTITY_ONLY_CLAUSE) + 1, 'el lugar del producto va pegado a la identidad');
  assert.ok(!engine({ personaCount: 0 }).includes(M.PERSONA_IDENTITY_ONLY_CLAUSE), 'sin persona, no hay identidad que reponer');
});

ok('puesta en escena del producto: kits sobre superficie, envase que rota, mano sólo si el carril dice envase (Sam, 2026-10-07)', () => {
  const abajo = { anchor: 'bottom_left', text_zone_pct: 40 };
  // Un kit nunca es «held», con cualquier semilla.
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
    assert.equal(M.productStagingFor('kit', 1, seed), 'on_surface', `kit, semilla ${seed}`);
    assert.equal(M.productStagingFor(null, 3, seed), 'on_surface', `varios artículos, semilla ${seed}`);
    assert.equal(M.productStagingFor(null, 1, seed), 'on_surface', `sin kind declarado, sobre superficie: ni mano ni uso (semilla ${seed})`);
  }
  // Un envase declarado rota entre las tres, y la semilla es estable.
  const vistos = new Set(Array.from({ length: 40 }, (_, i) => M.productStagingFor('product', 1, `pieza-${i}`)));
  assert.deepEqual([...vistos].sort(), ['held', 'in_use', 'on_surface'], 'las tres puestas en escena aparecen');
  assert.equal(M.productStagingFor('product', 1, 'p-1'), M.productStagingFor('product', 1, 'p-1'), 'misma pieza, misma escena');
  // Cada puesta en escena produce su cláusula, y la del kit nombra la superficie del lugar.
  const kit = M.productPlacementClause(abajo, true, 1, { kind: 'kit', seed: 's' });
  assert.ok(kit.includes('belongs to this place') && kit.includes('never in her hands'));
  const textos = new Set(Array.from({ length: 40 }, (_, i) => M.productPlacementClause(abajo, true, 1, { kind: 'product', seed: `pieza-${i}` })));
  assert.equal(textos.size, 3, 'tres cláusulas distintas para un envase');
  assert.ok([...textos].every((t) => t.includes('right half of the frame')), 'el lado contrario al texto se conserva en las tres');
  // Franja arriba: el kit tampoco va en la mano.
  assert.ok(M.productPlacementClause({ anchor: 'top_left', text_zone_pct: 30 }, true, 1, { kind: 'kit' }).includes('never held'));
});

ok('producto: del lado contrario al texto, con ángulo estable por semilla; mirada con destino', () => {
  assert.ok(M.productPlacementClause({ anchor: 'bottom_left', text_zone_pct: 40 }, true).includes('right half of the frame'));
  assert.ok(M.productPlacementClause({ anchor: 'bottom_right', text_zone_pct: 40 }, true).includes('left half of the frame'));
  assert.ok(!M.productPlacementClause({ anchor: 'bottom_center', text_zone_pct: 40 }, true).includes('half of the frame'), 'sin esquina, sin lado');
  const a = M.productAngleClause('pieza-1');
  assert.equal(a, M.productAngleClause('pieza-1'), 'misma pieza, mismo lado');
  assert.ok(/turned slightly to the (left|right)/.test(a) && a.includes('label stays fully readable'));
  const lados = new Set(['a','b','c','d','e','f','g','h'].map((s) => M.productAngleClause(s).includes('to the left') ? 'L' : 'R'));
  assert.equal(lados.size, 2, 'las semillas reparten los dos lados');
  assert.ok(M.PERSONA_GAZE_CLAUSE.includes('into the camera, at the other person in the scene, or at the product'));
  assert.ok(engine().includes(M.PERSONA_GAZE_CLAUSE), 'con persona y sin dato de mirada, la cláusula de siempre');
  assert.ok(!engine({ personaCount: 0 }).includes(M.PERSONA_GAZE_CLAUSE), 'sin persona, sin mirada');
});

// 7 · MULTIMARCA: el bloque no nombra marcas ni personas reales.
ok('el bloque PB no contiene literales de marca', () => {
  const pb = block('PB');
  for (const lit of ['Lucien', 'LucienSael', 'Neurone', 'ForumPHs', 'Unrealville', 'Patricia']) {
    assert.ok(!pb.includes(lit), `literal de marca en PB: ${lit}`);
  }
});

console.log(`\n✅ prompt_builder_test — ${n} bloques OK`);
