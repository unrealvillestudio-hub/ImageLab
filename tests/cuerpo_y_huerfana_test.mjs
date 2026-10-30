// 1.13.0 — EL TEXTO NO TAPA EL CUERPO DE LA PERSONA, Y NINGUNA PALABRA QUEDA SOLA EN SU LÍNEA. Test del bloque PURO y
// del cableado.
//
// EL CASO (Sam, 2026-10-22): «recomponer para que no tape el objetivo o el producto», y de una marca de autor: «también
// le veo muchos problemas». Medido ese día con 1.12.0 en tres piezas: la cara libre, pero el bloque sobre el torso y las
// piernas de la figura de pie (b95fd1c9, d9e97f57) y sobre el brazo (733c033a). Y en d9e97f57, «…It told» / «her» /
// «she was right.»: una palabra sola justo antes del énfasis.
//
// QUÉ AFIRMA.
//   1. GOLDEN: sin `avoid_people`, la elección del overlay y de la lámina es EXACTAMENTE la de 1.12.0, aunque lleguen
//      figuras detectadas. Sin palabra sola (o sin métricas), el estilo y la escena son los mismos objetos.
//   2. Contrato de dato: `layout.avoid_people` / `carousel.avoid_people` mal escritos fallan nombrando; exigen
//      `avoid_faces`; la lámina no admite último recurso propio.
//   3. Overlay con figura: de pie al centro-derecha y al centro ⇒ el bloque se estrecha al lado libre; cuerpo a la
//      izquierda con anclas de la izquierda ⇒ (1.13.1) la colocación de 1.12.0, que libra la cara, sin banda; con anclas
//      de la derecha declaradas ⇒ se estrecha a la derecha; por debajo del mínimo no se estrecha; la zona segura manda;
//      la fila pedida (`text_place`) manda y, si tapa, se dice sin banda.
//   4. Lámina con figura: columna estrechada al lado libre; si no cabe, (1.13.1) la colocación de 1.12.0: el cuerpo no
//      dispara el último recurso de 1.11.0.
//   1.13.1 — la banda del overlay se retiró y el cuerpo sólo desempata entre colocaciones que libran la cara: 2a, 3c, 3d,
//   3g, 4c y 6c se ajustaron a eso. El detalle y los casos medidos están en `la_cara_manda_test.mjs`.
//   5. La palabra sola: los dos textos medidos, una viuda al final sin énfasis, la bajada, la lámina; sin métricas,
//      nada cambia; el número de líneas no cambia.
//   6. Cableado: la MISMA detección (figuras sólo con el token), el corte va después de la elección y viaja en `meta`.
//   7. Marca N+1: el bloque nuevo no nombra marcas ni ciudades; una marca inventada compone con el mismo código.
//
// Ejecutar:  node tests/cuerpo_y_huerfana_test.mjs     (Node ≥ 22.18)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'compose.ts'), 'utf8');
const BEGIN = '// ── COMPOSITOR:BEGIN ──', END = '// ── COMPOSITOR:END ──';
const dir = mkdtempSync(join(tmpdir(), 'cuerpo-huerfana-'));
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
const tokens = (layout = {}, extra = {}) => ({
  layout: { anchor: 'bottom_left', margin_pct: 8, max_width_pct: 74, avoid_faces: { enabled: true, margin_pct: 2 }, ...layout },
  typography: {
    headline: { role: 'titular', fit_steps: [{ max_chars: 42, size_pct: 8.8 }, { max_chars: 72, size_pct: 6.8 }, { max_chars: 110, size_pct: 5.4 }],
      emphasis: { weight: 600, size_scale: 1.2 } },
    subheadline: { role: 'cuerpo', fit_steps: [{ max_chars: 400, size_pct: 3 }] },
  },
  palette: { headline: 'claro', subheadline: 'claro', headline_emphasis: 'trigo' },
  ...extra,
});
const PEOPLE = { enabled: true, margin_pct: 1, min_width_pct: 28 };
const BAND = { enabled: true, margin_pct: 1, min_width_pct: 28, fallback: 'band', band: { color: 'oscuro', alpha: 0.55, pad_pct: 2 } };
const style = (layout, text = { headline: 'La cosecha no espera a nadie' }, extra) =>
  M.resolveOverlayStyle({ tokens: tokens(layout, extra), typography: TYPO, palette: PAL, text });
