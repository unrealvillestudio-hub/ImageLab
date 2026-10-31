// 1.23.0 — LA CARA ANTES QUE EL PRODUCTO. Casos de la LÁMINA de carrusel, con una marca INVENTADA (otro rubro, otro
// idioma): la regla no depende de ninguna marca real. Los del overlay son los de `la_cara_manda_casos.mjs` (cajas medidas a
// mano sobre las piezas reales). Lo usan la captura del golden y el test.

export const TYPO = [{ role: 'titular', font_family: 'Fuente A' }, { role: 'cuerpo', font_family: 'Fuente B' }, { role: 'rotulo', font_family: 'Fuente C' }];
export const PAL = [
  { role: 'claro', hex: '#FAFAFA' }, { role: 'oscuro', hex: '#101010' }, { role: 'acento', hex: '#2F7A3D' },
  { role: 'trigo', hex: '#D9A441' }, { role: 'tierra', hex: '#3B2A1E' }, { role: 'arcilla', hex: '#5A4030' },
];
const LAYOUT = {
  layout: { anchor: 'bottom_left', margin_pct: 8, max_width_pct: 74, avoid_faces: { enabled: true, margin_pct: 2 } },
  typography: {
    headline: { role: 'titular', fit_steps: [{ max_chars: 42, size_pct: 8.8 }, { max_chars: 72, size_pct: 6.8 }] },
    subheadline: { role: 'cuerpo', fit_steps: [{ max_chars: 400, size_pct: 3 }] },
  },
  palette: { headline: 'claro', subheadline: 'claro', headline_emphasis: 'trigo' },
};
const CT = {
  palette: { keyword: 'trigo', progress_on: 'acento', progress_off: { role: 'claro', alpha: 0.2 }, counter: 'trigo', critical: 'trigo',
    light: 'trigo', muted: { role: 'claro', alpha: 0.5 }, surface: 'tierra', surface_closing: 'arcilla', figure: 'trigo' },
  carousel: {
    canvas: { width: 1000, height: 1250 }, margin_pct: 5, swipe: { text: 'Glisser' },
    typography: {
      headline: { role: 'titular', weight: 700, transform: 'none', line_height: 1, fit_steps: [{ max_chars: 40, size_pct: 10 }, { max_chars: 90, size_pct: 8 }] },
      body: { role: 'cuerpo', weight: 400, size_pct: 4 }, label: { role: 'rotulo', weight: 600, size_pct: 3 }, figure: { role: 'titular', weight: 700, size_pct: 25 },
    },
  },
};
export const LAMINA_TEXTO = { headline: 'La cosecha no espera a nadie, ni al clima', subheadline: 'Ni la lluvia ni el granizo.' };

/** Los tokens de la lámina con la política dada en `carousel` (fusionada sobre los de la marca inventada). */
export function laminaTokens(M, carousel) {
  return M.deepMergeTokens(M.deepMergeTokens({ layout: LAYOUT.layout, typography: LAYOUT.typography, palette: LAYOUT.palette }, CT), { carousel });
}
export function laminaChrome(M, tokens, text = LAMINA_TEXTO) {
  return M.resolveCarouselChrome({ tokens, typography: TYPO, palette: PAL,
    carousel: M.parseCarouselRequest({ index: 2, total: 5, role: 'body', eyebrow: 'Campo' }), text, logo: null });
}

// Las políticas de la lámina que se prueban. `fallback: []` es «sin último recurso»: ahí decide la regla nueva.
export const POLITICAS = {
  sin_recurso: { avoid_faces: { enabled: true, margin_pct: 2, fallback: [], column_pct: [60, 50] }, avoid_products: { enabled: true, margin_pct: 1 } },
  inset: { avoid_faces: { enabled: true, margin_pct: 2, fallback: ['inset'], column_pct: [60, 50] }, avoid_products: { enabled: true, margin_pct: 1 } },
  banda: { avoid_faces: { enabled: true, margin_pct: 2, fallback: ['band'], band: { alpha: 0.85 }, column_pct: [60, 50] }, avoid_products: { enabled: true, margin_pct: 1 } },
  sin_producto_en_la_politica: { avoid_faces: { enabled: true, margin_pct: 2, fallback: [], column_pct: [60, 50] } },
};

