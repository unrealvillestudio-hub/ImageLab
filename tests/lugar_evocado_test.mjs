// EL LUGAR EVOCADO (2026-10-22) — una ciudad o un barrio, en una escena NUEVA que «se ve como» ese lugar.
//
// Pedido de Sam (2026-10-22): «podrías hacer que el modelo tome información y referencias de las del bp_location
// y de internet para sacar nuevas imágenes que se vean como si fueran» la ciudad de la marca. Hasta hoy un lugar
// viajaba siempre como «a real place of this brand», con sus fotos como fondo: la imagen copiaba la foto.
//
// Qué fija, sin red:
//   1. Piezas puras: el modo (sólo `evoke` declarado cambia algo), la lista de lo que no debe parecer, la cláusula.
//   2. Reparto: con el lugar evocado, su foto es lo primero que cede dentro de `MODEL_MAX_INPUT_IMAGES`, también
//      con una persona. Sin la bandera, el reparto de siempre.
//   3. Rótulos y mensaje del constructor: la foto es ESTILO, la escena es nueva; sin foto, sólo el texto.
//   4. El handler real: con el lugar evocado viajan como mucho 3 imágenes, el prompt lleva la cláusula y la
//      respuesta dice `location_mode: 'evoke'`. Con el modo exacto (o sin modo), el cuerpo hacia Vertex es
//      IDÉNTICO al de `main` (`fixtures/lugar_exacto_golden.json`, congelado sobre f8daae9).
//   5. Multimarca (ningún nombre de ciudad en el código nuevo) y voseo.
//
// La marca de los fixtures es la ferretería inventada de Valparaíso de `personas_escenarios.mjs`.
//
// Ejecutar:  node tests/lugar_evocado_test.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { loadHandler, run, vertexDigest } from './_handler_harness.mjs';
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
const dir = mkdtempSync(join(tmpdir(), 'evocar-'));
const mod = join(dir, 'evocar_block.mts');
writeFileSync(mod, `${fb[0]}\n\n${block('C')}\n\n${block('PB')}\nexport { NO_TEXT_CLAUSE };\n`, 'utf8');
const M = await import(pathToFileURL(mod).href);

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`  ✓ ${name}`); };
const silence = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };
const { PERSONA_A, PERSONA_B, PRODUCT } = PERSONAS;

// Un puerto inventado, evocado: su perfil y una foto de estilo.
const PUERTO = {
  name: 'Cerro del puerto',
  description: 'steep hills of painted wooden houses with corrugated-iron roofs, funicular lifts, narrow stairways, the bay and cranes below, sea fog in the morning',
  reference_image_urls: ['https://cdn.example.invalid/l/cerro_1.jpg', 'https://cdn.example.invalid/l/cerro_2.jpg'],
  mode: 'evoke',
  avoid: ['a flat beach resort', 'glass skyscrapers', 'a flat beach resort', ' '],
};

// ── 1 · piezas puras ─────────────────────────────────────────────────────────────────────────────────
console.log('── 1 · piezas puras ──');
await ok('el modo: sólo `evoke` declarado; ausente, nulo u otro valor es `exact`', () => {
  assert.equal(M.locationModeOf({ mode: 'evoke' }), 'evoke');
  for (const x of [{}, { mode: null }, { mode: 'EVOKE' }, { mode: 'exact' }, null, undefined]) assert.equal(M.locationModeOf(x), 'exact');
});
await ok('lo que no debe parecer: limpio, sin vacíos ni repetidos, en su orden', () => {
  assert.deepEqual(M.normalizeLocationAvoid(PUERTO.avoid), ['a flat beach resort', 'glass skyscrapers']);
  assert.deepEqual(M.normalizeLocationAvoid('no es lista'), []);
});
await ok('la cláusula del lugar evocado: con foto prohíbe copiarla; con lista, la dice', () => {
  const c = M.locationEvokeClause('Cerro del puerto', 1, PUERTO.avoid);
  assert.match(c, /read unmistakably as Cerro del puerto, in a new view of it/);
  assert.match(c, /never a copy of the building, street or framing of the location reference photo/);
  assert.match(c, /must not look like a flat beach resort, glass skyscrapers$/);
  const sinFoto = M.locationEvokeClause('Cerro del puerto', 0, []);
  assert.ok(!sinFoto.includes('reference photo') && !sinFoto.includes('must not look like'));
});
await ok('engineClausesFor: sin lugar evocado, la lista de antes; con él, una cláusula más al final (y ninguna al editar)', () => {
  const base = { mode: 'regenerate_full', textZone: '', personaCount: 1, gaze: null, placement: '', productInScene: false, productComposited: false, angleSeed: 'x' };
  const antes = M.engineClausesFor(base);
  const con = M.engineClausesFor({ ...base, locationEvoke: { name: 'Cerro del puerto', refs: 1, avoid: [] } });
  assert.deepEqual(con.slice(0, -1), antes);
  assert.equal(con.at(-1), M.locationEvokeClause('Cerro del puerto', 1, []));
  assert.deepEqual(M.engineClausesFor({ ...base, mode: 'edit_from_current', locationEvoke: { name: 'Cerro del puerto', refs: 1 } }),
    M.engineClausesFor({ ...base, mode: 'edit_from_current' }));
});

