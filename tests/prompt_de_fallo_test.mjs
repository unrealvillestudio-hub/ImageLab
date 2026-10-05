// EL PROMPT DEL FALLO (2026-10-05).
//
// EL DEFECTO, medido por main en la ronda de imágenes del 2026-10-05: cuando Vertex bloquea la imagen,
// `/api/execute` devolvía sólo `"Gemini image: no inlineData returned (blockReason=SAFETY)"`. Ni el
// prompt ni su procedencia; y el log de Vercel guardaba sólo la longitud del prompt. Sin el texto no se
// puede saber qué palabra dispara el bloqueo.
//
// Lo que este test fija, con el handler REAL cargado por el arnés (sin red, sin credenciales):
//   1. GOLDEN: la respuesta de ÉXITO no cambia ni un byte (18 escenarios congelados sobre `main`
//      ca19c85 en `fixtures/respuesta_exito_golden.json`), y en un éxito no se escribe el prompt en el log.
//   2. El camino de error con un proveedor simulado que devuelve `blockReason=SAFETY` (y sus variantes:
//      `finishReason`, rechazo HTTP, modo direct): el cuerpo lleva `prompt_full`, `negative_prompt`,
//      `prompt_sent` (el texto EXACTO que recibió el proveedor), `block_reason`, `finish_reason`,
//      `preset_id` y `psycho_id`; los campos del contrato de fallo anterior siguen ahí.
//   3. El log: una línea por fallo con prompt, recortada a un tope declarado; ninguna si el fallo fue
//      anterior al prompt.
//   4. Ni el log ni el cuerpo del fallo llevan secretos, URLs de referencia ni imágenes.
//   5. Multimarca y voseo sobre lo nuevo.
//   6. Regresiones inyectadas (CC_PROTOCOL §14.2): cada comprobación se pone roja ante la suya.
//
// Ejecutar:  node tests/prompt_de_fallo_test.mjs     (Node ≥ 22.18, type-stripping nativo)

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { loadHandler, run } from './_handler_harness.mjs';
import { FORMAS, req } from './fixtures/canal_layout_escenarios.mjs';
import {
  ESCENARIOS_EXITO, PSYCHO, DB_SIN_PRESET, DB_CON_PRESET, BLOQUEO_SAFETY, SIN_IMAGEN_FINISH, BRAND,
} from './fixtures/prompt_de_fallo_escenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');
const GOLDEN = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'respuesta_exito_golden.json'), 'utf8')).escenarios;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const ETIQUETA = '[ImageLab][PROMPT-DEL-FALLO]';
const SECRETO = 'sb-clave-de-prueba-que-no-debe-salir-0123456789';

/** Ejecuta con la consola capturada; devuelve el resultado y las líneas de `console.error`. */
async function capturar(fn) {
  const l = console.log, w = console.warn, e = console.error;
  const errores = [];
  console.log = console.warn = () => {};
  console.error = (...a) => { errores.push(a.map(String).join(' ')); };
  try { return { r: await fn(), errores }; } finally { console.log = l; console.warn = w; console.error = e; }
}
const lineasDelFallo = (errores) => errores.filter((x) => x.startsWith(ETIQUETA));
/** El texto que recibió el modelo de imagen, tal como viajó. */
const textoEnviado = (r) => (r.vertexImage?.contents?.[0]?.parts ?? []).filter((p) => typeof p.text === 'string').map((p) => p.text).join('');

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`  ✓ ${name}`); };

// ── las comprobaciones, como funciones: se ejecutan sobre el código real y sobre cada regresión ──────

async function comprobarGolden(handler) {
  for (const esc of ESCENARIOS_EXITO) {
    const g = GOLDEN[esc.nombre];
    assert.ok(g, `escenario sin golden: ${esc.nombre}`);
    const { r, errores } = await capturar(() => run(handler, esc.body, { db: esc.db }));
    assert.equal(r.status, g.status, `${esc.nombre}: status`);
    assert.equal(sha(JSON.stringify(r.json)), g.respuesta_sha256, `${esc.nombre}: la respuesta de éxito cambió`);
    assert.equal(sha(JSON.stringify(r.vertexImage)), g.vertex_imagen_sha256, `${esc.nombre}: el cuerpo hacia el modelo de imagen cambió`);
    assert.equal(sha(JSON.stringify(r.vertexText)), g.vertex_texto_sha256, `${esc.nombre}: el cuerpo hacia el constructor cambió`);
    assert.equal(lineasDelFallo(errores).length, 0, `${esc.nombre}: un éxito escribió el prompt en el log`);
  }
}

