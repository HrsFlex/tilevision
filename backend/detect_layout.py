#!/usr/bin/env python3
"""
CLI: detect room layout from a panorama and write masks to assets/panorama/.

Usage:
    .venv312/bin/python backend/detect_layout.py [PANORAMA_PATH] [--out DIR]

Defaults:
    PANORAMA_PATH = assets/panorama/room_panorama.jpg
    OUT           = assets/panorama/
"""

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)  # so `app.*` imports work

from app.services import layout_service  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "panorama",
        nargs="?",
        default=os.path.join(ROOT, "assets", "panorama", "room_panorama.jpg"),
        help="Path to equirectangular panorama JPG/PNG.",
    )
    ap.add_argument(
        "--out",
        default=os.path.join(ROOT, "assets", "panorama"),
        help="Output directory for masks + layout.json.",
    )
    ap.add_argument("--ckpt", default=layout_service.DEFAULT_CKPT)
    ap.add_argument("--camera-height", type=float, default=1.6)
    ap.add_argument("--width", type=int, default=4096)
    ap.add_argument("--height", type=int, default=2048)
    ap.add_argument("--no-cuboid", action="store_true",
                    help="Disable force_cuboid (allow general layouts).")
    args = ap.parse_args()

    if not os.path.isfile(args.panorama):
        print(f"ERROR: panorama not found: {args.panorama}", file=sys.stderr)
        sys.exit(1)
    if not os.path.isfile(args.ckpt):
        print(f"ERROR: checkpoint not found: {args.ckpt}", file=sys.stderr)
        sys.exit(1)

    print(f"Panorama: {args.panorama}")
    print(f"Checkpoint: {args.ckpt}")
    print("Running HorizonNet ...")
    result = layout_service.detect_and_render(
        panorama_path=args.panorama,
        out_dir=args.out,
        ckpt_path=args.ckpt,
        camera_height_m=args.camera_height,
        out_size=(args.width, args.height),
        force_cuboid=not args.no_cuboid,
    )
    print("\nLayout detected:")
    print(f"  walls       : {result.num_walls}")
    print(f"  room W×D×H  : {result.width_m:.2f} × {result.depth_m:.2f} "
          f"× {result.height_m:.2f} m")
    print(f"  rotation    : {result.rotation_rad:.3f} rad "
          f"({result.rotation_rad * 180 / 3.141592653589793:+.1f}°)")
    print(f"  output      : {args.out}")


if __name__ == "__main__":
    main()
