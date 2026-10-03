/**
 * ImageLab — POST /api/encode
 * v1 (2026-10-03) — CODIFICADOR WebP del paquete de alt (Sam: «Paquete Alt, aprobado como sugieres
 * que sea el full pack»).
 *
 * Recibe la URL https de una imagen YA GENERADA (PNG, JPEG o WebP) y la devuelve codificada en WebP,
 * con su ancho y su alto reales. Lo llama `content-run-stage` (Edge Function de Supabase, otro repo)
 * cuando una imagen dentro del artículo queda aceptada, antes de guardarla en la zona permanente.
 *
 * POR QUÉ AQUÍ Y NO EN EL CARRIL. Medido el 2026-10-03: ningún repositorio del carril tiene un
 * codificador WebP. El carril corre en Deno (Supabase Edge), donde un módulo nativo no carga; ImageLab
 * corre en Node (Vercel), donde `sharp` es la librería de imagen estándar y se instala sola por
 * plataforma. Y ImageLab ya es quien sabe de imágenes (`/api/inspect` mide sus bandas de borde).
 *
 * REGLA MULTIMARCA. Este archivo es EJE: sabe codificar una imagen, no sabe de quién es. No recibe
 * marca, no decide calidad por marca y no escribe en ningún almacenamiento: devuelve los bytes y el
 * carril decide dónde guardarlos.
 *
 * Contrato:
 *   POST { image_url, format?: 'webp', quality?: 1..100 }
 *   200  { ok: true, format: 'webp', mime: 'image/webp', data_base64, width, height, bytes,
 *          quality, source: { mime, bytes, width, height } }
 *   4xx/5xx { ok: false, error, error_label, status: 'error' }
 *
 * Sin proveedor de pago: no hay `usage` que asentar. Sin cabecera ni secreto de entrada, igual que
 * `/api/inspect` (ningún endpoint de este repo lo exige hoy).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import sharp from 'sharp';

// La descarga y la codificación de una imagen de ~1-2 MB caben de sobra en este presupuesto.
export const config = { maxDuration: 30 };
const IMAGE_FETCH_TIMEOUT_MS = 15_000;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── ENCODE:BEGIN ── (2026-10-03) bloque PURO: qué se pide y cómo se valida. Sin red, sin sharp. Lo
// extrae `tests/codificacion_webp_test.mjs` por estos sentinelas.
//
// El formato de salida es un EJE del sistema (qué sabe producir este codificador), no un dato de
// marca: hoy sólo WebP. Un formato desconocido falla en voz alta, nunca cae a otro en silencio.
export const ENCODE_FORMATS = ['webp'] as const;
export type EncodeFormat = typeof ENCODE_FORMATS[number];
// Calidad por defecto. Quien llama puede pedir otra (1..100); fuera de rango es un 400, no un recorte.
export const ENCODE_QUALITY_DEFAULT = 82;
// Tope de la imagen descargada: el mismo que `/api/inspect`.
export const ENCODE_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Tope de píxeles que se decodifican. Una imagen del carril ronda 1-2 Mpx; esto corta un archivo
// patológico antes de que se coma la memoria de la función.
export const ENCODE_MAX_PIXELS = 40_000_000;

export class EncodeError extends Error {
  label: string; status: number;
  constructor(label: string, message: string, status: number) {
    super(message); this.label = label; this.status = status;
  }
}

export interface EncodeRequest { image_url: string; format: EncodeFormat; quality: number }

/** Valida el cuerpo. Lanza `EncodeError` 400 con etiqueta: nunca adivina lo que no llegó. */
export function validateEncodeRequest(body: unknown): EncodeRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new EncodeError('ENCODE_BAD_REQUEST', 'el cuerpo debe ser un objeto { image_url, format?, quality? }', 400);
  }
  const b = body as Record<string, unknown>;
  const url = typeof b.image_url === 'string' ? b.image_url.trim() : '';
  let valida = false;
  try { valida = /^https:\/\//i.test(url) && !!new URL(url).hostname; } catch { valida = false; }
  if (!valida) throw new EncodeError('ENCODE_BAD_REQUEST', 'image_url debe ser una URL https', 400);
  const fmt = b.format === undefined || b.format === null || b.format === '' ? 'webp' : String(b.format).trim().toLowerCase();
  if (!(ENCODE_FORMATS as readonly string[]).includes(fmt)) {
    throw new EncodeError('ENCODE_FORMAT_UNSUPPORTED', `format '${fmt}' no es uno de: ${ENCODE_FORMATS.join(', ')}`, 400);
  }
  let quality = ENCODE_QUALITY_DEFAULT;
  if (b.quality !== undefined && b.quality !== null && b.quality !== '') {
    const q = Number(b.quality);
    if (!Number.isInteger(q) || q < 1 || q > 100) throw new EncodeError('ENCODE_BAD_REQUEST', 'quality debe ser un entero 1..100', 400);
    quality = q;
  }
  return { image_url: url, format: fmt as EncodeFormat, quality };
}

