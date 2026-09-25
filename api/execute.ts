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
    persona?: PromptPersona | null;      // dato de `public.person_blueprints`, resuelto por el carril
    generation_mode?: GenerationMode;    // 'edit_from_current' exige `source_image_url`
    source_image_url?: string;           // la imagen actual, para editar en vez de repintar
    prompt_only?: boolean;               // medición en seco: sintetiza y devuelve el prompt, sin imagen
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
  `https://${GCP_LOCATION()}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT()}/locations/${GCP_LOCATION()}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;

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
    if (!res.ok) throw new Error(`PROMPT_BUILDER_MODEL_ERROR ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
      .trim();
    if (!text) {
      const why = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason ?? 'sin texto';
      throw new Error(`PROMPT_BUILDER_EMPTY: el modelo no devolvió prompt (${why})`);
    }
    return { text, usage: extractUsage(data) };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`PROMPT_BUILDER_TIMEOUT after ${UPSTREAM_TIMEOUT_MS / 1000}s.`);
    }
    throw err;
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

/** Tope de fotos de referencia de persona por llamada: más fotos no dan más parecido y sí más coste. */
const MAX_PERSONA_REFS = 3;

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
  const negParts: string[] = [NO_TEXT_NEGATIVE];
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
  opts: { styleNotes?: string | null; copyTheme?: string | null; sceneDirective?: string | null } = {},
): string {
  const p: string[] = [];

  if (conceptText)             p.push(`Concept: ${conceptText}.`);
  // BRIEF 7 — segunda posición, pegada al concepto: los generadores pesan más lo que viene primero,
  // y esto no es un matiz estético sino la restricción que define qué clase de imagen es. Va aunque
  // no haya concepto, identidad ni preset: es del motor, no de la pieza.
  p.push(`${NO_TEXT_CLAUSE}.`);
  // BRIEF-N06 — tercera posición, detrás de la cláusula sin texto y delante de todo lo demás: es
  // del motor igual que aquélla, y sale aunque no haya marca, preset ni concepto.
  p.push(`${DISTINCT_SUBJECTS_CLAUSE}.`);
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
  const withPersona = personaMentioned(input.persona, [input.copyFull, input.title, input.imageHook, ...directives]);
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
  if (withPersona && input.persona) {
    const refs = (input.persona.reference_image_urls ?? []).length;
    parts.push(
      `PERSONA — "${input.persona.name.trim()}" is a real, recurring person of this brand. Whenever the piece or a directive ` +
      `names them, they must look exactly like this${refs ? ' and like the attached reference photo(s)' : ''}:\n${input.persona.description.trim()}`,
    );
  }
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
export function imageRoleClause(args: { hasSource: boolean; personaName?: string | null; personaRefs: number }): string {
  const c: string[] = [];
  if (args.hasSource) {
    c.push('The FIRST attached image is the current version of this image: edit it. Keep its composition, subjects, lighting and style, and change only what the instructions ask for.');
  }
  if (args.personaName && args.personaRefs > 0) {
    const which = args.hasSource ? 'The other attached image(s)' : 'The attached image(s)';
    c.push(`${which} show ${args.personaName}: whenever ${args.personaName} appears, keep that exact face and identity.`);
  }
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
  };
}

// --- Vertex AI Gemini 2.5 Flash Image -------------------------------------

const GEMINI_IMAGE_URL = () =>
  `https://${GCP_LOCATION()}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT()}/locations/${GCP_LOCATION()}/publishers/google/models/${GEMINI_IMAGE_MODEL}:generateContent`;

/**
 * Gemini-image has no negativePrompt parameter — absorb it into the text body
 * as an "Avoid: ..." clause.
 */
