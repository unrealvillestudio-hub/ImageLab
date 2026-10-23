// 1.13.1 — LA CARA MANDA. Casos reales del 2026-10-22, con las cajas MEDIDAS A MANO sobre la foto limpia de cada pieza
// (rejilla al 5 %, 0..1 del lienzo). Las fotos limpias son las de `assets.image.clean_url`; las compuestas con 1.13.0 y
// `avoid_people` encendido son las de la tira `m1..m8` (cara centrada, de cintura arriba) y `n1..n3` (figura de pie a un
// lado). Los tokens, la tipografía y la paleta son los de producción ese día (SELECT sobre `imagelab_overlay_tokens`,
// `brand_typography` y `brand_palette`), sin `_note` ni `_previous`. Esto es DATO de prueba: el código del compositor no
// nombra marcas; aquí sí, porque son las piezas medidas.
//
// Cada caso: `id` (pieza), `tira` (su nombre en la tira), `brand`, `w`/`h`, el texto que llegó al compositor, y las cajas:
//   face   — frente a mentón, oreja a oreja (sin el pelo suelto).
//   person — la figura visible entera: pelo, hombros, brazos y lo que sostiene, hasta el borde del cuadro.
//   products — envases protagonistas.

// La capa global tal como quedó tras revertir 20261022150000 (md5 2c616e1f…): sin `avoid_people`.
export const GLOBAL_HOY = {
  layout: {
    avoid_faces: { enabled: true, margin_pct: 2 },
    text_effect: { kind: 'shadow', when: 'low_contrast', alpha: 0.4, color: '#000000', blur_pct: 0.7, offset_pct: 0.15, min_contrast: 4.5 },
    avoid_products: { enabled: true, margin_pct: 1 },
    avoid_scene_text: { enabled: true, blur_pct: 0.5, margin_pct: 1 },
    max_text_area_pct: 20,
  },
  carousel: {
    avoid_faces: { enabled: true, fallback: ['inset'], column_pct: [60, 50], margin_pct: 2, inset_min_pct: 25, inset_alternate: true },
    avoid_products: { enabled: true, margin_pct: 1 },
  },
};

// La forma 1.13.1 de `avoid_people` (la que escribe 20261022180000): sin `fallback` ni `band`.
export const AVOID_PEOPLE_1131 = {
  layout: { enabled: true, margin_pct: 1, min_width_pct: 28 },
  carousel: { enabled: true, margin_pct: 1, min_width_pct: 30 },
};
// La forma 1.13.0 (la de 20261022150000, ya revertida): con la banda.
export const AVOID_PEOPLE_1130_LAYOUT = { enabled: true, margin_pct: 1, min_width_pct: 28, fallback: 'band', band: { color: '#000000', alpha: 0.55, pad_pct: 2 } };

export const globalCon = (layoutPeople = AVOID_PEOPLE_1131.layout, carouselPeople = AVOID_PEOPLE_1131.carousel) => ({
  ...GLOBAL_HOY,
  layout: { ...GLOBAL_HOY.layout, avoid_people: layoutPeople },
  carousel: { ...GLOBAL_HOY.carousel, avoid_people: carouselPeople },
});

