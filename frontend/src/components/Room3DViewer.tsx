import { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import * as THREE from 'three';
import type { MaterialInfo, TileSettings } from '../types';

/* ---------- types ---------- */

export type SurfaceName = 'floor' | 'ceiling' | 'wallBack' | 'wallFront' | 'wallLeft' | 'wallRight';

export interface Surface3D {
  name: SurfaceName;
  label: string;
  materialId: string | null;
  texture: THREE.Texture | null;
}

const ROOM_WIDTH = 6;
const ROOM_HEIGHT = 3;
const ROOM_DEPTH = 5;

const SURFACE_LABELS: Record<SurfaceName, string> = {
  floor: 'Floor',
  ceiling: 'Ceiling',
  wallBack: 'Back Wall',
  wallFront: 'Front Wall',
  wallLeft: 'Left Wall',
  wallRight: 'Right Wall',
};

const DEFAULT_COLOR = '#e8e0d4';
const HOVER_COLOR = '#c4d9f0';
const SELECTED_COLOR = '#8bb8e8';

/* ---------- tile pattern generator ---------- */

/**
 * Create a Three.js texture from a tile image with proper repeat-wrapping.
 * Generates a small canvas with one tile cell (tile + grout) and lets
 * Three.js GPU-native RepeatWrapping handle the tiling — fast and reliable.
 */
function generateTileTexture(
  tileImage: HTMLImageElement,
  settings: TileSettings,
  surfaceWidthM: number,
  surfaceHeightM: number,
): THREE.Texture {
  // Size of one tile cell in pixels (tile + grout on right/bottom edges)
  const tilePx = 256;
  const aspect = settings.heightMm / settings.widthMm;
  const cellWPx = tilePx;
  const cellHPx = Math.round(tilePx * aspect);
  const groutPx = Math.max(1, Math.round((settings.groutWidthMm / settings.widthMm) * tilePx));

  // For brick layout, we need 2 rows to create the offset pattern
  const isBrick = settings.layout === 'brick';
  const patternRows = isBrick ? 2 : 1;
  const patternCols = isBrick ? 2 : 1;

  const canvasW = cellWPx * patternCols;
  const canvasH = cellHPx * patternRows;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  // Fill grout
  ctx.fillStyle = settings.groutColor;
  ctx.fillRect(0, 0, canvasW, canvasH);

  const tileDrawW = cellWPx - groutPx;
  const tileDrawH = cellHPx - groutPx;

  if (isBrick) {
    // Row 0: two tiles side by side
    ctx.drawImage(tileImage, 0, 0, tileDrawW, tileDrawH);
    ctx.drawImage(tileImage, cellWPx, 0, tileDrawW, tileDrawH);
    // Row 1: offset by half a tile
    const halfOffset = Math.round(cellWPx / 2);
    ctx.drawImage(tileImage, halfOffset, cellHPx, tileDrawW, tileDrawH);
    // Wrap-around pieces for row 1
    ctx.drawImage(tileImage, halfOffset - canvasW, cellHPx, tileDrawW, tileDrawH);
    ctx.drawImage(tileImage, halfOffset + canvasW, cellHPx, tileDrawW, tileDrawH);
  } else {
    // Simple grid: one tile per cell
    ctx.drawImage(tileImage, 0, 0, tileDrawW, tileDrawH);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  // How many tile cells fit across the surface
  const tileWidthM = settings.widthMm / 1000;
  const tileHeightM = settings.heightMm / 1000;
  const repeatX = surfaceWidthM / (tileWidthM * patternCols);
  const repeatY = surfaceHeightM / (tileHeightM * patternRows);
  texture.repeat.set(repeatX, repeatY);

  texture.needsUpdate = true;
  return texture;
}

/* ---------- Individual surface mesh ---------- */

interface SurfaceMeshProps {
  name: SurfaceName;
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number];
  texture: THREE.Texture | null;
  isSelected: boolean;
  isHovered: boolean;
  onHover: (name: SurfaceName | null) => void;
  onClick: (name: SurfaceName) => void;
}

function SurfaceMesh({
  name,
  position,
  rotation,
  size,
  texture,
  isSelected,
  isHovered,
  onHover,
  onClick,
}: SurfaceMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  const color = useMemo(() => {
    if (isSelected) return SELECTED_COLOR;
    if (isHovered) return HOVER_COLOR;
    return DEFAULT_COLOR;
  }, [isSelected, isHovered]);

  // Imperatively update the material map when texture changes
  useEffect(() => {
    if (matRef.current) {
      matRef.current.map = texture;
      matRef.current.needsUpdate = true;
    }
  }, [texture]);

  return (
    <mesh
      ref={meshRef}
      position={position}
      rotation={rotation}
      onClick={(e) => {
        e.stopPropagation();
        onClick(name);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(name);
      }}
      onPointerOut={() => onHover(null)}
    >
      <planeGeometry args={size} />
      <meshStandardMaterial
        ref={matRef}
        map={texture}
        color={texture ? '#ffffff' : color}
        side={THREE.DoubleSide}
        roughness={texture ? 0.7 : 0.85}
        metalness={texture ? 0.05 : 0.02}
      />
    </mesh>
  );
}

/* ---------- Room interior scene ---------- */

interface RoomSceneProps {
  surfaces: Record<SurfaceName, Surface3D>;
  selectedSurface: SurfaceName | null;
  onSelectSurface: (name: SurfaceName) => void;
}

function RoomScene({ surfaces, selectedSurface, onSelectSurface }: RoomSceneProps) {
  const [hovered, setHovered] = useState<SurfaceName | null>(null);
  const { gl } = useThree();

  useEffect(() => {
    gl.domElement.style.cursor = hovered ? 'pointer' : 'grab';
  }, [hovered, gl]);

  const halfW = ROOM_WIDTH / 2;
  const halfH = ROOM_HEIGHT / 2;
  const halfD = ROOM_DEPTH / 2;

  const surfaceDefs: {
    name: SurfaceName;
    position: [number, number, number];
    rotation: [number, number, number];
    size: [number, number];
  }[] = [
    // Floor
    { name: 'floor', position: [0, -halfH, 0], rotation: [-Math.PI / 2, 0, 0], size: [ROOM_WIDTH, ROOM_DEPTH] },
    // Ceiling
    { name: 'ceiling', position: [0, halfH, 0], rotation: [Math.PI / 2, 0, 0], size: [ROOM_WIDTH, ROOM_DEPTH] },
    // Back wall (in front of the viewer)
    { name: 'wallBack', position: [0, 0, -halfD], rotation: [0, 0, 0], size: [ROOM_WIDTH, ROOM_HEIGHT] },
    // Front wall (behind the viewer)
    { name: 'wallFront', position: [0, 0, halfD], rotation: [0, Math.PI, 0], size: [ROOM_WIDTH, ROOM_HEIGHT] },
    // Left wall
    { name: 'wallLeft', position: [-halfW, 0, 0], rotation: [0, Math.PI / 2, 0], size: [ROOM_DEPTH, ROOM_HEIGHT] },
    // Right wall
    { name: 'wallRight', position: [halfW, 0, 0], rotation: [0, -Math.PI / 2, 0], size: [ROOM_DEPTH, ROOM_HEIGHT] },
  ];

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <pointLight position={[0, halfH - 0.2, 0]} intensity={0.8} castShadow />
      <pointLight position={[-halfW + 0.5, halfH - 0.5, -halfD + 0.5]} intensity={0.3} />
      <pointLight position={[halfW - 0.5, halfH - 0.5, halfD - 0.5]} intensity={0.3} />

      {/* Room surfaces */}
      {surfaceDefs.map((def) => (
        <SurfaceMesh
          key={def.name}
          name={def.name}
          position={def.position}
          rotation={def.rotation}
          size={def.size}
          texture={surfaces[def.name]?.texture ?? null}
          isSelected={selectedSurface === def.name}
          isHovered={hovered === def.name}
          onHover={setHovered}
          onClick={onSelectSurface}
        />
      ))}

      {/* Simple furniture silhouettes for depth reference */}
      {/* Table */}
      <mesh position={[0, -halfH + 0.4, -1]} castShadow>
        <boxGeometry args={[1.2, 0.05, 0.7]} />
        <meshStandardMaterial color="#8B7355" roughness={0.6} />
      </mesh>
      {/* Table legs */}
      {[
        [-0.5, -halfH + 0.2, -1.25],
        [0.5, -halfH + 0.2, -1.25],
        [-0.5, -halfH + 0.2, -0.75],
        [0.5, -halfH + 0.2, -0.75],
      ].map((pos, i) => (
        <mesh key={`leg-${i}`} position={pos as [number, number, number]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, 0.38]} />
          <meshStandardMaterial color="#6B5340" />
        </mesh>
      ))}

      {/* Rug on floor */}
      <mesh position={[0, -halfH + 0.005, 0.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2.5, 1.8]} />
        <meshStandardMaterial color="#7B6B5A" roughness={0.95} transparent opacity={0.5} />
      </mesh>

      <OrbitControls
        enablePan={false}
        enableZoom={false}
        rotateSpeed={0.5}
        minPolarAngle={0.3}
        maxPolarAngle={Math.PI - 0.3}
        target={[0, 0, 0]}
      />
    </>
  );
}

