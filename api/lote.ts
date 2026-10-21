/**
 * ImageLab — POST /api/lote (2026-10-21) — EL LOTE DE IMAGEN EN VERTEX AI (batch prediction).
 *
 * Fase 3 del plan de Batch (Sam, 2026-10-20: «sí al plan de Batch, procede»): la imagen del carril se pide en lote
 * y se paga a la mitad. `/api/execute` prepara la petición exacta de `:generateContent` («preparar») y produce la
 * respuesta final a partir de la del lote («terminar»). Este endpoint hace lo que queda en medio, con la cuenta de
 * servicio de ImageLab (el carril no tiene credenciales de Google):
 *
 *   · `enviar`   — escribe el JSONL de entrada en el bucket del lote y crea el `batchPredictionJobs` regional.
 *   · `leer`     — el estado del job y, si terminó y se pide, la respuesta de su única petición (del JSONL de salida).
 *   · `cancelar` — cancela un job que nadie va a leer.
 *
 * Formato (medido 2026-10-21 en el notebook oficial de Google `GoogleCloudPlatform/generative-ai`,
 * `gemini/batch-prediction/intro_batch_prediction.ipynb`): una línea `{"request": GenerateContentRequest}` por
 * petición; la salida `…/prediction-model-<ts>/predictions.jsonl` con `{"status": "", "processed_time", "request",
 * "response"}` por línea, SIN orden garantizado. Por eso un lote de imagen lleva UNA petición: su resultado es la
 * única línea, sin depender de que Vertex conserve un campo propio.
 *
 * PROTEGIDO: crea gasto y lee resultados. Cabecera `x-imagelab-lote-secret` contra `IMAGELAB_LOTE_SECRET`; sin la
 * variable, el endpoint responde 503 y no hace nada (fail-closed). `VERTEX_BATCH_BUCKET` y `VERTEX_BATCH_LOCATION`
 * son obligatorias: sin ellas, 503 con el nombre de la que falta. Ninguna tiene valor por defecto.
 *
 * MULTIMARCA: ni una marca. El modelo lo trae la petición (el mismo de la llamada directa); aquí no hay literal.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleAuth } from 'google-auth-library';
import { randomUUID, timingSafeEqual } from 'node:crypto';

declare const process: { env: Record<string, string | undefined> };

export const config = { maxDuration: 60 };

// ── LOTE-VERTEX:BEGIN ── bloque PURO (sin red, sin env): lo extrae `tests/imagen_en_lote_test.mjs`.
// Los estados de un job que ya no van a cambiar (enum de `BatchPredictionJob.state`, discovery v1 de aiplatform,
// medido 2026-10-21). Sólo `SUCCEEDED` y `PARTIALLY_SUCCEEDED` pueden traer resultados.
export const ESTADOS_FINALES = ['JOB_STATE_SUCCEEDED', 'JOB_STATE_PARTIALLY_SUCCEEDED', 'JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED'];
export const ESTADOS_CON_RESULTADOS = ['JOB_STATE_SUCCEEDED', 'JOB_STATE_PARTIALLY_SUCCEEDED'];
// Una petición por lote (ver la cabecera). Un id que cabe en una etiqueta de Vertex: minúsculas, dígitos, _ y -.
export const PETICION_ID = /^[a-z0-9_-]{1,63}$/;
export const MODELO_ID = /^[a-z0-9][a-z0-9.\-]{1,62}$/;

export interface PeticionDeLote { id: string; model: string; request: Record<string, unknown> }

/** Valida lo que se va a enviar. Fail-loud: un lote a medias sería una imagen que nunca llega. */
export function leerPeticiones(raw: unknown): { ok: true; peticion: PeticionDeLote } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length !== 1) return { ok: false, error: 'LOTE_UNA_PETICION: un lote de imagen lleva exactamente una petición' };
  const p = raw[0] as Record<string, unknown>;
  if (typeof p?.id !== 'string' || !PETICION_ID.test(p.id)) return { ok: false, error: 'LOTE_PETICION_ID_INVALIDO' };
  if (typeof p.model !== 'string' || !MODELO_ID.test(p.model)) return { ok: false, error: 'LOTE_MODELO_INVALIDO' };
  const r = p.request as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object' || !Array.isArray(r.contents) || !r.contents.length) return { ok: false, error: 'LOTE_PETICION_SIN_CONTENTS' };
  return { ok: true, peticion: { id: p.id, model: p.model, request: r } };
}

/** La línea del JSONL de entrada. */
export function lineaDeEntrada(p: PeticionDeLote): string {
  return JSON.stringify({ request: p.request });
}

/** El cuerpo de `batchPredictionJobs.create` (campos de `BatchPredictionJob`, discovery v1). */
export function cuerpoDelJob(a: { nombre: string; model: string; entrada: string; salida: string; peticionId: string }): Record<string, unknown> {
  return {
    displayName: a.nombre,
    model: `publishers/google/models/${a.model}`,
    inputConfig: { instancesFormat: 'jsonl', gcsSource: { uris: [a.entrada] } },
    outputConfig: { predictionsFormat: 'jsonl', gcsDestination: { outputUriPrefix: a.salida } },
    labels: { origen: 'imagelab-lote', peticion: a.peticionId },
  };
}

