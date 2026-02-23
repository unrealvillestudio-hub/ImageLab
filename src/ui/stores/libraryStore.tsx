
import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
// Fix: Corrected relative imports for core types and utilities
import { LibraryAsset, LibraryAssetKind, PersonType } from '../../core/types.ts';
import { safeId, readFileAsDataUrl } from '../../utils/imageUtils.ts';
import { detectAssetKind } from '../../core/vision/inferKind.ts';
import { getImageDimensions } from '../../utils/imageMeta.ts';

// --- PENDING ASSET TYPES ---
export interface PendingAsset {
    id: string;
    file: File;
    dataUrl: string;
    label: string;
    kind: LibraryAssetKind; 
    alphaDetected: boolean;
    dimensions?: { w: number; h: number }; 
    selected: boolean;
    timestamp: number;
}

interface ActiveSlots {
    sourceA: string | null; 
    sourceB: string | null; 
    sourceC: string | null; 
    ref1: string | null;    
    ref2: string | null;    
    ref3: string | null;    
}

interface LibraryState {
  assets: LibraryAsset[];
  pendingAssets: PendingAsset[]; 
  activeTab: "assets" | "people";
  activeSlots: ActiveSlots;
  promptTexts: Record<string, string>; 
  slotsRevision: number;
  manualSlotsLocked: boolean;
  rememberLastClassify: boolean;
}

interface LibraryContextType extends LibraryState {
  setAssets: React.Dispatch<React.SetStateAction<LibraryAsset[]>>;
  setActiveTab: (tab: "assets" | "people") => void;
  stageFiles: (files: File[]) => Promise<void>;
  updatePendingAsset: (id: string, updates: Partial<PendingAsset>) => void;
  togglePendingSelection: (id: string) => void;
  setAllPendingSelection: (selected: boolean) => void;
  setPendingKindBulk: (kind: LibraryAssetKind) => void;
  commitPendingAssets: () => void; 
  discardPendingAssets: (ids?: string[]) => void;
  setRememberLastClassify: (enabled: boolean) => void;
  addAssetsFromFiles: (files: File[], overrideKind?: LibraryAssetKind) => Promise<void>;
  updateAssetKind: (id: string, kind: LibraryAssetKind) => void;
  removeAsset: (id: string) => void;
  getAssetById: (id: string) => LibraryAsset | undefined;
  assignSlot: (slotKey: keyof ActiveSlots, assetId: string) => void;
  swapActiveSlotsAB: () => void;
  fixActiveSlotKinds: (expectedA: LibraryAssetKind, expectedB: LibraryAssetKind) => void;
  setPromptText: (key: string, text: string) => void;
  resetWorkspace: () => void;
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

export const LibraryProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [pendingAssets, setPendingAssets] = useState<PendingAsset[]>([]);
  const [activeTab, setActiveTab] = useState<"assets" | "people">("assets");
  const [activeSlots, setActiveSlots] = useState<ActiveSlots>({ 
      sourceA: null, sourceB: null, sourceC: null, ref1: null, ref2: null, ref3: null
  });
  const [promptTexts, setPromptTexts] = useState<Record<string, string>>({
      tools_scene: "",
      tools_avatar: "",
      tools_product: "",
      customize: ""
  });
  
  const [slotsRevision, setSlotsRevision] = useState(0);
  const [manualSlotsLocked, setManualSlotsLocked] = useState(false);

  // Fix: Persistence for classification settings
  const [rememberLastClassify, setRememberLastClassifyState] = useState(() => {
      try { return localStorage.getItem("imagelab_remember_classify") === "true"; } catch { return false; }
  });
  const [lastKind, setLastKind] = useState<LibraryAssetKind>(() => {
      try { return (localStorage.getItem("imagelab_last_kind") as LibraryAssetKind) || "product"; } catch { return "product"; }
  });

  const setRememberLastClassify = useCallback((val: boolean) => {
      setRememberLastClassifyState(val);
      localStorage.setItem("imagelab_remember_classify", String(val));
  }, []);

