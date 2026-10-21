// LA IMAGEN DEL CARRIL VA EN LOTE (2026-10-21) — fase 3 del plan de Batch (Sam, 2026-10-20: «sí al plan de Batch,
// procede»). ImageLab «prepara» la petición exacta de `:generateContent` sin llamar al modelo de imagen, «termina» con
// la respuesta del lote y `api/lote.ts` envía y lee el lote de Vertex.
//
// QUÉ AFIRMA, y cada punto se rompe a propósito al final (CC_PROTOCOL §14.2):
//   1. SIN `lote`, NADA CAMBIA: ni una llamada al bucket, ni una clave más en la respuesta (los golden de
//      `personas_test`, `canal_layout_test` y `prompt_de_fallo_test` fijan además el cuerpo y la respuesta byte a byte).
//   2. «PREPARAR» no llama al modelo de imagen; llama al constructor como la directa; deja cada foto en el bucket (en
//      el mismo orden y con los mismos bytes) y devuelve el MISMO cuerpo que la directa manda, con `fileData` en lugar
//      de `inlineData`.
//   3. «TERMINAR» CON LA RESPUESTA X == LLAMADA DIRECTA CON X: la misma respuesta (éxito, bloqueo, sin imagen y placa
//      con su segundo intento), aunque el estado haya viajado por `jsonb` (claves reordenadas). No llama al
//      constructor, no lee la base; `lote_cobro` dice qué intento se pagó en lote.
//   4. Lo mal formado se dice (`IMAGELAB_LOTE_*`) y no paga nada.
//   5. `api/lote.ts`: protegido (sin secreto 503, secreto malo 401), UNA petición por lote, JSONL `{"request"}`, job
//      regional con el modelo de la petición, lectura de la única línea de salida, sólo jobs de su proyecto y región.
//
// Ejecutar:  node tests/imagen_en_lote_test.mjs     (Node ≥ 22.18)

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { run } from './_handler_harness.mjs';
import { N1, DB, PERSONAS, req as reqPersonas } from './fixtures/personas_escenarios.mjs';
import { ESCENARIOS_EXITO, BLOQUEO_SAFETY, SIN_IMAGEN_FINISH } from './fixtures/prompt_de_fallo_escenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');
const LOTE_SRC = readFileSync(join(ROOT, 'api', 'lote.ts'), 'utf8');
// Dentro del repo (y no en el tmp del sistema) para que `sharp` se resuelva y la placa se mida de verdad.
const DIR = mkdtempSync(join(ROOT, '.lote-test-'));
process.on('exit', () => rmSync(DIR, { recursive: true, force: true }));

let seq = 0;
const STUB = 'class GoogleAuth { constructor(_o) {} async getClient() { return { getAccessToken: async () => ({ token: "t" }) }; } }';
async function cargar(texto, nombre) {
  const patched = texto.replace("import { GoogleAuth } from 'google-auth-library';", STUB);
  assert.notEqual(patched, texto, 'import de google-auth-library');
  const f = join(DIR, `${nombre}-${seq++}.mts`);
  writeFileSync(f, patched, 'utf8');
  return await import(pathToFileURL(f).href);
}
function envBase() {
  Object.assign(process.env, { GOOGLE_SERVICE_ACCOUNT_KEY: '{}', GOOGLE_CLOUD_PROJECT: 'proyecto-prueba', GOOGLE_CLOUD_LOCATION: 'us-central1',
    SUPABASE_URL: 'https://db.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'k', VERTEX_BATCH_BUCKET: 'gs://lotes-prueba/' });
}
envBase();
const handlerDe = async (texto = SRC) => (await cargar(texto, 'execute')).default;
const H = await handlerDe();
const M = await cargar(SRC, 'puro');

let n = 0; const fails = [];
async function ok(name, fn) {
  try { await fn(); n++; console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.log(`  ✗ ${name}\n      ${String(e?.message ?? e).split('\n').slice(0, 6).join('\n      ')}`); }
}
const silencio = async (fn) => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {};
  try { return await fn(); } finally { console.log = l; console.warn = w; console.error = e; } };
const rt = (x) => JSON.parse(JSON.stringify(x));
// `jsonb` guarda los objetos con las claves reordenadas: el estado que vuelve de la base NO conserva el orden.
const comoJsonb = (x) => Array.isArray(x) ? x.map(comoJsonb) : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().reverse().map((k) => [k, comoJsonb(x[k])])) : x;
const sinCobro = (j) => { const { lote_cobro, ...resto } = j ?? {}; return resto; };