/** El tipo real de la imagen por su firma de bytes. Sólo lo que este codificador lee; lo demás, null. */
export function sniffEncodableMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

/** Ancho y alto válidos (enteros positivos dentro del tope de píxeles), o el error que lo dice. */
export function checkDimensions(width: unknown, height: unknown): { width: number; height: number } {
  const w = Number(width), h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    throw new EncodeError('ENCODE_IMAGE_UNDECODABLE', `dimensiones ilegibles (${String(width)}x${String(height)})`, 422);
  }
  if (w * h > ENCODE_MAX_PIXELS) throw new EncodeError('ENCODE_IMAGE_TOO_LARGE', `${w}x${h} supera ${ENCODE_MAX_PIXELS} píxeles`, 422);
  return { width: w, height: h };
}
// ── ENCODE:END ──

async function fetchImage(url: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new EncodeError('ENCODE_IMAGE_FETCH_FAILED', `GET ${url.slice(0, 160)} → ${res.status}`, 502);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0) throw new EncodeError('ENCODE_IMAGE_FETCH_FAILED', `GET ${url.slice(0, 160)} devolvió un cuerpo vacío`, 502);
    if (bytes.length > ENCODE_MAX_IMAGE_BYTES) {
      throw new EncodeError('ENCODE_IMAGE_TOO_LARGE', `la imagen pesa ${bytes.length} bytes (tope ${ENCODE_MAX_IMAGE_BYTES})`, 422);
    }
    return bytes;
  } catch (err) {
    if (err instanceof EncodeError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new EncodeError('ENCODE_IMAGE_FETCH_TIMEOUT', `la descarga superó ${IMAGE_FETCH_TIMEOUT_MS / 1000} s`, 504);
    }
    throw new EncodeError('ENCODE_IMAGE_FETCH_FAILED', err instanceof Error ? err.message : String(err), 502);
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Method not allowed', error_label: 'METHOD_NOT_ALLOWED', status: 'error' }); return; }
  try {
    let body: unknown;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? null);
    } catch {
      throw new EncodeError('ENCODE_BAD_REQUEST', 'Invalid JSON', 400);
    }
    const input = validateEncodeRequest(body);
    const bytes = await fetchImage(input.image_url);
    const mime = sniffEncodableMime(bytes);
    if (!mime) throw new EncodeError('ENCODE_IMAGE_UNSUPPORTED', 'el recurso no es png, jpeg ni webp', 422);

    let fuente: { width: number; height: number };
    let salida: { data: Buffer; info: { width: number; height: number; size: number } };
    try {
      const meta = await sharp(bytes, { limitInputPixels: ENCODE_MAX_PIXELS }).metadata();
      fuente = checkDimensions(meta.width, meta.height);
      // `rotate()` sin argumentos aplica la orientación EXIF y la descarta: el ancho y el alto que se
      // devuelven son los que el navegador va a pintar.
      salida = await sharp(bytes, { limitInputPixels: ENCODE_MAX_PIXELS }).rotate()
        .webp({ quality: input.quality }).toBuffer({ resolveWithObject: true });
    } catch (err) {
      if (err instanceof EncodeError) throw err;
      throw new EncodeError('ENCODE_FAILED', err instanceof Error ? err.message : String(err), 500);
    }
    const dim = checkDimensions(salida.info.width, salida.info.height);
    console.log(`[ENCODE] ${mime} ${fuente.width}x${fuente.height} ${bytes.length} B → webp q${input.quality} ${dim.width}x${dim.height} ${salida.data.length} B`);
    res.status(200).json({
      ok: true, format: input.format, mime: 'image/webp', data_base64: salida.data.toString('base64'),
      width: dim.width, height: dim.height, bytes: salida.data.length, quality: input.quality,
      source: { mime, bytes: bytes.length, width: fuente.width, height: fuente.height },
    });
  } catch (err) {
    const e = err instanceof EncodeError ? err : new EncodeError('ENCODE_FAILED', err instanceof Error ? err.message : String(err), 500);
    console.error(`[ENCODE] ${e.label}: ${e.message}`);
    res.status(e.status).json({ ok: false, error: e.message, error_label: e.label, status: 'error' });
  }
}
