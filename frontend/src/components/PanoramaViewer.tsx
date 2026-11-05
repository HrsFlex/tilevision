import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { TileSettings } from '../types';

/**
 * Surface identifier.
 *
 * For synthetic panoramas we use the hardcoded NSEW walls; for panoramas
 * processed by the HorizonNet layout service walls are numbered
 * "wall_0", "wall_1", ... .  Using `string` keeps both paths uniform.
 */
export type SurfaceName = string;

export interface PanoSurface {
  name: SurfaceName;
  label: string;
  maskUrl: string;
  maskData: ImageData | null;
  materialId: string | null;
}

export interface RoomLayout {
  /** Floor polygon vertices in metres, frontend convention (x east, z forward). */
  floorPolygon: [number, number][];
  roomHeightM: number;
  cameraHeightM: number;
}

export const SURFACE_LABELS: Record<string, string> = {
  floor: 'Floor',
  ceiling: 'Ceiling',
  wall_north: 'Back Wall',
  wall_south: 'Front Wall',
  wall_east: 'Right Wall',
  wall_west: 'Left Wall',
};

const COMP_W = 2048;
const COMP_H = 1024;

// Legacy hardcoded cuboid dimensions used when no dynamic layout is supplied
// (e.g. the original synthetic panorama produced by generate_masks.py).
const LEGACY_ROOM_W = 4.5;
const LEGACY_ROOM_H = 2.8;
const LEGACY_ROOM_D = 5.0;

interface UVPoint {
  px: number;
  py: number;
  su: number;
  sv: number;
}

interface TilePatternResult {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  tileWidthMeters: number;
  tileHeightMeters: number;
}

function dirFromEquirect(px: number, py: number): [number, number, number] {
  const theta = (px / COMP_W) * 2 * Math.PI;
  const phi = (py / COMP_H) * Math.PI;

  return [
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.cos(theta),
  ];
}

/**
 * Legacy UV builder: hardcoded axis-aligned cuboid with NSEW walls.
 * Kept for backward compatibility with the synthetic panorama that ships
 * with the app.
 */
function buildUVMapLegacy(maskData: Uint8ClampedArray, name: SurfaceName): UVPoint[] {
  const halfWidth = LEGACY_ROOM_W / 2;
  const halfHeight = LEGACY_ROOM_H / 2;
  const halfDepth = LEGACY_ROOM_D / 2;
  const points: UVPoint[] = [];

  for (let py = 0; py < COMP_H; py += 1) {
    for (let px = 0; px < COMP_W; px += 1) {
      if (maskData[(py * COMP_W + px) * 4] < 128) continue;
      const [dx, dy, dz] = dirFromEquirect(px + 0.5, py + 0.5);
      let su = 0;
      let sv = 0;
      switch (name) {
        case 'floor': {
          if (dy >= -1e-9) continue;
          const t = -halfHeight / dy;
          su = dx * t + halfWidth;
          sv = dz * t + halfDepth;
          break;
        }
        case 'ceiling': {
          if (dy <= 1e-9) continue;
          const t = halfHeight / dy;
          su = dx * t + halfWidth;
          sv = dz * t + halfDepth;
          break;
        }
        case 'wall_north': {
          if (dz >= -1e-9) continue;
          const t = -halfDepth / dz;
          su = dx * t + halfWidth;
          sv = dy * t + halfHeight;
          break;
        }
        case 'wall_south': {
          if (dz <= 1e-9) continue;
          const t = halfDepth / dz;
          su = dx * t + halfWidth;
          sv = dy * t + halfHeight;
          break;
        }
        case 'wall_east': {
          if (dx <= 1e-9) continue;
          const t = halfWidth / dx;
          su = dz * t + halfDepth;
          sv = dy * t + halfHeight;
          break;
        }
        case 'wall_west': {
          if (dx >= -1e-9) continue;
          const t = -halfWidth / dx;
          su = dz * t + halfDepth;
          sv = dy * t + halfHeight;
          break;
        }
        default:
          continue;
      }
      points.push({ px, py, su, sv });
    }
  }
  return points;
}

/**
 * Polygon-aware UV builder used when the backend supplies dynamic room
 * dimensions.  Handles `floor`, `ceiling`, and `wall_{i}` surfaces.
 */
