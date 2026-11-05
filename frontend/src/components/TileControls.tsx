import type { TileSettings } from '../types';

interface Props {
  settings: TileSettings;
  onChange: (settings: TileSettings) => void;
}

export default function TileControls({ settings, onChange }: Props) {
  const update = (partial: Partial<TileSettings>) => {
    onChange({ ...settings, ...partial });
  };

  return (
    <div className="p-3 space-y-3">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Tile Settings</h3>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-400">
          Width (mm)
          <input
            type="number"
            value={settings.widthMm}
            onChange={(e) => update({ widthMm: Math.max(50, +e.target.value) })}
            className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-white"
          />
        </label>
        <label className="text-xs text-gray-400">
          Height (mm)
          <input
            type="number"
            value={settings.heightMm}
            onChange={(e) => update({ heightMm: Math.max(50, +e.target.value) })}
            className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-white"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-400">
          Grout (mm)
          <input
            type="number"
            value={settings.groutWidthMm}
            onChange={(e) => update({ groutWidthMm: Math.max(0, +e.target.value) })}
            className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-white"
          />
        </label>
        <label className="text-xs text-gray-400">
          Grout Color
          <input
            type="color"
            value={settings.groutColor}
            onChange={(e) => update({ groutColor: e.target.value })}
            className="w-full mt-0.5 h-7 bg-gray-800 border border-gray-700 rounded cursor-pointer"
          />
        </label>
      </div>

      <label className="text-xs text-gray-400 block">
        Rotation
        <select
          value={settings.rotation}
          onChange={(e) => update({ rotation: +e.target.value })}
          className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-white"
        >
          <option value={0}>0°</option>
          <option value={45}>45°</option>
          <option value={90}>90°</option>
        </select>
      </label>

      <label className="text-xs text-gray-400 block">
        Layout
        <select
          value={settings.layout}
          onChange={(e) => update({ layout: e.target.value as TileSettings['layout'] })}
          className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-white"
        >
          <option value="grid">Grid</option>
          <option value="brick">Brick / Subway</option>
          <option value="herringbone">Herringbone</option>
        </select>
      </label>
    </div>
  );
}
