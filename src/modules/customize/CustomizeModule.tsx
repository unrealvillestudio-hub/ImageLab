import React, { useState, useMemo } from "react";
import { CUSTOMIZE_STRATEGIES, StrategyId, IntentId } from "../../config/customizeOutputs.ts";
import { Label, ResetButton, WarningBanner } from "../../ui/components.tsx";
import { RunControlButton } from "../../ui/RunControlButton.tsx";
import { useLibraryStore } from "../../ui/stores/libraryStore.tsx";
import { PromptWindow } from "../../ui/PromptWindow.tsx";
import { ModuleTips } from "../../ui/ModuleTips.tsx";
import { compositeProductOverBackground } from "../../utils/composite.ts";
import { cropToDataUrl } from "../../utils/image.ts";
import { safeId, downloadDataUrl } from "../../utils/imageUtils.ts";
import { createDebugMetadataHelper } from "../../core/debug/debugUtils.ts";
import { DebugMetadata } from "../../core/types.ts";
import { buildCustomizeAudit } from "../../services/customize/audit.ts";
import { buildCustomizeJobs } from "./buildCustomizeJobs.ts";
import { CompositeSettingsPanel, CompositeValues } from "../../components/composite/CompositeSettingsPanel.tsx"; 
import { CompositePreviewPanel, CompositeRenderFn } from "../../components/composite/CompositePreviewPanel.tsx";
import { PipelineOutputGallery } from "../../components/gallery/PipelineOutputGallery.tsx";
import { OutputPreviewModal } from "../../components/preview/OutputPreviewModal.tsx";
import { useSessionOutputsStore, SessionOutput } from "../../state/sessionOutputsStore.ts";
import { StandardActiveSlots } from "../../components/slots/StandardActiveSlots.tsx";

