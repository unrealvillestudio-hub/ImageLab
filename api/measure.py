"""ImageLab — POST /api/measure (y GET para diagnóstico): medida DETERMINISTA de personas en una imagen.

2026-11-19. Sam: «sí, hazlo, sería un buen upgrade». Las medidas de identidad del set (BluePrints tools/identity) usan
MediaPipe en Python; en la función Node de ImageLab MediaPipe no corre (pide WebGL). Versión 0.10.21: ver pyproject.toml. Esta función Python corre MediaPipe
en CPU y devuelve, por cada persona de la imagen:

  body: { shoulders_over_face_w, valid, issues[] }      hombros (pose 11-12) / ancho de cara (FaceLandmarker 234-454)
  hair: { width_ratio, height_ratio, hair_top_clipped, valid, issues[] }
        ancho del pelo oscuro de la frente al mentón y alto sobre la frente, ÷ ancho / alto de cara, contando SÓLO los
        píxeles de la persona (máscara de PoseLandmarker): el fondo oscuro de un estudio no se confunde con pelo.

Es la MISMA geometría que `tools/identity/proportions.py` y `hair_volume.py` de BluePrints, para que la referencia del set
y la medida de la escena sean comparables. Esta función mide; NO decide: el carril compara con la referencia de la
persona (dato de su ficha) y decide con su tolerancia.

2026-11-21 (1.1.0) — DOS MEDIDAS MÁS, pedidas por Sam («sí a 4 y E»): una imagen de varias personas salió con caras que
no eran las de la marca, y la edición «misma escena» devolvió otra escena (medido en la pieza 8cde215d).

  identity: { embedding?, scores: {id: coseno}, person_id, measurable, issues[] }
        SFace (OpenCV Zoo, Apache 2.0) sobre la cara alineada a la plantilla ArcFace con los puntos de FaceLandmarker.
        Con referencias, cada cara recibe A LO SUMO una persona y cada persona A LO SUMO una cara (el par de coseno más
        alto primero, sobre el umbral); la cara sin persona es complemento (`person_id: null`). Una cara girada más de
        MAX_ID_YAW no se identifica (NOT_IDENTIFIABLE_YAW): ni aprueba ni suspende.
  scene: { similarity, scale, shift, valid, issues[] }   (a nivel de imagen, no de persona)
        correlación del gradiente del FONDO —lo que no es persona en ninguna de las dos— contra la imagen de referencia,
        buscando la escala y el desplazamiento del reencuadre. Medido: la misma escena 0,86; otra, ≤ 0,29.

Pedido:  { image_url | image_data_url, measure?: { body?: true, hair?: true | { dark_threshold },
                                                 identity?: true | { references: [{ id, embeddings: [[128]] }], threshold?, embed? },
                                                 scene?: { reference_image_url | reference_image_data_url } } }
         GET /api/measure?image_url=https://…  (sólo para diagnóstico; mismas reglas)
Sin `measure`, se miden cuerpo y pelo (identidad y escena sólo si se piden). Errores con nombre: MEASURE_BAD_REQUEST, MEASURE_IMAGE_MISSING, MEASURE_IMAGE_FETCH_FAILED,
MEASURE_MODEL_UNAVAILABLE, MEASURE_FAILED.

Casos en que una medida NO vale, y lo dice (`valid: false` + `issues`): NOT_FRONTAL (|yaw| > MAX_YAW: perfil y 3/4 no se
juzgan), NO_POSE (la cara no tiene cuerpo asociado), SHOULDERS_NOT_VISIBLE, NO_PERSON_MASK, HAIR_NOT_DARK.

Dependencias: `pyproject.toml` en la raíz. MediaPipe importa OpenCV, matplotlib y sounddevice sólo para dibujar y para
audio; se excluyen en la instalación (`[tool.uv] override-dependencies`) y aquí se cubre su import con módulos vacíos
(`api/_measure_stubs/`), para que la función quepa en el límite de Vercel. libEGL/libGLESv2 van en `api/_measure_libs/`
(ver su README). Modelos: se descargan en el arranque en frío a
/tmp desde URL fijadas por versión y se verifican por sha256 (no se guardan en el repo).

EJE (código): la geometría y sus comprobaciones. INSTANCIA (dato): referencia y tolerancia de cada persona, en su ficha.
El código no nombra personas ni marcas.
"""
import base64
import hashlib
import io
import json
import os
import sys
import time
import urllib.request
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, '_measure_stubs'))


