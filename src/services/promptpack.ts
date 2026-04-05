import { PromptPackV1, PromptPackRunResult, CreativityLevel, ReferenceImage, PromptPackValidationResult, LibraryAsset, ValidationError } from "../core/types.ts";
import { buildPsychoVisualInjection } from './psychoPresetLoader.ts';
import type { PsychoPreset } from './psychoPresetLoader.ts';
import { generateImageFromPrompt } from "./gemini.ts";
import { safeId } from "../utils/imageUtils.ts";

export function parsePromptPackJson(jsonStr: string): PromptPackV1 {
  try {
    const parsed = JSON.parse(jsonStr);
    return parsed as PromptPackV1;
  } catch (e) {
    throw new Error("Invalid JSON format");
  }
}

/**
 * ICR v1.1.0 - Pre-flight Validation
 */
export function validatePromptPack(
    jsonStr: string, 
    sourceAssetA: LibraryAsset | undefined | null,
    sourceAssetB: LibraryAsset | undefined | null
): PromptPackValidationResult {
    const errors: ValidationError[] = [];
    let canSwapSlots = false;
    let pack: PromptPackV1 | null = null;

    // 1. Schema / Parse Check
    try {
        pack = JSON.parse(jsonStr);
        if (!pack || !pack.jobs || !Array.isArray(pack.jobs)) {
            errors.push({ code: "SCHEMA_INVALID", message: "JSON must contain a 'jobs' array.", severity: "BLOCK" });
            return { isValid: false, isBlocked: true, errors, canSwapSlots: false, status: "BLOCKED" };
        }
    } catch (e) {
        errors.push({ code: "JSON_PARSE_ERROR", message: "Invalid JSON syntax.", severity: "BLOCK" });
        return { isValid: false, isBlocked: true, errors, canSwapSlots: false, status: "BLOCKED" };
    }

    // 2. Logic / Policy Checks per Job
    let isBlocked = false;

    pack.jobs.forEach((job, idx) => {
        // Only check PIXEL_LOCK jobs for now as they are the strict ones
        if (job.slot_policies?.subject_a === 'PIXEL_LOCK') {
            
            // Check Input Existence
            if (!sourceAssetA) {
                // If not provided in UI, check if provided in JSON input (less common in this UI flow but possible)
                if (!pack?.inputs?.source_asset) {
                     errors.push({ 
                         code: "MISSING_INPUT_A", 
                         message: `Job '${job.label || idx}' requires PIXEL_LOCK but Subject A is empty.`, 
                         severity: "BLOCK", 
                         path: `jobs[${idx}]` 
                     });
                     isBlocked = true;
                }
            } else {
                // Check Slot Inversion (A=BG, B=PROD)
                // Heuristic: If A is background and B is product/person, suggest swap.
                const aIsBg = sourceAssetA.kind === 'background' || sourceAssetA.kind === 'reference';
                const bIsSubject = sourceAssetB && (sourceAssetB.kind === 'product' || sourceAssetB.kind === 'person');

                if (aIsBg && bIsSubject) {
                    canSwapSlots = true;
                    errors.push({
                        code: "SLOT_INVERSION",
                        message: `Job '${job.label || idx}' PIXEL_LOCK: Detected Background in Slot A and Subject in Slot B.`,
                        severity: "BLOCK",
                        path: `jobs[${idx}]`,
                        canFix: true
                    });
                    isBlocked = true;
                } else {
                    // Check Kind Validity for A
                    if (sourceAssetA.kind !== 'product' && sourceAssetA.kind !== 'person') {
                        errors.push({
                            code: "INVALID_KIND_A",
                            message: `Job '${job.label || idx}' requires Product/Person in Slot A. Found: ${sourceAssetA.kind}.`,
                            severity: "BLOCK",
                            path: `jobs[${idx}]`
                        });
                        isBlocked = true;
                    }

                    // Check Alpha for A (Strict Pixel Lock)
                    if (!sourceAssetA.alphaDetected && sourceAssetA.kind !== 'person') { 
                         errors.push({
                            code: "NO_ALPHA_A",
                            message: `Job '${job.label || idx}' PIXEL_LOCK requires transparency (alpha) in Subject A.`,
                            severity: "BLOCK",
                            path: `jobs[${idx}]`
                        });
                        isBlocked = true;
                    }
                }
            }
        }
    });

    return {
        isValid: errors.length === 0,
        isBlocked,
        errors,
        canSwapSlots,
        status: isBlocked ? "BLOCKED" : "OK"
    };
}

export function fixPromptPackSlots(jsonStr: string): string {
    return jsonStr; 
}

export async function runPromptPack(params: {
  pack: PromptPackV1;
  overrideCreativity?: CreativityLevel;
  variantCount?: number; // UI default override if JSON doesn't specify
  signal?: AbortSignal;
}): Promise<PromptPackRunResult> {
  const { pack, overrideCreativity, variantCount = 3, signal } = params;
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
  const defaultSize = pack.defaults?.size || "2k"; 

  // Determine Placement Request from JSON (scene_spec) if available
  const jsonPlacementAnchor = pack.scene_spec?.negative_space?.placement_request?.anchor;

  if (pack.jobs) {
      for (const job of pack.jobs) {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

          // Construct the prompt
          let finalPrompt = job.prompt || "Professional product photography";
          
          // Append context notes from defaults if they exist
          if (pack.defaults?.style_notes) {
              finalPrompt += `. Style: ${pack.defaults.style_notes}`;
          }

          // If JSON dictates specific placement via scene_spec, inject it nicely into prompt
          if (jsonPlacementAnchor) {
              const anchorReadable = jsonPlacementAnchor.replace('_', ' ');
              if (!finalPrompt.includes("negative space")) {
                  finalPrompt += `. Ensure clear negative space in the ${anchorReadable} area.`;
              }
          }

          // Simple creativity injection
          if (overrideCreativity && overrideCreativity > 1) {
              const creativityDescriptors = {
                  2: "creative lighting, interesting angles",
                  3: "dramatic composition, artistic interpretation, high contrast"
              };
              finalPrompt += `. ${creativityDescriptors[overrideCreativity]}`;
          }

          // Psycho Layer injection
          const psychoInjection = buildPsychoVisualInjection(psychoPreset);
          if (psychoInjection) finalPrompt += psychoInjection;

          // 3. EXECUTE GENERATION LOOP FOR VARIANTS
          // Priority: Job Specific > Pack Global > UI Default
          const jobVariants = job.outputs ?? pack.variants ?? variantCount;

          for (let v = 0; v < jobVariants; v++) {
              if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
              try {
                   const generatedImage = await generateImageFromPrompt({
                      prompt: finalPrompt,
                      aspectRatio: (job.aspect_ratio || defaultAR) as any,
                      size: (job.size || defaultSize) as any,
                      sourceAssetDataUrl: sourceAsset?.dataUrl,
                      sourceAssetLabel: sourceAsset?.label,
                      referenceImages: refImages,
                      signal: signal
                   });
                   
                   items.push({
                       id: safeId("item"),
                       label: `${job.label || "Generated Item"} (v${v + 1})`,
                       imageDataUrl: generatedImage,
                       job_id: job.id || safeId("job"),
                       variant_index: v
                   });
              } catch (e: any) {
                  if (e.name === 'AbortError') throw e;
                  console.error(`Job ${job.label || 'unknown'} variant ${v+1} failed:`, e);
              }
          }
      }
  }

  return {
    run_id: runId,
    pack_id: pack.pack_id,
    items: items,
  };
}
