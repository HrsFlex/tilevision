/**
 * Perspective-correct texture mapping via homography.
 *
 * Given a mask (ImageData), we:
 * 1. Find the convex hull / bounding quad of the mask
 * 2. Compute a homography from those 4 corners to a unit rectangle
 * 3. For each pixel inside the mask, apply inverse homography to get UV
 * 4. Sample the tile texture with wrapping (modulo tile size)
 */

import type { TileSettings } from '../types';

/**
 * Find 4 approximate corners of a mask region for homography.
 * Uses a simple approach: find extremes (top-left, top-right, bottom-left, bottom-right).
 */
export function findQuadCorners(maskData: ImageData): [number, number][] {
  const { width, height, data } = maskData;
  const points: [number, number][] = [];

  // Collect all mask pixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx] > 128 || data[idx + 3] > 128) {
        points.push([x, y]);
      }
    }
  }

  if (points.length < 4) {
    return [[0, 0], [width, 0], [width, height], [0, height]];
  }

  // Find bounding box corners weighted by actual mask shape
  let tl = points[0], tr = points[0], bl = points[0], br = points[0];
  let tlScore = Infinity, trScore = Infinity, blScore = Infinity, brScore = Infinity;

  for (const [x, y] of points) {
    const s1 = x + y;          // top-left minimizes x+y
    const s2 = (width - x) + y; // top-right minimizes (W-x)+y
    const s3 = x + (height - y); // bottom-left minimizes x+(H-y)
    const s4 = (width - x) + (height - y); // bottom-right minimizes (W-x)+(H-y)

    if (s1 < tlScore) { tlScore = s1; tl = [x, y]; }
    if (s2 < trScore) { trScore = s2; tr = [x, y]; }
    if (s3 < blScore) { blScore = s3; bl = [x, y]; }
    if (s4 < brScore) { brScore = s4; br = [x, y]; }
  }

  return [tl, tr, br, bl]; // clockwise from top-left
}

/**
 * Compute 3x3 homography matrix mapping src[4] → dst[4] (perspective transform).
 * Uses direct linear transform (DLT) with 4 point correspondences.
 */
export function computeHomography(
  src: [number, number][],
  dst: [number, number][],
): number[] {
  // Build 8x9 matrix for Ax = 0 (DLT)
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([-x, -y, -1, 0, 0, 0, u * x, u * y, u]);
    A.push([0, 0, 0, -x, -y, -1, v * x, v * y, v]);
  }

  // Solve with SVD-like approach: use last row of V from A^T A
  // For 4 points, we can solve directly
  const AtA = Array.from({ length: 9 }, () => new Float64Array(9));
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 9; j++) {
      for (let k = 0; k < 9; k++) {
        AtA[j][k] += A[i][j] * A[i][k];
      }
    }
  }

  // Power iteration to find smallest eigenvector — sufficient for 4 point homography
  // For POC, use a simpler direct solve approach
  return solveHomography4Point(src, dst);
}

/**
 * Direct 4-point homography solve.
 */
function solveHomography4Point(
  src: [number, number][],
  dst: [number, number][],
): number[] {
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, -u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, -v]);
  }

  // Gaussian elimination on 8x9 augmented matrix
  const m = rows.map((r) => [...r]);

  for (let col = 0; col < 8; col++) {
    // Find pivot
    let maxRow = col;
    for (let row = col + 1; row < 8; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[maxRow][col])) maxRow = row;
    }
    [m[col], m[maxRow]] = [m[maxRow], m[col]];

    const pivot = m[col][col];
    if (Math.abs(pivot) < 1e-12) continue;

    for (let j = col; j < 9; j++) m[col][j] /= pivot;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = m[row][col];
      for (let j = col; j < 9; j++) m[row][j] -= factor * m[col][j];
    }
  }

  // h[8] = 1, extract h[0..7] from last column
  const h = new Array(9);
  h[8] = 1;
  for (let i = 0; i < 8; i++) {
    h[i] = -m[i][8];
  }

  return h;
}

/**
 * Apply homography to transform a point.
 */
export function applyHomography(H: number[], x: number, y: number): [number, number] {
  const w = H[6] * x + H[7] * y + H[8];
  if (Math.abs(w) < 1e-12) return [0, 0];
  const u = (H[0] * x + H[1] * y + H[2]) / w;
  const v = (H[3] * x + H[4] * y + H[5]) / w;
  return [u, v];
}

