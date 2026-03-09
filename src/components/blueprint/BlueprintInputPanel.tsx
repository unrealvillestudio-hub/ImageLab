// ─── BlueprintInputPanel ──────────────────────────────────────────────────────
// Azul + badge verde "Blueprint inyectado" cuando activo.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useRef, useState } from "react";

export type BlueprintType = 'person' | 'location' | 'product';

export interface ParsedBlueprint {
  id: string;
  type: BlueprintType;
  name: string;
  brandId: string;
  raw: Record<string, unknown>;
}

interface Props {
  label: string;
  allowedTypes: BlueprintType[];
  activeBlueprint: ParsedBlueprint | null;
  onBlueprintLoaded: (bp: ParsedBlueprint) => void;
  onBlueprintCleared: () => void;
}

const TYPE_META: Record<BlueprintType, { icon: string; label: string }> = {
  person:   { icon: '👤', label: 'Persona'  },
  location: { icon: '📍', label: 'Locación' },
  product:  { icon: '📦', label: 'Producto' },
};

function inferType(d: Record<string, unknown>): BlueprintType | null {
  const sv = (d.schema_version as string) ?? '';
  if (sv.startsWith('BP_PERSON')   || d.voicelab   || d.humanize)       return 'person';
  if (sv.startsWith('BP_LOCATION') || d.location   || d.scene)          return 'location';
  if (sv.startsWith('BP_PRODUCT')  || d.compliance_flags || d.sku)      return 'product';
  const s = (d.schema as string) ?? '';
  if (s === 'BP_PERSON'  || d.persona)  return 'person';
  if (s === 'BP_LOCATION')              return 'location';
  if (s === 'BP_PRODUCT' || d.imagelab) return 'product';
  return null;
}

function extractName(d: Record<string, unknown>): string {
  return ((d.displayName || d.display_name || d.location_name || d.name || d.id) as string) || 'Sin nombre';
}

function parseBP(json: string, allowed: BlueprintType[], allowedLabel: string): { bp: ParsedBlueprint } | { error: string } {
  let data: Record<string, unknown>;
  try { data = JSON.parse(json); } catch { return { error: 'JSON inválido.' }; }
  const type = inferType(data);
  if (!type) return { error: 'No se detecta el tipo (BP_PERSON / BP_LOCATION / BP_PRODUCT).' };
  if (!allowed.includes(type)) return { error: `Tipo "${type}" no permitido aquí. Se esperaba: ${allowedLabel}.` };
  return { bp: { id: (data.id as string) ?? crypto.randomUUID(), type, name: extractName(data), brandId: ((data.brandId || data.brand_id) as string) ?? 'unknown', raw: data } };
}

// ── Sub-panel de carga ────────────────────────────────────────────────────────
function LoadPanel({ onLoad, allowedLabel, fileRef, handleFile }: {
  onLoad: (json: string) => void;
  allowedLabel: string;
  fileRef: React.RefObject<HTMLInputElement>;
  handleFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const [paste, setPaste] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const doLoad = (json: string) => {
    setErr(null);
    const r = parseBP(json, [], allowedLabel); // validation done in parent
    // just relay the raw text
    onLoad(json);
  };

  return (
    <div className="px-4 pb-4 pt-3 space-y-3 bg-black/25 border-t border-white/8">
      <button
        onClick={() => fileRef.current?.click()}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-white/15 text-xs text-white/40 hover:border-white/35 hover:text-white/70 transition-colors"
      >
        📂 Cargar archivo .json
      </button>
      <div>
        <p className="text-[10px] text-white/25 mb-1.5 font-mono">O pega el JSON ({allowedLabel}):</p>
        <textarea
          value={paste}
          onChange={e => { setPaste(e.target.value); setErr(null); }}
          placeholder={'{ "schema_version": "BP_PERSON_1.0", "displayName": "...", ... }'}
          rows={10}
          className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-[11px] text-white/60 placeholder:text-white/20 outline-none focus:border-blue-500/40 resize-y font-mono leading-relaxed"
          style={{ minHeight: '160px' }}
        />
      </div>
      <button
        onClick={() => onLoad(paste)}
        disabled={!paste.trim()}
        className="w-full py-2.5 rounded-xl bg-blue-600/25 hover:bg-blue-600/40 border border-blue-500/30 disabled:opacity-30 disabled:cursor-not-allowed text-sm text-blue-300 font-semibold transition-colors"
      >
        Cargar Blueprint
      </button>
      {err && <p className="text-[11px] text-red-400 bg-red-500/10 rounded-xl px-3 py-2 border border-red-500/20">❌ {err}</p>}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export function BlueprintInputPanel({ label, allowedTypes, activeBlueprint, onBlueprintLoaded, onBlueprintCleared }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const allowedLabel = allowedTypes.map(t => TYPE_META[t].label).join(' / ');

  const handleLoad = (json: string) => {
    setErr(null);
    const result = parseBP(json, allowedTypes, allowedLabel);
    if ('error' in result) { setErr(result.error); return; }
    onBlueprintLoaded(result.bp);
    setExpanded(false);
    setErr(null);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => handleLoad(ev.target?.result as string);
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── ACTIVO ───────────────────────────────────────────────────────────────
  if (activeBlueprint) {
    const meta = TYPE_META[activeBlueprint.type];
    return (
      <div className="rounded-2xl border-2 border-blue-500/50 bg-blue-500/8 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="text-2xl">{meta.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-blue-100 leading-tight">{activeBlueprint.name}</p>
              <span className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/35 text-emerald-400 font-semibold whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                Blueprint inyectado
              </span>
            </div>
            <p className="text-[11px] text-blue-300/50 mt-0.5">{meta.label} · {activeBlueprint.brandId}</p>
          </div>
          <button
            onClick={() => { onBlueprintCleared(); setExpanded(false); }}
            className="flex-shrink-0 text-[10px] px-2.5 py-1 rounded-lg bg-white/5 hover:bg-red-500/15 hover:text-red-400 text-white/35 border border-white/10 hover:border-red-500/25 transition-all"
          >
            ✕ Quitar
          </button>
        </div>
        {err && <p className="text-[11px] text-red-400 px-4 pb-2">❌ {err}</p>}
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full text-[10px] text-blue-400/40 hover:text-blue-400 py-1.5 border-t border-blue-500/15 hover:bg-blue-500/5 transition-colors"
        >
          {expanded ? '▲ Cerrar' : '↺ Reemplazar blueprint'}
        </button>
        {expanded && <LoadPanel onLoad={handleLoad} allowedLabel={allowedLabel} fileRef={fileRef} handleFile={handleFile} />}
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
      </div>
    );
  }

  // ── VACÍO ─────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-dashed border-white/12 hover:border-white/22 overflow-hidden transition-colors">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/3 transition-colors text-left"
      >
        <span className="text-lg opacity-25">🗂</span>
        <div className="flex-1">
          <p className="text-xs text-white/45 font-medium">{label}</p>
          <p className="text-[10px] text-white/22 mt-0.5">{allowedLabel}</p>
        </div>
        <span className="text-white/20 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>
      {err && <p className="text-[11px] text-red-400 px-4 pb-2">❌ {err}</p>}
      {expanded && (
        <>
          <LoadPanel onLoad={handleLoad} allowedLabel={allowedLabel} fileRef={fileRef} handleFile={handleFile} />
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
        </>
      )}
    </div>
  );
}
