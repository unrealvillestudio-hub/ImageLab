import React from 'react';
import { LibraryAsset } from '../core/types.ts';

// --- ALERTS ---

export const WarningBanner: React.FC<{ title?: string; message?: string; children?: React.ReactNode }> = ({ title = "WARNING", message, children }) => (
    <div className="uv-warning mb-4 animate-in fade-in">
        <div className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse mt-1.5"></div>
            <div>
                <h4 className="uv-label text-red-500 mb-1">{title}</h4>
                {message && <p className="text-[10px] text-red-300/80 font-mono leading-relaxed">{message}</p>}
                {children}
            </div>
        </div>
    </div>
);

// --- BUTTONS ---

export function TabButton({ active, onClick, children }: React.PropsWithChildren<{ active: boolean; onClick: () => void }>) {
  return (
    <button 
      onClick={onClick} 
      className={`px-5 py-2 uv-btn text-[11px] ${active ? "uv-tab--active" : "uv-btn-ghost"}`}
    >
      {children}
    </button>
  );
}

export function SubToolButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={`uv-tab ${active ? "uv-tab--active" : ""}`}>{label}</button>
  );
}

export function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="px-4 py-2 uv-btn uv-btn-danger text-[9px] flex items-center gap-2">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4L20 20M4 20L20 4" /></svg> Reset
    </button>
  );
}

// --- CONTROLS ---

export function Label({ children, help, className }: React.PropsWithChildren<{ help?: string, className?: string }>) {
  return (
    <div className={`flex items-center gap-2 mb-1.5 ${className || ''}`}>
      <label className="uv-label pl-0.5">{children}</label>
      {help && (
        <div className="group relative">
           <div className="w-3 h-3 rounded-full border border-white/20 text-white/40 flex items-center justify-center text-[8px] cursor-help">?</div>
           <div className="absolute left-full top-0 ml-2 w-48 p-2 bg-black border border-white/10 rounded-lg text-[9px] text-white/80 leading-tight opacity-0 group-hover:opacity-100 pointer-events-none z-50 transition-opacity">
             {help}
           </div>
        </div>
      )}
    </div>
  );
}

export function ToggleFilter({ label, active, onChange, help }: { label: string, active: boolean, onChange: (v: boolean) => void, help?: string }) {
  return (
    <div className="flex items-center gap-3 cursor-pointer select-none group" onClick={() => onChange(!active)}>
      <div className={`w-9 h-5 rounded-full transition-all flex items-center p-0.5 border ${
        active 
          ? "bg-[rgba(16,185,129,0.45)] border-[rgba(16,185,129,0.6)] shadow-[0_0_10px_rgba(16,185,129,0.2)]" 
          : "bg-white/10 border-white/10"
      }`}>
        <div className={`w-3.5 h-3.5 rounded-full bg-black shadow-sm transition-transform duration-200 ease-in-out ${
          active ? "translate-x-4" : "translate-x-0"
        }`} />
      </div>
      <div className="flex items-center gap-2">
        <span className={`uv-label tracking-normal transition-colors ${active ? "text-emerald-400 font-bold" : "text-white/40 group-hover:text-white/60"}`}>{label}</span>
        {help && (
            <div className="group/tooltip relative">
            <div className="w-3 h-3 rounded-full border border-white/20 text-white/40 flex items-center justify-center text-[8px]">?</div>
            <div className="absolute left-full top-0 ml-2 w-48 p-2 bg-black border border-white/10 rounded-lg text-[9px] text-white/80 leading-tight opacity-0 group-hover/tooltip:opacity-100 pointer-events-none z-50 transition-opacity">
                {help}
            </div>
            </div>
        )}
      </div>
    </div>
  );
}

export function ControlSlider({ label, value, onChange, min, max, step, help, presets }: { 
    label: string, value: number, onChange: (v: number) => void, min: number, max: number, step: number, help?: string, presets?: { label: string, val: number }[]
}) {
    return (
        <div className="space-y-2.5">
            <div className="flex justify-between items-center">
                <Label help={help}>{label}</Label>
                <input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value))} step={step} className="w-12 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-right text-amber-200 focus:border-amber-500 outline-none"/>
            </div>
            <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} className="w-full accent-amber-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer" />
            {presets && (
                <div className="flex gap-1.5 justify-end">
                    {presets.map(p => (
                        <button key={p.label} onClick={() => onChange(p.val)} className="px-2 py-1 uv-pill text-[8px] text-white/40 uppercase font-black hover:text-white transition-colors">{p.label}</button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function SlotStatus({ label, asset, onClear }: { label: string, asset?: LibraryAsset | null, onClear?: () => void }) {
    return (
        <div className="flex items-center justify-between bg-white/5 p-2 rounded-xl border border-white/10">
            <div className="flex items-center gap-3 overflow-hidden">
                <div className={`w-8 h-8 rounded-lg bg-black/50 border border-white/10 flex items-center justify-center overflow-hidden flex-shrink-0`}>
                    {asset ? <img src={asset.dataUrl} className="w-full h-full object-cover" /> : <div className="text-[7px] text-white/20 font-black">EMPTY</div>}
                </div>
                <div className="flex flex-col min-w-0">
                    <span className="uv-label text-[8px] text-white/30">{label}</span>
                    <span className={`text-[10px] font-bold truncate ${asset ? "text-white" : "text-white/20"}`}>
                        {asset ? asset.label : "Not Assigned"}
                    </span>
                </div>
            </div>
            {asset && onClear && (
                <button onClick={onClear} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors text-lg">×</button>
            )}
        </div>
    );
}
