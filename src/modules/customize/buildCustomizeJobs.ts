import type { OutputSpec } from "../../config/customizeOutputs.ts";
import { computeCameraBaseFromAuthor, projectCanvasPointToBg, projectBgPointToCanvas } from "../../core/compose/cameraLock.ts";

export interface CompositeValues {
  scale: number;
  offsetX: number;
  offsetY: number;
  shadowOpacity: number;
  shadowBlur: number;
  ambientOcclusion: boolean;
}

function computePerOutputParams(opts: {
  params: CompositeValues;
  bgW: number; bgH: number;
  authorW: number; authorH: number;
  outW: number; outH: number;
}) {
  const { params, bgW, bgH, authorW, authorH, outW, outH } = opts;

  const cam = computeCameraBaseFromAuthor({ bgW, bgH, authorW, authorH });
  const authorCenter = { x: authorW / 2, y: authorH / 2 };
  const authorAnchorCanvas = { x: authorCenter.x + params.offsetX, y: authorCenter.y + params.offsetY };

  const anchorBg = projectCanvasPointToBg({
      cam, bgW, bgH, authorW, authorH,
      xCanvas: authorAnchorCanvas.x, yCanvas: authorAnchorCanvas.y
  });

  const anchorCanvasTarget = projectBgPointToCanvas({
      cam, bgW, bgH, outW, outH,
      bx: anchorBg.bx, by: anchorBg.by
  });

  const targetCenter = { x: outW / 2, y: outH / 2 };
  const offsetX = anchorCanvasTarget.x - targetCenter.x;
  const offsetY = anchorCanvasTarget.y - targetCenter.y;

  const tTarget = anchorCanvasTarget.t;
  const sAuthor = Math.max(cam.sBase, authorW/bgW, authorH/bgH);
  
  const scale = params.scale * (tTarget.s / sAuthor);

  return {
    ...params,
    scale,
    offsetX,
    offsetY,
    shadowBlur: Math.max(0, Math.round(params.shadowBlur * (tTarget.s / sAuthor))),
  };
}

export function buildCustomizeJobs(args: {
  slots: any; 
  selectedOutputs: OutputSpec[];
  fineTune: {
    scale: number;
    offsetX: number;
    offsetY: number;
    shadowOpacity: number;
    shadowBlur: number;
    ambientOcclusion: boolean;
  };
  brandActive?: string;
  intentId?: string;
  customNotes?: string;
  authoringOutPx?: { w: number; h: number };
  bgDimensions?: { w: number; h: number }; 
}) {
  const { slots, selectedOutputs, fineTune, brandActive, intentId, customNotes, authoringOutPx, bgDimensions } = args;

  const lockedParams = { ...fineTune };
  const effectiveAuthorPx = authoringOutPx || { w: 1080, h: 1080 };
  const effectiveBgDims = bgDimensions || effectiveAuthorPx; 

  return selectedOutputs.map((out) => {
    const jobSlots: any = { ...(slots ?? {}) };

    const requiresProduct = !!out.requires?.productA;
    const requiresBg = !!out.requires?.backgroundB;

    if (!requiresProduct) {
      delete jobSlots.subject_a;
      delete jobSlots.secondary_subject;
    }

    if (!requiresBg) {
      delete jobSlots.subject_b;
    }

    const mappedParams = computePerOutputParams({
        params: lockedParams,
        bgW: effectiveBgDims.w,
        bgH: effectiveBgDims.h,
        authorW: effectiveAuthorPx.w,
        authorH: effectiveAuthorPx.h,
        outW: out.dimensions.w,
        outH: out.dimensions.h
    });

    return {
      module: "customize",
      routing: "CUSTOMIZE_DETERMINISTIC",
      use_scene_generator: false,
      use_compositing: requiresProduct,
      background_only: !requiresProduct,
      output_id: out.id,
      output_label: out.label,
      export_tag: out.exportTag,
      target: {
        w: out.dimensions?.w,
        h: out.dimensions?.h,
        aspectRatio: out.aspectRatio,
      },
      fine_tune: {
        scale: mappedParams.scale,
        offsetX: mappedParams.offsetX,
        offsetY: mappedParams.offsetY,
        shadowOpacity: mappedParams.shadowOpacity,
        shadowBlur: mappedParams.shadowBlur,
        ambientOcclusion: mappedParams.ambientOcclusion,
      },
      slots: jobSlots,
      metadata: {
        brandActive: brandActive ?? "",
        intentId: intentId ?? "",
        customNotes: customNotes ?? "",
        output_id: out.id,
        output_label: out.label,
        export_tag: out.exportTag,
        dimensions: out.dimensions,
        aspectRatio: out.aspectRatio,
        params_source: "camera_lock",
        params_original: lockedParams
      },
    };
  });
}