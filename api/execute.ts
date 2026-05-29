/**
 * ImageLab — POST /api/execute
 * v6 — Imagelab_presets injection (per-brand visual identity).
 *
 * Routing:
 *  - Orchestrator path (brandId + stage): looks up imagelab_presets by
 *    brand_id+canal; if found, assembles the brand-specific prompt format
 *    (reference_aesthetic + composition + lighting + grading + mood +
 *    concept + brand DNA + texture + FORBIDDEN); else falls back to the
 *    legacy generic prompt. Always calls imagen-3.0-fast-generate-001.
 *  - Direct mode (text-only): same preset lookup if body carries brand_id+
 *    canal; otherwise raw prompt path. imagen-3.0-fast-generate-001.
 *  - Direct mode (multimodal): preset prompt + REFERENCE_TYPE_SUBJECT/STYLE
 *    bindings via imagen-3.0-capability-001.
 *
 * Auth: Service Account JSON (GOOGLE_SERVICE_ACCOUNT_KEY) → OAuth2 Bearer token
 * via google-auth-library. Billed to GCP (uses the project's trial credits, not
 * AI Studio prepay).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleAuth } from 'google-auth-library';

declare const process: { env: Record<string, string | undefined> };

// Server-side only env names (no VITE_ prefix — those are opt-in for the client bundle).
// Normalize SUPABASE_URL: tolerate three common shapes that get pasted into
// the Vercel env panel by accident.
//   1) bare project ref     "amlvyycfepwhiindxgzw"
//   2) bare hostname        "amlvyycfepwhiindxgzw.supabase.co"
//   3) full url             "https://amlvyycfepwhiindxgzw.supabase.co"
// All three end up as `https://{ref}.supabase.co`.
function normalizeSupabaseUrl(raw: string): string {
  let v = raw.trim().replace(/\/+$/, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) {
    if (!v.includes('.')) v = `${v}.supabase.co`;
    v = `https://${v}`;
  }
  return v;
}
const SB_URL      = () => normalizeSupabaseUrl(process.env.SUPABASE_URL ?? '');
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
  const rawUrl = process.env.SUPABASE_URL ?? '';
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const normalized = SB_URL();
  console.log(`[sb v6.3] env_raw_url_len=${rawUrl.length} normalized_url=${JSON.stringify(normalized)} key_len=${rawKey.length}`);
  try {
    const url = `${normalized}/rest/v1/${path}`;
    console.log(`[sb v6.3] fetching ${url}`);
    const res = await fetch(url, {
      headers: { apikey: rawKey, Authorization: `Bearer ${rawKey}` },
    });
    const body = await res.text();
    console.log(`[sb v6.3] status=${res.status} body_head=${body.slice(0, 150)}`);
    if (!res.ok) return null;
    let data: any;
    try { data = JSON.parse(body); } catch { return null; }
    return Array.isArray(data) ? (data[0] ?? null) : data;
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}|${err.message}|${(err as any).cause?.code ?? ''}` : String(err);
    console.error(`[sb v6.3] exception ${msg}`);
    return null;
  }
}

// --- Imagelab presets (per-brand visual identity) ------------------------

interface ImageGenInput {
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
  brandName: string;
  canal: string;
  presetUsed: boolean;
  presetId: string | null;
}

const FALLBACK_NEGATIVE = 'blurry, low quality, amateur, stock photo look, watermark, text overlay, logo';

/** Load the imagelab_presets row for (brand_id, canal). Returns null if none. */
async function loadImagelabPreset(brandId: string, canal: string): Promise<any | null> {
  if (!brandId || !canal) return null;
  const b = encodeURIComponent(brandId);
  const c = encodeURIComponent(canal);
  const row = await sb<any>(`imagelab_presets?brand_id=eq.${b}&canal=eq.${c}&select=*&limit=1`);
  return row ?? null;
}

/**
 * Assemble the preset-driven prompt per the spec:
 *   "{reference_aesthetic} aesthetic. {composition_rule}. {lighting_style}.
 *    {color_grading}. Mood: {mood}. Concept: {job_prompt}.
 *    Brand DNA: {brand_dna}. {texture}.
 *    Photorealistic, 8K, large format cinema. FORBIDDEN: {negative_prompt}."
 */
