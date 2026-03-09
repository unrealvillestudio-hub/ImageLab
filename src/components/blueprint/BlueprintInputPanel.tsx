// ─── BlueprintInputPanel ──────────────────────────────────────────────────────
// Look & feel integrado con el tema UV de ImageLab.
// Vacío: uv-panel con título amber (uv-title style).
// Activo: borde azul + badge verde "Blueprint inyectado".
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
  if (sv.startsWith('BP_PERSON')   || d.voicelab   || d.humanize)        return 'person';
  if (sv.startsWith('BP_LOCATION') || d.location   || d.scene)           return 'location';
  if (sv.startsWith('BP_PRODUCT')  || d.compliance_flags || d.sku)       return 'product';
  const s = (d.schema as string) ?? '';
  if (s === 'BP_PERSON'  || d.persona)  return 'person';
  if (s === 'BP_LOCATION')              return 'location';
  if (s === 'BP_PRODUCT' || d.imagelab) return 'product';
  return null;
}

function extractName(d: Record<string, unknown>): string {
  return ((d.displayName || d.display_name || d.location_name || d.name || d.id) as string) || 'Sin nombre';
}

function parseBP(
  json: string,
  allowed: BlueprintType[],
  allowedLabel: string
): { bp: ParsedBlueprint } | { error: string } {
  let data: Record<string, unknown>;
  try { data = JSON.parse(json); } catch { return { error: 'JSON inválido.' }; }
  const type = inferType(data);
  if (!type) return { error: 'No se detecta el tipo (BP_PERSON / BP_LOCATION / BP_PRODUCT).' };
  if (!allowed.includes(type)) return { error: `Tipo "${type}" no permitido aquí. Se esperaba: ${allowedLabel}.` };
  return {
    bp: {
      id: (data.id as string) ?? crypto.randomUUID(),
      type,
      name: extractName(data),
      brandId: ((data.brandId || data.brand_id) as string) ?? 'unknown',
      raw: data,
    }
  };
}

