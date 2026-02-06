
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { AspectRatio, ImageSize, ReferenceImage, GeneratedAsset, PackSpec } from "../types";

// Inicializar cliente solo si existe la key (manejo seguro)
const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || "";
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

const VALID_ASPECT_RATIOS = new Set([
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'
]);

// Mock fallback por si no hay API Key configurada
async function mockGenerateImage(): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="100%" height="100%" fill="#1a1a1a"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="48" fill="#333">Simulación (Sin API Key)</text><circle cx="512" cy="512" r="100" fill="#FFAB00" opacity="0.5"/></svg>`;
      const base64 = btoa(svg);
      resolve(`data:image/svg+xml;base64,${base64}`);
    }, 1500);
  });
}

// Utility to handle 503 Overloaded errors with exponential backoff
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 2000
): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      const status = error?.status || error?.code;
      const msg = error?.message || "";
      
      const isRetryable = 
        status === 503 || 
        status === 429 || 
        msg.includes("overloaded") || 
        msg.includes("UNAVAILABLE") ||
        msg.includes("Too Many Requests");

      if (isRetryable && i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        console.warn(`API Overloaded (Attempt ${i + 1}/${maxRetries}). Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function dataUrlToPart(dataUrl: string) {
    const split = dataUrl.split(',');
    const base64Data = split[1];
    const mimeType = split[0].split(';')[0].split(':')[1];
    return {
        inlineData: {
            mimeType: mimeType,
            data: base64Data
        }
    };
}

