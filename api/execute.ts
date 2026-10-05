/**
 * ImageLab — POST /api/execute
 * v8 (M-3 / Unidad 1, 2026-07-30) — el productor devuelve PROCEDENCIA: el `model` realmente
 *   usado (la constante GEMINI_IMAGE_MODEL, no un literal que el consumidor adivina) y el `usage`
 *   facturable TAL COMO Vertex lo reporta en `usageMetadata` de la respuesta :generateContent
 *   (crudo, sin remapear a un esquema inventado; null si Vertex no lo trae — nunca un número
 *   fabricado). Hasta v7 ambos se descartaban: extractInlineImage leía sólo la imagen y tiraba el
 *   resto del body, así que content-run-stage etiquetaba las filas del ledger con el modelo Imagen 3
 *   ya apagado y un costo constante. La presencia/forma de usageMetadata se loguea una vez por
 *   llamada para confirmarla en vivo (era indecidible desde el código: se descartaba antes de mirarla).
 * v7 — Gemini 2.5 Flash Image (migrated off Vertex Imagen 3, shut down 2026-06-24).
 *
 * All image generation runs on `gemini-2.5-flash-image` via Vertex AI's
 * `:generateContent` endpoint — the single model now handles both text-to-image
 * and multimodal (subject/style reference) generation.
 *
 * Routing:
 *  - Orchestrator path (brandId + stage): looks up imagelab_presets by
 *    brand_id+canal; if found, assembles the brand-specific prompt format
 *    (reference_aesthetic + composition + lighting + grading + mood +
 *    concept + brand DNA + texture + FORBIDDEN); else falls back to the
 *    legacy generic prompt. Calls gemini-2.5-flash-image (text-to-image).
 *  - Direct mode (text-only): same preset lookup if body carries brand_id+
 *    canal; otherwise raw prompt path. gemini-2.5-flash-image.
 *  - Direct mode (multimodal): preset prompt + reference images passed as
 *    inlineData parts, with their subject/style roles described in the text
 *    (Gemini-image has no REFERENCE_TYPE system). gemini-2.5-flash-image.
 *
 * Gemini-image has no negativePrompt parameter, so any negative prompt is
 * absorbed into the text body as "Avoid: ...".
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

// ── ENDPOINT-VERTEX:BEGIN ── (2026-10-01) bloque PURO: de una ubicación a la URL base de Vertex.
// Lo extrae `tests/endpoint_vertex_test.mjs` por estos sentinelas.
//
// Una región (`us-central1`) vive en `{region}-aiplatform.googleapis.com`. La ubicación `global` NO
// sigue ese patrón: su host es `aiplatform.googleapis.com`, sin prefijo. Construir la URL con la
// plantilla regional daría `global-aiplatform.googleapis.com`, un host que no existe.
//
// Por qué importa: Gemini 2.5 en Vertex usa cuota compartida dinámica y el endpoint `global` reparte
// la carga entre regiones, en vez de depender de la capacidad de una sola. El carril midió 429
// «Resource exhausted» en la región fija (138 en agosto, 32 en septiembre, en
// public.ops_generation_ledger).
//
// La ubicación sigue siendo DATO (`GOOGLE_CLOUD_LOCATION`); este bloque no elige ninguna. Sin la
// variable, el comportamiento es idéntico al de antes (`us-central1`).
export function vertexBaseUrl(location: string, project: string): string {
  const loc = String(location ?? '').trim();
  if (!loc) throw new Error('VERTEX_LOCATION_EMPTY: GOOGLE_CLOUD_LOCATION está vacío.');
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${project}/locations/${loc}`;
}
// ── ENDPOINT-VERTEX:END ──
// Single Gemini-image model handles both roles (text-to-image + multimodal
// subject/style references) via :generateContent. Replaced the two Imagen 3
// models (fast-generate + capability), shut down 2026-06-24. If Google
// deprecates this, change it here.
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

// Aspect ratios Gemini 2.5 Flash Image accepts. Anything else degrades to 1:1.
const VALID_ASPECT_RATIOS = new Set([
  '1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
]);
function normalizeAspectRatio(ar?: string): string {
  const v = (ar ?? '').trim();
  return VALID_ASPECT_RATIOS.has(v) ? v : '1:1';
}

// maxDuration is 60s (see `config` below). Leave ~5s headroom for token + JSON I/O.
const UPSTREAM_TIMEOUT_MS = 55_000;

// ── FALLO:BEGIN ── bloque puro (sin red): lo extrae `tests/contrato_de_fallo_test.mjs`.
// ── CONTRATO DE FALLO PARA EL LIBRO MAYOR (2026-10-01) ─────────────────────────────────────────
// Un 500 de este endpoint ya no es sólo un texto: dice QUÉ llamada paga falló y QUÉ contestó el
// proveedor, para que el carril asiente el costo REAL de un fallo en vez de una fila sin modelo.
//
// EL DEFECTO, medido el 2026-10-01 en `public.ops_generation_ledger`: 187 filas de imagen fallida
// con `model_id='UNKNOWN'` y `rate_source='UNSEEDED'` desde el 2026-07-30. El carril no podía saber
// ni qué modelo se llamó, ni si el proveedor llegó a responder, ni cuánto consumió el constructor de
// prompt que sí corrió antes del fallo: este endpoint devolvía `{ error, status }` y nada más.
//
//   · `step`: qué llamada paga falló — el constructor de prompt o la imagen.
//   · `httpStatus`: el código con el que respondió el proveedor; `null` si no hubo respuesta
//     (timeout, red caída). Un código fuera de 2xx es un rechazo y no trae consumo.
//   · `usage`: el `usageMetadata` crudo cuando el proveedor SÍ respondió 2xx pero la respuesta no
//     sirvió (bloqueo de seguridad, sin imagen, sin texto). Esa respuesta reporta consumo y se
//     devuelve tal cual: el productor no inventa un esquema ni fabrica ceros.
//
// Ninguna regla de facturación vive acá: este archivo informa lo que pasó; el asiento lo decide el
// carril con la tarifa, que es dato.
//
// ── EL PROMPT DEL FALLO (2026-10-05) ──────────────────────────────────────────────────────────────
// EL DEFECTO, medido por main en la ronda de imágenes del 2026-10-05: ante un bloqueo, este endpoint
// devolvía sólo `"Gemini image: no inlineData returned (blockReason=SAFETY)"`, sin el prompt, y el log
// de Vercel guardaba sólo su longitud (`prompt=2561 chars`). Sin el texto no se puede saber qué
// palabra dispara el bloqueo. Ahora el cuerpo del fallo lleva, cuando existen:
//   · `prompt_full`: el mismo campo que la respuesta de éxito (el prompt final, antes de las fotos
//     rotuladas y del negativo), y `negative_prompt`: el negativo que viaja como «Avoid: …».
//   · `prompt_sent`: el texto EXACTO que se mandó al modelo de imagen (rótulos + prompt + «Avoid: …»).
//     Lo pone la propia llamada que lo mandó, así que es lo que el filtro del proveedor leyó.
//   · `block_reason` / `finish_reason`: los motivos del proveedor como dato, no sólo dentro del texto.
//   · `preset_id` / `psycho_id`: la capa de preset y el estímulo que entraron en ese prompt.
// Y el log de Vercel deja UNA línea con el texto, sólo al fallar y recortado a un tope declarado.
type PaidStep = 'prompt_builder' | 'image';
class ProviderCallError extends Error {
  readonly step: PaidStep;
  readonly httpStatus: number | null;
  readonly usage: Record<string, number> | null;
  readonly blockReason: string | null;
  readonly finishReason: string | null;
  /** El texto exacto que viajó al modelo de imagen. Lo asigna la llamada que lo mandó. */
  promptSent: string | null = null;
  constructor(
    message: string, step: PaidStep, httpStatus: number | null, usage: Record<string, number> | null,
    reasons: { blockReason?: string | null; finishReason?: string | null } = {},
  ) {
    super(message);
    this.name = 'ProviderCallError';
    this.step = step;
    this.httpStatus = httpStatus;
    this.usage = usage;
    this.blockReason = reasons.blockReason ?? null;
    this.finishReason = reasons.finishReason ?? null;
  }
}

/** Lo que el handler sabe del prompt cuando algo falla. Se llena a medida que el prompt se construye:
 *  un campo en `null` dice «todavía no existía», no «vacío». */
interface FailurePromptContext {
  promptFull: string | null;
  negativePrompt: string | null;
  presetId: string | null;
  psychoId: string | null;
}
function emptyFailurePromptContext(): FailurePromptContext {
  return { promptFull: null, negativePrompt: null, presetId: null, psychoId: null };
}

/** Lo que una llamada paga deja dicho cuando revienta dentro de su `try`: un ProviderCallError ya
 *  formado se respeta; un timeout es «llamada hecha, sin respuesta»; cualquier otra cosa (red caída,
 *  cuerpo ilegible) también lo es, porque la petición salió y no sabemos qué cobró el proveedor. */
function asProviderCallError(err: unknown, step: PaidStep, timeoutMessage: string): ProviderCallError {
  if (err instanceof ProviderCallError) return err;
  if (err instanceof Error && err.name === 'AbortError') return new ProviderCallError(timeoutMessage, step, null, null);
  return new ProviderCallError(err instanceof Error ? err.message : String(err), step, null, null);
}

/** El cuerpo de un fallo. `builder` es el constructor de prompt si llegó a llamarse (con su consumo
 *  si respondió): un constructor que corrió y cobró antes de que la imagen fallara es gasto real. */
function failurePayload(
  err: unknown,
  builder: { version: string; model: string; usage: Record<string, number> | null } | null,
  prompt: FailurePromptContext | null = null,
): Record<string, unknown> {
  const msg = err instanceof Error ? err.message : String(err);
  const fallo = err instanceof ProviderCallError ? err : null;
  const imagen = fallo?.step === 'image' ? fallo : null;
  const delConstructor = fallo?.step === 'prompt_builder' ? fallo : null;
  return {
    error: msg,
    status: 'error',
    // El modelo de la llamada de IMAGEN, con o sin fallo: es el que se llamó o el que se iba a llamar.
    model: GEMINI_IMAGE_MODEL,
    provider_called: !!imagen,
    provider_http_status: imagen ? imagen.httpStatus : null,
    usage: imagen ? imagen.usage : null,
    prompt_builder_version: builder?.version ?? null,
    prompt_builder_model: builder?.model ?? null,
    prompt_builder_usage: builder?.usage ?? delConstructor?.usage ?? null,
    prompt_builder_called: !!builder,
    prompt_builder_failed: !!delConstructor,
    prompt_builder_http_status: delConstructor ? delConstructor.httpStatus : null,
    // El prompt del fallo (2026-10-05). `null` cuando el fallo ocurrió antes de que existiera.
    prompt_full: prompt?.promptFull ?? null,
    negative_prompt: (prompt?.negativePrompt ?? '').trim() || null,
    prompt_sent: imagen?.promptSent ?? null,
    block_reason: imagen?.blockReason ?? null,
    finish_reason: imagen?.finishReason ?? null,
    preset_id: prompt?.presetId ?? null,
    psycho_id: prompt?.psychoId ?? null,
  };
}

// El log de Vercel recorta cada línea larga; además, el texto completo ya viaja en el cuerpo del fallo
// y el carril lo recibe entero. Por eso el log lleva un tope DECLARADO y dice cuándo lo aplicó: es la
// segunda vía para ver el prompt, no la única. Los prompts medidos rondan 2.600 caracteres, así que
// 4.000 los deja enteros con margen.
const FAILURE_PROMPT_LOG_MAX_CHARS = 4000;

/** La línea de log de un fallo con prompt, o `null` si el fallo ocurrió antes de que existiera.
 *  Sólo la llama el camino de fallo: en un éxito no se escribe el prompt en el log. */
function failurePromptLogLine(p: Record<string, unknown>): string | null {
  const fuente = typeof p.prompt_sent === 'string' ? 'prompt_sent' : typeof p.prompt_full === 'string' ? 'prompt_full' : null;
  if (!fuente) return null;
  const texto = p[fuente] as string;
  const recortado = texto.length > FAILURE_PROMPT_LOG_MAX_CHARS;
  return `[ImageLab][PROMPT-DEL-FALLO] block_reason=${p.block_reason ?? '-'} finish_reason=${p.finish_reason ?? '-'} ` +
    `http=${p.provider_http_status ?? '-'} preset=${p.preset_id ?? 'none'} psycho=${p.psycho_id ?? 'ninguno'} ` +
    `fuente=${fuente} chars=${texto.length} recorte=${recortado ? FAILURE_PROMPT_LOG_MAX_CHARS : 'no'} ` +
    `texto=${JSON.stringify(recortado ? texto.slice(0, FAILURE_PROMPT_LOG_MAX_CHARS) : texto)}`;
}

/** Escribe la línea del prompt del fallo (si la hay) y devuelve el cuerpo sin tocarlo. */
function logFailurePrompt(p: Record<string, unknown>): Record<string, unknown> {
  const linea = failurePromptLogLine(p);
  if (linea) console.error(linea);
  return p;
}
// ── FALLO:END ──

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
    // BRIEF-N06 — directriz visual del DOMINIO de la pieza (`intel.brand_topics.visual_directive`).
    // La emite el cable del carril; el lab no la deduce ni la inventa.
    visual_directive?: string;
    // BRIEF-IMG-01 fase 2 — TODAS OPCIONALES. Sin `copy_full`, el camino es exactamente el de antes.
    copy_full?: string;                  // el cuerpo ENTERO de la pieza, no su cabeza
    title?: string;
    image_hook?: string;
    visual_directives?: string[];        // las directrices humanas ACUMULADAS, en orden
    persona?: PromptPersona | null;      // ALIAS LEGACY (2026-10-03): una persona. Si llega `personas`, manda `personas`
    personas?: PromptPersona[] | null;   // 2026-10-03 — hasta MAX_PERSONAS_PER_IMAGE, en orden A, B…; dato del carril
    gaze?: PersonaGaze | null;           // 2026-10-03 — camera | each_other | subject_of_scene; sin dato, el defecto por N
    generation_mode?: GenerationMode;    // 'edit_from_current' exige `source_image_url`
    source_image_url?: string;           // la imagen actual, para editar en vez de repintar
    prompt_only?: boolean;               // medición en seco: sintetiza y devuelve el prompt, sin imagen
    location?: PromptLocation | null;    // dato de `public.location_blueprints`, resuelto por el carril
    product_composited?: boolean;        // el compositor pegará el PNG real: el modelo no dibuja producto
    product?: PromptProduct | null;      // opción (c): el producto se PINTA desde su foto y a su tamaño
  };
  previousOutputs: Record<string, string>;
}

// --- BRIEF-IMG-01 fase 2 · I/O del constructor de prompt -------------------

interface PromptBuilderVersion {
  version: string;
  model_id: string;
  instructions: string;
  max_output_tokens: number | null;
}

/**
 * La versión ACTIVA de las instrucciones del constructor. Es DATO (una fila activa a la vez), no
 * literal: mejorar el constructor es publicar una versión nueva con su motivo, no desplegar código.
 */
async function loadActivePromptBuilderVersion(): Promise<PromptBuilderVersion | null> {
  return sb<PromptBuilderVersion>(
    'imagelab_prompt_builder_versions?active=eq.true&select=version,model_id,instructions,max_output_tokens&limit=1',
  );
}

const TEXT_MODEL_URL = (model: string) =>
  `${vertexBaseUrl(GCP_LOCATION(), GCP_PROJECT())}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;

/** Un modelo de TEXTO de Vertex. Sin razonamiento extendido: el constructor redacta, no delibera. */
async function vertexGenerateText(params: {
  model: string; system: string; user: string; maxOutputTokens: number;
}): Promise<{ text: string; usage: Record<string, number> | null }> {
  if (!GCP_PROJECT()) throw new Error('GOOGLE_CLOUD_PROJECT missing in env.');
  const token = await getAccessToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(TEXT_MODEL_URL(params.model), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: params.system }] },
        contents: [{ role: 'user', parts: [{ text: params.user }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: params.maxOutputTokens,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new ProviderCallError(`PROMPT_BUILDER_MODEL_ERROR ${res.status}: ${await res.text()}`, 'prompt_builder', res.status, null);
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
      .trim();
    // El consumo se lee ANTES de decidir si sirve: una respuesta 2xx sin texto también se cobra.
    const usage = extractUsage(data);
    if (!text) {
      const why = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason ?? 'sin texto';
      throw new ProviderCallError(`PROMPT_BUILDER_EMPTY: el modelo no devolvió prompt (${why})`, 'prompt_builder', res.status, usage);
    }
    return { text, usage };
  } catch (err) {
    throw asProviderCallError(err, 'prompt_builder', `PROMPT_BUILDER_TIMEOUT after ${UPSTREAM_TIMEOUT_MS / 1000}s.`);
  } finally {
    clearTimeout(timeout);
  }
}

/** Una imagen por URL, lista para ir como `inlineData`. Falla en voz alta: una referencia que no
 *  llega cambiaría el resultado sin que nadie lo supiera. */
async function fetchImageInline(url: string): Promise<InlineImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IMAGE_FETCH_FAILED ${res.status}: ${url}`);
  const mimeType = (res.headers.get('content-type') ?? 'image/png').split(';')[0].trim() || 'image/png';
  const buf = Buffer.from(await res.arrayBuffer());
  return { mimeType, data: buf.toString('base64') };
}

