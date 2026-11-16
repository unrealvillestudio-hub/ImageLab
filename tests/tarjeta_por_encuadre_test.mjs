// TARJETA DE IDENTIDAD POR ENCUADRE (2026-11-15) — cada persona viaja en UNA imagen, la de la clase de la imagen.
//
// Qué fija, sin red:
//   1. La regla de clase (Sam, 2026-11-15): dato válido manda; sin dato, `tight` → close y `scene` → medium; un
//      valor ajeno avisa y usa la del encuadre.
//   2. Qué tarjeta viaja: la de la clase; sin ella, la de `medium`; sin tarjetas, las fotos sueltas de siempre.
//   3. El handler real: con tarjeta, la persona ocupa UNA plaza (también con dos personas y al editar, con la
//      imagen actual reservada), el rótulo dice que es una tarjeta y la respuesta trae `personas_refs_used`.
//   4. Sin dato, el cuerpo hacia Vertex y la respuesta no cambian (los goldens de `personas_test` lo fijan
//      además byte a byte).
//   5. PERSONA_MULTI_IMAGE: aviso en el log cuando una persona viaja en más de una imagen sin tarjeta.
//   6. Regresión inyectada: si el handler ignorara las tarjetas, el caso 3 lo ve.
//
// Marca y personas inventadas (una ferretería de Valparaíso, Chile): otro rubro y otro país.
//
// Ejecutar:  node tests/tarjeta_por_encuadre_test.mjs     (Node ≥ 22.18)

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
const dir = mkdtempSync(join(tmpdir(), 'tarjeta-'));
const mod = join(dir, 'tarjeta_block.mts');
writeFileSync(mod, `${fb[0]}\n\n${block('C')}\n\n${block('PB')}\n`, 'utf8');
const M = await import(pathToFileURL(mod).href);

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`  ✓ ${name}`); };
const capture = () => {
  const lines = []; const l = console.log, w = console.warn, e = console.error;
  console.log = console.warn = console.error = (...a) => lines.push(a.join(' '));
  return { lines, restore: () => { console.log = l; console.warn = w; console.error = e; } };
};

const { PERSONA_A, PERSONA_B } = PERSONAS;
const CARD = (who, c) => `https://cdn.example.invalid/cards/${who}_card_${c}.jpg`;
const A_CARDS = { ...PERSONA_A, identity_cards: { close: CARD('teo', 'close'), medium: CARD('teo', 'medium'), wide: CARD('teo', 'wide'), hands: CARD('teo', 'hands') } };
const B_ONLY_MEDIUM = { ...PERSONA_B, identity_cards: { medium: CARD('nacho', 'medium') } };

// ── 1 · la regla de clase ────────────────────────────────────────────────────────────────────────
console.log('── 1 · la clase de la imagen ──');
await ok('dato válido manda; sin dato, tight → close y scene → medium; valor ajeno avisa', () => {
  assert.deepEqual(M.identityCardClassFor('tight', undefined), { card_class: 'close', declared: false, warning: null });
  assert.deepEqual(M.identityCardClassFor(null, null), { card_class: 'close', declared: false, warning: null });
  assert.deepEqual(M.identityCardClassFor('scene', ''), { card_class: 'medium', declared: false, warning: null });
  assert.deepEqual(M.identityCardClassFor('tight', ' Hands '), { card_class: 'hands', declared: true, warning: null });
  assert.deepEqual(M.identityCardClassFor('scene', 'wide'), { card_class: 'wide', declared: true, warning: null });
  const raro = M.identityCardClassFor('scene', 'ots');
  assert.equal(raro.card_class, 'medium'); assert.match(raro.warning, /card_class="ots" no es uno de close, medium, wide, hands/);
  assert.deepEqual([...M.IDENTITY_CARD_CLASSES], ['close', 'medium', 'wide', 'hands']);
  assert.equal(M.IDENTITY_CARD_FALLBACK, 'medium');
});

