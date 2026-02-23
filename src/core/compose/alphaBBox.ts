
export type BBox = { x:number; y:number; w:number; h:number };

export async function getAlphaBBox(img:HTMLImageElement, alphaThreshold=8):Promise<BBox>{
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img,0,0);
  const { data, width, height } = ctx.getImageData(0,0,c.width,c.height);

  let minX=width, minY=height, maxX=0, maxY=0;
  let found=false;

  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const a = data[(y*width+x)*4+3];
      if(a>alphaThreshold){
        found=true;
        if(x<minX) minX=x;
        if(y<minY) minY=y;
        if(x>maxX) maxX=x;
        if(y>maxY) maxY=y;
      }
    }
  }
  if(!found) return {x:0,y:0,w:width,h:height};
  return {x:minX,y:minY,w:(maxX-minX+1),h:(maxY-minY+1)};
}
