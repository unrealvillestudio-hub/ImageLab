
export async function getImageDimensions(file: File): Promise<{ w: number; h: number } | null> {
  if (!file.type.startsWith("image/")) return null;

  // createImageBitmap is fast and efficient
  try {
    const bmp = await createImageBitmap(file);
    const w = bmp.width;
    const h = bmp.height;
    bmp.close?.(); // Cleanup if supported
    return { w, h };
  } catch {
    // Fallback using Image object
    return await new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }
}