// Escenas de la lámina (0..1 del LIENZO). `cara_y_envase`: la persona de cintura arriba a la izquierda y los envases
// abajo a la derecha, como en la pieza del 27-oct; `cara_toda`: ninguna colocación libra la cara.
export const ESCENAS = {
  cara_y_envase: { faces: [{ x0: 0.37, y0: 0.19, x1: 0.52, y1: 0.45 }], products: [{ x0: 0.45, y0: 0.55, x1: 0.97, y1: 0.95 }] },
  cara_y_envase_arriba: { faces: [{ x0: 0.40, y0: 0.55, x1: 0.60, y1: 0.80 }], products: [{ x0: 0.05, y0: 0.05, x1: 0.95, y1: 0.40 }] },
  sin_producto: { faces: [{ x0: 0.37, y0: 0.19, x1: 0.52, y1: 0.45 }], products: [] },
  cara_toda: { faces: [{ x0: 0.03, y0: 0.03, x1: 0.97, y1: 0.97 }], products: [{ x0: 0.45, y0: 0.55, x1: 0.97, y1: 0.95 }] },
};

// ── Resúmenes que compara el golden ──────────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { composeOverlay, digestOverlay } from './la_cara_manda_digest.mjs';

const sha = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const area = (r, b) => {
  const w = Math.min(r.x1, b.x1) - Math.max(r.x0, b.x0), h = Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
};
const r2 = (n) => Math.round(n * 100) / 100;

/** El overlay de un caso medido: el resumen de `la_cara_manda`, qué se dijo (sólo el código de cada marcador), qué claves
 *  lleva el informe que va a `meta`, y cuánto de la cara y de los envases (cajas sin margen, % de su área) queda bajo la
 *  caja del texto. */
export function digestOverlayCara(M, c, globalTokens) {
  const { style, report } = composeOverlay(M, c, globalTokens);
  const t = M.overlayTextRect(style, c.w, c.h, null, style.layout.anchor);
  const px = (b) => ({ x0: b.x0 * c.w, y0: b.y0 * c.h, x1: b.x1 * c.w, y1: b.y1 * c.h });
  const sup = (b) => (b.x1 - b.x0) * c.w * (b.y1 - b.y0) * c.h;
  const prodSup = c.products.reduce((s, p) => s + sup(p), 0);
  return { ...digestOverlay(M, c, globalTokens),
    markers: style.markers.map((m) => m.split(':')[0]), report_keys: report ? Object.keys(report).sort() : null,
    face_covered_pct: r2((100 * area(t, px(c.face))) / sup(c.face)),
    product_covered_pct: prodSup ? r2((100 * c.products.reduce((s, p) => s + area(t, px(p)), 0)) / prodSup) : null };
}

/** La lámina: dónde va el bloque, con qué último recurso y tamaño, qué se dijo (sólo el código de cada aviso), la escena
 *  del ajuste en su sha256 y cuánto de la cara queda bajo el bloque (sin margen; 0 con 'inset'). */
export function digestLamina(M, politica, escena, textPlace) {
  const tok = laminaTokens(M, POLITICAS[politica]);
  const r = M.chooseCarouselPlacement({ chrome: laminaChrome(M, tok), faces: ESCENAS[escena].faces, products: ESCENAS[escena].products,
    avoid: M.resolveCarouselAvoid(tok), textPlace });
  const W = 1000, H = 1250;
  const rect = M.carouselBlockRect(r.fit.chrome, null).rect;
  const faceArea = r.report.fallback === 'inset' ? 0
    : ESCENAS[escena].faces.reduce((s, f) => s + area(rect, { x0: f.x0 * W, y0: f.y0 * H, x1: f.x1 * W, y1: f.y1 * H }), 0);
  return { placement: r.report.placement_used, column_pct: r.report.column_pct, fallback: r.report.fallback,
    headline_size_pct: r.report.headline_size_pct ?? null, warnings: r.warnings.map((w) => w.split(':')[0]),
    fit_sha256: sha(r.fit), face_area_px: r2(faceArea) };
}

/** Todas las combinaciones de lámina que fija el golden: política × escena × fila pedida. */
export const COMBOS_LAMINA = Object.keys(POLITICAS).flatMap((p) => Object.keys(ESCENAS).flatMap((e) =>
  [null, 'top', 'bottom'].map((tp) => ({ key: `${p}|${e}|${tp ?? 'auto'}`, politica: p, escena: e, textPlace: tp }))));
