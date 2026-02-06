
import React, { useMemo, useState, useRef, useEffect } from "react";
import JSZip from "jszip";
import { BRANDS } from "./config/brands";
import { PACKS } from "./config/packs";
import { UNREALVILLE_LOGO_BASE64 } from "./constants/logo";
import { AVATAR_CATALOG, CatalogItem, StylePackItem } from "./config/avatarCatalog";
import type {
  AspectRatio,
  LibraryAsset,
  LibraryAssetKind,
  PersonType,
  SceneNegativeSpace,
} from "./types";
import { ASPECT_RATIOS } from "./types";
import { generateImageFromPrompt, generateAvatar } from "./services/gemini";
import { parsePromptPackJson, runPromptPack } from "./services/promptpack";
import { SCENE_ARCHETYPES, buildSceneVariantPrompts } from "./config/sceneArchetypes";
import {
  downloadDataUrl,
  readFileAsDataUrl,
  safeId,
  detectAssetKind,
  defaultPlacementForNegativeSpace,
} from "./utils/imageUtils";
import { compositeProductOverBackground, computeProductHash } from "./utils/composite";

type TabId = "promptpack" | "tools" | "customize";
type ToolId = "scene" | "avatar" | "product";
type IntegrationMode = "overlay" | "generative";

interface DebugMetadata {
  timestamp: string;
  module: string;
  model: string;
  seed?: string;
  variant_index?: number;
  variants_total?: number;
  routing: string;
  slots: {
      subject_a: { asset_id: string; label: string; kind: string; alpha_detected: boolean };
      subject_b: { asset_id: string; label: string; kind: string; alpha_detected: boolean };
      background?: { asset_id: string; label: string; kind: string; alpha_detected: boolean };
      ref1?: { asset_id: string; label: string; kind: string };
      ref2?: { asset_id: string; label: string; kind: string };
  };
  policy_applied: Record<string, string>;
  params: Record<string, any>;
  warnings: string[];
}

// --- UI Components ---
function TabButton({ active, onClick, children }: React.PropsWithChildren<{ active: boolean; onClick: () => void }>) {
  return (
    <button onClick={onClick} className={`px-6 py-2.5 rounded-full text-xs font-bold tracking-widest uppercase transition-all duration-300 ${active ? "bg-[#FFAB00] text-black shadow-[0_0_20px_rgba(255,171,0,0.3)]" : "bg-white/5 text-[#EBEBEB] hover:bg-white/10 border border-white/5"}`}>{children}</button>
  );
}

function SubToolButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${active ? "bg-[#FFAB00]/20 text-[#FFAB00] border border-[#FFAB00]/40" : "text-white/40 hover:text-white/60"}`}>{label}</button>
  );
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="px-4 py-2 rounded-full border border-red-500/30 text-red-500 text-[9px] font-black uppercase tracking-widest hover:bg-red-500/10 transition-all flex items-center gap-2">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4L20 20M4 20L20 4" /></svg> Reset
    </button>
  );
}

function Label({ children, help }: React.PropsWithChildren<{ help?: string }>) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <label className="text-[10px] font-black uppercase tracking-widest text-[#FFD77A] pl-1 block">{children}</label>
      {help && (
        <div className="group relative">
           <div className="w-3 h-3 rounded-full border border-white/20 text-white/40 flex items-center justify-center text-[8px] cursor-help">?</div>
           <div className="absolute left-full top-0 ml-2 w-48 p-2 bg-black border border-white/10 rounded-lg text-[9px] text-white/80 leading-tight opacity-0 group-hover:opacity-100 pointer-events-none z-50 transition-opacity">
             {help}
           </div>
        </div>
      )}
    </div>
  );
}

function ToggleFilter({ label, active, onChange, help }: { label: string, active: boolean, onChange: (v: boolean) => void, help?: string }) {
  return (
    <div className="flex items-center gap-3 cursor-pointer select-none group" onClick={() => onChange(!active)}>
      <div className={`w-9 h-5 rounded-full transition-all relative shadow-inner ${active ? "bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.4)]" : "bg-white/10"}`}>
        <div className={`absolute top-1 w-3 h-3 rounded-full bg-black shadow-sm transition-all ${active ? "left-5" : "left-1"}`} />
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-black uppercase tracking-widest transition-colors ${active ? "text-emerald-400" : "text-white/20 group-hover:text-white/40"}`}>{label}</span>
        {help && (
            <div className="group/tooltip relative">
            <div className="w-3 h-3 rounded-full border border-white/20 text-white/40 flex items-center justify-center text-[8px]">?</div>
            <div className="absolute left-full top-0 ml-2 w-48 p-2 bg-black border border-white/10 rounded-lg text-[9px] text-white/80 leading-tight opacity-0 group-hover/tooltip:opacity-100 pointer-events-none z-50 transition-opacity">
                {help}
            </div>
            </div>
        )}
      </div>
    </div>
  );
}

function ControlSlider({ label, value, onChange, min, max, step, help, presets }: { 
    label: string, value: number, onChange: (v: number) => void, min: number, max: number, step: number, help?: string, presets?: { label: string, val: number }[]
}) {
    return (
        <div className="space-y-2">
            <div className="flex justify-between items-center">
                <Label help={help}>{label}</Label>
                <input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value))} step={step} className="w-12 bg-black/40 border border-white/10 rounded px-1 text-[10px] text-right text-[#FFAB00]"/>
            </div>
            <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} className="w-full accent-[#FFAB00] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer" />
            {presets && (
                <div className="flex gap-1 justify-end">
                    {presets.map(p => (
                        <button key={p.label} onClick={() => onChange(p.val)} className="px-2 py-1 bg-white/5 hover:bg-white/10 rounded text-[8px] text-white/40 uppercase font-bold">{p.label}</button>
                    ))}
                </div>
            )}
        </div>
    );
}

