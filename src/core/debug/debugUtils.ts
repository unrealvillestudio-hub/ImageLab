
// Fix: Corrected relative imports for core types and metadataFixer module
import { DebugMetadata, LibraryAsset, ModelStage, PlacementHint } from "../types.ts";
import { fixMetadata } from "./metadataFixer.ts";

export function createDebugMetadataHelper(
    module: string, 
    routing: string, 
    policy: Record<string, string>, 
    params: any,
    assets: {
        sourceA?: LibraryAsset | null,
        sourceB?: LibraryAsset | null,
        sourceC?: LibraryAsset | null,
        ref1?: LibraryAsset | null,
        ref2?: LibraryAsset | null,
        ref3?: LibraryAsset | null
    },
    variantIdx?: number, 
    totalVariants?: number,
    warnings: string[] = [],
    modelStageConfig?: Partial<ModelStage>,
    placementHint?: PlacementHint
): DebugMetadata {
    
    const defaultModelStage: ModelStage = {
        enabled: null,
        prompt_built: null,
        images_sent: []
    };

    const finalModelStage = { ...defaultModelStage, ...modelStageConfig };

    const initialMeta: DebugMetadata = {
        timestamp: new Date().toISOString(),
        module,
        model: "gemini-2.5-flash-image", 
        routing,
        slots: {
            subject_a: assets.sourceA ? { asset_id: assets.sourceA.id, label: assets.sourceA.label, kind: assets.sourceA.kind, alpha_detected: !!assets.sourceA.alphaDetected } : {} as any,
            subject_b: assets.sourceB ? { asset_id: assets.sourceB.id, label: assets.sourceB.label, kind: assets.sourceB.kind, alpha_detected: !!assets.sourceB.alphaDetected } : {} as any,
            subject_c: assets.sourceC ? { asset_id: assets.sourceC.id, label: assets.sourceC.kind, alpha_detected: !!assets.sourceC.alphaDetected } : undefined,
            ref1: assets.ref1 ? { asset_id: assets.ref1.id, label: assets.ref1.label, kind: assets.ref1.kind } : undefined,
            ref2: assets.ref2 ? { asset_id: assets.ref2.id, label: assets.ref2.label, kind: assets.ref2.kind } : undefined,
            ref3: assets.ref3 ? { asset_id: assets.ref3.id, label: assets.ref3.label, kind: assets.ref3.kind } : undefined,
        },
        policy_applied: policy,
        policy_applied_original: { ...policy }, 
        params,
        model_stage: finalModelStage,
        placement_hint: placementHint,
        usage: {
            subject_a: { detected: false, used_in_prompt: null, overlayed: false, reason: "" },
            subject_b: { detected: false, used_in_prompt: null, overlayed: false, reason: "" },
            subject_c: { detected: false, used_in_prompt: null, overlayed: false, reason: "" },
            refs: { detected: false, count: 0, used_in_prompt: null, reason: "" }
        },
        hud_lines: [],
        variant_index: variantIdx,
        variants_total: totalVariants,
        warnings: warnings
    };

    return fixMetadata(initialMeta);
}
