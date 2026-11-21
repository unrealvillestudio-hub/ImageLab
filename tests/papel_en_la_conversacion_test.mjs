// QUIÉN HABLA Y QUIÉN ESCUCHA (2026-11-21).
//
// Sam (2026-11-21, pieza 15093e2a): «en un podcast no tiene sentido que ambas personas estén con la boca cerrada»; quien
// no es host sale hablando, con gestos, y mira a la host; la host la mira y escucha. El carril decide el papel de cada
// persona (`persona.scene_part`: speaker | listener) y aquí se vuelve una cláusula del motor, en todos los modos, también
// al pintar en el hueco (`replace_person`). Sin el dato, nada cambia.
//
// Qué fija, sin red: las cláusulas (puras); el handler con y sin constructor; el reemplazo; sin papel, sin cláusula.
// La marca y las personas de los fixtures son inventadas.
// Ejecutar:  node tests/papel_en_la_conversacion_test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHandler, run } from './_handler_harness.mjs';
import { DB, PERSONAS, req } from './fixtures/personas_escenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');
let pass = 0; const fails = [];
const test = async (n, f) => { try { await f(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fails.push(n); console.log(`  ✗ ${n}\n    ${e.message}`); } };
const silence = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };
const handler = await loadHandler();
const { PERSONA_A, PERSONA_B } = PERSONAS;
const habla = { ...PERSONA_A, scene_part: 'speaker' }, escucha = { ...PERSONA_B, scene_part: 'listener' };
const textoImagen = (r) => (r.vertexImage?.contents?.[0]?.parts ?? []).filter((p) => typeof p.text === 'string').map((p) => p.text).join(' ');
const HUECO = 'https://example.org/hueco.png';

await test('1 · con constructor: quien habla, a media frase y con las manos, mira a quien escucha; quien escucha la mira', async () => {
  const restore = silence(); let r;
  try {
    r = await run(handler, req({ copy_full: `${PERSONA_A.name} conversa con ${PERSONA_B.name}.`, title: 'Conversación', personas: [habla, escucha] }),
      { db: DB, synth: 'Two people talk in a studio.' });
  } finally { restore(); }
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const t = textoImagen(r);
  assert.ok(t.includes(`${PERSONA_A.name} is speaking, caught mid-sentence`), t.slice(0, 500));
  assert.ok(t.includes(`eyes on ${PERSONA_B.name}`));
  assert.ok(t.includes(`${PERSONA_B.name} is listening to ${PERSONA_A.name}`));
});

await test('2 · sin constructor: las cláusulas también viajan', async () => {
  const restore = silence(); let r;
  try { r = await run(handler, req({ title: `${PERSONA_A.name} y ${PERSONA_B.name}`, personas: [habla, escucha] }), { db: DB }); }
  finally { restore(); }
  assert.equal(r.status, 200);
  assert.ok(textoImagen(r).includes(`${PERSONA_A.name} is speaking`));
});

await test('3 · sin papel, o sin uno de cada, ninguna cláusula (la lista de antes)', async () => {
  const restore = silence(); let r1, r2;
  try {
    r1 = await run(handler, req({ copy_full: `${PERSONA_A.name} y ${PERSONA_B.name}.`, title: 'X', personas: [PERSONA_A, PERSONA_B] }), { db: DB });
    r2 = await run(handler, req({ copy_full: `${PERSONA_A.name} y ${PERSONA_B.name}.`, title: 'X', personas: [habla, PERSONA_B] }), { db: DB });
  } finally { restore(); }
  assert.ok(!/is speaking, caught mid-sentence|is listening to/.test(textoImagen(r1)));
  assert.ok(!/is speaking, caught mid-sentence|is listening to/.test(textoImagen(r2)), 'sin quien escuche, no se inventa');
});

await test('4 · en el hueco: cada persona repintada lleva su papel en lugar de la mirada genérica', async () => {
  const restore = silence(); let r;
  try {
    r = await run(handler, req({ copy_full: 'x', personas: [habla, escucha], generation_mode: 'replace_person', source_image_url: HUECO,
      replace: [{ persona: PERSONA_B.name, box: [0, 0.2, 0.45, 1] }, { persona: PERSONA_A.name, box: [0.55, 0.2, 1, 1] }] }), { db: DB });
  } finally { restore(); }
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const t = textoImagen(r);
  assert.ok(t.includes(`${PERSONA_A.name} is speaking, caught mid-sentence`), t.slice(0, 600));
  assert.ok(t.includes(`${PERSONA_B.name} is listening to ${PERSONA_A.name}`));
});

await test('5 · el código del papel no nombra marcas ni personas', () => {
  const a = source.indexOf('export const SCENE_PARTS'), b = source.indexOf('/** Las personas en escena con su rol declarado. */');
  assert.ok(a > 0 && b > a);
  assert.ok(!/ForumPHs|NeuroneSCF|Unrealville|Irja|Itzel|Ivette|Patricia|Sam Moreno|podcast/i.test(source.slice(a, b)));
});

console.log(`\n${pass} ok, ${fails.length} fallan`);
if (fails.length) process.exit(1);
