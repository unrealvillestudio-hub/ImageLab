import React, { useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { removeBg } from "../../services/removebg.ts";
import { downloadDataUrl, readFileAsDataUrl, safeId } from "../../utils/imageUtils.ts";

/**
 * BGRemover — autonomous background-removal submodule.
 * 3 linear steps: Upload (1–7) → Remove background → Download.
 * Local state only — NO global library store, NO presets, NO AI model.
 * Background removal is proxied server-side to remove.bg (api/removebg.ts);
 * download operates on the individual cutouts (no composition).
 */

type ProductStatus = "original" | "preview" | "final";

interface ProductImage {
  id: string;
  fileName: string;
  originalDataUrl: string;
  // Preview (free, low-res) and final (1 credit, full-res) cutouts are stored in
  // SEPARATE fields so a late-resolving preview can never clobber a confirmed
  // hi-res cutout. Download always picks the highest resolution available.
  previewCutoutDataUrl?: string;
  finalCutoutDataUrl?: string;
  busy: boolean;
  error?: string;
}

// Highest-resolution cutout available for a product (final > preview), or the
// original if no background removal has run yet.
function bestSource(p: ProductImage): string {
  return p.finalCutoutDataUrl ?? p.previewCutoutDataUrl ?? p.originalDataUrl;
}

function bestCutout(p: ProductImage): string | undefined {
  return p.finalCutoutDataUrl ?? p.previewCutoutDataUrl;
}

function productStatus(p: ProductImage): ProductStatus {
  if (p.finalCutoutDataUrl) return "final";
  if (p.previewCutoutDataUrl) return "preview";
  return "original";
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "") || "cutout";
}

type OutputFormat = "image/png" | "image/webp";

const MAX_PRODUCTS = 7;

export function BGRemoverModule() {
  const [products, setProducts] = useState<ProductImage[]>([]);
  const [creditsSpent, setCreditsSpent] = useState(0);

  const [outputFormat, setOutputFormat] = useState<OutputFormat>("image/png");
  const [webpQuality, setWebpQuality] = useState(0.9);
  const [zipping, setZipping] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const cutouts = useMemo(() => products.filter((p) => bestCutout(p)), [products]);

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
      // Write ONLY the field for this resolution. A late preview never overwrites
      // a confirmed final, and confirming final never wipes the preview.
      patch(id, preview
        ? { previewCutoutDataUrl: imageDataUrl, busy: false }
        : { finalCutoutDataUrl: imageDataUrl, busy: false });
      if (creditsCharged > 0) setCreditsSpent((c) => c + creditsCharged);
    } catch (err) {
      patch(id, { busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const removeBgAll = async (preview: boolean) => {
    for (const p of products) {
      // Skip already-final cutouts when confirming hi-res in bulk.
      if (!preview && p.finalCutoutDataUrl) continue;
      // eslint-disable-next-line no-await-in-loop
      await runRemoveBg(p.id, preview);
    }
  };

  // --- Step 3: download (per cutout) --------------------------------------

  // PNG keeps the original alpha cutout untouched; WEBP re-encodes via canvas
  // (WEBP also supports alpha) at the chosen quality for a smaller file.
  const encodeCutout = async (cutoutDataUrl: string): Promise<string> => {
    if (outputFormat === "image/png") return cutoutDataUrl;
    const img = await loadImageEl(cutoutDataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return cutoutDataUrl;
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/webp", webpQuality);
  };

  const ext = () => (outputFormat === "image/png" ? "png" : "webp");

  const downloadOne = async (p: ProductImage) => {
    const cut = bestCutout(p);
    if (!cut) return;
    const data = await encodeCutout(cut);
    downloadDataUrl(`${baseName(p.fileName)}_cutout.${ext()}`, data);
  };

  const downloadAll = async () => {
    if (cutouts.length === 0 || zipping) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      const used: Record<string, number> = {};
      for (const p of cutouts) {
        const cut = bestCutout(p);
        if (!cut) continue;
        const data = await encodeCutout(cut);
        const b64 = data.split(",")[1] ?? "";
        // Disambiguate duplicate base names within the zip.
        let name = `${baseName(p.fileName)}_cutout.${ext()}`;
        if (used[name] != null) {
          used[name] += 1;
          name = `${baseName(p.fileName)}_cutout_${used[name]}.${ext()}`;
        } else {
          used[name] = 0;
        }
        zip.file(name, b64, { base64: true });
      }
      const zipB64 = await zip.generateAsync({ type: "base64" });
      downloadDataUrl(`cutouts_${Date.now()}.zip`, `data:application/zip;base64,${zipB64}`);
    } finally {
      setZipping(false);
    }
  };

  // --- Render --------------------------------------------------------------

  return (
    <div className="max-w-[1100px] mx-auto pb-16 space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="uv-h1">BG<span> Remover</span></h1>
          <p className="uv-muted text-[11px] mt-1">
            Sube · quita el fondo · descarga el recorte. Sin IA, proxy a remove.bg.
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
                    src={bestSource(p)}
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
                  <StatusBadge status={productStatus(p)} busy={p.busy} />
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
                      label={productStatus(p) === "final" ? "Alta res" : productStatus(p) === "preview" ? "Preview" : "—"}
                      src={bestCutout(p)}
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

      {/* STEP 3 — DOWNLOAD (per cutout) */}
      <Section step={3} title="Descargar" hint="PNG conserva alpha · WEBP pesa menos">
        {cutouts.length === 0 ? (
          <EmptyHint>Quita el fondo de al menos una imagen para descargar.</EmptyHint>
        ) : (
          <>
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
              <button
                className="uv-btn uv-btn-primary px-6 py-3 text-[12px] disabled:opacity-40 ml-auto"
                disabled={zipping}
                onClick={downloadAll}
              >
                {zipping ? "Comprimiendo..." : `Descargar todas (.zip · ${cutouts.length})`}
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              {cutouts.map((p) => (
                <div key={p.id} className="uv-panel p-2 space-y-2">
                  <div className="aspect-square rounded-md overflow-hidden bg-checkered flex items-center justify-center">
                    <img src={bestCutout(p)} className="max-h-full max-w-full object-contain" alt={p.fileName} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge status={productStatus(p)} busy={p.busy} />
                    <button
                      className="uv-btn uv-btn-ghost px-3 py-1.5 text-[10px]"
                      onClick={() => downloadOne(p)}
                    >
                      {ext().toUpperCase()}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
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

function StatusBadge({ status, busy }: { status: ProductStatus; busy: boolean }) {
  if (busy) return <span className="uv-label text-[#FFAB00]">Procesando…</span>;
  if (status === "final") return <span className="uv-label text-emerald-400">Alta res</span>;
  if (status === "preview") return <span className="uv-label text-[#FFAB00]">Preview</span>;
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
    img.onerror = () => reject(new Error("Failed to load cutout image"));
    img.src = src;
  });
}
