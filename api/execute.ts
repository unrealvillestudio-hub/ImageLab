/**
 * ImageLab — POST /api/execute
 * Endpoint para integración con Orchestrator UNRLVL.
 *
 * Acepta { brandId, stage, params, previousOutputs }
 * → Carga imagelab_presets + psycho_presets desde Supabase
 * → Construye prompt visual con Gemini 2.5 Flash (multimodal)
 * → Llama a Google Imagen 3 para generar la imagen
 * → Devuelve { output: base64DataURL, status: 'ok' }
 *
 * NOTA: Timeout ~30s — configurar maxDuration = 60 en vercel.json si necesario.
 *
 * Env vars: GEMINI_API_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 */

declare const process: { env: Record<string, string | undefined> };

const SB_URL      = () => process.env.VITE_SUPABASE_URL ?? '';
const SB_KEY      = () => process.env.VITE_SUPABASE_ANON_KEY ?? '';
const GEMINI_KEY  = () => process.env.GEMINI_API_KEY ?? process.env.VITE_GEMINI_API_KEY ?? '';

const IMAGEN_MODEL  = 'imagen-3.0-generate-002';
const GEMINI_MODEL  = 'gemini-2.5-flash-preview-04-17';

// ── TYPES ─────────────────────────────────────────────────────────────────────

interface ExecuteRequest {
  brandId: string | null;
  stage: { labId: string; label: string; description: string; order: number };
  params: {
    canal?: string;          // instagram_feed | instagram_reels | facebook | tiktok | youtube | landing
    psycho_preset?: string;  // PSY-URGENCY | PSY-SCARCITY | etc.
    aspect_ratio?: string;   // 1:1 | 9:16 | 16:9
    style_notes?: string;    // notas de estilo adicionales
    subject?: string;        // descripción del sujeto principal
    extra_instructions?: string;
  };
  previousOutputs: Record<string, string>;
}

// ── SUPABASE HELPERS ───────────────────────────────────────────────────────────

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

// ── BUILD VISUAL PROMPT ────────────────────────────────────────────────────────

async function buildVisualPrompt(req: ExecuteRequest): Promise<string> {
  const brandId     = req.brandId ?? 'DEFAULT';
  const canal       = req.params.canal ?? 'instagram_feed';
  const psychoId    = req.params.psycho_preset;
  const aspectRatio = req.params.aspect_ratio ?? (canal.includes('reel') || canal === 'tiktok' ? '9:16' : '1:1');

  const [brand, preset, psychoPreset] = await Promise.all([
    sb<any>(`brands?id=eq.${brandId}&select=id,name,market,imagelab_style,imagelab_negative,imagelab_palette`),
    sb<any>(`imagelab_presets?brand_id=eq.${brandId}&canal=eq.${canal}&select=*`),
    psychoId
      ? sb<any>(`psycho_presets?id=eq.${psychoId}&select=*`)
      : null,
  ]);

  // Fallback al preset GLOBAL si no hay preset específico de marca
  const globalPreset = !preset
    ? await sb<any>(`imagelab_presets?brand_id=eq.GLOBAL&canal=eq.${canal}&select=*`)
    : null;

  const activePreset = preset ?? globalPreset;
  const brandName = brand?.name ?? brandId;

  // Construir prompt visual
  const parts: string[] = [];

  // Sujeto
  const subject = req.params.subject ?? req.stage.description ?? `producto de ${brandName}`;
  parts.push(subject);

  // Estilo de marca
  if (brand?.imagelab_style) parts.push(brand.imagelab_style);
  if (activePreset?.visual_style) parts.push(activePreset.visual_style);
  if (activePreset?.lighting) parts.push(`${activePreset.lighting} lighting`);
  if (activePreset?.mood) parts.push(`mood: ${activePreset.mood}`);
  if (brand?.imagelab_palette) parts.push(`color palette: ${brand.imagelab_palette}`);

  // Psycho Layer
  if (psychoPreset?.visual_injection) parts.push(psychoPreset.visual_injection);

  // Notas de estilo adicionales
  if (req.params.style_notes) parts.push(req.params.style_notes);

  // Copy de CopyLab como contexto visual
  const copyOutput = req.previousOutputs?.copylab ?? req.previousOutputs?.CopyLab ?? '';
  if (copyOutput) {
    parts.push(`Visual must reinforce this copy theme: ${copyOutput.slice(0, 150)}`);
  }

  // Quality tags
  parts.push('professional photography, high quality, 8k, sharp focus, commercial grade');

  const negativePrompt = brand?.imagelab_negative
    ?? 'blurry, low quality, amateur, stock photo look, watermark, text overlay, logo';

  const promptText = parts.filter(Boolean).join(', ');

  return JSON.stringify({
    prompt: promptText,
    negative_prompt: negativePrompt,
    aspect_ratio: aspectRatio,
    brand: brandName,
    canal,
  });
}

// ── GEMINI IMAGEN 3 CALL ───────────────────────────────────────────────────────

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

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Imagen 3 API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error('Imagen 3: no image returned');

  // Retorna como data URL para que el Orchestrator pueda mostrarla
  return `data:image/jpeg;base64,${b64}`;
}

// ── HANDLER ───────────────────────────────────────────────────────────────────

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': 'https://orchestrator.vercel.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed', status: 'error' }), { status: 405, headers: CORS });

  let body: ExecuteRequest;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON', status: 'error' }), { status: 400, headers: CORS }); }

  if (!body.brandId) {
    return new Response(JSON.stringify({ error: 'brandId is required', status: 'error' }), { status: 400, headers: CORS });
  }

  try {
    const promptJson = await buildVisualPrompt(body);
    const imageDataUrl = await generateImage(promptJson);

    // El output incluye el prompt usado (para debugging) + señal de que hay imagen
    const promptParsed = JSON.parse(promptJson);
    const output = `[IMAGE_GENERATED]\nPrompt: ${promptParsed.prompt}\nAspect: ${promptParsed.aspect_ratio}\nCanal: ${promptParsed.canal}\ndata_url_length: ${imageDataUrl.length} chars`;

    return new Response(JSON.stringify({
      output,
      image_data_url: imageDataUrl,  // campo extra para el Orchestrator UI
      status: 'ok',
    }), { status: 200, headers: CORS });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ImageLab /api/execute]', msg);
    return new Response(JSON.stringify({ error: msg, status: 'error' }), { status: 500, headers: CORS });
  }
}