/** Un `lote_id` es el nombre completo del job, y sólo se aceptan los de ESTE proyecto y región. */
export function loteIdValido(loteId: unknown, project: string, location: string): boolean {
  if (typeof loteId !== 'string') return false;
  const m = /^projects\/([^/]+)\/locations\/([^/]+)\/batchPredictionJobs\/(\d+)$/.exec(loteId);
  return !!m && m[2] === location && (m[1] === project || /^\d+$/.test(m[1]));
}

/** `gs://bucket/prefijo` → { bucket, prefijo }. */
export function partirGs(uri: string): { bucket: string; prefijo: string } | null {
  const m = /^gs:\/\/([^/]+)\/?(.*)$/.exec(String(uri ?? ''));
  return m ? { bucket: m[1], prefijo: m[2] } : null;
}

/** Las líneas de salida. Una línea que no se puede leer no tumba las demás: se cuenta. */
export function leerSalida(jsonl: string): { lineas: Array<{ status: string; response: Record<string, unknown> | null }>; ilegibles: number } {
  const lineas: Array<{ status: string; response: Record<string, unknown> | null }> = [];
  let ilegibles = 0;
  for (const l of String(jsonl ?? '').split('\n')) {
    if (!l.trim()) continue;
    try {
      const o = JSON.parse(l);
      lineas.push({ status: typeof o?.status === 'string' ? o.status : '', response: o?.response && typeof o.response === 'object' ? o.response : null });
    } catch { ilegibles++; }
  }
  return { lineas, ilegibles };
}

/** El resultado de la única petición. `ok` sólo si Vertex respondió (status vacío y `response`): una respuesta sin
 *  imagen (bloqueo) ES un resultado, y lo juzga «terminar» igual que en línea. */
export function resultadoDeLaPeticion(lineas: Array<{ status: string; response: Record<string, unknown> | null }>, peticionId: string):
  { id: string; ok: boolean; respuesta: Record<string, unknown> | null; error: string | null } {
  if (lineas.length !== 1) return { id: peticionId, ok: false, respuesta: null, error: `el lote devolvió ${lineas.length} líneas (se espera 1)` };
  const l = lineas[0];
  if (l.status || !l.response) return { id: peticionId, ok: false, respuesta: null, error: (l.status || 'línea sin response').slice(0, 300) };
  return { id: peticionId, ok: true, respuesta: l.response, error: null };
}
// ── LOTE-VERTEX:END ──

// --- impuro ---------------------------------------------------------------------------------------------------

