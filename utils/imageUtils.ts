
import type { ProductPlacement, SceneNegativeSpace, LibraryAssetKind } from "../types";

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

/**
 * Detects if an image has significant transparency (Alpha channel).
 * Returns inferred Kind and alpha detected boolean.
 */
export async function detectAssetKind(dataUrl: string): Promise<{ kind: LibraryAssetKind; alphaDetected: boolean }> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            // Downscale for performance check
            const w = Math.min(img.width, 200);
            const h = Math.min(img.height, 200);
            canvas.width = w;
            canvas.height = h;
            
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                resolve({ kind: "unknown", alphaDetected: false });
                return;
            }
            
            ctx.drawImage(img, 0, 0, w, h);
            
            try {
                const imgData = ctx.getImageData(0, 0, w, h);
                const data = imgData.data;
                let transparentPixels = 0;
                const totalPixels = w * h;
                
                // Sample pixels (step 4 for speed)
                for (let i = 0; i < data.length; i += 16) {
                    // Alpha is at i+3
                    if (data[i + 3] < 250) {
                        transparentPixels++;
                    }
                }
                
                // Heuristic: If > 5% pixels are transparent, it's likely a cutout/product
                const threshold = (totalPixels / 4) * 0.05; 
                const alphaDetected = transparentPixels > threshold;
                
                if (alphaDetected) {
                    resolve({ kind: "product", alphaDetected: true });
                } else {
                    // If opaque and distinct dimensions, likely background
                    resolve({ kind: "background", alphaDetected: false });
                }
            } catch (e) {
                console.warn("CORS or Canvas error during inference", e);
                resolve({ kind: "unknown", alphaDetected: false });
            }
        };
        img.onerror = () => resolve({ kind: "unknown", alphaDetected: false });
        img.src = dataUrl;
    });
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
