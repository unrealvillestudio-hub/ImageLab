// utils/compositeDeterministic.ts
export type Anchor =
  | "center"
  | "top_left"
  | "top_right"
  | "bottom_left"
  | "bottom_right"
  | "center_right"
  | "center_left"
  | "right_third"
  | "left_third";

export type CompositeDeterministicOptions = {
  anchor?: Anchor;
  offsetX?: number;
  offsetY?: number;

  // Tamaño del producto relativo al fondo
  // targetHeightPct=0.55 => producto ocupa ~55% de alto del canvas
  targetHeightPct?: number;
  scale?: number; // multiplica targetHeightPct (1.0 default)

  // Shadow (tu UI: 55% => 0.55)
  shadowOpacity?: number; // 0..1
  shadowBlurPx?: number;
  shadowDxPx?: number;
  shadowDyPx?: number;

  // Color match simple (corrige “sticker look”)
  colorMatch?: {
    enabled: boolean;
    strength?: number; // 0..1 (0.35 default)
    samplePadPx?: number; // 40 default
  };

  // Light wrap suave (opcional)
  lightWrap?: {
    enabled: boolean;
    strength?: number; // 0..1 (0.18 default)
    blurPx?: number; // 10 default
  };

  output?: {
    type?: "image/png" | "image/webp";
    quality?: number; // webp/jpeg only; 0..1
  };
};

