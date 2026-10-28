// EL TAMAÑO DEL TEXTO Y LA BAJADA LOS PIDE UNA PERSONA (compositor 1.19.0, 2026-10-28).
//
// Sam (2026-10-28), pieza 23698205 compuesta con 1.18.0: «se pierde el texto de la bajada, ni refrescando entra», y un
// control que agrande o achique el texto compuesto sobre la imagen, «un toque mínimo y personal». Medido ese día: el
// límite de área bajó el titular a su escalón mínimo y la escalera de caras quitó la bajada (`… sin bajada`).
//
// LO QUE FIJA ESTE TEST:
//   1. Contrato: `text_scale` = número de TEXT_SCALE_MIN a TEXT_SCALE_MAX o nada; `keep_subheadline` = booleano o nada.
//      Otro valor es 400 con etiqueta.
//   2. Golden: sin los campos, el estilo y el cromo son EL MISMO objeto y los ajustes salen idénticos.
//   3. La escala multiplica el titular y la bajada, y sus escalones más chicos, en la misma proporción (el resaltado
//      sigue a su ranura); en la lámina, el titular y el cuerpo, no la cifra ni el rótulo.
//   4. El límite de área rige después de escalar: si recorta un tamaño agrandado, se dice (`…_TEXT_SCALE_CAPPED`); si
//      ni el escalón más chico escalado cabe, se mide sin la escala y gana la que ocupa menos.
//   5. `keep_subheadline`: ninguna escalera (caras, área, alto) quita la bajada; si tapa, se compone igual y se dice
//      (`OVERLAY_SUB_KEPT`), también en el caso medido (la cara abajo a la izquierda, la figura ocupando la foto).
//   6. Cableado (los campos se validan con el resto del contrato, entran en el límite de área y vuelven en `meta`),
//      versión, marca N+1 y voseo.
//
// Ejecutar:  node tests/escala_del_texto_test.mjs     (Node ≥ 22.18)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { formasVoseantes } from './idioma_voseo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'compose.ts'), 'utf8');
const BEGIN = '// ── COMPOSITOR:BEGIN ──', END = '// ── COMPOSITOR:END ──';
const dir = mkdtempSync(join(tmpdir(), 'escala-texto-'));
const mod = join(dir, 'block.mts');
writeFileSync(mod, SRC.slice(SRC.indexOf(BEGIN), SRC.indexOf(END) + END.length) + '\n', 'utf8');
const M = await import(pathToFileURL(mod).href);

