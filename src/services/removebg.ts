/**
 * BGRemover — remove.bg client.
 * Mirrors services/gemini.ts: a thin fetch wrapper over the server-side proxy
 * at /api/removebg. No state, no global store. The API key stays server-side.
 */

export async function removeBg(params: {
  imageDataUrl: string;
  preview: boolean; // true = FREE low-res (framing); false = 1 credit full-res
  signal?: AbortSignal;
}): Promise<{ imageDataUrl: string; creditsCharged: number }> {
  if (params.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const res = await fetch('/api/removebg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_data_url: params.imageDataUrl,
      preview: params.preview,
    }),
    signal: params.signal,
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error ?? ''; } catch { detail = await res.text().catch(() => ''); }
    throw new Error(`remove.bg error ${res.status}: ${detail}`);
  }

  const data = await res.json();
  if (!data?.image_data_url) throw new Error('No image data returned from remove.bg.');
  return {
    imageDataUrl: data.image_data_url as string,
    creditsCharged: Number(data.credits_charged) || 0,
  };
}