/** Cómo entra el producto a la imagen para esta marca: DATO en `imagelab_overlay_tokens.product.mode`.
 *  `composite` = lo pega el compositor; cualquier otro valor o ausencia = se pinta en la escena (opción c). */
//
// 2026-10-03 — también la fila del CANAL (activa), mezclada sobre la de marca por `overlayTokensForCanal`
// (bloque PB). La consulta de la fila de marca no cambia. Sin fila de canal, `tokens` es el mismo objeto
// de antes. Cada consulta grita por su cuenta si falla (`sb`), y entonces se sigue con lo que llegó.
//
// ⛔ NO OPERATIVO — versión anterior (main 35eccca), se conserva por trazabilidad: devolvía sólo
// `row?.tokens ?? null` de la fila de marca, sin mirar el canal de la petición.
async function loadOverlayTokens(brandId: string | undefined, canal: string): Promise<{ tokens: any | null; canal: string | null; declared: string[] }> {
  if (!brandId) return { tokens: null, canal: null, declared: [] };
  const b = encodeURIComponent(brandId);
  const [row, canalRow] = await Promise.all([
    sb<any>(`imagelab_overlay_tokens?brand_id=eq.${b}&canal=is.null&select=tokens`),
    canal ? sb<any>(`imagelab_overlay_tokens?brand_id=eq.${b}&canal=eq.${encodeURIComponent(canal)}&active=is.true&select=canal,tokens&limit=1`) : null,
  ]);
  return overlayTokensForCanal(row?.tokens ?? null, canalRow, canal);
}

// Los topes de fotos de referencia (persona, locación, producto) viven en el bloque PB desde el
// 2026-10-03: el reparto entre varias personas es lógica pura y su test la ejecuta tal cual.

/**
 * Lector de PostgREST. Devuelve la primera fila, o `null`.
 *
 * FAIL-LOUD (#95-B). Antes esto era `if (!res.ok) return null` + `catch { return null }`: un
 * `select` contra una columna inexistente devolvía 400, se tragaba, y el prompt salía sin
 * identidad de marca **sin que nadie se enterara**. Así vivió meses. Es la misma familia de fallo
 * silencioso que costó tres semanas en el fan-out y un mes en el cron 29.
 *
 * La distinción que importa, y por la que no alcanza con "loguear si null":
 *
 *   200 + [fila]  → hay dato.
 *   200 + []      → AUSENCIA LEGÍTIMA. La marca no tiene preset, o no tiene identidad cargada
 *                   (hoy: ForumPHs, UnrealvilleStudio). Degrada en silencio, es el caso previsto.
 *   4xx / 5xx     → BUG. Columna que no existe, tabla mal escrita, permiso faltante, RLS.
 *                   GRITA, y con el cuerpo de la respuesta: PostgREST nombra la columna ofensora
 *                   ahí y ese es justo el diagnóstico que faltaba.
 *   throw         → BUG de red/DNS/env. Grita igual.
 *
 * Sigue devolviendo `null` en los tres casos: cambiar eso a `throw` dejaría a la marca sin imagen
 * en vez de con una imagen genérica, que es un cambio de comportamiento mayor y no es lo que este
 * paso viene a hacer. Lo que cambia es que el fallo deja de ser invisible.
 */
