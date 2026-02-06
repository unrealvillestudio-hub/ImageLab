
export interface ProductImage {
  id: string;
  url: string;
  base64: string;
  mimeType: string;
}

// ---- Pack generation types (multi-brand) ----
export type BrandId = string;

export interface BrandProfile {
  id: BrandId;
  displayName: string;
  industry: string;
  requiresProductLock: boolean;
  visualIdentity: string;
  complianceRules: string;
}

// ---- UI_ONLY_v2 integration: Pack Request schema (copy/paste JSON) ----
// NOTE: Field names follow the JSON contract we generate from Google Sheets.
export interface PackRequestBrandProfileV1 {
  industry: string;
  requires_product_lock: boolean;
  visual_identity: string;
  compliance_rules: string;
}

export interface PackRequestControlsV1 {
  realism_level: RealismLevel;
  skin_detail: DetailLevel;
  imperfections: ImperfectionsLevel;
  humidity_level: 0 | 1 | 2 | 3;
  sweat_level: 0 | 1 | 2 | 3;
  film_look: FilmLook;
  grain_level: 0 | 1 | 2 | 3;
  lens_preset: LensPreset;
  depth_of_field: DepthOfField;
  framing: Framing;
}

export interface PackRequestV1 {
  schema_version: 1;
  brand_id: string;
  pack_type: PackType;
  brand_profile: PackRequestBrandProfileV1;
  controls: PackRequestControlsV1;
  // Optional notes appended to all assets
  global_notes?: string;
  // Optional per-asset override text (key = asset_id like hero_01)
  shot_overrides?: Record<string, string>;
}

export type PackType = "landing_v1" | "web_future" | "ads_future" | "blog_future";

export type LensPreset = "24mm_wide" | "35mm_hero" | "50mm_lifestyle" | "85mm_portrait" | "90mm_macro";
export type FilmLook = "digital_clean" | "35mm_film" | "cinematic_soft";
export type RealismLevel = "editorial_clean" | "cinematic" | "documentary";
export type DetailLevel = "subtle" | "realistic" | "high_microdetail";
export type ImperfectionsLevel = "none" | "subtle" | "realistic";
export type DepthOfField = "deep" | "medium" | "shallow";
export type Framing = "centered" | "rule_of_thirds" | "negative_space_left" | "negative_space_right";

export interface PackControls {
  realismLevel: RealismLevel;
  skinDetail: DetailLevel;
  imperfections: ImperfectionsLevel;
  humidityLevel: 0 | 1 | 2 | 3;
  sweatLevel: 0 | 1 | 2 | 3;
  filmLook: FilmLook;
  grainLevel: 0 | 1 | 2 | 3;
  lensPreset: LensPreset;
  depthOfField: DepthOfField;
  framing: Framing;
}

export interface AssetSpec {
  assetId: string;
  assetType: string;
  // Desired output dimensions for the final file we export
  width: number;
  height: number;
  // The model's generation ratio (limited set). We may crop after.
  genAspectRatio: AspectRatio;
  // Shot instructions for this asset (brand-agnostic, brand prompt adds identity)
  shotDescription: string;
  negativePrompt?: string;
  // Optional crop output to exact ratio/dimensions (e.g., 1920x600 banner)
  cropTo?: { width: number; height: number };
}

export interface PackSpec {
  packType: PackType;
  assets: AssetSpec[];
}

export interface GeneratedAsset {
  assetId: string;
  assetType: string;
  url: string; // data URL
  filename: string;
  width: number;
  height: number;
}

export interface GenerationHistory {
  id: string;
  originalImageId: string;
  resultUrl: string;
  prompt: string;
  timestamp: number;
  aspectRatio: string;
}

export enum AspectRatio {
  SQUARE = "1:1",
  WEB_CLASSIC = "4:3",
  WIDE = "16:9",
  STORY = "9:16",
  PORTRAIT = "3:4"
}

export const ASPECT_RATIO_LABELS: Record<AspectRatio, string> = {
  [AspectRatio.SQUARE]: "Instagram (1:1)",
  [AspectRatio.WEB_CLASSIC]: "Web Classic (4:3)",
  [AspectRatio.WIDE]: "Landscape (16:9)",
  [AspectRatio.STORY]: "Story/TikTok (9:16)",
  [AspectRatio.PORTRAIT]: "Portrait (3:4)"
};

