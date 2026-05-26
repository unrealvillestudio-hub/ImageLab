/**
 * ImageLab — POST /api/execute
 * v2 — CORS fix: Access-Control-Allow-Origin *
 */

declare const process: { env: Record<string, string | undefined> };

const SB_URL      = () => process.env.VITE_SUPABASE_URL ?? '';
const SB_KEY      = () => process.env.VITE_SUPABASE_ANON_KEY ?? '';
const GEMINI_KEY  = () => process.env.GEMINI_API_KEY ?? process.env.VITE_GEMINI_API_KEY ?? '';

const IMAGEN_MODEL  = 'imagen-3.0-generate-002';

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

async function generateImage(promptJson: string): Promise<string> {
  const parsed = JSON.parse(promptJson);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:predict?key=${GEMINI_KEY()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: parsed.prompt }],
        parameters: {
          sampleCount: 1,
          negativePrompt: parsed.negative_prompt,
          aspectRatio: parsed.aspect_ratio,
          safetyFilterLevel: 'BLOCK_ONLY_HIGH',
          personGeneration: 'ALLOW_ADULT',
        },
      }),
    }
  );

  if (!res.ok) throw new Error(`Imagen 3 API error ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error('Imagen 3: no image returned');
  return `data:image/jpeg;base64,${b64}`;
}

// CORS fix: era 'https://orchestrator.vercel.app'
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

  let body: ExecuteRequest;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }

  if (!body.brandId) return new Response(JSON.stringify({ error: 'brandId is required' }), { status: 400, headers: CORS });

  try {
    const promptJson   = await buildVisualPrompt(body);
    const imageDataUrl = await generateImage(promptJson);
    const promptParsed = JSON.parse(promptJson);

    return new Response(JSON.stringify({
      output: `[IMAGE_GENERATED]\nPrompt: ${promptParsed.prompt}\nAspect: ${promptParsed.aspect_ratio}\nCanal: ${promptParsed.canal}`,
      image_data_url: imageDataUrl,
      status: 'ok',
    }), { status: 200, headers: CORS });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg, status: 'error' }), { status: 500, headers: CORS });
  }
}