/**
 * Generate a tiled texture pattern on a canvas.
 */
export function generateTilePattern(
  tileImage: HTMLImageElement,
  settings: TileSettings,
  patternWidth: number,
  patternHeight: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = patternWidth;
  canvas.height = patternHeight;
  const ctx = canvas.getContext('2d')!;

  // Scale: pixels per mm (assume ~3 px/mm for reasonable density)
  const pxPerMm = 3;
  const tileW = settings.widthMm * pxPerMm;
  const tileH = settings.heightMm * pxPerMm;
  const groutW = Math.max(1, settings.groutWidthMm * pxPerMm);

  // Fill grout color
  ctx.fillStyle = settings.groutColor;
  ctx.fillRect(0, 0, patternWidth, patternHeight);

  const cellW = tileW + groutW;
  const cellH = tileH + groutW;

  // Apply rotation
  if (settings.rotation !== 0) {
    ctx.save();
    ctx.translate(patternWidth / 2, patternHeight / 2);
    ctx.rotate((settings.rotation * Math.PI) / 180);
    ctx.translate(-patternWidth / 2, -patternHeight / 2);
  }

  const cols = Math.ceil(patternWidth / cellW) + 2;
  const rows = Math.ceil(patternHeight / cellH) + 2;

  for (let row = -1; row < rows; row++) {
    let offsetX = 0;
    if (settings.layout === 'brick' && row % 2 === 1) {
      offsetX = cellW / 2;
    }

    for (let col = -1; col < cols; col++) {
      const x = col * cellW + offsetX;
      const y = row * cellH;
      ctx.drawImage(tileImage, x, y, tileW, tileH);
    }
  }

  if (settings.rotation !== 0) {
    ctx.restore();
  }

  return canvas;
}

/**
 * Apply a tile texture to a surface mask with perspective correction.
 * Returns ImageData with the textured surface (transparent outside mask).
 */
export function applyTextureToMask(
  maskData: ImageData,
  tilePattern: HTMLCanvasElement,
  lightmapImage: HTMLImageElement | null,
): ImageData {
  const { width, height, data: maskPixels } = maskData;

  // Get tile pattern data
  const patternCtx = tilePattern.getContext('2d')!;
  const patternData = patternCtx.getImageData(0, 0, tilePattern.width, tilePattern.height);

  // Find quad corners and compute homography
  const corners = findQuadCorners(maskData);
  const unitRect: [number, number][] = [
    [0, 0],
    [tilePattern.width, 0],
    [tilePattern.width, tilePattern.height],
    [0, tilePattern.height],
  ];

  // Homography: image space → texture space
  const H = computeHomography(corners, unitRect);

  // Get lightmap data if available
  let lightmapData: ImageData | null = null;
  if (lightmapImage) {
    const lmCanvas = document.createElement('canvas');
    lmCanvas.width = width;
    lmCanvas.height = height;
    const lmCtx = lmCanvas.getContext('2d')!;
    lmCtx.drawImage(lightmapImage, 0, 0, width, height);
    lightmapData = lmCtx.getImageData(0, 0, width, height);
  }

  // Output
  const output = new ImageData(width, height);
  const outData = output.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const maskAlpha = maskPixels[idx + 3] > 0 ? maskPixels[idx] : 0;

      if (maskAlpha < 128) {
        // Outside mask — transparent
        outData[idx + 3] = 0;
        continue;
      }

      // Map image pixel to texture coordinate
      const [u, v] = applyHomography(H, x, y);
      const tx = ((Math.floor(u) % tilePattern.width) + tilePattern.width) % tilePattern.width;
      const ty = ((Math.floor(v) % tilePattern.height) + tilePattern.height) % tilePattern.height;

      const tIdx = (ty * tilePattern.width + tx) * 4;
      let r = patternData.data[tIdx];
      let g = patternData.data[tIdx + 1];
      let b = patternData.data[tIdx + 2];

      // Apply lightmap (multiply blend)
      if (lightmapData) {
        const lm = lightmapData.data[idx] / 128; // 128 = neutral
        r = Math.min(255, Math.round(r * lm));
        g = Math.min(255, Math.round(g * lm));
        b = Math.min(255, Math.round(b * lm));
      }

      outData[idx] = r;
      outData[idx + 1] = g;
      outData[idx + 2] = b;
      outData[idx + 3] = 255;
    }
  }

  return output;
}
