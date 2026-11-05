export interface RoomInfo {
  id: string;
  filename: string;
  width: number;
  height: number;
}

export interface MaterialInfo {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  thumbnail_url: string;
  texture_url: string;
}

/** Polygon-based surface for the new AI-driven editor */
export interface PolygonSurface {
  id: string;
  name: string;
  label: string;
  type: 'floor' | 'wall' | 'ceiling';
  polygon: [number, number][]; // normalized 0-1 coords
  materialId: string | null;
}

export interface TileSettings {
  widthMm: number;
  heightMm: number;
  groutWidthMm: number;
  groutColor: string;
  rotation: number;
  layout: 'grid' | 'brick' | 'herringbone';
}

export interface CostEstimate {
  area_sqm: number;
  tiles_needed: number;
  boxes_needed: number;
  total_cost: number;
  coverage_per_box_sqm: number;
}

export interface AISurface {
  name: string;
  label: string;
  type: 'floor' | 'wall' | 'ceiling';
  polygon: [number, number][];
}

export interface AIAnalysis {
  surfaces: AISurface[];
  description: string;
  style: string;
  tips: string[];
}

export interface AISuggestion {
  style: string;
  description: string;
  reason: string;
  grout: string;
  layout: string;
}

export interface AISuggestResponse {
  suggestions: AISuggestion[];
  room_style: string;
  color_palette: string[];
}

export const DEFAULT_TILE_SETTINGS: TileSettings = {
  widthMm: 300,
  heightMm: 300,
  groutWidthMm: 2,
  groutColor: '#888888',
  rotation: 0,
  layout: 'grid',
};

// Legacy — kept for panorama mode
export interface Surface {
  id: string;
  label: string;
  color: string;
  maskUrl: string;
  maskData: ImageData | null;
  lightmapUrl: string | null;
  materialId: string | null;
  bbox: number[];
  score: number;
}

export const SURFACE_COLORS = [
  'rgba(99, 102, 241, 0.4)',
  'rgba(236, 72, 153, 0.4)',
  'rgba(34, 197, 94, 0.4)',
  'rgba(234, 179, 8, 0.4)',
  'rgba(239, 68, 68, 0.4)',
  'rgba(168, 85, 247, 0.4)',
];
