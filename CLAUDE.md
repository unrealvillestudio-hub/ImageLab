# CLAUDE.md — ImageLab
_Contexto persistente para Claude Code. No editar manualmente._

---

## ⚠️ GOBERNANZA CC — NIVEL ALTA COMPLEJIDAD (leer ANTES de tocar nada)

Antes de cualquier acción en este repositorio, Claude Code DEBE cargar y obedecer el protocolo central:
**`https://unrlvl-context.vercel.app/protocols/CC_PROTOCOL.md`** (cargar con `Vercel:web_fetch_vercel_url` o `curl`).

**Este repo es parte del pipeline de contenido — un error rompe el flujo de varias marcas. Reglas:**

1. **CONTEXT FILES NUNCA SE REEMPLAZAN.** Se actualizan preservando historia: lo nuevo al tope, lo anterior archivado debajo, nunca borrado. Aplica a todo `.json`/`.md` de contexto. Antes de commitear: verificar que el diff no BORRA historia.

2. **PUSH:** `unrlvl-context` → nunca push directo, nunca por CC (solo Sam vía GitHub Desktop). Este repo y demás repos de código → branch + PR, nunca merge propio. CC nunca mergea por su cuenta. CC limpia sus worktrees al cerrar un PR.

3. **VERIFICACIÓN REFORZADA POR COMPLEJIDAD:** cambios que afecten `lab_jobs`, `lab_configs`, Edge Functions, o el flujo del pipeline requieren mensaje de verificación EXPLÍCITO a Sam antes de commitear (objetivo, pasos, archivos, repos y EFs afectados), porque un error se propaga aguas abajo a CopyLab/ImageLab/Meta y a todas las marcas. Reportar al final con el formato de CC_PROTOCOL (incluida PRESERVACIÓN DE CONTEXTO).

Ante cualquier duda → preguntar a Sam, no asumir.

---

## Qué es este repo
ImageLab es el motor de generación de imágenes del ecosistema UNRLVL. Recibe requests del pipeline (vía lab-worker EF) o directas, construye un prompt brand-specific desde `imagelab_presets`, y llama a **Google Vertex AI Imagen 3.0**. Devuelve un `image_data_url` (base64).

**URL producción:** https://image-lab-unrlvl.vercel.app  
**Vercel project:** prj_0BA7MvfSUHLTXXKvOdSckGNXoTAb  
**Framework:** Vite + React (UI) + Vercel Function Node (`api/execute.ts`)  
**Versión actual:** v6 (preset injection)

> NOTA DE PRECISIÓN (verificado en código 2026-06-08): el `ecosystem_graph` lista a ImageLab como "imagen-3.0-generate-002 via GEMINI_API_KEY". Eso esta DESACTUALIZADO. El `api/execute.ts` real usa Vertex AI con Service Account (no AI Studio, no GEMINI_API_KEY) y los modelos `imagen-3.0-fast-generate-001` + `imagen-3.0-capability-001`. El codigo manda.

---

## Stack tecnico (verificado en `api/execute.ts`)

### API principal
- **`api/execute.ts`** — unico endpoint: `POST /api/execute`. Handler Node (`VercelRequest/VercelResponse`). `export const config = { maxDuration: 60 }`.
- **Auth GCP:** `GOOGLE_SERVICE_ACCOUNT_KEY` (JSON crudo del Service Account) -> `GoogleAuth` (google-auth-library) -> OAuth2 Bearer token, scope `cloud-platform`. Singleton `_auth` cachea token entre invocaciones warm. Facturado a GCP (creditos del proyecto, no prepay de AI Studio).
- **Modelos Vertex:**
  - `imagen-3.0-fast-generate-001` — text-to-image (rapido/barato), via `vertexPredictImagen()`.
  - `imagen-3.0-capability-001` — subject/style customization multimodal, via `vertexPredictImagenCapability()`.
- **Endpoint Vertex:** `https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{MODEL}:predict`
- `UPSTREAM_TIMEOUT_MS = 55_000` (deja ~5s de headroom bajo maxDuration 60s). Parametros: `safetyFilterLevel: 'block_only_high'`, `personGeneration: 'allow_adult'` (enums lowercase — Vertex, no AI Studio).

### Variables de entorno (Vercel) — verificadas en codigo
```
GOOGLE_SERVICE_ACCOUNT_KEY   <- JSON completo del Service Account (string crudo, no base64, no path)
GOOGLE_CLOUD_PROJECT         <- project id de GCP (requerido)
GOOGLE_CLOUD_LOCATION        <- region Vertex (default 'us-central1')
SUPABASE_URL                 <- normalizeSupabaseUrl() tolera 3 formatos
SUPABASE_SERVICE_ROLE_KEY    <- el serverless lee imagelab_presets/brands/psycho_presets con service_role
```
> El front (`src/lib/supabaseClient.ts`) usa `sbSelect` anon read-only; SOLO `api/execute.ts` escribe/lee con service_role. (Confirmado en supabase_access_map 2026-06-03.)

