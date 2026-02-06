
import { ProductPlacement } from "../types";

// Helper: Cargar imagen con seguridad CORS
const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Error loading image`));
    img.src = src;
  });

// Helper: Generar Hash simple de una cadena (para verificar integridad del producto)
export const computeProductHash = (dataUrl: string): string => {
  let hash = 0;
  if (dataUrl.length === 0) return "0";
  // Usamos una porción del string base64 para velocidad
  const sample = dataUrl.substring(dataUrl.length - 1000, dataUrl.length);
  for (let i = 0; i < sample.length; i++) {
    const char = sample.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash.toString(16);
};

export async function compositeProductOverBackground(params: {
  backgroundDataUrl: string;
  productDataUrl: string;
  placement: ProductPlacement;
  debugMode?: boolean; // New Debug Flag
  debugInfo?: Record<string, string>; // Extra debug fields (routing, policy, etc)
}): Promise<string> {
  const bgImg = await loadImage(params.backgroundDataUrl);
  const prodImg = await loadImage(params.productDataUrl);

  const canvas = document.createElement("canvas");
  canvas.width = bgImg.width;
  canvas.height = bgImg.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) throw new Error("Canvas context failed");

  // 1. DIBUJAR FONDO (Base Layer)
  ctx.drawImage(bgImg, 0, 0);

  // --- CÁLCULO DE GEOMETRÍA DETERMINISTA ---
  // El scale es absoluto respecto a las dimensiones originales del producto o relativo al canvas si se especifica heightPct.
  // Aquí usamos la lógica simple solicitada: Scale multiplica el tamaño natural.
  
  let drawW = prodImg.width;
  let drawH = prodImg.height;
  
  // Si hay maxHeightPct (legacy), lo usamos, sino usamos scale directo
  const scale = params.placement.scale ?? 1.0;
  
  // Ajuste base para que escala 1.0 sea razonable en lienzos grandes (opcional, pero ayuda a la UX)
  // Si el usuario usa JSON explícito, respetamos scale absoluto.
  drawW = drawW * scale;
  drawH = drawH * scale;

  // Posicionamiento (Centro + Offset)
  const centerX = (canvas.width - drawW) / 2;
  const centerY = (canvas.height - drawH) / 2;

  const offsetX = params.placement.offsetX ?? 0;
  const offsetY = params.placement.offsetY ?? 0;

  const x = centerX + offsetX;
  const y = centerY + offsetY;

  // --- PREPARACIÓN DE SOMBRAS (Offscreen) ---
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = drawW;
  shadowCanvas.height = drawH;
  const sCtx = shadowCanvas.getContext('2d');
  
  if (sCtx) {
      // Dibujar silueta del producto para sombras
      sCtx.drawImage(prodImg, 0, 0, drawW, drawH);
      
      // MODO TRANSPARENCY SENSITIVE: Limpiar áreas semi-transparentes
      if (params.placement.transparencySensitive) {
          const id = sCtx.getImageData(0, 0, drawW, drawH);
          const d = id.data;
          for (let i = 0; i < d.length; i += 4) {
              if (d[i+3] < 240) d[i+3] = 0; // Hard cutoff para tapas transparentes
          }
          sCtx.putImageData(id, 0, 0);
      }
      
      // Convertir a silueta negra
      sCtx.globalCompositeOperation = "source-in";
      sCtx.fillStyle = params.placement.shadow?.color || "#000000";
      sCtx.fillRect(0, 0, drawW, drawH);
  }

  // --- LAYER 2: CAST SHADOW (Sombra Proyectada) ---
  const shadowOpacity = params.placement.shadow?.opacity ?? 0.0;
  
  if (shadowOpacity > 0 && sCtx) {
      const sBlur = params.placement.shadow?.blur ?? 15;
      const sOffX = params.placement.shadow?.offsetX ?? 0;
      const sOffY = params.placement.shadow?.offsetY ?? 10; // Default drop down

      ctx.save();
      ctx.globalAlpha = shadowOpacity;
      ctx.filter = `blur(${sBlur}px)`;
      // Dibujar la silueta desplazada
      ctx.drawImage(shadowCanvas, x + sOffX, y + sOffY);
      ctx.restore();
  }

  // --- LAYER 3: CONTACT SHADOW / AO (Ambient Occlusion) ---
  // "Soft darken near bottom edge"
  if (params.placement.ambientOcclusion?.enabled && sCtx) {
      const aoOpacity = params.placement.ambientOcclusion.opacity ?? 0.5;
      const aoBlur = params.placement.ambientOcclusion.blur ?? 20;
      // Spread controla cuánto sube la sombra por el objeto (simulado con offset vertical negativo relativo)
      const aoOffset = params.placement.ambientOcclusion.offsetY ?? 5; 

      ctx.save();
      ctx.globalCompositeOperation = "multiply"; // Blend mode para integrar con suelo
      ctx.globalAlpha = aoOpacity;
      ctx.filter = `blur(${aoBlur}px)`;
      
      // Dibujamos la misma silueta, pero muy cerca de la base original
      ctx.drawImage(shadowCanvas, x, y + (drawH * 0.02) + aoOffset);
      ctx.restore();
  }

  // --- LAYER 4: PRODUCTO (Overlay Determinista) ---
  ctx.drawImage(prodImg, x, y, drawW, drawH);

  // --- LAYER 5: DEBUG OVERLAY ---
  if (params.debugMode) {
      ctx.save();
      
      // Bounding Box
      ctx.strokeStyle = "#00FF00"; // Green for Product Box
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(x, y, drawW, drawH);

      // Center Crosshair
      ctx.beginPath();
      ctx.moveTo(x + drawW/2 - 10, y + drawH/2);
      ctx.lineTo(x + drawW/2 + 10, y + drawH/2);
      ctx.moveTo(x + drawW/2, y + drawH/2 - 10);
      ctx.lineTo(x + drawW/2, y + drawH/2 + 10);
      ctx.stroke();

      // Shadow Area Reference (Yellow)
      if (shadowOpacity > 0) {
          ctx.strokeStyle = "#FFFF00";
          ctx.setLineDash([2, 2]);
          const sOffX = params.placement.shadow?.offsetX ?? 0;
          const sOffY = params.placement.shadow?.offsetY ?? 10;
          ctx.strokeRect(x + sOffX, y + sOffY, drawW, drawH);
      }

      // Text Info Background
      ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
      ctx.fillRect(10, 10, 320, 160);
      
      ctx.fillStyle = "#00FF00";
      ctx.font = "bold 11px monospace";
      let lineY = 25;
      
      ctx.fillText(`Prod Hash: ${computeProductHash(params.productDataUrl).substring(0, 8)}...`, 20, lineY); lineY+=15;
      ctx.fillText(`Pos: ${Math.round(x)}, ${Math.round(y)} | Size: ${Math.round(drawW)}x${Math.round(drawH)}`, 20, lineY); lineY+=15;
      ctx.fillText(`Scale: ${scale.toFixed(2)} | AO: ${params.placement.ambientOcclusion?.enabled ? 'ON' : 'OFF'}`, 20, lineY); lineY+=15;
      
      if (params.debugInfo) {
          ctx.fillStyle = "#FFAB00";
          lineY += 5;
          if (params.debugInfo.routing) {
            ctx.fillText(`Routing: ${params.debugInfo.routing}`, 20, lineY); lineY+=15;
          }
          if (params.debugInfo.shadow) {
            ctx.fillText(`Shadow: ${params.debugInfo.shadow}`, 20, lineY); lineY+=15;
          }
          Object.entries(params.debugInfo).forEach(([k, v]) => {
              if (k !== 'routing' && k !== 'shadow') {
                ctx.fillText(`${k}: ${v}`, 20, lineY); lineY+=15;
              }
          });
      }

      ctx.restore();
  }

  return canvas.toDataURL("image/png", 0.95);
}