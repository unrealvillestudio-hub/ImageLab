// 1.13.1 — el resumen de una composición del overlay que el golden de LA CARA MANDA compara: el camino del handler
// (tokens → estilo → límite de área → elección del ancla → palabra sola) con las cajas medidas a mano, sin métricas de
// fuente (el estimado, determinista) y la escena entera resumida en su sha256. Lo usan la captura y el test.
import { createHash } from 'node:crypto';
import { BRANDS } from './la_cara_manda_casos.mjs';

export function composeOverlay(M, c, globalTokens) {
  const br = BRANDS[c.brand];
  const rows = [
    { id: 'global', brand_id: null, canal: null, active: true, tokens: globalTokens },
    { id: 'marca', brand_id: c.brand, canal: null, active: true, tokens: br.tokens },
  ];
  const picked = M.pickOverlayTokens(rows, c.brand, null);
  const style = M.resolveOverlayStyle({ tokens: picked.tokens, typography: br.typography, palette: br.palette, text: c.text });
  const fit = M.fitOverlayTextArea({ style, width: c.w, height: c.h, metrics: null }).style;
  const ch = M.chooseOverlayAnchor({ style: fit, width: c.w, height: c.h, metrics: null,
    faces: [c.face], people: [c.person], products: c.products, signs: [] });
  const final = M.avoidOrphanLines ? M.avoidOrphanLines(ch.style, c.w, c.h, null).style : ch.style;
  const scene = M.buildOverlayScene({ style: final, width: c.w, height: c.h, backgroundSrc: 'data:,' });
  return { style: final, report: ch.report, scene };
}

export function digestOverlay(M, c, globalTokens) {
  const { style, scene } = composeOverlay(M, c, globalTokens);
  return {
    anchor: style.layout.anchor,
    max_width_pct: style.layout.maxWidthPct,
    headline_size_pct: style.slots.headline?.sizePct ?? null,
    subheadline: !!style.slots.subheadline,
    scene_sha256: createHash('sha256').update(JSON.stringify(scene)).digest('hex'),
  };
}