export function CustomizeModule() {
    const { assets, activeSlots, assignSlot, promptTexts, setPromptText, resetWorkspace, setAssets } = useLibraryStore();
    const { items: globalOutputs, push: pushOutput, discard: discardOutput } = useSessionOutputsStore();
    
    const [strategyId, setStrategyId] = useState<StrategyId>("social");
    const [selectedOutputIds, setSelectedOutputIds] = useState<Set<string>>(new Set());
    const [compValues, setCompValues] = useState<CompositeValues>({ scale: 1.0, offsetX: 0, offsetY: 0, shadowOpacity: 0.4, shadowBlur: 15, ambientOcclusion: true });
    const [modalOpen, setModalOpen] = useState(false);
    const [modalIndex, setModalIndex] = useState(0);
    const [modalFilteredItems, setModalFilteredItems] = useState<SessionOutput[]>([]);

    const assetA = useMemo(() => assets.find(a => a.id === activeSlots.sourceA), [assets, activeSlots.sourceA]);
    const assetB = useMemo(() => assets.find(a => a.id === activeSlots.sourceB), [assets, activeSlots.sourceB]);
    const ref1 = useMemo(() => assets.find(a => a.id === activeSlots.ref1), [assets, activeSlots.ref1]);
    const strategyDef = useMemo(() => CUSTOMIZE_STRATEGIES.find((s) => s.id === strategyId) ?? CUSTOMIZE_STRATEGIES[0], [strategyId]);
    const selectedOutputs = useMemo(() => strategyDef?.outputs.filter((o) => (selectedOutputIds ?? new Set()).has(o.id)) ?? [], [strategyDef, selectedOutputIds]);

    const renderDeterministicComposite: CompositeRenderFn = async ({ bgUrl, productUrl, outW, outH, params }) => {
        let baseBg = bgUrl;
        if (outW && outH) baseBg = await cropToDataUrl({ dataUrl: bgUrl, targetWidth: outW, targetHeight: outH, outputMime: 'image/png', quality: 1.0 });
        if (productUrl) return await compositeProductOverBackground({ backgroundDataUrl: baseBg, productDataUrl: productUrl, placement: { anchor: 'center', scale: params.scale, offsetX: params.offsetX, offsetY: params.offsetY, shadow: { opacity: params.shadowOpacity, blur: params.shadowBlur, offsetY: 10, color: "#000000" }, ambientOcclusion: { enabled: params.ambientOcclusion, opacity: 0.5, blur: 20 }, transparencySensitive: true }, debugMode: false });
        return baseBg;
    };

    const handlePresetSelect = (type: 'single' | 'trio' | 'full') => {
        let count = type === 'single' ? 1 : type === 'trio' ? 3 : 6;
        setSelectedOutputIds(new Set(strategyDef.outputs.slice(0, count).map(o => o.id)));
    };

    const onGeneratePack = async (signal: AbortSignal) => {
        const jobs = buildCustomizeJobs({ slots: { subject_a: assetA, subject_b: assetB }, selectedOutputs: selectedOutputs.length ? selectedOutputs : strategyDef.outputs.slice(0,1), fineTune: compValues, authoringOutPx: selectedOutputs[0]?.dimensions || {w:1920, h:1080}, bgDimensions: assetB?.dimensions });
        for (const job of jobs) {
            if (signal.aborted) break;
            const finalUrl = await renderDeterministicComposite({ bgUrl: job.slots.subject_b.dataUrl, productUrl: job.slots.subject_a?.dataUrl, outW: job.target.w, outH: job.target.h, params: job.fine_tune });
            pushOutput({ id: safeId("cust"), module: "customize", createdAt: Date.now(), label: `${strategyDef.label} | ${job.output_label}`, outputTag: job.output_label, aspect: String(job.target.aspectRatio), w: job.target.w, h: job.target.h, imageUrl: finalUrl, metadata: createDebugMetadataHelper("customize", "DETERMINISTIC_COMPOSITE", { strategy: strategyId }, job.fine_tune, { sourceA: assetA, sourceB: assetB, ref1 }) });
        }
    };

    return (
        <div className="uv-panel animate-in fade-in">
            <div className="flex items-center justify-between mb-8">
                <h1 className="uv-h1">CUSTOMIZE <span>Station</span></h1>
                <ResetButton onClick={resetWorkspace} />
            </div>
            <ModuleTips moduleId="customize" />
            <div className="grid grid-cols-12 gap-8">
                <div className="col-span-6 flex flex-col gap-8">
                    <div className="h-[calc(100vh-170px)] flex items-center justify-center">
                        <div className="h-full aspect-video max-w-full">
                            <CompositePreviewPanel 
                                title="LIVE WORKBENCH PREVIEW" 
                                bgUrl={assetB?.dataUrl} 
                                productUrl={assetA?.dataUrl} 
                                enabled={!!assetB} 
                                outPx={selectedOutputs[0]?.dimensions || {w:1920, h:1080}} 
                                params={compValues} 
                                renderFn={renderDeterministicComposite} 
                                hint="Select Background (Slot B) to see live preview." 
                                className="h-full w-full" 
                            />
                        </div>
                    </div>
                    <PromptWindow title="USER PROMPT (TRACE ONLY)" value={promptTexts.customize || ""} onChange={v => setPromptText("customize", v)} placeholder="Add notes for this pack..." rows={2} />
                    <PipelineOutputGallery items={globalOutputs} currentModule="customize" onOpenIndex={(idx, filtered) => { setModalFilteredItems(filtered); setModalIndex(idx); setModalOpen(true); }} emptyMessage="Generated packs will appear here." />
                </div>
                <div className="col-span-6 flex flex-col gap-6 border-l border-white/5 pl-8">
                    <CompositeSettingsPanel enabled={!!assetA} values={compValues} onChange={setCompValues} meta={{ productPx: assetA?.dimensions, targetPx: {w:1920, h:1080} }} productDataUrl={assetA?.dataUrl} title="Composition Workbench" />
                    <div className="space-y-4">
                        <div className="uv-title mb-1.5">Pack Strategy</div>
                        <select className="uv-select" value={strategyId} onChange={e => setStrategyId(e.target.value as StrategyId)}>{CUSTOMIZE_STRATEGIES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
                    </div>
                    <div className="p-4 uv-panel border-white/10 flex flex-col gap-3">
                        <div className="flex justify-between items-center"><div className="uv-title">Pack Builder</div><span className="uv-label text-amber-500 bg-amber-500/10 px-2 py-1 rounded">Selected: {selectedOutputIds.size}</span></div>
                        <div className="flex gap-2">
                            {['single', 'trio', 'full'].map(t => <button key={t} onClick={() => handlePresetSelect(t as any)} className="flex-1 py-1 uv-btn uv-btn-ghost text-[9px]">{t}</button>)}
                        </div>
                        <div className="overflow-y-auto custom-scrollbar border border-white/5 rounded-lg bg-black/20 p-2 space-y-1 max-h-[120px]">
                            {strategyDef.outputs.map(spec => (
                                <div key={spec.id} onClick={() => { const n = new Set(selectedOutputIds); n.has(spec.id) ? n.delete(spec.id) : n.add(spec.id); setSelectedOutputIds(n); }} className={`flex items-center gap-2 p-1.5 rounded-lg cursor-pointer transition-all ${selectedOutputIds.has(spec.id) ? "bg-amber-500/10 border border-amber-500/30" : "hover:bg-white/5 border border-transparent"}`}>
                                    <div className={`w-2.5 h-2.5 rounded-full border flex items-center justify-center ${selectedOutputIds.has(spec.id) ? "border-amber-500 bg-amber-500" : "border-white/20"}`}>{selectedOutputIds.has(spec.id) && <div className="w-1 h-1 bg-black rounded-full" />}</div>
                                    <div className={`text-[10px] font-bold truncate ${selectedOutputIds.has(spec.id) ? "text-amber-500" : "text-white/60"}`}>{spec.label}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div><StandardActiveSlots slots={{ sourceA: assetA, sourceB: assetB, sourceC: null, ref1, ref2: null, ref3: null }} onAssign={(k, id) => assignSlot(k as any, id)} onClear={k => assignSlot(k as any, '')} activeKeys={['sourceA', 'sourceB']} /></div>
                    <RunControlButton label={`GENERATE PACK (${selectedOutputIds.size || 1})`} onRun={onGeneratePack} onRunningChange={() => {}} disabled={!assetB} className="w-full" />
                </div>
            </div>
            <OutputPreviewModal open={modalOpen} items={modalFilteredItems} index={modalIndex} onSetIndex={setModalIndex} onClose={() => setModalOpen(false)} onDiscard={discardOutput} onDownload={id => { const it = modalFilteredItems.find(x => x.id === id); if(it) downloadDataUrl(`${it.label}.png`, it.imageUrl); }} onAddToLibrary={async id => { const it = modalFilteredItems.find(x => x.id === id); if(it) setAssets(prev => [{ id: safeId("asset"), kind: 'product', label: it.label || "Output", dataUrl: it.imageUrl, createdAt: Date.now(), alphaDetected: false }, ...prev]); return true; }} />
        </div>
    );
}
