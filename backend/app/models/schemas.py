from __future__ import annotations

from pydantic import BaseModel


class RoomInfo(BaseModel):
    id: str
    filename: str
    width: int
    height: int


class RoomListResponse(BaseModel):
    rooms: list[RoomInfo]


class SegmentRequest(BaseModel):
    room_id: str
    points: list[list[float]]  # [[x, y], ...]
    labels: list[int]  # 1=foreground, 0=background


class SegmentResponse(BaseModel):
    mask_url: str
    score: float
    bbox: list[int]  # [x1, y1, x2, y2]


class LightmapRequest(BaseModel):
    room_id: str
    mask_url: str


class SemanticSurfaceRequest(BaseModel):
    room_id: str


class SemanticSurfaceInfo(BaseModel):
    label: str
    mask_url: str
    score: float = 1.0


class SemanticSurfaceResponse(BaseModel):
    room_id: str
    surfaces: list[SemanticSurfaceInfo]


class MaterialInfo(BaseModel):
    id: str
    name: str
    width_mm: float
    height_mm: float
    thumbnail_url: str
    texture_url: str


class MaterialListResponse(BaseModel):
    materials: list[MaterialInfo]


class CostRequest(BaseModel):
    area_sqm: float
    tile_width_mm: float
    tile_height_mm: float
    tiles_per_box: int
    price_per_box: float
    waste_factor: float = 0.10


class CostResponse(BaseModel):
    area_sqm: float
    tiles_needed: int
    boxes_needed: int
    total_cost: float
    coverage_per_box_sqm: float
