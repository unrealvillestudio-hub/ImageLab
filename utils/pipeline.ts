
// utils/pipeline.ts
import { cropAndConvertToWebP, compositeSubjectsOnBackground } from './image';
import { SubjectAsset } from '../types';
import { NO_PACKAGING_NEGATIVE, generateSceneBackground } from '../services/gemini';

export type SubjectSlot = {
  slotId: string;          // e.g. "primary", "person_1"
  subjectId: string;       // SubjectAsset.id
  zIndex?: number;         // overlay order
  placement?: any;         // future: per-slot placement override
};

export async function generateSceneThenComposite(args: {
  width: number;
  height: number;
  prompt: string;
  negativePrompt?: string;
  systemInstruction?: string;
  useCompositing: boolean;
  subjects: SubjectAsset[];     // resolved subject assets for this render
  slots: SubjectSlot[];         // ordered
}) {
  const negative = `${args.negativePrompt || ''} ${args.useCompositing ? NO_PACKAGING_NEGATIVE : ''}`.trim();

  const bg = await generateSceneBackground({
    prompt: args.prompt,
    negativePrompt: negative,
    width: args.width,
    height: args.height,
    systemInstruction: args.systemInstruction,
  });

  if (!args.useCompositing || args.subjects.length === 0) {
    // Still convert to webp deterministically for output consistency
    const webp = await cropAndConvertToWebP({ dataUrlPng: bg, targetWidth: args.width, targetHeight: args.height });
    return { background: bg, composed: webp };
  }

  // Composite subjects deterministically over the generated background.
  const layers = args.slots.map(slot => {
    const subject = args.subjects.find(s => s.id === slot.subjectId);
    return {
      dataUrl: subject?.dataUrl || "",
      placement: slot.placement || { anchor: 'center' as const },
      zIndex: slot.zIndex
    };
  });

  const composedPng = await compositeSubjectsOnBackground({
    backgroundDataUrl: bg,
    layers: layers
  });
  
  const webp = await cropAndConvertToWebP({ dataUrlPng: composedPng, targetWidth: args.width, targetHeight: args.height });
  return { background: bg, composed: webp };
}