// El bucket del lote: registra cada objeto subido (nombre y bytes) y responde como Cloud Storage.
function bucket() {
  const subidos = [];
  const intercept = async (u, init) => {
    if (u.startsWith('https://storage.googleapis.com/upload/storage/v1/b/')) {
      const name = decodeURIComponent(new URL(u).searchParams.get('name'));
      subidos.push({ bucket: decodeURIComponent(u.split('/b/')[1].split('/o')[0]), name, mime: init.headers['Content-Type'], bytes: Buffer.from(init.body) });
      return new Response(JSON.stringify({ name }), { status: 200 });
    }
    return undefined;
  };
  return { subidos, intercept };
}
const conLote = (body, lote) => ({ ...body, lote });

// Las peticiones del carril con fotos, constructor y sin él, editar, varias personas y los lienzos de la ronda.
const ESCENARIOS = [
  ['persona+lugar+producto', N1.copy_persona_locacion_producto, DB],
  ['editar con persona', N1.editar_con_persona, DB],
  ['sin copy (sin constructor) y sin persona', N1.sin_copy_sin_persona, DB],
  ['sin copy, persona en el título', N1.sin_copy_persona_en_titulo, DB],
  // Dos personas (lista `personas[]`, mirada y presupuesto): el producto sale de la escena para dejar sitio a la identidad.
  ['dos personas, lugar y producto', reqPersonas({ copy_full: 'Teodora y Nacho, en el Mostrador del puerto, con el kit.', title: 'Kit',
    personas: [PERSONAS.PERSONA_A, PERSONAS.PERSONA_B], gaze: 'each_other', location: PERSONAS.LOCATION, product: PERSONAS.PRODUCT }), DB],
  ['tres personas', reqPersonas({ copy_full: 'Teodora, Nacho y Marta Lillo abren la tienda.', title: 'Apertura',
    personas: [PERSONAS.PERSONA_A, PERSONAS.PERSONA_B, PERSONAS.PERSONA_C] }), DB],
  ...ESCENARIOS_EXITO.filter((e) => e.nombre.startsWith('carril|')).slice(0, 3).map((e) => [e.nombre, e.body, e.db]),
];
const EXITO = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 812, candidatesTokenCount: 1290, totalTokenCount: 2102 } };

async function preparar(body, db) {
  const b = bucket();
  const r = await silencio(() => run(H, conLote(body, { modo: 'preparar' }), { db, intercept: b.intercept }));
  return { r, subidos: b.subidos };
}

console.log('\n── 0 · bloque puro ──');
await ok('cuerpoDeImagen: imágenes primero, texto al final, sin imágenes `[{ text }]`', () => {
  assert.equal(JSON.stringify(M.cuerpoDeImagen('T', '1:1', [])),
    JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'T' }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } } }));
  const f = { fileData: { fileUri: 'gs://b/x.png', mimeType: 'image/png' } };
  assert.deepEqual(M.cuerpoDeImagen('T', '4:5', [f]).contents[0].parts, [f, { text: 'T' }]);
});
await ok('leerModoLote: ausente ⇒ null; preparar; terminar exige estado y respuesta; lo demás es error dicho', () => {
  assert.deepEqual(M.leerModoLote(undefined), { modo: null });
  assert.deepEqual(M.leerModoLote(null), { modo: null });
  assert.deepEqual(M.leerModoLote({ modo: 'preparar' }), { modo: 'preparar' });
  assert.equal(M.leerModoLote({ modo: 'terminar', estado: {}, respuesta: {} }).modo, 'terminar');
  assert.match(M.leerModoLote({ modo: 'terminar', respuesta: {} }).error, /^IMAGELAB_LOTE_SIN_ESTADO/);
  assert.match(M.leerModoLote({ modo: 'terminar', estado: {} }).error, /^IMAGELAB_LOTE_SIN_RESPUESTA/);
  assert.match(M.leerModoLote({ modo: 'otro' }).error, /^IMAGELAB_LOTE_MODO_DESCONOCIDO/);
  assert.match(M.leerModoLote('preparar').error, /^IMAGELAB_LOTE_MODO_INVALIDO/);
});

