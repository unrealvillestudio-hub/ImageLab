// OTRA PERSONA EN EL MISMO LUGAR, PINTADA EN EL HUECO (2026-11-21).
//
// Sam (2026-11-21, «sí a 4 y E»): en «Arreglos», cambiar a una persona sin cambiar la escena no funcionaba. Medido ese día
// sobre la pieza 8cde215d contra ImageLab producción: editar sobre la imagen actual no cambió a nadie; 'same_scene'
// devolvió un collage con las fotos de referencia; pintar a la nueva SÓLO en el hueco gris que deja la que sale conservó
// la escena (0,814) y la persona salió medida como la pedida (0,873). Este test fija la petición de ese camino.
//
// Qué fija, sin red:
//   1. Bloque REEMPLAZO puro: lado por la caja, validación con nombre, la instrucción (hueco, identidad, ropa, collage).
//   2. El handler real con generation_mode 'replace_person': imagen con hueco primero, UNA tarjeta por persona, sin
//      constructor ni lugar, y la respuesta dice quién entró.
//   3. Multimarca: el bloque no nombra marcas ni personas.
// La marca y las personas de los fixtures son inventadas (una ferretería de Valparaíso, Chile).
// Ejecutar:  node tests/reemplazo_de_persona_test.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { loadHandler, run } from './_handler_harness.mjs';
import { DB, PERSONAS, req } from './fixtures/personas_escenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');
const B = '// ── REEMPLAZO:BEGIN ──', E = '// ── REEMPLAZO:END ──';
const i = source.indexOf(B), j = source.indexOf(E);
assert.ok(i >= 0 && j > i, 'bloque REEMPLAZO no encontrado');
const bloque = source.slice(i, j + E.length);
const dir = mkdtempSync(join(tmpdir(), 'reemplazo-'));
const ruta = join(dir, 'reemplazo.mts');
writeFileSync(ruta, bloque + '\n', 'utf8');
const M = await import(pathToFileURL(ruta).href);

let pass = 0; const fails = [];
const test = async (n, f) => { try { await f(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fails.push(n); console.log(`  ✗ ${n}\n    ${e.message}`); } };
const { PERSONA_A, PERSONA_B } = PERSONAS;
const HUECO = 'data:image/jpeg;base64,' + Buffer.from('IMG:hueco').toString('base64');
const conTarjeta = (p, url) => ({ ...p, identity_cards: { close: url, medium: url } });

await test('1 · el lado sale del centro de la caja', () => {
  assert.equal(M.replaceSideOf([0.05, 0.2, 0.3, 0.6]), 'left');
  assert.equal(M.replaceSideOf([0.4, 0.2, 0.6, 0.6]), 'center');
  assert.equal(M.replaceSideOf([0.6, 0.2, 0.95, 0.6]), 'right');
});

await test('2 · replace mal formado falla con nombre; bien formado conserva orden, lado y ropa', () => {
  const names = ['Ana', 'Beto'];
  for (const [raw, re] of [
    [null, /REPLACE_BAD_REQUEST/], [[], /REPLACE_BAD_REQUEST/],
    [[{ persona: 'Carla', box: [0, 0, 1, 1] }], /REPLACE_PERSONA_UNKNOWN/],
    [[{ persona: 'Ana', box: [0.5, 0, 0.4, 1] }], /REPLACE_BAD_REQUEST/],
    [[{ persona: 'Ana', box: [0, 0, 1] }], /REPLACE_BAD_REQUEST/],
    [[{ persona: 'Ana', box: [0, 0, 0.5, 1] }, { persona: 'Ana', box: [0.5, 0, 1, 1] }], /repetida/],
    [[{ persona: 'Ana', box: [0, 0, 0.5, 1], outfit: 7 }], /vestuario/],
  ]) assert.match(M.normalizeReplace(raw, names, 3).error ?? '', re, JSON.stringify(raw));
  assert.match(M.normalizeReplace(Array(4).fill({ persona: 'Ana', box: [0, 0, 1, 1] }), names, 3).error, /como mucho 3/);
  const ok = M.normalizeReplace([{ persona: 'Beto', box: [0.6, 0.1, 0.9, 0.7], outfit: ' a navy knit top ' }, { persona: 'Ana', box: [0.1, 0.1, 0.3, 0.7] }], names, 3);
  assert.equal(ok.error, null);
  assert.deepEqual(ok.entries.map((e) => [e.persona, e.side, e.outfit]), [['Beto', 'right', 'a navy knit top'], ['Ana', 'left', null]]);
});

await test('3 · la instrucción: sólo el hueco, cada persona con SU imagen, su ropa, cara visible y nunca un collage', () => {
  const p = M.replacePersonPrompt({ people: [
    { name: 'Ana', description: 'DESC-ANA.', side: 'right', outfit: 'a navy knit top', expression: 'calm half-smile' },
    { name: 'Beto', description: 'DESC-BETO.', side: 'left' },
  ], gaze: 'each_other' });
  assert.match(p, /Paint into the grey area ONLY/);
  assert.match(p, /grey area on the right, paint Ana, the person in image 2/);
  assert.match(p, /grey area on the left, paint Beto, the person in image 3/);
  assert.match(p, /DESC-ANA\./); assert.match(p, /DESC-BETO\./);
  assert.match(p, /Ana wears a navy knit top, never the clothes of image 2/);
  assert.match(p, /Never copy the clothes of image 3/);
  assert.match(p, /both eyes are visible/);
  assert.match(p, /never into the lens/);
  assert.match(p, /never a collage/);
  assert.match(p, /2 people were removed/);
  assert.match(M.replacePersonPrompt({ people: [{ name: 'Ana', description: 'D.', side: 'center' }], gaze: 'camera' }), /look into the lens/);
});

const handler = await loadHandler();
const silence = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };
const A = conTarjeta(PERSONA_A, 'https://cdn.example.invalid/tarjeta-a.jpg');