def _preload_gl():
    """MediaPipe enlaza libEGL/libGLESv2 aunque mida en CPU, y el runtime de Vercel no las trae (api/_measure_libs/README.md).
    Cargadas antes con RTLD_GLOBAL, el cargador las encuentra por su soname al abrir libmediapipe.so. Si el sistema ya
    las tiene, se usan las del sistema."""
    import ctypes
    import ctypes.util
    for name in ('libGLdispatch.so.0', 'libEGL.so.1', 'libGLESv2.so.2'):
        try:
            ctypes.CDLL(name, mode=ctypes.RTLD_GLOBAL)
        except OSError:
            ctypes.CDLL(os.path.join(_HERE, '_measure_libs', name), mode=ctypes.RTLD_GLOBAL)


_preload_gl()

MEASURE_VERSION = '1.1.0'
MAX_YAW = 20.0          # grados: más girada que esto, la medida frontal no vale
DARK_DEFAULT = 80       # luminancia 0..255 del pelo oscuro; dato de la persona si se pasa
MAX_FACES = 4
# 2026-11-21 — IDENTIDAD (SFace) y ESCENA. Por encima de este giro la cara no se identifica (SFace se entrenó con caras
# alineadas de frente y de tres cuartos; medido el 2026-11-21: un perfil de unos 50° no da cara útil).
MAX_ID_YAW = 35.0
ID_THRESHOLD_DEFAULT = 0.363   # coseno de SFace en el que OpenCV fija «misma persona» (umbral publicado del modelo)
SCENE_WIDTH = 64                # ancho al que se reducen las dos imágenes para comparar su escena
SCENE_SCALES = tuple(round(0.75 + 0.05 * i, 2) for i in range(13))   # 0,75 … 1,35: el reencuadre que se tolera
SCENE_BG_MIN_SHARE = 0.3        # con menos fondo común que este tanto de la imagen, la escena no se puede comparar
# La plantilla de ArcFace (5 puntos en 112 × 112): ojos, nariz y comisuras. SFace espera la cara alineada a ella.
ARCFACE_112 = ((38.2946, 51.6963), (73.5318, 51.5014), (56.0252, 71.7366), (41.5493, 92.3655), (70.7299, 92.2041))
FETCH_TIMEOUT_S = 20
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MODELS = {
    'face': ('https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
             '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'),
    'pose': ('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
             '64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b'),
    # SFace (OpenCV Zoo, Apache 2.0): 128 números por cara; dos caras de la misma persona dan coseno alto.
    'sface': ('https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/'
              'face_recognition_sface_2021dec.onnx',
              '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79'),
}


class MeasureError(Exception):
    def __init__(self, label, message, status):
        super().__init__(message)
        self.label, self.status = label, status


# ── NÚCLEO PURO (sin red): de píxeles y puntos a medidas. Lo prueba tests/medida_test.py ──────────────────────────
def pair_pose(nose, face_w, poses):
    """El índice de la pose cuya nariz (pose 0) está a menos de media cara de la nariz de la cara, o -1."""
    best, dist = -1, None
    for j, P in enumerate(poses):
        d = ((P[0][0] - nose[0]) ** 2 + (P[0][1] - nose[1]) ** 2) ** 0.5
        if d < 0.5 * face_w and (dist is None or d < dist):
            best, dist = j, d
    return best


def body_measure(F, P, frontal):
    """Hombros / ancho de cara. F: 478 puntos de cara (x, y); P: 33 puntos de pose (x, y, visibilidad) o None."""
    import numpy as np
    out = {'valid': False, 'issues': []}
    if P is None:
        out['issues'].append('NO_POSE')
        return out
    fw = float(np.linalg.norm(F[234] - F[454]))
    if min(P[11][2], P[12][2]) < 0.5:
        out['issues'].append('SHOULDERS_NOT_VISIBLE')
    if not frontal:
        out['issues'].append('NOT_FRONTAL')
    out['shoulders_over_face_w'] = round(float(np.hypot(P[11][0] - P[12][0], P[11][1] - P[12][1]) / fw), 3)
    out['valid'] = not out['issues']
    return out


