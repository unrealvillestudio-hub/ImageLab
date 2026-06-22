import React, { useMemo, useRef, useState } from "react";
import { removeBg } from "../../services/removebg.ts";
import {
  makeCatalogBackground,
  aspectToDimensions,
  type CatalogVariant,
} from "../../utils/catalogBackground.ts";
import {
  composeProductShot,
  type ProductShotLayout,
} from "../../utils/compositeDeterministic.ts";
import { downloadDataUrl, readFileAsDataUrl, safeId } from "../../utils/imageUtils.ts";

/**
 * ProductShots — autonomous catalog packshot submodule.
 * 4 linear steps: Upload → Remove background → Compose → Download.
 * Local state only — NO global library store, NO presets, NO AI model.
 * Composition is 100% deterministic (canvas).
 */

type ProductStatus = "original" | "preview" | "final";

interface ProductImage {
  id: string;
  fileName: string;
  originalDataUrl: string;
  cutoutDataUrl?: string;
  status: ProductStatus;
  busy: boolean;
  error?: string;
}

type OutputFormat = "image/png" | "image/webp";

const MAX_PRODUCTS = 7;
const ASPECT_OPTIONS = ["1:1", "4:5", "4:3", "16:9", "9:16"] as const;
const LAYOUT_OPTIONS: { id: ProductShotLayout; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "row", label: "Fila" },
  { id: "group", label: "Grupo" },
];

