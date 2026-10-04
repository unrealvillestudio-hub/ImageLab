// LA FRANJA DE TEXTO Y EL ENCUADRE, POR CANAL Y COMO DATO (2026-10-03).
//
// Qué fija, sin red:
//   1. GOLDEN: sin dato que active el cambio (sin fila de canal, fila de otro canal, fila inactiva o fila
//      que no toca franja ni encuadre), el cuerpo hacia Vertex es el MISMO que en main (35eccca) en
//      144 corridas del handler real, y la lista de cláusulas del motor es la misma en 128 combinaciones.
//   2. Las piezas puras: mezcla de capas (igual a la del compositor), fila de canal, vocabulario del
//      encuadre y la cláusula de escena.
//   3. El handler real CON dato: la fila del canal apaga la franja y abre el encuadre sólo en su canal.
//   4. Multimarca (ningún literal de marca ni de canal en el código nuevo) y voseo.
//
// La marca de los fixtures es inventada (un taller de cerámica de Oaxaca, México): otro rubro y otro país.
// NO reimplementa la lógica: extrae los bloques `C` y `PB` de `api/execute.ts`, el bloque `COMPOSITOR`
// de `api/compose.ts`, y carga el handler real con el arnés.
//
// Ejecutar:  node tests/canal_layout_test.mjs     (Node ≥ 22.18, type-stripping nativo)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { loadHandler, run, vertexDigest } from './_handler_harness.mjs';
import { GOLDEN_DBS, CANALES, FORMAS, req, dbCon, dbMarca, fila, ACTIVA, MARCA_CON_FRANJA, PERSONAS } from './fixtures/canal_layout_escenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');
const composeSrc = readFileSync(join(ROOT, 'api', 'compose.ts'), 'utf8');
function block(src, tag) {
  const b = `// ── ${tag}:BEGIN ──`, e = `// ── ${tag}:END ──`;
  const i = src.indexOf(b), j = src.indexOf(e);
  assert.ok(i >= 0 && j > i, `bloque ${tag} no encontrado`);
  return src.slice(i, j + e.length);
}
const fb = source.match(/const FALLBACK_NEGATIVE = '[^']*';/);
const dir = mkdtempSync(join(tmpdir(), 'canal-layout-'));
writeFileSync(join(dir, 'pb.mts'), `${fb[0]}\n\n${block(source, 'C')}\n\n${block(source, 'PB')}\n`, 'utf8');
writeFileSync(join(dir, 'comp.mts'), `${block(composeSrc, 'COMPOSITOR')}\n`, 'utf8');
const M = await import(pathToFileURL(join(dir, 'pb.mts')).href);
const K = await import(pathToFileURL(join(dir, 'comp.mts')).href);

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`  ✓ ${name}`); };
const silence = () => { const l = console.log, w = console.warn, e = console.error; const seen = []; console.log = () => {}; console.warn = (...a) => seen.push(a.join(' ')); console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; return seen; }; };
const hash = (d) => createHash('sha256').update(JSON.stringify(d)).digest('hex');
const GOLDEN = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'canal_layout_golden.json'), 'utf8'));
const handler = await loadHandler();
const go = async (canal, params, db) => {
  const restore = silence();
  let r;
  try { r = await run(handler, req(canal, params), { db }); } finally { restore(); }
  return r;
};
const TEXTO = 'will carry text added later';
const CENIDO = 'Frame tightly around';
const PROMPT_ONLY = { ...FORMAS.copy_persona_producto, prompt_only: true };