  const stageFiles = useCallback(async (files: File[]) => {
      const newPending: PendingAsset[] = [];
      
      for (let f of files) {
          const dataUrl = await readFileAsDataUrl(f);
          const label = f.name.replace(/\.[^/.]+$/, "");
          const [detection, dims] = await Promise.all([
              detectAssetKind(dataUrl),
              getImageDimensions(f)
          ]);
          
          let initialKind: LibraryAssetKind = detection.kind;
          
          if (rememberLastClassify && lastKind !== 'unknown') {
              initialKind = lastKind;
          } else if (initialKind === 'unknown') {
              if (label.toLowerCase().includes('bg') || label.toLowerCase().includes('back')) initialKind = 'background';
              else if (label.toLowerCase().includes('person') || label.toLowerCase().includes('face')) initialKind = 'person';
              else initialKind = 'product';
          }

          newPending.push({
              id: safeId("pending"),
              file: f,
              dataUrl,
              label,
              kind: initialKind,
              alphaDetected: detection.alphaDetected,
              dimensions: dims || undefined,
              selected: true,
              timestamp: Date.now()
          });
      }

      setPendingAssets(prev => [...newPending, ...prev]);
  }, [rememberLastClassify, lastKind]);

  const updatePendingAsset = useCallback((id: string, updates: Partial<PendingAsset>) => {
      setPendingAssets(prev => prev.map(p => {
          if (p.id !== id) return p;
          const updated = { ...p, ...updates };
          if (updates.kind && rememberLastClassify) {
              setLastKind(updates.kind);
              localStorage.setItem("imagelab_last_kind", updates.kind);
          }
          return updated;
      }));
  }, [rememberLastClassify]);

  const togglePendingSelection = useCallback((id: string) => {
      setPendingAssets(prev => prev.map(p => p.id === id ? { ...p, selected: !p.selected } : p));
  }, []);

  const setAllPendingSelection = useCallback((selected: boolean) => {
      setPendingAssets(prev => prev.map(p => ({ ...p, selected })));
  }, []);

  const setPendingKindBulk = useCallback((kind: LibraryAssetKind) => {
      setPendingAssets(prev => prev.map(p => p.selected ? { ...p, kind } : p));
      if (rememberLastClassify) {
          setLastKind(kind);
          localStorage.setItem("imagelab_last_kind", kind);
      }
  }, [rememberLastClassify]);

  const commitPendingAssets = useCallback(() => {
      setPendingAssets(currentPending => {
          const toCommit = currentPending.filter(p => p.selected && p.kind !== 'unknown');
          const remaining = currentPending.filter(p => !p.selected || p.kind === 'unknown');

          if (toCommit.length > 0) {
              setAssets(prevAssets => {
                  const newAssets: LibraryAsset[] = toCommit.map(p => ({
                      id: safeId("asset"),
                      kind: p.kind,
                      label: p.label,
                      dataUrl: p.dataUrl,
                      type: p.kind === 'person' ? 'real' as PersonType : undefined,
                      alphaDetected: p.alphaDetected,
                      dimensions: p.dimensions, 
                      createdAt: Date.now()
                  }));
                  return [...newAssets, ...prevAssets];
              });
          }
          return remaining;
      });
  }, []);

  const discardPendingAssets = useCallback((ids?: string[]) => {
      setPendingAssets(prev => {
          if (!ids) return prev.filter(p => !p.selected); 
          return prev.filter(p => !ids.includes(p.id));
      });
  }, []);

  const addAssetsFromFiles = useCallback(async (files: File[], overrideKind?: LibraryAssetKind) => {
    if (overrideKind) {
        for (let f of files) {
            const dataUrl = await readFileAsDataUrl(f);
            const label = f.name.replace(/\.[^/.]+$/, "");
            const detection = await detectAssetKind(dataUrl);
            const dims = await getImageDimensions(f);
            
            const newAsset: LibraryAsset = {
                id: safeId("asset"),
                kind: overrideKind,
                label,
                dataUrl,
                type: overrideKind === 'person' ? 'real' : undefined,
                alphaDetected: detection.alphaDetected,
                dimensions: dims || undefined,
                createdAt: Date.now()
            };
            setAssets(prev => [newAsset, ...prev]);
        }
    } else {
        await stageFiles(files);
    }
  }, [stageFiles]);

