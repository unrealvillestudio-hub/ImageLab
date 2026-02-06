// config/sceneTags.ts
// Scene tag suggestions for the Scene Generator UI.
// These are NOT restrictive presets — users can type any tags.
export type SceneTagGroup = {
  label: string;
  tags: string[];
};

export const SCENE_TAG_GROUPS: SceneTagGroup[] = [
  { label: "Lifestyle (general)", tags: ["office", "gym", "street", "terrace", "restaurant", "hotel_lobby", "bathroom_spa", "kitchen_clean"] },
  { label: "Beauty / Wellness", tags: ["salon", "bathroom_spa", "vanity_table", "spa_stones", "botanical_shadows", "laboratory_clean"] },
  { label: "Automotive / Service", tags: ["garage_clean", "detailing_bay", "workshop_modern", "showroom", "street_night", "parking_rooftop"] },
  { label: "E-commerce safe", tags: ["studio_minimal", "gradient_backdrop", "softbox_light", "marble_surface", "concrete_surface"] },
];
