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
ImageLab es el motor de generación de imágenes del ecosistema UNRLVL. Recibe requests del pipeline (vía lab-worker EF) o directamente desde UI, llama a **Google Vertex AI Imagen 3.0**, y devuelve un `image_data_url` base64.

**URL producción:** https://image-lab-unrlvl.vercel.app  
**Vercel project:** prj_0BA7MvfSUHLTXXKvOdSckGNXoTAb  
**Framework:** Vite + React (UI) + Vercel Edge Functions (API)  
**Versión actual:** v6

---

## Stack técnico

### API principal
- **`api/execute.ts`** — único endpoint real: `POST /api/execute`
- `maxDuration: 60` (crítico — Vercel default 50s era el bug histórico)
- Auth: `GoogleAuth` con Service Account JSON (`GOOGLE_SERVICE_ACCOUNT_KEY`)
- Dos modelos:
  - `imagen-3.0-fast-generate-001` — text-to-image (~$0.02/img, ~5s)
  - `imagen-3.0-capability-001` — multimodal con subject/style refs (~$0.04/img, ~10-15s)

### Variables de entorno (Vercel)
```
GOOGLE_SERVICE_ACCOUNT_KEY   ← JSON completo del Service Account (NO base64)
GOOGLE_CLOUD_PROJECT         ← gen-lang-client-0491381650
GOOGLE_CLOUD_LOCATION        ← us-central1
SUPABASE_URL                 ← https://amlvyycfepwhiindxgzw.supabase.co
SUPABASE_SERVICE_ROLE_KEY    ← service_role key de Supabase
```
> ⚠️ `SUPABASE_URL` tiene `normalizeSupabaseUrl()` — tolera 3 formatos. Si hay errores de "Invalid URL", verificar que el valor sea la URL completa con `https://`.

### Supabase (proyecto amlvyycfepwhiindxgzw)
Tablas que lee:
- **`imagelab_presets`** — preset visual por `(brand_id, canal)`. Columnas clave: `preset_id`, `canal`, `lighting_style`, `color_grading`, `negative_prompt`, `aspect_ratio`, `extra_params` (JSON: `reference_aesthetic`, `composition_rule`, `mood`, `brand_dna`, `texture`, `forbidden_elements`)
- **`brands`** — fallback cuando no hay preset (`imagelab_style`, `imagelab_palette`, `imagelab_negative`)
- **`psycho_presets`** — inyección visual adicional vía `psycho_preset` param

---

## Flujo de ejecución

### Modo Orchestrator (pipeline)
```
lab-worker EF → POST /api/execute { brandId, stage, params: { canal, aspect_ratio, ... }, previousOutputs }
  → loadImagelabPreset(brandId, canal)
  → buildPromptFromPreset() o legacy generic builder
  → vertexPredictImagen()
  → { output, image_data_url, preset_used, preset_id, brand, canal }
```

### Modo directo (UI o API externa)
```
POST /api/execute { mode: 'direct', prompt, brand_id?, canal?, sourceAssetDataUrl?, referenceImages? }
  → Si brand_id + canal → loadImagelabPreset() para preset injection
  → Sin imágenes → vertexPredictImagen() (fast model)
  → Con imágenes → vertexPredictImagenCapability() (capability model)
  → { image_data_url, preset_used, preset_id }
```

### Preset injection (v6)
Cuando existe un preset para `(brand_id, canal)`, el prompt se construye así:
```
{reference_aesthetic} aesthetic. {composition_rule}. {lighting_style}. {color_grading}.
Mood: {mood}. Concept: {job_prompt}. Brand DNA: {brand_dna}. {texture}.
Photorealistic, 8K, large format cinema. FORBIDDEN: {negative_prompt}.
```

### Aspect ratio mapping
Vertex AI solo acepta: `1:1`, `3:4`, `4:3`, `9:16`, `16:9`.  
El mapping ocurre en **lab-worker EF** (no aquí):
- `4:5` → `3:4`
- `5:4` → `4:3`
- otros → `1:1`

---

## Estructura del repo
```
api/
  execute.ts          ← API principal (Vercel Function, maxDuration:60)
src/
  App.tsx             ← UI principal
  config/
    brands.ts         ← Brand configs para la UI
    presets.ts        ← Preset configs UI
  services/
    gemini.ts         ← Llama /api/execute en modo directo desde UI
  modules/
    tools/ToolsModule.tsx  ← Módulo principal de herramientas UI
  lib/
    brandLoader.ts    ← Carga brands desde Supabase
    supabaseClient.ts ← Cliente Supabase (usa VITE_ vars para UI)
config/               ← Configs legacy (directorio raíz, no src/)
utils/                ← Utils legacy (directorio raíz, no src/)
```
> ⚠️ Hay duplicación de `config/` y `utils/` — los de `src/` son los activos. Los del root son legacy.

---

## Conexiones con el ecosistema
- **Recibe requests de:** `lab-worker` EF (Supabase) vía pipeline `lab_jobs`
- **Lee datos de:** `imagelab_presets`, `brands`, `psycho_presets` (Supabase)
- **También consume:** `person_blueprints`, `location_blueprints` (BP_PERSON_1.0, BP_LOCATION_1.0) para identity params
- **GCP:** proyecto `gen-lang-client-0491381650`, billing activo ($300 trial), budget alert $30/mes

---

## Reglas de trabajo
1. **Nunca cambiar `maxDuration`** — 60s es el valor correcto y costó varios bugs encontrarlo
2. **`normalizeSupabaseUrl()`** debe aplicarse a cualquier URL de Supabase nueva — no asumir formato
3. **No usar `VITE_` prefix** en las env vars del server (`api/execute.ts`) — solo `SUPABASE_URL` etc. Los `VITE_` son solo para el cliente React
4. **Service Account JSON** va en la env var completo como string JSON — no base64, no path
5. Al agregar un nuevo canal, agregarlo en `imagelab_presets` con `brand_id` + `canal` uppercase

---

## Estado actual (2026-05-29)
- ✅ OPERACIONAL — pipeline end-to-end funcionando
- ✅ Preset injection v6 activo para UnrealvilleStudio (preset UNRLVL-FEED-TEASER v2)
- ✅ Multimodal capability (REFERENCE_TYPE_SUBJECT + REFERENCE_TYPE_STYLE)
- ⏳ NeuroneSCF presets pendientes de crear
