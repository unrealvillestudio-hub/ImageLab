import React from "react";

export type CompositeValues = {
  scale: number;
  offsetX: number;
  offsetY: number;
  shadowOpacity: number;
  shadowBlur: number;
  ambientOcclusion: boolean;
};

export type CompositeRenderInput = {
  bgUrl: string;
  productUrl?: string | null;
  outW: number;
  outH: number;
  params: CompositeValues;
};

export type CompositeRenderFn = (input: CompositeRenderInput) => Promise<string>; 

export function CompositePreviewPanel(props: {
  title?: string;
  hint?: string;
  bgUrl?: string | null;
  productUrl?: string | null;
  outPx: { w: number; h: number };
  params: CompositeValues;
  enabled: boolean;
  renderFn: CompositeRenderFn;
  className?: string;
}) {
  const { title = "PREVIEW", hint, bgUrl, productUrl, outPx, params, enabled, renderFn, className } = props;
  const [src, setSrc] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);
  const lastKey = React.useRef<string>("");

  React.useEffect(() => {
    if (!enabled || !bgUrl) {
      setSrc("");
      return;
    }
    
    // Create a key to debounce/deduplicate renders
    const key = JSON.stringify({ 
      bg: bgUrl.slice(-20), 
      prod: productUrl ? productUrl.slice(-20) : null, 
      w: outPx.w, h: outPx.h, 
      p: params 
    });
    
    if (key === lastKey.current) return;
    lastKey.current = key;

    let alive = true;
    
    // Small debounce to prevent render thrashing on slider drag
    const timer = setTimeout(() => {
        setBusy(true);
        renderFn({ bgUrl, productUrl: productUrl ?? null, outW: outPx.w, outH: outPx.h, params })
          .then((dataUrl) => {
            if (!alive) return;
            setSrc(dataUrl);
          })
          .catch(err => console.warn("Preview Render error", err))
          .finally(() => {
            if (!alive) return;
            setBusy(false);
          });
    }, 50);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [enabled, bgUrl, productUrl, outPx.w, outPx.h, params, renderFn]);

  return (
    <div className={`rounded-2xl border border-zinc-800 bg-zinc-950 p-3 h-full flex flex-col ${className || ""}`}>
      <div className="mb-2 flex items-center justify-between shrink-0">
        <div className="uv-title">{title}</div>
        <div className="flex gap-2 text-xs">
            {busy && <span className="text-zinc-500 animate-pulse uppercase font-black tracking-widest text-[8px]">Rendering...</span>}
            <span className="text-zinc-600 font-mono text-[9px]">{outPx.w}x{outPx.h}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 w-full overflow-hidden rounded-xl border border-zinc-800 bg-black relative flex items-center justify-center">
        {src ? (
            <img src={src} className="max-w-full max-h-full object-contain" alt="Composite Preview" />
        ) : (
            <div className="flex flex-col items-center justify-center px-6 text-center text-zinc-500">
                <p className="text-sm">{hint ?? "Live composite preview."}</p>
                {!enabled && <p className="text-xs text-zinc-700 mt-1">(Select Background & Product to start)</p>}
            </div>
        )}
      </div>
    </div>
  );
}
