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