export async function generateImageFromPrompt(params: {
  prompt: string;
  aspectRatio: AspectRatio;
  size: ImageSize;
  sourceAssetDataUrl?: string; // Source A (Main Subject)
  sourceAssetLabel?: string;
  referenceImages?: ReferenceImage[]; // Source B + Refs 1-3
  model?: string;
}): Promise<string> {
  console.log("Generating image with prompt:", params.prompt);

  if (!ai) {
    console.warn("No API Key found. Using mock generator.");
    return mockGenerateImage();
  }

  // VALIDATION: Ensure aspect ratio is valid, fallback to 1:1 if not.
  let validAR = params.aspectRatio;
  if (!VALID_ASPECT_RATIOS.has(validAR)) {
      console.warn(`Invalid aspect ratio '${validAR}', defaulting to '1:1'`);
      validAR = '1:1';
  }

  // --- LOGIC ---
  const hasSource = !!params.sourceAssetDataUrl;
  const hasRefs = params.referenceImages && params.referenceImages.length > 0;
  const useMultimodal = hasSource || hasRefs;

  // --- PATH 1: Imagen 3 (Text Only) ---
  if (!useMultimodal && !params.model) {
    try {
      console.log("Attempting Imagen 3 generation...");
      const arMap: Record<string, string> = {
        "1:1": "1:1", "16:9": "16:9", "9:16": "9:16", "4:3": "4:3", "3:4": "3:4"
      };
      
      const response = await withRetry(async () => {
        return await ai!.models.generateImages({
          model: 'imagen-3.0-generate-001',
          prompt: params.prompt + " photorealistic, 8k, highly detailed, professional lighting, no text, no watermarks",
          config: {
            numberOfImages: 1,
            aspectRatio: arMap[validAR] || "1:1",
            outputMimeType: 'image/jpeg',
          },
        });
      }) as any;

      if (response.generatedImages && response.generatedImages.length > 0) {
        return `data:image/jpeg;base64,${response.generatedImages[0].image.imageBytes}`;
      }
    } catch (error: any) {
      console.warn("Imagen 3 failed. Falling back to Gemini 2.5.", error.message);
    }
  }

  // --- PATH 2: Gemini 2.5 Flash Image (Multimodal / Fallback) ---
  try {
    const model = params.model || 'gemini-2.5-flash-image';
    console.log(`Using model: ${model}`);

    const parts: any[] = [];
    
    // START OF PROMPT ENGINEERING FOR COMPOSITION
    let imageDefinitions = "";
    let backgroundIndex = -1;
    let mainSubjectIndex = -1;
    
    // 1. Add Main Source Asset (Source A)
    if (params.sourceAssetDataUrl) {
        parts.push(dataUrlToPart(params.sourceAssetDataUrl));
        const label = params.sourceAssetLabel || "Main Subject";
        imageDefinitions += `[Image 1] is the MAIN SUBJECT (${label}) that must be placed into the scene.\n`;
        mainSubjectIndex = 1;
    }

    // 2. Add Additional References (Source B, Refs)
    if (params.referenceImages) {
        params.referenceImages.forEach((ref, idx) => {
             parts.push(dataUrlToPart(ref.dataUrl));
             // Adjust index offset based on whether Source A exists
             const refIndex = params.sourceAssetDataUrl ? idx + 2 : idx + 1;
             const refLabel = ref.label || "Reference";
             
             // INTELLIGENT PARSING BASED ON LABELS
             if (refLabel.toLowerCase().includes("fondo") || refLabel.toLowerCase().includes("background")) {
                 imageDefinitions += `[Image ${refIndex}] is the BACKGROUND ENVIRONMENT (${refLabel}) where the subject(s) must be placed.\n`;
                 backgroundIndex = refIndex;
             } else if (refLabel.toLowerCase().includes("sujeto") || refLabel.toLowerCase().includes("subject") || refLabel.toLowerCase().includes("person")) {
                 imageDefinitions += `[Image ${refIndex}] is a SECONDARY SUBJECT (${refLabel}) to be included in the composition.\n`;
             } else {
                 imageDefinitions += `[Image ${refIndex}] is a STYLE REFERENCE (${refLabel}).\n`;
             }
        });
    }

    let fullPrompt = "";
    if (imageDefinitions) {
        fullPrompt += `IMAGES CONTEXT:\n${imageDefinitions}\n`;
        
        if (backgroundIndex !== -1 && mainSubjectIndex !== -1) {
            // *** FUSION LOGIC ENHANCEMENT ***
            // Explicitly instructing NOT to overlay, but to integrate.
            fullPrompt += `TASK: PHOTOREALISTIC INTEGRATION (NOT OVERLAY).\n`;
            fullPrompt += `1. Analyze the perspective and light direction of [Image ${backgroundIndex}].\n`;
            fullPrompt += `2. Re-render the scene placing [Image ${mainSubjectIndex}] inside it.\n`;
            fullPrompt += `3. CRITICAL: The subject must cast REALISTIC SHADOWS onto the floor of the environment.\n`;
            fullPrompt += `4. CRITICAL: Apply 'Light Wrap' and 'Global Illumination'. The colors of the environment must reflect on the edges of the subject.\n`;
            fullPrompt += `5. Do not just paste the image. Blend the pixels at the contact point with the ground.\n`;
        } else {
            fullPrompt += `TASK: Composite the provided subject(s) into the scene. Match perspective, lighting, and shadows.\n`;
        }
        
        fullPrompt += `SCENE DESCRIPTION: ${params.prompt}`;
    } else {
        // FORCE IMPERATIVE COMMAND TO AVOID CONVERSATIONAL RESPONSES
        // The error "What product would you like..." happens when the model acts as a chat bot.
        fullPrompt = `Generate a high-quality photorealistic image of: ${params.prompt}`;
    }
    
    fullPrompt += " \nSTYLE: Photorealistic, 8k, professional photography, high detail, no text overlays. Do not ask questions, just generate the image.";

    parts.push({ text: fullPrompt });

    const response = await withRetry<GenerateContentResponse>(() => ai!.models.generateContent({
      model: model,
      contents: { parts },
      config: {
        imageConfig: {
          aspectRatio: validAR,
        }
      },
    }));

    if (!response.candidates || response.candidates.length === 0) {
      throw new Error("API returned no candidates.");
    }

    const candidate = response.candidates[0];
    if (candidate.content && candidate.content.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }
    
    const textPart = candidate.content?.parts?.find(p => p.text)?.text;
    throw new Error(`Model did not return an image. Reason: ${candidate.finishReason}. Message: ${textPart || 'None'}`);

  } catch (error: any) {
    console.error("Gemini Generation Error:", error);
    if (error.message.includes("Mock")) return mockGenerateImage();
    throw error; 
  }
}

export const NO_PACKAGING_NEGATIVE = "packaging, box, container, text, label, logo, watermark, hands, fingers, people";

// --- AVATAR GENERATOR UPGRADE (v1.0 Hardening) ---

export interface AvatarGenParams {
  aspectRatio: AspectRatio;
  baseStyleRules: string;
  contextRules: string;
  roleRules: string;
  stylePackRules?: string; // New Style Pack support
  
  // Advanced Config
  enableRefs: boolean;
  allowMirrors: boolean;
  strictIdentity: boolean;
  creativityLevel: 1 | 2 | 3;
  userPrompt?: string;

  // Assets
  subjectA?: { dataUrl: string; label: string };
  subjectB?: { dataUrl: string; label: string };
  background?: { dataUrl: string; label: string };
  styleRefs?: { dataUrl: string; label: string }[];
}