/** El fallo por SAFETY en el carril: lienzo y estímulo de la ronda medida, sin preset (`preset=none`). */
async function comprobarFalloSafety(handler) {
  const body = req('LINKEDIN_FEED', { ...FORMAS.sin_copy, psycho_preset: PSYCHO.id });
  const { r, errores } = await capturar(() => run(handler, body, { db: DB_SIN_PRESET, image: { status: 200, body: BLOQUEO_SAFETY } }));
  const j = r.json;
  assert.equal(r.status, 500);
  // El contrato de fallo anterior, intacto.
  assert.match(j.error, /no inlineData returned \(blockReason=SAFETY\)/, 'el mensaje legible no cambia');
  assert.equal(j.status, 'error');
  assert.equal(j.provider_called, true);
  assert.equal(j.provider_http_status, 200);
  assert.deepEqual(j.usage, BLOQUEO_SAFETY.usageMetadata);
  // Lo nuevo.
  assert.equal(j.block_reason, 'SAFETY', 'block_reason como dato');
  assert.equal(j.finish_reason, null);
  assert.equal(typeof j.prompt_full, 'string', 'prompt_full ausente');
  assert.ok(j.prompt_full.includes(`PSYCHO LAYER [${PSYCHO.id}]`), 'prompt_full no es el prompt de la imagen');
  assert.equal(j.prompt_sent, textoEnviado(r), 'prompt_sent no es el texto que recibió el proveedor');
  assert.equal(typeof j.negative_prompt, 'string');
  assert.ok(j.prompt_sent.endsWith(`Avoid: ${j.negative_prompt}.`), 'el negativo no es el que viajó');
  assert.equal(j.preset_id, null, 'preset=none');
  assert.equal(j.psycho_id, PSYCHO.id);
  // prompt_full significa lo mismo que en el éxito: el mismo pedido, terminado bien, lo devuelve igual.
  const { r: bien } = await capturar(() => run(handler, body, { db: DB_SIN_PRESET }));
  assert.equal(bien.status, 200);
  assert.equal(j.prompt_full, bien.json.prompt_full, 'prompt_full del fallo ≠ prompt_full del éxito');
  // El log: una línea, con el texto entero (está por debajo del tope).
  const lineas = lineasDelFallo(errores);
  assert.equal(lineas.length, 1, `líneas de log del fallo: ${lineas.length}`);
  assert.ok(lineas[0].includes('block_reason=SAFETY') && lineas[0].includes(`psycho=${PSYCHO.id}`) && lineas[0].includes('preset=none'));
  assert.ok(lineas[0].includes('recorte=no') && lineas[0].endsWith(`texto=${JSON.stringify(j.prompt_sent)}`), 'el log no lleva el texto enviado');
}

/** Un prompt más largo que el tope: el log lo recorta y lo declara; el cuerpo lo lleva entero. */
async function comprobarTope(handler) {
  const tope = Number(source.match(/const FAILURE_PROMPT_LOG_MAX_CHARS = (\d+);/)?.[1]);
  assert.ok(tope > 0, 'tope no declarado');
  const largo = 'a quiet pottery workshop, '.repeat(Math.ceil((tope + 500) / 26));
  const { r, errores } = await capturar(() => run(handler, { mode: 'direct', prompt: largo }, { image: { status: 200, body: BLOQUEO_SAFETY } }));
  assert.equal(r.status, 500);
  assert.ok(r.json.prompt_sent.length > tope, 'el cuerpo debe llevar el texto entero');
  const [linea] = lineasDelFallo(errores);
  assert.ok(linea, 'sin línea de log');
  assert.ok(linea.includes(`recorte=${tope}`) && linea.includes(`chars=${r.json.prompt_sent.length}`), 'el recorte no se declara');
  const texto = JSON.parse(linea.slice(linea.indexOf('texto=') + 'texto='.length));
  assert.equal(texto, r.json.prompt_sent.slice(0, tope), 'el log no respeta el tope');
}

// ── 1 · golden de éxito ─────────────────────────────────────────────────────────────────────────────
console.log('── 1 · la respuesta de éxito no cambia ni un byte ──');
const handler = await loadHandler(source);
await ok(`golden: ${ESCENARIOS_EXITO.length} escenarios idénticos a main ca19c85, y ningún prompt en el log`, () => comprobarGolden(handler));
await ok('el golden ejercita el estímulo y el preset (si no, no guarda lo que dice guardar)', async () => {
  const { r } = await capturar(() => run(handler, req('FACEBOOK_FEED', { ...FORMAS.sin_copy, psycho_preset: PSYCHO.id }), { db: DB_SIN_PRESET }));
  assert.ok(textoEnviado(r).includes(`PSYCHO LAYER [${PSYCHO.id}]`));
  const { r: d } = await capturar(() => run(handler, ESCENARIOS_EXITO.find((e) => e.nombre === 'direct|con_preset').body, { db: DB_CON_PRESET('LINKEDIN_FEED') }));
  assert.equal(d.json.preset_used, true);
});

