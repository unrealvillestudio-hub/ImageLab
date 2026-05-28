/**
 * ImageLab — POST /api/execute
 * v4 — Vertex AI (uses GCP billing / $300 trial), Service Account auth.
 *
 * Migration notes vs v3:
 *  - Auth: GEMINI_API_KEY query param → Bearer OAuth2 token from Service Account.
 *  - Endpoint: generativelanguage.googleapis.com → {region}-aiplatform.googleapis.com.
 *  - Billing: AI Studio prepay → GCP billing (consumes the project's trial credits).
 *  - Multimodal direct mode (source / reference images via gemini-2.5-flash-image)
 *    is NOT YET implemented on Vertex. Text-only direct prompts work; multimodal
 *    requests return a clear 400 instead of silently failing.
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
const IMAGEN_MODEL = 'imagen-3.0-fast-generate-001';

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
  referenceImages?: { dataUrl: string; label?: string }[];
  model?: string; // accepted for compatibility; ignored on Vertex (always Imagen 3 fast).
}

async function generateImageDirect(req: DirectImageRequest): Promise<string> {
  const hasMultimodal = !!req.sourceAssetDataUrl
    || (Array.isArray(req.referenceImages) && req.referenceImages.length > 0);
  if (hasMultimodal) {
    throw new Error(
      'Multimodal generation (source / reference images) is not yet wired on the Vertex backend. '
      + 'Send a text-only prompt for now, or revert to the AI Studio gemini-2.5-flash-image path.'
    );
  }
  return vertexPredictImagen({
    prompt: req.prompt,
    negativePrompt: 'blurry, low quality, amateur, watermark, text overlay, logo',
    aspectRatio: req.aspectRatio ?? '1:1',
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