let pass = 0; const fails = [];
const test = (n, f) => { try { f(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fails.push(n); console.log(`  ✗ ${n}\n    ${e.message}`); } };

// ── Marca INVENTADA (otro rubro, otro idioma): el eje no depende de ninguna marca real ──
const TYPO = [{ role: 'titular', font_family: 'Fuente A' }, { role: 'cuerpo', font_family: 'Fuente B' }, { role: 'rotulo', font_family: 'Fuente C' }];
const PAL = [
  { role: 'claro', hex: '#FAFAFA' }, { role: 'oscuro', hex: '#101010' }, { role: 'acento', hex: '#2F7A3D' },
  { role: 'trigo', hex: '#D9A441' }, { role: 'tierra', hex: '#3B2A1E' }, { role: 'arcilla', hex: '#5A4030' },
];
const tokens = (layout = {}) => ({
  layout: { anchor: 'bottom_left', margin_pct: 7, max_width_pct: 76, gap_pct: 2, ...layout },
  typography: {
    headline: { role: 'titular', weight: 700, fit_steps: [{ max_chars: 30, size_pct: 9 }, { max_chars: 80, size_pct: 7 }, { max_chars: 400, size_pct: 5 }],
      emphasis: { role: 'titular', weight: 400, italic: true, size_scale: 1.1 } },
    subheadline: { role: 'cuerpo', fit_steps: [{ max_chars: 60, size_pct: 3.4 }, { max_chars: 400, size_pct: 2.8 }] },
  },
  palette: { headline: 'claro', subheadline: 'claro', headline_emphasis: 'trigo' },
});
const TEXT = { headline: 'La cosecha del año no espera a nadie en el valle', subheadline: 'Ni el clima ni la lluvia esperan.', emphasis: ['no espera'] };
const style = (layout) => M.resolveOverlayStyle({ tokens: tokens(layout), typography: TYPO, palette: PAL, text: TEXT });
const W = 1080, H = 1350;
const area = (st, extra = {}) => M.fitOverlayTextArea({ style: st, width: W, height: H, metrics: null, ...extra });
/** El estilo con el titular a un tamaño dado y sin bajada: para ubicar una caja justo debajo de ese bloque. */
const soloTitular = (st, sizePct) => ({ ...st, slots: { headline: { ...st.slots.headline, sizePct }, subheadline: null } });

console.log('\n── 1 · contrato ──');
test('1a · text_scale: número de 0,7 a 1,3 (ambos incluidos) o nada; otro valor es 400 con etiqueta', () => {
  assert.equal(M.TEXT_SCALE_MIN, 0.7); assert.equal(M.TEXT_SCALE_MAX, 1.3);
  for (const v of [undefined, null]) assert.equal(M.parseTextScaleRequest(v), null);
  for (const v of [0.7, 0.85, 1, 1.15, 1.3]) assert.equal(M.parseTextScaleRequest(v), v);
  for (const v of ['', '1.2', 0.69, 1.31, 0, -1, 2, NaN, Infinity, true, [], {}]) {
    assert.throws(() => M.parseTextScaleRequest(v), (e) => e.label === 'COMPOSITOR_TEXT_SCALE_INVALID' && e.status === 400, String(v));
  }
});
test('1b · keep_subheadline: true | false o nada; otro valor es 400 con etiqueta', () => {
  for (const v of [undefined, null]) assert.equal(M.parseKeepSubheadlineRequest(v), false);
  assert.equal(M.parseKeepSubheadlineRequest(true), true); assert.equal(M.parseKeepSubheadlineRequest(false), false);
  for (const v of ['true', 1, 0, '', {}, []]) {
    assert.throws(() => M.parseKeepSubheadlineRequest(v), (e) => e.label === 'COMPOSITOR_KEEP_SUBHEADLINE_INVALID' && e.status === 400, JSON.stringify(v));
  }
});

console.log('\n── 2 · golden ──');
test('2a · sin escala (o con 1) y sin pedido de bajada, EL MISMO estilo', () => {
  const s = style({ max_text_area_pct: 20 });
  assert.equal(M.applyTextScale(s, null), s); assert.equal(M.applyTextScale(s, 1), s);
  assert.equal(M.applyKeepSubheadline(s, false), s);
  const sinBajada = M.resolveOverlayStyle({ tokens: tokens(), typography: TYPO, palette: PAL, text: { headline: TEXT.headline } });
  assert.equal(M.applyKeepSubheadline(sinBajada, true), sinBajada, 'sin bajada no hay nada que conservar');
});
test('2b · el límite de área sin los campos es el de 1.18.0, clave por clave', () => {
  for (const lim of [undefined, 20, 8]) {
    const s = style(lim ? { max_text_area_pct: lim } : {});
    const a = area(s);
    assert.deepEqual(area(s, { textScale: null, keepSubheadline: false }), a);
    assert.deepEqual(area(s, { textScale: 1 }), a);
    if (!lim) assert.equal(a.style, s, 'sin límite, EL MISMO estilo');
  }
});

console.log('\n── 3 · la escala ──');
test('3a · multiplica el titular y la bajada, y sus escalones más chicos, en la misma proporción; la entrada no se muta', () => {
  const s = style();
  const before = JSON.stringify(s);
  const up = M.applyTextScale(s, 1.2);
  assert.equal(s.slots.headline.sizePct, 7); assert.deepEqual(s.slots.headline.fitSmaller, [5]);
  assert.equal(up.slots.headline.sizePct, 8.4); assert.deepEqual(up.slots.headline.fitSmaller, [6]);
  assert.equal(up.slots.subheadline.sizePct, 4.08); assert.deepEqual(up.slots.subheadline.fitSmaller, [3.36]);
  const down = M.applyTextScale(s, 0.7);
  assert.equal(down.slots.headline.sizePct, 4.9); assert.deepEqual(down.slots.headline.fitSmaller, [3.5]);
  assert.equal(down.slots.subheadline.sizePct, 2.38);
  assert.equal(JSON.stringify(s), before);
  assert.equal(M.scaledSizePct(8.4, 1.3), 10.92);
});
test('3b · el resaltado sigue a su ranura en la escena (su tamaño es relativo al del titular)', () => {
  const sizeOf = (st, t) => {
    const scene = M.buildOverlayScene({ style: st, width: W, height: H, backgroundSrc: 'data:,' });
    const found = [];
    const walk = (n) => { if (!n || typeof n !== 'object') return; if (n.type === 'span' && String(n.props?.children ?? '').startsWith(t)) found.push(n); for (const c of [].concat(n.props?.children ?? [])) walk(c); };
    walk(scene);
    return found[0]?.props.style.fontSize;
  };
  const s = style();
  const k = sizeOf(M.applyTextScale(s, 1.2), 'espera') / sizeOf(s, 'espera');
  assert.ok(Math.abs(k - 1.2) < 0.01, `el resaltado escala ×${k}`);
});
test('3c · lámina: el titular (tamaño, escalones y resaltado) y el cuerpo; la cifra y el rótulo no cambian', () => {
  const c = chrome({ index: 1, total: 5, role: 'cover' });
  assert.equal(M.applyCarouselTextScale(c, null), c); assert.equal(M.applyCarouselTextScale(c, 1), c);
  const up = M.applyCarouselTextScale(c, 1.2);
  assert.equal(up.type.headline.sizePct, M.scaledSizePct(c.type.headline.sizePct, 1.2));
  assert.equal(up.type.body.sizePct, M.scaledSizePct(c.type.body.sizePct, 1.2));
  assert.deepEqual(up.fitLadder.headline, c.fitLadder.headline.map((v) => M.scaledSizePct(v, 1.2)));
  assert.equal(up.type.figure, c.type.figure); assert.equal(up.type.label, c.type.label);
  const cc = M.fitCarouselCoverArea({ chrome: c, metrics: null });
  assert.deepEqual(M.fitCarouselCoverArea({ chrome: c, metrics: null, textScale: null }), cc);
  assert.deepEqual(M.fitCarouselCoverArea({ chrome: c, metrics: null, textScale: 1 }), cc);
});
test('3d · la escala que quedó: el titular final sobre el de base, a dos decimales', () => {
  assert.equal(M.textScaleApplied(7, 8.4), 1.2);
  assert.equal(M.textScaleApplied(8.4, 5.2), 0.62);
  assert.equal(M.textScaleApplied(null, 5), null); assert.equal(M.textScaleApplied(7, undefined), null);
});

console.log('\n── 4 · el límite de área rige después ──');
test('4a · el aviso del recorte: sólo al agrandar y sólo si el límite recortó el tamaño pedido', () => {
  assert.equal(M.textScaleCappedMarker('OVERLAY', null, 7, 5), null);
  assert.equal(M.textScaleCappedMarker('OVERLAY', 0.8, 7, 5), null);
  assert.equal(M.textScaleCappedMarker('OVERLAY', 1.2, 7, 8.4), null);
  assert.equal(M.textScaleCappedMarker('OVERLAY', 1.2, 7, 6), 'OVERLAY_TEXT_SCALE_CAPPED: se pidió 120 %, la regla del área dejó 86 %');
  assert.equal(M.textScaleCappedMarker('CAROUSEL', 1.3, 10, 8), 'CAROUSEL_TEXT_SCALE_CAPPED: se pidió 130 %, la regla del área dejó 80 %');
});
// El límite que deja pasar el titular de base y no el agrandado: se busca, no se supone (sin métricas, el área se estima).
const sNoLimit = style();
const baseArea = M.measureOverlayText(sNoLimit, W, H, null).areaPct;
test('4b · agrandado por encima del límite: baja por los escalones escalados y se dice', () => {
  const lim = Math.ceil(baseArea) + 1;
  const s = style({ max_text_area_pct: lim });
  assert.equal(area(s).report.adjusted, false, `sin escala cabe (${baseArea} % ≤ ${lim} %)`);
  const r = area(s, { textScale: 1.3 });
  assert.equal(r.report.adjusted, true);
  assert.ok(r.style.slots.headline.sizePct < M.scaledSizePct(7, 1.3));
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_AREA_REDUCED: ')), r.style.markers.join(' | '));
  const cap = r.style.markers.find((m) => m.startsWith('OVERLAY_TEXT_SCALE_CAPPED'));
  assert.equal(cap, `OVERLAY_TEXT_SCALE_CAPPED: se pidió 130 %, la regla del área dejó ${Math.round(M.textScaleApplied(7, r.style.slots.headline.sizePct) * 100)} %`);
  assert.ok(r.report.area_pct <= lim);
});
test('4c · si ni el escalón más chico escalado cabe, se mide sin la escala y gana la que ocupa menos', () => {
  // Un límite que sólo deja pasar los escalones de la marca, no los escalados ×1,3.
  const lim = Math.ceil(M.measureOverlayText(soloTitular(sNoLimit, 5), W, H, null).areaPct * 100) / 100 + 0.01;
  const s = style({ max_text_area_pct: lim });
  const sinEscala = area(s);
  assert.equal(sinEscala.report.exceeded, false, 'sin escala, el escalón de la marca cabe');
  const solo = area(M.applyTextScale(s, 1.3));
  assert.equal(solo.report.exceeded, true, 'con la escala, ni el escalón más chico cabe');
  const r = area(s, { textScale: 1.3 });
  assert.equal(r.report.exceeded, false);
  assert.equal(r.style.slots.headline.sizePct, sinEscala.style.slots.headline.sizePct);
  assert.deepEqual(r.report, sinEscala.report);
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_SCALE_CAPPED: se pidió 130 %')));
  // Al achicar no hay segunda medida: el escalado ya ocupa menos.
  assert.equal(area(s, { textScale: 0.7 }).style.slots.headline.sizePct <= M.scaledSizePct(7, 0.7), true);
});
test('4d · lámina: el límite de la portada rige después de escalar, con la misma segunda medida', () => {
  const c = chrome({ index: 1, total: 5, role: 'cover' });
  const lim = Math.ceil(M.carouselTextArea(c, null).areaPct) + 1;
  const cl = chrome({ index: 1, total: 5, role: 'cover' }, { layout: { max_text_area_pct: lim } });
  assert.equal(M.fitCarouselCoverArea({ chrome: cl, metrics: null }).warnings.length, 0, 'sin escala cabe');
  const r = M.fitCarouselCoverArea({ chrome: cl, metrics: null, textScale: 1.3 });
  assert.ok(r.chrome.type.headline.sizePct < M.scaledSizePct(cl.type.headline.sizePct, 1.3));
  assert.ok(r.warnings.some((w) => w.startsWith('CAROUSEL_TEXT_SCALE_CAPPED: se pidió 130 %')), r.warnings.join(' | '));
  assert.equal(r.report.exceeded, false);
  // Una lámina que no es portada no tiene límite: la escala entra entera.
  const b = chrome({ index: 2, total: 5, role: 'body', eyebrow: 'Campo' }, { layout: { max_text_area_pct: lim } });
  const rb = M.fitCarouselCoverArea({ chrome: b, metrics: null, textScale: 1.3 });
  assert.equal(rb.chrome.type.headline.sizePct, M.scaledSizePct(b.type.headline.sizePct, 1.3));
  assert.deepEqual(rb.warnings, []);
});

console.log('\n── 5 · la bajada la pidió una persona ──');
test('5a · área: sin el pedido, el último escalón quita la bajada; con él, se queda y se dice que excede', () => {
  const lim = Math.ceil(M.measureOverlayText(soloTitular(sNoLimit, 5), W, H, null).areaPct * 100) / 100 + 0.01;
  const s = style({ max_text_area_pct: lim });
  const hoy = area(s);
  assert.equal(hoy.report.dropped_subheadline, true); assert.equal(hoy.style.slots.subheadline, null);
  assert.ok(hoy.style.markers.some((m) => m.includes('sin bajada')));
  const r = area(s, { keepSubheadline: true });
  assert.equal(r.report.dropped_subheadline, false); assert.equal(r.report.exceeded, true);
  assert.ok(r.style.slots.subheadline, 'la bajada se queda');
  assert.equal(r.style.slots.subheadline.sizePct, 2.8, 'achicada por su escalera');
  assert.equal(r.style.keepSubheadline, true, 'el pedido viaja en el estilo para las escaleras que siguen');
  assert.ok(!r.style.markers.some((m) => m.includes('sin bajada')));
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_AREA_EXCEEDED')));
});
test('5b · alto: en un lienzo apaisado la escalera tampoco quita la bajada pedida', () => {
  const LONG = { headline: 'La cosecha del año no espera a nadie en el valle ni en la ladera ni en la orilla del río grande', subheadline: 'Ni el clima ni la lluvia esperan, y la cuadrilla tampoco espera a que se seque el campo.' };
  const s = M.resolveOverlayStyle({ tokens: tokens(), typography: TYPO, palette: PAL, text: LONG });
  const hoy = M.fitOverlayTextHeight({ style: s, width: 1920, height: 400, metrics: null });
  assert.equal(hoy.report.dropped_subheadline, true, 'sin el pedido, la quita');
  const r = M.fitOverlayTextHeight({ style: M.applyKeepSubheadline(s, true), width: 1920, height: 400, metrics: null });
  assert.equal(r.report.dropped_subheadline, false); assert.ok(r.style.slots.subheadline);
});
test('5c · cara bajo el titular: sin el pedido se quita la bajada; con él se achica, tapa lo menos posible y se dice', () => {
  const s = style({ anchor: 'top_left', avoid_faces: { enabled: true, anchors: ['top_left'], margin_pct: 0 } });
  // La cara queda justo debajo del titular en su escalón más chico: sólo sin bajada el bloque la libra.
  const tit = M.overlayTextRect(soloTitular(s, 5), W, H, null, 'top_left');
  const cara = { x0: 0.05, y0: (tit.y1 + 4) / H, x1: 0.6, y1: (tit.y1 + 160) / H };
  const hoy = M.chooseOverlayAnchor({ style: s, width: W, height: H, faces: [cara] });
  assert.equal(hoy.report.overlap_pct, 0); assert.deepEqual(hoy.report.reduced, ['titular 7→5 %', 'sin bajada']);
  assert.equal(hoy.style.slots.subheadline, null);
  const k = M.chooseOverlayAnchor({ style: M.applyKeepSubheadline(s, true), width: W, height: H, faces: [cara] });
  assert.ok(k.style.slots.subheadline, 'la bajada se queda');
  assert.ok(k.report.overlap_pct > 0);
  assert.ok(k.report.overlap_pct < k.report.candidates[0].overlap_pct, 'achicar la bajada tapa menos');
  // «Lo menos posible» es la medida de siempre (el % de la caja del texto que cae sobre la cara), entre todos los
  // escalones que quedan: ninguno es «sin bajada».
  assert.equal(k.report.reduced[0], 'titular 7→5 %'); assert.ok(!k.report.reduced.includes('sin bajada'));
  assert.ok(k.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_REDUCED_FOR_FACE: para que el texto quepa en top_left tapando lo menos posible: titular 7→5 %')), k.style.markers.join(' | '));
  assert.ok(k.style.markers.some((m) => m.startsWith('OVERLAY_FACE_OVERLAP_UNAVOIDABLE')));
  assert.ok(k.style.markers.includes(`OVERLAY_SUB_KEPT: la bajada la escribió una persona; se compone aunque tape ${k.report.overlap_pct} %`));
});
test('5d · el caso medido: cara abajo a la izquierda, la figura ocupa la foto; la bajada se queda donde libra la cara', () => {
  const pol = { avoid_faces: { enabled: true, margin_pct: 0 }, avoid_people: { enabled: true, margin_pct: 0 } };
  const s = style(pol);
  const titArriba = M.overlayTextRect(soloTitular(s, 5), W, H, null, 'top_left');
  const figura = { x0: 0, y0: (titArriba.y1 + 6) / H, x1: 1, y1: 1 };
  const cara = { x0: 0.06, y0: 0.62, x1: 0.36, y1: 0.86 };
  const hoy = M.chooseOverlayAnchor({ style: s, width: W, height: H, faces: [cara], people: [figura] });
  assert.equal(hoy.style.slots.subheadline, null, 'sin el pedido: «sin bajada», como en la pieza medida');
  assert.ok(hoy.style.markers.some((m) => /^OVERLAY_TEXT_REDUCED_FOR_FACE: para que el texto quepa en top_left sin tapar una cara o una persona: titular 7→5 % · sin bajada$/.test(m)), hoy.style.markers.join(' | '));
  const k = M.chooseOverlayAnchor({ style: M.applyKeepSubheadline(s, true), width: W, height: H, faces: [cara], people: [figura] });
  assert.ok(k.style.slots.subheadline, 'la bajada se queda');
  assert.equal(k.report.overlap_pct, 0, 'la cara sigue libre: la cara manda');
  assert.ok(k.report.body_overlap_pct > 0);
  assert.ok(k.style.markers.some((m) => m.startsWith('OVERLAY_BODY_UNAVOIDABLE')));
  assert.ok(k.style.markers.includes(`OVERLAY_SUB_KEPT: la bajada la escribió una persona; se compone aunque tape ${k.report.body_overlap_pct} %`), k.style.markers.join(' | '));
});
test('5e · con el pedido y nada que tapar, ningún aviso nuevo', () => {
  const s = M.applyKeepSubheadline(style({ avoid_faces: { enabled: true } }), true);
  const ch = M.chooseOverlayAnchor({ style: s, width: W, height: H, faces: [] });
  assert.ok(!ch.style.markers.some((m) => m.startsWith('OVERLAY_SUB_KEPT')));
});

console.log('\n── 6 · cableado y marca N+1 ──');
test('6a · el handler valida los campos con el resto del contrato y los pasa al límite de área (overlay y lámina)', () => {
  assert.match(SRC, /const textScaleIn = parseTextScaleRequest\(body\.text_scale\);/);
  assert.match(SRC, /const keepSubIn = parseKeepSubheadlineRequest\(body\.keep_subheadline\);/);
  assert.ok(SRC.indexOf('const textScaleIn = parseTextScaleRequest') < SRC.indexOf('const [tokenRows, typography, palette] = await Promise.all(['), 'antes de leer dato');
  assert.match(SRC, /const areaFit = fitOverlayTextArea\(\{ style: oStyle, width: dims\.width, height: dims\.height, metrics: areaMetrics,\n\s*\.\.\.\(textScaleIn != null \? \{ textScale: textScaleIn \} : \{\}\), \.\.\.\(keepSubIn \? \{ keepSubheadline: true \} : \{\}\) \}\);/);
  assert.match(SRC, /const area = fitCarouselCoverArea\(\{ chrome: withItalicFallback\(chrome, italicLoad\.fallback\), metrics, \.\.\.\(textScaleIn != null \? \{ textScale: textScaleIn \} : \{\}\) \}\);/);
});
test('6b · meta.text_scale { requested, applied } vuelve siempre que el campo llega, en el overlay y en la lámina', () => {
  assert.match(SRC, /const textScaleArrived = body\.text_scale !== undefined;/);
  assert.match(SRC, /\.\.\.\(textScaleArrived \? \{ text_scale: \{ requested: textScaleIn, applied: textScaleApplied\(baseHeadlinePct, finalStyle\.slots\.headline\?\.sizePct\) \} \} : \{\}\),/);
  assert.match(SRC, /\.\.\.\(textScaleArrived \? \{ text_scale: \{ requested: textScaleIn,\n\s*applied: chrome\.headline\.length \? textScaleApplied\(chrome\.type\.headline\?\.sizePct, fit\.chrome\.type\.headline\?\.sizePct\) : null \} \} : \{\}\),/);
});
test('6c · la versión sube a 1.19.0 (o después) y la historia lo cuenta', () => {
  assert.match(SRC, /COMPOSITOR_VERSION = '1\.(19|20)\.0'/);
  assert.ok(SRC.includes('//   1.19.0 (2026-10-28) — EL TAMAÑO DEL TEXTO Y LA BAJADA LOS PIDE UNA PERSONA'));
});
test('6d · el bloque nuevo no nombra marcas, ciudades ni familias, y nadie vosea', () => {
  const ini = SRC.indexOf('// ── 1.19.0 · EL TAMAÑO DEL TEXTO Y LA BAJADA');
  const blk = SRC.slice(ini, SRC.indexOf('/**\n * 1.6.3 — ¿Se lee el énfasis?', ini));
  assert.ok(blk.length > 2000);
  const hist = SRC.slice(SRC.indexOf('//   1.19.0 (2026-10-28)'), SRC.indexOf("export const COMPOSITOR_VERSION = '"));
  for (const t of [blk, hist]) {
    assert.ok(!/neurone|forum|unrealville|lucien|panam|miami|madrid|garamond|bebas|baskerville|playfair|inter\b/i.test(t));
  }
  assert.deepEqual(formasVoseantes(blk + hist), []);
  assert.deepEqual(formasVoseantes(readFileSync(fileURLToPath(import.meta.url), 'utf8')), []);
});

// ── la lámina (al final: sólo la usan 3c y 4d) ──
function chrome(slide, over = {}) {
  const t = M.deepMergeTokens(M.deepMergeTokens(tokens(), {
    palette: {
      keyword: 'trigo', progress_on: 'acento', progress_off: { role: 'claro', alpha: 0.2 }, counter: 'trigo', critical: 'trigo',
      light: 'trigo', muted: { role: 'claro', alpha: 0.5 }, surface: 'tierra', surface_closing: 'arcilla', figure: 'trigo',
    },
    carousel: {
      canvas: { width: 1000, height: 1250 }, margin_pct: 5,
      typography: {
        headline: { role: 'titular', weight: 700, transform: 'none', line_height: 1, fit_steps: [{ max_chars: 40, size_pct: 10 }, { max_chars: 90, size_pct: 8 }],
          emphasis: { role: 'titular', weight: 400, italic: true, size_scale: 1.1 } },
        body: { role: 'cuerpo', weight: 400, size_pct: 4 },
        label: { role: 'rotulo', weight: 600, size_pct: 3, letter_spacing_em: 0.1, transform: 'uppercase' },
        figure: { role: 'titular', weight: 700, size_pct: 25, line_height: 0.9 },
      },
      swipe: { text: 'Glisser' },
      logo: { size_pct: 5, height_pct: 6 },
    },
  }), over);
  return M.resolveCarouselChrome({ tokens: t, typography: TYPO, palette: PAL, carousel: M.parseCarouselRequest(slide),
    text: { headline: 'El trigo no espera', subheadline: 'Ni el clima ni la lluvia esperan.', emphasis: ['no espera'] } });
}

console.log(`\n${fails.length ? '✗' : '✓'} ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