function DebugOverlay({ title, items, expanded }: { title: string, items: Record<string, string>, expanded?: boolean }) {
    const baseClasses = "absolute z-50 p-4 bg-black/95 border border-emerald-500/50 rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.2)] font-mono pointer-events-none";
    const layoutClasses = expanded 
        ? "top-8 left-8 right-8 text-sm" 
        : "top-4 right-4 max-w-xs text-[9px]";

    return (
        <div className={`${baseClasses} ${layoutClasses}`}>
            <h4 className={`${expanded ? "text-lg mb-4" : "text-[10px] mb-2"} font-black uppercase text-emerald-500 border-b border-emerald-900 pb-1 flex justify-between`}>
                <span>{title}</span>
                {expanded && <span className="opacity-50">DEBUG MODE ACTIVE</span>}
            </h4>
            <div className={`space-y-1 ${expanded ? "grid grid-cols-2 gap-x-8 gap-y-2 space-y-0" : ""}`}>
                {Object.entries(items).map(([k,v]) => (
                    <div key={k} className="flex justify-between gap-4 border-b border-white/5 py-1">
                        <span className="text-white/40 uppercase">{k}:</span>
                        <span className="text-emerald-300 font-bold truncate">{v}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function App() {
  const [globalDebug, setGlobalDebug] = useState(() => {
      try { return localStorage.getItem("global_debug") === "true" } catch { return false }
  });
  const [showDebugToggle, setShowDebugToggle] = useState(false);

  useEffect(() => localStorage.setItem("global_debug", String(globalDebug)), [globalDebug]);

  const [tab, setTab] = useState<TabId>("promptpack");
  const [toolId, setToolId] = useState<ToolId>("scene");
  const [libTab, setLibTab] = useState<"assets" | "people">("assets");
  const [library, setLibrary] = useState<LibraryAsset[]>([]);
  
  const [activeSlots, setActiveSlots] = useState<{
      sourceA: string | null;
      sourceB: string | null;
      ref1: string | null;
      ref2: string | null;
      ref3: string | null;
  }>({ sourceA: null, sourceB: null, ref1: null, ref2: null, ref3: null });

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<Array<{title: string, dataUrl: string, metadata?: DebugMetadata}>>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const [ppHistory, setPpHistory] = useState<Array<{id: string, title: string, dataUrl: string, metadata?: DebugMetadata}>>([]);
  const [toolsHistory, setToolsHistory] = useState<Array<{id: string, title: string, dataUrl: string, metadata?: DebugMetadata}>>([]);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [ppIncludeAsset, setPpIncludeAsset] = useState(true);
  const [ppIncludePeople, setPpIncludePeople] = useState(true);
  const [ppRaw, setPpRaw] = useState("");
  const [ppCreativity, setPpCreativity] = useState<1|2|3>(2);
  const [ppRunning, setPpRunning] = useState(false);

  // LIVE PREVIEW STATE
  const [livePreviewUrl, setLivePreviewUrl] = useState<string | null>(null);
  const [fullScreenPreview, setFullScreenPreview] = useState(false);

  // SCENE CREATOR
  const [sceneArchetype, setSceneArchetype] = useState("studio_minimal");
  const [sceneNS, setSceneNS] = useState<SceneNegativeSpace>("right_third");
  const [sceneAR, setSceneAR] = useState<AspectRatio>(ASPECT_RATIOS.STORY);
  const [sceneVariants, setSceneVariants] = useState<number>(3);
  const [sceneCustomBrief, setSceneCustomBrief] = useState("");
  const [sceneUserPrompt, setSceneUserPrompt] = useState(""); 
  const [sceneRunning, setSceneRunning] = useState(false);
  const [sceneComposite, setSceneComposite] = useState(true);
  const [sceneIntegrationMode, setSceneIntegrationMode] = useState<IntegrationMode>("overlay");
  const [sceneScale, setSceneScale] = useState(1.0);
  const [sceneShadow, setSceneShadow] = useState(0.55);

  // E-COMMERCE PRODUCT STUDIO
  const [prodScale, setProdScale] = useState(1.0);
  const [prodOffsetX, setProdOffsetX] = useState(0);
  const [prodOffsetY, setProdOffsetY] = useState(0);
  const [prodShadowOpacity, setProdShadowOpacity] = useState(0.4);
  const [prodShadowBlur, setProdShadowBlur] = useState(15);
  const [prodAO, setProdAO] = useState(true); 
  const [prodRunning, setProdRunning] = useState(false);
  const [prodJson, setProdJson] = useState("");
  const [prodNotes, setProdNotes] = useState("");
  const [prodBatchSize, setProdBatchSize] = useState<number>(3); 
  
  // Local Debug Flag (Ecom) - Synced with Global but kept for slider control if needed?
  // We will force it to follow Global Debug for the "Advanced" requirement
  const [debugMode, setDebugMode] = useState(globalDebug); 
  useEffect(() => setDebugMode(globalDebug), [globalDebug]);

  // AVATAR GENERATOR (NEW STATE)
  const [avatarBaseStyle, setAvatarBaseStyle] = useState(AVATAR_CATALOG.basePortraitStyles[0].id);
  const [avatarContextStyle, setAvatarContextStyle] = useState(AVATAR_CATALOG.contextStyles[0].id);
  const [avatarContextPreset, setAvatarContextPreset] = useState(AVATAR_CATALOG.contextStyles[0].presets![0].id);
  const [avatarRole, setAvatarRole] = useState(AVATAR_CATALOG.roles[0].id);
  const [avatarRolePreset, setAvatarRolePreset] = useState("");
  const [avatarStylePack, setAvatarStylePack] = useState(""); // Style Pack selection
  const [avatarEnableRefs, setAvatarEnableRefs] = useState(false);
  const [avatarAllowMirrors, setAvatarAllowMirrors] = useState(false);
  const [avatarStrictIdentity, setAvatarStrictIdentity] = useState(true);
  const [avatarCreativity, setAvatarCreativity] = useState<1|2|3>(2);
  const [avatarUserPrompt, setAvatarUserPrompt] = useState("");
  const [avatarRunning, setAvatarRunning] = useState(false);
  const [avatarBatchSize, setAvatarBatchSize] = useState(3);
  const [avatarAR, setAvatarAR] = useState<AspectRatio>(ASPECT_RATIOS.PORTRAIT);
  
  // Implicit Mode State
  const [avatarMode, setAvatarMode] = useState<"solo" | "duo">("solo");

  const [brandId, setBrandId] = useState("D7Herbal");
  const [packId, setPackId] = useState("ig_organic_pack");

  const brand = useMemo(() => BRANDS.find(b => b.id === brandId) || BRANDS[0], [brandId]);
  const stylePack = useMemo(() => PACKS.find(p => p.id === packId) || PACKS[0], [packId]);

  const sourceAssetA = useMemo(() => library.find(x => x.id === activeSlots.sourceA), [library, activeSlots.sourceA]);
  const sourceAssetB = useMemo(() => library.find(x => x.id === activeSlots.sourceB), [library, activeSlots.sourceB]);
  const subject2 = useMemo(() => library.find(x => x.id === activeSlots.ref1), [library, activeSlots.ref1]);
  
  const activeRefAssets = useMemo(() => {
      const ids = [activeSlots.ref2, activeSlots.ref3].filter(Boolean) as string[];
      return library.filter(a => ids.includes(a.id));
  }, [library, activeSlots]);

  // Mode Auto-Detection for Avatar Generator
  useEffect(() => {
      if (subject2) {
          setAvatarMode("duo");
      } else {
          setAvatarMode("solo");
      }
  }, [subject2]);

  // STRICT GATING CHECKS: E-COMMERCE
  const ecomValidation = useMemo(() => {
      const errors = [];
      let canSwap = false;
      let fixTypesAvailable = false;

      if (!sourceAssetA || !sourceAssetB) return { valid: false, errors, canSwap, fixTypesAvailable };

      // Inverted Logic Check (A=Bg, B=Prod)
      const aIsLikelyBg = sourceAssetA.kind === 'background' || sourceAssetA.kind === 'reference';
      const bIsLikelyProd = sourceAssetB.kind === 'product' || sourceAssetB.kind === 'person';
      
      if (aIsLikelyBg && bIsLikelyProd) {
          canSwap = true;
          errors.push("Slot Mismatch: Background in Slot A, Product in Slot B.");
      }

      // Type Check (Strict)
      if (sourceAssetA.kind !== 'product' && sourceAssetA.kind !== 'person') {
          if (!canSwap) { 
             errors.push(`Slot A invalid: Kind is '${sourceAssetA.kind}', expected 'product'.`);
             fixTypesAvailable = true;
          }
      }
      if (sourceAssetB.kind !== 'background' && sourceAssetB.kind !== 'reference' && sourceAssetB.kind !== 'unknown') {
          if (!canSwap) {
             errors.push(`Slot B invalid: Kind is '${sourceAssetB.kind}', expected 'background'.`);
             fixTypesAvailable = true;
          }
      }

      return { valid: errors.length === 0, errors, canSwap, fixTypesAvailable };
  }, [sourceAssetA, sourceAssetB]);

  // STRICT GATING CHECKS: SCENE CREATOR
  const sceneValidation = useMemo(() => {
      let valid = true;
      let warning = false;
      const errors: string[] = [];
      let canSwap = false;

      if (sceneComposite) {
          // Check inversion logic
          const aIsBg = sourceAssetA?.kind === 'background' || sourceAssetA?.kind === 'reference';
          const bIsProd = sourceAssetB && (sourceAssetB.kind === 'product' || sourceAssetB.kind === 'person');
          
          if (aIsBg && bIsProd) {
              canSwap = true;
          }

          if (sceneIntegrationMode === 'overlay') {
              // STRICT OVERLAY MODE
              if (canSwap) {
                  valid = false;
                  errors.push("Slots Inverted: Background in A, Product in B.");
              } else {
                  if (sourceAssetA && sourceAssetA.kind !== 'product' && sourceAssetA.kind !== 'person' && sourceAssetA.kind !== 'unknown') {
                      valid = false;
                      errors.push(`Overlay requires Product/Person in Slot A. Found: ${sourceAssetA.kind}`);
                  }
                  if (sourceAssetB && (sourceAssetB.kind === 'product' || sourceAssetB.kind === 'person')) {
                       valid = false;
                       errors.push(`Slot B invalid: Kind is '${sourceAssetB.kind}', expected 'background'.`);
                  }
              }
          } else {
              // AI FUSION (Soft Warning)
              if (canSwap) {
                  warning = true;
                  errors.push("Recommendation: Swap slots for best results (A=Product, B=Background).");
              }
          }
      }
      return { valid, warning, errors, canSwap };
  }, [sceneComposite, sceneIntegrationMode, sourceAssetA, sourceAssetB]);

  // Compute available Style Packs based on Base & Context
  const availableStylePacks = useMemo(() => {
      return AVATAR_CATALOG.stylePacks.filter(sp => {
          const baseMatch = sp.allowed_base.includes(avatarBaseStyle);
          const ctxMatch = sp.allowed_context.includes(avatarContextStyle);
          return baseMatch || ctxMatch; // Loose matching for UX, can be strict if needed
      });
  }, [avatarBaseStyle, avatarContextStyle]);

  // Product Hash for Debug
  const productHash = useMemo(() => sourceAssetA ? computeProductHash(sourceAssetA.dataUrl).substring(0,8) : "", [sourceAssetA]);

  // LIVE PREVIEW EFFECT
  useEffect(() => {
      const updatePreview = async () => {
          const isEcom = toolId === 'product' && sourceAssetA && sourceAssetB;
          const isSceneOverlay = toolId === 'scene' && sceneComposite && sceneIntegrationMode === 'overlay' && sourceAssetA;
          
          if (!isEcom && !isSceneOverlay) {
              setLivePreviewUrl(null);
              return;
          }

          let bgUrl = "";
          let prodUrl = sourceAssetA!.dataUrl;
          let placement: any = {};

          if (isEcom) {
              bgUrl = sourceAssetB!.dataUrl;
              placement = {
                  anchor: "center",
                  scale: prodScale,
                  offsetX: prodOffsetX,
                  offsetY: prodOffsetY,
                  shadow: {
                      opacity: prodShadowOpacity,
                      blur: prodShadowBlur,
                      offsetY: 10,
                      color: "#000000"
                  },
                  ambientOcclusion: {
                      enabled: prodAO,
                      opacity: 0.5,
                      blur: 20,
                      offsetY: 5
                  },
                  transparencySensitive: true
              };
          } else if (isSceneOverlay) {
              if (sourceAssetB) {
                  bgUrl = sourceAssetB.dataUrl;
              } else {
                  setLivePreviewUrl(null);
                  return;
              }
              
              placement = { 
                  ...defaultPlacementForNegativeSpace(sceneNS), 
                  scale: sceneScale, 
                  shadow: { opacity: sceneShadow, blur: 18 } 
              };
          }

          try {
              const debugInfo = globalDebug ? {
                  routing: isEcom ? "PIXEL_LOCK_OVERLAY" : "OVERLAY",
                  shadow: `${placement.shadow?.opacity} / ${placement.shadow?.blur}px`,
                  AO: placement.ambientOcclusion?.enabled ? "ON" : "OFF"
              } : undefined;

              const url = await compositeProductOverBackground({
                  backgroundDataUrl: bgUrl,
                  productDataUrl: prodUrl,
                  placement: placement,
                  debugMode: globalDebug,
                  debugInfo
              });
              setLivePreviewUrl(url);
          } catch (e) {
              console.warn("Live Preview Render Failed:", e);
          }
      };

      const t = setTimeout(updatePreview, 100);
      return () => clearTimeout(t);

  }, [
      toolId, sourceAssetA, sourceAssetB, 
      prodScale, prodOffsetX, prodOffsetY, prodShadowOpacity, prodShadowBlur, prodAO,
      sceneComposite, sceneIntegrationMode, sceneScale, sceneShadow, sceneNS,
      globalDebug
  ]);

  const addToLibrary = async (label: string, dataUrl: string, explicitKind?: LibraryAssetKind) => {
    let kind = explicitKind;
    let alphaDetected = false;
    
    // Auto-inference logic
    if (!kind) {
        if (libTab === 'people') {
            kind = 'person';
            alphaDetected = true; // Assume people uploads might have alpha or user intends strict lock
        } else {
            const detected = await detectAssetKind(dataUrl);
            kind = detected.kind;
            alphaDetected = detected.alphaDetected;
        }
    } else {
        // If kind is explicit, check alpha anyway for metadata
        const detected = await detectAssetKind(dataUrl);
        alphaDetected = detected.alphaDetected;
    }
    
    const type: PersonType | undefined = kind === 'person' ? 'real' : undefined;
    setLibrary(prev => [{ id: safeId("asset"), kind: kind!, label, dataUrl, type, alphaDetected, createdAt: Date.now() }, ...prev]);
  };

  const updateAssetKind = (assetId: string, newKind: LibraryAssetKind) => {
      setLibrary(prev => prev.map(a => a.id === assetId ? { ...a, kind: newKind } : a));
  };

  const deleteGeneratedItem = (id: string, from: 'promptpack' | 'tools') => {
    if (from === 'promptpack') { setPpHistory(prev => prev.filter(i => i.id !== id)); } 
    else { setToolsHistory(prev => prev.filter(i => i.id !== id)); }
    if (previewOpen) setPreviewOpen(false);
  };

  const openPreview = (items: Array<{id: string, title: string, dataUrl: string, metadata?: DebugMetadata}>, index: number) => {
    setPreviewItems(items); setPreviewIndex(index); setZoom(1); setOffset({ x: 0, y: 0 }); setPreviewOpen(true);
  };

  const openLibraryPreview = (asset: LibraryAsset) => {
      openPreview([{ id: asset.id, title: asset.label, dataUrl: asset.dataUrl }], 0);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault(); const delta = e.deltaY > 0 ? 0.9 : 1.1; setZoom(z => Math.max(0.2, Math.min(10, z * delta)));
  };
  const handleMouseDown = (e: React.MouseEvent) => { setIsDragging(true); dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }; };
  const handleMouseMove = (e: React.MouseEvent) => { if (!isDragging) return; setOffset({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }); };
  const handleMouseUp = () => setIsDragging(false);

  const swapSlots = () => {
      setActiveSlots(prev => ({
          ...prev,
          sourceA: prev.sourceB,
          sourceB: prev.sourceA
      }));
  };

  const fixTypesForEcom = () => {
      if (sourceAssetA && sourceAssetA.kind !== 'product') updateAssetKind(sourceAssetA.id, 'product');
      if (sourceAssetB && sourceAssetB.kind !== 'background') updateAssetKind(sourceAssetB.id, 'background');
  };

  const assignSlot = (slotKey: keyof typeof activeSlots, assetId: string) => {
      if (activeSlots[slotKey] === assetId) {
          setActiveSlots(prev => ({ ...prev, [slotKey]: null }));
          return;
      }
      setActiveSlots(prev => ({ ...prev, [slotKey]: assetId }));
  };

  const downloadMetadata = (meta: any, filename: string) => {
      const blob = new Blob([JSON.stringify(meta, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
  };

  // STRICT METADATA BUILDER (ICR v1 Compliant)
  const createDebugMetadata = (
      module: string, 
      routing: string, 
      policy: Record<string, string>, 
      params: any,
      variantIdx?: number, 
      totalVariants?: number,
      warnings: string[] = []
  ): DebugMetadata => ({
      timestamp: new Date().toISOString(),
      module,
      model: "gemini-2.5-flash-image", // Default abstraction
      routing,
      slots: {
          subject_a: sourceAssetA ? { asset_id: sourceAssetA.id, label: sourceAssetA.label, kind: sourceAssetA.kind, alpha_detected: !!sourceAssetA.alphaDetected } : {} as any,
          subject_b: sourceAssetB ? { asset_id: sourceAssetB.id, label: sourceAssetB.label, kind: sourceAssetB.kind, alpha_detected: !!sourceAssetB.alphaDetected } : {} as any,
          ref1: subject2 ? { asset_id: subject2.id, label: subject2.label, kind: subject2.kind } : undefined,
      },
      policy_applied: policy,
      params,
      variant_index: variantIdx,
      variants_total: totalVariants,
      warnings: warnings
  });

  const resetSceneTools = () => {
    setSceneArchetype("studio_minimal");
    setSceneNS("right_third");
    setSceneAR(ASPECT_RATIOS.STORY);
    setSceneVariants(3);
    setSceneCustomBrief("");
    setSceneUserPrompt("");
    setSceneComposite(true);
    setSceneIntegrationMode("overlay");
    setSceneScale(1.0);
    setSceneShadow(0.55);
  };

  const resetProductTools = () => {
      setProdJson("");
      setProdNotes("");
      setProdScale(1.0);
      setProdOffsetX(0);
      setProdOffsetY(0);
      setProdAO(true); 
      setActiveSlots(prev => ({ ...prev, sourceA: null, sourceB: null }));
      setToolsHistory(prev => prev.filter(i => !i.id.startsWith("prod")));
  };

  const resetAvatarTools = () => {
      setAvatarUserPrompt("");
      setToolsHistory(prev => prev.filter(i => !i.id.startsWith("avatar")));
  }

  const setVariantsFromEvent = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSceneVariants(parseInt(e.target.value));
  };

  const onRunPromptPack = async () => {
    if (!ppRaw.trim()) { alert("Por favor, pega un JSON de PromptPack válido."); return; }
    
    // HARDENING: PROMPTPACK POLICY CHECK
    try {
        const packCheck = parsePromptPackJson(ppRaw);
        if (packCheck.jobs) {
            for (const job of packCheck.jobs) {
                if (job.slot_policies?.subject_a === 'PIXEL_LOCK') {
                    if (sourceAssetA && sourceAssetA.kind !== 'product' && sourceAssetA.kind !== 'person') {
                        alert(`Job "${job.label}" requires PIXEL_LOCK (Product/Person) in Slot A. Found: ${sourceAssetA.kind}.\nPlease check inputs or SWAP slots.`);
                        return;
                    }
                }
            }
        }
    } catch (e) {
        console.warn("Pre-run check failed", e);
    }

    setPpRunning(true);
    try {
      const pack = parsePromptPackJson(ppRaw);
      if (!pack.inputs) pack.inputs = {};
      
      if (ppIncludeAsset && sourceAssetA) {
          pack.inputs.source_asset = { dataUrl: sourceAssetA.dataUrl, label: sourceAssetA.label };
      }
      
      const explicitRefs = [activeSlots.ref1, activeSlots.ref2, activeSlots.ref3]
          .map(id => library.find(a => a.id === id))
          .filter(Boolean)
          .map(a => ({ dataUrl: a!.dataUrl, label: a!.label }));

      if (explicitRefs.length > 0) {
          pack.inputs.reference_images = explicitRefs;
      } else if (ppIncludePeople) {
          const people = library.filter(a => a.kind === 'person');
          if (people.length > 0) {
              pack.inputs.reference_images = people.map(p => ({ dataUrl: p.dataUrl, label: p.label }));
          }
      }
      
      const res = await runPromptPack({ pack, overrideCreativity: ppCreativity });
      
      if (res && res.items && res.items.length > 0) {
        const out = res.items.map(i => {
            const meta = globalDebug ? createDebugMetadata(
                "promptpack",
                "gemini_runner",
                { global: "Standard", job_policy: "CHECKED" },
                { creativity: ppCreativity, job_id: i.job_id }
            ) : undefined;
            return { id: safeId("res"), title: i.label, dataUrl: i.imageDataUrl, metadata: meta };
        });
        setPpHistory(prev => [...out, ...prev]); openPreview(out, 0);
      } else { alert("El Runner no encontró trabajos válidos o falló la generación."); }
    } catch (e: any) { alert("Error en el Pipeline: " + e.message); } finally { setPpRunning(false); }
  };

  const onDownloadBulk = async () => {
    if (selectedHistoryIds.size === 0) { alert("Selecciona al menos una imagen."); return; }
    const zip = new JSZip();
    const selected = ppHistory.filter(h => selectedHistoryIds.has(h.id));
    selected.forEach((item, idx) => {
      const base64Data = item.dataUrl.split(',')[1];
      const filename = globalDebug 
         ? `promptpack__runner__${item.title.replace(/\s+/g,'_')}__v${idx}.png`
         : `${item.title || `image_${idx}`}.png`;
      zip.file(filename, base64Data, { base64: true });
    });
    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `UnrealVille_Bulk_${Date.now()}.zip`;
    link.click();
    setBulkMode(false); setSelectedHistoryIds(new Set());
  };

  const toggleSelection = (id: string) => {
    const next = new Set(selectedHistoryIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedHistoryIds(next);
  };

  const onGenerateScenes = async () => {
    if (sceneComposite && !sourceAssetA) { alert("Asigna un asset al slot 'Sujeto 1' para Auto-Compositing."); return; }
    if (!sceneValidation.valid) { alert(sceneValidation.errors[0]); return; }

    setSceneRunning(true);
    try {
      const prompts = buildSceneVariantPrompts({ 
        archetype: sceneArchetype, 
        negativeSpace: sceneNS, 
        variants: sceneVariants, 
        customBrief: sceneArchetype === 'custom' ? sceneCustomBrief : undefined,
        userPrompt: sceneUserPrompt 
      });
      
      const allReferences = [];
      if (sourceAssetB) {
          allReferences.push({ dataUrl: sourceAssetB.dataUrl, label: `Fondo/Escena: ${sourceAssetB.label}` });
      }
      if (subject2) {
          allReferences.push({ dataUrl: subject2.dataUrl, label: `Sujeto 2: ${subject2.label}` });
      }
      activeRefAssets.forEach(r => allReferences.push({ dataUrl: r.dataUrl, label: `Estilo: ${r.label}` }));
      
      const out = [];
      for (let i = 0; i < prompts.length; i++) {
        let genImg = "";
        let routing = "";
        const warnings: string[] = [];

        if (sceneComposite && sceneIntegrationMode === 'generative' && sourceAssetA) {
            routing = "ai_fusion";
            if (sceneValidation.warning) warnings.push("Soft warning: Slot types suboptimal for AI Fusion.");
            
            let integrationPrompt = "";
            if (sourceAssetB) {
                integrationPrompt = `GOAL: Create a high-end commercial photograph blending the subject(s) into the background scene.`;
                integrationPrompt += ` The background is provided in [Fondo]. Use its lighting, shadows, and perspective as the ground truth.`;
                if (subject2) {
                     integrationPrompt += ` Place TWO subjects: [Sujeto 1] (${sourceAssetA.label}) and [Sujeto 2] (${subject2.label}).`;
                     integrationPrompt += ` Interaction: They should look like they are physically interacting in the scene.`;
                } else {
                     integrationPrompt += ` Place the [Sujeto 1] (${sourceAssetA.label}) naturally in the scene.`;
                }
                integrationPrompt += ` CRITICAL: Ensure realistic ambient occlusion (contact shadows) where the subjects touch the environment. Match color grading.`;
            } else {
                integrationPrompt = `${prompts[i]}. Feature the [Sujeto 1: ${sourceAssetA.label}] prominently.`;
                if (subject2) integrationPrompt += ` Include [Sujeto 2: ${subject2.label}] in the composition.`;
            }
            if (sceneUserPrompt) integrationPrompt += ` Details: ${sceneUserPrompt}`;
            
            genImg = await generateImageFromPrompt({
                prompt: integrationPrompt,
                aspectRatio: sceneAR,
                size: "2k",
                sourceAssetDataUrl: sourceAssetA.dataUrl,
                sourceAssetLabel: `Sujeto 1: ${sourceAssetA.label}`,
                referenceImages: allReferences 
            });

        } else {
            routing = sceneComposite ? "overlay" : "background_only";
            const bg = await generateImageFromPrompt({ 
                prompt: prompts[i], 
                aspectRatio: sceneAR, 
                size: "2k", 
                referenceImages: allReferences 
            });
            
            if (sceneComposite && sourceAssetA) {
              const placement = { ...defaultPlacementForNegativeSpace(sceneNS), scale: sceneScale, shadow: { opacity: sceneShadow, blur: 18 } };
              genImg = await compositeProductOverBackground({ backgroundDataUrl: bg, productDataUrl: sourceAssetA.dataUrl, placement });
            } else { 
                genImg = bg;
            }
        }
        
        const meta = globalDebug ? createDebugMetadata(
            "scene_creator",
            routing,
            { subject_a: sceneComposite ? "ACTIVE" : "NONE", compositing: sceneIntegrationMode },
            { archetype: sceneArchetype, negative_space: sceneNS },
            i, sceneVariants, warnings
        ) : undefined;

        out.push({ id: safeId("scene"), title: `Scene ${i+1}`, dataUrl: genImg, metadata: meta });
      }
      setToolsHistory(prev => [...out, ...prev]);
      openPreview(out, 0);
    } finally { setSceneRunning(false); }
  };

  const onRunProductComposite = async () => {
    if (!ecomValidation.valid) { 
        alert("E-Commerce Rules Violation. Please fix slot types."); 
        return; 
    }
    
    setProdRunning(true);
    const items = [];
    
    let placement = {
        anchor: "center",
        scale: prodScale,
        offsetX: prodOffsetX,
        offsetY: prodOffsetY,
        shadow: {
            opacity: prodShadowOpacity,
            blur: prodShadowBlur,
            offsetY: 10,
            color: "#000000"
        },
        ambientOcclusion: {
            enabled: prodAO,
            opacity: 0.5,
            blur: 20,
            offsetY: 5
        },
        transparencySensitive: true
    };

    try {
        if (prodJson.trim()) {
            const overrides = JSON.parse(prodJson);
            placement = { ...placement, ...overrides };
        }
    } catch (e) { console.warn("Invalid JSON ignored"); }

    try {
        for(let i=0; i < prodBatchSize; i++) {
            let bgDataUrl = sourceAssetB!.dataUrl;
            
            if (prodBatchSize > 1) {
                const bgPrompt = `Variation of the provided background environment. Professional product photography background, similar style and lighting, but different angle or arrangement. Maintain high quality.`;
                try {
                    bgDataUrl = await generateImageFromPrompt({
                        prompt: bgPrompt,
                        aspectRatio: "1:1",
                        size: "2k",
                        referenceImages: [{ dataUrl: sourceAssetB!.dataUrl, label: "Original Background" }]
                    });
                } catch(err) {
                    console.warn("Background variation failed, using original.", err);
                }
            }

            const routing = "PIXEL_LOCK_OVERLAY";
            const composite = await compositeProductOverBackground({
                backgroundDataUrl: bgDataUrl,
                productDataUrl: sourceAssetA!.dataUrl,
                placement: placement,
                debugMode: globalDebug, // Use global debug
                debugInfo: {
                    routing,
                    shadow: `${prodShadowOpacity.toFixed(2)} / ${prodShadowBlur}px`,
                    AO: prodAO ? "ON" : "OFF"
                }
            });
            
            const meta = globalDebug ? createDebugMetadata(
                "ecommerce_studio",
                routing,
                { subject_a: "PIXEL_LOCK", subject_b: "VAR_BG" },
                placement,
                i, prodBatchSize
            ) : undefined;

            items.push({ 
                id: safeId("prod"), 
                title: `Ecom Var ${i+1}`, 
                dataUrl: composite,
                metadata: meta
            });
        }
        
        setToolsHistory(prev => [...items, ...prev]);
        openPreview(items, 0);
    } catch(e: any) {
        alert("Error en E-Commerce Studio: " + e.message);
    } finally {
        setProdRunning(false);
    }
  };

  const onGenerateAvatar = async () => {
    setAvatarRunning(true);
    try {
        const base = AVATAR_CATALOG.basePortraitStyles.find(x => x.id === avatarBaseStyle);
        const ctx = AVATAR_CATALOG.contextStyles.find(x => x.id === avatarContextStyle);
        const ctxPreset = ctx?.presets?.find(x => x.id === avatarContextPreset);
        const role = AVATAR_CATALOG.roles.find(x => x.id === avatarRole);
        const rolePreset = role?.presets?.find(x => x.id === avatarRolePreset);
        const sp = AVATAR_CATALOG.stylePacks.find(x => x.id === avatarStylePack);

        // Map inputs
        const subjectA = sourceAssetA ? { dataUrl: sourceAssetA.dataUrl, label: sourceAssetA.label } : undefined;
        // Logic: if solo mode, do not pass subjectB even if loaded in R1
        const subjectB = (avatarMode === 'duo' && subject2) ? { dataUrl: subject2.dataUrl, label: subject2.label } : undefined;
        
        const background = sourceAssetB ? { dataUrl: sourceAssetB.dataUrl, label: sourceAssetB.label } : undefined;
        // Refs logic handled by toggle in service, but we pass them if toggle ON
        const styleRefs = avatarEnableRefs ? activeRefAssets.map(a => ({ dataUrl: a.dataUrl, label: a.label })) : undefined;

        const variants = [];
        for (let i = 0; i < avatarBatchSize; i++) {
             const res = await generateAvatar({
                 aspectRatio: avatarAR,
                 baseStyleRules: base?.rules || "",
                 contextRules: `${ctx?.rules} ${ctxPreset?.rules}`,
                 roleRules: `${role?.rules} ${rolePreset?.rules || ""}`,
                 stylePackRules: sp?.rules,
                 
                 enableRefs: avatarEnableRefs,
                 allowMirrors: avatarAllowMirrors,
                 strictIdentity: avatarStrictIdentity,
                 creativityLevel: avatarCreativity,
                 userPrompt: avatarUserPrompt,

                 subjectA,
                 subjectB,
                 background,
                 styleRefs
             });
             
             const meta = globalDebug ? createDebugMetadata(
                 "avatar_generator",
                 "avatar_render",
                 { 
                     identity_lock: avatarStrictIdentity ? "STRICT" : "OFF", 
                     mirrors: avatarAllowMirrors ? "ALLOWED" : "BLOCKED",
                     bg_source: background ? "PROVIDED" : "AUTOGEN"
                 },
                 { base: base?.id, role: role?.id, style_pack: sp?.id },
                 i, avatarBatchSize
             ) : undefined;

             variants.push({ id: safeId("avatar"), title: `Avatar ${i+1}`, dataUrl: res, metadata: meta });
        }
        
        setToolsHistory(prev => [...variants, ...prev]);
        openPreview(variants, 0);
    } catch (e: any) {
        alert("Error generating Avatar: " + e.message);
    } finally { setAvatarRunning(false); }
  }

  return (
    <div className="min-h-screen bg-[#050505] text-[#EBEBEB]">
      <header className="sticky top-0 z-[100] border-b border-[#FFAB00]/10 bg-[#050505]/90 backdrop-blur-2xl px-8 py-4">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex flex-col">
            <img src={UNREALVILLE_LOGO_BASE64} alt="UnrealVille Studio" className="h-6 md:h-8 w-auto object-contain" />
            <span className="text-[#FFD77A]/60 text-[10px] font-bold tracking-[0.4em] uppercase mt-1 pl-1">ImageLab</span>
          </div>
          <div className="flex items-center gap-4">
              {/* DEBUG TOGGLE */}
              {showDebugToggle && (
                  <div className="flex items-center gap-2 bg-black/50 rounded-full px-3 py-1 border border-white/5 animate-in fade-in slide-in-from-right-4">
                      <span className={`text-[9px] font-black uppercase tracking-widest ${globalDebug ? "text-emerald-500" : "text-white/20"}`}>Debug Mode</span>
                      <div className={`w-8 h-4 rounded-full relative cursor-pointer transition-colors ${globalDebug ? "bg-emerald-500" : "bg-white/10"}`} onClick={() => setGlobalDebug(!globalDebug)}>
                          <div className={`absolute top-0.5 w-3 h-3 bg-black rounded-full transition-all ${globalDebug ? "left-4.5" : "left-0.5"}`} />
                      </div>
                  </div>
              )}
              <button onClick={() => setShowDebugToggle(!showDebugToggle)} className="w-8 h-8 rounded-full bg-white/5 text-white/40 hover:text-white flex items-center justify-center transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </button>
              
              <nav className="flex items-center gap-3 border-l border-white/10 pl-4">
                <TabButton active={tab === "promptpack"} onClick={() => setTab("promptpack")}>PromptPack</TabButton>
                <TabButton active={tab === "tools"} onClick={() => setTab("tools")}>Tools</TabButton>
                <TabButton active={tab === "customize"} onClick={() => setTab("customize")}>Customize</TabButton>
              </nav>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-8 py-10 relative">
        <div className="grid grid-cols-12 gap-10">
          <div className="col-span-12 lg:col-span-9 space-y-10 relative">
            
            {/* DEBUG OVERLAYS PER MODULE */}
            {globalDebug && tab === "tools" && toolId === "scene" && !fullScreenPreview && (
                <DebugOverlay title="Scene Creator" items={{
                    routing: sceneComposite ? (sceneIntegrationMode === "generative" ? "AI_FUSION" : "OVERLAY") : "BACKGROUND_ONLY",
                    compositing: sceneComposite ? "ON" : "OFF",
                    slots: `${sourceAssetA?.kind || '-'} / ${sourceAssetB?.kind || '-'}`,
                    policy: sceneValidation.valid ? "VALID" : "ERROR",
                    swap_rec: sceneValidation.canSwap ? "YES" : "NO"
                }} />
            )}
            {globalDebug && tab === "tools" && toolId === "product" && !fullScreenPreview && (
                <DebugOverlay title="E-Commerce" items={{
                    slots: `${sourceAssetA?.kind || '-'} / ${sourceAssetB?.kind || '-'}`,
                    valid: ecomValidation.valid ? "YES" : "NO",
                    swap_needed: ecomValidation.canSwap ? "YES" : "NO"
                }} />
            )}
            {globalDebug && tab === "tools" && toolId === "avatar" && !fullScreenPreview && (
                <DebugOverlay title="Avatar Gen" items={{
                    mode: avatarMode.toUpperCase(),
                    identity: avatarStrictIdentity ? "STRICT" : "SOFT",
                    bg_source: sourceAssetB ? "PROVIDED" : "AUTOGEN",
                    refs: avatarEnableRefs ? `${activeRefAssets.length} (ACTIVE)` : "IGNORED",
                    mirrors: avatarAllowMirrors ? "ALLOWED" : "BLOCKED"
                }} />
            )}

            {/* ... PromptPack ... */}
            {tab === "promptpack" && (
                <div className="rounded-[32px] border border-[#FFAB00]/10 bg-[#0a0a0a] p-8 shadow-2xl animate-in fade-in duration-500">
                    <div className="flex items-center justify-between mb-8">
                        <h2 className="text-2xl font-black uppercase tracking-tighter text-[#FFF8E7]">PromptPack Runner</h2>
                        <div className="flex items-center gap-6">
                            <div className="flex items-center gap-4 border-r border-white/5 pr-6">
                               <ToggleFilter label="Asset (Src A)" active={ppIncludeAsset} onChange={setPpIncludeAsset} />
                               <ToggleFilter label="People Refs" active={ppIncludePeople} onChange={setPpIncludePeople} />
                            </div>
                            {ppRunning && <span className="text-[#00FF00] text-[10px] font-black uppercase tracking-[0.3em] animate-pulse">Generating...</span>}
                            <ResetButton onClick={() => { setPpRaw(""); setPpHistory([]); }} />
                        </div>
                    </div>
                    <div className="mb-10 space-y-4">
                        <span className="text-[#FFD77A] text-[11px] font-black uppercase tracking-widest mb-1 opacity-80">Creativity Level</span>
                        <div className="flex gap-3">
                            {[1, 2, 3].map(v => (
                                <button key={v} onClick={() => setPpCreativity(v as any)} className={`flex-1 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all ${ppCreativity === v ? "bg-[#FFAB00] text-black shadow-xl shadow-[#FFAB00]/20" : "bg-white/5 text-white/40 border-white/5"}`}>{v} {v===1?'Strict':v===2?'Balanced':'Wild'}</button>
                            ))}
                        </div>
                    </div>
                    <div className="mb-8 space-y-2">
                        <Label>JSON Specification Window</Label>
                        <textarea className="w-full h-[750px] bg-[#181818] border border-white/10 rounded-[24px] p-6 text-xs font-mono text-[#FFD77A]/80 focus:border-[#FFAB00] outline-none transition-all custom-scrollbar" value={ppRaw} onChange={e => setPpRaw(e.target.value)} placeholder="Paste your PromptPack JSON here..." />
                    </div>
                    <div className="flex justify-center"><button onClick={onRunPromptPack} disabled={ppRunning} className="group relative px-20 py-4 rounded-full topaz-gradient text-black font-black uppercase tracking-[0.2em] text-xs shadow-2xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50">{ppRunning ? "Generating..." : "Ejecutar Pipeline"}</button></div>
                    {/* PromptPack Output Grid */}
                    {ppHistory.length > 0 && (
                        <div className="mt-12 pt-10 border-t border-white/5">
                            <div className="flex items-center justify-between mb-6">
                               <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-[#FFAB00]">Pipeline Output Gallery</h3>
                               <div className="flex items-center gap-3">
                                  {bulkMode ? (
                                    <>
                                      <button onClick={onDownloadBulk} className="px-4 py-2 rounded-xl bg-[#00FF00]/20 text-[#00FF00] text-[9px] font-black uppercase border border-[#00FF00]/40">Download Selected ({selectedHistoryIds.size})</button>
                                      <button onClick={() => { setBulkMode(false); setSelectedHistoryIds(new Set()); }} className="px-4 py-2 rounded-xl bg-white/5 text-white/40 text-[9px] font-black uppercase">Cancel</button>
                                    </>
                                  ) : (
                                    <button onClick={() => setBulkMode(true)} className="px-4 py-2 rounded-xl bg-white/5 text-white/60 hover:text-white text-[9px] font-black uppercase border border-white/10 transition-all">Bulk Download</button>
                                  )}
                               </div>
                            </div>
                            <div className="grid grid-cols-6 gap-4">
                                {ppHistory.map((item, idx) => (
                                    <div key={item.id} className={`group relative aspect-square rounded-2xl overflow-hidden border transition-all cursor-pointer ${selectedHistoryIds.has(item.id) ? "border-[#FFAB00] ring-2 ring-[#FFAB00]/40" : "border-white/10 hover:border-white/20"}`} onClick={() => bulkMode ? toggleSelection(item.id) : openPreview(ppHistory, idx)}>
                                        <img src={item.dataUrl} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                                        <button onClick={(e) => { e.stopPropagation(); deleteGeneratedItem(item.id, 'promptpack'); }} className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 hover:bg-red-500/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">×</button>
                                        {bulkMode && <div className={`absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${selectedHistoryIds.has(item.id) ? "bg-[#FFAB00] border-[#FFAB00] text-black" : "bg-black/40 border-white/40 text-transparent"}`}><svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg></div>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {tab === "tools" && (
              <div className="rounded-[32px] border border-[#FFAB00]/10 bg-[#0a0a0a] p-8 shadow-2xl">
                <div className="flex items-center justify-between mb-10">
                   <div className="flex gap-4 overflow-x-auto pb-2 custom-scrollbar">
                     <SubToolButton active={toolId === "scene"} onClick={() => setToolId("scene")} label="Scene Creator" />
                     <SubToolButton active={toolId === "product"} onClick={() => setToolId("product")} label="E-Commerce Studio" />
                     <SubToolButton active={toolId === "avatar"} onClick={() => setToolId("avatar")} label="Avatar Generator" />
                   </div>
                </div>
                
                {toolId === "scene" && (
                   <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-6">
                        <div className="flex justify-between items-center">
                            <Label>Arquetipo</Label>
                            <ResetButton onClick={resetSceneTools} />
                        </div>
                        
                        <select className="w-full h-12 bg-[#181818] border border-white/10 rounded-xl px-4 text-sm" value={sceneArchetype} onChange={e => setSceneArchetype(e.target.value)}>{SCENE_ARCHETYPES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
                        
                        {sceneArchetype === 'custom' && (<div><Label>Custom Brief</Label><input type="text" className="w-full h-12 bg-[#181818] border border-white/10 rounded-xl px-4 text-sm" placeholder="Describe your scene..." value={sceneCustomBrief} onChange={e => setSceneCustomBrief(e.target.value)} /></div>)}
                        <div>
                            <Label help="Añade detalles específicos. Usa [Sujeto 1], [Sujeto 2] o [Fondo] para guiar a la IA.">Prompt Adicional / Contexto</Label>
                            <textarea className="w-full h-72 bg-[#181818] border border-white/10 rounded-xl p-4 text-sm resize-none focus:border-[#FFAB00] outline-none transition-all" placeholder="Ej: 'Sujeto 1 y Sujeto 2 conversando dentro del Fondo'." value={sceneUserPrompt} onChange={e => setSceneUserPrompt(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div><Label>Variantes</Label><select className="w-full h-12 bg-[#181818] border border-white/10 rounded-xl px-4 text-sm" value={sceneVariants} onChange={setVariantsFromEvent}>{[1,2,3,4,5,6].map(v => <option key={v} value={v}>{v} Imágenes</option>)}</select></div>
                          <div><Label>Aspect Ratio</Label><select className="w-full h-12 bg-[#181818] border border-white/10 rounded-xl px-4 text-sm" value={sceneAR} onChange={e => setSceneAR(e.target.value as any)}><option value={ASPECT_RATIOS.STORY}>9:16 Story</option><option value={ASPECT_RATIOS.WIDE}>16:9 Wide</option><option value={ASPECT_RATIOS.SQUARE}>1:1 Square</option></select></div>
                        </div>
                        
                        {/* SCENE CREATOR ACTIONS / VALIDATION */}
                        {sceneValidation.valid && !sceneValidation.warning ? (
                            <button onClick={onGenerateScenes} disabled={sceneRunning} className="w-full py-4 rounded-full topaz-gradient text-black font-black uppercase tracking-widest text-xs">{sceneRunning ? "Generating..." : "Generate Scenes"}</button>
                        ) : (
                            <div className="space-y-2">
                                {sceneValidation.canSwap && (
                                    <button onClick={swapSlots} className="w-full py-3 bg-red-500 hover:bg-red-400 text-white font-black uppercase rounded shadow-lg flex items-center justify-center gap-2 animate-pulse">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
                                        Swap Slots (Fix Order)
                                    </button>
                                )}
                                
                                {sceneValidation.valid && sceneValidation.warning && (
                                    <button onClick={onGenerateScenes} disabled={sceneRunning} className="w-full py-4 bg-orange-500/20 text-orange-400 border border-orange-500/50 rounded-full font-black uppercase tracking-widest text-xs hover:bg-orange-500/30">
                                        Proceed Anyway (Warning)
                                    </button>
                                )}

                                {!sceneValidation.valid && (
                                    <div className="text-center text-[10px] text-red-400 font-bold uppercase tracking-widest border border-red-900 bg-red-950/50 p-2 rounded">
                                        Generation Blocked: {sceneValidation.errors[0]}
                                    </div>
                                )}
                            </div>
                        )}
                      </div>
                      <div className="space-y-6">
                        <div className="p-6 bg-[#181818] rounded-2xl border border-white/5 space-y-5">
                          <div className="flex items-center justify-between">
                             <ToggleFilter label="Auto-Compositing" active={sceneComposite} onChange={setSceneComposite} />
                             {sceneComposite && (
                               <div className="flex bg-black rounded-lg p-1 border border-white/10">
                                  <button onClick={() => setSceneIntegrationMode("overlay")} className={`px-2 py-1 rounded text-[8px] font-black uppercase ${sceneIntegrationMode === "overlay" ? "bg-[#FFAB00] text-black" : "text-white/40"}`}>Overlay</button>
                                  <button onClick={() => setSceneIntegrationMode("generative")} className={`px-2 py-1 rounded text-[8px] font-black uppercase ${sceneIntegrationMode === "generative" ? "bg-[#FFAB00] text-black" : "text-white/40"}`}>AI Fusion</button>
                                </div>
                             )}
                          </div>
                          {/* LIVE PREVIEW FOR SCENE (Overlay Mode) */}
                          {sceneComposite && sceneIntegrationMode === "overlay" && livePreviewUrl && (
                              <div className="w-full aspect-square bg-black rounded-xl border border-white/10 overflow-hidden relative group/preview">
                                  <img src={livePreviewUrl} className="w-full h-full object-contain opacity-100" />
                                  <div className="absolute bottom-2 right-2 text-[8px] text-[#FFAB00] bg-black/80 px-2 py-1 rounded font-black uppercase tracking-widest border border-[#FFAB00]/30">Live Preview</div>
                                  <button onClick={() => setFullScreenPreview(true)} className="absolute top-2 right-2 p-2 bg-black/60 hover:bg-[#FFAB00] hover:text-black rounded-full text-white transition-all opacity-0 group-hover/preview:opacity-100">
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                                  </button>
                              </div>
                          )}

                          {sceneComposite && sceneIntegrationMode === "overlay" && (
                            <>
                                <ControlSlider label="Escala del Producto" value={sceneScale} onChange={setSceneScale} min={0.5} max={2.0} step={0.05} help="Tamaño relativo del producto respecto a la altura de la escena." presets={[{label: 'Small', val: 0.8}, {label: 'Norm', val: 1.0}, {label: 'Large', val: 1.3}]}/>
                                <ControlSlider label="Intensidad Sombra" value={sceneShadow} onChange={setSceneShadow} min={0} max={1} step={0.05} help="Opacidad de la sombra de contacto y proyectada." presets={[{label: 'Soft', val: 0.3}, {label: 'Med', val: 0.55}, {label: 'Deep', val: 0.8}]}/>
                            </>
                          )}
                        </div>
                        
                        {/* Slot Summary & Errors */}
                        <div className={`p-4 rounded-xl border bg-[#FFAB00]/5 text-[10px] text-[#FFD77A]/80 leading-relaxed space-y-2 ${(!sceneValidation.valid || sceneValidation.warning) ? "border-red-500 border-2" : "border-[#FFAB00]/20"}`}>
                            {(sceneValidation.errors.length > 0) && (
                                <div className="p-3 bg-red-500/10 border border-red-500 rounded-lg flex flex-col gap-2 mb-2">
                                    <div className="flex items-center gap-2 text-red-400 font-bold uppercase">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                        <span>{sceneValidation.warning ? "Recommendation" : "Error"}</span>
                                    </div>
                                    <ul className="list-disc list-inside text-white/60">
                                        {sceneValidation.errors.map((e,i) => <li key={i}>{e}</li>)}
                                    </ul>
                                </div>
                            )}
                            <div><strong className="block mb-1 text-[#FFAB00] uppercase tracking-widest">Sujeto 1 (A)</strong>{sourceAssetA ? (<span>{sourceAssetA.label} <span className="opacity-50 text-[8px]">[{sourceAssetA.kind}]</span></span>) : <span className="opacity-50">-- Vacío --</span>}</div>
                            <div><strong className="block mb-1 text-[#FFAB00] uppercase tracking-widest">Sujeto 2 (R1)</strong>{subject2 ? subject2.label : <span className="opacity-50">-- Vacío --</span>}</div>
                            <div><strong className="block mb-1 text-[#FFAB00] uppercase tracking-widest">Fondo (B)</strong>{sourceAssetB ? (<span>{sourceAssetB.label} <span className="opacity-50 text-[8px]">[{sourceAssetB.kind}]</span></span>) : <span className="opacity-50">-- Vacío --</span>}</div>
                        </div>
                      </div>
                   </div>
                )}
                
                {toolId === "product" && (
                   <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-6">
                         {/* LIVE PREVIEW PANEL */}
                         {livePreviewUrl ? (
                             <div className="w-full aspect-square bg-black rounded-2xl border border-[#FFAB00]/30 overflow-hidden relative shadow-2xl group/preview">
                                 <img src={livePreviewUrl} className="w-full h-full object-contain" />
                                 <div className="absolute bottom-3 right-3 text-[8px] text-[#FFAB00] bg-black/80 px-2 py-1 rounded font-black uppercase tracking-widest border border-[#FFAB00]/30">Live Preview</div>
                                 <button onClick={() => setFullScreenPreview(true)} className="absolute top-3 right-3 p-3 bg-black/60 hover:bg-[#FFAB00] hover:text-black rounded-full text-white transition-all opacity-0 group-hover/preview:opacity-100 shadow-xl border border-white/10">
                                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                                 </button>
                             </div>
                         ) : (
                             <div className="w-full aspect-square bg-[#181818] rounded-2xl border border-white/5 flex flex-col items-center justify-center text-white/20 p-8 text-center border-dashed">
                                 <div className="text-2xl mb-2">👁️</div>
                                 <p className="text-[10px] uppercase font-bold">Preview Inactivo</p>
                                 <p className="text-[9px]">Carga un Sujeto (A) y un Fondo (B) para habilitar el Live Compositing.</p>
                             </div>
                         )}

                         <div className="p-6 bg-[#181818] rounded-2xl border border-white/5 space-y-4">
                            <div className="flex items-center gap-3">
                               <div className="w-8 h-8 rounded-full bg-[#FFAB00] text-black flex items-center justify-center font-black">2</div>
                               <h3 className="text-sm font-bold text-white">Controles Manuales</h3>
                            </div>
                            <ControlSlider label="Escala" value={prodScale} onChange={setProdScale} min={0.1} max={3.0} step={0.05} help="Tamaño relativo del producto." />
                            <ControlSlider label="Posición X" value={prodOffsetX} onChange={setProdOffsetX} min={-500} max={500} step={10} help="Desplazamiento Horizontal" />
                            <ControlSlider label="Posición Y" value={prodOffsetY} onChange={setProdOffsetY} min={-500} max={500} step={10} help="Desplazamiento Vertical" />
                            <div className="h-px bg-white/5 my-2"></div>
                            
                            <div className="flex items-center justify-between py-2">
                                <ToggleFilter 
                                    label="Ambient Occlusion (Contact)" 
                                    active={prodAO} 
                                    onChange={setProdAO} 
                                    help="Añade una sombra profunda y compacta en la base del producto para 'anclarlo' al suelo y mejorar el realismo." 
                                />
                            </div>

                            <ControlSlider label="Opacidad Sombra (Cast)" value={prodShadowOpacity} onChange={setProdShadowOpacity} min={0} max={1} step={0.05} help="Intensidad de la sombra proyectada." />
                            <ControlSlider label="Desenfoque Sombra" value={prodShadowBlur} onChange={setProdShadowBlur} min={0} max={50} step={1} help="Suavidad de la sombra." />
                         </div>
                         
                         {/* GENERATE OR FIX BUTTON */}
                         {ecomValidation.valid ? (
                             <button onClick={onRunProductComposite} disabled={prodRunning} className={`w-full py-4 rounded-full font-black uppercase tracking-widest text-xs shadow-xl hover:scale-[1.02] transition-all topaz-gradient text-black`}>
                                 {prodRunning ? "Procesando Variantes..." : `Generar ${prodBatchSize} Variantes`}
                             </button>
                         ) : (
                             <div className="space-y-2">
                                 {ecomValidation.canSwap && (
                                     <button onClick={swapSlots} className="w-full py-3 bg-red-500 hover:bg-red-400 text-white font-black uppercase rounded shadow-lg flex items-center justify-center gap-2 animate-pulse">
                                         <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
                                         Swap Slots (Fix Order)
                                     </button>
                                 )}
                                 {ecomValidation.fixTypesAvailable && (
                                     <button onClick={fixTypesForEcom} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase rounded shadow-lg flex items-center justify-center gap-2">
                                         <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                         Auto-Fix Types
                                     </button>
                                 )}
                                 <div className="text-center text-[10px] text-red-400 font-bold uppercase tracking-widest border border-red-900 bg-red-950/50 p-2 rounded">
                                     Generation Blocked: Invalid Slot Types
                                 </div>
                             </div>
                         )}
                      </div>

                      <div className="space-y-6">
                          <div className={`p-4 rounded-xl border bg-[#FFAB00]/5 text-[10px] text-[#FFD77A]/80 leading-relaxed space-y-4 ${!ecomValidation.valid ? "border-red-500 border-2" : "border-[#FFAB00]/20"}`}>
                            {ecomValidation.errors.length > 0 && (
                                <div className="p-3 bg-red-500/10 border border-red-500 rounded-lg flex flex-col gap-2">
                                    <div className="flex items-center gap-2 text-red-400 font-bold uppercase">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                        <span>Configuration Error</span>
                                    </div>
                                    <ul className="list-disc list-inside text-white/60">
                                        {ecomValidation.errors.map((e,i) => <li key={i}>{e}</li>)}
                                    </ul>
                                </div>
                            )}
                            <div>
                                <strong className="block mb-1 text-[#FFAB00] uppercase tracking-widest">Sujeto (A) - PRODUCTO</strong>
                                {sourceAssetA ? (
                                    <div className="flex items-center gap-2">
                                        <img src={sourceAssetA.dataUrl} className="w-8 h-8 object-contain bg-black/50 rounded" />
                                        <div className="flex flex-col">
                                            <span>{sourceAssetA.label}</span>
                                            <span className={`text-[8px] uppercase font-black px-1 rounded w-fit ${sourceAssetA.kind === 'product' ? 'bg-emerald-500 text-black' : 'bg-red-500 text-white'}`}>{sourceAssetA.kind}</span>
                                        </div>
                                    </div>
                                ) : <span className="opacity-50 text-red-400 font-bold">-- REQUERIDO --</span>}
                            </div>
                            <div>
                                <strong className="block mb-1 text-[#FFAB00] uppercase tracking-widest">Fondo (B) - ESCENA</strong>
                                {sourceAssetB ? (
                                    <div className="flex items-center gap-2">
                                        <img src={sourceAssetB.dataUrl} className="w-8 h-8 object-cover bg-black/50 rounded" />
                                        <div className="flex flex-col">
                                            <span>{sourceAssetB.label}</span>
                                            <span className={`text-[8px] uppercase font-black px-1 rounded w-fit ${sourceAssetB.kind === 'background' ? 'bg-blue-500 text-white' : 'bg-red-500 text-white'}`}>{sourceAssetB.kind}</span>
                                        </div>
                                    </div>
                                ) : <span className="opacity-50 text-red-400 font-bold">-- REQUERIDO --</span>}
                            </div>
                          </div>
                      </div>
                   </div>
                )}

                {toolId === "avatar" && (
                    <div className="max-w-3xl grid grid-cols-2 gap-8">
                       <div className="space-y-6">
                           <div className="flex justify-between items-center">
                             <div className="flex items-center gap-2">
                                 <h3 className="text-sm font-bold text-[#FFAB00]">Avatar Config</h3>
                                 <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${avatarMode === 'duo' ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/40'}`}>{avatarMode === 'duo' ? 'Duo Mode' : 'Solo Mode'}</span>
                             </div>
                             <ResetButton onClick={resetAvatarTools} />
                           </div>

                           {/* LAYERS CONFIG */}
                           <div className="p-6 bg-[#181818] rounded-2xl border border-white/5 space-y-5">
                               <div className="text-[10px] font-black uppercase tracking-widest text-white/40 border-b border-white/5 pb-2 mb-2">1. Base Portrait</div>
                               <div>
                                   <Label>Portrait Style</Label>
                                   <select className="w-full h-10 bg-black/40 border border-white/10 rounded-lg px-3 text-[10px]" value={avatarBaseStyle} onChange={e => setAvatarBaseStyle(e.target.value)}>
                                       {AVATAR_CATALOG.basePortraitStyles.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                                   </select>
                               </div>

                               <div className="text-[10px] font-black uppercase tracking-widest text-white/40 border-b border-white/5 pb-2 mb-2 pt-2">2. Context</div>
                               <div className="grid grid-cols-2 gap-3">
                                   <div>
                                       <Label>Context Style</Label>
                                       <select className="w-full h-10 bg-black/40 border border-white/10 rounded-lg px-3 text-[10px]" value={avatarContextStyle} onChange={e => {
                                           setAvatarContextStyle(e.target.value);
                                           const ctx = AVATAR_CATALOG.contextStyles.find(c => c.id === e.target.value);
                                           if (ctx?.presets?.[0]) setAvatarContextPreset(ctx.presets[0].id);
                                       }}>
                                           {AVATAR_CATALOG.contextStyles.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                                       </select>
                                   </div>
                                   <div>
                                       <Label>Context Preset</Label>
                                       <select className="w-full h-10 bg-black/40 border border-white/10 rounded-lg px-3 text-[10px]" value={avatarContextPreset} onChange={e => setAvatarContextPreset(e.target.value)}>
                                           {AVATAR_CATALOG.contextStyles.find(c => c.id === avatarContextStyle)?.presets?.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                                       </select>
                                   </div>
                               </div>

                               <div className="text-[10px] font-black uppercase tracking-widest text-white/40 border-b border-white/5 pb-2 mb-2 pt-2">3. Role / Wardrobe</div>
                               <div className="grid grid-cols-2 gap-3">
                                   <div>
                                       <Label>Role</Label>
                                       <select className="w-full h-10 bg-black/40 border border-white/10 rounded-lg px-3 text-[10px]" value={avatarRole} onChange={e => {
                                           setAvatarRole(e.target.value);
                                           const role = AVATAR_CATALOG.roles.find(r => r.id === e.target.value);
                                           setAvatarRolePreset(role?.presets?.[0]?.id || "");
                                       }}>
                                           {AVATAR_CATALOG.roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                                       </select>
                                   </div>
                                   <div>
                                       <Label>Role Preset</Label>
                                       <select className="w-full h-10 bg-black/40 border border-white/10 rounded-lg px-3 text-[10px]" value={avatarRolePreset} onChange={e => setAvatarRolePreset(e.target.value)} disabled={!AVATAR_CATALOG.roles.find(r => r.id === avatarRole)?.presets}>
                                           <option value="">Default / None</option>
                                           {AVATAR_CATALOG.roles.find(r => r.id === avatarRole)?.presets?.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                                       </select>
                                   </div>
                               </div>

                               {availableStylePacks.length > 0 && (
                                   <>
                                     <div className="text-[10px] font-black uppercase tracking-widest text-white/40 border-b border-white/5 pb-2 mb-2 pt-2">4. Style Pack (Optional)</div>
                                     <div>
                                         <Label>Style Pack (Dependent)</Label>
                                         <select className="w-full h-10 bg-black/40 border border-white/10 rounded-lg px-3 text-[10px]" value={avatarStylePack} onChange={e => setAvatarStylePack(e.target.value)}>
                                             <option value="">None (Standard)</option>
                                             {availableStylePacks.map(sp => <option key={sp.id} value={sp.id}>{sp.label}</option>)}
                                         </select>
                                     </div>
                                   </>
                               )}
                           </div>
                           
                           <div className="bg-[#181818] p-4 rounded-xl border border-white/5">
                                <Label>Prompt Adicional (User Intent)</Label>
                                <textarea className="w-full h-48 bg-black/40 border border-white/10 rounded-xl p-3 text-[10px] resize-none focus:border-[#FFAB00] outline-none" placeholder="Detalles extra: 'wear glasses', 'looking at camera'..." value={avatarUserPrompt} onChange={e => setAvatarUserPrompt(e.target.value)} />
                           </div>

                           <button onClick={onGenerateAvatar} disabled={avatarRunning} className="w-full py-4 rounded-full topaz-gradient text-black font-black uppercase text-xs shadow-xl hover:scale-[1.02] transition-all">
                               {avatarRunning ? "Compiling & Generating..." : `Generar ${avatarBatchSize} Variantes`}
                           </button>
                       </div>

                       <div className="space-y-6">
                          {/* ADVANCED CONFIG */}
                          <div className="p-6 bg-[#181818] rounded-2xl border border-white/5 space-y-4">
                              <div className="text-[10px] font-black uppercase tracking-widest text-[#FFAB00] border-b border-white/5 pb-2 mb-2">Advanced Config</div>
                              <div className="grid grid-cols-1 gap-3">
                                  <ToggleFilter label="Strict Identity Lock" active={avatarStrictIdentity} onChange={setAvatarStrictIdentity} help="Mantiene rasgos faciales exactos del Sujeto A/B." />
                                  <ToggleFilter label="Allow Mirrors/Reflections" active={avatarAllowMirrors} onChange={setAvatarAllowMirrors} help="Permite espejos. Desactivado por defecto para evitar distorsiones." />
                                  <ToggleFilter label="Enable Visual Refs (Soft)" active={avatarEnableRefs} onChange={setAvatarEnableRefs} help="Usa las Refs (Slots R2/R3) solo para estilo/luz, NO para identidad." />
                              </div>
                              <div className="pt-2">
                                  <Label>Creativity Level (Variations)</Label>
                                  <div className="flex gap-2">
                                      {[1, 2, 3].map(v => (
                                          <button key={v} onClick={() => setAvatarCreativity(v as any)} className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase border transition-all ${avatarCreativity === v ? "bg-[#FFAB00] text-black border-[#FFAB00]" : "bg-white/5 text-white/40 border-white/10"}`}>
                                              {v === 1 ? "1. Strict" : v === 2 ? "2. Balanced" : "3. Wild"}
                                          </button>
                                      ))}
                                  </div>
                              </div>
                              <div className="grid grid-cols-2 gap-3 pt-2">
                                  <div>
                                      <Label>Variantes</Label>
                                      <div className="flex gap-1">
                                        {[1, 3, 6].map(v => (
                                            <button key={v} onClick={() => setAvatarBatchSize(v)} className={`flex-1 py-1.5 rounded text-[9px] font-bold ${avatarBatchSize === v ? "bg-[#FFAB00] text-black" : "bg-white/10 text-white/50"}`}>{v}</button>
                                        ))}
                                      </div>
                                  </div>
                                  <div>
                                      <Label>Aspect Ratio</Label>
                                      <select className="w-full h-8 bg-black/40 border border-white/10 rounded px-2 text-[9px]" value={avatarAR} onChange={e => setAvatarAR(e.target.value as any)}>
                                          <option value={ASPECT_RATIOS.PORTRAIT}>3:4 Portrait</option>
                                          <option value={ASPECT_RATIOS.SQUARE}>1:1 Square</option>
                                          <option value={ASPECT_RATIOS.STORY}>9:16 Vertical</option>
                                      </select>
                                  </div>
                              </div>
                          </div>

                          <div className={`p-4 rounded-xl border transition-all space-y-2 bg-[#FFAB00]/5 border-[#FFAB00]/20`}>
                             <div className="text-[10px] font-black uppercase tracking-widest text-[#FFAB00] mb-2">Input Slots</div>
                             <div className="grid grid-cols-1 gap-2">
                                <div className="flex justify-between items-center text-[9px]">
                                    <span className="text-white/60">Subject A (Main)</span>
                                    <span className={sourceAssetA ? "text-[#FFAB00] font-bold" : "text-white/20"}>{sourceAssetA ? "LOADED" : "EMPTY"}</span>
                                </div>
                                <div className="flex justify-between items-center text-[9px]">
                                    <span className="text-white/60">Subject B (Sec) [Slot R1]</span>
                                    <span className={subject2 ? "text-[#FFAB00] font-bold" : "text-white/20"}>{subject2 ? "LOADED" : "EMPTY"}</span>
                                </div>
                                <div className="flex justify-between items-center text-[9px]">
                                    <span className="text-white/60">Background [Slot B]</span>
                                    <span className={sourceAssetB ? "text-blue-400 font-bold" : "text-white/20"}>{sourceAssetB ? "LOADED" : `AUTO-GEN (${avatarContextPreset})`}</span>
                                </div>
                                <div className="flex justify-between items-center text-[9px]">
                                    <span className="text-white/60">Visual Refs [Slot R2/R3]</span>
                                    <span className={activeRefAssets.length > 0 ? "text-pink-400 font-bold" : "text-white/20"}>{activeRefAssets.length} REF(S) {avatarEnableRefs ? "" : "(IGNORED)"}</span>
                                </div>
                             </div>
                          </div>
                       </div>
                    </div>
                )}

                {/* History Grid */}
                {toolsHistory.length > 0 && (
                  <div className="mt-12 pt-10 border-t border-white/5 grid grid-cols-6 gap-4">
                    {toolsHistory.map((item, idx) => (
                      <div key={idx} className="group relative aspect-[3/4] rounded-2xl overflow-hidden border border-white/10 bg-black cursor-pointer shadow-xl" onClick={() => openPreview(toolsHistory, idx)}>
                        <img src={item.dataUrl} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {tab === "customize" && (
              <div className="rounded-[32px] border border-[#FFAB00]/10 bg-[#0a0a0a] p-8 shadow-2xl animate-in fade-in">
                <div className="flex items-center justify-between mb-8"><h2 className="text-2xl font-black uppercase tracking-tighter text-[#FFF8E7]">Customize Station</h2><ResetButton onClick={() => { setBrandId("D7Herbal"); setPackId("ig_organic_pack"); }} /></div>
                <div className="grid grid-cols-2 gap-8 mb-8">
                   <div className="space-y-4">
                      <Label>Marca Activa</Label>
                      <select className="w-full h-12 bg-[#181818] border border-white/10 rounded-xl px-4 text-sm outline-none focus:border-[#FFAB00] transition-all" value={brandId} onChange={e => setBrandId(e.target.value)}>{BRANDS.map(b => <option key={b.id} value={b.id}>{b.displayName}</option>)}</select>
                      <div className="p-6 bg-[#181818] rounded-2xl border border-white/5"><Label>Identidad Visual</Label><p className="text-xs text-white/60 leading-relaxed italic">"{brand.visualIdentity}"</p></div>
                   </div>
                   <div className="space-y-4">
                      <Label>Pack de Estilo</Label>
                      <select className="w-full h-12 bg-[#181818] border border-white/10 rounded-xl px-4 text-sm outline-none focus:border-[#FFAB00] transition-all" value={packId} onChange={e => setPackId(e.target.value)}>{PACKS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
                      <div className="p-6 bg-[#181818] rounded-2xl border border-white/5">
                          <Label>Assets en Pack</Label>
                          <ul className="space-y-2 mt-2">
                              {stylePack.assets.map(a => (
                                  <li key={a.assetId} className="flex items-center gap-2 text-[10px] font-bold text-white/80">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]"></span>
                                      <span className="uppercase text-emerald-400">{a.assetType}</span>
                                      <span className="text-white/30 text-[9px]">• {a.genAspectRatio}</span>
                                  </li>
                              ))}
                          </ul>
                      </div>
                   </div>
                </div>
              </div>
            )}
          </div>
          <div className="col-span-12 lg:col-span-3 space-y-6">
            <div className="rounded-[32px] border border-white/5 bg-[#0a0a0a] p-6 shadow-xl sticky top-[100px]">
              <div className="flex gap-2 mb-6">
                <button onClick={() => setLibTab("assets")} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${libTab === "assets" ? "bg-[#FFAB00] text-black" : "bg-white/5 text-white/40"}`}>Assets</button>
                <button onClick={() => setLibTab("people")} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${libTab === "people" ? "bg-[#FFAB00] text-black" : "bg-white/5 text-white/40"}`}>People</button>
              </div>
              <div className="space-y-6">
                <div className="relative group">
                  <input type="file" multiple className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={async e => {
                    const files = e.target.files; if (!files) return;
                    for (let f of Array.from(files) as File[]) { 
                      const d = await readFileAsDataUrl(f); 
                      // Automatic kind inference here
                      addToLibrary(f.name.replace(/\.[^/.]+$/, ""), d); 
                    }
                  }} />
                  <div className="border-2 border-dashed border-white/5 group-hover:border-[#FFAB00]/40 rounded-[20px] p-6 text-center transition-all bg-[#121212]"><div className="text-xl mb-1 text-[#FFAB00]">+</div><p className="text-[9px] font-black uppercase tracking-widest text-[#EBEBEB]/40">Subir {libTab}</p></div>
                </div>
                {/* UPGRADED LIBRARY UI */}
                <div className="space-y-3 max-h-[600px] overflow-auto pr-1 custom-scrollbar">
                   <div className="grid grid-cols-2 gap-3">
                       {library.filter(a => libTab === 'people' ? a.kind === 'person' : a.kind !== 'person').map(item => (
                         <div key={item.id} className="group relative bg-[#181818] rounded-xl overflow-hidden border border-white/5 hover:border-[#FFAB00]/40 transition-all">
                           <img src={item.dataUrl} onClick={() => openLibraryPreview(item)} className="w-full h-40 object-cover opacity-80 group-hover:opacity-100 cursor-zoom-in" />
                           
                           {/* KIND BADGE */}
                           <div className="absolute top-1 left-1 z-20">
                               <select 
                                   value={item.kind} 
                                   onChange={(e) => updateAssetKind(item.id, e.target.value as LibraryAssetKind)}
                                   onClick={(e) => e.stopPropagation()}
                                   className={`text-[8px] font-black uppercase rounded px-1.5 py-0.5 border-none outline-none cursor-pointer appearance-none ${
                                       item.kind === 'product' ? 'bg-emerald-500 text-black' : 
                                       item.kind === 'background' ? 'bg-blue-500 text-white' : 
                                       item.kind === 'person' ? 'bg-purple-500 text-white' : 
                                       'bg-white/20 text-white'
                                   }`}
                               >
                                   <option value="unknown">?</option>
                                   <option value="product">PROD</option>
                                   <option value="background">BG</option>
                                   <option value="person">PERS</option>
                                   <option value="reference">REF</option>
                               </select>
                           </div>

                           <div className="p-2 space-y-2 bg-black/90 backdrop-blur-md absolute bottom-0 left-0 right-0 translate-y-full group-hover:translate-y-0 transition-transform z-10">
                             <div className="flex items-center justify-between"><span className="text-[8px] font-bold text-white/90 truncate">{item.label}</span><button onClick={(e) => { e.stopPropagation(); setLibrary(l => l.filter(x => x.id !== item.id)); }} className="text-[8px] text-red-500 hover:text-red-400 font-bold">DEL</button></div>
                             <div className="grid grid-cols-3 gap-1">
                                <button onClick={(e) => { e.stopPropagation(); assignSlot('sourceA', item.id); }} className={`py-1 rounded text-[7px] font-black ${activeSlots.sourceA === item.id ? "bg-[#FFAB00] text-black" : "bg-white/20 text-white"}`}>Sujeto</button>
                                <button onClick={(e) => { e.stopPropagation(); assignSlot('sourceB', item.id); }} className={`py-1 rounded text-[7px] font-black ${activeSlots.sourceB === item.id ? "bg-blue-500 text-white" : "bg-white/20 text-white"}`}>Fondo</button>
                                <button onClick={(e) => { e.stopPropagation(); assignSlot('ref1', item.id); }} className={`py-1 rounded text-[7px] font-black ${activeSlots.ref1 === item.id ? "bg-purple-500 text-white" : "bg-white/20 text-white"}`}>Suj.2</button>
                             </div>
                           </div>
                         </div>
                       ))}
                   </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      
      {/* FULLSCREEN PREVIEW MODAL */}
      {fullScreenPreview && livePreviewUrl && (
          <div className="fixed inset-0 z-[2000] bg-black/95 backdrop-blur-md flex items-center justify-center animate-in fade-in duration-200">
              <button onClick={() => setFullScreenPreview(false)} className="absolute top-6 right-6 w-12 h-12 bg-white/10 hover:bg-white/20 rounded-full text-white text-2xl font-black z-50">×</button>
              <div className="relative w-full h-full p-10 flex items-center justify-center">
                  <img src={livePreviewUrl} className="max-w-full max-h-full object-contain shadow-2xl" />
                  
                  {/* FULLSCREEN DEBUG OVERLAY */}
                  {globalDebug && (
                      <DebugOverlay 
                          title="Fullscreen Debug" 
                          expanded={true}
                          items={{
                              module: toolId === 'product' ? 'E-COMMERCE STUDIO' : 'SCENE CREATOR',
                              compositing: "LIVE RENDER (Canvas2D)",
                              slot_a: `${sourceAssetA?.label} [${sourceAssetA?.kind}]`,
                              slot_b: `${sourceAssetB?.label} [${sourceAssetB?.kind}]`,
                              scale: prodScale.toFixed(2),
                              offset: `${prodOffsetX}, ${prodOffsetY}`,
                              shadow: `${prodShadowOpacity} / ${prodShadowBlur}px`,
                              ao: prodAO ? "ENABLED" : "DISABLED",
                              routing: toolId === 'product' ? "PIXEL_LOCK_OVERLAY" : (sceneIntegrationMode === 'generative' ? "AI_FUSION" : "OVERLAY")
                          }} 
                      />
                  )}
              </div>
          </div>
      )}

      {/* RESULT PREVIEW MODAL (unchanged) */}
      {previewOpen && previewItems[previewIndex] && (
        <div className="fixed inset-0 z-[1000] flex flex-col bg-black/98 backdrop-blur-3xl animate-in fade-in duration-300">
          <div className="flex items-center justify-between p-8 bg-black/40 border-b border-white/5">
            <div className="flex flex-col"><h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-[#FFAB00]">Imaging Workstation</h3><p className="text-white font-bold text-sm">{previewItems[previewIndex].title}</p></div>
            <button onClick={() => setPreviewOpen(false)} className="w-12 h-12 bg-white/5 hover:bg-red-500 text-white rounded-full transition-all flex items-center justify-center text-2xl font-black">×</button>
          </div>
          <div className="flex-1 relative overflow-hidden flex flex-row bg-checkered select-none">
             <div className="flex-1 flex items-center justify-center relative" onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
                <button disabled={previewIndex === 0} onClick={(e) => { e.stopPropagation(); setPreviewIndex(p => p - 1); setZoom(1); setOffset({x:0,y:0}); }} className="absolute left-10 w-16 h-16 rounded-full bg-black/50 text-white text-3xl font-black disabled:opacity-5 hover:bg-[#FFAB00] hover:text-black transition-all z-50">←</button>
                <div className={`relative transition-transform duration-75 flex items-center justify-center ${isDragging ? "cursor-grabbing" : "cursor-grab"}`} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}>
                   <img src={previewItems[previewIndex].dataUrl} className="max-h-[75vh] max-w-[80vw] object-contain shadow-2xl rounded-lg pointer-events-none" />
                </div>
                <button disabled={previewIndex === previewItems.length - 1} onClick={(e) => { e.stopPropagation(); setPreviewIndex(p => p + 1); setZoom(1); setOffset({x:0,y:0}); }} className="absolute right-10 w-16 h-16 rounded-full bg-black/50 text-white text-3xl font-black disabled:opacity-5 hover:bg-[#FFAB00] hover:text-black transition-all z-50">→</button>
             </div>
             {/* DEBUG METADATA VIEWER */}
             {globalDebug && previewItems[previewIndex].metadata && (
                <div className="w-[300px] border-l border-white/10 bg-black/95 p-4 overflow-y-auto text-[9px] font-mono text-emerald-400 shadow-2xl z-50 flex flex-col">
                    <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-2 sticky top-0 bg-black">
                        <h4 className="text-[11px] font-black uppercase text-white">Debug Metadata</h4>
                        <button onClick={() => downloadMetadata(previewItems[previewIndex].metadata, `metadata_${previewItems[previewIndex].id}.json`)} className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-[8px] font-black uppercase hover:bg-emerald-500/40">JSON ⬇</button>
                    </div>
                    <pre className="whitespace-pre-wrap break-all flex-1">{JSON.stringify(previewItems[previewIndex].metadata, null, 2)}</pre>
                </div>
             )}
          </div>
          <div className="p-8 flex justify-center gap-4 bg-black/90 border-t border-white/5">
             <button onClick={() => deleteGeneratedItem(previewItems[previewIndex].id, tab as any)} className="px-12 py-4 bg-red-500/10 border border-red-500/30 text-red-500 rounded-full font-black text-[10px] uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all">Discard Image</button>
             <button onClick={() => {
                 const item = previewItems[previewIndex];
                 const filename = globalDebug && item.metadata
                     ? `${item.metadata.module}__${item.metadata.routing}__v${item.metadata.variant_index || 0}.png`
                     : `${item.title}.png`;
                 downloadDataUrl(filename, item.dataUrl);
             }} className="px-12 py-4 bg-[#FFAB00] text-black rounded-full font-black text-[10px] uppercase tracking-widest shadow-xl shadow-[#FFAB00]/20 hover:scale-[1.05] transition-all">Download Image</button>
             <button onClick={() => { addToLibrary(previewItems[previewIndex].title, previewItems[previewIndex].dataUrl, 'product'); alert("Asset guardado en la librería."); }} className="px-12 py-4 border border-[#FFAB00] text-[#FFAB00] rounded-full font-black text-[10px] uppercase tracking-widest hover:bg-[#FFAB00] hover:text-black transition-all">Add to Library</button>
          </div>
        </div>
      )}
    </div>
  );
}
