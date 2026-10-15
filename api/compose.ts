/**
 * ImageLab — POST /api/compose
 *
 * BRIEF 7 (2026-08-22) — EL COMPOSITOR DETERMINÍSTICO. "La escena se genera, la tipografía se
 * compone."
 *
 * POR QUÉ EXISTE. Medido en producción el 2026-08-22: el modelo de imagen corrompe sistemáticamente
 * la tipografía española que dibuja dentro de la imagen ("EXACTEMENTE", "CUANDA", "APAPSRIENTA",
 * "FRACIÓN") e insertó "LEY 284" en una pieza. Ese texto vive en el plano VISUAL, y el Watcher juzga
 * el COPY: ninguna regla —HR-LEGAL-01 incluida— alcanza a los píxeles. Dos piezas aprobadas
 * quedaron bloqueadas por eso el mismo día.
 *
 * LA DECISIÓN (Sam). La generación deja de producir texto (cláusula del eje en `api/execute.ts`,
 * bloque C) y el texto se compone acá, por código, sobre la imagen limpia. Un generador estocástico
 * no vuelve a tocar una letra.
 *
 * MOTOR ELEGIDO Y POR QUÉ. `satori` (HTML/CSS → SVG) + `@resvg/resvg-js` (SVG → PNG). Es el mismo
 * par que hay debajo de `@vercel/og`, el generador de OG-images del stack donde ImageLab ya vive
 * (Vercel, runtime Node); se usan directos y no vía `@vercel/og` porque éste está pensado para el
 * runtime Edge y acá el handler es Node (`VercelRequest/VercelResponse`, igual que `/api/execute`).
 * satori vectoriza el texto a `<path>`, así que el PNG no depende de las fuentes del sistema.
 *
 * DETERMINISMO. El bloque PURO de abajo (COMPOSITOR:BEGIN/END) resuelve tokens → estilo → escena
 * sin red, sin DB y sin reloj: misma entrada ⇒ misma escena, carácter por carácter. Lo verifica
 * `tests/compositor_test.mjs` extrayendo el bloque de ESTA fuente. Lo impuro queda afuera y es
 * transporte: leer tokens de Supabase, bajar el archivo de fuente y rasterizar.
 *
 * LAS TRES REGLAS DURAS DEL BRIEF, y dónde se cumplen:
 *   (a) el texto del overlay sale del COPY YA JUZGADO. Este endpoint NO escribe ni reescribe texto:
 *       recibe `headline` / `subheadline` y los compone VERBATIM. Quien los deriva de la pieza es
 *       `content-run-stage` (bloque puro COMPOSITOR-TEXTO). Acá no hay ninguna rama que genere,
 *       recorte, traduzca o complete texto: si no entra, no sale.
 *   (b) tipografía, paleta y posición son DATO POR MARCA. Salen de tres tablas que ya existen o se
 *       siembran: `brand_typography` (familia + import), `brand_palette` (hex por rol) y
 *       `imagelab_overlay_tokens` (qué rol juega cada ranura + la posición). CERO fuentes y CERO
 *       colores cableados en el motor: si el dato falta, esto FALLA con el nombre de lo que falta,
 *       no inventa un Helvetica blanco.
 *   (c) determinista y testeable sin red (arriba).
 *
 * CONTRATO
 *   POST /api/compose
 *   { brand_id, canal?, image_url? | image_data_url?, headline, subheadline?, piece_id?,
 *     products?: [{ image_url, name? }],    ← capa de producto (2026-09-27), PNG real con alfa
 *     carousel?: { index, total, role, background?, eyebrow?, keyword?, figure?, steps?, cta? },
 *                                           ← F3 (2026-10-02), lámina de carrusel; ver el bloque F3
 *     emphasis?: [subcadena literal del titular, …] }   ← 1.4.0 (2026-10-13), hasta 3 tramos
 *   → 200 { status:'ok', image_data_url, compositor_version, tokens_source, width, height,
 *           fonts:[…], markers:[…], text:{ headline, subheadline, emphasis? },
 *           meta:{ carousel_applied, warnings:[…], carousel?:{ …, fit } } }
 *                                           ← `fit` (1.3.3): qué redujo el ajuste vertical, si actuó
 *   → 4xx/5xx { error, error_label, status:'error' }  ← `error_label` es lo que lee execLab.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { GoogleAuth } from 'google-auth-library';

declare const process: { env: Record<string, string | undefined> };

// ── COMPOSITOR:BEGIN ── (BRIEF 7, 2026-08-22) bloque PURO: tokens → estilo → escena.
// Sin fetch, sin DB, sin estado, sin reloj. Lo ejecuta `tests/compositor_test.mjs` extrayéndolo por
// estos sentinelas: lo que se testea es la fuente que se deploya, no una copia.

// La versión viaja al eco de la pieza (`builder_meta.image.compositor_version`). Sube cuando cambia
// lo que el compositor DIBUJA — no cuando cambia un token de marca (eso es dato) ni un comentario.
//   1.3.0 (F3, 2026-10-02) — láminas de carrusel según la maqueta v4 (campo `carousel`). Aditivo:
//         una marca sin `tokens.carousel` compone exactamente como en 1.2.0.
//   1.3.1 (2026-10-03) — espacio entre palabras parejo: las fuentes llegan a satori sin kerning
//         (`neutralizeKerning`), porque satori mide sin él y dibuja con él. Cambia el dibujo de TODO
//         texto —titular, bajada, etiquetas, logotipo de texto— en lámina y en overlay.
//   1.3.2 (2026-10-03) — la flecha del CTA del cierre señala abajo, al texto del post: a la derecha
//         prometía una lámina más que no existe. La del aviso de deslizar en la portada no cambia.
//   1.3.3 (2026-10-03) — ajuste vertical de la lámina de carrusel (`fitCarouselContent`): si el bloque
//         central no cabe entre la cabecera y el pie, se reduce por escalones (cifra → titular →
//         cuerpo y pasos → pasos omitidos, nunca el crítico) y el pie no se tapa ni sale del lienzo.
//         Una lámina que ya cabía sale idéntica.
//   1.3.4 (2026-10-03) — efecto de texto en las láminas con foto (`tokens.carousel.text_effect`): una
//         sombra por glifo, del color de una FUNCIÓN de la paleta, que da contraste local al texto sin
//         tocar el velo ni la imagen. Sólo con `background:'image'`; ni la superficie, ni el logotipo,
//         ni la barra de progreso. Sin el token, la escena sale idéntica a la de 1.3.3.
//   1.4.0 (2026-10-13) — ÉNFASIS POR PALABRA en el titular (Sam, 2026-10-13: «que en los textos de las
//         imágenes se resalten las palabras clave con negritas, mayúsculas, tamaños y colores de la
//         marca»). La petición trae `emphasis: [subcadenas LITERALES del titular]`; la marca declara
//         cómo se ven en `typography.headline.emphasis` (overlay) y `carousel.typography.headline.emphasis`
//         (lámina): rol tipográfico, peso, itálica, transformación, escala de tamaño y tracking, más
//         `palette.headline_emphasis` (overlay; la lámina usa la función `keyword`). Sin `emphasis` en la
//         petición, o sin el token en la marca, la escena sale idéntica a la de 1.3.4.
//   1.5.0 (2026-10-13) — EL TEXTO RESPETA A LA PLATAFORMA (Sam, 2026-10-13: «que la proporción y cantidad
//         de texto vs la imagen no sobrepase los requerimientos de cada plataforma»). Dos tokens de DATO por
//         canal: `layout.max_text_area_pct` (el bloque de texto no ocupa más de ese % de la imagen; si no
//         cabe, baja de escalón, luego se quita la bajada y, si aun así no cabe, se compone al mínimo y se
//         marca) y `layout.safe_zone_pct` (bordes que la interfaz de la plataforma tapa: el texto se compone
//         dentro). El límite rige el post y la portada del carrusel; las láminas interiores son tarjetas de
//         texto por diseño. Sin los tokens, la escena sale idéntica a la de 1.4.0.
//   1.6.0 (2026-10-15) — EL TEXTO NO TAPA UNA CARA, Y SE LEE SOBRE FONDO CLARO (Sam, 2026-10-15, pieza c3762333:
//         «el texto está casi encima de la cara cuando hay mucho espacio disponible»; «las letras blancas quedan
//         sobre fondo claro… un sutil tratamiento visual de sombra… No oscurezcas el fondo»). Dos tokens de DATO:
//         `layout.avoid_faces` { enabled, anchors?, margin_pct? } — las caras de la escena se detectan (Gemini, la
//         misma vía de Vertex que el inspector) y el bloque se compone en la primera ancla candidata cuya caja no
//         toca ninguna (por defecto: la declarada y luego las otras dos de su misma columna); si ninguna queda
//         libre, la de menor solape, y se dice. Si la detección falla, se compone en el ancla declarada y se dice.
//         `layout.text_effect` { kind:'shadow', color: <rol de brand_palette>, alpha, blur_pct, offset_pct } — la
//         sombra por glifo de 1.3.4, ahora también en el overlay. Sin los tokens, la escena sale idéntica a 1.5.0.
export const COMPOSITOR_VERSION = '1.6.0';

// Las nueve anclas. Enumeración CERRADA con fail-loud: un ancla que no está no cae a un default
// silencioso — el token está mal escrito y hay que verlo. (La regla multimarca admite enumerar con
// fail-loud; lo que prohíbe es que la enumeración distinga marcas, y ésta es geometría.)
const ANCHORS: Record<string, { y: 'flex-start' | 'center' | 'flex-end'; x: 'flex-start' | 'center' | 'flex-end'; align: 'left' | 'center' | 'right' }> = {
  top_left:      { y: 'flex-start', x: 'flex-start', align: 'left' },
  top_center:    { y: 'flex-start', x: 'center',     align: 'center' },
  top_right:     { y: 'flex-start', x: 'flex-end',   align: 'right' },
  middle_left:   { y: 'center',     x: 'flex-start', align: 'left' },
  center:        { y: 'center',     x: 'center',     align: 'center' },
  middle_right:  { y: 'center',     x: 'flex-end',   align: 'right' },
  bottom_left:   { y: 'flex-end',   x: 'flex-start', align: 'left' },
  bottom_center: { y: 'flex-end',   x: 'center',     align: 'center' },
  bottom_right:  { y: 'flex-end',   x: 'flex-end',   align: 'right' },
};

const SCRIM_MODES = new Set(['none', 'solid', 'gradient_bottom', 'gradient_top']);

// ── BRIEF 8 · D · LA FRANJA DE IDENTIDAD ───────────────────────────────────────────────────────
// El sello de la marca en la imagen. Es MECÁNICA DEL EJE: los cuatro modos son geometría —de qué
// borde nace la franja—, y nada más. El color, el grosor y la PRESENCIA son instancia: viven en la
// fila de la marca (`tokens.identity`), como todo lo demás de este compositor.
//
// REGLA DURA, y es de diseño, no de código: la franja es A SANGRE COMPLETA del borde elegido y
// DELGADA. Jamás un marco cerrado — un rectángulo alrededor de la imagen se lee como un anuncio
// publicitario, y esta franja existe para lo contrario: firmar sin gritar. Por eso no hay ningún
// modo de marco ni combinación de bordes: la enumeración lo hace imposible, no lo desaconseja.
//
// Y se dibuja SIEMPRE que la marca la declare, con titular o sin él: es el sello de la marca, no un
// adorno del texto. De ahí sale la capacidad de SELLAR retroactivamente una escena limpia cuyo
// título todavía no existe.
const IDENTITY_MODES = new Set(['none', 'edge_left', 'edge_right', 'edge_bottom']);
const SLOTS = ['headline', 'subheadline'] as const;
type Slot = (typeof SLOTS)[number];

export interface OverlayText { headline: string; subheadline?: string | null; emphasis?: string[] | null }

// ── 1.4.0 · ÉNFASIS POR PALABRA ────────────────────────────────────────────────────────────────
// EJE: que un titular pueda llevar tramos con otro peso, tamaño, transformación y color, y cómo se
// arman en la escena. INSTANCIA: QUÉ tramos (los marca quien escribe el copy y llegan en `emphasis`)
// y CÓMO se ven (tokens de la marca). El motor no elige palabras ni estilos: sigue el dato.
//
// Los tramos son subcadenas LITERALES del titular. El texto visible es el mismo carácter por carácter
// con énfasis o sin él (regla (a)): el énfasis sólo agrupa y estiliza, nunca escribe.
export const EMPHASIS_MAX_TERMS = 3;
export const EMPHASIS_MAX_CHARS = 60;
// Escala de tamaño admitida para el tramo enfatizado, respecto del titular. Fuera de rango es un
// token mal escrito y se dice (fail-loud), no se recorta en silencio.
const EMPHASIS_SCALE_MIN = 0.5;
const EMPHASIS_SCALE_MAX = 2.5;

/** Valida el campo `emphasis` de la petición. Ausente ⇒ []. Error del LLAMADOR ⇒ 400 con etiqueta. */
export function parseEmphasisRequest(raw: unknown): string[] {
  if (raw == null) return [];
  const bad = (msg: string) => new CompositorError('COMPOSITOR_EMPHASIS_INVALID', msg, 400);
  if (!Array.isArray(raw)) throw bad('emphasis debe ser una lista de subcadenas del titular');
  if (raw.length > EMPHASIS_MAX_TERMS) throw bad(`emphasis trae ${raw.length} tramos; el máximo es ${EMPHASIS_MAX_TERMS}`);
  const out: string[] = [];
  raw.forEach((v, k) => {
    if (typeof v !== 'string' || !v.trim()) throw bad(`emphasis[${k}] debe ser texto no vacío`);
    if (v.length > EMPHASIS_MAX_CHARS) throw bad(`emphasis[${k}] excede ${EMPHASIS_MAX_CHARS} caracteres`);
    if (!out.includes(v)) out.push(v);
  });
  return out;
}

/**
 * Parte el titular en tramos alrededor de VARIAS subcadenas literales. Cada término marca su primera
 * aparición que no se solape con un término anterior (el orden de la lista es la prioridad). Los que
 * no aparecen se devuelven en `missing`; el titular nunca cambia. Con un solo término el resultado es
 * el mismo que el de `splitKeyword`.
 */
export function splitEmphasis(headline: string, terms: Array<string | null | undefined>): {
  parts: Array<{ text: string; keyword: boolean }>; found: string[]; missing: string[];
} {
  const h = String(headline ?? '');
  const ranges: Array<[number, number]> = [];
  const found: string[] = [];
  const missing: string[] = [];
  for (const raw of terms ?? []) {
    const k = raw ?? '';
    if (!k) continue;
    let from = 0;
    let at = -1;
    while (from <= h.length) {
      const i = h.indexOf(k, from);
      if (i < 0) break;
      if (!ranges.some(([a, b]) => i < b && i + k.length > a)) { at = i; break; }
      from = i + 1;
    }
    if (at < 0) { missing.push(k); continue; }
    ranges.push([at, at + k.length]);
    found.push(k);
  }
  if (!h) return { parts: [], found, missing };
  ranges.sort((a, b) => a[0] - b[0]);
  const parts: Array<{ text: string; keyword: boolean }> = [];
  let cur = 0;
  for (const [a, b] of ranges) {
    if (a > cur) parts.push({ text: h.slice(cur, a), keyword: false });
    parts.push({ text: h.slice(a, b), keyword: true });
    cur = b;
  }
  if (cur < h.length) parts.push({ text: h.slice(cur), keyword: false });
  return { parts, found, missing };
}

/** Estilo de un tramo enfatizado: lo que la marca declara y, lo que no declara, heredado del titular. */
export interface EmphasisType {
  role: string; family: string; cssImport: string | null; fallback: string | null; fontUrl: string | null;
  weight: number; italic: boolean; transform: string; letterSpacingEm: number; sizeScale: number;
}

/**
 * Resuelve `…headline.emphasis` contra `brand_typography`. Token ausente ⇒ null (la marca no declara
 * énfasis: la escena sale como antes). Token presente y mal escrito ⇒ se acumula en `missing` y el
 * llamador falla nombrando, como el resto del bloque.
 */
export function resolveEmphasisType(
  tok: unknown,
  base: { role: string; weight: number; italic: boolean; transform: string; letterSpacingEm: number },
  typoBy: Map<string, { role: string; font_family: string; css_import?: string | null; fallback?: string | null }>,
  where: string,
  missing: string[],
): EmphasisType | null {
  if (!isPlain(tok) || Object.keys(tok).length === 0) return null;
  const e = tok as Record<string, any>;
  const role = e.role != null ? String(e.role) : base.role;
  const typo = typoBy.get(role);
  if (!typo) { missing.push(`brand_typography.role='${role}' (pedido por ${where}.role)`); return null; }
  const scale = e.size_scale == null ? 1 : Number(e.size_scale);
  if (!Number.isFinite(scale) || scale < EMPHASIS_SCALE_MIN || scale > EMPHASIS_SCALE_MAX) {
    missing.push(`${where}.size_scale=${e.size_scale} (válido: ${EMPHASIS_SCALE_MIN}..${EMPHASIS_SCALE_MAX})`);
    return null;
  }
  return {
    role, family: String(typo.font_family),
    cssImport: typo.css_import ? String(typo.css_import) : null,
    fallback: typo.fallback ? String(typo.fallback) : null,
    fontUrl: e.font_url ? String(e.font_url) : null,
    weight: e.weight != null ? Number(e.weight) : base.weight,
    italic: e.italic != null ? e.italic === true : base.italic,
    transform: e.transform != null ? String(e.transform) : base.transform,
    letterSpacingEm: e.letter_spacing_em != null ? Number(e.letter_spacing_em) : base.letterSpacingEm,
    sizeScale: scale,
  };
}

/**
 * Largo efectivo de un titular con tramos de otra escala, para la escalera `fit_steps` (que cuenta
 * caracteres): un tramo al 130 % ocupa como 1,3 veces sus caracteres. Sin énfasis es el largo de siempre.
 */
export function emphasisEffectiveLength(parts: Array<{ text: string; keyword: boolean }>, scale: number): number {
  let n = 0;
  for (const p of parts) n += p.keyword ? p.text.length * scale : p.text.length;
  return Math.round(n);
}

/** Error del compositor con etiqueta estable: es lo que el carril asienta y lo que se grepea. */
export class CompositorError extends Error {
  label: string;
  status: number;
  constructor(label: string, message: string, status = 422) {
    super(message);
    this.label = label;
    this.status = status;
  }
}

/** Objeto plano (no array, no null). Lo usa el merge de capas. */
function isPlain(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Merge profundo, la capa de la derecha gana clave a clave. Los arrays se REEMPLAZAN, nunca se
 * concatenan: un `fit_steps` de marca tiene que poder sustituir al global entero, no mezclarse con él.
 */
export function deepMergeTokens<T extends Record<string, unknown>>(base: T, over: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(over)) {
    const a = out[k];
    const b = over[k];
    out[k] = isPlain(a) && isPlain(b) ? deepMergeTokens(a, b) : b;
  }
  return out as T;
}

/**
 * Precedencia de `imagelab_overlay_tokens`, por especificidad y de menos a más:
 *
 *   global (brand NULL, canal NULL) → global de canal → marca → marca + canal
 *
 * Es la MISMA forma que `imagelab_presets` resuelve para el estilo visual (#95-C) y por la misma
 * razón: lo global rellena, la marca declara y el canal ajusta. Las capas se acumulan (merge), no
 * se excluyen: una marca que sólo declara la posición hereda del global el resto.
 *
 * Una fila cuyo brand_id o canal no corresponden a esta llamada se descarta (specificity -1).
 */
export function pickOverlayTokens(
  rows: Array<Record<string, any>>, brandId: string, canal: string | null,
): { tokens: Record<string, any>; source: string; layers: string[] } {
  const scored = (rows ?? [])
    .filter((r) => r && r.active !== false)
    .map((r) => {
      const b = r.brand_id == null ? 0 : (r.brand_id === brandId ? 2 : -1);
      const c = r.canal == null ? 0 : (canal && r.canal === canal ? 1 : -1);
      return { row: r, score: b < 0 || c < 0 ? -1 : b + c };
    })
    .filter((s) => s.score >= 0)
    // Orden estable y total: la especificidad manda; a igual especificidad, el id desempata para
    // que dos filas gemelas no dependan del orden en que PostgREST las devolvió.
    .sort((a, b) => (a.score - b.score) || String(a.row.id ?? '').localeCompare(String(b.row.id ?? '')));

  if (scored.length === 0) {
    throw new CompositorError(
      'COMPOSITOR_TOKENS_MISSING',
      `no hay fila de imagelab_overlay_tokens para brand_id='${brandId}' canal='${canal ?? '∅'}' (ni global). ` +
      'La tipografía, la paleta y la posición son DATO por marca: sin fila no hay composición y el motor no inventa una.',
    );
  }

  let tokens: Record<string, any> = {};
  const layers: string[] = [];
  for (const s of scored) {
    tokens = deepMergeTokens(tokens, (s.row.tokens ?? {}) as Record<string, unknown>);
    layers.push(`${s.row.brand_id ?? '*'}:${s.row.canal ?? '*'}`);
  }
  return { tokens, source: layers[layers.length - 1], layers };
}

/**
 * Elige el tamaño de fuente sin tocar el TEXTO. `fit_steps` es una escalera declarada por la marca
 * (`[{max_chars, size_pct}, …]`): gana el primer escalón cuyo `max_chars` alcanza. Si ninguno
 * alcanza, se usa el último (el más chico) y se emite un marcador — el titular entra igual, más
 * chico, y queda constancia. NUNCA se recorta ni se reescribe: el texto es el copy ya juzgado.
 */
export function fitFontSizePct(
  fitSteps: Array<{ max_chars: number; size_pct: number }>, text: string,
): { sizePct: number; overflow: boolean } {
  const steps = [...(fitSteps ?? [])].sort((a, b) => Number(a.max_chars) - Number(b.max_chars));
  const len = String(text ?? '').length;
  for (const s of steps) if (len <= Number(s.max_chars)) return { sizePct: Number(s.size_pct), overflow: false };
  return { sizePct: Number(steps[steps.length - 1].size_pct), overflow: true };
}