await test('4 · handler: imagen con hueco primero, una tarjeta por persona, sin constructor; la respuesta dice quién entró', async () => {
  const restore = silence();
  let r;
  try {
    r = await run(handler, req({ copy_full: 'cualquier texto', personas: [A], generation_mode: 'replace_person', source_image_url: HUECO,
      replace: [{ persona: A.name, box: [0.55, 0.1, 0.95, 0.8], outfit: 'a navy knit top' }] }), { db: DB });
  } finally { restore(); }
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.vertexText, null, 'no pasa por el constructor');
  const parts = r.vertexImage.contents[0].parts;
  const imgs = parts.filter((p) => p.inlineData).map((p) => Buffer.from(p.inlineData.data, 'base64').toString('utf8'));
  assert.deepEqual(imgs, ['IMG:hueco', 'IMG:https://cdn.example.invalid/tarjeta-a.jpg']);
  const texto = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join(' ');
  assert.match(texto, new RegExp(`grey area on the right, paint ${A.name}, the person in image 2`));
  assert.equal(r.json.generation_mode, 'replace_person');
  assert.deepEqual(r.json.personas_used, [A.name]);
  assert.equal(r.json.prompt_builder_version, null);
});

await test('5 · handler: sin hueco, persona desconocida o sin foto de identidad ⇒ 400 con nombre, sin llamar al modelo', async () => {
  const restore = silence();
  try {
    const casos = [
      [req({ personas: [A], generation_mode: 'replace_person', replace: [{ persona: A.name, box: [0, 0, 1, 1] }] }), /EDIT_WITHOUT_SOURCE/],
      [req({ personas: [A], generation_mode: 'replace_person', source_image_url: HUECO, replace: [{ persona: 'Nadie', box: [0, 0, 1, 1] }] }), /REPLACE_PERSONA_UNKNOWN/],
      [req({ personas: [{ ...PERSONA_B, reference_image_urls: [] }], generation_mode: 'replace_person', source_image_url: HUECO,
        replace: [{ persona: PERSONA_B.name, box: [0, 0, 1, 1] }] }), /REPLACE_NO_IDENTITY/],
    ];
    for (const [body, re] of casos) {
      const r = await run(handler, body, { db: DB });
      assert.equal(r.status, 400, JSON.stringify(r.json));
      assert.match(JSON.stringify(r.json), re);
      assert.equal(r.vertexImage, null);
    }
  } finally { restore(); }
});

await test('6 · el bloque no nombra marcas ni personas', () => {
  assert.ok(!/ForumPHs|NeuroneSCF|Unrealville|Irja|Itzel|Ivette|Patricia|Sam Moreno/i.test(bloque));
});

console.log(`\n${pass} ok, ${fails.length} fallan`);
if (fails.length) process.exit(1);
