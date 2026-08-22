// #95-C — builder visual unificado: marca + preset de marca + preset global + estímulo.
//
// NO reimplementa la lógica: extrae el bloque `C:BEGIN/END` de `api/execute.ts` y lo ejecuta.
// Lo que se testea es la fuente que se deploya, no una copia. Mismo patrón que los tests de
// `unrlvl-iid-functions` (bloques PBD / OBJ / U4 / U94 / CANAL).
//
// Ejecutar:  node tests/visual_spec_test.mjs
// Requiere Node ≥ 22.18 (type-stripping nativo). Sin dependencias.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'api', 'execute.ts');

// ── extracción del bloque puro ────────────────────────────────────────────────
const source = readFileSync(SRC, 'utf8');
const BEGIN = '// ── C:BEGIN ──';
const END = '// ── C:END ──';
const i = source.indexOf(BEGIN);
const j = source.indexOf(END);
assert.ok(i >= 0, `sentinela ${BEGIN} no encontrado en ${SRC}`);
assert.ok(j > i, `sentinela ${END} no encontrado (o antes del BEGIN)`);

const dir = mkdtempSync(join(tmpdir(), 'c-block-'));
const modPath = join(dir, 'c_block.mts');
// El bloque usa FALLBACK_NEGATIVE, declarada fuera. Se extrae por regex del MISMO archivo para no
// reimplementarla: si cambia en producción, el test la sigue.
const fbMatch = source.match(/const FALLBACK_NEGATIVE = '[^']*';/);
assert.ok(fbMatch, 'no se pudo extraer FALLBACK_NEGATIVE — ¿cambió su forma?');
writeFileSync(modPath, `${fbMatch[0]}\n\n${source.slice(i, j + END.length)}\n`, 'utf8');
const M = await import(pathToFileURL(modPath).href);
for (const fn of ['mergeVisualSpec', 'composeVisualPrompt']) {
  assert.equal(typeof M[fn], 'function', `el bloque C debe exportar ${fn}`);
}

// ── fixtures REALES (leídos de la DB el 2026-07-24) ──────────────────────────
const LUCIEN = {
  id: 'LucienSael',
  display_name: 'Lucien Sael',
  imagelab_visual_identity: 'Editorial portrait of a man in his early-to-mid 40s. Ambiguous ethnic origin — slight Slavic bone structure, olive-warm undertone. Angular jaw, defined cheekbones, dark grey-green eyes, direct gaze without warmth. Modern monochromatic wardrobe — black or deep charcoal only, never color.',
  imagelab_compliance_rules: null,
  imagelab_industry: null,
  imagelab_realism_level: 'photorealistic, editorial, high-end commercial photography standard',
  imagelab_film_look: 'Leica M11 aesthetic, Kodak Vision3 500T color science, slight cinematic grain',
  imagelab_lens_preset: '85mm f/1.4 equivalent, shallow depth of field',
  imagelab_depth_of_field: 'shallow — subject sharp, background architecturally soft',
  imagelab_framing: 'upper third centered, intentional negative space, editorial composition',
  imagelab_skin_detail: 'natural skin texture, visible pores, micro-asymmetry — real not retouched',
  imagelab_imperfections: 'very slight texture only — no blemishes, no distracting imperfections',
  imagelab_humidity_level: null,
  imagelab_sweat_level: null,
  imagelab_grain_level: 2,
  default_negative_prompt: 'smiling broadly, casual pose, sporty clothing, colorful wardrobe, visible logos, excess jewelry, stock photo expression, AI-generated skin smoothness',
};

// `imagelab_presets` con brand_id NULL, canal TIKTOK (uno de los 7 globales)
const GLOBAL_TIKTOK = {
  brand_id: null, canal: 'TIKTOK', preset_id: 'T0101',
  realism_level: 'cinematic', film_look: '35mm_film', lens_preset: '35mm_hero',
  depth_of_field: 'shallow', framing: 'rule_of_thirds', skin_detail: 'realistic',
  imperfections: null, humidity_level: null, sweat_level: null, grain_level: 1.5,
  lighting_style: null, color_grading: null, aspect_ratio: '9:16',
  negative_prompt: null, extra_params: null,
};

const PSY_AUTHORITY = {
  id: 'PSY-AUTHORITY', objective_tag: 'authority',
  injection_visual: 'Include a credential or concrete data point. Didactic tone without condescension.',
};

// ── 1 · LO QUE C ARREGLA: identidad + preset + estímulo EN LA MISMA IMAGEN ───
{
  const spec = M.mergeVisualSpec(LUCIEN, null, GLOBAL_TIKTOK, PSY_AUTHORITY);
  assert.ok(spec.visual_identity, 'la identidad de marca debe llegar aunque haya preset');
  assert.equal(spec.preset_source, 'global', 'sin preset de marca, cae al global');
  assert.equal(spec.psycho_id, 'PSY-AUTHORITY', 'el estímulo entra en la MISMA spec que la identidad');

  const prompt = M.composeVisualPrompt(spec, 'un tema cualquiera');
  assert.match(prompt, /Brand visual identity:/, 'la identidad va al prompt');
  assert.match(prompt, /PSYCHO LAYER \[PSY-AUTHORITY\]/, 'el estímulo va al prompt');
  // Antes de C esto era imposible: la rama preset ignoraba el psycho y la legacy ignoraba el preset.
}