export function ProductShotsModule() {
  const [products, setProducts] = useState<ProductImage[]>([]);
  const [creditsSpent, setCreditsSpent] = useState(0);

  const [variant, setVariant] = useState<CatalogVariant>("light");
  const [aspect, setAspect] = useState<string>("1:1");
  const [layout, setLayout] = useState<ProductShotLayout>("auto");

  const [composing, setComposing] = useState(false);
  const [composed, setComposed] = useState<string | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);

  const [outputFormat, setOutputFormat] = useState<OutputFormat>("image/png");
  const [webpQuality, setWebpQuality] = useState(0.9);

  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const hasCutouts = useMemo(() => products.some((p) => p.cutoutDataUrl), [products]);

  // --- Step 1: upload ------------------------------------------------------

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    const room = MAX_PRODUCTS - products.length;
    if (room <= 0) return;
    const accepted = files.slice(0, room);
    const next: ProductImage[] = [];
    for (const f of accepted) {
      try {
        const dataUrl = await readFileAsDataUrl(f);
        next.push({
          id: safeId("ps"),
          fileName: f.name,
          originalDataUrl: dataUrl,
          status: "original",
          busy: false,
        });
      } catch {
        /* skip unreadable file */
      }
    }
    if (next.length) setProducts((prev) => [...prev, ...next]);
  };

  const removeProduct = (id: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
  };

  const patch = (id: string, p: Partial<ProductImage>) =>
    setProducts((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));

  // --- Step 2: remove background ------------------------------------------

  const runRemoveBg = async (id: string, preview: boolean) => {
    const target = products.find((p) => p.id === id);
    if (!target || target.busy) return;
    patch(id, { busy: true, error: undefined });
    try {
      const { imageDataUrl, creditsCharged } = await removeBg({
        imageDataUrl: target.originalDataUrl,
        preview,
      });
      patch(id, {
        cutoutDataUrl: imageDataUrl,
        status: preview ? "preview" : "final",
        busy: false,
      });
      if (creditsCharged > 0) setCreditsSpent((c) => c + creditsCharged);
    } catch (err) {
      patch(id, { busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const removeBgAll = async (preview: boolean) => {
    for (const p of products) {
      // Skip already-final cutouts when confirming hi-res in bulk.
      if (!preview && p.status === "final") continue;
      // eslint-disable-next-line no-await-in-loop
      await runRemoveBg(p.id, preview);
    }
  };

  // --- Step 3: compose -----------------------------------------------------

  const compose = async () => {
    if (products.length === 0) return;
    setComposing(true);
    setComposeError(null);
    try {
      const { w, h } = aspectToDimensions(aspect);
      const background = makeCatalogBackground({ variant, width: w, height: h });
      const productSrcs = products.map((p) => p.cutoutDataUrl ?? p.originalDataUrl);
      const { dataUrl } = await composeProductShot({
        backgroundSrc: background,
        productSrcs,
        opts: {
          variant,
          layout,
          colorMatch: { enabled: true, strength: 0.3 },
          lightWrap: { enabled: true, strength: 0.16 },
          contactShadow: { enabled: true },
          output: { type: "image/png" },
        },
      });
      setComposed(dataUrl);
    } catch (err) {
      setComposeError(err instanceof Error ? err.message : String(err));
    } finally {
      setComposing(false);
    }
  };

  // --- Step 4: download ----------------------------------------------------

  const download = async () => {
    if (!composed) return;
    if (outputFormat === "image/png") {
      downloadDataUrl(`productshot_${Date.now()}.png`, composed);
      return;
    }
    // Re-encode the composed PNG to WEBP at the chosen quality.
    const img = await loadImageEl(composed);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const webp = canvas.toDataURL("image/webp", webpQuality);
    downloadDataUrl(`productshot_${Date.now()}.webp`, webp);
  };

  // --- Render --------------------------------------------------------------

  return (
    <div className="max-w-[1100px] mx-auto pb-16 space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="uv-h1">Product<span> Shots</span></h1>
          <p className="uv-muted text-[11px] mt-1">
            Sube · quita fondo · compón sobre catálogo · descarga. Sin IA, 100% determinístico.
          </p>
        </div>
        <div className="uv-pill px-4 py-2 text-right">
          <div className="uv-label">Créditos esta sesión</div>
          <div className="text-[#FFAB00] font-black text-lg leading-none">{creditsSpent}</div>
        </div>
      </header>

      {/* STEP 1 — UPLOAD */}
      <Section step={1} title="Subir productos" hint={`${products.length}/${MAX_PRODUCTS} imágenes`}>
        <div
          className={`relative group transition-all ${isDragOver ? "scale-[1.01]" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragOver(false); addFiles(e.dataTransfer.files); }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            disabled={products.length >= MAX_PRODUCTS}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
            onChange={(e) => { addFiles(e.target.files); if (inputRef.current) inputRef.current.value = ""; }}
          />
          <div
            className={`border border-dashed rounded-xl p-6 text-center transition-all flex flex-col items-center justify-center min-h-[110px] space-y-1
              ${isDragOver ? "border-[#FFAB00] bg-[#FFAB00]/5" : "border-white/10 bg-[#121212] group-hover:border-[#FFAB00]/40"}`}
          >
            <div className="text-3xl text-[#FFAB00] group-hover:scale-110 transition-transform">+</div>
            <p className="text-[11px] font-black uppercase tracking-widest text-[#EBEBEB]">
              Arrastra o haz click para subir
            </p>
            <p className="text-[9px] text-white/40 font-medium">1 a {MAX_PRODUCTS} imágenes de producto</p>
          </div>
        </div>

        {products.length > 0 && (
          <div className="grid grid-cols-4 md:grid-cols-7 gap-3 mt-4">
            {products.map((p) => (
              <div key={p.id} className="relative group uv-panel p-2">
                <div className="aspect-square rounded-md overflow-hidden bg-checkered flex items-center justify-center">
                  <img
                    src={p.cutoutDataUrl ?? p.originalDataUrl}
                    className="max-h-full max-w-full object-contain"
                    alt={p.fileName}
                  />
                </div>
                <button
                  onClick={() => removeProduct(p.id)}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 hover:bg-red-500 text-white text-sm flex items-center justify-center transition-colors"
                  title="Quitar"
                >
                  ×
                </button>
                <div className="mt-1 text-center">
                  <StatusBadge status={p.status} hasCutout={!!p.cutoutDataUrl} busy={p.busy} />
                </div>
                {p.error && <p className="text-[8px] text-red-400 mt-1 leading-tight">{p.error}</p>}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* STEP 2 — REMOVE BACKGROUND */}
      <Section step={2} title="Quitar fondo" hint="Vista previa gratis · alta resolución = 1 crédito">
        {products.length === 0 ? (
          <EmptyHint>Sube imágenes para habilitar este paso.</EmptyHint>
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <button className="uv-btn uv-btn-ghost px-5 py-2.5 text-[11px]" onClick={() => removeBgAll(true)}>
                Vista previa a todas (gratis)
              </button>
              <button className="uv-btn uv-btn-primary px-5 py-2.5 text-[11px]" onClick={() => removeBgAll(false)}>
                Confirmar alta resolución (todas)
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {products.map((p) => (
                <div key={p.id} className="uv-panel p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <BeforeAfter label="Original" src={p.originalDataUrl} />
                    <BeforeAfter
                      label={p.status === "final" ? "Alta res" : p.status === "preview" ? "Preview" : "—"}
                      src={p.cutoutDataUrl}
                      checkered
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="uv-label truncate max-w-[40%]">{p.fileName}</span>
                    <div className="flex gap-2">
                      <button
                        className="uv-btn uv-btn-ghost px-3 py-1.5 text-[10px] disabled:opacity-40"
                        disabled={p.busy}
                        onClick={() => runRemoveBg(p.id, true)}
                      >
                        {p.busy ? "..." : "Preview"}
                      </button>
                      <button
                        className="uv-btn uv-btn-primary px-3 py-1.5 text-[10px] disabled:opacity-40"
                        disabled={p.busy}
                        onClick={() => runRemoveBg(p.id, false)}
                      >
                        {p.busy ? "..." : "Alta res (1)"}
                      </button>
                    </div>
                  </div>
                  {p.error && <p className="uv-warning text-[10px]">{p.error}</p>}
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      {/* STEP 3 — COMPOSE */}
      <Section step={3} title="Componer" hint={hasCutouts ? "" : "Sugerencia: quita el fondo primero para mejor resultado"}>
        {products.length === 0 ? (
          <EmptyHint>Sube imágenes para habilitar este paso.</EmptyHint>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
            <div className="space-y-4">
              <ControlRow label="Fondo">
                <div className="flex gap-2">
                  <Chip active={variant === "light"} onClick={() => setVariant("light")}>Claro</Chip>
                  <Chip active={variant === "dark"} onClick={() => setVariant("dark")}>Oscuro</Chip>
                </div>
              </ControlRow>

              <ControlRow label="Aspect ratio">
                <select className="uv-select" value={aspect} onChange={(e) => setAspect(e.target.value)}>
                  {ASPECT_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </ControlRow>

              <ControlRow label="Layout">
                <div className="flex gap-2">
                  {LAYOUT_OPTIONS.map((l) => (
                    <Chip key={l.id} active={layout === l.id} onClick={() => setLayout(l.id)}>{l.label}</Chip>
                  ))}
                </div>
              </ControlRow>

              <button
                className="uv-btn uv-btn-primary w-full py-3 text-[12px] disabled:opacity-40"
                disabled={composing}
                onClick={compose}
              >
                {composing ? "Componiendo..." : "Componer"}
              </button>
              {composeError && <p className="uv-warning text-[10px]">{composeError}</p>}
            </div>

            <div className="uv-panel p-3 min-h-[320px] flex items-center justify-center bg-checkered rounded-xl">
              {composed ? (
                <img src={composed} className="max-h-[60vh] max-w-full object-contain rounded-md shadow-2xl" alt="composed" />
              ) : (
                <p className="uv-muted text-[11px]">El resultado aparecerá aquí.</p>
              )}
            </div>
          </div>
        )}
      </Section>

      {/* STEP 4 — DOWNLOAD */}
      <Section step={4} title="Descargar" hint="PNG conserva alpha · WEBP pesa menos">
        {!composed ? (
          <EmptyHint>Compón una imagen para habilitar la descarga.</EmptyHint>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex gap-2">
              <Chip active={outputFormat === "image/png"} onClick={() => setOutputFormat("image/png")}>PNG</Chip>
              <Chip active={outputFormat === "image/webp"} onClick={() => setOutputFormat("image/webp")}>WEBP</Chip>
            </div>
            {outputFormat === "image/webp" && (
              <label className="flex items-center gap-3">
                <span className="uv-label">Calidad {Math.round(webpQuality * 100)}%</span>
                <input
                  type="range"
                  min={0.5}
                  max={1}
                  step={0.05}
                  value={webpQuality}
                  onChange={(e) => setWebpQuality(Number(e.target.value))}
                  className="accent-[#FFAB00]"
                />
              </label>
            )}
            <button className="uv-btn uv-btn-primary px-6 py-3 text-[12px]" onClick={download}>
              Descargar {outputFormat === "image/png" ? "PNG" : "WEBP"}
            </button>
          </div>
        )}
      </Section>
    </div>
  );
}

// --- Local presentational helpers -----------------------------------------

function Section(props: React.PropsWithChildren<{ step: number; title: string; hint?: string }>) {
  return (
    <section className="uv-panel uv-panel-strong p-5">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-7 h-7 rounded-full bg-[#FFAB00] text-black font-black text-sm flex items-center justify-center">
          {props.step}
        </span>
        <h2 className="uv-h2 text-[#EBEBEB]">{props.title}</h2>
        {props.hint && <span className="uv-muted text-[10px] ml-auto">{props.hint}</span>}
      </div>
      {props.children}
    </section>
  );
}

function ControlRow(props: React.PropsWithChildren<{ label: string }>) {
  return (
    <div className="space-y-2">
      <div className="uv-label">{props.label}</div>
      {props.children}
    </div>
  );
}

function Chip(props: React.PropsWithChildren<{ active: boolean; onClick: () => void }>) {
  return (
    <button className={`uv-chip ${props.active ? "uv-chip--active" : ""}`} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

function EmptyHint(props: React.PropsWithChildren<{}>) {
  return <p className="uv-muted text-[11px] italic">{props.children}</p>;
}

function StatusBadge({ status, hasCutout, busy }: { status: ProductStatus; hasCutout: boolean; busy: boolean }) {
  if (busy) return <span className="uv-label text-[#FFAB00]">Procesando…</span>;
  if (status === "final") return <span className="uv-label text-emerald-400">Alta res</span>;
  if (status === "preview" && hasCutout) return <span className="uv-label text-[#FFAB00]">Preview</span>;
  return <span className="uv-label">Original</span>;
}

function BeforeAfter({ label, src, checkered }: { label: string; src?: string; checkered?: boolean }) {
  return (
    <div>
      <div className="uv-label mb-1">{label}</div>
      <div className={`aspect-square rounded-md overflow-hidden flex items-center justify-center ${checkered ? "bg-checkered" : "bg-black/40"}`}>
        {src ? (
          <img src={src} className="max-h-full max-w-full object-contain" alt={label} />
        ) : (
          <span className="text-white/20 text-xs">—</span>
        )}
      </div>
    </div>
  );
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load composed image"));
    img.src = src;
  });
}