export const PROMPT_CATEGORIES = {
  escenario: {
    label: "Escenario / Product Shot",
    options: [
      "Encimera de baño lujoso (mármol claro, bokeh, toalla blanca)",
      "Tocador 'beauty corner' minimal (espejo redondo, bandeja)",
      "Spa premium (piedra, vapor suave, plantas)",
      "Estantería de baño 'clean' (azulejo blanco, orden)",
      "Mesita de noche (rutina nocturna, lánpara cálida)",
      "Lavabo con gotitas (post-ducha, humedad realista)",
      "Mesa de madera natural + hojas (botánico)",
      "Clínica dermo-estética (blanco, acero, pulcro)",
      "Gimnasio boutique / vestuario (post-entreno, estética fitness)",
      "Before/After ritual (producto + peine + scrunchie, sin exceso)"
    ]
  },
  ambiente: {
    label: "Ambiente",
    options: [
      "Minimal blanco",
      "Natural botánico (verdes, madera)",
      "Premium oscuro (negro/verde profundo)",
      "Mediterráneo luminoso (beige, piedra)",
      "Escandinavo (madera clara, gris suave)",
      "Editorial de revista (props controlados)",
      "Clínico/dermocosmético (medical clean)",
      "Vintage elegante (latón, espejo clásico)",
      "Urbano moderno (cemento, vidrio)",
      "Home spa cálido (velas, textiles)"
    ]
  },
  estiloEstudio: {
    label: "Estilo de Estudio",
    options: [
      "High-key e-commerce (blanco puro)",
      "Low-key dramático (fondo negro, rim light)",
      "Gradient backdrop (degradado verde/crema)",
      "Flat lay editorial (cenital con props mínimos)",
      "Table-top premium (superficie mármol/piedra)",
      "Reflective premium (acrílico negro con reflejo)",
      "Color block (fondo sólido verde marca)",
      "Softbox beauty (luz grande + sombras suaves)",
      "Catalog + shadow (sombra definida pero limpia)",
      "Macro label (detalle etiqueta con micro-contraste)"
    ]
  },
  encuadre: {
    label: "Encuadre de Cámara",
    options: [
      "Plano general (producto contextual)",
      "Plano medio (producto protagonista + entorno)",
      "Primer plano (botella dominante)",
      "Plano detalle (etiqueta/boquilla)",
      "Macro extremo (textura, gota)",
      "Cenital (flat lay)",
      "3/4 clásico (hero e-commerce)",
      "Plano contrapicado leve (más hero)",
      "Plano a ras de superficie (cinematográfico)",
      "Plano con negative space para copy/CTA"
    ]
  },
  perspectiva: {
    label: "Perspectiva",
    options: [
      "Eye-level neutra",
      "Leve picado (comercial)",
      "Leve contrapicado (poder)",
      "3/4 frontal (estándar)",
      "3/4 lateral (volumen)",
      "Perfil lateral (forma)",
      "Detrás-lateral (para mostrar etiqueta trasera)",
      "Perspectiva diagonal (dinámica)",
      "Top-down (cenital)",
      "Perspectiva close + wide (producto grande, fondo amplio)"
    ]
  },
  enfoque: {
    label: "Opciones de Enfoque",
    options: [
      "Enfoque en etiqueta (nitidez máxima)",
      "Enfoque en logo D7 (micro-nitidez)",
      "Enfoque en boquilla/atomizador",
      "Enfoque en gota/rociado (si aplica)",
      "Enfoque en borde del envase (reflejos)",
      "Enfoque en producto + bokeh fuerte fondo",
      "Enfoque deep (todo nítido estilo catálogo)",
      "Enfoque selectivo (solo tercio superior)",
      "Enfoque en manos (producto secundario)",
      "Enfoque en cuero cabelludo (producto en segundo plano)"
    ]
  },
  iluminacionInterior: {
    label: "Iluminación Interior",
    options: [
      "Softbox frontal grande (suave)",
      "Key lateral + fill suave (volumen)",
      "Rembrandt suave (premium)",
      "Top light difuso (limpio)",
      "Rim light posterior (contorno)",
      "Beauty dish (estética beauty)",
      "Luz ventana simulada (natural)",
      "Luz tungsteno cálida (rutina noche)",
      "Luz fría clínica (dermo)",
      "Luz mixta controlada (key neutra + acento cálido)"
    ]
  },
  iluminacionExterior: {
    label: "Iluminación Exterior",
    options: [
      "Golden hour (cálida, suave)",
      "Sombra abierta (natural uniforme)",
      "Día nublado (difusa perfecta)",
      "Contraluz suave (halo)",
      "Sol filtrado por hojas (dappled light)",
      "Amanecer frío (azulado)",
      "Atardecer con bokeh urbano",
      "Luz lateral fuerte + reflect (drama controlado)",
      "Backyard spa (luz natural + vapor)",
      "Exterior clínica (fachada moderna, luz neutra)"
    ]
  },
  personajes: {
    label: "Personajes (Arquetipos)",
    options: [
      "Mujer 35–45 profesional (estrés/ritmo alto)",
      "Mujer 46–55 perimenopausia (cambio hormonal)",
      "Mujer 55–60 menopausia (afinidad recuperar densidad)",
      "Mujer postparto (caída estacional/postparto)",
      "Mujer deportista (coleta, lavado frecuente)",
      "Mujer con cabello teñido (fragilidad)",
      "Mujer cabello rizado (cuidado específico)",
      "Estilista profesional (autoridad)",
      "Dermatóloga/tricóloga (credibilidad)",
      "Everyday mom (rutina realista)"
    ]
  },
  combinaciones: {
    label: "Combinaciones de Escena",
    options: [
      "Mujer 50–60 + estilista (consulta/recomendación)",
      "Mujer 35–45 + amiga (recomendación social)",
      "Mujer postparto + pareja (apoyo, rutina)",
      "Mujer 46–55 + dermatóloga (credibilidad clínica)",
      "Mujer 55–60 + hija adulta (transmisión/confianza)",
      "Mujer deportista + entrenadora (rutina post-entreno)",
      "Mujer cabello teñido + colorista (salón)",
      "Mujer rizada + estilista rizados (especialista)",
      "Mujer 35–45 + self-care buddy (spa en casa)",
      "Dermatólogo/a + paciente (evaluación + plan)"
    ]
  }
};
