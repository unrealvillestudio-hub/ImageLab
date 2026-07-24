// #95-C — PRUEBA COMPARATIVA: builder viejo vs builder nuevo, con datos reales de LucienSael.
//
// Requisito del brief antes de desplegar C. Genera los DOS prompts —el que produce el código
// desplegado hoy y el que produce este PR— sobre la misma marca y el mismo canal, para que Sam
// compare con criterio de marca.
//
// Se compara el PROMPT y no la imagen: generar imágenes exige credenciales de Vertex y consume
// cuota. El prompt es además lo que decide si C hace lo que debe — si la identidad de marca no
// entra al prompt, no va a aparecer en ninguna imagen.
//
// Ejecutar:  node tests/comparativa_95c.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');

const i = source.indexOf('// ── C:BEGIN ──');
const j = source.indexOf('// ── C:END ──');
const dir = mkdtempSync(join(tmpdir(), 'cmp-'));
const modPath = join(dir, 'c.mts');
const fb = source.match(/const FALLBACK_NEGATIVE = '[^']*';/)[0];
writeFileSync(modPath, `${fb}\n\n${source.slice(i, j + 13)}\n`, 'utf8');
const M = await import(pathToFileURL(modPath).href);

// ── datos REALES (DB, 2026-07-24) ───────────────────────────────────────────
const LUCIEN = {
  id: 'LucienSael',
  display_name: 'Lucien Sael',
  imagelab_visual_identity: 'Editorial portrait of a man in his early-to-mid 40s. Ambiguous ethnic origin — slight Slavic bone structure, olive-warm undertone, undefined geographic identity. Angular jaw, defined cheekbones, dark grey-green eyes, direct gaze without warmth. Dark brown-black hair, natural texture, not styled. Modern monochromatic wardrobe — black or deep charcoal only, never color. Open collar shirt 1-2 buttons, never turtleneck. Structured collarless blazer dark. Movado Museum watch steel bracelet. No rings, no other jewelry, no logos visible.',
  imagelab_compliance_rules: null,
  imagelab_industry: null,
  imagelab_realism_level: 'photorealistic, editorial, high-end commercial photography standard',
  imagelab_film_look: 'Leica M11 aesthetic, Kodak Vision3 500T color science, slight cinematic grain',
  imagelab_lens_preset: '85mm f/1.4 equivalent, shallow depth of field',
  imagelab_depth_of_field: 'shallow — subject sharp, background architecturally soft',
  imagelab_framing: 'upper third centered, intentional negative space, editorial composition',
  imagelab_skin_detail: 'natural skin texture, visible pores, micro-asymmetry — real not retouched',
  imagelab_imperfections: 'very slight texture only — no blemishes, no distracting imperfections',
  imagelab_humidity_level: null, imagelab_sweat_level: null, imagelab_grain_level: 2,
  default_negative_prompt: 'smiling broadly, casual pose, sporty clothing, colorful wardrobe, visible logos, excess jewelry, stock photo expression, AI-generated skin smoothness, plastic perfection, warm color palette, vintage or period clothing, suit and tie, athletic or streetwear',
};

const GLOBAL_TIKTOK = {
  brand_id: null, canal: 'TIKTOK', preset_id: 'T0101',
  realism_level: 'cinematic', film_look: '35mm_film', lens_preset: '35mm_hero',
  depth_of_field: 'shallow', framing: 'rule_of_thirds', skin_detail: 'realistic',
  imperfections: null, humidity_level: null, sweat_level: null, grain_level: 1.5,
  lighting_style: null, color_grading: null, aspect_ratio: '9:16',
  negative_prompt: null, extra_params: null,
};

const PSY = { id: 'PSY-AUTHORITY', objective_tag: 'authority',
  injection_visual: 'Include a credential or concrete data point within the first 15 words. Didactic tone without condescension. Precise language, no exaggeration.' };

const CONCEPTO = 'El sistema que sobrevive a su creador — por qué la mayoría de los productos mueren con su fundador';
const FALLBACK_NEGATIVE_LIT = fb.match(/'([^']*)'/)[1];