// ── Panel de carga interno ────────────────────────────────────────────────────
function LoadPanel({ onLoad, allowedLabel, fileRef, handleFile }: {
  onLoad: (json: string) => void;
  allowedLabel: string;
  fileRef: React.RefObject<HTMLInputElement>;
  handleFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const [paste, setPaste] = useState('');
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="px-4 pb-4 pt-3 space-y-3" style={{ background: 'rgba(0,0,0,0.25)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <button
        onClick={() => fileRef.current?.click()}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs transition-colors"
        style={{ border: '1px dashed rgba(255,171,0,0.25)', color: 'rgba(255,171,0,0.5)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,171,0,0.5)'; (e.currentTarget as HTMLButtonElement).style.color = '#FFAB00'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,171,0,0.25)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,171,0,0.5)'; }}
      >
        📂 Cargar archivo .json
      </button>
      <div>
        <p className="mb-1.5 font-mono" style={{ fontSize: '10px', color: 'rgba(235,235,235,0.3)', letterSpacing: '0.1em' }}>
          O pega el JSON ({allowedLabel}):
        </p>
        <textarea
          value={paste}
          onChange={e => { setPaste(e.target.value); setErr(null); }}
          placeholder={'{ "schema_version": "BP_PERSON_1.0", "displayName": "...", ... }'}
          rows={10}
          className="w-full rounded-xl px-3 py-2.5 font-mono leading-relaxed resize-y outline-none"
          style={{
            fontSize: '11px',
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(235,235,235,0.6)',
            minHeight: '160px',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'rgba(255,171,0,0.3)'; }}
          onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
        />
      </div>
      <button
        onClick={() => { setErr(null); onLoad(paste); }}
        disabled={!paste.trim()}
        className="w-full py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ background: 'rgba(255,171,0,0.12)', border: '1px solid rgba(255,171,0,0.25)', color: '#FFAB00' }}
      >
        Cargar Blueprint
      </button>
      {err && (
        <p className="text-xs px-3 py-2 rounded-xl" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#F87171' }}>
          ❌ {err}
        </p>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export function BlueprintInputPanel({ label, allowedTypes, activeBlueprint, onBlueprintLoaded, onBlueprintCleared }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const allowedLabel = allowedTypes.map(t => TYPE_META[t].label).join(' / ');

  const handleLoad = (json: string) => {
    setErr(null);
    const result = parseBP(json, allowedTypes, allowedLabel);
    if ('error' in result) { setErr(result.error); return; }
    onBlueprintLoaded(result.bp);
    setExpanded(false);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => handleLoad(ev.target?.result as string);
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── ACTIVO — borde azul, badge verde ─────────────────────────────────────
  if (activeBlueprint) {
    const meta = TYPE_META[activeBlueprint.type];
    return (
      <div className="rounded-2xl overflow-hidden" style={{ border: '2px solid rgba(59,130,246,0.55)', background: 'rgba(59,130,246,0.07)' }}>
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span style={{ fontSize: '22px' }}>{meta.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold truncate" style={{ color: '#BFDBFE' }}>{activeBlueprint.name}</p>
              {/* Badge verde animado */}
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full font-semibold whitespace-nowrap"
                style={{ fontSize: '10px', background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.35)', color: '#34D399' }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#34D399' }} />
                Blueprint inyectado
              </span>
            </div>
            <p className="mt-0.5" style={{ fontSize: '11px', color: 'rgba(147,197,253,0.5)' }}>
              {meta.label} · {activeBlueprint.brandId}
            </p>
          </div>
          <button
            onClick={() => { onBlueprintCleared(); setExpanded(false); }}
            className="flex-shrink-0 rounded-lg transition-all"
            style={{ fontSize: '10px', padding: '4px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.35)' }}
            onMouseEnter={e => { const b = e.currentTarget; b.style.background = 'rgba(239,68,68,0.12)'; b.style.color = '#F87171'; b.style.borderColor = 'rgba(239,68,68,0.25)'; }}
            onMouseLeave={e => { const b = e.currentTarget; b.style.background = 'rgba(255,255,255,0.04)'; b.style.color = 'rgba(255,255,255,0.35)'; b.style.borderColor = 'rgba(255,255,255,0.10)'; }}
          >
            ✕ Quitar
          </button>
        </div>
        {err && <p className="px-4 pb-2 text-xs" style={{ color: '#F87171' }}>❌ {err}</p>}
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full py-1.5 transition-colors"
          style={{ fontSize: '10px', color: 'rgba(147,197,253,0.4)', borderTop: '1px solid rgba(59,130,246,0.15)' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#93C5FD'; e.currentTarget.style.background = 'rgba(59,130,246,0.05)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'rgba(147,197,253,0.4)'; e.currentTarget.style.background = 'transparent'; }}
        >
          {expanded ? '▲ Cerrar' : '↺ Reemplazar blueprint'}
        </button>
        {expanded && <LoadPanel onLoad={handleLoad} allowedLabel={allowedLabel} fileRef={fileRef} handleFile={handleFile} />}
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
      </div>
    );
  }

  // ── VACÍO — mismo look que uv-panel con título amber ──────────────────────
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' }}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,171,0,0.04)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        {/* Ícono amber */}
        <span style={{ fontSize: '16px', color: '#FFAB00', opacity: 0.7 }}>🗂</span>
        <div className="flex-1">
          {/* Título en estilo uv-title: amber, bold, uppercase, tracking */}
          <p style={{ color: '#FFAB00', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: '11px' }}>
            {label}
          </p>
          <p style={{ fontSize: '10px', color: 'rgba(235,235,235,0.3)', marginTop: '2px', letterSpacing: '0.08em' }}>
            {allowedLabel}
          </p>
        </div>
        <span style={{ color: 'rgba(255,171,0,0.4)', fontSize: '11px' }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {err && <p className="px-4 pb-2 text-xs" style={{ color: '#F87171' }}>❌ {err}</p>}
      {expanded && (
        <>
          <LoadPanel onLoad={handleLoad} allowedLabel={allowedLabel} fileRef={fileRef} handleFile={handleFile} />
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
        </>
      )}
    </div>
  );
}
