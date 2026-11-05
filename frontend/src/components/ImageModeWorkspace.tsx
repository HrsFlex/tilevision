import { useCallback, useEffect, useRef, useState } from 'react';
import RoomViewer from './RoomViewer';
import MaterialBrowser from './MaterialBrowser';
import TileControls from './TileControls';
import CostEstimator from './CostEstimator';
import {
  detectSemanticSurfaces,
  listRooms,
  loadImage,
  loadMaskData,
  roomImageUrl,
  uploadRoom,
} from '../hooks/useApi';
import { applyTextureToMask, generateTilePattern } from '../lib/textureMapper';
import { DEFAULT_TILE_SETTINGS, SURFACE_COLORS } from '../types';
import type { MaterialInfo, RoomInfo, Surface, TileSettings } from '../types';

type Tab = 'surfaces' | 'materials' | 'settings' | 'cost';

interface ImageModeWorkspaceProps {
  onBack: () => void;
}

const tabIcons: Record<Tab, string> = {
  surfaces: '◫',
  materials: '◧',
  settings: '⚙',
  cost: '₹',
};

function surfaceIcon(label: string): string {
  const low = label.toLowerCase();
  if (low.includes('floor')) return '▦';
  if (low.includes('ceiling')) return '▭';
  if (low.includes('wall')) return '▯';
  return '◻';
}

