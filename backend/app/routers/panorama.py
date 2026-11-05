from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException, UploadFile, File
from PIL import Image
from pydantic import BaseModel

from app.config import PANORAMA_DIR

router = APIRouter()

ROOMS_SUBDIR = "rooms"
DEFAULT_ROOM_ORDER = [
    "detected_room",
    "warm_living_room",
    "empty_workshop",
    "long_corridor",
    "grand_hall",
]

_SLUG_RE = re.compile(r"[^a-z0-9_-]+")
_VALID_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


class SurfaceMask(BaseModel):
    name: str
    label: str
    mask_url: str


class RoomDimensions(BaseModel):
    width_m: float
    depth_m: float
    height_m: float
    rotation_rad: float
    camera_height_m: float
    floor_polygon_m: list[list[float]]
    num_walls: int


class RoomSummary(BaseModel):
    id: str
    title: str
    description: str | None = None
    panorama_url: str
    thumbnail_url: str
    source: str | None = None


class RoomListResponse(BaseModel):
    rooms: list[RoomSummary]
    default_id: str | None = None


class PanoramaInfo(BaseModel):
    id: str | None = None
    title: str | None = None
    description: str | None = None
    source: str | None = None
    panorama_url: str
    width: int
    height: int
    surfaces: list[SurfaceMask]
    dimensions: RoomDimensions | None = None


_KNOWN_LABELS = {
    "floor": "Floor",
    "ceiling": "Ceiling",
    "wall_north": "Back Wall",
    "wall_south": "Front Wall",
    "wall_east": "Right Wall",
    "wall_west": "Left Wall",
}


def _label_for(name: str) -> str:
    if name in _KNOWN_LABELS:
        return _KNOWN_LABELS[name]
    if name.startswith("wall_"):
        tail = name.split("_", 1)[1]
        try:
            return f"Wall {int(tail) + 1}"
        except ValueError:
            pass
    return name.replace("_", " ").title()


def _slugify(text: str) -> str:
    s = _SLUG_RE.sub("-", text.lower()).strip("-_")
    return s or "room"


def _rooms_root() -> Path:
    return PANORAMA_DIR / ROOMS_SUBDIR


def _room_dir(room_id: str) -> Path:
    # Prevent path traversal and enforce charset.
    if not _VALID_ID_RE.match(room_id):
        raise HTTPException(status_code=400, detail="Invalid room id")
    d = _rooms_root() / room_id
    if not d.is_dir():
        raise HTTPException(status_code=404, detail=f"Room not found: {room_id}")
    return d


def _discover_surfaces_in(dir_: Path, url_prefix: str) -> list[SurfaceMask]:
    surfaces: list[SurfaceMask] = []
    seen: set[str] = set()
    for name in ("floor", "ceiling"):
        if (dir_ / f"mask_{name}.png").exists():
            surfaces.append(
                SurfaceMask(
                    name=name,
                    label=_label_for(name),
                    mask_url=f"{url_prefix}/mask_{name}.png",
                )
            )
            seen.add(name)
    for p in sorted(dir_.glob("mask_wall_*.png")):
        name = p.stem.removeprefix("mask_")
        if name in seen:
            continue
        surfaces.append(
            SurfaceMask(
                name=name,
                label=_label_for(name),
                mask_url=f"{url_prefix}/mask_{name}.png",
            )
        )
        seen.add(name)
    return surfaces


def _load_layout(dir_: Path) -> dict | None:
    layout_path = dir_ / "layout.json"
    if not layout_path.exists():
        return None
    try:
        return json.loads(layout_path.read_text())
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def _dimensions_from_layout(data: dict) -> RoomDimensions | None:
    try:
        return RoomDimensions(
            width_m=float(data["width_m"]),
            depth_m=float(data["depth_m"]),
            height_m=float(data["height_m"]),
            rotation_rad=float(data.get("rotation_rad", 0.0)),
            camera_height_m=float(data.get("camera_height_m", 1.6)),
            floor_polygon_m=[
                [float(x), float(y)] for x, y in data["floor_polygon_m"]
            ],
            num_walls=int(data["num_walls"]),
        )
    except (KeyError, ValueError, TypeError):
        return None