  const updateAssetKind = useCallback((id: string, kind: LibraryAssetKind) => {
    setAssets(prev => prev.map(a => a.id === id ? { ...a, kind } : a));
    setSlotsRevision(prev => prev + 1);
  }, []);

  const removeAsset = useCallback((id: string) => {
    setAssets(prev => prev.filter(a => a.id !== id));
    setActiveSlots(prev => {
        const next = { ...prev };
        let changed = false;
        (Object.keys(next) as Array<keyof ActiveSlots>).forEach(key => {
            if (next[key] === id) {
                next[key] = null;
                changed = true;
            }
        });
        if (changed) setSlotsRevision(r => r + 1);
        return next;
    });
  }, []);

  const getAssetById = useCallback((id: string) => {
      return assets.find(a => a.id === id);
  }, [assets]);

  const assignSlot = useCallback((slotKey: keyof ActiveSlots, assetId: string) => {
      setActiveSlots(prev => {
          const nextId = prev[slotKey] === assetId ? null : assetId;
          return { ...prev, [slotKey]: nextId };
      });
      setSlotsRevision(prev => prev + 1);
      setManualSlotsLocked(true);
  }, []);

  const swapActiveSlotsAB = useCallback(() => {
      setActiveSlots(prev => {
          return {
              ...prev,
              sourceA: prev.sourceB,
              sourceB: prev.sourceA
          };
      });
      setSlotsRevision(prev => prev + 1);
      setManualSlotsLocked(true);
  }, []);

  const fixActiveSlotKinds = useCallback((expectedA: LibraryAssetKind, expectedB: LibraryAssetKind) => {
      setActiveSlots(currentSlots => {
          setAssets(currentAssets => {
              return currentAssets.map(asset => {
                  if (asset.id === currentSlots.sourceA && asset.kind !== expectedA) {
                      return { ...asset, kind: expectedA };
                  }
                  if (asset.id === currentSlots.sourceB && asset.kind !== expectedB) {
                      return { ...asset, kind: expectedB };
                  }
                  return asset;
              });
          });
          return currentSlots; 
      });
      setSlotsRevision(prev => prev + 1);
  }, []);

  const setPromptText = useCallback((key: string, text: string) => {
      setPromptTexts(prev => ({ ...prev, [key]: text }));
  }, []);

  const resetWorkspace = useCallback(() => {
      setActiveSlots({ sourceA: null, sourceB: null, sourceC: null, ref1: null, ref2: null, ref3: null });
      setPromptTexts({
          tools_scene: "",
          tools_avatar: "",
          tools_product: "",
          customize: ""
      });
      setManualSlotsLocked(false);
      setSlotsRevision(prev => prev + 1);
  }, []);

  return (
    <LibraryContext.Provider value={{
      assets,
      pendingAssets,
      activeTab,
      activeSlots,
      promptTexts,
      slotsRevision,
      manualSlotsLocked,
      rememberLastClassify,
      setAssets,
      setActiveTab,
      stageFiles,
      updatePendingAsset,
      togglePendingSelection,
      setAllPendingSelection,
      setPendingKindBulk,
      commitPendingAssets,
      discardPendingAssets,
      setRememberLastClassify,
      addAssetsFromFiles,
      updateAssetKind,
      removeAsset,
      getAssetById,
      assignSlot,
      swapActiveSlotsAB,
      fixActiveSlotKinds,
      setPromptText,
      resetWorkspace
    }}>
      {children}
    </LibraryContext.Provider>
  );
};

export function useLibraryStore() {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error("useLibraryStore must be used within a LibraryProvider");
  }
  return context;
}
