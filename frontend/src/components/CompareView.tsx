import { useRef, useEffect, useState } from 'react';

interface Props {
  originalUrl: string | null;
  compositeCanvas: HTMLCanvasElement | null;
}

export default function CompareView({ originalUrl, compositeCanvas }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sliderPos, setSliderPos] = useState(50);
  const [dragging, setDragging] = useState(false);

  const handleMove = (clientX: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setSliderPos(Math.max(0, Math.min(100, pct)));
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => handleMove(e.clientX);
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  if (!originalUrl || !compositeCanvas) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Apply a material to a surface to see the comparison
      </div>
    );
  }

  const compositeUrl = compositeCanvas.toDataURL('image/jpeg', 0.9);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden cursor-col-resize select-none"
      onMouseDown={(e) => {
        setDragging(true);
        handleMove(e.clientX);
      }}
    >
      {/* After (composite) - full width background */}
      <img src={compositeUrl} alt="After" className="absolute inset-0 w-full h-full object-contain" />

      {/* Before (original) - clipped */}
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${sliderPos}%` }}>
        <img src={originalUrl} alt="Before" className="w-full h-full object-contain" style={{ minWidth: containerRef.current?.clientWidth }} />
      </div>

      {/* Slider line */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg z-10"
        style={{ left: `${sliderPos}%` }}
      >
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg">
          <span className="text-gray-700 text-xs font-bold">⟷</span>
        </div>
      </div>

      {/* Labels */}
      <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">Before</div>
      <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">After</div>
    </div>
  );
}
