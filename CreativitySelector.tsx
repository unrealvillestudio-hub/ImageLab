// src/components/CreativitySelector.tsx
import React from "react";

type CreativityLevel = 1 | 2 | 3;

// Selector opcional (solo aparece si el parent lo usa)
export type ComposeMode = "ecom" | "ugc";

export function CreativitySelector({
  value,
  onChange,

  // OPTIONAL (no rompe nada si no se pasa)
  composeMode,
  onComposeModeChange,
  showHelp = true,
}: {
  value: CreativityLevel;
  onChange: (v: CreativityLevel) => void;

  composeMode?: ComposeMode;
  onComposeModeChange?: (m: ComposeMode) => void;
  showHelp?: boolean;
}) {
  const helpTitle =
    composeMode === "ugc"
      ? "Modo UGC (Gemini) — para manos/interacción"
      : composeMode === "ecom"
      ? "Modo ECOM (overlay) — para producto intacto"
      : "Cómo usar Tools (elige objetivo)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Help visible */}
      {showHelp && (
        <div
          style={{
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 10,
            padding: 12,
            background: "rgba(0,0,0,0.03)",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>{helpTitle}</div>

          <div style={{ fontSize: 13, lineHeight: 1.35 }}>
            <div style={{ marginBottom: 8 }}>
              <b>“Determinista”</b> = <b>tu producto se pega EXACTO</b> como lo
              subes (PNG/WebP). <b>No</b> lo re-dibuja la IA.
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div>
                <b>A) Quiero poner MI producto sin deformarlo</b> (landing, web,
                catálogo, ads “limpios”) →
                <b> usa ECOM</b>.
              </div>
              <div>
                <b>B) Quiero mano/persona sosteniendo o usando el producto</b>{" "}
                (UGC realista) →
                <b> usa UGC</b>.
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <b>Workflow ECOM (recomendado para tu caso “collage raro”):</b>
              <ol style={{ margin: "6px 0 0 18px", padding: 0 }}>
                <li>
                  Prompt de escena = <b>solo fondo</b> (NO manos, NO producto, NO
                  texto).
                </li>
                <li>
                  Source = <b>PNG/WebP con fondo transparente</b>.
                </li>
                <li>
                  Genera escena → <b>Compose/Overlay</b>.
                </li>
              </ol>
            </div>

            <div style={{ marginTop: 10 }}>
              <b>Workflow UGC:</b>
              <ol style={{ margin: "6px 0 0 18px", padding: 0 }}>
                <li>
                  Prompt incluye acción: <b>“hand holding / applying”</b>.
                </li>
                <li>
                  Acepta que la IA puede <b>cambiar</b> etiqueta/forma.
                </li>
              </ol>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
              <b>Tip:</b> Si ves una mano “sosteniendo algo” cuando solo querías
              overlay, estás usando prompt de UGC en un caso ECOM.
            </div>
          </div>
        </div>
      )}

      {/* Mode selector (optional, only if wired from parent) */}
      {composeMode && onComposeModeChange && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontWeight: 700 }}>Modo</label>
          <select
            value={composeMode}
            onChange={(e) => onComposeModeChange(e.target.value as ComposeMode)}
          >
            <option value="ecom">ECOM (overlay, producto intacto)</option>
            <option value="ugc">UGC (Gemini, mano/interacción)</option>
          </select>
        </div>
      )}

      {/* Existing Creativity selector (unchanged behavior) */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label style={{ fontWeight: 700 }}>Creatividad</label>
        <select
          value={value}
          onChange={(e) => onChange(Number(e.target.value) as CreativityLevel)}
        >
          <option value={1}>1 — Strict (Brand-safe)</option>
          <option value={2}>2 — Balanced (3 bloques)</option>
          <option value={3}>3 — Wild (Auto-Random 7 bloques)</option>
        </select>
      </div>
    </div>
  );
}