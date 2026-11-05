import { useState } from 'react';
import { calculateCost } from '../hooks/useApi';
import type { CostEstimate, TileSettings } from '../types';

interface Props {
  tileSettings: TileSettings;
}

export default function CostEstimator({ tileSettings }: Props) {
  const [areaSqm, setAreaSqm] = useState(10);
  const [tilesPerBox, setTilesPerBox] = useState(6);
  const [pricePerBox, setPricePerBox] = useState(25);
  const [wasteFactor, setWasteFactor] = useState(0.1);
  const [result, setResult] = useState<CostEstimate | null>(null);
  const [loading, setLoading] = useState(false);

  const compute = async () => {
    setLoading(true);
    try {
      const est = await calculateCost({
        area_sqm: areaSqm,
        tile_width_mm: tileSettings.widthMm,
        tile_height_mm: tileSettings.heightMm,
        tiles_per_box: tilesPerBox,
        price_per_box: pricePerBox,
        waste_factor: wasteFactor,
      });
      setResult(est);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-3 space-y-3">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Cost Estimation</h3>

      <label className="text-xs text-gray-400 block">
        Area (m²)
        <input
          type="number"
          step="0.5"
          value={areaSqm}
          onChange={(e) => setAreaSqm(+e.target.value)}
          className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-white"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-400">
          Tiles/box
          <input
            type="number"
            value={tilesPerBox}
            onChange={(e) => setTilesPerBox(+e.target.value)}
            className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-white"
          />
        </label>
        <label className="text-xs text-gray-400">
          Price/box ($)
          <input
            type="number"
            value={pricePerBox}
            onChange={(e) => setPricePerBox(+e.target.value)}
            className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-white"
          />
        </label>
      </div>

      <label className="text-xs text-gray-400 block">
        Waste factor
        <select
          value={wasteFactor}
          onChange={(e) => setWasteFactor(+e.target.value)}
          className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-white"
        >
          <option value={0.05}>5%</option>
          <option value={0.1}>10%</option>
          <option value={0.15}>15%</option>
          <option value={0.2}>20%</option>
        </select>
      </label>

      <button
        onClick={compute}
        disabled={loading}
        className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white text-sm rounded transition-colors"
      >
        {loading ? 'Calculating...' : 'Calculate Cost'}
      </button>

      {result && (
        <div className="bg-gray-800/50 rounded p-2 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Area</span>
            <span className="text-white">{result.area_sqm} m²</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Tiles needed</span>
            <span className="text-white">{result.tiles_needed}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Boxes needed</span>
            <span className="text-white">{result.boxes_needed}</span>
          </div>
          <div className="flex justify-between border-t border-gray-700 pt-1 mt-1">
            <span className="text-gray-300 font-medium">Total Cost</span>
            <span className="text-green-400 font-semibold">${result.total_cost.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