console.log('\n── 1 · sin `lote`, nada cambia ──');
await ok('la llamada directa no toca el bucket ni añade claves de lote', async () => {
  for (const [nombre, body, db] of ESCENARIOS) {
    const b = bucket();
    const r = await silencio(() => run(H, body, { db, intercept: b.intercept }));
    assert.equal(r.status, 200, nombre);
    assert.equal(b.subidos.length, 0, nombre);
    assert.ok(!r.fetched.some((u) => u.includes('storage.googleapis.com')), nombre);
    assert.ok(!('lote_cobro' in r.json) && !('lote' in r.json), nombre);
  }
});

console.log('\n── 2 · «preparar» ──');
await ok('no llama al modelo de imagen; el constructor, igual que la directa; las fotos al bucket, en orden y con sus bytes; el MISMO cuerpo', async () => {
  for (const [nombre, body, db] of ESCENARIOS) {
    const d = await silencio(() => run(H, body, { db }));
    const { r, subidos } = await preparar(body, db);
    assert.equal(r.status, 200, nombre);
    assert.equal(r.json.status, 'prepared', nombre);
    assert.equal(r.vertexImage, null, `${nombre}: preparar no llama al modelo de imagen`);
    assert.deepEqual(r.vertexText, d.vertexText, `${nombre}: el constructor recibe lo mismo (o no corre, igual que en directo)`);
    assert.deepEqual([r.json.prompt_builder_version, r.json.prompt_builder_usage], [d.json.prompt_builder_version, d.json.prompt_builder_usage], nombre);
    const [p] = r.json.lote.peticiones;
    assert.equal(r.json.lote.peticiones.length, 1);
    assert.deepEqual([p.id, p.model, r.json.lote.v], ['imagen', d.json.model, 1], nombre);
    const dParts = d.vertexImage.contents[0].parts, pParts = p.request.contents[0].parts;
    assert.equal(pParts.length, dParts.length, nombre);
    dParts.forEach((dp, i) => {
      if (dp.text !== undefined) { assert.deepEqual(pParts[i], dp, `${nombre}: el texto es el mismo`); return; }
      const sub = subidos.find((s) => `gs://${s.bucket}/${s.name}` === pParts[i].fileData.fileUri);
      assert.ok(sub, `${nombre}: la foto ${i} está en el bucket`);
      assert.equal(sub.bytes.toString('base64'), dp.inlineData.data, `${nombre}: mismos bytes, misma posición (${i})`);
      assert.equal(pParts[i].fileData.mimeType, dp.inlineData.mimeType);
      assert.equal(sub.name, `referencias/${createHash('sha256').update(sub.bytes).digest('hex')}.png`);
      assert.equal(sub.bucket, 'lotes-prueba', 'el bucket sin gs:// ni barra');
    });
    assert.deepEqual(p.request.generationConfig, d.vertexImage.generationConfig, nombre);
    assert.deepEqual(Object.keys(p.request), Object.keys(d.vertexImage), nombre);
    assert.equal(r.json.lote.estado.respuesta.reference_images, dParts.length - 1, nombre);
  }
});

console.log('\n── 3 · «terminar» con X == directa con X ──');
async function terminar(body, estado, respuesta, opts = {}) {
  return await silencio(() => run(H, conLote(body, { modo: 'terminar', estado: comoJsonb(rt(estado)), respuesta }), opts));
}
await ok('éxito, bloqueo de seguridad y respuesta sin imagen: misma respuesta y mismo código; sin constructor, sin base, sin imagen nueva', async () => {
  for (const [nombre, body, db] of ESCENARIOS) {
    const { r: prep } = await preparar(body, db);
    for (const [cual, X] of [['éxito', EXITO], ['SAFETY', BLOQUEO_SAFETY], ['IMAGE_SAFETY', SIN_IMAGEN_FINISH]]) {
      // Como el carril: `ledger_by_caller: true` (el carril asienta). Así cualquier lectura de la base es un defecto.
      const bodyC = { ...body, ledger_by_caller: true };
      const d = await silencio(() => run(H, bodyC, { db, image: { status: 200, body: X } }));
      const t = await terminar(bodyC, prep.json.lote.estado, rt(X));
      assert.equal(t.status, d.status, `${nombre}/${cual}`);
      assert.deepEqual(sinCobro(t.json), rt(d.json), `${nombre}/${cual}: la misma respuesta`);
      assert.deepEqual(t.json.lote_cobro, { entregada: 'diferido', descartados: [] }, `${nombre}/${cual}`);
      assert.deepEqual([t.vertexText, t.vertexImage], [null, null], `${nombre}/${cual}: ni constructor ni imagen`);
      assert.deepEqual(t.fetched.filter((u) => u.startsWith('https://db.example.invalid')), [], `${nombre}/${cual}: no lee la base`);
      assert.equal(t.fetched.length, 0, `${nombre}/${cual}: ninguna llamada de red`);
    }
  }
});

