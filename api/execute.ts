/**
 * ImageLab — POST /api/execute
 * v5 — Vertex AI text-to-image + multimodal subject/style customization.
 *
 * Routing:
 *  - Orchestrator path (brandId + stage): builds a brand-aware prompt and calls
 *    imagen-3.0-fast-generate-001 (text-to-image, fast & cheap).
 *  - Direct mode without refs: same fast model.
 *  - Direct mode WITH sourceAssetDataUrl or referenceImages: routes to
 *    imagen-3.0-capability-001 with REFERENCE_TYPE_SUBJECT / REFERENCE_TYPE_STYLE
 *    bindings. Subject type (PERSON / PRODUCT / ANIMAL / DEFAULT) is inferred
 *    from the asset label; refs whose label hints at style are sent as STYLE.
 *
 * Auth: Service Account JSON (GOOGLE_SERVICE_ACCOUNT_KEY) → OAuth2 Bearer token
 * via google-auth-library. Billed to GCP (uses the project's trial credits, not
 * AI Studio prepay).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleAuth } from 'google-auth-library';

declare const process: { env: Record<string, string | undefined> };

// Server-side only env names (no VITE_ prefix — those are opt-in for the client bundle).
const SB_URL      = () => process.env.SUPABASE_URL ?? '';
const SB_KEY      = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// Vertex AI config.
const GCP_PROJECT  = () => process.env.GOOGLE_CLOUD_PROJECT ?? '';
const GCP_LOCATION = () => process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1';
const IMAGEN_MODEL            = 'imagen-3.0-fast-generate-001';   // text-to-image (cheap, fast)
const IMAGEN_CAPABILITY_MODEL = 'imagen-3.0-capability-001';      // subject/style customization

// maxDuration is 60s (see `config` below). Leave ~5s headroom for token + JSON I/O.
const UPSTREAM_TIMEOUT_MS = 55_000;

// --- Auth ------------------------------------------------------------------
// Singleton GoogleAuth — reuses cached access tokens across warm invocations.
let _auth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (_auth) return _auth;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? '';
  if (!raw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY missing — paste the Service Account JSON into Vercel env vars.');
  }
  let credentials: any;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON. Paste the raw JSON of the SA key.');
  }
  _auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  return _auth;
}

async function getAccessToken(): Promise<string> {
  const client = await getAuth().getClient();
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse.token) throw new Error('Failed to obtain GCP access token from Service Account.');
  return tokenResponse.token;
}

// --- Supabase prompt-context loaders --------------------------------------

interface ExecuteRequest {
  brandId: string | null;
  stage: { labId: string; label: string; description: string; order: number };
  params: {
    canal?: string;
    psycho_preset?: string;
    aspect_ratio?: string;
    style_notes?: string;
    subject?: string;
    extra_instructions?: string;
  };
  previousOutputs: Record<string, string>;
}

async function sb<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SB_URL()}/rest/v1/${path}`, {
      headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? (data[0] ?? null) : data;
  } catch { return null; }
}

async function buildVisualPrompt(req: ExecuteRequest): Promise<string> {
  const brandId     = req.brandId ?? 'DEFAULT';
  const canal       = req.params.canal ?? 'instagram_feed';
  const psychoId    = req.params.psycho_preset;
  const aspectRatio = req.params.aspect_ratio ?? (canal.includes('reel') || canal === 'tiktok' ? '9:16' : '1:1');

  const [brand, preset, psychoPreset] = await Promise.all([
    sb<any>(`brands?id=eq.${brandId}&select=id,name,market,imagelab_style,imagelab_negative,imagelab_palette`),
    sb<any>(`imagelab_presets?brand_id=eq.${brandId}&canal=eq.${canal}&select=*`),
    psychoId ? sb<any>(`psycho_presets?id=eq.${psychoId}&select=*`) : null,
  ]);

  const globalPreset = !preset
    ? await sb<any>(`imagelab_presets?brand_id=eq.GLOBAL&canal=eq.${canal}&select=*`)
    : null;

  const activePreset = preset ?? globalPreset;
  const brandName = brand?.name ?? brandId;

  const parts: string[] = [];
  const subject = req.params.subject ?? req.stage.description ?? `producto de ${brandName}`;
  parts.push(subject);

  if (brand?.imagelab_style) parts.push(brand.imagelab_style);
  if (activePreset?.visual_style) parts.push(activePreset.visual_style);
  if (activePreset?.lighting) parts.push(`${activePreset.lighting} lighting`);
  if (activePreset?.mood) parts.push(`mood: ${activePreset.mood}`);
  if (brand?.imagelab_palette) parts.push(`color palette: ${brand.imagelab_palette}`);
  if (psychoPreset?.visual_injection) parts.push(psychoPreset.visual_injection);
  if (req.params.style_notes) parts.push(req.params.style_notes);

  const copyOutput = req.previousOutputs?.copylab ?? req.previousOutputs?.CopyLab ?? '';
  if (copyOutput) parts.push(`Visual must reinforce this copy theme: ${copyOutput.slice(0, 150)}`);

  parts.push('professional photography, high quality, 8k, sharp focus, commercial grade');

  const negativePrompt = brand?.imagelab_negative
    ?? 'blurry, low quality, amateur, stock photo look, watermark, text overlay, logo';

  return JSON.stringify({
    prompt: parts.filter(Boolean).join(', '),
    negative_prompt: negativePrompt,
    aspect_ratio: aspectRatio,
    brand: brandName,
    canal,
  });
}

// --- Vertex AI Imagen 3 ---------------------------------------------------

async function vertexPredictImagen(params: {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
}): Promise<string> {
  const project  = GCP_PROJECT();
  const location = GCP_LOCATION();
  if (!project) throw new Error('GOOGLE_CLOUD_PROJECT missing in env.');

  const token = await getAccessToken();
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${IMAGEN_MODEL}:predict`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: [{ prompt: params.prompt }],
        parameters: {
          sampleCount: 1,
          negativePrompt: params.negativePrompt,
          aspectRatio: params.aspectRatio ?? '1:1',
          // Vertex enum values are lowercase (AI Studio used UPPERCASE).
          safetyFilterLevel: 'block_only_high',
          personGeneration: 'allow_adult',
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Vertex Imagen error ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const pred = data.predictions?.[0];
    const b64  = pred?.bytesBase64Encoded;
    const mime = pred?.mimeType ?? 'image/png';
    if (!b64) throw new Error('Vertex Imagen: no image returned.');
    return `data:${mime};base64,${b64}`;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Vertex Imagen timeout after ${UPSTREAM_TIMEOUT_MS / 1000}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// Orchestrator path (brandId): builds a rich prompt then calls Vertex.
async function generateImage(promptJson: string): Promise<string> {
  const parsed = JSON.parse(promptJson);
  return vertexPredictImagen({
    prompt: parsed.prompt,
    negativePrompt: parsed.negative_prompt,
    aspectRatio: parsed.aspect_ratio,
  });
}

// Direct path (called from src/services/gemini.ts): raw prompt + aspect ratio.
interface DirectImageRequest {
  mode: 'direct';
  prompt: string;
  aspectRatio?: string;
  sourceAssetDataUrl?: string;
  sourceAssetLabel?: string;
  referenceImages?: { dataUrl: string; label?: string }[];
  model?: string; // accepted for compatibility; ignored on Vertex.
}

// --- Vertex AI Imagen 3 Capability (subject / style customization) -----

/** Strip the `data:image/...;base64,` header and return just the base64 payload. */
function dataUrlBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** Heuristic: map a free-form asset label to the closest Imagen subjectType. */
function inferSubjectType(label?: string): 'SUBJECT_TYPE_PERSON' | 'SUBJECT_TYPE_ANIMAL' | 'SUBJECT_TYPE_PRODUCT' | 'SUBJECT_TYPE_DEFAULT' {
  const l = (label ?? '').toLowerCase();
  if (/(person|people|man|woman|human|model|face|avatar|portrait|persona)/.test(l)) return 'SUBJECT_TYPE_PERSON';
  if (/(animal|dog|cat|pet|horse)/.test(l)) return 'SUBJECT_TYPE_ANIMAL';
  if (/(product|bottle|item|sku|packshot|object|merch|good)/.test(l)) return 'SUBJECT_TYPE_PRODUCT';
  return 'SUBJECT_TYPE_DEFAULT';
}

