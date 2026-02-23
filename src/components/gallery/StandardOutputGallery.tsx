
import React from "react";

export type GalleryItem = {
  id: string;
  thumbUrl: string;
  imageUrl?: string;
  label?: string;
  module?: string;
};

export function StandardOutputGallery(props: {
  title?: string;
  items: GalleryItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onBulkDownload?: () => void;
  emptyMessage?: string;
}) {
  const { title = "PIPELINE OUTPUT GALLERY", items, selectedId, onSelect, onBulkDownload, emptyMessage } = props;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm font-semibold text-amber-200 tracking-widest">{title}</div>
        {onBulkDownload && items.length > 0 ? (
          <button className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 transition-colors" onClick={onBulkDownload}>
            BULK DOWNLOAD
          </button>
        ) : null}
      </div>

      {items.length === 0 ? (
          <div className="py-8 text-center border border-dashed border-zinc-800 rounded-xl">
              <p className="text-xs text-zinc-500">{emptyMessage || "No outputs generated yet."}</p>
          </div>
      ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
            {items.map((it) => {
              const active = it.id === selectedId;
              return (
                <button
                  key={it.id}
                  onClick={() => onSelect(it.id)}
                  className={[
                    "relative aspect-square overflow-hidden rounded-xl border bg-zinc-900 text-left transition-all",
                    active ? "border-amber-400 ring-1 ring-amber-400/50" : "border-zinc-800 hover:border-zinc-600",
                  ].join(" ")}
                  title={it.label ?? it.id}
                >
                  <img src={it.thumbUrl} className="h-full w-full object-cover" alt={it.label ?? it.id} />
                  {it.module && (
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5 text-[8px] text-white/80 truncate">
                          {it.module}
                      </div>
                  )}
                </button>
              );
            })}
          </div>
      )}
    </div>
  );
}
