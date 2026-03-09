// ─── BlueprintInputPanel ──────────────────────────────────────────────────────
// Componente para cargar un Blueprint JSON en ToolsModule.
// Acepta archivo .json o paste directo. Valida tipo contra allowedTypes.
// ─────────────────────────────────────────────────────────────────────────────

import { useRef, useState } from "react";

// ── Tipos exportados ───────────────────────────────────────────────────────────

export type BlueprintType = 'person' | 'location' | 'product';

export interface ParsedBlueprint {
  id: string;
  type: BlueprintType;
  name: string;
  brandId: string;
  raw: Record<string, unknown>;
}

interface BlueprintInputPanelProps {
  label: string;
  allowedTypes: BlueprintType[];
  activeBlueprint: ParsedBlueprint | null;
  onBlueprintLoaded: (bp: ParsedBlueprint) => void;
  onBlueprintCleared: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function inferType(data: Record<string, unknown>): BlueprintType | null {
  const sv = (data.schema_version as string) ?? '';
  if (sv.startsWith('BP_PERSON')   || data.voicelab  || data.humanize)       return 'person';
  if (sv.startsWith('BP_LOCATION') || data.location  || data.scene)          return 'location';
  if (sv.startsWith('BP_PRODUCT')  || data.compliance_flags || data.sku)     return 'product';
  // legacy
  const schema = (data.schema as string) ?? '';
  if (schema === 'BP_PERSON'   || data.persona)   return 'person';
  if (schema === 'BP_LOCATION')                   return 'location';
  if (schema === 'BP_PRODUCT'  || data.imagelab)  return 'product';
  return null;
}

function extractName(data: Record<string, unknown>): string {
  return (
    (data.displayName   as string) ||
    (data.display_name  as string) ||
    (data.location_name as string) ||
    (data.name          as string) ||
    (data.id            as string) ||
    'Sin nombre'
  );
}

function parseBlueprint(json: string): { bp: ParsedBlueprint } | { error: string } {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json);
  } catch {
    return { error: 'JSON inválido. Verifica el formato.' };
  }

  const type = inferType(data);
  if (!type) return { error: 'No se puede detectar el tipo (BP_PERSON / BP_LOCATION / BP_PRODUCT).' };

  const bp: ParsedBlueprint = {
    id: (data.id as string) ?? crypto.randomUUID(),
    type,
    name: extractName(data),
    brandId: (data.brandId as string) ?? (data.brand_id as string) ?? 'unknown',
    raw: data,
  };

  return { bp };
}

// ── TYPE COLORS ────────────────────────────────────────────────────────────────
const TYPE_STYLE: Record<BlueprintType, { badge: string; dot: string; icon: string; label: string }> = {
  person:   { badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30',    dot: 'bg-blue-400',    icon: '👤', label: 'Persona'   },
  location: { badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-400', icon: '📍', label: 'Locación'  },
  product:  { badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30', dot: 'bg-amber-400',   icon: '📦', label: 'Producto'  },
};

// ── Componente ────────────────────────────────────────────────────────────────

export function BlueprintInputPanel({
  label,
  allowedTypes,
  activeBlueprint,
  onBlueprintLoaded,
  onBlueprintCleared,
}: BlueprintInputPanelProps) {
  const [expanded, setExpanded]   = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [error, setError]         = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const allowedLabel = allowedTypes.map(t => TYPE_STYLE[t].label).join(' / ');

  const handleLoad = (json: string) => {
    setError(null);
    const result = parseBlueprint(json);
    if ('error' in result) { setError(result.error); return; }
    if (!allowedTypes.includes(result.bp.type)) {
      setError(`Tipo "${result.bp.type}" no permitido aquí. Se esperaba: ${allowedLabel}.`);
      return;
    }
    onBlueprintLoaded(result.bp);
    setPasteText('');
    setExpanded(false);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleLoad(ev.target?.result as string);
    reader.readAsText(file);
    e.target.value = '';
  };

  const style = activeBlueprint ? TYPE_STYLE[activeBlueprint.type] : null;

  return (
    <div className="space-y-2">
      {/* ── Header / Estado activo ── */}
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-all ${
          activeBlueprint
            ? `${style!.badge} hover:opacity-90`
            : 'bg-zinc-800/60 border-zinc-700/50 hover:border-zinc-600'
        }`}
        onClick={() => setExpanded(v => !v)}
      >
        {activeBlueprint ? (
          <>
            <span className="text-sm">{style!.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate">{activeBlueprint.name}</p>
              <p className="text-[10px] opacity-60 truncate">{style!.label} · {activeBlueprint.brandId}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onBlueprintCleared(); setExpanded(false); }}
              className="text-[10px] px-2 py-0.5 rounded-md hover:bg-red-500/20 hover:text-red-400 transition-colors opacity-60 hover:opacity-100"
            >
              ✕ Quitar
            </button>
          </>
        ) : (
          <>
            <span className="text-base opacity-40">🗂</span>
            <p className="flex-1 text-xs text-zinc-500">{label}</p>
            <span className="text-[10px] text-zinc-600 font-mono">{allowedLabel}</span>
            <span className="text-zinc-600 text-xs">{expanded ? '▲' : '▼'}</span>
          </>
        )}
      </div>

      {/* ── Panel de carga (expandible) ── */}
      {expanded && (
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/80 p-3 space-y-2">
          {/* Cargar desde archivo */}
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-zinc-600 text-xs text-zinc-400 hover:border-zinc-400 hover:text-zinc-200 transition-colors"
          >
            📂 Cargar archivo .json
          </button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />

          {/* Pegar JSON */}
          <textarea
            value={pasteText}
            onChange={e => { setPasteText(e.target.value); setError(null); }}
            placeholder={`Pega el JSON del blueprint aquí...\n{ "schema_version": "BP_PERSON_1.0", "displayName": "...", ... }`}
            rows={8}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-2 text-[11px] text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-zinc-500 resize-y font-mono leading-relaxed"
            style={{ minHeight: '140px' }}
          />

          <button
            onClick={() => handleLoad(pasteText)}
            disabled={!pasteText.trim()}
            className="w-full py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed text-xs text-zinc-200 font-medium transition-colors"
          >
            Cargar Blueprint
          </button>

          {error && (
            <p className="text-[11px] text-red-400 bg-red-500/10 rounded-lg px-2.5 py-1.5 border border-red-500/20">
              ❌ {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
