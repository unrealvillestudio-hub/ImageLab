
export type RemoveBgMethod = 'auto' | 'white' | 'black' | 'custom';

export interface RemoveBgOptions {
  method: RemoveBgMethod;
  threshold: number; // 1..100
  feather: number;   // 0..10
  customColor?: { r: number; g: number; b: number };
}

export async function removeBackground(dataUrl: string, opts: RemoveBgOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Determinar color a remover
      let targetR = 255, targetG = 255, targetB = 255;
      
      if (opts.method === 'auto') {
        // Muestrear las 4 esquinas para adivinar el color de fondo
        const corners = [
          0, 
          (img.width - 1) * 4, 
          (img.width * (img.height - 1)) * 4, 
          (img.width * img.height - 1) * 4
        ];
        // Usar la esquina superior izquierda como referencia principal simple
        targetR = data[0];
        targetG = data[1];
        targetB = data[2];
      } else if (opts.method === 'black') {
        targetR = 0; targetG = 0; targetB = 0;
      } else if (opts.method === 'white') {
        targetR = 255; targetG = 255; targetB = 255;
      }

      const threshold = (opts.threshold || 30); // Sensibilidad (0-255 en realidad, mapeamos input de UI)
      const distSqLimit = threshold * threshold * 3; // Distancia euclidiana cuadrada aproximada

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Calcular distancia de color
        const dr = r - targetR;
        const dg = g - targetG;
        const db = b - targetB;
        
        const distSq = dr*dr + dg*dg + db*db;

        if (distSq < distSqLimit) {
          data[i + 3] = 0; // Alpha transparente
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
