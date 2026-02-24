import React, { useMemo, useState, useEffect } from "react";
import { 
    Label, SubToolButton, ResetButton, ToggleFilter, WarningBanner 
} from "../../ui/components.tsx";
import { RunControlButton } from "../../ui/RunControlButton.tsx";
import { 
    AspectRatio, DebugMetadata, ToolId, SceneNegativeSpace, ModelStage, VARIANT_OPTIONS, PlacementHint, LibraryAssetKind, ASPECT_RATIOS, BrandProfile 
} from "../../core/types.ts";
import { BlueprintInputPanel, ParsedBlueprint } from "../../components/blueprint/BlueprintInputPanel.tsx";
import { SCENE_ARCHETYPES, buildSceneVariantPrompts } from "../../config/sceneArchetypes.ts";
import { AVATAR_CATALOG } from "../../config/avatarCatalog.ts";
import { ECOM_PRESETS } from "../../config/presets.ts";
import { BRANDS } from "../../config/brands.ts";
import { PERSON_BLUEPRINTS, getBlueprintsByBrand, PersonBlueprint } from "../../config/personBlueprints.ts";
import { LOCATION_BLUEPRINTS, getLocationsByBrand, LocationBlueprint, ArchetypeId } from "../../config/locationBlueprints.ts";
import { useLibraryStore } from "../../ui/stores/libraryStore.tsx";
import { useSessionOutputsStore } from "../../state/sessionOutputsStore.ts"; 
import { validateEcomSlots, validateSceneSlots, validateAvatarSlots, getKindMismatchWarnings } from "../../core/policies/slotValidation.ts";
import { createDebugMetadataHelper } from "../../core/debug/debugUtils.ts";
import { DebugOverlay } from "../../core/debug/DebugOverlay.tsx";
import { safeId, downloadDataUrl } from "../../utils/imageUtils.ts";
import { compositeProductOverBackground } from "../../utils/composite.ts";
import { generateImageFromPrompt, generateAvatar } from "../../services/gemini.ts";
import { ModuleTips } from "../../ui/ModuleTips.tsx";
import { CompositeSettingsPanel, CompositeValues } from "../../components/composite/CompositeSettingsPanel.tsx"; 
import { ToolsPreviewPane } from "../../components/preview/ToolsPreviewPane.tsx";
import { PipelineOutputGallery } from "../../components/gallery/PipelineOutputGallery.tsx";
import { OutputPreviewModal } from "../../components/preview/OutputPreviewModal.tsx";
import { PromptWindow } from "../../ui/PromptWindow.tsx";
import { StandardActiveSlots } from "../../components/slots/StandardActiveSlots.tsx";

interface ToolsModuleProps {
    activeSlots: {
        sourceA: string | null;
        sourceB: string | null;
        sourceC: string | null;
        ref1: string | null;
        ref2: string | null;
        ref3: string | null;
    };
    onAssignSlot: (key: any, id: string) => void;
    onSwapSlots: () => void;
    globalDebug: boolean;
}

