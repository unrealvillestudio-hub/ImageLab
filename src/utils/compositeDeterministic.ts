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
  targetHeightPct?: number;
  scale?: number; 
  shadowOpacity?: number; 
  shadowBlurPx?: number;
  shadowDxPx?: number;
  shadowDyPx?: number;
  colorMatch?: {
    enabled: boolean;
    strength?: number; 
    samplePadPx?: number; 
  };
  lightWrap?: {
    enabled: boolean;
    strength?: number;
    blurPx?: number;
  };
  // Diffuse dark ellipse at the base of the product — what makes a packshot
  // "sit" on the floor instead of floating. Separate from the drop shadow above.
  contactShadow?: ContactShadowOptions;
  output?: {
    type?: "image/png" | "image/webp";
    quality?: number;
  };
};

export type ContactShadowOptions = {
  enabled: boolean;
  opacity?: number;     // 0..1, default 0.40
  widthRatio?: number;  // ellipse width relative to product width, default 0.90
  heightRatio?: number; // ellipse height relative to its width, default 0.14 (flattened)
};

export async function compositeDeterministicCanvas(params: {
  backgroundSrc: string; 
  productSrc: string; 
  opts?: CompositeDeterministicOptions;
 pid: string; // PID stands for Picture ID placeholder
}): Promise<{ dataUrl: string; width: number; height: number }> {
  const opts = params.opts ?? {};

  const bgImg = await loadImage(params.backgroundSrc);
  const prImg = await loadImage(params.productSrc);

  const W = bgImg.naturalWidth || bgImg.width;
  const H = bgImg.naturalHeight || bgImg.height;
  if (!W || !H) throw new Error("Background image has invalid dimensions.");

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D context not available.");

  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(bgImg, 0, 0, W, H);

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

  const prodCanvas = document.createElement("canvas");
  prodCanvas.width = drawW;
  prodCanvas.height = drawH;
  const pctx = prodCanvas.getContext("2d", { willReadFrequently: true });
  if (!pctx) throw new Error("Product 2D context not available.");

  pctx.clearRect(0, 0, drawW, drawH);
  pctx.drawImage(prImg, 0, 0, drawW, drawH);

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

  // Contact shadow on the floor (below the product base), drawn before the product
  // so the product sits on top of it. Opt-in; existing callers are unaffected.
  if (opts.contactShadow?.enabled) {
    drawContactShadow({
      ctx,
      centerX: x + drawW / 2,
      baselineY: y + drawH,
      productW: drawW,
      opts: opts.contactShadow,
    });
  }

  const shadowOpacity = clamp(opts.shadowOpacity ?? 0.55, 0, 1);
  const shadowBlurPx = Math.max(0, Math.round(opts.shadowBlurPx ?? 18));
  const shadowDxPx = Math.round(opts.shadowDxPx ?? 0);
  const shadowDyPx = Math.round(opts.shadowDyPx ?? 10);

  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${shadowOpacity})`;
  ctx.shadowBlur = shadowBlurPx;
  ctx.shadowOffsetX = shadowDxPx;
  ctx.shadowOffsetY = shadowDyPx;
  ctx.drawImage(prodCanvas, x, y);
  ctx.restore();

  ctx.drawImage(prodCanvas, x, y);

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
  let x = 0, y = 0;
  switch (anchor) {
    case "center": x = Math.round((W - pW) / 2); y = Math.round((H - pH) / 2); break;
    case "top_left": x = 0; y = 0; break;
    case "top_right": x = W - pW; y = 0; break;
    case "bottom_left": x = 0; y = H - pH; break;
    case "bottom_right": x = W - pW; y = H - pH; break;
    case "center_left": x = 0; y = Math.round((H - pH) / 2); break;
    case "center_right": x = W - pW; y = Math.round((H - pH) / 2); break;
    case "right_third": x = Math.round(W * (2 / 3) - pW / 2); y = Math.round((H - pH) / 2); break;
    case "left_third": x = Math.round(W * (1 / 3) - pW / 2); y = Math.round((H - pH) / 2); break;
  }
  x += ox; y += oy;
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
  const sx = Math.max(0, box.x - pad);
  const sy = Math.max(0, box.y - pad);
  const sw = Math.min(canvasW - sx, box.w + pad * 2);
  const hBox = Math.min(canvasH - sy, box.h + pad * 2);
  let bgData: ImageData;
  let prData: ImageData;
  try {
    bgData = bgCtx.getImageData(sx, sy, sw, hBox);
    prData = prodCtx.getImageData(0, 0, box.w, box.h);
  } catch { return; }
  const bgL = meanLuma(bgData.data, false);
  const prL = meanLuma(prData.data, true); 
  if (!isFinite(bgL) || !isFinite(prL)) return;
  const delta = (bgL - prL) * 1.15 * strength; 
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
  const wrap = document.createElement("canvas");
  wrap.width = w; wrap.height = h;
  const wctx = wrap.getContext("2d");
  if (!wctx) return;
  wctx.clearRect(0, 0, w, h);
  wctx.drawImage(prodCanvas, 0, 0);
  wctx.globalCompositeOperation = "source-in";
  wctx.drawImage(bgImg, -x, -y); 
  wctx.globalCompositeOperation = "source-over";
  wctx.filter = `blur(${blurPx}px)`;
  const blurred = document.createElement("canvas");
  blurred.width = w; blurred.height = h;
  const bctx = blurred.getContext("2d");
  if (!bctx) return;
  bctx.filter = `blur(${blurPx}px)`;
  bctx.drawImage(wrap, 0, 0);
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.globalCompositeOperation = "screen";
  ctx.drawImage(blurred, x, y);
  ctx.restore();
}

function meanLuma(data: Uint8ClampedArray, onlyAlpha: boolean) {
  let sum = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (onlyAlpha && a < 8) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += l; n++;
  }
  return n ? sum / n : NaN;
}

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
function clampByte(v: number) { return Math.max(0, Math.min(255, Math.round(v))); }

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image`));
    img.src = src;
  });
}

