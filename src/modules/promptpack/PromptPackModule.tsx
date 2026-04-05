import React, { useState, useEffect, useMemo } from "react";
import { Label, ResetButton, ToggleFilter } from "../../ui/components.tsx";
import { RunControlButton } from "../../ui/RunControlButton.tsx";
import { 
    PromptPackValidationResult, DebugMetadata, CreativityLevel, ModelStage, PlacementHint, VARIANT_OPTIONS, PromptPackV1, LibraryAssetKind 
} from "../../core/types.ts";
import { parsePromptPackJson, runPromptPack } from "../../services/promptpack.ts";
import PsychoLayerSelector from "../../services/components/PsychoLayerSelector.tsx";
import { buildPsychoVisualInjection } from "../../services/psychoPresetLoader.ts";
import type { PsychoPreset } from "../../services/psychoPresetLoader.ts";
import { validatePromptPackPolicy, validateSlotsICR } from "../../core/policies/slotValidation.ts";
import { createDebugMetadataHelper } from "../../core/debug/debugUtils.ts";
import { useLibraryStore } from "../../ui/stores/libraryStore.tsx";
import { useSessionOutputsStore } from "../../state/sessionOutputsStore.ts"; 
import { safeId, downloadDataUrl } from "../../utils/imageUtils.ts";
import { DebugOverlay } from "../../core/debug/DebugOverlay.tsx";
import { ModuleTips } from "../../ui/ModuleTips.tsx";
import { PipelineOutputGallery } from "../../components/gallery/PipelineOutputGallery.tsx"; 
import { OutputPreviewModal } from "../../components/preview/OutputPreviewModal.tsx";
import { StandardActiveSlots } from "../../components/slots/StandardActiveSlots.tsx";

interface PromptPackModuleProps {
    activeSlots: {
        sourceA: string | null;
        sourceB: string | null;
        sourceC: string | null;
        ref1: string | null;
        ref2: string | null;
        ref3: string | null;
    };
    onSwapSlots: () => void;
    globalDebug: boolean;
}

