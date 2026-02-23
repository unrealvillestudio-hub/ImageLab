export interface PersonBlueprint {
  id: string;
  brandId: string;
  displayName: string;
  role_default: "HOST" | "GUEST" | "BOTH";
  status: "active" | "draft";
  imagelab: {
    description: string;
    style: string;
    realism_level: string;
    skin_detail: string;
    film_look: string;
    lens_preset: string;
    depth_of_field: string;
    avatar_preset?: string;
    has_reference_photos: boolean;
    reference_photos_path: string;
  };
  voicelab: {
    voice_id: string;
    language: string;
    emotion_base: string;
    speed: number;
    script_style: string;
    speaking_style: string;
  };
  expertise: string;
  compliance_notes?: string;
  compatible_archetypes: string[];
}

export const PERSON_BLUEPRINTS: PersonBlueprint[] = [
  {
    id: "po_patricia",
    brandId: "PatriciaOsorio",
    displayName: "Patricia Osorio",
    role_default: "BOTH",
    status: "active",
    imagelab: {
      description: "Mujer latina profesional, 35-45 años, cabello rubio/castaño impecablemente trabajado, estilo Miami premium. Presencia de autoridad cálida. Siempre imagen de estilista de alto nivel.",
      style: "editorial_clean, Miami daylight, warm tones, beauty professional",
      realism_level: "editorial_clean",
      skin_detail: "realistic",
      film_look: "digital_clean",
      lens_preset: "50mm_lifestyle",
      depth_of_field: "shallow",
      has_reference_photos: false,
      reference_photos_path: "Reference_Assets/Patricia_Osorio/"
    },
    voicelab: {
      voice_id: "TBD_po_patricia",
      language: "es-FL",
      emotion_base: "energetic",
      speed: 1.05,
      script_style: "conversational",
      speaking_style: "AUTHORITY_EDU — didáctico, directo, Spanglish natural. Explica el por qué antes del qué."
    },
    expertise: "colorimetría, balayage, salud capilar, estilismo profesional Miami",
    compliance_notes: "No medical claims. No guaranteed results.",
    compatible_archetypes: ["studio_setup","car_front","car_rear","street_interview","salon_workshop","event_stage","single_talking_head"]
  },
  {
    id: "dd_host_01",
    brandId: "DiamondDetails",
    displayName: "Host Diamond Details A",
    role_default: "BOTH",
    status: "active",
    imagelab: {
      description: "Hombre profesional 30-40 años, aspecto cuidado, ropa casual premium en tonos oscuros, actitud experta y cercana.",
      style: "cinematic_soft, moody garage lighting, automotive premium",
      realism_level: "cinematic",
      skin_detail: "subtle",
      film_look: "cinematic_soft",
      lens_preset: "35mm_hero",
      depth_of_field: "shallow",
      has_reference_photos: false,
      reference_photos_path: "Reference_Assets/Diamond_Details/"
    },
    voicelab: {
      voice_id: "TBD_dd_voice_01",
      language: "es-ES",
      emotion_base: "authoritative",
      speed: 1.0,
      script_style: "spot",
      speaking_style: "Experto técnico pero cercano. Usa términos del sector con naturalidad."
    },
    expertise: "detailing automotriz, protección cerámica, PPF, tintado de lunas",
    compliance_notes: "No absolute guarantees. No readable plates.",
    compatible_archetypes: ["studio_setup","car_front","car_rear","street_interview","salon_workshop","single_talking_head"]
  },
  {
    id: "vizos_host_01",
    brandId: "VizosCosmetics",
    displayName: "Host Vizos Cosmetics",
    role_default: "BOTH",
    status: "active",
    imagelab: {
      description: "Mujer profesional 35-50 años, imagen de laboratorio premium, estilo salón de alto nivel. Miami/España.",
      style: "cinematic, high fashion lighting, obsidian tones, lab premium",
      realism_level: "cinematic",
      skin_detail: "high_microdetail",
      film_look: "35mm_film",
      lens_preset: "85mm_portrait",
      depth_of_field: "shallow",
      has_reference_photos: false,
      reference_photos_path: "Reference_Assets/Vizos_Cosmetics/"
    },
    voicelab: {
      voice_id: "TBD_vizos_voice_01",
      language: "es-ES",
      emotion_base: "authoritative",
      speed: 1.0,
      script_style: "narrator",
      speaking_style: "Técnico, profesional. Referencia de laboratorio y salón premium."
    },
    expertise: "cuidado capilar profesional, Hair Healing Systems, tecnología capilar avanzada",
    compliance_notes: "Professional haircare only. No medical claims.",
    compatible_archetypes: ["studio_setup","street_interview","salon_workshop","single_talking_head"]
  },
  {
    id: "d7h_host_01",
    brandId: "D7Herbal",
    displayName: "Host D7Herbal",
    role_default: "BOTH",
    status: "active",
    imagelab: {
      description: "Mujer profesional 30-45 años, imagen natural y experta. Contexto lifestyle wellness España.",
      style: "editorial_clean, botanical spa tones, soft natural light, wellness lifestyle",
      realism_level: "editorial_clean",
      skin_detail: "realistic",
      film_look: "digital_clean",
      lens_preset: "50mm_lifestyle",
      depth_of_field: "medium",
      has_reference_photos: false,
      reference_photos_path: "Reference_Assets/D7Herbal/"
    },
    voicelab: {
      voice_id: "TBD_d7h_voice_01",
      language: "es-ES",
      emotion_base: "warm",
      speed: 0.95,
      script_style: "conversational",
      speaking_style: "Experto cercano, clínico natural. Usa: ayuda a, contribuye a, favorece."
    },
    expertise: "cuidado capilar natural, ingredientes botánicos, dermocosmética",
    compliance_notes: "Cosmetic only. No medical/cure language.",
    compatible_archetypes: ["studio_setup","street_interview","salon_workshop","single_talking_head"]
  }
];

export function getBlueprintsByBrand(brandId: string): PersonBlueprint[] {
  return PERSON_BLUEPRINTS.filter(b => b.brandId === brandId && b.status === "active");
}

export function getBlueprintById(id: string): PersonBlueprint | undefined {
  return PERSON_BLUEPRINTS.find(b => b.id === id);
}