// ── 2 · el camino de error ──────────────────────────────────────────────────────────────────────────
console.log('── 2 · el fallo lleva su prompt ──');
await ok('carril, blockReason=SAFETY: prompt_full, prompt_sent exacto, negativo, block_reason, preset y psycho', () => comprobarFalloSafety(handler));

await ok('carril con constructor, persona y producto (multimodal): prompt_sent con los rótulos de las fotos', async () => {
  const body = req('FACEBOOK_FEED', { ...FORMAS.copy_persona_producto, psycho_preset: PSYCHO.id });
  const { r } = await capturar(() => run(handler, body, { db: DB_SIN_PRESET, image: { status: 200, body: BLOQUEO_SAFETY } }));
  const j = r.json;
  assert.equal(r.status, 500);
  assert.equal(j.block_reason, 'SAFETY');
  assert.equal(j.prompt_sent, textoEnviado(r));
  assert.ok(j.prompt_sent.length > j.prompt_full.length && j.prompt_sent.includes(j.prompt_full), 'prompt_sent = rótulos + prompt_full + negativo');
  assert.equal(j.prompt_builder_called, true, 'el constructor que corrió sigue declarado');
  assert.ok(r.vertexImage.contents[0].parts.some((p) => p.inlineData), 'el escenario debe ser multimodal');
});

await ok('finishReason sin blockReason: viaja como finish_reason', async () => {
  const { r } = await capturar(() => run(handler, req('LINKEDIN_FEED', FORMAS.sin_copy), { db: DB_SIN_PRESET, image: { status: 200, body: SIN_IMAGEN_FINISH } }));
  assert.equal(r.json.block_reason, null);
  assert.equal(r.json.finish_reason, 'IMAGE_SAFETY');
  assert.equal(r.json.prompt_sent, textoEnviado(r));
  assert.equal(r.json.psycho_id, null, 'sin estímulo pedido, psycho_id null');
});

await ok('rechazo HTTP del proveedor (429): sin motivos, pero con el prompt que se mandó', async () => {
  const { r, errores } = await capturar(() => run(handler, req('LINKEDIN_FEED', FORMAS.sin_copy), { db: DB_SIN_PRESET, image: { status: 429, body: { error: { code: 429, message: 'Resource exhausted' } } } }));
  assert.equal(r.json.provider_http_status, 429);
  assert.equal(r.json.block_reason, null);
  assert.equal(r.json.prompt_sent, textoEnviado(r));
  assert.equal(lineasDelFallo(errores).length, 1);
});

await ok('modo direct con preset: prompt_full, preset_id y prompt_sent', async () => {
  const esc = ESCENARIOS_EXITO.find((e) => e.nombre === 'direct|con_preset');
  const { r } = await capturar(() => run(handler, esc.body, { db: esc.db, image: { status: 200, body: BLOQUEO_SAFETY } }));
  assert.equal(r.status, 500);
  assert.equal(r.json.block_reason, 'SAFETY');
  assert.equal(r.json.preset_id, 'preset-linkedin_feed');
  assert.equal(r.json.prompt_sent, textoEnviado(r));
  assert.ok(r.json.prompt_sent.startsWith(r.json.prompt_full));
  assert.equal(r.json.psycho_id, null);
});

await ok('un fallo ANTERIOR al prompt no inventa uno: campos en null y ninguna línea de log', async () => {
  const { r, errores } = await capturar(() => run(handler, { stage: {}, params: {} }, {}));
  assert.equal(r.status, 400);
  for (const k of ['prompt_full', 'negative_prompt', 'prompt_sent', 'block_reason', 'finish_reason', 'preset_id', 'psycho_id']) {
    assert.ok(k in r.json, `falta la clave ${k}: el contrato es estable`);
    assert.equal(r.json[k], null, k);
  }
  assert.equal(lineasDelFallo(errores).length, 0);
});

// ── 3 · el tope del log ─────────────────────────────────────────────────────────────────────────────
console.log('── 3 · el log recorta a un tope declarado ──');
await ok('prompt más largo que el tope: recortado en el log, entero en el cuerpo', () => comprobarTope(handler));