function appendNegative(prompt: string, negativePrompt?: string): string {
  const neg = (negativePrompt ?? '').trim();
  if (!neg) return prompt;
  return `${prompt} Avoid: ${neg}.`;
}

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
          parts: [{ text: appendNegative(params.prompt, params.negativePrompt) }],
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

    if (!res.ok) throw new Error(`Gemini image error ${res.status}: ${await res.text()}`);

    const data = await res.json();
    return { image_data_url: extractInlineImage(data), usage: extractUsage(data) };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Gemini image timeout after ${UPSTREAM_TIMEOUT_MS / 1000}s.`);
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
  model?: string;      // accepted for compatibility; ignored — gemini-2.5-flash-image is the only model.
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
  parts.push({ text: appendNegative(params.prompt, params.negativePrompt) });

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

    if (!res.ok) throw new Error(`Gemini image (multimodal) error ${res.status}: ${await res.text()}`);

    const data = await res.json();
    return { image_data_url: extractInlineImage(data), usage: extractUsage(data) };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Gemini image (multimodal) timeout after ${UPSTREAM_TIMEOUT_MS / 1000}s.`);
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
  usage: Record<string, number> | null;   // M-3 — usageMetadata crudo de Vertex (o null)
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
        // M-3 / Unidad 1 — procedencia: el modelo REALMENTE ejecutado (constante, no un literal que
        // el consumidor adivina) y el usage crudo de Vertex (o null si no vino). El consumidor
        // (content-run-stage, Unidad 2) los asienta en el ledger en vez de hardcodear Imagen 3.
        model:          GEMINI_IMAGE_MODEL,
        usage:          result.usage,
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
    const request = body as ExecuteRequest;
    const params = request.params ?? {};
    const built = await buildVisualPrompt(request);

    // ── BRIEF-IMG-01 fase 2 · el constructor ────────────────────────────────────────────────
    // Sin `copy_full` no se sintetiza y el prompt es el de siempre: el cambio es inerte hasta que el
    // carril (fase 3) mande el copy entero. Con él, se sintetiza UN prompt con todo.
    const mode: GenerationMode = params.generation_mode === 'edit_from_current' ? 'edit_from_current' : 'regenerate_full';
    if (mode === 'edit_from_current' && !params.source_image_url) {
      res.status(400).json({ error: "EDIT_WITHOUT_SOURCE: generation_mode 'edit_from_current' exige source_image_url", status: 'error' });
      return;
    }
    const directives = normalizeDirectives(params.visual_directives);
    const persona = params.persona ?? null;
    const personaUsed = personaMentioned(persona, [params.copy_full, params.title, params.image_hook, ...directives]);

    let finalPrompt = built.prompt;
    let builder: { version: string; model: string; usage: Record<string, number> | null } | null = null;
    if (shouldSynthesize(params)) {
      const v = await loadActivePromptBuilderVersion();
      // FAIL-LOUD: quien manda el copy entero pidió síntesis. Degradar al prompt de 180 caracteres sin
      // decirlo sería volver al defecto que esto cierra, con la apariencia de haberlo cerrado.
      if (!v) {
        res.status(500).json({ error: 'PROMPT_BUILDER_VERSION_MISSING: no hay fila activa en imagelab_prompt_builder_versions', status: 'error' });
        return;
      }
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
          mode,
        }),
        maxOutputTokens: v.max_output_tokens ?? 700,
      });
      finalPrompt = enforceEngineClauses(synth.text, [NO_TEXT_CLAUSE, DISTINCT_SUBJECTS_CLAUSE]);
      builder = { version: v.version, model: v.model_id, usage: synth.usage };
      console.log(`[ImageLab][IMG-01] constructor v=${v.version} modelo=${v.model_id} modo=${mode} directrices=${directives.length} persona=${personaUsed ? 'sí' : 'no'} prompt=${finalPrompt.length} chars`);
    }

    // Medición en seco: el prompt y su coste, sin pagar una imagen.
    if (params.prompt_only === true) {
      res.status(200).json({
        prompt_full: finalPrompt,
        prompt_builder_version: builder?.version ?? null,
        prompt_builder_model:   builder?.model ?? null,
        prompt_builder_usage:   builder?.usage ?? null,
        generation_mode: mode,
        persona_used:    personaUsed,
        status: 'ok',
      });
      return;
    }

    // Las imágenes que acompañan al prompt: la actual (editar) y las de la persona, si se la nombra.
    const images: InlineImage[] = [];
    if (mode === 'edit_from_current') images.push(await fetchImageInline(String(params.source_image_url)));
    const personaRefs = personaUsed ? (persona?.reference_image_urls ?? []).slice(0, MAX_PERSONA_REFS) : [];
    for (const u of personaRefs) images.push(await fetchImageInline(u));

    const { image_data_url: imageDataUrl, usage } = images.length
      ? await vertexPredictImagenCapability({
          prompt: [imageRoleClause({ hasSource: mode === 'edit_from_current', personaName: persona?.name ?? null, personaRefs: personaRefs.length }), finalPrompt].filter(Boolean).join(' '),
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
      reference_images:       images.length,
      status:         'ok',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg, status: 'error' });
  }
}
