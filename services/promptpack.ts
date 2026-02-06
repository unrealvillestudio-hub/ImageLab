
import { PromptPackV1, PromptPackRunResult, CreativityLevel, VarietyStrength, ReferenceImage } from "../types";
import { generateImageFromPrompt } from "./gemini";
import { safeId } from "../utils/imageUtils";

export function parsePromptPackJson(jsonStr: string): PromptPackV1 {
  try {
    const parsed = JSON.parse(jsonStr);
    return parsed as PromptPackV1;
  } catch (e) {
    throw new Error("Invalid JSON format");
  }
}

export async function runPromptPack(params: {
  pack: PromptPackV1;
  overrideCreativity?: CreativityLevel;
}): Promise<PromptPackRunResult> {
  const { pack, overrideCreativity } = params;
  const runId = safeId("run");
  const items = [];

  // 1. Extract Optional Assets from Pack Inputs (injected by App.tsx)
  const sourceAsset = pack.inputs?.source_asset;
  
  // Transform inputs.reference_images to ReferenceImage[] type if present
  let refImages: ReferenceImage[] | undefined = undefined;
  if (pack.inputs?.reference_images && Array.isArray(pack.inputs.reference_images)) {
      refImages = pack.inputs.reference_images.map(r => ({
          dataUrl: r.dataUrl,
          label: r.label
      }));
  }

  // 2. Extract Defaults
  const defaultAR = pack.defaults?.aspect_ratio || "1:1";
  const defaultSize = pack.defaults?.size || "2k"; // Maps to ImageSize

  if (pack.jobs) {
      for (const job of pack.jobs) {
          // Construct the prompt
          let finalPrompt = job.prompt || "Professional product photography";
          
          // Append context notes from defaults if they exist
          if (pack.defaults?.style_notes) {
              finalPrompt += `. Style: ${pack.defaults.style_notes}`;
          }

          // Simple creativity injection (can be expanded later with blocks)
          if (overrideCreativity && overrideCreativity > 1) {
              const creativityDescriptors = {
                  2: "creative lighting, interesting angles",
                  3: "dramatic composition, artistic interpretation, high contrast"
              };
              finalPrompt += `. ${creativityDescriptors[overrideCreativity]}`;
          }

          try {
               // 3. EXECUTE GENERATION WITH ASSETS
               const generatedImage = await generateImageFromPrompt({
                  prompt: finalPrompt,
                  aspectRatio: (job.aspect_ratio || defaultAR) as any,
                  size: (job.size || defaultSize) as any,
                  
                  // CRITICAL FIX: Pass the assets to the generator
                  sourceAssetDataUrl: sourceAsset?.dataUrl,
                  sourceAssetLabel: sourceAsset?.label,
                  referenceImages: refImages
               });
               
               items.push({
                   id: safeId("item"),
                   label: job.label || "Generated Item",
                   imageDataUrl: generatedImage,
                   job_id: job.id || safeId("job"),
                   variant_index: 0
               });
          } catch (e: any) {
              console.error(`Job ${job.label || 'unknown'} failed:`, e);
              // We continue to the next job instead of failing the whole pack
          }
      }
  }

  return {
    run_id: runId,
    pack_id: pack.pack_id,
    items: items,
  };
}
