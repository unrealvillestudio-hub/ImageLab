# Librerías de sistema para `api/measure.py`

MediaPipe (`libmediapipe.so`) enlaza `libEGL.so.1` y `libGLESv2.so.2` aunque mida en CPU, y el runtime Python de Vercel
(Amazon Linux 2023, glibc 2.34) no las trae: sin ellas, la función respondía `libEGL.so.1: cannot open shared object file`
(medido en el preview de ImageLab #100, 2026-11-20). `api/measure.py` las carga con `ctypes` (RTLD_GLOBAL) antes de
importar MediaPipe.

| Archivo | Origen | sha256 |
|---|---|---|
| `libGLdispatch.so.0` | conda-forge `libglvnd-1.7.0-ha4b6fd6_5` | `fb9e08d6d6898b203ad5ea6cfb70ea7fee87495c2671d0fb6292fd116e27a6e7` |
| `libEGL.so.1` | conda-forge `libegl-1.7.0-ha4b6fd6_5` | `bde411b870193ab4a8d8051b3072b4d9bea4fd9ee83bb1b3b36f3be4c0808b83` |
| `libGLESv2.so.2` | conda-forge `libgles-1.7.0-ha4b6fd6_5` | `26c3c5c8e871e461bac9a2d31b9285cd82f03af45fbbe7a291cbf0b32ccfbeb7` |

Por qué de conda-forge y no del sistema de desarrollo: las de Ubuntu 24.04 exigen glibc 2.38; estas, glibc 2.14 (medido con
`objdump -T`), compatibles con Amazon Linux 2023. Son libglvnd 1.7.0, de licencia permisiva estilo MIT
(https://gitlab.freedesktop.org/glvnd/libglvnd). Para cambiarlas: descargar los tres `.conda` de la misma versión, extraer
`lib/*.so.*` y actualizar esta tabla.
