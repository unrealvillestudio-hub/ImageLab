"""ImageLab — POST /api/measure (y GET para diagnóstico): medida DETERMINISTA de personas en una imagen.

2026-11-19. Sam: «sí, hazlo, sería un buen upgrade». Las medidas de identidad del set (BluePrints tools/identity) usan
MediaPipe en Python; en la función Node de ImageLab MediaPipe no corre (pide WebGL). Esta función Python corre MediaPipe
en CPU y devuelve, por cada persona de la imagen:

  body: { shoulders_over_face_w, valid, issues[] }      hombros (pose 11-12) / ancho de cara (FaceLandmarker 234-454)
  hair: { width_ratio, height_ratio, hair_top_clipped, valid, issues[] }
        ancho del pelo oscuro de la frente al mentón y alto sobre la frente, ÷ ancho / alto de cara, contando SÓLO los
        píxeles de la persona (máscara de PoseLandmarker): el fondo oscuro de un estudio no se confunde con pelo.

Es la MISMA geometría que `tools/identity/proportions.py` y `hair_volume.py` de BluePrints, para que la referencia del set
y la medida de la escena sean comparables. Esta función mide; NO decide: el carril compara con la referencia de la
persona (dato de su ficha) y decide con su tolerancia.

Pedido:  { image_url | image_data_url, measure?: { body?: true, hair?: true | { dark_threshold } } }
         GET /api/measure?image_url=https://…  (sólo para diagnóstico; mismas reglas)
Sin `measure`, se mide todo. Errores con nombre: MEASURE_BAD_REQUEST, MEASURE_IMAGE_MISSING, MEASURE_IMAGE_FETCH_FAILED,
MEASURE_MODEL_UNAVAILABLE, MEASURE_FAILED.

Casos en que una medida NO vale, y lo dice (`valid: false` + `issues`): NOT_FRONTAL (|yaw| > MAX_YAW: perfil y 3/4 no se
juzgan), NO_POSE (la cara no tiene cuerpo asociado), SHOULDERS_NOT_VISIBLE, NO_PERSON_MASK, HAIR_NOT_DARK.

Dependencias: `pyproject.toml` en la raíz. MediaPipe importa OpenCV, matplotlib y sounddevice sólo para dibujar y para
audio; se excluyen en la instalación (`[tool.uv] override-dependencies`) y aquí se cubre su import con módulos vacíos
(`api/_measure_stubs/`), para que la función quepa en el límite de Vercel. Modelos: se descargan en el arranque en frío a
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

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '_measure_stubs'))

MEASURE_VERSION = '1.0.0'
MAX_YAW = 20.0          # grados: más girada que esto, la medida frontal no vale
DARK_DEFAULT = 80       # luminancia 0..255 del pelo oscuro; dato de la persona si se pasa
MAX_FACES = 4
FETCH_TIMEOUT_S = 20
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MODELS = {
    'face': ('https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
             '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'),
    'pose': ('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
             '64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b'),
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


def parse_measure(raw):
    """`measure` del pedido. Ausente ⇒ todo. Mal formado ⇒ MEASURE_BAD_REQUEST."""
    if raw is None:
        return {'body': True, 'hair': True, 'dark': DARK_DEFAULT}
    if not isinstance(raw, dict) or set(raw) - {'body', 'hair'}:
        raise MeasureError('MEASURE_BAD_REQUEST', 'measure debe ser { body?, hair? }', 400)
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
    return {'body': raw.get('body') is True, 'hair': hair is True or isinstance(hair, dict), 'dark': float(dark)}


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


def measure_image(rgb, want):
    """Todas las personas de la imagen. Las caras pequeñas se buscan en un recorte ampliado alrededor de la cabeza de cada
    pose que no tenga cara (el detector de cara de MediaPipe es de corto alcance)."""
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
    lum = rgb.mean(2)
    persons = []
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
        persons.append(p)
    persons.sort(key=lambda q: q['face_box'][0])
    return persons


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
    persons = measure_image(rgb, want)
    return {'status': 'ok', 'mode': 'measure', 'measure_version': MEASURE_VERSION,
            'image': {'width': int(rgb.shape[1]), 'height': int(rgb.shape[0])}, 'persons': persons,
            'models': {k: v[1][:12] for k, v in MODELS.items()}, 'duration_ms': int((time.time() - t0) * 1000)}


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
