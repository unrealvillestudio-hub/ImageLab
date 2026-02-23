import React from 'react';
import { LibraryAsset } from '../../core/types.ts';

interface StandardActiveSlotsProps {
    slots: {
        sourceA: LibraryAsset | undefined | null;
        sourceB: LibraryAsset | undefined | null;
        sourceC: LibraryAsset | undefined | null;
        ref1: LibraryAsset | undefined | null;
        ref2: LibraryAsset | undefined | null;
        ref3: LibraryAsset | undefined | null;
    };
    onAssign: (key: string, id: string) => void;
    onClear: (key: string) => void;
    title?: string;
    activeKeys?: string[]; 
}

export function StandardActiveSlots({ slots, onAssign, onClear, title = "ACTIVE ASSET SLOTS", activeKeys }: StandardActiveSlotsProps) {
    const renderSlot = (label: string, key: string, asset: LibraryAsset | undefined | null, colorClass: string = "text-white") => {
        const isAssigned = !!asset;
        const isUsed = isAssigned && activeKeys && activeKeys.includes(key);

        return (
            <div 
                className={`flex items-center justify-between p-2 rounded-lg border mb-1 group transition-all duration-300
                    ${isUsed 
                        ? "bg-[rgba(16,185,129,0.16)] border-[rgba(16,185,129,0.35)] shadow-[0_0_10px_rgba(16,185,129,0.1)]" 
                        : "bg-white/5 border-white/10 hover:border-white/20"
                    }
                `}
            >
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className={`w-8 h-8 rounded bg-black/50 border border-white/10 flex items-center justify-center overflow-hidden flex-shrink-0 relative`}>
                        {asset ? (
                            <img src={asset.dataUrl} className="w-full h-full object-cover" alt={label} />
                        ) : (
                            <div className="text-[7px] text-white/20 font-mono text-center leading-tight">EMPTY</div>
                        )}
                        <div className="absolute top-0 right-0 bg-black/70 text-[6px] px-1 text-white/50 font-mono">{label.split(' ')[1] || label.charAt(0)}</div>
                    </div>
                    
                    <div className="flex flex-col min-w-0">
                        <span className={`text-[8px] font-black uppercase tracking-wider ${isUsed ? "text-emerald-400" : "text-white/40"}`}>
                            {label}
                        </span>
                        <span className={`text-[9px] font-bold truncate ${isAssigned ? (isUsed ? "text-white" : colorClass) : "text-white/20 italic"}`}>
                            {asset ? asset.label : "Not Assigned"}
                        </span>
                    </div>
                </div>

                {asset ? (
                    <button 
                        onClick={() => onClear(key)} 
                        className={`w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors ${isUsed ? "text-emerald-500/50 hover:text-emerald-400" : "text-white/40 hover:text-red-400"}`}
                        title="Clear Slot"
                    >
                        ×
                    </button>
                ) : (
                    <div className="text-[8px] text-white/10 uppercase tracking-widest px-2">
                        --
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col">
            <h4 className="text-[9px] font-black uppercase tracking-widest text-[#FFAB00] mb-2">{title}</h4>
            <div className="space-y-0.5">
                {renderSlot("Slot A (Subject)", "sourceA", slots.sourceA, "text-[#FFAB00]")}
                {renderSlot("Slot B (Background)", "sourceB", slots.sourceB, "text-blue-400")}
                {renderSlot("Slot C (Subj 2)", "sourceC", slots.sourceC, "text-purple-400")}
                <div className="h-2"></div>
                {renderSlot("Ref 1 (Style)", "ref1", slots.ref1, "text-emerald-400")}
                {renderSlot("Ref 2 (Style)", "ref2", slots.ref2, "text-emerald-400")}
                {renderSlot("Ref 3 (Style)", "ref3", slots.ref3, "text-emerald-400")}
            </div>
        </div>
    );
}