// La placa medida de verdad: una franja blanca lisa arriba (25 %) sobre una foto con grano.
async function pngConPlaca(placa) {
  const w = 64, h = 64, px = Buffer.alloc(w * h * 3);
  let s = 7;
  for (let i = 0; i < px.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; px[i] = s % 256; }
  if (placa) for (let y = 0; y < 16; y++) px.fill(255, y * w * 3, (y + 1) * w * 3);
  return (await sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()).toString('base64');
}
const CON_PLACA = await pngConPlaca(true), SIN_PLACA = await pngConPlaca(false);
const respuestaCon = (data, ct) => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data } }] } }], usageMetadata: { promptTokenCount: 800, candidatesTokenCount: ct } });
// Vertex en línea: cada llamada al modelo de imagen recibe la siguiente respuesta de la lista.
function vertexEnLinea(lista) {
  const cuerpos = [];
  return { cuerpos, intercept: async (u, init) => {
    if (!u.includes('gemini-2.5-flash-image:generateContent')) return undefined;
    cuerpos.push(JSON.parse(init.body));
    return new Response(JSON.stringify(lista[Math.min(cuerpos.length - 1, lista.length - 1)]), { status: 200 });
  } };
}
await ok('placa: el segundo intento va en línea, con las fotos y la corrección; misma respuesta que la directa; el cobro de cada intento', async () => {
  for (const [nombre, body, db] of ESCENARIOS.slice(0, 3)) {
    const { r: prep } = await preparar(body, db);
    for (const [caso, segunda, cobro] of [
      ['la segunda también tiene placa', respuestaCon(CON_PLACA, 1291), { entregada: 'diferido', descartados: ['estandar'] }],
      ['la segunda sale limpia', respuestaCon(SIN_PLACA, 1292), { entregada: 'estandar', descartados: ['diferido'] }],
    ]) {
      const vd = vertexEnLinea([respuestaCon(CON_PLACA, 1290), segunda]);
      const d = await silencio(() => run(H, body, { db, intercept: vd.intercept }));
      const vt = vertexEnLinea([segunda]);
      const t = await terminar(body, prep.json.lote.estado, respuestaCon(CON_PLACA, 1290), { intercept: vt.intercept });
      assert.equal(vd.cuerpos.length, 2, `${nombre}/${caso}: la directa intenta dos veces`);
      assert.equal(vt.cuerpos.length, 1, `${nombre}/${caso}: terminar sólo paga el segundo intento`);
      assert.deepEqual(vt.cuerpos[0], vd.cuerpos[1], `${nombre}/${caso}: el segundo intento es el mismo cuerpo, fotos incluidas`);
      assert.match(JSON.stringify(vt.cuerpos[0]), /CORRECTION: a previous attempt left a flat/);
      assert.ok(d.json.edge_plate !== undefined && d.json.discarded_attempts.length === 1, `${nombre}/${caso}: hubo placa`);
      assert.deepEqual(sinCobro(t.json), rt(d.json), `${nombre}/${caso}: la misma respuesta`);
      assert.deepEqual(t.json.lote_cobro, cobro, `${nombre}/${caso}`);
    }
  }
});

