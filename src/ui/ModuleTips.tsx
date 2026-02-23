import React, { useState } from 'react';
import { ModuleTipId, MODULE_TIPS } from './moduleTipsContent';

export function ModuleTips({ moduleId }: { moduleId: ModuleTipId }) {
    const [collapsed, setCollapsed] = useState(moduleId === 'library');
    const data = MODULE_TIPS[moduleId];
    if (!data) return null;

    if (collapsed) {
        return (
            <div 
                onClick={() => setCollapsed(false)}
                className="mb-6 p-2 bg-transparent border border-white/5 rounded-xl flex items-center justify-between cursor-pointer hover:border-amber-500/30 transition-all group"
            >
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500 text-[9px] font-black">i</div>
                    <span className="uv-label text-white/40 group-hover:text-white/60">Module Tips</span>
                </div>
                <span className="uv-label text-amber-500 opacity-0 group-hover:opacity-100">SHOW</span>
            </div>
        );
    }

    return (
        <div className="mb-6 relative group px-6 py-4 bg-transparent border border-transparent rounded-2xl">
            <button 
                onClick={(e) => { e.stopPropagation(); setCollapsed(true); }}
                className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/5 hover:bg-white/10 text-white/40 hover:text-white flex items-center justify-center text-[10px] transition-colors"
            >
                ✕
            </button>
            <div className="flex flex-col">
                <h4 className="uv-h3 text-amber-500 mb-3 uppercase tracking-widest">{data.title}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <ul className="space-y-2">
                        {data.bullets.map((b, i) => (
                            <li key={i} className="uv-body text-white/70 pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-amber-500/50">
                                {b}
                            </li>
                        ))}
                    </ul>
                    <div className="space-y-3 border-l border-white/5 pl-6 flex flex-col justify-center">
                        <div className="text-[10px]"><span className="uv-label text-emerald-400 mr-2">Best Workflow:</span><span className="uv-body text-white/60">{data.bestWorkflow}</span></div>
                        <div className="text-[10px]"><span className="uv-label text-red-400 mr-2">Avoid:</span><span className="uv-body text-white/60">{data.avoid}</span></div>
                    </div>
                </div>
            </div>
        </div>
    );
}
