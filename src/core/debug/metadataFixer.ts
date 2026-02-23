import { DebugMetadata, UsageStats, UsageDetail, RefUsageDetail } from "../types.ts";

/**
 * Applies "E-Comm Debug Fixer" logic to normalize metadata, calculate usage, and generate HUD lines.
 * STRICT CONTRACT: policy_applied must match usage. NO contradictions.
 */
export function fixMetadata(meta: DebugMetadata): DebugMetadata {
    const { routing, module } = meta;
    
    const slots = JSON.parse(JSON.stringify(meta.slots)); 
    const warnings: string[] = [...(meta.warnings || [])];

    const normalizeSlotKind = (key: string, slot: any) => {
        if (!slot || !slot.label) return;
        const labelLower = slot.label.toLowerCase();
        const currentKind = slot.kind;
        
        let fixedKind = currentKind;

        if (labelLower.includes('avatar')) {
            fixedKind = 'person';
        }
        else if (currentKind === 'background') {
            const personKeywords = ['woman', 'man', 'model', 'face', 'portrait', 'girl', 'boy'];
            if (personKeywords.some(kw => labelLower.includes(kw))) {
                fixedKind = 'person';
            }
        }

        if (fixedKind !== currentKind) {
            slot.kind = fixedKind;
            warnings.push(`kind_corrected_to_${fixedKind}`);
        }
    };

    if (slots.subject_a) normalizeSlotKind('subject_a', slots.subject_a);
    if (slots.subject_b) normalizeSlotKind('subject_b', slots.subject_b);
    if (slots.subject_c) normalizeSlotKind('subject_c', slots.subject_c);

    const model_stage = {
        enabled: meta.model_stage?.enabled ?? null,
        prompt_built: meta.model_stage?.prompt_built ?? null,
        images_sent: meta.model_stage?.images_sent ?? []
    };

    if (model_stage.enabled === null) warnings.push("model_stage_unknown");
    
    if (model_stage.enabled === true && model_stage.images_sent.length === 0) {
        if (module !== 'promptpack' && module !== 'scene_creator') {
            warnings.push("images_sent_missing");
        }
    }

    const usage: UsageStats = {
        subject_a: { detected: !!slots.subject_a?.asset_id, used_in_prompt: null, overlayed: false, reason: "" },
        subject_b: { detected: !!slots.subject_b?.asset_id, used_in_prompt: null, overlayed: false, reason: "" },
        subject_c: { detected: !!slots.subject_c?.asset_id, used_in_prompt: null, overlayed: false, reason: "" },
        refs: { 
            detected: (!!slots.ref1?.asset_id || !!slots.ref2?.asset_id || !!slots.ref3?.asset_id), 
            count: (slots.ref1?.asset_id ? 1 : 0) + (slots.ref2?.asset_id ? 1 : 0) + (slots.ref3?.asset_id ? 1 : 0), 
            used_in_prompt: null, 
            reason: "" 
        }
    };

    const getReason = (isSent: boolean, isDetected: boolean, slotKey?: string) => {
        if (!isDetected) return "";
        if (module === 'promptpack') {
            if (meta.policy_applied?.product_lock === "ON" && slotKey === 'subject_a' && !isSent) {
                return "PromptPack: locked (not sent)";
            }
            if (isSent && slotKey === 'subject_b') return "PromptPack: sent to model (background context)";
            
            return isSent ? "PromptPack: sent to model" : "PromptPack: not sent (toggle OFF or missing slot)";
        }
        if (module === 'scene_creator' && slotKey === 'subject_a' && !isSent) {
            return "SceneGen: product used only to compute placement_hint (not composited)";
        }
        return isSent ? "Included in prompt context" : "Detected but not sent to model";
    };

    const setPromptUsage = (detail: UsageDetail | RefUsageDetail, keysToCheck: string[], slotKeyForReason?: string) => {
        if (model_stage.enabled === false) {
            detail.used_in_prompt = false;
            detail.reason = "Not used: model_stage=OFF";
        } else if (model_stage.enabled === null) {
            detail.used_in_prompt = null;
            detail.reason = "Unknown: model_stage=UNKNOWN";
        } else {
            const sent = model_stage.images_sent.some(sentKey => keysToCheck.includes(sentKey));
            detail.used_in_prompt = sent;
            detail.reason = getReason(sent, detail.detected, slotKeyForReason);
        }
    };

    setPromptUsage(usage.subject_a, ['subject_a'], 'subject_a');
    setPromptUsage(usage.subject_b, ['subject_b', 'background'], 'subject_b');
    setPromptUsage(usage.subject_c, ['subject_c'], 'subject_c');
    
    if (model_stage.enabled === false) {
        usage.refs.used_in_prompt = false;
        usage.refs.reason = "Not used: model_stage=OFF";
    } else if (model_stage.enabled === null) {
        usage.refs.used_in_prompt = null;
        usage.refs.reason = "Unknown: model_stage=UNKNOWN";
    } else {
        const refsSent = model_stage.images_sent.some(k => k.startsWith('ref'));
        usage.refs.used_in_prompt = refsSent;
        if (usage.refs.detected) {
            usage.refs.reason = refsSent ? (module === 'promptpack' ? "PromptPack: refs sent" : "Style references active") : "Style refs ignored";
        }
    }

    if (routing === "PIXEL_LOCK_OVERLAY") {
        if (usage.subject_a.detected) {
            usage.subject_a.overlayed = true;
            usage.subject_a.reason = "Primary subject for deterministic overlay";
        }
        if (usage.subject_b.detected) {
            usage.subject_b.overlayed = false; 
            usage.subject_b.reason = "Base background layer";
        }
        usage.subject_c.overlayed = false;
    }

    const policy_applied = { ...meta.policy_applied };
    const policy_original = meta.policy_applied_original || meta.policy_applied;

    if (usage.refs.used_in_prompt !== true) {
        const newPolicy = usage.refs.detected ? 'DETECTED' : 'IGNORED';
        policy_applied.style_refs = newPolicy;
        if (policy_original.style_refs === 'INCLUDED') {
            warnings.push('style_refs_policy_mismatch');
        }
    }
    
    if (usage.subject_c.used_in_prompt !== true) {
        const newPolicy = usage.subject_c.detected ? 'DETECTED' : 'IGNORED';
        policy_applied.secondary_subject = newPolicy;
        if (policy_original.secondary_subject === 'INCLUDED') {
            warnings.push('secondary_subject_policy_mismatch');
        }
    }

    if (model_stage.enabled === false) {
        if (usage.subject_c.detected) warnings.push("subject_c_assigned_but_not_used");
        if (usage.refs.detected) warnings.push("refs_assigned_but_not_used");
    }

    const hud_lines: string[] = [];
    hud_lines.push(`Routing: ${routing}`);
    
    if (meta.policy_applied?.product_lock === "ON" && usage.subject_a.detected && !usage.subject_a.used_in_prompt) {
        hud_lines.push("A: PROD [LOCKED - Not Sent]");
    } else if (usage.subject_a.overlayed) {
        hud_lines.push("A: PROD [USED: Overlay]");
    } else if (usage.subject_a.used_in_prompt) {
        hud_lines.push("A: USED [Prompt Only]");
    } else if (usage.subject_a.detected) {
        if (module === 'scene_creator') hud_lines.push("A: PROD [Hint Source Only]");
        else hud_lines.push("A: DETECTED [Not Sent]");
    } else {
        hud_lines.push("A: NONE");
    }

    if (routing === 'PIXEL_LOCK_OVERLAY') {
        hud_lines.push("B: BG [Base]");
    } else if (usage.subject_b.used_in_prompt) {
        if (usage.subject_b.reason.includes("background context")) {
             hud_lines.push("B: USED [Prompt Only]");
        } else {
             hud_lines.push("B: BG [USED: Context]");
        }
    } else if (usage.subject_b.detected) {
        hud_lines.push("B: DETECTED [Not Sent]");
    } else {
        hud_lines.push("B: NONE");
    }

    if (!usage.subject_c.detected) {
        hud_lines.push("C: NONE");
    } else {
        if (model_stage.enabled === false) hud_lines.push("C: DETECTED [Not Used: model_stage=OFF]");
        else if (model_stage.enabled === null) hud_lines.push("C: DETECTED [UsedInPrompt=UNKNOWN]");
        else if (usage.subject_c.used_in_prompt) hud_lines.push("C: USED [Prompt Only]");
        else hud_lines.push("C: DETECTED [Not Used: not in images_sent]");
    }

    if (usage.refs.detected) {
        const n = usage.refs.count;
        if (model_stage.enabled === false) hud_lines.push(`Refs: ${n} [Not Used: model_stage=OFF]`);
        else if (model_stage.enabled === null) hud_lines.push(`Refs: ${n} [UsedInPrompt=UNKNOWN]`);
        else if (usage.refs.used_in_prompt) hud_lines.push(`Refs: ${n} [USED: Prompt Only]`);
        else hud_lines.push(`Refs: ${n} [Not Used: not in images_sent]`);
    }

    if (meta.placement_hint) {
        const { preset, anchor, scale, offsetX, offsetY, safeBox } = meta.placement_hint;
        hud_lines.push(`Placement: ${preset} | ${anchor} | scale=${scale.toFixed(2)} | off=(${offsetX},${offsetY})`);
        hud_lines.push(`SafeBox: x=${safeBox.x.toFixed(2)} y=${safeBox.y.toFixed(2)} w=${safeBox.w.toFixed(2)} h=${safeBox.h.toFixed(2)}`);
    }

    return {
        ...meta,
        model_stage, 
        slots, 
        policy_applied, 
        policy_applied_original: policy_original, 
        usage,
        hud_lines,
        warnings
    };
}