console.log('\n── 4 · lo mal formado se dice y no paga ──');
await ok('estado ilegible ⇒ 400 IMAGELAB_LOTE_ESTADO_INVALIDO sin llamar a nadie; modo desconocido ⇒ 400', async () => {
  const { r: prep } = await preparar(N1.copy_persona_locacion_producto, DB);
  const e = prep.json.lote.estado;
  for (const [mal, re] of [[{ ...e, v: 2 }, /versión/], [{ ...e, prompt: null }, /prompt/], [{ ...e, image_urls: ['a'] }, /reference_images/],
    [{ ...e, respuesta: { ...e.respuesta, canal: 1 } }, /respuesta\.canal/]]) {
    const t = await terminar(N1.copy_persona_locacion_producto, mal, EXITO);
    assert.equal(t.status, 400);
    assert.match(t.json.error, /^IMAGELAB_LOTE_ESTADO_INVALIDO: /);
    assert.match(t.json.error, re);
    assert.equal(t.fetched.length, 0, 'ni una llamada');
  }
  const x = await silencio(() => run(H, conLote(N1.copy_persona_sola, { modo: 'otro' }), { db: DB }));
  assert.equal(x.status, 400);
  assert.equal(x.fetched.length, 0);
});
await ok('«preparar» sin VERTEX_BATCH_BUCKET ⇒ 503 IMAGELAB_LOTE_NO_CONFIGURADO ANTES de pagar el constructor', async () => {
  const antes = process.env.VERTEX_BATCH_BUCKET;
  delete process.env.VERTEX_BATCH_BUCKET;
  try {
    const r = await silencio(() => run(H, conLote(N1.copy_persona_sola, { modo: 'preparar' }), { db: DB }));
    assert.equal(r.status, 503);
    assert.match(r.json.error, /^IMAGELAB_LOTE_NO_CONFIGURADO/);
    assert.deepEqual([r.vertexText, r.vertexImage], [null, null]);
  } finally { process.env.VERTEX_BATCH_BUCKET = antes; }
});
await ok('una foto que no sube ⇒ fallo (no «prepared») con el consumo del constructor, para que el carril lo asiente', async () => {
  const r = await silencio(() => run(H, conLote(N1.copy_persona_sola, { modo: 'preparar' }), { db: DB,
    intercept: async (u) => u.includes('storage.googleapis.com') ? new Response('denied', { status: 403 }) : undefined }));
  assert.equal(r.status, 500);
  assert.match(r.json.error, /^IMAGELAB_LOTE_REFERENCIA: Cloud Storage respondió 403/);
  assert.ok(r.json.prompt_builder_usage, 'el constructor corrió y su consumo viaja');
  assert.equal(r.vertexImage, null);
});