// --- Contact shadow + separation glow -------------------------------------

// Soft, flattened dark ellipse on the floor under the product. Built from a
// radial gradient (no canvas filter needed → deterministic across browsers).
function drawContactShadow(args: {
  ctx: CanvasRenderingContext2D;
  centerX: number;
  baselineY: number;
  productW: number;
  opts: ContactShadowOptions;
}) {
  const { ctx, centerX, baselineY, productW, opts } = args;
  const opacity = clamp(opts.opacity ?? 0.4, 0, 1);
  const widthRatio = clamp(opts.widthRatio ?? 0.9, 0.1, 2);
  const heightRatio = clamp(opts.heightRatio ?? 0.14, 0.02, 1);
  const rw = Math.max(1, (productW * widthRatio) / 2);
  const rh = Math.max(1, rw * heightRatio);

  ctx.save();
  ctx.translate(centerX, baselineY);
  ctx.scale(1, rh / rw); // squash the circular gradient into a floor ellipse
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rw);
  grad.addColorStop(0, `rgba(0,0,0,${opacity})`);
  grad.addColorStop(0.55, `rgba(0,0,0,${opacity * 0.45})`);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, rw, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Subtle rim/halo behind a product (dark backgrounds) so it doesn't merge into
// the floor. Screen-blended radial light centered on the product box.
function drawSeparationGlow(args: {
  ctx: CanvasRenderingContext2D;
  centerX: number;
  centerY: number;
  productW: number;
  productH: number;
  strength: number;
}) {
  const { ctx, centerX, centerY, productW, productH, strength } = args;
  const s = clamp(strength, 0, 1);
  const r = Math.max(productW, productH) * 0.7;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const g = ctx.createRadialGradient(centerX, centerY, r * 0.1, centerX, centerY, r);
  g.addColorStop(0, `rgba(190,190,200,${s})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(centerX - r, centerY - r, r * 2, r * 2);
  ctx.restore();
}

// --- Multi-product catalog composition ------------------------------------

export type ProductShotLayout = "auto" | "row" | "group";
export type ProductShotVariant = "light" | "dark";

export type ProductShotOptions = {
  layout?: ProductShotLayout;
  variant?: ProductShotVariant;     // calibrates contact shadow + separation glow
  baselinePct?: number;             // floor line as fraction of H, default 0.84
  productHeightPct?: number;        // base product height as fraction of H (overrides per-count default)
  gapPct?: number;                  // horizontal gap as fraction of W, default 0.035
  contactShadow?: ContactShadowOptions;
  colorMatch?: { enabled: boolean; strength?: number; samplePadPx?: number };
  lightWrap?: { enabled: boolean; strength?: number; blurPx?: number };
  shadowOpacity?: number;
  shadowBlurPx?: number;
  shadowDyPx?: number;
  output?: { type?: "image/png" | "image/webp"; quality?: number };
};

// Default base product height (fraction of canvas H) by product count. These are
// only a starting ratio — the layout then scales the whole group up to fill the
// canvas within the width/height budgets (see composeProductShot), so multi-product
// shots don't end up as a small strip with empty space above.
function defaultHeightPct(n: number): number {
  if (n <= 1) return 0.7;
  if (n <= 3) return 0.6;
  return 0.5;
}

/**
 * Compose 1–7 products over a catalog background on a common floor baseline.
 * Reuses the same colorMatch + lightWrap + contact-shadow machinery per product.
 * Layout:
 *  - 1 product  → centered.
 *  - 2–3        → even horizontal row, baseline-aligned.
 *  - 4–7        → row with gentle center-emphasis depth ("auto"/"group").
 * If the row would overflow, every product is scaled down proportionally to fit.
 */
export async function composeProductShot(params: {
  backgroundSrc: string;
  productSrcs: string[];
  opts?: ProductShotOptions;
}): Promise<{ dataUrl: string; width: number; height: number }> {
  const opts = params.opts ?? {};
  const variant: ProductShotVariant = opts.variant ?? "light";
  const srcs = params.productSrcs.filter(Boolean).slice(0, 7);
  if (srcs.length === 0) throw new Error("composeProductShot: at least one product is required.");

  const bgImg = await loadImage(params.backgroundSrc);
  const W = bgImg.naturalWidth || bgImg.width;
  const H = bgImg.naturalHeight || bgImg.height;
  if (!W || !H) throw new Error("Background image has invalid dimensions.");

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D context not available.");
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(bgImg, 0, 0, W, H);

  const prImgs = await Promise.all(srcs.map(loadImage));
  const n = prImgs.length;

  const baseHeightPct = clamp(opts.productHeightPct ?? defaultHeightPct(n), 0.1, 0.9);
  const baseGap = W * clamp(opts.gapPct ?? 0.035, 0, 0.2);

  const layout: ProductShotLayout = opts.layout ?? "auto";
  const useDepth = (layout === "group") || (layout === "auto" && n >= 4);
  const mid = (n - 1) / 2;

  // Per-product relative heights (with optional center-emphasis depth).
  const relHeights = prImgs.map((_, i) => {
    let pct = baseHeightPct;
    if (useDepth && n > 1) {
      const dist = Math.abs(i - mid) / (mid || 1); // 0 center → 1 edge
      pct = baseHeightPct * (1 + 0.12 * (1 - dist)); // center a touch bigger
    }
    return H * pct;
  });

  // Provisional draw sizes from each product's aspect ratio.
  const provisional = prImgs.map((img, i) => {
    const pw0 = img.naturalWidth || img.width;
    const ph0 = img.naturalHeight || img.height;
    const drawH = Math.max(1, relHeights[i]);
    const ratio = pw0 && ph0 ? pw0 / ph0 : 1;
    const drawW = Math.max(1, drawH * ratio);
    return { img, drawW, drawH };
  });

  // Fill the canvas with balance: scale the whole group (and the gaps) by a single
  // factor that makes it as large as both budgets allow — width budget 90% of W,
  // height budget 82% of H for the tallest item. This both shrinks an overflowing
  // row AND grows an under-filled one, so products are never a tiny strip.
  const provGap = baseGap;
  const provRowW = provisional.reduce((s, d) => s + d.drawW, 0) + provGap * (n - 1);
  const provMaxH = provisional.reduce((m, d) => Math.max(m, d.drawH), 0);
  const widthBudget = W * 0.9;
  const heightBudget = H * 0.82;
  const fill = Math.min(widthBudget / provRowW, heightBudget / provMaxH);

  const gap = Math.round(provGap * fill);
  const draws = provisional.map((d) => ({
    img: d.img,
    drawW: Math.max(1, Math.round(d.drawW * fill)),
    drawH: Math.max(1, Math.round(d.drawH * fill)),
  }));

  const finalTotalW = draws.reduce((s, d) => s + d.drawW, 0) + gap * (n - 1);
  const finalMaxH = draws.reduce((m, d) => Math.max(m, d.drawH), 0);

  // Vertical centering: products share a common floor baseline, but the group's
  // vertical extent is centered (with a slight downward bias for a grounded feel),
  // so the empty space is balanced top/bottom instead of all above the products.
  const baselineY = Math.round(
    clamp(H * 0.54 + finalMaxH / 2, finalMaxH + H * 0.04, H * 0.96),
  );
  let cursorX = Math.round((W - finalTotalW) / 2);

  const cm = opts.colorMatch ?? { enabled: true, strength: 0.3, samplePadPx: 40 };
  const lw = opts.lightWrap ?? { enabled: true, strength: 0.16, blurPx: 10 };
  const contact = opts.contactShadow ?? {
    enabled: true,
    opacity: variant === "dark" ? 0.5 : 0.4,
    widthRatio: 0.92,
    heightRatio: 0.13,
  };
  const dropOpacity = clamp(opts.shadowOpacity ?? 0.4, 0, 1);
  const dropBlur = Math.max(0, Math.round(opts.shadowBlurPx ?? 22));
  const dropDy = Math.round(opts.shadowDyPx ?? 14);

  // Pass 1: floor contact shadows + (dark) separation glows — behind all products.
  for (const d of draws) {
    const cx = cursorX + d.drawW / 2;
    if (contact.enabled) {
      drawContactShadow({ ctx, centerX: cx, baselineY, productW: d.drawW, opts: contact });
    }
    if (variant === "dark") {
      drawSeparationGlow({
        ctx,
        centerX: cx,
        centerY: baselineY - d.drawH / 2,
        productW: d.drawW,
        productH: d.drawH,
        strength: 0.22,
      });
    }
    cursorX += d.drawW + gap;
  }

  // Pass 2: each product (colorMatch → drop shadow → draw → light wrap), on top.
  cursorX = Math.round((W - finalTotalW) / 2);
  for (const d of draws) {
    const x = cursorX;
    const y = baselineY - d.drawH;

    const prodCanvas = document.createElement("canvas");
    prodCanvas.width = d.drawW;
    prodCanvas.height = d.drawH;
    const pctx = prodCanvas.getContext("2d", { willReadFrequently: true });
    if (!pctx) throw new Error("Product 2D context not available.");
    pctx.clearRect(0, 0, d.drawW, d.drawH);
    pctx.drawImage(d.img, 0, 0, d.drawW, d.drawH);

    if (cm.enabled) {
      applySimpleLumaMatch({
        bgCtx: ctx,
        prodCtx: pctx,
        box: { x, y, w: d.drawW, h: d.drawH },
        pad: Math.max(0, Math.round(cm.samplePadPx ?? 40)),
        strength: clamp(cm.strength ?? 0.3, 0, 1),
        canvasW: W,
        canvasH: H,
      });
    }

    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${dropOpacity})`;
    ctx.shadowBlur = dropBlur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = dropDy;
    ctx.drawImage(prodCanvas, x, y);
    ctx.restore();

    ctx.drawImage(prodCanvas, x, y);

    if (lw.enabled) {
      drawLightWrap({
        ctx,
        bgImg,
        prodCanvas,
        x,
        y,
        blurPx: Math.max(0, Math.round(lw.blurPx ?? 10)),
        strength: clamp(lw.strength ?? 0.16, 0, 1),
      });
    }

    cursorX += d.drawW + gap;
  }

  const outType = opts.output?.type ?? "image/png";
  const q = clamp(opts.output?.quality ?? 0.92, 0.1, 1);
  const dataUrl = canvas.toDataURL(outType, q);
  return { dataUrl, width: W, height: H };
}