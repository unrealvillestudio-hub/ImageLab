// Escenarios del PROMPT DEL FALLO (2026-10-05).
//
// Dos usos:
//   1. `ESCENARIOS_EXITO`: peticiones que TERMINAN BIEN. Su respuesta se congeló byte a byte sobre
//      `main` (ca19c85) en `respuesta_exito_golden.json`, antes del cambio, y no puede moverse.
//   2. `fallo(...)`: la misma forma de petición, con un proveedor simulado que contesta 2xx SIN imagen
//      (`promptFeedback.blockReason = SAFETY`), o con un rechazo HTTP.
//
// Marca INVENTADA de otro rubro y otro país (un taller de cerámica de Oaxaca, México), reutilizada de
// `canal_layout_escenarios.mjs`. Los lienzos de la ronda medida el 2026-10-05 (LINKEDIN_FEED y
// FACEBOOK_FEED) entran como DATO de la petición, no como rama del código.

import { BRAND, PERSONAS, GOLDEN_DBS, FORMAS, req, postgrest } from './canal_layout_escenarios.mjs';

export { BRAND, PERSONAS };

/** Un estímulo psicológico inventado: el id y su inyección son dato de la fila. */
export const PSYCHO = { id: 'PSY-PRUEBA-CONTRASTE', injection_visual: 'strong light-dark contrast between the two halves of the frame', active: true };

/** Base sin preset de marca ni global (el caso medido: `preset=none`), con el estímulo sembrado. */
export const DB_SIN_PRESET = { ...GOLDEN_DBS.sin_filas, psycho_presets: postgrest([PSYCHO]) };

/** Base con preset de marca para el lienzo pedido (para el modo direct con `brand_id` + `canal`). */
export const presetDe = (canal) => ({
  preset_id: `preset-${canal.toLowerCase()}`, brand_id: BRAND, canal,
  lighting_style: 'soft window light', color_grading: 'warm earth tones', negative_prompt: 'neon',
  aspect_ratio: '4:5', extra_params: { reference_aesthetic: 'documentary', mood: ['calm'], forbidden_elements: ['plastic'] },
});
export const DB_CON_PRESET = (canal) => ({ ...DB_SIN_PRESET, imagelab_presets: postgrest([presetDe(canal)]) });

const LIENZOS = ['LINKEDIN_FEED', 'FACEBOOK_FEED'];
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Las peticiones que terminan bien: carril (con y sin estímulo, cada forma) y modo direct. */
export const ESCENARIOS_EXITO = [
  ...LIENZOS.flatMap((canal) => Object.entries(FORMAS).map(([forma, params]) => ({
    nombre: `carril|${canal}|${forma}|psycho`,
    body: req(canal, { ...params, psycho_preset: PSYCHO.id }),
    db: DB_SIN_PRESET,
  }))),
  ...LIENZOS.map((canal) => ({ nombre: `carril|${canal}|sin_copy|sin_psycho`, body: req(canal, FORMAS.sin_copy), db: GOLDEN_DBS.sin_filas })),
  { nombre: 'direct|solo_texto', body: { mode: 'direct', prompt: 'a black clay jar on a wooden table' }, db: {} },
  { nombre: 'direct|con_preset', body: { mode: 'direct', prompt: 'a black clay jar', brand_id: BRAND, canal: 'linkedin_feed' }, db: DB_CON_PRESET('LINKEDIN_FEED') },
  { nombre: 'direct|referencias', body: { mode: 'direct', prompt: 'the potter at work', sourceAssetDataUrl: PNG_1PX, sourceAssetLabel: 'potter', referenceImages: [{ dataUrl: PNG_1PX, label: 'style reference' }] }, db: {} },
  { nombre: 'direct|espacios', body: { mode: 'direct', prompt: 'two potters by the kiln', slots: { subjects: [{ dataUrl: PNG_1PX, label: 'Rosa' }, { dataUrl: PNG_1PX, label: 'Emilio' }], style: [{ dataUrl: PNG_1PX }] } }, db: {} },
];

/** Respuesta 2xx de Vertex SIN imagen: el bloqueo de seguridad medido el 2026-10-05. */
export const BLOQUEO_SAFETY = {
  promptFeedback: { blockReason: 'SAFETY' },
  usageMetadata: { promptTokenCount: 812, totalTokenCount: 812 },
};
/** Respuesta 2xx con candidato pero sin imagen, cerrado por motivo de seguridad de imagen. */
export const SIN_IMAGEN_FINISH = {
  candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }],
  usageMetadata: { promptTokenCount: 790, totalTokenCount: 790 },
};
