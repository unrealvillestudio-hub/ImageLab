import { LibraryAssetKind } from "../types.ts";

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
                
                // Heuristic: If > 5% pixels are transparent, it's likely a cutout/product
                for (let i = 0; i < data.length; i += 16) {
                    if (data[i + 3] < 250) {
                        transparentPixels++;
                    }
                }
                
                const threshold = (totalPixels / 4) * 0.05; 
                const alphaDetected = transparentPixels > threshold;
                
                if (alphaDetected) {
                    resolve({ kind: "product", alphaDetected: true });
                } else {
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