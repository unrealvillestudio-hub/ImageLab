import React, { useMemo, useState, useRef, useEffect } from "react";
import JSZip from "jszip";
import type {
  LibraryAsset,
  LibraryAssetKind,
  PersonType,
  DebugMetadata,
  TabId,
  PlacementHint,
} from "./core/types.ts";
import {
  downloadDataUrl,
  safeId,
} from "./utils/imageUtils.ts";
import { detectAssetKind } from "./core/vision/inferKind.ts";
import { BUILD_TAG } from "./config/buildTag.ts";
import { LibraryProvider, useLibraryStore } from "./ui/stores/libraryStore.tsx";
import { OutputProvider, useOutputStore } from "./ui/stores/outputStore.tsx";
import { BrandsProvider } from "./lib/brandsContext.tsx"; // ← NUEVO
import { LibraryDock } from "./modules/library/LibraryDock.tsx";
import { ToolsModule } from "./modules/tools/ToolsModule.tsx";
import { PromptPackModule } from "./modules/promptpack/PromptPackModule.tsx";
import { CustomizeModule } from "./modules/customize/CustomizeModule.tsx";
import { 
    TabButton
} from "./ui/components.tsx";
import { FixedPreviewPane } from "./components/preview/FixedPreviewPane.tsx";
import { AssetLibraryDrawer } from "./components/drawers/AssetLibraryDrawer.tsx";

// WRAPPER FOR STORE
export default function App() {
    return (
        <LibraryProvider>
            <OutputProvider>
                <BrandsProvider>  {/* ← NUEVO: envuelve AppContent */}
                    <AppContent />
                </BrandsProvider>
            </OutputProvider>
        </LibraryProvider>
    )
}

