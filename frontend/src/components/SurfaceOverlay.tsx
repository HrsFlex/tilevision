import type { Surface } from '../types';

interface Props {
  surfaces: Surface[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, label: string) => void;
}

export default function SurfaceOverlay({ surfaces, selectedId, onSelect, onDelete, onRename }: Props) {
  if (surfaces.length === 0) {
    return (
      <div className="p-3 text-sm text-gray-400 italic">
        Click on the room image to detect surfaces (walls, floor, ceiling).
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1">Surfaces</h3>
      {surfaces.map((s) => (
        <div
          key={s.id}
          onClick={() => onSelect(s.id)}
          className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm transition-colors ${
            s.id === selectedId ? 'bg-blue-600/20 border border-blue-500/40' : 'hover:bg-gray-700/50'
          }`}
        >
          <div
            className="w-3 h-3 rounded-sm flex-shrink-0"
            style={{ backgroundColor: s.color.replace('0.4', '1') }}
          />
          <input
            type="text"
            value={s.label}
            onChange={(e) => onRename(s.id, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-transparent text-white text-sm outline-none border-b border-transparent focus:border-gray-500"
          />
          <span className="text-xs text-gray-500">{Math.round(s.score * 100)}%</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(s.id);
            }}
            className="text-gray-500 hover:text-red-400 text-xs"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
