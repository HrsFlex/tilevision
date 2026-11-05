import type { RoomInfo, MaterialInfo, CostEstimate, AIAnalysis, AISuggestResponse } from '../types';

// In production, set VITE_API_BASE_URL to your Railway backend URL
// e.g. https://tilevision-backend.railway.app
// In dev, leave unset — Vite proxy handles /api and /static
const BASE = (import.meta.env.VITE_API_BASE_URL as string) ?? '';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

export async function uploadRoom(file: File): Promise<RoomInfo> {
  const form = new FormData();
  form.append('file', file);
  return fetchJson<RoomInfo>('/api/rooms/upload', { method: 'POST', body: form });
}

export async function listRooms(): Promise<RoomInfo[]> {
  const data = await fetchJson<{ rooms: RoomInfo[] }>('/api/rooms');
  return data.rooms;
}

export async function getRoomInfo(roomId: string): Promise<RoomInfo> {
  return fetchJson<RoomInfo>(`/api/rooms/${roomId}`);
}

export function roomImageUrl(room: RoomInfo): string {
  return `${BASE}/static/rooms/${room.filename}`;
}

export async function detectSurface(
  roomId: string,
  points: number[][],
  labels: number[],
): Promise<{ mask_url: string; score: number; bbox: number[] }> {
  return fetchJson('/api/segments/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: roomId, points, labels }),
  });
}

export async function getLightmap(
  roomId: string,
  maskUrl: string,
): Promise<string> {
  const res = await fetch(BASE + '/api/segments/lightmap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: roomId, mask_url: maskUrl }),
  });
  if (!res.ok) throw new Error('Lightmap request failed');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export interface SemanticSurfaceInfo {
  label: string;
  mask_url: string;
  score: number;
}

export interface SemanticSurfaceResponse {
  room_id: string;
  surfaces: SemanticSurfaceInfo[];
}

export async function detectSemanticSurfaces(roomId: string): Promise<SemanticSurfaceResponse> {
  return fetchJson<SemanticSurfaceResponse>('/api/segments/semantic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: roomId }),
  });
}

export async function listMaterials(): Promise<MaterialInfo[]> {
  const data = await fetchJson<{ materials: MaterialInfo[] }>('/api/materials');
  return data.materials;
}

export async function uploadMaterial(file: File): Promise<MaterialInfo> {
  const form = new FormData();
  form.append('file', file);
  return fetchJson<MaterialInfo>('/api/materials/upload', { method: 'POST', body: form });
}

export interface PanoramaApiSurface {
  name: string;
  label: string;
  mask_url: string;
}

export interface RoomDimensions {
  width_m: number;
  depth_m: number;
  height_m: number;
  rotation_rad: number;
  camera_height_m: number;
  floor_polygon_m: number[][];
  num_walls: number;
}

export interface PanoramaApiResponse {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  source?: string | null;
  panorama_url: string;
  width: number;
  height: number;
  surfaces: PanoramaApiSurface[];
  dimensions: RoomDimensions | null;
}

export interface PanoramaRoomSummary {
  id: string;
  title: string;
  description: string | null;
  panorama_url: string;
  thumbnail_url: string;
  source: string | null;
}

export interface PanoramaRoomListResponse {
  rooms: PanoramaRoomSummary[];
  default_id: string | null;
}

export async function fetchPanorama(): Promise<PanoramaApiResponse> {
  return fetchJson<PanoramaApiResponse>('/api/panorama');
}

export async function listPanoramaRooms(): Promise<PanoramaRoomListResponse> {
  return fetchJson<PanoramaRoomListResponse>('/api/panorama/rooms');
}

export async function fetchPanoramaRoom(roomId: string): Promise<PanoramaApiResponse> {
  return fetchJson<PanoramaApiResponse>(`/api/panorama/rooms/${encodeURIComponent(roomId)}`);
}

export async function detectLayout(opts: {
  room_id?: string;
  panorama?: string;
  camera_height_m?: number;
  force_cuboid?: boolean;
} = {}): Promise<PanoramaApiResponse> {
  return fetchJson<PanoramaApiResponse>('/api/panorama/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
}

export async function uploadPanorama(file: File): Promise<PanoramaApiResponse> {
  const form = new FormData();
  form.append('file', file);
  return fetchJson<PanoramaApiResponse>('/api/panorama/upload', {
    method: 'POST',
    body: form,
  });
}

export async function calculateCost(params: {
  area_sqm: number;
  tile_width_mm: number;
  tile_height_mm: number;
  tiles_per_box: number;
  price_per_box: number;
  waste_factor?: number;
}): Promise<CostEstimate> {
  return fetchJson('/api/estimate/cost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export async function loadMaskData(
  maskUrl: string,
  width: number,
  height: number,
): Promise<ImageData> {
  const img = await loadImage(BASE + maskUrl);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

// ── AI endpoints ──────────────────────────────────────────────────────────────

export async function analyzeRoom(roomId: string, force = false): Promise<AIAnalysis> {
  return fetchJson<AIAnalysis>('/api/ai/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: roomId, force }),
  });
}

export async function getSuggestions(roomId: string, style?: string): Promise<AISuggestResponse> {
  return fetchJson<AISuggestResponse>('/api/ai/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: roomId, style: style ?? 'any' }),
  });
}

export async function renderWithAI(
  roomId: string,
  tileId: string,
  surfaceName: string,
  polygon: [number, number][],
): Promise<{ rendered_url: string }> {
  return fetchJson<{ rendered_url: string }>('/api/ai/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: roomId, tile_id: tileId, surface_name: surfaceName, polygon }),
  });
}
