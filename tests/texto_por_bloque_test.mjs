// 1.16.0 — CADA BLOQUE DEL TEXTO TIENE LO SUYO, Y LA BAJADA SE PROTEGE SOLA. Test del bloque PURO y del cableado.
//
// EL CASO (Sam, 2026-10-23, pieza affe6b7c): «debo poder decidir según el title combinación de resaltado, colores de
// franja o resaltado, pero ahora veo que también color del texto cuando sea necesario… y lo mismo y aparte para la última
// oración del embedded text… quisiera poder definir el grueso de la sombra»; y «sí a todo, carrusel también y que la
// bajada se proteja sola». La bajada salió en el gris de la marca sobre un cielo claro y no se leía.
//
// QUÉ AFIRMA.
//   1. Contrato: `text_style` es { headline?, sub? } con sus campos; cualquier otro es 400 con etiqueta.
//   2. GOLDEN: sin `text_style` (ni el token), el estilo, el cromo y la escena son EXACTAMENTE los de 1.15.0.
//   3. Color del texto por bloque, de la lista de la marca; fuera de ella no se aplica y se dice.
//   4. La bajada se resalta con sus tramos y su color.
//   5. La sombra por bloque: 'off' sólo en ese bloque, 'on' con la declarada, tramos al revés y grosor.
//   6. La bajada se protege sola: gris sobre fondo claro ⇒ el neutro de la marca que más contrasta.
//   7. Lámina de carrusel: lo mismo sobre su cromo; y los campos sueltos de 1.8.0–1.9.0 por fin la alcanzan.
//   8. Cableado del handler.
//   9. Marca N+1: el bloque nuevo no nombra marcas.
//  10. 1.18.0 — CURSIVA POR TRAMO: `italic_spans` por bloque invierte la cursiva de lo que tiene debajo, en el overlay y
//      en la lámina; la cara que falta se simula inclinando la recta; cada tramo se mide con la métrica de su estilo.
//  12. 1.22.0 — NEGRITA POR TRAMO: `bold_spans` por bloque invierte el peso (regular → 700, negrita → 400), en el overlay y
//      en la lámina; la cara de ese peso se pide y se mide; si falta, el tramo queda con su peso y se dice.
//  11. 1.21.0 — COLOR POR TRAMO: `color_spans` por bloque cambia SÓLO el color (misma familia, caja y tamaño), con el
//      color del resaltado de ese bloque; en el overlay y en la lámina; no cambia ninguna medida.
//
// Ejecutar:  node tests/texto_por_bloque_test.mjs     (Node ≥ 22.18)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'compose.ts'), 'utf8');
const BEGIN = '// ── COMPOSITOR:BEGIN ──', END = '// ── COMPOSITOR:END ──';
const dir = mkdtempSync(join(tmpdir(), 'texto-por-bloque-'));
const mod = join(dir, 'block.mts');
writeFileSync(mod, SRC.slice(SRC.indexOf(BEGIN), SRC.indexOf(END) + END.length) + '\n', 'utf8');
const M = await import(pathToFileURL(mod).href);