/** `#RRGGBB` (o `#RGB`) + alfa → `rgba()`. El hex sale de `brand_palette`; acá no hay ninguno. */
export function hexToRgba(hex: string, alpha = 1): string {
  const h = String(hex ?? '').trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new CompositorError('COMPOSITOR_COLOR_INVALID', `hex inválido en brand_palette: '${hex}'`);
  }
  const n = parseInt(full, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Une las tres fuentes de DATO en un estilo concreto:
 *   · `imagelab_overlay_tokens` — qué rol tipográfico y qué rol de paleta juega cada ranura, y dónde
 *     va el bloque. Es el único que declara la POSICIÓN.
 *   · `brand_typography`        — un ROL tipográfico de la marca → familia + import de la fuente.
 *   · `brand_palette`           — un ROL de color de la marca → hex.
 *
 * Los ROLES los nombra la MARCA en sus propios tokens; el motor sólo los sigue. Dos marcas con
 * catálogos de rol disjuntos —una que llama a sus colores por material y otra por función— componen
 * con este mismo código sin que aparezca acá el nombre de ninguna. Esa indirección es lo que hace
 * que el motor sobreviva a la marca N+1; el test lo verifica grepeando este bloque.
 *
 * FAIL-LOUD ACUMULATIVO: junta TODO lo que falta y lo reporta junto (un solo viaje para el que
 * siembra el dato), y no compone. Un default de fuente o de color acá anularía el brief entero.
 */
export function resolveOverlayStyle(args: {
  tokens: Record<string, any>;
  typography: Array<{ role: string; font_family: string; css_import?: string | null; fallback?: string | null }>;
  palette: Array<{ role: string; hex: string }>;
  text: OverlayText;
}): {
  layout: {
    anchor: string; marginPct: number; maxWidthPct: number; gapPct: number; align: 'left' | 'center' | 'right';
    // 1.5.0 — sólo existen si la marca o el canal los declaran.
    maxTextAreaPct?: number;
    safeZonePct?: { top: number; bottom: number; left: number; right: number };
    // 1.6.0 — sólo existe si la marca o el canal lo declaran.
    avoidFaces?: { anchors: string[]; marginPct: number; keepAlign: boolean };
  };
  // 1.6.0 — sombra por glifo del overlay. Sólo existe si la marca la declara.
  textEffect?: { color: string; blurPct: number; offsetPct: number };
  slots: Record<Slot, null | {
    text: string; role: string; family: string; fallback: string | null; cssImport: string | null;
    fontUrl: string | null; weight: number; italic: boolean; transform: string;
    lineHeight: number; letterSpacingEm: number; sizePct: number; color: string;
    // 1.4.0 — tramos del titular con énfasis. null ⇒ la ranura se dibuja como en 1.3.4 (un solo texto).
    parts?: null | Array<{ text: string; keyword: boolean }>;
    emphasis?: null | (EmphasisType & { color: string });
    // 1.5.0 — los escalones de `fit_steps` MÁS CHICOS que el elegido, de mayor a menor: el límite de área
    // baja por ellos. Lo usa sólo `fitOverlayTextArea`; la escena no lo lee.
    fitSmaller?: number[];
  }>;
  scrim: null | { mode: string; color: string; opacity: number; coveragePct: number };
  rule: null | { color: string; widthPct: number; thicknessPx: number; gapPct: number };
  identity: null | { mode: string; color: string; widthPct: number; fullBleed: boolean };
  markers: string[];
} {
  const missing: string[] = [];
  const markers: string[] = [];
  const t = args.tokens ?? {};
  const typoBy = new Map((args.typography ?? []).map((r) => [String(r.role), r]));
  const palBy = new Map((args.palette ?? []).map((r) => [String(r.role), r]));

  const layoutTok = (t.layout ?? {}) as Record<string, any>;
  const anchor = String(layoutTok.anchor ?? '');
  if (!ANCHORS[anchor]) missing.push(`layout.anchor='${anchor || '∅'}' (válidos: ${Object.keys(ANCHORS).join(', ')})`);
  for (const k of ['margin_pct', 'max_width_pct']) {
    if (!Number.isFinite(Number(layoutTok[k]))) missing.push(`layout.${k}`);
  }

  const slots = { headline: null, subheadline: null } as ReturnType<typeof resolveOverlayStyle>['slots'];
  for (const slot of SLOTS) {
    const raw = slot === 'headline' ? args.text?.headline : args.text?.subheadline;
    const value = String(raw ?? '');
    // Ranura sin texto = ranura que no se dibuja. `subheadline` es opcional POR CONTRATO: una pieza
    // sin bajada compone igual. `headline` vacío no llega acá (lo rechaza el handler).
    if (!value.trim()) continue;

    const st = ((t.typography ?? {})[slot] ?? {}) as Record<string, any>;
    // Ranura NO DECLARADA por la marca —distinto de declarada a medias, que sí es un error— : la
    // marca decidió que su composición no la lleva. Se salta con marcador y se compone el resto.
    // `headline` no admite esta salida: sin titular no hay nada que componer.
    if (slot !== 'headline' && Object.keys(st).length === 0) {
      markers.push(`OVERLAY_SLOT_NOT_DECLARED: la marca no declara typography.${slot}; se compone sin esa ranura`);
      continue;
    }
    const typoRole = String(st.role ?? '');
    const palRole = String((t.palette ?? {})[slot] ?? '');
    const typo = typoBy.get(typoRole);
    const pal = palBy.get(palRole);
    if (!typoRole) missing.push(`typography.${slot}.role`);
    else if (!typo) missing.push(`brand_typography.role='${typoRole}' (pedido por typography.${slot}.role)`);
    if (!palRole) missing.push(`palette.${slot}`);
    else if (!pal) missing.push(`brand_palette.role='${palRole}' (pedido por palette.${slot})`);
    const steps = Array.isArray(st.fit_steps) ? st.fit_steps : [];
    if (steps.length === 0) missing.push(`typography.${slot}.fit_steps`);
    if (!typo || !pal || steps.length === 0) continue;

    // 1.4.0 — énfasis: sólo en el titular. El token se valida siempre que exista (un dato mal escrito
    // se ve aunque esta pieza no traiga tramos); los tramos se aplican sólo si la marca lo declara.
    let parts: Array<{ text: string; keyword: boolean }> | null = null;
    let emphasis: (EmphasisType & { color: string }) | null = null;
    if (slot === 'headline') {
      const emType = resolveEmphasisType(st.emphasis, {
        role: typoRole, weight: Number(st.weight ?? 400), italic: st.italic === true,
        transform: String(st.transform ?? 'none'), letterSpacingEm: Number(st.letter_spacing_em ?? 0),
      }, typoBy, `typography.${slot}.emphasis`, missing);
      const emRole = (t.palette ?? {}).headline_emphasis;
      let emColor = hexToRgba(String(pal.hex), 1);
      if (emType && emRole != null) {
        const ep = palBy.get(String(emRole));
        if (!ep) missing.push(`brand_palette.role='${emRole}' (pedido por palette.headline_emphasis)`);
        else emColor = hexToRgba(String(ep.hex), 1);
      }
      const terms = (args.text?.emphasis ?? []).filter((x) => typeof x === 'string' && x);
      if (terms.length && !emType) {
        markers.push('OVERLAY_EMPHASIS_NOT_DECLARED: la petición trae tramos de énfasis y la marca no declara typography.headline.emphasis; se compone sin énfasis');
      } else if (terms.length && emType) {
        const split = splitEmphasis(value, terms);
        if (split.missing.length) {
          markers.push(`OVERLAY_EMPHASIS_NOT_IN_HEADLINE: ${split.missing.map((m) => `«${m}»`).join(', ')} no está literal en el titular; ese tramo no se resalta`);
        }
        if (split.found.length) { parts = split.parts; emphasis = { ...emType, color: emColor }; }
      }
    }

    const fit = fitFontSizePct(steps, parts && emphasis ? 'x'.repeat(emphasisEffectiveLength(parts, emphasis.sizeScale)) : value);
    if (fit.overflow) {
      markers.push(
        `OVERLAY_TEXT_OVERFLOW: ${slot} de ${value.length} caracteres excede el último escalón declarado ` +
        `(${steps[steps.length - 1].max_chars}); se compone entero al tamaño más chico (${fit.sizePct}%). ` +
        'El texto NO se recorta: es el copy ya juzgado.',
      );
    }
    slots[slot] = {
      text: value,
      role: typoRole,
      family: String(typo.font_family),
      fallback: typo.fallback ? String(typo.fallback) : null,
      cssImport: typo.css_import ? String(typo.css_import) : null,
      fontUrl: st.font_url ? String(st.font_url) : null,
      weight: Number(st.weight ?? 400),
      italic: st.italic === true,
      transform: String(st.transform ?? 'none'),
      lineHeight: Number(st.line_height ?? 1.15),
      letterSpacingEm: Number(st.letter_spacing_em ?? 0),
      sizePct: fit.sizePct,
      color: hexToRgba(String(pal.hex), 1),
      // Sin tramos, las dos claves no existen: la ranura es la de 1.3.4, clave por clave.
      ...(parts && emphasis ? { parts, emphasis } : {}),
      fitSmaller: [...new Set(steps.map((x: any) => Number(x.size_pct)))]
        .filter((x) => Number.isFinite(x) && x > 0 && x < fit.sizePct).sort((a, b) => b - a),
    };
  }

  // Velo. Existe para una razón medible: un titular sobre foto sin velo es ilegible en la mitad de
  // las escenas. Su modo, su color (rol de paleta) y su cobertura son DATO.
  let scrim: ReturnType<typeof resolveOverlayStyle>['scrim'] = null;
  const scrimTok = (layoutTok.scrim ?? null) as Record<string, any> | null;
  if (scrimTok && String(scrimTok.mode ?? 'none') !== 'none') {
    const mode = String(scrimTok.mode);
    if (!SCRIM_MODES.has(mode)) missing.push(`layout.scrim.mode='${mode}' (válidos: ${[...SCRIM_MODES].join(', ')})`);
    const role = String(scrimTok.palette ?? '');
    const pal = palBy.get(role);
    if (!role) missing.push('layout.scrim.palette');
    else if (!pal) missing.push(`brand_palette.role='${role}' (pedido por layout.scrim.palette)`);
    if (pal && SCRIM_MODES.has(mode)) {
      scrim = {
        mode,
        color: String(pal.hex),
        opacity: Number(scrimTok.opacity ?? 1),
        coveragePct: Number(scrimTok.coverage_pct ?? 100),
      };
    }
  }

  // Filete de marca. Opcional y también dato.
  let rule: ReturnType<typeof resolveOverlayStyle>['rule'] = null;
  const ruleTok = (layoutTok.rule ?? null) as Record<string, any> | null;
  if (ruleTok && ruleTok.enabled === true) {
    const role = String(ruleTok.palette ?? '');
    const pal = palBy.get(role);
    if (!role) missing.push('layout.rule.palette');
    else if (!pal) missing.push(`brand_palette.role='${role}' (pedido por layout.rule.palette)`);
    if (pal) {
      rule = {
        color: hexToRgba(String(pal.hex), 1),
        widthPct: Number(ruleTok.width_pct ?? 10),
        thicknessPx: Number(ruleTok.thickness_px ?? 3),
        gapPct: Number(ruleTok.gap_pct ?? 2),
      };
    }
  }

  // BRIEF 8 · D — la franja de identidad. Ausente ⇒ null y la escena queda como antes de este brief:
  // aditivo, igual que todo lo demás. Declarada a medias (modo desconocido, rol de paleta que la
  // marca no tiene) ⇒ falla nombrando, como el resto del bloque: el sello de una marca no se dibuja
  // «aproximadamente».
  let identity: ReturnType<typeof resolveOverlayStyle>['identity'] = null;
  const identityTok = (t.identity ?? null) as Record<string, any> | null;
  if (identityTok && String(identityTok.mode ?? 'none') !== 'none') {
    const mode = String(identityTok.mode);
    if (!IDENTITY_MODES.has(mode)) missing.push(`identity.mode='${mode}' (válidos: ${[...IDENTITY_MODES].join(', ')})`);
    const role = String(identityTok.palette ?? '');
    const pal = palBy.get(role);
    if (!role) missing.push('identity.palette');
    else if (!pal) missing.push(`brand_palette.role='${role}' (pedido por identity.palette)`);
    const widthPct = Number(identityTok.width_pct);
    if (!Number.isFinite(widthPct) || widthPct <= 0) missing.push('identity.width_pct');
    if (pal && IDENTITY_MODES.has(mode) && Number.isFinite(widthPct) && widthPct > 0) {
      identity = {
        mode,
        color: hexToRgba(String(pal.hex), 1),
        widthPct,
        // `full_bleed: false` NO es "más corta": es una declaración que este motor todavía no sabe
        // dibujar de otra manera, y se dice en vez de silenciarse. La franja siempre corre el borde
        // entero; un día que exista un modo parcial, este flag es donde vive.
        fullBleed: identityTok.full_bleed !== false,
      };
      if (identityTok.full_bleed === false) {
        markers.push('IDENTITY_FULL_BLEED_IGNORED: identity.full_bleed=false no está implementado; la franja se dibuja a sangre completa (nunca un marco cerrado)');
      }
    }
  }

  // 1.5.0 — los requisitos de la plataforma, como dato del canal. Declarados mal ⇒ fail-loud, como el resto.
  let maxTextAreaPct: number | null = null;
  if (layoutTok.max_text_area_pct != null) {
    const v = Number(layoutTok.max_text_area_pct);
    if (!Number.isFinite(v) || v <= 0 || v > 100) missing.push(`layout.max_text_area_pct=${layoutTok.max_text_area_pct} (válido: 0 < x ≤ 100)`);
    else maxTextAreaPct = v;
  }
  let safeZonePct: { top: number; bottom: number; left: number; right: number } | null = null;
  if (layoutTok.safe_zone_pct != null) {
    const z = layoutTok.safe_zone_pct as Record<string, unknown>;
    const sides = ['top', 'bottom', 'left', 'right'] as const;
    const vals = sides.map((k) => Number(isPlain(z) ? (z[k] ?? 0) : NaN));
    if (!isPlain(z) || vals.some((v) => !Number.isFinite(v) || v < 0 || v >= 50)) {
      missing.push(`layout.safe_zone_pct (objeto { top, bottom, left, right } con 0 ≤ x < 50; llegó ${JSON.stringify(layoutTok.safe_zone_pct)})`);
    } else safeZonePct = { top: vals[0], bottom: vals[1], left: vals[2], right: vals[3] };
  }

  // 1.6.0 — el texto no tapa una cara. Ausente o `enabled: false` ⇒ no existe y nada cambia.
  let avoidFaces: { anchors: string[]; marginPct: number; keepAlign: boolean } | null = null;
  const afTok = layoutTok.avoid_faces as unknown;
  if (afTok != null && !(isPlain(afTok) && (afTok as Record<string, unknown>).enabled === false)) {
    const af = afTok as Record<string, unknown>;
    if (!isPlain(afTok) || af.enabled !== true) {
      missing.push(`layout.avoid_faces (objeto { enabled: true, anchors?: [anclas], margin_pct?: 0..20 }; llegó ${JSON.stringify(afTok)})`);
    } else {
      const list = af.anchors == null ? faceAnchorCandidates(anchor) : (Array.isArray(af.anchors) ? af.anchors.map(String) : null);
      const bad = list === null ? ['(no es una lista)'] : list.filter((a) => !ANCHORS[a]);
      const marginPct = Number(af.margin_pct ?? 2);
      if (bad.length) missing.push(`layout.avoid_faces.anchors: ${bad.join(', ')} (válidos: ${Object.keys(ANCHORS).join(', ')})`);
      if (!Number.isFinite(marginPct) || marginPct < 0 || marginPct > 20) missing.push(`layout.avoid_faces.margin_pct=${af.margin_pct} (0 ≤ x ≤ 20)`);
      if (!bad.length && list && ANCHORS[anchor] && Number.isFinite(marginPct) && marginPct >= 0 && marginPct <= 20) {
        avoidFaces = { anchors: [...new Set([anchor, ...list])], marginPct, keepAlign: layoutTok.align != null };
      }
    }
  }
  // 1.6.0 — sombra por glifo del overlay: la MISMA forma que `carousel.text_effect` (1.3.4), con el color como
  // ROL de `brand_palette` (como el velo y el filete del overlay), no como función del cromo de carrusel.
  let textEffect: { color: string; blurPct: number; offsetPct: number } | null = null;
  if (layoutTok.text_effect != null) {
    try {
      const te = parseCarouselTextEffect(layoutTok.text_effect);
      const pal = palBy.get(te.fn);
      if (!pal) missing.push(`brand_palette.role='${te.fn}' (pedido por layout.text_effect.color)`);
      else textEffect = { color: hexToRgba(String(pal.hex), te.alpha), blurPct: te.blurPct, offsetPct: te.offsetPct };
    } catch (e) {
      missing.push(`layout.text_effect: ${e instanceof Error ? e.message.replace(/carousel\.text_effect/g, 'layout.text_effect').replace('función de tokens.palette', 'rol de brand_palette') : String(e)}`);
    }
  }

  if (missing.length) {
    throw new CompositorError(
      'COMPOSITOR_TOKENS_INCOMPLETE',
      `faltan datos de marca para componer: ${missing.join(' · ')}. ` +
      'El motor no tiene fuentes ni colores propios con los que rellenar (BRIEF 7, regla b).',
    );
  }

  return {
    layout: {
      anchor,
      marginPct: Number(layoutTok.margin_pct),
      maxWidthPct: Number(layoutTok.max_width_pct),
      gapPct: Number(layoutTok.gap_pct ?? 2),
      align: (layoutTok.align ? String(layoutTok.align) : ANCHORS[anchor].align) as 'left' | 'center' | 'right',
      ...(maxTextAreaPct != null ? { maxTextAreaPct } : {}),
      ...(safeZonePct ? { safeZonePct } : {}),
      ...(avoidFaces ? { avoidFaces } : {}),
    },
    ...(textEffect ? { textEffect } : {}),
    slots,
    scrim,
    rule,
    identity,
    markers,
  };
}

// ── CAPA DE PRODUCTO (2026-09-27) ──────────────────────────────────────────────────────────────
// El PNG REAL del producto, pegado por código sobre la escena limpia: el generador no lo redibuja,
// igual que no redibuja el titular. Misma disciplina que el resto del bloque: la POSICIÓN y el TAMAÑO
// son dato de la marca (`tokens.product`); el motor sólo sabe de anclas y porcentajes.
//
//   tokens.product = { mode: 'composite', anchor, height_pct, margin_pct, max_items?, overlap_pct? }
//   (sin `mode: 'composite'` el producto NO se pega: lo pinta el generador — opción (c), 2026-09-27)
//
// · Ausente ⇒ la marca no compone producto: se omite con marcador, la escena sale como antes.
// · Declarada a medias ⇒ falla nombrando, como la tipografía.
// · Misma ancla que el titular ⇒ falla: dos capas en la misma esquina se tapan, y esa colisión no se
//   resuelve "aproximadamente".
// Un kit llega como VARIOS productos (sus componentes): se dibujan en fila, solapados `overlap_pct`
// sobre su propio ancho, hasta `max_items`.
export interface ProductImageIn { src: string; width: number; height: number; name?: string | null }

export function resolveProductLayer(args: {
  tokens: Record<string, any>; textAnchor: string | null; count: number;
}): { layer: null | { anchor: string; heightPct: number; marginPct: number; maxItems: number; overlapPct: number }; markers: string[] } {
  const markers: string[] = [];
  if (!args.count) return { layer: null, markers };
  const tok = (args.tokens ?? {}).product as Record<string, any> | undefined;
  if (!tok || Object.keys(tok).length === 0) {
    markers.push('PRODUCT_LAYER_NOT_DECLARED: llegaron productos pero la marca no declara tokens.product; se compone sin producto');
    return { layer: null, markers };
  }
  // Opción (c) (Sam, 2026-09-27): por defecto el producto lo PINTA el generador en la escena, a su
  // tamaño real. El compositor sólo lo pega si la marca lo pide explícitamente con `mode: 'composite'`.
  if (tok.mode !== 'composite') {
    markers.push(`PRODUCT_IN_SCENE: la marca declara product.mode='${tok.mode ?? '∅'}' — el producto va pintado en la escena, no se pega`);
    return { layer: null, markers };
  }
  const missing: string[] = [];
  const anchor = String(tok.anchor ?? '');
  if (!ANCHORS[anchor]) missing.push(`product.anchor='${anchor || '∅'}' (válidos: ${Object.keys(ANCHORS).join(', ')})`);
  else if (args.textAnchor && anchor === args.textAnchor) missing.push(`product.anchor='${anchor}' coincide con layout.anchor del titular: las dos capas se taparían`);
  const heightPct = Number(tok.height_pct);
  if (!Number.isFinite(heightPct) || heightPct <= 0 || heightPct > 100) missing.push('product.height_pct');
  const marginPct = Number(tok.margin_pct);
  if (!Number.isFinite(marginPct) || marginPct < 0) missing.push('product.margin_pct');
  if (missing.length) {
    throw new CompositorError('COMPOSITOR_TOKENS_INCOMPLETE',
      `faltan datos de marca para la capa de producto: ${missing.join(' · ')}.`);
  }
  const maxItems = Math.max(1, Math.floor(Number(tok.max_items ?? 1)));
  const overlapPct = Math.min(90, Math.max(0, Number(tok.overlap_pct ?? 0)));
  if (args.count > maxItems) markers.push(`PRODUCT_LAYER_TRIMMED: llegaron ${args.count} productos y la marca compone hasta ${maxItems}; se dibujan los primeros`);
  return { layer: { anchor, heightPct, marginPct, maxItems, overlapPct }, markers };
}

/**
 * La escena que come satori: un árbol JSON plano (`{type, props}`), sin JSX y sin dependencias.
 * Función PURA de (estilo, dimensiones, fondo) — misma entrada ⇒ mismo árbol, clave por clave.
 *
 * Las medidas: los tamaños de fuente y los márgenes se derivan del ANCHO (el ojo lee líneas, y el
 * ancho es lo que fija cuántos caracteres entran por línea); la cobertura del velo, del ALTO. Un
 * mismo token rinde igual en 1:1 que en 9:16 sin una tabla por formato.
 */
/**
 * 1.5.0 — la caja donde vive el bloque de texto del overlay: los cuatro rellenos y el ancho máximo. PURO.
 * Sin zona segura es la de siempre (margen uniforme y `max_width_pct`); con ella, cada borde toma el mayor
 * entre el margen y el % que la interfaz de la plataforma tapa, y el ancho no pasa del hueco que queda.
 */
export function overlayTextBox(style: ReturnType<typeof resolveOverlayStyle>, width: number, height: number): {
  safe: boolean; top: number; right: number; bottom: number; left: number; maxWidth: number;
} {
  const px = (pct: number, base: number) => Math.round((pct / 100) * base * 100) / 100;
  const m = px(style.layout.marginPct, width);
  const mw = px(style.layout.maxWidthPct, width);
  const z = style.layout.safeZonePct;
  if (!z) return { safe: false, top: m, right: m, bottom: m, left: m, maxWidth: mw };
  const top = Math.max(m, px(z.top, height));
  const bottom = Math.max(m, px(z.bottom, height));
  const left = Math.max(m, px(z.left, width));
  const right = Math.max(m, px(z.right, width));
  return { safe: true, top, right, bottom, left, maxWidth: Math.min(mw, Math.round((width - left - right) * 100) / 100) };
}

// Ancho medio de glifo (en em) cuando no hay métricas de la fuente: la medición queda ESTIMADA y se dice.
const AREA_FALLBACK_EM = 0.6;

/**
 * 1.5.0 — el tamaño del bloque de texto del overlay (titular, filete y bajada), con las MISMAS medidas que
 * `buildOverlayScene`: tamaños en % del ancho, corte de línea voraz por palabras dentro de la caja, cada
 * tramo con énfasis medido con su fuente y su tamaño, y cada línea tan alta como su letra más grande. PURO.
 * Mide la caja de LÍNEAS (con su interlineado), que es un poco mayor que la de los glifos: el límite queda
 * del lado seguro.
 */
export function measureOverlayText(style: ReturnType<typeof resolveOverlayStyle>, width: number, height: number,
  metrics: Record<string, FontAdvance | null | undefined> | null | undefined,
): { width: number; height: number; areaPct: number; estimated: string[] } {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const box = overlayTextBox(style, width, height);
  const estimated: string[] = [];
  const widthFn = (f: { family: string; weight: number; italic: boolean; transform: string; letterSpacingEm: number }, size: number) => {
    const m = metrics?.[fitFontKey(f)] ?? null;
    if (!m && !estimated.includes(f.family)) estimated.push(f.family);
    const ls = r2(f.letterSpacingEm * size);
    return (s: string) => {
      const str = f.transform === 'uppercase' ? s.toUpperCase() : f.transform === 'lowercase' ? s.toLowerCase() : s;
      let w = 0;
      for (const ch of str) {
        const cp = ch.codePointAt(0)!;
        const em = m ? (m.advances.get(cp) ?? (cp === 0xa0 ? m.advances.get(0x20) : undefined) ?? m.avgEm) : AREA_FALLBACK_EM;
        w += em * size + ls;
      }
      return w;
    };
  };
  let maxLine = 0;
  let total = 0;
  const slotBlock = (s: NonNullable<ReturnType<typeof resolveOverlayStyle>['slots']['headline']>) => {
    const size = r2((s.sizePct / 100) * width);
    const base = widthFn(s, size);
    const em = s.parts && s.emphasis ? s.emphasis : null;
    const esize = em ? r2(size * em.sizeScale) : size;
    const emw = em ? widthFn(em, esize) : base;
    const atoms = s.parts && em ? headlineAtoms(s.parts) : headlineAtoms([{ text: s.text, keyword: false }]);
    let cur = 0, lineMax = 0, h = 0;
    for (const atom of atoms) {
      const aw = atom.reduce((acc, p) => acc + (p.keyword && em ? emw(p.text) : base(p.text)), 0);
      const ah = Math.max(...atom.map((p) => (p.keyword && em ? esize : size)));
      if (cur > 0 && cur + aw > box.maxWidth + 0.01) { h += lineMax; maxLine = Math.max(maxLine, cur); cur = aw; lineMax = ah; }
      else { cur += aw; lineMax = Math.max(lineMax, ah); }
    }
    maxLine = Math.max(maxLine, Math.min(cur, box.maxWidth));
    return (h + lineMax) * s.lineHeight;
  };
  const hl = style.slots.headline;
  if (hl) total += slotBlock(hl);
  if (style.rule && hl) {
    total += r2((style.rule.gapPct / 100) * width) + style.rule.thicknessPx;
    maxLine = Math.max(maxLine, r2((style.rule.widthPct / 100) * width));
  }
  if (style.slots.subheadline) total += r2((style.layout.gapPct / 100) * width) + slotBlock(style.slots.subheadline);
  const w = Math.min(maxLine, box.maxWidth);
  return { width: r2(w), height: r2(total), areaPct: Math.round((10000 * w * total) / (width * height)) / 100, estimated };
}

/**
 * 1.5.0 — el límite de área de la plataforma (`layout.max_text_area_pct`). PURO y determinista. Si el
 * bloque cabe —o la marca no declara límite— devuelve EL MISMO estilo: la escena sale idéntica. Si no
 * cabe, baja por los escalones del titular, luego por los de la bajada, luego quita la bajada; si aun así
 * excede, compone al mínimo y lo marca. El texto nunca se recorta ni se reescribe.
 */
export function fitOverlayTextArea(args: {
  style: ReturnType<typeof resolveOverlayStyle>; width: number; height: number;
  metrics?: Record<string, FontAdvance | null | undefined> | null;
}): { style: ReturnType<typeof resolveOverlayStyle>; report: null | { limit_pct: number; area_pct_before: number; area_pct: number; adjusted: boolean; dropped_subheadline: boolean; exceeded: boolean; estimated_fonts: string[] } } {
  const base = args.style;
  const limit = base.layout.maxTextAreaPct;
  if (limit == null || !base.slots.headline) return { style: base, report: null };
  const first = measureOverlayText(base, args.width, args.height, args.metrics);
  const est = first.estimated.length
    ? [`OVERLAY_TEXT_AREA_ESTIMATED: sin métricas de ${first.estimated.join(', ')}; el área se estimó con un ancho medio genérico`] : [];
  if (first.areaPct <= limit) {
    return { style: est.length ? { ...base, markers: [...base.markers, ...est] } : base,
      report: { limit_pct: limit, area_pct_before: first.areaPct, area_pct: first.areaPct, adjusted: false, dropped_subheadline: false, exceeded: false, estimated_fonts: first.estimated } };
  }
  type St = { h: number; s: number | null; drop: boolean };
  const hl = base.slots.headline;
  const sub = base.slots.subheadline;
  const ladder: St[] = [];
  let st: St = { h: hl.sizePct, s: sub ? sub.sizePct : null, drop: false };
  for (const h of hl.fitSmaller ?? []) ladder.push(st = { ...st, h });
  if (sub) for (const x of sub.fitSmaller ?? []) ladder.push(st = { ...st, s: x });
  if (sub) ladder.push(st = { ...st, drop: true });
  const apply = (x: St): ReturnType<typeof resolveOverlayStyle> => ({
    ...base,
    slots: {
      headline: { ...hl, sizePct: x.h },
      subheadline: !sub || x.drop ? null : { ...sub, sizePct: x.s ?? sub.sizePct },
    },
  });
  let chosen: St | null = null;
  let out = base;
  let m = first;
  for (const x of ladder) {
    out = apply(x);
    m = measureOverlayText(out, args.width, args.height, args.metrics);
    if (m.areaPct <= limit) { chosen = x; break; }
  }
  const final = chosen ?? ladder[ladder.length - 1] ?? { h: hl.sizePct, s: sub ? sub.sizePct : null, drop: false };
  if (!chosen) { out = apply(final); m = measureOverlayText(out, args.width, args.height, args.metrics); }
  const markers = [...base.markers, ...est];
  const what: string[] = [];
  if (final.h !== hl.sizePct) what.push(`titular ${hl.sizePct}→${final.h} %`);
  if (sub && final.s != null && final.s !== sub.sizePct && !final.drop) what.push(`bajada ${sub.sizePct}→${final.s} %`);
  if (final.drop) what.push('sin bajada');
  if (what.length) markers.push(`OVERLAY_TEXT_AREA_REDUCED: el texto ocupaba ${first.areaPct} % de la imagen (límite ${limit} %); ${what.join(' · ')} → ${m.areaPct} %`);
  if (!chosen) markers.push(`OVERLAY_TEXT_AREA_EXCEEDED: ni al tamaño mínimo cabe en ${limit} % (queda en ${m.areaPct} %); se compone igual, el texto no se recorta`);
  return { style: { ...out, markers },
    report: { limit_pct: limit, area_pct_before: first.areaPct, area_pct: m.areaPct, adjusted: true, dropped_subheadline: !!(sub && final.drop), exceeded: !chosen, estimated_fonts: first.estimated } };
}

/**
 * 1.4.0 — los átomos del titular con énfasis, como nodos de satori. PURO. Un átomo es una palabra
 * (con su espacio duro al final, ver `headlineAtoms`); cada tramo enfatizado lleva su familia, peso,
 * estilo, tamaño (escala del titular), tracking, transformación y color. Los demás heredan del padre.
 */
function emphasisAtomsNode(
  parts: Array<{ text: string; keyword: boolean }>,
  base: { sizePct: number },
  em: EmphasisType & { color: string },
  width: number,
  // 1.6.0 — la sombra del overlay viaja también a los tramos con énfasis (sin depender de la herencia).
  textShadow?: string,
): Array<Record<string, any>> {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const size = r2((base.sizePct * em.sizeScale / 100) * width);
  const emStyle = {
    fontFamily: em.family, fontWeight: em.weight, fontStyle: em.italic ? 'italic' : 'normal',
    fontSize: size, letterSpacing: r2(em.letterSpacingEm * size), textTransform: em.transform, color: em.color,
    ...(textShadow ? { textShadow } : {}),
  };
  return headlineAtoms(parts).map((atom) => ({
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'row', alignItems: 'baseline' },
      children: atom.map((p) => ({ type: 'span', props: { style: p.keyword ? emStyle : {}, children: p.text } })),
    },
  }));
}

