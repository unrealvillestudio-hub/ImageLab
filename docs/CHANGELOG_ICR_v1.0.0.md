
# CHANGELOG - ImageLab Tools ICR v1.0.0 (Release Candidate)

### Hardening & Stability
- **Global Debug Mode**: Interruptor global persistente que habilita paneles HUD en tiempo real y exportación de metadatos JSON completos por imagen generada.
- **Strict Slot Typing**: Los assets ahora tienen tipos estrictos (`product`, `background`, `person`, `ref`).
- **Alpha Detection**: Detección automática de transparencia para sugerir `product`/`person` en subidas nuevas.
- **Pixel Lock Enforcement**:
  - **E-Commerce Studio**: Bloquea la generación si los slots están invertidos (A=Fondo, B=Producto) y ofrece corrección en 1 click ("Swap Slots").
  - **Scene Creator (Overlay)**: Misma política de bloqueo estricto.
  - **PromptPack Runner**: Valida `slot_policies` en el JSON de entrada; bloquea si un job requiere `PIXEL_LOCK` y el asset de entrada no es compatible.

### UI/UX
- **Live Preview Determinista**: Vista previa en tiempo real para E-Commerce y Scene Creator (Overlay) que refleja escala, posición, sombras y AO sin gastar créditos de generación.
- **Fullscreen Preview**: Botón para expandir el preview con zoom y debug overlay legible.
- **Library Badges**: Indicadores visuales (PROD, BG, PER, REF) en los thumbnails de la librería.
- **Exportable Metadata**: Botón "JSON ⬇" en el panel de debug para descargar la traza completa de generación.

### Modules
- **Avatar Generator**:
  - Protocolos de Identity Lock (Strict/Soft).
  - Lógica de Refs visuales separada de identidad.
  - Soporte para modos Solo/Duo.
- **Customize Station**: Restaurado el acceso a la configuración de marcas y packs.

### Rollback Instructions
Para revertir a este estado estable, desplegar el tag `imagelab_tools_icr_v1.0.0` o utilizar el build.zip adjunto en el release.
