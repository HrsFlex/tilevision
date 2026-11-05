import type { PanoramaRoomSummary } from '../hooks/useApi';

interface RoomPickerProps {
  rooms: PanoramaRoomSummary[];
  activeId: string | null;
  onSelect: (roomId: string) => void;
  loading?: boolean;
}

/**
 * Horizontal strip of panorama room thumbnails, pinned above the 3D viewer.
 * Each card is a simple square preview of the equirectangular image.
 */
export default function RoomPicker({ rooms, activeId, onSelect, loading }: RoomPickerProps) {
  if (rooms.length === 0) return null;
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto border-b border-slate-800 bg-slate-900/90 px-3 py-2">
      <div className="flex flex-col justify-center pr-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Room
        </div>
        <div className="text-[10px] text-slate-500">{rooms.length} available</div>
      </div>
      {rooms.map((room) => {
        const isActive = room.id === activeId;
        return (
          <button
            key={room.id}
            onClick={() => onSelect(room.id)}
            disabled={loading || isActive}
            title={room.description ?? room.title}
            className={`group relative flex w-32 flex-shrink-0 flex-col overflow-hidden rounded-md border text-left transition-all ${
              isActive
                ? 'border-sky-500 ring-2 ring-sky-500/40'
                : 'border-slate-700 hover:border-slate-500'
            } ${loading && !isActive ? 'opacity-50 cursor-wait' : ''}`}
          >
            <div className="relative h-14 w-full overflow-hidden bg-slate-800">
              <img
                src={room.thumbnail_url}
                alt={room.title}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              {isActive && (
                <div className="pointer-events-none absolute inset-0 bg-sky-500/10" />
              )}
            </div>
            <div className="px-2 py-1">
              <div className="truncate text-xs font-medium text-white">{room.title}</div>
              {room.description && (
                <div className="truncate text-[10px] text-slate-400">
                  {room.description}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