function buildUVMapPolygon(
  maskData: Uint8ClampedArray,
  name: SurfaceName,
  layout: RoomLayout,
): UVPoint[] {
  const points: UVPoint[] = [];
  const { floorPolygon, roomHeightM, cameraHeightM } = layout;
  const floorY = -cameraHeightM;
  const ceilY = roomHeightM - cameraHeightM;

  // Origin offset so that floor/ceiling UVs are >= 0.
  let minX = Infinity;
  let minZ = Infinity;
  for (const [x, z] of floorPolygon) {
    if (x < minX) minX = x;
    if (z < minZ) minZ = z;
  }

  // Wall edge lookup
  let edge: { p1: [number, number]; p2: [number, number]; length: number } | null = null;
  if (name.startsWith('wall_')) {
    const i = Number.parseInt(name.slice('wall_'.length), 10);
    if (!Number.isFinite(i) || i < 0 || i >= floorPolygon.length) return points;
    const p1 = floorPolygon[i];
    const p2 = floorPolygon[(i + 1) % floorPolygon.length];
    const ex = p2[0] - p1[0];
    const ez = p2[1] - p1[1];
    edge = { p1, p2, length: Math.hypot(ex, ez) };
  }

  for (let py = 0; py < COMP_H; py += 1) {
    for (let px = 0; px < COMP_W; px += 1) {
      if (maskData[(py * COMP_W + px) * 4] < 128) continue;
      const [dx, dy, dz] = dirFromEquirect(px + 0.5, py + 0.5);
      let su = 0;
      let sv = 0;

      if (name === 'floor') {
        if (dy >= -1e-9) continue;
        const t = floorY / dy;
        if (t <= 0) continue;
        su = t * dx - minX;
        sv = t * dz - minZ;
      } else if (name === 'ceiling') {
        if (dy <= 1e-9) continue;
        const t = ceilY / dy;
        if (t <= 0) continue;
        su = t * dx - minX;
        sv = t * dz - minZ;
      } else if (edge) {
        // Solve t*(dx, dz) = P1 + s*(ex, ez)
        const { p1, p2, length } = edge;
        const ex = p2[0] - p1[0];
        const ez = p2[1] - p1[1];
        const det = ex * dz - ez * dx;
        if (Math.abs(det) < 1e-9) continue;
        const t = (ex * p1[1] - ez * p1[0]) / det;
        const s = (dx * p1[1] - dz * p1[0]) / det;
        if (t <= 0 || s < -1e-6 || s > 1 + 1e-6) continue;
        const hitY = t * dy;
        if (hitY < floorY - 1e-3 || hitY > ceilY + 1e-3) continue;
        su = s * length;
        sv = hitY - floorY;
      } else {
        continue;
      }

      points.push({ px, py, su, sv });
    }
  }
  return points;
}

function buildUVMap(
  maskData: Uint8ClampedArray,
  name: SurfaceName,
  layout: RoomLayout | null,
): UVPoint[] {
  if (layout) return buildUVMapPolygon(maskData, name, layout);
  return buildUVMapLegacy(maskData, name);
}

function buildTilePattern(tileImage: HTMLImageElement, settings: TileSettings): TilePatternResult {
  const tilePixels = 256;
  const aspectRatio = settings.heightMm / settings.widthMm;
  const cellWidth = tilePixels;
  const cellHeight = Math.round(tilePixels * aspectRatio);
  const groutPixels = Math.max(
    1,
    Math.round((settings.groutWidthMm / settings.widthMm) * tilePixels),
  );
  const isBrick = settings.layout === 'brick';
  const patternWidth = isBrick ? cellWidth * 2 : cellWidth;
  const patternHeight = isBrick ? cellHeight * 2 : cellHeight;
  const canvas = document.createElement('canvas');

  canvas.width = patternWidth;
  canvas.height = patternHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to create tile pattern context');
  }

  context.fillStyle = settings.groutColor;
  context.fillRect(0, 0, patternWidth, patternHeight);

  const drawWidth = cellWidth - groutPixels;
  const drawHeight = cellHeight - groutPixels;

  if (isBrick) {
    context.drawImage(tileImage, 0, 0, drawWidth, drawHeight);
    context.drawImage(tileImage, cellWidth, 0, drawWidth, drawHeight);

    const offset = Math.round(cellWidth / 2);
    context.drawImage(tileImage, offset, cellHeight, drawWidth, drawHeight);
    context.drawImage(tileImage, offset - patternWidth, cellHeight, drawWidth, drawHeight);
    context.drawImage(tileImage, offset + patternWidth, cellHeight, drawWidth, drawHeight);
  } else {
    context.drawImage(tileImage, 0, 0, drawWidth, drawHeight);
  }

  return {
    data: context.getImageData(0, 0, patternWidth, patternHeight).data,
    width: patternWidth,
    height: patternHeight,
    tileWidthMeters: settings.widthMm / 1000,
    tileHeightMeters: settings.heightMm / 1000,
  };
}

