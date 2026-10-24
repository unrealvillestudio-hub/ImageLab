// 1.13.1 — LA CARA MANDA; EL CUERPO SÓLO DESEMPATA. Test del bloque PURO, con las cajas medidas a mano sobre las piezas
// reales del 2026-10-22, y del cableado.
//
// EL CASO (medido el 2026-10-22 en producción, 12 piezas): con 1.13.0 y `avoid_people` encendido en la capa global, la
// figura de pie a un lado (n1..n3) salió bien —el bloque se estrechó al lado libre—, pero la persona centrada, de cintura
// arriba, que ocupa casi todo el alto (m1..m8), salió con la banda gris en 7 de 8 piezas, varias sobre la cabeza o la
// cara. Causa: la figura entera se sumaba a las MISMAS cajas que la cara; cuando ninguna colocación libraba la figura, el
// último recurso se elegía por el menor solape conjunto y llevaba banda, sin volver a exigir que se librara la cara.
//
// QUÉ AFIRMA.
//   1. GOLDEN sin `avoid_people`: la elección y la escena son EXACTAMENTE las de 1.13.0 (y las de 1.12.0, que son iguales
//      en estos casos), pieza por pieza.
//   2. GOLDEN con `avoid_people`, persona centrada: donde ninguna colocación libra el cuerpo, la elección y la escena son
//      EXACTAMENTE las de 1.12.0, sin banda, y se dice. Donde una libra cara y cuerpo (m2), se prefiere esa.
//   3. La figura de pie a un lado: sigue estrechándose al lado libre, idéntica a 1.13.0.
//   4. LA INVARIANTE: ningún caso pone texto sobre una caja de cara que 1.12.0 libraba; y nunca tapa más cara que 1.12.0.
//   5. La forma de 1.13.0 (`fallback: 'band'`) es un alias retirado: no falla, no dibuja nada, se dice.
//   6. La lámina: el cuerpo nunca dispara el 'inset' ni la banda; la cara sí, como en 1.11.0; la columna estrechada
//      sigue funcionando.
//   7. Cableado: ni banda en la escena ni `refitOverlayBand` en el handler; versión 1.13.1.
//   8. Marca N+1 y voseo: el bloque nuevo no nombra marcas ni ciudades, y este test y sus casos no vosean.
//
// Ejecutar:  node tests/la_cara_manda_test.mjs     (Node ≥ 22.18)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { CASOS, CENTRADA, DE_PIE, GLOBAL_HOY, globalCon, AVOID_PEOPLE_1130_LAYOUT } from './fixtures/la_cara_manda_casos.mjs';
import { composeOverlay, digestOverlay } from './fixtures/la_cara_manda_digest.mjs';
import { formasVoseantes } from './idioma_voseo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'compose.ts'), 'utf8');
const BEGIN = '// ── COMPOSITOR:BEGIN ──', END = '// ── COMPOSITOR:END ──';
const dir = mkdtempSync(join(tmpdir(), 'la-cara-manda-'));
writeFileSync(join(dir, 'block.mts'), SRC.slice(SRC.indexOf(BEGIN), SRC.indexOf(END) + END.length) + '\n', 'utf8');
const M = await import(pathToFileURL(join(dir, 'block.mts')).href);
const GOLDEN = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'la_cara_manda_golden.json'), 'utf8'));

