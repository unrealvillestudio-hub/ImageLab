/**
 * ImageLab — POST /api/removebg
 * Server-side proxy to remove.bg. The API key (REMOVEBG_API_KEY) lives only in
 * process.env and never reaches the browser.
 *
 * Input:  { image_data_url: "data:image/...;base64,...", preview?: boolean }
 *           preview=true  -> size=preview (FREE, low-res, for framing)        [default]
 *           preview=false -> size=auto    (1 credit, full-res, on confirm)
 * Output: { image_data_url: "data:image/png;base64,...", credits_charged: number }
 *
 * remove.bg returns the cutout as a binary PNG (alpha) and the cost in the
 * X-Credits-Charged response header. On error it returns a JSON body we relay
 * with a clear message (402 = out of credits, 400 = invalid image).
 *
 * Belongs to the ProductShots submodule (deterministic, no AI model).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

declare const process: { env: Record<string, string | undefined> };
declare const Buffer: { from(data: ArrayBuffer | string, enc?: string): { toString(enc: string): string } };

const REMOVEBG_ENDPOINT = 'https://api.remove.bg/v1.0/removebg';
const REMOVEBG_KEY = () => process.env.REMOVEBG_API_KEY ?? '';

// Match execute.ts: ~5s headroom under maxDuration 60s.
const UPSTREAM_TIMEOUT_MS = 55_000;

interface RemoveBgRequest {
  image_data_url?: string;
  preview?: boolean;
}

// Split a data URL into its base64 payload (without the "data:...;base64," prefix).
function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

async function callRemoveBg(imageB64: string, preview: boolean): Promise<{
  imageDataUrl: string;
  creditsCharged: number;
}> {
  const key = REMOVEBG_KEY();
  if (!key) {
    throw Object.assign(new Error('REMOVEBG_API_KEY missing — set it in Vercel env vars.'), { status: 500 });
  }

  const form = new FormData();
  form.append('image_file_b64', imageB64);
  form.append('size', preview ? 'preview' : 'auto');
  form.append('format', 'png');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(REMOVEBG_ENDPOINT, {
      method: 'POST',
      headers: { 'X-Api-Key': key },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw Object.assign(
      new Error(aborted ? 'remove.bg timed out.' : `remove.bg request failed: ${err instanceof Error ? err.message : String(err)}`),
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    // remove.bg returns a JSON error body: { errors: [{ title, detail }] }
    let detail = '';
    try {
      const j: any = await resp.json();
      detail = j?.errors?.[0]?.detail || j?.errors?.[0]?.title || '';
    } catch {
      detail = await resp.text().catch(() => '');
    }
    if (resp.status === 402) detail = detail || 'No remove.bg credits remaining.';
    if (resp.status === 400) detail = detail || 'Invalid image for remove.bg.';
    throw Object.assign(new Error(detail || `remove.bg error ${resp.status}`), { status: resp.status });
  }

  const creditsHeader = resp.headers.get('X-Credits-Charged');
  const creditsCharged = creditsHeader ? Number(creditsHeader) : 0;

  const buf = await resp.arrayBuffer();
  const b64 = Buffer.from(buf).toString('base64');
  return {
    imageDataUrl: `data:image/png;base64,${b64}`,
    creditsCharged: Number.isFinite(creditsCharged) ? creditsCharged : 0,
  };
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

  let body: RemoveBgRequest;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? null);
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }
  if (!body || typeof body !== 'object' || !body.image_data_url) {
    res.status(400).json({ error: 'image_data_url is required' });
    return;
  }

  // Default to the FREE preview size so we never burn a credit by accident.
  const preview = body.preview !== false;

  try {
    const imageB64 = stripDataUrl(body.image_data_url);
    const result = await callRemoveBg(imageB64, preview);
    res.status(200).json({
      image_data_url: result.imageDataUrl,
      credits_charged: result.creditsCharged,
      status: 'ok',
    });
  } catch (err) {
    const status = (err as any)?.status ?? 500;
    const msg = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: msg, status: 'error' });
  }
}
