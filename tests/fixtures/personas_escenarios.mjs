// Escenarios del motor de personas (2026-10-03). Marca INVENTADA de otro rubro y otro país
// (una ferretería de barrio en Valparaíso, Chile): ninguna marca real del ecosistema aparece aquí.
//
// `N1` son los escenarios de UNA persona (o ninguna): su cuerpo hacia Vertex se congeló sobre `main`
// (`personas_n1_golden.json`) y no puede moverse. `N2` son los de dos o más personas.

export const BRAND = 'FerreteriaPortuaria';

const PERSONA_A = {
  name: 'Teodora Quispe',
  aliases: ['Teodora'],
  description: 'woman in her fifties, short grey hair, round glasses, navy work apron',
  reference_image_urls: ['https://cdn.example.invalid/p/teo_1.png', 'https://cdn.example.invalid/p/teo_2.png', 'https://cdn.example.invalid/p/teo_3.png', 'https://cdn.example.invalid/p/teo_4.png'],
  expressions: [{ when: 'explaining a tool', face: 'focused, half smile' }],
  expression_avoid: ['open-mouth grin'],
  wardrobe: [{ when: 'in the shop', outfit: 'navy apron over a checked shirt' }],
};
const PERSONA_B = {
  name: 'Ignacio Huerta',
  aliases: ['Nacho'],
  description: 'man in his twenties, curly black hair, light beard, red hoodie',
  reference_image_urls: ['https://cdn.example.invalid/p/nacho_1.png', 'https://cdn.example.invalid/p/nacho_2.png'],
};
const PERSONA_C = {
  name: 'Marta Lillo',
  aliases: [],
  description: 'woman in her thirties, long braided hair, denim jacket',
  reference_image_urls: ['https://cdn.example.invalid/p/marta_1.png'],
};
const LOCATION = {
  name: 'Mostrador del puerto',
  description: 'a narrow hardware shop with wooden drawers to the ceiling and a long worn counter',
  reference_image_urls: ['https://cdn.example.invalid/l/mostrador_1.jpg', 'https://cdn.example.invalid/l/mostrador_2.jpg'],
};
const PRODUCT = {
  name: 'Kit de llaves',
  items: [
    { name: 'Llave inglesa 10"', image_url: 'https://cdn.example.invalid/x/llave.png', height_cm: 25, width_cm: 6 },
    { name: 'Alicate', image_url: 'https://cdn.example.invalid/x/alicate.png', height_cm: 18, width_cm: 5 },
  ],
};

export const DB = {
  brands: [{ id: BRAND, display_name: 'Ferretería Portuaria', imagelab_visual_identity: 'warm documentary light, worn wood', imagelab_compliance_rules: null, imagelab_industry: 'hardware retail', default_negative_prompt: 'cartoon' }],
  imagelab_overlay_tokens: [{ tokens: { layout: { text_zone_pct: 30, anchor: 'bottom_left' }, product: { mode: 'in_scene' } } }],
  imagelab_prompt_builder_versions: [{ version: '9.9', model_id: 'gemini-2.5-flash', instructions: 'BUILDER INSTRUCTIONS', max_output_tokens: 700 }],
};

const stage = { labId: 'imagelab', label: 'ImageLab', description: 'Generate brand visual', order: 3 };
const req = (params) => ({ brandId: BRAND, stage, params: { canal: 'INSTAGRAM_FEED', subject: 'semilla del sujeto', ...params }, previousOutputs: {} });

export const N1 = {
  sin_copy_persona_en_titulo: req({ title: 'Teodora explica el taladro', persona: PERSONA_A }),
  sin_copy_sin_persona: req({ title: 'El taladro', persona: null }),
  copy_persona_sola: req({ copy_full: 'Teodora Quispe muestra cómo elegir una broca.', title: 'Brocas', persona: PERSONA_A }),
  copy_persona_no_nombrada: req({ copy_full: 'Cómo elegir una broca.', title: 'Brocas', persona: PERSONA_A }),
  copy_persona_locacion: req({ copy_full: 'Teodora atiende en el Mostrador del puerto.', title: 'Atención', persona: PERSONA_A, location: LOCATION }),
  copy_persona_producto: req({ copy_full: 'Teodora recomienda el kit.', title: 'Kit', image_hook: 'El kit que dura', persona: PERSONA_A, product: PRODUCT }),
  copy_persona_locacion_producto: req({ copy_full: 'Teodora, en el Mostrador del puerto, con el kit.', title: 'Kit', persona: PERSONA_A, location: LOCATION, product: PRODUCT }),
  copy_locacion_sin_persona: req({ copy_full: 'El Mostrador del puerto abre temprano.', title: 'Horario', location: LOCATION }),
  editar_con_persona: req({ copy_full: 'Teodora sonríe.', title: 'Sonrisa', persona: PERSONA_A, generation_mode: 'edit_from_current', source_image_url: 'https://cdn.example.invalid/actual.png', visual_directives: ['más luz'] }),
  copy_dos_nombradas_pero_persona_legacy: req({ copy_full: 'Teodora y Nacho prueban la escalera.', title: 'Escalera', persona: PERSONA_A }),
  prompt_only_persona: req({ copy_full: 'Teodora Quispe muestra el nivel.', title: 'Nivel', persona: PERSONA_A, prompt_only: true }),
};

export const PERSONAS = { PERSONA_A, PERSONA_B, PERSONA_C, LOCATION, PRODUCT };
export { req };

// Modo `direct` (UI sync). `DIRECT_LEGACY` son peticiones SIN `slots`: su cuerpo hacia Vertex se congeló
// sobre `main` (`personas_direct_golden.json`) y no puede moverse.
const PX = 'data:image/png;base64,' + Buffer.from('IMG:pixel').toString('base64');
export const DIRECT_LEGACY = {
  solo_texto: { mode: 'direct', prompt: 'una ferretería al amanecer', aspectRatio: '16:9' },
  sujeto_y_referencias: { mode: 'direct', prompt: 'retrato en el mostrador', sourceAssetDataUrl: PX, sourceAssetLabel: 'Teodora',
    referenceImages: [{ dataUrl: PX, label: 'Fondo: mostrador' }, { dataUrl: PX, label: 'style reference warm' }] },
};
export { PX };
