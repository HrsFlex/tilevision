import { useRef, useEffect, useCallback } from 'react';
import { useRoomCanvas } from '../hooks/useRoomCanvas';
import type { Surface } from '../types';

interface Props {
  roomImageUrl: string | null;
  surfaces: Surface[];
  selectedSurfaceId: string | null;
  texturedCanvases: Map<string, HTMLCanvasElement>;
  onImageClick: (x: number, y: number) => void;
  onImageLoaded: (width: number, height: number) => void;
}

export default function RoomViewer({
  roomImageUrl,
  surfaces,
  selectedSurfaceId,
  texturedCanvases,
  onImageClick,
  onImageLoaded,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    canvasRef,
    transform,
    fitToViewport,
    screenToImage,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  } = useRoomCanvas(containerRef);

  const roomImageRef = useRef<HTMLImageElement | null>(null);
  const maskImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Load room image
  useEffect(() => {
    if (!roomImageUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      roomImageRef.current = img;
      fitToViewport(img.naturalWidth, img.naturalHeight);
      onImageLoaded(img.naturalWidth, img.naturalHeight);
    };
    img.src = roomImageUrl;
  }, [roomImageUrl, fitToViewport, onImageLoaded]);

  // Load mask images
  useEffect(() => {
    for (const surface of surfaces) {
      if (!maskImagesRef.current.has(surface.id)) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          maskImagesRef.current.set(surface.id, img);
          draw();
        };
        img.src = surface.maskUrl;
      }
    }
  }, [surfaces]);

  // Draw everything
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const roomImg = roomImageRef.current;
    if (!canvas || !ctx || !roomImg) return;

    const container = containerRef.current;
    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(transform.offsetX, transform.offsetY);
    ctx.scale(transform.scale, transform.scale);

    // 1. Draw original room image
    ctx.drawImage(roomImg, 0, 0);

    // 2. Draw textured surfaces (applied materials)
    for (const [surfaceId, texCanvas] of texturedCanvases) {
      ctx.drawImage(texCanvas, 0, 0);
    }

    // 3. Draw mask overlays for surfaces without texture
    for (const surface of surfaces) {
      const hasTexture = texturedCanvases.has(surface.id);
      if (hasTexture) continue;

      const maskImg = maskImagesRef.current.get(surface.id);
      if (!maskImg) continue;

      // Draw colored overlay
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = roomImg.naturalWidth;
      tmpCanvas.height = roomImg.naturalHeight;
      const tmpCtx = tmpCanvas.getContext('2d')!;

      tmpCtx.drawImage(maskImg, 0, 0, tmpCanvas.width, tmpCanvas.height);
      tmpCtx.globalCompositeOperation = 'source-in';
      tmpCtx.fillStyle = surface.color;
      if (surface.id === selectedSurfaceId) {
        // Brighter for selected
        tmpCtx.fillStyle = surface.color.replace('0.4', '0.6');
      }
      tmpCtx.fillRect(0, 0, tmpCanvas.width, tmpCanvas.height);

      ctx.drawImage(tmpCanvas, 0, 0);
    }

    ctx.restore();

    // Draw crosshair hint
    ctx.fillStyle = '#666';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(
      surfaces.length === 0 ? 'Click on a surface to detect it' : `${surfaces.length} surface(s) detected`,
      canvas.width - 10,
      canvas.height - 10,
    );
  }, [canvasRef, transform, surfaces, selectedSurfaceId, texturedCanvases]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const img = roomImageRef.current;
      if (img) fitToViewport(img.naturalWidth, img.naturalHeight);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [fitToViewport]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.altKey) return; // alt+click = pan
      const [x, y] = screenToImage(e.clientX, e.clientY);
      const img = roomImageRef.current;
      if (!img) return;
      if (x >= 0 && y >= 0 && x < img.naturalWidth && y < img.naturalHeight) {
        onImageClick(x, y);
      }
    },
    [screenToImage, onImageClick],
  );

  return (
    <div ref={containerRef} className="relative w-full h-full bg-gray-900 overflow-hidden cursor-crosshair">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
}
