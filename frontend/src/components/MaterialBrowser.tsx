import { useEffect, useRef, useState } from 'react';
import type { MaterialInfo } from '../types';
import { listMaterials, uploadMaterial } from '../hooks/useApi';

interface Props {
  selectedId: string | null;
  onSelect: (material: MaterialInfo) => void;
}

export default function MaterialBrowser({ selectedId, onSelect }: Props) {
  const [materials, setMaterials] = useState<MaterialInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = () => {
    setLoading(true);
    listMaterials()
      .then(setMaterials)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const mat = await uploadMaterial(file);
      setMaterials((prev) => [mat, ...prev.filter((m) => m.id !== mat.id)]);
      onSelect(mat);
    } catch (err) {
      console.error('Tile upload failed', err);
    } finally {
      setUploading(false);
    }
  };

  const filtered = materials.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 space-y-2">
        <input
          type="text"
          placeholder="Search tiles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
            e.currentTarget.value = '';
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full rounded-md border border-dashed border-sky-600/50 bg-sky-500/10 py-1.5 text-xs font-medium text-sky-200 transition hover:bg-sky-500/20 disabled:opacity-50"
        >
          {uploading ? 'Uploading...' : '+ Upload tile image'}
        </button>
      </div>

      {loading ? (
        <div className="p-3 text-sm text-slate-300">Loading...</div>
      ) : materials.length === 0 ? (
        <div className="p-3 text-sm text-gray-400">
          No tiles yet. Upload one above.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-2">
          {filtered.map((m) => (
            <button
              key={m.id}
              onClick={() => onSelect(m)}
              className={`overflow-hidden rounded-md border-2 bg-slate-900 transition-colors ${
                m.id === selectedId ? 'border-sky-500' : 'border-transparent hover:border-slate-600'
              }`}
            >
              <img
                src={m.thumbnail_url}
                alt={m.name}
                className="w-full aspect-square object-cover"
              />
              <div className="truncate p-1 text-xs text-slate-200">{m.name}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
