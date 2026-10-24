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
  assert.deepEqual(r.headline, { role: 'tinta', emphasis: [], emphasis_role: null, text_shadow: null, shadow_spans: [], shadow_strength: 'strong' });
  assert.deepEqual(r.sub, { role: 'lino', emphasis: ['el vecino'], emphasis_role: 'hoja', text_shadow: 'on', shadow_spans: ['No fue'], shadow_strength: 'heavy' });
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

console.log(`\n${pass} ok · ${fails.length} fallos`);
if (fails.length) { console.log('FALLOS:\n  ' + fails.join('\n  ')); process.exit(1); }