// ── 2 · qué tarjeta viaja ────────────────────────────────────────────────────────────────────────
console.log('── 2 · qué viaja de cada persona ──');
await ok('la tarjeta de la clase; sin ella, medium; sin tarjetas, las fotos sueltas; basura ignorada', () => {
  assert.deepEqual(M.personaIdentityRefs(A_CARDS, 'hands'), { refs: [CARD('teo', 'hands')], card: 'hands', fallback: false });
  assert.deepEqual(M.personaIdentityRefs(B_ONLY_MEDIUM, 'close'), { refs: [CARD('nacho', 'medium')], card: 'medium', fallback: true });
  assert.deepEqual(M.personaIdentityRefs(PERSONA_A, 'close'), { refs: PERSONA_A.reference_image_urls, card: null, fallback: false });
  const basura = { ...PERSONA_A, identity_cards: { close: 'ftp://x', medium: 7, selfie: CARD('teo', 'selfie') } };
  assert.deepEqual(M.personaIdentityRefs(basura, 'close'), { refs: PERSONA_A.reference_image_urls, card: null, fallback: false });
  assert.deepEqual(M.identityCardsOf({ ...PERSONA_A, identity_cards: [CARD('teo', 'close')] }), {}, 'una lista no es un mapa de clases');
});

// ── 3 · el handler real ──────────────────────────────────────────────────────────────────────────
console.log('── 3 · el handler ──');
const handler = await loadHandler();
const imgs = (r) => (r.vertexImage?.contents?.[0]?.parts ?? []).filter((p) => p.inlineData).map((p) => Buffer.from(p.inlineData.data, 'base64').toString());
const promptOf = (r) => (r.vertexImage?.contents?.[0]?.parts ?? []).filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n');

await ok('una persona con tarjetas: viaja UNA imagen, la close (encuadre tight); rótulo y respuesta lo dicen', async () => {
  const c = capture();
  let r; try { r = await run(handler, req({ copy_full: 'Teodora Quispe muestra cómo elegir una broca.', title: 'Brocas', persona: A_CARDS }), { db: DB }); } finally { c.restore(); }
  assert.equal(r.status, 200);
  assert.deepEqual(imgs(r), [`IMG:${CARD('teo', 'close')}`]);
  assert.match(promptOf(r), /ONE identity card with several views of the same person/);
  assert.equal(r.json.identity_card_class, 'close');
  assert.deepEqual(r.json.personas_refs_used, { 'Teodora Quispe': [CARD('teo', 'close')] });
  assert.ok(!c.lines.some((l) => l.includes('PERSONA_MULTI_IMAGE')), 'con tarjeta no hay aviso');
});

await ok('card_class del dato manda (hands)', async () => {
  const c = capture();
  let r; try { r = await run(handler, req({ copy_full: 'Teodora Quispe ajusta la llave.', title: 'Llave', persona: A_CARDS, card_class: 'hands' }), { db: DB }); } finally { c.restore(); }
  assert.deepEqual(imgs(r), [`IMG:${CARD('teo', 'hands')}`]);
  assert.equal(r.json.identity_card_class, 'hands');
});

await ok('dos personas: cada una en UNA imagen; la que no tiene la clase viaja con medium y el log lo dice', async () => {
  const c = capture();
  let r; try { r = await run(handler, req({ copy_full: 'Teodora y Nacho prueban la escalera.', title: 'Escalera', personas: [A_CARDS, B_ONLY_MEDIUM] }), { db: DB }); } finally { c.restore(); }
  assert.deepEqual(imgs(r), [`IMG:${CARD('teo', 'close')}`, `IMG:${CARD('nacho', 'medium')}`]);
  assert.deepEqual(r.json.personas_refs_used, { 'Teodora Quispe': [CARD('teo', 'close')], 'Ignacio Huerta': [CARD('nacho', 'medium')] });
  assert.ok(c.lines.some((l) => l.includes('IDENTITY_CARD_FALLBACK: Ignacio Huerta no tiene tarjeta close; viaja la de medium')));
});

