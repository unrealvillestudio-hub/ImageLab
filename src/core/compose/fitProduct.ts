import { getAlphaBBox } from "./alphaBBox.ts";

export type FitProductInput = {
  productImg: HTMLImageElement;
  outW: number;
  outH: number;
  currentOffsetX: number;
  currentOffsetY: number;
  touchedOffsets: boolean;
  defaultOffsetX?: number;
  defaultOffsetY?: number;
  targetHRatio?: number; 
};

export async function computeFitProductParams(inp: FitProductInput){
  const {
    productImg,outW,outH,currentOffsetX,currentOffsetY,touchedOffsets,
    defaultOffsetX,defaultOffsetY,targetHRatio
  } = inp;

  const bbox = await getAlphaBBox(productImg, 8);
  const ratio = targetHRatio ?? 0.26;
  const targetH = Math.max(40, ratio * outH);

  const h = Math.max(1, bbox.h);
  
  let scale = targetH / h;
  scale = Math.max(0.05, Math.min(3.0, scale));

  const offsetX = touchedOffsets
    ? currentOffsetX
    : (defaultOffsetX ?? (-0.22 * outW));

  const offsetY = touchedOffsets
    ? currentOffsetY
    : (defaultOffsetY ?? ( 0.12 * outH));

  return { scale, offsetX, offsetY };
}