export function PromptPackModule({ activeSlots, globalDebug }: PromptPackModuleProps) {
    const { assets, setAssets } = useLibraryStore();
    const { items: globalOutputs, push: pushOutput, discard: discardOutput } = useSessionOutputsStore();

    const [ppIncludeAsset, setPpIncludeAsset] = useState(true);
    const [ppIncludePeople, setPpIncludePeople] = useState(true);
    const [ppRaw, setPpRaw] = useState("");
    const [ppCreativity, setPpCreativity] = useState<CreativityLevel>(2);
    const [isRunning, setIsRunning] = useState(false);
    const [ppVariants, setPpVariants] = useState<number>(3);
    const [psychoPreset, setPsychoPreset] = useState<PsychoPreset | null>(null); 

    const [modalOpen, setModalOpen] = useState(false);
    const [modalIndex, setModalIndex] = useState(0);
    const [modalFilteredItems, setModalFilteredItems] = useState<any[]>([]);

    const [ppValidation, setPpValidation] = useState<PromptPackValidationResult>({ isValid: false, isBlocked: false, errors: [], canSwapSlots: false, status: "NOT_READY" });
    
    const sourceAssetA = useMemo(() => assets.find(x => x.id === activeSlots.sourceA), [assets, activeSlots.sourceA]);
    const sourceAssetB = useMemo(() => assets.find(x => x.id === activeSlots.sourceB), [assets, activeSlots.sourceB]);

    const slotValidation = useMemo(() => {
        if (!ppIncludeAsset) return { isValid: true, severity: "ok", message: "Asset inclusion disabled.", canAutoFixBySwap: false };
        return validateSlotsICR(activeSlots, assets);
    }, [activeSlots, assets, ppIncludeAsset]);

    useEffect(() => {
        const res = validatePromptPackPolicy(ppRaw, sourceAssetA, sourceAssetB, ppIncludeAsset, ppIncludePeople);
        setPpValidation(res);
    }, [ppRaw, sourceAssetA, sourceAssetB, ppIncludeAsset, ppIncludePeople]);

    const onRunPromptPack = async (signal: AbortSignal) => {
        if (!ppRaw.trim()) { alert("Por favor, pega un JSON de PromptPack válido."); return; }
        const pack = JSON.parse(ppRaw) as PromptPackV1;
        if (!pack.inputs) pack.inputs = {};
        if (ppIncludeAsset && sourceAssetA) pack.inputs.source_asset = { dataUrl: sourceAssetA.dataUrl, label: sourceAssetA.label };
        if (sourceAssetB) pack.inputs.reference_images = [{ dataUrl: sourceAssetB.dataUrl, label: sourceAssetB.label }];
        
        const res = await runPromptPack({ pack, overrideCreativity: ppCreativity, variantCount: ppVariants, signal, psychoPreset });
        res.items.forEach(item => {
            pushOutput({ id: safeId("res"), module: "promptpack", createdAt: Date.now(), label: item.label, imageUrl: item.imageDataUrl, metadata: globalDebug ? createDebugMetadataHelper("promptpack", "gemini_runner", { global: "Standard" }, { creativity: ppCreativity }, { sourceA: sourceAssetA, sourceB: sourceAssetB }, item.variant_index, ppVariants) : undefined });
        });
    };

    const handleAddToLibrary = async (itemId: string): Promise<boolean> => {
        const item = modalFilteredItems.find(o => o.id === itemId);
        if (!item) return false;
        setAssets(prev => [{ id: safeId("asset"), kind: 'background', label: item.label || "Output", dataUrl: item.imageUrl, createdAt: Date.now(), alphaDetected: false }, ...prev]);
        return true;
    };

    return (
        <div className="uv-panel animate-in fade-in">
            {globalDebug && <DebugOverlay title="PromptPack Runner" items={{ status: ppValidation.status }} />}
            <div className="flex items-center justify-between mb-8">
                <h1 className="uv-h1">PROMPTPACK <span>Runner</span></h1>
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-4 border-r border-white/5 pr-6">
                       <ToggleFilter label="Asset (Src A)" active={ppIncludeAsset} onChange={setPpIncludeAsset} />
                       <ToggleFilter label="People Refs" active={ppIncludePeople} onChange={setPpIncludePeople} />
                    </div>
                    <ResetButton onClick={() => setPpRaw("")} />
                </div>
            </div>
            <ModuleTips moduleId="promptpack" />
            {slotValidation.severity === 'error' && <div className="uv-warning mb-6"><div className="uv-label text-red-500 mb-1">SLOT ERROR</div><div className="text-[10px] opacity-80">{slotValidation.message}</div></div>}
            <div className="mb-8 grid grid-cols-2 gap-8 items-end">
                <div className="space-y-4">
                    <div className="uv-title mb-2">Outputs</div>
                    <select value={ppVariants} onChange={e => setPpVariants(Number(e.target.value))} className="uv-select">{VARIANT_OPTIONS.map(v => <option key={v} value={v}>{v} Variants</option>)}</select>
                </div>
                <div className="space-y-4">
                    <div className="uv-title mb-2">Creativity</div>
                    <div className="flex gap-2">{[1, 2, 3].map(v => <button key={v} onClick={() => setPpCreativity(v as any)} className={`flex-1 py-3 uv-btn text-[10px] ${ppCreativity === v ? "uv-tab--active" : "uv-btn-ghost"}`}>{v}</button>)}</div>
                </div>
            </div>
            <div className="mb-8 space-y-2">
                <div className="uv-title mb-2">JSON Specifications</div>
                <textarea className="uv-input h-[380px] font-mono text-amber-200/70" value={ppRaw} onChange={e => setPpRaw(e.target.value)} placeholder="Paste PromptPack JSON..." />
            </div>
            <div className="my-4"><PsychoLayerSelector selected={psychoPreset} onSelect={setPsychoPreset} /></div>
            <div className="flex justify-center"><RunControlButton label="Ejecutar Pipeline" onRun={onRunPromptPack} onRunningChange={setIsRunning} disabled={ppValidation.status === "BLOCKED"} /></div>
            <div className="mt-12 pt-10 border-t border-white/5"><PipelineOutputGallery items={globalOutputs} currentModule="promptpack" onOpenIndex={(idx, filtered) => { setModalFilteredItems(filtered); setModalIndex(idx); setModalOpen(true); }} emptyMessage="No outputs yet." /></div>
            <OutputPreviewModal open={modalOpen} items={modalFilteredItems} index={modalIndex} onSetIndex={setModalIndex} onClose={() => setModalOpen(false)} onDiscard={discardOutput} onDownload={id => { const it = modalFilteredItems.find(x => x.id === id); if(it) downloadDataUrl(`${it.label}.png`, it.imageUrl); }} onAddToLibrary={handleAddToLibrary} />
        </div>
    );
}
