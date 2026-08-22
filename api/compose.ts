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
 *   { brand_id, canal?, image_url? | image_data_url?, headline, subheadline?, piece_id? }
 *   → 200 { status:'ok', image_data_url, compositor_version, tokens_source, width, height,
 *           fonts:[…], markers:[…], text:{ headline, subheadline } }
 *   → 4xx/5xx { error, error_label, status:'error' }  ← `error_label` es lo que lee execLab.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

declare const process: { env: Record<string, string | undefined> };

// ── COMPOSITOR:BEGIN ── (BRIEF 7, 2026-08-22) bloque PURO: tokens → estilo → escena.
// Sin fetch, sin DB, sin estado, sin reloj. Lo ejecuta `tests/compositor_test.mjs` extrayéndolo por
// estos sentinelas: lo que se testea es la fuente que se deploya, no una copia.

// La versión viaja al eco de la pieza (`builder_meta.image.compositor_version`). Sube cuando cambia
// lo que el compositor DIBUJA — no cuando cambia un token de marca (eso es dato) ni un comentario.
export const COMPOSITOR_VERSION = '1.0.0';

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
const SLOTS = ['headline', 'subheadline'] as const;
type Slot = (typeof SLOTS)[number];

export interface OverlayText { headline: string; subheadline?: string | null }

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
  layout: { anchor: string; marginPct: number; maxWidthPct: number; gapPct: number; align: 'left' | 'center' | 'right' };
  slots: Record<Slot, null | {
    text: string; role: string; family: string; fallback: string | null; cssImport: string | null;
    fontUrl: string | null; weight: number; italic: boolean; transform: string;
    lineHeight: number; letterSpacingEm: number; sizePct: number; color: string;
  }>;
  scrim: null | { mode: string; color: string; opacity: number; coveragePct: number };
  rule: null | { color: string; widthPct: number; thicknessPx: number; gapPct: number };
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

    const fit = fitFontSizePct(steps, value);
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
    },
    slots,
    scrim,
    rule,
    markers,
  };
}

/**
 * La escena que come satori: un árbol JSON plano (`{type, props}`), sin JSX y sin dependencias.
 * Función PURA de (estilo, dimensiones, fondo) — misma entrada ⇒ mismo árbol, clave por clave.
 *
 * Las medidas: los tamaños de fuente y los márgenes se derivan del ANCHO (el ojo lee líneas, y el
 * ancho es lo que fija cuántos caracteres entran por línea); la cobertura del velo, del ALTO. Un
 * mismo token rinde igual en 1:1 que en 9:16 sin una tabla por formato.
 */
