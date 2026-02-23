
import React from 'react';

export function DebugOverlay({ title, items, expanded }: { title: string, items: Record<string, string>, expanded?: boolean }) {
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
