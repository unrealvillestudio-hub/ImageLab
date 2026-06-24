// Fix: Relative import
import type { ProductPlacement, SceneNegativeSpace } from "../core/types.ts";

export function safeId(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`;
}

export function downloadDataUrl(filename: string, dataUrl: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image for upload normalization"));
    img.src = src;
  });
}

/**
 * Normalize an image before uploading it to the remove.bg proxy.
 *
 * Re-encodes through a canvas to a clean baseline JPEG (white matte) and caps the
 * longest side. This solves two confirmed failure modes (reproduced against the
 * live endpoint):
 *   1. remove.bg returns 400 "There was an error reading the image" when it can
 *      start but not finish decoding the input (unusual/partial PNG encodings).
 *      A canvas re-encode always yields a decodable baseline image.
 *   2. Vercel serverless functions hard-reject request bodies > ~4.5 MB with a
 *      413 (FUNCTION_PAYLOAD_TOO_LARGE) before our proxy runs. Capping the
 *      dimension + JPEG re-encode keeps the base64 payload well under that.
 *
 * remove.bg still returns a full-alpha PNG cutout regardless of the input format,
 * so flattening transparency here does not affect the cutout's alpha.
 */
export async function prepareImageForUpload(
  dataUrl: string,
  opts: { maxDim?: number; quality?: number; maxBase64Bytes?: number } = {},
): Promise<string> {
  let maxDim = opts.maxDim ?? 2400;
  const quality = opts.quality ?? 0.9;
  // Keep the base64 comfortably under Vercel's 4.5 MB body limit (with JSON
  // wrapper headroom). ~3.4 MB base64 ≈ ~2.5 MB binary.
  const maxBase64 = opts.maxBase64Bytes ?? 3_400_000;

  let img: HTMLImageElement;
  try {
    img = await loadImageElement(dataUrl);
  } catch {
    return dataUrl; // unreadable here → let the server/remove.bg surface the error
  }
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  if (!w0 || !h0) return dataUrl;

  const encodeAt = (dim: number): string => {
    const scale = Math.min(1, dim / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.fillStyle = "#FFFFFF"; // flatten any alpha onto white (JPEG has no alpha)
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  };

  let out = encodeAt(maxDim);
  // Shrink further if still too large for the body limit.
  let guard = 0;
  while (out.length > maxBase64 && guard < 5 && maxDim > 800) {
    maxDim = Math.round(maxDim * 0.8);
    out = encodeAt(maxDim);
    guard++;
  }
  return out;
}

export function defaultPlacementForNegativeSpace(ns: SceneNegativeSpace): ProductPlacement {
  if (ns === "left_third") {
    return { anchor: "center_left", marginPct: 0.06, maxHeightPct: 0.78, maxWidthPct: 0.42, scale: 1, rotationDeg: 0 };
  }
  if (ns === "center") {
    return { anchor: "center", marginPct: 0.06, maxHeightPct: 0.72, maxWidthPct: 0.4, scale: 1, rotationDeg: 0 };
  }
  // right_third / others
  return { anchor: "center_right", marginPct: 0.06, maxHeightPct: 0.78, maxWidthPct: 0.42, scale: 1, rotationDeg: 0 };
}

export async function compositeImageDataUrl(options: {
  backgroundDataUrl: string;
  overlayDataUrl: string;
  placement: ProductPlacement;
  outputFormat?: "png" | "jpg" | "webp";
  outputQuality?: number;
}): Promise<string> {
  // This is a placeholder for actual image composition logic
  // In a real implementation, this would use Canvas API to composite images
  console.log("Compositing images with placement:", options.placement);
  return options.backgroundDataUrl; // Returning background as placeholder
}