async function sb<T>(path: string): Promise<T | null> {
  // El path lleva el brand_id pero ninguna credencial — es seguro loguearlo entero, y sin él
  // el error no dice QUÉ consulta falló.
  const where = path.split('?')[0];
  try {
    const res = await fetch(`${SB_URL()}/rest/v1/${path}`, {
      headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` },
    });
    if (!res.ok) {
      let body = '';
      try { body = (await res.text()).slice(0, 400); } catch { /* cuerpo ilegible: el status ya informa */ }
      console.error(
        `[ImageLab][sb] CONSULTA FALLIDA ${res.status} sobre "${where}" — la marca queda SIN ese ` +
        `contexto y el prompt sale degradado. NO es "la marca no tiene el dato": es que la query ` +
        `no corrió. path=${path}${body ? ` · respuesta=${body}` : ''}`,
      );
      return null;
    }
    const data = await res.json();
    const row = Array.isArray(data) ? (data[0] ?? null) : data;
    if (row == null) {
      // Ausencia legítima: informativo, no error. Un ERROR acá enseñaría a ignorar los ERROR.
      console.log(`[ImageLab][sb] sin filas en "${where}" (ausencia legítima) · path=${path}`);
    }
    return row;
  } catch (e) {
    console.error(
      `[ImageLab][sb] EXCEPCIÓN consultando "${where}" — prompt degradado. ` +
      `path=${path} · ${e instanceof Error ? e.message : String(e)}`,
    );
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
  psychoId?: string | null;   // el estímulo que entró en el prompt (sólo para el cuerpo del fallo)
}

const FALLBACK_NEGATIVE = 'blurry, low quality, amateur, stock photo look, watermark, text overlay, logo';

// --- Canal: normalización (#95-D) -----------------------------------------
//
// ImageLab es el ÚNICO punto donde convergen los tres caminos, así que el vocabulario visual se
// normaliza acá y no en cada emisor:
//
//   [A] UI            → elige el canal en la interfaz
//   [B] Orchestrator → lab-worker  → `normalizeCanal()` sube a MAYÚSCULAS y cae a INSTAGRAM_FEED
//   [C] IID          → content-run-stage → alias explícito (bloque CANAL, #95-D)
//
// Dos problemas que esto cierra:
//
// 1. CASE. `lab-worker` manda MAYÚSCULAS y las filas de `imagelab_presets` NO son homogéneas: las
//    globales y la de UnrealvilleStudio están en mayúsculas, pero **las 4 de NeuroneSCF están en
//    minúscula** (`blog_featured`). Con `canal=eq.X` ese preset era inalcanzable desde los dos
//    caminos — no por el canal, sino por el case.
// 2. VOCABULARIO LEGACY. Jobs viejos de `lab_jobs` pueden traer literales previos a la convención
//    (`LINKEDIN` sin sufijo, el plural `INSTAGRAM_STORIES`). Se traducen en vez de fallar.
//
// NO se renombra ninguna fila de la DB: el alias las alcanza donde están. Y `META`, `LANDING` y
// `WEB` se dejan pasar tal cual — son canales legítimos del camino [B] con presets globales
// sembrados, no valores a corregir.
const CANAL_ALIAS: Record<string, string> = {
  INSTAGRAM_STORIES: 'INSTAGRAM_STORY',   // el plural era código muerto en content-run-stage; se acepta por si un job viejo lo trae
  LINKEDIN:          'LINKEDIN_FEED',     // sin sufijo, anterior a la convención de superficie
  FACEBOOK:          'FACEBOOK_FEED',
  INSTAGRAM:         'INSTAGRAM_FEED',
  BLOG:              'BLOG_FEATURED',
};

/** Canal canónico: MAYÚSCULAS, sin espacios, con los alias legacy resueltos. */
function normalizeCanal(canal: string | null | undefined): string {
  const up = String(canal ?? '').trim().toUpperCase();
  if (!up) return 'INSTAGRAM_FEED';
  return CANAL_ALIAS[up] ?? up;
}

/**
 * Load the imagelab_presets row for (brand_id, canal). Returns null if none.
 *
 * Busca el canal en MAYÚSCULAS y, si no hay fila, reintenta en minúsculas — porque las filas de la
 * DB no son homogéneas (ver arriba: las 4 de NeuroneSCF están en minúscula).
 *
 * DOS CONSULTAS `eq` SECUENCIALES, deliberadamente, en vez de un solo `or=(...)` o un `ilike`:
 *   · `ilike` no sirve: en LIKE el guion bajo es COMODÍN, así que `BLOG_FEATURED` matchearía
 *     también `BLOGXFEATURED`. Silencioso y difícil de ver.
 *   · `or=(...)` haría una sola llamada, pero **ese operador no se usa en ninguna parte de este
 *     stack**: sería sintaxis de PostgREST sin precedente verificado. Este ecosistema ya perdió
 *     tiempo con un `order=` por columna inexistente que se tragaba en silencio (10-jul); no vale
 *     la pena ahorrar un round-trip a cambio de estrenar un operador acá.
 * `eq` es el que usa todo el archivo y está probado. La segunda llamada solo ocurre en el miss.
 */
async function loadImagelabPreset(brandId: string, canal: string): Promise<any | null> {
  if (!brandId || !canal) return null;
  const b = encodeURIComponent(brandId);
  const upper = canal.toUpperCase();
  const lower = canal.toLowerCase();

  const hit = await sb<any>(`imagelab_presets?brand_id=eq.${b}&canal=eq.${encodeURIComponent(upper)}&select=*&limit=1`);
  if (hit) return hit;
  if (lower === upper) return null;

  const hitLower = await sb<any>(`imagelab_presets?brand_id=eq.${b}&canal=eq.${encodeURIComponent(lower)}&select=*&limit=1`);
  if (hitLower) {
    console.log(`[ImageLab][#95-D] preset de ${brandId} encontrado con canal en minúscula ('${lower}'); la convención es MAYÚSCULAS`);
  }
  return hitLower ?? null;
}

/**
 * Carga el preset GLOBAL (`brand_id IS NULL`) para un canal. #95-C.
 *
 * Existen 7 filas globales (`LANDING`, `META`, `TIKTOK`, `WEB`) que hasta ahora eran **inalcanzables
 * desde el camino async**: el lookup solo consultaba `brand_id=eq.<marca>`. CopyLab sí las usa
 * (`mergeImagelabPresets(global, brand)`), así que el patrón correcto ya estaba escrito en el
 * ecosistema — solo faltaba aquí.
 */
async function loadGlobalPreset(canal: string): Promise<any | null> {
  if (!canal) return null;
  const upper = canal.toUpperCase();
  const lower = canal.toLowerCase();

  const hit = await sb<any>(`imagelab_presets?brand_id=is.null&canal=eq.${encodeURIComponent(upper)}&select=*&limit=1`);
  if (hit) return hit;
  if (lower === upper) return null;
  return await sb<any>(`imagelab_presets?brand_id=is.null&canal=eq.${encodeURIComponent(lower)}&select=*&limit=1`);
}

// ── C:BEGIN ── (#95-C, 2026-07-24) bloque PURO: fusión de capas → prompt visual.
// Sin fetch, sin DB, sin estado. Lo ejecuta `tests/visual_spec_test.mjs` extrayéndolo por estos
// sentinelas: lo que se testea es la fuente que se deploya, no una copia.
//
// POR QUÉ EXISTE. Antes había dos builders excluyentes y ninguno completo:
//   · rama PRESET  → `buildPromptFromPreset` leía SOLO `extra_params`, `lighting_style` y
//     `color_grading`. **Ignoraba las 10 columnas del preset que espejan los ejes de marca** y
//     **nunca recibía el `psycho_preset`**. Por eso la única fila con `extra_params` poblado
//     (UnrealvilleStudio/INSTAGRAM_FEED) era el único caso que producía algo con carácter.
//   · rama LEGACY  → leía la marca (tras #95-A) pero ignoraba cualquier preset.
// Resultado: identidad y estímulo **nunca coincidían en la misma imagen**, y las 10 columnas
// espejo del preset eran datos declarados que nadie leía.
//
// EL MODELO. Los ejes visuales existen en DOS niveles con los MISMOS nombres:
//   `brands.imagelab_realism_level`  ←→  `imagelab_presets.realism_level`
//   `brands.imagelab_film_look`      ←→  `imagelab_presets.film_look`   … y así los 10.
// Eso no es casualidad: **el preset es un override por canal de los mismos ejes que la marca fija
// como base**. La fusión es la que los datos ya describían y nadie ejecutaba:
//
//   marca (base)  ←  preset de marca (override)  ←  preset global (relleno)
//
// El preset de marca gana sobre el global; el global solo rellena lo que nadie declaró. La marca
// es la base porque es lo que define a la marca en TODOS los canales; el preset ajusta uno.
const EJES_COMPARTIDOS = [
  'realism_level', 'film_look', 'lens_preset', 'depth_of_field', 'framing',
  'skin_detail', 'imperfections', 'humidity_level', 'sweat_level', 'grain_level',
] as const;

// ── BRIEF 7 · LA CLÁUSULA SIN TEXTO — la imagen se genera, la tipografía se compone ──
//
// MEDIDO EN PRODUCCIÓN (2026-08-22): el modelo de imagen corrompe sistemáticamente la tipografía
// española que dibuja dentro de la imagen ("EXACTEMENTE", "CUANDA", "APAPSRIENTA", "FRACIÓN") e
// insertó "LEY 284" en una pieza — texto normativo dentro del plano visual, que el Watcher NO juzga
// (juzga el COPY, no los píxeles). Dos piezas aprobadas quedaron bloqueadas por eso.
//
// HALLAZGO QUE LO AGRAVA, verificado hoy contra `public.brands`: hay marcas que llevan PROSA en
// `default_negative_prompt` (ForumPHs: "…compliant with Ley 284 de Propiedad Horizontal (Panamá)…").
// Esa prosa entra al prompt por la puerta FORBIDDEN / "Avoid:", y un generador de imagen que ve un
// nombre propio y un número tiende a DIBUJARLOS. O sea: el candado de compliance venía alimentando
// al defecto. Esta cláusula lo cierra por el lado que pesa —la instrucción afirmativa— sin tocar el
// dato de ninguna marca.
//
// DECISIÓN (Sam): la imagen se genera SIN texto y el texto se compone determinísticamente encima
// (ver `api/compose.ts`). Es cláusula del EJE: no nombra marca, canal, idioma ni jurisdicción, y
// gobierna a toda marca que pase por este builder. Va en las DOS direcciones del prompt porque el
// modelo las pesa distinto: la afirmativa (qué ES la imagen) y la negativa (qué está prohibido).
const NO_TEXT_CLAUSE =
  'CRITICAL: the image must contain NO text of any kind — no letters, no words, no numbers, ' +
  'no typography, no captions, no subtitles, no headlines, no labels, no signage, no watermarks, ' +
  'no lettered logos, no UI overlays, no handwriting. Pure scene only: the typography is composed ' +
  'afterwards by code, so leave the composition clean and legible without it';
const NO_TEXT_NEGATIVE =
  'text, letters, words, typography, captions, subtitles, headlines, numbers, lettering, ' +
  'watermark, signage, labels, on-image copy, UI overlay';

// ── TEXTO PERMITIDO EN ESCENA, COMO DATO (2026-10-03, motor de personas) ──
//
// MEDIDO el 2026-10-03 (set de un podcast, 12 tomas): un letrero encendido que es PARTE del lugar
// («ON AIR») chocaba con la cláusula sin texto y sólo salía porque el concepto lo declaraba a mano como
// excepción. La excepción es INSTANCIA —qué palabras muestra un lugar concreto— y vive en el dato del
// lugar (`location_blueprints.raw_config.allowed_scene_text`, que el carril manda como
// `params.location.allowed_scene_text`). El motor sólo sabe redactarla: sin dato, la cláusula es
// EXACTAMENTE la de siempre.
/** Tope de entradas y de largo: es un letrero del lugar, no un titular. Más que eso sería copy dibujado. */
export const ALLOWED_SCENE_TEXT_MAX_ITEMS = 5;
export const ALLOWED_SCENE_TEXT_MAX_CHARS = 40;

/** Las palabras que el lugar muestra, limpias: cadenas no vacías, sin repetir, con su tope. */
export function normalizeAllowedSceneText(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
    if (!s || s.length > ALLOWED_SCENE_TEXT_MAX_CHARS || s.includes('"') || out.includes(s)) continue;
    out.push(s);
    if (out.length >= ALLOWED_SCENE_TEXT_MAX_ITEMS) break;
  }
  return out;
}

/** La cláusula sin texto. Sin palabras permitidas, la constante literal; con ellas, la constante más
 *  una excepción que las cita tal cual y no admite nada más. Sin punto final: quien la usa lo pone. */
export function noTextClause(allowed?: string[] | null): string {
  const words = normalizeAllowedSceneText(allowed ?? []);
  if (!words.length) return NO_TEXT_CLAUSE;
  return `${NO_TEXT_CLAUSE}. Single exception, because it is part of the place itself: ` +
    `${words.map((w) => `"${w}"`).join(', ')} may appear exactly as written, legible and correctly spelled, ` +
    'only where the place shows it (for example a lit sign on the wall); no other letters, words or numbers anywhere';
}

// ── BRIEF-N06 · LA CLÁUSULA DE SUJETOS DISTINTOS — si hay más de una persona, son personas ──
//
// MEDIDO EN PRODUCCIÓN (2026-09-06): la pieza `d9a45427` salió con la MISMA mujer dos veces en el
// mismo plano. No es un defecto de una marca ni de un rubro: ninguna marca, en ningún país, quiere
// dos personas que se leen como la misma persona. Por eso es cláusula del EJE y vive en el bloque
// puro, donde el test la cubre y no puede evaporarse en un refactor.
//
// EL NOMBRE ES LA FUNCIÓN, NO EL CASO. Se llama DISTINCT_SUBJECTS, no NO_SAME_WOMAN: el defecto
// medido fue una mujer repetida, pero el eje es «si hay más de una persona, son distintas». Un
// nombre tomado del caso habría bautizado un motor de N marcas con el accidente de una pieza.
//
// POSICIÓN: DESPUÉS de NO_TEXT_CLAUSE, nunca antes. Esa cláusula está en segunda posición a
// propósito —define qué CLASE de imagen es— y desplazarla degrada lo que ya funciona.
const DISTINCT_SUBJECTS_CLAUSE =
  'When the scene includes more than one person, each person must be a visibly different ' +
  'individual: different facial structure, age range, skin tone and hair. Never repeat the same ' +
  'face, and never render two people who read as the same person';

// ── UNA SOLA IMAGEN, UN SOLO MOMENTO — nunca paneles ──
//
// MEDIDO EN PRODUCCIÓN (2026-09-25): 3 de 11 imágenes de prueba salieron partidas en dos paneles
// («antes / después», «la misma mujer por la mañana y por la tarde»). Sam: «el panel partido no me
// gusta, complica la imagen». No lo pedía sólo el estímulo PSY-CONTRAST: tras corregir su texto
// (migración 20260925130000) el CONSTRUCTOR volvió a escribir «lado izquierdo… lado derecho, la misma
// mujer más tarde», porque el copy narraba dos momentos. Por eso es cláusula del MOTOR, no de un dato:
// ninguna marca quiere un díptico que se lee como collage, y la regla tiene que sobrevivir a cualquier
// copy, estímulo o síntesis. Nombre por la FUNCIÓN (un solo encuadre), no por el caso.
//
// POSICIÓN: detrás de DISTINCT_SUBJECTS_CLAUSE. Las dos primeras definen qué clase de imagen es y quién
// aparece; ésta define cuántos encuadres hay.
const SINGLE_FRAME_CLAUSE =
  'The image is ONE single photograph of ONE moment, in ONE continuous frame: never a split screen, ' +
  'diptych, triptych, collage, grid, side-by-side or before-and-after panels, and never the same ' +
  'person shown twice. If the idea contrasts two states, show the contrast inside that single scene. ' +
  // 2026-09-28 (844f834a, medido): el modelo pintó una franja negra de «cine» arriba de la escena.
  // 2026-09-30 (medido sobre la imagen limpia, antes del compositor): también pinta franjas BLANCAS o
  // GRISES y «foto dentro de foto» —una foto más chica sobre un lienzo liso—, sobre todo en 9:16. La
  // redacción anterior sólo nombraba las negras.
  // ⛔ NO OPERATIVO — redacción anterior, se conserva por trazabilidad:
  // 'The photograph fills the whole frame edge to edge: no black bars, letterbox, borders or frames'
  'The photograph fills the whole frame edge to edge, top to bottom: no black, white or gray bars or bands, ' +
  'no letterbox, borders, frames or picture-in-picture';
// ⛔ NO OPERATIVO — negativo anterior (2026-09-28), se conserva por trazabilidad:
// 'split screen, diptych, triptych, collage, grid layout, side-by-side panels, before and after panels, picture in picture, same person twice'
const SINGLE_FRAME_NEGATIVE =
  'split screen, diptych, triptych, collage, grid layout, side-by-side panels, before and after panels, ' +
  'picture in picture, same person twice, letterbox, black bars, blank band, solid color band, empty margin';

export interface VisualSpec {
  // Ejes que viven en los dos niveles. Valor efectivo tras la fusión.
  ejes: Record<string, string>;
  // Solo del preset.
  lighting_style: string | null;
  color_grading: string | null;
  reference_aesthetic: string | null;
  composition_rule: string | null;
  mood: string | null;
  brand_dna: string | null;
  texture: string | null;
  // Solo de la marca.
  visual_identity: string | null;
  compliance_rules: string | null;
  industry: string | null;
  // Estímulo psicológico. `null` = no llegó (caso del camino sync: degrada, no falla).
  psycho_injection: string | null;
  psycho_id: string | null;
  // Negativo y metadatos.
  negative: string;
  aspect_ratio: string | null;
  preset_id: string | null;
  preset_source: 'brand' | 'global' | 'none';
}

/** Primer valor no vacío. `''` y `null` cuentan como ausencia; `0` y `false` no aplican acá. */
function firstNonEmpty(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

export function mergeVisualSpec(
  brand: any | null,
  brandPreset: any | null,
  globalPreset: any | null,
  psycho: any | null,
): VisualSpec {
  const preset = brandPreset ?? globalPreset ?? null;
  const presetSource: VisualSpec['preset_source'] = brandPreset ? 'brand' : (globalPreset ? 'global' : 'none');
  const ep = (preset?.extra_params ?? {}) as Record<string, any>;

  // PRECEDENCIA DE LOS 10 EJES — por especificidad, de más a menos:
  //
  //   1. preset de MARCA  (esta marca, este canal)      ← lo más específico que existe
  //   2. la MARCA         (esta marca, todos los canales)
  //   3. preset GLOBAL    (cualquier marca, este canal) ← solo RELLENA lo que nadie declaró
  //
  // El global va ÚLTIMO, y esto importa: es un default para todas las marcas, así que no puede
  // pisar lo que una marca declaró sobre sí misma. Caso real que lo obliga — LucienSael en TIKTOK:
  // la marca declara `realism_level = "photorealistic, editorial, high-end commercial photography
  // standard"` y el preset global de TIKTOK dice `"cinematic"`. Si el global ganara, la spec de
  // retrato editorial de la marca quedaría sustituida por un genérico — justo el problema que #95
  // vino a cerrar. El global sí aporta donde la marca calla (p. ej. `grain_level` en un TikTok).
  const ejes: Record<string, string> = {};
  for (const eje of EJES_COMPARTIDOS) {
    const v = firstNonEmpty(brandPreset?.[eje], brand?.[`imagelab_${eje}`], globalPreset?.[eje]);
    if (v) ejes[eje] = v;
  }

  // Negativo ACUMULATIVO, no excluyente: lo prohibido por la marca sigue prohibido aunque el canal
  // agregue lo suyo. Un `??` acá dejaría caer el candado de marca al aparecer un preset.
  // BRIEF 7 — el eje va PRIMERO y siempre: el negativo del motor no depende de que una marca lo
  // haya declarado. El dedup por término de abajo hace que una marca que ya prohibía "text" (hoy:
  // NeuroneSCF, VivoseMask, VizosCosmetics, UnrealvilleStudio, LucienSael) no lo duplique.
  const negParts: string[] = [NO_TEXT_NEGATIVE, SINGLE_FRAME_NEGATIVE];
  const forbidden = Array.isArray(ep.forbidden_elements) ? ep.forbidden_elements.join(', ')
    : (typeof ep.forbidden_elements === 'string' ? ep.forbidden_elements : '');
  if (forbidden)                     negParts.push(forbidden);
  if (preset?.negative_prompt)       negParts.push(String(preset.negative_prompt));
  if (brand?.default_negative_prompt) negParts.push(String(brand.default_negative_prompt));
  const negative = [...new Set(negParts.filter(Boolean).flatMap((s) => s.split(',').map((x) => x.trim())))]
    .filter(Boolean).join(', ') || FALLBACK_NEGATIVE;

  const mood = Array.isArray(ep.mood) ? ep.mood.join(', ')
    : (typeof ep.mood === 'string' ? ep.mood : null);

  return {
    ejes,
    lighting_style:      firstNonEmpty(preset?.lighting_style),
    color_grading:       firstNonEmpty(preset?.color_grading),
    reference_aesthetic: firstNonEmpty(ep.reference_aesthetic),
    composition_rule:    firstNonEmpty(ep.composition_rule),
    mood:                firstNonEmpty(mood),
    brand_dna:           firstNonEmpty(ep.brand_dna),
    texture:             firstNonEmpty(ep.texture),
    visual_identity:     firstNonEmpty(brand?.imagelab_visual_identity),
    compliance_rules:    firstNonEmpty(brand?.imagelab_compliance_rules),
    industry:            firstNonEmpty(brand?.imagelab_industry),
    // DEGRADACIÓN LIMPIA (#99): si no llega estímulo, el prompt sale sin capa psicológica y nada
    // más cambia. Es el estado ESPERADO del camino sync, no un error — el estímulo pertenece al
    // flujo async, y la UI se reconvierte (deuda #100), no se parcha.
    psycho_injection:    firstNonEmpty(psycho?.injection_visual),
    psycho_id:           firstNonEmpty(psycho?.id),
    negative,
    aspect_ratio:        firstNonEmpty(preset?.aspect_ratio),
    preset_id:           firstNonEmpty(preset?.preset_id),
    preset_source:       presetSource,
  };
}

/**
 * Compone el prompt final. El ORDEN no es decorativo: los generadores de imagen pesan más lo que
 * viene primero, así que va de lo que la imagen ES a cómo se ve, y termina en restricciones.
 *
 *   concepto → identidad de marca → estética/composición → ejes técnicos → luz y color →
 *   mood → ADN de marca → textura → ESTÍMULO → notas del operador → tema del copy →
 *   candado de compliance → cola de calidad → FORBIDDEN
 */
export function composeVisualPrompt(
  spec: VisualSpec,
  conceptText: string,
  opts: { styleNotes?: string | null; copyTheme?: string | null; sceneDirective?: string | null; allowedSceneText?: string[] | null } = {},
): string {
  const p: string[] = [];

  if (conceptText)             p.push(`Concept: ${conceptText}.`);
  // BRIEF 7 — segunda posición, pegada al concepto: los generadores pesan más lo que viene primero,
  // y esto no es un matiz estético sino la restricción que define qué clase de imagen es. Va aunque
  // no haya concepto, identidad ni preset: es del motor, no de la pieza.
  // 2026-10-03 — la excepción del lugar (`allowedSceneText`) es dato; sin ella, la constante de siempre.
  p.push(`${noTextClause(opts.allowedSceneText)}.`);
  // BRIEF-N06 — tercera posición, detrás de la cláusula sin texto y delante de todo lo demás: es
  // del motor igual que aquélla, y sale aunque no haya marca, preset ni concepto.
  p.push(`${DISTINCT_SUBJECTS_CLAUSE}.`);
  // Un solo encuadre: detrás de los sujetos distintos, delante de todo lo demás. Es del motor.
  p.push(`${SINGLE_FRAME_CLAUSE}.`);
  // BRIEF-N06 — la directriz del DOMINIO. Es INSTANCIA: el motor no sabe qué dice ni la interpreta,
  // sólo la transporta. Llega de `intel.brand_topics.visual_directive` por el cable del carril. Va
  // aquí porque describe QUÉ muestra la escena, y los generadores pesan más lo que viene primero;
  // detrás de las dos cláusulas del eje, que no se negocian. Ausente = prompt de hoy, sin cambios:
  // no hay directriz por defecto, porque un genérico inventado degradaría en silencio.
  if (opts.sceneDirective)     p.push(`Scene directive: ${opts.sceneDirective}.`);
  if (spec.visual_identity)    p.push(`Brand visual identity: ${spec.visual_identity}.`);
  if (spec.reference_aesthetic) p.push(`${spec.reference_aesthetic} aesthetic.`);
  if (spec.composition_rule)   p.push(`${spec.composition_rule}.`);

  // Los ejes en orden fijo (no el del objeto): el prompt debe ser reproducible entre corridas.
  const ejesTxt = EJES_COMPARTIDOS.filter((e) => spec.ejes[e]).map((e) => `${e.replace(/_/g, ' ')}: ${spec.ejes[e]}`);
  if (ejesTxt.length)          p.push(`${ejesTxt.join(', ')}.`);

  if (spec.lighting_style)     p.push(`${spec.lighting_style}.`);
  if (spec.color_grading)      p.push(`${spec.color_grading}.`);
  if (spec.mood)               p.push(`Mood: ${spec.mood}.`);
  if (spec.brand_dna)          p.push(`Brand DNA: ${spec.brand_dna}.`);
  if (spec.texture)            p.push(`${spec.texture}.`);
  if (spec.industry)           p.push(`Industry context: ${spec.industry}.`);

  // El estímulo va DESPUÉS de la identidad y ANTES de las restricciones: modula la lectura de una
  // imagen que ya es de la marca. Si viniera primero, competiría con la identidad.
  if (spec.psycho_injection)   p.push(`PSYCHO LAYER [${spec.psycho_id ?? 'n/a'}]: ${spec.psycho_injection}.`);

  if (opts.styleNotes)         p.push(`${opts.styleNotes}.`);
  if (opts.copyTheme)          p.push(`Visual must reinforce this copy theme: ${opts.copyTheme}.`);
  // El compliance al final y como candado explícito: es una restricción de marca, no un rasgo
  // estético que deba mezclarse con el estilo.
  if (spec.compliance_rules)   p.push(`Brand constraints: ${spec.compliance_rules}.`);

  p.push('Photorealistic, high quality, 8K, sharp focus, commercial grade.');
  if (spec.negative)           p.push(`FORBIDDEN: ${spec.negative}.`);

  return p.join(' ');
}
// ── C:END ──

// ── PB:BEGIN ── (BRIEF-IMG-01 fase 2, 2026-09-25) bloque PURO: el CONSTRUCTOR DE PROMPT.
//
// EL DEFECTO QUE CIERRA, medido el 2026-09-25:
//   · El carril sembraba la imagen con el título + los PRIMEROS 180 caracteres del copy
//     (`content-run-stage/index.ts:6929` y `:7679`), y este lab añadía otros 150
//     (`copyTheme`). Nada leía el texto entero: la imagen ilustraba el arranque de la pieza.
//   · Al corregir, sólo viajaba la ÚLTIMA directriz de Sam: cada una pisaba a la anterior.
//   · El prompt con el que nació una imagen no se guardaba: `output` sólo decía «[IMAGE_GENERATED]».
//
// LO QUE HACE ESTE BLOQUE: decide si hay que sintetizar, arma el mensaje para el modelo de texto,
// resuelve si la PERSONA de la marca aparece, y garantiza que las cláusulas del motor sobreviven a la
// síntesis. La llamada al modelo vive FUERA (es I/O); acá sólo hay forma y decisión, y el test
// `tests/prompt_builder_test.mjs` la extrae y la ejecuta tal cual se despliega.
//
// MULTIMARCA: cero marcas, cero canales, cero idiomas. La persona llega como DATO (`params.persona`,
// que el carril resuelve de `public.person_blueprints`), y las instrucciones del constructor son dato
// versionado (`public.imagelab_prompt_builder_versions`). Este bloque no sabe cómo se llama nadie.

export type GenerationMode = 'edit_from_current' | 'regenerate_full';

export interface PromptPersona {
  name: string;
  aliases?: string[];
  description: string;
  reference_image_urls?: string[];
  // Catálogo de gestos de ESTA persona (dato del carril, `person_blueprints.raw_config.expression_catalog`).
  expressions?: Array<{ when: string; face: string }>;
  expression_avoid?: string[];
  // Vestuario de ESTA persona (dato del carril, `person_blueprints.raw_config.wardrobe_catalog`).
  wardrobe?: Array<{ when: string; outfit: string }>;
  // 2026-10-04 — POR QUÉ la manda el carril. Sólo `PERSONA_ENTRY_AUTHOR_VOICE` cambia algo (la exime
  // del filtro de mención); cualquier otro valor, o ninguno, es la regla de mención de siempre.
  entry?: string | null;
}

/** Una locación real de la marca (`public.location_blueprints`, enlazada por `public.brand_locations`).
 *  Llega resuelta por el carril: acá no se decide cuál, sólo cómo se cuenta al modelo. */
export interface PromptLocation {
  name: string;
  description: string;
  reference_image_urls?: string[];
  // 2026-10-03 — las palabras que el lugar muestra (un letrero del set). Dato de
  // `location_blueprints.raw_config.allowed_scene_text`; sin él, la cláusula sin texto de siempre.
  allowed_scene_text?: string[];
}

/** Tope de fotos de referencia de persona por llamada: más fotos no dan más parecido y sí más coste. */
const MAX_PERSONA_REFS = 3;
/** Tope de fotos de locación por llamada: dos ángulos bastan para anclar el lugar. */
const MAX_LOCATION_REFS = 1;
/** Con lugar o producto, la persona viaja con 2 fotos: más fotos adjuntas empujan al modelo al collage. */
const MAX_PERSONA_REFS_WITH_OTHERS = 2;
const MAX_PRODUCT_REFS = 2;

/** Un producto REAL que aparece en la escena (opción (c), Sam 2026-09-27): el generador lo PINTA a partir
 *  de su foto real y a su tamaño físico. Llega resuelto por el carril desde la ficha del producto. */
export interface PromptProduct {
  name: string;
  items: Array<{ name: string; image_url: string; height_cm?: number | null; width_cm?: number | null }>;
}

/** Referencia humana para la escala: el alto medio de una cara adulta, del nacimiento del pelo al mentón. */
export const FACE_HEIGHT_CM = 18.5;

/** Una línea de tamaño por envase, en cm y en «caras»: el modelo entiende mejor la proporción con una persona. */
export function productSizeLine(it: { name: string; height_cm?: number | null; width_cm?: number | null }): string {
  const h = Number(it.height_cm); const w = Number(it.width_cm);
  if (!Number.isFinite(h) || h <= 0) return `"${it.name}": keep its real proportions relative to a human hand`;
  const faces = Math.round((h / FACE_HEIGHT_CM) * 10) / 10;
  return `"${it.name}": about ${h} cm tall${Number.isFinite(w) && w > 0 ? ` and ${w} cm wide` : ''} (about ${faces}× the height of an adult face)`;
}

/** Las referencias son REFERENCIAS, no capas. Medido el 2026-09-27: con 5 fotos adjuntas (persona recortada
 *  con alfa + lugar), el modelo pegó las fotos en collage en vez de pintar una escena nueva. */
export const REFERENCE_PHOTOS_CLAUSE =
  'The attached photos are references only (identity, place, product). Paint ONE new photograph from scratch: never cut out, paste, collage or reuse any reference photo as a layer or as the background';

/** EXPRESIÓN DE LA PERSONA (Sam, 2026-09-27): el gesto acompaña lo que dice el texto de la imagen.
 *  Mostrar un producto → sonríe; hablar de un daño o un problema → preocupación; celebrar un buen
 *  resultado → satisfacción. Cláusula del EJE: el tono se lee del gancho de CADA pieza, no de la marca. */
export const PERSONA_EXPRESSION_CLAUSE =
  'The person\'s facial expression and body language match the emotional tone of the TEXT ON IMAGE (and, without it, of the TITLE): ' +
  'when presenting or holding a product, a warm genuine smile; when the text names a problem or damage, an empathetic, concerned expression ' +
  '(never exaggerated or theatrical); when it celebrates a good result, visible satisfaction and confidence. Natural, never a stock-photo grin';

/** El gesto de la persona: su CATÁLOGO si la marca lo declara (Sam, 2026-09-28: «gestos que no
 *  coinciden con el carácter de la pieza»); si no, la regla general. El tono se lee del texto de la
 *  imagen de cada pieza. */
export function personaExpressionBlock(persona: PromptPersona | null | undefined): string {
  const entries = (persona?.expressions ?? []).filter((e) => e?.when?.trim() && e?.face?.trim());
  if (!entries.length) return `${PERSONA_EXPRESSION_CLAUSE}.`;
  const avoid = (persona?.expression_avoid ?? []).filter((a) => a?.trim());
  return `Pick ${persona!.name.trim()}'s facial expression from this catalog, by the tone of the TEXT ON IMAGE (or of the TITLE when there is none):\n` +
    entries.map((e) => `- when ${e.when.trim()}: ${e.face.trim()}`).join('\n') +
    (avoid.length ? `\nNever: ${avoid.join('; ')}.` : '');
}

/** LAS FOTOS DE LA PERSONA SON SU IDENTIDAD, NO SU VESTUARIO (Sam, 2026-09-28: «no puede salir con la
 *  misma foto siempre»). Medido el mismo día: las fotos de referencia de la persona son de UNA sesión,
 *  con la misma ropa, y el generador copiaba ropa, collar y pose. Cláusula del EJE. */
export const PERSONA_IDENTITY_ONLY_CLAUSE =
  'The reference photos of the person define identity only — face, hair, skin tone and build. Do NOT copy their clothing, jewellery, pose, background or lighting: ' +
  'dress and pose the person for THIS scene, with an outfit different from the one in the reference photos';

/** El vestuario de la persona: su CATÁLOGO si la marca lo declara; si no, sólo la cláusula de identidad.
 *  Al editar la imagen actual no se dicta: manda la ropa que ya tiene, salvo que una directriz la cambie. */
export function personaWardrobeBlock(persona: PromptPersona | null | undefined, mode?: GenerationMode | null): string {
  if (mode === 'edit_from_current') return 'Keep the clothing of the current image unless a directive asks to change it.';
  const entries = (persona?.wardrobe ?? []).filter((w) => w?.when?.trim() && w?.outfit?.trim());
  if (!entries.length) return `${PERSONA_IDENTITY_ONLY_CLAUSE}.`;
  return `${PERSONA_IDENTITY_ONLY_CLAUSE}. Choose ${persona!.name.trim()}'s outfit by the setting of the scene, and vary it from image to image:\n` +
    entries.map((w) => `- ${w.when.trim()}: ${w.outfit.trim()}`).join('\n');
}

/** LUZ COHERENTE (Sam, 2026-09-28: la persona iluminada de una forma y el fondo de otra). Con fotos de persona, lugar y producto de sesiones distintas, el modelo tiende a
 *  pegar la luz de cada referencia: sujeto de estudio sobre fondo de exterior. Cláusula del EJE. */
//
// Revisada el 2026-09-28 (Sam: «cuidado con aplanar la perspectiva y resulte parecer una polaroid
// iluminada»). La redacción anterior pedía la MISMA luz para todo, y una luz pareja aplana: sin luz
// principal en el rostro, sin caída hacia el fondo, sin profundidad. La luz de una foto real se compone
// por capas —fondo, sujeto, rostro— y lo que comparten es la FUENTE (dirección), la temperatura de
// color, el grano y la óptica, no la intensidad.
// ⛔ NO OPERATIVO — redacción anterior, se conserva por trazabilidad:
// 'One single light for the whole photograph: the person, their skin, hair and clothing, and any product are lit by the same light as the scene around them — same direction, color temperature, intensity and shadows as the background. Never a studio-lit subject over a background with different light, never a cut-out or pasted look'
export const LIGHTING_COHERENCE_CLAUSE =
  'Lighting is layered like a real photograph, never flat: the scene keeps its own light, depth and perspective, with natural falloff and a background slightly softer in focus; ' +
  'the person gets a gentle key light on the face with soft modelling shadows, coming from the same side as the scene\'s main light source, so the subject reads in three dimensions. ' +
  'Subject, product and background share the same light direction, color temperature, white balance, lens, depth of field and film grain. ' +
  'Never an evenly lit flat image, never a subject lit from a different direction or temperature than the scene, never a cut-out or pasted look';

/** ZONA DE TEXTO (Sam, 2026-09-28: el titular tapaba el producto en dos piezas). El compositor pone el
 *  texto donde la marca lo declara (`imagelab_overlay_tokens.layout`); el generador no lo sabía y
 *  dejaba el envase o la cara justo ahí. La franja es DATO (`layout.text_zone_pct` + `layout.anchor`):
 *  sin ella no hay cláusula. Cláusula del EJE: no nombra marca ni canal. */
export function textZoneClause(layout: any): string {
  const pct = Number(layout?.text_zone_pct);
  const anchor = String(layout?.anchor ?? '');
  if (!Number.isFinite(pct) || pct < 10 || pct > 70) return '';
  const side = anchor.startsWith('bottom') ? 'lower' : anchor.startsWith('top') ? 'upper' : '';
  if (!side) return '';
  const other = side === 'lower' ? 'upper' : 'lower';
  // Medido el 2026-09-28: con sólo el porcentaje, el modelo siguió poniendo el envase a la altura de
  // la cintura, justo debajo del titular. Una instrucción de CUERPO (a qué altura se sostiene) se
  // cumple mejor que una geométrica, así que viajan las dos.
  const pose = side === 'lower'
    ? ' If a person holds a product, it is raised to shoulder or face height, next to the face, never at waist or chest level'
    : ' If a person holds a product, it is held at chest height, below the face';
  // 2026-09-30 (medido): «the lower area may show only background» se leía como «zona reservada»; en
  // 5–8 de ~150 imágenes el modelo dejó ahí una placa lisa del tamaño de la franja (473 de 1344 filas
  // uniformes en una 9:16). La franja es parte de la MISMA fotografía, sólo sin cara, manos ni producto.
  // ⛔ NO OPERATIVO — redacción anterior, se conserva por trazabilidad:
  // `out of that area, inside the ${other} ${100 - Math.round(pct)}% of the frame; the ${side} area may show only background, clothing or surfaces.` + pose
  return `The ${side} ${Math.round(pct)}% of the frame will carry text added later: keep the face, the hands and any product ` +
    `out of that area, inside the ${other} ${100 - Math.round(pct)}% of the frame. The photograph continues through the ${side} area: ` +
    `the same scene, light and perspective (background, clothing or surfaces), never an empty, blank or solid-color band.` + pose;
}

/** DÓNDE VA EL PRODUCTO cuando la marca declara su franja de texto. Medido el 2026-09-28 (pasada NSCF,
 *  4 de 6 piezas): con la cláusula de zona sola, la síntesis ponía el envase «on a salon counter in the
 *  foreground», es decir, en la franja baja, y el titular lo tapaba. La cláusula de zona dice qué
 *  franja evitar; ésta dice dónde SÍ va el producto. Cláusula del EJE: sale del mismo dato de layout. */
//
// Tanda 2 (2026-09-28, medido): con un envase se cumplió; con KITS de 3 envases, que no caben en una
// mano, el modelo los bajó al mostrador bajo el titular (3 de 10). Con varios envases, el lugar es un
// estante a la altura del hombro, al lado de la persona.
//
// Tanda 3 (2026-09-28, Sam en 83b65e2f, formato horizontal): «a la altura del hombro» seguía cayendo en la
// franja del titular. Falta el LADO: el texto se ancla en una esquina (`anchor` = bottom_left…) y el
// producto va del lado contrario. Sale del mismo dato de layout.
function productSide(anchor: string): string {
  if (anchor.endsWith('left')) return ' It sits in the right half of the frame, away from the text corner.';
  if (anchor.endsWith('right')) return ' It sits in the left half of the frame, away from the text corner.';
  return '';
}
export function productPlacementClause(layout: any, withPerson: boolean, items = 1): string {
  const pct = Number(layout?.text_zone_pct);
  const anchor = String(layout?.anchor ?? '');
  if (!Number.isFinite(pct) || pct < 10 || pct > 70) return '';
  if (anchor.startsWith('bottom')) {
    const side = productSide(anchor);
    if (withPerson && items > 1) {
      return 'The products stand together on a high shelf or raised counter at the person\'s shoulder height, right beside her and in the upper part of the frame, ' +
        'or she holds them up at shoulder height; never on a low counter, table or surface in the lower part of the frame.' + side;
    }
    return (withPerson
      ? 'The product is held in the person\'s hand, raised to shoulder or face height beside the face; never standing on a counter, table or shelf in the lower part of the frame.'
      : 'The product stands on a raised surface in the upper part of the frame; never on a counter or table at the bottom of the frame.') + side;
  }
  if (anchor.startsWith('top')) return 'The product sits in the lower part of the frame, below the area reserved for text';
  return '';
}

/** EL PRODUCTO CON VOLUMEN (Sam, 2026-09-28: «un cierto toque de ángulo a los productos… levemente
 *  menos frontal, hacia ambos lados»). Un envase de frente a cámara parece pegado; girado unos grados
 *  tiene volumen y se lee igual. El lado sale de una semilla estable, para que varíe entre imágenes sin
 *  cambiar al recomponer la misma pieza. Cláusula del EJE: no nombra marca ni producto. */
export function productAngleClause(seed: string): string {
  let h = 0;
  for (const ch of String(seed ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const side = h % 2 === 0 ? 'left' : 'right';
  return `Show each product turned slightly to the ${side} (a gentle three-quarter view, about 15 to 25 degrees, never flat to the camera and never in profile), ` +
    'so its shape has depth while the front label stays fully readable';
}

/** LA MIRADA DE LA PERSONA (Sam, 2026-09-28: «nunca con mirada perdida; su mirada empuja la atención del
 *  espectador»). Cláusula del EJE: la mirada va a la cámara, a la otra persona de la escena o al producto. */
export const PERSONA_GAZE_CLAUSE =
  'The person\'s gaze is purposeful and leads the viewer\'s attention: they look into the camera, at the other person in the scene, or at the product. ' +
  'Never a vacant, distant or lost gaze, never looking at nothing';

/** ENCUADRE DEL SUJETO (Sam, 2026-09-27: «las imágenes están dejando mucho espacio inútil en la parte
 *  superior»; «PO se ve menos que el salón»). Cláusula del EJE: no nombra marca, persona ni lugar.
 *  Sólo al generar desde cero: al editar la imagen actual manda su composición. */
export const SUBJECT_FRAMING_CLAUSE =
  'Frame tightly around the main subject: it fills most of the frame, with only a small margin above the head or the top of the subject — no large empty area of ceiling, wall or sky above it. When a person is present, the person is the subject and the place is the backdrop behind them, never the other way round';

/** La orden al modelo cuando el PRODUCTO se pega después por código (compositor, capa de producto):
 *  un frasco inventado al lado del real sería dos productos, y el inventado siempre miente. */
export const PRODUCT_COMPOSITED_CLAUSE =
  'A photo of the real product will be composited onto this image later, by code: do NOT draw any product, bottle, jar, tube, box, packaging or label anywhere in the scene';

// ── VARIAS PERSONAS EN UNA IMAGEN (2026-10-03, motor de personas) ──────────────────────────────────
//
// EL DEFECTO QUE CIERRA, medido el 2026-10-03:
//   · El carril elegía UNA persona; si la pieza nombraba a dos, ninguna (`content-run-stage`,
//     `selectMentionedPersona`). Este lab, además, sólo entendía `params.persona` (una).
//   · Las cláusulas de luz, encuadre y mirada hablan de «the person», en singular.
//   · Prueba de la ronda 1 (scratchpad `avatar_nscf.md` §4): con las fotos de dos personas ROTULADAS
//     por posición, el modelo reconoció a las dos en 9 de 11 tomas. Sin la foto de la segunda, la
//     inventó. La identidad se separa cuando cada imagen dice de quién es.
//
// LO QUE HACE: acepta `params.personas[]` (el `persona` de siempre queda como ALIAS LEGACY: una lista
// de uno), filtra por mención como siempre, reparte el presupuesto de imágenes de entrada y rotula cada
// imagen por posición y rol («Image 1: SUBJECT A, <nombre>»). Con UNA persona, todo sale EXACTAMENTE
// como antes: lo fija `tests/fixtures/personas_n1_golden.json`, congelado sobre `main`.
//
// MULTIMARCA: cero marcas, cero nombres. Quiénes son, cuántas y qué miran llega como dato.

/** Máximo de personas por imagen que el MOTOR acepta. Cuántas van es dato de la petición (`personas[]`);
 *  esto es el techo de código, para que un dato roto no adjunte diez caras. Pasarlo es un error
 *  declarado (400), no un recorte silencioso. Debe coincidir con el techo del carril. */
export const MAX_PERSONAS_PER_IMAGE = 3;

/** Imágenes de entrada que admite `gemini-2.5-flash-image` según su ficha de Vertex AI («Maximum images
 *  per prompt: 3»; reportado el 2026-10-03, ficha `vertex-ai/generative-ai/docs/models/gemini/2-5-flash-image`).
 *  Es el PRESUPUESTO cuando hay dos o más personas. Con una persona no se aplica: ese camino manda hasta
 *  5 imágenes desde 2026-09-27 (persona 2 + lugar 1 + producto 2, medido en el golden) y no se toca. */
export const MODEL_MAX_INPUT_IMAGES = 3;

/** Hacia dónde miran las personas. Es DATO de la petición (`params.gaze`). */
export const PERSONA_GAZES = ['camera', 'each_other', 'subject_of_scene'] as const;
export type PersonaGaze = typeof PERSONA_GAZES[number];

/** Las personas de la petición. `personas[]` manda; si no llega, `persona` (alias legacy) es una lista
 *  de uno. Error declarado si la lista está mal formada o pasa el techo. */
export function resolvePersonas(params: { persona?: unknown; personas?: unknown } | null | undefined):
  { personas: PromptPersona[]; source: 'personas' | 'persona' | 'none'; error: string | null } {
  const raw = params?.personas;
  if (Array.isArray(raw) && raw.length) {
    const bad = raw.findIndex((p: any) => !p || typeof p.name !== 'string' || !p.name.trim() || typeof p.description !== 'string' || !p.description.trim());
    if (bad >= 0) return { personas: [], source: 'personas', error: `PERSONAS_INVALID: personas[${bad}] necesita name y description no vacíos` };
    const seen = new Set<string>();
    const list = (raw as PromptPersona[]).filter((p) => {
      const k = p.name.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (list.length > MAX_PERSONAS_PER_IMAGE) {
      return { personas: [], source: 'personas', error: `PERSONAS_TOO_MANY: ${list.length} personas; el motor acepta hasta ${MAX_PERSONAS_PER_IMAGE} por imagen` };
    }
    return { personas: list, source: 'personas', error: null };
  }
  const legacy = params?.persona;
  if (legacy && typeof legacy === 'object') return { personas: [legacy as PromptPersona], source: 'persona', error: null };
  return { personas: [], source: 'none', error: null };
}

/** Las personas que la pieza o una directriz NOMBRAN, en el orden de la petición (A, B, C…). */
export function mentionedPersonas(personas: PromptPersona[], texts: Array<string | null | undefined>): PromptPersona[] {
  return (personas ?? []).filter((p) => personaMentioned(p, texts));
}

// ── LA VOZ AUTORA ENTRA SIN SER NOMBRADA (2026-10-04) ───────────────────────────────────────────────
//
// EL DEFECTO QUE CIERRA: el carril (`content-run-stage`, `unrlvl-iid-functions#337`) manda a la autora
// de la marca con `entry: "author_voice"` cuando la pieza argumenta en primera persona, aunque no la
// nombre. Este lab volvía a filtrar por mención (`mentionedPersonas`) y la descartaba al nacer la pieza,
// cuando el copy todavía no lleva la firma. La decisión de quién es autora y cuándo entra es del carril;
// el lab sólo respeta la entrada declarada.
//
// EJE, NO INSTANCIA: `author_voice` describe la FUNCIÓN de la persona en la pieza (habla en nombre
// propio), no a nadie. Quién es autora es dato (`brand_persons.role`), resuelto por el carril.

/** Valor de `PromptPersona.entry` que exime del filtro de mención: la pieza va en la voz de esa persona.
 *  Comparación exacta; cualquier otro valor, o ninguno, se comporta como siempre. */
export const PERSONA_ENTRY_AUTHOR_VOICE = 'author_voice';

/** ¿La persona llega como voz autora de la pieza? Exige además un nombre: sin nombre no hay a quién pintar. */
export function isAuthorVoiceEntry(persona: PromptPersona | null | undefined): boolean {
  return !!persona?.name?.trim() && persona.entry === PERSONA_ENTRY_AUTHOR_VOICE;
}

/** ¿Entra la persona en la escena? La voz autora entra siempre; las demás, sólo si se las nombra. */
export function personaEntersScene(persona: PromptPersona | null | undefined, texts: Array<string | null | undefined>): boolean {
  return isAuthorVoiceEntry(persona) || personaMentioned(persona, texts);
}

/** Las personas que entran en la escena, en el orden de la petición (A, B, C…). Sin `entry` de voz
 *  autora, es exactamente `mentionedPersonas`. */
export function scenePersonas(personas: PromptPersona[], texts: Array<string | null | undefined>): PromptPersona[] {
  return (personas ?? []).filter((p) => personaEntersScene(p, texts));
}

/** La mirada efectiva. Sin dato: con dos o más personas, se miran entre ellas; con una, `null`, que
 *  significa «la cláusula de siempre». Un valor fuera del vocabulario es un error, no un defecto. */
export function resolveGaze(raw: unknown, count: number): { gaze: PersonaGaze | null; error: string | null } {
  if (raw === undefined || raw === null || raw === '') return { gaze: count >= 2 ? 'each_other' : null, error: null };
  const v = String(raw).trim();
  if ((PERSONA_GAZES as readonly string[]).includes(v)) return { gaze: v as PersonaGaze, error: null };
  return { gaze: null, error: `GAZE_INVALID: '${v}' no es uno de: ${PERSONA_GAZES.join(', ')}` };
}

/** La cláusula de mirada. `null` = la constante de siempre (una persona, sin dato). */
export function gazeClause(gaze: PersonaGaze | null, count: number): string {
  if (!gaze) return PERSONA_GAZE_CLAUSE;
  const never = 'Never a vacant, distant or lost gaze, never looking at nothing';
  const many = count >= 2;
  if (gaze === 'camera') {
    return (many ? 'Each person looks into the camera, engaging the viewer directly. ' : 'The person looks into the camera, engaging the viewer directly. ') + never;
  }
  if (gaze === 'each_other') {
    return (many
      ? 'The people look at each other as they talk and listen: each one\'s gaze goes to another person in the scene, never to the camera. '
      : 'The person looks at the other person in the scene, never at the camera. ') + never;
  }
  return (many
    ? 'The people look at what the scene is about — the product, the object in their hands or the task — not at the camera. '
    : 'The person looks at what the scene is about — the product, the object in their hands or the task — not at the camera. ') + never;
}

/** Luz por capas para N personas. Con una o ninguna, la constante literal de siempre. */
export function lightingCoherenceClause(count: number): string {
  if (count < 2) return LIGHTING_COHERENCE_CLAUSE;
  return 'Lighting is layered like a real photograph, never flat: the scene keeps its own light, depth and perspective, with natural falloff and a background slightly softer in focus; ' +
    'each person gets a gentle key light on the face with soft modelling shadows, all coming from the same side as the scene\'s main light source, so every subject reads in three dimensions. ' +
    'People, product and background share the same light direction, color temperature, white balance, lens, depth of field and film grain. ' +
    'Never an evenly lit flat image, never one person lit differently from another or from the scene, never a cut-out or pasted look';
}

/** Encuadre para N personas. Con una o ninguna, la constante literal de siempre. */
export function subjectFramingClause(count: number): string {
  if (count < 2) return SUBJECT_FRAMING_CLAUSE;
  return `Frame tightly around the ${count} people: together they fill most of the frame, all of them fully inside it, none cropped out or hidden behind another, ` +
    'with only a small margin above their heads — no large empty area of ceiling, wall or sky above them. The people are the subject and the place is the backdrop behind them, never the other way round';
}

// ── LA FRANJA Y EL ENCUADRE, POR CANAL (2026-10-03) ─────────────────────────────────────────────
//
// EL DEFECTO QUE CIERRA, medido sobre main 35eccca:
//   · `loadOverlayTokens` leía sólo la fila de MARCA (`canal is null`), así que la franja de texto
//     (`layout.text_zone_pct`) se pedía en todos los canales de la marca, también en la imagen dentro
//     del artículo, que se sube sin texto encima (`content-run-stage`, `uploadMedia` sin compositor).
//   · `engineClausesFor` añadía el encuadre ceñido en todo modo que no fuera edición, así que un plano
//     cenital o un detalle de manos recibía «el sujeto llena casi todo el cuadro».
//   Las dos cosas varían por (marca, canal) en la realidad, y la tabla ya tiene esa granularidad: el
//   compositor (`api/compose.ts`, `pickOverlayTokens`) lee la fila del canal desde F3. El generador era
//   el único lector que se quedaba en la de marca (MULTIBRAND_RULE §12).
//
// LA REGLA:
//   · La fila del canal, si existe y está activa, se mezcla SOBRE la de marca, clave a clave, con la
//     misma mezcla que el compositor: los dos leen la misma franja para el mismo canal.
//   · `layout.text_zone_pct: 0` en la fila del canal apaga la cláusula de franja (y con ella el lugar del
//     producto, que sólo existe para esquivar la franja): `textZoneClause` ya devuelve '' fuera de 10..70.
//   · `layout.subject_framing` (`tight` | `scene`) decide el encuadre. `tight`, o la clave ausente, es el
//     encuadre de siempre. Un valor ajeno no se adivina: se usa `tight` y se avisa.
//   · Sin fila de canal, `tokens` es el MISMO objeto que antes y todo es idéntico byte a byte
//     (`tests/fixtures/canal_layout_golden.json`, congelado sobre main).
//
// MULTIMARCA: cero marcas y cero canales en el código. Qué canal apaga la franja o abre el encuadre es
// una fila de `imagelab_overlay_tokens`.

/** Mezcla de capas de tokens: la de encima manda clave a clave; dos objetos se mezclan, todo lo demás se
 *  reemplaza. Es la misma regla que `deepMergeTokens` de `api/compose.ts` (el test lo comprueba). */
export function mergeTokenLayers(base: any, over: any): any {
  const plain = (v: any) => v != null && typeof v === 'object' && !Array.isArray(v);
  const out: Record<string, any> = { ...(plain(base) ? base : {}) };
  for (const k of Object.keys(plain(over) ? over : {})) {
    out[k] = plain(out[k]) && plain(over[k]) ? mergeTokenLayers(out[k], over[k]) : over[k];
  }
  return out;
}

/** Las claves de `layout` que este bloque lee del generador. Una fila de canal que no declara ninguna
 *  (las de carrusel de hoy: scrim, anclaje y ancho) se mezcla igual, pero no se anuncia en la respuesta. */
export const GENERATOR_LAYOUT_KEYS = ['text_zone_pct', 'subject_framing'] as const;

/** Los tokens que valen para (marca, canal). La fila de canal sólo cuenta si es de ESTE canal y trae
 *  tokens; si no, se devuelven los de marca tal cual (el mismo objeto: nada cambia). `declared` son las
 *  claves de `GENERATOR_LAYOUT_KEYS` que la fila del canal declara en su propio `layout`. */
export function overlayTokensForCanal(brandTokens: any | null, canalRow: any | null, canal: string | null | undefined): { tokens: any | null; canal: string | null; declared: string[] } {
  const want = String(canal ?? '').trim().toUpperCase();
  const got = String(canalRow?.canal ?? '').trim().toUpperCase();
  const t = canalRow?.tokens;
  if (!want || got !== want || t == null || typeof t !== 'object' || Array.isArray(t)) return { tokens: brandTokens, canal: null, declared: [] };
  const lay = t.layout != null && typeof t.layout === 'object' ? t.layout : {};
  return { tokens: mergeTokenLayers(brandTokens, t), canal: want, declared: GENERATOR_LAYOUT_KEYS.filter((k) => k in lay) };
}

/** El vocabulario del encuadre. `tight` es el de siempre. */
export const SUBJECT_FRAMINGS = ['tight', 'scene'] as const;
export type SubjectFraming = typeof SUBJECT_FRAMINGS[number];

/** El encuadre que declara el dato (`layout.subject_framing`). Ausente: `tight`. Ajeno: `tight` y aviso. */
export function resolveSubjectFraming(layout: any): { framing: SubjectFraming; declared: boolean; warning: string | null } {
  const raw = layout?.subject_framing;
  if (raw === undefined || raw === null || raw === '') return { framing: 'tight', declared: false, warning: null };
  const v = String(raw).trim().toLowerCase();
  if ((SUBJECT_FRAMINGS as readonly string[]).includes(v)) return { framing: v as SubjectFraming, declared: true, warning: null };
  return { framing: 'tight', declared: false, warning: `layout.subject_framing=${JSON.stringify(raw)} no es uno de ${SUBJECT_FRAMINGS.join(', ')}: se usa tight` };
}

/** ENCUADRE DE ESCENA. La cláusula ceñida dice dos cosas: (a) el sujeto llena el cuadro y (b) sin una
 *  zona vacía grande arriba. (a) contradice un plano cenital o un detalle de manos; (b) es el defecto
 *  medido el 2026-09-27 y sigue valiendo en cualquier plano. Por eso `scene` no OMITE la cláusula: la
 *  cambia por una que conserva (b) y deja el ángulo y la distancia a la escena. No depende del número
 *  de personas: «todas enteras en el cuadro» es justo lo que un detalle de manos no cumple. */
export const SCENE_FRAMING_CLAUSE =
  'Frame the shot the way the scene describes it: a wide shot, a top-down overhead view or a close-up detail of hands or objects are all valid, ' +
  'and the camera angle and distance follow the scene rather than a portrait framing. Whatever the framing, the scene fills the frame — no large empty area of ceiling, wall or sky';

/** El encuadre para N personas según el dato. Con `tight`, exactamente `subjectFramingClause(n)`. */
export function framingClause(framing: SubjectFraming | null | undefined, count: number): string {
  return framing === 'scene' ? SCENE_FRAMING_CLAUSE : subjectFramingClause(count);
}

/** Identidad sin vestuario, para N personas. Con una, la constante literal de siempre. */
export function personaIdentityOnlyClause(count: number): string {
  if (count < 2) return PERSONA_IDENTITY_ONLY_CLAUSE;
  return 'The reference photos of each person define that person\'s identity only — face, hair, skin tone and build. Do NOT copy their clothing, jewellery, pose, background or lighting: ' +
    'dress and pose each person for THIS scene, with outfits different from the ones in the reference photos';
}

const SUBJECT_LETTERS = 'ABCDEFGHIJ';
/** La letra de rol de la persona i (0 → A). */
export function subjectLetter(i: number): string { return SUBJECT_LETTERS[i] ?? String(i + 1); }

/**
 * EL PRESUPUESTO DE IMÁGENES DE ENTRADA. Recibe las fotos DISPONIBLES de cada persona nombrada (en
 * orden A, B…), del lugar y del producto; devuelve cuáles viajan.
 *
 * Con 0 o 1 persona: la regla de siempre, sin presupuesto (persona 3, o 2 si hay lugar o producto;
 * lugar 1; producto 2). Con 2 o más: `MODEL_MAX_INPUT_IMAGES`, repartido en este orden y por este motivo:
 *   1. una foto por persona — sin foto, el modelo inventa la cara (medido, M1 de la ronda 1);
 *   2. una del producto, si lo hay — un envase sin foto es un envase inventado; si no cabe, se excede
 *      el presupuesto en esa una y se declara en `over_budget`;
 *   3. más fotos de las personas, de a una y empezando por A (hasta 2 por persona);
 *   4. el lugar, sólo si aún queda plaza — también va descrito en texto, así que es lo primero que cede.
 *
 * ⛔ NO OPERATIVO — orden anterior (2026-10-03, PR #39), se conserva por trazabilidad: persona →
 * producto → LUGAR → fotos extra. Medido en producción (5c05a19) el mismo día, set de podcast con dos
 * personas: con la foto del lugar, cada persona viajó con UNA foto y la identidad cumplió en 3 de 6
 * tomas (la entrevistadora perdió el largo de pelo y la edad). Con el lugar sólo en texto y la
 * entrevistadora con 2 fotos, 6 de 6 (hojas `motor_personas_A.jpg` y `motor_personas_A2.jpg`).
 */
export function allocateReferences(args: { personaRefs: string[][]; locationRefs: string[]; productRefs: string[] }): {
  persona: string[][]; location: string[]; product: string[];
  budget: number | null; over_budget: boolean; dropped: { persona: number; location: number; product: number };
} {
  const pr = args.personaRefs ?? [];
  const lr = args.locationRefs ?? [];
  const xr = args.productRefs ?? [];
  if (pr.length <= 1) {
    const location = lr.slice(0, MAX_LOCATION_REFS);
    const product = xr.slice(0, MAX_PRODUCT_REFS);
    const cap = location.length || product.length ? MAX_PERSONA_REFS_WITH_OTHERS : MAX_PERSONA_REFS;
    const persona = pr.map((r) => (r ?? []).slice(0, cap));
    return { persona, location, product, budget: null, over_budget: false,
      dropped: { persona: (pr[0]?.length ?? 0) - (persona[0]?.length ?? 0), location: lr.length - location.length, product: xr.length - product.length } };
  }
  const budget = MODEL_MAX_INPUT_IMAGES;
  const counts = pr.map((r) => ((r ?? []).length ? 1 : 0));
  let used = counts.reduce((a, b) => a + b, 0);
  const product = xr.length ? xr.slice(0, 1) : [];
  used += product.length;
  let grew = true;
  while (used < budget && grew) {
    grew = false;
    for (let i = 0; i < pr.length && used < budget; i++) {
      const cap = Math.min((pr[i] ?? []).length, MAX_PERSONA_REFS_WITH_OTHERS);
      if (counts[i] < cap) { counts[i]++; used++; grew = true; }
    }
  }
  const location = lr.length && used < budget ? lr.slice(0, 1) : [];
  used += location.length;
  const persona = pr.map((r, i) => (r ?? []).slice(0, counts[i]));
  const totalPersona = pr.reduce((a, r) => a + (r ?? []).length, 0);
  return {
    persona, location, product, budget, over_budget: used > budget,
    dropped: { persona: totalPersona - persona.reduce((a, r) => a + r.length, 0), location: lr.length - location.length, product: xr.length - product.length },
  };
}

/**
 * Las cláusulas del motor que se reponen sobre la síntesis, en el orden de siempre. Con 0 o 1 persona,
 * sin mirada ni texto permitido como dato, la lista es LITERALMENTE la anterior al 2026-10-03.
 */
export function engineClausesFor(args: {
  mode: GenerationMode; textZone: string; personaCount: number; gaze: PersonaGaze | null;
  placement: string; productInScene: boolean; productComposited: boolean; angleSeed: string;
  allowedSceneText?: string[] | null;
  /** 2026-10-03 — el encuadre como dato (`layout.subject_framing`). Ausente: `tight`, el de siempre. */
  framing?: SubjectFraming | null;
}): string[] {
  const n = args.personaCount;
  const edit = args.mode === 'edit_from_current';
  return [noTextClause(args.allowedSceneText), DISTINCT_SUBJECTS_CLAUSE, SINGLE_FRAME_CLAUSE, lightingCoherenceClause(n),
    ...(edit ? [] : [framingClause(args.framing, n), ...(args.textZone ? [args.textZone] : []),
      ...(n > 0 ? [personaIdentityOnlyClause(n)] : []), ...(args.placement ? [args.placement] : [])]),
    ...(n > 0 ? [gazeClause(args.gaze, n)] : []),
    ...(args.productInScene && !edit ? [productAngleClause(args.angleSeed)] : []),
    ...(args.productComposited && !args.productInScene ? [PRODUCT_COMPOSITED_CLAUSE] : [])];
}

export interface PromptBuilderInput {
  basePrompt: string;
  copyFull: string;
  title?: string | null;
  imageHook?: string | null;
  domainDirective?: string | null;
  directives?: string[];
  persona?: PromptPersona | null;
  mode?: GenerationMode | null;
  location?: PromptLocation | null;
  productComposited?: boolean;
  product?: PromptProduct | null;
  // 2026-10-03 — varias personas. Si llegan dos o más NOMBRADAS, cada una entra rotulada (A, B…); con
  // una o ninguna, manda `persona` y el mensaje es el de siempre.
  personas?: PromptPersona[] | null;
}

/** El constructor corre sólo cuando el llamante manda el copy ENTERO. Sin eso, el camino de hoy. */
export function shouldSynthesize(params: { copy_full?: unknown } | null | undefined): boolean {
  return typeof params?.copy_full === 'string' && params.copy_full.trim().length > 0;
}

/** Directrices limpias y en orden: se descartan vacías y duplicadas CONSECUTIVAS, nunca se reordenan. */
export function normalizeDirectives(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const d of raw) {
    const s = typeof d === 'string' ? d.trim() : '';
    if (!s) continue;
    if (out.length && out[out.length - 1] === s) continue;
    out.push(s);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * ¿La pieza o alguna directriz NOMBRA a la persona? Por nombre o por alias declarado, palabra
 * completa y sin distinguir mayúsculas. Si no se nombra, la persona NO entra en la escena: una marca
 * con persona no obliga a que la persona salga en todas sus imágenes.
 */
export function personaMentioned(persona: PromptPersona | null | undefined, texts: Array<string | null | undefined>): boolean {
  if (!persona?.name?.trim()) return false;
  const names = [persona.name, ...(persona.aliases ?? [])].map((n) => (n ?? '').trim()).filter(Boolean);
  const hay = texts.filter((t): t is string => typeof t === 'string' && t.length > 0).join('\n');
  if (!hay) return false;
  return names.some((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(n)}($|[^\\p{L}\\p{N}])`, 'iu').test(hay));
}

/** El mensaje de usuario para el modelo de texto. Rotulado, para que el modelo sepa qué es cada cosa. */
export function buildBuilderUserMessage(input: PromptBuilderInput): string {
  const directives = normalizeDirectives(input.directives ?? []);
  const withPersona = personaEntersScene(input.persona, [input.copyFull, input.title, input.imageHook, ...directives]);
  const parts: string[] = [];
  parts.push(`MODE: ${input.mode ?? 'regenerate_full'}`);
  parts.push(`BASE PROMPT (engine-composed; keep every constraint in it):\n${input.basePrompt}`);
  if (input.title?.trim()) parts.push(`PIECE — TITLE:\n${input.title.trim()}`);
  if (input.imageHook?.trim()) parts.push(`PIECE — TEXT ON IMAGE (composed later by code, never drawn):\n${input.imageHook.trim()}`);
  parts.push(`PIECE — FULL BODY:\n${input.copyFull.trim()}`);
  if (input.domainDirective?.trim()) parts.push(`DOMAIN DIRECTIVE:\n${input.domainDirective.trim()}`);
  if (directives.length) {
    parts.push(`HUMAN DIRECTIVES (chronological; later ones refine earlier ones; if two conflict, the later wins):\n${directives.map((d, k) => `${k + 1}. ${d}`).join('\n')}`);
  }
  const many = scenePersonas(input.personas ?? [], [input.copyFull, input.title, input.imageHook, ...directives]);
  if (many.length >= 2) {
    parts.push(
      `PEOPLE — exactly ${many.length} recurring people of this brand appear in this scene, each one exactly once and each a ` +
      `different individual: ${many.map((p, k) => `SUBJECT ${subjectLetter(k)} = "${p.name.trim()}"`).join(', ')}. ` +
      'Describe every one of them in the scene, by name, with their own features; never merge, swap or duplicate them.',
    );
    many.forEach((p, k) => {
      const refs = (p.reference_image_urls ?? []).length;
      parts.push(
        `PERSONA ${subjectLetter(k)} — "${p.name.trim()}" is a real, recurring person of this brand. They must look exactly like this` +
        `${refs ? ` and like their own attached reference photo(s) (SUBJECT ${subjectLetter(k)})` : ''}:\n${p.description.trim()}`,
      );
      parts.push(`PERSONA ${subjectLetter(k)} EXPRESSION:\n${personaExpressionBlock(p)}`);
      parts.push(`PERSONA ${subjectLetter(k)} WARDROBE:\n${personaWardrobeBlock(p, input.mode)}`);
    });
  } else if (withPersona && input.persona) {
    const refs = (input.persona.reference_image_urls ?? []).length;
    // La voz autora no tiene por qué estar nombrada: el «whenever … names them» de siempre la dejaría fuera.
    const when = isAuthorVoiceEntry(input.persona)
      ? 'The piece is written in their own voice: they appear in the scene, and'
      : 'Whenever the piece or a directive names them,';
    parts.push(
      `PERSONA — "${input.persona.name.trim()}" is a real, recurring person of this brand. ${when} ` +
      `they must look exactly like this${refs ? ' and like the attached reference photo(s)' : ''}:\n${input.persona.description.trim()}`,
    );
    parts.push(`PERSONA EXPRESSION:\n${personaExpressionBlock(input.persona)}`);
    parts.push(`PERSONA WARDROBE:\n${personaWardrobeBlock(input.persona, input.mode)}`);
  }
  if (input.location?.name?.trim() && input.location.description?.trim()) {
    const refs = (input.location.reference_image_urls ?? []).length;
    parts.push(
      `LOCATION — the scene takes place at "${input.location.name.trim()}", a real place of this brand` +
      `${refs ? ' shown in the attached location photo(s)' : ''}. It is the BACKDROP: keep its materials, colours and style ` +
      `recognizable and do not invent another place, but the camera frames the subject, not the room — the place never ` +
      `dominates the person:\n${input.location.description.trim()}`,
    );
    const allowed = normalizeAllowedSceneText(input.location.allowed_scene_text);
    if (allowed.length) {
      parts.push(
        `ALLOWED SCENE TEXT — this place shows ${allowed.map((w) => `"${w}"`).join(', ')} (for example on a lit sign). ` +
        'Those words are part of the place: keep them, exactly as written, where the place shows them. They are the ONLY text allowed in the image.',
      );
    }
  }
  if (input.product?.items?.length) {
    parts.push(
      `PRODUCT — the real packaging of ${input.product.items.map((i) => `"${i.name}"`).join(', ')} appears in the scene` +
      ' (held in a hand or placed naturally on a surface), reproduced faithfully from the attached product photo(s): same shape, colours and label layout.' +
      ` Real physical size — ${input.product.items.map(productSizeLine).join('; ')}. Do not add any other product or packaging.`,
    );
  } else if (input.productComposited) parts.push(`PRODUCT:\n${PRODUCT_COMPOSITED_CLAUSE}.`);
  return parts.join('\n\n');
}

/**
 * Las cláusulas del motor NO se negocian con el modelo de texto: si la síntesis las pierde o las
 * parafrasea, se reponen literales al frente. Van en el orden del bloque C —primero la de sin texto,
 * después la de sujetos distintos— y después la síntesis.
 */
export function enforceEngineClauses(synth: string, clauses: string[]): string {
  const body = (synth ?? '').trim();
  const missing = clauses.filter((c) => c && !body.includes(c));
  return [...missing.map((c) => `${c}.`), body].filter(Boolean).join(' ');
}

/** Rol de las imágenes adjuntas, en lenguaje natural: Gemini-image no tiene bindings de tipo. */
export function imageRoleClause(args: {
  hasSource: boolean; personaName?: string | null; personaRefs: number;
  locationName?: string | null; locationRefs?: number;
  productNames?: string[] | null; productRefs?: number;
  // 2026-10-03 — dos o más personas: cada una con cuántas fotos suyas viajan, en el orden de las imágenes.
  personas?: Array<{ name: string; refs: number }> | null;
}): string {
  if ((args.personas ?? []).length >= 2) return labeledReferencesClause(args as typeof args & { personas: Array<{ name: string; refs: number }> });
  const c: string[] = [];
  const locRefs = args.locationName ? Math.max(0, args.locationRefs ?? 0) : 0;
  const perRefs = args.personaName ? Math.max(0, args.personaRefs) : 0;
  const prodRefs = args.productNames?.length ? Math.max(0, args.productRefs ?? 0) : 0;
  if (perRefs + locRefs + prodRefs > 0) c.push(`${REFERENCE_PHOTOS_CLAUSE}.`);
  if (args.hasSource) {
    c.push('The FIRST attached image is the current version of this image: edit it. Keep its composition, subjects, lighting and style, and change only what the instructions ask for.');
  }
  // Sin locación, la redacción de siempre. Con locación, las imágenes se nombran por POSICIÓN: el
  // modelo no tiene otra forma de saber cuál es la persona y cuál el lugar.
  if (!locRefs && !prodRefs) {
    if (perRefs > 0) {
      const which = args.hasSource ? 'The other attached image(s)' : 'The attached image(s)';
      c.push(`${which} show ${args.personaName}: whenever ${args.personaName} appears, keep that exact face and identity (never copy their clothing or pose).`);
    }
    return c.join(' ');
  }
  let at = args.hasSource ? 2 : 1;
  const span = (n: number) => (n === 1 ? `Attached image ${at}` : `Attached images ${at} to ${at + n - 1}`);
  if (perRefs > 0) {
    c.push(`${span(perRefs)} show ${args.personaName}: whenever ${args.personaName} appears, keep that exact face and identity (never copy their clothing or pose).`);
    at += perRefs;
  }
  if (locRefs > 0) {
    c.push(`${span(locRefs)} show the real place "${args.locationName}": set the scene there as the backdrop, keeping its materials, colours and style recognizable; frame the subject, not the room. Do not copy any person from those photos.`);
    at += locRefs;
  }
  if (prodRefs > 0) {
    c.push(`${span(prodRefs)} show the real product packaging (${args.productNames!.join(', ')}): paint it into the scene at its real size, faithful to that photo.`);
  }
  return c.join(' ');
}

/**
 * EL CONSTRUCTOR DE REFERENCIAS ROTULADAS. Cada imagen se nombra por POSICIÓN y por ROL
 * («Image 1–2: SUBJECT A, <nombre>»): el modelo no tiene otra forma de saber de quién es cada cara, y
 * la prueba de la ronda 1 (2026-10-03) mostró que, rotuladas así, separa las identidades.
 * El orden es el mismo en que se adjuntan las imágenes: actual (si se edita), personas, lugar,
 * producto y estilo. Lo usan el carril con 2+ personas y el modo `direct` de la UI cuando manda
 * `slots` (2026-10-03): los dos caminos rotulan igual.
 */
export function labeledReferencesClause(args: {
  hasSource: boolean; personas: Array<{ name: string; refs: number }>;
  locationName?: string | null; locationRefs?: number; productNames?: string[] | null; productRefs?: number;
  styleRefs?: number;
}): string {
  const c: string[] = [];
  const people = args.personas.map((p, i) => ({ name: String(p.name ?? '').trim(), refs: Math.max(0, p.refs ?? 0), letter: subjectLetter(i) }));
  const locRefs = args.locationName ? Math.max(0, args.locationRefs ?? 0) : 0;
  const prodRefs = args.productNames?.length ? Math.max(0, args.productRefs ?? 0) : 0;
  if (people.some((p) => p.refs > 0) || locRefs + prodRefs + Math.max(0, args.styleRefs ?? 0) > 0) c.push(`${REFERENCE_PHOTOS_CLAUSE}.`);
  if (args.hasSource) {
    c.push('The FIRST attached image is the current version of this image: edit it. Keep its composition, subjects, lighting and style, and change only what the instructions ask for.');
  }
  let at = args.hasSource ? 2 : 1;
  const span = (n: number) => (n === 1 ? `Image ${at}` : `Images ${at}–${at + n - 1}`);
  const labels: string[] = [];
  for (const p of people) {
    if (!p.refs) continue;
    labels.push(`${span(p.refs)}: SUBJECT ${p.letter}, ${p.name}.`);
    at += p.refs;
  }
  if (locRefs > 0) {
    labels.push(`${span(locRefs)}: BACKGROUND, the real place "${args.locationName}" — set the scene there, keeping its materials, colours and style recognizable; do not copy any person from it.`);
    at += locRefs;
  }
  if (prodRefs > 0) {
    labels.push(`${span(prodRefs)}: PRODUCT, the real packaging (${args.productNames!.join(', ')}) — paint it into the scene at its real size, faithful to that photo.`);
    at += prodRefs;
  }
  const styleRefs = Math.max(0, args.styleRefs ?? 0);
  if (styleRefs > 0) {
    labels.push(`${span(styleRefs)}: STYLE reference only — match its light, colour and photographic look; never copy its content, place or people.`);
  }
  if (labels.length) c.push(`The attached images, by position: ${labels.join(' ')}`);
  if (people.length === 1) {
    const p = people[0];
    if (p.refs) c.push(`Whenever ${p.name} appears, keep that exact face and identity (never copy their clothing or pose).`);
    return c.join(' ');
  }
  if (!people.length) return c.join(' ');
  const names = people.map((p) => `SUBJECT ${p.letter} (${p.name})`);
  const noPhoto = people.filter((p) => !p.refs).map((p) => p.name);
  c.push(
    `The scene shows exactly ${people.length} different people — ${names.join(', ')} — each one exactly once. ` +
    'Each keeps the face, hair, skin tone and build of their OWN reference image(s), never those of another subject; never merge, swap, blend or duplicate them, and never add a lookalike. ' +
    (noPhoto.length ? `${noPhoto.join(', ')} ${noPhoto.length === 1 ? 'has' : 'have'} no photo: follow the written description. ` : '') +
    'Never copy clothing or pose from the photos.',
  );
  return c.join(' ');
}
// ── PB:END ──

/**
 * Assemble the preset-driven prompt per the spec:
 *   "{reference_aesthetic} aesthetic. {composition_rule}. {lighting_style}.
 *    {color_grading}. Mood: {mood}. Concept: {job_prompt}.
 *    Brand DNA: {brand_dna}. {texture}.
 *    Photorealistic, 8K, large format cinema. FORBIDDEN: {negative_prompt}."
 *
 * ⚠️ #95-C — este builder ya NO gobierna el camino del Orchestrator/IID (lo hace
 * `composeVisualPrompt`). Se conserva porque **`generateImageDirect` (modo `direct`, el de la UI)
 * sigue llamándolo**. Reconvertir ese camino es la deuda #100.
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
 * Orchestrator/IID prompt builder — UNIFICADO (#95-C).
 *
 * Antes eran dos ramas excluyentes y ninguna completa (ver el bloque C). Ahora una sola:
 *
 *   1. Normaliza el canal (#95-D): MAYÚSCULAS + alias legacy.
 *   2. Carga EN PARALELO las cuatro capas: marca · preset de marca · preset global · estímulo.
 *   3. Las fusiona (`mergeVisualSpec`) y compone (`composeVisualPrompt`), las dos puras.
 *
 * Lo que cambia respecto de antes, en una línea cada uno:
 *   · La identidad de marca llega SIEMPRE, haya preset o no. Antes, tener preset la anulaba.
 *   · Las 10 columnas del preset que espejan los ejes de marca **se leen**. Antes se ignoraban.
 *   · El `psycho_preset` entra en las DOS ramas. Antes solo en la legacy, así que identidad y
 *     estímulo nunca coincidían en la misma imagen.
 *   · El preset GLOBAL (7 filas, `brand_id IS NULL`) es alcanzable. Antes, nunca.
 *   · El negativo es ACUMULATIVO: lo prohibido por la marca sigue prohibido aunque el canal sume.
 */
async function buildVisualPrompt(req: ExecuteRequest): Promise<ImageGenInput> {
  const brandId  = req.brandId ?? 'DEFAULT';
  const canalRaw = req.params.canal;
  const canal    = normalizeCanal(canalRaw);
  if (canalRaw && canal !== String(canalRaw).trim().toUpperCase()) {
    console.log(`[ImageLab][#95-D] canal '${canalRaw}' → '${canal}' (alias legacy)`);
  }
  const psychoId = req.params.psycho_preset;

  const copyOutput  = req.previousOutputs?.copylab ?? req.previousOutputs?.CopyLab ?? '';
  const conceptText = (req.params.subject ?? req.stage.description ?? '').trim();

  // Las cuatro capas, en paralelo. `sb()` grita ante fallo de query desde #95-B, así que una capa
  // que no llegue por error deja rastro; una que no llegue por ausencia legítima, no.
  const [brand, brandPreset, globalPreset, psycho] = await Promise.all([
    sb<any>(
      `brands?id=eq.${encodeURIComponent(brandId)}&select=` +
      `id,display_name,imagelab_visual_identity,imagelab_compliance_rules,imagelab_industry,` +
      `imagelab_realism_level,imagelab_film_look,imagelab_lens_preset,imagelab_depth_of_field,` +
      `imagelab_framing,imagelab_skin_detail,imagelab_imperfections,imagelab_humidity_level,` +
      `imagelab_sweat_level,imagelab_grain_level,default_negative_prompt`,
    ),
    loadImagelabPreset(brandId, canal),
    loadGlobalPreset(canal),
    // DEGRADACIÓN LIMPIA (#99): sin `psycho_preset` no se consulta y el prompt sale sin capa
    // psicológica. Es el estado ESPERADO del camino sync — el estímulo pertenece al flujo async.
    psychoId ? sb<any>(`psycho_presets?id=eq.${encodeURIComponent(psychoId)}&select=*`) : null,
  ]);

  if (psychoId && !psycho) {
    // Se PIDIÓ un estímulo y no se encontró: eso no es degradación esperada, es un id que no
    // resuelve. Distinto de "no se pidió" — y por eso se avisa solo en este caso.
    console.warn(`[ImageLab][#95-C] psycho_preset '${psychoId}' no resuelve a ninguna fila activa; la pieza sale sin capa psicológica`);
  }

  const spec = mergeVisualSpec(brand, brandPreset, globalPreset, psycho);

  const aspectRatio = req.params.aspect_ratio
    ?? spec.aspect_ratio
    ?? (canal.includes('REEL') || canal.includes('STORY') || canal === 'TIKTOK' ? '9:16' : '1:1');

  const prompt = composeVisualPrompt(spec, conceptText || `producto de ${brand?.display_name ?? brandId}`, {
    styleNotes: req.params.style_notes ?? null,
    copyTheme:  copyOutput ? String(copyOutput).slice(0, 150) : null,
    sceneDirective: req.params.visual_directive ?? null,
    // 2026-10-03 — las palabras que el lugar muestra (dato del lugar); sin ellas, la cláusula de siempre.
    allowedSceneText: normalizeAllowedSceneText(req.params.location?.allowed_scene_text),
  });

  console.log(
    `[ImageLab][#95-C] brand=${brandId} canal=${canal} preset=${spec.preset_source}` +
    `${spec.preset_id ? `(${spec.preset_id})` : ''} identidad=${spec.visual_identity ? 'sí' : 'NO'} ` +
    `ejes=${Object.keys(spec.ejes).length}/10 psycho=${spec.psycho_id ?? 'ninguno'}`,
  );

  return {
    prompt,
    negativePrompt: spec.negative,
    aspectRatio,
    brandName: brand?.display_name ?? brandId,
    canal,
    presetUsed: spec.preset_source !== 'none',
    presetId: spec.preset_id,
    psychoId: spec.psycho_id,
  };
}

// --- Vertex AI Gemini 2.5 Flash Image -------------------------------------

const GEMINI_IMAGE_URL = () =>
  `${vertexBaseUrl(GCP_LOCATION(), GCP_PROJECT())}/publishers/google/models/${GEMINI_IMAGE_MODEL}:generateContent`;

/**
 * Gemini-image has no negativePrompt parameter — absorb it into the text body
 * as an "Avoid: ..." clause.
 */
function appendNegative(prompt: string, negativePrompt?: string): string {
  const neg = (negativePrompt ?? '').trim();
  if (!neg) return prompt;
  return `${prompt} Avoid: ${neg}.`;
}

// ── RESPUESTA-IMAGEN:BEGIN ── bloque puro (sin red): lo extrae `tests/contrato_de_fallo_test.mjs`.
/**
 * Pull the first inline image out of a Gemini :generateContent response.
 * Returns a `data:<mime>;base64,<...>` URL. Throws with the block/finish reason
 * if no image part is present.
 */
function extractInlineImage(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const imgPart = parts.find((p: any) => p?.inlineData?.data);
  if (!imgPart) {
    const block   = data?.promptFeedback?.blockReason;
    const finish  = data?.candidates?.[0]?.finishReason;
    const extra   = block ? ` (blockReason=${block})` : finish ? ` (finishReason=${finish})` : '';
    throw new Error(`Gemini image: no inlineData returned${extra}.`);
  }
  const mime = imgPart.inlineData.mimeType ?? 'image/png';
  return `data:${mime};base64,${imgPart.inlineData.data}`;
}

// M-3 / Unidad 1 — el consumo facturable, TAL COMO Vertex lo reporta. La respuesta de
// :generateContent trae `usageMetadata` con { promptTokenCount, candidatesTokenCount,
// totalTokenCount }; para gemini-2.5-flash-image la imagen se factura como un bloque fijo de
// tokens de SALIDA (candidatesTokenCount), no por unidad. Se devuelve el objeto CRUDO (o null si
// no viene): el productor no inventa un esquema ni fabrica ceros — el consumidor decide el mapeo
// con el dato real. El log deja la forma exacta a la vista en cada llamada: hasta v7 el body se
// descartaba antes de mirarlo, así que si `usageMetadata` está o no era indecidible desde el código.
function extractUsage(data: any): Record<string, number> | null {
  const um = data?.usageMetadata;
  console.log(`[ImageLab][M-3] Vertex usageMetadata: ${um ? JSON.stringify(um) : 'ABSENT'}`);
  if (!um || typeof um !== 'object') return null;
  return um as Record<string, number>;
}

// Lo que un generador de imagen devuelve puertas adentro: la imagen + la procedencia del consumo.
interface ImageWithUsage {
  image_data_url: string;
  usage: Record<string, number> | null;
}

/** Una respuesta 2xx de imagen. El consumo se lee ANTES de buscar la imagen: hasta el 2026-10-01
 *  `extractInlineImage` lanzaba primero y el `usageMetadata` de una respuesta bloqueada (que el
 *  proveedor sí reporta) se perdía con la excepción. Ahora viaja dentro del error. */
function imageFromResponse(data: any, httpStatus: number): ImageWithUsage {
  const usage = extractUsage(data);
  try {
    return { image_data_url: extractInlineImage(data), usage };
  } catch (err) {
    // 2026-10-05 — los motivos del proveedor viajan también como dato, crudos: el texto del error los
    // nombra, pero leerlos de un texto es un regex que se rompe cuando el texto cambia.
    const block = data?.promptFeedback?.blockReason;
    const finish = data?.candidates?.[0]?.finishReason;
    throw new ProviderCallError(err instanceof Error ? err.message : String(err), 'image', httpStatus, usage, {
      blockReason: typeof block === 'string' ? block : null,
      finishReason: typeof finish === 'string' ? finish : null,
    });
  }
}
// ── RESPUESTA-IMAGEN:END ──

/**
 * Text-to-image via gemini-2.5-flash-image:generateContent.
 * (Name retained from the Imagen era to keep call sites stable.)
 */
async function vertexPredictImagen(params: {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
}): Promise<ImageWithUsage> {
  if (!GCP_PROJECT()) throw new Error('GOOGLE_CLOUD_PROJECT missing in env.');

  const token = await getAccessToken();
  const text = appendNegative(params.prompt, params.negativePrompt);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(GEMINI_IMAGE_URL(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text }],
        }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: normalizeAspectRatio(params.aspectRatio),
          },
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new ProviderCallError(`Gemini image error ${res.status}: ${await res.text()}`, 'image', res.status, null);

    const data = await res.json();
    return imageFromResponse(data, res.status);
  } catch (err) {
    const fallo = asProviderCallError(err, 'image', `Gemini image timeout after ${UPSTREAM_TIMEOUT_MS / 1000}s.`);
    fallo.promptSent = text;
    throw fallo;
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
  model?: string;      // accepted for compatibility; ignored — gemini-2.5-flash-image is the only model.
  // 2026-10-03 — los ESPACIOS de la UI, cada imagen con su rol. Si llega, manda sobre
  // `sourceAssetDataUrl`/`referenceImages` y las imágenes se rotulan por posición con el MISMO
  // constructor que el carril (`labeledReferencesClause`). Sin `slots`, el camino de siempre.
  slots?: DirectSlots;
}

/** Los espacios de la UI sync (Slot A, Slot C «Subj 2», Slot B fondo, producto, Ref 1–3 estilo). */
export interface DirectSlots {
  subjects?: Array<{ dataUrl: string; label?: string }>;
  background?: { dataUrl: string; label?: string } | null;
  product?: Array<{ dataUrl: string; label?: string }>;
  style?: Array<{ dataUrl: string; label?: string }>;
}

// --- Gemini 2.5 Flash Image — multimodal (subject / style references) -----

/** Strip the `data:image/...;base64,` header and return just the base64 payload. */
function dataUrlBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** Infer the mimeType from a data URL header (default image/png). */
function dataUrlMime(dataUrl: string): string {
  const m = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return m?.[1] || 'image/png';
}

/** Is this reference image meant as a STYLE ref (not a subject)? Used only to
 *  word the prompt text — Gemini-image has no REFERENCE_TYPE system. */
function looksLikeStyleRef(label?: string): boolean {
  const l = (label ?? '').toLowerCase();
  return /(style|aesthetic|mood|look|grade|grading|reference|ref\b|palette|art\s*direction|inspiration)/.test(l);
}

interface InlineImage { mimeType: string; data: string; }

/**
 * Multimodal (subject/style references) via gemini-2.5-flash-image:generateContent.
 * Each reference image is an `inlineData` part; their roles are described in the
 * text prompt (Gemini-image has no REFERENCE_TYPE_SUBJECT/STYLE bindings).
 * (Name retained from the Imagen era to keep call sites stable.)
 */
async function vertexPredictImagenCapability(params: {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  images: InlineImage[];
}): Promise<ImageWithUsage> {
  if (!GCP_PROJECT()) throw new Error('GOOGLE_CLOUD_PROJECT missing in env.');

  const token = await getAccessToken();

  const parts: any[] = params.images.map(img => ({
    inlineData: { mimeType: img.mimeType, data: img.data },
  }));
  const text = appendNegative(params.prompt, params.negativePrompt);
  parts.push({ text });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(GEMINI_IMAGE_URL(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: normalizeAspectRatio(params.aspectRatio),
          },
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new ProviderCallError(`Gemini image (multimodal) error ${res.status}: ${await res.text()}`, 'image', res.status, null);

    const data = await res.json();
    return imageFromResponse(data, res.status);
  } catch (err) {
    const fallo = asProviderCallError(err, 'image', `Gemini image (multimodal) timeout after ${UPSTREAM_TIMEOUT_MS / 1000}s.`);
    fallo.promptSent = text;
    throw fallo;
  } finally {
    clearTimeout(timeout);
  }
}

// ── SLOTS:BEGIN ── (2026-10-03) bloque PURO: de los espacios de la UI a imágenes y rótulo. Lo extrae
// `tests/personas_test.mjs` junto con C y PB.
export function directSlotsPlan(slots: DirectSlots): { images: Array<{ mimeType: string; data: string }>; clause: string; error: string | null } {
  const ok = (x: any) => x && typeof x.dataUrl === 'string' && x.dataUrl.startsWith('data:');
  const subjects = (slots.subjects ?? []).filter(ok);
  if (subjects.length > MAX_PERSONAS_PER_IMAGE) {
    return { images: [], clause: '', error: `PERSONAS_TOO_MANY: ${subjects.length} sujetos; el motor acepta hasta ${MAX_PERSONAS_PER_IMAGE} por imagen` };
  }
  const background = ok(slots.background) ? [slots.background!] : [];
  const product = (slots.product ?? []).filter(ok);
  const style = (slots.style ?? []).filter(ok);
  const toInline = (d: string) => {
    const comma = d.indexOf(',');
    const m = /^data:([^;,]+)[;,]/.exec(d);
    return { mimeType: m?.[1] || 'image/png', data: comma >= 0 ? d.slice(comma + 1) : d };
  };
  const images = [...subjects, ...background, ...product, ...style].map((x) => toInline(x.dataUrl));
  const clause = labeledReferencesClause({
    hasSource: false,
    personas: subjects.map((x, i) => ({ name: (x.label ?? '').trim() || `subject ${subjectLetter(i)}`, refs: 1 })),
    locationName: background.length ? ((background[0].label ?? '').trim() || 'the background') : null, locationRefs: background.length,
    productNames: product.length ? product.map((x, i) => (x.label ?? '').trim() || `product ${i + 1}`) : null, productRefs: product.length,
    styleRefs: style.length,
  });
  return { images, clause, error: null };
}
// ── SLOTS:END ──

interface DirectImageResult {
  image_data_url: string;
  preset_used: boolean;
  preset_id: string | null;
  usage: Record<string, number> | null;   // M-3 — usageMetadata crudo de Vertex (o null)
}

async function generateImageDirect(
  req: DirectImageRequest,
  fallo: FailurePromptContext = emptyFailurePromptContext(),   // 2026-10-05 — lo lee el cuerpo del fallo
): Promise<DirectImageResult> {
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

  fallo.presetId = presetId;
  fallo.negativePrompt = negativePrompt;

  // 2026-10-03 — espacios de la UI: imágenes en orden sujetos → fondo → producto → estilo, cada una
  // rotulada por posición y rol. Mismo techo de personas que el carril.
  if (req.slots) {
    const plan = directSlotsPlan(req.slots);
    if (plan.error) throw new Error(plan.error);
    const finalPrompt = plan.images.length ? `${plan.clause} ${basePrompt}` : basePrompt;
    fallo.promptFull = finalPrompt;
    const { image_data_url, usage } = plan.images.length
      ? await vertexPredictImagenCapability({ prompt: finalPrompt, negativePrompt, aspectRatio, images: plan.images })
      : await vertexPredictImagen({ prompt: finalPrompt, negativePrompt, aspectRatio });
    return { image_data_url, preset_used: presetUsed, preset_id: presetId, usage };
  }

  // No images → text-to-image fast path.
  if (!hasSource && !hasRefs) {
    fallo.promptFull = basePrompt;
    const { image_data_url, usage } = await vertexPredictImagen({
      prompt: basePrompt,
      negativePrompt,
      aspectRatio,
    });
    return { image_data_url, preset_used: presetUsed, preset_id: presetId, usage };
  }

  // Multimodal → gemini-2.5-flash-image: pass each reference as an inlineData
  // part and describe its role (subject vs style) in the text prompt. There is
  // no REFERENCE_TYPE binding — the [n] tokens of the Imagen era are replaced by
  // natural-language role descriptions.
  const images: InlineImage[] = [];
  const subjectDescs: string[] = [];
  const styleDescs: string[]   = [];

  if (req.sourceAssetDataUrl) {
    images.push({
      mimeType: dataUrlMime(req.sourceAssetDataUrl),
      data:     dataUrlBase64(req.sourceAssetDataUrl),
    });
    subjectDescs.push(req.sourceAssetLabel?.trim() || 'main subject');
  }

  if (hasRefs) {
    for (const r of req.referenceImages!) {
      images.push({ mimeType: dataUrlMime(r.dataUrl), data: dataUrlBase64(r.dataUrl) });
      if (looksLikeStyleRef(r.label)) {
        styleDescs.push(r.label?.trim() || 'reference style');
      } else {
        subjectDescs.push(r.label?.trim() || 'subject');
      }
    }
  }

  const roleClauses: string[] = [];
  if (subjectDescs.length > 0) {
    roleClauses.push(
      `Using the provided image(s) as the exact subject (${subjectDescs.join(', ')}), keep their identity, labels, and proportions unchanged.`,
    );
  }
  if (styleDescs.length > 0) {
    roleClauses.push(
      `Match the visual style of the provided style reference(s) (${styleDescs.join(', ')}).`,
    );
  }

  const finalPrompt = roleClauses.length > 0
    ? `${roleClauses.join(' ')} ${basePrompt}`
    : basePrompt;
  fallo.promptFull = finalPrompt;

  const { image_data_url, usage } = await vertexPredictImagenCapability({
    prompt: finalPrompt,
    negativePrompt,
    aspectRatio,
    images,
  });
  return { image_data_url, preset_used: presetUsed, preset_id: presetId, usage };
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
    const fallo = emptyFailurePromptContext();
    try {
      if (!body.prompt || typeof body.prompt !== 'string') {
        res.status(400).json(failurePayload(new Error('prompt is required for direct mode'), null));
        return;
      }
      const result = await generateImageDirect(body as DirectImageRequest, fallo);
      res.status(200).json({
        image_data_url: result.image_data_url,
        preset_used:    result.preset_used,
        preset_id:      result.preset_id,
        // M-3 / Unidad 1 — procedencia: el modelo REALMENTE ejecutado (constante, no un literal que
        // el consumidor adivina) y el usage crudo de Vertex (o null si no vino). El consumidor
        // (content-run-stage, Unidad 2) los asienta en el ledger en vez de hardcodear Imagen 3.
        model:          GEMINI_IMAGE_MODEL,
        usage:          result.usage,
        status:         'ok',
      });
      return;
    } catch (err) {
      res.status(500).json(logFailurePrompt(failurePayload(err, null, fallo)));
      return;
    }
  }

  if (!body.brandId) { res.status(400).json(failurePayload(new Error('brandId is required'), null)); return; }

  // El constructor, declarado FUERA del try: si la imagen falla después de que él corrió, su consumo
  // tiene que llegar al cuerpo del fallo. Dentro del try se perdía con la excepción.
  let builder: { version: string; model: string; usage: Record<string, number> | null } | null = null;
  // 2026-10-05 — el prompt del fallo, también FUERA del try y por la misma razón: se llena a medida que
  // el prompt se construye, y el catch lo lee.
  const fallo = emptyFailurePromptContext();
  try {
    const request = body as ExecuteRequest;
    const params = request.params ?? {};
    const built = await buildVisualPrompt(request);
    fallo.presetId = built.presetId;
    fallo.psychoId = built.psychoId ?? null;
    fallo.negativePrompt = built.negativePrompt;

    // ── BRIEF-IMG-01 fase 2 · el constructor ────────────────────────────────────────────────
    // Sin `copy_full` no se sintetiza y el prompt es el de siempre: el cambio es inerte hasta que el
    // carril (fase 3) mande el copy entero. Con él, se sintetiza UN prompt con todo.
    const mode: GenerationMode = params.generation_mode === 'edit_from_current' ? 'edit_from_current' : 'regenerate_full';
    if (mode === 'edit_from_current' && !params.source_image_url) {
      res.status(400).json(failurePayload(new Error("EDIT_WITHOUT_SOURCE: generation_mode 'edit_from_current' exige source_image_url"), null));
      return;
    }
    const directives = normalizeDirectives(params.visual_directives);
    // 2026-10-03 — PERSONAS: `personas[]` manda; `persona` es el alias legacy (una lista de uno). Una
    // lista mal formada o por encima del techo es un error declarado: nunca un recorte silencioso.
    const resolved = resolvePersonas(params);
    if (resolved.error) { res.status(400).json(failurePayload(new Error(resolved.error), null)); return; }
    // 2026-10-04 — `scenePersonas`: las nombradas y la voz autora (`entry: "author_voice"`); sin esa
    // entrada, exactamente el filtro de mención de siempre.
    const usedPersonas = scenePersonas(resolved.personas, [params.copy_full, params.title, params.image_hook, ...directives]);
    const persona: PromptPersona | null = usedPersonas[0] ?? resolved.personas[0] ?? null;
    const gazeR = resolveGaze(params.gaze, usedPersonas.length);
    if (gazeR.error) { res.status(400).json(failurePayload(new Error(gazeR.error), null)); return; }
    // Locación y producto: DATO resuelto por el carril. La locación viaja con sus fotos; el producto
    // sólo como aviso, porque su PNG real lo pega el compositor después.
    const location: PromptLocation | null =
      params.location && typeof params.location.name === 'string' && typeof params.location.description === 'string'
        ? params.location as PromptLocation : null;
    const allowedSceneText = normalizeAllowedSceneText(location?.allowed_scene_text);
    // Opción (c) (Sam, 2026-09-27): el producto se PINTA en la escena. Sólo se pega por código si la
    // marca lo declara (`imagelab_overlay_tokens.product.mode = 'composite'`), y entonces no se pinta.
    const productIn: PromptProduct | null =
      params.product && Array.isArray(params.product.items) && params.product.items.length
        ? { name: String(params.product.name ?? ''), items: params.product.items.filter((i: any) => i && typeof i.image_url === 'string' && /^https?:\/\//.test(i.image_url)) }
        : null;
    // Los tokens de la marca dicen cómo entra el producto y DÓNDE irá el texto (TEXT-ZONE).
    // 2026-10-03 — los de (marca, canal): la fila del canal manda clave a clave sobre la de marca.
    const overlay = await loadOverlayTokens(request.brandId, built.canal);
    const overlayTokens = overlay.tokens;
    const productMode = productIn ? (overlayTokens?.product?.mode === 'composite' ? 'composite' : 'in_scene') : null;
    const textZone = textZoneClause(overlayTokens?.layout);
    const framingR = resolveSubjectFraming(overlayTokens?.layout);
    if (framingR.warning) console.warn(`[ImageLab][CANAL] brand=${request.brandId} canal=${built.canal} ${framingR.warning}`);
    // Sólo cuando la fila del canal declara franja o encuadre, o el dato declara el encuadre: sin eso, la
    // respuesta es la de siempre, clave por clave (una fila de canal que no toca estas claves no se anuncia).
    const overlayTrace = overlay.declared.length || framingR.declared ? {
      overlay_canal: overlay.canal,
      subject_framing: framingR.framing,
      text_zone: textZone !== '',
    } : {};
    if (overlay.canal) {
      console.log(`[ImageLab][CANAL] brand=${request.brandId} fila de canal ${overlay.canal} sobre la de marca (declara: ${overlay.declared.join(', ') || 'nada del generador'}): encuadre=${framingR.framing} franja=${textZone ? 'sí' : 'no'}`);
    }
    const productComposited = params.product_composited === true || productMode === 'composite';
    const productInScene = productIn && productMode !== 'composite' && productIn.items.length ? productIn : null;
    const personaUsed = usedPersonas.length > 0;

    // 2026-10-03 — el reparto se decide ANTES de sintetizar: con 2+ personas el lugar puede ceder su
    // plaza, y entonces el constructor no debe hablar de «la foto del lugar adjunta» (no viaja).
    const alloc = allocateReferences({
      personaRefs: usedPersonas.map((p) => p.reference_image_urls ?? []),
      locationRefs: location ? (location.reference_image_urls ?? []).filter((u) => /^(https?:\/\/|data:image\/)/.test(u)) : [],
      productRefs: productInScene ? productInScene.items.map((i) => i.image_url) : [],
    });
    const builderLocation: PromptLocation | null = location && usedPersonas.length >= 2
      ? { ...location, reference_image_urls: alloc.location } : location;

    let finalPrompt = built.prompt;
    if (shouldSynthesize(params)) {
      const v = await loadActivePromptBuilderVersion();
      // FAIL-LOUD: quien manda el copy entero pidió síntesis. Degradar al prompt de 180 caracteres sin
      // decirlo sería volver al defecto que esto cierra, con la apariencia de haberlo cerrado.
      if (!v) {
        res.status(500).json(failurePayload(new Error('PROMPT_BUILDER_VERSION_MISSING: no hay fila activa en imagelab_prompt_builder_versions'), null));
        return;
      }
      // Antes de llamar: si la llamada falla, el cuerpo del fallo nombra el constructor que se llamó.
      builder = { version: v.version, model: v.model_id, usage: null };
      const synth = await vertexGenerateText({
        model: v.model_id,
        system: v.instructions,
        user: buildBuilderUserMessage({
          basePrompt: built.prompt,
          copyFull: String(params.copy_full),
          title: params.title ?? null,
          imageHook: params.image_hook ?? null,
          domainDirective: params.visual_directive ?? null,
          directives,
          persona,
          personas: usedPersonas.length >= 2 ? usedPersonas : null,
          mode,
          location: builderLocation,
          productComposited,
          product: productInScene,
        }),
        maxOutputTokens: v.max_output_tokens ?? 700,
      });
      // Identidad y lugar del producto también se reponen (medido 2026-09-28: la síntesis perdía la
      // cláusula de identidad y la persona salía con la ropa exacta de sus fotos, o el envase en la
      // franja del titular).
      const placement = productInScene ? productPlacementClause(overlayTokens?.layout, personaUsed, productInScene.items.length) : '';
      // 2026-10-03 — la lista vive en `engineClausesFor` (bloque PB, con test). Con una persona, sin
      // mirada ni texto permitido como dato, es literalmente la de antes (golden `personas_n1_golden.json`).
      finalPrompt = enforceEngineClauses(synth.text, engineClausesFor({
        mode, textZone, personaCount: usedPersonas.length, gaze: gazeR.gaze, placement,
        productInScene: !!productInScene, productComposited,
        angleSeed: String(params.title ?? params.image_hook ?? params.copy_full ?? ''),
        allowedSceneText,
        framing: framingR.framing,
      }));
      builder = { version: v.version, model: v.model_id, usage: synth.usage };
      console.log(`[ImageLab][IMG-01] constructor v=${v.version} modelo=${v.model_id} modo=${mode} directrices=${directives.length} persona=${personaUsed ? 'sí' : 'no'} prompt=${finalPrompt.length} chars`);
    }

    // Sin síntesis, la orden de no dibujar producto también viaja: la capa la pega el compositor igual.
    if (!builder && productComposited && !productInScene) finalPrompt = enforceEngineClauses(finalPrompt, [PRODUCT_COMPOSITED_CLAUSE]);

    // Medición en seco: el prompt y su coste, sin pagar una imagen.
    if (params.prompt_only === true) {
      res.status(200).json({
        prompt_full: finalPrompt,
        prompt_builder_version: builder?.version ?? null,
        prompt_builder_model:   builder?.model ?? null,
        prompt_builder_usage:   builder?.usage ?? null,
        generation_mode: mode,
        persona_used:    personaUsed,
        ...overlayTrace,
        status: 'ok',
      });
      return;
    }

    // El prompt ya es el final: si algo falla desde aquí, el cuerpo del fallo lo lleva.
    fallo.promptFull = finalPrompt;

    // Las imágenes que acompañan al prompt: la actual (editar) y las de la persona, si se la nombra.
    const images: InlineImage[] = [];
    if (mode === 'edit_from_current') images.push(await fetchImageInline(String(params.source_image_url)));
    // 2026-10-03 — el reparto vive en `allocateReferences` (bloque PB, con test). Con una persona, la
    // regla de siempre; con dos o más, el presupuesto del modelo. El lugar acepta también `data:image/`,
    // como la persona: el carril manda https, una prueba puede mandar la foto en línea.
    const locationRefs = alloc.location;
    const productRefs = alloc.product;
    const personaRefs = alloc.persona.flat();
    for (const u of personaRefs) images.push(await fetchImageInline(u));
    for (const u of locationRefs) images.push(await fetchImageInline(u));
    for (const u of productRefs) images.push(await fetchImageInline(u));
    if (alloc.over_budget) {
      console.warn(`[ImageLab][PERSONAS] ${images.length} imágenes de entrada: el producto no cabía en el presupuesto de ${alloc.budget} y viaja igual (sin su foto sería inventado)`);
    }

    const { image_data_url: imageDataUrl, usage } = images.length
      ? await vertexPredictImagenCapability({
          prompt: [imageRoleClause({
            hasSource: mode === 'edit_from_current', personaName: persona?.name ?? null, personaRefs: personaRefs.length,
            personas: usedPersonas.length >= 2 ? usedPersonas.map((p, i) => ({ name: p.name, refs: alloc.persona[i].length })) : null,
            locationName: location?.name ?? null, locationRefs: locationRefs.length,
            productNames: productInScene ? productInScene.items.slice(0, Math.max(1, productRefs.length)).map((i) => i.name) : null,
            productRefs: productRefs.length,
          }), finalPrompt].filter(Boolean).join(' '),
          negativePrompt: built.negativePrompt,
          aspectRatio: built.aspectRatio,
          images,
        })
      : await vertexPredictImagen({
          prompt:         finalPrompt,
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
      // M-3 / Unidad 1 — procedencia para el ledger del consumidor (Orchestrator path, el que usa
      // content-run-stage vía execLab): modelo real + usage crudo de Vertex (o null).
      model:          GEMINI_IMAGE_MODEL,
      usage,
      // BRIEF-IMG-01 fase 2 — el prompt ENTERO con el que nació esta imagen, SIEMPRE, sintetizado o
      // no. Sin esto no hay forma de regenerar «con todo el prompt + la corrección».
      prompt_full:            finalPrompt,
      prompt_builder_version: builder?.version ?? null,
      prompt_builder_model:   builder?.model ?? null,
      prompt_builder_usage:   builder?.usage ?? null,
      generation_mode:        mode,
      persona_used:           personaUsed,
      location_used:          location ? location.name : null,
      location_refs:          locationRefs.length,
      product_composited:     productComposited && !productInScene,
      product_in_scene:       productInScene ? productInScene.items.slice(0, MAX_PRODUCT_REFS).map((i) => i.name) : null,
      product_refs:           productRefs.length,
      reference_images:       images.length,
      // 2026-10-03 — sólo cuando se pidió `personas[]` o entraron dos o más: con el alias legacy y una
      // persona, la respuesta es la de siempre, clave por clave.
      ...(resolved.source === 'personas' || usedPersonas.length >= 2 ? {
        personas_used: usedPersonas.map((p) => p.name),
        persona_refs: alloc.persona.map((r) => r.length),
        gaze: gazeR.gaze,
        reference_budget: alloc.budget,
        references_dropped: alloc.dropped,
      } : {}),
      ...overlayTrace,
      status:         'ok',
    });
  } catch (err) {
    res.status(500).json(logFailurePrompt(failurePayload(err, builder, fallo)));
  }
}
