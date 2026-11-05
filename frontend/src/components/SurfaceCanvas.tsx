import { useEffect, useRef, useCallback, useState } from 'react';
import type { PolygonSurface, TileSettings } from '../types';
import { generateTilePattern, applyTextureToMask } from '../lib/textureMapper';

interface Props {
  roomImageUrl: string;
  surfaces: PolygonSurface[];
  selectedSurfaceId: string | null;
  tileImages: Map<string, HTMLImageElement>;
  tileSettings: TileSettings;
  onImageLoaded?: (w: number, h: number) => void;
  onSurfaceClick?: (id: string) => void;
  aiRenderedUrl?: string | null;
}

function cacheKey(surface: PolygonSurface, settings: TileSettings): string {
  return `${surface.id}_${surface.materialId}_${settings.widthMm}_${settings.heightMm}_${settings.groutWidthMm}_${settings.groutColor}_${settings.layout}`;
}

/** Render perspective-correct tile texture for a polygon surface. */
function renderSurfaceTexture(
  surface: PolygonSurface,
  tileImg: HTMLImageElement,
  settings: TileSettings,
  roomImg: HTMLImageElement,
): HTMLCanvasElement {
  const W = roomImg.naturalWidth;
  const H = roomImg.naturalHeight;

  // Work at reduced resolution for speed, then upscale
  const maxDim = 1200;
  const sc = Math.min(1, maxDim / Math.max(W, H));
  const rW = Math.round(W * sc);
  const rH = Math.round(H * sc);

  // 1. Create polygon mask at reduced resolution
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = rW;
  maskCanvas.height = rH;
  const mc = maskCanvas.getContext('2d')!;
  mc.fillStyle = 'white';
  mc.beginPath();
  surface.polygon.forEach(([nx, ny], i) => {
    if (i === 0) mc.moveTo(nx * rW, ny * rH);
    else mc.lineTo(nx * rW, ny * rH);
  });
  mc.closePath();
  mc.fill();
  const maskData = mc.getImageData(0, 0, rW, rH);

  // 2. Tile pattern
  const pattern = generateTilePattern(tileImg, settings, 1024, 1024);

  // 3. Perspective-correct texture via homography (uses quad-corner detection internally)
  const texturedData = applyTextureToMask(maskData, pattern, null);

  // 4. Put on a temp canvas at reduced resolution
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = rW;
  tempCanvas.height = rH;
  tempCanvas.getContext('2d')!.putImageData(texturedData, 0, 0);

  // 5. Scale back to full resolution and blend with original lighting
  const result = document.createElement('canvas');
  result.width = W;
  result.height = H;
  const rc = result.getContext('2d')!;
  rc.imageSmoothingEnabled = true;
  rc.imageSmoothingQuality = 'high';
  rc.drawImage(tempCanvas, 0, 0, W, H);

  // Multiply blend with original to preserve lighting / shadows
  rc.save();
  rc.globalCompositeOperation = 'multiply';
  rc.globalAlpha = 0.28;
  rc.drawImage(roomImg, 0, 0, W, H);
  rc.restore();

  return result;
}