let pass = 0; const fails = [];
const test = (n, f) => { try { f(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fails.push(n); console.log(`  ✗ ${n}\n    ${e.message}`); } };
const sha = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

// ── Marca INVENTADA (otro rubro, otro idioma): el eje no depende de ninguna marca real ──
const TYPO = [
  { role: 'titular', font_family: 'Fuente Titular' }, { role: 'texto', font_family: 'Fuente Texto' }, { role: 'rotulo', font_family: 'Fuente Rotulo' },
];
const PAL = [
  { role: 'lino', hex: '#F4EFE6' }, { role: 'gris', hex: '#B8B0A8' }, { role: 'tinta', hex: '#141210' },
  { role: 'trigo', hex: '#D9A441' }, { role: 'hoja', hex: '#2F7A3D' }, { role: 'tierra', hex: '#3B2A1E' },
];
const SHADOW = { kind: 'shadow', color: '#000000', alpha: 0.4, blur_pct: 0.7, offset_pct: 0.15 };
const baseTokens = (layout = {}, extra = {}) => M.deepMergeTokens({
  layout: { anchor: 'bottom_left', margin_pct: 7, max_width_pct: 78, gap_pct: 2.4, text_effect: SHADOW,
    emphasis_contrast: { min_contrast: 3, fallbacks: ['hoja'] } },
  typography: {
    headline: { role: 'titular', emphasis: { italic: true, size_scale: 1.2 }, fit_steps: [{ max_chars: 120, size_pct: 6 }] },
    subheadline: { role: 'texto', fit_steps: [{ max_chars: 160, size_pct: 3 }] },
  },
  palette: { headline: 'lino', subheadline: 'gris', headline_emphasis: 'trigo' },
}, M.deepMergeTokens({ layout }, extra));
const TEXT = { headline: 'El precio de la cosecha está bajando', subheadline: 'No fue el clima. Fue el vecino que no pagó.' };
const resolve = (tok = baseTokens(), text = TEXT) => M.resolveOverlayStyle({ tokens: tok, typography: TYPO, palette: PAL, text });
const ts = (raw) => M.parseTextStyleRequest(raw);
const W = 1024, H = 1024;
const scene = (style) => M.buildOverlayScene({ style, width: W, height: H, backgroundSrc: 'data:image/png;base64,BG' });
const nodes = (n, out = []) => { if (n && typeof n === 'object') { out.push(n); const c = n.props?.children; if (Array.isArray(c)) c.forEach((x) => nodes(x, out)); else nodes(c, out); } return out; };
const textNodeOf = (sc, txt) => nodes(sc).find((n) => n.props?.children === txt);
const allShadowsUnder = (n) => nodes(n).map((x) => x.props?.style?.textShadow).filter(Boolean);

console.log('\n── 1 · contrato ──');
test('1a · ausente ⇒ los dos bloques vacíos', () => {
  for (const v of [undefined, null]) {
    const r = ts(v);
    assert.equal(M.textBlockRequested(r.headline), false); assert.equal(M.textBlockRequested(r.sub), false);
  }
});
test('1b · la forma válida se normaliza', () => {
  const r = ts({ headline: { role: 'tinta', shadow_strength: 'strong' }, sub: { emphasis: ['el vecino'], emphasis_role: 'hoja', role: 'lino', text_shadow: 'on', shadow_spans: ['No fue'], shadow_strength: 'heavy' } });
  // 1.18.0 — la forma normalizada lleva además `italic_spans` (vacío si no llega). 1.21.0 — y `color_spans`.
  assert.deepEqual(r.headline, { role: 'tinta', emphasis: [], emphasis_role: null, text_shadow: null, shadow_spans: [], shadow_strength: 'strong', italic_spans: [], color_spans: [], bold_spans: [] });
  assert.deepEqual(r.sub, { role: 'lino', emphasis: ['el vecino'], emphasis_role: 'hoja', text_shadow: 'on', shadow_spans: ['No fue'], shadow_strength: 'heavy', italic_spans: [], color_spans: [], bold_spans: [] });
  assert.deepEqual(Object.keys(M.SHADOW_STRENGTHS), ['soft', 'brand', 'strong', 'heavy']);
});
test('1c · lo que no es contrato es 400 con etiqueta, antes de leer dato', () => {
  const bad = [
    'x', [], { otro: {} }, { headline: 3 }, { headline: { emphasis: ['x'] } }, { headline: { role: 'Tinta' } },
    { sub: { text_shadow: 'si' } }, { sub: { shadow_strength: 'enorme' } }, { sub: { emphasis: 'x' } }, { sub: { color: 'x' } },
    { sub: { emphasis: ['a', 'b', 'c', 'd'] } },
  ];
  for (const v of bad) assert.throws(() => ts(v), (e) => e.label === 'COMPOSITOR_TEXT_STYLE_INVALID' && e.status === 400, JSON.stringify(v));
});

console.log('\n── 2 · golden: sin text_style, lo de 1.15.0 ──');
test('2a · applyTextStyleBlocks sin nada devuelve EL MISMO estilo y la escena no cambia', () => {
  const s = resolve();
  const r = M.applyTextStyleBlocks(s, ts(null), PAL, baseTokens());
  assert.equal(r.style, s); assert.equal(r.applied, null);
  assert.equal(sha(scene(r.style)), sha(scene(s)));
});
test('2b · sin `subEmphasis` la bajada no lleva tramos, y sin el token no hay protección', () => {
  const s = resolve();
  assert.equal('parts' in s.slots.subheadline, false); assert.equal('emphasis' in s.slots.subheadline, false);
  assert.equal('subContrast' in s.layout, false);
});
test('2c · scaleTextEffect con factor 1 o sin factor devuelve EL MISMO objeto', () => {
  const te = { color: 'rgba(0, 0, 0, 0.4)', blurPct: 0.7, offsetPct: 0.15 };
  assert.equal(M.scaleTextEffect(te, 1), te); assert.equal(M.scaleTextEffect(te, undefined), te);
});

console.log('\n── 3 · color del texto por bloque ──');
test('3a · los colores de texto: los suyos, los extremos de la paleta (sin text_options) y los accent', () => {
  assert.deepEqual(M.textNeutralRoles(baseTokens(), PAL), ['lino', 'gris', 'tinta']);
  assert.deepEqual(M.textAllowedRoles(baseTokens(), PAL), ['lino', 'gris', 'tinta', 'trigo', 'hoja']);
  const conOpciones = baseTokens({}, { palette: { text_options: ['tierra'] } });
  assert.deepEqual(M.textNeutralRoles(conOpciones, PAL), ['lino', 'gris', 'tierra']);
});
test('3b · titular en tinta y bajada en lino', () => {
  const r = M.applyTextStyleBlocks(resolve(), ts({ headline: { role: 'tinta' }, sub: { role: 'lino' } }), PAL, baseTokens());
  assert.equal(r.style.slots.headline.color, 'rgb(20, 18, 16)');
  assert.equal(r.style.slots.subheadline.color, 'rgb(244, 239, 230)');
  assert.equal(r.applied.headline.role, 'tinta'); assert.equal(r.applied.sub.role, 'lino');
});
test('3c · un rol fuera de la lista no se aplica y se dice', () => {
  const s = resolve();
  const r = M.applyTextStyleBlocks(s, ts({ sub: { role: 'rojo' } }), PAL, baseTokens());
  assert.equal(r.style.slots.subheadline.color, s.slots.subheadline.color);
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_ROLE_NOT_ALLOWED')));
});

console.log('\n── 4 · el resaltado de la bajada ──');
test('4a · los tramos de la bajada se resaltan con el color de resaltado de la marca', () => {
  const s = resolve(baseTokens(), { ...TEXT, subEmphasis: ['el vecino que no pagó'] });
  const sub = s.slots.subheadline;
  assert.deepEqual(sub.parts.filter((p) => p.keyword).map((p) => p.text), ['el vecino que no pagó']);
  assert.equal(sub.emphasis.color, 'rgb(217, 164, 65)');
  assert.equal(sub.emphasis.sizeScale, 1, 'sin tipografía de énfasis declarada, la de la bajada');
});
test('4b · el color elegido para el resaltado de la bajada, sólo de los accent de la marca', () => {
  const s = resolve(baseTokens(), { ...TEXT, subEmphasis: ['el vecino'] });
  const ok = M.applyTextStyleBlocks(s, ts({ sub: { emphasis: ['el vecino'], emphasis_role: 'hoja' } }), PAL, baseTokens());
  assert.equal(ok.style.slots.subheadline.emphasis.color, 'rgb(47, 122, 61)');
  const no = M.applyTextStyleBlocks(s, ts({ sub: { emphasis: ['el vecino'], emphasis_role: 'tinta' } }), PAL, baseTokens());
  assert.ok(no.style.markers.some((m) => m.startsWith('OVERLAY_SUB_EMPHASIS_ROLE_NOT_ALLOWED')));
});
test('4c · un tramo que no está en la bajada no se resalta y se dice', () => {
  const s = resolve(baseTokens(), { ...TEXT, subEmphasis: ['no existe'] });
  assert.equal('parts' in s.slots.subheadline, false);
  assert.ok(s.markers.some((m) => m.startsWith('OVERLAY_SUB_EMPHASIS_NOT_IN_SUBHEADLINE')));
});

console.log('\n── 5 · la sombra por bloque ──');
test("5a · 'off' sólo en la bajada: el titular conserva la suya", () => {
  const r = M.applyTextStyleBlocks(resolve(), ts({ sub: { text_shadow: 'off' } }), PAL, baseTokens());
  const sc = scene(r.style);
  const hl = textNodeOf(sc, TEXT.headline), sb = textNodeOf(sc, TEXT.subheadline);
  assert.ok(hl.props.style.textShadow, 'el titular lleva sombra');
  assert.equal(sb.props.style.textShadow, undefined, 'la bajada no');
});
test('5b · el grosor escala la sombra: heavy más gruesa que la de la marca, soft más fina', () => {
  const brand = textNodeOf(scene(resolve()), TEXT.subheadline).props.style.textShadow;
  const heavy = textNodeOf(scene(M.applyTextStyleBlocks(resolve(), ts({ sub: { shadow_strength: 'heavy' } }), PAL, baseTokens()).style), TEXT.subheadline).props.style.textShadow;
  const soft = textNodeOf(scene(M.applyTextStyleBlocks(resolve(), ts({ sub: { shadow_strength: 'soft' } }), PAL, baseTokens()).style), TEXT.subheadline).props.style.textShadow;
  const blur = (s) => Number(s.match(/0px 0px ([\d.]+)px/)[1]);
  assert.ok(blur(heavy) > blur(brand) && blur(brand) > blur(soft), `${soft} < ${brand} < ${heavy}`);
  assert.match(heavy, /rgba\(0, 0, 0, 1\)|rgb\(0, 0, 0\)/, 'y más opaca');
});
test("5c · 'on' sin sombra declarada no inventa una y se dice", () => {
  const tok = baseTokens(); delete tok.layout.text_effect;
  const r = M.applyTextStyleBlocks(resolve(tok), ts({ headline: { text_shadow: 'on' } }), PAL, tok);
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_SHADOW_NOT_DECLARED')));
  assert.equal(r.style.slots.headline.shadowMode, undefined);
});
test('5d · tramos de la bajada con la sombra al revés', () => {
  const r = M.applyTextStyleBlocks(resolve(), ts({ sub: { shadow_spans: ['No fue el clima.'] } }), PAL, baseTokens());
  assert.deepEqual(r.style.slots.subheadline.shadowFlip, [[0, 16]]);
  const sb = nodes(scene(r.style)).filter((n) => n.type === 'span' && /No|fue|clima/.test(String(n.props.children)));
  assert.ok(sb.length && sb.every((n) => !n.props.style.textShadow), 'el tramo marcado va sin la sombra que el resto lleva');
});
test('5e · los tramos sueltos (1.9.0) siguen siendo del titular', () => {
  const s = M.applyTextShadowRequest(resolve(), null, ['está bajando']).style;
  assert.ok(s.slots.headline.shadowFlip?.length); assert.equal(s.slots.subheadline.shadowFlip, undefined);
});

console.log('\n── 6 · la bajada se protege sola ──');
const LIGHT_SKY = Array.from({ length: 200 }, () => M.relLuminanceRgb(200, 225, 245));
test('6a · gris sobre cielo claro ⇒ el neutro que más contrasta (la tinta)', () => {
  const d = M.decideSubheadlineColor({ currentColor: 'rgb(184, 176, 168)', bgLuminances: LIGHT_SKY, minContrast: 4.5,
    candidates: [{ role: 'lino', hex: '#F4EFE6' }, { role: 'gris', hex: '#B8B0A8' }, { role: 'tinta', hex: '#141210' }] });
  assert.equal(d.changed, true); assert.equal(d.role, 'tinta'); assert.ok(d.contrast_after >= 4.5, JSON.stringify(d));
});
test('6b · si ya se lee, no se toca', () => {
  const dark = Array.from({ length: 50 }, () => M.relLuminanceRgb(20, 20, 30));
  const d = M.decideSubheadlineColor({ currentColor: 'rgb(244, 239, 230)', bgLuminances: dark, minContrast: 4.5, candidates: [{ role: 'tinta', hex: '#141210' }] });
  assert.equal(d.changed, false);
});
test('6c · el token: sin fallbacks, los neutros de la marca; con un rol que no existe, falla nombrando', () => {
  const s = resolve(baseTokens({ subheadline_contrast: { min_contrast: 4.5 } }));
  assert.deepEqual(s.layout.subContrast.candidates.map((c) => c.role), ['lino', 'gris', 'tinta']);
  assert.throws(() => resolve(baseTokens({ subheadline_contrast: { min_contrast: 4.5, fallbacks: ['nada'] } })), (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE');
  assert.throws(() => resolve(baseTokens({ subheadline_contrast: { min_contrast: 40 } })), (e) => e.label === 'COMPOSITOR_TOKENS_INCOMPLETE');
});
test('6d · la caja de la bajada es la parte de abajo del bloque', () => {
  const s = resolve();
  const block = M.overlayTextRect(s, W, H, null, s.layout.anchor);
  const sub = M.overlaySubRect(s, W, H, null, s.layout.anchor);
  assert.ok(sub.y0 > block.y0 && sub.y1 === block.y1 && sub.x0 === block.x0, JSON.stringify({ block, sub }));
});

console.log('\n── 7 · lámina de carrusel ──');
const CTOK = M.deepMergeTokens(baseTokens(), {
  palette: { keyword: 'trigo', progress_on: 'hoja', progress_off: { role: 'lino', alpha: 0.2 }, counter: 'lino', critical: 'trigo',
    light: 'trigo', muted: { role: 'lino', alpha: 0.5 }, surface: 'tierra', figure: 'trigo', text: 'lino', text_soft: 'gris', shade: 'tierra' },
  carousel: {
    canvas: { width: 1000, height: 1250 }, margin_pct: 5,
    typography: {
      headline: { role: 'titular', weight: 700, line_height: 1, fit_steps: [{ max_chars: 90, size_pct: 8 }] },
      body: { role: 'texto', weight: 400, size_pct: 4 }, label: { role: 'rotulo', weight: 600, size_pct: 3 }, figure: { role: 'titular', size_pct: 25 },
    },
    swipe: { text: 'Deslizar' }, text_effect: { kind: 'shadow', color: 'shade', alpha: 0.5, blur_pct: 0.8, offset_pct: 0.2 },
  },
});
const chromeOf = () => M.resolveCarouselChrome({ tokens: CTOK, typography: TYPO, palette: PAL,
  carousel: M.parseCarouselRequest({ index: 2, total: 4, role: 'body', keyword: 'cosecha' }), text: TEXT, logo: null });
const cscene = (chrome) => M.buildCarouselScene({ chrome, style: resolve(CTOK), backgroundSrc: 'data:image/png;base64,BG' });
const NOLEG = { emphasis_role: null, text_shadow: null, shadow_spans: [] };
test('7a · golden: sin nada, EL MISMO cromo y la misma escena', () => {
  const c = chromeOf();
  const r = M.applyCarouselTextStyle(c, { ts: ts(null), legacy: NOLEG, palette: PAL, tokens: CTOK, declared: null });
  assert.equal(r.chrome, c); assert.equal(r.applied, null);
  assert.equal(sha(cscene(r.chrome)), sha(cscene(c)));
});
test('7b · colores del titular, de la palabra clave y de la bajada', () => {
  const r = M.applyCarouselTextStyle(chromeOf(), { ts: ts({ headline: { role: 'tinta', emphasis_role: 'hoja' }, sub: { role: 'lino' } }), legacy: NOLEG, palette: PAL, tokens: CTOK, declared: null });
  assert.equal(r.chrome.colors.headline, 'rgb(20, 18, 16)');
  assert.equal(r.chrome.colors.keyword, 'rgb(47, 122, 61)');
  assert.equal(r.chrome.colors.subheadline, 'rgb(244, 239, 230)');
  const sub = textNodeOf(cscene(r.chrome), TEXT.subheadline);
  assert.equal(sub.props.style.color, 'rgb(244, 239, 230)');
});
test('7c · la bajada se resalta en la lámina', () => {
  const r = M.applyCarouselTextStyle(chromeOf(), { ts: ts({ sub: { emphasis: ['el vecino'] } }), legacy: NOLEG, palette: PAL, tokens: CTOK, declared: null });
  assert.deepEqual(r.applied.sub.highlighted, ['el vecino']);
  const spans = nodes(cscene(r.chrome)).filter((n) => n.type === 'span' && /vecino/.test(String(n.props.children)));
  assert.equal(spans[0].props.style.color, 'rgb(217, 164, 65)');
});
test("7d · 'off' en la bajada de la lámina: el titular conserva la sombra de la lámina", () => {
  const r = M.applyCarouselTextStyle(chromeOf(), { ts: ts({ sub: { text_shadow: 'off' } }), legacy: NOLEG, palette: PAL, tokens: CTOK, declared: null });
  const sc = cscene(r.chrome);
  assert.equal(textNodeOf(sc, TEXT.subheadline).props.style.textShadow, undefined);
  const head = nodes(sc).find((n) => n.props?.style?.width && n.props?.style?.flexWrap === 'wrap' && n.props.style.color === r.chrome.colors.headline);
  assert.ok(head.props.style.textShadow, 'el titular la lleva');
});
test('7e · los campos sueltos de 1.8.0 por fin llegan a la lámina', () => {
  const r = M.applyCarouselTextStyle(chromeOf(), { ts: ts(null), legacy: { emphasis_role: 'hoja', text_shadow: null, shadow_spans: [] }, palette: PAL, tokens: CTOK, declared: null });
  assert.equal(r.chrome.colors.keyword, 'rgb(47, 122, 61)');
});

console.log('\n── 8 · cableado ──');
test('8a · el handler valida text_style con el contrato y aplica los bloques tras la sombra suelta', () => {
  assert.match(SRC, /const textStyleIn = parseTextStyleRequest\(body\.text_style\);/);
  const a = SRC.indexOf('applyTextShadowRequest(identityApplied.style, textShadowIn, legacySpans)');
  const b = SRC.indexOf('const block = applyTextStyleBlocks(');
  assert.ok(a > 0 && b > a);
  assert.match(SRC, /subEmphasis: textStyleIn\.sub\.emphasis/);
});
test('8b · la bajada se mide ANTES de decidir la sombra, y no si una persona eligió su color', () => {
  const i = SRC.indexOf('const d = decideSubheadlineColor({ currentColor: finalStyle.slots.subheadline!.color');
  const j = SRC.indexOf('const d = decideTextEffect({ textHexes');
  assert.ok(i > 0 && j > i);
  assert.match(SRC, /!block\.applied\?\.sub\?\.role \? finalStyle\.layout\.subContrast : null/);
  assert.match(SRC, /!textStyleIn\.sub\.role\) \{/);
});
test('8c · la lámina aplica lo elegido y lo devuelve en meta', () => {
  assert.match(SRC, /const cts = applyCarouselTextStyle\(chrome0, \{ ts: textStyleIn,/);
  assert.match(SRC, /\.\.\.\(cts\.applied \? \{ text_style: \{ requested: textStyleIn, applied: cts\.applied \} \} : \{\}\),/);
  assert.match(SRC, /\.\.\.\(block\.applied \? \{ text_style: \{ requested: textStyleIn, applied: block\.applied \} \} : \{\}\),/);
});
test('8d · la versión sube a 1.16.0 o después', () => { assert.match(SRC, /COMPOSITOR_VERSION = '1\.(1[6-9]|[2-9]\d)\.\d+'/); });

console.log('\n── 9 · marca N+1 ──');
test('9 · el bloque nuevo no nombra marcas ni ciudades', () => {
  const ini = SRC.indexOf('// ── 1.16.0 · CADA BLOQUE DEL TEXTO TIENE LO SUYO');
  const fin = SRC.indexOf('export function parseEmphasisRequest', ini);
  const ini2 = SRC.indexOf('// ── 1.16.0 · LO ELEGIDO POR BLOQUE, EN LA LÁMINA');
  const blk = SRC.slice(ini, fin) + SRC.slice(ini2, SRC.indexOf('/**\n * El titular, en «átomos»', ini2));
  assert.ok(blk.length > 2000);
  assert.ok(!/neurone|forum|unrealville|lucien|panam|miami/i.test(blk));
});

console.log('\n── 10 · 1.18.0 · cursiva por tramo ──');
const ITOK = (over = {}) => baseTokens({}, over);
const resolveI = (tok = ITOK(), text = TEXT) => resolve(tok, text);
const spanStyle = (sc, t) => nodes(sc).find((n) => n.type === 'span' && String(n.props.children).replace(/ $/, '') === t)?.props.style;
test('10a · contrato: `italic_spans` se acepta en los dos bloques, con los límites de `shadow_spans`', () => {
  const r = ts({ headline: { italic_spans: ['cosecha'] }, sub: { italic_spans: ['el clima', 'el vecino'] } });
  assert.deepEqual(r.headline.italic_spans, ['cosecha']); assert.deepEqual(r.sub.italic_spans, ['el clima', 'el vecino']);
  assert.equal(M.textBlockRequested(r.headline), true);
  for (const v of [{ headline: { italic_spans: ['a', 'b', 'c', 'd'] } }, { sub: { italic_spans: 'x' } }, { sub: { italic_spans: [3] } },
    { headline: { italic_spans: ['x'.repeat(61)] } }, { headline: { italics: ['x'] } }]) {
    assert.throws(() => ts(v), (e) => e.label === 'COMPOSITOR_TEXT_STYLE_INVALID' && e.status === 400, JSON.stringify(v));
  }
});
test('10b · golden: sin `italic_spans` la ranura no lleva tramos, no se pide ninguna cara y la escena es la misma', () => {
  const s = resolveI();
  const r = M.applyTextStyleBlocks(s, ts({ headline: { role: 'tinta' } }), PAL, ITOK());
  assert.equal(r.style.slots.headline.italicFlip, undefined); assert.equal(r.style.slots.subheadline.italicFlip, undefined);
  assert.deepEqual(r.applied.headline.italic, []); assert.deepEqual(r.applied.sub.italic, []);
  assert.deepEqual(M.overlayItalicFacesNeeded(r.style), []);
  assert.equal(M.withItalicFallback(s, {}), s);
  const only = M.applyTextStyleBlocks(s, ts({ headline: { role: 'tinta' } }), PAL, ITOK()).style;
  assert.equal(sha(scene(only)), sha(scene(r.style)));
});
test('10c · sobre texto recto, el tramo sale en cursiva y el resto queda recto; `applied.italic` lo dice', () => {
  const r = M.applyTextStyleBlocks(resolveI(), ts({ headline: { italic_spans: ['cosecha'] }, sub: { italic_spans: ['el vecino'] } }), PAL, ITOK());
  assert.deepEqual(r.applied.headline.italic, ['cosecha']); assert.deepEqual(r.applied.sub.italic, ['el vecino']);
  const sc = scene(r.style);
  assert.equal(spanStyle(sc, 'cosecha').fontStyle, 'italic'); assert.equal(spanStyle(sc, 'precio').fontStyle, 'normal');
  assert.equal(spanStyle(sc, 'vecino').fontStyle, 'italic'); assert.equal(spanStyle(sc, 'clima.').fontStyle, 'normal');
  const sub = nodes(sc).find((n) => n.props?.style?.fontFamily === 'Fuente Texto');
  assert.ok(sub.props.style.textShadow, 'sin tramos de sombra, la ranura conserva su sombra');
});
test('10d · lo que no está literal no se aplica y se dice, en el titular y en la bajada', () => {
  const r = M.applyTextStyleBlocks(resolveI(), ts({ headline: { italic_spans: ['granizo'] }, sub: { italic_spans: ['la lluvia'] } }), PAL, ITOK());
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_ITALIC_SPAN_NOT_IN_HEADLINE: «granizo»')));
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_ITALIC_SPAN_NOT_IN_SUBHEADLINE: «la lluvia»')));
  assert.deepEqual(r.applied.headline.italic, []);
  const sinBajada = M.applyTextStyleBlocks(resolveI(ITOK(), { headline: TEXT.headline }), ts({ sub: { italic_spans: ['x'] } }), PAL, ITOK());
  assert.ok(sinBajada.style.markers.some((m) => m.startsWith('OVERLAY_ITALIC_SPAN_NOT_IN_SUBHEADLINE')));
});
test('10e · sobre una ranura en cursiva, el tramo sale recto', () => {
  const tok = ITOK({ typography: { subheadline: { italic: true } } });
  const r = M.applyTextStyleBlocks(resolveI(tok), ts({ sub: { italic_spans: ['el vecino'] } }), PAL, tok);
  const sc = scene(r.style);
  assert.equal(spanStyle(sc, 'vecino').fontStyle, 'normal'); assert.equal(spanStyle(sc, 'clima.').fontStyle, 'italic');
  assert.deepEqual(M.overlayItalicFacesNeeded(r.style).map((x) => x.key), ['Fuente Texto|400|normal']);
});
test('10f · sobre un resaltado en cursiva, el tramo sale recto; fuera del resaltado, en cursiva', () => {
  const s = resolveI(ITOK(), { ...TEXT, emphasis: ['está bajando'] });
  const r = M.applyTextStyleBlocks(s, ts({ headline: { italic_spans: ['bajando', 'precio'] } }), PAL, ITOK());
  const sc = scene(r.style);
  assert.equal(spanStyle(sc, 'bajando').fontStyle, 'normal', 'resaltado en cursiva ⇒ recto');
  assert.equal(spanStyle(sc, 'está').fontStyle, 'italic', 'el resto del resaltado sigue en cursiva');
  assert.equal(spanStyle(sc, 'precio').fontStyle, 'italic', 'fuera del resaltado, recto ⇒ cursiva');
  assert.equal(spanStyle(sc, 'cosecha').fontStyle, 'normal');
});
test('10g · un tramo con la sombra al revés y la cursiva a la vez lleva las dos cosas', () => {
  const r = M.applyTextStyleBlocks(resolveI(), ts({ headline: { shadow_spans: ['la cosecha'], italic_spans: ['cosecha está'] } }), PAL, ITOK());
  const sc = scene(r.style);
  const cos = spanStyle(sc, 'cosecha'), la = spanStyle(sc, 'la'), esta = spanStyle(sc, 'está');
  assert.equal(cos.fontStyle, 'italic'); assert.equal(cos.textShadow, undefined, 'el tramo marcado va sin la sombra que el resto lleva');
  assert.equal(la.fontStyle, 'normal'); assert.equal(la.textShadow, undefined);
  assert.equal(esta.fontStyle, 'italic'); assert.ok(esta.textShadow, 'fuera del tramo de sombra, la sombra de siempre');
});
test('10h · sin cara cursiva, el tramo se dibuja con la recta inclinada', () => {
  const r = M.applyTextStyleBlocks(resolveI(), ts({ headline: { italic_spans: ['cosecha'] } }), PAL, ITOK());
  const need = M.overlayItalicFacesNeeded(r.style)[0];
  const fb = M.italicFallbackFor(need);
  assert.equal(fb.marker, 'OVERLAY_ITALIC_SYNTHESIZED: Fuente Titular no tiene cursiva; se inclinó');
  const st = M.withItalicFallback(r.style, { [need.baseKey]: fb.fallback });
  const cos = spanStyle(scene(st), 'cosecha');
  assert.equal(cos.fontStyle, 'normal'); assert.equal(cos.transform, 'skewX(-10deg)');
  assert.equal(spanStyle(scene(st), 'precio').transform, undefined);
});
// Métricas sintéticas: la recta mide 0,5 em por carácter; la cursiva, 0,7 em. Lo que se mide es CUÁL se usa.
const adv = (em) => ({ advances: new Map(Array.from({ length: 0x250 }, (_, c) => [c, em])), avgEm: em });
const METRICS = { 'Fuente Titular|400|normal': adv(0.5), 'Fuente Titular|400|italic': adv(0.7), 'Fuente Texto|400|normal': adv(0.5), 'Fuente Texto|400|italic': adv(0.7) };
test('10i · la medición usa la métrica de la cara cursiva; la simulada, la de la recta', () => {
  const tok = ITOK({ typography: { headline: { emphasis: null } } });
  const plain = resolveI(tok, { headline: 'la cosecha' });
  const it = M.applyTextStyleBlocks(plain, ts({ headline: { italic_spans: ['la cosecha'] } }), PAL, tok).style;
  const w0 = M.measureOverlayText(plain, W, H, METRICS).width;
  const w1 = M.measureOverlayText(it, W, H, METRICS).width;
  assert.ok(Math.abs(w1 / w0 - 0.7 / 0.5) < 0.01, `${w0} → ${w1}`);
  const key = M.overlayItalicFacesNeeded(it)[0].baseKey;
  const synth = M.withItalicFallback(it, { [key]: 'skew' });
  assert.equal(M.measureOverlayText(synth, W, H, METRICS).width, w0, 'inclinar no cambia el avance');
  const atoms = M.overlaySlotAtoms(it.slots.headline, W, METRICS, [], it.italicFallback);
  const atoms0 = M.overlaySlotAtoms(plain.slots.headline, W, METRICS, []);
  assert.ok(atoms[0].atoms[0].w > atoms0[0].atoms[0].w);
  const est = [];
  M.measureOverlayText(it, W, H, { 'Fuente Titular|400|normal': adv(0.5) }).estimated.forEach((x) => est.push(x));
  assert.deepEqual(est, ['Fuente Titular'], 'sin la métrica cursiva, la medición se dice estimada');
});
test('10j · lámina: el titular y la bajada invierten la cursiva, se miden con su cara y lo dicen', () => {
  const r = M.applyCarouselTextStyle(chromeOf(), { ts: ts({ headline: { italic_spans: ['precio'] }, sub: { italic_spans: ['el vecino', 'granizo'] } }), legacy: NOLEG, palette: PAL, tokens: CTOK, declared: null });
  assert.deepEqual(r.applied.headline.italic, ['precio']); assert.deepEqual(r.applied.sub.italic, ['el vecino']);
  assert.ok(r.warnings.some((w) => w.startsWith('CAROUSEL_ITALIC_SPAN_NOT_IN_SUBHEADLINE: «granizo»')));
  const sc = cscene(r.chrome);
  assert.equal(spanStyle(sc, 'precio').fontStyle, 'italic'); assert.equal(spanStyle(sc, 'cosecha').fontStyle, 'normal');
  assert.equal(spanStyle(sc, 'vecino').fontStyle, 'italic'); assert.equal(spanStyle(sc, 'clima.').fontStyle, 'normal');
  assert.deepEqual(M.carouselItalicFacesNeeded(r.chrome).map((x) => x.key), ['Fuente Titular|700|italic', 'Fuente Texto|400|italic']);
  const CM = { 'Fuente Titular|700|normal': adv(0.5), 'Fuente Titular|700|italic': adv(0.9), 'Fuente Texto|400|normal': adv(0.5),
    'Fuente Texto|400|italic': adv(0.9), 'Fuente Rotulo|600|normal': adv(0.5), 'Fuente Titular|400|normal': adv(0.5) };
  const before = M.measureCarouselLayout(chromeOf(), CM), after = M.measureCarouselLayout(r.chrome, CM);
  assert.ok(after.midWidth >= before.midWidth && (after.midWidth > before.midWidth || after.mid > before.mid), JSON.stringify({ before, after }));
  const key = M.carouselItalicFacesNeeded(r.chrome)[0].baseKey;
  const synth = M.withItalicFallback(r.chrome, { [key]: 'skew', 'Fuente Texto|400|normal': 'skew' });
  assert.equal(spanStyle(cscene(synth), 'precio').transform, 'skewX(-10deg)');
  const ms = M.measureCarouselLayout(synth, CM);
  assert.equal(ms.mid, before.mid); assert.equal(ms.midWidth, before.midWidth);
});
test('10k · lámina sin `italic_spans`: EL MISMO cromo (golden de 7a) y sin caras que pedir', () => {
  const c = chromeOf();
  assert.deepEqual(M.carouselItalicFacesNeeded(c), []);
  assert.equal(M.carouselHeadlineParts(c), c.headline);
});
test('10l · cableado: las caras contrarias se bajan antes de cualquier ajuste, en el overlay y en la lámina', () => {
  const a = SRC.indexOf('const italicLoad = await loadOppositeFaces(overlayItalicFacesNeeded(oStyle), new Set(Object.keys(areaMetrics)));');
  const b = SRC.indexOf('const areaFit = fitOverlayTextArea({ style: ');
  assert.ok(a > 0 && b > a);
  const c = SRC.indexOf('const italicLoad = await loadOppositeFaces(carouselItalicFacesNeeded(chrome), new Set(Object.keys(metrics)));');
  const d = SRC.indexOf('const area = fitCarouselCoverArea({ chrome: withItalicFallback(chrome, italicLoad.fallback), metrics');
  assert.ok(c > 0 && d > c);
  assert.match(SRC, /COMPOSITOR_VERSION = '1\.(18|19|2\d)\.0'/);
  assert.match(SRC, /googleFontsFaceCssUrl\(need\.family, need\.weight, need\.italic\)/);
});
test('10m · el bloque nuevo no nombra familias ni marcas', () => {
  const ini = SRC.indexOf('// ── 1.18.0 · CURSIVA POR TRAMO');
  const fin = SRC.indexOf('/**\n * 1.16.0 — aplica lo elegido por bloque al estilo del overlay', ini);
  const blk = SRC.slice(ini, fin);
  assert.ok(blk.length > 2000);
  assert.ok(!/neurone|forum|unrealville|lucien|panam|miami|pt sans|narrow|garamond|bebas|baskerville/i.test(blk));
});

console.log('\n── 11 · 1.21.0 · color por tramo ──');
const TRIGO = M.hexToRgba('#D9A441', 1), HOJA = M.hexToRgba('#2F7A3D', 1);
test('11a · contrato: `color_spans` se acepta en los dos bloques, con los límites de `shadow_spans`', () => {
  const r = ts({ headline: { color_spans: ['cosecha'] }, sub: { color_spans: ['el clima', 'el vecino'] } });
  assert.deepEqual(r.headline.color_spans, ['cosecha']); assert.deepEqual(r.sub.color_spans, ['el clima', 'el vecino']);
  assert.equal(M.textBlockRequested(r.headline), true);
  for (const v of [{ headline: { color_spans: ['a', 'b', 'c', 'd'] } }, { sub: { color_spans: 'x' } }, { sub: { color_spans: [3] } },
    { headline: { color_spans: ['x'.repeat(61)] } }, { headline: { colour_spans: ['x'] } }]) {
    assert.throws(() => ts(v), (e) => e.label === 'COMPOSITOR_TEXT_STYLE_INVALID' && e.status === 400, JSON.stringify(v));
  }
});
test('11b · golden: sin `color_spans` la ranura no lleva tramos, `applied` no trae `color` y la escena es la misma', () => {
  const s = resolveI();
  const r = M.applyTextStyleBlocks(s, ts({ headline: { role: 'tinta' } }), PAL, ITOK());
  assert.equal(r.style.slots.headline.colorMark, undefined); assert.equal(r.style.slots.subheadline.colorMark, undefined);
  assert.ok(!('color' in r.applied.headline) && !('color' in r.applied.sub));
});
test('11c · el tramo cambia sólo de color: misma familia, estilo y caja que su vecino; `applied.color` lo dice', () => {
  const r = M.applyTextStyleBlocks(resolveI(), ts({ headline: { color_spans: ['cosecha'] }, sub: { color_spans: ['el vecino'] } }), PAL, ITOK());
  assert.deepEqual(r.applied.headline.color, ['cosecha']); assert.deepEqual(r.applied.sub.color, ['el vecino']);
  const sc = scene(r.style);
  const cos = spanStyle(sc, 'cosecha'), pre = spanStyle(sc, 'precio');
  assert.equal(cos.color, TRIGO, 'el color del resaltado de la marca');
  assert.equal(pre.color, undefined, 'el vecino hereda el color de la ranura');
  for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'textTransform', 'fontStyle']) assert.equal(cos[k], pre[k], k);
  assert.equal(spanStyle(sc, 'vecino').color, TRIGO, 'la bajada sin color propio toma el del resaltado del titular');
});
test('11d · con `emphasis_role` elegido (y permitido), el tramo toma ese color; fuera de la lista, el de la marca', () => {
  const ok = M.applyTextStyleBlocks(resolveI(), ts({ sub: { color_spans: ['el vecino'], emphasis_role: 'hoja' } }), PAL, ITOK());
  assert.equal(spanStyle(scene(ok.style), 'vecino').color, HOJA);
  const h = M.applyTextStyleBlocks(resolveI(), ts({ headline: { color_spans: ['cosecha'] } }), PAL, ITOK(), 'hoja');
  assert.equal(spanStyle(scene(h.style), 'cosecha').color, HOJA, 'el resaltado elegido para el titular');
  const no = M.applyTextStyleBlocks(resolveI(), ts({ sub: { color_spans: ['el vecino'], emphasis_role: 'tinta' } }), PAL, ITOK());
  assert.equal(spanStyle(scene(no.style), 'vecino').color, TRIGO);
});
test('11e · con resaltado en el mismo bloque, el tramo toma exactamente el color del resaltado', () => {
  const s = resolveI(ITOK(), { ...TEXT, emphasis: ['está bajando'] });
  const r = M.applyTextStyleBlocks(s, ts({ headline: { color_spans: ['precio'] } }), PAL, ITOK());
  const sc = scene(r.style);
  assert.equal(spanStyle(sc, 'precio').color, r.style.slots.headline.emphasis.color);
  assert.equal(spanStyle(sc, 'precio').fontFamily, undefined, 'el tramo de color no toma la tipografía del resaltado');
  assert.equal(spanStyle(sc, 'precio').fontSize, undefined);
  assert.equal(spanStyle(sc, 'bajando').fontStyle, 'italic', 'el resaltado conserva la suya');
});
test('11f · lo que no está literal no se aplica y se dice; sin color de resaltado declarado, tampoco', () => {
  const r = M.applyTextStyleBlocks(resolveI(), ts({ headline: { color_spans: ['granizo'] }, sub: { color_spans: ['la lluvia'] } }), PAL, ITOK());
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_COLOR_SPAN_NOT_IN_HEADLINE: «granizo»')));
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_COLOR_SPAN_NOT_IN_SUBHEADLINE: «la lluvia»')));
  assert.ok(!('color' in r.applied.headline));
  const tok = ITOK({ palette: { headline_emphasis: null } });
  const n = M.applyTextStyleBlocks(resolveI(tok), ts({ headline: { color_spans: ['cosecha'] } }), PAL, tok);
  assert.ok(n.style.markers.some((m) => m.startsWith('OVERLAY_COLOR_SPAN_NO_COLOR')), n.style.markers.join(' | '));
});
test('11g · color, cursiva y sombra al revés a la vez en el mismo tramo', () => {
  const r = M.applyTextStyleBlocks(resolveI(), ts({ headline: { color_spans: ['cosecha'], italic_spans: ['cosecha'], shadow_spans: ['cosecha'] } }), PAL, ITOK());
  const cos = spanStyle(scene(r.style), 'cosecha');
  assert.equal(cos.color, TRIGO); assert.equal(cos.fontStyle, 'italic'); assert.equal(cos.textShadow, undefined);
});
test('11h · el color no cambia ninguna medida', () => {
  const m = { 'Fuente Titular|400|normal': adv(0.5), 'Fuente Texto|400|normal': adv(0.5) };
  const r = M.applyTextStyleBlocks(resolveI(), ts({ headline: { color_spans: ['cosecha'] }, sub: { color_spans: ['el vecino'] } }), PAL, ITOK());
  assert.deepEqual(M.measureOverlayText(r.style, W, H, m), M.measureOverlayText(resolveI(), W, H, m));
});
test('11i · lámina: el titular toma el color de su palabra clave; la bajada, el de su resaltado; sin medida nueva', () => {
  const r = M.applyCarouselTextStyle(chromeOf(), { ts: ts({ headline: { color_spans: ['precio'] }, sub: { color_spans: ['el vecino', 'granizo'], emphasis_role: 'hoja' } }), legacy: NOLEG, palette: PAL, tokens: CTOK, declared: null });
  assert.deepEqual(r.applied.headline.color, ['precio']); assert.deepEqual(r.applied.sub.color, ['el vecino']);
  assert.equal(r.applied.sub.emphasis_role, 'hoja');
  assert.ok(r.warnings.some((w) => w.startsWith('CAROUSEL_COLOR_SPAN_NOT_IN_SUBHEADLINE: «granizo»')));
  const sc = cscene(r.chrome);
  assert.equal(spanStyle(sc, 'precio').color, r.chrome.colors.keyword); assert.equal(spanStyle(sc, 'bajando').color, r.chrome.colors.headline);
  assert.equal(spanStyle(sc, 'vecino').color, HOJA); assert.equal(spanStyle(sc, 'clima.').color, r.chrome.colors.subheadline);
  const CM = { 'Fuente Titular|700|normal': adv(0.5), 'Fuente Texto|400|normal': adv(0.5), 'Fuente Rotulo|600|normal': adv(0.5), 'Fuente Titular|400|normal': adv(0.5) };
  assert.deepEqual(M.measureCarouselLayout(r.chrome, CM), M.measureCarouselLayout(chromeOf(), CM));
});
test('11j · lámina sin `color_spans`: EL MISMO cromo (golden de 7a)', () => {
  const c = chromeOf();
  const r = M.applyCarouselTextStyle(c, { ts: ts(null), legacy: NOLEG, palette: PAL, tokens: CTOK, declared: null });
  assert.equal(r.chrome, c);
});
test('11m · el corrector de contraste cambia también el color de los tramos del titular sin resaltado', () => {
  const r = M.applyTextStyleBlocks(resolveI(), ts({ headline: { color_spans: ['cosecha'] } }), PAL, ITOK());
  const st = M.withEmphasisColor(r.style, HOJA);
  assert.equal(st.slots.headline.markColor, HOJA); assert.equal(st.slots.headline.emphasis, undefined);
  assert.equal(spanStyle(scene(st), 'cosecha').color, HOJA);
  const plain = resolveI(); assert.equal(M.withEmphasisColor(plain, HOJA), plain, 'sin resaltado ni tramos, EL MISMO estilo');
  assert.match(SRC, /const headMark = finalStyle\.slots\.headline\?\.emphasis\?\.color \?\? \(finalStyle\.slots\.headline\?\.colorMark\?\.length \? finalStyle\.slots\.headline\.markColor : undefined\);/);
  assert.match(SRC, /decideEmphasisColor\(\{ currentColor: headMark!,/);
});
test('11k · versión e historia: 1.21.0 documentada en la cabecera', () => {
  assert.match(SRC, /COMPOSITOR_VERSION = '1\.2[1-9]\.0'/);
  const hist = SRC.slice(SRC.indexOf('//   1.21.0 (2026-10-30)'), SRC.indexOf("export const COMPOSITOR_VERSION = '"));
  assert.ok(hist.includes('color_spans') && hist.includes('Sin `color_spans`, idéntico a 1.20.0'));
});
test('11l · el bloque nuevo no nombra familias ni marcas', () => {
  const ini = SRC.indexOf('// ── 1.21.0 · COLOR POR TRAMO');
  const fin = SRC.indexOf('/**\n * 1.18.0 — el estilo FINAL de un tramo', ini);
  const blk = SRC.slice(ini, fin);
  assert.ok(blk.length > 1500, String(blk.length));
  assert.ok(!/neurone|forum|unrealville|lucien|panam|miami|pt sans|narrow|garamond|bebas|baskerville/i.test(blk));
});

console.log('\n── 12 · 1.22.0 · negrita por tramo ──');
test('12a · contrato: `bold_spans` se acepta en los dos bloques, con los límites de los demás tramos', () => {
  const r = ts({ headline: { bold_spans: ['cosecha'] }, sub: { bold_spans: ['el vecino'] } });
  assert.deepEqual(r.headline.bold_spans, ['cosecha']); assert.deepEqual(r.sub.bold_spans, ['el vecino']);
  assert.equal(M.textBlockRequested(r.headline), true);
  for (const v of [{ headline: { bold_spans: ['a', 'b', 'c', 'd'] } }, { sub: { bold_spans: 'x' } }, { headline: { bold: ['x'] } }]) {
    assert.throws(() => ts(v), (e) => e.label === 'COMPOSITOR_TEXT_STYLE_INVALID' && e.status === 400, JSON.stringify(v));
  }
});
test('12b · el peso contrario: debajo de 600 sale 700; desde 600, 400', () => {
  assert.equal(M.flippedWeight(400), 700); assert.equal(M.flippedWeight(300), 700); assert.equal(M.flippedWeight(500), 700);
  assert.equal(M.flippedWeight(600), 400); assert.equal(M.flippedWeight(700), 400); assert.equal(M.flippedWeight(900), 400);
});
test('12c · golden: sin `bold_spans` no hay tramos, ni caras que pedir, ni `fontWeight` por tramo', () => {
  const r = M.applyTextStyleBlocks(resolveI(), ts({ headline: { italic_spans: ['cosecha'] } }), PAL, ITOK());
  assert.equal(r.style.slots.headline.boldFlip, undefined);
  assert.ok(!('bold' in r.applied.headline));
  assert.equal(spanStyle(scene(r.style), 'cosecha').fontWeight, undefined, 'sólo cursiva: el tramo no declara peso (escena de 1.21.0)');
  assert.ok(M.overlayItalicFacesNeeded(r.style).every((x) => !x.axis));
});
test('12d · sobre texto regular, el tramo sale en 700 y el resto en su peso; `applied.bold` lo dice', () => {
  const r = M.applyTextStyleBlocks(resolveI(), ts({ headline: { bold_spans: ['cosecha'] }, sub: { bold_spans: ['el vecino'] } }), PAL, ITOK());
  assert.deepEqual(r.applied.headline.bold, ['cosecha']); assert.deepEqual(r.applied.sub.bold, ['el vecino']);
  const sc = scene(r.style);
  const w = r.style.slots.headline.weight;
  assert.equal(spanStyle(sc, 'cosecha').fontWeight, M.flippedWeight(w)); assert.equal(spanStyle(sc, 'precio').fontWeight, w);
  assert.equal(spanStyle(sc, 'cosecha').fontStyle, undefined, 'sin tramos de cursiva, el tramo no declara estilo');
  assert.equal(spanStyle(sc, 'vecino').fontWeight, M.flippedWeight(r.style.slots.subheadline.weight));
  const need = M.overlayItalicFacesNeeded(r.style);
  assert.deepEqual(need.map((x) => [x.key, x.axis]), [[`Fuente Titular|${M.flippedWeight(w)}|normal`, 'bold'], [`Fuente Texto|${M.flippedWeight(r.style.slots.subheadline.weight)}|normal`, 'bold']]);
});
test('12e · sobre una ranura en negrita, el tramo sale regular', () => {
  const tok = ITOK({ typography: { headline: { weight: 700 } } });
  const r = M.applyTextStyleBlocks(resolveI(tok), ts({ headline: { bold_spans: ['cosecha'] } }), PAL, tok);
  assert.equal(r.style.slots.headline.weight, 700);
  const sc = scene(r.style);
  assert.equal(spanStyle(sc, 'cosecha').fontWeight, 400); assert.equal(spanStyle(sc, 'precio').fontWeight, 700);
});
test('12f · lo que no está literal no se aplica y se dice', () => {
  const r = M.applyTextStyleBlocks(resolveI(), ts({ headline: { bold_spans: ['granizo'] }, sub: { bold_spans: ['la lluvia'] } }), PAL, ITOK());
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_BOLD_SPAN_NOT_IN_HEADLINE: «granizo»')));
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_BOLD_SPAN_NOT_IN_SUBHEADLINE: «la lluvia»')));
  assert.ok(!('bold' in r.applied.headline));
});
test('12g · sin la cara de ese peso, NO se simula: el tramo queda con su peso y se dice', () => {
  const r = M.applyTextStyleBlocks(resolveI(), ts({ headline: { bold_spans: ['cosecha'] } }), PAL, ITOK());
  const need = M.overlayItalicFacesNeeded(r.style)[0];
  const fb = M.italicFallbackFor(need);
  assert.equal(fb.fallback, 'none'); assert.match(fb.marker, /^OVERLAY_BOLD_UNAVAILABLE: Fuente Titular no tiene la cara de peso 700; el tramo queda con su peso$/);
  const st = M.withItalicFallback(r.style, { [M.boldFallbackKey(need.baseKey)]: 'none' });
  assert.equal(spanStyle(scene(st), 'cosecha').fontWeight, r.style.slots.headline.weight);
  assert.equal(M.spanFaceStyle(r.style.slots.headline, { bold: true }, st.italicFallback).weight, r.style.slots.headline.weight);
});
test('12h · cursiva y negrita en el mismo tramo: la cara de los dos, y por si falta, cada una', () => {
  const r = M.applyTextStyleBlocks(resolveI(), ts({ headline: { bold_spans: ['cosecha'], italic_spans: ['cosecha'] } }), PAL, ITOK());
  const cos = spanStyle(scene(r.style), 'cosecha');
  assert.equal(cos.fontWeight, 700); assert.equal(cos.fontStyle, 'italic');
  assert.deepEqual(M.overlayItalicFacesNeeded(r.style).map((x) => [x.key, x.axis ?? 'italic']),
    [['Fuente Titular|700|italic', 'both'], ['Fuente Titular|400|italic', 'italic'], ['Fuente Titular|700|normal', 'bold']]);
  // Falta la de los dos: queda la cursiva sin negrita.
  const st = M.withItalicFallback(r.style, { [M.boldFallbackKey('Fuente Titular|400|normal')]: 'none' });
  const c2 = spanStyle(scene(st), 'cosecha');
  assert.equal(c2.fontWeight, 400); assert.equal(c2.fontStyle, 'italic');
});
test('12i · la medición usa la métrica de la cara de ese peso', () => {
  const r = M.applyTextStyleBlocks(resolveI(), ts({ headline: { bold_spans: ['El precio de la cosecha está bajando'] } }), PAL, ITOK());
  const m = { 'Fuente Titular|400|normal': adv(0.5), 'Fuente Titular|700|normal': adv(0.9), 'Fuente Texto|400|normal': adv(0.5) };
  const before = M.measureOverlayText(resolveI(), W, H, m), after = M.measureOverlayText(r.style, W, H, m);
  assert.ok(after.height > before.height || after.width > before.width, JSON.stringify({ before, after }));
  const sinCara = M.withItalicFallback(r.style, { [M.boldFallbackKey('Fuente Titular|400|normal')]: 'none' });
  assert.deepEqual(M.measureOverlayText(sinCara, W, H, m), before, 'sin la cara, se mide con la regular');
});
test('12j · pickExactStyleFace con peso exacto: una hoja con sólo la regular no es la negrita', () => {
  const faces = [{ family: 'Fuente Titular', weight: 400, italic: false, url: 'r' }];
  assert.equal(M.pickExactStyleFace(faces, { family: 'Fuente Titular', weight: 700, italic: false }, true), null);
  assert.equal(M.pickExactStyleFace(faces, { family: 'Fuente Titular', weight: 700, italic: false })?.url, 'r', 'sin exigir peso, cae a la más cercana (1.18.0)');
  const both = [...faces, { family: 'Fuente Titular', weight: 700, italic: false, url: 'b' }];
  assert.equal(M.pickExactStyleFace(both, { family: 'Fuente Titular', weight: 700, italic: false }, true)?.url, 'b');
  assert.equal(M.googleFontsFaceCssUrl('Fuente Titular', 700, false), 'https://fonts.googleapis.com/css2?family=Fuente+Titular:ital,wght@0,700');
});
test('12k · lámina: titular (700) y bajada (400) invierten el peso, se miden con su cara y lo dicen', () => {
  const r = M.applyCarouselTextStyle(chromeOf(), { ts: ts({ headline: { bold_spans: ['precio'] }, sub: { bold_spans: ['el vecino', 'granizo'] } }), legacy: NOLEG, palette: PAL, tokens: CTOK, declared: null });
  assert.deepEqual(r.applied.headline.bold, ['precio']); assert.deepEqual(r.applied.sub.bold, ['el vecino']);
  assert.ok(r.warnings.some((w) => w.startsWith('CAROUSEL_BOLD_SPAN_NOT_IN_SUBHEADLINE: «granizo»')));
  const sc = cscene(r.chrome);
  assert.equal(spanStyle(sc, 'precio').fontWeight, 400); assert.equal(spanStyle(sc, 'bajando').fontWeight, 700);
  assert.equal(spanStyle(sc, 'vecino').fontWeight, 700); assert.equal(spanStyle(sc, 'clima.').fontWeight, 400);
  assert.deepEqual(M.carouselItalicFacesNeeded(r.chrome).map((x) => [x.key, x.axis]), [['Fuente Titular|400|normal', 'bold'], ['Fuente Texto|700|normal', 'bold']]);
  const CM = { 'Fuente Titular|700|normal': adv(0.5), 'Fuente Titular|400|normal': adv(0.5), 'Fuente Texto|400|normal': adv(0.5),
    'Fuente Texto|700|normal': adv(0.9), 'Fuente Rotulo|600|normal': adv(0.5) };
  const before = M.measureCarouselLayout(chromeOf(), CM), after = M.measureCarouselLayout(r.chrome, CM);
  assert.ok(after.midWidth >= before.midWidth && (after.midWidth > before.midWidth || after.mid > before.mid), JSON.stringify({ before, after }));
});
test('12l · lámina sin `bold_spans`: EL MISMO cromo y el mismo titular por tramos', () => {
  const c = chromeOf();
  const r = M.applyCarouselTextStyle(c, { ts: ts(null), legacy: NOLEG, palette: PAL, tokens: CTOK, declared: null });
  assert.equal(r.chrome, c); assert.equal(M.carouselHeadlineParts(c), c.headline);
  assert.equal(M.carouselSpanFace(c.type.headline, {}), c.type.headline);
});
test('12m · versión e historia: 1.22.0 documentada; el bloque no nombra marcas ni familias', () => {
  assert.match(SRC, /COMPOSITOR_VERSION = '1\.2[2-9]\.0'/);
  const hist = SRC.slice(SRC.indexOf('//   1.22.0 (2026-10-30)'), SRC.indexOf("export const COMPOSITOR_VERSION = '"));
  assert.ok(hist.includes('bold_spans') && hist.includes('Sin `bold_spans`, idéntico a 1.21.0'));
  const ini = SRC.indexOf('// ── 1.22.0 · NEGRITA POR TRAMO');
  const blk = SRC.slice(ini, SRC.indexOf('/**\n * 1.18.0 — el estilo FINAL de un tramo', ini));
  assert.ok(blk.length > 2500, String(blk.length));
  for (const t of [blk, hist]) assert.ok(!/neurone|forum|unrealville|lucien|panam|miami|pt sans|narrow|garamond|bebas|baskerville/i.test(t));
});

console.log(`\n${pass} ok · ${fails.length} fallos`);
if (fails.length) { console.log('FALLOS:\n  ' + fails.join('\n  ')); process.exit(1); }
