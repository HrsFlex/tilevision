import { useRef, useState, useCallback, useEffect } from 'react';

interface Transform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function useRoomCanvas(containerRef: React.RefObject<HTMLDivElement | null>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [transform, setTransform] = useState<Transform>({ scale: 1, offsetX: 0, offsetY: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const fitToViewport = useCallback(
    (imgWidth: number, imgHeight: number) => {
      const container = containerRef.current;
      if (!container) return;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const scale = Math.min(cw / imgWidth, ch / imgHeight, 1);
      const offsetX = (cw - imgWidth * scale) / 2;
      const offsetY = (ch - imgHeight * scale) / 2;
      setTransform({ scale, offsetX, offsetY });
      setImageSize({ width: imgWidth, height: imgHeight });
    },
    [containerRef],
  );

  // Convert screen coords to image coords
  const screenToImage = useCallback(
    (sx: number, sy: number): [number, number] => {
      const canvas = canvasRef.current;
      if (!canvas) return [0, 0];
      const rect = canvas.getBoundingClientRect();
      const x = (sx - rect.left - transform.offsetX) / transform.scale;
      const y = (sy - rect.top - transform.offsetY) / transform.scale;
      return [x, y];
    },
    [transform],
  );

  // Mouse wheel zoom
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      setTransform((prev) => {
        const newScale = Math.max(0.1, Math.min(10, prev.scale * zoomFactor));
        const ratio = newScale / prev.scale;
        return {
          scale: newScale,
          offsetX: mx - ratio * (mx - prev.offsetX),
          offsetY: my - ratio * (my - prev.offsetY),
        };
      });
    },
    [],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanning.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setTransform((prev) => ({
      ...prev,
      offsetX: prev.offsetX + dx,
      offsetY: prev.offsetY + dy,
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  // Attach wheel listener
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  return {
    canvasRef,
    transform,
    imageSize,
    fitToViewport,
    screenToImage,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