export async function compositeDeterministicCanvas(params: {
  backgroundSrc: string; // dataURL / blobURL / url
  productSrc: string; // PNG/WebP con alpha idealmente
  opts?: CompositeDeterministicOptions;
}): Promise<{ dataUrl: string; width: number; height: number }> {
  const opts = params.opts ?? {};

  const bgImg = await loadImage(params.backgroundSrc);
  const prImg = await loadImage(params.productSrc);

  const W = bgImg.naturalWidth || bgImg.width;
  const H = bgImg.naturalHeight || bgImg.height;
  if (!W || !H) throw new Error("Background image has invalid dimensions.");

  // Canvas final
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D context not available.");

  // Draw background
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(bgImg, 0, 0, W, H);

  // Compute product target size
  const pW0 = prImg.naturalWidth || prImg.width;
  const pH0 = prImg.naturalHeight || prImg.height;
  if (!pW0 || !pH0) throw new Error("Product image has invalid dimensions.");

  const targetHeightPct = clamp(opts.targetHeightPct ?? 0.55, 0.05, 0.95);
  const scale = clamp(opts.scale ?? 1.0, 0.1, 3.0);

  const targetH = Math.round(H * targetHeightPct * scale);
  const ratio = pW0 / pH0;
  const drawH = Math.max(1, targetH);
  const drawW = Math.max(1, Math.round(drawH * ratio));

  const anchor = opts.anchor ?? "right_third";
  const offsetX = Math.round(opts.offsetX ?? 0);
  const offsetY = Math.round(opts.offsetY ?? 0);
  const { x, y } = anchorToXY(anchor, W, H, drawW, drawH, offsetX, offsetY);

  // Prepare product bitmap in offscreen (so we can brightness-match)
  const prodCanvas = document.createElement("canvas");
  prodCanvas.width = drawW;
  prodCanvas.height = drawH;
  const pctx = prodCanvas.getContext("2d", { willReadFrequently: true });
  if (!pctx) throw new Error("Product 2D context not available.");

  pctx.clearRect(0, 0, drawW, drawH);
  pctx.drawImage(prImg, 0, 0, drawW, drawH);

  // Color match (simple luminance shift)
  if (opts.colorMatch?.enabled) {
    const strength = clamp(opts.colorMatch.strength ?? 0.35, 0, 1);
    const pad = Math.max(0, Math.round(opts.colorMatch.samplePadPx ?? 40));
    applySimpleLumaMatch({
      bgCtx: ctx,
      prodCtx: pctx,
      box: { x, y, w: drawW, h: drawH },
      pad,
      strength,
      canvasW: W,
      canvasH: H,
    });
  }

  // Shadow settings
  const shadowOpacity = clamp(opts.shadowOpacity ?? 0.55, 0, 1);
  const shadowBlurPx = Math.max(0, Math.round(opts.shadowBlurPx ?? 18));
  const shadowDxPx = Math.round(opts.shadowDxPx ?? 0);
  const shadowDyPx = Math.round(opts.shadowDyPx ?? 10);

  // Draw shadow by using canvas shadow on the product draw
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${shadowOpacity})`;
  ctx.shadowBlur = shadowBlurPx;
  ctx.shadowOffsetX = shadowDxPx;
  ctx.shadowOffsetY = shadowDyPx;
  ctx.drawImage(prodCanvas, x, y);
  ctx.restore();

  // Draw product clean on top (no shadow)
  ctx.drawImage(prodCanvas, x, y);

  // Light wrap (background bleeding into edges)
  if (opts.lightWrap?.enabled) {
    const strength = clamp(opts.lightWrap.strength ?? 0.18, 0, 1);
    const blurPx = Math.max(0, Math.round(opts.lightWrap.blurPx ?? 10));
    drawLightWrap({
      ctx,
      bgImg,
      prodCanvas,
      x,
      y,
      blurPx,
      strength,
    });
  }

  const outType = opts.output?.type ?? "image/png";
  const q = clamp(opts.output?.quality ?? 0.92, 0.1, 1);

  const dataUrl = canvas.toDataURL(outType, q);
  return { dataUrl, width: W, height: H };
}

function anchorToXY(anchor: Anchor, W: number, H: number, pW: number, pH: number, ox: number, oy: number) {
  let x = 0,
    y = 0;

  switch (anchor) {
    case "center":
      x = Math.round((W - pW) / 2);
      y = Math.round((H - pH) / 2);
      break;
    case "top_left":
      x = 0;
      y = 0;
      break;
    case "top_right":
      x = W - pW;
      y = 0;
      break;
    case "bottom_left":
      x = 0;
      y = H - pH;
      break;
    case "bottom_right":
      x = W - pW;
      y = H - pH;
      break;
    case "center_left":
      x = 0;
      y = Math.round((H - pH) / 2);
      break;
    case "center_right":
      x = W - pW;
      y = Math.round((H - pH) / 2);
      break;
    case "right_third":
      x = Math.round(W * (2 / 3) - pW / 2);
      y = Math.round((H - pH) / 2);
      break;
    case "left_third":
      x = Math.round(W * (1 / 3) - pW / 2);
      y = Math.round((H - pH) / 2);
      break;
  }

  x += ox;
  y += oy;

  x = Math.max(0, Math.min(W - pW, x));
  y = Math.max(0, Math.min(H - pH, y));
  return { x, y };
}

function applySimpleLumaMatch(args: {
  bgCtx: CanvasRenderingContext2D;
  prodCtx: CanvasRenderingContext2D;
  box: { x: number; y: number; w: number; h: number };
  pad: number;
  strength: number;
  canvasW: number;
  canvasH: number;
}) {
  const { bgCtx, prodCtx, box, pad, strength, canvasW, canvasH } = args;

  // Sample bg around placement area
  const sx = Math.max(0, box.x - pad);
  const sy = Math.max(0, box.y - pad);
  const sw = Math.min(canvasW - sx, box.w + pad * 2);
  const sh = Math.min(canvasH - sy, box.h + pad * 2);

  let bgData: ImageData;
  let prData: ImageData;
  try {
    bgData = bgCtx.getImageData(sx, sy, sw, sh);
    prData = prodCtx.getImageData(0, 0, box.w, box.h);
  } catch {
    // Si hay CORS por URLs externas, no podemos leer pixels.
    // En ese caso simplemente no hacemos colorMatch.
    return;
  }

  const bgL = meanLuma(bgData.data, false);
  const prL = meanLuma(prData.data, true); // only alpha pixels

  if (!isFinite(bgL) || !isFinite(prL)) return;

  const delta = (bgL - prL) * 1.15 * strength; // factor para que se note sin pasarse

  const d = prData.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 8) continue;
    d[i] = clampByte(d[i] + delta);
    d[i + 1] = clampByte(d[i + 1] + delta);
    d[i + 2] = clampByte(d[i + 2] + delta);
  }
  prodCtx.putImageData(prData, 0, 0);
}

function drawLightWrap(args: {
  ctx: CanvasRenderingContext2D;
  bgImg: HTMLImageElement;
  prodCanvas: HTMLCanvasElement;
  x: number;
  y: number;
  blurPx: number;
  strength: number;
}) {
  const { ctx, bgImg, prodCanvas, x, y, blurPx, strength } = args;

  const w = prodCanvas.width;
  const h = prodCanvas.height;

  // Create wrap canvas
  const wrap = document.createElement("canvas");
  wrap.width = w;
  wrap.height = h;
  const wctx = wrap.getContext("2d");
  if (!wctx) return;

  // 1) draw product as alpha mask
  wctx.clearRect(0, 0, w, h);
  wctx.drawImage(prodCanvas, 0, 0);

  // 2) Keep only alpha (source-in) and fill with background crop (same region)
  wctx.globalCompositeOperation = "source-in";
  wctx.drawImage(bgImg, -x, -y); // align crop

  // 3) blur wrap
  wctx.globalCompositeOperation = "source-over";
  wctx.filter = `blur(${blurPx}px)`;

  const blurred = document.createElement("canvas");
  blurred.width = w;
  blurred.height = h;
  const bctx = blurred.getContext("2d");
  if (!bctx) return;
  bctx.filter = `blur(${blurPx}px)`;
  bctx.drawImage(wrap, 0, 0);

  // 4) draw over product with screen
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.globalCompositeOperation = "screen";
  ctx.drawImage(blurred, x, y);
  ctx.restore();
}

function meanLuma(data: Uint8ClampedArray, onlyAlpha: boolean) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (onlyAlpha && a < 8) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Rec. 709 luma
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += l;
    n++;
  }
  return n ? sum / n : NaN;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
function clampByte(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 60)}...`));
    img.src = src;
  });
}