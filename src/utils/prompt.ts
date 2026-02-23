// Fix: Relative import
import { AssetSpec, BrandProfile, PackControls } from "../core/types.ts";

function controlsToPrompt(controls: PackControls): string {
  const parts: string[] = [];

  // Realism / overall look
  switch (controls.realismLevel) {
    case "editorial_clean":
      parts.push("High-end editorial realism, clean premium styling, no CGI look");
      break;
    case "cinematic":
      parts.push("Cinematic realism, controlled contrast, cinematic lighting and composition");
      break;
    case "documentary":
      parts.push("Documentary realism, natural imperfections, authentic lighting");
      break;
  }

  // Skin micro detail
  switch (controls.skinDetail) {
    case "subtle":
      parts.push("Natural skin texture, subtle pores, no plastic skin");
      break;
    case "realistic":
      parts.push("Realistic skin micro-texture: pores, fine lines, vellus hair (subtle)");
      break;
    case "high_microdetail":
      parts.push(
        "High micro-detail skin texture: pores, fine lines, subtle birthmarks/freckles, still flattering and realistic"
      );
      break;
  }

  // Imperfections intensity
  switch (controls.imperfections) {
    case "none":
      parts.push("Even complexion, minimal imperfections");
      break;
    case "subtle":
      parts.push("Subtle realistic imperfections (tiny freckles/birthmarks), not exaggerated");
      break;
    case "realistic":
      parts.push("Realistic imperfections (pores, freckles, subtle birthmarks), avoid exaggeration");
      break;
  }

  // Humidity & sweat
  if (controls.humidityLevel > 0) {
    parts.push(
      `Subtle humidity in environment level ${controls.humidityLevel}/3 (e.g., post-shower bathroom condensation), realistic`
    );
  }
  if (controls.sweatLevel > 0) {
    parts.push(`Subtle sweat sheen level ${controls.sweatLevel}/3, realistic and non-glamourized`);
  }

  // Film / grain
  switch (controls.filmLook) {
    case "digital_clean":
      parts.push("Digital clean capture, modern commercial sharpness");
      break;
    case "35mm_film":
      parts.push("35mm film-inspired look, gentle halation, organic contrast");
      break;
    case "cinematic_soft":
      parts.push("Cinematic soft look, gentle bloom, premium color grading");
      break;
  }
  if (controls.grainLevel > 0) {
    parts.push(`Film grain level ${controls.grainLevel}/3 (subtle, organic)`);
  }

  // Lens + DOF
  const lensMap: Record<string, string> = {
    "24mm_wide": "24mm wide-angle lens, environmental context",
    "35mm_hero": "35mm lens, hero perspective",
    "50mm_lifestyle": "50mm lens, natural lifestyle perspective",
    "85mm_portrait": "85mm lens, flattering portrait compression",
    "90mm_macro": "90mm macro lens, extreme detail",
  };
  parts.push(lensMap[controls.lensPreset]);

  const dofMap: Record<string, string> = {
    deep: "Deep focus (more elements sharp) when appropriate",
    medium: "Medium depth of field, subject sharp, background softly blurred",
    shallow: "Shallow depth of field, strong bokeh, subject isolation",
  };
  parts.push(dofMap[controls.depthOfField]);

  // Framing
  const framingMap: Record<string, string> = {
    centered: "Centered framing, stable composition",
    rule_of_thirds: "Rule-of-thirds composition",
    negative_space_left: "Leave strong negative space on the left for copy overlays",
    negative_space_right: "Leave strong negative space on the right for copy overlays",
  };
  parts.push(framingMap[controls.framing]);

  return parts.join(". ") + ".";
}

function mergeNegatives(...chunks: Array<string | undefined | null>): string {
  // Split by commas or newlines, trim, dedupe (case-insensitive), keep original casing of first occurrence
  const seen = new Set<string>();
  const out: string[] = [];

  for (const chunk of chunks) {
    if (!chunk) continue;
    const parts = chunk
      .split(/[,|\n]+/g)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const p of parts) {
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }

  return out.join(", ");
}

export function buildSystemInstruction(brand: BrandProfile): string {
  return `You are a world-class creative director and professional photographer.
GOAL: Generate one high-end marketing image.

CRITICAL:
1) Output MUST include a generated image.
2) If a product reference is provided and product lock is required: keep shape, label, typography, and colors exactly.
3) No readable embedded text. Leave negative space for overlays.
4) High realism, no CGI look, no watermarks.
5) Respect brand compliance.

BRAND VISUAL IDENTITY: ${brand.visualIdentity}
COMPLIANCE RULES: ${brand.complianceRules}`;
}

export function buildAssetPrompt(params: {
  brand: BrandProfile;
  asset: AssetSpec;
  controls: PackControls;
  userNotes?: string;
}): { prompt: string; negative: string } {
  const { brand, asset, controls, userNotes } = params;

  const prompt = [
    `Asset type: ${asset.assetType}.`,
    asset.shotDescription,
    `Brand identity: ${brand.visualIdentity}`,
    controlsToPrompt(controls),
    userNotes ? `Additional notes: ${userNotes}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const globalNeg =
    "readable text, watermark, logo, brand names, labels, deformed hands, extra fingers, CGI, low resolution, artifacts";

  const negative = mergeNegatives(
    brand.defaultNegativePrompt,
    asset.negativePrompt,
    globalNeg
  );

  return { prompt, negative };
}