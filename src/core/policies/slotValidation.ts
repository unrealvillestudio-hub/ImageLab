
// Fix: Corrected relative imports for core types and promptpack service
import { LibraryAsset, LibraryAssetKind, PromptPackValidationResult } from "../types.ts";
import { validatePromptPack } from "../../services/promptpack.ts";

export interface SlotValidationResult {
    isValid: boolean;
    severity: "ok" | "warn" | "error";
    message: string;
    canAutoFixBySwap: boolean;
}

/**
 * Validates slots for E-Commerce Studio (Strict Pixel Lock)
 * Contract: Required [A, B]. A=Product, B=Background. Block if fails.
 */
export function validateEcomSlots(
    slotA: LibraryAsset | undefined | null, 
    slotB: LibraryAsset | undefined | null,
    slotC?: LibraryAsset | undefined | null,
    ref1?: LibraryAsset | undefined | null,
    ref2?: LibraryAsset | undefined | null
): SlotValidationResult {
    
    if (!slotA || !slotB) {
        return { 
            isValid: false, 
            severity: "error", 
            message: "E-Commerce requires both Subject (A) and Background (B).", 
            canAutoFixBySwap: false 
        };
    }

    const aIsBg = slotA.kind === 'background' || slotA.kind === 'reference';
    const bIsProd = slotB.kind === 'product' || slotB.kind === 'person';

    if (aIsBg && bIsProd) {
        return { 
            isValid: false, 
            severity: "error", 
            message: "Slots Inverted: Background in A, Product in B.", 
            canAutoFixBySwap: true 
        };
    }

    if (slotA.kind !== 'product' && slotA.kind !== 'person' && slotA.kind !== 'unknown') {
        return {
            isValid: false,
            severity: "error",
            message: `Slot A must be Product/Person. Found: ${slotA.kind}`,
            canAutoFixBySwap: false
        };
    }

    return { isValid: true, severity: "ok", message: "Ready for Composite.", canAutoFixBySwap: false };
}

export function validateSceneSlots(
    slotA: LibraryAsset | undefined | null,
    compositeMode: boolean
): SlotValidationResult {
    if (compositeMode && !slotA) {
        return {
            isValid: true,
            severity: "warn",
            message: "Auto-Composite is ON but Slot A is empty. Will generate scene only.",
            canAutoFixBySwap: false
        };
    }
    return { isValid: true, severity: "ok", message: "Ready to Generate.", canAutoFixBySwap: false };
}

export function validateAvatarSlots(
    activeSlots: { sourceA: string | null; sourceB: string | null; sourceC?: string | null },
    assets: LibraryAsset[],
    strictIdentity: boolean
): SlotValidationResult {
    const assetA = assets.find(a => a.id === activeSlots.sourceA);
    const assetB = assets.find(a => a.id === activeSlots.sourceB);

    if (strictIdentity) {
        if (!assetA) {
            return {
                isValid: false,
                severity: "error",
                message: "Strict Identity requires a Person in Slot A.",
                canAutoFixBySwap: false
            };
        }
        if (assetA.kind !== 'person' && assetA.kind !== 'unknown') {
            return {
                isValid: false,
                severity: "error",
                message: `Strict Identity requires Person in Slot A. Found: ${assetA.kind}`,
                canAutoFixBySwap: false
            };
        }
    } else {
        const aIsBg = assetA && (assetA.kind === 'background' || assetA.kind === 'reference');
        const bIsPerson = assetB && assetB.kind === 'person';
        
        if (aIsBg && bIsPerson) {
            return {
                isValid: true,
                severity: "warn",
                message: "Recommendation: Swap slots (Person in A).",
                canAutoFixBySwap: true
            };
        }
    }

    return { isValid: true, severity: "ok", message: "Ready to Generate.", canAutoFixBySwap: false };
}

export function validateSlotsICR(
    activeSlots: { sourceA: string | null; sourceB: string | null; sourceC?: string | null },
    assets: LibraryAsset[]
): SlotValidationResult {
    const assetA = assets.find(a => a.id === activeSlots.sourceA);
    const assetB = assets.find(a => a.id === activeSlots.sourceB);

    const aIsBg = assetA && (assetA.kind === 'background' || assetA.kind === 'reference');
    const bIsSubject = assetB && (assetB.kind === 'product' || assetB.kind === 'person');

    if (aIsBg && bIsSubject) {
        return {
            isValid: true,
            severity: "warn",
            message: "Detected Background in A / Subject in B. Swap recommended.",
            canAutoFixBySwap: true
        };
    }

    return { isValid: true, severity: "ok", message: "Slots configuration valid.", canAutoFixBySwap: false };
}

export function validatePromptPackPolicy(
    jsonStr: string,
    sourceAssetA: LibraryAsset | undefined | null,
    sourceAssetB: LibraryAsset | undefined | null,
    includeAsset: boolean,
    includePeople: boolean
): PromptPackValidationResult {
    const effectiveA = includeAsset ? sourceAssetA : null;
    return validatePromptPack(jsonStr, effectiveA, sourceAssetB);
}

export function getKindMismatchWarnings(
    assetA: LibraryAsset | undefined | null, 
    assetB: LibraryAsset | undefined | null,
    expectedKindA: 'product' | 'person' = 'product'
): string[] {
    const msgs: string[] = [];
    
    if (assetA && assetA.kind !== expectedKindA && assetA.kind !== 'unknown') {
        const usageLabel = expectedKindA === 'person' ? 'Person' : 'Product';
        msgs.push(`Slot A: This asset is classified as '${assetA.kind}' but is used as ${usageLabel} (Slot A). Consider reclassifying to '${expectedKindA}' for best results.`);
    }

    if (assetB && assetB.kind !== 'background' && assetB.kind !== 'unknown') {
        msgs.push(`Slot B: This asset is classified as '${assetB.kind}' but is used as Background (Slot B). Consider reclassifying to 'background' for best results.`);
    }

    return msgs;
}
