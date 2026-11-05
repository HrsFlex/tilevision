from __future__ import annotations

import io
import uuid

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from PIL import Image

from app.config import ROOMS_DIR
from app.models.schemas import (
    SegmentRequest,
    SegmentResponse,
    LightmapRequest,
    SemanticSurfaceRequest,
    SemanticSurfaceResponse,
    SemanticSurfaceInfo,
)
from app.services.sam_service import sam_service
from app.services.lighting import extract_lightmap

router = APIRouter()

# In-memory mask store (POC only — no persistence needed)
_mask_store: dict[str, np.ndarray] = {}


def _load_room_image(room_id: str) -> np.ndarray:
    """Load a room image as RGB numpy array."""
    for p in ROOMS_DIR.iterdir():
        if p.stem == room_id and "_mask_" not in p.stem:
            img = cv2.imread(str(p))
            if img is not None:
                return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    raise HTTPException(404, "Room not found")


def _mask_to_png_bytes(mask: np.ndarray) -> bytes:
    """Convert a boolean HW mask to a PNG byte buffer."""
    img = Image.fromarray((mask.astype(np.uint8) * 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _store_mask(mask: np.ndarray) -> str:
    mask_id = uuid.uuid4().hex[:12]
    _mask_store[mask_id] = mask.astype(bool)
    return f"/api/segments/mask/{mask_id}"


def _heuristic_surface_masks(image: np.ndarray) -> list[tuple[str, np.ndarray]]:
    """Fallback masks when SegFormer is unavailable."""
    h, w = image.shape[:2]
    yy = np.linspace(0.0, 1.0, h, endpoint=False)[:, None]
    xx = np.linspace(0.0, 1.0, w, endpoint=False)[None, :]

    floor = yy > 0.62
    ceiling = yy < 0.20
    walls = (~floor & ~ceiling) & (xx > 0.03) & (xx < 0.97)
    return [("Floor", floor), ("Walls", walls), ("Ceiling", ceiling)]


@router.post("/detect", response_model=SegmentResponse)
async def detect_surface(req: SegmentRequest):
    image = _load_room_image(req.room_id)
    mask, score, bbox = sam_service.predict(image, req.points, req.labels)

    # Store mask for later use (lightmap, etc.)
    mask_url = _store_mask(mask)
    return SegmentResponse(mask_url=mask_url, score=score, bbox=bbox)


@router.post("/semantic", response_model=SemanticSurfaceResponse)
async def detect_semantic_surfaces(req: SemanticSurfaceRequest):
    """Auto-generate paintable masks (floor, walls, ceiling) from ADE20K."""
    image = _load_room_image(req.room_id)
    try:
        from app.services import semantic_service as sem

        semantic_ids = sem.segment_pano(image, infer_size=(1024, 768), tiled=False)
        occ = sem.occluder_mask_from_ids(semantic_ids, dilate_px=3)
        candidates = [
            ("Floor", sem.surface_class_mask(semantic_ids, "floor")),
            ("Walls", sem.surface_class_mask(semantic_ids, "wall")),
            ("Ceiling", sem.surface_class_mask(semantic_ids, "ceiling")),
        ]
    except Exception:  # pragma: no cover
        occ = np.zeros(image.shape[:2], dtype=bool)
        candidates = _heuristic_surface_masks(image)

    surfaces: list[SemanticSurfaceInfo] = []
    min_area = max(500, int(image.shape[0] * image.shape[1] * 0.005))
    for label, mask in candidates:
        refined = mask & ~occ
        if int(refined.sum()) < min_area:
            # Fallback when occluder removal is too aggressive.
            refined = mask
        area = int(refined.sum())
        if area < min_area:
            continue

        # Save mask to disk so it survives backend restarts
        safe_label = label.lower().replace(" ", "_")
        mask_filename = f"{req.room_id}_mask_{safe_label}.png"
        mask_path = ROOMS_DIR / mask_filename
        png_bytes = _mask_to_png_bytes(refined)
        mask_path.write_bytes(png_bytes)
        mask_url = f"/static/rooms/{mask_filename}"

        score = min(1.0, area / float(image.shape[0] * image.shape[1]) * 2.0)
        surfaces.append(SemanticSurfaceInfo(label=label, mask_url=mask_url, score=score))

    return SemanticSurfaceResponse(room_id=req.room_id, surfaces=surfaces)


@router.get("/mask/{mask_id}")
async def get_mask(mask_id: str):
    mask = _mask_store.get(mask_id)
    if mask is None:
        raise HTTPException(404, "Mask not found")
    png_bytes = _mask_to_png_bytes(mask)
    return StreamingResponse(io.BytesIO(png_bytes), media_type="image/png")


@router.post("/lightmap")
async def get_lightmap(req: LightmapRequest):
    image = _load_room_image(req.room_id)

    # Extract mask_id from URL
    mask_id = req.mask_url.split("/")[-1]
    mask = _mask_store.get(mask_id)
    if mask is None:
        raise HTTPException(404, "Mask not found — detect surface first")

    lightmap = extract_lightmap(image, mask)
    png_bytes = _mask_to_png_bytes(lightmap > 0)  # just for debug

    # Return actual lightmap as grayscale PNG
    img = Image.fromarray(lightmap)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png")