let _auth: GoogleAuth | null = null;
async function token(): Promise<string> {
  if (!_auth) {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? '';
    if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY missing in env.');
    _auth = new GoogleAuth({ credentials: JSON.parse(raw), scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  }
  const t = await (await _auth.getClient()).getAccessToken();
  const v = typeof t === 'string' ? t : t?.token;
  if (!v) throw new Error('No se obtuvo token de la cuenta de servicio.');
  return v;
}

function entorno(): { ok: true; project: string; location: string; bucket: string } | { ok: false; error: string } {
  const project = (process.env.GOOGLE_CLOUD_PROJECT ?? '').trim();
  const location = (process.env.VERTEX_BATCH_LOCATION ?? '').trim();
  const bucket = (process.env.VERTEX_BATCH_BUCKET ?? '').trim().replace(/^gs:\/\//, '').replace(/\/+$/, '');
  const falta = [!project && 'GOOGLE_CLOUD_PROJECT', !location && 'VERTEX_BATCH_LOCATION', !bucket && 'VERTEX_BATCH_BUCKET'].filter(Boolean);
  return falta.length ? { ok: false, error: `LOTE_NO_CONFIGURADO: falta ${falta.join(', ')}` } : { ok: true, project, location, bucket };
}

const jobsUrl = (location: string, project: string) =>
  `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/batchPredictionJobs`;

async function gcsSubir(bucket: string, name: string, texto: string, tk: string): Promise<void> {
  const r = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(name)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/jsonl' }, body: texto });
  if (!r.ok) throw new Error(`LOTE_GCS_ESCRITURA: ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
}

async function gcsLeerJsonl(bucket: string, prefijo: string, tk: string): Promise<string> {
  const pre = prefijo.endsWith('/') ? prefijo : `${prefijo}/`;
  const l = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?prefix=${encodeURIComponent(pre)}`,
    { headers: { Authorization: `Bearer ${tk}` } });
  if (!l.ok) throw new Error(`LOTE_GCS_LISTA: ${l.status}`);
  const nombres = (((await l.json()) as any)?.items ?? []).map((i: any) => String(i?.name ?? '')).filter((n: string) => n.endsWith('.jsonl'));
  let texto = '';
  for (const n of nombres) {
    const d = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(n)}?alt=media`,
      { headers: { Authorization: `Bearer ${tk}` } });
    if (!d.ok) throw new Error(`LOTE_GCS_LECTURA: ${d.status} ${n}`);
    texto += `${await d.text()}\n`;
  }
  return texto;
}

function secretoValido(req: VercelRequest, esperado: string): boolean {
  const h = req.headers?.['x-imagelab-lote-secret'];
  const dado = Buffer.from(String(Array.isArray(h) ? h[0] : h ?? ''));
  const ok = Buffer.from(esperado);
  return dado.length === ok.length && timingSafeEqual(dado, ok);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }
  const secreto = (process.env.IMAGELAB_LOTE_SECRET ?? '').trim();
  if (!secreto) { res.status(503).json({ ok: false, error: 'LOTE_NO_CONFIGURADO: falta IMAGELAB_LOTE_SECRET' }); return; }
  if (!secretoValido(req, secreto)) { res.status(401).json({ ok: false, error: 'LOTE_NO_AUTORIZADO' }); return; }
  const env = entorno();
  if (env.ok === false) { res.status(503).json({ ok: false, error: (env as { error: string }).error }); return; }
  const { project, location, bucket } = env as { project: string; location: string; bucket: string };
  let body: any;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); }
  catch { res.status(400).json({ ok: false, error: 'Invalid JSON' }); return; }

  try {
    if (body.accion === 'enviar') {
      const p = leerPeticiones(body.peticiones);
      if (p.ok === false) { res.status(400).json({ ok: false, error: (p as { error: string }).error }); return; }
      const pet = (p as { peticion: PeticionDeLote }).peticion;
      const id = randomUUID();
      const entrada = `lotes/${id}/entrada.jsonl`;
      const tk = await token();
      await gcsSubir(bucket, entrada, `${lineaDeEntrada(pet)}\n`, tk);
      const r = await fetch(jobsUrl(location, project), {
        method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpoDelJob({ nombre: `imagelab-${id}`, model: pet.model, entrada: `gs://${bucket}/${entrada}`,
          salida: `gs://${bucket}/lotes/${id}/salida/`, peticionId: pet.id })),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || typeof j?.name !== 'string') {
        res.status(502).json({ ok: false, error: `LOTE_NO_CREADO: Vertex ${r.status} ${String(j?.error?.message ?? '').slice(0, 200)}` });
        return;
      }
      console.log(`[ImageLab][LOTE] creado ${j.name} (${pet.id}, ${pet.model}, ${location})`);
      res.status(200).json({ ok: true, lote_id: j.name, estado: j.state ?? null, entrada: `gs://${bucket}/${entrada}` });
      return;
    }

    if (body.accion === 'leer' || body.accion === 'cancelar') {
      if (!loteIdValido(body.lote_id, project, location)) { res.status(400).json({ ok: false, error: 'LOTE_ID_INVALIDO' }); return; }
      const tk = await token();
      const base = `https://${location}-aiplatform.googleapis.com/v1/${body.lote_id}`;
      if (body.accion === 'cancelar') {
        const c = await fetch(`${base}:cancel`, { method: 'POST', headers: { Authorization: `Bearer ${tk}` } });
        res.status(c.ok ? 200 : 502).json({ ok: c.ok, ...(c.ok ? {} : { error: `LOTE_NO_CANCELADO: Vertex ${c.status}` }) });
        return;
      }
      const g = await fetch(base, { headers: { Authorization: `Bearer ${tk}` } });
      const job: any = await g.json().catch(() => ({}));
      if (!g.ok) { res.status(502).json({ ok: false, error: `LOTE_ILEGIBLE: Vertex ${g.status}` }); return; }
      const estado = String(job?.state ?? 'JOB_STATE_UNSPECIFIED');
      const terminado = ESTADOS_FINALES.includes(estado);
      const peticionId = String(job?.labels?.peticion ?? '');
      if (!body.con_resultados || !terminado) { res.status(200).json({ ok: true, terminado, estado }); return; }
      if (!ESTADOS_CON_RESULTADOS.includes(estado)) {
        res.status(200).json({ ok: true, terminado, estado, resultados: [{ id: peticionId, ok: false, respuesta: null,
          error: `job ${estado}: ${String(job?.error?.message ?? '').slice(0, 200)}` }] });
        return;
      }
      const dir = partirGs(String(job?.outputInfo?.gcsOutputDirectory ?? ''));
      if (!dir) { res.status(502).json({ ok: false, error: 'LOTE_SIN_SALIDA: el job terminó sin gcsOutputDirectory' }); return; }
      const salida = leerSalida(await gcsLeerJsonl(dir.bucket, dir.prefijo, tk));
      if (salida.ilegibles) console.warn(`[ImageLab][LOTE] ${body.lote_id}: ${salida.ilegibles} línea(s) ilegible(s)`);
      res.status(200).json({ ok: true, terminado, estado, resultados: [resultadoDeLaPeticion(salida.lineas, peticionId)] });
      return;
    }

    res.status(400).json({ ok: false, error: `LOTE_ACCION_DESCONOCIDA: ${JSON.stringify(body.accion ?? null).slice(0, 40)}` });
  } catch (err) {
    res.status(502).json({ ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
  }
}
