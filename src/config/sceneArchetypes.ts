// Fix: Relative import
import { SceneArchetypeId, CreativityLevel, VarietyStrength } from "../core/types.ts";

export const SCENE_ARCHETYPES = [
  { id: "custom", label: "Custom (Brief Prompt)" },
  { id: "studio_minimal", label: "Studio Minimal (E-com)" },
  { id: "bathroom_premium", label: "Bathroom / Vanity Premium" },
  { id: "salon", label: "Luxury Hair Salon" },
  { id: "gym", label: "Boutique Fitness Gym" },
  { id: "spa_wellness", label: "Spa & Zen Wellness" },
  { id: "penthouse_skyline", label: "Modern Penthouse" },
  { id: "detail_shop", label: "Auto Detailing Bay" },
  { id: "garage_modern", label: "Modern High-End Garage" },
  { id: "office_modern", label: "Executive Office" },
  { id: "rooftop_terrace", label: "Rooftop City Terrace" },
  { id: "boutique_retail", label: "High-End Boutique" },
  { id: "laboratory_clean", label: "Clinical / Lab Clean" },
  { id: "warehouse_industrial", label: "Industrial Loft / Warehouse" },
  { id: "kitchen_editorial", label: "Gourmet Kitchen" },
  { id: "yacht_deck", label: "Luxury Yacht Deck" },
  { id: "zen_garden", label: "Japanese Zen Garden" },
  { id: "brutalist_arch", label: "Brutalist Architecture" },
];

export function buildSceneVariantPrompts(params: {
  archetype: string;
  negativeSpace: string;
  variants: number;
  customBrief?: string;
  userPrompt?: string; // New field for user context
  runSignature?: string;
  sceneMode?: "auto_random" | "seeded";
  seed?: number;
  varietyStrength?: VarietyStrength;
  creativityLevel?: CreativityLevel;
  extraNotes?: string;
}): string[] {
    const prompts = [];
    
    // Buscar la etiqueta legible del arquetipo para mejorar el prompt
    const archObj = SCENE_ARCHETYPES.find(a => a.id === params.archetype);
    const archLabel = archObj ? archObj.label : params.archetype;

    // Construir un prompt descriptivo real en lugar de un placeholder
    let basePrompt = "";
    
    if (params.archetype === 'custom' && params.customBrief) {
        basePrompt = params.customBrief;
    } else {
        basePrompt = `Professional product photography background featuring a ${archLabel} environment`;
    }

    // Añadir instrucción de espacio negativo
    let spaceInstruction = "";
    if (params.negativeSpace) {
        const readableSpace = params.negativeSpace.replace('_', ' ');
        spaceInstruction = `, composed with clear negative space on the ${readableSpace} for product placement`;
    }

    // Incorporar el prompt del usuario si existe
    let userContext = "";
    if (params.userPrompt && params.userPrompt.trim().length > 0) {
        userContext = `. Context details: ${params.userPrompt}`;
    }

    const styleInstruction = ". High resolution, 8k, photorealistic, professional lighting, shallow depth of field, architectural detail.";

    for(let i=0; i<params.variants; i++) {
        // Generamos variantes sutiles simplemente pidiendo el prompt.
        prompts.push(`${basePrompt}${userContext}${spaceInstruction}${styleInstruction}`);
    }
    return prompts;
}