export const BRANDS = {
  NeuroneSCF: {
    tokens: {
      layout: {
        rule: { enabled: true, gap_pct: 2.2, palette: 'accent_warm', width_pct: 12, thickness_px: 4 },
        align: 'left',
        scrim: { mode: 'gradient_bottom', opacity: 0.84, palette: 'primary', coverage_pct: 60 },
        anchor: 'bottom_left', gap_pct: 2.2, margin_pct: 7,
        text_effect: { kind: 'shadow', when: 'always', alpha: 0.4, color: 'primary', blur_pct: 0.7, offset_pct: 0.15 },
        max_width_pct: 76, text_zone_pct: 40,
        emphasis_contrast: { fallbacks: ['accent_warm', 'editorial', 'accent_3'], min_contrast: 3, min_contrast_vs_text: 1.8 },
      },
      palette: { headline: 'neutral', subheadline: 'neutral', headline_emphasis: 'accent_glow' },
      persons: { max_per_image: 2 },
      product: { mode: 'in_scene', anchor: 'top_right', max_items: 3, height_pct: 34, margin_pct: 6, overlap_pct: 18 },
      identity: { mode: 'edge_left', palette: 'accent_warm', width_pct: 1.8, full_bleed: true },
      typography: {
        headline: { role: 'headline', weight: 400, emphasis: { weight: 700, transform: 'uppercase', size_scale: 1.2 },
          fit_steps: [{ size_pct: 8.6, max_chars: 42 }, { size_pct: 6.7, max_chars: 72 }, { size_pct: 5.3, max_chars: 110 }],
          transform: 'none', line_height: 1.05, letter_spacing_em: -0.005 },
        subheadline: { role: 'body', weight: 400, fit_steps: [{ size_pct: 3.1, max_chars: 90 }, { size_pct: 2.5, max_chars: 160 }],
          transform: 'none', line_height: 1.32, letter_spacing_em: 0 },
      },
    },
    typography: [
      { role: 'headline', font_family: 'PT Sans Narrow', css_import: 'https://fonts.googleapis.com/css2?family=PT+Sans+Narrow:wght@400;700&display=swap', fallback: 'Arial Narrow, sans-serif' },
      { role: 'body', font_family: 'Montserrat', css_import: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600&display=swap', fallback: 'Helvetica Neue, sans-serif' },
    ],
    palette: [
      { role: 'primary', hex: '#000000' }, { role: 'accent', hex: '#0076A8' }, { role: 'pro', hex: '#003A70' },
      { role: 'editorial', hex: '#C27D5B' }, { role: 'neutral', hex: '#FAFAFA' }, { role: 'accent_warm', hex: '#C4622D' },
      { role: 'accent_3', hex: '#7CC6A4' }, { role: 'accent_glow', hex: '#0095D4' }, { role: 'bg_deep', hex: '#0A0D14' },
      { role: 'surface_1', hex: '#111520' }, { role: 'surface_2', hex: '#161C2A' },
    ],
  },
  LucienSael: {
    tokens: {
      layout: {
        rule: { enabled: true, gap_pct: 2.2, palette: 'ember', width_pct: 12, thickness_px: 4 },
        align: 'left',
        scrim: { mode: 'gradient_bottom', opacity: 0.85, palette: 'obsidian', coverage_pct: 58 },
        anchor: 'bottom_left', gap_pct: 2.2, margin_pct: 8, max_width_pct: 74,
      },
      palette: { headline: 'bone', subheadline: 'parchment', headline_emphasis: 'ember' },
      identity: { mode: 'edge_left', palette: 'ember', width_pct: 1.8, full_bleed: true },
      typography: {
        headline: { role: 'display', weight: 300, emphasis: { weight: 600, size_scale: 1.2 },
          fit_steps: [{ size_pct: 8.8, max_chars: 42 }, { size_pct: 6.8, max_chars: 72 }, { size_pct: 5.4, max_chars: 110 }],
          transform: 'none', line_height: 1.04, letter_spacing_em: 0 },
        subheadline: { role: 'body', weight: 400, fit_steps: [{ size_pct: 3, max_chars: 90 }, { size_pct: 2.5, max_chars: 160 }],
          transform: 'none', line_height: 1.3, letter_spacing_em: 0 },
      },
    },
    typography: [
      { role: 'display', font_family: 'Cormorant Garamond', css_import: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,600;1,300;1,600&display=swap', fallback: null },
      { role: 'body', font_family: 'Crimson Pro', css_import: 'https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;500&display=swap', fallback: null },
    ],
    palette: [
      { role: 'obsidian', hex: '#0D0D0B' }, { role: 'carbon', hex: '#1C1C1A' }, { role: 'bone', hex: '#EDE8DF' },
      { role: 'parchment', hex: '#C4BDB0' }, { role: 'ember', hex: '#D4622A' },
    ],
  },
};

// Persona centrada, de cintura arriba, que ocupa casi todo el alto: la regresión de 1.13.0 (banda en 7 de 8).
export const CENTRADA = [
  { id: '06a5180c', tira: 'm1', brand: 'NeuroneSCF', w: 768, h: 1344,
    text: { headline: 'Tu keratina se va por el drenaje en cada lavado. Eso ya lo sabes.', subheadline: 'Lo que no sabías es por qué el mercado nunca reparó eso — solo lo cubrió.', emphasis: ['por el drenaje'] },
    face: { x0: 0.42, y0: 0.12, x1: 0.62, y1: 0.27 }, person: { x0: 0.17, y0: 0.08, x1: 0.91, y1: 0.61 }, products: [{ x0: 0.66, y0: 0.34, x1: 0.86, y1: 0.57 }] },
  { id: '0cd8f005', tira: 'm2', brand: 'NeuroneSCF', w: 768, h: 1344,
    text: { headline: 'Cada mañana le pides al mismo acondicionador que arregle lo que no puede arreglar.', subheadline: null, emphasis: ['no puede arreglar'] },
    face: { x0: 0.29, y0: 0.26, x1: 0.52, y1: 0.43 }, person: { x0: 0.07, y0: 0.23, x1: 0.71, y1: 0.88 }, products: [{ x0: 0.80, y0: 0.55, x1: 0.95, y1: 0.78 }] },
  { id: '2383b96f', tira: 'm3', brand: 'NeuroneSCF', w: 1024, h: 1024,
    text: { headline: '"¿Qué te hiciste? Tu pelo no se mueve ni con este clima."', subheadline: null, emphasis: ['no se mueve'] },
    face: { x0: 0.27, y0: 0.25, x1: 0.42, y1: 0.46 }, person: { x0: 0.11, y0: 0.18, x1: 0.60, y1: 1 }, products: [{ x0: 0.71, y0: 0.44, x1: 0.97, y1: 0.68 }] },
  { id: '7085ece4', tira: 'm4', brand: 'NeuroneSCF', w: 1024, h: 1024,
    text: { headline: 'Cada tres semanas repites el mismo ritual con el mismo tono rubio.', subheadline: null, emphasis: ['mismo tono rubio'] },
    face: { x0: 0.32, y0: 0.19, x1: 0.49, y1: 0.42 }, person: { x0: 0.11, y0: 0.11, x1: 0.80, y1: 1 }, products: [{ x0: 0.65, y0: 0.38, x1: 0.81, y1: 0.65 }] },
  { id: 'b24cdc5f', tira: 'm5', brand: 'NeuroneSCF', w: 1024, h: 1024,
    text: { headline: 'Dejaste de usar proteína porque alguien te dijo que tu cabello ya tenía "demasiada"', subheadline: null, emphasis: ['demasiada'] },
    face: { x0: 0.37, y0: 0.19, x1: 0.52, y1: 0.45 }, person: { x0: 0.10, y0: 0.09, x1: 0.59, y1: 1 }, products: [{ x0: 0.59, y0: 0.59, x1: 0.97, y1: 0.95 }] },
  { id: 'da5bafa1', tira: 'm6', brand: 'NeuroneSCF', w: 1024, h: 1024,
    text: { headline: 'Cada mañana te hidratas el cabello. Cada tarde vuelve el frizz.', subheadline: null, emphasis: ['vuelve el frizz'] },
    face: { x0: 0.37, y0: 0.22, x1: 0.53, y1: 0.44 }, person: { x0: 0.20, y0: 0.18, x1: 0.73, y1: 1 }, products: [{ x0: 0.79, y0: 0.42, x1: 0.90, y1: 0.70 }] },
  { id: 'f0955319', tira: 'm7', brand: 'NeuroneSCF', w: 1024, h: 1024,
    text: { headline: '75 minutos de blowout. Menos de 5 en el estacionamiento.', subheadline: 'No fue el estilista. Fue el aire.', emphasis: ['75 minutos', 'Menos de 5'] },
    face: { x0: 0.33, y0: 0.17, x1: 0.47, y1: 0.35 }, person: { x0: 0.18, y0: 0.13, x1: 0.75, y1: 0.93 }, products: [{ x0: 0.65, y0: 0.68, x1: 0.93, y1: 0.94 }] },
  { id: 'fe9847d5', tira: 'm8', brand: 'NeuroneSCF', w: 1024, h: 1024,
    text: { headline: '"¿Qué te hiciste? Se te ve el cabello distinto."', subheadline: null, emphasis: ['distinto'] },
    face: { x0: 0.29, y0: 0.24, x1: 0.46, y1: 0.47 }, person: { x0: 0.08, y0: 0.17, x1: 0.61, y1: 1 }, products: [{ x0: 0.67, y0: 0.50, x1: 0.97, y1: 0.79 }] },
];

// Figura de pie a un lado (la marca de autor): 1.13.0 la resolvió bien y 1.13.1 no debe tocarla.
export const DE_PIE = [
  { id: '733c033a', tira: 'n1', brand: 'LucienSael', w: 1024, h: 1024,
    text: { headline: "Her was fiction. The lawsuit wasn't.", subheadline: null, emphasis: ['lawsuit'] },
    face: { x0: 0.575, y0: 0.11, x1: 0.71, y1: 0.24 }, person: { x0: 0.555, y0: 0.04, x1: 0.825, y1: 1 }, products: [{ x0: 0, y0: 0.45, x1: 0.045, y1: 0.59 }] },
  { id: 'b95fd1c9', tira: 'n2', brand: 'LucienSael', w: 1024, h: 1024,
    text: { headline: 'Twenty paid days off. The diagnosis needs twelve months.', subheadline: null, emphasis: ['Twenty paid days', 'twelve months'] },
    face: { x0: 0.58, y0: 0.08, x1: 0.65, y1: 0.19 }, person: { x0: 0.52, y0: 0.055, x1: 0.79, y1: 0.945 }, products: [] },
  { id: 'd9e97f57', tira: 'n3', brand: 'LucienSael', w: 1024, h: 1024,
    text: { headline: 'She told it the plan. It told her she was right.', subheadline: null, emphasis: ['she was right'] },
    face: { x0: 0.49, y0: 0.06, x1: 0.59, y1: 0.20 }, person: { x0: 0.395, y0: 0.055, x1: 0.715, y1: 1 }, products: [] },
];

export const CASOS = [...CENTRADA, ...DE_PIE];
