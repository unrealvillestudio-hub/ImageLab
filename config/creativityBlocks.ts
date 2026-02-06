// config/creativityBlocks.ts
// Goal: add macro creativity beyond scene archetypes.
// Creativity 3 = 6–7 randomized blocks (radical changes).

export type CreativityLevel = 1 | 2 | 3;

export type CreativeBlockId =
  | "camera_angle"
  | "lens"
  | "lighting"
  | "time_of_day"
  | "style"
  | "composition"
  | "color_grade";

export type CreativeBlocksSelection = Partial<Record<CreativeBlockId, string>>;

export interface CreativeBlock {
  id: CreativeBlockId;
  label: string;
  options: string[];
}

// 7 blocks (as requested) to force radical change at level 3
export const CREATIVE_BLOCKS: Record<CreativeBlockId, CreativeBlock> = {
  camera_angle: {
    id: "camera_angle",
    label: "Camera angle",
    options: [
      "low-angle hero framing",
      "eye-level centered framing",
      "high-angle overview framing",
      "top-down flat-lay framing",
      "three-quarter angle dynamic framing",
    ],
  },
  lens: {
    id: "lens",
    label: "Lens",
    options: ["24mm wide", "35mm natural wide", "50mm standard", "85mm portrait", "100mm macro"],
  },
  lighting: {
    id: "lighting",
    label: "Lighting",
    options: [
      "soft diffused studio light",
      "hard directional light with crisp shadows",
      "neon accent rim light",
      "warm golden key light",
      "cool moody low-key lighting",
    ],
  },
  time_of_day: {
    id: "time_of_day",
    label: "Time of day",
    options: ["morning freshness", "midday clarity", "sunset warmth", "night city vibe", "overcast cinematic"],
  },
  style: {
    id: "style",
    label: "Style",
    options: [
      "hyperreal commercial photo",
      "cinematic film still",
      "clean minimal editorial",
      "high-contrast luxury aesthetic",
      "modern tech aesthetic",
    ],
  },
  composition: {
    id: "composition",
    label: "Composition",
    options: [
      "centered symmetry",
      "rule of thirds",
      "strong leading lines",
      "negative space dominant",
      "foreground framing elements",
    ],
  },
  color_grade: {
    id: "color_grade",
    label: "Color grade",
    options: [
      "neutral true-to-life",
      "teal & orange",
      "matte desaturated",
      "vibrant saturated",
      "warm premium grade",
    ],
  },
};

// Creativity mapping:
// - L1: strict (no block randomization)
// - L2: moderate (3 blocks)
// - L3: radical (7 blocks)
export const CREATIVITY_LEVEL_TO_BLOCKS: Record<CreativityLevel, CreativeBlockId[]> = {
  1: [],
  2: ["lighting", "composition", "color_grade"],
  3: ["camera_angle", "lens", "lighting", "time_of_day", "style", "composition", "color_grade"],
};

export function renderCreativitySuffix(selection: CreativeBlocksSelection): string {
  const entries = Object.entries(selection).filter(([, v]) => !!v) as Array<[CreativeBlockId, string]>;
  if (!entries.length) return "";
  const lines = entries.map(([k, v]) => `- ${CREATIVE_BLOCKS[k].label}: ${v}`);
  return `\n\n[Creativity Variations]\n${lines.join("\n")}`;
}
