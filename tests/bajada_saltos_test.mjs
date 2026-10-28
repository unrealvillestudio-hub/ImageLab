// LA BAJADA RESPETA SUS SALTOS DE LÍNEA (compositor 1.20.0, 2026-10-28).
//
// Sam (2026-10-28): «en la bajada quisiera poder poner una línea aparte entre por ejemplo una oración y otra». Desde
// 1.7.0 el titular respeta un salto escrito; la bajada se componía como un solo párrafo corrido y un `\n` se leía como
// un espacio.
//
// LO QUE FIJA ESTE TEST:
//   1. La regla: cada `\n` abre línea, cada línea se recorta, los tramos vacíos se funden (no hay líneas en blanco). El
//      titular conserva su regla manual de 1.7.0, salida por salida.
//   2. Golden: sin `\n`, la ranura de la bajada no lleva `lines` y la escena es la de siempre.
//   3. Toda medida que dimensiona o ubica la bajada cuenta las líneas forzadas: el alto y el área del bloque, el límite de
//      área, el ajuste al alto, la escalera de caras, `keep_subheadline` y `text_scale`.
//   4. Un tramo de `text_style.sub` (resaltado, sombra, cursiva) que cruza un salto no se encuentra y se dice con el aviso
//      de siempre; sin tramos así, la búsqueda es la de `splitEmphasis`.
//   5. La lámina del carrusel: medidor, área de la portada, escena y tramos.
//   6. Eco (`meta.sub_breaks`, `meta.carousel.sub_breaks`), versión, marca N+1 y voseo.
//
// Ejecutar:  node tests/bajada_saltos_test.mjs     (Node ≥ 22.18)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { formasVoseantes } from './idioma_voseo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'compose.ts'), 'utf8');
const BEGIN = '// ── COMPOSITOR:BEGIN ──', END = '// ── COMPOSITOR:END ──';
const dir = mkdtempSync(join(tmpdir(), 'bajada-saltos-'));
const mod = join(dir, 'block.mts');
writeFileSync(mod, SRC.slice(SRC.indexOf(BEGIN), SRC.indexOf(END) + END.length) + '\n', 'utf8');
const M = await import(pathToFileURL(mod).href);