// ── 1 · golden ──────────────────────────────────────────────────────────────────────────────────
console.log('── 1 · sin dato activo: idéntico a main ──');
await ok(`las ${Object.keys(GOLDEN.handler).length} corridas del handler son idénticas al golden de main`, async () => {
  assert.equal(Object.keys(GOLDEN.handler).length, Object.keys(GOLDEN_DBS).length * CANALES.length * Object.keys(FORMAS).length);
  for (const [db, DB] of Object.entries(GOLDEN_DBS)) {
    for (const canal of CANALES) {
      for (const [forma, params] of Object.entries(FORMAS)) {
        const k = `${db}|${canal ?? '∅'}|${forma}`;
        assert.equal(hash(vertexDigest(await go(canal, params, DB))), GOLDEN.handler[k], `la corrida «${k}» cambió`);
      }
    }
  }
});
await ok(`las ${Object.keys(GOLDEN.engine).length} listas del motor son idénticas, sin el argumento nuevo y con framing «tight»`, () => {
  for (const [k, h] of Object.entries(GOLDEN.engine)) {
    const args = JSON.parse(k);
    assert.equal(hash(M.engineClausesFor(args)), h, `motor ${k}`);
    assert.equal(hash(M.engineClausesFor({ ...args, framing: 'tight' })), h, `motor tight ${k}`);
    assert.equal(hash(M.engineClausesFor({ ...args, framing: null })), h, `motor null ${k}`);
  }
});

// ── 2 · piezas puras ────────────────────────────────────────────────────────────────────────────
console.log('── 2 · piezas puras ──');
await ok('la mezcla de capas es la del compositor (mismas filas, mismos tokens)', () => {
  const marca = { layout: { anchor: 'bottom_left', text_zone_pct: 40, scrim: { mode: 'gradient_bottom', opacity: 0.8 } }, product: { mode: 'in_scene' }, fit: [1, 2] };
  const canal = { layout: { text_zone_pct: 0, subject_framing: 'scene', scrim: { opacity: 0.5 } }, fit: [3] };
  assert.deepEqual(M.mergeTokenLayers(marca, canal), K.deepMergeTokens(marca, canal));
  const rows = [{ id: '1', brand_id: 'X', canal: null, active: true, tokens: marca }, { id: '2', brand_id: 'X', canal: 'SUPERFICIE', active: true, tokens: canal }];
  assert.deepEqual(M.overlayTokensForCanal(marca, rows[1], 'SUPERFICIE').tokens, K.pickOverlayTokens(rows, 'X', 'SUPERFICIE').tokens,
    'el generador y el compositor leen la misma franja para el mismo canal');
  assert.deepEqual(marca.layout.text_zone_pct, 40, 'la mezcla no muta la fila de marca');
});
await ok('fila de canal: sólo la de ESTE canal y con tokens; si no, los de marca, el mismo objeto', () => {
  const marca = { layout: { text_zone_pct: 40, anchor: 'bottom_left' } };
  assert.equal(M.overlayTokensForCanal(marca, null, 'SUPERFICIE').tokens, marca);
  assert.equal(M.overlayTokensForCanal(marca, { canal: 'OTRA', tokens: { layout: {} } }, 'SUPERFICIE').tokens, marca);
  assert.equal(M.overlayTokensForCanal(marca, { canal: null, tokens: { layout: {} } }, 'SUPERFICIE').tokens, marca, 'la fila de marca no se mezcla consigo');
  assert.equal(M.overlayTokensForCanal(marca, { canal: 'SUPERFICIE', tokens: null }, 'SUPERFICIE').tokens, marca);
  assert.equal(M.overlayTokensForCanal(marca, { canal: 'SUPERFICIE', tokens: {} }, '').tokens, marca, 'sin canal pedido, nada');
  const r = M.overlayTokensForCanal(marca, { canal: 'superficie', tokens: { layout: { text_zone_pct: 0 } } }, 'Superficie');
  assert.deepEqual(r, { tokens: { layout: { text_zone_pct: 0, anchor: 'bottom_left' } }, canal: 'SUPERFICIE', declared: ['text_zone_pct'] });
  assert.deepEqual(M.overlayTokensForCanal(null, { canal: 'SUPERFICIE', tokens: { layout: { subject_framing: 'scene' } } }, 'SUPERFICIE').tokens,
    { layout: { subject_framing: 'scene' } }, 'sin fila de marca, la del canal sola');
});
await ok('encuadre: ausente = tight; tight y scene del vocabulario; ajeno = tight con aviso', () => {
  assert.deepEqual(M.resolveSubjectFraming(undefined), { framing: 'tight', declared: false, warning: null });
  assert.deepEqual(M.resolveSubjectFraming({ subject_framing: '' }), { framing: 'tight', declared: false, warning: null });
  assert.deepEqual(M.resolveSubjectFraming({ subject_framing: ' Scene ' }), { framing: 'scene', declared: true, warning: null });
  assert.deepEqual(M.resolveSubjectFraming({ subject_framing: 'tight' }), { framing: 'tight', declared: true, warning: null });
  const raro = M.resolveSubjectFraming({ subject_framing: 'wide' });
  assert.equal(raro.framing, 'tight'); assert.match(raro.warning, /no es uno de tight, scene/);
  assert.deepEqual([...M.SUBJECT_FRAMINGS], ['tight', 'scene']);
});
await ok('la cláusula de escena conserva «sin zona vacía arriba» y deja el plano a la escena', () => {
  for (const k of [0, 1, 2, 3]) assert.equal(M.framingClause('tight', k), M.subjectFramingClause(k));
  for (const k of [0, 1, 2, 3]) assert.equal(M.framingClause('scene', k), M.SCENE_FRAMING_CLAUSE);
  assert.ok(M.SCENE_FRAMING_CLAUSE.includes('top-down overhead view') && M.SCENE_FRAMING_CLAUSE.includes('close-up detail of hands'));
  assert.ok(M.SCENE_FRAMING_CLAUSE.includes('no large empty area of ceiling, wall or sky'));
  assert.ok(!M.SCENE_FRAMING_CLAUSE.includes('Frame tightly') && !M.SCENE_FRAMING_CLAUSE.includes('fills most of the frame'));
  const base = { mode: 'regenerate_full', textZone: 'TZ', personaCount: 2, gaze: null, placement: '', productInScene: false, productComposited: false, angleSeed: '' };
  const tight = M.engineClausesFor(base), scene = M.engineClausesFor({ ...base, framing: 'scene' });
  assert.deepEqual(scene, tight.map((c) => (c === M.subjectFramingClause(2) ? M.SCENE_FRAMING_CLAUSE : c)), 'sólo cambia la cláusula de encuadre, en su sitio');
  assert.deepEqual(M.engineClausesFor({ ...base, mode: 'edit_from_current', framing: 'scene' }), M.engineClausesFor({ ...base, mode: 'edit_from_current' }), 'al editar no hay encuadre');
});