function buildPromptFromPreset(preset: any, conceptText: string, aspectRatioFallback?: string): ImageGenInput {
  const ep = (preset?.extra_params ?? {}) as Record<string, any>;

  const moodList = Array.isArray(ep.mood) ? ep.mood.join(', ')
    : (typeof ep.mood === 'string' ? ep.mood : '');
  const forbiddenList = Array.isArray(ep.forbidden_elements) ? ep.forbidden_elements.join(', ')
    : (typeof ep.forbidden_elements === 'string' ? ep.forbidden_elements : '');

  const negParts: string[] = [];
  if (forbiddenList)            negParts.push(forbiddenList);
  if (preset?.negative_prompt)  negParts.push(preset.negative_prompt);
  const negativePrompt = negParts.filter(Boolean).join(', ') || FALLBACK_NEGATIVE;

  const parts: string[] = [];
  if (ep.reference_aesthetic) parts.push(`${ep.reference_aesthetic} aesthetic.`);
  if (ep.composition_rule)    parts.push(`${ep.composition_rule}.`);
  if (preset?.lighting_style) parts.push(`${preset.lighting_style}.`);
  if (preset?.color_grading)  parts.push(`${preset.color_grading}.`);
  if (moodList)               parts.push(`Mood: ${moodList}.`);
  if (conceptText)            parts.push(`Concept: ${conceptText}.`);
  if (ep.brand_dna)           parts.push(`Brand DNA: ${ep.brand_dna}.`);
  if (ep.texture)             parts.push(`${ep.texture}.`);
  parts.push('Photorealistic, 8K, large format cinema.');
  if (negativePrompt)         parts.push(`FORBIDDEN: ${negativePrompt}.`);

  return {
    prompt: parts.join(' '),
    negativePrompt,
    aspectRatio: preset?.aspect_ratio ?? aspectRatioFallback ?? '1:1',
    brandName: preset?.brand_id ?? 'unknown',
    canal: preset?.canal ?? 'INSTAGRAM_FEED',
    presetUsed: true,
    presetId: (preset?.preset_id as string) ?? null,
  };
}

/**
 * Orchestrator-path prompt builder.
 *
 * 1. Normalize canal to UPPERCASE (matches imagelab_presets.canal convention).
 * 2. Try to load preset for (brand_id, canal). If found → preset-driven prompt.
 * 3. Else fall back to the legacy generic builder (preserves prior behavior).
 */
