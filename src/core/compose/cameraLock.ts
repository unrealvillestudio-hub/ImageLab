
export type CameraBase = {
  sBase: number;     // pxCanvas por pxBG
  cxBg: number;      // centro de cámara en BG coords (px)
  cyBg: number;
};

export function computeCameraBaseFromAuthor(opts:{
  bgW:number; bgH:number;
  authorW:number; authorH:number;
}): CameraBase{
  const { bgW,bgH, authorW,authorH } = opts;

  // COVER en el author (esto define tu "zoom/framing base")
  const sBase = Math.max(authorW/bgW, authorH/bgH);

  // Center-cam por defecto: centro del BG (si luego quieres “anchor negative space”, se ajusta aquí)
  const cxBg = bgW/2;
  const cyBg = bgH/2;

  return { sBase, cxBg, cyBg };
}

export function cameraToDrawTransform(cam:CameraBase, outW:number, outH:number, bgW:number, bgH:number){
  // mantener zoom base; solo subir si el output lo exige para cubrir
  const s = Math.max(cam.sBase, outW/bgW, outH/bgH);
  const dx = outW/2 - cam.cxBg * s;
  const dy = outH/2 - cam.cyBg * s;
  return { s, dx, dy };
}

export function projectCanvasPointToBg(opts:{
  cam:CameraBase;
  bgW:number; bgH:number;
  authorW:number; authorH:number;
  xCanvas:number; yCanvas:number;
}){
  const { cam,bgW,bgH, authorW,authorH, xCanvas,yCanvas } = opts;
  const t = cameraToDrawTransform(cam, authorW, authorH, bgW, bgH);
  const bx = (xCanvas - t.dx)/t.s;
  const by = (yCanvas - t.dy)/t.s;
  return { bx, by };
}

export function projectBgPointToCanvas(opts:{
  cam:CameraBase;
  bgW:number; bgH:number;
  outW:number; outH:number;
  bx:number; by:number;
}){
  const { cam,bgW,bgH, outW,outH, bx,by } = opts;
  const t = cameraToDrawTransform(cam, outW, outH, bgW, bgH);
  const x = bx*t.s + t.dx;
  const y = by*t.s + t.dy;
  return { x,y, t };
}