function AppContent() {
  const [globalDebug, setGlobalDebug] = useState(() => {
      try { return localStorage.getItem("global_debug") === "true" } catch { return false }
  });
  const [showDebugToggle, setShowDebugToggle] = useState(false);
  const { outputs } = useOutputStore();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean>(true);

  useEffect(() => {
    document.title = `ImageLab • ${BUILD_TAG}`;
    const k = "imagelab_build_tag";
    const prev = localStorage.getItem(k);
    if (prev && prev !== BUILD_TAG) {
        localStorage.setItem(k, BUILD_TAG);
        window.location.reload();
        return;
    }
    localStorage.setItem(k, BUILD_TAG);
    const checkApiKey = async () => {
      if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
        const has = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(has);
      }
    };
    checkApiKey();
  }, []);

  useEffect(() => localStorage.setItem("global_debug", String(globalDebug)), [globalDebug]);

  const { setAssets, activeSlots, assignSlot, swapActiveSlotsAB } = useLibraryStore();
  const [tab, setTab] = useState<TabId>("promptpack");
  
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<Array<{id: string, title: string, dataUrl: string, metadata?: DebugMetadata}>>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
      if (outputs.length > 0) {
          setSelectedOutputId(outputs[0].id);
      }
  }, [outputs]);

  const addToLibrary = async (label: string, dataUrl: string, explicitKind?: LibraryAssetKind, placementHint?: PlacementHint) => {
    let kind = explicitKind;
    let alphaDetected = false;
    const d = await detectAssetKind(dataUrl); 
    if (!kind) { kind = d.kind; }
    alphaDetected = d.alphaDetected;
    const type: PersonType | undefined = kind === 'person' ? 'real' : undefined;
    setAssets(prev => [{ id: safeId("asset"), kind: kind!, label, dataUrl, type, alphaDetected, placementHint, createdAt: Date.now() }, ...prev]);
  };

  const openLibraryPreview = (asset: LibraryAsset) => {
      setPreviewItems([{ id: asset.id, title: asset.label, dataUrl: asset.dataUrl }]); 
      setPreviewIndex(0); 
      setZoom(1); setOffset({ x: 0, y: 0 }); setPreviewOpen(true);
  };

  const handleWheel = (e: React.WheelEvent) => { e.preventDefault(); const delta = e.deltaY > 0 ? 0.9 : 1.1; setZoom(z => Math.max(0.2, Math.min(10, z * delta))); };
  const handleMouseDown = (e: React.MouseEvent) => { setIsDragging(true); dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }; };
  const handleMouseMove = (e: React.MouseEvent) => { if (!isDragging) return; setOffset({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }); };
  const handleMouseUp = () => setIsDragging(false);

  if (!hasApiKey) {
    return (
      <div className="min-h-screen bg-[#050505] text-[#EBEBEB] flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-[#121212] border border-[#FFAB00]/20 rounded-[32px] p-8 text-center space-y-6">
          <div className="flex flex-col mb-4">
            <div className="text-white font-black tracking-[-0.02em] text-[24px] leading-none uppercase italic">UNRLVL</div>
            <div className="text-[#FFAB00] text-[12px] font-bold tracking-[0.28em] uppercase mt-1">ImageLab</div>
          </div>
          <h2 className="text-xl font-black uppercase tracking-widest text-[#FFAB00]">Pro Features Locked</h2>
          <p className="text-white/60 text-sm leading-relaxed">
            This application uses high-quality image generation models. To proceed, you must select an API key from a paid GCP project.
          </p>
          <div className="bg-black/40 p-4 rounded-xl text-left space-y-2">
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Billing Info</p>
            <p className="text-[11px] text-white/50">
              User must select a API key from a paid GCP project. Documentation: <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="text-[#FFAB00] hover:underline">ai.google.dev/gemini-api/docs/billing</a>.
            </p>
          </div>
          <button 
            onClick={async () => {
              if (window.aistudio && window.aistudio.openSelectKey) {
                await window.aistudio.openSelectKey();
                setHasApiKey(true);
              }
            }}
            className="w-full topaz-gradient text-black py-4 rounded-full font-black uppercase tracking-[0.2em] text-xs hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            Select API Key
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-[#EBEBEB] overflow-hidden flex flex-col">
      <header className="sticky top-0 z-[100] border-b border-[#FFAB00]/10 bg-[#050505]/90 backdrop-blur-2xl px-8 py-4 shrink-0">
        <div className="max-w-[1920px] mx-auto flex items-center justify-between">
          <div className="flex flex-col">
            <div className="flex items-center gap-6">
              <div className="flex flex-col">
                <div className="text-white font-black tracking-[-0.02em] text-[18px] leading-none uppercase italic">UNRLVL</div>
                <div className="text-white/60 text-[11px] font-bold tracking-[0.28em] uppercase mt-1">ImageLab</div>
              </div>
              <span className="text-[#FFB800]/70 text-[11px] font-black tracking-[0.28em] uppercase self-start mt-1">
                BUILD:{BUILD_TAG}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
              {showDebugToggle && (
                  <div className="flex items-center gap-2 bg-black/50 rounded-full px-3 py-1 border border-white/5 animate-in fade-in slide-in-from-right-4">
                      <span className={`text-[9px] font-black uppercase tracking-widest ${globalDebug ? "text-emerald-500" : "text-white/20"}`}>Debug Mode</span>
                      <div className={`w-8 h-4 rounded-full relative cursor-pointer transition-colors ${globalDebug ? "bg-emerald-500" : "bg-white/10"}`} onClick={() => setGlobalDebug(!globalDebug)}>
                          <div className={`absolute top-0.5 w-3 h-3 bg-black rounded-full transition-all ${globalDebug ? "left-4.5" : "left-0.5"}`} />
                      </div>
                  </div>
              )}
              <button onClick={() => setShowDebugToggle(!showDebugToggle)} className="w-8 h-8 rounded-full bg-white/5 text-white/40 hover:text-white flex items-center justify-center transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </button>
              <nav className="flex items-center gap-3 border-l border-white/10 pl-4">
                <TabButton active={tab === "promptpack"} onClick={() => setTab("promptpack")}>PromptPack</TabButton>
                <TabButton active={tab === "tools"} onClick={() => setTab("tools")}>Tools</TabButton>
                <TabButton active={tab === "customize"} onClick={() => setTab("customize")}>Customize</TabButton>
              </nav>
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-hidden relative max-w-[1920px] mx-auto w-full px-8 py-6">
        <div className="grid grid-cols-12 gap-6 h-full">
          <div className="col-span-12 h-full overflow-y-auto custom-scrollbar pr-2">
            {tab === "promptpack" && (
                <PromptPackModule
                    activeSlots={activeSlots}
                    onSwapSlots={swapActiveSlotsAB}
                    globalDebug={globalDebug}
                />
            )}
            {tab === "tools" && (
                <ToolsModule 
                    activeSlots={activeSlots}
                    onAssignSlot={assignSlot}
                    onSwapSlots={swapActiveSlotsAB}
                    globalDebug={globalDebug}
                />
            )}
            {tab === "customize" && (
              <CustomizeModule />
            )}
          </div>
        </div>
      </main>
      <AssetLibraryDrawer isOpen={drawerOpen} setOpen={setDrawerOpen}>
          <LibraryDock 
              activeSlots={activeSlots} 
              onAssignSlot={assignSlot} 
              onPreview={openLibraryPreview}
          />
      </AssetLibraryDrawer>
      {previewOpen && previewItems[previewIndex] && (
        <div className="fixed inset-0 z-[2000] flex flex-col bg-black/98 backdrop-blur-3xl animate-in fade-in duration-300">
          <div className="flex items-center justify-between p-8 bg-black/40 border-b border-white/5">
            <div className="flex flex-col"><h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-[#FFAB00]">Quick Look</h3><p className="text-white font-bold text-sm">{previewItems[previewIndex].title}</p></div>
            <button onClick={() => setPreviewOpen(false)} className="w-12 h-12 bg-white/5 hover:bg-red-500 text-white rounded-full transition-all flex items-center justify-center text-2xl font-black">×</button>
          </div>
          <div className="flex-1 relative overflow-hidden flex flex-row bg-checkered select-none">
             <div className="flex-1 flex items-center justify-center relative" onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
                <div className={`relative transition-transform duration-75 flex items-center justify-center ${isDragging ? "cursor-grabbing" : "cursor-grab"}`} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}>
                   <img src={previewItems[previewIndex].dataUrl} className="max-h-[75vh] max-w-[80vw] object-contain shadow-2xl rounded-lg pointer-events-none" />
                </div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
