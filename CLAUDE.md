# CLAUDE.md — ImageLab
_Contexto persistente para Claude Code. No editar manualmente._

---

## ⚠️ GOBERNANZA CC — NIVEL ALTA COMPLEJIDAD (leer ANTES de tocar nada)

Antes de cualquier acción en este repositorio, Claude Code DEBE cargar y obedecer el protocolo central:
**`https://unrlvl-context.vercel.app/protocols/CC_PROTOCOL.md`** (cargar con la tool `Vercel:web_fetch_vercel_url`; **nunca con `curl`** — ver la nota de abajo).

> **Orden de carga — la fuente canónica es el repo, Vercel es respaldo** (`CC_PROTOCOL.md` §0 bis).
> **(1)** `unrealvillestudio-hub/unrlvl-context` — working tree si está clonado, o `api.github.com` /
> `raw.githubusercontent.com`; **(2)** la URL de Vercel, **sólo si el repo no está disponible**, y
> declarándolo. El estático puede ir por detrás de `main` entre el merge y el deploy (`HRD-R09`, `HRD-R14`).
>
> **Cómo se alcanza esa URL de respaldo [medido 2026-08-29, `CC_PROTOCOL.md` §0 bis.1]:** con la tool
> **`Vercel:web_fetch_vercel_url`**, que devuelve **200**. **Nunca con `curl`**, que devuelve **403 en
> CONNECT** contra `*.vercel.app` — el proxy de egreso de CC lo bloquea. Son dos vías distintas y sólo
> una funciona; declarar Vercel inalcanzable tras probar sólo `curl` es afirmar sin medir.
>
> **Carga obligatoria además de `CC_PROTOCOL.md`:** `protocols/MULTIBRAND_RULE.md` y
> `protocols/DELIVERY_AND_VERIFICATION_RULE.md`. Esta última **se carga en la apertura de sesión**, no
> cuando surja la duda: gobierna **cómo se responde**, y una regla de forma que se consulta al final
> llega tarde porque el texto ya está escrito.

**Este repo es parte del pipeline de contenido — un error rompe el flujo de varias marcas. Reglas:**

1. **CONTEXT FILES NUNCA SE REEMPLAZAN.** Se actualizan preservando historia: lo nuevo al tope, lo anterior archivado debajo, nunca borrado. Aplica a todo `.json`/`.md` de contexto. Antes de commitear: verificar que el diff no BORRA historia.

2. **PUSH (redacción vigente — corregida 2026-08-22):**
   - **Este repo y demás repos de código** → **branch + PR**, nunca push directo a `main`, nunca merge propio. CC limpia sus worktrees al cerrar un PR (`CC_PROTOCOL.md` §7.2).
   - **`unrlvl-context`** → CC trabaja **igual: branch + PR**. CC **crea la rama, commitea y PUSHEA esa rama de PR**, y abre el PR contra `main`. Su restricción es **no pushear a `main` y no mergear** — nada más. Sam revisa, mergea y borra la rama **por GitHub Web UI**. CC **nunca crea worktrees** en ese repo (`CC_PROTOCOL.md` §7.1).
   - **CC nunca mergea un PR por su cuenta**, en ningún repo. El merge es decisión de Sam.

   > **⛔ NO OPERATIVO — redacción anterior, derogada.** Se conserva sólo por trazabilidad
   > (`CC_PROTOCOL.md` §0 y §6) y **no se obedece**:
   > *«PUSH: `unrlvl-context` → nunca push directo, nunca por CC (solo Sam vía GitHub Desktop).
   > Este repo y demás repos de código → branch + PR, nunca merge propio. CC nunca mergea por su
   > cuenta. CC limpia sus worktrees al cerrar un PR.»*
   >
   > Estaba **vencida desde el 2026-07-31**, cuando `CC_PROTOCOL.md` v2026-07-31 corrigió el punto
   > de push de CC según la instrucción de Sam del 29-jul, y arrastraba además que Sam usa **GitHub
   > Web UI** desde el 2026-07-29, no GitHub Desktop. Este `CLAUDE.md` nunca se sincronizó, y en
   > sesión **trabó a CC**: leyó «nunca por CC» como imperativo vigente. Fuente de verdad:
   > `https://unrlvl-context.vercel.app/protocols/CC_PROTOCOL.md` §1 + «Flujo de entrega de context
   > files». Los `CLAUDE.md` de cada repo **sólo apuntan** al protocolo; cuando duplican una regla,
   > divergen — que es exactamente lo que pasó acá.

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

---

## ENTREGA Y VERIFICACIÓN — INVIOLABLE

**Destinatario declarado.** Todo lo que se entrega cae dentro de un bloque con
encabezado propio: `PARA SAM — [de qué va]` o `PARA CC — [asunto]`. El bloque termina
donde empieza el siguiente encabezado. Un párrafo fuera de un bloque no es una
instrucción: es contexto.

**El diferenciador visual es para que SAM lea, no para que CC ejecute.** La marca
depende de la superficie: en **chat**, cuadrado emoji (verde Sam / naranja CC) más
encabezado grande, porque el markdown no rinde color arbitrario; en **documento, HTML
o UI con estilos**, el carácter `●` con la línea completa en su hex (`#00FFD1` Sam /
`#FFB300` CC). El hex no se escribe dentro de la línea: es especificación.

**Briefs largos se entregan como archivo**, no pegados: un bloque se trunca al copiarlo
y el truncamiento no falla — CC ejecuta lo que le llegó.

**Idioma.** ES neutro internacional o EN neutro internacional, sin excepción, sin
regionalismos y **sin voseo** (el imperativo voseante y el pretérito son homógrafos:
"decidí" es a la vez una orden y un hecho consumado). Aplica a chat, briefs, PRs,
commits, comentarios de código, context files y plantillas de protocolo.

**Evidencia.** Toda afirmación de estado va etiquetada `medido` / `reportado` /
`deducido`. Sin etiqueta se lee como `medido`. Antes de asumir, se consulta.

**Las cuatro QA son HRD RULES, en este orden:**
`QA-ENCARGO` (confirmar que entendí el encargo) → `QA-OBJETIVO` (confirmar el objetivo
con Sam) → `QA-INFO` (**bloqueo**: sin información completa NO se responde; si no hay
forma de obtenerla, se entrega el plan para conseguirla vía Sam o CC) → `QA-PROP`
(comprobar que lo entregado apunta al objetivo validado; cinco preguntas respondidas
por escrito). Un brief sin `QA-PROP` respondida se devuelve.

Fuente única: `unrlvl-context/protocols/DELIVERY_AND_VERIFICATION_RULE.md`.
**No copiar la regla completa aquí: este bloque es un puntero, no una segunda fuente.**