let pass = 0; const fails = [];
const test = (n, f) => { try { f(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fails.push(n); console.log(`  ✗ ${n}\n    ${e.message}`); } };
const sha = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

// ── Marca INVENTADA (otro rubro, otro idioma): el eje no depende de ninguna marca real ──
const TYPO = [{ role: 'titular', font_family: 'Fuente A' }, { role: 'cuerpo', font_family: 'Fuente B' }, { role: 'rotulo', font_family: 'Fuente C' }];
const PAL = [
  { role: 'claro', hex: '#FAFAFA' }, { role: 'oscuro', hex: '#101010' }, { role: 'acento', hex: '#2F7A3D' },
  { role: 'trigo', hex: '#D9A441' }, { role: 'tierra', hex: '#3B2A1E' }, { role: 'arcilla', hex: '#5A4030' },
];
const SHADOW = { kind: 'shadow', color: '#000000', alpha: 0.4, blur_pct: 0.7, offset_pct: 0.15 };
const tokens = (layout = {}) => ({
  layout: { anchor: 'bottom_left', margin_pct: 7, max_width_pct: 76, gap_pct: 2, text_effect: SHADOW, ...layout },
  typography: {
    headline: { role: 'titular', weight: 700, fit_steps: [{ max_chars: 30, size_pct: 9 }, { max_chars: 80, size_pct: 7 }, { max_chars: 400, size_pct: 5 }] },
    subheadline: { role: 'cuerpo', fit_steps: [{ max_chars: 60, size_pct: 3.4 }, { max_chars: 400, size_pct: 2.8 }] },
  },
  palette: { headline: 'claro', subheadline: 'claro', headline_emphasis: 'trigo' },
});
const HL = 'La cosecha no espera';
const SUB_NO = 'Uno dos. Tres cuatro.';
const SUB_BR = 'Uno dos.\nTres cuatro.';
const style = (sub, layout, extra = {}) => M.resolveOverlayStyle({ tokens: tokens(layout), typography: TYPO, palette: PAL, text: { headline: HL, subheadline: sub, ...extra } });
const W = 1080, H = 1350;
const nodes = (n, out = []) => { if (n && typeof n === 'object') { out.push(n); const c = n.props?.children; if (Array.isArray(c)) c.forEach((x) => nodes(x, out)); else nodes(c, out); } return out; };
const strings = (sc) => nodes(sc).map((n) => n.props?.children).filter((c) => typeof c === 'string');
const ts = (raw) => M.parseTextStyleRequest(raw);

console.log('\n── 1 · la regla ──');
test('1a · cada salto abre línea; cada línea se recorta; los tramos vacíos se funden', () => {
  assert.equal(M.writtenLineRanges('Sin saltos.'), null);
  assert.equal(M.writtenLineRanges(''), null);
  assert.equal(M.writtenLineRanges(null), null);
  const t = '  Uno dos.  \n\n\n  Tres.\n';
  const r = M.writtenLineRanges(t);
  assert.deepEqual(r.map(([a, b]) => t.slice(a, b)), ['Uno dos.', 'Tres.']);
  assert.deepEqual(M.subheadlineLineRanges(t), r);
  // Un retorno de carro antes del salto se recorta con la línea.
  const crlf = 'Uno\r\nDos';
  assert.deepEqual(M.writtenLineRanges(crlf).map(([a, b]) => crlf.slice(a, b)), ['Uno', 'Dos']);
});
test('1b · una sola línea con texto no impone cortes; los saltos respetados son las líneas menos una', () => {
  assert.equal(M.subheadlineLineRanges('Hola\n'), null);
  assert.equal(M.subheadlineLineRanges('\n\nHola\n\n'), null);
  assert.equal(M.subheadlineBreaks('Sin saltos.'), null, 'sin `\\n` no hay eco');
  assert.equal(M.subheadlineBreaks('Hola\n'), 0);
  assert.equal(M.subheadlineBreaks('\n\n'), 0);
  assert.equal(M.subheadlineBreaks('Uno.\nDos.'), 1);
  assert.equal(M.subheadlineBreaks('Uno.\n\n\nDos.\nTres.'), 2, 'dos saltos seguidos cuentan como uno');
});
test('1c · el titular conserva su regla manual de 1.7.0, salida por salida', () => {
  assert.deepEqual(M.headlineLineRanges('Uno\n  Dos ', null), { ranges: [[0, 3], [6, 9]], source: 'manual' });
  assert.equal(M.headlineLineRanges('Uno\n', null), null);
  assert.equal(M.headlineLineRanges('Uno dos', null), null);
});

console.log('\n── 2 · golden ──');
test('2a · sin `\\n`, la ranura de la bajada no lleva `lines` y su texto queda entero en la escena', () => {
  const s = style(SUB_NO);
  assert.ok(!('lines' in s.slots.subheadline));
  assert.ok(strings(M.buildOverlayScene({ style: s, width: W, height: H, backgroundSrc: 'data:image/png;base64,BG' })).includes(SUB_NO));
});
test('2b · la bajada con saltos impone sus líneas y la escena dibuja una fila por línea', () => {
  const s = style('Uno dos.\n\nTres cuatro.\n  Cinco.  ');
  assert.deepEqual(s.slots.subheadline.lines.map(([a, b]) => s.slots.subheadline.text.slice(a, b)), ['Uno dos.', 'Tres cuatro.', 'Cinco.']);
  assert.ok(!s.markers.some((m) => m.startsWith('OVERLAY_HEADLINE_LINES')), 'el marcador del titular no se usa para la bajada');
  const str = strings(M.buildOverlayScene({ style: s, width: W, height: H, backgroundSrc: 'data:image/png;base64,BG' }));
  for (const x of ['Uno dos.', 'Tres cuatro.', 'Cinco.']) assert.ok(str.includes(x), x);
  assert.ok(!str.some((x) => x.includes('\n')), 'ningún salto llega a satori');
});

console.log('\n── 3 · las medidas cuentan las líneas forzadas ──');
const subPx = (s) => Math.round((s.slots.subheadline.sizePct / 100) * W * 100) / 100;
test('3a · el alto del bloque suma una línea de bajada por salto; el área crece', () => {
  const a = style(SUB_NO), b = style(SUB_BR);
  const ma = M.measureOverlayText(a, W, H, null), mb = M.measureOverlayText(b, W, H, null);
  const line = subPx(b) * b.slots.subheadline.lineHeight;
  assert.ok(Math.abs((mb.height - ma.height) - line) < 0.02, JSON.stringify({ ma, mb, line }));
  assert.ok(mb.areaPct > ma.areaPct);
  // La caja de la bajada (la que mide el contraste de 1.16.0) también crece.
  const ra = M.overlaySubRect(a, W, H, null, 'bottom_left'), rb = M.overlaySubRect(b, W, H, null, 'bottom_left');
  assert.ok((rb.y1 - rb.y0) - (ra.y1 - ra.y0) > line - 0.02);
});
test('3b · el límite de área: lo que cabía en una línea, con el salto ya no cabe y se ajusta', () => {
  const ma = M.measureOverlayText(style(SUB_NO), W, H, null).areaPct;
  const mb = M.measureOverlayText(style(SUB_BR), W, H, null).areaPct;
  const lim = Math.round(((ma + mb) / 2) * 100) / 100;
  const ra = M.fitOverlayTextArea({ style: style(SUB_NO, { max_text_area_pct: lim }), width: W, height: H, metrics: null });
  const rb = M.fitOverlayTextArea({ style: style(SUB_BR, { max_text_area_pct: lim }), width: W, height: H, metrics: null });
  assert.equal(ra.report.adjusted, false);
  assert.equal(rb.report.adjusted, true);
  assert.ok(rb.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_AREA_REDUCED')));
  // La escalera conserva los cortes de la bajada mientras la bajada se queda.
  if (rb.style.slots.subheadline) assert.deepEqual(rb.style.slots.subheadline.lines, style(SUB_BR).slots.subheadline.lines);
});
test('3c · el ajuste al alto: el hueco donde cabía la bajada en una línea no alcanza con el salto', () => {
  const ha = M.measureOverlayText(style(SUB_NO), W, H, null).height;
  const m = Math.round((7 / 100) * W * 100) / 100;
  const Hc = Math.ceil(ha + 2 * m) + 1;
  const ra = M.fitOverlayTextHeight({ style: style(SUB_NO), width: W, height: Hc, metrics: null });
  const rb = M.fitOverlayTextHeight({ style: style(SUB_BR), width: W, height: Hc, metrics: null });
  assert.equal(ra.report, null, 'sin salto cabe');
  assert.ok(rb.report && rb.report.adjusted, JSON.stringify(rb.report));
});
test('3d · la escalera de caras: una cara justo encima del bloque de una línea la tapa el bloque con el salto', () => {
  const pol = { avoid_faces: { enabled: true, anchors: ['bottom_left'], margin_pct: 0 } };
  const a = style(SUB_NO, pol), b = style(SUB_BR, pol);
  const ra = M.overlayTextRect(a, W, H, null, 'bottom_left'), rb = M.overlayTextRect(b, W, H, null, 'bottom_left');
  assert.ok(rb.y0 < ra.y0 - 10, 'el bloque con el salto empieza más arriba');
  const cara = { x0: ra.x0 / W, y0: (rb.y0 - 4) / H, x1: (ra.x0 + 120) / W, y1: (ra.y0 - 2) / H };
  const ca = M.chooseOverlayAnchor({ style: a, width: W, height: H, faces: [cara] });
  const cb = M.chooseOverlayAnchor({ style: b, width: W, height: H, faces: [cara] });
  assert.equal(ca.report.candidates[0].overlap_pct, 0);
  assert.ok(cb.report.candidates[0].overlap_pct > 0, JSON.stringify(cb.report.candidates[0]));
});
test('3e · `keep_subheadline` y `text_scale` conservan los cortes; la escala agranda cada línea', () => {
  const b = style(SUB_BR);
  const kept = M.fitOverlayTextArea({ style: style(SUB_BR, { max_text_area_pct: 0.5 }), width: W, height: H, metrics: null, keepSubheadline: true });
  assert.ok(kept.style.slots.subheadline, 'la bajada se queda');
  assert.deepEqual(kept.style.slots.subheadline.lines, b.slots.subheadline.lines);
  const sc = M.applyTextScale(b, 1.2);
  assert.deepEqual(sc.slots.subheadline.lines, b.slots.subheadline.lines);
  const h0 = M.measureOverlayText(b, W, H, null).height, h1 = M.measureOverlayText(sc, W, H, null).height;
  assert.ok(h1 > h0);
});

console.log('\n── 4 · un tramo no cruza un salto ──');
test('4a · `splitSubheadlineSpans`: sin tramos que crucen, la salida de `splitEmphasis`; el que cruza va a `missing`', () => {
  for (const t of [['dos'], ['dos', 'cuatro'], ['nada'], []]) assert.deepEqual(M.splitSubheadlineSpans(SUB_BR, t), M.splitEmphasis(SUB_BR, t));
  const r = M.splitSubheadlineSpans(SUB_BR, ['dos.\nTres', 'cuatro', 'nada']);
  assert.deepEqual(r.found, ['cuatro']);
  assert.deepEqual(r.missing, ['dos.\nTres', 'nada'], 'en el orden pedido');
  assert.deepEqual(r.parts.filter((p) => p.keyword).map((p) => p.text), ['cuatro']);
});
test('4b · overlay: resaltado, sombra y cursiva que cruzan un salto se dicen con el aviso de siempre', () => {
  const s = style(SUB_BR, {}, { subEmphasis: ['dos.\nTres', 'cuatro'] });
  assert.ok(s.markers.includes('OVERLAY_SUB_EMPHASIS_NOT_IN_SUBHEADLINE: «dos.\nTres» no está literal en la bajada; ese tramo no se resalta'), s.markers.join(' | '));
  assert.deepEqual(s.slots.subheadline.parts.filter((p) => p.keyword).map((p) => p.text), ['cuatro']);
  const blk = ts({ sub: { shadow_spans: ['dos.\nTres'], italic_spans: ['dos.\nTres', 'Tres'] } }).sub;
  const sh = M.applySlotShadow(style(SUB_BR), 'subheadline', blk);
  assert.ok(sh.style.markers.some((m) => m.startsWith('OVERLAY_SHADOW_SPAN_NOT_IN_SUBHEADLINE: «dos.\nTres»')), sh.style.markers.join(' | '));
  assert.deepEqual(sh.applied.spans, []);
  const it = M.applySlotItalic(style(SUB_BR), 'subheadline', blk);
  assert.ok(it.style.markers.some((m) => m.startsWith('OVERLAY_ITALIC_SPAN_NOT_IN_SUBHEADLINE: «dos.\nTres»')), it.style.markers.join(' | '));
  assert.deepEqual(it.applied.italic, ['Tres']);
  // El tramo que sí está, dentro de su línea, se dibuja en ella.
  const str = strings(M.buildOverlayScene({ style: it.style, width: W, height: H, backgroundSrc: 'data:image/png;base64,BG' }));
  assert.ok(str.some((x) => x.trim() === 'Tres') && !str.some((x) => x.includes('\n')), JSON.stringify(str));
});
test('4c · el titular no cambia: su búsqueda literal es la de siempre', () => {
  const s = M.resolveOverlayStyle({ tokens: tokens(), typography: TYPO, palette: PAL, text: { headline: 'Uno\nDos tres', subheadline: SUB_NO } });
  const it = M.applySlotItalic(s, 'headline', ts({ headline: { italic_spans: ['Uno\nDos'] } }).headline);
  assert.deepEqual(it.applied.italic, ['Uno\nDos']);
});

console.log('\n── 5 · la lámina del carrusel ──');
const CTOK = M.deepMergeTokens(tokens(), {
  palette: {
    keyword: 'trigo', progress_on: 'acento', progress_off: { role: 'claro', alpha: 0.2 }, counter: 'trigo', critical: 'trigo',
    light: 'trigo', muted: { role: 'claro', alpha: 0.5 }, surface: 'tierra', surface_closing: 'arcilla', figure: 'trigo', shade: 'oscuro',
  },
  carousel: {
    canvas: { width: 1000, height: 1250 }, margin_pct: 5,
    typography: {
      headline: { role: 'titular', weight: 700, transform: 'none', line_height: 1, fit_steps: [{ max_chars: 40, size_pct: 10 }, { max_chars: 90, size_pct: 8 }] },
      body: { role: 'cuerpo', weight: 400, size_pct: 4 },
      label: { role: 'rotulo', weight: 600, size_pct: 3, letter_spacing_em: 0.1, transform: 'uppercase' },
      figure: { role: 'titular', weight: 700, size_pct: 25, line_height: 0.9 },
    },
    swipe: { text: 'Glisser' }, logo: { size_pct: 5, height_pct: 6 },
    text_effect: { kind: 'shadow', color: 'shade', alpha: 0.5, blur_pct: 0.8, offset_pct: 0.2 },
  },
});
const chrome = (sub, slide = { index: 2, total: 5, role: 'body', eyebrow: 'Campo' }, over = {}) => M.resolveCarouselChrome({
  tokens: M.deepMergeTokens(CTOK, over), typography: TYPO, palette: PAL, carousel: M.parseCarouselRequest(slide),
  text: { headline: HL, subheadline: sub }, logo: null });
const cscene = (c) => M.buildCarouselScene({ chrome: c, style: M.resolveOverlayStyle({ tokens: CTOK, typography: TYPO, palette: PAL, text: { headline: HL, subheadline: SUB_NO } }), backgroundSrc: null });
const NOLEG = { emphasis_role: null, text_shadow: null, shadow_spans: [] };
const cstyle = (c, raw) => M.applyCarouselTextStyle(c, { ts: ts(raw), legacy: NOLEG, palette: PAL, tokens: CTOK, declared: null });
test('5a · el medidor de la lámina suma una línea de cuerpo por salto (ajuste vertical y caja del bloque)', () => {
  const a = chrome(SUB_NO), b = chrome(SUB_BR);
  const ma = M.measureCarouselLayout(a, null), mb = M.measureCarouselLayout(b, null);
  const B = Math.round((b.type.body.sizePct / 100) * b.canvas.width * 100) / 100;
  assert.ok(Math.abs((mb.mid - ma.mid) - B * b.type.body.lineHeight) < 0.02, JSON.stringify({ a: ma.mid, b: mb.mid, B }));
  assert.ok(mb.slack < ma.slack);
  const ba = M.carouselBlockRect(a, null).rect, bb = M.carouselBlockRect(b, null).rect;
  assert.ok((bb.y1 - bb.y0) > (ba.y1 - ba.y0));
  // Con tramos de cursiva, la misma cuenta.
  const ia = cstyle(a, { sub: { italic_spans: ['cuatro'] } }).chrome, ib = cstyle(b, { sub: { italic_spans: ['cuatro'] } }).chrome;
  assert.ok(Math.abs((M.measureCarouselLayout(ib, null).mid - M.measureCarouselLayout(ia, null).mid) - B * b.type.body.lineHeight) < 0.02);
});
test('5b · el área de la portada cuenta las líneas forzadas y su límite actúa por ellas', () => {
  const cover = { index: 1, total: 5, role: 'cover' };
  const aa = M.carouselTextArea(chrome(SUB_NO, cover), null).areaPct, ab = M.carouselTextArea(chrome(SUB_BR, cover), null).areaPct;
  assert.ok(ab > aa);
  const lim = Math.round(((aa + ab) / 2) * 100) / 100;
  const over = { layout: { max_text_area_pct: lim } };
  assert.equal(M.fitCarouselCoverArea({ chrome: chrome(SUB_NO, cover, over), metrics: null }).warnings.length, 0);
  assert.ok(M.fitCarouselCoverArea({ chrome: chrome(SUB_BR, cover, over), metrics: null }).warnings.some((w) => w.startsWith('CAROUSEL_TEXT_AREA_')));
  const ib = cstyle(chrome(SUB_BR, cover), { sub: { italic_spans: ['cuatro'] } }).chrome;
  assert.equal(M.carouselTextArea(ib, null).areaPct, ab, 'con cursiva simulada se mide con la recta: la misma área');
});
test('5c · la escena de la lámina: una fila por línea escrita; sin `\\n`, el nodo de siempre', () => {
  const str = strings(cscene(chrome('Uno dos.\n\n  Tres cuatro.')));
  assert.ok(str.includes('Uno dos.') && str.includes('Tres cuatro.'));
  assert.ok(!str.some((x) => x.includes('\n')));
  assert.ok(strings(cscene(chrome(SUB_NO))).includes(SUB_NO));
  // Con resaltado y cursiva, cada línea lleva sus átomos.
  const r = cstyle(chrome(SUB_BR), { sub: { emphasis: ['dos.'], italic_spans: ['cuatro'] } });
  const n = nodes(cscene(r.chrome));
  const span = (t) => n.find((x) => x.type === 'span' && x.props?.children === t);
  assert.ok(span('dos.') && span('cuatro'), 'los tramos quedan dentro de su línea');
  assert.equal(span('cuatro').props.style.fontStyle, 'italic');
  // Golden: sin `\n`, la bajada es el nodo de texto de siempre (con su margen y su ancho), no una columna de líneas.
  const plain = nodes(cscene(chrome(SUB_NO))).find((x) => x.props?.children === SUB_NO);
  assert.ok(plain && 'marginTop' in plain.props.style && plain.props.style.flexDirection === undefined);
  const col = nodes(cscene(chrome(SUB_BR))).find((x) => x.props?.style?.flexDirection === 'column' && Array.isArray(x.props.children)
    && x.props.children.some((c) => c.props?.children === 'Uno dos.'));
  assert.ok(col && col.props.children.length === 2, 'una columna con una fila por línea');
  assert.equal(sha(cscene(chrome(SUB_NO))), sha(cscene(chrome(SUB_NO))), 'determinista');
});
test('5d · lámina: resaltado, sombra y cursiva que cruzan un salto se dicen con el aviso de siempre', () => {
  const r = cstyle(chrome(SUB_BR), { sub: { emphasis: ['dos.\nTres'], shadow_spans: ['dos.\nTres'], italic_spans: ['dos.\nTres'] } });
  assert.ok(r.warnings.some((w) => w.startsWith('CAROUSEL_SUB_EMPHASIS_NOT_IN_SUBHEADLINE: «dos.\nTres»')), r.warnings.join(' | '));
  assert.ok(r.warnings.some((w) => w.startsWith('CAROUSEL_SHADOW_SPAN_NOT_FOUND: «dos.\nTres»')), r.warnings.join(' | '));
  assert.ok(r.warnings.some((w) => w.startsWith('CAROUSEL_ITALIC_SPAN_NOT_IN_SUBHEADLINE: «dos.\nTres»')), r.warnings.join(' | '));
  assert.equal(r.chrome.subParts, undefined); assert.equal(r.chrome.subItalic, undefined);
});

console.log('\n── 6 · eco, versión, marca N+1 y voseo ──');
test('6a · `meta.sub_breaks` y `meta.carousel.sub_breaks` sólo si la bajada trae `\\n`; 0 si una escalera la quitó', () => {
  assert.match(SRC, /const subBreaksIn = subheadline != null \? subheadlineBreaks\(subheadline\) : null;/);
  assert.match(SRC, /\.\.\.\(subBreaksIn != null \? \{ sub_breaks: finalStyle\.slots\.subheadline \? subBreaksIn : 0 \} : \{\}\),/);
  assert.match(SRC, /\.\.\.\(subBreaksIn != null \? \{ sub_breaks: fit\.chrome\.subheadline \? subBreaksIn : 0 \} : \{\}\),/);
  assert.ok(SRC.indexOf('const subBreaksIn = ') < SRC.indexOf('const [tokenRows, typography, palette] = await Promise.all(['), 'antes de leer dato');
});
test('6b · la versión sube a 1.20.0 y la historia lo cuenta', () => {
  assert.match(SRC, /COMPOSITOR_VERSION = '1\.20\.0'/);
  assert.ok(SRC.includes('//   1.20.0 (2026-10-28) — LA BAJADA RESPETA SUS SALTOS DE LÍNEA'));
  assert.equal(M.COMPOSITOR_VERSION, '1.20.0');
});
test('6c · el bloque nuevo no nombra marcas, ciudades ni familias, y nadie vosea', () => {
  const ini = SRC.indexOf('// ── 1.20.0 · LA BAJADA CON SALTOS DE LÍNEA');
  const blk = SRC.slice(ini, SRC.indexOf('export function headlineAtoms', ini));
  assert.ok(blk.length > 1500);
  const hist = SRC.slice(SRC.indexOf('//   1.20.0 (2026-10-28)'), SRC.indexOf("export const COMPOSITOR_VERSION = '"));
  const own = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  for (const t of [blk, hist]) {
    assert.ok(!/neurone|forum|unrealville|lucien|panam|miami|madrid|garamond|bebas|baskerville|playfair|inter\b/i.test(t));
  }
  assert.deepEqual(formasVoseantes(blk + hist), []);
  assert.deepEqual(formasVoseantes(own), []);
});

console.log(`\n${fails.length ? '✗' : '✓'} ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