await ok('editar (reserved = 1): la imagen actual primero y la persona en UNA plaza', async () => {
  const c = capture();
  let r; try { r = await run(handler, req({ copy_full: 'Teodora sonríe.', title: 'Sonrisa', persona: A_CARDS, generation_mode: 'edit_from_current', source_image_url: 'https://cdn.example.invalid/actual.png', visual_directives: ['más luz'] }), { db: DB }); } finally { c.restore(); }
  assert.deepEqual(imgs(r), ['IMG:https://cdn.example.invalid/actual.png', `IMG:${CARD('teo', 'close')}`]);
});

// ── 4 · sin dato, nada cambia ────────────────────────────────────────────────────────────────────
console.log('── 4 · sin dato ──');
await ok('sin identity_cards: ni personas_refs_used ni identity_card_class ni cláusula de tarjeta', async () => {
  const c = capture();
  let r; try { r = await run(handler, req({ copy_full: 'Teodora Quispe muestra cómo elegir una broca.', title: 'Brocas', persona: PERSONA_A }), { db: DB }); } finally { c.restore(); }
  assert.ok(!('personas_refs_used' in r.json) && !('identity_card_class' in r.json));
  assert.ok(!promptOf(r).includes('identity card'));
  assert.equal(imgs(r).length, 3, 'las tres fotos de siempre');
  // ── 5 · el aviso de la clase de defecto
  assert.ok(c.lines.some((l) => l.includes('PERSONA_MULTI_IMAGE: Teodora Quispe viaja en 3 imágenes sin tarjeta de identidad')));
});

// ── 6 · regresión inyectada ──────────────────────────────────────────────────────────────────────
console.log('── 6 · regresión inyectada ──');
await ok('si el handler ignorara las tarjetas, la persona volvería a viajar en varias imágenes', async () => {
  const roto = source.replace('personaRefs: identityRefs.map((r) => r.refs),', 'personaRefs: usedPersonas.map((p) => p.reference_image_urls ?? []),');
  assert.notEqual(roto, source, 'la inyección encontró su punto');
  const h = await loadHandler(roto);
  const c = capture();
  let r; try { r = await run(h, req({ copy_full: 'Teodora Quispe muestra cómo elegir una broca.', title: 'Brocas', persona: A_CARDS }), { db: DB }); } finally { c.restore(); }
  assert.notDeepEqual(imgs(r), [`IMG:${CARD('teo', 'close')}`], 'la prueba del caso 3 se pondría en rojo');
});

// ── multimarca ───────────────────────────────────────────────────────────────────────────────────
await ok('multimarca: el bloque nuevo no nombra marcas ni personas reales', () => {
  const i = source.indexOf('// ── TARJETA DE IDENTIDAD POR ENCUADRE'), j = source.indexOf('/** ENCUADRE DE ESCENA.');
  const nuevo = source.slice(i, j).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/ForumPHs|NeuroneSCF|UnrealvilleStudio|SamPublisher|Irja|Itzel|Mariela|Mirjam/.test(nuevo));
});

// ── 2026-11-16 · la ropa de la tarjeta y el id de persona ─────────────────────────────────────────
console.log('── la ropa de la tarjeta no se copia; el id viaja ──');
await ok('la cláusula de la tarjeta dice que su ropa no es la de la imagen', () => {
  const c = M.identityCardClause(['Teo']);
  assert.match(c, /ONE identity card/); assert.match(c, /Take ONLY the face, hair and build from the card/);
  assert.match(c, /clothing shown in the card is NOT this image's outfit, never copy it/);
});
await ok('personaIdsOf: sólo los ids bien formados; sin ids, lista vacía (la respuesta queda como siempre)', () => {
  assert.deepEqual(M.personaIdsOf([{ ...PERSONA_A, person_id: ' 3f2a-uuid_1 ' }, { ...PERSONA_B }]), [{ name: PERSONA_A.name, person_id: '3f2a-uuid_1' }]);
  assert.deepEqual(M.personaIdsOf([{ ...PERSONA_A, person_id: 'con espacio' }, { ...PERSONA_B, person_id: 7 }]), []);
  assert.deepEqual(M.personaIdsOf([PERSONA_A, PERSONA_B]), []);
});

console.log(`\ntarjeta_por_encuadre: ${n} en verde`);