const W = 1024, H = 1024;
// Las figuras medidas a mano sobre las imágenes limpias del 2026-10-22 (0..1).
const DE_PIE_DERECHA = { face: { x0: 0.58, y0: 0.10, x1: 0.645, y1: 0.19 }, body: { x0: 0.52, y0: 0.055, x1: 0.79, y1: 0.945 } };   // como b95fd1c9
const DE_PIE_CENTRO = { face: { x0: 0.505, y0: 0.10, x1: 0.59, y1: 0.195 }, body: { x0: 0.395, y0: 0.055, x1: 0.715, y1: 1 } };   // como d9e97f57
const CUERPO_IZQUIERDA = { face: { x0: 0.22, y0: 0.10, x1: 0.32, y1: 0.20 }, body: { x0: 0.12, y0: 0.06, x1: 0.46, y1: 1 } };
const px = (b) => ({ x0: b.x0 * W, y0: b.y0 * H, x1: b.x1 * W, y1: b.y1 * H });
const cruza = (r, b) => Math.min(r.x1, b.x1) > Math.max(r.x0, b.x0) && Math.min(r.y1, b.y1) > Math.max(r.y0, b.y0);
const rectOf = (st) => M.overlayTextRect(st, W, H, null, st.layout.anchor);
const choose = (st, fig, extra = {}) => M.chooseOverlayAnchor({ style: st, width: W, height: H, faces: [fig.face], people: [fig.body], ...extra });

// Métricas SINTÉTICAS: cada glifo mide `em` del tamaño; así los cortes se pueden contar a mano.
const metricsFor = (fonts, em = 0.5) => Object.fromEntries(fonts.map((f) => [M.fitFontKey(f), { advances: new Map(), avgEm: em }]));
const overlayMetrics = (st) => metricsFor([st.slots.headline, ...(st.slots.headline?.emphasis ? [st.slots.headline.emphasis] : []), ...(st.slots.subheadline ? [st.slots.subheadline] : [])]);
const linesText = (st, slot = 'headline') => (st.slots[slot].lines ?? []).map(([a, b]) => st.slots[slot].text.slice(a, b));

console.log('\n── 1 · golden: sin el token, 1.12.0 ──');
test('1a · sin avoid_people, las figuras detectadas no cambian la elección (mismo resultado que sin ellas)', () => {
  const s = style();
  for (const fig of [DE_PIE_DERECHA, DE_PIE_CENTRO, CUERPO_IZQUIERDA]) {
    const a = M.chooseOverlayAnchor({ style: s, width: W, height: H, faces: [fig.face] });
    const b = M.chooseOverlayAnchor({ style: s, width: W, height: H, faces: [fig.face], people: [fig.body] });
    assert.deepEqual(b, a);
    assert.equal('people' in a.report, false);
  }
  assert.equal('avoidPeople' in s.layout, false);
  assert.equal('band' in s, false);
});
test('1b · sin palabra sola, o sin métricas, el estilo es EL MISMO objeto', () => {
  const s = style();
  assert.equal(M.avoidOrphanLines(s, W, H, null).style, s, 'sin métricas no se toca');
  const corto = style({}, { headline: 'Cosecha propia' });
  assert.equal(M.avoidOrphanLines(corto, W, H, overlayMetrics(corto)).style, corto, 'cabe en una línea');
});
test('1c · lámina sin carousel.avoid_people: ni clave nueva ni colocación nueva', () => {
  const a = M.resolveCarouselAvoid({ carousel: { avoid_faces: { enabled: true } } });
  assert.equal('people' in a, false);
  assert.ok(M.CAROUSEL_POLICY_KEYS.has('avoid_people'), 'una capa global que sólo trae la política no declara un carrusel');
  assert.equal(M.carouselChromeDeclared({ avoid_people: { enabled: true } }), false);
});