export function buildOverlayScene(args: {
  style: ReturnType<typeof resolveOverlayStyle>;
  width: number; height: number; backgroundSrc: string;
  products?: ProductImageIn[];
  productLayer?: ReturnType<typeof resolveProductLayer>['layer'];
}): Record<string, any> {
  const { style, width, height, backgroundSrc } = args;
  const px = (pct: number, base: number) => Math.round((pct / 100) * base * 100) / 100;
  const a = ANCHORS[style.layout.anchor];
  const children: Array<Record<string, any>> = [];

  children.push({
    type: 'img',
    props: {
      src: backgroundSrc, width, height,
      style: { position: 'absolute', top: 0, left: 0, width, height, objectFit: 'cover' },
    },
  });

  if (style.scrim) {
    const cover = px(style.scrim.coveragePct, height);
    const from = hexToRgba(style.scrim.color, style.scrim.opacity);
    const to = hexToRgba(style.scrim.color, 0);
    const grad = style.scrim.mode === 'solid'
      ? { backgroundColor: from }
      : { backgroundImage: `linear-gradient(${style.scrim.mode === 'gradient_top' ? '180deg' : '0deg'}, ${from} 0%, ${to} 100%)` };
    children.push({
      type: 'div',
      props: {
        style: {
          position: 'absolute', left: 0, width,
          height: cover,
          ...(style.scrim.mode === 'gradient_top' ? { top: 0 } : { bottom: 0 }),
          ...grad,
        },
      },
    });
  }

  // BRIEF 8 · D — la franja de identidad, ENCIMA del velo (que si no se la comería) y debajo del
  // texto. D.1 — el grosor se calcula sobre el LADO CORTO, no sobre el ancho: con el ancho, un 1,8%
  // rinde 18px en un 1:1 de 1024 y 18px en un 9:16 de 1024×1792 pero 34px en un 16:9 de 1920×1080 —
  // la misma marca se vería tres grosores distintos según el formato. Con el lado corto, el sello se
  // lee IGUAL en 1:1, 4:5, 9:16 y 16:9. Y el borde elegido es constante entre formatos: la franja no
  // se reposiciona ni se deforma porque cambie el aspecto.
  if (style.identity) {
    const shortSide = Math.min(width, height);
    const thickness = Math.max(1, Math.round(px(style.identity.widthPct, shortSide)));
    const vertical = style.identity.mode === 'edge_left' || style.identity.mode === 'edge_right';
    children.push({
      type: 'div',
      props: {
        style: {
          position: 'absolute',
          backgroundColor: style.identity.color,
          // A sangre completa del borde elegido: 100% del lado que recorre. Nunca dos bordes a la
          // vez — eso sería un marco, que es exactamente lo que la regla dura prohíbe.
          ...(vertical
            ? { top: 0, height, width: thickness, ...(style.identity.mode === 'edge_left' ? { left: 0 } : { right: 0 }) }
            : { left: 0, width, height: thickness, bottom: 0 }),
        },
      },
    });
  }

  // CAPA DE PRODUCTO — encima del velo y del sello, debajo del texto. El alto sale del ALTO de la
  // escena (un frasco se mide de pie); el ancho, del aspecto REAL del PNG: nunca se deforma.
  const pl = args.productLayer ?? null;
  const prods = (args.products ?? []).slice(0, pl?.maxItems ?? 0);
  if (pl && prods.length) {
    const pa = ANCHORS[pl.anchor];
    const h = px(pl.heightPct, height);
    children.push({
      type: 'div',
      props: {
        style: {
          position: 'absolute', top: 0, left: 0, width, height,
          display: 'flex', flexDirection: 'row',
          justifyContent: pa.x, alignItems: pa.y,
          padding: px(pl.marginPct, width),
        },
        children: [{
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-end' },
            children: prods.map((p, k) => {
              const w = Math.round((h * p.width / p.height) * 100) / 100;
              return {
                type: 'img',
                props: {
                  src: p.src, width: w, height: h,
                  style: { width: w, height: h, ...(k > 0 ? { marginLeft: -Math.round((pl.overlapPct / 100) * w) } : {}) },
                },
              };
            }),
          },
        }],
      },
    });
  }

  const box = overlayTextBox(style, width, height);
  const textChildren: Array<Record<string, any>> = [];
  // 1.6.0 — sin token es undefined y ningún estilo cambia: la escena es la de 1.5.0, clave por clave.
  const shadow = style.textEffect ? overlayTextShadow(style.textEffect, width) : undefined;
  const slotNode = (s: NonNullable<ReturnType<typeof resolveOverlayStyle>['slots']['headline']>, marginTop: number) => ({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        marginTop,
        fontFamily: s.family,
        fontSize: px(s.sizePct, width),
        fontWeight: s.weight,
        fontStyle: s.italic ? 'italic' : 'normal',
        color: s.color,
        lineHeight: s.lineHeight,
        letterSpacing: px(s.letterSpacingEm * s.sizePct, width),
        textTransform: s.transform,
        textAlign: style.layout.align,
        ...(shadow ? { textShadow: shadow } : {}),
        // 1.4.0 — con tramos, la ranura es una fila que envuelve átomos (palabras que no se cortan),
        // alineados por la línea de base: un tramo más grande no descoloca a sus vecinos.
        ...(s.parts && s.emphasis ? {
          flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline',
          justifyContent: style.layout.align === 'center' ? 'center' : style.layout.align === 'right' ? 'flex-end' : 'flex-start',
        } : {}),
      },
      children: s.parts && s.emphasis ? emphasisAtomsNode(s.parts, s, s.emphasis, width, shadow) : s.text,
    },
  });

  if (style.slots.headline) textChildren.push(slotNode(style.slots.headline, 0));
  // El filete acompaña al TITULAR: sin titular no hay nada que subrayar. (La franja de identidad es
  // otra cosa y sí se dibuja sola — una firma la marca, un filete separa texto.)
  if (style.rule && style.slots.headline) {
    textChildren.push({
      type: 'div',
      props: {
        style: {
          marginTop: px(style.rule.gapPct, width),
          width: px(style.rule.widthPct, width),
          height: style.rule.thicknessPx,
          backgroundColor: style.rule.color,
        },
      },
    });
  }
  if (style.slots.subheadline) {
    textChildren.push(slotNode(style.slots.subheadline, px(style.layout.gapPct, width)));
  }

  // Sin ninguna ranura de texto no se emite el contenedor: la escena queda SELLADA (franja) y sin
  // tipografía. Es el caso de una pieza cuyo título todavía no existe — se sella hoy y se recompone
  // con el titular cuando lo tenga, sin volver a generar la escena.
  if (textChildren.length === 0) {
    return { type: 'div', props: { style: { display: 'flex', position: 'relative', width, height }, children } };
  }

  children.push({
    type: 'div',
    props: {
      style: {
        position: 'absolute', top: 0, left: 0, width, height,
        display: 'flex', flexDirection: 'column',
        justifyContent: a.y, alignItems: a.x,
        // 1.5.0 — con zona segura, cada borde lleva el mayor entre el margen y lo que la interfaz tapa.
        ...(box.safe ? { paddingTop: box.top, paddingRight: box.right, paddingBottom: box.bottom, paddingLeft: box.left }
          : { padding: px(style.layout.marginPct, width) }),
      },
      children: [{
        type: 'div',
        props: {
          style: {
            display: 'flex', flexDirection: 'column',
            alignItems: a.x,
            maxWidth: box.maxWidth,
          },
          children: textChildren,
        },
      }],
    },
  });

  return { type: 'div', props: { style: { display: 'flex', position: 'relative', width, height }, children } };
}

/**
 * Dimensiones REALES del PNG/JPEG que devolvió el generador. No se asumen por el canal: el aspect
 * ratio pedido y el entregado no siempre coinciden, y componer sobre dimensiones supuestas descoloca
 * el texto. PNG: cabecera IHDR. JPEG: primer marcador SOFn.
 */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number; mime: string } {
  const b = bytes;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const rd = (o: number) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
    return { width: rd(16), height: rd(20), mime: 'image/png' };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const marker = b[o + 1];
      const len = (b[o + 2] << 8) | b[o + 3];
      // SOF0..SOF15 menos los marcadores que no son de trama (DHT 0xc4, JPG 0xc8, DAC 0xcc).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: (b[o + 7] << 8) | b[o + 8], height: (b[o + 5] << 8) | b[o + 6], mime: 'image/jpeg' };
      }
      o += 2 + len;
    }
  }
  throw new CompositorError('COMPOSITOR_IMAGE_UNSUPPORTED', 'la imagen limpia no es PNG ni JPEG legible', 415);
}

/**
 * `@font-face` de una hoja de Google Fonts (`css_import` de `brand_typography`) → candidatos.
 * Pedida con un User-Agent viejo, la css2 devuelve TTF, que es lo que satori sabe leer (woff2 no).
 * Puro: recibe el CSS ya bajado.
 */