function paintSurface(
  outputData: Uint8ClampedArray,
  panoramaData: Uint8ClampedArray,
  uvMap: UVPoint[],
  tilePattern: TilePatternResult,
): void {
  // Compute mean luminance of this surface from the ORIGINAL panorama so we
  // can transfer shading onto the tile (shadows in corners, bright patches
  // near windows, light-temperature cast, ambient occlusion, etc.).
  let sumL = 0;
  let n = 0;
  for (const { px, py } of uvMap) {
    const idx = (py * COMP_W + px) * 4;
    sumL += 0.2126 * panoramaData[idx] +
            0.7152 * panoramaData[idx + 1] +
            0.0722 * panoramaData[idx + 2];
    n++;
  }
  if (n === 0) return;
  const meanL = Math.max(1, sumL / n);

  for (const { px, py, su, sv } of uvMap) {
    const origIdx = (py * COMP_W + px) * 4;
    const oR = panoramaData[origIdx];
    const oG = panoramaData[origIdx + 1];
    const oB = panoramaData[origIdx + 2];
    const oL = 0.2126 * oR + 0.7152 * oG + 0.0722 * oB;

    const u = ((su / tilePattern.tileWidthMeters) % 1 + 1) % 1;
    const v = ((sv / tilePattern.tileHeightMeters) % 1 + 1) % 1;
    const sourceX = Math.min(Math.floor(u * tilePattern.width), tilePattern.width - 1);
    const sourceY = Math.min(Math.floor(v * tilePattern.height), tilePattern.height - 1);
    const sourceIndex = (sourceY * tilePattern.width + sourceX) * 4;
    const targetIndex = origIdx;

    // Shading transfer — multiply tile by relative luminance of the photo
    // at this point.  Clamp so specular clips and deep shadows don't kill
    // the tile's own colour.
    let shade = oL / meanL;
    if (shade < 0.55) shade = 0.55;
    else if (shade > 1.45) shade = 1.45;

    const tR = tilePattern.data[sourceIndex];
    const tG = tilePattern.data[sourceIndex + 1];
    const tB = tilePattern.data[sourceIndex + 2];

    // 85% shaded tile + 15% original colour cast (light temperature carry-over).
    const outR = tR * shade * 0.85 + oR * 0.15;
    const outG = tG * shade * 0.85 + oG * 0.15;
    const outB = tB * shade * 0.85 + oB * 0.15;

    outputData[targetIndex] = outR < 0 ? 0 : outR > 255 ? 255 : outR;
    outputData[targetIndex + 1] = outG < 0 ? 0 : outG > 255 ? 255 : outG;
    outputData[targetIndex + 2] = outB < 0 ? 0 : outB > 255 ? 255 : outB;
    outputData[targetIndex + 3] = 255;
  }
}

