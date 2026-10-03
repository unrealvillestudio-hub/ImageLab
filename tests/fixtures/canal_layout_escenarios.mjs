// Escenarios de la franja de texto y el encuadre POR CANAL (2026-10-03).
//
// Marca INVENTADA de otro rubro y otro país: un taller de cerámica de barro negro en Oaxaca, México.
// Ninguna marca real del ecosistema aparece aquí.
//
// `GOLDEN_DBS` son bases SIN dato que active el cambio: o no hay fila de canal, o la fila es de otro
// canal, o está inactiva, o su `layout` no toca la franja ni el encuadre (la forma de las filas
// CAROUSEL de hoy). Su cuerpo hacia Vertex se congeló sobre `main` (35eccca) en
// `canal_layout_golden.json` y no puede moverse.

export const BRAND = 'TallerBarroNegro';

const PERSONA_A = {
  name: 'Rosalía Méndez',
  aliases: ['Rosa'],
  description: 'woman in her sixties, long grey braid, embroidered blouse, clay on her forearms',
  reference_image_urls: ['https://cdn.example.invalid/p/rosa_1.png', 'https://cdn.example.invalid/p/rosa_2.png', 'https://cdn.example.invalid/p/rosa_3.png'],
};
const PERSONA_B = {
  name: 'Emilio Vargas',
  aliases: ['Emilio'],
  description: 'man in his thirties, short black hair, canvas apron, rolled sleeves',
  reference_image_urls: ['https://cdn.example.invalid/p/emilio_1.png', 'https://cdn.example.invalid/p/emilio_2.png'],
};
const PRODUCT = {
  name: 'Cántaro bruñido',
  items: [{ name: 'Cántaro bruñido', image_url: 'https://cdn.example.invalid/x/cantaro.png', height_cm: 30, width_cm: 22 }],
};
export const PERSONAS = { PERSONA_A, PERSONA_B, PRODUCT };

/** Filtro mínimo de PostgREST (`eq.`, `is.null`, `is.true`, `select`, `limit`) sobre una lista de filas. */
export function postgrest(rows) {
  return (q) => {
    let out = rows.filter((r) => {
      for (const [k, v] of q.entries()) {
        if (k === 'select' || k === 'limit' || k === 'order') continue;
        if (v === 'is.null') { if (r[k] != null) return false; continue; }
        if (v === 'is.true') { if (r[k] !== true) return false; continue; }
        if (v.startsWith('eq.')) { if (String(r[k] ?? '') !== v.slice(3)) return false; continue; }
        throw new Error(`postgrest(): filtro no soportado ${k}=${v}`);
      }
      return true;
    });
    const lim = q.get('limit');
    if (lim) out = out.slice(0, Number(lim));
    const sel = q.get('select');
    if (sel && sel !== '*') out = out.map((r) => Object.fromEntries(sel.split(',').map((c) => [c, r[c]])));
    return out;
  };
}

const BASE = {
  brands: [{ id: BRAND, display_name: 'Taller Barro Negro', imagelab_visual_identity: 'earthy daylight, black burnished clay', imagelab_compliance_rules: null, imagelab_industry: 'handmade pottery', default_negative_prompt: 'plastic' }],
  imagelab_prompt_builder_versions: [{ version: '9.9', model_id: 'gemini-2.5-flash', instructions: 'BUILDER INSTRUCTIONS', max_output_tokens: 700 }],
};
const fila = (canal, tokens, extra = {}) => ({ id: `${BRAND}:${canal ?? '*'}`, brand_id: BRAND, canal, active: true, tokens, ...extra });
const MARCA_CON_FRANJA = fila(null, { layout: { anchor: 'bottom_left', text_zone_pct: 40, max_width_pct: 76 }, product: { mode: 'in_scene' } });
const MARCA_SIN_FRANJA = fila(null, { layout: { anchor: 'top_left', max_width_pct: 72 }, product: { mode: 'in_scene' } });
// La forma de las filas CAROUSEL de producción [medido 2026-10-03]: `layout` con scrim, anclaje y ancho,
// sin `text_zone_pct` ni `subject_framing`.
const inerte = (canal, anchor = 'bottom_left') => fila(canal, { _note: 'nota', layout: { scrim: { mode: 'gradient_bottom', opacity: 0.84, coverage_pct: 62 }, anchor, max_width_pct: 80 }, carousel: { x: 1 } });
const ACTIVA = (canal) => fila(canal, { layout: { text_zone_pct: 0, subject_framing: 'scene' } });

