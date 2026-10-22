// Escenarios del lugar EXACTO (2026-10-22): el cuerpo hacia Vertex se congeló sobre `main` (f8daae9) en
// `lugar_exacto_golden.json` y no puede moverse. Misma marca inventada que `personas_escenarios.mjs`.
import { PERSONAS, req } from './personas_escenarios.mjs';

const { PERSONA_A, PERSONA_B, PRODUCT } = PERSONAS;
const CERRO = {
  name: 'Cerro del puerto',
  description: 'steep hills of painted wooden houses with corrugated-iron roofs, funicular lifts, narrow stairways, the bay and cranes below, sea fog in the morning',
  reference_image_urls: ['https://cdn.example.invalid/l/cerro_1.jpg', 'https://cdn.example.invalid/l/cerro_2.jpg'],
};

export const EXACTOS = {
  sin_modo_una_persona: req({ copy_full: 'Teodora sube al Cerro del puerto.', title: 'Cerro', persona: PERSONA_A, location: CERRO }),
  modo_exacto_declarado: req({ copy_full: 'Teodora sube al Cerro del puerto.', title: 'Cerro', persona: PERSONA_A, location: { ...CERRO, mode: 'exact' } }),
  modo_desconocido: req({ copy_full: 'Teodora sube al Cerro del puerto.', title: 'Cerro', persona: PERSONA_A, location: { ...CERRO, mode: 'EVOKE', avoid: ['x'] } }),
  sin_modo_con_producto: req({ copy_full: 'Teodora, en el Cerro del puerto, con el kit.', title: 'Kit', persona: PERSONA_A, location: CERRO, product: PRODUCT }),
  sin_modo_dos_personas: req({ copy_full: 'Teodora y Nacho en el Cerro del puerto.', title: 'Dos', personas: [PERSONA_A, PERSONA_B], location: CERRO }),
  sin_modo_editando: req({ copy_full: 'Teodora en el cerro.', title: 'Cerro', persona: PERSONA_A, location: CERRO, generation_mode: 'edit_from_current', source_image_url: 'https://cdn.example.invalid/actual.png', visual_directives: ['más luz'] }),
};