// ── BUILDER VIEJO — reproducción exacta del código desplegado hoy (_A mergeado) ──
// Rama LEGACY (LucienSael no tiene preset de marca; el global NO se consultaba).
function builderViejo(brand, psycho, conceptText) {
  const brandName = brand?.display_name ?? brand?.id;
  const parts = [conceptText || `producto de ${brandName}`];
  if (brand?.imagelab_visual_identity)  parts.push(brand.imagelab_visual_identity);
  if (brand?.imagelab_industry)         parts.push(`industry context: ${brand.imagelab_industry}`);
  if (psycho?.injection_visual)         parts.push(psycho.injection_visual);
  if (brand?.imagelab_compliance_rules) parts.push(`Brand constraints: ${brand.imagelab_compliance_rules}`);
  parts.push('professional photography, high quality, 8k, sharp focus, commercial grade');
  return { prompt: parts.filter(Boolean).join(', '), negative: brand?.default_negative_prompt ?? FALLBACK_NEGATIVE_LIT };
}

// ── BUILDER NUEVO ────────────────────────────────────────────────────────────
function builderNuevo(brand, brandPreset, globalPreset, psycho, conceptText) {
  const spec = M.mergeVisualSpec(brand, brandPreset, globalPreset, psycho);
  return { prompt: M.composeVisualPrompt(spec, conceptText), negative: spec.negative, spec };
}

// ── SALIDA ───────────────────────────────────────────────────────────────────
const linea = (c = '─') => c.repeat(100);
function bloque(titulo, r) {
  console.log(`\n${linea('━')}\n${titulo}\n${linea('━')}`);
  console.log(`\nPROMPT (${r.prompt.length} chars):\n\n${r.prompt}`);
  console.log(`\nNEGATIVE (${r.negative.split(',').length} términos):\n\n${r.negative}`);
}

console.log(`\n${linea('═')}`);
console.log('PRUEBA COMPARATIVA #95-C — LucienSael · canal TIKTOK · estímulo PSY-AUTHORITY');
console.log(`${linea('═')}`);
console.log(`\nConcepto (simula el título+copy que manda content-run-stage):\n  "${CONCEPTO}"`);
console.log('\nContexto: LucienSael NO tiene preset de marca. Existe un preset GLOBAL para TIKTOK');
console.log('(preset_id T0101) que el builder viejo nunca consultaba.');

const viejo = builderViejo(LUCIEN, PSY, CONCEPTO);
const nuevo = builderNuevo(LUCIEN, null, GLOBAL_TIKTOK, PSY, CONCEPTO);

bloque('ANTES — builder desplegado hoy', viejo);
bloque('DESPUÉS — builder unificado (#95-C)', nuevo);

console.log(`\n${linea('━')}\nQUÉ CAMBIÓ\n${linea('━')}\n`);

const ejes = Object.keys(nuevo.spec.ejes);
console.log(`· Ejes técnicos de marca en el prompt:   ANTES 0   →   DESPUÉS ${ejes.length}`);
for (const e of ejes) console.log(`    ${e.padEnd(18)} ${String(nuevo.spec.ejes[e]).slice(0, 62)}`);
console.log(`\n· Preset consultado:                    ANTES ninguno   →   DESPUÉS ${nuevo.spec.preset_source} (${nuevo.spec.preset_id})`);
console.log(`· Identidad de marca:                   ANTES sí   →   DESPUÉS sí (sin cambio)`);
console.log(`· Estímulo psicológico:                 ANTES suelto, sin etiquetar   →   DESPUÉS "PSYCHO LAYER [${nuevo.spec.psycho_id}]"`);
console.log(`· Longitud del prompt:                  ANTES ${viejo.prompt.length}   →   DESPUÉS ${nuevo.prompt.length} chars`);
console.log(`· Términos en el negativo:              ANTES ${viejo.negative.split(',').length}   →   DESPUÉS ${nuevo.negative.split(',').length}`);

