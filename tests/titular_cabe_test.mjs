// 1.12.0 — EL TITULAR CABE EN EL ALTO, EN CUALQUIER PROPORCIÓN. Test del bloque PURO y del cableado.
//
// EL CASO. El carril va a pedir portadas 16:9 (la proporción a la que una red profesional recorta la portada de un
// artículo). Los tamaños del overlay salen del ANCHO y el escalón se elige por caracteres: en un lienzo apaisado un
// titular largo con bajada, anclado abajo, medía más que el alto disponible y se salía por arriba del lienzo.
//
// QUÉ AFIRMA.
//   1. LA CLASE: para un titular largo en español, con y sin bajada, en 16:9, 1,91:1, 1:1, 4:5 y 9:16 y con el
//      bloque anclado abajo, arriba y al centro, la caja del bloque ya ajustado queda DENTRO del lienzo
//      (arriba ≥ 0, abajo ≤ alto) y dentro de los márgenes.
//   2. GOLDEN: lo que ya cabe sale idéntico —el MISMO objeto de estilo, sin informe, sin marcador nuevo y la misma
//      escena clave por clave—.
//   3. El orden de la escalera (titular, bajada, sin bajada) y los marcadores: reducción dicha; y si ni al último
//      escalón cabe, `OVERLAY_TEXT_OVERFLOW`, con el texto intacto.
//   4. La franja de identidad inferior más gruesa que el margen achica el hueco; la zona segura también cuenta.
//   5. Cableado: el handler ajusta el alto después del área y antes de elegir ancla, y lo informa en `meta`.
//   6. Marca N+1: el bloque nuevo no nombra marcas, canales ni modelos.
//
// La marca de los fixtures es inventada (la misma de compositor_test.mjs): otro rubro, roles que ninguna marca real usa.
//
// Ejecutar:  node tests/titular_cabe_test.mjs     (Node ≥ 22.18, type-stripping nativo)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'compose.ts'), 'utf8');
const BEGIN = '// ── COMPOSITOR:BEGIN ──', END = '// ── COMPOSITOR:END ──';
const BLOCK = SRC.slice(SRC.indexOf(BEGIN), SRC.indexOf(END) + END.length);
const dir = mkdtempSync(join(tmpdir(), 'titular-cabe-'));
const mod = join(dir, 'block.mts');
writeFileSync(mod, BLOCK + '\n', 'utf8');
const M = await import(pathToFileURL(mod).href);