// ── 3 · el handler con dato ─────────────────────────────────────────────────────────────────────
console.log('── 3 · el handler con fila de canal ──');
await ok('fila BLOG_INLINE {text_zone_pct 0, scene}: sin franja ni lugar del producto, encuadre de escena, y lo dice la respuesta', async () => {
  const r = await go('BLOG_INLINE', PROMPT_ONLY, dbCon(ACTIVA('BLOG_INLINE')));
  const p = r.json.prompt_full;
  assert.equal(r.status, 200);
  assert.ok(!p.includes(TEXTO), 'la franja sigue');
  assert.ok(!p.includes('raised to shoulder or face height'), 'el lugar del producto (que sólo esquiva la franja) sigue');
  assert.ok(!p.includes(CENIDO) && p.includes(M.SCENE_FRAMING_CLAUSE));
  assert.deepEqual([r.json.overlay_canal, r.json.subject_framing, r.json.text_zone], ['BLOG_INLINE', 'scene', false]);
  // Lo mismo sin prompt_only: el texto que viaja a Vertex.
  const full = vertexDigest(await go('BLOG_INLINE', FORMAS.copy_persona_producto, dbCon(ACTIVA('BLOG_INLINE'))));
  const t = full.image_text.join(' ');
  assert.ok(!t.includes(TEXTO) && !t.includes(CENIDO) && t.includes(M.SCENE_FRAMING_CLAUSE));
  assert.equal(full.response.overlay_canal, 'BLOG_INLINE');
});
await ok('la fila de un canal no toca los otros: BLOG_FEATURED, INSTAGRAM_FEED y sin canal, idénticos a main', async () => {
  const db = dbCon(ACTIVA('BLOG_INLINE'));
  for (const canal of ['BLOG_FEATURED', 'INSTAGRAM_FEED', null]) {
    for (const [forma, params] of Object.entries(FORMAS)) {
      assert.equal(hash(vertexDigest(await go(canal, params, db))), GOLDEN.handler[`solo_marca|${canal ?? '∅'}|${forma}`], `${canal}|${forma}`);
    }
  }
});
await ok('clave a clave: sólo text_zone_pct 0 deja el encuadre ceñido; sólo scene deja la franja de la marca', async () => {
  const soloTexto = (await go('BLOG_INLINE', PROMPT_ONLY, dbCon(fila('BLOG_INLINE', { layout: { text_zone_pct: 0 } })))).json;
  assert.ok(!soloTexto.prompt_full.includes(TEXTO) && soloTexto.prompt_full.includes(CENIDO));
  assert.deepEqual([soloTexto.overlay_canal, soloTexto.subject_framing], ['BLOG_INLINE', 'tight']);
  const soloEncuadre = (await go('BLOG_INLINE', PROMPT_ONLY, dbCon(fila('BLOG_INLINE', { layout: { subject_framing: 'scene' } })))).json;
  assert.ok(soloEncuadre.prompt_full.includes('The lower 40% of the frame ' + TEXTO), 'la franja de la marca (40, abajo) sigue');
  assert.ok(soloEncuadre.prompt_full.includes(M.SCENE_FRAMING_CLAUSE) && !soloEncuadre.prompt_full.includes(CENIDO));
  assert.equal(soloEncuadre.text_zone, true);
});
await ok('el encuadre en la fila de marca vale para todos sus canales; la fila del canal lo devuelve a tight', async () => {
  const marca = { ...MARCA_CON_FRANJA.tokens, layout: { ...MARCA_CON_FRANJA.tokens.layout, subject_framing: 'scene' } };
  const db = dbMarca(marca, fila('INSTAGRAM_FEED', { layout: { subject_framing: 'tight' } }));
  const blog = (await go('BLOG_FEATURED', PROMPT_ONLY, db)).json;
  assert.ok(blog.prompt_full.includes(M.SCENE_FRAMING_CLAUSE));
  assert.deepEqual([blog.overlay_canal, blog.subject_framing], [null, 'scene'], 'sin fila de canal, se declara el encuadre');
  const feed = (await go('INSTAGRAM_FEED', PROMPT_ONLY, db)).json;
  assert.ok(feed.prompt_full.includes(CENIDO) && !feed.prompt_full.includes(M.SCENE_FRAMING_CLAUSE));
});
await ok('valor ajeno: encuadre ceñido de siempre y aviso en el log', async () => {
  const restore = silence();
  let r;
  try { r = await run(handler, req('BLOG_INLINE', PROMPT_ONLY), { db: dbCon(fila('BLOG_INLINE', { layout: { subject_framing: 'wide' } })) }); } finally { var seen = restore(); }
  assert.ok(r.json.prompt_full.includes(CENIDO));
  assert.ok(seen.some((l) => l.includes('subject_framing="wide"')), 'sin aviso');
});
await ok('dos personas con escena: la cláusula de escena, no el plural ceñido; editar: sin encuadre, como siempre', async () => {
  const dos = (await go('BLOG_INLINE', { ...FORMAS.copy_dos_personas, prompt_only: true }, dbCon(ACTIVA('BLOG_INLINE')))).json.prompt_full;
  assert.ok(dos.includes(M.SCENE_FRAMING_CLAUSE) && !dos.includes('Frame tightly around the 2 people'));
  const ed = (await go('BLOG_INLINE', { ...FORMAS.editar, prompt_only: true }, dbCon(ACTIVA('BLOG_INLINE')))).json.prompt_full;
  assert.ok(!ed.includes(M.SCENE_FRAMING_CLAUSE) && !ed.includes(CENIDO) && !ed.includes(TEXTO));
});
await ok('fila de canal sin fila de marca: vale sola', async () => {
  const db = { ...GOLDEN_DBS.sin_filas, imagelab_overlay_tokens: GOLDEN_DBS.sin_filas.imagelab_overlay_tokens };
  const solo = { ...db, imagelab_overlay_tokens: (q) => (q.get('canal') === 'eq.BLOG_INLINE' ? [{ canal: 'BLOG_INLINE', tokens: { layout: { subject_framing: 'scene' } } }] : []) };
  const r = (await go('BLOG_INLINE', PROMPT_ONLY, solo)).json;
  assert.ok(r.prompt_full.includes(M.SCENE_FRAMING_CLAUSE) && !r.prompt_full.includes(TEXTO));
  assert.equal(r.overlay_canal, 'BLOG_INLINE');
});
await ok('la consulta de la fila de marca es la de siempre y la del canal pide activa, ese canal y una fila', async () => {
  const r = await go('BLOG_INLINE', PROMPT_ONLY, dbCon());
  const q = r.fetched.filter((u) => u.includes('/imagelab_overlay_tokens?'));
  assert.ok(q.some((u) => u.endsWith('imagelab_overlay_tokens?brand_id=eq.TallerBarroNegro&canal=is.null&select=tokens')));
  assert.ok(q.some((u) => u.endsWith('imagelab_overlay_tokens?brand_id=eq.TallerBarroNegro&canal=eq.BLOG_INLINE&active=is.true&select=canal,tokens&limit=1')));
  assert.equal(q.length, 2);
});