// ── 4 · sin secretos ────────────────────────────────────────────────────────────────────────────────
console.log('── 4 · ni secretos, ni URLs de referencia, ni imágenes ──');
await ok('el cuerpo y el log del fallo no llevan la clave, el token, las URLs ni los bytes de las fotos', async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = SECRETO;
  try {
    const body = req('FACEBOOK_FEED', { ...FORMAS.copy_persona_producto, psycho_preset: PSYCHO.id });
    const { r, errores } = await capturar(() => run(handler, body, { db: DB_SIN_PRESET, image: { status: 200, body: BLOQUEO_SAFETY } }));
    const salida = JSON.stringify(r.json) + '\n' + lineasDelFallo(errores).join('\n');
    for (const prohibido of [SECRETO, 'Bearer', 'cdn.example.invalid', 'data:image', 'base64,']) {
      assert.ok(!salida.includes(prohibido), `el fallo filtra «${prohibido}»`);
    }
  } finally { process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; }
});

// ── 5 · multimarca y voseo ──────────────────────────────────────────────────────────────────────────
console.log('── 5 · multimarca y voseo ──');
const bloqueFallo = source.slice(source.indexOf('// ── FALLO:BEGIN ──'), source.indexOf('// ── FALLO:END ──'));
await ok('el código nuevo no nombra marcas ni lienzos', () => {
  assert.ok(bloqueFallo.includes('FAILURE_PROMPT_LOG_MAX_CHARS'), 'no se encontró el código nuevo');
  // CC_PROTOCOL §14.1: sin comentarios, o la comprobación se dispara sobre su propia explicación.
  const sinComentarios = bloqueFallo.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n');
  for (const lit of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'Neurone', 'Patricia', 'Lucien',
    BRAND, 'LINKEDIN', 'FACEBOOK', 'INSTAGRAM', 'PSY-']) {
    assert.ok(!sinComentarios.includes(lit), `literal «${lit}» en el código nuevo`);
  }
});
await ok('sin voseo en lo nuevo (código, comentarios, tests y fixtures)', () => {
  const VOSEO = /(?<!\p{L})(querés|podés|tenés|sabés|hacés|decís|sos|vos|mirá|fijate|andá|vení|poné|usá|hacé|decí|tené|agregá|revisá|probá|dejá|sacá|cambiá|tomá|pasá|llamá|acordate|fijá|corré|aplicá|mergeá|mirala|medí|abrí|elegí|decidí|confirmá|desplegá|leé|guardá|registrá|recortá)(?!\p{L})/iu;
  const propios = [bloqueFallo, readFileSync(fileURLToPath(import.meta.url), 'utf8'),
    readFileSync(join(ROOT, 'tests', 'fixtures', 'prompt_de_fallo_escenarios.mjs'), 'utf8'),
    readFileSync(join(ROOT, 'tests', '_capturar_golden_exito.mjs'), 'utf8'), readFileSync(join(ROOT, 'tests', '_handler_harness.mjs'), 'utf8')];
  for (const t of propios) {
    const hit = t.split('\n').filter((l) => !l.includes('const VOSEO')).find((l) => VOSEO.test(l));
    assert.equal(hit, undefined, `voseo en: ${hit}`);
  }
});

// ── 6 · regresiones inyectadas (CC_PROTOCOL §14.2) ──────────────────────────────────────────────────
console.log('── 6 · regresiones inyectadas: cada comprobación se pone roja ante la suya ──');
async function debeFallar(nombre, buscar, poner, comprobar) {
  assert.equal(source.split(buscar).length, 2, `${nombre}: el punto de inyección debe existir y ser único`);
  const h = await loadHandler(source.replace(buscar, poner));
  let rojo = false;
  try { await comprobar(h); } catch { rojo = true; }
  assert.ok(rojo, `${nombre}: la comprobación siguió en verde con la regresión puesta`);
}
await ok('R1 · el motivo del bloqueo deja de viajar como dato → el camino de error se pone rojo', () => debeFallar('R1',
  "blockReason: typeof block === 'string' ? block : null,", 'blockReason: null,', comprobarFalloSafety));
await ok('R2 · el carril deja de guardar el prompt final → el camino de error se pone rojo', () => debeFallar('R2',
  '    fallo.promptFull = finalPrompt;\n\n    // Las imágenes', '\n    // Las imágenes', comprobarFalloSafety));
await ok('R3 · la respuesta de éxito gana una clave → el golden se pone rojo', () => debeFallar('R3',
  '      generation_mode:        mode,\n      persona_used:           personaUsed,\n      location_used:',
  '      generation_mode:        mode,\n      persona_used:           personaUsed,\n      block_reason: null,\n      location_used:', comprobarGolden));
await ok('R4 · el log deja de recortar → la comprobación del tope se pone roja', () => debeFallar('R4',
  'const recortado = texto.length > FAILURE_PROMPT_LOG_MAX_CHARS;', 'const recortado = false;', comprobarTope));

console.log(`\nprompt del fallo: ${n} comprobaciones OK`);