// ── 2 · reparto ──────────────────────────────────────────────────────────────────────────────────────
console.log('── 2 · reparto ──');
const A = PERSONA_A.reference_image_urls, L = PUERTO.reference_image_urls, X = PRODUCT.items.map((i) => i.image_url);
await ok('sin la bandera, una persona: el reparto de siempre (2 + 1 + 2 = 5)', () => {
  const r = M.allocateReferences({ personaRefs: [A], locationRefs: L, productRefs: X });
  assert.deepEqual([r.persona[0].length, r.location.length, r.product.length], [2, 1, 2]);
});
await ok('evocado, una persona: la foto de estilo entra si cabe (2 + 1 = 3)', () => {
  const r = M.allocateReferences({ personaRefs: [A], locationRefs: L, productRefs: [], locationEvoke: true });
  assert.deepEqual([r.persona[0].length, r.location.length], [2, 1]);
});
await ok('evocado, una persona y producto: la foto de estilo cede (2 + 2, el lugar queda en texto)', () => {
  const r = M.allocateReferences({ personaRefs: [A], locationRefs: L, productRefs: X, locationEvoke: true });
  assert.deepEqual([r.persona[0].length, r.location.length, r.product.length], [2, 0, 2]);
  assert.equal(r.dropped.location, 2);
});
await ok('evocado, editando con una persona: la imagen actual cuenta (1 + 2, sin foto de estilo)', () => {
  const r = M.allocateReferences({ personaRefs: [A], locationRefs: L, productRefs: [], reserved: 1, locationEvoke: true });
  assert.deepEqual([r.persona[0].length, r.location.length], [2, 0]);
});
await ok('evocado, sin persona: la foto de estilo viaja; con dos personas, el presupuesto de siempre', () => {
  assert.equal(M.allocateReferences({ personaRefs: [], locationRefs: L, productRefs: [], locationEvoke: true }).location.length, 1);
  const r = M.allocateReferences({ personaRefs: [A, PERSONA_B.reference_image_urls], locationRefs: L, productRefs: [], locationEvoke: true });
  assert.deepEqual(r, M.allocateReferences({ personaRefs: [A, PERSONA_B.reference_image_urls], locationRefs: L, productRefs: [] }));
});

// ── 3 · rótulos y constructor ────────────────────────────────────────────────────────────────────────
console.log('── 3 · rótulos y constructor ──');
await ok('rótulo con una persona: la foto del lugar evocado es ESTILO; sin la bandera, el fondo real de siempre', () => {
  const args = { hasSource: false, personaName: 'Teodora Quispe', personaRefs: 2, locationName: 'Cerro del puerto', locationRefs: 1 };
  const e = M.imageRoleClause({ ...args, locationEvoke: true });
  assert.match(e, /Attached image 3 is a STYLE reference of "Cerro del puerto" only/);
  assert.match(e, /never reproduce the building, street or view it shows/);
  assert.match(M.imageRoleClause(args), /Attached image 3 show the real place "Cerro del puerto": set the scene there as the backdrop/);
});
await ok('rótulo con dos personas: «STYLE of the place» en lugar de «BACKGROUND, the real place»', () => {
  const args = { hasSource: false, personaName: 'x', personaRefs: 2, personas: [{ name: 'Teodora', refs: 1 }, { name: 'Nacho', refs: 1 }], locationName: 'Cerro del puerto', locationRefs: 1 };
  assert.match(M.imageRoleClause({ ...args, locationEvoke: true }), /Image 3: STYLE of the place "Cerro del puerto"/);
  assert.match(M.imageRoleClause(args), /Image 3: BACKGROUND, the real place "Cerro del puerto"/);
});
await ok('constructor: escena NUEVA, foto como atmósfera, lista de lo que no debe parecer; sin foto, sólo texto', () => {
  const base = { basePrompt: 'BASE', copyFull: 'Teodora sube al cerro.', title: 'Cerro', persona: PERSONA_A, mode: 'regenerate_full' };
  const m = M.buildBuilderUserMessage({ ...base, location: { ...PUERTO, reference_image_urls: [L[0]] } });
  assert.match(m, /LOCATION — the scene is set in "Cerro del puerto" and must read unmistakably as that place, in a NEW view of it/);
  assert.match(m, /ATMOSPHERE and STYLE reference only/);
  assert.match(m, /LOCATION — MUST NOT LOOK LIKE: a flat beach resort; glass skyscrapers\./);
  assert.ok(!m.includes('a real place of this brand'));
  const s = M.buildBuilderUserMessage({ ...base, location: { ...PUERTO, reference_image_urls: [] } });
  assert.match(s, /There is no photo of it: build the place from this description alone/);
  assert.ok(!s.includes('ATMOSPHERE and STYLE'));
  // Sin modo: el bloque de siempre, carácter a carácter.
  const exacto = M.buildBuilderUserMessage({ ...base, location: { name: PUERTO.name, description: PUERTO.description, reference_image_urls: L } });
  assert.match(exacto, /a real place of this brand shown in the attached location photo\(s\)/);
});

