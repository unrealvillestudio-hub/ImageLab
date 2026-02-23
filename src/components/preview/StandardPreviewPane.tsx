
import React from "react";

export type PreviewSelected = {
  id: string;
  imageUrl: string;
  label?: string;
};

export function StandardPreviewPane(props: {
  title?: string;
  selected?: PreviewSelected;
  onDownload: () => void;
  onAddToLibrary: () => void;
  hint?: string;
}) {
  const { title = "PREVIEW", selected, onDownload, onAddToLibrary, hint } = props;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3 h-full flex flex-col">
      <div className="mb-2 text-sm font-semibold text-zinc-100">{title}</div>

      <div className="flex-1 min-h-0 w-full overflow-hidden rounded-xl border border-zinc-800 bg-black flex items-center justify-center relative">
        {selected?.imageUrl ? (
          <img src={selected.imageUrl} className="max-w-full max-h-full object-contain" alt={selected.label ?? "Preview"} />
        ) : (
          <div className="flex flex-col items-center justify-center px-6 text-center">
            <svg className="w-12 h-12 text-zinc-700 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span className="text-sm leading-6 text-zinc-500">{hint ?? "Select an output from the gallery."}</span>
          </div>
        )}
      </div>

      <div className="mt-3 flex gap-2 shrink-0">
        <button
          className="flex-1 rounded-xl bg-amber-500 px-3 py-2 text-sm font-semibold text-black disabled:opacity-40 disabled:grayscale transition-all"
          onClick={onDownload}
          disabled={!selected?.imageUrl}
        >
          Download
        </button>
        <button
          className="flex-1 rounded-xl border border-amber-400 px-3 py-2 text-sm font-semibold text-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          onClick={onAddToLibrary}
          disabled={!selected?.imageUrl}
        >
          Add to Library
        </button>
      </div>
    </div>
  );
}
