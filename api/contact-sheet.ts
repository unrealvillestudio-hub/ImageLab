/**
 * ImageLab — POST /api/contact-sheet
 * v1 (2026-10-18) — HOJA DE CONTACTO: varias imágenes ya generadas, unidas en UNA sola.
 *
 * Por qué existe. Vertex admite como mucho 3 imágenes de referencia por generación. Una persona que
 * ocupa una sola imagen (sus vistas unidas en una hoja) deja dos lugares libres para otra persona o el
 * producto. Medido el 2026-10-18: pedirle a Vertex la hoja entera en una sola generación no respeta la
 * cuadrícula (devuelve 3 o 6 paneles, cambia la ropa y el fondo); generar cada vista por separado sí sale
 * fiel. Falta quien las una: el carril corre en Deno, donde no hay librería de imagen, y aquí está `sharp`.
 *
 * REGLA MULTIMARCA. Este archivo es EJE: sabe poner imágenes en una cuadrícula, no sabe de quién son. No
 * recibe marca ni persona, y no escribe en ningún almacenamiento: devuelve los bytes y quien llama decide
 * dónde guardarlos.
 *
 * SÓLO LEE DEL ALMACENAMIENTO DEL ECOSISTEMA. Cada URL tiene que ser del mismo host que `SUPABASE_URL`.
 * Sin esa variable, el endpoint no lee nada (fallo cerrado): un servicio que descarga hasta 16 URLs que le
 * pasan es un proxy abierto si no se acota el origen.
 *
 * Contrato:
 *   POST { image_urls: string[2..16], cols?: 1..8, cell_px?: 128..1024, gap_px?: 0..64, quality?: 1..100 }
 *   200  { ok: true, mime: 'image/jpeg', data_base64, width, height, bytes, cols, rows, cells }
 *   4xx/5xx { ok: false, error, error_label, status: 'error' }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import sharp from 'sharp';

export const config = { maxDuration: 60 };
const IMAGE_FETCH_TIMEOUT_MS = 15_000;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── CONTACT:BEGIN ── (2026-10-18) bloque PURO: qué se pide, cómo se valida y dónde va cada celda. Sin red,
// sin sharp. Lo extrae `tests/hoja_de_contacto_test.mjs` por estos sentinelas.
export const CONTACT_MIN_IMAGES = 2;
export const CONTACT_MAX_IMAGES = 16;
export const CONTACT_CELL_DEFAULT = 512;
export const CONTACT_GAP_DEFAULT = 8;
export const CONTACT_QUALITY_DEFAULT = 88;
export const CONTACT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export class ContactError extends Error {
  label: string; status: number;
  constructor(label: string, message: string, status: number) {
    super(message); this.label = label; this.status = status;
  }
}

export interface ContactRequest { image_urls: string[]; cols: number; cell_px: number; gap_px: number; quality: number }

function entero(v: unknown, def: number, min: number, max: number, nombre: string): number {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ContactError('CONTACT_BAD_REQUEST', `${nombre} debe ser un entero ${min}..${max}`, 400);
  }
  return n;
}

/** Valida el cuerpo contra el host permitido. Lanza `ContactError`: nunca adivina lo que no llegó. */
export function validateContactRequest(body: unknown, allowedHost: string): ContactRequest {
  if (!allowedHost) {
    throw new ContactError('CONTACT_NOT_CONFIGURED', 'falta SUPABASE_URL: el endpoint no lee de ningún origen', 500);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ContactError('CONTACT_BAD_REQUEST', 'el cuerpo debe ser un objeto { image_urls, cols?, cell_px?, gap_px?, quality? }', 400);
  }
  const b = body as Record<string, unknown>;
  const urls = Array.isArray(b.image_urls) ? b.image_urls : null;
  if (!urls || urls.length < CONTACT_MIN_IMAGES || urls.length > CONTACT_MAX_IMAGES) {
    throw new ContactError('CONTACT_BAD_REQUEST', `image_urls debe traer entre ${CONTACT_MIN_IMAGES} y ${CONTACT_MAX_IMAGES} URLs`, 400);
  }
  const limpias = urls.map((u, i) => {
    const s = typeof u === 'string' ? u.trim() : '';
    let host = '';
    try { host = /^https:\/\//i.test(s) ? new URL(s).hostname.toLowerCase() : ''; } catch { host = ''; }
    if (!host) throw new ContactError('CONTACT_BAD_REQUEST', `image_urls[${i}] debe ser una URL https`, 400);
    if (host !== allowedHost.toLowerCase()) {
      throw new ContactError('CONTACT_ORIGIN_FORBIDDEN', `image_urls[${i}] no es del almacenamiento del ecosistema (${host})`, 403);
    }
    return s;
  });
  const cols = entero(b.cols, Math.min(4, limpias.length), 1, 8, 'cols');
  return {
    image_urls: limpias,
    cols,
    cell_px: entero(b.cell_px, CONTACT_CELL_DEFAULT, 128, 1024, 'cell_px'),
    gap_px: entero(b.gap_px, CONTACT_GAP_DEFAULT, 0, 64, 'gap_px'),
    quality: entero(b.quality, CONTACT_QUALITY_DEFAULT, 1, 100, 'quality'),
  };
}

/** El lienzo y la posición de cada celda, en el orden recibido: de izquierda a derecha y de arriba abajo. */
export function contactLayout(n: number, cols: number, cell: number, gap: number): {
  width: number; height: number; rows: number; cells: Array<{ left: number; top: number }>;
} {
  const c = Math.max(1, Math.min(cols, n));
  const rows = Math.ceil(n / c);
  const cells = Array.from({ length: n }, (_, i) => ({
    left: gap + (i % c) * (cell + gap),
    top: gap + Math.floor(i / c) * (cell + gap),
  }));
  return { width: c * cell + (c + 1) * gap, height: rows * cell + (rows + 1) * gap, rows, cells };
}

/** El host permitido a partir de `SUPABASE_URL` (tolera las tres formas habituales de pegarla). */
export function allowedHostFrom(raw: string | undefined): string {
  let v = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) {
    if (!v.includes('.')) v = `${v}.supabase.co`;
    v = `https://${v}`;
  }
  try { return new URL(v).hostname.toLowerCase(); } catch { return ''; }
}
// ── CONTACT:END ──