console.log(`\n${linea('━')}\nEL PUNTO QUE DECIDE\n${linea('━')}\n`);
console.log('El builder viejo mandaba la identidad de marca como texto suelto y NADA de los 8 ejes');
console.log('técnicos que LucienSael tiene declarados: la cámara, la óptica, la ciencia de color, el');
console.log('encuadre y el tratamiento de piel se perdían enteros. El generador recibía "retrato');
console.log('editorial de un hombre de 40" sin una sola instrucción de CÓMO fotografiarlo.\n');
console.log('Si en la imagen no se nota la diferencia entre "Leica M11 + Kodak Vision3 500T + 85mm');
console.log('f/1.4 + piel con poros visibles" y no decir nada de eso, entonces C no sirve.');

// ═══════════════════════════════════════════════════════════════════════════
// CASO DE RIESGO — UnrealvilleStudio / INSTAGRAM_FEED
// Es el ÚNICO caso que hoy produce algo con carácter de marca, y C lo cambia.
// Por eso el brief pide comparación: no basta con que mejore en LucienSael.
// ═══════════════════════════════════════════════════════════════════════════
const UNRLVL_PRESET = {
  brand_id: 'UnrealvilleStudio', canal: 'INSTAGRAM_FEED', preset_id: 'UNRLVL-FEED-TEASER',
  realism_level: 'photorealistic', film_look: 'large_format_cinema', lens_preset: 'ultra_sharp_prime',
  depth_of_field: 'extreme_center_soft_edges', framing: 'vertical_centered',
  skin_detail: null, imperfections: null, humidity_level: null, sweat_level: null, grain_level: 0,
  lighting_style: 'single_beam_surgical_gold',
  color_grading: 'ultra_dark_black_base_gold_accent_#FFAB00_luxury_editorial',
  aspect_ratio: '3:4', resolution: '8K',
  negative_prompt: 'people, faces, hands, body parts, nature, plants, organic shapes, neon lights, colorful, gradients, lens flares, bokeh, warm tones, stock photo aesthetic, text in image, watermarks',
  extra_params: {
    reference_aesthetic: 'Zaha Hadid architecture × Stanley Kubrick composition × Rolex dark campaign',
    composition_rule: 'Chevron void occupies 60% of frame, positioned 40% from left, emerging from bottom third. Apex bisected by single vertical light beam.',
    mood: ['controlled intensity', 'intelligence without explanation', 'forward momentum', 'not for everyone'],
    brand_dna: 'Not for everyone. Precision over noise. The > is not a logo — it is a direction. Forward. Always.',
    texture: 'zero texture on obsidian except the cut. Grid lines inside the void: ultra-fine, #FFAB00 at 15% opacity',
    forbidden_elements: ['people', 'faces', 'nature', 'organic shapes', 'circuit boards', 'robots', 'lens flares', 'neon', 'gradients'],
    // …y SIETE campos más que NINGÚN builder lee. Ver "HALLAZGO" abajo.
    visual_concept: '(no leído por ningún builder)', background: '(no leído)', accent_color: '#FFAB00',
    depth_layers: [], style_keywords: [], emotional_target: '(no leído)',
  },
};
// UnrealvilleStudio tiene las 14 columnas `imagelab_*` en NULL (verificado en DB).
const UNRLVL = { id: 'UnrealvilleStudio', display_name: 'Unrealville Studio', default_negative_prompt: null };