// ── 2 · PRECEDENCIA — el preset GLOBAL no pisa lo que la marca declara ──────
// El caso que obligó a corregir el diseño a mitad de camino.
{
  const spec = M.mergeVisualSpec(LUCIEN, null, GLOBAL_TIKTOK, null);
  assert.match(spec.ejes.realism_level, /photorealistic, editorial/,
    'la marca gana sobre el global: su spec editorial NO puede caer a "cinematic"');
  assert.notEqual(spec.ejes.realism_level, 'cinematic');
  assert.match(spec.ejes.film_look, /Leica M11/, 'idem film_look');
  // …pero el global SÍ rellena donde la marca calla.
  assert.equal(spec.ejes.humidity_level, undefined, 'ninguno lo declara → ausente');
  assert.equal(String(spec.ejes.grain_level), '2', 'la marca declara 2 → gana sobre el 1.5 global');
}

// ── 3 · El preset de MARCA sí gana sobre la marca ───────────────────────────
{
  const presetMarca = { brand_id: 'LucienSael', canal: 'TIKTOK', preset_id: 'L-TT', realism_level: 'hiperrealista de canal' };
  const spec = M.mergeVisualSpec(LUCIEN, presetMarca, GLOBAL_TIKTOK, null);
  assert.equal(spec.ejes.realism_level, 'hiperrealista de canal', 'el preset de marca es lo más específico');
  assert.equal(spec.preset_source, 'brand');
  assert.equal(spec.preset_id, 'L-TT');
  // Los ejes que el preset de marca NO declara siguen viniendo de la marca.
  assert.match(spec.ejes.film_look, /Leica M11/);
}

// ── 4 · DEGRADACIÓN LIMPIA sin estímulo (#99: el caso del camino sync) ──────
{
  const conPsy = M.mergeVisualSpec(LUCIEN, null, GLOBAL_TIKTOK, PSY_AUTHORITY);
  const sinPsy = M.mergeVisualSpec(LUCIEN, null, GLOBAL_TIKTOK, null);
  assert.equal(sinPsy.psycho_injection, null);
  assert.equal(sinPsy.psycho_id, null);

  const a = M.composeVisualPrompt(sinPsy, 'tema');
  const b = M.composeVisualPrompt(conPsy, 'tema');
  assert.ok(!a.includes('PSYCHO LAYER'), 'sin estímulo, no aparece la capa');
  assert.ok(b.includes('PSYCHO LAYER'), 'con estímulo, sí');
  // Degradación LIMPIA = lo único que cambia es la capa psicológica. Todo lo demás, idéntico.
  // Se quita el segmento EXACTO, no por regex: `injection_visual` contiene puntos y cualquier
  // `[^.]*\.` cortaría a la mitad. (Lo aprendí fallando este mismo assert.)
  const segmento = `PSYCHO LAYER [${PSY_AUTHORITY.id}]: ${PSY_AUTHORITY.injection_visual}. `;
  assert.ok(b.includes(segmento), 'el segmento del estímulo debe aparecer entero');
  assert.equal(b.replace(segmento, ''), a,
    'sin estímulo el prompt debe ser el mismo MENOS la capa — nada más puede moverse');
}

// ── 5 · NEGATIVO ACUMULATIVO, no excluyente ────────────────────────────────
{
  const presetConNeg = { brand_id: 'LucienSael', canal: 'X', preset_id: 'P', negative_prompt: 'texto legible, marcas de agua',
    extra_params: { forbidden_elements: ['manos deformes'] } };
  const spec = M.mergeVisualSpec(LUCIEN, presetConNeg, null, null);
  assert.match(spec.negative, /manos deformes/, 'lo prohibido por el preset');
  assert.match(spec.negative, /texto legible/, 'y su negative_prompt');
  assert.match(spec.negative, /smiling broadly/, 'Y SIGUE lo prohibido por la MARCA — el candado no se pierde');
  // sin duplicados
  const items = spec.negative.split(',').map((s) => s.trim());
  assert.equal(items.length, new Set(items).size, 'el negativo no debe repetir términos');
}

// ── 6 · Sin ninguna capa — no explota y cae al negativo por defecto ────────
{
  const spec = M.mergeVisualSpec(null, null, null, null);
  assert.equal(spec.preset_source, 'none');
  assert.equal(spec.visual_identity, null);
  assert.ok(spec.negative.length > 0, 'siempre hay negativo: FALLBACK_NEGATIVE');
  const prompt = M.composeVisualPrompt(spec, 'un producto');
  assert.match(prompt, /Concept: un producto/);
  assert.match(prompt, /FORBIDDEN:/);
}

