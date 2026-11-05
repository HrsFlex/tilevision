from __future__ import annotations

import math

from fastapi import APIRouter

from app.models.schemas import CostRequest, CostResponse

router = APIRouter()


@router.post("/cost", response_model=CostResponse)
async def calculate_cost(req: CostRequest):
    # Single tile area in m²
    tile_area_sqm = (req.tile_width_mm / 1000) * (req.tile_height_mm / 1000)

    # Coverage per box
    coverage_per_box = tile_area_sqm * req.tiles_per_box

    # Required coverage with waste
    required_coverage = req.area_sqm * (1 + req.waste_factor)

    # Tiles and boxes needed
    tiles_needed = math.ceil(required_coverage / tile_area_sqm)
    boxes_needed = math.ceil(required_coverage / coverage_per_box)

    total_cost = boxes_needed * req.price_per_box

    return CostResponse(
        area_sqm=round(req.area_sqm, 2),
        tiles_needed=tiles_needed,
        boxes_needed=boxes_needed,
        total_cost=round(total_cost, 2),
        coverage_per_box_sqm=round(coverage_per_box, 4),
    )
