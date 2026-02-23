import React from "react";
import { computeFitProductParams } from "../../core/compose/fitProduct";

export type CompositeValues = {
  scale: number;
  offsetX: number;
  offsetY: number;
  shadowOpacity: number;
  shadowBlur: number;
  ambientOcclusion: boolean;
};

export type CompositeMeta = {
  productPx?: { w: number; h: number };
  targetPx?: { w: number; h: number };
};

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

function Stepper(props: {
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const { value, step, min, max, onChange } = props;
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        className="w-[70px] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-100"
        value={Number.isFinite(value) ? Number(value.toFixed(2)) : 0}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(clamp(Number(e.target.value), min, max))}
      />
      <div className="flex gap-1">
        <button
          type="button"
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-800"
          onClick={() => onChange(clamp(value - step, min, max))}
        >
          −
        </button>
        <button
          type="button"
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-800"
          onClick={() => onChange(clamp(value + step, min, max))}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function CompositeSettingsPanel(props: {
  enabled: boolean;
  values: CompositeValues;
  onChange: (next: CompositeValues) => void;
  meta?: CompositeMeta;
  title?: string;
  productDataUrl?: string; 
}) {
  const { enabled, values, onChange, meta, title = "COMPOSITE SETTINGS", productDataUrl } = props;

  const p = meta?.productPx;
  const t = meta?.targetPx;

  // Track if user has touched offsets to avoid overwriting manual placement
  const touchedOffsets = values.offsetX !== 0 || values.offsetY !== 0;

  const largeWarn =
    p && Math.max(p.w, p.h) > 3000
      ? `Large Image Warning: Product is ${p.w}×${p.h}px.`
      : null;

  function reset() {
    onChange({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      shadowOpacity: 0.4,
      shadowBlur: 15,
      ambientOcclusion: true,
    });
  }

  async function fitProduct() {
    if (!t) {
       onChange({ ...values, scale: clamp(values.scale || 1, 0.05, 2.0) });
       return;
    }

    if (productDataUrl) {
        try {
            const img = new Image();
            img.src = productDataUrl;
            await new Promise((r) => (img.onload = r));
            
            const params = await computeFitProductParams({
                productImg: img,
                outW: t.w,
                outH: t.h,
                currentOffsetX: values.offsetX,
                currentOffsetY: values.offsetY,
                touchedOffsets: touchedOffsets,
            });

            onChange({ 
                ...values, 
                scale: params.scale, 
                offsetX: params.offsetX,
                offsetY: params.offsetY
            });
        } catch (e) {
            console.warn("FitProduct: Failed", e);
        }
    } else {
        const ratio = 0.26;
        const targetH = Math.max(40, ratio * t.h);
        const bboxH = p?.h || 1;
        const scale = clamp(targetH / bboxH, 0.05, 3.0);
        onChange({ ...values, scale });
    }
  }

  const disabledCls = !enabled ? "opacity-60 pointer-events-none" : "";

  return (
    <div className={`rounded-2xl border border-zinc-800 bg-zinc-950 p-3 ${disabledCls} flex flex-col gap-2 max-h-[450px]`}>
      <div className="flex items-center justify-between shrink-0 mb-1">
        <div className="uv-title">{title}</div>
        <div className="flex gap-1.5">
          <button
            type="button"
            className="rounded-lg border border-emerald-700 bg-emerald-900/40 px-2 py-1 text-[9px] font-black text-emerald-200 hover:bg-emerald-900/60 transition-colors uppercase"
            onClick={fitProduct}
          >
            Fit
          </button>
          <button
            type="button"
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-[9px] font-black text-zinc-200 hover:bg-zinc-800 transition-colors uppercase"
            onClick={reset}
          >
            Reset
          </button>
        </div>
      </div>

      {largeWarn ? (
        <div className="shrink-0 rounded-xl border border-red-800 bg-red-950/40 p-2 text-[9px] leading-tight text-red-200">
          {largeWarn}
        </div>
      ) : null}

      {/* Internal Scroll Container for Sliders */}
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-4 max-h-[320px]">
        <div className="grid grid-cols-1 gap-4">
            {/* SCALE */}
            <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-[10px] font-black text-white/40 uppercase tracking-wider">Scale</div>
                  <Stepper value={values.scale} step={0.05} min={0.05} max={3.0} onChange={(v) => onChange({ ...values, scale: v })} />
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={3.0}
                  step={0.05}
                  value={values.scale}
                  onChange={(e) => onChange({ ...values, scale: Number(e.target.value) })}
                  className="w-full accent-amber-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
            </div>

            {/* OFFSET X */}
            <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-[10px] font-black text-white/40 uppercase tracking-wider">Offset X</div>
                  <Stepper value={values.offsetX} step={5} min={-1000} max={1000} onChange={(v) => onChange({ ...values, offsetX: v })} />
                </div>
                <input
                  type="range"
                  min={-1000}
                  max={1000}
                  step={1}
                  value={values.offsetX}
                  onChange={(e) => onChange({ ...values, offsetX: Number(e.target.value) })}
                  className="w-full accent-amber-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
            </div>

            {/* OFFSET Y */}
            <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-[10px] font-black text-white/40 uppercase tracking-wider">Offset Y</div>
                  <Stepper value={values.offsetY} step={5} min={-1000} max={1000} onChange={(v) => onChange({ ...values, offsetY: v })} />
                </div>
                <input
                  type="range"
                  min={-1000}
                  max={1000}
                  step={1}
                  value={values.offsetY}
                  onChange={(e) => onChange({ ...values, offsetY: Number(e.target.value) })}
                  className="w-full accent-amber-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
            </div>

            {/* SHADOW OPACITY */}
            <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-[10px] font-black text-white/40 uppercase tracking-wider">Shadow Opacity</div>
                  <Stepper value={values.shadowOpacity} step={0.05} min={0} max={1} onChange={(v) => onChange({ ...values, shadowOpacity: v })} />
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={values.shadowOpacity}
                  onChange={(e) => onChange({ ...values, shadowOpacity: Number(e.target.value) })}
                  className="w-full accent-amber-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
            </div>

            {/* SHADOW BLUR */}
            <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-[10px] font-black text-white/40 uppercase tracking-wider">Shadow Blur</div>
                  <Stepper value={values.shadowBlur} step={1} min={0} max={100} onChange={(v) => onChange({ ...values, shadowBlur: v })} />
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={1}
                  value={values.shadowBlur}
                  onChange={(e) => onChange({ ...values, shadowBlur: Number(e.target.value) })}
                  className="w-full accent-amber-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
            </div>

            {/* AMBIENT OCCLUSION */}
            <div className="flex items-center gap-3 pt-1">
                <input
                  type="checkbox"
                  checked={values.ambientOcclusion}
                  onChange={(e) => onChange({ ...values, ambientOcclusion: e.target.checked })}
                  className="h-4 w-4 accent-emerald-500 rounded border-white/10 bg-black/40"
                  id="chk-ao"
                />
                <label htmlFor="chk-ao" className="text-[11px] font-black text-emerald-200 uppercase tracking-wider cursor-pointer">Ambient Occlusion</label>
            </div>
        </div>
        <div className="h-4" />
      </div>
    </div>
  );
}