/** Is this reference image meant as a STYLE ref (not a subject)? */
function looksLikeStyleRef(label?: string): boolean {
  const l = (label ?? '').toLowerCase();
  return /(style|aesthetic|mood|look|grade|grading|reference|ref\b|palette|art\s*direction|inspiration)/.test(l);
}

interface CapabilityRef {
  referenceType: 'REFERENCE_TYPE_SUBJECT' | 'REFERENCE_TYPE_STYLE';
  referenceId: number;
  referenceImage: { bytesBase64Encoded: string };
  subjectImageConfig?: { subjectDescription: string; subjectType: string };
  styleImageConfig?: { styleDescription: string };
}

async function vertexPredictImagenCapability(params: {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  refs: CapabilityRef[];
}): Promise<string> {
  const project  = GCP_PROJECT();
  const location = GCP_LOCATION();
  if (!project) throw new Error('GOOGLE_CLOUD_PROJECT missing in env.');

  const token = await getAccessToken();
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${IMAGEN_CAPABILITY_MODEL}:predict`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: [{
          prompt: params.prompt,
          referenceImages: params.refs,
        }],
        parameters: {
          sampleCount: 1,
          negativePrompt: params.negativePrompt,
          aspectRatio: params.aspectRatio ?? '1:1',
          safetyFilterLevel: 'block_only_high',
          personGeneration: 'allow_adult',
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Vertex Imagen Capability error ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const pred = data.predictions?.[0];
    const b64  = pred?.bytesBase64Encoded;
    const mime = pred?.mimeType ?? 'image/png';
    if (!b64) throw new Error('Vertex Imagen Capability: no image returned.');
    return `data:${mime};base64,${b64}`;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Vertex Imagen Capability timeout after ${UPSTREAM_TIMEOUT_MS / 1000}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateImageDirect(req: DirectImageRequest): Promise<string> {
  const hasSource = !!req.sourceAssetDataUrl;
  const hasRefs   = Array.isArray(req.referenceImages) && req.referenceImages.length > 0;

  // No images → text-to-image fast path.
  if (!hasSource && !hasRefs) {
    return vertexPredictImagen({
      prompt: req.prompt,
      negativePrompt: 'blurry, low quality, amateur, watermark, text overlay, logo',
      aspectRatio: req.aspectRatio ?? '1:1',
    });
  }

  // Multimodal → Imagen 3 capability model with subject/style references.
  const refs: CapabilityRef[] = [];
  let nextId = 1;

  if (req.sourceAssetDataUrl) {
    const subjectType = inferSubjectType(req.sourceAssetLabel);
    const description = req.sourceAssetLabel?.trim() || 'main subject';
    refs.push({
      referenceType: 'REFERENCE_TYPE_SUBJECT',
      referenceId: nextId++,
      referenceImage: { bytesBase64Encoded: dataUrlBase64(req.sourceAssetDataUrl) },
      subjectImageConfig: { subjectDescription: description, subjectType },
    });
  }

  if (hasRefs) {
    for (const r of req.referenceImages!) {
      const id = nextId++;
      if (looksLikeStyleRef(r.label)) {
        refs.push({
          referenceType: 'REFERENCE_TYPE_STYLE',
          referenceId: id,
          referenceImage: { bytesBase64Encoded: dataUrlBase64(r.dataUrl) },
          styleImageConfig: { styleDescription: r.label?.trim() || 'reference style' },
        });
      } else {
        refs.push({
          referenceType: 'REFERENCE_TYPE_SUBJECT',
          referenceId: id,
          referenceImage: { bytesBase64Encoded: dataUrlBase64(r.dataUrl) },
          subjectImageConfig: {
            subjectDescription: r.label?.trim() || `subject ${id}`,
            subjectType: inferSubjectType(r.label),
          },
        });
      }
    }
  }

  // Imagen 3 expects [referenceId] tokens inline in the prompt to bind images
  // to their roles. Prepend a clause that names every subject ref, and append
  // a style clause if any style refs are present.
  const subjectIds = refs.filter(r => r.referenceType === 'REFERENCE_TYPE_SUBJECT').map(r => `[${r.referenceId}]`);
  const styleIds   = refs.filter(r => r.referenceType === 'REFERENCE_TYPE_STYLE').map(r => `[${r.referenceId}]`);

  let finalPrompt = req.prompt;
  if (subjectIds.length > 0) finalPrompt = `${subjectIds.join(' ')} ${finalPrompt}`;
  if (styleIds.length > 0)   finalPrompt = `${finalPrompt} in the style of ${styleIds.join(' ')}`;

  return vertexPredictImagenCapability({
    prompt: finalPrompt,
    negativePrompt: 'blurry, low quality, amateur, watermark, text overlay, logo',
    aspectRatio: req.aspectRatio ?? '1:1',
    refs,
  });
}

// --- HTTP handler ----------------------------------------------------------

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  let body: any;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? null);
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  if (body?.mode === 'direct') {
    try {
      if (!body.prompt || typeof body.prompt !== 'string') {
        res.status(400).json({ error: 'prompt is required for direct mode' });
        return;
      }
      const imageDataUrl = await generateImageDirect(body as DirectImageRequest);
      res.status(200).json({ image_data_url: imageDataUrl, status: 'ok' });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg, status: 'error' });
      return;
    }
  }

  if (!body.brandId) { res.status(400).json({ error: 'brandId is required' }); return; }

  try {
    const promptJson   = await buildVisualPrompt(body as ExecuteRequest);
    const imageDataUrl = await generateImage(promptJson);
    const promptParsed = JSON.parse(promptJson);

    res.status(200).json({
      output: `[IMAGE_GENERATED]\nPrompt: ${promptParsed.prompt}\nAspect: ${promptParsed.aspect_ratio}\nCanal: ${promptParsed.canal}`,
      image_data_url: imageDataUrl,
      status: 'ok',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg, status: 'error' });
  }
}