export function ToolsModule({ 
    activeSlots, onAssignSlot, globalDebug
}: ToolsModuleProps) {
    const { assets, promptTexts, setPromptText, resetWorkspace, setAssets } = useLibraryStore();
    const { items: globalOutputs, push: pushOutput, discard: discardOutput } = useSessionOutputsStore(); 
    
    const [toolId, setToolId] = useState<ToolId>("scene");

    const sourceAssetA = useMemo(() => assets.find(x => x.id === activeSlots.sourceA), [assets, activeSlots.sourceA]);
    const sourceAssetB = useMemo(() => assets.find(x => x.id === activeSlots.sourceB), [assets, activeSlots.sourceB]);
    const sourceAssetC = useMemo(() => assets.find(x => x.id === activeSlots.sourceC), [assets, activeSlots.sourceC]);
    const ref1Asset = useMemo(() => assets.find(x => x.id === activeSlots.ref1), [assets, activeSlots.ref1]);
    const ref2Asset = useMemo(() => assets.find(x => x.id === activeSlots.ref2), [assets, activeSlots.ref2]);
    const ref3Asset = useMemo(() => assets.find(x => x.id === activeSlots.ref3), [assets, activeSlots.ref3]);

    const [compValues, setCompValues] = useState<CompositeValues>({
        scale: 1.0, offsetX: 0, offsetY: 0, shadowOpacity: 0.4, shadowBlur: 15, ambientOcclusion: true
    });
    
    const [sceneArchetype, setSceneArchetype] = useState("studio_minimal");
    const [sceneNS, setSceneNS] = useState<SceneNegativeSpace>("right_third");
    const [sceneAR, setSceneAR] = useState<AspectRatio>(ASPECT_RATIOS.STORY);
    const [sceneVariants, setSceneVariants] = useState<number>(3);
    const [prodBatchSize, setProdBatchSize] = useState<number>(3); 
    const [avatarBaseStyle, setAvatarBaseStyle] = useState<string>(AVATAR_CATALOG.basePortraitStyles[0].id);
    const [avatarStrictIdentity, setAvatarStrictIdentity] = useState(true);
    const [avatarCreativity, setAvatarCreativity] = useState<1|2|3>(2);
    const [avatarBatchSize, setAvatarBatchSize] = useState<number>(3);
    const [avatarAR, setAvatarAR] = useState<AspectRatio>(ASPECT_RATIOS.PORTRAIT);

    // Blueprint State
    const [sceneActiveBlueprint, setSceneActiveBlueprint] = useState<ParsedBlueprint | null>(null);
    const [avatarActiveBlueprint, setAvatarActiveBlueprint] = useState<ParsedBlueprint | null>(null);
    const [vpActiveBlueprint, setVpActiveBlueprint] = useState<ParsedBlueprint | null>(null);

    // VideoPodcast State
    const [vpStep, setVpStep] = useState(1);
    const [vpArchetype, setVpArchetype] = useState<ArchetypeId>("studio_setup");
    const [vpBrandId, setVpBrandId] = useState<string>("");
    const [vpPersonA, setVpPersonA] = useState<string>("");
    const [vpPersonB, setVpPersonB] = useState<string>("");
    const [vpLocationId, setVpLocationId] = useState<string>("");
    const [vpSelectedAngles, setVpSelectedAngles] = useState<string[]>([]);
    const [vpVariants, setVpVariants] = useState<number>(1);

    // ─── BRAND CHANGE: explicit manual handler ────────────────────────────────
    // ONLY called when user manually changes brand via dropdown.
    // Blueprint loading bypasses this — it sets values directly.
    const handleBrandChange = (newBrandId: string) => {
        setVpBrandId(newBrandId);
        setVpActiveBlueprint(null); // clear blueprint when brand changes manually
        setVpPersonA("");
        setVpPersonB("");
        setVpLocationId("");
        setVpSelectedAngles([]);
    };

    // ─── BLUEPRINT SYNC: fires when a blueprint is loaded ────────────────────
    // Sets brand + person/location directly. No race conditions, no flags.
    useEffect(() => {
        if (!vpActiveBlueprint) return;

        const raw = vpActiveBlueprint.raw as any;
        const bpBrandId = raw.brandId as string;

        if (vpActiveBlueprint.type === 'person') {
            setVpBrandId(bpBrandId);
            setVpPersonA(vpActiveBlueprint.id);
            // Don't clear personB or location — user may have set them already
        }

        if (vpActiveBlueprint.type === 'location') {
            setVpBrandId(bpBrandId);
            setVpLocationId(vpActiveBlueprint.id);
            if (raw.recommended_angles?.length) {
                setVpSelectedAngles(raw.recommended_angles.slice(0, 3));
            }
        }
    }, [vpActiveBlueprint]);

    // ─── EFFECTIVE BRAND ID for Step 2 dropdowns ─────────────────────────────
    // Uses blueprint's brandId directly so dropdowns populate even before
    // React processes the setVpBrandId state update.
    const effectiveBrandId = (vpActiveBlueprint?.raw as any)?.brandId ?? vpBrandId;

    const [livePreviewUrl, setLivePreviewUrl] = useState<string | null>(null);
    const [fullScreenPreview, setFullScreenPreview] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [modalIndex, setModalIndex] = useState(0);
    const [modalFilteredItems, setModalFilteredItems] = useState<any[]>([]);

    const ecomValidation = useMemo(() => validateEcomSlots(sourceAssetA, sourceAssetB, sourceAssetC, ref1Asset, ref2Asset), [sourceAssetA, sourceAssetB, sourceAssetC, ref1Asset, ref2Asset]);
    const sceneValidation = useMemo(() => validateSceneSlots(sourceAssetA, false), [sourceAssetA]);
    const avatarValidation = useMemo(() => validateAvatarSlots(activeSlots, assets, avatarStrictIdentity), [activeSlots, assets, avatarStrictIdentity]);

    const currentValidation = useMemo(() => {
        if (toolId === 'scene') return sceneValidation;
        if (toolId === 'product') return ecomValidation;
        if (toolId === 'avatar') return avatarValidation;
        if (toolId === 'videopodcast') {
            const eBrand = (vpActiveBlueprint?.raw as any)?.brandId ?? vpBrandId;
            if (!eBrand) return { isValid: false, severity: "error", message: "Select a Brand first" };
            if (!vpPersonA) return { isValid: false, severity: "error", message: "Select Person A" };
            if (vpArchetype !== 'single_talking_head' && !vpPersonB) return { isValid: false, severity: "error", message: "Select Person B" };
            if (!vpLocationId) return { isValid: false, severity: "error", message: "Select a Location" };
            if (vpSelectedAngles.length === 0) return { isValid: false, severity: "error", message: "Select at least one angle" };
            return { isValid: true, severity: "ok", message: "" };
        }
        return { isValid: true, severity: "ok", message: "" };
    }, [toolId, sceneValidation, ecomValidation, avatarValidation, vpBrandId, vpActiveBlueprint, vpPersonA, vpPersonB, vpArchetype, vpLocationId, vpSelectedAngles]);

    const activeKeys = useMemo(() => {
        const keys: string[] = [];
        if (toolId === 'scene') { if (sourceAssetA) keys.push('sourceA'); if (sourceAssetB) keys.push('sourceB'); }
        else if (toolId === 'product') { if (sourceAssetA) keys.push('sourceA'); if (sourceAssetB) keys.push('sourceB'); }
        else if (toolId === 'avatar') { if (sourceAssetA) keys.push('sourceA'); if (sourceAssetB) keys.push('sourceB'); if (ref1Asset) keys.push('ref1'); if (ref2Asset) keys.push('ref2'); if (ref3Asset) keys.push('ref3'); }
        else if (toolId === 'videopodcast') { /* Uses blueprints, no direct slots */ }
        return keys;
    }, [toolId, sourceAssetA, sourceAssetB, ref1Asset, ref2Asset, ref3Asset]);

    const isExecutionBlocked = useMemo(() => {
        if (toolId === 'scene') return sceneValidation.severity === 'error';
        if (toolId === 'product') return ecomValidation.severity === 'error';
        if (toolId === 'avatar') return avatarValidation.severity === 'error'; 
        if (toolId === 'videopodcast') {
            const eBrand = (vpActiveBlueprint?.raw as any)?.brandId ?? vpBrandId;
            return vpStep < 3 || !eBrand || !vpPersonA || (vpArchetype !== 'single_talking_head' && !vpPersonB) || !vpLocationId || vpSelectedAngles.length === 0;
        }
        return false;
    }, [toolId, sceneValidation, ecomValidation, avatarValidation, vpStep, vpBrandId, vpActiveBlueprint, vpPersonA, vpPersonB, vpArchetype, vpLocationId, vpSelectedAngles]);

    const kindMismatchWarnings = useMemo(() => getKindMismatchWarnings(sourceAssetA, sourceAssetB, toolId === 'avatar' ? 'person' : 'product'), [toolId, sourceAssetA, sourceAssetB]);

    useEffect(() => {
        const updatePreview = async () => {
            if (toolId === 'product') {
                if (!sourceAssetA || !sourceAssetB) { setLivePreviewUrl(null); return; }
                try {
                    const url = await compositeProductOverBackground({
                        backgroundDataUrl: sourceAssetB.dataUrl,
                        productDataUrl: sourceAssetA.dataUrl,
                        placement: { anchor: "center", scale: compValues.scale, offsetX: compValues.offsetX, offsetY: compValues.offsetY, shadow: { opacity: compValues.shadowOpacity, blur: compValues.shadowBlur, offsetY: 10, color: "#000000" }, ambientOcclusion: { enabled: compValues.ambientOcclusion, opacity: 0.5, blur: 20, offsetY: 5 }, transparencySensitive: true },
                        debugMode: false
                    });
                    setLivePreviewUrl(url);
                } catch (e) { setLivePreviewUrl(null); }
            } else if (toolId === 'avatar' && sourceAssetA && sourceAssetB) {
                try {
                    const url = await compositeProductOverBackground({
                        backgroundDataUrl: sourceAssetB.dataUrl, 
                        productDataUrl: sourceAssetA.dataUrl, 
                        placement: { anchor: "center", scale: compValues.scale, offsetX: compValues.offsetX, offsetY: compValues.offsetY, shadow: { opacity: compValues.shadowOpacity, blur: compValues.shadowBlur, offsetY: 10, color: "#000000" }, ambientOcclusion: { enabled: compValues.ambientOcclusion, opacity: 0.5, blur: 20, offsetY: 5 }, transparencySensitive: true },
                        debugMode: false
                    });
                    setLivePreviewUrl(url);
                } catch (e) { setLivePreviewUrl(null); }
            } else { setLivePreviewUrl(null); }
        };
        const t = setTimeout(updatePreview, 100);
        return () => clearTimeout(t);
    }, [toolId, sourceAssetA, sourceAssetB, compValues]);

    const applyEcomPreset = (id: string) => {
        const p = ECOM_PRESETS.find(x => x.id === id);
        if (p) setCompValues(prev => ({ ...prev, scale: p.params.scale, shadowOpacity: p.params.shadowOpacity, shadowBlur: p.params.shadowBlur, offsetY: p.params.offsetY, ambientOcclusion: p.params.aoEnabled }));
    };

    const onGenerateScenes = async (signal: AbortSignal) => {
        const userPrompt = promptTexts.tools_scene || "";
        let customBrief = sceneArchetype === 'custom' ? userPrompt : undefined;
        
        if (sceneActiveBlueprint && sceneActiveBlueprint.type === 'location') {
            const raw = sceneActiveBlueprint.raw as any;
            const bpDesc = raw.visual?.description || "";
            const bpLight = raw.visual?.lighting || "";
            const bpSig = raw.visual?.signature_elements?.join(", ") || "";
            const bpParams = raw.imagelab || {};
            customBrief = (customBrief || "") + ` ${bpDesc}. Lighting: ${bpLight}. Elements: ${bpSig}. Style: ${bpParams.realism_level || ""}, ${bpParams.film_look || ""}, ${bpParams.lens_preset || ""}.`;
        }

        const prompts = buildSceneVariantPrompts({ archetype: sceneArchetype, negativeSpace: sceneNS, variants: sceneVariants, customBrief, userPrompt: userPrompt });
        const allReferences = [];
        if (sourceAssetB) allReferences.push({ dataUrl: sourceAssetB.dataUrl, label: `Fondo: ${sourceAssetB.label}` });
        for (let i = 0; i < prompts.length; i++) {
            if (signal.aborted) throw new DOMException("Aborted", "AbortError");
            let genImg = await generateImageFromPrompt({ prompt: prompts[i] + ". Negative: text, product", aspectRatio: sceneAR, size: "2k", referenceImages: allReferences, signal });
            pushOutput({ id: safeId("scene"), module: "tools" as any, createdAt: Date.now(), label: `Scene ${i+1}`, imageUrl: genImg, metadata: globalDebug ? createDebugMetadataHelper("scene_creator", "scene_only", { mode: "SCENE_ONLY" }, { archetype: sceneArchetype, user_prompt: userPrompt, blueprint: sceneActiveBlueprint?.id }, { sourceA: sourceAssetA, sourceB: sourceAssetB }, i, sceneVariants, [], { enabled: true, prompt_built: true, images_sent: [] }) : undefined, aspect: sceneAR });
        }
    };

    const onRunProductComposite = async (signal: AbortSignal) => {
        for(let i=0; i < prodBatchSize; i++) {
            if (signal.aborted) throw new DOMException("Aborted", "AbortError");
            const composite = await compositeProductOverBackground({ backgroundDataUrl: sourceAssetB!.dataUrl, productDataUrl: sourceAssetA!.dataUrl, placement: { anchor: "center", scale: compValues.scale, offsetX: compValues.offsetX, offsetY: compValues.offsetY, shadow: { opacity: compValues.shadowOpacity, blur: compValues.shadowBlur, offsetY: 10 }, ambientOcclusion: { enabled: compValues.ambientOcclusion, opacity: 0.5, blur: 20 }, transparencySensitive: true } });
            pushOutput({ id: safeId("prod"), module: "tools" as any, createdAt: Date.now(), label: `Ecom Var ${i+1}`, imageUrl: composite, metadata: globalDebug ? createDebugMetadataHelper("ecommerce_studio", "PIXEL_LOCK_OVERLAY", { subject_a: "PIXEL_LOCK" }, { ...compValues, user_prompt: promptTexts.tools_product }, { sourceA: sourceAssetA, sourceB: sourceAssetB }, i, prodBatchSize, [], { enabled: false }) : undefined, w: 1000, h: 1000 });
            await new Promise(r => setTimeout(r, 50));
        }
    };

    const onGenerateAvatar = async (signal: AbortSignal) => {
        let subjectA = sourceAssetA ? { dataUrl: sourceAssetA.dataUrl, label: sourceAssetA.label } : undefined;
        let subjectB = sourceAssetB && sourceAssetB.kind === 'person' ? { dataUrl: sourceAssetB.dataUrl, label: sourceAssetB.label } : undefined;
        let background = sourceAssetB && sourceAssetB.kind === 'background' ? { dataUrl: sourceAssetB.dataUrl, label: sourceAssetB.label } : undefined;
        const styleRefs = [];
        if (ref1Asset) styleRefs.push({ dataUrl: ref1Asset.dataUrl, label: ref1Asset.label });
        if (ref2Asset) styleRefs.push({ dataUrl: ref2Asset.dataUrl, label: ref2Asset.label });
        if (ref3Asset) styleRefs.push({ dataUrl: ref3Asset.dataUrl, label: ref3Asset.label });
        const base = AVATAR_CATALOG.basePortraitStyles.find(x => x.id === avatarBaseStyle);
        
        let finalPrompt = promptTexts.tools_avatar || "";
        let customRules = "";
        if (avatarActiveBlueprint && avatarActiveBlueprint.type === 'person') {
            const raw = avatarActiveBlueprint.raw as any;
            finalPrompt += ` ${raw.imagelab?.description || ""}`;
            customRules += `Portrait photography, ${raw.imagelab?.style || ""}. Compliance: ${raw.compliance_notes || ""}. `;
            customRules += `Lens: ${raw.imagelab?.lens_preset || "85mm"}. DOF: shallow. Skin: ${raw.imagelab?.skin_detail || "realistic"}.`;
        }
        for (let i = 0; i < avatarBatchSize; i++) {
             if (signal.aborted) throw new DOMException("Aborted", "AbortError");
             const res = await generateAvatar({ aspectRatio: avatarAR, baseStyleRules: base?.rules || "", contextRules: "Studio " + customRules, roleRules: "Model", enableRefs: styleRefs.length > 0, allowMirrors: false, strictIdentity: avatarStrictIdentity, creativityLevel: avatarCreativity, subjectA, subjectB, background, styleRefs: styleRefs.length > 0 ? styleRefs : undefined, userPrompt: finalPrompt, signal });
             pushOutput({ id: safeId("avatar"), module: "tools" as any, createdAt: Date.now(), label: `Avatar ${i+1}`, imageUrl: res, metadata: globalDebug ? createDebugMetadataHelper("avatar_generator", "avatar_render", { identity_lock: "STRICT" }, { user_prompt: finalPrompt, blueprint: avatarActiveBlueprint?.id }, { sourceA: sourceAssetA, sourceB: sourceAssetB, ref1: ref1Asset, ref2: ref2Asset, ref3: ref3Asset }, i, avatarBatchSize, [], { enabled: true, prompt_built: true, images_sent: ['subject_a'] }) : undefined, aspect: avatarAR });
        }
    };

    const onGenerateVideoPodcast = async (signal: AbortSignal) => {
        const location = LOCATION_BLUEPRINTS.find(l => l.id === vpLocationId);
        const personA = PERSON_BLUEPRINTS.find(p => p.id === vpPersonA);
        const personB = PERSON_BLUEPRINTS.find(p => p.id === vpPersonB);

        if (!location || !personA) return;

        for (const angle of vpSelectedAngles) {
            for (let v = 0; v < vpVariants; v++) {
                if (signal.aborted) throw new DOMException("Aborted", "AbortError");

                let prompt = `${location.visual.description}. `;
                prompt += `${personA.imagelab.description}. `;
                if (vpArchetype !== 'single_talking_head' && personB) {
                    prompt += `${personB.imagelab.description}. `;
                }
                prompt += `Camera angle: ${angle}. `;
                prompt += `Style: ${location.imagelab.realism_level}, ${location.imagelab.film_look}, lens ${location.imagelab.lens_preset}, depth of field ${location.imagelab.depth_of_field}. `;
                prompt += `Compliance: ${personA.compliance_notes || ""}`;
                if (personB) prompt += ` ${personB.compliance_notes || ""}`;

                const genImg = await generateImageFromPrompt({
                    prompt,
                    aspectRatio: "16:9",
                    size: "2k",
                    signal
                });

                pushOutput({
                    id: safeId("vp"),
                    module: "tools" as any,
                    createdAt: Date.now(),
                    label: `VP ${angle} ${v + 1}`,
                    imageUrl: genImg,
                    metadata: {
                        module: "tools_videopodcast",
                        archetype: vpArchetype,
                        location: vpLocationId,
                        angle,
                        persona_a: vpPersonA,
                        persona_b: vpPersonB || undefined,
                        blueprint_used: vpActiveBlueprint?.id,
                        timestamp: new Date().toISOString()
                    },
                    aspect: "16:9"
                });
            }
        }
    };

    const previewEmptyText = useMemo(() => {
        if (toolId === 'scene') return "Preview not available for Scene Gen (Direct Output)";
        if (toolId === 'product') return "Preview requires Product + Background";
        if (toolId === 'avatar') return "Preview available when Source A + B assigned";
        return "No Preview";
    }, [toolId]);

    const targetPx = useMemo(() => sourceAssetB?.dimensions || { w: 1080, h: 1080 }, [sourceAssetB]);

    const handleAddToLibrary = async (itemId: string): Promise<boolean> => {
        const item = modalFilteredItems.find(o => o.id === itemId);
        if (!item) return false;
        let kind: LibraryAssetKind = item.module === 'tools_scene' ? 'background' : (item.module === 'tools_avatar' ? 'person' : 'product');
        setAssets(prev => [{ id: safeId("asset"), kind, label: item.label || "Output", dataUrl: item.imageUrl, createdAt: Date.now(), alphaDetected: false }, ...prev]);
        return true;
    };

    return (
        <div className="uv-panel animate-in fade-in">
            {globalDebug && <DebugOverlay title="Tools Debug" items={{ tool: toolId }} />}

            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-4">
                <h2 className="uv-h1">Tools <span>Studio</span></h2>
                <div className="h-6 w-px bg-white/10 mx-2"></div>
                <div className="flex bg-white/5 p-1 rounded-full border border-white/5 gap-2">
                    <SubToolButton active={toolId === 'scene'} onClick={() => setToolId('scene')} label="Scene Gen" />
                    <SubToolButton active={toolId === 'avatar'} onClick={() => setToolId('avatar')} label="Avatar Gen" />
                    <SubToolButton active={toolId === 'product'} onClick={() => setToolId('product')} label="E-com Studio" />
                    <SubToolButton active={toolId === 'videopodcast'} onClick={() => setToolId('videopodcast')} label="VideoPodcast" />
                </div>
              </div>
              <ResetButton onClick={() => resetWorkspace()} />
            </div>

            {toolId === 'scene' && <ModuleTips moduleId="scene_gen" />}
            {toolId === 'product' && <ModuleTips moduleId="ecomm_studio" />}
            {toolId === 'avatar' && <ModuleTips moduleId="avatar_gen" />}
            {toolId === 'videopodcast' && <ModuleTips moduleId="videopodcast_gen" />}

            <div className="mb-8 grid grid-cols-12 gap-8">
                <div className="col-span-7 h-[42vh] min-h-[280px] max-h-[520px]">
                    <ToolsPreviewPane title="Preview" previewUrl={livePreviewUrl} emptyMessage={previewEmptyText} onFullScreen={() => setFullScreenPreview(true)} className="h-full" />
                </div>

                <div className="col-span-5 flex flex-col gap-4">
                    {toolId === 'product' && (
                        <CompositeSettingsPanel enabled={!!sourceAssetA && !!sourceAssetB} values={compValues} onChange={setCompValues} meta={{ productPx: sourceAssetA?.dimensions, targetPx }} productDataUrl={sourceAssetA?.dataUrl} title="Workbench Parameters" />
                    )}
                    <StandardActiveSlots slots={{ sourceA: sourceAssetA, sourceB: sourceAssetB, sourceC: sourceAssetC, ref1: ref1Asset, ref2: ref2Asset, ref3: ref3Asset }} onAssign={onAssignSlot} onClear={(key) => onAssignSlot(key as any, '')} activeKeys={activeKeys} />
                    {isExecutionBlocked && <WarningBanner title="CONFIGURATION ERROR" message={currentValidation.message} />}
                    {kindMismatchWarnings.map((msg, idx) => <WarningBanner key={idx} message={msg} />)}
                </div>
            </div>

            {toolId === 'scene' && (
                <div className="space-y-8 animate-in fade-in">
                    <BlueprintInputPanel 
                        label="Cargar Location Blueprint" 
                        allowedTypes={['location']} 
                        activeBlueprint={sceneActiveBlueprint}
                        onBlueprintCleared={() => {
                            setSceneActiveBlueprint(null);
                            setPromptText("tools_scene", "");
                        }}
                        onBlueprintLoaded={(bp) => {
                            setSceneActiveBlueprint(bp);
                            const raw = bp.raw as any;
                            setPromptText("tools_scene", raw.visual?.description || "");
                        }}
                    />
                    <div className="grid grid-cols-2 gap-8">
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <div className="uv-title">Archetype</div>
                                <select value={sceneArchetype} onChange={e => setSceneArchetype(e.target.value)} className="uv-select">{SCENE_ARCHETYPES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <div className="uv-title">Aspect Ratio</div>
                                    <select value={sceneAR as any} onChange={e => setSceneAR(e.target.value as any)} className="uv-select">{Object.entries(ASPECT_RATIOS).map(([k,v]) => <option key={k} value={v as any}>{k} ({v as any})</option>)}</select>
                                </div>
                                <div className="space-y-2">
                                    <div className="uv-title">Variants</div>
                                    <select value={sceneVariants} onChange={(e) => setSceneVariants(Number(e.target.value))} className="uv-select">{(VARIANT_OPTIONS as any).map((v: any) => <option key={v} value={v}>{v} Variants</option>)}</select>
                                </div>
                            </div>
                        </div>
                    </div>
                    <PromptWindow title="USER PROMPT (OPTIONAL)" value={promptTexts.tools_scene || ""} onChange={(v) => setPromptText("tools_scene", v)} placeholder="Add extra details, style notes..." rows={3} />
                    <RunControlButton className="w-full" label="Generate Scene Backgrounds" onRun={onGenerateScenes} onRunningChange={() => {}} />
                </div>
            )}

            {toolId === 'avatar' && (
                <div className="space-y-8 animate-in fade-in">
                    <BlueprintInputPanel 
                        label="Cargar Person Blueprint" 
                        allowedTypes={['person']} 
                        activeBlueprint={avatarActiveBlueprint}
                        onBlueprintCleared={() => {
                            setAvatarActiveBlueprint(null);
                            setPromptText("tools_avatar", "");
                        }}
                        onBlueprintLoaded={(bp) => {
                            setAvatarActiveBlueprint(bp);
                            const raw = bp.raw as any;
                            setPromptText("tools_avatar", raw.imagelab?.description || "");
                        }}
                    />
                    <div className="grid grid-cols-3 gap-6">
                        <div className="space-y-2">
                            <div className="uv-title">Base Style</div>
                            <select value={avatarBaseStyle} onChange={(e) => setAvatarBaseStyle(e.target.value)} className="uv-select">
                                {AVATAR_CATALOG.basePortraitStyles.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <div className="uv-title">Aspect Ratio</div>
                            <select value={avatarAR as any} onChange={(e) => setAvatarAR(e.target.value as any)} className="uv-select">
                                {Object.entries(ASPECT_RATIOS).map(([k,v]) => <option key={k} value={v as any}>{k} ({v as any})</option>)}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <div className="uv-title">Batch Size</div>
                            <select value={avatarBatchSize} onChange={(e) => setAvatarBatchSize(Number(e.target.value))} className="uv-select">
                                {(VARIANT_OPTIONS as any).map((v: any) => <option key={v} value={v}>{v} Variants</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                         <div className="flex items-center justify-between bg-white/5 p-4 rounded-xl border border-white/5">
                            <div className="text-xs font-bold text-white/80">Strict Identity Lock</div>
                            <button onClick={() => setAvatarStrictIdentity(!avatarStrictIdentity)} className={`w-12 h-6 rounded-full transition-colors relative ${avatarStrictIdentity ? "bg-emerald-500" : "bg-white/10"}`}>
                                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${avatarStrictIdentity ? "left-7" : "left-1"}`} />
                            </button>
                        </div>
                        <div className="space-y-2">
                             <div className="uv-title">Creativity Level ({avatarCreativity})</div>
                             <input type="range" min="1" max="5" step="1" value={avatarCreativity} onChange={(e) => setAvatarCreativity(Number(e.target.value))} className="w-full accent-[#FFAB00]" />
                        </div>
                    </div>
                    <PromptWindow title="USER PROMPT (OPTIONAL)" value={promptTexts.tools_avatar || ""} onChange={(v) => setPromptText("tools_avatar", v)} placeholder="Describe the person, clothing, style..." rows={3} />
                    <RunControlButton className="w-full" label="Generate Avatars" onRun={onGenerateAvatar} onRunningChange={() => {}} disabled={isExecutionBlocked} />
                </div>
            )}

            {toolId === 'product' && (
                <div className="space-y-8 animate-in fade-in">
                    <div className="flex justify-between items-end gap-6">
                        <div className="flex-1 space-y-2">
                            <div className="uv-title">Quick Presets</div>
                            <select onChange={(e) => applyEcomPreset(e.target.value)} className="uv-select text-emerald-400"><option value="">-- Select Visual Preset --</option>{ECOM_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
                        </div>
                        <div className="w-40 space-y-2">
                            <div className="uv-title">Batch</div>
                            <select value={prodBatchSize} onChange={(e) => setProdBatchSize(Number(e.target.value))} className="uv-select">{(VARIANT_OPTIONS as any).map((v: any) => <option key={v} value={v}>{v} Variants</option>)}</select>
                        </div>
                    </div>
                    <PromptWindow title="USER PROMPT (TRACE ONLY)" value={promptTexts.tools_product || ""} onChange={(v) => setPromptText("tools_product", v)} placeholder="Notes for trace/audit..." rows={2} />
                    <RunControlButton className="w-full" label="Run Product Studio" onRun={onRunProductComposite} onRunningChange={() => {}} disabled={isExecutionBlocked} />
                </div>
            )}

            {toolId === 'videopodcast' && (
                <div className="space-y-8 animate-in fade-in">
                    {/* Stepper Header */}
                    <div className="flex items-center gap-4 mb-6">
                        {[1, 2, 3].map(s => (
                            <div key={s} className="flex items-center gap-2">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-colors ${vpStep >= s ? "bg-[#FFAB00] text-black" : "bg-white/5 text-white/40"}`}>
                                    {s}
                                </div>
                                <div className={`text-[10px] font-black uppercase tracking-widest ${vpStep === s ? "text-white" : "text-white/20"}`}>
                                    {s === 1 ? "Setup" : s === 2 ? "Persons & Location" : "Generation"}
                                </div>
                                {s < 3 && <div className="w-12 h-px bg-white/10 mx-2" />}
                            </div>
                        ))}
                    </div>

                    {/* ── STEP 1: SETUP ─────────────────────────────────────────────────── */}
                    {vpStep === 1 && (
                        <div className="grid grid-cols-2 gap-8 animate-in slide-in-from-bottom-4">
                            <div className="col-span-2">
                                <BlueprintInputPanel 
                                    label="Cargar Blueprint (Person/Location)" 
                                    allowedTypes={['person', 'location']} 
                                    activeBlueprint={vpActiveBlueprint}
                                    onBlueprintCleared={() => {
                                        setVpActiveBlueprint(null);
                                        // Don't auto-clear brand/person/location on clear
                                        // Let user decide
                                    }}
                                    onBlueprintLoaded={(bp) => {
                                        // Set blueprint — sync useEffect will handle
                                        // setting vpBrandId and vpPersonA/vpLocationId
                                        setVpActiveBlueprint(bp);
                                    }}
                                />
                            </div>
                            <div className="space-y-6">
                                <div className="space-y-2">
                                    <div className="uv-title">Archetype</div>
                                    <div className="grid grid-cols-2 gap-3">
                                        {[
                                            { id: "studio_setup", label: "Estudio Podcast" },
                                            { id: "car_front", label: "Coche — Asientos Delanteros" },
                                            { id: "car_rear", label: "Coche — Asiento Trasero" },
                                            { id: "street_interview", label: "Exterior / Calle" },
                                            { id: "salon_workshop", label: "Salón / Taller" },
                                            { id: "event_stage", label: "Tarima / Evento" },
                                            { id: "single_talking_head", label: "Single / Talking Head" }
                                        ].map(a => (
                                            <button 
                                                key={a.id} 
                                                onClick={() => setVpArchetype(a.id as ArchetypeId)}
                                                className={`p-4 rounded-2xl border text-left transition-all ${vpArchetype === a.id ? "bg-[#FFAB00]/10 border-[#FFAB00] text-[#FFAB00]" : "bg-white/5 border-white/5 text-white/60 hover:bg-white/10"}`}
                                            >
                                                <div className="text-xs font-bold">{a.label}</div>
                                                <div className="text-[9px] opacity-50 mt-1 uppercase tracking-widest">{a.id}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-6">
                                <div className="space-y-2">
                                    <div className="uv-title">Brand</div>
                                    <select 
                                        value={vpBrandId}
                                        onChange={e => handleBrandChange(e.target.value)}
                                        className="uv-select"
                                    >
                                        <option value="">-- Select Brand --</option>
                                        {BRANDS.filter(b => b.id !== 'new').map(b => (
                                            <option key={b.id} value={b.id}>{b.displayName}</option>
                                        ))}
                                    </select>
                                    {vpActiveBlueprint && (
                                        <div className="text-[10px] text-white/30 mt-1">
                                            Blueprint loaded — brand pre-selected. Change here to override.
                                        </div>
                                    )}
                                </div>
                                <button 
                                    disabled={!effectiveBrandId}
                                    onClick={() => setVpStep(2)}
                                    className="w-full py-4 rounded-full bg-white text-black font-black uppercase tracking-widest text-xs disabled:opacity-20 transition-all hover:scale-[1.02]"
                                >
                                    Next Step
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── STEP 2: PERSONS & LOCATION ────────────────────────────────────── */}
                    {vpStep === 2 && (
                        <div className="grid grid-cols-2 gap-8 animate-in slide-in-from-bottom-4">
                            <div className="space-y-6">
                                <div className="space-y-4">
                                    <div className="uv-title">Personas</div>
                                    <div className="space-y-4 p-4 bg-white/5 rounded-2xl border border-white/5">
                                        <div className="space-y-2">
                                            <Label>Persona A</Label>
                                            <select 
                                                value={vpPersonA} 
                                                onChange={e => setVpPersonA(e.target.value)} 
                                                className="uv-select"
                                            >
                                                <option value="">-- Select Person A --</option>
                                                {getBlueprintsByBrand(effectiveBrandId).map(p => (
                                                    <option key={p.id} value={p.id}>{p.displayName} ({p.role_default})</option>
                                                ))}
                                            </select>
                                        </div>
                                        {vpArchetype !== 'single_talking_head' && (
                                            <>
                                                <div className="space-y-2">
                                                    <Label>Persona B</Label>
                                                    <select 
                                                        value={vpPersonB} 
                                                        onChange={e => setVpPersonB(e.target.value)} 
                                                        className="uv-select"
                                                    >
                                                        <option value="">-- Select Person B --</option>
                                                        {getBlueprintsByBrand(effectiveBrandId)
                                                            .filter(p => p.id !== vpPersonA)
                                                            .map(p => (
                                                                <option key={p.id} value={p.id}>{p.displayName} ({p.role_default})</option>
                                                            ))
                                                        }
                                                        {getBlueprintsByBrand(effectiveBrandId).filter(p => p.id !== vpPersonA).length === 0 && (
                                                            <option disabled value="">— Add more blueprints for this brand —</option>
                                                        )}
                                                    </select>
                                                </div>
                                                <button 
                                                    onClick={() => {
                                                        const temp = vpPersonA;
                                                        setVpPersonA(vpPersonB);
                                                        setVpPersonB(temp);
                                                    }}
                                                    className="w-full py-2 rounded-xl bg-white/5 text-white/40 text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-colors"
                                                >
                                                    Swap Roles A/B
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-6">
                                <div className="space-y-4">
                                    <div className="uv-title">Location</div>
                                    <div className="space-y-4 p-4 bg-white/5 rounded-2xl border border-white/5">
                                        <div className="space-y-2">
                                            <Label>Select Location</Label>
                                            <select 
                                                value={vpLocationId} 
                                                onChange={e => {
                                                    setVpLocationId(e.target.value);
                                                    setVpSelectedAngles([]);
                                                }} 
                                                className="uv-select"
                                            >
                                                <option value="">-- Select Location --</option>
                                                {getLocationsByBrand(effectiveBrandId)
                                                    .filter(l => !vpArchetype || l.compatible_archetypes.includes(vpArchetype as ArchetypeId))
                                                    .map(l => (
                                                        <option key={l.id} value={l.id}>{l.displayName}</option>
                                                    ))
                                                }
                                            </select>
                                        </div>
                                        {vpLocationId && (() => {
                                            const loc = LOCATION_BLUEPRINTS.find(l => l.id === vpLocationId);
                                            if (!loc) return null;
                                            return (
                                                <div className="space-y-4 animate-in fade-in">
                                                    <div className="space-y-2">
                                                        <Label>Angles to Generate (Max 5)</Label>
                                                        <div className="flex flex-wrap gap-2">
                                                            {loc.recommended_angles.map((angle: string) => (
                                                                <button 
                                                                    key={angle}
                                                                    onClick={() => {
                                                                        if (vpSelectedAngles.includes(angle)) {
                                                                            setVpSelectedAngles(prev => prev.filter(a => a !== angle));
                                                                        } else if (vpSelectedAngles.length < 5) {
                                                                            setVpSelectedAngles(prev => [...prev, angle]);
                                                                        }
                                                                    }}
                                                                    className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${vpSelectedAngles.includes(angle) ? "bg-[#FFAB00] text-black" : "bg-white/5 text-white/40 hover:bg-white/10"}`}
                                                                >
                                                                    {angle}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2 p-3 bg-black/40 rounded-xl border border-white/5">
                                                        <div className="text-[9px] text-white/30 uppercase font-black">Realism: <span className="text-white/60">{loc.imagelab.realism_level}</span></div>
                                                        <div className="text-[9px] text-white/30 uppercase font-black">Film: <span className="text-white/60">{loc.imagelab.film_look}</span></div>
                                                        <div className="text-[9px] text-white/30 uppercase font-black">Lens: <span className="text-white/60">{loc.imagelab.lens_preset}</span></div>
                                                        <div className="text-[9px] text-white/30 uppercase font-black">DOF: <span className="text-white/60">{loc.imagelab.depth_of_field}</span></div>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                                <div className="flex gap-4">
                                    <button onClick={() => setVpStep(1)} className="flex-1 py-4 rounded-full bg-white/5 text-white/60 font-black uppercase tracking-widest text-xs hover:bg-white/10 transition-all">Back</button>
                                    <button 
                                        disabled={
                                            !vpLocationId || 
                                            vpSelectedAngles.length === 0 || 
                                            !vpPersonA || 
                                            (vpArchetype !== 'single_talking_head' && !vpPersonB)
                                        }
                                        onClick={() => setVpStep(3)}
                                        className="flex-[2] py-4 rounded-full bg-white text-black font-black uppercase tracking-widest text-xs disabled:opacity-20 transition-all hover:scale-[1.02]"
                                    >
                                        Review & Generate
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── STEP 3: GENERATION ────────────────────────────────────────────── */}
                    {vpStep === 3 && (
                        <div className="space-y-8 animate-in slide-in-from-bottom-4">
                            <div className="grid grid-cols-3 gap-6">
                                <div className="p-6 bg-white/5 rounded-[32px] border border-white/5 space-y-4">
                                    <div className="uv-title">Setup Summary</div>
                                    <div className="space-y-2">
                                        <div className="text-[10px] text-white/40 uppercase font-black">Archetype</div>
                                        <div className="text-sm font-bold text-[#FFAB00]">{vpArchetype}</div>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="text-[10px] text-white/40 uppercase font-black">Brand</div>
                                        <div className="text-sm font-bold">{BRANDS.find(b => b.id === effectiveBrandId)?.displayName}</div>
                                    </div>
                                </div>
                                <div className="p-6 bg-white/5 rounded-[32px] border border-white/5 space-y-4">
                                    <div className="uv-title">Cast & Crew</div>
                                    <div className="space-y-2">
                                        <div className="text-[10px] text-white/40 uppercase font-black">Person A</div>
                                        <div className="text-sm font-bold">{PERSON_BLUEPRINTS.find(p => p.id === vpPersonA)?.displayName}</div>
                                    </div>
                                    {vpArchetype !== 'single_talking_head' && (
                                        <div className="space-y-2">
                                            <div className="text-[10px] text-white/40 uppercase font-black">Person B</div>
                                            <div className="text-sm font-bold">{PERSON_BLUEPRINTS.find(p => p.id === vpPersonB)?.displayName}</div>
                                        </div>
                                    )}
                                </div>
                                <div className="p-6 bg-white/5 rounded-[32px] border border-white/5 space-y-4">
                                    <div className="uv-title">Location & Angles</div>
                                    <div className="space-y-2">
                                        <div className="text-[10px] text-white/40 uppercase font-black">Location</div>
                                        <div className="text-sm font-bold">{LOCATION_BLUEPRINTS.find(l => l.id === vpLocationId)?.displayName}</div>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="text-[10px] text-white/40 uppercase font-black">Angles ({vpSelectedAngles.length})</div>
                                        <div className="flex flex-wrap gap-1">
                                            {vpSelectedAngles.map(a => <span key={a} className="text-[9px] bg-white/10 px-2 py-0.5 rounded-full text-white/60 uppercase font-bold">{a}</span>)}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between p-6 bg-[#FFAB00]/5 rounded-[32px] border border-[#FFAB00]/20">
                                <div className="flex items-center gap-8">
                                    <div className="space-y-2">
                                        <div className="uv-title">Variants per Angle</div>
                                        <div className="flex gap-2">
                                            {[1, 3].map(v => (
                                                <button 
                                                    key={v} 
                                                    onClick={() => setVpVariants(v)}
                                                    className={`px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all ${vpVariants === v ? "bg-[#FFAB00] text-black" : "bg-white/5 text-white/40 hover:bg-white/10"}`}
                                                >
                                                    {v} Var
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="h-12 w-px bg-white/10" />
                                    <div className="space-y-1">
                                        <div className="text-[10px] text-white/40 uppercase font-black">Total Images</div>
                                        <div className="text-2xl font-black text-[#FFAB00]">{vpSelectedAngles.length * vpVariants}</div>
                                    </div>
                                </div>
                                <div className="flex gap-4">
                                    <button onClick={() => setVpStep(2)} className="px-8 py-4 rounded-full bg-white/5 text-white/60 font-black uppercase tracking-widest text-xs hover:bg-white/10 transition-all">Back</button>
                                    <RunControlButton 
                                        className="min-w-[240px]" 
                                        label="Generar Escenas VideoPodcast" 
                                        onRun={onGenerateVideoPodcast} 
                                        onRunningChange={() => {}} 
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="mt-12 pt-10 border-t border-white/5">
                <PipelineOutputGallery items={globalOutputs} currentModule="tools" onOpenIndex={(idx, filtered) => { setModalFilteredItems(filtered); setModalIndex(idx); setModalOpen(true); }} emptyMessage="No Tools outputs yet." />
            </div>

            <OutputPreviewModal open={modalOpen} items={modalFilteredItems} index={modalIndex} onSetIndex={setModalIndex} onClose={() => setModalOpen(false)} onDiscard={discardOutput} onDownload={id => { const item = modalFilteredItems.find(o => o.id === id); if(item) downloadDataUrl(`${item.label}.png`, item.imageUrl); }} onAddToLibrary={handleAddToLibrary} />
            {fullScreenPreview && livePreviewUrl && (
                <div className="fixed inset-0 z-[2000] bg-black/98 backdrop-blur-md flex items-center justify-center animate-in fade-in duration-200">
                    <button onClick={() => setFullScreenPreview(false)} className="absolute top-6 right-6 w-12 h-12 bg-white/10 hover:bg-white/20 rounded-full text-white text-2xl font-black z-50">×</button>
                    <img src={livePreviewUrl} className="max-w-full max-h-full object-contain shadow-2xl" />
                </div>
            )}
        </div>
    );
}