console.log('\n── 5 · api/lote.ts ──');
const L = await cargar(LOTE_SRC, 'lote');
function resp() { let status = 0, json = null; return { r: { setHeader() {}, status(s) { status = s; return this; }, json(j) { json = j; return this; } }, get: () => ({ status, json }) }; }
async function lote(body, { secreto = 's3cr3t', env = {}, fetchs = [] } = {}) {
  const real = globalThis.fetch, llamadas = [];
  const prev = { ...process.env };
  Object.assign(process.env, { IMAGELAB_LOTE_SECRET: 's3cr3t', VERTEX_BATCH_LOCATION: 'us-central1', VERTEX_BATCH_BUCKET: 'gs://lotes-prueba', GOOGLE_CLOUD_PROJECT: 'proyecto-prueba', ...env });
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  globalThis.fetch = async (u, init) => { llamadas.push({ u: String(u), init }); const f = fetchs.find(([m]) => String(u).includes(m)); return f ? f[1](String(u), init) : new Response('{}', { status: 404 }); };
  const x = resp();
  try { await silencio(() => L.default({ method: 'POST', headers: secreto === null ? {} : { 'x-imagelab-lote-secret': secreto }, body }, x.r)); }
  finally { globalThis.fetch = real; for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k]; Object.assign(process.env, prev); }
  return { ...x.get(), llamadas };
}
const PET = { id: 'p_imagen', model: 'gemini-2.5-flash-image', request: { contents: [{ role: 'user', parts: [{ text: 'T' }] }], generationConfig: { responseModalities: ['IMAGE'] } } };
const JOB = 'projects/32577846028/locations/us-central1/batchPredictionJobs/123';
await ok('protegido: sin IMAGELAB_LOTE_SECRET 503; secreto ausente o malo 401; sin región o bucket 503; nada sale', async () => {
  for (const [o, status, re] of [[{ env: { IMAGELAB_LOTE_SECRET: undefined } }, 503, /IMAGELAB_LOTE_SECRET/], [{ secreto: null }, 401, /NO_AUTORIZADO/],
    [{ secreto: 'otro!!' }, 401, /NO_AUTORIZADO/], [{ env: { VERTEX_BATCH_LOCATION: undefined } }, 503, /VERTEX_BATCH_LOCATION/],
    [{ env: { VERTEX_BATCH_BUCKET: undefined } }, 503, /VERTEX_BATCH_BUCKET/]]) {
    const r = await lote({ accion: 'enviar', peticiones: [PET] }, o);
    assert.equal(r.status, status, JSON.stringify(o));
    assert.match(r.json.error, re);
    assert.equal(r.llamadas.length, 0);
  }
});
await ok('enviar: UNA petición; JSONL `{"request"}` al bucket; job regional con el modelo de la petición y su id en la etiqueta', async () => {
  const r = await lote({ accion: 'enviar', peticiones: [PET] }, { fetchs: [
    ['storage.googleapis.com/upload', () => new Response('{}', { status: 200 })],
    ['batchPredictionJobs', () => new Response(JSON.stringify({ name: JOB, state: 'JOB_STATE_PENDING' }), { status: 200 })]] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.ok, r.json.lote_id], [true, JOB]);
  const [sub, job] = r.llamadas;
  assert.match(sub.u, /^https:\/\/storage\.googleapis\.com\/upload\/storage\/v1\/b\/lotes-prueba\/o\?uploadType=media&name=lotes%2F[0-9a-f-]{36}%2Fentrada\.jsonl$/);
  assert.equal(sub.init.body, `${JSON.stringify({ request: PET.request })}\n`);
  assert.equal(job.u, 'https://us-central1-aiplatform.googleapis.com/v1/projects/proyecto-prueba/locations/us-central1/batchPredictionJobs');
  const cuerpo = JSON.parse(job.init.body);
  assert.equal(cuerpo.model, 'publishers/google/models/gemini-2.5-flash-image');
  assert.deepEqual(cuerpo.inputConfig.instancesFormat, 'jsonl');
  assert.match(cuerpo.inputConfig.gcsSource.uris[0], /^gs:\/\/lotes-prueba\/lotes\/[0-9a-f-]{36}\/entrada\.jsonl$/);
  assert.match(cuerpo.outputConfig.gcsDestination.outputUriPrefix, /^gs:\/\/lotes-prueba\/lotes\/[0-9a-f-]{36}\/salida\/$/);
  assert.equal(cuerpo.labels.peticion, 'p_imagen');
  for (const mal of [[], [PET, PET], [{ ...PET, id: 'P mayúscula' }], [{ ...PET, model: 'x/../y' }], [{ ...PET, request: {} }]]) {
    const x = await lote({ accion: 'enviar', peticiones: mal });
    assert.equal(x.status, 400, JSON.stringify(mal).slice(0, 80));
    assert.equal(x.llamadas.length, 0);
  }
});
await ok('leer: estado; terminado con resultados ⇒ la única línea; sólo jobs de su proyecto y región; cancelar', async () => {
  const jobPend = () => new Response(JSON.stringify({ name: JOB, state: 'JOB_STATE_RUNNING', labels: { peticion: 'p_imagen' } }), { status: 200 });
  let r = await lote({ accion: 'leer', lote_id: JOB, con_resultados: true }, { fetchs: [[JOB, jobPend]] });
  assert.deepEqual(r.json, { ok: true, terminado: false, estado: 'JOB_STATE_RUNNING' });
  const linea = JSON.stringify({ status: '', processed_time: 'x', request: {}, response: EXITO });
  const fin = () => new Response(JSON.stringify({ name: JOB, state: 'JOB_STATE_SUCCEEDED', labels: { peticion: 'p_imagen' },
    outputInfo: { gcsOutputDirectory: 'gs://lotes-prueba/lotes/u/salida/prediction-model-1' } }), { status: 200 });
  r = await lote({ accion: 'leer', lote_id: JOB, con_resultados: true }, { fetchs: [
    ['?prefix=', () => new Response(JSON.stringify({ items: [{ name: 'lotes/u/salida/prediction-model-1/predictions.jsonl' }] }), { status: 200 })],
    ['alt=media', () => new Response(`${linea}\n`, { status: 200 })], [JOB, fin]] });
  assert.deepEqual(r.json.resultados, [{ id: 'p_imagen', ok: true, respuesta: EXITO, error: null }]);
  assert.ok(r.llamadas.some((c) => c.u.endsWith('?prefix=lotes%2Fu%2Fsalida%2Fprediction-model-1%2F')));
  const lineaMal = JSON.stringify({ status: 'Bad Request: x', request: {} });
  r = await lote({ accion: 'leer', lote_id: JOB, con_resultados: true }, { fetchs: [
    ['?prefix=', () => new Response(JSON.stringify({ items: [{ name: 'p/predictions.jsonl' }] }), { status: 200 })],
    ['alt=media', () => new Response(lineaMal, { status: 200 })], [JOB, fin]] });
  assert.deepEqual(r.json.resultados, [{ id: 'p_imagen', ok: false, respuesta: null, error: 'Bad Request: x' }]);
  const fallido = () => new Response(JSON.stringify({ name: JOB, state: 'JOB_STATE_FAILED', labels: { peticion: 'p_imagen' }, error: { message: 'cuota' } }), { status: 200 });
  r = await lote({ accion: 'leer', lote_id: JOB, con_resultados: true }, { fetchs: [[JOB, fallido]] });
  assert.equal(r.json.resultados[0].ok, false);
  assert.match(r.json.resultados[0].error, /JOB_STATE_FAILED: cuota/);
  for (const mal of ['projects/1/locations/europe-west4/batchPredictionJobs/1', 'projects/otro-proyecto/locations/us-central1/batchPredictionJobs/1',
    'projects/1/locations/us-central1/models/1', `${JOB}/../x`]) {
    const x = await lote({ accion: 'leer', lote_id: mal });
    assert.equal(x.status, 400, mal);
    assert.equal(x.llamadas.length, 0);
  }
  r = await lote({ accion: 'cancelar', lote_id: JOB }, { fetchs: [[`${JOB}:cancel`, () => new Response('{}', { status: 200 })]] });
  assert.deepEqual([r.status, r.llamadas[0].u, r.llamadas[0].init.method], [200, `https://us-central1-aiplatform.googleapis.com/v1/${JOB}:cancel`, 'POST']);
});
await ok('resultadoDeLaPeticion: más de una línea o ninguna ⇒ no servida (sin adivinar cuál es)', () => {
  assert.equal(L.resultadoDeLaPeticion([], 'p').ok, false);
  assert.equal(L.resultadoDeLaPeticion([{ status: '', response: {} }, { status: '', response: {} }], 'p').ok, false);
  assert.deepEqual(L.leerSalida('{"status":"","response":{"a":1}}\nno-json\n\n'), { lineas: [{ status: '', response: { a: 1 } }], ilegibles: 1 });
});