// ── 4 · multimarca y voseo ──────────────────────────────────────────────────────────────────────
console.log('── 4 · multimarca y voseo ──');
const nuevo = source.slice(source.indexOf('// ── LA FRANJA Y EL ENCUADRE, POR CANAL'), source.indexOf('/** Identidad sin vestuario, para N personas.'))
  + source.slice(source.indexOf('async function loadOverlayTokens'), source.indexOf('// Los topes de fotos de referencia'))
  + source.slice(source.indexOf('const overlay = await loadOverlayTokens'), source.indexOf('const productComposited ='));
await ok('el código nuevo no nombra marcas ni canales', () => {
  assert.ok(nuevo.length > 3000, 'no se encontró el código nuevo');
  // CC_PROTOCOL §14.1: sin comentarios, o la comprobación se dispara sobre su propia explicación.
  const sinComentarios = nuevo.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n');
  for (const lit of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'Neurone', 'Patricia', 'Lucien', 'podcast',
    'BLOG_INLINE', 'BLOG_FEATURED', 'INSTAGRAM', 'CAROUSEL', 'REFERENCE_SHEET']) {
    assert.ok(!sinComentarios.includes(lit), `literal «${lit}» en el código nuevo`);
  }
});
await ok('sin voseo en lo nuevo (código, comentarios, tests y fixtures)', () => {
  const VOSEO = /(?<!\p{L})(querés|podés|tenés|sabés|hacés|decís|sos|vos|mirá|fijate|andá|vení|poné|usá|hacé|decí|tené|agregá|revisá|probá|dejá|sacá|cambiá|tomá|pasá|llamá|acordate|fijá|corré|aplicá|mergeá|mirala|medí|abrí|elegí|decidí|confirmá|desplegá|leé)(?!\p{L})/iu;
  const propios = [nuevo, readFileSync(fileURLToPath(import.meta.url), 'utf8'), readFileSync(join(ROOT, 'tests', 'fixtures', 'canal_layout_escenarios.mjs'), 'utf8'),
    readFileSync(join(ROOT, 'tests', '_capturar_golden_canal.mjs'), 'utf8'), readFileSync(join(ROOT, 'tests', '_handler_harness.mjs'), 'utf8')];
  for (const t of propios) {
    const hit = t.split('\n').filter((l) => !l.includes('const VOSEO')).find((l) => VOSEO.test(l));
    assert.equal(hit, undefined, `voseo en: ${hit}`);
  }
});

console.log(`\n✅ canal_layout_test — ${n} bloques OK`);