def hair_measure(F, lum, mask, frontal, dark=DARK_DEFAULT):
    """Volumen del pelo con la geometría de hair_volume.py, contando sólo píxeles oscuros de la persona."""
    import numpy as np
    out = {'valid': False, 'issues': []}
    if mask is None:
        out['issues'].append('NO_PERSON_MASK')
        return out
    H, W = lum.shape
    hair = (lum < dark) & mask
    fw = float(np.linalg.norm(F[234] - F[454]))
    fh = float(np.linalg.norm(F[10] - F[152]))
    cx = (F[234][0] + F[454][0]) / 2
    top, chin = F[10][1], F[152][1]
    a, b = int(max(0, cx - 1.6 * fw)), int(min(W, cx + 1.6 * fw))
    width = 0
    for y in range(int(max(0, top)), int(min(H, chin))):
        xs = np.where(hair[y, a:b])[0]
        if len(xs):
            width = max(width, int(xs.max() - xs.min()))
    y0 = top - 1.2 * fh
    band = hair[int(max(0, y0)):int(max(0, top)), int(max(0, cx - .6 * fw)):int(min(W, cx + .6 * fw))]
    rows = np.where(band.any(1))[0]
    out['hair_top_clipped'] = bool(y0 < 0 and len(rows) and rows.min() == 0)
    out['width_ratio'] = round(width / fw, 3)
    out['height_ratio'] = None if out['hair_top_clipped'] or not len(rows) else round(float((len(band) - rows.min()) / fh), 3)
    if width <= 1.02 * fw:
        out['issues'].append('HAIR_NOT_DARK')
    if not frontal:
        out['issues'].append('NOT_FRONTAL')
    out['valid'] = not out['issues']
    return out


def arcface_points(F):
    """Los 5 puntos de la plantilla ArcFace a partir de los 478 de FaceLandmarker: centro de cada ojo (33+133, 362+263),
    punta de la nariz (1) y comisuras (61, 291)."""
    import numpy as np
    return np.array([(F[33] + F[133]) / 2, (F[362] + F[263]) / 2, F[1], F[61], F[291]], dtype=float)


def similarity_transform(src, dst):
    """Umeyama: la semejanza (giro, escala uniforme y traslación) que lleva `src` a `dst` por mínimos cuadrados.
    Devuelve (A 2×2, t 2) con dst ≈ A·src + t."""
    import numpy as np
    src, dst = np.asarray(src, dtype=float), np.asarray(dst, dtype=float)
    ms, md = src.mean(0), dst.mean(0)
    s, d = src - ms, dst - md
    U, S, Vt = np.linalg.svd(d.T @ s / len(src))
    D = np.eye(2)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        D[1, 1] = -1
    R = U @ D @ Vt
    scale = float((S * np.diag(D)).sum() / (s ** 2).sum() * len(src))
    A = scale * R
    return A, md - A @ ms


def assign_identities(scores, ref_ids, threshold):
    """Reparto UNO A UNO de caras y personas de referencia. `scores[i][j]` es el coseno de la cara i con la persona j, o
    None si la cara no es identificable. Gana el par de coseno más alto, se retiran los dos, y así hasta que no queda par
    por encima del umbral. Devuelve, por cara, el id asignado o None (complemento: alguien que no es ninguna referencia)."""
    pares = sorted(((s, i, j) for i, fila in enumerate(scores) if fila is not None
                    for j, s in enumerate(fila) if s is not None and s >= threshold), reverse=True)
    out, usadas = [None] * len(scores), set()
    for s, i, j in pares:
        if out[i] is None and j not in usadas:
            out[i], _ = ref_ids[j], usadas.add(j)
    return out


def gradient(l):
    """Magnitud del gradiente (diferencias centrales). La escena se compara por sus bordes, no por su luz: un cambio de
    exposición o de color no es otra escena."""
    import numpy as np
    gx, gy = np.zeros_like(l), np.zeros_like(l)
    gx[:, 1:-1] = l[:, 2:] - l[:, :-2]
    gy[1:-1] = l[2:] - l[:-2]
    return np.hypot(gx, gy)


