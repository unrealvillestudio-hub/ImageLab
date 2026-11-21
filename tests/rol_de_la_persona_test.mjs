// EL ROL DE LA PERSONA VIAJA (2026-11-21).
//
// Sam (2026-11-20, pieza e82dea93): la voz de marca, socio de la empresa, salió de jardinero. Medido: su ficha no llevaba
// su cargo y la escena pedía un jardinero; otra persona del mismo set, con su cargo en la descripción, nunca salió con
// otro oficio. Ahora el rol es dato de la persona (`persona.role`, lo resuelve el carril) y el motor repone una cláusula:
// esa persona sólo como su rol; otro oficio lo hace otra persona, sin nombre.
//
// Qué fija, sin red: la cláusula y su recolección (puras); el handler con y sin constructor; sin rol, el cuerpo hacia
// Vertex es el de siempre (golden de una persona, `personas_n1_golden.json`, que sigue corriendo en personas_test).
// La marca y las personas de los fixtures son inventadas.
// Ejecutar:  node tests/rol_de_la_persona_test.mjs

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
const { PERSONA_A } = PERSONAS;
const ROL = 'the founding partner and business director of the company';
const conRol = { ...PERSONA_A, role: ROL };
const textoImagen = (r) => (r.vertexImage?.contents?.[0]?.parts ?? []).filter((p) => typeof p.text === 'string').map((p) => p.text).join(' ');
const clausula = `${PERSONA_A.name} is ${ROL}: show ${PERSONA_A.name} only as that`;

await test('1 · con constructor: la cláusula del rol viaja aunque la escena pida otro oficio', async () => {
  const restore = silence(); let r;
  try {
    r = await run(handler, req({ copy_full: `${PERSONA_A.name} y el jardinero revisan las plantas.`, title: 'Jardines', persona: conRol,
      visual_directives: ['a garden maintenance worker trims the hedge'] }), { db: DB, synth: 'A garden scene with a gardener.' });
  } finally { restore(); }
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(textoImagen(r).includes(clausula), textoImagen(r).slice(0, 400));
  assert.match(textoImagen(r), /that is a different, unnamed person/);
});

await test('2 · sin constructor (sin copy): la cláusula del rol también viaja', async () => {
  const restore = silence(); let r;
  try { r = await run(handler, req({ title: `${PERSONA_A.name} en el jardín`, persona: conRol }), { db: DB }); }
  finally { restore(); }
  assert.equal(r.status, 200);
  assert.ok(textoImagen(r).includes(clausula));
});

await test('3 · sin rol, ninguna cláusula de rol (el golden de una persona sigue en personas_test)', async () => {
  const restore = silence(); let r;
  try { r = await run(handler, req({ copy_full: `${PERSONA_A.name} revisa las plantas.`, title: 'Jardines', persona: PERSONA_A }), { db: DB }); }
  finally { restore(); }
  assert.ok(!/only as that, dressed and acting as that role/.test(textoImagen(r)));
});

await test('4 · el código del rol no nombra marcas ni personas', () => {
  const a = source.indexOf('export function personaRoleClause('), b = source.indexOf('/** La cláusula del motor: la persona no lleva la ropa');
  assert.ok(a > 0 && b > a);
  assert.ok(!/ForumPHs|NeuroneSCF|Unrealville|Irja|Itzel|Ivette|Patricia|Sam Moreno|jardiner/i.test(source.slice(a, b)));
});

console.log(`\n${pass} ok, ${fails.length} fallan`);
if (fails.length) process.exit(1);