def _room_panorama_path(dir_: Path) -> Path | None:
    for fname in ("panorama.jpg", "panorama.png", "panorama.webp"):
        p = dir_ / fname
        if p.exists():
            return p
    return None


def _build_info_from_dir(room_id: str, dir_: Path) -> PanoramaInfo:
    pano = _room_panorama_path(dir_)
    if pano is None:
        raise HTTPException(status_code=404, detail=f"Panorama not found in room {room_id}")
    url_prefix = f"/static/panorama/{ROOMS_SUBDIR}/{room_id}"
    layout = _load_layout(dir_) or {}
    dims = _dimensions_from_layout(layout) if layout else None
    return PanoramaInfo(
        id=room_id,
        title=layout.get("title") or _label_for(room_id),
        description=layout.get("description"),
        source=layout.get("source"),
        panorama_url=f"{url_prefix}/{pano.name}",
        width=4096,
        height=2048,
        surfaces=_discover_surfaces_in(dir_, url_prefix),
        dimensions=dims,
    )


# --- Legacy top-level fallback (pre-multi-room layout) -------------------


def _discover_surfaces_legacy() -> list[SurfaceMask]:
    return _discover_surfaces_in(PANORAMA_DIR, "/static/panorama")


def _build_info_legacy() -> PanoramaInfo:
    layout = _load_layout(PANORAMA_DIR) or {}
    dims = _dimensions_from_layout(layout) if layout else None
    return PanoramaInfo(
        id="legacy",
        title=layout.get("title") or "Default Room",
        description=layout.get("description"),
        source=layout.get("source"),
        panorama_url="/static/panorama/room_panorama.jpg",
        width=4096,
        height=2048,
        surfaces=_discover_surfaces_legacy(),
        dimensions=dims,
    )


# --- Room enumeration ----------------------------------------------------


def _list_room_ids() -> list[str]:
    root = _rooms_root()
    if not root.is_dir():
        return []
    found = {p.name for p in root.iterdir() if p.is_dir() and _room_panorama_path(p)}
    ordered = [r for r in DEFAULT_ROOM_ORDER if r in found]
    ordered += sorted(r for r in found if r not in DEFAULT_ROOM_ORDER)
    return ordered


def _summary_for(room_id: str) -> RoomSummary:
    dir_ = _rooms_root() / room_id
    layout = _load_layout(dir_) or {}
    pano = _room_panorama_path(dir_)
    assert pano is not None
    url_prefix = f"/static/panorama/{ROOMS_SUBDIR}/{room_id}"
    return RoomSummary(
        id=room_id,
        title=layout.get("title") or _label_for(room_id),
        description=layout.get("description"),
        source=layout.get("source"),
        panorama_url=f"{url_prefix}/{pano.name}",
        thumbnail_url=f"{url_prefix}/{pano.name}",
    )


# --- Endpoints -----------------------------------------------------------


@router.get("/rooms", response_model=RoomListResponse)
async def list_rooms():
    ids = _list_room_ids()
    rooms = [_summary_for(r) for r in ids]
    return RoomListResponse(rooms=rooms, default_id=ids[0] if ids else None)


@router.get("/rooms/{room_id}", response_model=PanoramaInfo)
async def get_room(room_id: str):
    dir_ = _room_dir(room_id)
    return _build_info_from_dir(room_id, dir_)


@router.get("", response_model=PanoramaInfo)
async def get_default_panorama():
    ids = _list_room_ids()
    if ids:
        return _build_info_from_dir(ids[0], _rooms_root() / ids[0])
    return _build_info_legacy()


class DetectLayoutRequest(BaseModel):
    room_id: str | None = None
    panorama: str | None = None          # legacy: filename inside PANORAMA_DIR
    camera_height_m: float = 1.6
    force_cuboid: bool = True