def scene_alignment(ref_g, ref_bg, cands):
    """La mejor correlación normalizada entre el FONDO de la referencia y el de la candidata, buscando la escala y el
    desplazamiento con que el generador pudo reencuadrar la misma escena. `ref_g`/`ref_bg`: gradiente y fondo (no
    persona) de la referencia; `cands`: [(escala, gradiente, fondo)] de la candidata reescalada. Sólo cuentan los píxeles
    que son fondo en las dos. Devuelve { similarity, scale, shift, valid, issues }.

    Medido el 2026-11-21 sobre la pieza 8cde215d: la edición que conservó el estudio da 0,862; el collage que lo perdió,
    0,268; otras dos escenas del mismo estudio, 0,274 y 0,292; una escena de jardín, 0,212."""
    import numpy as np
    H, W = ref_g.shape
    best = {'similarity': None, 'scale': None, 'shift': None}
    for sc, g, bg in cands:
        Hb, Wb = g.shape
        ry, rx = Hb // 6 + abs(Hb - H) // 2 + 2, Wb // 6 + abs(Wb - W) // 2 + 2
        # Pasos de 2 píxeles que SIEMPRE incluyen el desplazamiento cero (con un radio impar, un rango que empieza en
        # -radio lo saltaría: medido el 2026-11-21, la imagen contra sí misma daba 0,794).
        for dy in range(-(ry - ry % 2), ry + 1, 2):
            for dx in range(-(rx - rx % 2), rx + 1, 2):
                oy, ox = (Hb - H) // 2 + dy, (Wb - W) // 2 + dx
                y0, y1, x0, x1 = max(0, -oy), min(H, Hb - oy), max(0, -ox), min(W, Wb - ox)
                if (y1 - y0) * (x1 - x0) < 0.5 * H * W:
                    continue
                m = ref_bg[y0:y1, x0:x1] & bg[y0 + oy:y1 + oy, x0 + ox:x1 + ox]
                if m.sum() < SCENE_BG_MIN_SHARE * H * W:
                    continue
                u = ref_g[y0:y1, x0:x1][m]
                v = g[y0 + oy:y1 + oy, x0 + ox:x1 + ox][m]
                u, v = u - u.mean(), v - v.mean()
                r = float((u * v).sum() / np.sqrt((u * u).sum() * (v * v).sum() + 1e-9))
                if best['similarity'] is None or r > best['similarity']:
                    best = {'similarity': r, 'scale': round(float(sc), 2), 'shift': [dx, dy]}
    out = {**best, 'issues': []}
    if out['similarity'] is None:
        out['issues'].append('TOO_LITTLE_BACKGROUND')
    else:
        out['similarity'] = round(out['similarity'], 3)
    out['valid'] = not out['issues']
    return out


def parse_measure(raw):
    """`measure` del pedido. Ausente ⇒ cuerpo y pelo. Mal formado ⇒ MEASURE_BAD_REQUEST."""
    if raw is None:
        return {'body': True, 'hair': True, 'dark': DARK_DEFAULT, 'identity': None, 'scene': None}
    if not isinstance(raw, dict) or set(raw) - {'body', 'hair', 'identity', 'scene'}:
        raise MeasureError('MEASURE_BAD_REQUEST', 'measure debe ser { body?, hair?, identity?, scene? }', 400)
    identity = parse_identity(raw.get('identity'))
    scene = parse_scene(raw.get('scene'))
    hair = raw.get('hair')
    dark = DARK_DEFAULT
    if isinstance(hair, dict):
        dark = hair.get('dark_threshold', DARK_DEFAULT)
        if not isinstance(dark, (int, float)) or not 1 <= dark <= 254:
            raise MeasureError('MEASURE_BAD_REQUEST', 'measure.hair.dark_threshold debe estar entre 1 y 254', 400)
    elif hair not in (None, True, False):
        raise MeasureError('MEASURE_BAD_REQUEST', 'measure.hair debe ser true o un objeto', 400)
    if raw.get('body') not in (None, True, False):
        raise MeasureError('MEASURE_BAD_REQUEST', 'measure.body debe ser true o false', 400)
    return {'body': raw.get('body') is True, 'hair': hair is True or isinstance(hair, dict), 'dark': float(dark),
            'identity': identity, 'scene': scene}