console.log('\n── 6 · regresiones inyectadas: cada comprobación se pone roja ante la suya ──');
async function debeFallar(nombre, src, buscar, poner, comprobar) {
  assert.equal(src.split(buscar).length, 2, `${nombre}: el punto de inyección debe existir y ser único`);
  let rojo = false;
  try { await silencio(() => comprobar(src.replace(buscar, poner))); } catch { rojo = true; }
  assert.ok(rojo, `${nombre}: la comprobación siguió en verde con la regresión puesta`);
}
const terminaIgual = async (texto) => {
  const h = await handlerDe(texto);
  const { subidos } = bucket();
  const b = bucket();
  const prep = await run(h, conLote(N1.copy_persona_locacion_producto, { modo: 'preparar' }), { db: DB, intercept: b.intercept });
  const d = await run(h, N1.copy_persona_locacion_producto, { db: DB, image: { status: 200, body: EXITO } });
  const t = await run(h, conLote(N1.copy_persona_locacion_producto, { modo: 'terminar', estado: comoJsonb(rt(prep.json.lote.estado)), respuesta: EXITO }), {});
  assert.deepEqual(sinCobro(t.json), rt(d.json));
  assert.deepEqual([t.vertexText, t.vertexImage], [null, null]);
  return subidos;
};
const preparaIgual = async (texto) => {
  const h = await handlerDe(texto);
  const b = bucket();
  const d = await run(h, N1.copy_persona_locacion_producto, { db: DB });
  const p = await run(h, conLote(N1.copy_persona_locacion_producto, { modo: 'preparar' }), { db: DB, intercept: b.intercept });
  assert.equal(p.vertexImage, null);
  assert.equal(p.json.lote.peticiones[0].request.contents[0].parts.filter((x) => x.fileData).length, d.vertexImage.contents[0].parts.length - 1);
};
await ok('R1 · la respuesta de lote pierde una clave ⇒ «terminar ≠ directa» se pone rojo', () => debeFallar('R1', SRC,
  '    location_refs: r.location_refs,\n', '    location_refs: (r as any).location_refs_x,\n', async (t) => {
    // La regresión toca la función común: se compara contra la respuesta CONGELADA de la directa, no contra sí misma.
    const h = await handlerDe(t), hBueno = H;
    const d = await run(hBueno, N1.copy_persona_locacion_producto, { db: DB, image: { status: 200, body: EXITO } });
    const b = bucket();
    const prep = await run(h, conLote(N1.copy_persona_locacion_producto, { modo: 'preparar' }), { db: DB, intercept: b.intercept });
    const x = await run(h, conLote(N1.copy_persona_locacion_producto, { modo: 'terminar', estado: comoJsonb(rt(prep.json.lote.estado)), respuesta: EXITO }), {});
    assert.deepEqual(sinCobro(x.json), rt(d.json));
  }));
