import React, { useState } from "react";
import type { SessionOutput } from "../../state/sessionOutputsStore";

export function PipelineOutputGallery(props: {
  title?: string;
  items: SessionOutput[];
  currentModule: string; // "customize", "tools", "promptpack"
  onOpenIndex: (index: number, filteredItems: SessionOutput[]) => void;
  onBulkDownload?: () => void;
  emptyMessage?: string;
}) {
  const { title = "PIPELINE OUTPUT GALLERY", items, currentModule, onOpenIndex, onBulkDownload, emptyMessage } = props;
  const [viewAll, setViewAll] = useState(false);

  // Filter items
  const filtered = viewAll ? items : items.filter((x) => {
      // Fuzzy match for 'tools' since we might have 'tools_scene', 'tools_ecom'
      if (currentModule === 'tools') return x.module.startsWith('tools');
      return x.module === currentModule;
  });

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
            <div className="uv-title">{title}</div>
            <div className="flex items-center gap-1.5 ml-2">
                <button 
                    onClick={() => setViewAll(false)}
                    className={`uv-chip ${!viewAll ? "uv-chip--active" : ""}`}
                >
                    Current
                </button>
                <button 
                    onClick={() => setViewAll(true)}
                    className={`uv-chip ${viewAll ? "uv-chip--active" : ""}`}
                >
                    All
                </button>
            </div>
        </div>
        <div className="flex gap-2">
            {filtered.length > 0 && <span className="px-2 py-1 bg-white/5 rounded text-[10px] text-zinc-500 font-mono">{filtered.length} ITEMS</span>}
            {onBulkDownload && filtered.length > 0 ? (
            <button className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 text-[10px] font-bold uppercase text-zinc-300 hover:bg-zinc-800 transition-colors" onClick={onBulkDownload}>
                Bulk Save
            </button>
            ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
          <div className="py-12 text-center border border-dashed border-zinc-800 rounded-xl">
              <p className="text-xs text-zinc-600 font-bold uppercase tracking-widest">
                  {!viewAll ? "No items in Current yet. Switch to 'All' or Generate to see results." : (emptyMessage || "No generated outputs.")}
              </p>
          </div>
      ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
            {filtered.map((it, idx) => (
              <button
                key={it.id}
                onClick={() => onOpenIndex(idx, filtered)}
                className="group relative aspect-square overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 text-left transition-all hover:border-amber-500/50 hover:ring-1 hover:ring-amber-500/20"
                title={it.label ?? it.id}
              >
                <img src={it.imageUrl || it.thumbUrl} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" alt={it.label ?? it.id} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                    <span className="text-[9px] font-bold text-white truncate w-full">{it.label}</span>
                    <span className="text-[8px] text-zinc-400 truncate">{it.module}</span>
                </div>
                <div className="absolute top-1 right-1 bg-black/60 px-1 py-0.5 rounded text-[7px] text-white/80 border border-white/10 font-mono">
                    {it.aspect || "1:1"}
                </div>
              </button>
            ))}
          </div>
      )}
    </div>
  );
}