def parse_identity(raw):
    """`measure.identity`. `true` ⇒ devuelve el vector de cada cara (para sembrar referencias). Un objeto
    `{ references: [{ id, embeddings: [[128 números], …] }], threshold? }` ⇒ además asigna cada cara a una referencia."""
    if raw in (None, False):
        return None
    if raw is True:
        return {'references': [], 'threshold': ID_THRESHOLD_DEFAULT, 'embed': True}
    if not isinstance(raw, dict) or set(raw) - {'references', 'threshold', 'embed'}:
        raise MeasureError('MEASURE_BAD_REQUEST', 'measure.identity debe ser true o { references, threshold?, embed? }', 400)
    th = raw.get('threshold', ID_THRESHOLD_DEFAULT)
    if not isinstance(th, (int, float)) or isinstance(th, bool) or not 0 < th < 1:
        raise MeasureError('MEASURE_BAD_REQUEST', 'measure.identity.threshold debe estar entre 0 y 1', 400)
    refs = raw.get('references', [])
    if not isinstance(refs, list) or len(refs) > 8:
        raise MeasureError('MEASURE_BAD_REQUEST', 'measure.identity.references debe ser una lista de hasta 8', 400)
    out, vistos = [], set()
    for r in refs:
        rid = r.get('id') if isinstance(r, dict) else None
        embs = r.get('embeddings') if isinstance(r, dict) else None
        if not isinstance(rid, str) or not rid or rid in vistos:
            raise MeasureError('MEASURE_BAD_REQUEST', 'cada referencia lleva un id de texto, único', 400)
        if (not isinstance(embs, list) or not 1 <= len(embs) <= 12
                or any(not isinstance(e, list) or len(e) != 128 or not all(isinstance(v, (int, float)) for v in e) for e in embs)):
            raise MeasureError('MEASURE_BAD_REQUEST', f'la referencia {rid}: embeddings debe ser de 1 a 12 vectores de 128', 400)
        vistos.add(rid)
        out.append({'id': rid, 'embeddings': embs})
    return {'references': out, 'threshold': float(th), 'embed': raw.get('embed') is True}


def parse_scene(raw):
    """`measure.scene`: `{ reference_image_url | reference_image_data_url }`, la imagen con la que se compara el fondo."""
    if raw is None:
        return None
    if (not isinstance(raw, dict) or set(raw) - {'reference_image_url', 'reference_image_data_url'}
            or not (raw.get('reference_image_url') or raw.get('reference_image_data_url'))):
        raise MeasureError('MEASURE_BAD_REQUEST', 'measure.scene debe ser { reference_image_url | reference_image_data_url }', 400)
    return {'image_url': raw.get('reference_image_url'), 'image_data_url': raw.get('reference_image_data_url')}


# ── MODELOS Y DETECCIÓN ────────────────────────────────────────────────────────────────────────────────────────────
_DET = {}


def _model_path(key):
    url, sha = MODELS[key]
    path = os.path.join('/tmp', f'imagelab_{key}_{sha[:12]}.task')
    if not os.path.exists(path):
        try:
            with urllib.request.urlopen(url, timeout=FETCH_TIMEOUT_S) as r:
                data = r.read()
        except Exception as e:  # noqa: BLE001
            raise MeasureError('MEASURE_MODEL_UNAVAILABLE', f'{key}: {str(e)[:160]}', 503)
        if hashlib.sha256(data).hexdigest() != sha:
            raise MeasureError('MEASURE_MODEL_UNAVAILABLE', f'{key}: sha256 no coincide con el fijado', 503)
        with open(path + '.part', 'wb') as f:
            f.write(data)
        os.replace(path + '.part', path)
    return path


def detectors():
    if not _DET:
        from mediapipe.tasks.python import BaseOptions, vision
        _DET['face'] = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=_model_path('face')), num_faces=MAX_FACES,
            output_facial_transformation_matrixes=True))
        _DET['pose'] = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=_model_path('pose')), num_poses=MAX_FACES,
            output_segmentation_masks=True))
    return _DET['face'], _DET['pose']


def _faces_in(face, rgb, offset=(0, 0), scale=1.0):
    import mediapipe as mp
    import numpy as np
    H, W = rgb.shape[:2]
    r = face.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    out = []
    for i, L in enumerate(r.face_landmarks):
        F = np.array([[q.x * W / scale + offset[0], q.y * H / scale + offset[1]] for q in L])
        M = np.array(r.facial_transformation_matrixes[i])[:3, :3]
        out.append((F, float(np.degrees(np.arcsin(-M[2, 0])))))
    return out


