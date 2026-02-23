
import React from "react";

export type HistoryItem = {
  id: string;
  thumbUrl: string;
  title?: string;
  module?: string;
};

export function HistoryDrawer(props: {
  isOpen: boolean;
  onClose: () => void;
  items: HistoryItem[];
  onSelect: (id: string) => void;
  onClear?: () => void;
}) {
  const { isOpen, onClose, items, onSelect, onClear } = props;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-[400px] max-w-[90vw] border-l border-zinc-800 bg-[#0a0a0a] shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 bg-[#121212]">
          <div className="text-sm font-black uppercase tracking-widest text-zinc-100">Session History</div>
          <div className="flex gap-2">
            {onClear ? (
              <button className="rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 px-3 py-1.5 text-[10px] font-bold uppercase text-red-400 transition-colors" onClick={onClear}>
                Clear
              </button>
            ) : null}
            <button className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase text-zinc-400 transition-colors" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {items.length === 0 && (
              <div className="text-center py-10 text-white/20 text-xs font-mono">No recent outputs</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {items.map((it) => (
              <button
                key={it.id}
                onClick={() => {
                  onSelect(it.id);
                  onClose();
                }}
                className="group overflow-hidden rounded-xl border border-white/10 bg-[#181818] text-left hover:border-[#FFAB00]/50 transition-all"
              >
                <div className="aspect-square w-full bg-black relative">
                  <img src={it.thumbUrl} alt={it.title ?? it.id} className="h-full w-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="p-2 bg-[#181818]">
                  <div className="truncate text-[9px] font-bold text-zinc-100">{it.title ?? "Output"}</div>
                  <div className="truncate text-[8px] text-zinc-500 font-mono uppercase">{it.module ?? "General"}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
