"""Test del núcleo PURO de api/measure.py (2026-11-19). Sin red, sin modelos y sin fotos de personas: puntos y píxeles
sintéticos.

QUÉ AFIRMA.
  1. `measure` mal formado falla con MEASURE_BAD_REQUEST; ausente, se mide todo.
  2. Hombros / cara es la distancia pose 11-12 dividida por la cara 234-454; sin pose, NO_POSE; de perfil, NOT_FRONTAL;
     hombros poco visibles, SHOULDERS_NOT_VISIBLE.
  3. A cada cara le toca la pose cuya nariz está a menos de media cara; si no hay ninguna, -1.
  4. El pelo cuenta SÓLO píxeles oscuros de la persona: el mismo pelo sobre un fondo oscuro mide igual que sobre uno claro
     (el defecto de la medida de la piel, DARK_BACKGROUND, desaparece). Pelo más ancho ⇒ width_ratio mayor.

Ejecutar:  python3 tests/medida_test.py   (necesita numpy; CI lo corre tras `uv sync` con el pyproject de la raíz)
"""
import importlib.util
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('measure', os.path.join(ROOT, 'api', 'measure.py'))
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)

fails = []


def test(name, fn):
    try:
        fn()
        print(f'  ✓ {name}')
    except Exception as e:  # noqa: BLE001
        fails.append(name)
        print(f'  ✗ {name}\n    {e!r}')


def face(cx=300, cy=300, fw=100, fh=130):
    """478 puntos con los que usa la medida: 234/454 (mejillas), 10 (frente), 152 (mentón), 1 (nariz)."""
    F = np.tile(np.array([[cx, cy]], dtype=float), (478, 1))
    F[234] = [cx - fw / 2, cy]
    F[454] = [cx + fw / 2, cy]
    F[10] = [cx, cy - fh / 2]
    F[152] = [cx, cy + fh / 2]
    F[1] = [cx, cy]
    return F


def pose(cx=300, cy=300, sw=210, vis=0.99):
    P = np.zeros((33, 3))
    P[:, 2] = vis
    P[0] = [cx, cy, vis]
    P[11] = [cx + sw / 2, cy + 150, vis]
    P[12] = [cx - sw / 2, cy + 150, vis]
    return P


def bad(raw):
    try:
        M.parse_measure(raw)
    except M.MeasureError as e:
        assert e.label == 'MEASURE_BAD_REQUEST' and e.status == 400, e.label
        return
    raise AssertionError(f'no falló: {raw!r}')


def t1():
    assert M.parse_measure(None) == {'body': True, 'hair': True, 'dark': M.DARK_DEFAULT}
    assert M.parse_measure({'body': True}) == {'body': True, 'hair': False, 'dark': M.DARK_DEFAULT}
    assert M.parse_measure({'hair': {'dark_threshold': 100}})['dark'] == 100
    for raw in ['x', [1], {'otra': 1}, {'hair': 'si'}, {'hair': {'dark_threshold': 0}}, {'body': 'si'}]:
        bad(raw)


def t2():
    F = face(fw=100)
    b = M.body_measure(F, pose(sw=210), True)
    assert b['valid'] and b['shoulders_over_face_w'] == 2.1, b
    assert M.body_measure(F, None, True)['issues'] == ['NO_POSE']
    assert 'NOT_FRONTAL' in M.body_measure(F, pose(), False)['issues']
    assert 'SHOULDERS_NOT_VISIBLE' in M.body_measure(F, pose(vis=0.2), True)['issues']


def t3():
    assert M.pair_pose([300, 300], 100, [pose(cx=600), pose(cx=310)]) == 1
    assert M.pair_pose([300, 300], 100, [pose(cx=600)]) == -1


def scene(bg, hair_w=220, H=700, W=700):
    """Luminancia y máscara: cara clara, pelo oscuro alrededor, fondo `bg`. La máscara es la persona (pelo + cara)."""
    lum = np.full((H, W), float(bg))
    yy, xx = np.mgrid[0:H, 0:W]
    hair = ((xx - 300) / (hair_w / 2)) ** 2 + ((yy - 300) / 160) ** 2 <= 1
    facem = ((xx - 300) / 50) ** 2 + ((yy - 300) / 65) ** 2 <= 1
    lum[hair] = 30
    lum[facem] = 200
    return lum, hair | facem


def t4():
    F = face()
    light = M.hair_measure(F, *scene(235), True)
    dark = M.hair_measure(F, *scene(20), True)
    assert light['valid'] and dark['valid'], (light, dark)
    assert light['width_ratio'] == dark['width_ratio'], (light, dark)
    assert light['height_ratio'] == dark['height_ratio'], (light, dark)
    wider = M.hair_measure(F, *scene(20, hair_w=300), True)
    assert wider['width_ratio'] > light['width_ratio'] * 1.2, (wider, light)
    # Sin máscara de persona, el fondo oscuro sí se confundiría: por eso la medida exige la máscara.
    assert M.hair_measure(F, scene(20)[0], None, True)['issues'] == ['NO_PERSON_MASK']
    lum, mask = scene(235)
    lum[lum == 30] = 150  # pelo claro
    assert 'HAIR_NOT_DARK' in M.hair_measure(F, lum, mask, True)['issues']


test('1 · measure: ausente mide todo; mal formado, 400 con nombre', t1)
test('2 · hombros / cara y sus casos no válidos', t2)
test('3 · cada cara con su pose', t3)
test('4 · el pelo cuenta sólo la persona: fondo oscuro o claro, la misma medida', t4)
print(f'\n{4 - len(fails)} ok, {len(fails)} fallan')
sys.exit(1 if fails else 0)
