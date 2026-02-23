import React from 'react';
import { useLibraryStore } from '../../ui/stores/libraryStore.tsx';
import { LibraryAssetKind } from '../../core/types.ts';
import { ToggleFilter } from '../../ui/components.tsx';

export function UploadInbox({ onCommit }: { onCommit?: () => void }) {
    const { 
        pendingAssets, 
        updatePendingAsset, 
        togglePendingSelection, 
        setAllPendingSelection, 
        setPendingKindBulk,
        commitPendingAssets,
        discardPendingAssets,
        rememberLastClassify,
        setRememberLastClassify
    } = useLibraryStore();

    if (pendingAssets.length === 0) return null;

    const selectedCount = pendingAssets.filter(p => p.selected).length;
    const allSelected = pendingAssets.length > 0 && selectedCount === pendingAssets.length;
    
    const invalidSelection = pendingAssets.some(p => p.selected && p.kind === 'unknown');

    const handleKindChange = (kind: LibraryAssetKind) => {
        setPendingKindBulk(kind);
    };

    const handleCommit = () => {
        commitPendingAssets();
        if (onCommit) onCommit();
    }

    return (
        <div className="bg-[#121212] border-b border-white/10 flex flex-col animate-in slide-in-from-top-4 duration-300">
            <div className="p-4 border-b border-white/5 bg-[#181818]">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#FFAB00] flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#FFAB00] animate-pulse"></span>
                        Inbox (Pending Classification)
                    </h3>
                    <div className="flex items-center gap-2">
                         <ToggleFilter 
                             label="Remember" 
                             active={rememberLastClassify} 
                             onChange={setRememberLastClassify} 
                             help="Automatically apply last used classification to new uploads."
                         />
                    </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                    <label className="flex items-center gap-2 text-[9px] font-bold text-white/60 cursor-pointer select-none">
                        <input 
                            type="checkbox" 
                            checked={allSelected} 
                            onChange={(e) => setAllPendingSelection(e.target.checked)}
                            className="accent-[#FFAB00] w-3 h-3 rounded bg-white/10 border-white/20" 
                        />
                        ALL
                    </label>

                    <div className="h-4 w-px bg-white/10 mx-1 hidden md:block"></div>

                    <div className="flex gap-1">
                        <button onClick={() => handleKindChange('product')} className="px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-[8px] font-black uppercase transition-all">Product</button>
                        <button onClick={() => handleKindChange('person')} className="px-2 py-1 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded text-[8px] font-black uppercase transition-all">Person</button>
                        <button onClick={() => handleKindChange('background')} className="px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-[8px] font-black uppercase transition-all">BG</button>
                    </div>

                    <div className="flex-1"></div>
                    
                    <button 
                        onClick={() => discardPendingAssets()}
                        className="px-3 py-1 text-red-500 hover:text-red-400 text-[8px] font-bold uppercase transition-colors"
                    >
                        Discard ({selectedCount})
                    </button>
                    
                    <button 
                        onClick={handleCommit}
                        disabled={selectedCount === 0 || invalidSelection}
                        className={`px-4 py-1.5 rounded text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
                            selectedCount > 0 && !invalidSelection
                                ? "bg-[#FFAB00] text-black hover:bg-[#FFD77A] shadow-[0_0_10px_rgba(255,171,0,0.3)]" 
                                : "bg-white/5 text-white/20 cursor-not-allowed"
                        }`}
                    >
                        Commit Selected
                        {selectedCount > 0 && <span className="bg-black/20 px-1 rounded text-[8px]">{selectedCount}</span>}
                    </button>
                </div>
            </div>

            <div className="max-h-[300px] overflow-y-auto custom-scrollbar p-2 space-y-2">
                {pendingAssets.map(asset => {
                    const w = asset.dimensions?.w || 0;
                    const h = asset.dimensions?.h || 0;
                    const isOversized = w > 3000 || h > 3000;
                    const isHuge = w > 5000 || h > 5000;

                    return (
                        <div 
                            key={asset.id} 
                            className={`flex flex-col rounded-lg border transition-all ${
                                asset.selected ? "bg-white/5 border-white/10" : "bg-transparent border-transparent hover:bg-white/5"
                            }`}
                        >
                            <div className="flex items-center gap-3 p-2" onClick={() => togglePendingSelection(asset.id)}>
                                <input 
                                    type="checkbox" 
                                    checked={asset.selected}
                                    onChange={() => {}} 
                                    className="accent-[#FFAB00] w-3 h-3 bg-white/10 border-white/20 flex-shrink-0"
                                />
                                
                                <div className="w-10 h-10 rounded bg-black/40 border border-white/5 flex-shrink-0 overflow-hidden">
                                    <img src={asset.dataUrl} className="w-full h-full object-cover" />
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="text-[9px] font-bold text-white/90 truncate mb-1">{asset.label}</div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <select 
                                            value={asset.kind}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                updatePendingAsset(asset.id, { kind: e.target.value as LibraryAssetKind });
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            className={`h-5 text-[8px] font-black uppercase rounded px-2 border-none outline-none cursor-pointer appearance-none transition-colors ${
                                                asset.kind === 'product' ? 'bg-emerald-500 text-black' : 
                                                asset.kind === 'background' ? 'bg-blue-500 text-white' : 
                                                asset.kind === 'person' ? 'bg-purple-500 text-white' : 
                                                asset.kind === 'reference' ? 'bg-white/20 text-white' :
                                                'bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse'
                                            }`}
                                        >
                                            <option value="unknown">SELECT TYPE</option>
                                            <option value="product">Product</option>
                                            <option value="person">Person</option>
                                            <option value="background">Background</option>
                                            <option value="reference">Reference</option>
                                        </select>
                                        
                                        <span className="text-[8px] font-mono text-white/30">{w}x{h}</span>

                                        {asset.kind === 'unknown' && (
                                            <span className="text-[8px] text-red-400 italic">Required</span>
                                        )}
                                    </div>
                                </div>

                                <button 
                                    onClick={(e) => { e.stopPropagation(); discardPendingAssets([asset.id]); }}
                                    className="w-6 h-6 rounded-full flex items-center justify-center text-white/20 hover:text-red-500 hover:bg-white/5 transition-all opacity-0 group-hover:opacity-100"
                                >
                                    ×
                                </button>
                            </div>
                            
                            {isOversized && asset.kind === 'product' && (
                                <div className="mx-2 mb-2 p-2 bg-red-500/10 border-t border-red-500/20 rounded-b">
                                    <p className="text-[9px] text-red-300 font-bold flex items-center gap-1">
                                        <span>⚠️</span>
                                        {isHuge ? "HUGE IMAGE DETECTED" : "Large Image Warning"}
                                    </p>
                                    <p className="text-[9px] text-red-200/80 leading-relaxed mt-1">
                                        Product is {w}x{h}px. {isHuge ? "Critically large." : "Larger than recommended (3000px)."}
                                        <br/>
                                        Resize to ~2000px before uploading for better scale control and performance.
                                    </p>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}