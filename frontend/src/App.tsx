import { useState, useEffect, useRef, useCallback } from 'react';
import PanoramaViewer from './components/PanoramaViewer';
import type { PanoSurface } from './components/PanoramaViewer';
import type { MaterialInfo, TileSettings } from './types';
import { DEFAULT_TILE_SETTINGS } from './types';
import {
  listMaterials,
  uploadMaterial,
  loadImage,
  listPanoramaRooms,
  fetchPanoramaRoom,
  uploadPanorama,
} from './hooks/useApi';
import type { PanoramaRoomSummary, PanoramaApiResponse } from './hooks/useApi';

type Screen = 'landing' | 'panorama';
type Tab = 'surfaces' | 'tiles' | 'settings';

export default function App() {
  const [screen, setScreen] = useState<Screen>('landing');

  // Panorama state
  const [panoRooms, setPanoRooms] = useState<PanoramaRoomSummary[]>([]);
  const [panoInfo, setPanoInfo] = useState<PanoramaApiResponse | null>(null);
  const [panoSurfaces, setPanoSurfaces] = useState<PanoSurface[]>([]);
  const [panoSelectedSurface, setPanoSelectedSurface] = useState<string | null>(null);
  const [panoLoading, setPanoLoading] = useState(false);
  const panoTileImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const panoFileRef = useRef<HTMLInputElement>(null);
  const [panoUploading, setPanoUploading] = useState(false);

  // Tile (material) state
  const [materials, setMaterials] = useState<MaterialInfo[]>([]);
  const tileFileRef = useRef<HTMLInputElement>(null);
  const [tileUploading, setTileUploading] = useState(false);

  // Settings & UI
  const [tileSettings, setTileSettings] = useState<TileSettings>(DEFAULT_TILE_SETTINGS);
  const [activeTab, setActiveTab] = useState<Tab>('surfaces');

  // Load data on mount
  useEffect(() => {
    listMaterials().then(setMaterials).catch(console.error);
    listPanoramaRooms().then((r) => setPanoRooms(r.rooms)).catch(console.error);
  }, []);

  const loadPanoRoom = useCallback(async (roomId: string) => {
    setPanoLoading(true);
    try {
      const info = await fetchPanoramaRoom(roomId);
      setPanoInfo(info);
      setPanoSurfaces(
        info.surfaces.map((s) => ({
          name: s.name,
          label: s.label,
          maskUrl: s.mask_url,
          maskData: null,
          materialId: null,
        })),
      );
      setPanoSelectedSurface(null);
      setScreen('panorama');
    } catch (err) {
      console.error('Failed to load panorama room', err);
    } finally {
      setPanoLoading(false);
    }
  }, []);

  const handlePanoUpload = useCallback(async (file: File) => {
    setPanoUploading(true);
    try {
      const info = await uploadPanorama(file);
      const updated = await listPanoramaRooms();
      setPanoRooms(updated.rooms);
      setPanoInfo(info);
      setPanoSurfaces(
        info.surfaces.map((s) => ({
          name: s.name,
          label: s.label,
          maskUrl: s.mask_url,
          maskData: null,
          materialId: null,
        })),
      );
      setPanoSelectedSurface(null);
      setScreen('panorama');
    } catch (err) {
      console.error('Panorama upload failed', err);
    } finally {
      setPanoUploading(false);
    }
  }, []);

  const handleTileUpload = useCallback(async (file: File) => {
    setTileUploading(true);
    try {
      const mat = await uploadMaterial(file);
      setMaterials((prev) => [mat, ...prev.filter((m) => m.id !== mat.id)]);
      if (panoSelectedSurface) {
        if (!panoTileImagesRef.current.has(mat.id)) {
          const img = await loadImage(mat.texture_url);
          panoTileImagesRef.current.set(mat.id, img);
        }
        setPanoSurfaces((prev) =>
          prev.map((s) => (s.name === panoSelectedSurface ? { ...s, materialId: mat.id } : s)),
        );
      }
    } catch (err) {
      console.error('Tile upload failed', err);
    } finally {
      setTileUploading(false);
    }
  }, [panoSelectedSurface]);

  const handleTileSelect = useCallback(async (mat: MaterialInfo) => {
    if (!panoSelectedSurface) return;
    if (!panoTileImagesRef.current.has(mat.id)) {
      const img = await loadImage(mat.texture_url);
      panoTileImagesRef.current.set(mat.id, img);
    }
    setPanoSurfaces((prev) =>
      prev.map((s) => (s.name === panoSelectedSurface ? { ...s, materialId: mat.id } : s)),
    );
  }, [panoSelectedSurface]);

  // ── Landing screen ────────────────────────────────────────────────────────
  if (screen === 'landing') {
    return (
      <div className="min-h-screen bg-[#0f1117] text-white flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-12 text-center">
          <div className="mb-8">
            <span className="inline-block px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-xs font-medium tracking-wide mb-4">
              360° Tile Visualizer
            </span>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white">
              Tile<span className="text-indigo-400">Vision</span>
            </h1>
            <p className="mt-3 text-slate-400 text-base max-w-sm mx-auto">
              Walk through a real room in 360° and see any tile applied to floors, walls, and ceilings.
            </p>
          </div>

          <div
            className="w-full max-w-sm border-2 border-dashed border-indigo-500/40 rounded-2xl bg-indigo-500/5 hover:bg-indigo-500/10 transition cursor-pointer p-7 flex flex-col items-center gap-3 mb-8"
            onClick={() => !panoUploading && panoFileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) handlePanoUpload(f);
            }}
          >
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/20 flex items-center justify-center text-2xl">
              🌐
            </div>
            <div>
              <p className="font-semibold text-white">
                {panoUploading ? 'Uploading 360° photo…' : 'Upload your 360° room photo'}
              </p>
              <p className="text-sm text-slate-400 mt-1">Equirectangular JPG or PNG</p>
            </div>
            {panoUploading && (
              <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            )}
          </div>
          <input
            ref={panoFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handlePanoUpload(f);
              e.currentTarget.value = '';
            }}
          />

          {panoRooms.length > 0 && (
            <div className="w-full max-w-lg">
              <p className="text-sm text-slate-500 mb-3 text-left">Or pick a demo room →</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {panoRooms.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => loadPanoRoom(r.id)}
                    disabled={panoLoading}
                    className="rounded-xl overflow-hidden border border-slate-800 hover:border-indigo-500/60 transition group text-left relative"
                  >
                    <div className="relative h-28 overflow-hidden">
                      <img
                        src={r.thumbnail_url}
                        alt={r.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                      <span className="absolute bottom-2 left-2.5 text-xs font-medium text-white leading-tight">
                        {r.title}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {panoLoading && (
            <div className="mt-6 flex items-center gap-2 text-sm text-slate-400">
              <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              Loading room…
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Panorama screen ───────────────────────────────────────────────────────
  return (
    <div className="h-screen bg-[#0f1117] text-white flex flex-col overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-2.5 bg-[#1a1d2e] border-b border-[#2d3148] flex-shrink-0">
        <button
          onClick={() => { setScreen('landing'); setPanoInfo(null); setPanoSurfaces([]); }}
          className="text-slate-400 hover:text-white transition text-sm"
        >
          ←
        </button>
        <span className="font-bold text-sm">Tile<span className="text-indigo-400">Vision</span></span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
          360°
        </span>
        <span className="text-xs text-slate-500 truncate flex-1">{panoInfo?.title ?? ''}</span>
        <button
          onClick={() => { setScreen('landing'); setPanoInfo(null); setPanoSurfaces([]); }}
          className="text-xs text-slate-500 hover:text-slate-300 transition"
        >
          Change room
        </button>
      </header>

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <div className="flex-1 min-h-0 relative" style={{ minHeight: '45vh' }}>
          {panoLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {panoInfo && (
            <PanoramaViewer
              key={panoInfo.id ?? 'pano'}
              panoramaUrl={panoInfo.panorama_url}
              surfaces={panoSurfaces}
              tileImages={panoTileImagesRef.current}
              tileSettings={tileSettings}
              selectedSurface={panoSelectedSurface as any}
              layout={
                panoInfo.dimensions
                  ? {
                      floorPolygon: panoInfo.dimensions.floor_polygon_m as [number, number][],
                      roomHeightM: panoInfo.dimensions.height_m,
                      cameraHeightM: panoInfo.dimensions.camera_height_m,
                    }
                  : null
              }
            />
          )}
        </div>

        <div
          className="w-full md:w-80 flex-shrink-0 bg-[#1a1d2e] border-t md:border-t-0 md:border-l border-[#2d3148] flex flex-col"
          style={{ maxHeight: '55vh', minHeight: '55vh' } as React.CSSProperties}
        >
          <div className="grid grid-cols-3 border-b border-[#2d3148] flex-shrink-0">
            {(['surfaces', 'tiles', 'settings'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`py-3 text-xs font-medium transition capitalize ${
                  activeTab === t
                    ? 'text-indigo-300 border-b-2 border-indigo-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t === 'surfaces' ? '◫ ' : t === 'tiles' ? '◧ ' : '⚙ '}
                {t}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {activeTab === 'surfaces' && (
              <div className="p-3 space-y-2">
                <p className="text-xs text-slate-500 px-1 pb-1">Select a surface, then go to Tiles to apply.</p>
                {panoSurfaces.length === 0 && (
                  <p className="text-xs text-slate-600 text-center pt-6">No surfaces detected in this room.</p>
                )}
                {panoSurfaces.map((s) => (
                  <div
                    key={s.name}
                    onClick={() => { setPanoSelectedSurface(s.name); setActiveTab('tiles'); }}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition border ${
                      panoSelectedSurface === s.name
                        ? 'bg-indigo-500/20 border-indigo-500/40'
                        : 'hover:bg-white/5 border-transparent'
                    }`}
                  >
                    <span className="text-slate-400 text-base">
                      {s.name === 'floor' ? '▦' : s.name === 'ceiling' ? '▭' : '▯'}
                    </span>
                    <span className="flex-1 text-sm text-white">{s.label}</span>
                    {s.materialId ? (
                      <>
                        <span className="text-xs text-green-400 truncate max-w-[80px]">
                          {materials.find((m) => m.id === s.materialId)?.name ?? 'Applied'}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPanoSurfaces((prev) =>
                              prev.map((p) => p.name === s.name ? { ...p, materialId: null } : p),
                            );
                          }}
                          className="text-slate-500 hover:text-red-400 text-xs flex-shrink-0"
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-slate-600">tap →</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'tiles' && (
              <div className="flex flex-col h-full">
                {panoSelectedSurface ? (
                  <div className="px-3 pt-3 pb-2 bg-indigo-500/10 border-b border-[#2d3148] flex-shrink-0">
                    <p className="text-xs text-indigo-300">
                      Applying to:{' '}
                      <strong>{panoSurfaces.find((s) => s.name === panoSelectedSurface)?.label}</strong>
                    </p>
                  </div>
                ) : (
                  <div className="px-3 pt-3 pb-2 border-b border-[#2d3148] flex-shrink-0">
                    <p className="text-xs text-amber-400">← Select a surface first</p>
                  </div>
                )}

                <div className="p-2 flex-shrink-0">
                  <input
                    ref={tileFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleTileUpload(f);
                      e.currentTarget.value = '';
                    }}
                  />
                  <button
                    onClick={() => tileFileRef.current?.click()}
                    disabled={tileUploading}
                    className="w-full py-2.5 rounded-xl border-2 border-dashed border-indigo-500/40 bg-indigo-500/5 hover:bg-indigo-500/10 text-xs text-indigo-300 disabled:opacity-50 transition flex items-center justify-center gap-2"
                  >
                    {tileUploading ? (
                      <>
                        <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                        Uploading tile…
                      </>
                    ) : (
                      <>+ Upload tile photo</>
                    )}
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-2">
                  {materials.map((m) => {
                    const applied = panoSurfaces.find((s) => s.name === panoSelectedSurface)?.materialId === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => handleTileSelect(m)}
                        className={`overflow-hidden rounded-xl border-2 transition ${
                          applied
                            ? 'border-indigo-500 ring-2 ring-indigo-500/30'
                            : 'border-transparent hover:border-slate-600'
                        }`}
                      >
                        <img src={m.thumbnail_url} alt={m.name} className="w-full aspect-square object-cover" />
                        <div className="px-1.5 py-1 bg-[#0f1117]">
                          <p className="truncate text-xs text-slate-300">{m.name}</p>
                        </div>
                      </button>
                    );
                  })}
                  {materials.length === 0 && (
                    <div className="col-span-2 text-center py-8 text-xs text-slate-600">
                      No tiles yet — upload one above.
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="p-3 space-y-4">
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider">Tile Size</label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <label className="text-xs text-slate-500">Width (mm)</label>
                      <input
                        type="number"
                        value={tileSettings.widthMm}
                        onChange={(e) => setTileSettings((p) => ({ ...p, widthMm: +e.target.value }))}
                        className="w-full mt-1 rounded-lg border border-[#2d3148] bg-[#0f1117] px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Height (mm)</label>
                      <input
                        type="number"
                        value={tileSettings.heightMm}
                        onChange={(e) => setTileSettings((p) => ({ ...p, heightMm: +e.target.value }))}
                        className="w-full mt-1 rounded-lg border border-[#2d3148] bg-[#0f1117] px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider">Grout</label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <label className="text-xs text-slate-500">Width (mm)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={tileSettings.groutWidthMm}
                        onChange={(e) => setTileSettings((p) => ({ ...p, groutWidthMm: +e.target.value }))}
                        className="w-full mt-1 rounded-lg border border-[#2d3148] bg-[#0f1117] px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Color</label>
                      <input
                        type="color"
                        value={tileSettings.groutColor}
                        onChange={(e) => setTileSettings((p) => ({ ...p, groutColor: e.target.value }))}
                        className="w-full mt-1 h-9 rounded-lg border border-[#2d3148] bg-[#0f1117] cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider">Layout</label>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {(['grid', 'brick', 'herringbone'] as const).map((layout) => (
                      <button
                        key={layout}
                        onClick={() => setTileSettings((p) => ({ ...p, layout }))}
                        className={`py-2 rounded-lg text-xs capitalize transition border ${
                          tileSettings.layout === layout
                            ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-200'
                            : 'border-[#2d3148] text-slate-400 hover:text-slate-200 hover:bg-white/5'
                        }`}
                      >
                        {layout}
                      </button>
                    ))}
                  </div>
                </div>

                {panoSurfaces.some((s) => s.materialId) && (
                  <button
                    onClick={() => setPanoSurfaces((prev) => prev.map((s) => ({ ...s, materialId: null })))}
                    className="w-full py-2 rounded-lg border border-red-500/30 text-xs text-red-400 hover:bg-red-500/10 transition"
                  >
                    Clear all tiles
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
