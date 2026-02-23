
import React from "react";

export function ToolsPreviewPane(props: {
  previewUrl: string | null;
  emptyMessage?: string;
  onFullScreen?: () => void;
  className?: string;
  title?: string;
}) {
  const { previewUrl, emptyMessage = "No preview available", onFullScreen, className, title = "PREVIEW" } = props;

  return (
    <div className={`flex flex-col h-full ${className}`}>
        {title && <div className="mb-2 text-sm font-semibold text-zinc-100 uppercase tracking-widest">{title}</div>}
        
        <div className="bg-black/40 rounded-2xl border border-white/10 aspect-video flex items-center justify-center relative overflow-hidden group w-full h-full min-h-[200px]">
            {previewUrl ? (
                <>
                    <img src={previewUrl} className="max-w-full max-h-full object-contain" alt="Preview" />
                    {onFullScreen && (
                        <button 
                            onClick={onFullScreen} 
                            className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded-lg hover:bg-white/20 opacity-0 group-hover:opacity-100 transition-all border border-white/10"
                            title="Fullscreen"
                        >
                            ⤢
                        </button>
                    )}
                </>
            ) : (
                <div className="text-center text-white/20 text-xs font-mono px-4 select-none">
                    {emptyMessage}
                </div>
            )}
        </div>
    </div>
  );
}