function usePanoComposite(
  panoramaUrl: string,
  surfaces: PanoSurface[],
  tileImages: Map<string, HTMLImageElement>,
  tileSettings: TileSettings,
  layout: RoomLayout | null,
): { texture: THREE.CanvasTexture | null; loading: boolean } {
  const panoramaDataRef = useRef<ImageData | null>(null);
  const uvMapsRef = useRef<Map<SurfaceName, UVPoint[]>>(new Map());
  const loadedMaskKeysRef = useRef<Set<string>>(new Set());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);

  const bumpVersion = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    setLoading(true);

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = COMP_W;
      canvas.height = COMP_H;

      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }

      context.drawImage(image, 0, 0, COMP_W, COMP_H);
      panoramaDataRef.current = context.getImageData(0, 0, COMP_W, COMP_H);

      if (!canvasRef.current) {
        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = COMP_W;
        outputCanvas.height = COMP_H;
        canvasRef.current = outputCanvas;
      }

      bumpVersion();
    };
    image.src = panoramaUrl;
  }, [panoramaUrl, bumpVersion]);

  useEffect(() => {
    // Layout change invalidates all cached UV maps; rebuild them.
    loadedMaskKeysRef.current.clear();
    uvMapsRef.current.clear();

    surfaces.forEach((surface) => {
      const maskKey = `${surface.name}:${surface.maskUrl}`;
      if (loadedMaskKeysRef.current.has(maskKey)) {
        return;
      }

      loadedMaskKeysRef.current.add(maskKey);

      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = COMP_W;
        canvas.height = COMP_H;

        const context = canvas.getContext('2d');
        if (!context) {
          return;
        }

        context.drawImage(image, 0, 0, COMP_W, COMP_H);
        const maskImage = context.getImageData(0, 0, COMP_W, COMP_H);
        uvMapsRef.current.set(surface.name, buildUVMap(maskImage.data, surface.name, layout));
        bumpVersion();
      };
      image.src = surface.maskUrl;
    });
  }, [surfaces, layout, bumpVersion]);

  useEffect(() => {
    const panoramaData = panoramaDataRef.current;
    const outputCanvas = canvasRef.current;

    if (!panoramaData || !outputCanvas) {
      return;
    }

    const outputPixels = new Uint8ClampedArray(panoramaData.data);

    surfaces.forEach((surface) => {
      if (!surface.materialId) {
        return;
      }

      const tileImage = tileImages.get(surface.materialId);
      const uvMap = uvMapsRef.current.get(surface.name);

      if (!tileImage || !uvMap) {
        return;
      }

      const tilePattern = buildTilePattern(tileImage, tileSettings);
      paintSurface(outputPixels, panoramaData.data, uvMap, tilePattern);
    });

    const context = outputCanvas.getContext('2d');
    if (!context) {
      return;
    }

    context.putImageData(new ImageData(outputPixels, COMP_W, COMP_H), 0, 0);

    if (!textureRef.current) {
      textureRef.current = new THREE.CanvasTexture(outputCanvas);
      textureRef.current.colorSpace = THREE.SRGBColorSpace;
    } else {
      textureRef.current.needsUpdate = true;
    }

    setLoading(false);
  }, [version, surfaces, tileImages, tileSettings]);

  useEffect(() => {
    return () => {
      textureRef.current?.dispose();
    };
  }, []);

  return { texture: textureRef.current, loading };
}

function PanoSphere({ texture }: { texture: THREE.CanvasTexture | null }) {
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);

  useEffect(() => {
    if (!materialRef.current || !texture) {
      return;
    }

    materialRef.current.map = texture;
    materialRef.current.needsUpdate = true;
  }, [texture]);

  return (
    <mesh scale={[-1, 1, 1]}>
      <sphereGeometry args={[50, 64, 32]} />
      <meshBasicMaterial ref={materialRef} side={THREE.BackSide} depthWrite={false} />
    </mesh>
  );
}

export interface PanoramaViewerProps {
  panoramaUrl: string;
  surfaces: PanoSurface[];
  tileImages: Map<string, HTMLImageElement>;
  tileSettings: TileSettings;
  selectedSurface: SurfaceName | null;
  layout?: RoomLayout | null;
}

export default function PanoramaViewer({
  panoramaUrl,
  surfaces,
  tileImages,
  tileSettings,
  selectedSurface,
  layout = null,
}: PanoramaViewerProps) {
  const { texture, loading } = usePanoComposite(
    panoramaUrl,
    surfaces,
    tileImages,
    tileSettings,
    layout,
  );

  return (
    <div className="relative h-full w-full bg-black">
      {loading && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/20 backdrop-blur-[1px]">
          <div className="rounded-full border border-white/10 bg-black/70 px-4 py-2 text-sm text-white shadow-lg">
            Loading panorama...
          </div>
        </div>
      )}

      <Canvas
        gl={{ antialias: true }}
        camera={{ position: [0.01, 0, 0.01], fov: 75, near: 0.1, far: 200 }}
      >
        <PanoSphere texture={texture} />
        <OrbitControls
          enablePan={false}
          enableZoom={true}
          rotateSpeed={-0.3}
          zoomSpeed={0.5}
          target={[0, 0, 0]}
          minPolarAngle={0.1}
          maxPolarAngle={Math.PI - 0.1}
          minDistance={0.1}
          maxDistance={20}
        />
      </Canvas>

      <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/45 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/45 to-transparent" />

      <div className="pointer-events-none absolute bottom-3 right-3 rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-xs text-white/75 shadow">
        Drag to look around · Scroll to zoom
      </div>

      {selectedSurface && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-sky-400/35 bg-slate-900/80 px-4 py-1.5 text-sm text-sky-100 shadow-lg">
          {SURFACE_LABELS[selectedSurface] ?? surfaces.find((s) => s.name === selectedSurface)?.label ?? selectedSurface} selected - choose a tile from the left panel
        </div>
      )}
    </div>
  );
}