export default function ImageModeWorkspace({ onBack }: ImageModeWorkspaceProps) {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [roomSwitching, setRoomSwitching] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<RoomInfo | null>(null);
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialInfo | null>(null);
  const [tileSettings, setTileSettings] = useState<TileSettings>(DEFAULT_TILE_SETTINGS);
  const [activeTab, setActiveTab] = useState<Tab>('surfaces');
  const [applying, setApplying] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tileImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const texturedCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const [, bumpVersion] = useState(0);

  const forceRedraw = useCallback(() => bumpVersion((v) => v + 1), []);

  const refreshRooms = useCallback(async () => {
    setRoomsLoading(true);
    try {
      const list = await listRooms();
      setRooms(list);
    } catch (err) {
      console.error('Failed to list rooms', err);
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshRooms();
  }, [refreshRooms]);

  const openRoom = useCallback(async (room: RoomInfo) => {
    setRoomSwitching(true);
    setSelectedRoom(room);
    setSurfaces([]);
    setSelectedSurfaceId(null);
    setSelectedMaterial(null);
    texturedCanvasesRef.current.clear();
    forceRedraw();
    try {
      const semantic = await detectSemanticSurfaces(room.id);
      const autoSurfaces: Surface[] = semantic.surfaces.map((s, idx) => ({
        id: `semantic_${room.id}_${idx}`,
        label: s.label,
        color: SURFACE_COLORS[idx % SURFACE_COLORS.length],
        maskUrl: s.mask_url,
        maskData: null,
        lightmapUrl: null,
        materialId: null,
        bbox: [0, 0, room.width, room.height],
        score: s.score ?? 1,
      }));
      setSurfaces(autoSurfaces);
      setSelectedSurfaceId(autoSurfaces[0]?.id ?? null);
      if (autoSurfaces.length > 0) setActiveTab('surfaces');
    } catch (err) {
      console.error('Semantic auto-mask failed', err);
    } finally {
      setRoomSwitching(false);
    }
  }, [forceRedraw]);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const room = await uploadRoom(file);
      setRooms((prev) => [room, ...prev]);
      openRoom(room);
    } catch (err) {
      console.error('Upload failed', err);
    } finally {
      setUploading(false);
    }
  }, [openRoom]);

  const ensureTextureForSurface = useCallback(async (surface: Surface, material: MaterialInfo, settings: TileSettings) => {
    if (!selectedRoom || imageSize.width <= 0 || imageSize.height <= 0) return;

    let tileImage = tileImagesRef.current.get(material.id) ?? null;
    if (!tileImage) {
      tileImage = await loadImage(material.texture_url);
      tileImagesRef.current.set(material.id, tileImage);
    }

    const maskData = surface.maskData ?? await loadMaskData(surface.maskUrl, imageSize.width, imageSize.height);
    const lightmapImage = surface.lightmapUrl ? await loadImage(surface.lightmapUrl) : null;
    const pattern = generateTilePattern(tileImage, settings, 1024, 1024);
    const textured = applyTextureToMask(maskData, pattern, lightmapImage);

    const canvas = document.createElement('canvas');
    canvas.width = imageSize.width;
    canvas.height = imageSize.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(textured, 0, 0);

    texturedCanvasesRef.current.set(surface.id, canvas);
    setSurfaces((prev) => prev.map((s) => (s.id === surface.id ? { ...s, maskData, materialId: material.id } : s)));
  }, [imageSize.height, imageSize.width, selectedRoom]);

  const handleImageClick = useCallback(async (_x: number, _y: number) => {
    // Semantic mode auto-generates masks; click-to-detect disabled for now.
  }, []);

  const handleMaterialSelect = useCallback(async (material: MaterialInfo) => {
    setSelectedMaterial(material);
    const sid = selectedSurfaceId;
    if (!sid) return;
    const surface = surfaces.find((s) => s.id === sid);
    if (!surface) return;

    setApplying(true);
    try {
      await ensureTextureForSurface(surface, material, tileSettings);
      forceRedraw();
    } catch (err) {
      console.error('Failed applying texture', err);
    } finally {
      setApplying(false);
    }
  }, [ensureTextureForSurface, forceRedraw, selectedSurfaceId, surfaces, tileSettings]);

  const handleClearSurface = useCallback((id: string) => {
    texturedCanvasesRef.current.delete(id);
    setSurfaces((prev) => prev.map((s) => (s.id === id ? { ...s, materialId: null } : s)));
    forceRedraw();
  }, [forceRedraw]);

  useEffect(() => {
    const rerenderAll = async () => {
      if (surfaces.length === 0) return;
      const textured = surfaces.filter((s) => s.materialId);
      if (textured.length === 0) return;
      setApplying(true);
      try {
        for (const surface of textured) {
          const materialId = surface.materialId;
          if (!materialId) continue;
          const material = selectedMaterial && selectedMaterial.id === materialId
            ? selectedMaterial
            : ({ id: materialId, name: materialId, thumbnail_url: '', texture_url: tileImagesRef.current.get(materialId)?.src ?? '', width_mm: 0, height_mm: 0 } as MaterialInfo);
          if (!material.texture_url) continue;
          await ensureTextureForSurface(surface, material, tileSettings);
        }
        forceRedraw();
      } catch (err) {
        console.error(err);
      } finally {
        setApplying(false);
      }
    };
    rerenderAll();
  }, [tileSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: { id: Tab; label: string }[] = [
    { id: 'surfaces', label: 'Surfaces' },
    { id: 'materials', label: 'Tiles' },
    { id: 'settings', label: 'Settings' },
    { id: 'cost', label: 'Cost' },
  ];

  if (!selectedRoom) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
          <header className="mb-8 flex items-center justify-between">
            <div>
              <p className="mb-2 inline-block rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1 text-xs font-medium text-fuchsia-200">
                Image Mode
              </p>
              <h1 className="text-3xl font-semibold tracking-tight">Select or upload a room image</h1>
              <p className="mt-2 text-sm text-slate-300">
                Click on image points to detect surfaces, then apply tiles with the same controls as panorama mode.
              </p>
            </div>
            <button
              onClick={onBack}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
            >
              ← Back
            </button>
          </header>

          <div className="mb-6">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.currentTarget.value = '';
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="rounded-lg border border-fuchsia-400/40 bg-fuchsia-500/15 px-4 py-2 text-sm font-medium text-fuchsia-100 transition hover:bg-fuchsia-500/25 disabled:opacity-60"
            >
              {uploading ? 'Uploading...' : '+ Upload New Room Image'}
            </button>
          </div>

          <main className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {roomsLoading && <p className="text-sm text-slate-300">Loading rooms...</p>}
            {!roomsLoading && rooms.length === 0 && (
              <p className="text-sm text-slate-300">No room images yet. Upload one to begin.</p>
            )}
            {rooms.map((room) => (
              <button
                key={room.id}
                onClick={() => openRoom(room)}
                className="group overflow-hidden rounded-xl border border-slate-700 bg-slate-900 text-left transition hover:border-fuchsia-400/60 hover:shadow-lg hover:shadow-fuchsia-900/20"
              >
                <div className="relative h-40 w-full overflow-hidden bg-slate-800">
                  <img src={roomImageUrl(room)} alt={room.filename} className="h-full w-full object-cover" />
                </div>
                <div className="px-4 py-3">
                  <div className="truncate text-sm font-semibold text-white">{room.filename}</div>
                  <div className="mt-1 text-xs text-slate-400">{room.width} x {room.height}</div>
                  <div className="mt-3 text-xs font-medium text-fuchsia-300 group-hover:text-fuchsia-200">
                    Open editor →
                  </div>
                </div>
              </button>
            ))}
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-slate-950 text-white flex flex-col">
      <header className="flex items-center gap-3 px-4 py-3 bg-slate-900 border-b border-slate-800 flex-shrink-0">
        <div>
          <h1 className="text-sm font-semibold tracking-wide">Tiles Visualizer</h1>
          <p className="text-[11px] text-slate-400">Image workspace</p>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 bg-fuchsia-600/25 text-fuchsia-100 rounded">
          2D Image
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setSelectedRoom(null)}
          className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
        >
          Change room
        </button>
        {(applying || roomSwitching) && (
          <div className="text-fuchsia-200 text-xs animate-pulse">
            {applying ? 'Applying texture...' : 'Generating semantic masks...'}
          </div>
        )}
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="w-72 flex-shrink-0 bg-slate-900/95 border-r border-slate-800 flex flex-col">
          <div className="grid grid-cols-4 gap-1 border-b border-slate-800 p-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`rounded-md py-2 text-xs transition-colors ${
                  activeTab === t.id
                    ? 'bg-slate-700/80 text-fuchsia-100'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                }`}
              >
                <span className="mr-1">{tabIcons[t.id]}</span>
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {activeTab === 'surfaces' && (
              <div className="p-3 space-y-2">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1 mb-2">
                  Image Surfaces
                </h3>
                <p className="text-xs text-slate-400 px-1 mb-2">
                  Semantic masks are generated automatically. Select a surface, then choose a tile.
                </p>
                {surfaces.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-700 p-3 text-xs text-slate-400">
                    No semantic surfaces found for this image.
                  </div>
                )}
                {surfaces.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => {
                      setSelectedSurfaceId(s.id);
                      setActiveTab('materials');
                    }}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer text-sm transition-colors border ${
                      selectedSurfaceId === s.id
                        ? 'bg-fuchsia-600/20 border-fuchsia-500/40'
                        : 'hover:bg-slate-800/80 border-slate-800'
                    }`}
                  >
                    <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: s.materialId ? '#22c55e' : '#6b7280' }} />
                    <span className="text-slate-400 text-xs">{surfaceIcon(s.label)}</span>
                    <span className="flex-1 text-white truncate">{s.label}</span>
                    <span className="text-[10px] text-slate-500">{Math.round(s.score * 100)}%</span>
                    {s.materialId && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearSurface(s.id);
                        }}
                        className="text-slate-500 hover:text-red-400 text-xs"
                        title="Remove tile"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'materials' && (
              <MaterialBrowser selectedId={selectedMaterial?.id ?? null} onSelect={handleMaterialSelect} />
            )}
            {activeTab === 'settings' && (
              <TileControls settings={tileSettings} onChange={setTileSettings} />
            )}
            {activeTab === 'cost' && (
              <CostEstimator tileSettings={tileSettings} />
            )}
          </div>
        </aside>

        <main className="flex flex-1 min-w-0 flex-col">
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-4 py-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Selected Image</p>
              <p className="text-sm font-medium text-slate-100">{selectedRoom.filename}</p>
            </div>
            <p className="text-xs text-slate-400">Auto semantic masks: floor, walls, ceiling</p>
          </div>

          <div className="relative min-h-0 flex-1">
            <RoomViewer
              roomImageUrl={roomImageUrl(selectedRoom)}
              surfaces={surfaces}
              selectedSurfaceId={selectedSurfaceId}
              texturedCanvases={texturedCanvasesRef.current}
              onImageClick={handleImageClick}
              onImageLoaded={(width, height) => setImageSize({ width, height })}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