export function parseFontFaces(css: string): Array<{ family: string; weight: number; italic: boolean; url: string }> {
  const out: Array<{ family: string; weight: number; italic: boolean; url: string }> = [];
  for (const m of String(css ?? '').matchAll(/@font-face\s*\{([\s\S]*?)\}/g)) {
    const block = m[1];
    const family = (block.match(/font-family:\s*['"]?([^;'"]+)['"]?\s*;/) ?? [])[1] ?? '';
    const weight = Number((block.match(/font-weight:\s*([0-9]+)/) ?? [])[1] ?? 400);
    const italic = /font-style:\s*italic/.test(block);
    const url = (block.match(/url\(([^)]+)\)/) ?? [])[1] ?? '';
    if (url) out.push({ family: family.trim(), weight, italic, url: url.replace(/['"]/g, '').trim() });
  }
  return out;
}

/**
 * 1.3.1 — la fuente que recibe satori, SIN KERNING. Devuelve una COPIA con las tablas `kern` y `GPOS`
 * renombradas en el directorio de tablas (`kern`→`xern`, `GPOS`→`xPOS`), así el lector de fuentes de
 * satori no las encuentra; el resto de los bytes no se toca. Acepta sfnt (TrueType u OpenType/CFF)
 * y WOFF; cualquier otra cosa vuelve intacta con `neutralized: []`. Puro e idempotente.
 *
 * POR QUÉ, medido (satori 0.12.2, 2026-10-03): satori UBICA cada palabra sumando el avance de cada
 * grafema por separado —sin pares de kerning— y la DIBUJA con kerning. Toda palabra con pares
 * negativos queda más corta que su caja y el hueco sobrante aparece pegado a la palabra siguiente:
 * hasta +9,8 px después de una palabra de cinco letras con pares fuertes, en una familia condensada
 * en negrita a 90,7 px (un espacio de esa fuente mide 18,6 px). Pasa en cualquier texto y cualquier
 * marca, con mayúsculas o sin ellas, dentro o fuera de `headlineAtoms`; se nota más donde la familia
 * tiene pares fuertes y el cuerpo es grande. Sin kerning, la medida y el dibujo coinciden: el espacio
 * entre palabras vuelve a ser el de la fuente.
 * En el lector de satori `GPOS` sólo aporta kerning (no hay posicionamiento de marcas), así que
 * renombrarlo no mueve ningún acento: los TTF traen las letras acentuadas compuestas.
 */
export function neutralizeKerning(bytes: Uint8Array): { bytes: Uint8Array; neutralized: string[] } {
  const out = new Uint8Array(bytes);
  const neutralized: string[] = [];
  const u16 = (o: number) => (out[o] << 8) | out[o + 1];
  const tag = (o: number) => String.fromCharCode(out[o], out[o + 1], out[o + 2], out[o + 3]);
  if (out.length < 12) return { bytes: out, neutralized };
  const sig = tag(0);
  const sfnt = sig === '\u0000\u0001\u0000\u0000' || sig === 'OTTO' || sig === 'true';
  const woff = sig === 'wOFF';
  if (!sfnt && !woff) return { bytes: out, neutralized };
  const count = u16(woff ? 12 : 4);
  const dirAt = woff ? 44 : 12;
  const entry = woff ? 20 : 16;
  for (let k = 0; k < count; k++) {
    const o = dirAt + k * entry;
    if (o + 4 > out.length) break;
    const t = tag(o);
    if (t === 'kern' || t === 'GPOS') { out[o] = 0x78; neutralized.push(t); }   // 0x78 = 'x'
  }
  return { bytes: out, neutralized };
}

/** El @font-face más cercano al peso pedido, respetando la itálica. Determinista ante empates. */
export function pickFontFace(
  faces: Array<{ family: string; weight: number; italic: boolean; url: string }>,
  want: { weight: number; italic: boolean },
): { family: string; weight: number; italic: boolean; url: string } | null {
  const pool = faces.filter((f) => f.italic === want.italic);
  const use = pool.length ? pool : faces;
  if (!use.length) return null;
  return [...use].sort((a, b) =>
    (Math.abs(a.weight - want.weight) - Math.abs(b.weight - want.weight)) ||
    (a.weight - b.weight) || a.url.localeCompare(b.url))[0];
}

// ── F3 (2026-10-02) · LÁMINAS DE CARRUSEL SEGÚN LA MAQUETA v4 ──────────────────────────────────
// Cada lámina lleva: barra de progreso por lámina, número `i / n`, etiqueta superior, UNA palabra
// clave del titular resaltada, cifra con barra a escala y su fuente, pasos con uno crítico, CTA de
// texto subrayado (sólo en el cierre, nunca con forma de botón), el aviso de deslizar con flecha (sólo en la
// portada) y el logotipo de la marca en el pie.
//
// EJE Y INSTANCIA, igual que el resto del bloque:
//   · EJE (código): qué elemento existe, dónde va y qué FUNCIÓN de color lo pinta — la regla de la
//     maqueta (`CAROUSEL_ELEMENT_COLOR`). También las proporciones internas, derivadas de los tamaños
//     de letra (un punto mide media letra de cuerpo en cualquier marca).
//   · INSTANCIA (dato): qué ROL de `brand_palette` juega cada función (`tokens.palette`), qué ROL de
//     `brand_typography` y qué tamaño lleva cada familia de texto, el lienzo, el margen, el velo y el
//     texto del aviso de deslizar, por idioma (`tokens.carousel`), y el logotipo (`public.brand_logo`).
// Sin `tokens.carousel` en la fila resuelta, el campo `carousel` de la petición se ignora y la escena
// es la de 1.2.0, byte por byte.

const CAROUSEL_ROLES = new Set(['cover', 'body', 'closing']);
const CAROUSEL_BACKGROUNDS = new Set(['image', 'surface']);
const CAROUSEL_MAX_SLIDES = 10;
const CAROUSEL_MAX_STEPS = 5;

// Funciones de color que una marca con carrusel DEBE declarar en `tokens.palette` (valor: rol de
// `brand_palette`, o `{ role, alpha }`). Las opcionales tienen un reemplazo declarado abajo.
const CAROUSEL_COLOR_FUNCTIONS = ['keyword', 'progress_on', 'progress_off', 'counter', 'critical', 'light', 'muted', 'surface', 'figure'];

// EL REPARTO elemento → función de color. Es la regla de la maqueta v4 y es del sistema: acento 1 en
// la barra de progreso y en la palabra clave; acento 2 en `i / n`, el paso crítico y el punto de la
// fuente; la «luz» en el aviso de deslizar y el subrayado del CTA. Qué hex es cada acento lo dice la marca.
const CAROUSEL_ELEMENT_COLOR: Record<string, string> = {
  progress_done: 'progress_on', progress_todo: 'progress_off',
  eyebrow: 'muted', counter: 'counter',
  headline: 'text', keyword: 'keyword', subheadline: 'text_soft',
  figure: 'figure', bar_track: 'progress_off', bar_from: 'progress_on', bar_to: 'counter',
  source_text: 'muted', source_mark: 'counter',
  step_text: 'text_soft', step_mark: 'keyword', step_critical_text: 'text', step_critical_mark: 'critical',
  cta_text: 'text', cta_underline: 'light', swipe: 'light',
};

export interface CarouselIn {
  index: number; total: number; role: 'cover' | 'body' | 'closing'; background: 'image' | 'surface';
  eyebrow: string | null; keyword: string | null;
  figure: null | { value: string; bar: null | { from: number; to: number }; source: string };
  steps: Array<{ text: string; critical: boolean }>;
  cta: string | null;
}

/**
 * Valida el campo `carousel` de la petición contra el contrato F3. Errores 400 con etiqueta estable:
 * son errores del LLAMADOR (la misma regla la valida el carril antes de llamar). Ausente ⇒ null.
 * No toca el texto: lo que llega es copy ya juzgado y se devuelve tal cual.
 */
export function parseCarouselRequest(raw: unknown): CarouselIn | null {
  if (raw == null) return null;
  const bad = (label: string, msg: string) => new CompositorError(label, msg, 400);
  if (!isPlain(raw)) throw bad('CAROUSEL_BAD_REQUEST', 'carousel debe ser un objeto');
  const r = raw as Record<string, any>;
  const index = Number(r.index);
  const total = Number(r.total);
  if (!Number.isInteger(index) || index < 1 || !Number.isInteger(total) || total < index || total > CAROUSEL_MAX_SLIDES) {
    throw bad('CAROUSEL_INDEX_INVALID', `carousel.index/total inválidos (${r.index}/${r.total}): index ≥ 1, index ≤ total ≤ ${CAROUSEL_MAX_SLIDES}`);
  }
  const role = String(r.role ?? '');
  if (!CAROUSEL_ROLES.has(role)) throw bad('CAROUSEL_ROLE_INVALID', `carousel.role='${role || '∅'}' (válidos: ${[...CAROUSEL_ROLES].join(', ')})`);
  const background = r.background == null ? 'image' : String(r.background);
  if (!CAROUSEL_BACKGROUNDS.has(background)) {
    throw bad('CAROUSEL_BACKGROUND_INVALID', `carousel.background='${background}' (válidos: ${[...CAROUSEL_BACKGROUNDS].join(', ')})`);
  }
  const optText = (v: unknown, field: string): string | null => {
    if (v == null) return null;
    if (typeof v !== 'string') throw bad('CAROUSEL_BAD_REQUEST', `carousel.${field} debe ser texto`);
    return v.trim() ? v : null;
  };
  const eyebrow = optText(r.eyebrow, 'eyebrow');
  const keyword = optText(r.keyword, 'keyword');

  let figure: CarouselIn['figure'] = null;
  if (r.figure != null) {
    if (!isPlain(r.figure)) throw bad('CAROUSEL_FIGURE_INVALID', 'carousel.figure debe ser un objeto { value, bar?, source }');
    const f = r.figure as Record<string, any>;
    const value = typeof f.value === 'string' ? f.value : '';
    if (!value.trim()) throw bad('CAROUSEL_FIGURE_INVALID', 'carousel.figure.value es obligatorio');
    const source = typeof f.source === 'string' ? f.source : '';
    if (!source.trim()) {
      throw bad('CAROUSEL_FIGURE_WITHOUT_SOURCE', 'una cifra sin fuente no se compone: carousel.figure.source es obligatorio');
    }
    let bar: { from: number; to: number } | null = null;
    if (f.bar != null) {
      const from = Number(f.bar?.from);
      const to = Number(f.bar?.to);
      if (!isPlain(f.bar) || !Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > 100 || from > to) {
        throw bad('CAROUSEL_FIGURE_BAR_INVALID', `carousel.figure.bar fuera de escala (${f.bar?.from}..${f.bar?.to}): 0 ≤ from ≤ to ≤ 100`);
      }
      bar = { from, to };
    }
    figure = { value, bar, source };
  }

  let steps: CarouselIn['steps'] = [];
  if (r.steps != null) {
    if (!Array.isArray(r.steps)) throw bad('CAROUSEL_BAD_REQUEST', 'carousel.steps debe ser una lista');
    if (r.steps.length > CAROUSEL_MAX_STEPS) throw bad('CAROUSEL_STEPS_TOO_MANY', `carousel.steps trae ${r.steps.length} pasos; el máximo es ${CAROUSEL_MAX_STEPS}`);
    steps = r.steps.map((s: any, k: number) => {
      const text = isPlain(s) && typeof s.text === 'string' ? s.text : '';
      if (!text.trim()) throw bad('CAROUSEL_STEP_INVALID', `carousel.steps[${k}].text es obligatorio`);
      return { text, critical: s.critical === true };
    });
    if (steps.filter((s) => s.critical).length > 1) throw bad('CAROUSEL_STEPS_CRITICAL_MULTIPLE', 'como máximo un paso crítico por lámina');
  }

  const cta = optText(r.cta, 'cta');
  if (cta && role !== 'closing') throw bad('CAROUSEL_CTA_OUTSIDE_CLOSING', `el CTA va sólo en la lámina de cierre (role='${role}')`);

  return { index, total, role: role as CarouselIn['role'], background: background as CarouselIn['background'], eyebrow, keyword, figure, steps, cta };
}

/**
 * Parte el titular en tramos alrededor de la palabra clave. La clave es una subcadena LITERAL del
 * titular (como máximo una, la primera aparición); si no está, el titular sale entero sin resaltar.
 */
export function splitKeyword(headline: string, keyword: string | null): { parts: Array<{ text: string; keyword: boolean }>; found: boolean } {
  const h = String(headline ?? '');
  const k = keyword ?? '';
  const at = k ? h.indexOf(k) : -1;
  if (at < 0) return { parts: h ? [{ text: h, keyword: false }] : [], found: false };
  const parts = [
    { text: h.slice(0, at), keyword: false },
    { text: k, keyword: true },
    { text: h.slice(at + k.length), keyword: false },
  ].filter((p) => p.text.length > 0);
  return { parts, found: true };
}

/** Ancho y alto intrínsecos de un SVG: atributos numéricos o, si no, el viewBox. Puro: recibe el texto. */
export function svgDimensions(svg: string): { width: number; height: number } | null {
  const tag = (String(svg ?? '').match(/<svg\b[^>]*>/i) ?? [])[0] ?? '';
  const attr = (n: string) => (tag.match(new RegExp(`\\s${n}\\s*=\\s*["']([^"']+)["']`, 'i')) ?? [])[1] ?? '';
  const w = attr('width');
  const h = attr('height');
  if (/^[0-9.]+(px)?$/.test(w) && /^[0-9.]+(px)?$/.test(h) && parseFloat(w) > 0 && parseFloat(h) > 0) {
    return { width: parseFloat(w), height: parseFloat(h) };
  }
  const vb = attr('viewBox').trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { width: vb[2], height: vb[3] };
  return null;
}

/** `0.04em` / `.04` / 0.04 → 0.04. Lo que no es número cae a 0 (el tracking es un ajuste, no un dato crítico). */
function emValue(v: unknown): number {
  const n = parseFloat(String(v ?? '0').replace(/em$/i, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Color de un elemento: un ROL de `brand_palette` (o `{ role, alpha }`) y, sólo para el logotipo
 * declarado en `brand_logo`, también un hex literal de la marca (#RGB, #RRGGBB o #RRGGBBAA). Devuelve
 * null si no resuelve: quien llama decide si eso es un faltante (fail-loud) o un aviso.
 */
function carouselColor(
  spec: unknown, palBy: Map<string, { role: string; hex: string }>, opts: { allowHex: boolean; alpha?: number },
): string | null {
  let role = '';
  let alpha = opts.alpha ?? 1;
  if (typeof spec === 'string') role = spec;
  else if (isPlain(spec)) {
    role = String(spec.role ?? '');
    if (spec.alpha != null && Number.isFinite(Number(spec.alpha))) alpha = Number(spec.alpha);
  }
  if (!role) return null;
  const pal = palBy.get(role);
  if (pal) return hexToRgba(String(pal.hex), alpha);
  if (opts.allowHex && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(role)) {
    if (role.length === 9) return hexToRgba(role.slice(0, 7), Math.round((parseInt(role.slice(7), 16) / 255) * alpha * 100) / 100);
    return hexToRgba(role, alpha);
  }
  return null;
}

export interface CarouselLogoIn {
  kind: string; src?: string | null; spec?: Record<string, any> | null;
  intrinsic?: { width: number; height: number } | null;
}
type CarouselType = { role: string; family: string; cssImport: string | null; weight: number; italic: boolean; transform: string; lineHeight: number; letterSpacingEm: number; sizePct: number };
type CarouselLogo =
  | { kind: 'image'; src: string; heightPct: number; aspect: number }
  | { kind: 'wordmark'; sizePct: number; parts: Array<{ text: string; family: string; weight: number; italic: boolean; color: string; letterSpacingEm: number; scale: number; stretch: { x: number; y: number } | null; spaceBeforeEm: number }> };

// ── 1.3.4 · EFECTO DE TEXTO DE LAS LÁMINAS CON FOTO ──────────────────────────────────────────────
// DEFECTO, medido en producción (2026-10-03): en láminas con foto, el texto en el color de acento se
// leía mal sobre caras o fondos cálidos. Oscurecer el velo lo resolvía tapando la foto, y cuánto
// oscurecer era un juicio por lámina. La corrección es una capa que va CON el texto: una sombra por
// glifo, que da contraste local alrededor de cada letra y no pinta ningún rectángulo.
//
// EJE (código): QUÉ es el efecto —dos sombras apiladas por glifo, una centrada (halo) y otra caída
// hacia abajo— y A QUÉ texto se aplica (el de las láminas con foto, nunca el logotipo ni la barra).
// INSTANCIA (dato, `tokens.carousel.text_effect`): la función de color, su alfa, y el desenfoque y el
// desplazamiento como PORCENTAJE del ancho del lienzo. Ningún tamaño en px vive en el código de marca.
const TEXT_EFFECT_KINDS = new Set(['shadow']);
// Tope de desenfoque y desplazamiento, en % del ancho: por encima, la sombra deja de seguir al glifo y
// se convierte en una mancha — el velo que este efecto existe para no tener que oscurecer.
const TEXT_EFFECT_MAX_PCT = 5;

export interface CarouselTextEffect { kind: 'shadow'; fn: string; alpha: number; blurPct: number; offsetPct: number; color?: string }

/**
 * Valida la FORMA de `tokens.carousel.text_effect`. PURO. Un token mal formado es un error con
 * etiqueta estable (400 `CAROUSEL_TEXT_EFFECT_INVALID`), no un efecto silenciosamente omitido.
 * No resuelve el color: eso lo hace `resolveCarouselChrome` contra la paleta de la marca.
 */
export function parseCarouselTextEffect(raw: unknown): CarouselTextEffect {
  const bad = (why: string) => new CompositorError('CAROUSEL_TEXT_EFFECT_INVALID',
    `carousel.text_effect mal formado: ${why}. Forma: { kind: 'shadow', color: <función de tokens.palette>, ` +
    `alpha: 0..1, blur_pct: 0..${TEXT_EFFECT_MAX_PCT}, offset_pct: 0..${TEXT_EFFECT_MAX_PCT} } (% del ancho del lienzo)`, 400);
  if (!isPlain(raw)) throw bad('debe ser un objeto');
  const r = raw as Record<string, unknown>;
  const kind = String(r.kind ?? '');
  if (!TEXT_EFFECT_KINDS.has(kind)) throw bad(`kind='${kind || '∅'}' (válidos: ${[...TEXT_EFFECT_KINDS].join(', ')})`);
  if (typeof r.color !== 'string' || !r.color.trim()) throw bad('color debe ser el nombre de una función de tokens.palette');
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const alpha = num(r.alpha);
  const blurPct = num(r.blur_pct);
  const offsetPct = num(r.offset_pct);
  if (!(alpha > 0 && alpha <= 1)) throw bad(`alpha=${JSON.stringify(r.alpha)} (número, 0 < alpha ≤ 1)`);
  for (const [k, v, raw2] of [['blur_pct', blurPct, r.blur_pct], ['offset_pct', offsetPct, r.offset_pct]] as const) {
    if (!(v >= 0 && v <= TEXT_EFFECT_MAX_PCT)) throw bad(`${k}=${JSON.stringify(raw2)} (número, 0 ≤ ${k} ≤ ${TEXT_EFFECT_MAX_PCT})`);
  }
  if (blurPct === 0 && offsetPct === 0) throw bad('blur_pct y offset_pct en 0: la sombra quedaría oculta bajo el glifo');
  return { kind: 'shadow', fn: r.color.trim(), alpha, blurPct, offsetPct };
}

/**
 * Resuelve el «cromo» de una lámina de carrusel: colores por FUNCIÓN, familias y tamaños por ROL,
 * textos y logotipo. PURO. Devuelve `applied:false` si la marca no declara `tokens.carousel`.
 * FAIL-LOUD ACUMULATIVO para lo que la marca declaró a medias (como `resolveOverlayStyle`); el
 * logotipo es la excepción declarada: si su fila está incompleta se avisa y se compone sin él.
 */
export function resolveCarouselChrome(args: {
  tokens: Record<string, any>;
  typography: Array<{ role: string; font_family: string; css_import?: string | null }>;
  palette: Array<{ role: string; hex: string }>;
  carousel: CarouselIn | null;
  text: OverlayText;
  logo?: CarouselLogoIn | null;
}): { applied: false } | {
  applied: true;
  slide: CarouselIn;
  canvas: { width: number; height: number };
  marginPct: number;
  colors: Record<string, string>;
  surface: string;
  shade: null | Array<{ pos: number; color: string }>;
  // 1.3.4 — sombra del texto de las láminas con foto; null si la marca no declara `carousel.text_effect`.
  textEffect: null | CarouselTextEffect;
  type: Record<'headline' | 'body' | 'label' | 'figure', CarouselType>;
  headline: Array<{ text: string; keyword: boolean }>;
  // 1.4.0 — cómo se ven los tramos resaltados del titular (palabra clave + énfasis). null ⇒ sólo
  // cambian de color, como en 1.3.4.
  headlineEmphasis: null | (CarouselType & { sizeScale: number });
  subheadline: string | null;
  swipeText: string;
  logo: CarouselLogo | null;
  fonts: Array<{ role: string; family: string; cssImport: string | null; weight: number; italic: boolean }>;
  warnings: string[];
  // 1.3.3 — los escalones de `fit_steps` MÁS CHICOS que el elegido, de mayor a menor: el ajuste vertical
  // baja por ellos si el bloque central no cabe. `fitGuard` lo pone sólo `fitCarouselContent`.
  fitLadder: { headline: number[] };
  fitGuard?: boolean;
  // 1.5.0 — el límite de área de la plataforma; sólo rige la PORTADA (las láminas interiores son
  // tarjetas de texto por diseño, decisión de Sam del 2026-10-13). Ausente ⇒ sin límite.
  maxTextAreaPct?: number;
} {
  const t = args.tokens ?? {};
  const ctRaw: unknown = t.carousel;
  if (!args.carousel || !isPlain(ctRaw) || Object.keys(ctRaw).length === 0) return { applied: false };
  const ct = ctRaw as Record<string, any>;
  const slide = args.carousel;
  const missing: string[] = [];
  const warnings: string[] = [];
  const typoBy = new Map((args.typography ?? []).map((r) => [String(r.role), r]));
  const palBy = new Map((args.palette ?? []).map((r) => [String(r.role), r]));
  const palTok = (t.palette ?? {}) as Record<string, unknown>;

  // ── colores por función ──
  const fn: Record<string, string> = {};
  const need = (name: string, spec: unknown, where: string) => {
    const c = carouselColor(spec, palBy, { allowHex: false });
    if (c) { fn[name] = c; return; }
    const role = typeof spec === 'string' ? spec : isPlain(spec) ? String(spec.role ?? '') : '';
    missing.push(role ? `brand_palette.role='${role}' (pedido por ${where})` : where);
  };
  for (const name of CAROUSEL_COLOR_FUNCTIONS) need(name, palTok[name], `palette.${name}`);
  // Opcionales con reemplazo: el texto del carrusel hereda el de las ranuras de 1.2.0.
  need('text', palTok.text ?? palTok.headline, palTok.text != null ? 'palette.text' : 'palette.text (o palette.headline)');
  need('text_soft', palTok.text_soft ?? palTok.subheadline ?? palTok.headline,
    palTok.text_soft != null ? 'palette.text_soft' : 'palette.text_soft (o palette.subheadline)');
  if (palTok.surface_closing != null) need('surface_closing', palTok.surface_closing, 'palette.surface_closing');

  // ── lienzo y margen ──
  const canvasW = Number(ct.canvas?.width);
  const canvasH = Number(ct.canvas?.height);
  if (!Number.isInteger(canvasW) || canvasW <= 0 || !Number.isInteger(canvasH) || canvasH <= 0) missing.push('carousel.canvas.width/height');
  const marginPct = Number(ct.margin_pct);
  if (!Number.isFinite(marginPct) || marginPct < 0) missing.push('carousel.margin_pct');

  // ── tipografía: cuatro familias de texto, cada una un ROL de la marca ──
  const fonts: Array<{ role: string; family: string; cssImport: string | null; weight: number; italic: boolean }> = [];
  const addFont = (f: { role: string; family: string; cssImport: string | null; weight: number; italic: boolean }) => {
    if (!fonts.some((x) => x.family === f.family && x.weight === f.weight && x.italic === f.italic)) fonts.push(f);
  };
  const type = {} as Record<'headline' | 'body' | 'label' | 'figure', CarouselType>;
  let headlineOverflow = false;
  let headlineSmaller: number[] = [];
  for (const kind of ['headline', 'body', 'label', 'figure'] as const) {
    const st = ((ct.typography ?? {})[kind] ?? {}) as Record<string, any>;
    const role = String(st.role ?? '');
    const typo = typoBy.get(role);
    if (!role) { missing.push(`carousel.typography.${kind}.role`); continue; }
    if (!typo) { missing.push(`brand_typography.role='${role}' (pedido por carousel.typography.${kind}.role)`); continue; }
    let sizePct = Number(st.size_pct);
    if (kind === 'headline') {
      const steps = Array.isArray(st.fit_steps) ? st.fit_steps : [];
      if (steps.length === 0) { missing.push('carousel.typography.headline.fit_steps'); continue; }
      const fit = fitFontSizePct(steps, String(args.text?.headline ?? ''));
      sizePct = fit.sizePct;
      headlineSmaller = [...new Set(steps.map((s: any) => Number(s.size_pct)))]
        .filter((x) => Number.isFinite(x) && x > 0 && x < sizePct).sort((a, b) => b - a);
      headlineOverflow = fit.overflow && !!String(args.text?.headline ?? '').trim();
    } else if (!Number.isFinite(sizePct) || sizePct <= 0) { missing.push(`carousel.typography.${kind}.size_pct`); continue; }
    type[kind] = {
      role, family: String(typo.font_family), cssImport: typo.css_import ? String(typo.css_import) : null,
      weight: Number(st.weight ?? 400), italic: st.italic === true,
      transform: String(st.transform ?? 'none'),
      lineHeight: Number(st.line_height ?? 1.2),
      letterSpacingEm: Number(st.letter_spacing_em ?? 0),
      sizePct,
    };
    addFont({ role, family: type[kind].family, cssImport: type[kind].cssImport, weight: type[kind].weight, italic: type[kind].italic });
  }
  // 1.4.0 — énfasis de la lámina: `carousel.typography.headline.emphasis`. Hereda del titular lo que no declara.
  let headlineEmphasis: null | (CarouselType & { sizeScale: number }) = null;
  if (type.headline) {
    const hb = type.headline;
    const em = resolveEmphasisType(((ct.typography ?? {}).headline ?? {}).emphasis,
      { role: hb.role, weight: hb.weight, italic: hb.italic, transform: hb.transform, letterSpacingEm: hb.letterSpacingEm },
      typoBy, 'carousel.typography.headline.emphasis', missing);
    if (em) {
      headlineEmphasis = {
        role: em.role, family: em.family, cssImport: em.cssImport, weight: em.weight, italic: em.italic,
        transform: em.transform, lineHeight: hb.lineHeight, letterSpacingEm: em.letterSpacingEm,
        sizePct: hb.sizePct, sizeScale: em.sizeScale,
      };
      addFont({ role: em.role, family: em.family, cssImport: em.cssImport, weight: em.weight, italic: em.italic });
    }
  }
  if (headlineOverflow) {
    warnings.push(`CAROUSEL_HEADLINE_OVERFLOW: el titular excede el último escalón de carousel.typography.headline.fit_steps; se compone entero al tamaño más chico`);
  }

  // ── aviso de deslizar: el texto es DATO por idioma; la flecha es geometría ──
  const swipeText = typeof ct.swipe?.text === 'string' ? ct.swipe.text : '';
  if (!swipeText.trim()) missing.push('carousel.swipe.text');

  // ── velo de las láminas con foto (opcional; sin él, el velo de 1.2.0 de la marca) ──
  let shade: null | Array<{ pos: number; color: string }> = null;
  if (ct.shade != null) {
    const stops = Array.isArray(ct.shade?.stops) ? ct.shade.stops : [];
    const role = palTok.shade;
    const ok = stops.length >= 2 && stops.every((s: any) => Array.isArray(s) && s.length === 2 && Number.isFinite(Number(s[0])) && Number.isFinite(Number(s[1])));
    if (!ok) missing.push('carousel.shade.stops ([[posición %, alfa], …], al menos dos)');
    const spec = typeof role === 'string' ? role : isPlain(role) ? String(role.role ?? '') : '';
    if (!spec) missing.push('palette.shade (pedido por carousel.shade)');
    else if (!palBy.get(spec)) missing.push(`brand_palette.role='${spec}' (pedido por palette.shade)`);
    if (ok && spec && palBy.get(spec)) {
      shade = stops.map((s: any) => ({ pos: Number(s[0]), color: hexToRgba(String(palBy.get(spec)!.hex), Number(s[1])) }));
    }
  }

  // ── 1.3.4 · efecto de texto de las láminas con foto (opcional; sin él, la escena de 1.3.3) ──
  // La FORMA del token es contrato y se valida con 400; el COLOR es una función de `tokens.palette` y,
  // si no resuelve, falla como cualquier otro color del carrusel (faltante acumulado, fail-loud).
  let textEffect: null | CarouselTextEffect = null;
  if (ct.text_effect != null) {
    const te = parseCarouselTextEffect(ct.text_effect);
    const spec = palTok[te.fn];
    const role = typeof spec === 'string' ? spec : isPlain(spec) ? String(spec.role ?? '') : '';
    if (spec == null || !role) missing.push(`palette.${te.fn} (pedido por carousel.text_effect.color)`);
    else {
      // El alfa es el del efecto, no el que la función pueda llevar para su propio elemento.
      const color = carouselColor(role, palBy, { allowHex: false, alpha: te.alpha });
      if (!color) missing.push(`brand_palette.role='${role}' (pedido por palette.${te.fn}, vía carousel.text_effect.color)`);
      else textEffect = { ...te, color };
    }
  }

  if (missing.length) {
    throw new CompositorError(
      'COMPOSITOR_TOKENS_INCOMPLETE',
      `faltan datos de marca para componer la lámina de carrusel: ${missing.join(' · ')}. ` +
      'El motor no tiene fuentes ni colores propios con los que rellenar (BRIEF 7, regla b; F3).',
    );
  }

  // ── textos ──
  // 1.4.0 — la palabra clave de la lámina y los tramos de `emphasis` se resaltan juntos; la clave
  // tiene prioridad si se solapan. Con sólo la clave, el resultado es el de `splitKeyword` (1.3.4).
  const emTerms = (args.text?.emphasis ?? []).filter((x) => typeof x === 'string' && x && x !== slide.keyword);
  const split = splitEmphasis(String(args.text?.headline ?? ''), [slide.keyword, ...emTerms]);
  if (slide.keyword && split.missing.includes(slide.keyword)) {
    warnings.push('CAROUSEL_KEYWORD_NOT_IN_HEADLINE');
  }
  const emMissing = emTerms.filter((x) => split.missing.includes(x));
  if (emMissing.length) {
    warnings.push(`CAROUSEL_EMPHASIS_NOT_IN_HEADLINE: ${emMissing.map((m) => `«${m}»`).join(', ')} no está literal en el titular; ese tramo no se resalta`);
  }
  const sub = String(args.text?.subheadline ?? '');

  // ── logotipo del pie: tolerante. Sin fila ⇒ sin logotipo; fila incompleta ⇒ aviso y sin logotipo ──
  let logo: CarouselLogo | null = null;
  const lg = args.logo ?? null;
  const logoTok = (ct.logo ?? {}) as Record<string, any>;
  if (lg) {
    if (lg.kind === 'image') {
      const h = Number(logoTok.height_pct);
      const iw = Number(lg.intrinsic?.width);
      const ih = Number(lg.intrinsic?.height);
      const src = String(lg.src ?? '');
      if (!/^(https:\/\/|data:image\/)/.test(src)) warnings.push('CAROUSEL_LOGO_INVALID: brand_logo.src no es https ni data:image; se compone sin logotipo');
      else if (!Number.isFinite(h) || h <= 0) warnings.push('CAROUSEL_LOGO_SIZE_NOT_DECLARED: falta carousel.logo.height_pct; se compone sin logotipo');
      else if (!(iw > 0 && ih > 0)) warnings.push('CAROUSEL_LOGO_INVALID: no se pudieron medir las dimensiones del logotipo; se compone sin logotipo');
      else logo = { kind: 'image', src, heightPct: h, aspect: iw / ih };
    } else if (lg.kind === 'wordmark') {
      const size = Number(logoTok.size_pct);
      const parts = Array.isArray(lg.spec?.parts) ? lg.spec!.parts : [];
      const bad: string[] = [];
      const out = parts.map((p: any, k: number) => {
        const text = typeof p?.text === 'string' ? p.text : '';
        const typo = typoBy.get(String(p?.font ?? ''));
        const color = carouselColor(p?.color, palBy, { allowHex: true, alpha: p?.alpha != null ? Number(p.alpha) : undefined });
        if (!text) bad.push(`parts[${k}].text`);
        if (!typo) bad.push(`parts[${k}].font='${p?.font ?? '∅'}' (rol de brand_typography)`);
        if (!color) bad.push(`parts[${k}].color='${p?.color ?? '∅'}'`);
        const sx = Number(p?.stretch?.x);
        const sy = Number(p?.stretch?.y);
        return {
          text, family: typo ? String(typo.font_family) : '', cssImport: typo?.css_import ? String(typo.css_import) : null,
          role: String(p?.font ?? ''), weight: Number(p?.weight ?? 400), italic: p?.style === 'italic',
          color: color ?? '', letterSpacingEm: emValue(p?.tracking),
          scale: Number.isFinite(Number(p?.scale)) && Number(p?.scale) > 0 ? Number(p.scale) : 1,
          stretch: sx > 0 && sy > 0 ? { x: sx, y: sy } : null,
          spaceBeforeEm: Number.isFinite(Number(p?.space_before)) ? Number(p.space_before) : 0,
        };
      });
      if (!parts.length) bad.push('spec.parts vacío');
      if (!Number.isFinite(size) || size <= 0) warnings.push('CAROUSEL_LOGO_SIZE_NOT_DECLARED: falta carousel.logo.size_pct; se compone sin logotipo');
      else if (bad.length) warnings.push(`CAROUSEL_LOGO_INVALID: brand_logo (wordmark) incompleto — ${bad.join(' · ')}; se compone sin logotipo`);
      else {
        for (const p of out) addFont({ role: p.role, family: p.family, cssImport: p.cssImport, weight: p.weight, italic: p.italic });
        logo = {
          kind: 'wordmark', sizePct: size,
          parts: out.map(({ cssImport: _c, role: _r, ...rest }) => rest),
        };
      }
    } else {
      warnings.push(`CAROUSEL_LOGO_INVALID: brand_logo.kind='${lg.kind}' desconocido; se compone sin logotipo`);
    }
  }

  const colors: Record<string, string> = {};
  for (const [element, f] of Object.entries(CAROUSEL_ELEMENT_COLOR)) colors[element] = fn[f];
  const surface = slide.role === 'closing' && fn.surface_closing ? fn.surface_closing : fn.surface;

  return {
    applied: true, slide,
    canvas: { width: canvasW, height: canvasH },
    marginPct, colors, surface, shade, textEffect, type,
    headline: split.parts,
    headlineEmphasis,
    subheadline: sub.trim() ? sub : null,
    swipeText, logo, fonts, warnings,
    fitLadder: { headline: headlineSmaller },
    ...(Number.isFinite(Number((t.layout ?? {}).max_text_area_pct)) && Number(t.layout.max_text_area_pct) > 0
      ? { maxTextAreaPct: Number(t.layout.max_text_area_pct) } : {}),
  };
}

/**
 * El titular, en «átomos» para el ajuste de línea: un átomo es una palabra (o una palabra partida
 * entre la clave y lo que la rodea, como «BROKEN» + «.»), y nunca se corta por dentro. El espacio
 * entre palabras viaja como espacio duro al final del átomo: satori recorta los espacios normales en
 * el borde de cada tramo y, sin esto, «SAME GOAL.» + «THREE» se pegarían. Puro: no cambia el texto
 * visible, sólo cómo se agrupa.
 * (Los huecos desiguales entre palabras de 1.3.0 no venían de aquí sino del kerning: ver
 * `neutralizeKerning`. Lo que sí aporta el átomo es redondear su caja al píxel de arriba: ≤ 1 px.)
 */
export function headlineAtoms(parts: Array<{ text: string; keyword: boolean }>): Array<Array<{ text: string; keyword: boolean }>> {
  const atoms: Array<Array<{ text: string; keyword: boolean }>> = [[]];
  for (const p of parts) {
    for (const piece of p.text.split(/(\s+)/)) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) { if (atoms[atoms.length - 1].length) atoms.push([]); continue; }
      atoms[atoms.length - 1].push({ text: piece, keyword: p.keyword });
    }
  }
  const out = atoms.filter((a) => a.length);
  for (let k = 0; k < out.length - 1; k++) {
    const last = out[k][out[k].length - 1];
    out[k][out[k].length - 1] = { ...last, text: `${last.text}\u00a0` };
  }
  return out;
}

/**
 * 1.3.4 — el `textShadow` de satori para el efecto de texto. PURO. Dos sombras apiladas del mismo
 * color: un halo centrado (contraste en todo el contorno del glifo, también por arriba) y una caída
 * hacia abajo (asienta la letra sobre la foto). Desenfoque y desplazamiento son % del ANCHO del lienzo.
 */
export function carouselTextShadow(te: CarouselTextEffect, canvasWidth: number): string {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const blur = r2((te.blurPct / 100) * canvasWidth);
  const off = r2((te.offsetPct / 100) * canvasWidth);
  return `0px 0px ${blur}px ${te.color}, 0px ${off}px ${blur}px ${te.color}`;
}

/**
 * La escena de una lámina de carrusel. PURA, misma disciplina que `buildOverlayScene`: todo se mide
 * en porcentaje del ANCHO del lienzo, y las proporciones internas (puntos, barras, separaciones) se
 * derivan del tamaño de letra de su familia — eso es geometría del eje, no dato de una marca.
 *
 * Estructura (la de la maqueta v4): arriba la barra de progreso y la fila etiqueta · `i / n`; al
 * centro el contenido; abajo el aviso de deslizar (portada) y el logotipo. Con foto: imagen a sangre + velo +
 * franja de identidad (si la marca la declara). Sin foto: el color de la función `surface`.
 */
export function buildCarouselScene(args: {
  chrome: Extract<ReturnType<typeof resolveCarouselChrome>, { applied: true }>;
  style: ReturnType<typeof resolveOverlayStyle>;
  backgroundSrc: string | null;
}): Record<string, any> {
  const { chrome, style } = args;
  const W = chrome.canvas.width;
  const H = chrome.canvas.height;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const px = (pct: number) => r2((pct / 100) * W);
  const c = chrome.colors;
  const T = chrome.type;
  const L = px(T.label.sizePct);
  const B = px(T.body.sizePct);
  const M = px(chrome.marginPct);
  const inner = r2(W - 2 * M);
  const slide = chrome.slide;
  const withImage = slide.background === 'image' && !!args.backgroundSrc;
  const children: Array<Record<string, any>> = [];
  // 1.3.4 — efecto de texto: sólo sobre foto, y sólo en nodos de TEXTO (no en el logotipo, la barra de
  // progreso, las marcas de los pasos ni las flechas). Sin token `fx` es {}: ningún estilo cambia y la
  // escena es la de 1.3.3, clave por clave.
  const fx: Record<string, string> = withImage && chrome.textEffect ? { textShadow: carouselTextShadow(chrome.textEffect, W) } : {};

  const text = (value: string, s: Record<string, any>) => ({ type: 'div', props: { style: { display: 'flex', ...s }, children: value } });
  const font = (k: CarouselType, size: number) => ({
    fontFamily: k.family, fontWeight: k.weight, fontStyle: k.italic ? 'italic' : 'normal',
    fontSize: size, lineHeight: k.lineHeight, letterSpacing: r2(k.letterSpacingEm * size), textTransform: k.transform,
  });
  // Flecha GEOMÉTRICA (la familia display de una marca puede no tener «→»): un trazo vectorial con el
  // color de su función. No es un carácter: no depende de qué glifos traiga la fuente.
  // La DIRECCIÓN es eje y la fija el rol de la lámina, no la marca: en la portada señala a la derecha
  // (hay más láminas: el gesto existe); en el cierre señala ABAJO, al texto del post y al botón real
  // del anuncio. Una flecha a la derecha en la última lámina promete un deslizamiento que no existe
  // (Sam, 2026-10-03; Meta rechaza en anuncios la funcionalidad inexistente).
  const arrow = (color: string, size: number, direction: 'right' | 'down' = 'right') => {
    const down = direction === 'down';
    const w = r2(size * (down ? 0.62 : 1.25));
    const h = r2(size * (down ? 0.84 : 0.62));
    const svg = down
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 16" width="${w}" height="${h}">` +
        `<path d="M6 1V14.5M2 10.5L6 14.5L10 10.5" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12" width="${w}" height="${h}">` +
        `<path d="M1 6H22.5M17.5 1.5L22.5 6L17.5 10.5" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return {
      type: 'img',
      props: { src: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, width: w, height: h, style: { width: w, height: h, flexShrink: 0, marginLeft: r2(size * 0.45) } },
    };
  };

  // ── fondo ──
  if (withImage) {
    children.push({ type: 'img', props: { src: args.backgroundSrc, width: W, height: H, style: { position: 'absolute', top: 0, left: 0, width: W, height: H, objectFit: 'cover' } } });
    if (chrome.shade) {
      const stops = chrome.shade.map((s) => `${s.color} ${s.pos}%`).join(', ');
      children.push({ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: W, height: H, backgroundImage: `linear-gradient(180deg, ${stops})` } } });
    } else if (style.scrim) {
      const from = hexToRgba(style.scrim.color, style.scrim.opacity);
      const to = hexToRgba(style.scrim.color, 0);
      const cover = r2((style.scrim.coveragePct / 100) * H);
      children.push({
        type: 'div',
        props: {
          style: {
            position: 'absolute', left: 0, width: W, height: cover,
            ...(style.scrim.mode === 'gradient_top' ? { top: 0 } : { bottom: 0 }),
            ...(style.scrim.mode === 'solid' ? { backgroundColor: from }
              : { backgroundImage: `linear-gradient(${style.scrim.mode === 'gradient_top' ? '180deg' : '0deg'}, ${from} 0%, ${to} 100%)` }),
          },
        },
      });
    }
    if (style.identity) {
      const thickness = Math.max(1, Math.round((style.identity.widthPct / 100) * Math.min(W, H)));
      const vertical = style.identity.mode === 'edge_left' || style.identity.mode === 'edge_right';
      children.push({
        type: 'div',
        props: {
          style: {
            position: 'absolute', backgroundColor: style.identity.color,
            ...(vertical
              ? { top: 0, height: H, width: thickness, ...(style.identity.mode === 'edge_left' ? { left: 0 } : { right: 0 }) }
              : { left: 0, width: W, height: thickness, bottom: 0 }),
          },
        },
      });
    }
  } else {
    children.push({ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: W, height: H, backgroundColor: chrome.surface } } });
  }

  // ── arriba: progreso por lámina + etiqueta · i / n ──
  const segGap = r2(L * 0.42);
  const segs = Array.from({ length: slide.total }, (_, k) => ({
    type: 'div',
    props: {
      style: {
        flexGrow: 1, flexBasis: 0, height: Math.max(2, r2(L * 0.21)),
        ...(k < slide.total - 1 ? { marginRight: segGap } : {}),
        backgroundColor: k < slide.index ? c.progress_done : c.progress_todo,
      },
    },
  }));
  const labelFont = font(T.label, L);
  const top = {
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'column', width: inner },
      children: [
        { type: 'div', props: { style: { display: 'flex', flexDirection: 'row', width: inner }, children: segs } },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: r2(L * 0.95), width: inner },
            children: [
              slide.eyebrow ? text(slide.eyebrow, { ...labelFont, color: c.eyebrow, ...fx }) : { type: 'div', props: { style: { display: 'flex' } } },
              text(`${slide.index} / ${slide.total}`, { ...labelFont, color: c.counter, textTransform: 'none', ...fx }),
            ],
          },
        },
      ],
    },
  };

  // ── centro ──
  const mid: Array<Record<string, any>> = [];
  if (chrome.headline.length) {
    const hs = px(T.headline.sizePct);
    const hf = font(T.headline, hs);
    const HE = chrome.headlineEmphasis;
    mid.push({
      type: 'div',
      props: {
        style: { display: 'flex', flexWrap: 'wrap', width: inner, ...hf, color: c.headline, ...fx, ...(HE ? { alignItems: 'baseline' } : {}) },
        children: headlineAtoms(chrome.headline).map((atom) => ({
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'row', ...(HE ? { alignItems: 'baseline' } : {}) },
            children: atom.map((p) => ({
              type: 'span',
              props: {
                style: {
                  textTransform: T.headline.transform, color: p.keyword ? c.keyword : c.headline, ...fx,
                  // 1.4.0 — el tramo resaltado con la tipografía de énfasis de la marca.
                  ...(HE && p.keyword ? { ...font(HE, r2(hs * HE.sizeScale)) } : {}),
                },
                children: p.text,
              },
            })),
          },
        })),
      },
    });
  }
  const subNode = (marginTop: number) => text(chrome.subheadline!, { ...font(T.body, B), color: c.subheadline, marginTop, width: inner, ...fx });
  if (slide.figure) {
    const fs = px(T.figure.sizePct);
    mid.push(text(slide.figure.value, { ...font(T.figure, fs), color: c.figure, marginTop: mid.length ? r2(B * 0.8) : 0, width: inner, ...fx }));
    if (slide.figure.bar) {
      const bh = Math.max(2, r2(L * 0.53));
      const from = r2((slide.figure.bar.from / 100) * inner);
      const w = r2(((slide.figure.bar.to - slide.figure.bar.from) / 100) * inner);
      mid.push({
        type: 'div',
        props: {
          style: { display: 'flex', position: 'relative', width: inner, height: bh, marginTop: r2(L * 1.26), borderRadius: r2(bh / 2), backgroundColor: c.bar_track, overflow: 'hidden' },
          children: [{
            type: 'div',
            props: { style: { position: 'absolute', top: 0, left: from, width: w, height: bh, backgroundImage: `linear-gradient(90deg, ${c.bar_from}, ${c.bar_to})` } },
          }],
        },
      });
    }
    if (chrome.subheadline) mid.push(subNode(r2(B * 0.69)));
    const dot = r2(L * 0.63);
    mid.push({
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginTop: r2(B * 0.69), width: inner },
        children: [
          { type: 'div', props: { style: { width: dot, height: dot, borderRadius: r2(dot / 2), backgroundColor: c.source_mark, marginRight: r2(L * 0.74), flexShrink: 0 } } },
          text(slide.figure.source, { ...font(T.label, r2(L * 1.1)), letterSpacing: r2(T.label.letterSpacingEm * 0.4 * L * 1.1), textTransform: 'none', color: c.source_text, ...fx }),
        ],
      },
    });
  } else if (chrome.subheadline) {
    mid.push(subNode(mid.length ? r2(B * 0.69) : 0));
  }
  if (slide.steps.length) {
    const ss = r2(B * 0.86);
    const mark = r2(B * 0.55);
    const bw = Math.max(1, r2(B * 0.07));
    mid.push({
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'column', marginTop: mid.length ? r2(B * 0.83) : 0, width: inner },
        children: slide.steps.map((s, k) => ({
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'row', alignItems: 'center', ...(k > 0 ? { marginTop: r2(B * 0.48) } : {}) },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    width: mark, height: mark, borderRadius: r2(mark / 2), flexShrink: 0, marginRight: r2(B * 0.62),
                    border: `${bw}px solid ${s.critical ? c.step_critical_mark : c.step_mark}`,
                    ...(s.critical ? { backgroundColor: c.step_critical_mark } : {}),
                  },
                },
              },
              text(s.text, { ...font(T.body, ss), lineHeight: 1.35, color: s.critical ? c.step_critical_text : c.step_text, ...fx }),
            ],
          },
        })),
      },
    });
  }
  if (slide.cta && slide.role === 'closing') {
    const cs = r2(L * 1.16);
    mid.push({
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'row', marginTop: mid.length ? r2(B * 0.97) : 0 },
        children: [{
          type: 'div',
          props: {
            // Subrayado, sin forma de botón: en una imagen nada se toca (maqueta v4).
            style: { display: 'flex', flexDirection: 'row', alignItems: 'center', maxWidth: inner, paddingBottom: r2(cs * 0.45), borderBottom: `${Math.max(1, r2(cs * 0.09))}px solid ${c.cta_underline}` },
            children: [
              text(slide.cta, { ...font(T.label, cs), letterSpacing: r2(T.label.letterSpacingEm * 0.75 * cs), color: c.cta_text, flexShrink: 1, ...fx }),
              arrow(c.cta_underline, cs, 'down'),
            ],
          },
        }],
      },
    });
  }

  // ── abajo: aviso de deslizar (sólo portada) + logotipo ──
  let logoNode: Record<string, any> = { type: 'div', props: { style: { display: 'flex' } } };
  if (chrome.logo?.kind === 'image') {
    const h = px(chrome.logo.heightPct);
    const w = r2(h * chrome.logo.aspect);
    logoNode = { type: 'img', props: { src: chrome.logo.src, width: w, height: h, style: { width: w, height: h } } };
  } else if (chrome.logo?.kind === 'wordmark') {
    const S = px(chrome.logo.sizePct);
    logoNode = {
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-end', lineHeight: 1 },
        children: chrome.logo.parts.map((p) => {
          const size = r2(S * p.scale);
          return {
            type: 'span',
            props: {
              style: {
                fontFamily: p.family, fontWeight: p.weight, fontStyle: p.italic ? 'italic' : 'normal',
                fontSize: size, color: p.color, letterSpacing: r2(p.letterSpacingEm * size), lineHeight: 1,
                ...(p.spaceBeforeEm ? { marginLeft: r2(p.spaceBeforeEm * S) } : {}),
                ...(p.stretch ? { transform: `scale(${p.stretch.x}, ${p.stretch.y})` } : {}),
              },
              children: p.text,
            },
          };
        }),
      },
    };
  }
  const swipe = slide.role === 'cover'
    ? {
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'row', alignItems: 'center' },
        children: [text(chrome.swipeText, { ...labelFont, color: c.swipe, ...fx }), arrow(c.swipe, L)],
      },
    }
    : { type: 'div', props: { style: { display: 'flex' } } };
  const foot = {
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: inner },
      children: [swipe, logoNode],
    },
  };

  // 1.3.3 — si el ajuste vertical tuvo que actuar (`fitGuard`), la cabecera y el pie quedan rígidos y
  // el bloque central es el único que cede: aunque la estimación se quedara corta, el pie no se tapa
  // ni sale del lienzo. Una lámina que ya cabía no lleva estas claves y su escena no cambia.
  const guard = chrome.fitGuard === true;
  const rigid = (node: Record<string, any>) => (guard ? { ...node, props: { ...node.props, style: { ...node.props.style, flexShrink: 0 } } } : node);
  children.push({
    type: 'div',
    props: {
      style: {
        position: 'absolute', top: 0, left: 0, width: W, height: H,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: M,
      },
      children: [
        rigid(top),
        { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', width: inner, ...(guard ? { flexShrink: 1, minHeight: 0, overflow: 'hidden' } : {}) }, children: mid } },
        rigid(foot),
      ],
    },
  });

  return { type: 'div', props: { style: { display: 'flex', position: 'relative', width: W, height: H }, children } };
}

// ── 1.3.3 (2026-10-03) · AJUSTE VERTICAL DE LA LÁMINA ─────────────────────────────────────────────
// DEFECTO, medido en producción (barrido del 2026-10-03): el bloque central —titular, bajada, cifra,
// pasos, CTA— se dimensionaba por número de caracteres (`fit_steps`) y nadie comprobaba que cupiera
// entre la cabecera (progreso, etiqueta, i / n) y el pie (aviso de deslizar, logotipo). Una cifra de
// 26,5 % del ancho más cuatro pasos empujaba el pie fuera del lienzo: el cuarto paso cortado y el
// logotipo perdido, o una cifra de dos palabras partida en dos líneas que desplazaba el logotipo.
//
// LA CORRECCIÓN, determinista y sin red: se MIDE la altura que el bloque central va a ocupar con las
// métricas de avance de la MISMA fuente que recibe satori (sin kerning desde 1.3.1, así que la suma
// de avances es exactamente lo que satori mide), se reparte en líneas con el mismo ancho disponible
// y, si no cabe, se reduce por escalones en un orden fijo:
//   1. la cifra (hasta la mitad de su tamaño declarado),
//   2. el titular (los escalones siguientes de su `fit_steps`),
//   3. el cuerpo y los pasos (hasta el 85 %),
//   4. y, si ni así cabe, se omiten pasos desde el final —nunca el crítico— con aviso.
// Si una lámina ya cabe, nada de esto toca la escena: sale idéntica, clave por clave.
// Todo es eje: los escalones son proporciones del tamaño que la marca declara, no tamaños de marca.

// Proporción del tamaño declarado en cada escalón de reducción (el primero es «sin reducir»).
const FIT_FIGURE_SCALES = [1, 0.85, 0.72, 0.6, 0.5];
const FIT_BODY_SCALES = [0.92, 0.85];
// Aire mínimo entre la cabecera y el bloque central, y entre éste y el pie, en tamaños de etiqueta.
const FIT_MIN_GAP_LABELS = 0.6;
// Ancho medio de glifo (en em) cuando no hay métricas de la fuente: el ajuste queda ESTIMADO y avisa.
const FIT_FALLBACK_EM = 0.6;

/** Métricas de avance de una fuente: ancho de cada carácter en em, y la media de los imprimibles ASCII. */
export interface FontAdvance { advances: Map<number, number>; avgEm: number }

/**
 * Lee de una fuente sfnt (TrueType u OpenType/CFF) el avance horizontal de cada carácter: `cmap`
 * (formato 4 o 12) → glifo → `hmtx`, dividido por `unitsPerEm` (`head`). PURO: recibe los bytes. Es
 * la misma métrica con la que satori ubica el texto (sin kerning, 1.3.1). Lo que no sea una fuente
 * legible —WOFF comprimido, bytes cortos, tablas fuera del búfer— devuelve null: el ajuste avisa y
 * estima, no falla.
 */
export function fontAdvanceMetrics(bytes: Uint8Array): FontAdvance | null {
  const b = bytes;
  if (!b || b.length < 12) return null;
  const u16 = (o: number) => (b[o] << 8) | b[o + 1];
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  const sig = tag(0);
  if (!(sig === '\u0000\u0001\u0000\u0000' || sig === 'OTTO' || sig === 'true')) return null;
  const tables: Record<string, { off: number; len: number }> = {};
  for (let k = 0, n = u16(4); k < n; k++) {
    const o = 12 + k * 16;
    if (o + 16 > b.length) break;
    tables[tag(o)] = { off: u32(o + 8), len: u32(o + 12) };
  }
  const { head, hhea, hmtx, cmap } = tables;
  if (!head || !hhea || !hmtx || !cmap) return null;
  if ([head, hhea, hmtx, cmap].some((t) => t.off + t.len > b.length) || head.len < 20 || hhea.len < 36) return null;
  const upem = u16(head.off + 18);
  const nH = u16(hhea.off + 34);
  if (!upem || !nH || hmtx.len < nH * 4) return null;
  const adv = (g: number) => u16(hmtx.off + 4 * Math.min(g, nH - 1)) / upem;

  // Subtabla de cmap: Unicode completo (formato 12) antes que BMP (formato 4).
  let sub = -1;
  let rank = 0;
  for (let k = 0, n = u16(cmap.off + 2); k < n; k++) {
    const r = cmap.off + 4 + k * 8;
    if (r + 8 > b.length) break;
    const pid = u16(r);
    const eid = u16(r + 2);
    const at = cmap.off + u32(r + 4);
    if (at + 4 > b.length) continue;
    const fmt = u16(at);
    const unicode = pid === 0 || (pid === 3 && (eid === 1 || eid === 10));
    const rk = !unicode ? 0 : fmt === 12 ? 2 : fmt === 4 ? 1 : 0;
    if (rk > rank) { rank = rk; sub = at; }
  }
  if (sub < 0) return null;

  const advances = new Map<number, number>();
  const LIMIT = 200_000;
  if (u16(sub) === 4) {
    const segX2 = u16(sub + 6);
    const ends = sub + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ros = deltas + segX2;
    if (ros + segX2 > b.length) return null;
    for (let s = 0; s < segX2 / 2 && advances.size < LIMIT; s++) {
      const end = u16(ends + 2 * s);
      const start = u16(starts + 2 * s);
      const delta = u16(deltas + 2 * s);
      const ro = u16(ros + 2 * s);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g: number;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const a = ros + 2 * s + ro + 2 * (c - start);
          if (a + 2 > b.length) continue;
          g = u16(a);
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) advances.set(c, adv(g));
      }
    }
  } else {
    const groups = u32(sub + 12);
    for (let k = 0; k < groups && advances.size < LIMIT; k++) {
      const o = sub + 16 + k * 12;
      if (o + 12 > b.length) break;
      const s = u32(o);
      const e = Math.min(u32(o + 4), s + LIMIT);
      const g0 = u32(o + 8);
      for (let c = s; c <= e; c++) advances.set(c, adv(g0 + c - s));
    }
  }
  let sum = 0;
  let cnt = 0;
  for (let c = 0x20; c <= 0x7e; c++) {
    const a = advances.get(c);
    if (a != null) { sum += a; cnt++; }
  }
  if (!cnt) return null;
  return { advances, avgEm: sum / cnt };
}

/** Clave de una fuente en el mapa de métricas: la misma familia, peso y estilo que pide el cromo. */
export function fitFontKey(f: { family: string; weight: number; italic: boolean }): string {
  return `${f.family}|${f.weight}|${f.italic ? 'italic' : 'normal'}`;
}

type CarouselChrome = Extract<ReturnType<typeof resolveCarouselChrome>, { applied: true }>;
type FitMetrics = Record<string, FontAdvance | null | undefined>;

/**
 * Altura que ocupan la cabecera, el bloque central y el pie de una lámina, con las MISMAS medidas
 * que `buildCarouselScene` (si una cambia allí, cambia aquí: el smoke compara esta estimación con la
 * caja que satori dibuja). PURO. `estimated` = alguna fuente no tenía métricas y se usó el ancho medio
 * genérico.
 */
export function measureCarouselLayout(chrome: CarouselChrome, metrics: FitMetrics | null | undefined): {
  top: number; mid: number; foot: number; available: number; gap: number; slack: number; estimated: string[];
} {
  const W = chrome.canvas.width;
  const H = chrome.canvas.height;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const px = (pct: number) => r2((pct / 100) * W);
  const T = chrome.type;
  const L = px(T.label.sizePct);
  const B = px(T.body.sizePct);
  const M = px(chrome.marginPct);
  const inner = r2(W - 2 * M);
  const slide = chrome.slide;
  const estimated: string[] = [];

  // Ancho de un texto en una familia, a un tamaño, con su tracking y su transformación.
  const widthFn = (k: CarouselType, size: number, letterSpacing: number, transform: string) => {
    const m = metrics?.[fitFontKey(k)] ?? null;
    if (!m && !estimated.includes(k.family)) estimated.push(k.family);
    return (s: string) => {
      const str = transform === 'uppercase' ? s.toUpperCase() : transform === 'lowercase' ? s.toLowerCase() : s;
      let w = 0;
      for (const ch of str) {
        const cp = ch.codePointAt(0)!;
        const em = m ? (m.advances.get(cp) ?? (cp === 0xa0 ? m.advances.get(0x20) : undefined) ?? m.avgEm) : FIT_FALLBACK_EM;
        w += em * size + letterSpacing;
      }
      return w;
    };
  };
  // Líneas de un texto partido en palabras, a lo ancho disponible (corte voraz, como el de satori).
  const lines = (s: string, widthOf: (s: string) => number, maxW: number) => {
    const words = String(s ?? '').split(/\s+/).filter(Boolean);
    if (!words.length) return 0;
    const space = widthOf(' ');
    let n = 1;
    let cur = -1;
    for (const w of words) {
      const ww = widthOf(w);
      if (cur < 0) cur = ww;
      else if (cur + space + ww <= maxW + 0.01) cur += space + ww;
      else { n++; cur = ww; }
    }
    return n;
  };
  const textH = (k: CarouselType, size: number, s: string, maxW: number, letterSpacing = r2(k.letterSpacingEm * size), transform = k.transform, lh = k.lineHeight) =>
    lines(s, widthFn(k, size, letterSpacing, transform), maxW) * size * lh;

  // ── cabecera ──
  const counterW = widthFn(T.label, L, r2(T.label.letterSpacingEm * L), 'none')(`${slide.index} / ${slide.total}`);
  const top = Math.max(2, r2(L * 0.21)) + r2(L * 0.95) +
    Math.max(L * T.label.lineHeight, slide.eyebrow ? textH(T.label, L, slide.eyebrow, inner - counterW) : 0);

  // ── centro ──
  let mid = 0;
  let any = false;
  if (chrome.headline.length) {
    const hs = px(T.headline.sizePct);
    const wOf = widthFn(T.headline, hs, r2(T.headline.letterSpacingEm * hs), T.headline.transform);
    const HE = chrome.headlineEmphasis;
    if (!HE) {
      let n = 1;
      let cur = 0;
      for (const atom of headlineAtoms(chrome.headline)) {
        const aw = Math.ceil(atom.reduce((s, p) => s + wOf(p.text), 0));
        if (cur > 0 && cur + aw > inner + 0.01) { n++; cur = aw; } else cur += aw;
      }
      mid += n * hs * T.headline.lineHeight;
    } else {
      // 1.4.0 — con énfasis, cada tramo se mide con SU fuente y SU tamaño, y cada línea es tan alta
      // como su letra más grande.
      const es = r2(hs * HE.sizeScale);
      const eOf = widthFn(HE, es, r2(HE.letterSpacingEm * es), HE.transform);
      let cur = 0;
      let lineMax = 0;
      let total = 0;
      for (const atom of headlineAtoms(chrome.headline)) {
        const aw = Math.ceil(atom.reduce((s, p) => s + (p.keyword ? eOf(p.text) : wOf(p.text)), 0));
        const ah = Math.max(...atom.map((p) => (p.keyword ? es : hs)));
        if (cur > 0 && cur + aw > inner + 0.01) { total += lineMax; cur = aw; lineMax = ah; }
        else { cur += aw; lineMax = Math.max(lineMax, ah); }
      }
      mid += (total + lineMax) * T.headline.lineHeight;
    }
    any = true;
  }
  if (slide.figure) {
    const fs = px(T.figure.sizePct);
    mid += (any ? r2(B * 0.8) : 0) + textH(T.figure, fs, slide.figure.value, inner);
    any = true;
    if (slide.figure.bar) mid += r2(L * 1.26) + Math.max(2, r2(L * 0.53));
    if (chrome.subheadline) mid += r2(B * 0.69) + textH(T.body, B, chrome.subheadline, inner);
    const dot = r2(L * 0.63);
    const ls = r2(L * 1.1);
    mid += r2(B * 0.69) + Math.max(dot,
      textH(T.label, ls, slide.figure.source, inner - dot - r2(L * 0.74), r2(T.label.letterSpacingEm * 0.4 * ls), 'none'));
  } else if (chrome.subheadline) {
    mid += (any ? r2(B * 0.69) : 0) + textH(T.body, B, chrome.subheadline, inner);
    any = true;
  }
  if (slide.steps.length) {
    const ss = r2(B * 0.86);
    const mark = r2(B * 0.55);
    mid += any ? r2(B * 0.83) : 0;
    slide.steps.forEach((s, k) => {
      mid += (k > 0 ? r2(B * 0.48) : 0) + Math.max(mark, textH(T.body, ss, s.text, inner - mark - r2(B * 0.62), undefined, undefined, 1.35));
    });
    any = true;
  }
  if (slide.cta && slide.role === 'closing') {
    const cs = r2(L * 1.16);
    const arrowW = r2(cs * 0.62) + r2(cs * 0.45);
    mid += (any ? r2(B * 0.97) : 0) +
      Math.max(r2(cs * 0.84), textH(T.label, cs, slide.cta, inner - arrowW, r2(T.label.letterSpacingEm * 0.75 * cs))) +
      r2(cs * 0.45) + Math.max(1, r2(cs * 0.09));
  }

  // ── pie ──
  let logoH = 0;
  if (chrome.logo?.kind === 'image') logoH = px(chrome.logo.heightPct);
  else if (chrome.logo?.kind === 'wordmark') {
    const S = px(chrome.logo.sizePct);
    logoH = Math.max(0, ...chrome.logo.parts.map((p) => r2(S * p.scale)));
  }
  const swipeH = slide.role === 'cover' ? Math.max(L * T.label.lineHeight, r2(L * 0.62)) : 0;
  const foot = Math.max(logoH, swipeH);

  const available = H - 2 * M - top - foot;
  const gap = r2(L * FIT_MIN_GAP_LABELS);
  const r = (n: number) => Math.round(n * 100) / 100;
  return { top: r(top), mid: r(mid), foot: r(foot), available: r(available), gap, slack: r(available - mid - 2 * gap), estimated };
}

/**
 * El ajuste vertical: devuelve el cromo con el que la lámina CABE entre la cabecera y el pie, y los
 * avisos de lo que hubo que reducir. PURO y determinista. Si la lámina ya cabe devuelve EL MISMO
 * objeto `chrome`, sin tocar: la escena sale idéntica. Sin `metrics` (o con una fuente sin métricas)
 * estima con un ancho medio genérico y lo avisa.
 */
export function fitCarouselContent(args: { chrome: CarouselChrome; metrics?: FitMetrics | null }): {
  chrome: CarouselChrome; warnings: string[];
  report: { adjusted: boolean; slack_px: number; figure_scale: number; headline_size_pct: number | null;
    body_scale: number; steps_dropped: number; overflow: boolean; estimated_fonts: string[] };
} {
  const base = args.chrome;
  const first = measureCarouselLayout(base, args.metrics);
  const headlineFrom = base.headline.length ? base.type.headline.sizePct : null;
  const untouched = {
    chrome: base, warnings: [] as string[],
    report: { adjusted: false, slack_px: first.slack, figure_scale: 1, headline_size_pct: headlineFrom, body_scale: 1, steps_dropped: 0, overflow: false, estimated_fonts: first.estimated },
  };
  if (first.estimated.length) {
    untouched.warnings.push(`CAROUSEL_FIT_ESTIMATED: sin métricas de ${first.estimated.join(', ')}; el ajuste usó un ancho medio genérico`);
  }
  if (first.slack >= 0) return untouched;

  // Escalera de estados, en el orden fijado: cifra → titular → cuerpo y pasos → pasos omitidos.
  type State = { figure: number; headline: number; body: number; drop: number };
  const ladder: State[] = [];
  let st: State = { figure: 1, headline: base.type.headline.sizePct, body: 1, drop: 0 };
  if (base.slide.figure) for (const f of FIT_FIGURE_SCALES.slice(1)) ladder.push(st = { ...st, figure: f });
  if (base.headline.length) for (const h of base.fitLadder.headline) ladder.push(st = { ...st, headline: h });
  if (base.subheadline || base.slide.steps.length) for (const b of FIT_BODY_SCALES) ladder.push(st = { ...st, body: b });
  const droppable = base.slide.steps.filter((s) => !s.critical).length;
  for (let d = 1; d <= droppable; d++) ladder.push(st = { ...st, drop: d });

  const apply = (s: State): CarouselChrome => {
    // Se omiten los pasos NO críticos empezando por el último; el orden de los que quedan no cambia.
    let toDrop = s.drop;
    const keep = [...base.slide.steps].reverse().filter((p) => {
      if (toDrop > 0 && !p.critical) { toDrop--; return false; }
      return true;
    }).reverse();
    return {
      ...base,
      slide: { ...base.slide, steps: keep },
      type: {
        ...base.type,
        figure: { ...base.type.figure, sizePct: Math.round(base.type.figure.sizePct * s.figure * 1000) / 1000 },
        headline: { ...base.type.headline, sizePct: s.headline },
        body: { ...base.type.body, sizePct: Math.round(base.type.body.sizePct * s.body * 1000) / 1000 },
      },
      fitGuard: true,
    };
  };

  let chosen: State | null = null;
  let fitted: CarouselChrome = base;
  let m = first;
  for (const s of ladder) {
    fitted = apply(s);
    m = measureCarouselLayout(fitted, args.metrics);
    if (m.slack >= 0) { chosen = s; break; }
  }
  const final = chosen ?? ladder[ladder.length - 1] ?? { figure: 1, headline: base.type.headline.sizePct, body: 1, drop: 0 };
  if (!chosen) { fitted = apply(final); m = measureCarouselLayout(fitted, args.metrics); }

  const warnings: string[] = [];
  const what: string[] = [];
  if (final.figure !== 1) what.push(`cifra ×${final.figure}`);
  if (headlineFrom != null && final.headline !== headlineFrom) what.push(`titular ${headlineFrom}→${final.headline} %`);
  if (final.body !== 1) what.push(`cuerpo y pasos ×${final.body}`);
  if (what.length) {
    warnings.push(`CAROUSEL_CONTENT_FIT_REDUCED: el bloque central no cabía entre la cabecera y el pie (faltaban ${Math.ceil(-first.slack)} px); ${what.join(' · ')}`);
  }
  if (final.drop > 0) {
    warnings.push(`CAROUSEL_STEPS_TRUNCATED: se omitieron ${final.drop} de ${base.slide.steps.length} pasos desde el final para que la lámina quepa; el paso crítico se conserva`);
  }
  if (!chosen) {
    warnings.push(`CAROUSEL_CONTENT_OVERFLOW: ni con el mínimo legible cabe (faltan ${Math.ceil(-m.slack)} px); el pie queda en su sitio y el bloque central se recorta`);
  }
  return {
    chrome: fitted, warnings: [...warnings, ...untouched.warnings],
    report: { adjusted: true, slack_px: m.slack, figure_scale: final.figure, headline_size_pct: headlineFrom == null ? null : final.headline,
      body_scale: final.body, steps_dropped: final.drop, overflow: !chosen, estimated_fonts: first.estimated },
  };
}
/**
 * 1.5.0 — el área que ocupa el titular (y la bajada, si la lámina la lleva) de una lámina, con las mismas
 * medidas que `measureCarouselLayout`. PURO. Caja de líneas: un poco mayor que la de los glifos.
 */
export function carouselTextArea(chrome: CarouselChrome, metrics: FitMetrics | null | undefined): { areaPct: number; estimated: string[] } {
  const W = chrome.canvas.width;
  const H = chrome.canvas.height;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const T = chrome.type;
  const inner = r2(W - 2 * r2((chrome.marginPct / 100) * W));
  const estimated: string[] = [];
  const widthFn = (k: { family: string; weight: number; italic: boolean; transform: string; letterSpacingEm: number }, size: number) => {
    const m = metrics?.[fitFontKey(k)] ?? null;
    if (!m && !estimated.includes(k.family)) estimated.push(k.family);
    const ls = r2(k.letterSpacingEm * size);
    return (s: string) => {
      const str = k.transform === 'uppercase' ? s.toUpperCase() : k.transform === 'lowercase' ? s.toLowerCase() : s;
      let w = 0;
      for (const ch of str) {
        const cp = ch.codePointAt(0)!;
        w += (m ? (m.advances.get(cp) ?? (cp === 0xa0 ? m.advances.get(0x20) : undefined) ?? m.avgEm) : FIT_FALLBACK_EM) * size + ls;
      }
      return w;
    };
  };
  let maxW = 0;
  let total = 0;
  if (chrome.headline.length) {
    const hs = r2((T.headline.sizePct / 100) * W);
    const HE = chrome.headlineEmphasis;
    const es = HE ? r2(hs * HE.sizeScale) : hs;
    const wOf = widthFn(T.headline, hs);
    const eOf = HE ? widthFn(HE, es) : wOf;
    let cur = 0, lineMax = 0, h = 0;
    for (const atom of headlineAtoms(chrome.headline)) {
      const aw = Math.ceil(atom.reduce((acc, p) => acc + (p.keyword && HE ? eOf(p.text) : wOf(p.text)), 0));
      const ah = Math.max(...atom.map((p) => (p.keyword && HE ? es : hs)));
      if (cur > 0 && cur + aw > inner + 0.01) { h += lineMax; maxW = Math.max(maxW, cur); cur = aw; lineMax = ah; }
      else { cur += aw; lineMax = Math.max(lineMax, ah); }
    }
    maxW = Math.max(maxW, Math.min(cur, inner));
    total += (h + lineMax) * T.headline.lineHeight;
  }
  if (chrome.subheadline) {
    const B = r2((T.body.sizePct / 100) * W);
    const bOf = widthFn(T.body, B);
    let cur = 0, n = chrome.subheadline.split(/\s+/).filter(Boolean).length ? 1 : 0;
    for (const word of chrome.subheadline.split(/\s+/).filter(Boolean)) {
      const ww = bOf(word);
      if (cur > 0 && cur + bOf(' ') + ww > inner + 0.01) { n++; maxW = Math.max(maxW, cur); cur = ww; } else cur = cur > 0 ? cur + bOf(' ') + ww : ww;
    }
    maxW = Math.max(maxW, Math.min(cur, inner));
    total += r2(B * 0.69) + n * B * T.body.lineHeight;
  }
  return { areaPct: Math.round((10000 * Math.min(maxW, inner) * total) / (W * H)) / 100, estimated };
}

/**
 * 1.5.0 — el límite de área en la PORTADA del carrusel. PURO. Si la lámina no es portada, la marca no
 * declara límite o ya cabe, devuelve EL MISMO cromo. Si no cabe, baja el titular por sus escalones; si ni
 * al mínimo cabe, lo dice. No toca el texto.
 */
export function fitCarouselCoverArea(args: { chrome: CarouselChrome; metrics?: FitMetrics | null }): {
  chrome: CarouselChrome; warnings: string[]; report: null | { limit_pct: number; area_pct_before: number; area_pct: number; exceeded: boolean };
} {
  const c = args.chrome;
  const limit = c.maxTextAreaPct;
  if (limit == null || c.slide.role !== 'cover' || !c.headline.length) return { chrome: c, warnings: [], report: null };
  const first = carouselTextArea(c, args.metrics);
  if (first.areaPct <= limit) return { chrome: c, warnings: [], report: { limit_pct: limit, area_pct_before: first.areaPct, area_pct: first.areaPct, exceeded: false } };
  let out = c;
  let m = first;
  for (const h of c.fitLadder.headline) {
    out = { ...c, type: { ...c.type, headline: { ...c.type.headline, sizePct: h } },
      fitLadder: { headline: c.fitLadder.headline.filter((x) => x < h) } };
    m = carouselTextArea(out, args.metrics);
    if (m.areaPct <= limit) break;
  }
  const warnings: string[] = [];
  if (out.type.headline.sizePct !== c.type.headline.sizePct) {
    warnings.push(`CAROUSEL_TEXT_AREA_REDUCED: la portada ocupaba ${first.areaPct} % (límite ${limit} %); titular ${c.type.headline.sizePct}→${out.type.headline.sizePct} % → ${m.areaPct} %`);
  }
  if (m.areaPct > limit) warnings.push(`CAROUSEL_TEXT_AREA_EXCEEDED: ni al tamaño mínimo cabe en ${limit} % (queda en ${m.areaPct} %); se compone igual`);
  return { chrome: out, warnings, report: { limit_pct: limit, area_pct_before: first.areaPct, area_pct: m.areaPct, exceeded: m.areaPct > limit } };
}
// ── 1.6.0 · EL TEXTO NO TAPA UNA CARA ──────────────────────────────────────────────────────────────
// EJE (código): QUÉ se evita —la caja del bloque de texto no toca la caja de una cara, con un margen— y CÓMO se
// elige —la primera ancla candidata libre; si ninguna, la de menor solape—. INSTANCIA (dato): si se aplica, en
// qué anclas se prueba y con qué margen (`layout.avoid_faces`). Las cajas de las caras las mide un modelo de
// visión fuera de este bloque; acá entran como dato (0..1 sobre el ancho y el alto).
export interface FaceBox { x0: number; y0: number; x1: number; y1: number }

/** Candidatas por defecto: la declarada y luego las otras dos filas de SU MISMA columna (la marca eligió un lado
 *  de la imagen; se respeta). Abajo ⇒ arriba, medio. Arriba ⇒ abajo, medio. Medio ⇒ arriba, abajo. PURO. */
export function faceAnchorCandidates(anchor: string): string[] {
  const a = ANCHORS[anchor];
  if (!a) return [];
  const col = Object.entries(ANCHORS).filter(([, v]) => v.x === a.x).map(([k, v]) => ({ k, y: v.y }));
  const order = a.y === 'flex-end' ? ['flex-start', 'center'] : a.y === 'flex-start' ? ['flex-end', 'center'] : ['flex-start', 'flex-end'];
  return [anchor, ...order.map((y) => col.find((c) => c.y === y)?.k).filter((k): k is string => !!k)];
}

/** La caja (px) del bloque de texto con un ancla dada: las mismas medidas que `measureOverlayText` y los mismos
 *  rellenos que `overlayTextBox`, colocada como la coloca el flex de `buildOverlayScene`. PURO. */
export function overlayTextRect(style: ReturnType<typeof resolveOverlayStyle>, width: number, height: number,
  metrics: Record<string, FontAdvance | null | undefined> | null | undefined, anchor: string,
): { x0: number; y0: number; x1: number; y1: number } {
  const a = ANCHORS[anchor];
  const box = overlayTextBox(style, width, height);
  const m = measureOverlayText(style, width, height, metrics);
  const innerW = width - box.left - box.right;
  const innerH = height - box.top - box.bottom;
  const x0 = a.x === 'flex-start' ? box.left : a.x === 'center' ? box.left + (innerW - m.width) / 2 : width - box.right - m.width;
  const y0 = a.y === 'flex-start' ? box.top : a.y === 'center' ? box.top + (innerH - m.height) / 2 : height - box.bottom - m.height;
  return { x0, y0, x1: x0 + m.width, y1: y0 + m.height };
}

/** Las cajas de caras que devuelve el modelo (`{ faces: [{ box_2d: [ymin, xmin, ymax, xmax] }] }`, 0..1000) a
 *  0..1. Lo que no tiene forma de caja se descarta; nunca se inventa una. PURO. */
export function parseFaceBoxes(text: string): FaceBox[] {
  let data: any;
  try { data = JSON.parse(text); } catch { return []; }
  const list = Array.isArray(data?.faces) ? data.faces : Array.isArray(data) ? data : [];
  const out: FaceBox[] = [];
  for (const f of list) {
    const b = Array.isArray(f?.box_2d) ? f.box_2d.map(Number) : null;
    if (!b || b.length !== 4 || b.some((v: number) => !Number.isFinite(v))) continue;
    const c = (v: number) => Math.min(1, Math.max(0, v / 1000));
    const [y0, x0, y1, x1] = [c(b[0]), c(b[1]), c(b[2]), c(b[3])];
    if (x1 > x0 && y1 > y0) out.push({ x0, y0, x1, y1 });
  }
  return out;
}

/** Los escalones para que el bloque quepa en un hueco: el titular baja por sus `fit_steps` más chicos, luego la
 *  bajada por los suyos, y por último la bajada se quita — el mismo orden que el límite de área de 1.5.0. El
 *  texto nunca se recorta ni se reescribe. PURO. */
function faceFitLadder(base: ReturnType<typeof resolveOverlayStyle>): Array<{ style: ReturnType<typeof resolveOverlayStyle>; what: string[] }> {
  const hl = base.slots.headline;
  const sub = base.slots.subheadline;
  if (!hl) return [];
  type St = { h: number; s: number | null; drop: boolean };
  const out: Array<{ style: ReturnType<typeof resolveOverlayStyle>; what: string[] }> = [];
  let st: St = { h: hl.sizePct, s: sub ? sub.sizePct : null, drop: false };
  const push = (x: St) => {
    const what: string[] = [];
    if (x.h !== hl.sizePct) what.push(`titular ${hl.sizePct}→${x.h} %`);
    if (sub && !x.drop && x.s != null && x.s !== sub.sizePct) what.push(`bajada ${sub.sizePct}→${x.s} %`);
    if (x.drop) what.push('sin bajada');
    out.push({ what, style: { ...base, slots: {
      headline: { ...hl, sizePct: x.h },
      subheadline: !sub || x.drop ? null : { ...sub, sizePct: x.s ?? sub.sizePct },
    } } });
  };
  for (const h of (hl.fitSmaller ?? []).filter((v) => v < hl.sizePct)) push(st = { ...st, h });
  if (sub) for (const v of (sub.fitSmaller ?? []).filter((v) => v < sub.sizePct)) push(st = { ...st, s: v });
  if (sub) push(st = { ...st, drop: true });
  return out;
}

/** Elige el ancla del bloque de texto que no tapa ninguna cara. Sin `avoidFaces` o sin titular devuelve EL MISMO
 *  estilo. Orden: (1) la primera candidata libre al tamaño de siempre; (2) si ninguna, la que queda libre con el
 *  MENOR ajuste (escalones de `faceFitLadder`); (3) si ni así, la de menor solape al tamaño de siempre, y se dice.
 *  El ancla de la capa de producto (si se pega) no es candidata: las dos capas se taparían. PURO. */
export function chooseOverlayAnchor(args: {
  style: ReturnType<typeof resolveOverlayStyle>; width: number; height: number;
  metrics?: Record<string, FontAdvance | null | undefined> | null; faces: FaceBox[]; productAnchor?: string | null;
}): { style: ReturnType<typeof resolveOverlayStyle>; report: null | {
  faces: number; anchor_declared: string; anchor_used: string; moved: boolean; overlap_pct: number;
  candidates: Array<{ anchor: string; overlap_pct: number }>; reduced: string[];
} } {
  const { style, width, height } = args;
  const af = style.layout.avoidFaces;
  if (!af || !style.slots.headline) return { style, report: null };
  const declared = style.layout.anchor;
  const pad = (af.marginPct / 100) * Math.min(width, height);
  const boxes = args.faces.map((f) => ({ x0: f.x0 * width - pad, y0: f.y0 * height - pad, x1: f.x1 * width + pad, y1: f.y1 * height + pad }));
  const cands = af.anchors.filter((a) => ANCHORS[a] && a !== (args.productAnchor ?? null));
  const score = (st: ReturnType<typeof resolveOverlayStyle>) => cands.map((anchor) => {
    const r = overlayTextRect(st, width, height, args.metrics, anchor);
    const area = Math.max(1, (r.x1 - r.x0) * (r.y1 - r.y0));
    let inter = 0;
    for (const b of boxes) {
      const w = Math.min(r.x1, b.x1) - Math.max(r.x0, b.x0);
      const h = Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0);
      if (w > 0 && h > 0) inter += w * h;
    }
    return { anchor, overlap_pct: Math.round((10000 * inter) / area) / 100 };
  });
  const scored = score(style);
  if (!scored.length) return { style, report: null };
  let base = style;
  let what: string[] = [];
  let best = scored.find((c) => c.overlap_pct === 0) ?? null;
  if (!best) {
    for (const step of faceFitLadder(style)) {
      const free = score(step.style).find((c) => c.overlap_pct === 0);
      if (free) { best = free; base = step.style; what = step.what; break; }
    }
  }
  if (!best) best = scored.reduce((m, c) => (c.overlap_pct < m.overlap_pct ? c : m), scored[0]);
  const declaredScore = scored.find((c) => c.anchor === declared)?.overlap_pct ?? 0;
  const markers = [...style.markers];
  if (best.anchor !== declared) {
    markers.push(`OVERLAY_ANCHOR_MOVED_FOR_FACE: en ${declared} el texto tapaba una cara (${declaredScore} % de su caja); se compone en ${best.anchor}`);
  }
  if (what.length) markers.push(`OVERLAY_TEXT_REDUCED_FOR_FACE: para que el texto quepa en ${best.anchor} sin tapar una cara: ${what.join(' · ')}`);
  if (best.overlap_pct > 0) {
    markers.push(`OVERLAY_FACE_OVERLAP_UNAVOIDABLE: ninguna ancla candidata (${cands.join(', ')}) deja el texto libre de caras ni al tamaño mínimo; se usa ${best.anchor}, que tapa ${best.overlap_pct} %`);
  }
  const out = best.anchor === declared && markers.length === style.markers.length ? style : {
    ...base,
    layout: { ...base.layout, anchor: best.anchor, align: af.keepAlign ? base.layout.align : ANCHORS[best.anchor].align },
    markers,
  };
  return { style: out, report: {
    faces: args.faces.length, anchor_declared: declared, anchor_used: best.anchor, moved: best.anchor !== declared,
    overlap_pct: best.overlap_pct, candidates: scored, reduced: what,
  } };
}

/** 1.6.0 — el `textShadow` del overlay: las mismas dos sombras que `carouselTextShadow` (halo y caída). PURO. */
export function overlayTextShadow(te: { color: string; blurPct: number; offsetPct: number }, canvasWidth: number): string {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const blur = r2((te.blurPct / 100) * canvasWidth);
  const off = r2((te.offsetPct / 100) * canvasWidth);
  return `0px 0px ${blur}px ${te.color}, 0px ${off}px ${blur}px ${te.color}`;
}

// ── COMPOSITOR:END ──

// ── Transporte (impuro) ────────────────────────────────────────────────────

function normalizeSupabaseUrl(raw: string): string {
  let v = raw.trim().replace(/\/+$/, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) {
    if (!v.includes('.')) v = `${v}.supabase.co`;
    v = `https://${v}`;
  }
  return v;
}
const SB_URL = () => normalizeSupabaseUrl(process.env.SUPABASE_URL ?? '');
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/**
 * Lector de PostgREST, FAIL-LOUD (misma disciplina que `sb()` de `api/execute.ts`, #95-B): 200+[]
 * es ausencia legítima y devuelve []; un 4xx/5xx es un BUG (columna que no existe, RLS, permiso) y
 * LANZA. Se duplica en vez de importarse: cada función de Vercel se empaqueta por separado y
 * `api/execute.ts` es una ruta, no una librería — un import cruzado acoplaría dos deploys.
 */
async function sbSelect<T = any>(path: string): Promise<T[]> {
  const base = SB_URL();
  const key = SB_KEY();
  if (!base || !key) {
    throw new CompositorError('COMPOSITOR_SUPABASE_ENV_MISSING',
      'faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno de ImageLab', 500);
  }
  const res = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new CompositorError('COMPOSITOR_DB_QUERY_FAILED',
      `select '${path}' devolvió ${res.status}: ${(await res.text()).slice(0, 240)}`, 500);
  }
  return (await res.json()) as T[];
}

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

function dataUrlToBytes(d: string): Uint8Array {
  const comma = d.indexOf(',');
  return new Uint8Array(Buffer.from(comma >= 0 ? d.slice(comma + 1) : d, 'base64'));
}

async function fetchBytes(url: string, label: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/4.0 (compatible; ImageLab compositor)' } });
  if (!res.ok) throw new CompositorError(label, `GET ${url.slice(0, 120)} → ${res.status}`, 502);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Bytes de la fuente de una ranura. Dos caminos, los dos DATO:
 *   1. `typography.<slot>.font_url` en los tokens — un archivo fijado por la marca. Gana.
 *   2. `brand_typography.css_import` — hoja css2 de Google, de la que sale el TTF del peso pedido.
 * Sin ninguno de los dos: FALLA con el nombre del rol. El motor no tiene una fuente de reserva.
 */
async function loadFont(slot: Slot | string, s: {
  role: string; family: string; cssImport: string | null; fontUrl: string | null; weight: number; italic: boolean;
}): Promise<{ name: string; data: Uint8Array; weight: number; style: 'normal' | 'italic'; source: string }> {
  // Toda fuente pasa por `neutralizeKerning` antes de llegar a satori (1.3.1): sin eso, el espacio
  // entre palabras sale desigual. El porqué, medido, está en la función.
  if (s.fontUrl) {
    return { name: s.family, data: neutralizeKerning(await fetchBytes(s.fontUrl, 'COMPOSITOR_FONT_FETCH_FAILED')).bytes,
      weight: s.weight, style: s.italic ? 'italic' : 'normal', source: s.fontUrl };
  }
  if (!s.cssImport || !/^https?:\/\//i.test(s.cssImport)) {
    throw new CompositorError('COMPOSITOR_FONT_UNRESOLVED',
      `la ranura '${slot}' usa brand_typography.role='${s.role}' (${s.family}) y esa fila no trae un css_import ` +
      `descargable ('${s.cssImport ?? '∅'}'). Siembra css_import (hoja css2) o typography.${slot}.font_url con un .ttf/.otf.`);
  }
  const css = new TextDecoder().decode(await fetchBytes(s.cssImport, 'COMPOSITOR_FONT_CSS_FAILED'));
  const face = pickFontFace(parseFontFaces(css), { weight: s.weight, italic: s.italic });
  if (!face) {
    throw new CompositorError('COMPOSITOR_FONT_UNRESOLVED',
      `css_import de '${s.role}' (${s.family}) no declara ningún @font-face descargable: ${s.cssImport}`);
  }
  return { name: s.family, data: neutralizeKerning(await fetchBytes(face.url, 'COMPOSITOR_FONT_FETCH_FAILED')).bytes,
    weight: face.weight, style: face.italic ? 'italic' : 'normal', source: face.url };
}

/**
 * F3 — el logotipo de firma de la marca (`public.brand_logo`, role 'signature', activo). TOLERANTE por
 * contrato: sin fila, sin tabla, sin permiso o con un `src` que no baja ⇒ null y un aviso; nunca un
 * error. Una lámina sin logotipo es una lámina legible; una lámina que no sale no lo es.
 * Las imágenes se embeben como data URI y se miden aquí (PNG/JPEG por cabecera, SVG por viewBox).
 */
async function loadSignatureLogo(brandId: string, warnings: string[]): Promise<CarouselLogoIn | null> {
  let rows: any[] = [];
  try {
    rows = await sbSelect(`brand_logo?brand_id=eq.${encodeURIComponent(brandId)}&role=eq.signature&active=eq.true&select=kind,src,spec,width,height&limit=1`);
  } catch (e) {
    warnings.push(`CAROUSEL_LOGO_UNAVAILABLE: no se pudo leer brand_logo (${(e as Error)?.message?.slice(0, 160) ?? e}); se compone sin logotipo`);
    return null;
  }
  const row = rows[0];
  if (!row) return null;
  if (row.kind !== 'image') return { kind: String(row.kind), spec: row.spec ?? null };
  try {
    let src = String(row.src ?? '');
    let bytes: Uint8Array | null = null;
    let mime = '';
    if (/^https:\/\//.test(src)) {
      bytes = await fetchBytes(src, 'CAROUSEL_LOGO_FETCH_FAILED');
      const head = new TextDecoder().decode(bytes.slice(0, 256));
      mime = /<svg|<\?xml/i.test(head) ? 'image/svg+xml' : imageDimensions(bytes).mime;
      src = `data:${mime};base64,${b64(bytes)}`;
    } else {
      mime = (src.match(/^data:([^;,]+)/) ?? [])[1] ?? '';
      const comma = src.indexOf(',');
      const payload = src.slice(comma + 1);
      bytes = /;base64,/.test(src.slice(0, comma + 1))
        ? new Uint8Array(Buffer.from(payload, 'base64'))
        : new TextEncoder().encode(decodeURIComponent(payload));
    }
    let intrinsic: { width: number; height: number } | null = null;
    if (Number(row.width) > 0 && Number(row.height) > 0) intrinsic = { width: Number(row.width), height: Number(row.height) };
    else if (mime === 'image/svg+xml') intrinsic = svgDimensions(new TextDecoder().decode(bytes));
    else { const d = imageDimensions(bytes); intrinsic = { width: d.width, height: d.height }; }
    return { kind: 'image', src, intrinsic };
  } catch (e) {
    warnings.push(`CAROUSEL_LOGO_UNAVAILABLE: el logotipo de brand_logo no se pudo cargar (${(e as Error)?.message?.slice(0, 160) ?? e}); se compone sin logotipo`);
    return null;
  }
}

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const config = { maxDuration: 60 };


// ── 1.6.0 · DETECCIÓN DE CARAS (red) ─────────────────────────────────────────────────────────────────
// Sólo corre si la marca o el canal declaran `layout.avoid_faces`. Usa la misma vía de Vertex que el inspector
// (`api/inspect.ts`): las dos copias de abajo son LITERALES de las suyas, y `tests/compositor_caras_test.mjs`
// exige que no diverjan. NUNCA tumba la composición: si falla, se compone en el ancla declarada y se dice.
const FACES_GCP_PROJECT  = () => process.env.GOOGLE_CLOUD_PROJECT ?? '';
const FACES_GCP_LOCATION = () => process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1';
const FACES_MODEL = () => (process.env.IMAGELAB_FACES_MODEL ?? '').trim() || 'gemini-2.5-flash';
const FACES_TIMEOUT_MS = 15_000;
const FACES_PROMPT =
  'Detect every human face visible in this image, including faces in profile, partially visible or turned away. ' +
  'Return each one as box_2d = [ymin, xmin, ymax, xmax], integers normalized to 0-1000, covering the whole head ' +
  'from the hairline to the chin. If there are no faces, return an empty list.';

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

// ── AUTH-VERTEX:BEGIN ── copia literal de la autenticación de `api/execute.ts`.
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
// ── AUTH-VERTEX:END ──

type FaceCheck = {
  faces: FaceBox[] | null; model: string; called: boolean; http_status: number | null;
  usage: { input_tokens: number; output_tokens: number } | null; error: string | null; duration_ms: number;
};

async function detectFaces(bytes: Uint8Array, mime: string): Promise<FaceCheck> {
  const t0 = Date.now();
  const out: FaceCheck = { faces: null, model: FACES_MODEL(), called: false, http_status: null, usage: null, error: null, duration_ms: 0 };
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), FACES_TIMEOUT_MS);
  try {
    if (!FACES_GCP_PROJECT()) throw new Error('GOOGLE_CLOUD_PROJECT missing in env.');
    const token = await getAccessToken();
    const url = `${vertexBaseUrl(FACES_GCP_LOCATION(), FACES_GCP_PROJECT())}/publishers/google/models/${encodeURIComponent(out.model)}:generateContent`;
    out.called = true;
    const res = await fetch(url, {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: b64(bytes) } }, { text: FACES_PROMPT }] }],
        generationConfig: {
          temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 },
          responseSchema: {
            type: 'OBJECT', required: ['faces'],
            properties: { faces: { type: 'ARRAY', items: { type: 'OBJECT', required: ['box_2d'],
              properties: { box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } } } } } },
          },
        },
      }),
    });
    out.http_status = res.status;
    if (!res.ok) throw new Error(`Vertex ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const um = data?.usageMetadata;
    if (typeof um?.promptTokenCount === 'number' && typeof um?.candidatesTokenCount === 'number') {
      out.usage = { input_tokens: um.promptTokenCount, output_tokens: um.candidatesTokenCount + (Number(um.thoughtsTokenCount) || 0) };
    }
    const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
    if (!text) throw new Error(`sin respuesta (${data?.candidates?.[0]?.finishReason ?? 'sin texto'})`);
    out.faces = parseFaceBoxes(text);
  } catch (err) {
    out.error = err instanceof Error && err.name === 'AbortError' ? `el detector superó ${FACES_TIMEOUT_MS / 1000} s`
      : (err instanceof Error ? err.message : String(err)).slice(0, 240);
  } finally {
    clearTimeout(tid);
    out.duration_ms = Date.now() - t0;
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed', error_label: 'METHOD_NOT_ALLOWED' }); return; }

  let body: any;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? null);
  } catch { body = null; }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Invalid JSON', error_label: 'COMPOSITOR_BAD_REQUEST', status: 'error' });
    return;
  }

  const t0 = Date.now();
  try {
    const brandId = String(body.brand_id ?? '').trim();
    const canal = body.canal == null ? null : String(body.canal).trim().toUpperCase();
    const headline = String(body.headline ?? '');
    const subheadline = body.subheadline == null ? null : String(body.subheadline);
    if (!brandId) throw new CompositorError('COMPOSITOR_BRAND_MISSING', 'brand_id es obligatorio: los tokens son por marca', 400);
    // F3 — el campo `carousel` se valida contra el contrato ANTES de leer nada: un 400 es un error
    // del llamador y no depende de los datos de la marca.
    const carouselIn = parseCarouselRequest(body.carousel);
    // 1.4.0 — tramos de énfasis del titular. Se validan con el resto del contrato, antes de leer dato.
    const emphasisIn = parseEmphasisRequest(body.emphasis);
    const hasImage = !!(body.image_data_url || body.image_url);
    // BRIEF 8 · D — un titular vacío ya NO es motivo suficiente para rechazar: si la marca declara
    // franja de identidad, la escena se SELLA igual (el sello no es un adorno del texto). La guarda
    // de BRIEF 7 sigue viva para el caso en que no habría NADA que dibujar, y se evalúa abajo,
    // cuando los tokens ya dijeron si hay identidad. Lo que no cambia: acá no se escribe texto.
    // F3 — una lámina de carrusel con fondo de superficie no lleva foto: la imagen no se exige acá y
    // se vuelve a exigir abajo si la marca no tiene `tokens.carousel` (sin cromo no hay superficie).
    if (!hasImage && carouselIn?.background !== 'surface') {
      throw new CompositorError('COMPOSITOR_IMAGE_MISSING', 'falta image_data_url o image_url (la imagen limpia a componer)', 400);
    }

    // Las tres capas de dato, en paralelo. Cada una fail-loud por su cuenta.
    const [tokenRows, typography, palette] = await Promise.all([
      sbSelect(`imagelab_overlay_tokens?or=(brand_id.eq.${encodeURIComponent(brandId)},brand_id.is.null)&select=id,brand_id,canal,tokens,active`),
      sbSelect(`brand_typography?brand_id=eq.${encodeURIComponent(brandId)}&select=role,font_family,css_import,fallback`),
      sbSelect(`brand_palette?brand_id=eq.${encodeURIComponent(brandId)}&select=role,hex`),
    ]);

    const picked = pickOverlayTokens(tokenRows as any[], brandId, canal);
    const style = resolveOverlayStyle({ tokens: picked.tokens, typography: typography as any[], palette: palette as any[], text: { headline, subheadline, emphasis: emphasisIn } });

    // ── F3 · lámina de carrusel ── Sólo si llega `carousel` Y la marca declara `tokens.carousel`.
    // Si no, todo lo de abajo es exactamente 1.2.0.
    const warnings: string[] = [];
    const carouselTokens = picked.tokens.carousel;
    const carouselOn = !!carouselIn && isPlain(carouselTokens) && Object.keys(carouselTokens).length > 0;
    if (carouselIn && !carouselOn) {
      warnings.push(`CAROUSEL_NOT_DECLARED: la marca no declara tokens.carousel (capas: ${picked.layers.join(' < ')}); se compone como 1.2.0`);
      if (!hasImage) {
        throw new CompositorError('COMPOSITOR_IMAGE_MISSING',
          'carousel.background=surface sin imagen, y la marca no declara tokens.carousel: sin cromo de carrusel no hay superficie que pintar', 400);
      }
    }
    if (carouselOn) {
      if (!headline.trim() && !carouselIn!.figure) {
        throw new CompositorError('COMPOSITOR_TEXT_MISSING',
          'lámina de carrusel sin titular y sin cifra: no hay nada que componer. El compositor NO escribe texto (BRIEF 7, regla a).', 400);
      }
      const logo = await loadSignatureLogo(brandId, warnings);
      const chrome = resolveCarouselChrome({
        tokens: picked.tokens, typography: typography as any[], palette: palette as any[],
        carousel: carouselIn, text: { headline, subheadline, emphasis: emphasisIn }, logo,
      });
      if (!chrome.applied) throw new CompositorError('COMPOSITOR_FAILED', 'cromo de carrusel no resuelto', 500);
      warnings.push(...chrome.warnings);
      const prodPick = resolveProductLayer({ tokens: picked.tokens, textAnchor: null, count: Array.isArray(body.products) ? body.products.length : 0 });
      if (prodPick.layer) warnings.push('CAROUSEL_PRODUCT_LAYER_NOT_COMPOSED: la lámina de carrusel no pega la capa de producto');

      // Fondo: la foto se baja sólo si la lámina la usa. El lienzo es el de la marca (dato), así que
      // todas las láminas de un carrusel salen del MISMO tamaño, tengan foto o no.
      let backgroundSrc: string | null = null;
      if (chrome.slide.background === 'image') {
        const cleanBytes = body.image_data_url
          ? dataUrlToBytes(String(body.image_data_url))
          : await fetchBytes(String(body.image_url), 'COMPOSITOR_IMAGE_FETCH_FAILED');
        const d = imageDimensions(cleanBytes);
        backgroundSrc = `data:${d.mime};base64,${b64(cleanBytes)}`;
      }
      const fonts = await Promise.all(chrome.fonts.map(async (f) => ({
        slot: `carousel:${f.role}`,
        ...(await loadFont(`carousel:${f.role}`, { role: f.role, family: f.family, cssImport: f.cssImport, fontUrl: null, weight: f.weight, italic: f.italic })),
      })));
      // 1.3.3 — el ajuste vertical se mide con las MISMAS fuentes que recibe satori (ya sin kerning).
      const metrics: Record<string, FontAdvance | null> = {};
      chrome.fonts.forEach((f, k) => { metrics[fitFontKey(f)] = fontAdvanceMetrics(fonts[k].data); });
      // 1.5.0 — primero el límite de área de la plataforma (sólo portada), después el ajuste vertical.
      const area = fitCarouselCoverArea({ chrome, metrics });
      warnings.push(...area.warnings);
      const fit = fitCarouselContent({ chrome: area.chrome, metrics });
      warnings.push(...fit.warnings);
      const scene = buildCarouselScene({ chrome: fit.chrome, style, backgroundSrc });
      const { width, height } = chrome.canvas;
      const svg = await satori(scene as any, {
        width, height,
        fonts: fonts.map((f) => ({ name: f.name, data: Buffer.from(f.data), weight: f.weight as any, style: f.style })),
      });
      const png = new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
      console.log(
        `[Compositor][F3] brand=${brandId} canal=${canal ?? '∅'} piece=${body.piece_id ?? '∅'} ` +
        `lámina=${chrome.slide.index}/${chrome.slide.total} ${chrome.slide.role} fondo=${chrome.slide.background} ` +
        `tokens=${picked.source} ${width}x${height} logotipo=${chrome.logo ? chrome.logo.kind : 'ninguno'} ` +
        `ajuste=${fit.report.adjusted ? `sí (holgura ${fit.report.slack_px}px)` : 'no'} avisos=${warnings.length} ${Date.now() - t0}ms`,
      );
      res.status(200).json({
        status: 'ok',
        image_data_url: `data:image/png;base64,${b64(new Uint8Array(png))}`,
        compositor_version: COMPOSITOR_VERSION,
        tokens_source: picked.source,
        tokens_layers: picked.layers,
        width, height,
        fonts: fonts.map((f) => ({ slot: f.slot, family: f.name, weight: f.weight, source: f.source })),
        // La franja de identidad sólo se dibuja en láminas con foto (sobre superficie, el logotipo firma).
        identity: style.identity && backgroundSrc
          ? { mode: style.identity.mode, color: style.identity.color, width_pct: style.identity.widthPct,
              thickness_px: Math.max(1, Math.round((style.identity.widthPct / 100) * Math.min(width, height))),
              short_side: Math.min(width, height) }
          : null,
        sealed_without_title: false,
        product_layer: null,
        markers: style.markers,
        text: { headline, subheadline, ...(emphasisIn.length ? { emphasis: emphasisIn } : {}) },
        meta: {
          carousel_applied: true,
          warnings,
          carousel: {
            index: chrome.slide.index, total: chrome.slide.total, role: chrome.slide.role, background: chrome.slide.background,
            keyword_found: !!chrome.headline.find((p) => p.keyword), logo: chrome.logo ? chrome.logo.kind : null,
            // 1.4.0 — qué tramos se resaltaron y con qué estilo (null si la marca no declara énfasis).
            emphasis: emphasisIn.length || chrome.headlineEmphasis
              ? { requested: emphasisIn, highlighted: chrome.headline.filter((p) => p.keyword).map((p) => p.text),
                  styled: !!chrome.headlineEmphasis }
              : null,
            // 1.3.4 — si la lámina llevó efecto de texto, y cuál: sólo en láminas con foto.
            text_effect: chrome.textEffect && backgroundSrc
              ? { kind: chrome.textEffect.kind, color: chrome.textEffect.fn, alpha: chrome.textEffect.alpha,
                  blur_pct: chrome.textEffect.blurPct, offset_pct: chrome.textEffect.offsetPct, text_shadow: carouselTextShadow(chrome.textEffect, width) }
              : null,
            // 1.3.3 — qué hizo el ajuste vertical: sin esto no se puede auditar una lámina reducida.
            fit: fit.report,
            // 1.5.0 — el límite de área de la portada, si rigió.
            ...(area.report ? { text_area: area.report } : {}),
          },
        },
        duration_ms: Date.now() - t0,
      });
      return;
    }

    const sealOnly = !headline.trim();
    if (sealOnly && !style.identity) {
      throw new CompositorError('COMPOSITOR_TEXT_MISSING',
        'headline vacío y la marca no declara franja de identidad: no hay nada que componer. El compositor NO escribe texto — compone el que le llega, que sale del copy ya juzgado (BRIEF 7, regla a).', 400);
    }
    if (sealOnly) {
      style.markers.push('OVERLAY_SEALED_WITHOUT_TITLE: se compuso la franja de identidad sin titular; recomponer cuando la pieza tenga título (no hace falta regenerar la escena)');
    }

    // CAPA DE PRODUCTO — `products: [{ image_url, name? }]`. Lo resuelve el carril desde la ficha
    // (`product_blueprints`); acá sólo se baja, se mide y se pega.
    const productsIn = (Array.isArray(body.products) ? body.products : [])
      .filter((p: any) => p && typeof p.image_url === 'string' && /^https?:\/\//.test(p.image_url));
    const prodPick = resolveProductLayer({ tokens: picked.tokens, textAnchor: style.slots.headline ? style.layout.anchor : null, count: productsIn.length });
    style.markers.push(...prodPick.markers);
    const productImgs: ProductImageIn[] = [];
    if (prodPick.layer) {
      for (const p of productsIn.slice(0, prodPick.layer.maxItems)) {
        const bytes = await fetchBytes(String(p.image_url), 'COMPOSITOR_PRODUCT_FETCH_FAILED');
        const d = imageDimensions(bytes);
        if (d.mime !== 'image/png') style.markers.push(`PRODUCT_NOT_PNG: ${String(p.image_url).slice(0, 120)} no es PNG — sin alfa se verá su fondo`);
        productImgs.push({ src: `data:${d.mime};base64,${b64(bytes)}`, width: d.width, height: d.height, name: p.name ?? null });
      }
    }

    const cleanBytes = body.image_data_url
      ? dataUrlToBytes(String(body.image_data_url))
      : await fetchBytes(String(body.image_url), 'COMPOSITOR_IMAGE_FETCH_FAILED');
    const dims = imageDimensions(cleanBytes);

    // Sin ranuras de texto no se baja ninguna fuente: sellar una escena no debería costar una
    // descarga ni fallar por un css_import que la marca todavía no sembró.
    const fonts = await Promise.all(
      SLOTS.filter((s) => style.slots[s]).map(async (s) => ({ slot: s, ...(await loadFont(s, style.slots[s]!)) })),
    );
    // 1.4.0 — la fuente del énfasis, si es otra familia, otro peso u otro estilo que la del titular.
    // Si la hoja de la marca no sirve ese peso exacto se compone con el más cercano y SE DICE.
    const hl = style.slots.headline;
    if (hl?.emphasis) {
      const em = hl.emphasis;
      const same = fonts.some((f) => f.name === em.family && f.weight === em.weight && (f.style === 'italic') === em.italic);
      if (!same) {
        const f = await loadFont('headline:emphasis', em);
        if (f.weight !== em.weight || (f.style === 'italic') !== em.italic) {
          style.markers.push(`OVERLAY_EMPHASIS_FONT_SUBSTITUTED: ${em.family} ${em.weight}${em.italic ? ' itálica' : ''} no está en css_import; se usó ${f.weight}${f.style === 'italic' ? ' itálica' : ''}`);
        }
        fonts.push({ slot: 'headline:emphasis' as any, ...f });
      }
    }

    // 1.5.0 — el límite de área de la plataforma, medido con las MISMAS fuentes que recibe satori.
    const areaMetrics: Record<string, FontAdvance | null> = {};
    for (const f of fonts) {
      const slotStyle = (f.slot as string) === 'headline:emphasis' ? style.slots.headline?.emphasis : style.slots[f.slot as Slot];
      if (slotStyle) areaMetrics[fitFontKey(slotStyle)] = fontAdvanceMetrics(f.data);
    }
    const areaFit = fitOverlayTextArea({ style, width: dims.width, height: dims.height, metrics: areaMetrics });
    let finalStyle = areaFit.style;

    // 1.6.0 — el texto no tapa una cara. Sólo si la marca o el canal lo declaran y hay titular.
    let faceMeta: Record<string, unknown> | null = null;
    if (finalStyle.layout.avoidFaces && finalStyle.slots.headline) {
      const fc = await detectFaces(cleanBytes, dims.mime);
      faceMeta = { model: fc.model, provider_called: fc.called, provider_http_status: fc.http_status, usage: fc.usage,
        duration_ms: fc.duration_ms, faces: fc.faces, error: fc.error };
      if (fc.faces) {
        const ch = chooseOverlayAnchor({ style: finalStyle, width: dims.width, height: dims.height, metrics: areaMetrics,
          faces: fc.faces, productAnchor: prodPick.layer && productImgs.length ? prodPick.layer.anchor : null });
        finalStyle = ch.style;
        faceMeta = { ...faceMeta, ...(ch.report ?? {}) };
      } else {
        finalStyle = { ...finalStyle, markers: [...finalStyle.markers,
          `OVERLAY_FACE_CHECK_UNAVAILABLE: ${fc.error ?? 'sin respuesta'}; se compone en el ancla declarada (${finalStyle.layout.anchor})`] };
      }
    }

    const scene = buildOverlayScene({
      style: finalStyle, width: dims.width, height: dims.height,
      backgroundSrc: `data:${dims.mime};base64,${b64(cleanBytes)}`,
      products: productImgs, productLayer: prodPick.layer,
    });

    const svg = await satori(scene as any, {
      width: dims.width, height: dims.height,
      fonts: fonts.map((f) => ({ name: f.name, data: Buffer.from(f.data), weight: f.weight as any, style: f.style })),
    });
    const png = new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();

    console.log(
      `[Compositor][BRIEF7] brand=${brandId} canal=${canal ?? '∅'} piece=${body.piece_id ?? '∅'} ` +
      `tokens=${picked.source} (capas: ${picked.layers.join(' < ')}) ${dims.width}x${dims.height} ` +
      `fuentes=${fonts.map((f) => `${f.slot}:${f.name}@${f.weight}`).join(', ') || '∅ (sello sin titular)'} ` +
      `identidad=${style.identity ? style.identity.mode : 'ninguna'} ` +
      `producto=${productImgs.length ? `${productImgs.length}@${prodPick.layer!.anchor}` : 'ninguno'} ` +
      `markers=${finalStyle.markers.length} ${Date.now() - t0}ms`,
    );

    res.status(200).json({
      status: 'ok',
      image_data_url: `data:image/png;base64,${b64(new Uint8Array(png))}`,
      compositor_version: COMPOSITOR_VERSION,
      tokens_source: picked.source,
      tokens_layers: picked.layers,
      width: dims.width, height: dims.height,
      fonts: fonts.map((f) => ({ slot: f.slot, family: f.name, weight: f.weight, source: f.source })),
      // BRIEF 8 · D — el eco del sello: qué se dibujó y con qué grosor REAL en píxeles, calculado
      // sobre el lado corto. Sin este número no se puede verificar que el sello se lee igual en los
      // cuatro formatos, que es justamente lo que D.1 exige.
      identity: style.identity
        ? { mode: style.identity.mode, color: style.identity.color, width_pct: style.identity.widthPct,
            thickness_px: Math.max(1, Math.round((style.identity.widthPct / 100) * Math.min(dims.width, dims.height))),
            short_side: Math.min(dims.width, dims.height) }
        : null,
      sealed_without_title: sealOnly,
      // Eco de la capa de producto: qué se pegó y dónde. Sin esto no se puede auditar la imagen.
      product_layer: prodPick.layer && productImgs.length
        ? { anchor: prodPick.layer.anchor, height_pct: prodPick.layer.heightPct, items: productImgs.map((p) => p.name ?? null) }
        : null,
      markers: finalStyle.markers,
      // Eco VERBATIM de lo compuesto: el carril lo asienta y así queda cruzable contra el copy juzgado.
      // 1.4.0 — `emphasis` viaja sólo si la petición lo trajo: sin él, el eco es el de 1.3.4.
      // 1.5.0 — si el límite de área retiró la bajada, el eco lo dice: lo compuesto ya no la lleva.
      text: { headline, subheadline: finalStyle.slots.subheadline ? subheadline : (style.slots.subheadline ? null : subheadline),
        ...(emphasisIn.length ? { emphasis: emphasisIn } : {}) },
      // F3 — la forma de 1.2.0 se mantiene; sólo se suma `meta`.
      meta: {
        carousel_applied: false, warnings,
        ...(areaFit.report ? { text_area: areaFit.report } : {}),
        // 1.6.0 — la detección de caras: qué vio, dónde quedó el texto y el consumo del modelo (el carril lo asienta).
        ...(faceMeta ? { faces: faceMeta } : {}),
        ...(emphasisIn.length ? { emphasis: {
          requested: emphasisIn,
          highlighted: (hl?.parts ?? []).filter((p) => p.keyword).map((p) => p.text),
          styled: !!hl?.emphasis,
        } } : {}),
      },
      duration_ms: Date.now() - t0,
    });
  } catch (err) {
    const e = err as CompositorError;
    const label = e?.label ?? 'COMPOSITOR_FAILED';
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Compositor][BRIEF7] ${label}: ${msg}`);
    res.status(e?.status ?? 500).json({ error: msg, error_label: label, status: 'error' });
  }
}