def sface():
    if 'sface' not in _DET:
        import onnxruntime as ort
        _DET['sface'] = ort.InferenceSession(_model_path('sface'), providers=['CPUExecutionProvider'])
    return _DET['sface']


def embed_face(rgb, F):
    """El vector SFace (128, norma 1) de una cara: se alinea a la plantilla ArcFace de 112 × 112 y se pasa al modelo."""
    import numpy as np
    from PIL import Image
    A, t = similarity_transform(arcface_points(F), ARCFACE_112)
    Ai = np.linalg.inv(A)
    ti = -Ai @ t
    im = Image.fromarray(rgb).transform((112, 112), Image.AFFINE,
                                        (Ai[0, 0], Ai[0, 1], ti[0], Ai[1, 0], Ai[1, 1], ti[1]), Image.BILINEAR)
    x = np.asarray(im, dtype=np.float32).transpose(2, 0, 1)[None]
    sess = sface()
    e = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
    return e / np.linalg.norm(e)


def analyze(rgb):
    """Caras, poses y máscaras de persona de una imagen. Las caras pequeñas se buscan en un recorte ampliado alrededor de
    la cabeza de cada pose que no tenga cara (el detector de cara de MediaPipe es de corto alcance)."""
    import mediapipe as mp
    import numpy as np
    from PIL import Image
    face, pose = detectors()
    H, W = rgb.shape[:2]
    pr = pose.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    poses = [np.array([[q.x * W, q.y * H, q.visibility] for q in L]) for L in pr.pose_landmarks]
    masks = [m.numpy_view().reshape(H, W) > 0.5 for m in (pr.segmentation_masks or [])]
    faces = _faces_in(face, rgb)
    for P in poses:
        nose = P[0]
        if any(pair_pose(F[1], float(np.linalg.norm(F[234] - F[454])), [P]) == 0 for F, _ in faces):
            continue
        sw = float(np.hypot(P[11][0] - P[12][0], P[11][1] - P[12][1])) or 0.2 * W
        s = 0.6 * sw
        x0, y0 = int(max(0, nose[0] - s)), int(max(0, nose[1] - 1.2 * s))
        x1, y1 = int(min(W, nose[0] + s)), int(min(H, nose[1] + 0.8 * s))
        if x1 - x0 < 16 or y1 - y0 < 16:
            continue
        k = 512.0 / (x1 - x0)
        crop = np.asarray(Image.fromarray(rgb[y0:y1, x0:x1]).resize((512, int((y1 - y0) * k)), Image.LANCZOS))
        faces += _faces_in(face, crop, offset=(x0, y0), scale=k)
    return faces, poses, masks


def person_mask(shape, masks):
    import numpy as np
    m = np.zeros(shape[:2], dtype=bool)
    for x in masks:
        m |= x
    return m


def measure_image(rgb, want, found=None):
    """Todas las personas de la imagen, ordenadas de izquierda a derecha."""
    import numpy as np
    faces, poses, masks = found or analyze(rgb)
    H, W = rgb.shape[:2]
    lum = rgb.mean(2)
    ident = want.get('identity')
    refs = ident['references'] if ident else []
    persons, scores = [], []
    for F, yaw in faces:
        fw = float(np.linalg.norm(F[234] - F[454]))
        j = pair_pose(F[1], fw, poses)
        P = poses[j] if j >= 0 else None
        mask = masks[j] if j >= 0 and j < len(masks) else None
        frontal = abs(yaw) <= MAX_YAW
        p = {'face_box': [round(float(F[:, 0].min() / W), 4), round(float(F[:, 1].min() / H), 4),
                          round(float(F[:, 0].max() / W), 4), round(float(F[:, 1].max() / H), 4)],
             'face_width_px': round(fw, 1), 'yaw': round(yaw, 1), 'frontal': frontal}
        if want['body']:
            p['body'] = body_measure(F, P, frontal)
        if want['hair']:
            p['hair'] = hair_measure(F, lum, mask, frontal, want['dark'])
        fila = None
        if ident:
            idm = {'issues': []}
            if abs(yaw) > MAX_ID_YAW:
                idm['issues'].append('NOT_IDENTIFIABLE_YAW')
            else:
                e = embed_face(rgb, F)
                if ident['embed']:
                    idm['embedding'] = [round(float(v), 5) for v in e]
                fila = [max(float(e @ np.asarray(x, dtype=float) / (np.linalg.norm(x) or 1)) for x in r['embeddings'])
                        for r in refs]
                idm['scores'] = {r['id']: round(s, 3) for r, s in zip(refs, fila)}
            idm['measurable'] = not idm['issues']
            p['identity'] = idm
        scores.append(fila)
        persons.append(p)
    if ident and refs:
        asignado = assign_identities(scores, [r['id'] for r in refs], ident['threshold'])
        for p, a in zip(persons, asignado):
            p['identity']['person_id'] = a
    persons.sort(key=lambda q: q['face_box'][0])
    return persons