async function fetchImage(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new ContactError('CONTACT_IMAGE_FETCH_FAILED', `GET ${url.slice(0, 160)} → ${res.status}`, 502);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) throw new ContactError('CONTACT_IMAGE_FETCH_FAILED', `GET ${url.slice(0, 160)} devolvió un cuerpo vacío`, 502);
    if (bytes.length > CONTACT_MAX_IMAGE_BYTES) {
      throw new ContactError('CONTACT_IMAGE_TOO_LARGE', `una imagen pesa ${bytes.length} bytes (tope ${CONTACT_MAX_IMAGE_BYTES})`, 422);
    }
    return bytes;
  } catch (err) {
    if (err instanceof ContactError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ContactError('CONTACT_IMAGE_FETCH_TIMEOUT', `la descarga superó ${IMAGE_FETCH_TIMEOUT_MS / 1000} s`, 504);
    }
    throw new ContactError('CONTACT_IMAGE_FETCH_FAILED', err instanceof Error ? err.message : String(err), 502);
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
      throw new ContactError('CONTACT_BAD_REQUEST', 'Invalid JSON', 400);
    }
    const input = validateContactRequest(body, allowedHostFrom(process.env.SUPABASE_URL));
    // Una por vez: son pocas y el orden de la hoja es el orden de la petición.
    const fuentes: Buffer[] = [];
    for (const u of input.image_urls) fuentes.push(await fetchImage(u));
    const lay = contactLayout(fuentes.length, input.cols, input.cell_px, input.gap_px);
    let celdas: Array<{ input: Buffer; left: number; top: number }>;
    try {
      celdas = await Promise.all(fuentes.map(async (b, i) => ({
        input: await sharp(b).rotate().resize(input.cell_px, input.cell_px, { fit: 'cover' }).toBuffer(),
        left: lay.cells[i].left, top: lay.cells[i].top,
      })));
    } catch (err) {
      throw new ContactError('CONTACT_IMAGE_UNDECODABLE', err instanceof Error ? err.message : String(err), 422);
    }
    const out = await sharp({ create: { width: lay.width, height: lay.height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite(celdas).jpeg({ quality: input.quality }).toBuffer();
    console.log(`[CONTACT] ${fuentes.length} imágenes · ${input.cols}×${lay.rows} · ${lay.width}x${lay.height} · ${out.length} B`);
    res.status(200).json({
      ok: true, mime: 'image/jpeg', data_base64: out.toString('base64'), width: lay.width, height: lay.height,
      bytes: out.length, cols: Math.min(input.cols, fuentes.length), rows: lay.rows, cells: fuentes.length,
    });
  } catch (err) {
    const e = err instanceof ContactError ? err : new ContactError('CONTACT_FAILED', err instanceof Error ? err.message : String(err), 500);
    console.error(`[CONTACT] ${e.label}: ${e.message}`);
    res.status(e.status).json({ ok: false, error: e.message, error_label: e.label, status: 'error' });
  }
}
