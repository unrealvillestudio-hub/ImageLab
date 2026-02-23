
import React, { useState, useEffect, useRef } from "react";
import type { SessionOutput } from "../../state/sessionOutputsStore";

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export function OutputPreviewModal(props: {
  open: boolean;
  items: SessionOutput[];
  index: number;
  onSetIndex: (i: number) => void;
  onClose: () => void;
  onDiscard: (id: string) => void;
  onDownload: (id: string) => void;
  onAddToLibrary: (id: string) => Promise<boolean>; 
}) {
  const { open, items, index, onSetIndex, onClose, onDiscard, onDownload, onAddToLibrary } = props;
  const item = items[index];

  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const dragging = React.useRef(false);
  const last = React.useRef({ x: 0, y: 0 });

  // Add to Library State
  const [addedMap, setAddedMap] = useState<Record<string, boolean>>({});
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);

  React.useEffect(() => {
    if (!open) return;
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setAddError(null);
    setCopiedJson(false);
  }, [open, index]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onSetIndex(clamp(index - 1, 0, items.length - 1));
      if (e.key === "ArrowRight") onSetIndex(clamp(index + 1, 0, items.length - 1));
      if (e.key === "+" || e.key === "=") setZoom((z) => clamp(z + 0.1, 1, 5));
      if (e.key === "-") setZoom((z) => clamp(z - 0.1, 1, 5));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, items.length, onClose, onSetIndex]);

  if (!open || !item) return null;

  const prevDisabled = index <= 0;
  const nextDisabled = index >= items.length - 1;

  const onWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.12 : 0.12;
    setZoom((z) => clamp(z + delta, 1, 5));
  };

  const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (zoom <= 1) return;
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };
  };

  const onMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!dragging.current) return;
    const dx = e.clientX - last.current.x;
    const dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  };

  const stopDrag = () => {
    dragging.current = false;
  };

  const handleAddToLibraryClick = async () => {
      const id = item.id;
      setAddingId(id);
      setAddError(null);
      try {
          const success = await onAddToLibrary(id);
          if (success) {
              setAddedMap(prev => ({ ...prev, [id]: true }));
          } else {
              setAddError("Add failed.");
          }
      } catch (e: any) {
          setAddError(e?.message || "Add failed.");
      } finally {
          setAddingId(null);
      }
  };

  const handleCopyJson = () => {
      if (item.metadata) {
          navigator.clipboard.writeText(JSON.stringify(item.metadata, null, 2));
          setCopiedJson(true);
          setTimeout(() => setCopiedJson(false), 2000);
      }
  };

  const isAdded = !!addedMap[item.id];
  const isAdding = addingId === item.id;

  return (
    <div className="fixed inset-0 z-[2000]">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[980px] max-w-[96vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 bg-[#121212] rounded-t-2xl">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-zinc-100">
              {item.label || item.title || "Output"}{" "}
              <span className="ml-2 text-xs font-normal text-zinc-500">
                {item.aspect ?? ""}{item.w && item.h ? ` · ${item.w}×${item.h}` : ""} · {item.module}
              </span>
            </div>
            <div className="text-xs text-zinc-500">{new Date(item.createdAt).toLocaleString()}</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-200"
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            >
              Reset View
            </button>
            <button className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-200" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="p-4 bg-[#0a0a0a] flex-1 min-h-0 relative">
          
          {/* NAV OVERLAY LEFT */}
          <button
            disabled={prevDisabled}
            className={`absolute left-6 top-1/2 -translate-y-1/2 z-10 rounded-full border p-3 shadow-xl backdrop-blur-sm transition-all
              ${prevDisabled ? "border-zinc-800 text-zinc-600 cursor-not-allowed bg-black/20" : "border-zinc-700 bg-black/60 text-zinc-200 hover:bg-black/80 hover:scale-110 hover:border-zinc-500"}`}
            onClick={() => onSetIndex(index - 1)}
            title="Previous"
          >
            ←
          </button>

          {/* NAV OVERLAY RIGHT */}
          <button
            disabled={nextDisabled}
            className={`absolute right-6 top-1/2 -translate-y-1/2 z-10 rounded-full border p-3 shadow-xl backdrop-blur-sm transition-all
              ${nextDisabled ? "border-zinc-800 text-zinc-600 cursor-not-allowed bg-black/20" : "border-zinc-700 bg-black/60 text-zinc-200 hover:bg-black/80 hover:scale-110 hover:border-zinc-500"}`}
            onClick={() => onSetIndex(index + 1)}
            title="Next"
          >
            →
          </button>

          <div className="mb-2 flex justify-end text-xs text-zinc-500 pr-2">
              Zoom: {(zoom * 100).toFixed(0)}% (wheel / +/-)
          </div>

          <div
            className="mb-4 w-full overflow-hidden rounded-xl border border-zinc-800 bg-black relative"
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={stopDrag}
            onMouseLeave={stopDrag}
          >
            <div className="relative h-[62vh] max-h-[680px] w-full bg-[#050505]">
              <img
                src={item.imageUrl}
                alt={item.label ?? "Output"}
                className="absolute left-1/2 top-1/2 select-none max-w-none"
                style={{
                  transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
                  transformOrigin: "center",
                  cursor: zoom > 1 ? "grab" : "default",
                  maxHeight: zoom === 1 ? '100%' : 'none',
                  maxWidth: zoom === 1 ? '100%' : 'none'
                }}
                draggable={false}
              />
            </div>
          </div>

          {addError && (
              <div className="text-center mb-3">
                  <span className="bg-red-500/10 border border-red-500/30 text-red-400 px-3 py-1 rounded text-[10px] uppercase font-bold tracking-wide">
                      Error: {addError}
                  </span>
              </div>
          )}

          <div className="flex gap-3 justify-center">
            <button
              className="rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-900/40 transition-colors"
              onClick={() => onDiscard(item.id)}
            >
              Discard
            </button>
            <button
              className="rounded-xl bg-[#FFAB00] px-4 py-2 text-sm font-semibold text-black hover:bg-[#FFD77A] shadow-[0_0_15px_rgba(255,171,0,0.2)] transition-colors"
              onClick={() => onDownload(item.id)}
            >
              Download Image
            </button>
            
            {item.metadata && (
                <button
                    className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors flex items-center gap-2
                        ${copiedJson 
                            ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10" 
                            : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                        }
                    `}
                    onClick={handleCopyJson}
                >
                    {copiedJson ? "Copied JSON" : "Copy JSON"}
                </button>
            )}

            <button
              className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors flex items-center gap-2
                  ${isAdded 
                      ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10 cursor-default" 
                      : "border-[#FFAB00]/50 text-[#FFAB00] hover:bg-[#FFAB00]/10"
                  }
                  ${isAdding ? "opacity-70 cursor-wait" : ""}
              `}
              onClick={handleAddToLibraryClick}
              disabled={isAdded || isAdding}
            >
              {isAdded ? (
                  <>
                    <span>✓</span> Added
                  </>
              ) : isAdding ? (
                  "Adding..." 
              ) : (
                  "Add to Library"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
