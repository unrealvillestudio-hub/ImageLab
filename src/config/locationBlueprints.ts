export type ArchetypeId = 
  "studio_setup" | "car_front" | "car_rear" | 
  "street_interview" | "salon_workshop" | "event_stage" | 
  "single_talking_head";

export interface LocationBlueprint {
  id: string;
  brandId: string;
  displayName: string;
  locationType: "salon" | "workshop" | "exterior_urban" | 
                "exterior_coastal" | "event_stage" | "studio" | "residential";
  city: string;
  country: string;
  status: "active" | "draft";
  visual: {
    description: string;
    materials: string[];
    color_palette: string[];
    lighting: string;
    time_of_day_best: string;
    signature_elements: string[];
  };
  has_reference_photos: boolean;
  reference_photos_path: string;
  imagelab: {
    realism_level: string;
    film_look: string;
    lens_preset: string;
    depth_of_field: string;
    framing: string;
  };
  compatible_archetypes: ArchetypeId[];
  recommended_angles: string[];
}

export const LOCATION_BLUEPRINTS: LocationBlueprint[] = [
  {
    id: "loc_po_salon_miami",
    brandId: "PatriciaOsorio",
    displayName: "Salón Patricia Osorio — Miami",
    locationType: "salon",
    city: "Miami", country: "USA", status: "active",
    visual: {
      description: "Salón de peluquería premium Miami. Sillones blancos, espejos con iluminación perimetral dorada, suelo oscuro, plantas tropicales, ambiente exclusivo.",
      materials: ["cristal","cuero blanco","metal dorado","mármol"],
      color_palette: ["blanco","dorado","verde tropical","negro mate"],
      lighting: "cálida controlada, iluminación perimetral espejo + spots techo",
      time_of_day_best: "tarde",
      signature_elements: ["sillones blancos estilismo","espejos iluminados","plantas tropicales","display productos"]
    },
    has_reference_photos: false,
    reference_photos_path: "Reference_Assets/Patricia_Osorio/",
    imagelab: { realism_level: "editorial_clean", film_look: "digital_clean", lens_preset: "50mm_lifestyle", depth_of_field: "medium", framing: "negative_space_right" },
    compatible_archetypes: ["studio_setup","salon_workshop","single_talking_head"],
    recommended_angles: ["silla_espejo","mostrador_productos","two_shot_espejo","top_down_silla","ventana_luz_natural"]
  },
  {
    id: "loc_po_miami_beach",
    brandId: "PatriciaOsorio",
    displayName: "Miami Beach Waterfront",
    locationType: "exterior_coastal",
    city: "Miami Beach", country: "USA", status: "active",
    visual: {
      description: "Paseo marítimo Miami Beach. Palmeras, arena blanca, agua turquesa, luz dorada de tarde.",
      materials: ["arena blanca","palmeras","pavimento paseo"],
      color_palette: ["turquesa","arena","verde palmera","dorado atardecer"],
      lighting: "luz natural dorada de tarde, golden hour",
      time_of_day_best: "golden hour",
      signature_elements: ["palmeras icónicas","agua turquesa","arena blanca","skyline Miami"]
    },
    has_reference_photos: false,
    reference_photos_path: "Reference_Assets/Patricia_Osorio/",
    imagelab: { realism_level: "cinematic", film_look: "cinematic_soft", lens_preset: "35mm_hero", depth_of_field: "medium", framing: "rule_of_thirds" },
    compatible_archetypes: ["street_interview","single_talking_head"],
    recommended_angles: ["walking_lateral_mar","static_palmeras","golden_hour_silueta","behind_walking_horizonte"]
  },
  {
    id: "loc_po_downtown_miami",
    brandId: "PatriciaOsorio",
    displayName: "Downtown Miami — Brickell / Wynwood",
    locationType: "exterior_urban",
    city: "Miami", country: "USA", status: "active",
    visual: {
      description: "Arquitectura moderna Brickell o murales Wynwood. Rascacielos cristal, energía urbana Miami multicultural.",
      materials: ["cristal edificios","hormigón","asfalto","murales"],
      color_palette: ["gris urbano","cristal reflectante","colores murales","cielo azul Miami"],
      lighting: "luz tropical directa o sombra de edificios",
      time_of_day_best: "mañana o tarde",
      signature_elements: ["rascacielos cristal Brickell","murales Wynwood","calles anchas","skyline"]
    },
    has_reference_photos: false,
    reference_photos_path: "Reference_Assets/Patricia_Osorio/",
    imagelab: { realism_level: "cinematic", film_look: "35mm_film", lens_preset: "35mm_hero", depth_of_field: "medium", framing: "negative_space_left" },
    compatible_archetypes: ["street_interview","single_talking_head"],
    recommended_angles: ["arquitectura_fondo","walking_calle","mural_wynwood","reflejo_cristal","rooftop_skyline"]
  },
  {
    id: "loc_dd_cabinas",
    brandId: "DiamondDetails",
    displayName: "Cabinas Diamond Details — Alicante",
    locationType: "workshop",
    city: "Alicante", country: "España", status: "active",
    visual: {
      description: "Bahía de detailing profesional premium. Suelo epoxy gris claro, iluminación LED blanca de techo, coche en proceso como elemento central.",
      materials: ["epoxy suelo","metal cromado","LED techo","equipamiento profesional"],
      color_palette: ["gris claro","blanco LED","negro herramientas","plateado cromado"],
      lighting: "LED blanca de techo alta intensidad, sin sombras duras",
      time_of_day_best: "cualquiera (iluminación artificial controlada)",
      signature_elements: ["coche en bahía","suelo epoxy","LED profesional","herramientas organizadas"]
    },
    has_reference_photos: false,
    reference_photos_path: "Reference_Assets/Diamond_Details/",
    imagelab: { realism_level: "cinematic", film_look: "cinematic_soft", lens_preset: "35mm_hero", depth_of_field: "shallow", framing: "negative_space_right" },
    compatible_archetypes: ["salon_workshop","single_talking_head","studio_setup"],
    recommended_angles: ["wide_bahia_coche","detalle_led_carroceria","tecnico_aplicando","top_down_bahia","entrada_taller"]
  },
  {
    id: "loc_dd_costa_blanca",
    brandId: "DiamondDetails",
    displayName: "Costa Blanca — Alicante",
    locationType: "exterior_coastal",
    city: "Alicante", country: "España", status: "active",
    visual: {
      description: "Costa mediterránea alicantina. Arquitectura blanca, mar azul intenso Mediterráneo, luz mediterránea brillante y cálida.",
      materials: ["asfalto","piedra mediterránea","arena","vegetación mediterránea"],
      color_palette: ["azul mediterráneo","blanco arquitectura","verde palmera","ocre piedra"],
      lighting: "luz mediterránea intensa, dorada al atardecer",
      time_of_day_best: "atardecer",
      signature_elements: ["mar Mediterráneo","arquitectura blanca","palmeras","carretera costera"]
    },
    has_reference_photos: false,
    reference_photos_path: "Reference_Assets/Diamond_Details/",
    imagelab: { realism_level: "cinematic", film_look: "cinematic_soft", lens_preset: "35mm_hero", depth_of_field: "medium", framing: "rule_of_thirds" },
    compatible_archetypes: ["car_front","car_rear","street_interview","single_talking_head"],
    recommended_angles: ["coche_mar_fondo","carretera_costera_palmeras","wide_paisaje_costero","reflejo_mar_carroceria"]
  },
  {
    id: "loc_generic_event_stage",
    brandId: "GENERIC",
    displayName: "Event Stage / Tarima Conferencia",
    locationType: "event_stage",
    city: "VARIABLE", country: "VARIABLE", status: "active",
    visual: {
      description: "Tarima profesional de evento. Iluminación de plató, público difuminado al fondo, backdrop neutro o de marca.",
      materials: ["tarima madera oscura","backdrop tela","equipo audio"],
      color_palette: ["negro audiencia","luz frontal cálida","color backdrop variable"],
      lighting: "iluminación profesional: key light frontal + fill lateral + backlight",
      time_of_day_best: "cualquiera (interior controlado)",
      signature_elements: ["tarima elevada","micrófono","público al fondo","luz de plató"]
    },
    has_reference_photos: false,
    reference_photos_path: "Reference_Assets/",
    imagelab: { realism_level: "cinematic", film_look: "cinematic_soft", lens_preset: "85mm_portrait", depth_of_field: "shallow", framing: "centered" },
    compatible_archetypes: ["event_stage","single_talking_head"],
    recommended_angles: ["frontal_tarima_publico","lateral_escenario","close_up_cara_luz","wide_sala_completa","backstage_entrada"]
  }
];

export function getLocationsByBrand(brandId: string): LocationBlueprint[] {
  return LOCATION_BLUEPRINTS.filter(l => 
    (l.brandId === brandId || l.brandId === "GENERIC") && l.status === "active"
  );
}

export function getLocationsByArchetype(archetypeId: ArchetypeId): LocationBlueprint[] {
  return LOCATION_BLUEPRINTS.filter(l => 
    l.compatible_archetypes.includes(archetypeId) && l.status === "active"
  );
}

export function getLocationById(id: string): LocationBlueprint | undefined {
  return LOCATION_BLUEPRINTS.find(l => l.id === id);
}