async function buildVisualPrompt(req: ExecuteRequest): Promise<ImageGenInput> {
  const brandId     = req.brandId ?? 'DEFAULT';
  const canal       = (req.params.canal ?? 'INSTAGRAM_FEED').toUpperCase();
  const psychoId    = req.params.psycho_preset;
  const aspectRatio = req.params.aspect_ratio ?? (canal.includes('REEL') || canal === 'TIKTOK' ? '9:16' : '1:1');

  // Concept text: same heuristic the legacy path used (subject → stage description → fallback).
  const copyOutput = req.previousOutputs?.copylab ?? req.previousOutputs?.CopyLab ?? '';
  const conceptText = (req.params.subject ?? req.stage.description ?? '').trim();

  // ── Preset injection (v6) ────────────────────────────────────────────
  const preset = await loadImagelabPreset(brandId, canal);
  if (preset) {
    const built = buildPromptFromPreset(preset, conceptText, aspectRatio);
    return {
      ...built,
      brandName: brandId,
      canal,
    };
  }

  console.log(`[ImageLab v6] No preset found for brand_id=${brandId} canal=${canal}, using raw prompt`);

  // ── Legacy generic builder (no preset) ───────────────────────────────
  const [brand, psychoPreset] = await Promise.all([
    sb<any>(`brands?id=eq.${encodeURIComponent(brandId)}&select=id,name,market,imagelab_style,imagelab_negative,imagelab_palette`),
    psychoId ? sb<any>(`psycho_presets?id=eq.${encodeURIComponent(psychoId)}&select=*`) : null,
  ]);

  const brandName = brand?.name ?? brandId;
  const subject = conceptText || `producto de ${brandName}`;

  const parts: string[] = [subject];
  if (brand?.imagelab_style) parts.push(brand.imagelab_style);
  if (brand?.imagelab_palette) parts.push(`color palette: ${brand.imagelab_palette}`);
  if (psychoPreset?.visual_injection) parts.push(psychoPreset.visual_injection);
  if (req.params.style_notes) parts.push(req.params.style_notes);
  if (copyOutput) parts.push(`Visual must reinforce this copy theme: ${copyOutput.slice(0, 150)}`);
  parts.push('professional photography, high quality, 8k, sharp focus, commercial grade');

  const negativePrompt = brand?.imagelab_negative ?? FALLBACK_NEGATIVE;

  return {
    prompt: parts.filter(Boolean).join(', '),
    negativePrompt,
    aspectRatio,
    brandName,
    canal,
    presetUsed: false,
    presetId: null,
  };
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

// Direct path (called from src/services/gemini.ts or directly by callers
// that pass brand_id + canal to opt into preset injection).
interface DirectImageRequest {
  mode: 'direct';
  prompt: string;
  aspectRatio?: string;
  brand_id?: string;   // v6: opt into imagelab_presets injection
  canal?: string;      // v6: opt into imagelab_presets injection (case-insensitive)
  sourceAssetDataUrl?: string;
  sourceAssetLabel?: string;
  referenceImages?: { dataUrl: string; label?: string }[];
  model?: string;      // accepted for compatibility; ignored on Vertex.
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

interface DirectImageResult {
  image_data_url: string;
  preset_used: boolean;
  preset_id: string | null;
}

async function generateImageDirect(req: DirectImageRequest): Promise<DirectImageResult> {
  const hasSource = !!req.sourceAssetDataUrl;
  const hasRefs   = Array.isArray(req.referenceImages) && req.referenceImages.length > 0;

  // v6: optional preset injection — only when brand_id + canal are both provided.
  let basePrompt = req.prompt;
  let negativePrompt = FALLBACK_NEGATIVE;
  let aspectRatio = req.aspectRatio ?? '1:1';
  let presetUsed = false;
  let presetId: string | null = null;

  if (req.brand_id && req.canal) {
    const canal = req.canal.toUpperCase();
    const preset = await loadImagelabPreset(req.brand_id, canal);
    if (preset) {
      const built = buildPromptFromPreset(preset, req.prompt, aspectRatio);
      basePrompt     = built.prompt;
      negativePrompt = built.negativePrompt;
      aspectRatio    = built.aspectRatio;
      presetUsed     = true;
      presetId       = built.presetId;
    } else {
      console.log(`[ImageLab v6] No preset found for brand_id=${req.brand_id} canal=${canal}, using raw prompt`);
    }
  }

  // No images → text-to-image fast path.
  if (!hasSource && !hasRefs) {
    const dataUrl = await vertexPredictImagen({
      prompt: basePrompt,
      negativePrompt,
      aspectRatio,
    });
    return { image_data_url: dataUrl, preset_used: presetUsed, preset_id: presetId };
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

  let finalPrompt = basePrompt;
  if (subjectIds.length > 0) finalPrompt = `${subjectIds.join(' ')} ${finalPrompt}`;
  if (styleIds.length > 0)   finalPrompt = `${finalPrompt} in the style of ${styleIds.join(' ')}`;

  const dataUrl = await vertexPredictImagenCapability({
    prompt: finalPrompt,
    negativePrompt,
    aspectRatio,
    refs,
  });
  return { image_data_url: dataUrl, preset_used: presetUsed, preset_id: presetId };
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
      const result = await generateImageDirect(body as DirectImageRequest);
      res.status(200).json({
        image_data_url: result.image_data_url,
        preset_used:    result.preset_used,
        preset_id:      result.preset_id,
        status:         'ok',
      });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg, status: 'error' });
      return;
    }
  }

  if (!body.brandId) { res.status(400).json({ error: 'brandId is required' }); return; }

  try {
    // v6.3 diagnostic: surface env shape directly in response for debugging.
    const _rawUrl = process.env.SUPABASE_URL ?? '';
    const _diag = {
      raw_url_len: _rawUrl.length,
      raw_url_head: _rawUrl.slice(0, 30),
      raw_url_tail: _rawUrl.slice(-10),
      normalized_url: SB_URL(),
      key_len: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').length,
    };
    const built = await buildVisualPrompt(body as ExecuteRequest);
    const imageDataUrl = await vertexPredictImagen({
      prompt:         built.prompt,
      negativePrompt: built.negativePrompt,
      aspectRatio:    built.aspectRatio,
    });

    res.status(200).json({
      output: `[IMAGE_GENERATED]\nPreset: ${built.presetId ?? '(none)'} (used=${built.presetUsed})\nAspect: ${built.aspectRatio}\nCanal: ${built.canal}`,
      image_data_url: imageDataUrl,
      preset_used:    built.presetUsed,
      preset_id:      built.presetId,
      brand:          built.brandName,
      canal:          built.canal,
      status:         'ok',
      _debug_env:     _diag,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg, status: 'error' });
  }
}