---

## Dos modos de operacion (verificados en codigo)

### 1. Orchestrator path — `POST /api/execute { brandId, stage, params:{canal, aspect_ratio, subject...}, previousOutputs }`
```
buildVisualPrompt() -> canal.toUpperCase() -> loadImagelabPreset(brandId, canal)
  - preset encontrado -> buildPromptFromPreset() (formato v6, ver abajo)
  - sin preset -> legacy generic builder (lee tabla brands: imagelab_style/palette/negative + psycho_presets)
-> vertexPredictImagen(fast-generate-001) -> image_data_url
```

### 2. Direct mode — `POST /api/execute { mode:'direct', prompt, brand_id?, canal?, sourceAssetDataUrl?, referenceImages? }`
```
- brand_id + canal presentes -> mismo preset injection opcional
- sin imagenes -> vertexPredictImagen (fast-generate-001)
- con sourceAsset/referenceImages -> vertexPredictImagenCapability (capability-001):
    - infiere REFERENCE_TYPE_SUBJECT vs REFERENCE_TYPE_STYLE por el label (inferSubjectType/looksLikeStyleRef)
    - inserta tokens [referenceId] inline en el prompt para bindear imagenes a roles
```

### Preset injection v6 — formato exacto del prompt (de `buildPromptFromPreset`)
```
{reference_aesthetic} aesthetic. {composition_rule}. {lighting_style}. {color_grading}.
Mood: {mood}. Concept: {conceptText}. Brand DNA: {brand_dna}. {texture}.
Photorealistic, 8K, large format cinema. FORBIDDEN: {negative_prompt}.
```
- Lee `imagelab_presets` por `(brand_id, canal)`. Campos: `lighting_style`, `color_grading`, `negative_prompt`, `aspect_ratio`, y `extra_params` (JSON: `reference_aesthetic`, `composition_rule`, `mood[]`, `brand_dna`, `texture`, `forbidden_elements[]`).
- `negativePrompt` = `forbidden_elements` + `negative_prompt`, fallback a `FALLBACK_NEGATIVE`.

### Aspect ratio
Vertex acepta `1:1, 3:4, 4:3, 9:16, 16:9`. El mapeo `4:5->3:4`, `5:4->4:3` ocurre en lab-worker EF antes de llamar a ImageLab. Default `1:1` (o `9:16` si canal incluye REEL/TIKTOK).

---

## Estructura del repo
```
api/execute.ts          <- motor (Vertex AI, presets, dual model). maxDuration 60.
src/
  App.tsx               <- UI
  lib/supabaseClient.ts <- sbSelect anon read-only (solo lectura desde el front)
  lib/brandLoader.ts    <- carga brands
  services/gemini.ts    <- llama /api/execute en modo direct desde la UI
  config/brands.ts, presets.ts
  modules/tools/ToolsModule.tsx
config/ utils/           <- legacy en root (los activos estan en src/)
```

---

## Conexiones (verificadas: codigo + ecosystem_graph + access_map)
- **Recibe de:** lab-worker EF (pipeline `lab_jobs`) y modo direct desde la UI.
- **Lee de Supabase (service_role):** `imagelab_presets` (preset por brand+canal), `brands` (fallback), `psycho_presets`. Tambien consume `person_blueprints`/`location_blueprints` para identity params (grafo: provides_params_to).
- **Front (anon read-only):** solo SELECT.
- **Llama a:** Google Vertex AI Imagen 3.0 (`{location}-aiplatform.googleapis.com`).
- **GCP:** proyecto en `GOOGLE_CLOUD_PROJECT`, billing con creditos del proyecto.

---

## Reglas de trabajo (del codigo)
1. **Es Vertex AI + Service Account, NO AI Studio/GEMINI_API_KEY.** Si alguien "corrige" hacia GEMINI_API_KEY por docs viejas o por el ecosystem_graph, esta mal — el codigo usa `GOOGLE_SERVICE_ACCOUNT_KEY` + google-auth-library.
2. **Nunca cambiar `maxDuration: 60`** ni `UPSTREAM_TIMEOUT_MS` 55s sin razon — fue el bug historico del timeout.
3. **`GOOGLE_SERVICE_ACCOUNT_KEY`** va como JSON crudo (no base64, no path). Secreto — solo en Vercel, nunca en el repo.
4. `normalizeSupabaseUrl()` se aplica a toda URL de Supabase nueva.
5. El front es read-only anon por diseno (access_map intentional=true) — no moverlo a service_role.
6. Modelos Imagen como constantes (`IMAGEN_MODEL`, `IMAGEN_CAPABILITY_MODEL`) — si Google deprecara, cambiar ahi.

---

## Estado actual
- OPERACIONAL — v6 preset injection.
- Auth Vertex + Service Account verificada en codigo (2026-06-08).
- Preset injection activo para UnrealvilleStudio; NeuroneSCF presets pendientes.
- ecosystem_graph desactualizado sobre modelo/auth de ImageLab — corregir en el proximo ecosystem audit.