// ── 7 · Orden determinista de los ejes ─────────────────────────────────────
// El prompt tiene que ser reproducible: el orden no puede depender del orden de claves del objeto.
{
  const spec = M.mergeVisualSpec(LUCIEN, null, GLOBAL_TIKTOK, PSY_AUTHORITY);
  const a = M.composeVisualPrompt(spec, 'tema');
  const b = M.composeVisualPrompt(M.mergeVisualSpec(LUCIEN, null, GLOBAL_TIKTOK, PSY_AUTHORITY), 'tema');
  assert.equal(a, b, 'misma entrada → mismo prompt, carácter por carácter');
  // realism_level antes que grain_level, siempre (orden de EJES_COMPARTIDOS)
  assert.ok(a.indexOf('realism level:') < a.indexOf('grain level:'));
}

// ── 8 · El estímulo va DESPUÉS de la identidad y ANTES del compliance ──────
{
  const marcaConCompliance = { ...LUCIEN, imagelab_compliance_rules: 'Sin texto, sin logos.' };
  const spec = M.mergeVisualSpec(marcaConCompliance, null, null, PSY_AUTHORITY);
  const p = M.composeVisualPrompt(spec, 'tema');
  assert.ok(p.indexOf('Brand visual identity:') < p.indexOf('PSYCHO LAYER'),
    'el estímulo modula una imagen que ya es de la marca: no puede ir antes de la identidad');
  assert.ok(p.indexOf('PSYCHO LAYER') < p.indexOf('Brand constraints:'),
    'y las restricciones cierran');
  assert.ok(p.indexOf('Brand constraints:') < p.indexOf('FORBIDDEN:'));
}

// ── 9 · El bloque es puro ──────────────────────────────────────────────────
{
  const block = source.slice(i, j);
  for (const prohibido of ['fetch(', 'await ', 'sb<', 'process.env']) {
    assert.ok(!block.includes(prohibido), `el bloque C debe ser puro: contiene '${prohibido}'`);
  }
}

// ── 10 · BRIEF 7 · la cláusula SIN TEXTO es del motor, no del dato ─────────
// Lo que este bloque prueba es lo único que hace que el compositor tenga sentido: que la imagen
// llegue LIMPIA. Si el modelo sigue dibujando letras, componer tipografía encima apila dos textos.
{
  // (a) sale SIEMPRE — sin marca, sin preset, sin estímulo y sin concepto.
  const vacio = M.composeVisualPrompt(M.mergeVisualSpec(null, null, null, null), '');
  assert.match(vacio, /must contain NO text of any kind/,
    'la cláusula no depende de que una marca la declare: es del eje');
  assert.match(vacio, /FORBIDDEN:[^.]*\btext\b/, 'y también viaja por el negativo');

  // (b) posición: pegada al concepto, antes de identidad, estilo y estímulo.
  const spec = M.mergeVisualSpec(LUCIEN, null, GLOBAL_TIKTOK, PSY_AUTHORITY);
  const p = M.composeVisualPrompt(spec, 'tema');
  assert.ok(p.indexOf('Concept: tema') < p.indexOf('NO text of any kind'));
  assert.ok(p.indexOf('NO text of any kind') < p.indexOf('Brand visual identity:'),
    'la restricción que define qué CLASE de imagen es va antes que el estilo');

  // (c) cero vocabulario de marca (test de la marca N+1 sobre el literal del motor).
  const clausula = (source.match(/const NO_TEXT_CLAUSE =[\s\S]*?;\n/) ?? [''])[0]
    + (source.match(/const NO_TEXT_NEGATIVE =[\s\S]*?;\n/) ?? [''])[0];
  for (const marca of ['ForumPHs', 'Unrealville', 'Lucien', 'Neurone', 'Ley 284', 'Panam', 'espa\u00f1ol']) {
    assert.ok(!clausula.includes(marca), `la cláusula del eje nombra '${marca}' — sería instancia, no eje`);
  }

  // (d) el negativo del eje no se duplica cuando la marca ya prohibía lo mismo, y el de la marca
  //     sobrevive (acumulativo, no excluyente).
  const conTexto = { ...LUCIEN, default_negative_prompt: 'text, plastic perfection' };
  const neg = M.mergeVisualSpec(conTexto, null, null, null).negative;
  assert.equal(neg.split(', ').filter((t) => t === 'text').length, 1, 'sin duplicar términos');
  assert.ok(neg.includes('plastic perfection'), 'lo que la marca prohíbe sigue prohibido');
  assert.ok(neg.startsWith('text, letters, words'), 'el eje encabeza el negativo');
}

console.log('✅ visual_spec_test — 10 bloques OK');
