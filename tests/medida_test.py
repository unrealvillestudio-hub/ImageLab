"""Test del núcleo PURO de api/measure.py (2026-11-19). Sin red, sin modelos y sin fotos de personas: puntos y píxeles
sintéticos.

QUÉ AFIRMA.
  1. `measure` mal formado falla con MEASURE_BAD_REQUEST; ausente, se mide todo.
  2. Hombros / cara es la distancia pose 11-12 dividida por la cara 234-454; sin pose, NO_POSE; de perfil, NOT_FRONTAL;
     hombros poco visibles, SHOULDERS_NOT_VISIBLE.
  3. A cada cara le toca la pose cuya nariz está a menos de media cara; si no hay ninguna, -1.
  5. Identidad (2026-11-21): cada cara recibe a lo sumo una persona de referencia y cada persona a lo sumo una cara.
  6. La alineación a la plantilla ArcFace es exacta.
  7. Escena: se juzga el fondo, no a quien cambia.
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
    assert M.parse_measure(None) == {'body': True, 'hair': True, 'dark': M.DARK_DEFAULT, 'identity': None, 'scene': None}
    assert M.parse_measure({'body': True}) == {'body': True, 'hair': False, 'dark': M.DARK_DEFAULT, 'identity': None, 'scene': None}
    assert M.parse_measure({'hair': {'dark_threshold': 100}})['dark'] == 100
    for raw in ['x', [1], {'otra': 1}, {'hair': 'si'}, {'hair': {'dark_threshold': 0}}, {'body': 'si'},
                {'identity': 'si'}, {'identity': {'references': [{'id': 'a', 'embeddings': [[0.1] * 127]}]}},
                {'identity': {'references': [{'id': 'a', 'embeddings': [[0.1] * 128]}, {'id': 'a', 'embeddings': [[0.1] * 128]}]}},
                {'identity': {'threshold': 1.5}}, {'scene': {}}, {'scene': 'x'}]:
        bad(raw)
    ok = M.parse_measure({'identity': {'references': [{'id': 'p1', 'embeddings': [[0.1] * 128]}], 'threshold': 0.4}})
    assert ok['identity']['threshold'] == 0.4 and ok['identity']['references'][0]['id'] == 'p1' and not ok['identity']['embed']
    assert M.parse_measure({'identity': True})['identity']['embed'] is True
    assert M.parse_measure({'scene': {'reference_image_url': 'https://x/y.png'}})['scene']['image_url'] == 'https://x/y.png'


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


def t5():
    # Uno a uno: gana el par más alto; la segunda cara no puede quedarse con la persona ya asignada.
    S = [[0.95, 0.30], [0.80, 0.70], None, [0.20, 0.10]]
    assert M.assign_identities(S, ['A', 'B'], 0.363) == ['A', 'B', None, None]
    # Dos caras que se parecen a la misma persona: sólo una la recibe; la otra es complemento si no pasa con nadie más.
    assert M.assign_identities([[0.9, 0.1], [0.85, 0.2]], ['A', 'B'], 0.363) == ['A', None]
    assert M.assign_identities([[0.3]], ['A'], 0.363) == [None]


def t6():
    # La alineación lleva los puntos a la plantilla: con puntos ya en la plantilla, la identidad.
    A, t = M.similarity_transform(M.ARCFACE_112, M.ARCFACE_112)
    assert np.allclose(A, np.eye(2), atol=1e-6) and np.allclose(t, 0, atol=1e-6)
    src = np.array(M.ARCFACE_112) * 3 + [50, 20]
    A, t = M.similarity_transform(src, M.ARCFACE_112)
    assert np.allclose(src @ A.T + t, M.ARCFACE_112, atol=1e-6)


def t7():
    rng = np.random.default_rng(7)

    def textura():  # 64 × 64: ruido suavizado con una caja de 3 × 3, para que haya bordes sin rejilla fija
        n = rng.uniform(0, 255, (66, 66))
        return M.gradient(sum(n[i:i + 64, j:j + 64] for i in range(3) for j in range(3)) / 9)
    escena = textura()
    bg = np.ones((64, 64), dtype=bool)
    bg[16:56, 24:40] = False  # la persona
    otra_persona = escena.copy()
    otra_persona[16:56, 24:40] = 0  # cambia sólo quien está: la misma escena
    same = M.scene_alignment(escena, bg, [(1.0, otra_persona, bg)])
    assert same['valid'] and same['similarity'] > 0.99 and same['shift'] == [0, 0], same
    # La misma escena desplazada 4 píxeles: se encuentra el desplazamiento.
    m = M.scene_alignment(escena, bg, [(1.0, np.roll(escena, 4, 1), np.roll(bg, 4, 1))])
    assert m['similarity'] > 0.99 and m['shift'] == [4, 0], m
    assert M.scene_alignment(escena, bg, [(1.0, textura(), bg)])['similarity'] < 0.3
    # Con un radio de búsqueda impar, el desplazamiento cero sigue entrando: la imagen contra sí misma da 1.
    # (68 × 68 centrada: radio 68 // 6 + 2 + 2 = 15, impar).
    impar = np.pad(escena, 2)
    r = M.scene_alignment(escena, bg, [(1.06, impar, np.pad(bg, 2))])
    assert r['similarity'] > 0.99 and r['shift'] == [0, 0], r
    assert M.scene_alignment(escena, np.zeros((64, 64), dtype=bool), [(1.0, escena, bg)])['issues'] == ['TOO_LITTLE_BACKGROUND']


def t8():
    # Dos cuerpos; sólo el de la izquierda tiene cara (el otro, de perfil). Se tapa el de la derecha por CUERPO.
    H, W = 200, 300
    izq, der = np.zeros((H, W), bool), np.zeros((H, W), bool)
    izq[40:180, 40:110] = True
    der[40:180, 190:260] = True
    faces = [(face(cx=75, cy=60, fw=40, fh=50), 0.0)]
    poses = [pose(cx=225, cy=60), pose(cx=75, cy=60)]   # el orden de PoseLandmarker no es el de la imagen
    bodies = M.bodies_of([der, izq], poses, faces)
    assert [b['face'] for b in bodies] == [0, None] and bodies[0]['center'][0] < bodies[1]['center'][0], bodies
    m, boxes = M.hole_mask([der, izq], bodies, [1], 5)
    assert 0.63 < boxes[0][0] < 0.65 and 0.85 < boxes[0][2] < 0.87, boxes
    # Un píxel suelto lejos del cuerpo no estira la caja.
    suelto = der.copy(); suelto[100, 5] = True
    b2 = M.bodies_of([suelto, izq], poses, faces)
    assert b2[1]['box'][0] > 0.6, b2
    assert m[100, 225] and not m[100, 75] and m[100, 188] and not m[100, 150], 'la derecha, dilatada, sin tocar a la izquierda'
    for raw in ['x', {'bodies': []}, {'bodies': [0, 0]}, {'bodies': [0], 'dilate_px': 0}, {'persons': [0]}]:
        try:
            M.parse_hole(raw)
        except M.MeasureError as e:
            assert e.label == 'MEASURE_BAD_REQUEST'
            continue
        raise AssertionError(f'no falló: {raw!r}')
    assert M.parse_hole({'bodies': [1]}) == {'bodies': [1], 'dilate_px': M.HOLE_DILATE_DEFAULT}
    try:
        M.hole_mask([der, izq], bodies, [5], 5)
        raise AssertionError('índice fuera de rango sin fallar')
    except M.MeasureError as e:
        assert e.label == 'MEASURE_BAD_REQUEST'


def t9():
    # Los detectores se cargan los dos o ninguno: una carga a medias no deja a la instancia rota para siempre.
    llamadas = []
    real = M._model_path
    try:
        def falla_pose(key):
            llamadas.append(key)
            if key == 'pose':
                raise M.MeasureError('MEASURE_MODEL_UNAVAILABLE', 'pose: timeout', 503)
            return real(key)
        M._model_path = falla_pose
        M._DET.clear()
        try:
            M.detectors()
            raise AssertionError('no falló')
        except M.MeasureError:
            pass
        assert 'face' not in M._DET and 'pose' not in M._DET, M._DET.keys()
        # Con 'face' sola (el estado roto de antes), la guarda vuelve a cargar en vez de caer en KeyError.
        M._DET.clear(); M._DET['face'] = object()
        try:
            M.detectors()
        except M.MeasureError:
            pass
        assert llamadas.count('pose') == 2, llamadas
    finally:
        M._model_path = real
        M._DET.clear()


test('1 · measure: ausente mide todo; mal formado, 400 con nombre', t1)
test('2 · hombros / cara y sus casos no válidos', t2)
test('3 · cada cara con su pose', t3)
test('4 · el pelo cuenta sólo la persona: fondo oscuro o claro, la misma medida', t4)
test('5 · identidad: reparto uno a uno por coseno, el resto es complemento', t5)
test('6 · la alineación a la plantilla ArcFace es una semejanza exacta', t6)
test('7 · escena: cambiar sólo a la persona no la cambia; un desplazamiento se encuentra; otra escena no pasa', t7)
test('8 · hueco por CUERPO (también sin cara): dilatado, sin tocar al vecino; índices validados', t8)
test('9 · detectores: los dos o ninguno; una carga a medias se reintenta', t9)
print(f'\n{9 - len(fails)} ok, {len(fails)} fallan')
sys.exit(1 if fails else 0)
