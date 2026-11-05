/**
 * Canvas utility functions for compositing the final visualization.
 */

/**
 * Composite the textured surfaces onto the original room image.
 *
 * Pipeline:
 * 1. Draw original room image
 * 2. For each surface with applied texture, draw the textured ImageData on top
 */
export function compositeScene(
  canvas: HTMLCanvasElement,
  roomImage: HTMLImageElement,
  texturedSurfaces: Array<{ imageData: ImageData }>,
): void {
  const ctx = canvas.getContext('2d')!;
  canvas.width = roomImage.naturalWidth;
  canvas.height = roomImage.naturalHeight;

  // Draw original room
  ctx.drawImage(roomImage, 0, 0);

  // Draw each textured surface on top
  for (const surface of texturedSurfaces) {
    // Create temp canvas for the surface ImageData
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = surface.imageData.width;
    tmpCanvas.height = surface.imageData.height;
    const tmpCtx = tmpCanvas.getContext('2d')!;
    tmpCtx.putImageData(surface.imageData, 0, 0);

    // Draw onto main canvas
    ctx.drawImage(tmpCanvas, 0, 0);
  }
}

/**
 * Export a canvas as a downloadable image.
 */
export function exportCanvas(canvas: HTMLCanvasElement, filename: string = 'visualized-room.jpg'): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/jpeg', 0.95);
  link.click();
}

/**
 * Create an offscreen canvas with an image drawn on it.
 */
export function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return canvas;
}
