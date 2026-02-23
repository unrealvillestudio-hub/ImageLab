import { CustomizeAudit, LibraryAsset } from "../../core/types.ts";
import { OutputSpec } from "../../config/customizeOutputs.ts";

export function buildCustomizeAudit(params: {
    brandId: string;
    pack: { id: string; label: string }; 
    item: OutputSpec;
    assetA: LibraryAsset | undefined;
    assetB: LibraryAsset;
    overlayUsed: boolean;
    overlayReason: string;
    placementParams: any;
    warnings: string[];
    resultAssetId?: string;
}): CustomizeAudit {
    return {
        timestamp: new Date().toISOString(),
        module: "customize",
        brand_id: params.brandId,
        pack_id: params.pack.id,
        pack_name: params.pack.label,
        pack_outputs_total: 1, 
        asset_id_result: params.resultAssetId,
        source_slots: {
            subject_a: params.assetA ? {
                asset_id: params.assetA.id,
                label: params.assetA.label,
                kind: params.assetA.kind,
                alpha_detected: !!params.assetA.alphaDetected
            } : null,
            subject_b: {
                asset_id: params.assetB.id,
                label: params.assetB.label,
                kind: params.assetB.kind,
                alpha_detected: !!params.assetB.alphaDetected
            }
        },
        render_policy: {
            deterministic: true,
            model_stage_enabled: false,
            overlay_used: params.overlayUsed,
            overlay_reason: params.overlayReason
        },
        output_spec: {
            output_id: params.item.id,
            label: params.item.label,
            aspect_ratio: String(params.item.aspectRatio),
            px: { w: params.item.dimensions.w, h: params.item.dimensions.h },
            safe_zone: null
        },
        params_applied: params.placementParams,
        warnings: params.warnings
    };
}

export function buildCustomizeSuccessBundle(
    summary: { brandId: string; packId: string; outputCount: number },
    outputs: Array<{ audit: CustomizeAudit }>
) {
    return {
        bundle_type: "CUSTOMIZE_SUCCESS_BUNDLE",
        created_at: new Date().toISOString(),
        summary,
        outputs: outputs.map(o => ({
            audit: o.audit,
            result_asset_ref: o.audit.asset_id_result || "unknown"
        }))
    };
}