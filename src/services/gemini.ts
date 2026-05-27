import { AspectRatio, ImageSize, ReferenceImage } from "../core/types.ts";

const VALID_ASPECT_RATIOS = new Set([
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'
]);

export const NO_PACKAGING_NEGATIVE = "bottles, packaging, labels, product containers, text, logos, branding";

/**
 * Generates an image by calling the server-side /api/execute endpoint.
 * The Gemini API key lives in the server's process.env so it is never shipped to the browser.
 */
export async function generateImageFromPrompt(params: {
  prompt: string;
  aspectRatio: AspectRatio;
  size: ImageSize;
  sourceAssetDataUrl?: string;
  sourceAssetLabel?: string;
  referenceImages?: ReferenceImage[];
  model?: string;
  signal?: AbortSignal;
}): Promise<string> {
  if (params.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  let validAR = params.aspectRatio;
  if (!VALID_ASPECT_RATIOS.has(validAR)) validAR = '1:1';

  let modelName = params.model || 'gemini-2.5-flash-image';
  if (modelName.startsWith('gemini-3')) modelName = 'gemini-2.5-flash-image';

  const res = await fetch('/api/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'direct',
      prompt: params.prompt,
      aspectRatio: validAR,
      sourceAssetDataUrl: params.sourceAssetDataUrl,
      referenceImages: params.referenceImages,
      model: modelName,
    }),
    signal: params.signal,
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error ?? ''; } catch { detail = await res.text().catch(() => ''); }
    throw new Error(`Image API error ${res.status}: ${detail}`);
  }

  const data = await res.json();
  if (!data?.image_data_url) throw new Error('No image data found in the API response.');
  return data.image_data_url as string;
}

// Fix: Exported missing generateAvatar for ToolsModule integration
export async function generateAvatar(params: {
  aspectRatio: AspectRatio;
  baseStyleRules: string;
  contextRules: string;
  roleRules: string;
  enableRefs: boolean;
  allowMirrors: boolean;
  strictIdentity: boolean;
  creativityLevel: number;
  subjectA?: { dataUrl: string; label: string };
  subjectB?: { dataUrl: string; label: string };
  background?: { dataUrl: string; label: string };
  styleRefs?: { dataUrl: string; label: string }[];
  userPrompt?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const prompt = `High-end professional portrait. 
Style: ${params.baseStyleRules}. 
Context: ${params.contextRules}. 
Role: ${params.roleRules}. 
${params.userPrompt ? `Extra constraints: ${params.userPrompt}` : ''}
${params.allowMirrors ? '' : 'Strictly avoid mirrors or reflective glass in background.'}
${params.strictIdentity ? 'Maintain strict facial likeness of the person provided.' : ''}`;

  return generateImageFromPrompt({
    prompt,
    aspectRatio: params.aspectRatio,
    size: "1k",
    sourceAssetDataUrl: params.subjectA?.dataUrl,
    referenceImages: params.styleRefs,
    signal: params.signal
  });
}

// Fix: Exported missing generateSceneBackground for pipeline utility integration
export async function generateSceneBackground(params: {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  systemInstruction?: string;
}): Promise<string> {
  // Determine best fit aspect ratio
  const ratio = params.width / params.height;
  let ar: AspectRatio = "1:1";
  if (ratio > 1.35) ar = "16:9";
  else if (ratio < 0.75) ar = "9:16";
  else if (ratio > 1.15) ar = "4:3";
  else if (ratio < 0.85) ar = "3:4";

  return generateImageFromPrompt({
    prompt: `${params.prompt}. Negative prompt: ${params.negativePrompt || ''}`,
    aspectRatio: ar,
    size: "1k"
  });
}