// Builder VIEJO para este caso = la rama PRESET (`buildPromptFromPreset`), reproducida exacta.
function builderViejoPreset(preset, conceptText) {
  const ep = preset.extra_params ?? {};
  const moodList = Array.isArray(ep.mood) ? ep.mood.join(', ') : (ep.mood ?? '');
  const forbidden = Array.isArray(ep.forbidden_elements) ? ep.forbidden_elements.join(', ') : (ep.forbidden_elements ?? '');
  const negative = [forbidden, preset.negative_prompt].filter(Boolean).join(', ') || FALLBACK_NEGATIVE_LIT;
  const p = [];
  if (ep.reference_aesthetic) p.push(`${ep.reference_aesthetic} aesthetic.`);
  if (ep.composition_rule)    p.push(`${ep.composition_rule}.`);
  if (preset.lighting_style)  p.push(`${preset.lighting_style}.`);
  if (preset.color_grading)   p.push(`${preset.color_grading}.`);
  if (moodList)               p.push(`Mood: ${moodList}.`);
  if (conceptText)            p.push(`Concept: ${conceptText}.`);
  if (ep.brand_dna)           p.push(`Brand DNA: ${ep.brand_dna}.`);
  if (ep.texture)             p.push(`${ep.texture}.`);
  p.push('Photorealistic, 8K, large format cinema.');
  p.push(`FORBIDDEN: ${negative}.`);
  return { prompt: p.join(' '), negative };
}

const CONCEPTO_U = 'Infraestructura de inteligencia de marca — el sistema que ya está operando';
console.log(`\n${linea('═')}`);
console.log('CASO DE RIESGO — UnrealvilleStudio · INSTAGRAM_FEED · el único que hoy sale bien');
console.log(`${linea('═')}`);

const uViejo = builderViejoPreset(UNRLVL_PRESET, CONCEPTO_U);
const uNuevo = builderNuevo(UNRLVL, UNRLVL_PRESET, null, null, CONCEPTO_U);

bloque('ANTES — rama preset del builder desplegado', uViejo);
bloque('DESPUÉS — builder unificado (#95-C)', uNuevo);

console.log(`\n${linea('━')}\nQUÉ CAMBIÓ EN EL CASO DE RIESGO\n${linea('━')}\n`);
const ejesU = Object.keys(uNuevo.spec.ejes);
console.log(`· Ejes técnicos del preset en el prompt:  ANTES 0 (se ignoraban)  →  DESPUÉS ${ejesU.length}`);
for (const e of ejesU) console.log(`    ${e.padEnd(18)} ${uNuevo.spec.ejes[e]}`);
console.log('\n· Todo lo que el viejo SÍ ponía (estética, composición, luz, grading, mood, brand DNA,');
console.log('  textura, forbidden) SE CONSERVA. C AÑADE, no reemplaza.');
console.log(`· Longitud:  ANTES ${uViejo.prompt.length}  →  DESPUÉS ${uNuevo.prompt.length} chars`);

const conservado = ['Zaha Hadid', 'Chevron void', 'single_beam_surgical_gold', 'Not for everyone', 'obsidian'];
const perdidos = conservado.filter((t) => uViejo.prompt.includes(t) && !uNuevo.prompt.includes(t));
console.log(`· Elementos del preset viejo PERDIDOS: ${perdidos.length === 0 ? 'ninguno ✔' : perdidos.join(', ') + ' ✘'}`);

console.log(`\n${linea('━')}\n🔎 HALLAZGO COLATERAL — fuera del alcance de C, para decidir aparte\n${linea('━')}\n`);
console.log('El `extra_params` de UNRLVL tiene SIETE campos más que NINGÚN builder lee, ni el viejo');
console.log('ni el nuevo:  visual_concept · background · accent_color · depth_layers · style_keywords');
console.log('· emotional_target · what_this_image_must_NOT_feel_like\n');
console.log('`visual_concept` es un párrafo entero describiendo el concepto visual de la pieza (el');
console.log('corte arquitectónico en obsidiana, la luz quirúrgica, la profundidad de grid). Es');
console.log('probablemente el campo MÁS rico del preset, y se está tirando.\n');
console.log('NO lo incorporé a C a propósito: C es UNIFICACIÓN (marca + preset + global), y leer');
console.log('campos nuevos es ENRIQUECIMIENTO — cambiaría el output de UNRLVL mucho más de lo que');
console.log('esta comparación permite juzgar. Es el mismo patrón de #95 (identidad declarada y no');
console.log('leída) una capa más adentro. Decisión de Sam, PR aparte.');
console.log(`\n${linea('═')}\n`);
