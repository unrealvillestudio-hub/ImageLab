// BLOQUES A MANO (2026-11-16) — escenas de referencia SIN `blocks`. `tests/bloques_a_mano_test.mjs` compara su huella
// (sha256 del árbol de satori) con la que dio `main` antes del cambio: sin `blocks`, la escena es la misma, nodo por nodo.
// Marcas SINTÉTICAS (test de la marca N+1): ninguna marca real.

export const TYPO = [
  { role: 'titular', font_family: 'Fuente A', css_import: 'https://example.invalid/a.css', fallback: null },
  { role: 'cuerpo', font_family: 'Fuente B', css_import: 'https://example.invalid/b.css', fallback: null },
];
export const PAL = [{ role: 'claro', hex: '#FAFAFA' }, { role: 'oscuro', hex: '#0E1018' }, { role: 'acento', hex: '#0076A8' }];

export const tokens = (layout = {}, extra = {}) => ({
  layout: { anchor: 'bottom_left', margin_pct: 7, max_width_pct: 76, gap_pct: 2.4, align: 'left',
    scrim: { mode: 'gradient_bottom', palette: 'oscuro', opacity: 0.7, coverage_pct: 55 },
    rule: { enabled: true, palette: 'acento', width_pct: 12, thickness_px: 4, gap_pct: 1.6 }, ...layout },
  typography: {
    headline: { role: 'titular', weight: 600, line_height: 1.06, fit_steps: [{ max_chars: 60, size_pct: 7 }, { max_chars: 400, size_pct: 5 }] },
    subheadline: { role: 'cuerpo', weight: 400, line_height: 1.3, fit_steps: [{ max_chars: 80, size_pct: 3.4 }, { max_chars: 400, size_pct: 2.6 }] },
  },
  palette: { headline: 'claro', subheadline: 'claro' },
  identity: { mode: 'edge_bottom', palette: 'acento', width_pct: 1.8, full_bleed: true },
  ...extra,
});

export const TEXT = { headline: 'Lo que la piel cuenta cuando nadie mira', subheadline: 'Una rutina corta, todos los días.' };

/** Las escenas de referencia: varias anclas, con y sin zona segura, con y sin bajada, y sin titular (sello). */
export function escenas(M) {
  const casos = [
    [{}, TEXT],
    [{ anchor: 'top_right', align: 'right' }, TEXT],
    [{ anchor: 'center', align: 'center', safe_zone_pct: { top: 12, bottom: 18, left: 4, right: 4 } }, TEXT],
    [{}, { headline: TEXT.headline }],
    [{}, { headline: '' }],
  ];
  return casos.map(([layout, text]) => {
    const st = M.resolveOverlayStyle({ tokens: tokens(layout), typography: TYPO, palette: PAL, text });
    return M.buildOverlayScene({ style: st, width: 1080, height: 1350, backgroundSrc: 'data:image/png;base64,AA' });
  });
}