export async function generateAvatar(params: AvatarGenParams): Promise<string> {
    if (!ai) return mockGenerateImage();

    const parts: any[] = [];
    let imgIdx = 1;
    let imagesContext = "IMAGES PROVIDED:\n";

    // 1. INPUT MAPPING
    if (params.subjectA) {
        parts.push(dataUrlToPart(params.subjectA.dataUrl));
        imagesContext += `[Image ${imgIdx++}] = SUBJECT A (Main Person). IDENTITY LOCK REQUIRED.\n`;
    }

    if (params.subjectB) {
        parts.push(dataUrlToPart(params.subjectB.dataUrl));
        imagesContext += `[Image ${imgIdx++}] = SUBJECT B (Secondary Person). IDENTITY LOCK REQUIRED. Ensure consistent scale with Subject A.\n`;
    }

    if (params.background) {
        parts.push(dataUrlToPart(params.background.dataUrl));
        imagesContext += `[Image ${imgIdx++}] = BACKGROUND BASE (Geometry/Lighting Reference). Use this scene exactly, integrate subjects into it.\n`;
    }

    // VISUAL REFS PROTOCOL (GATED)
    if (params.enableRefs && params.styleRefs) {
        params.styleRefs.forEach((ref) => {
            parts.push(dataUrlToPart(ref.dataUrl));
            imagesContext += `[Image ${imgIdx++}] = STYLE REF (Use for lighting/mood/texture/grading ONLY. Do NOT use face/identity from this image).\n`;
        });
    }

    // 2. PROMPT COMPILER
    const creativityInstructions = {
        1: "STRICT: Maintain pose and framing exactly as implied by context. High fidelity to source identity.",
        2: "BALANCED: Allow natural micro-variations in pose and expression. Cinematic lighting enhancements allowed.",
        3: "WILD: Dynamic angles, creative interpretation of context and lighting. High contrast."
    };

    const prompt = `
TASK: GENERATE PROFESSIONAL AVATAR PORTRAIT
${parts.length > 0 ? imagesContext : ""}

HARD CONSTRAINTS:
1. PHOTOREALISTIC, 8k, High Fidelity. No CGI look.
2. NO TEXT, NO LOGOS, NO WATERMARKS.
3. ${params.allowMirrors ? "Reflections allowed if coherent." : "NO MIRRORS. Avoid reflective surfaces that show the camera or duplicate faces. No blurry reflections."}
4. ${params.subjectB ? "TWO PEOPLE SCENE. Do not merge faces. Do not generate extra people." : "SINGLE PERSON SCENE. Do not generate extra people."}

IDENTITY PROTOCOL:
${params.subjectA ? `- KEEP IDENTITY OF SUBJECT A. Do not change facial features, age, or ethnicity.` : "- Generate a fictional person fitting the role."}
${params.subjectB ? `- KEEP IDENTITY OF SUBJECT B. Maintain consistent interaction.` : ""}
${params.strictIdentity ? "STRICT IDENTITY LOCK: ON. Prioritize facial fidelity over style adjustments." : ""}

LAYERS CONFIGURATION:
1. BASE STYLE: ${params.baseStyleRules}
2. CONTEXT: ${params.contextRules} ${params.background ? "(GROUND TRUTH: Use provided Background image)" : "(AUTO-GEN: Generate this environment with high detail)"}
3. ROLE/WARDROBE: ${params.roleRules}
${params.stylePackRules ? `4. STYLE PACK: ${params.stylePackRules}` : ""}

${params.enableRefs ? "VISUAL REFS PROTOCOL: Use provided Style Refs for color palette, lighting and texture grading. DO NOT COPY FACES from Style Refs." : ""}

USER NOTES: ${params.userPrompt || "None"}

CREATIVITY LEVEL ${params.creativityLevel}: ${creativityInstructions[params.creativityLevel]}

EXECUTION:
Generate the final image combining these layers. Ensure realistic lighting integration (light wrap, shadows) between subject and environment.
`;

    parts.push({ text: prompt });

    const response = await withRetry<GenerateContentResponse>(() => ai!.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts },
      config: {
        imageConfig: {
          aspectRatio: params.aspectRatio,
        }
      },
    }));

    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    
    throw new Error("Avatar generation failed.");
}

// --- Backup Exports ---
export async function generateSceneBackground(params: any): Promise<string> {
  return generateImageFromPrompt({
    prompt: params.prompt,
    aspectRatio: "1:1",
    size: "2k",
  });
}
export async function generateProductBackground(params: any): Promise<string> {
  return generateImageFromPrompt(params);
}
export async function generateLandingPack(brandId: string, packSpec: PackSpec | undefined, controls: any): Promise<GeneratedAsset[]> {
  return [];
}