console.log('\n── 2 · contrato de dato ──');
test('2a · avoid_people mal escrito falla nombrando; apagado no existe', () => {
  const bad = [
    [{ enabled: 'si' }, /layout\.avoid_people \(objeto/],
    [{ enabled: true, margin_pct: 40 }, /layout\.avoid_people\.margin_pct/],
    [{ enabled: true, min_width_pct: 10 }, /layout\.avoid_people\.min_width_pct/],
    [{ enabled: true, fallback: 'inset' }, /layout\.avoid_people\.fallback/],
  ];
  for (const [tok, re] of bad) {
    assert.throws(() => style({ avoid_people: tok }), (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE' && re.test(e.message), JSON.stringify(tok));
  }
  assert.equal('avoidPeople' in style({ avoid_people: { enabled: false } }).layout, false);
  // 1.13.1 — 'band' es un alias retirado: se acepta (aun sin `band` o con un color que no existe), no dibuja y se dice.
  assert.deepEqual(style({ avoid_people: PEOPLE }).layout.avoidPeople, { marginPct: 1, minWidthPct: 28 });
  for (const tok of [BAND, { enabled: true, fallback: 'band' }, { enabled: true, fallback: 'band', band: { color: 'violeta', alpha: 0.5 } }]) {
    const st = style({ avoid_people: tok });
    assert.deepEqual(st.layout.avoidPeople, { marginPct: tok.margin_pct ?? 1, minWidthPct: tok.min_width_pct ?? null, bandRetired: true });
    assert.ok(st.markers.some((m) => m.startsWith('OVERLAY_BAND_RETIRED')));
  }
});
test('2b · avoid_people exige avoid_faces (comparte su detección), en el overlay y en la lámina', () => {
  assert.throws(() => style({ avoid_faces: undefined, avoid_people: PEOPLE }), (e) => /layout\.avoid_people pide layout\.avoid_faces/.test(e.message));
  assert.throws(() => M.resolveCarouselAvoid({ carousel: { avoid_people: { enabled: true } } }), (e) => /carousel\.avoid_people pide carousel\.avoid_faces/.test(e.message));
});
test('2c · la lámina lee la misma forma, sin último recurso propio', () => {
  const a = M.resolveCarouselAvoid({ carousel: { avoid_faces: { enabled: true }, avoid_people: { enabled: true, min_width_pct: 30 } } });
  assert.deepEqual(a.people, { marginPct: 1, minWidthPct: 30 });
  assert.throws(() => M.resolveCarouselAvoid({ carousel: { avoid_faces: { enabled: true }, avoid_people: { enabled: true, fallback: 'band' } } }),
    (e) => /carousel\.avoid_people\.fallback: la lámina usa el último recurso de carousel\.avoid_faces\.fallback/.test(e.message));
});

console.log('\n── 3 · overlay con figura ──');
const TXT = { headline: 'She told it the plan. It told her she was right.', emphasis: ['she was right'] };
test('3a · de pie al centro-derecha: el bloque se estrecha al lado libre y no cruza la figura', () => {
  const s = style({ avoid_people: PEOPLE }, TXT);
  assert.ok(cruza(rectOf(s), px(DE_PIE_DERECHA.body)), 'precondición: a todo el ancho cruza la figura (lo medido con 1.12.0)');
  const c = choose(s, DE_PIE_DERECHA);
  const r = rectOf(c.style);
  assert.equal(c.report.overlap_pct, 0);
  assert.equal(cruza(r, px(DE_PIE_DERECHA.body)), false);
  assert.ok(c.style.layout.maxWidthPct < 74 && c.style.layout.maxWidthPct >= 28, `ancho ${c.style.layout.maxWidthPct}`);
  assert.deepEqual(c.report.narrowed, { max_width_pct_declared: 74, max_width_pct_used: c.style.layout.maxWidthPct });
  assert.equal(c.report.people, 1); assert.equal(c.report.fallback, null);
  assert.ok(c.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_NARROWED_FOR_PERSON')));
  assert.equal(c.style.layout.anchor, 'bottom_left', 'la columna y la fila de la marca se conservan');
});
test('3b · de pie al centro: también se estrecha (columna angosta, nunca por debajo del mínimo)', () => {
  const s = style({ avoid_people: PEOPLE }, TXT);
  const c = choose(s, DE_PIE_CENTRO);
  assert.equal(c.report.overlap_pct, 0);
  assert.equal(cruza(rectOf(c.style), px(DE_PIE_CENTRO.body)), false);
  assert.ok(c.style.layout.maxWidthPct >= 28 && c.style.layout.maxWidthPct < 40, `ancho ${c.style.layout.maxWidthPct}`);
  assert.equal(M.overlayWordOverflow(c.style, W, H, null), false, 'ninguna palabra más ancha que la columna');
});
test('3c · por debajo del mínimo declarado no se estrecha: (1.13.1) la colocación de 1.12.0, que libra la cara', () => {
  const s = style({ avoid_people: { ...PEOPLE, min_width_pct: 40 } }, TXT);
  const c = choose(s, DE_PIE_CENTRO);
  assert.equal(c.report.narrowed, null);
  assert.equal(c.report.overlap_pct, 0, 'la cara queda libre');
  assert.equal(cruza(rectOf(c.style), px(DE_PIE_CENTRO.face)), false);
  assert.ok(c.report.body_overlap_pct > 0);
  assert.ok(c.style.markers.some((m) => m.startsWith('OVERLAY_BODY_UNAVOIDABLE')));
  assert.equal(c.style.markers.some((m) => m.startsWith('OVERLAY_FACE_OVERLAP_UNAVOIDABLE')), false);
  assert.equal('band' in c.style, false, 'no hay banda');
});
test('3d · cuerpo a la izquierda con anclas de la izquierda: (1.13.1) sin banda, la colocación de 1.12.0', () => {
  // 1.15.0 — las anclas de la izquierda se declaran: el orden por defecto ya prueba toda la franja (`faceAnchorCandidates`).
  const IZQ = { enabled: true, margin_pct: 2, anchors: ['top_left', 'middle_left'] };
  const s = style({ avoid_people: BAND, avoid_faces: IZQ }, TXT);
  const c = choose(s, CUERPO_IZQUIERDA);
  const s12 = style({ avoid_faces: IZQ }, TXT);
  const c12 = M.chooseOverlayAnchor({ style: s12, width: W, height: H, faces: [CUERPO_IZQUIERDA.face] });
  assert.equal(c.report.fallback, null);
  assert.equal('band' in c.style, false);
  assert.equal(c.style.layout.anchor, c12.style.layout.anchor);
  assert.equal(c.style.layout.maxWidthPct, c12.style.layout.maxWidthPct);
  assert.equal(c.style.slots.headline.sizePct, c12.style.slots.headline.sizePct);
  assert.equal(cruza(rectOf(c.style), px(CUERPO_IZQUIERDA.face)), false, 'la cara queda libre');
  assert.ok(c.style.markers.some((m) => m.startsWith('OVERLAY_BODY_UNAVOIDABLE')));
  assert.ok(c.style.markers.some((m) => m.startsWith('OVERLAY_BAND_RETIRED')));
  const scene = JSON.stringify(M.buildOverlayScene({ style: c.style, width: W, height: H, backgroundSrc: 'data:,' }));
  const scene12 = JSON.stringify(M.buildOverlayScene({ style: c12.style, width: W, height: H, backgroundSrc: 'data:,' }));
  assert.equal(scene, scene12, 'la escena es la de 1.12.0');
  assert.equal(scene.includes('rgba(16, 16, 16, 0.55)'), false);
});
test('3e · cuerpo a la izquierda con anclas de la derecha declaradas: se estrecha a la derecha', () => {
  const s = style({ avoid_people: PEOPLE, avoid_faces: { enabled: true, margin_pct: 2, anchors: ['bottom_left', 'top_left', 'bottom_right', 'top_right'] } }, TXT);
  const c = choose(s, CUERPO_IZQUIERDA);
  assert.equal(c.report.overlap_pct, 0);
  assert.ok(c.style.layout.anchor.endsWith('_right'), c.style.layout.anchor);
  assert.equal(cruza(rectOf(c.style), px(CUERPO_IZQUIERDA.body)), false);
});
test('3f · la zona segura manda: el bloque estrechado vive dentro de ella', () => {
  const s = style({ avoid_people: PEOPLE, safe_zone_pct: { top: 10, bottom: 20, left: 12, right: 6 } }, TXT);
  const c = choose(s, DE_PIE_DERECHA);
  const r = rectOf(c.style);
  assert.ok(r.x0 >= 0.12 * W - 0.5 && r.y1 <= H - 0.2 * H + 0.5 && r.y0 >= 0.1 * H - 0.5, JSON.stringify(r));
});
test('3g · la fila pedida manda: si tapa, se compone igual, se dice y sin banda', () => {
  const s = M.applyTextPlace(style({ avoid_people: BAND }, TXT), 'bottom').style;
  // Un grupo que ocupa todo el ancho: ninguna columna de la fila de abajo lo libra, ni estrechada.
  const GRUPO = { face: { x0: 0.45, y0: 0.1, x1: 0.55, y1: 0.2 }, body: { x0: 0.04, y0: 0.06, x1: 0.96, y1: 1 } };
  const c = choose(s, GRUPO, { textPlace: 'bottom' });
  assert.ok(c.style.layout.anchor.startsWith('bottom_'));
  // 1.13.1 — la fila pedida libra la cara; el cuerpo, no: se compone igual en esa fila y se dice.
  assert.equal(c.report.overlap_pct, 0);
  assert.ok(c.report.body_overlap_pct > 0);
  assert.ok(c.style.markers.some((m) => m.startsWith('OVERLAY_BODY_UNAVOIDABLE')));
  assert.equal('band' in c.style, false); assert.equal(c.report.fallback, null);
});
test('3h · un bloque estrechado prefiere un escalón más chico antes que dejar una palabra sola que no se acompaña', () => {
  const s = style({ avoid_people: PEOPLE }, { headline: 'Veinte días pagados. El diagnóstico pide doce meses.', emphasis: ['doce meses'] });
  const met = overlayMetrics(s);
  const c = M.chooseOverlayAnchor({ style: s, width: W, height: H, metrics: met, faces: [DE_PIE_DERECHA.face], people: [DE_PIE_DERECHA.body] });
  assert.equal(c.report.overlap_pct, 0);
  assert.ok(c.report.narrowed);
  const lone = M.overlayLoneWords(c.style, W, H, met);
  const sameSize = M.overlayLoneWords({ ...s, layout: { ...s.layout, maxWidthPct: c.report.narrowed.max_width_pct_used } }, W, H, met);
  assert.ok(lone <= sameSize, `${lone} ≤ ${sameSize}`);
});

console.log('\n── 4 · lámina con figura ──');
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
const ctTokens = (over = {}) => M.deepMergeTokens(M.deepMergeTokens(tokens(), CT), over);
const chromeOf = (text, over) => M.resolveCarouselChrome({ tokens: ctTokens(over), typography: TYPO, palette: PAL,
  carousel: M.parseCarouselRequest({ index: 2, total: 5, role: 'body', eyebrow: 'Campo' }), text, logo: null });
const LAMINA = { headline: 'La cosecha no espera a nadie', subheadline: 'Ni el clima ni la lluvia.' };
const FIG_LAM = { face: { x0: 0.62, y0: 0.1, x1: 0.72, y1: 0.2 }, body: { x0: 0.55, y0: 0.05, x1: 0.85, y1: 1 } };
test('4a · sin carousel.avoid_people, la figura no cuenta: la elección es la de 1.12.0', () => {
  const ch = chromeOf(LAMINA);
  const avoid = M.resolveCarouselAvoid(ctTokens({ carousel: { avoid_faces: { enabled: true } } }));
  const a = M.chooseCarouselPlacement({ chrome: ch, faces: [FIG_LAM.face], avoid });
  const b = M.chooseCarouselPlacement({ chrome: ch, faces: [FIG_LAM.face], people: [FIG_LAM.body], avoid });
  assert.deepEqual(b, a);
});
test('4b · con la figura y min_width_pct: la columna se estrecha al lado libre', () => {
  const ch = chromeOf(LAMINA);
  const avoid = M.resolveCarouselAvoid(ctTokens({ carousel: { avoid_faces: { enabled: true }, avoid_people: { enabled: true, min_width_pct: 30 } } }));
  const r = M.chooseCarouselPlacement({ chrome: ch, faces: [FIG_LAM.face], people: [FIG_LAM.body], avoid });
  assert.equal(r.report.overlap_pct, 0);
  assert.equal(r.fit.chrome.block.side, 'left');
  assert.ok(r.fit.chrome.block.columnPct >= 30 && r.fit.chrome.block.columnPct < 100);
  assert.equal(r.report.people, 1);
  assert.ok(r.report.narrowed_column_pct.left >= 30 && r.report.narrowed_column_pct.right === null);
  const rect = M.carouselBlockRect(r.fit.chrome, null).rect;
  assert.ok(rect.x1 <= FIG_LAM.body.x0 * 1000, 'el bloque termina antes de la figura');
});
test('4c · sin columna posible: (1.13.1) la colocación de 1.12.0; el cuerpo no dispara el inset', () => {
  const ch = chromeOf(LAMINA);
  const avoid = M.resolveCarouselAvoid(ctTokens({ carousel: { avoid_faces: { enabled: true, fallback: ['inset'] }, avoid_people: { enabled: true, min_width_pct: 90 } } }));
  const sin = M.resolveCarouselAvoid(ctTokens({ carousel: { avoid_faces: { enabled: true, fallback: ['inset'] } } }));
  const r = M.chooseCarouselPlacement({ chrome: ch, faces: [FIG_LAM.face], people: [FIG_LAM.body], avoid });
  const r12 = M.chooseCarouselPlacement({ chrome: ch, faces: [FIG_LAM.face], avoid: sin });
  assert.equal(r.report.fallback, null);
  assert.deepEqual(r.fit, r12.fit);
  assert.ok(r.warnings.some((w) => w.startsWith('CAROUSEL_BODY_UNAVOIDABLE')));
});

console.log('\n── 5 · la palabra sola ──');
test('5a · el corte voraz y su arreglo: la última de la anterior baja si la anterior tiene 3 o más y la pareja cabe', () => {
  assert.deepEqual(M.greedyAtomLines([40, 40, 40, 40], 100), [[0, 1], [2, 3]]);
  assert.deepEqual(M.orphanFreeLines([30, 30, 30, 30], 95, true), { lines: [[0, 1], [2, 3]], moved: 2 });
  assert.deepEqual(M.orphanFreeLines([30, 30, 30, 30], 95, false).moved, null, 'sin protección no se toca');
  assert.deepEqual(M.orphanFreeLines([45, 45, 45], 95, true).moved, null, 'la anterior con 2 palabras quedaría con una');
  assert.deepEqual(M.orphanFreeLines([20, 20, 20, 90], 95, true).moved, null, 'la pareja no cabe');
  assert.equal(M.ORPHAN_MIN_PREV_WORDS, 3);
});
test('5b · «…It told» / «her» / «she was right.»: «her» ya no queda sola antes del énfasis', () => {
  // Ancho tal que el tramo anterior al énfasis se parte dejando «her» sola (lo medido en d9e97f57).
  let s = null;
  for (let mw = 30; mw <= 74; mw += 0.5) {
    const t = style({ max_width_pct: mw }, TXT);
    const g = M.overlaySlotAtoms(t.slots.headline, W, overlayMetrics(t), [])[0];
    const lines = M.greedyAtomLines(g.atoms.map((x) => x.w), M.overlayTextBox(t, W, H).maxWidth);
    if (lines.length >= 2 && lines.at(-1).length === 1 && lines.at(-2).length >= 3) { s = t; break; }
  }
  assert.ok(s, 'precondición: hay un ancho que deja «her» sola');
  const m = overlayMetrics(s);
  const before = M.measureOverlayText(s, W, H, m);
  const r = M.avoidOrphanLines(s, W, H, m);
  const ls = linesText(r.style);
  assert.ok(!ls.includes('her'), JSON.stringify(ls));
  assert.ok(ls.some((l) => l.endsWith(' her')), JSON.stringify(ls));
  assert.equal(ls.at(-1), 'she was right.');
  assert.deepEqual(r.report, [{ slot: 'headline', word: 'her', moved: ls.find((l) => l.endsWith(' her')).split(' ')[0] }]);
  assert.ok(r.style.markers.some((x) => x.startsWith('OVERLAY_ORPHAN_AVOIDED: «her»')));
  const after = M.measureOverlayText(r.style, W, H, m);
  assert.equal(after.height, before.height, 'mismo número de líneas, misma altura');
  assert.ok(after.width <= before.width + 0.01);
  assert.equal(r.style.slots.headline.sizePct, s.slots.headline.sizePct);
  assert.equal(r.style.layout.anchor, s.layout.anchor);
});
test('5c · «what\'s» / «wrong»: ninguna palabra sola justo antes de un énfasis', () => {
  const T2 = { headline: "She checks the mirror for what's wrong before she checks it for what's there.", emphasis: ['wrong', "what's there"] };
  let hits = 0;
  for (let mw = 25; mw <= 74; mw += 0.5) {
    const t = style({ max_width_pct: mw }, T2);
    const m = overlayMetrics(t);
    const r = M.avoidOrphanLines(t, W, H, m);
    const maxW = M.overlayTextBox(r.style, W, H).maxWidth;
    const groups = M.overlaySlotAtoms(r.style.slots.headline, W, m, []);
    groups.forEach((g, i) => {
      const next = groups[i + 1];
      if (!next?.atoms[0]?.keyword) return;
      const lines = M.greedyAtomLines(g.atoms.map((x) => x.w), maxW);
      // Una línea de una palabra antes del énfasis sólo queda si no se podía acompañar.
      if (lines.length >= 2 && lines.at(-1).length === 1) assert.ok(lines.at(-2).length < 3, `ancho ${mw}: ${JSON.stringify(linesText(r.style))}`);
    });
    if (r.report.length) hits++;
  }
  assert.ok(hits > 0, 'en algún ancho la regla actuó');
});
test('5d · viuda al final sin énfasis (regla general) y en la bajada', () => {
  let found = false;
  for (let mw = 30; mw <= 74 && !found; mw += 0.5) {
    const t = style({ max_width_pct: mw }, { headline: 'El campo no se apura y la cosecha llega cuando quiere', subheadline: 'Ni el clima ni la lluvia ni el mercado le ponen fecha a lo que madura' });
    const m = overlayMetrics(t);
    const r = M.avoidOrphanLines(t, W, H, m);
    if (r.report.length) {
      found = true;
      for (const slot of ['headline', 'subheadline']) {
        const sl = r.style.slots[slot];
        if (!sl.lines) continue;
        assert.ok(linesText(r.style, slot).at(-1).includes(' '), `${slot}: ${JSON.stringify(linesText(r.style, slot))}`);
      }
      const scene = JSON.stringify(M.buildOverlayScene({ style: r.style, width: W, height: H, backgroundSrc: 'data:,' }));
      assert.ok(scene.includes('"flexDirection":"column"'), 'la ranura se compone por filas');
    }
  }
  assert.ok(found);
});
test('5e · lámina: la última palabra del titular no queda sola; sin métricas, el mismo ajuste', () => {
  let ok = false;
  for (const h of ['La cosecha no espera a nadie nunca', 'El trigo madura cuando el sol lo decide', 'Nadie apura al campo ni a su gente']) {
    const ch = chromeOf({ headline: h });
    const fit = M.fitCarouselContent({ chrome: ch, metrics: null });
    assert.equal(M.carouselAvoidOrphan(fit, null), fit);
    for (let em = 0.40; em <= 0.70 && !ok; em += 0.01) {
      const met = metricsFor([ch.type.headline], em);
      const r = M.carouselAvoidOrphan(fit, met);
      if (r === fit) continue;
      ok = true;
      assert.equal(r.chrome.headlineBreaks.length, 1);
      assert.ok(r.warnings.at(-1).startsWith('CAROUSEL_ORPHAN_AVOIDED'));
      const scene = JSON.stringify(M.buildCarouselScene({ chrome: r.chrome, style: style(), backgroundSrc: 'data:,' }));
      assert.ok(scene.includes('"height":0'), 'el corte a la fuerza es un hueco de alto cero');
      const plain = JSON.stringify(M.buildCarouselScene({ chrome: fit.chrome, style: style(), backgroundSrc: 'data:,' }));
      assert.equal(plain.includes('"height":0'), false);
    }
  }
  assert.ok(ok, 'en algún caso la regla actuó en la lámina');
});

console.log('\n── 6 · cableado ──');
test('6a · la MISMA detección: figuras sólo con el token; sin él, la petición de 1.11.0', () => {
  assert.match(SRC, /FACES_PROMPT \+ \(opts\.signs \? SIGNS_PROMPT : ''\) \+ \(opts\.products \? PRODUCTS_PROMPT : ''\) \+ \(opts\.people \? PEOPLE_PROMPT : ''\)/);
  assert.match(SRC, /if \(opts\.people\) schemaKeys\.push\('people'\);/);
  assert.match(SRC, /from the top of the head to the lowest visible part of the body/);
  assert.match(SRC, /detectFaces\(cleanBytes, dims\.mime, \{ signs: wantSigns, products: wantProducts, people: wantPeople,/);
  assert.match(SRC, /detectFaces\(slideBytes, slideDims\.mime, \{ products: !!avoid\.products, people: !!avoid\.people,/);
  assert.match(SRC, /faces: fc\.faces, people: fc\.people,/);
  assert.match(SRC, /people: coverMapBoxes\(fc\.people \?\? \[\], slideDims\.width, slideDims\.height, cw, ch\)/);
  assert.deepEqual(M.parseFaceBoxes('{"faces":[],"people":[{"box_2d":[50,400,1000,700]}]}', 'people'), [{ x0: 0.4, y0: 0.05, x1: 0.7, y1: 1 }]);
});
test('6b · detección fallida: se compone en el ancla declarada y se dice (lo de siempre)', () => {
  assert.match(SRC, /OVERLAY_FACE_CHECK_UNAVAILABLE: \$\{fc\.error \?\? 'sin respuesta'\}; se compone en el ancla declarada/);
  assert.match(SRC, /CAROUSEL_FACE_CHECK_UNAVAILABLE/);
});
test('6c · el corte va después de la elección del ancla, y viaja en meta', () => {
  const iAnchor = SRC.indexOf('const ch = chooseOverlayAnchor(');
  const iOrphan = SRC.indexOf('const orphan = avoidOrphanLines(finalStyle, dims.width, dims.height, areaMetrics);');
  assert.match(SRC, /const orphan = avoidOrphanLines\(finalStyle, dims\.width, dims\.height, areaMetrics\);\n\s*finalStyle = orphan\.style;/);
  const iScene = SRC.indexOf('const scene = buildOverlayScene({\n      style: finalStyle');
  assert.ok(iAnchor > 0 && iOrphan > iAnchor && iScene > iOrphan, `${iAnchor} < ${iOrphan} < ${iScene}`);
  assert.match(SRC, /\.\.\.\(orphan\.report\.length \? \{ orphan_lines: orphan\.report \} : \{\}\),/);
  assert.match(SRC, /fit = carouselAvoidOrphan\(fit, metrics\);\n\s*warnings\.push\(\.\.\.fit\.warnings\);/);
  assert.match(SRC, /\.\.\.\(wantPeople \? \{ people_boxes: fc\.people \} : \{\}\)/);
  assert.match(SRC, /COMPOSITOR_VERSION = '1\.(13\.[01]|14\.0|15\.0|16\.0|17\.0|18\.0|19\.0|20\.0|21\.0|22\.0)'/);
});

console.log('\n── 7 · marca N+1 ──');
test('7 · el bloque nuevo no nombra marcas, ciudades ni clientes', () => {
  const ini = SRC.indexOf('// ── 1.13.0 · EL TEXTO NO TAPA EL CUERPO DE LA PERSONA');
  const fin = SRC.indexOf('export function resolveOverlayStyle(');
  const ini2 = SRC.indexOf('// ── 1.13.0 · NINGUNA PALABRA SOLA EN SU LÍNEA');
  const fin2 = SRC.indexOf('/**\n * 1.5.0 — el tamaño del bloque de texto del overlay');
  assert.ok(ini > 0 && fin > ini && ini2 > 0 && fin2 > ini2);
  const bloque = SRC.slice(ini, fin) + SRC.slice(ini2, fin2) + SRC.slice(SRC.indexOf('export function carouselAvoidOrphan'), SRC.indexOf('export function measureCarouselLayout'));
  for (const w of ['LucienSael', 'Lucien', 'NeuroneSCF', 'ForumPHs', 'Unrealville', 'Patricia', 'Miami', 'Panam', 'Broward', 'Florida']) {
    assert.equal(bloque.includes(w), false, `nombra «${w}»`);
  }
});

console.log(`\n${pass} ok · ${fails.length} fallos`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