let pass = 0; const fails = [];
const test = (n, f) => { try { f(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fails.push(n); console.log(`  ✗ ${n}\n    ${e.message}`); } };
const sha = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

// ── Marca INVENTADA ──────────────────────────────────────────────────────────────────────────────
const N1_TYPO = [
  { role: 'titular', font_family: 'Fuente Titular', css_import: 'https://fonts.example/titular.css' },
  { role: 'texto', font_family: 'Fuente Texto', css_import: 'https://fonts.example/texto.css' },
];
const N1_PAL = [{ role: 'lino', hex: '#F4EFE6' }, { role: 'tierra', hex: '#3B2A1E' }, { role: 'hoja', hex: '#2F7A3D' }];
const N1_TOK = {
  layout: { anchor: 'bottom_left', margin_pct: 6, max_width_pct: 80, gap_pct: 2 },
  typography: {
    headline: { role: 'titular', weight: 700, line_height: 1.1,
      fit_steps: [{ max_chars: 40, size_pct: 9 }, { max_chars: 90, size_pct: 7.5 }, { max_chars: 140, size_pct: 5.5 }] },
    subheadline: { role: 'texto', weight: 400, line_height: 1.3, fit_steps: [{ max_chars: 160, size_pct: 3.2 }, { max_chars: 260, size_pct: 2.6 }] },
  },
  palette: { headline: 'lino', subheadline: 'lino' },
};
const TITULAR = '29 mil dólares de deuda. Una sola cuota extraordinaria no la causó.';
const BAJADA = 'Lo que dice el reglamento sobre las cuotas, punto por punto.';
const style = (text, over = {}) => M.resolveOverlayStyle({ tokens: M.deepMergeTokens(N1_TOK, over), typography: N1_TYPO, palette: N1_PAL, text });
const fit = (st, w, h) => M.fitOverlayTextHeight({ style: st, width: w, height: h, metrics: null });

const LIENZOS = [['16:9', 1920, 1080], ['1,91:1', 1200, 628], ['1:1', 1080, 1080], ['4:5', 1080, 1350], ['9:16', 1080, 1920]];
const ANCLAS = ['bottom_left', 'top_left', 'center'];

console.log('── 1 · la clase: el bloque queda dentro del lienzo en toda proporción ──');
test('el defecto existe sin el ajuste: en 16:9, con bajada y anclado abajo, el bloque se sale por arriba', () => {
  const st = style({ headline: TITULAR, subheadline: BAJADA });
  const r = M.overlayTextRect(st, 1920, 1080, null, 'bottom_left');
  assert.ok(r.y0 < 0, `sin ajuste el borde superior queda en ${r.y0} px (se esperaba < 0)`);
});
for (const [nombre, w, h] of LIENZOS) {
  for (const conBajada of [true, false]) {
    for (const ancla of ANCLAS) {
      test(`${nombre} (${w}×${h}) · ${conBajada ? 'con' : 'sin'} bajada · ${ancla}: arriba ≥ 0 y abajo ≤ alto`, () => {
        const st = style({ headline: TITULAR, ...(conBajada ? { subheadline: BAJADA } : {}) }, { layout: { anchor: ancla } });
        const out = fit(st, w, h).style;
        assert.equal(out.slots.headline.text, TITULAR, 'el titular no se reescribe');
        const r = M.overlayTextRect(out, w, h, null, ancla);
        assert.ok(r.y0 >= 0, `el borde superior del bloque queda en ${r.y0} px`);
        assert.ok(r.y1 <= h, `el borde inferior del bloque queda en ${r.y1} px (alto ${h})`);
        const box = M.overlayTextBox(out, w, h);
        assert.ok(r.y0 >= box.top - 0.01 && r.y1 <= h - box.bottom + 0.01, 'y además dentro de los márgenes');
      });
    }
  }
}

console.log('── 2 · lo que ya cabe sale idéntico ──');
test('sin ajuste necesario: el MISMO objeto, sin informe y la misma escena clave por clave', () => {
  for (const [, w, h] of LIENZOS) {
    const st = style({ headline: 'Una cuota no se vota a mano alzada' });
    const r = fit(st, w, h);
    assert.equal(r.style, st, `${w}×${h}: el MISMO objeto`);
    assert.equal(r.report, null);
    const a = M.buildOverlayScene({ style: st, width: w, height: h, backgroundSrc: 'data:image/png;base64,AA' });
    const b = M.buildOverlayScene({ style: r.style, width: w, height: h, backgroundSrc: 'data:image/png;base64,AA' });
    assert.equal(sha(a), sha(b));
  }
});
test('el titular largo SIN bajada en 16:9 ya cabía: no se toca', () => {
  const st = style({ headline: TITULAR });
  assert.equal(fit(st, 1920, 1080).style, st);
});
test('sin titular (sólo sello) no hay nada que medir', () => {
  const st = style({ headline: '' }, { identity: { mode: 'edge_bottom', palette: 'hoja', width_pct: 1.5 } });
  const r = fit(st, 1920, 1080);
  assert.equal(r.style, st);
  assert.equal(r.report, null);
});

console.log('── 3 · escalera y marcadores ──');
test('16:9 con bajada: baja primero el titular, lo dice y no quita la bajada si no hace falta', () => {
  const st = style({ headline: TITULAR, subheadline: BAJADA });
  const r = fit(st, 1920, 1080);
  assert.equal(r.style.slots.headline.sizePct, 5.5);
  assert.ok(r.style.slots.subheadline, 'la bajada sigue');
  assert.equal(r.report.adjusted, true);
  assert.equal(r.report.exceeded, false);
  assert.ok(r.report.height_px <= r.report.room_px && r.report.height_px_before > r.report.room_px);
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_HEIGHT_REDUCED') && /titular 7\.5→5\.5 %/.test(m)));
  assert.ok(!r.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_OVERFLOW')));
});
test('si ni al último escalón cabe: compone al mínimo, emite OVERLAY_TEXT_OVERFLOW y el texto queda intacto', () => {
  const st = style({ headline: TITULAR, subheadline: BAJADA });
  const r = fit(st, 1920, 420);
  assert.equal(r.report.exceeded, true);
  assert.equal(r.report.dropped_subheadline, true, 'el último escalón es sin bajada');
  assert.equal(r.style.slots.headline.text, TITULAR);
  assert.equal(r.style.slots.headline.sizePct, 5.5, 'el escalón más chico declarado');
  assert.ok(r.style.markers.some((m) => m.startsWith('OVERLAY_TEXT_OVERFLOW') && /1920×420/.test(m)));
});

console.log('── 4 · lo que achica el hueco ──');
test('una franja inferior más gruesa que el margen achica el hueco; una lateral, no', () => {
  const sinMargen = { layout: { margin_pct: 0.5 } };
  const base = M.overlayTextVerticalRoom(style({ headline: TITULAR }, sinMargen), 1920, 1080);
  const abajo = M.overlayTextVerticalRoom(style({ headline: TITULAR }, { ...sinMargen, identity: { mode: 'edge_bottom', palette: 'hoja', width_pct: 4 } }), 1920, 1080);
  const lado = M.overlayTextVerticalRoom(style({ headline: TITULAR }, { ...sinMargen, identity: { mode: 'edge_left', palette: 'hoja', width_pct: 4 } }), 1920, 1080);
  assert.equal(base, 1060.8, '1080 − 9,6 − 9,6');
  assert.equal(abajo, 1027.4, '1080 − 9,6 − 43 (4 % del lado corto, redondeado como lo dibuja la escena)');
  assert.equal(lado, base);
});
test('la zona segura cuenta: el bloque queda dentro de ella', () => {
  const zona = { layout: { safe_zone_pct: { top: 10, bottom: 20, left: 0, right: 0 } } };
  const st = style({ headline: TITULAR, subheadline: BAJADA }, zona);
  const out = fit(st, 1920, 1080).style;
  const r = M.overlayTextRect(out, 1920, 1080, null, 'bottom_left');
  assert.ok(r.y0 >= 108 - 0.01 && r.y1 <= 1080 - 216 + 0.01, `caja ${r.y0}..${r.y1}`);
});

console.log('── 5 · cableado ──');
test('el handler ajusta el alto después del área y antes de elegir ancla, y lo informa en meta', () => {
  const area = SRC.indexOf('const areaFit = fitOverlayTextArea(');
  const alto = SRC.indexOf('const heightFit = fitOverlayTextHeight({ style: areaFit.style');
  const ancla = SRC.indexOf('chooseOverlayAnchor({ style: finalStyle');
  assert.ok(area > 0 && alto > area && ancla > alto, 'orden: área → alto → ancla');
  assert.match(SRC, /let finalStyle = heightFit\.style;/);
  assert.match(SRC, /heightFit\.report \? \{ text_height: heightFit\.report \}/);
});

console.log('── 6 · marca N+1 ──');
test('el bloque nuevo no nombra marcas, canales ni modelos', () => {
  const i = BLOCK.indexOf('export function overlayTextVerticalRoom');
  const j = BLOCK.indexOf('\n}\n', BLOCK.indexOf('export function fitOverlayTextHeight'));
  const nuevo = BLOCK.slice(i, j);
  assert.ok(i > 0 && j > i && nuevo.length > 500);
  assert.doesNotMatch(nuevo, /ForumPHs|Unrealville|NeuroneSCF|INSTAGRAM|FACEBOOK|LINKEDIN|TIKTOK|REEL|gemini|imagen-/i);
});

console.log(`\n${fails.length ? '✗' : '✓'} ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