// ── 4 · el handler real ──────────────────────────────────────────────────────────────────────────────
console.log('── 4 · el handler real ──');
const handler = await loadHandler();
// El golden de los casos exactos se congeló el 2026-10-22 sobre `main` (f8daae9) con `tests/_capturar_golden_lugar.mjs`.
const GOLDEN = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'lugar_exacto_golden.json'), 'utf8'));
const { EXACTOS } = await import('./fixtures/lugar_escenarios.mjs');
await ok(`modo exacto o sin modo: el cuerpo hacia Vertex es IDÉNTICO al de main en los ${Object.keys(EXACTOS).length} escenarios`, async () => {
  assert.deepEqual(Object.keys(GOLDEN).sort(), Object.keys(EXACTOS).sort());
  const restore = silence();
  try {
    for (const [name, body] of Object.entries(EXACTOS)) {
      assert.deepEqual(vertexDigest(await run(handler, body, { db: DB })), GOLDEN[name], `el escenario «${name}» cambió`);
    }
  } finally { restore(); }
});
await ok('evocado con una persona: 3 imágenes (2 de ella + 1 de estilo), cláusula en el prompt y `location_mode`', async () => {
  const restore = silence();
  let r;
  try { r = await run(handler, req({ copy_full: 'Teodora sube al cerro.', title: 'Cerro', persona: PERSONA_A, location: PUERTO }), { db: DB }); }
  finally { restore(); }
  const d = vertexDigest(r);
  assert.equal(r.status, 200);
  assert.equal(d.image_parts.length, 3);
  assert.ok(d.image_parts[2].includes('cerro_1.jpg'), 'la tercera es la foto de estilo');
  const texto = d.image_text.join(' ');
  assert.match(texto, /Attached image 3 is a STYLE reference of "Cerro del puerto" only/);
  assert.ok(texto.includes(M.locationEvokeClause('Cerro del puerto', 1, PUERTO.avoid)), 'la cláusula del motor se repone');
  assert.match(d.builder_user, /in a NEW view of it/);
  assert.equal(r.json.location_mode, 'evoke');
  assert.equal(r.json.location_used, 'Cerro del puerto');
  assert.equal(r.json.location_refs, 1);
});
await ok('evocado con persona y producto: el lugar queda en texto, nunca más de lo que cabe; sin foto no promete foto', async () => {
  const restore = silence();
  let r, s;
  try {
    r = await run(handler, req({ copy_full: 'Teodora, en el cerro, con el kit.', title: 'Kit', persona: PERSONA_A, location: PUERTO, product: PRODUCT }), { db: DB });
    s = await run(handler, req({ copy_full: 'El cerro al amanecer.', title: 'Cerro', location: { ...PUERTO, reference_image_urls: [] } }), { db: DB });
  } finally { restore(); }
  assert.equal(r.json.location_refs, 0);
  assert.ok(!vertexDigest(r).builder_user.includes('ATMOSPHERE and STYLE'), 'no habla de una foto que no viaja');
  assert.match(vertexDigest(r).builder_user, /There is no photo of it/);
  assert.equal(s.json.location_refs, 0);
  assert.equal(s.json.location_mode, 'evoke');
  assert.ok(vertexDigest(s).image_text.join(' ').includes(M.locationEvokeClause('Cerro del puerto', 0, PUERTO.avoid)));
});

// ── 5 · multimarca y voseo ───────────────────────────────────────────────────────────────────────────
console.log('── 5 · multimarca y voseo ──');
await ok('el código nuevo no nombra ciudades, barrios ni marcas', () => {
  const nuevo = ['export type LocationMode', 'export function locationModeOf', 'export function normalizeLocationAvoid', 'export function locationEvokeClause']
    .map((f) => { const i = source.indexOf(f); assert.ok(i >= 0, f); return source.slice(i, source.indexOf('\n}\n', i) + 2); }).join('\n') +
    source.split('\n').filter((l) => /locationEvoke|location_mode|EVOCAR/.test(l)).join('\n');
  for (const w of ['Panam', 'Miami', 'Florida', 'Broward', 'ForumPHs', 'NeuroneSCF', 'Brickell', 'Costa del Este']) {
    assert.ok(!nuevo.includes(w), `literal de marca o ciudad en el código nuevo: ${w}`);
  }
});
await ok('sin voseo en los comentarios nuevos', () => {
  const lineas = source.split('\n').filter((l) => /2026-10-22/.test(l)).join('\n');
  for (const v of [/\bacá\b/i, /\bvos\b/i, /\btenés\b/i, /\bpodés\b/i, /\bquerés\b/i]) assert.ok(!v.test(lineas), String(v));
});

console.log(`\nVERDE · ${n} comprobaciones del lugar evocado`);