def measure_scene(ref_rgb, rgb, ref_found, found):
    """El fondo de `rgb` contra el de `ref_rgb`, fuera de las personas de las dos. Ver `scene_alignment`."""
    import numpy as np
    from PIL import Image

    def prep(x, mask, w):
        h = max(8, int(round(w * x.shape[0] / x.shape[1])))
        lum = np.asarray(Image.fromarray(x).convert('L').resize((w, h), Image.BILINEAR), dtype=float)
        bg = np.asarray(Image.fromarray(mask.astype(np.uint8) * 255).resize((w, h), Image.BILINEAR)) < 128
        return gradient(lum), bg

    ref_g, ref_bg = prep(ref_rgb, person_mask(ref_rgb.shape, ref_found[2]), SCENE_WIDTH)
    m = person_mask(rgb.shape, found[2])
    cands = [(sc, *prep(rgb, m, int(round(SCENE_WIDTH * sc)))) for sc in SCENE_SCALES]
    return scene_alignment(ref_g, ref_bg, cands)


def load_image(body):
    import numpy as np
    from PIL import Image, ImageOps
    url, du = body.get('image_url'), body.get('image_data_url')
    if isinstance(du, str) and du.startswith('data:image/'):
        data = base64.b64decode(du.split(',', 1)[1])
    elif isinstance(url, str) and url.startswith(('https://', 'http://')):
        try:
            with urllib.request.urlopen(url, timeout=FETCH_TIMEOUT_S) as r:
                data = r.read(MAX_IMAGE_BYTES + 1)
        except Exception as e:  # noqa: BLE001
            raise MeasureError('MEASURE_IMAGE_FETCH_FAILED', str(e)[:200], 502)
    else:
        raise MeasureError('MEASURE_IMAGE_MISSING', 'falta image_url (http/https) o image_data_url', 400)
    if len(data) > MAX_IMAGE_BYTES:
        raise MeasureError('MEASURE_BAD_REQUEST', 'imagen de más de 20 MB', 400)
    return np.asarray(ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert('RGB'))


def run(body):
    t0 = time.time()
    want = parse_measure(body.get('measure'))
    rgb = load_image(body)
    found = analyze(rgb)
    persons = measure_image(rgb, want, found)
    out = {'status': 'ok', 'mode': 'measure', 'measure_version': MEASURE_VERSION,
           'image': {'width': int(rgb.shape[1]), 'height': int(rgb.shape[0])}, 'persons': persons}
    if want.get('scene'):
        ref = load_image(want['scene'])
        out['scene'] = measure_scene(ref, rgb, analyze(ref), found)
    out['models'] = {k: v[1][:12] for k, v in MODELS.items() if k in _DET or k != 'sface'}
    out['duration_ms'] = int((time.time() - t0) * 1000)
    return out


class handler(BaseHTTPRequestHandler):  # noqa: N801 — nombre que exige el runtime de Vercel
    def _send(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    def _do(self, body):
        try:
            self._send(200, run(body))
        except MeasureError as e:
            self._send(e.status, {'status': 'error', 'error_label': e.label, 'error': str(e)})
        except Exception as e:  # noqa: BLE001
            self._send(500, {'status': 'error', 'error_label': 'MEASURE_FAILED', 'error': str(e)[:300]})

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):  # noqa: N802
        q = parse_qs(urlparse(self.path).query)
        self._do({'image_url': (q.get('image_url') or [None])[0]})

    def do_POST(self):  # noqa: N802
        try:
            n = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self.rfile.read(n) or b'{}')
            if not isinstance(body, dict):
                raise ValueError
        except Exception:  # noqa: BLE001
            self._send(400, {'status': 'error', 'error_label': 'MEASURE_BAD_REQUEST', 'error': 'JSON inválido'})
            return
        self._do(body)
