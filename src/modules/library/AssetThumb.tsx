import React from 'react';
import { LibraryAsset, LibraryAssetKind } from '../../core/types.ts';

interface AssetThumbProps {
    asset: LibraryAsset;
    activeSlots: {
        sourceA: string | null;
        sourceB: string | null;
        sourceC: string | null;
        ref1: string | null;
        ref2: string | null;
        ref3: string | null;
    };
    onAssignSlot: (slotKey: 'sourceA' | 'sourceB' | 'sourceC' | 'ref1' | 'ref2' | 'ref3', assetId: string) => void;
    onUpdateKind: (id: string, kind: LibraryAssetKind) => void;
    onRemove: (id: string) => void;
    onPreview: (asset: LibraryAsset) => void;
}

export const AssetThumb: React.FC<AssetThumbProps> = ({ asset, activeSlots, onAssignSlot, onUpdateKind, onRemove, onPreview }) => {
    return (
        <div className="group relative bg-[#181818] rounded-xl overflow-hidden border border-white/5 hover:border-[#FFAB00]/40 transition-all">
            <img 
                src={asset.dataUrl} 
                onClick={() => onPreview(asset)} 
                className="w-full h-56 object-cover opacity-80 group-hover:opacity-100 cursor-zoom-in" 
                alt={asset.label}
            />
            
            {/* KIND BADGE */}
            <div className="absolute top-1 left-1 z-20">
                <select 
                    value={asset.kind} 
                    onChange={(e) => onUpdateKind(asset.id, e.target.value as LibraryAssetKind)}
                    onClick={(e) => e.stopPropagation()}
                    className={`text-[8px] font-black uppercase rounded px-1.5 py-0.5 border-none outline-none cursor-pointer appearance-none ${
                        asset.kind === 'product' ? 'bg-emerald-500 text-black' : 
                        asset.kind === 'background' ? 'bg-blue-500 text-white' : 
                        asset.kind === 'person' ? 'bg-purple-500 text-white' : 
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

            <div className="p-3 space-y-2 bg-black/90 backdrop-blur-md absolute bottom-0 left-0 right-0 translate-y-full group-hover:translate-y-0 transition-transform z-10">
                <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold text-white/90 truncate">{asset.label}</span>
                    <button 
                        onClick={(e) => { e.stopPropagation(); onRemove(asset.id); }} 
                        className="text-[8px] text-red-500 hover:text-red-400 font-bold"
                    >
                        DEL
                    </button>
                </div>
                {/* 6-Slot Allocation Grid */}
                <div className="grid grid-cols-6 gap-1">
                    <button onClick={(e) => { e.stopPropagation(); onAssignSlot('sourceA', asset.id); }} className={`py-1.5 rounded text-[8px] font-black uppercase ${activeSlots.sourceA === asset.id ? "bg-[#FFAB00] text-black" : "bg-white/20 text-white hover:bg-white/30"}`} title="Assign to Subject A">A</button>
                    <button onClick={(e) => { e.stopPropagation(); onAssignSlot('sourceB', asset.id); }} className={`py-1.5 rounded text-[8px] font-black uppercase ${activeSlots.sourceB === asset.id ? "bg-blue-500 text-white" : "bg-white/20 text-white hover:bg-white/30"}`} title="Assign to Background">B</button>
                    <button onClick={(e) => { e.stopPropagation(); onAssignSlot('sourceC', asset.id); }} className={`py-1.5 rounded text-[8px] font-black uppercase ${activeSlots.sourceC === asset.id ? "bg-purple-500 text-white" : "bg-white/20 text-white hover:bg-white/30"}`} title="Assign to Subject 2">C</button>
                    <button onClick={(e) => { e.stopPropagation(); onAssignSlot('ref1', asset.id); }} className={`py-1.5 rounded text-[8px] font-black uppercase ${activeSlots.ref1 === asset.id ? "bg-emerald-500 text-black" : "bg-white/10 text-white/60 hover:bg-white/20"}`} title="Assign to Ref 1">R1</button>
                    <button onClick={(e) => { e.stopPropagation(); onAssignSlot('ref2', asset.id); }} className={`py-1.5 rounded text-[8px] font-black uppercase ${activeSlots.ref2 === asset.id ? "bg-emerald-500 text-black" : "bg-white/10 text-white/60 hover:bg-white/20"}`} title="Assign to Ref 2">R2</button>
                    <button onClick={(e) => { e.stopPropagation(); onAssignSlot('ref3', asset.id); }} className={`py-1.5 rounded text-[8px] font-black uppercase ${activeSlots.ref3 === asset.id ? "bg-emerald-500 text-black" : "bg-white/10 text-white/60 hover:bg-white/20"}`} title="Assign to Ref 3">R3</button>
                </div>
            </div>
        </div>
    );
};