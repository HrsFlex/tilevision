"""Run the real HorizonNet + SegFormer pipeline on each non-detected room.

For every subdirectory under assets/panorama/rooms/ whose layout.json has
source != 'horizonnet_detection', this script will:
    1. (Polyhaven HDRIs are already aligned, so we skip pano_lsd VP align)
    2. run HorizonNet to get corners
    3. render per-surface masks by ray-casting the recovered cuboid
    4. semantically refine them via SegFormer ADE20K
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))

# Cache heavy ML artefacts inside the repo so sandboxed runs can write them.
os.environ.setdefault("TORCH_HOME", str(REPO / ".torch_cache"))
os.environ.setdefault("HF_HOME", str(REPO / ".hf_cache"))
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

from app.services import layout_service  # noqa: E402

ROOMS_DIR = REPO / "assets" / "panorama" / "rooms"


def log(msg: str) -> None:
    print(msg, flush=True)


def _read_layout(room_dir: Path) -> dict | None:
    p = room_dir / "layout.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def should_process(layout: dict | None) -> bool:
    if layout is None:
        return True
    return layout.get("source") != "horizonnet_detection"


def _pano_already_aligned(layout: dict | None) -> bool:
    """Polyhaven HDRIs we ship are horizon-aligned, so we can skip the slow
    LSD-based VP alignment step."""
    if not layout:
        return False
    src = str(layout.get("source", ""))
    return src.startswith("polyhaven/")


def run_room(room_dir: Path) -> None:
    pano_path = room_dir / "panorama.jpg"
    if not pano_path.exists():
        log(f"  ! skip {room_dir.name}: no panorama.jpg")
        return

    layout = _read_layout(room_dir)
    if not should_process(layout):
        log(f"  = {room_dir.name} already HorizonNet-detected, skipping")
        return

    title = (layout or {}).get("title")
    description = (layout or {}).get("description")
    source_note = (layout or {}).get("source")
    do_align = not _pano_already_aligned(layout)

    log(
        f"→ {room_dir.name}  ({pano_path.stat().st_size // 1024} KB)  "
        f"align={do_align}"
    )
    t0 = time.time()
    try:
        result = layout_service.detect_and_render(
            panorama_path=str(pano_path),
            out_dir=str(room_dir),
            camera_height_m=1.6,
            out_size=(4096, 2048),
            force_cuboid=True,
            align=do_align,
            semantic_refine=True,
        )
    except Exception as exc:
        log(f"  ✗ {room_dir.name}: {exc!r}")
        raise

    layout_path = room_dir / "layout.json"
    if layout_path.exists():
        data = json.loads(layout_path.read_text())
        if title:
            data["title"] = title
        if description:
            data["description"] = description
        if source_note and source_note != "horizonnet_detection":
            data["original_source"] = source_note
        data["source"] = "horizonnet_detection"
        layout_path.write_text(json.dumps(data, indent=2))

    dt = time.time() - t0
    log(
        f"  ✓ {room_dir.name}  "
        f"{result.width_m:.1f}×{result.depth_m:.1f}×{result.height_m:.1f} m  "
        f"in {dt:.1f}s"
    )


def main() -> None:
    for room_dir in sorted(p for p in ROOMS_DIR.iterdir() if p.is_dir()):
        run_room(room_dir)


if __name__ == "__main__":
    main()