let pass = 0; const fails = [];
const test = (n, f) => { try { f(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fails.push(n); console.log(`  ✗ ${n}\n    ${e.message}`); } };

const px = (c, b) => ({ x0: b.x0 * c.w, y0: b.y0 * c.h, x1: b.x1 * c.w, y1: b.y1 * c.h });
const cruza = (r, b) => Math.min(r.x1, b.x1) > Math.max(r.x0, b.x0) && Math.min(r.y1, b.y1) > Math.max(r.y0, b.y0);
const solape = (r, b) => {
  const w = Math.min(r.x1, b.x1) - Math.max(r.x0, b.x0), h = Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
};
const rectOf = (c, st) => M.overlayTextRect(st, c.w, c.h, null, st.layout.anchor);
const CON = globalCon();
const BANDA_1130 = 'rgba(0, 0, 0, 0.55)';
// Donde 1.12.0, con estas cajas, no libra la cara ni al tamaño mínimo (las tres anclas de la columna izquierda tapan la
// cara o los envases y gana el menor solape conjunto). Es un límite de 1.12.0, no de 1.13.x; ver el test 4b.
const LIMITE_1120 = new Set(['b24cdc5f', 'fe9847d5']);
// Donde una colocación libra cara, producto y cuerpo: se prefiere esa (jerarquía, punto 2).
const CUERPO_LIBRE = new Set(['0cd8f005']);

console.log('\n── 1 · golden: sin avoid_people, lo de hoy ──');
test('1a · sin avoid_people, cada pieza compone EXACTAMENTE como 1.13.0 (y 1.12.0)', () => {
  for (const c of CASOS) {
    const d = digestOverlay(M, c, GLOBAL_HOY);
    assert.deepEqual(d, GOLDEN['1.13.0'].casos[c.id], `${c.tira} ${c.id}`);
    assert.deepEqual(d, GOLDEN['1.12.0'].casos[c.id], `${c.tira} ${c.id}`);
  }
});

console.log('\n── 2 · golden: persona centrada, con avoid_people ──');
test('2a · donde nada libra el cuerpo: la colocación, el tamaño, el ancho y la escena de 1.12.0', () => {
  let n = 0;
  for (const c of CENTRADA.filter((x) => !CUERPO_LIBRE.has(x.id))) {
    assert.deepEqual(digestOverlay(M, c, CON), GOLDEN['1.12.0'].casos[c.id], `${c.tira} ${c.id}`);
    n++;
  }
  assert.equal(n, 7);
});
test('2b · sin banda: ni en el estilo, ni en la escena, ni en el informe', () => {
  for (const c of CENTRADA) {
    const r = composeOverlay(M, c, CON);
    assert.equal('band' in r.style, false, c.id);
    assert.equal(JSON.stringify(r.scene).includes(BANDA_1130), false, c.id);
    assert.equal(r.report.fallback, null, c.id);
    assert.equal('band' in r.report, false, c.id);
  }
});
test('2c · si el texto cae sobre el cuerpo, se dice y meta lleva cuánto', () => {
  let dichos = 0;
  for (const c of CENTRADA.filter((x) => !CUERPO_LIBRE.has(x.id))) {
    const r = composeOverlay(M, c, CON);
    assert.equal(r.report.people, 1);
    assert.equal(r.report.narrowed, null);
    const tapaCuerpo = solape(rectOf(c, r.style), px(c, c.person)) > 0;
    assert.equal(r.report.body_overlap_pct > 0, tapaCuerpo, c.id);
    const m = r.style.markers.find((x) => x.startsWith('OVERLAY_BODY_UNAVOIDABLE'));
    assert.equal(!!m, tapaCuerpo, c.id);
    if (m) { dichos++; assert.ok(m.includes('la elección de 1.12.0') && m.includes('sin banda'), m); }
    assert.equal(r.style.layout.avoidPeople.minWidthPct, 28, 'la política sigue en el estilo');
  }
  assert.ok(dichos >= 5, `dichos=${dichos}`);
});
test('2d · m2: una colocación libra cara, producto y cuerpo, y se prefiere', () => {
  const c = CENTRADA.find((x) => x.id === '0cd8f005');
  const r = composeOverlay(M, c, CON);
  const t = rectOf(c, r.style);
  assert.equal(r.report.overlap_pct, 0);
  assert.equal(cruza(t, px(c, c.face)), false);
  assert.equal(cruza(t, px(c, c.person)), false);
  assert.ok(c.products.every((p) => !cruza(t, px(c, p))));
  assert.notEqual(r.style.layout.anchor, GOLDEN['1.12.0'].casos[c.id].anchor, 'precondición: 1.12.0 caía sobre el torso');
});

console.log('\n── 3 · figura de pie a un lado ──');
test('3a · sigue estrechándose al lado libre: idéntica a 1.13.0', () => {
  for (const c of DE_PIE) {
    const r = composeOverlay(M, c, CON);
    assert.deepEqual(digestOverlay(M, c, CON), GOLDEN['1.13.0+avoid_people'].casos[c.id], `${c.tira} ${c.id}`);
    assert.ok(r.report.narrowed && r.report.narrowed.max_width_pct_used < 74, c.id);
    assert.equal(r.report.overlap_pct, 0); assert.equal(r.report.body_overlap_pct, 0);
    const t = rectOf(c, r.style);
    assert.equal(cruza(t, px(c, c.person)), false, c.id);
    assert.equal(cruza(t, px(c, c.face)), false, c.id);
    assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_NARROWED_FOR_PERSON')));
    assert.equal(r.style.markers.some((m) => m.startsWith('OVERLAY_BODY_UNAVOIDABLE')), false);
  }
});

console.log('\n── 4 · la invariante: el texto no cae sobre una cara ──');
test('4a · ningún caso pone texto sobre una caja de cara que 1.12.0 libraba (sin el token, con 1.13.1 y con el alias)', () => {
  let n = 0;
  for (const c of CASOS.filter((x) => !LIMITE_1120.has(x.id))) {
    for (const g of [GLOBAL_HOY, CON, globalCon(AVOID_PEOPLE_1130_LAYOUT)]) {
      const r = composeOverlay(M, c, g);
      assert.equal(cruza(rectOf(c, r.style), px(c, c.face)), false, `${c.tira} ${c.id} tapa la cara`);
      n++;
    }
  }
  assert.equal(n, 27);
});
test('4b · donde 1.12.0 no puede librarla, 1.13.1 nunca tapa MÁS cara que 1.12.0, ni con banda', () => {
  for (const c of CENTRADA.filter((x) => LIMITE_1120.has(x.id))) {
    const hoy = composeOverlay(M, c, GLOBAL_HOY);
    const con = composeOverlay(M, c, CON);
    assert.equal(solape(rectOf(c, con.style), px(c, c.face)), solape(rectOf(c, hoy.style), px(c, c.face)), c.id);
    assert.ok(hoy.style.markers.some((m) => m.startsWith('OVERLAY_FACE_OVERLAP_UNAVOIDABLE')), 'precondición: 1.12.0 lo dice');
    assert.ok(con.style.markers.some((m) => m.startsWith('OVERLAY_FACE_OVERLAP_UNAVOIDABLE')), 'y 1.13.1 también');
  }
});
test('4c · 1.13.0 sí la tapaba: el caso que motivó 1.13.1 (precondición, medida con el golden de la banda)', () => {
  // Con 1.13.0, m3 y m6 iban a top_left con banda: la caja del texto cruzaba la cara. Hoy, con avoid_people, van donde
  // 1.12.0 (bottom_left), que la libra.
  for (const id of ['2383b96f', 'da5bafa1']) {
    const c = CENTRADA.find((x) => x.id === id);
    const r = composeOverlay(M, c, CON);
    assert.equal(r.style.layout.anchor, 'bottom_left');
    assert.equal(cruza(rectOf(c, r.style), px(c, c.face)), false, id);
  }
});

console.log('\n── 5 · la forma de 1.13.0: alias retirado ──');
test('5a · fallback band: no falla, no dibuja nada, compone igual que la forma 1.13.1 y se dice', () => {
  const ALIAS = globalCon(AVOID_PEOPLE_1130_LAYOUT);
  for (const c of CASOS) {
    const a = composeOverlay(M, c, ALIAS);
    const b = composeOverlay(M, c, CON);
    assert.deepEqual(a.scene, b.scene, c.id);
    assert.equal(a.style.layout.anchor, b.style.layout.anchor);
    assert.ok(a.style.markers.some((m) => m.startsWith('OVERLAY_BAND_RETIRED')), c.id);
    assert.equal(b.style.markers.some((m) => m.startsWith('OVERLAY_BAND_RETIRED')), false, c.id);
    assert.equal(a.style.layout.avoidPeople.bandRetired, true);
    assert.equal('bandRetired' in b.style.layout.avoidPeople, false);
  }
});
test('5b · la forma vigente se lee igual; un valor ajeno sigue fallando nombrando', () => {
  const c = CENTRADA[2];
  const st = composeOverlay(M, c, CON).style;
  assert.deepEqual(st.layout.avoidPeople, { marginPct: 1, minWidthPct: 28 });
  assert.throws(() => composeOverlay(M, c, globalCon({ enabled: true, fallback: 'inset' })),
    (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE' && /layout\.avoid_people\.fallback/.test(e.message));
  assert.equal(typeof M.overlayBandRect, 'undefined', 'la banda del overlay ya no existe');
  assert.equal(typeof M.refitOverlayBand, 'undefined');
});

console.log('\n── 6 · la lámina ──');
// Marca INVENTADA (otro rubro, otro idioma): la lámina no depende de ninguna marca real.
const TYPO = [{ role: 'titular', font_family: 'Fuente A' }, { role: 'cuerpo', font_family: 'Fuente B' }, { role: 'rotulo', font_family: 'Fuente C' }];
const PAL = [
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
  carousel_palette: null,
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
const base = { layout: LAYOUT.layout, typography: LAYOUT.typography, palette: LAYOUT.palette };
const ctTokens = (over = {}) => M.deepMergeTokens(M.deepMergeTokens(base, CT), over);
const chromeOf = (text) => M.resolveCarouselChrome({ tokens: ctTokens(), typography: TYPO, palette: PAL,
  carousel: M.parseCarouselRequest({ index: 2, total: 5, role: 'body', eyebrow: 'Campo' }), text, logo: null });
const LAMINA = { headline: 'La cosecha no espera a nadie', subheadline: 'Ni el clima ni la lluvia.' };
// Como m3, en el lienzo de la lámina: cara centrada arriba, figura de casi todo el alto.
const CENTRADA_LAM = { face: { x0: 0.30, y0: 0.20, x1: 0.48, y1: 0.40 }, body: { x0: 0.10, y0: 0.15, x1: 0.70, y1: 1 } };
const DE_PIE_LAM = { face: { x0: 0.62, y0: 0.1, x1: 0.72, y1: 0.2 }, body: { x0: 0.55, y0: 0.05, x1: 0.85, y1: 1 } };
const avoidCon = (af = {}) => M.resolveCarouselAvoid(ctTokens({ carousel: { avoid_faces: { enabled: true, fallback: ['inset'], column_pct: [60, 50], ...af }, avoid_people: { enabled: true, min_width_pct: 30 } } }));
const avoidSin = (af = {}) => M.resolveCarouselAvoid(ctTokens({ carousel: { avoid_faces: { enabled: true, fallback: ['inset'], column_pct: [60, 50], ...af } } }));
const blockPx = (r) => M.carouselBlockRect(r.fit.chrome, null).rect;
const lamPx = (b) => ({ x0: b.x0 * 1000, y0: b.y0 * 1250, x1: b.x1 * 1000, y1: b.y1 * 1250 });
test('6a · persona centrada: el cuerpo no dispara el inset; la colocación es la de 1.12.0 y se dice', () => {
  const ch = chromeOf(LAMINA);
  const hoy = M.chooseCarouselPlacement({ chrome: ch, faces: [CENTRADA_LAM.face], avoid: avoidSin() });
  const con = M.chooseCarouselPlacement({ chrome: ch, faces: [CENTRADA_LAM.face], people: [CENTRADA_LAM.body], avoid: avoidCon() });
  assert.deepEqual(con.fit, hoy.fit, 'mismo ajuste y misma colocación que sin la política del cuerpo');
  assert.equal(con.report.fallback, null);
  assert.equal(con.report.placement_used, hoy.report.placement_used);
  assert.ok(con.report.body_overlap_pct > 0);
  assert.ok(con.warnings.some((w) => w.startsWith('CAROUSEL_BODY_UNAVOIDABLE')));
  assert.equal(con.warnings.some((w) => w.startsWith('CAROUSEL_PHOTO_INSET_FOR_SUBJECT')), false);
  assert.equal(cruza(blockPx(con), lamPx(CENTRADA_LAM.face)), false, 'el bloque no cae sobre la cara');
});
test('6b · la cara sí dispara el último recurso de 1.11.0, con o sin la política del cuerpo', () => {
  const ch = chromeOf(LAMINA);
  const CARA_TODA = { face: { x0: 0.05, y0: 0.05, x1: 0.95, y1: 0.95 }, body: { x0: 0, y0: 0, x1: 1, y1: 1 } };
  const hoy = M.chooseCarouselPlacement({ chrome: ch, faces: [CARA_TODA.face], avoid: avoidSin() });
  const con = M.chooseCarouselPlacement({ chrome: ch, faces: [CARA_TODA.face], people: [CARA_TODA.body], avoid: avoidCon() });
  assert.equal(hoy.report.fallback, 'inset');
  assert.deepEqual(con.fit, hoy.fit);
  assert.equal(con.report.fallback, 'inset');
  assert.equal(con.report.body_overlap_pct, 0, "con 'inset' el texto va sobre la superficie, no sobre la foto");
});
test('6c · figura de pie a un lado: la columna se estrecha al lado libre, libre de cara y cuerpo', () => {
  const ch = chromeOf(LAMINA);
  const r = M.chooseCarouselPlacement({ chrome: ch, faces: [DE_PIE_LAM.face], people: [DE_PIE_LAM.body], avoid: avoidCon() });
  assert.equal(r.report.overlap_pct, 0); assert.equal(r.report.fallback, null); assert.equal(r.report.body_overlap_pct, 0);
  assert.equal(cruza(blockPx(r), lamPx(DE_PIE_LAM.body)), false);
  assert.equal(r.fit.chrome.block.side, 'left');
});
test('6d · sin carousel.avoid_people: la figura no cuenta, idéntico a 1.12.0', () => {
  const ch = chromeOf(LAMINA);
  const a = M.chooseCarouselPlacement({ chrome: ch, faces: [CENTRADA_LAM.face], avoid: avoidSin() });
  const b = M.chooseCarouselPlacement({ chrome: ch, faces: [CENTRADA_LAM.face], people: [CENTRADA_LAM.body], avoid: avoidSin() });
  assert.deepEqual(b, a);
  assert.equal('body_overlap_pct' in a.report, false);
});

console.log('\n── 7 · cableado ──');
test('7a · el handler ya no reajusta una banda y la escena del overlay no la dibuja', () => {
  assert.match(SRC, /const orphan = avoidOrphanLines\(finalStyle, dims\.width, dims\.height, areaMetrics\);\n\s*finalStyle = orphan\.style;/);
  assert.equal(SRC.includes('refitOverlayBand'), false);
  assert.equal(SRC.includes('overlayBandRect'), false);
  assert.equal(/if \(style\.band\)/.test(SRC), false);
  assert.equal(SRC.includes('OVERLAY_BAND_FOR_PERSON'), false);
  assert.match(SRC, /COMPOSITOR_VERSION = '1\.(13\.1|14\.0|15\.0|16\.0|17\.0)'/);
});
test('7b · la elección de 1.12.0 es la de siempre: chooseOverlayAnchorCore y chooseCarouselPlacementCore', () => {
  assert.match(SRC, /const r12 = chooseOverlayAnchorCore\(\{ \.\.\.args, style: \{ \.\.\.style, layout: layoutSinCuerpo \}, people: null \}\);/);
  assert.match(SRC, /const r12 = chooseCarouselPlacementCore\(\{ \.\.\.args, avoid: avoidSinCuerpo, people: null \}\);/);
  assert.match(SRC, /if \(conCuerpo\.report && conCuerpo\.report\.overlap_pct === 0\) return conCuerpo;/);
  assert.match(SRC, /if \(conCuerpo\.report\.fallback === null && conCuerpo\.report\.overlap_pct === 0\)/);
});

console.log('\n── 8 · marca N+1 y voseo ──');
test('8a · el bloque nuevo no nombra marcas, ciudades ni clientes', () => {
  const ini = SRC.indexOf('export function chooseOverlayAnchor(args: OverlayAnchorArgs)');
  const fin = SRC.indexOf('function chooseOverlayAnchorCore(');
  const ini2 = SRC.indexOf('export function chooseCarouselPlacement(args: Parameters');
  const fin2 = SRC.indexOf('/**\n * ELIGE DÓNDE VA EL BLOQUE DE LA LÁMINA.');
  assert.ok(ini > 0 && fin > ini && ini2 > 0 && fin2 > ini2);
  const bloque = SRC.slice(ini, fin) + SRC.slice(ini2, fin2) + SRC.slice(SRC.indexOf('//   1.13.1 (2026-10-22)'), SRC.indexOf("export const COMPOSITOR_VERSION = '"));
  for (const w of ['LucienSael', 'Lucien', 'NeuroneSCF', 'Neurone', 'ForumPHs', 'Unrealville', 'Patricia', 'Miami', 'Panam', 'Broward', 'Florida']) {
    assert.equal(bloque.includes(w), false, `nombra «${w}»`);
  }
});
test('8b · ni este test ni sus casos vosean', () => {
  for (const f of ['tests/la_cara_manda_test.mjs', 'tests/fixtures/la_cara_manda_casos.mjs', 'tests/fixtures/la_cara_manda_digest.mjs', 'tests/_capturar_golden_cara.mjs']) {
    const t = readFileSync(join(ROOT, f), 'utf8');
    assert.deepEqual(formasVoseantes(t), [], f);
  }
});

console.log(`\n${pass} ok · ${fails.length} fallos`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
