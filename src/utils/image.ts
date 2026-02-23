// Basic client-side cropping + format conversion + compositing utilities (no server required)
// NOTE: These functions are intentionally deterministic to avoid accidental subject alterations.

// Fix: Relative import
import type { ProductPlacement } from "../core/types.ts";

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });

export async function cropToDataUrl(params: {
  dataUrl: string;
  targetWidth: number;
  targetHeight: number;
  outputMime?: "image/png" | "image/webp";
  quality?: number;
}): Promise<string> {
  const {
    dataUrl,
    targetWidth,
    targetHeight,
    outputMime = "image/png",
    quality = 0.92,
  } = params;

  const img = await loadImage(dataUrl);

  const targetAspect = targetWidth / targetHeight;
  const imgAspect = img.width / img.height;

  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;

  // Center-crop to target aspect
  if (imgAspect > targetAspect) {
    // image too wide
    sh = img.height;
    sw = sh * targetAspect;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    // image too tall
    sw = img.width;
    sh = sw / targetAspect;
    sx = 0;
    sy = (img.height - sh) / 2;
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);

  // Some browsers may not support webp; fall back to png
  try {
    return canvas.toDataURL(outputMime, quality);
  } catch {
    return canvas.toDataURL("image/png");
  }
}

export async function cropAndConvertToWebP(params: {
  dataUrlPng: string;
  targetWidth: number;
  targetHeight: number;
  quality?: number;
}): Promise<string> {
  const { dataUrlPng, targetWidth, targetHeight, quality = 0.92 } = params;
  return cropToDataUrl({
    dataUrl: dataUrlPng,
    targetWidth,
    targetHeight,
    outputMime: "image/webp",
    quality,
  });
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function computeAnchoredXY(params: {
  canvasW: number;
  canvasH: number;
  drawW: number;
  drawH: number;
  anchor: ProductPlacement["anchor"];
  marginPx: number;
}): { x: number; y: number } {
  const { canvasW, canvasH, drawW, drawH, anchor, marginPx } = params;

  let x = (canvasW - drawW) / 2;
  let y = (canvasH - drawH) / 2;

  if (anchor.includes("left")) x = marginPx;
  if (anchor.includes("right")) x = canvasW - marginPx - drawW;
  if (anchor.includes("top")) y = marginPx;
  if (anchor.includes("bottom")) y = canvasH - marginPx - drawH;

  if (anchor === "center") {
    x = (canvasW - drawW) / 2;
    y = (canvasH - drawH) / 2;
  }
  if (anchor === "center_left") {
    x = marginPx;
    y = (canvasH - drawH) / 2;
  }
  if (anchor === "center_right") {
    x = canvasW - marginPx - drawW;
    y = (canvasH - drawH) / 2;
  }
  if (anchor === "top_center") {
    x = (canvasW - drawW) / 2;
    y = marginPx;
  }
  if (anchor === "bottom_center") {
    x = (canvasW - drawW) / 2;
    y = canvasH - marginPx - drawH;
  }

  return { x, y };
}

export type CompositeLayer = {
  dataUrl: string;
  placement: ProductPlacement;
  zIndex?: number;
};

export async function compositeSubjectsOnBackground(params: {
  backgroundDataUrl: string;
  layers: CompositeLayer[];
  outputMime?: "image/png" | "image/webp";
  quality?: number;
}): Promise<string> {
  const {
    backgroundDataUrl,
    layers,
    outputMime = "image/png",
    quality = 0.92,
  } = params;

  const bg = await loadImage(backgroundDataUrl);

  const canvas = document.createElement("canvas");
  canvas.width = bg.width;
  canvas.height = bg.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Background first
  ctx.drawImage(bg, 0, 0);

  const ordered = [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

  for (const layer of ordered) {
    const subject = await loadImage(layer.dataUrl);
    const placement = layer.placement;

    const marginPct = clamp(placement.marginPct ?? 0.06, 0, 0.2);
    const marginPx = marginPct * Math.min(canvas.width, canvas.height);

    const maxW = clamp(placement.maxWidthPct ?? 0.55, 0.1, 0.95) * (canvas.width - 2 * marginPx);
    const maxH = clamp(placement.maxHeightPct ?? 0.85, 0.1, 0.98) * (canvas.height - 2 * marginPx);

    const baseScale = Math.min(maxW / subject.width, maxH / subject.height);
    const userScale = clamp(placement.scale ?? 1, 0.1, 4);
    const scale = baseScale * userScale;

    const drawW = Math.round(subject.width * scale);
    const drawH = Math.round(subject.height * scale);

    const anchored = computeAnchoredXY({
      canvasW: canvas.width,
      canvasH: canvas.height,
      drawW,
      drawH,
      anchor: placement.anchor,
      marginPx,
    });

    const x = anchored.x + (placement.offsetX ?? 0);
    const y = anchored.y + (placement.offsetY ?? 0);

    const rotationDeg = placement.rotationDeg ?? 0;
    const rotationRad = (rotationDeg * Math.PI) / 180;

    // Shadow: conservative defaults, overrideable via placement.shadow
    const shadow = placement.shadow ?? {};
    const shadowOpacity = clamp(shadow.opacity ?? 0.28, 0, 1);
    const shadowBlur = Math.max(0, shadow.blur ?? 18);
    const shadowOffsetX = shadow.offsetX ?? 0;
    const shadowOffsetY = shadow.offsetY ?? 10;
    const shadowColor = shadow.color ?? "#000000";

    ctx.save();
    const cx = x + drawW / 2;
    const cy = y + drawH / 2;
    ctx.translate(cx, cy);
    ctx.rotate(rotationRad);

    ctx.shadowColor = shadowOpacity > 0 ? `rgba(0,0,0,${shadowOpacity})` : "rgba(0,0,0,0)";
    // if color is not black, approximate by using it at given opacity
    if (shadowColor !== "#000000" && shadowColor !== "#000") {
      ctx.shadowColor = shadowOpacity > 0 ? shadowColor : "rgba(0,0,0,0)";
    }
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetX = shadowOffsetX;
    ctx.shadowOffsetY = shadowOffsetY;

    ctx.drawImage(subject, -drawW / 2, -drawH / 2, drawW, drawH);

    // Reset shadow for safety
    ctx.shadowColor = "rgba(0,0,0,0)";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.restore();
  }

  try {
    return canvas.toDataURL(outputMime, quality);
  } catch {
    return canvas.toDataURL("image/png");
  }
}

// Backward-compatible single-subject helper
export async function compositeProductOnBackground(params: {
  backgroundDataUrl: string;
  productDataUrl: string;
  placement: ProductPlacement;
  outputMime?: "image/png" | "image/webp";
  quality?: number;
}): Promise<string> {
  const { backgroundDataUrl, productDataUrl, placement, outputMime, quality } = params;
  return compositeSubjectsOnBackground({
    backgroundDataUrl,
    layers: [{ dataUrl: productDataUrl, placement, zIndex: 0 }],
    outputMime,
    quality,
  });
}