await ok('R2 · «preparar» llama al modelo de imagen ⇒ rojo', () => debeFallar('R2', SRC,
  "    if (lote.modo === 'preparar') {\n", "    if (lote.modo === 'preparar') {\n      await generarImagen(estado, [], null);\n", preparaIgual));
await ok('R3 · «terminar» vuelve a pagar la primera imagen en línea ⇒ rojo', () => debeFallar('R3', SRC,
  '      primera = imageFromResponse(lote.respuesta, 200);', '      primera = await generarImagen(e, [], null);', terminaIgual));
await ok('R4 · el orden de las fotos cambia en el estado ⇒ rojo', () => debeFallar('R4', SRC,
  '      ...personaRefs, ...locationRefs, ...productRefs,\n    ];', '      ...productRefs, ...locationRefs, ...personaRefs,\n    ];', async (t) => {
    const h = await handlerDe(t);
    const b = bucket();
    const d = await run(H, N1.copy_persona_locacion_producto, { db: DB });
    const p = await run(h, conLote(N1.copy_persona_locacion_producto, { modo: 'preparar' }), { db: DB, intercept: b.intercept });
    const pParts = p.json.lote.peticiones[0].request.contents[0].parts;
    d.vertexImage.contents[0].parts.forEach((dp, i) => { if (dp.inlineData) {
      const sub = b.subidos.find((s) => `gs://${s.bucket}/${s.name}` === pParts[i].fileData.fileUri);
      assert.equal(sub.bytes.toString('base64'), dp.inlineData.data);
    } });
  }));
await ok('R5 · lote.ts deja de exigir el secreto ⇒ rojo', () => debeFallar('R5', LOTE_SRC,
  "  if (!secretoValido(req, secreto)) { res.status(401).json({ ok: false, error: 'LOTE_NO_AUTORIZADO' }); return; }", '', async (t) => {
    const Lx = await cargar(t, 'lote-roto');
    const x = resp();
    Object.assign(process.env, { IMAGELAB_LOTE_SECRET: 's', VERTEX_BATCH_LOCATION: 'us-central1' });
    const real = globalThis.fetch; globalThis.fetch = async () => new Response('{}', { status: 500 });
    try { await Lx.default({ method: 'POST', headers: {}, body: { accion: 'leer', lote_id: JOB } }, x.r); } finally { globalThis.fetch = real; delete process.env.IMAGELAB_LOTE_SECRET; delete process.env.VERTEX_BATCH_LOCATION; }
    assert.equal(x.get().status, 401);
  }));
await ok('R6 · lote.ts acepta más de una petición por lote ⇒ rojo', () => debeFallar('R6', LOTE_SRC,
  'if (!Array.isArray(raw) || raw.length !== 1)', 'if (!Array.isArray(raw) || raw.length < 1)', async (t) => {
    const Lx = await cargar(t, 'lote-roto');
    assert.equal(Lx.leerPeticiones([PET, PET]).ok, false);
  }));

console.log('\n── 7 · multimarca ──');
await ok('lo nuevo no nombra marcas ni modelos literales nuevos', () => {
  const nuevo = [SRC.slice(SRC.indexOf('// ── LOTE-IMAGEN:BEGIN ──'), SRC.indexOf('// ── LOTE-IMAGEN:END ──')),
    SRC.slice(SRC.indexOf('// --- LOTE-IMAGEN (2026-10-21)'), SRC.indexOf('// --- HTTP handler')), LOTE_SRC];
  for (const s of nuevo) {
    assert.doesNotMatch(s, /NeuroneSCF|ForumPHs|LucienSael|Unrealville|D7Herbal|Vivose|Vizos|DiamondDetails|Patricia/i);
    assert.doesNotMatch(s, /['"`](?:gemini|claude|imagen)-[a-z0-9.\-]+['"`]/, 'un modelo es dato o la constante de la llamada directa');
  }
});

console.log(fails.length ? `\n❌ imagen_en_lote: ${n} ok · ${fails.length} fallan` : `\n✓ imagen_en_lote: ${n} pruebas OK`);
process.exit(fails.length ? 1 : 0);