export function buildOverlayScene(args: {
  style: ReturnType<typeof resolveOverlayStyle>;
  width: number; height: number; backgroundSrc: string;
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

  const textChildren: Array<Record<string, any>> = [];
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
      },
      children: s.text,
    },
  });

  if (style.slots.headline) textChildren.push(slotNode(style.slots.headline, 0));
  if (style.rule) {
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

  children.push({
    type: 'div',
    props: {
      style: {
        position: 'absolute', top: 0, left: 0, width, height,
        display: 'flex', flexDirection: 'column',
        justifyContent: a.y, alignItems: a.x,
        padding: px(style.layout.marginPct, width),
      },
      children: [{
        type: 'div',
        props: {
          style: {
            display: 'flex', flexDirection: 'column',
            alignItems: a.x,
            maxWidth: px(style.layout.maxWidthPct, width),
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
async function loadFont(slot: Slot, s: {
  role: string; family: string; cssImport: string | null; fontUrl: string | null; weight: number; italic: boolean;
}): Promise<{ name: string; data: Uint8Array; weight: number; style: 'normal' | 'italic'; source: string }> {
  if (s.fontUrl) {
    return { name: s.family, data: await fetchBytes(s.fontUrl, 'COMPOSITOR_FONT_FETCH_FAILED'),
      weight: s.weight, style: s.italic ? 'italic' : 'normal', source: s.fontUrl };
  }
  if (!s.cssImport || !/^https?:\/\//i.test(s.cssImport)) {
    throw new CompositorError('COMPOSITOR_FONT_UNRESOLVED',
      `la ranura '${slot}' usa brand_typography.role='${s.role}' (${s.family}) y esa fila no trae un css_import ` +
      `descargable ('${s.cssImport ?? '∅'}'). Sembrá css_import (hoja css2) o typography.${slot}.font_url con un .ttf/.otf.`);
  }
  const css = new TextDecoder().decode(await fetchBytes(s.cssImport, 'COMPOSITOR_FONT_CSS_FAILED'));
  const face = pickFontFace(parseFontFaces(css), { weight: s.weight, italic: s.italic });
  if (!face) {
    throw new CompositorError('COMPOSITOR_FONT_UNRESOLVED',
      `css_import de '${s.role}' (${s.family}) no declara ningún @font-face descargable: ${s.cssImport}`);
  }
  return { name: s.family, data: await fetchBytes(face.url, 'COMPOSITOR_FONT_FETCH_FAILED'),
    weight: face.weight, style: face.italic ? 'italic' : 'normal', source: face.url };
}

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
    if (!headline.trim()) {
      throw new CompositorError('COMPOSITOR_TEXT_MISSING',
        'headline vacío. El compositor NO escribe texto: compone el que le llega, que sale del copy ya juzgado (BRIEF 7, regla a).', 400);
    }
    if (!body.image_data_url && !body.image_url) {
      throw new CompositorError('COMPOSITOR_IMAGE_MISSING', 'falta image_data_url o image_url (la imagen limpia a componer)', 400);
    }

    // Las tres capas de dato, en paralelo. Cada una fail-loud por su cuenta.
    const [tokenRows, typography, palette] = await Promise.all([
      sbSelect(`imagelab_overlay_tokens?or=(brand_id.eq.${encodeURIComponent(brandId)},brand_id.is.null)&select=id,brand_id,canal,tokens,active`),
      sbSelect(`brand_typography?brand_id=eq.${encodeURIComponent(brandId)}&select=role,font_family,css_import,fallback`),
      sbSelect(`brand_palette?brand_id=eq.${encodeURIComponent(brandId)}&select=role,hex`),
    ]);

    const picked = pickOverlayTokens(tokenRows as any[], brandId, canal);
    const style = resolveOverlayStyle({ tokens: picked.tokens, typography: typography as any[], palette: palette as any[], text: { headline, subheadline } });

    const cleanBytes = body.image_data_url
      ? dataUrlToBytes(String(body.image_data_url))
      : await fetchBytes(String(body.image_url), 'COMPOSITOR_IMAGE_FETCH_FAILED');
    const dims = imageDimensions(cleanBytes);

    const fonts = await Promise.all(
      SLOTS.filter((s) => style.slots[s]).map(async (s) => ({ slot: s, ...(await loadFont(s, style.slots[s]!)) })),
    );

    const scene = buildOverlayScene({
      style, width: dims.width, height: dims.height,
      backgroundSrc: `data:${dims.mime};base64,${b64(cleanBytes)}`,
    });

    const svg = await satori(scene as any, {
      width: dims.width, height: dims.height,
      fonts: fonts.map((f) => ({ name: f.name, data: Buffer.from(f.data), weight: f.weight as any, style: f.style })),
    });
    const png = new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();

    console.log(
      `[Compositor][BRIEF7] brand=${brandId} canal=${canal ?? '∅'} piece=${body.piece_id ?? '∅'} ` +
      `tokens=${picked.source} (capas: ${picked.layers.join(' < ')}) ${dims.width}x${dims.height} ` +
      `fuentes=${fonts.map((f) => `${f.slot}:${f.name}@${f.weight}`).join(', ')} ` +
      `markers=${style.markers.length} ${Date.now() - t0}ms`,
    );

    res.status(200).json({
      status: 'ok',
      image_data_url: `data:image/png;base64,${b64(new Uint8Array(png))}`,
      compositor_version: COMPOSITOR_VERSION,
      tokens_source: picked.source,
      tokens_layers: picked.layers,
      width: dims.width, height: dims.height,
      fonts: fonts.map((f) => ({ slot: f.slot, family: f.name, weight: f.weight, source: f.source })),
      markers: style.markers,
      // Eco VERBATIM de lo compuesto: el carril lo asienta y así queda cruzable contra el copy juzgado.
      text: { headline, subheadline },
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