export const CANALES = ['BLOG_INLINE', 'BLOG_FEATURED', 'INSTAGRAM_FEED', null];

export const GOLDEN_DBS = {
  sin_filas: { ...BASE, imagelab_overlay_tokens: postgrest([]) },
  solo_marca: { ...BASE, imagelab_overlay_tokens: postgrest([MARCA_CON_FRANJA]) },
  fila_de_otro_canal: { ...BASE, imagelab_overlay_tokens: postgrest([MARCA_CON_FRANJA, ACTIVA('CAROUSEL')]) },
  fila_inactiva_del_canal: { ...BASE, imagelab_overlay_tokens: postgrest([MARCA_CON_FRANJA, ...['BLOG_INLINE', 'BLOG_FEATURED', 'INSTAGRAM_FEED'].map((c) => ({ ...ACTIVA(c), id: `off:${c}`, active: false }))]) },
  filas_inertes_del_canal: { ...BASE, imagelab_overlay_tokens: postgrest([MARCA_CON_FRANJA, inerte('BLOG_INLINE'), inerte('BLOG_FEATURED'), inerte('INSTAGRAM_FEED'), inerte('CAROUSEL')]) },
  marca_sin_franja_canal_con_otro_anclaje: { ...BASE, imagelab_overlay_tokens: postgrest([MARCA_SIN_FRANJA, inerte('BLOG_INLINE'), inerte('BLOG_FEATURED'), inerte('INSTAGRAM_FEED')]) },
};

/** Una base con la fila de marca con franja y las filas de canal que se pasen. */
export const dbCon = (...canalRows) => ({ ...BASE, imagelab_overlay_tokens: postgrest([MARCA_CON_FRANJA, ...canalRows]) });
export const dbMarca = (brandTokens, ...canalRows) => ({ ...BASE, imagelab_overlay_tokens: postgrest([fila(null, brandTokens), ...canalRows]) });
export { fila, ACTIVA, MARCA_CON_FRANJA };

const stage = { labId: 'imagelab', label: 'ImageLab', description: 'Generate brand visual', order: 3 };
export const req = (canal, params) => ({ brandId: BRAND, stage, params: { ...(canal ? { canal } : {}), subject: 'semilla del sujeto', ...params }, previousOutputs: {} });

/** Las formas de petición: síntesis con persona y producto, dos personas, sin persona, sin síntesis,
 *  edición y medición en seco. */
export const FORMAS = {
  copy_persona_producto: { copy_full: 'Rosalía Méndez bruñe el cántaro antes de la quema.', title: 'Bruñido', persona: PERSONA_A, product: PRODUCT },
  copy_dos_personas: { copy_full: 'Rosa y Emilio sacan las piezas del horno.', title: 'Horno', personas: [PERSONA_A, PERSONA_B] },
  copy_sin_persona: { copy_full: 'El barro se cuela dos veces antes de modelarlo.', title: 'Colado' },
  sin_copy: { title: 'El horno de leña', persona: PERSONA_A },
  editar: { copy_full: 'Rosa sonríe junto al horno.', title: 'Horno', persona: PERSONA_A, generation_mode: 'edit_from_current', source_image_url: 'https://cdn.example.invalid/actual.png' },
  prompt_only: { copy_full: 'Rosalía Méndez enseña a modelar un cántaro.', title: 'Taller', persona: PERSONA_A, prompt_only: true },
};
