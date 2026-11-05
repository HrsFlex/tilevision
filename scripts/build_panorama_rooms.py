"""Download Polyhaven HDRI panoramas and render approximate cuboid masks.

Creates one folder per room under assets/panorama/rooms/<slug>/ containing:
    panorama.jpg      – equirectangular photo (4096×2048)
    layout.json       – room dimensions + floor polygon
    mask_floor.png    – per-surface masks (same size as panorama)
    mask_ceiling.png
    mask_wall_0.png
    mask_wall_1.png
    mask_wall_2.png
    mask_wall_3.png

Cuboid geometry is hand-picked per room (torch is not required). Since these
panoramas are typically axis-aligned photography HDRIs, a rectangular cuboid
is a reasonable first approximation and can be regenerated with HorizonNet
later via POST /api/panorama/detect once torch is installed.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import time
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))

from app.services.layout_service import render_masks  # noqa: E402

ROOMS_DIR = REPO / "assets" / "panorama" / "rooms"
CACHE_DIR = REPO / "scripts" / ".pano_cache"
PANO_W, PANO_H = 4096, 2048


@dataclass
class RoomSpec:
    slug: str
    title: str
    source: str                          # polyhaven HDRI slug (for attribution)
    description: str
    url: str                             # direct JPG url
    width_m: float                       # W = east-west
    depth_m: float                       # D = north-south
    height_m: float                      # ceiling height
    rotation_rad: float = 0.0            # extra yaw so that wall_0 is "back"
    camera_height_m: float = 1.6


ROOMS: list[RoomSpec] = [
    RoomSpec(
        slug="warm_living_room",
        title="Warm Living Room",
        source="lebombo",
        description="Simple domestic room with wood floor and a large window.",
        url="https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/lebombo.jpg",
        width_m=6.0, depth_m=5.0, height_m=3.0,
    ),
    RoomSpec(
        slug="empty_workshop",
        title="Empty Workshop",
        source="empty_workshop",
        description="Large, bare concrete workshop with bright overhead skylights.",
        url="https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/empty_workshop.jpg",
        width_m=14.0, depth_m=12.0, height_m=5.5,
    ),
    RoomSpec(
        slug="long_corridor",
        title="Long Corridor",
        source="large_corridor",
        description="Long arched hallway with tall windows on both sides.",
        url="https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/large_corridor.jpg",
        width_m=3.5, depth_m=18.0, height_m=5.0,
    ),
    RoomSpec(
        slug="grand_hall",
        title="Grand Hall",
        source="music_hall_02",
        description="High-ceilinged Victorian hall with side windows.",
        url="https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/music_hall_02.jpg",
        width_m=10.0, depth_m=14.0, height_m=6.0,
    ),
]


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return
    print(f"  ↓ {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "tiles-visualizer/1.0"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = resp.read()
    dest.write_bytes(data)


def _enhance_panorama(img: Image.Image, preset: str) -> Image.Image:
    """Apply a cinematic enhancement pass for stronger perceived quality."""
    if preset == "none":
        return img

    if preset == "balanced":
        color_boost = 1.12
        contrast_boost = 1.14
        brightness_boost = 1.03
        sharpness_boost = 1.22
        radius = 1.8
        percent = 155
    elif preset == "godlike":
        color_boost = 1.20
        contrast_boost = 1.28
        brightness_boost = 1.05
        sharpness_boost = 1.38
        radius = 2.1
        percent = 190
    else:  # pragma: no cover
        raise ValueError(f"Unknown enhancement preset: {preset}")

    # Build a gentle local-contrast base, then layer global boosts.
    # This avoids flat lighting while making details pop.
    local_contrast = img.filter(ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=2))
    enhanced = Image.blend(img, local_contrast, alpha=0.62)
    enhanced = ImageEnhance.Color(enhanced).enhance(color_boost)
    enhanced = ImageEnhance.Contrast(enhanced).enhance(contrast_boost)
    enhanced = ImageEnhance.Brightness(enhanced).enhance(brightness_boost)
    enhanced = ImageEnhance.Sharpness(enhanced).enhance(sharpness_boost)
    return enhanced


def resize_panorama(src: Path, dest: Path, preset: str) -> None:
    with Image.open(src) as img:
        img = img.convert("RGB")
        resized = img.resize((PANO_W, PANO_H), Image.LANCZOS)
        resized = _enhance_panorama(resized, preset=preset)
        resized.save(dest, "JPEG", quality=90, progressive=True)


def rectangular_floor_polygon(width: float, depth: float, rot: float = 0.0) -> np.ndarray:
    """Return 4 floor corners (x, z) in meters for a centered rectangle.

    Polygon winds CCW so `wall_0` is the +Z side (back wall).
    """
    hw, hd = width / 2.0, depth / 2.0
    pts = np.array([[-hw, +hd], [+hw, +hd], [+hw, -hd], [-hw, -hd]])
    if rot != 0.0:
        c, s = np.cos(rot), np.sin(rot)
        R = np.array([[c, -s], [s, c]])
        pts = pts @ R.T
    return pts


def build_room(spec: RoomSpec, preset: str) -> None:
    print(f"→ {spec.slug}  ({spec.source})")
    cached = CACHE_DIR / f"{spec.source}.jpg"
    download(spec.url, cached)

    room_dir = ROOMS_DIR / spec.slug
    room_dir.mkdir(parents=True, exist_ok=True)

    pano_path = room_dir / "panorama.jpg"
    resize_panorama(cached, pano_path, preset=preset)

    floor_polygon = rectangular_floor_polygon(spec.width_m, spec.depth_m, spec.rotation_rad)
    masks = render_masks(
        floor_polygon=floor_polygon,
        room_height_m=spec.height_m,
        camera_height_m=spec.camera_height_m,
        out_size=(PANO_W, PANO_H),
    )
    for name, mask in masks.items():
        Image.fromarray(mask, mode="L").save(room_dir / f"mask_{name}.png", optimize=True)

    layout = {
        "width_m": spec.width_m,
        "depth_m": spec.depth_m,
        "height_m": spec.height_m,
        "rotation_rad": spec.rotation_rad,
        "floor_polygon_m": floor_polygon.tolist(),
        "camera_height_m": spec.camera_height_m,
        "num_walls": len(floor_polygon),
        "title": spec.title,
        "description": spec.description,
        "source": f"polyhaven/{spec.source}",
        "image_processing": {"preset": preset},
    }
    (room_dir / "layout.json").write_text(json.dumps(layout, indent=2))
    print(f"  ✓ wrote {room_dir.relative_to(REPO)}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build panorama rooms from Polyhaven HDRIs with optional enhancement."
    )
    parser.add_argument(
        "--enhance",
        choices=["none", "balanced", "godlike"],
        default="godlike",
        help="Enhancement preset for panorama.jpg (default: godlike).",
    )
    args = parser.parse_args()

    ROOMS_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Enhancement preset: {args.enhance}")
    t0 = time.time()
    for spec in ROOMS:
        try:
            build_room(spec, preset=args.enhance)
        except Exception as exc:  # pragma: no cover
            print(f"  ✗ {spec.slug}: {exc}", file=sys.stderr)
    print(f"done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