@router.post("/detect", response_model=PanoramaInfo)
async def detect_layout(req: Optional[DetectLayoutRequest] = None):
    req = req or DetectLayoutRequest()

    if req.room_id:
        room_dir = _room_dir(req.room_id)
        pano_path = _room_panorama_path(room_dir)
        if pano_path is None:
            raise HTTPException(status_code=404, detail="Panorama not found in room")
        out_dir = room_dir
        url_room_id = req.room_id
    else:
        # Legacy path — work on top-level PANORAMA_DIR
        pano_name = req.panorama or "room_panorama.jpg"
        pano_path = PANORAMA_DIR / pano_name
        if not pano_path.exists():
            raise HTTPException(status_code=404, detail=f"Panorama not found: {pano_name}")
        out_dir = PANORAMA_DIR
        url_room_id = None

    for old in out_dir.glob("mask_wall_*.png"):
        old.unlink()

    try:
        from app.services import layout_service
    except ImportError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Layout service unavailable (torch not installed?): {e}",
        )

    try:
        layout_service.detect_and_render(
            panorama_path=str(pano_path),
            out_dir=str(out_dir),
            camera_height_m=req.camera_height_m,
            force_cuboid=req.force_cuboid,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Layout detection failed: {e}")

    if url_room_id:
        return _build_info_from_dir(url_room_id, out_dir)
    return _build_info_legacy()


def _create_heuristic_pano_room(
    room_id: str, room_dir: Path, pano_path: Path, title: Optional[str]
) -> PanoramaInfo:
    """Create simple floor/ceiling/wall masks without AI when torch isn't available."""
    img = Image.open(pano_path)
    w, h = img.size

    yy = np.linspace(0.0, 1.0, h, endpoint=False)[:, None]
    xx = np.linspace(0.0, 1.0, w, endpoint=False)[None, :]

    floor_mask = yy > 0.75
    ceiling_mask = yy < 0.20
    mid = (~floor_mask) & (~ceiling_mask)
    # 4 wall slices: W/E/N/S
    wall_masks = [
        mid & (xx < 0.25),
        mid & (xx >= 0.25) & (xx < 0.50),
        mid & (xx >= 0.50) & (xx < 0.75),
        mid & (xx >= 0.75),
    ]

    def _save(mask: np.ndarray, name: str) -> None:
        Image.fromarray((mask.astype(np.uint8) * 255)).save(room_dir / name)

    _save(floor_mask, "mask_floor.png")
    _save(ceiling_mask, "mask_ceiling.png")
    for i, wm in enumerate(wall_masks):
        _save(wm, f"mask_wall_{i}.png")

    layout = {
        "title": title or _label_for(room_id),
        "source": "user_upload_heuristic",
        "width_m": 5.0,
        "depth_m": 5.0,
        "height_m": 2.7,
        "rotation_rad": 0.0,
        "camera_height_m": 1.6,
        "floor_polygon_m": [[-2.5, -2.5], [2.5, -2.5], [2.5, 2.5], [-2.5, 2.5]],
        "num_walls": 4,
    }
    (room_dir / "layout.json").write_text(json.dumps(layout, indent=2))
    return _build_info_from_dir(room_id, room_dir)


@router.post("/upload", response_model=PanoramaInfo)
async def upload_panorama(file: UploadFile = File(...), title: Optional[str] = None):
    if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=400, detail="Unsupported image type")

    base_name = (title or file.filename or "uploaded").rsplit(".", 1)[0]
    room_id = _slugify(base_name) or "uploaded"
    rooms_root = _rooms_root()
    rooms_root.mkdir(parents=True, exist_ok=True)
    candidate = room_id
    i = 2
    while (rooms_root / candidate).exists():
        candidate = f"{room_id}-{i}"
        i += 1
    room_dir = rooms_root / candidate
    room_dir.mkdir(parents=True)

    dest = room_dir / "panorama.jpg"
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    if title:
        (room_dir / "layout.json").write_text(
            json.dumps({"title": title, "source": "user_upload"}, indent=2)
        )

    # Try AI layout detection; fall back to heuristic masks if torch unavailable.
    try:
        return await detect_layout(DetectLayoutRequest(room_id=candidate, panorama=None))
    except HTTPException:
        return _create_heuristic_pano_room(candidate, room_dir, dest, title)