export default function SurfaceCanvas({
  roomImageUrl,
  surfaces,
  selectedSurfaceId,
  tileImages,
  tileSettings,
  onImageLoaded,
  onSurfaceClick,
  aiRenderedUrl,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roomImgRef = useRef<HTMLImageElement | null>(null);
  const aiImgRef = useRef<HTMLImageElement | null>(null);
  const scaleRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });

  // Perspective-correct texture cache
  const texCache = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const [renderTick, setRenderTick] = useState(0);
  const [rendering, setRendering] = useState(false);

  // ── Re-render textures whenever surfaces / tiles / settings change ──────
  useEffect(() => {
    const roomImg = roomImgRef.current;
    if (!roomImg) return;

    let needed = false;
    for (const s of surfaces) {
      if (!s.materialId) continue;
      const tileImg = tileImages.get(s.materialId);
      if (!tileImg) continue;
      if (!texCache.current.has(cacheKey(s, tileSettings))) {
        needed = true;
        break;
      }
    }
    if (!needed) return;

    setRendering(true);
    // Defer rendering to next animation frame so the UI stays responsive
    requestAnimationFrame(() => {
      const img = roomImgRef.current;
      if (!img) { setRendering(false); return; }

      for (const s of surfaces) {
        if (!s.materialId) continue;
        const tileImg = tileImages.get(s.materialId);
        if (!tileImg) continue;
        const key = cacheKey(s, tileSettings);
        if (texCache.current.has(key)) continue;
        try {
          texCache.current.set(key, renderSurfaceTexture(s, tileImg, tileSettings, img));
        } catch (err) {
          console.warn('Texture render failed for surface', s.name, err);
        }
      }

      setRendering(false);
      setRenderTick((t) => t + 1);
    });
  }, [surfaces, tileImages, tileSettings]);

  // ── Main draw ──────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const container = containerRef.current;
    const roomImg = roomImgRef.current;
    if (!canvas || !ctx || !container || !roomImg) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    canvas.width = cw;
    canvas.height = ch;

    const scale = Math.min(cw / roomImg.naturalWidth, ch / roomImg.naturalHeight);
    const imgW = roomImg.naturalWidth * scale;
    const imgH = roomImg.naturalHeight * scale;
    const ox = (cw - imgW) / 2;
    const oy = (ch - imgH) / 2;
    scaleRef.current = { scale, offsetX: ox, offsetY: oy };

    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    const W = roomImg.naturalWidth;
    const H = roomImg.naturalHeight;

    if (aiRenderedUrl && aiImgRef.current) {
      // Show AI-rendered image
      ctx.drawImage(aiImgRef.current, 0, 0, W, H);
    } else {
      // 1. Room base image
      ctx.drawImage(roomImg, 0, 0, W, H);

      // 2. Surface overlays
      for (const surface of surfaces) {
        if (!surface.polygon || surface.polygon.length < 3) continue;
        const isSelected = surface.id === selectedSurfaceId;

        if (surface.materialId) {
          // Try perspective-correct cached texture
          const cached = texCache.current.get(cacheKey(surface, tileSettings));
          if (cached) {
            ctx.drawImage(cached, 0, 0, W, H);
          } else {
            // Fallback: simple flat fill while rendering
            const pts = surface.polygon.map(([nx, ny]) => [nx * W, ny * H] as [number, number]);
            ctx.save();
            ctx.beginPath();
            pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
            ctx.closePath();
            ctx.fillStyle = 'rgba(99,102,241,0.25)';
            ctx.fill();
            ctx.restore();
          }
        } else {
          // No material — colored polygon overlay
          const pts = surface.polygon.map(([nx, ny]) => [nx * W, ny * H] as [number, number]);
          ctx.save();
          ctx.beginPath();
          pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
          ctx.closePath();
          ctx.fillStyle = isSelected ? 'rgba(99,102,241,0.38)' : 'rgba(99,102,241,0.14)';
          ctx.fill();
          if (isSelected) {
            ctx.strokeStyle = '#818cf8';
            ctx.lineWidth = 3 / scale;
            ctx.setLineDash([10 / scale, 6 / scale]);
            ctx.stroke();
          }
          ctx.restore();
        }
      }
    }

    ctx.restore();
  }, [surfaces, selectedSurfaceId, tileImages, tileSettings, aiRenderedUrl, renderTick]);

  // Load room image
  useEffect(() => {
    if (!roomImageUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      roomImgRef.current = img;
      // Clear texture cache when room changes
      texCache.current.clear();
      onImageLoaded?.(img.naturalWidth, img.naturalHeight);
      draw();
    };
    img.src = roomImageUrl;
  }, [roomImageUrl]); // eslint-disable-line

  // Load AI rendered image
  useEffect(() => {
    if (!aiRenderedUrl) {
      aiImgRef.current = null;
      draw();
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      aiImgRef.current = img;
      draw();
    };
    img.src = aiRenderedUrl;
  }, [aiRenderedUrl]); // eslint-disable-line

  useEffect(() => { draw(); }, [draw]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  // Click-to-select surface
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!onSurfaceClick) return;
      const { scale, offsetX, offsetY } = scaleRef.current;
      const rect = canvasRef.current!.getBoundingClientRect();
      const cx = (e.clientX - rect.left - offsetX) / scale;
      const cy = (e.clientY - rect.top - offsetY) / scale;
      const W = roomImgRef.current?.naturalWidth ?? 1;
      const H = roomImgRef.current?.naturalHeight ?? 1;
      const nx = cx / W;
      const ny = cy / H;

      for (const surface of [...surfaces].reverse()) {
        if (pointInPolygon(nx, ny, surface.polygon)) {
          onSurfaceClick(surface.id);
          return;
        }
      }
    },
    [surfaces, onSurfaceClick],
  );

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#0f1117] overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-pointer"
        onClick={handleClick}
      />
      {rendering && (
        <div className="absolute top-3 right-3 flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-full px-3 py-1.5 pointer-events-none">
          <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-slate-300">Applying perspective…</span>
        </div>
      )}
      {surfaces.length === 0 && roomImgRef.current && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm rounded-full px-4 py-2 text-xs text-slate-300 pointer-events-none">
          Tap "Analyze with AI" to detect surfaces
        </div>
      )}
    </div>
  );
}

function pointInPolygon(x: number, y: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