/* ---------- main exported component ---------- */

interface Room3DViewerProps {
  surfaces: Record<SurfaceName, Surface3D>;
  selectedSurface: SurfaceName | null;
  onSelectSurface: (name: SurfaceName) => void;
}

export default function Room3DViewer({
  surfaces,
  selectedSurface,
  onSelectSurface,
}: Room3DViewerProps) {
  return (
    <div className="relative w-full h-full bg-gray-950">
      <Canvas
        camera={{
          position: [0, 0.2, 0.01],
          fov: 80,
          near: 0.1,
          far: 100,
        }}
        shadows
      >
        <RoomScene
          surfaces={surfaces}
          selectedSurface={selectedSurface}
          onSelectSurface={onSelectSurface}
        />
      </Canvas>

      {/* Overlay hints */}
      <div className="absolute bottom-3 right-3 text-xs text-gray-500 pointer-events-none">
        Drag to look around · Click a surface to select it
      </div>

      {selectedSurface && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/60 text-white text-sm px-3 py-1.5 rounded-full pointer-events-none">
          {SURFACE_LABELS[selectedSurface]} selected — choose a tile from the left panel
        </div>
      )}
    </div>
  );
}

/* ---------- exported utilities ---------- */

export { generateTileTexture, SURFACE_LABELS, ROOM_WIDTH, ROOM_HEIGHT, ROOM_DEPTH };
