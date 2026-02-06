export type FitMode = 'contain' | 'cover' | 'stretch';

export interface ConvertResizeOptions {
  targetWidth: number;
  targetHeight: number;
  fit: FitMode;
  background?: string; 
  outputMime: 'image/webp' | 'image/png' | 'image/jpeg';
  quality?: number; 
}

export async function convertResizeToDataUrl(inputDataUrl: string, opts: ConvertResizeOptions): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = opts.targetWidth;
      canvas.height = opts.targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(inputDataUrl);
        return;
      }

      // Simple fill background if provided
      if (opts.background) {
        ctx.fillStyle = opts.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // Basic drawing logic (simplified for placeholder)
      ctx.drawImage(img, 0, 0, opts.targetWidth, opts.targetHeight);
      
      resolve(canvas.toDataURL(opts.outputMime, opts.quality));
    };
    img.src = inputDataUrl;
  });
}