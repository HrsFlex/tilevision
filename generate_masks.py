"""
Generate geometric surface masks for a real equirectangular room panorama.

Uses ray-casting against a box room to determine which pixel belongs to which
surface (floor, ceiling, 4 walls). The room dimensions and rotation offset
can be tuned to match the actual panorama photograph.

Output:  assets/panorama/mask_*.png  (one per surface)
"""

import math
import os

try:
    from PIL import Image, ImageFilter
except ImportError:
    print("Pillow not installed. Run: pip install pillow")
    exit(1)

# Must match the panorama image dimensions
W, H = 4096, 2048

# Room dimensions (meters) – camera at center
ROOM_W = 4.5   # x-axis (left/right)
ROOM_H = 2.8   # y-axis (up/down)
ROOM_D = 5.0   # z-axis (front/back)

HALF_W = ROOM_W / 2
HALF_H = ROOM_H / 2
HALF_D = ROOM_D / 2

# Rotation offset (radians) – rotates the virtual room to align with the photo.
# Adjust this so virtual walls line up with real walls.
ROTATION = 0.0

SURFACE_NAMES = ['floor', 'ceiling', 'wall_north', 'wall_south', 'wall_east', 'wall_west']

OUT_DIR = os.path.join(os.path.dirname(__file__), 'assets', 'panorama')


def direction_from_equirect(px: int, py: int):
    """Convert equirectangular pixel to 3D direction vector."""
    theta = (px / W) * 2 * math.pi + ROTATION
    phi = (py / H) * math.pi  # 0=up, π=down

    dx = math.sin(phi) * math.sin(theta)
    dy = math.cos(phi)
    dz = math.sin(phi) * math.cos(theta)

    return dx, dy, dz


def ray_hit_room(dx, dy, dz):
    """
    Ray from origin in direction (dx,dy,dz) – find which room surface it hits.
    Returns surface_name or None.
    """
    best_t = float('inf')
    best = None

    # Floor: y = -HALF_H
    if dy < -1e-9:
        t = -HALF_H / dy
        hx, hz = dx * t, dz * t
        if abs(hx) <= HALF_W and abs(hz) <= HALF_D and t < best_t:
            best_t = t
            best = 'floor'

    # Ceiling: y = +HALF_H
    if dy > 1e-9:
        t = HALF_H / dy
        hx, hz = dx * t, dz * t
        if abs(hx) <= HALF_W and abs(hz) <= HALF_D and t < best_t:
            best_t = t
            best = 'ceiling'

    # Wall North: z = -HALF_D
    if dz < -1e-9:
        t = -HALF_D / dz
        hx, hy = dx * t, dy * t
        if abs(hx) <= HALF_W and abs(hy) <= HALF_H and t < best_t:
            best_t = t
            best = 'wall_north'

    # Wall South: z = +HALF_D
    if dz > 1e-9:
        t = HALF_D / dz
        hx, hy = dx * t, dy * t
        if abs(hx) <= HALF_W and abs(hy) <= HALF_H and t < best_t:
            best_t = t
            best = 'wall_south'

    # Wall East: x = +HALF_W
    if dx > 1e-9:
        t = HALF_W / dx
        hz, hy = dz * t, dy * t
        if abs(hz) <= HALF_D and abs(hy) <= HALF_H and t < best_t:
            best_t = t
            best = 'wall_east'

    # Wall West: x = -HALF_W
    if dx < -1e-9:
        t = -HALF_W / dx
        hz, hy = dz * t, dy * t
        if abs(hz) <= HALF_D and abs(hy) <= HALF_H and t < best_t:
            best_t = t
            best = 'wall_west'

    return best


def generate():
    os.makedirs(OUT_DIR, exist_ok=True)

    print(f"Generating {W}×{H} geometric masks for room panorama...")
    print(f"Room: {ROOM_W}m × {ROOM_H}m × {ROOM_D}m, rotation={math.degrees(ROTATION):.1f}°")

    # Create mask images
    masks = {}
    mask_pixels = {}
    for name in SURFACE_NAMES:
        m = Image.new('L', (W, H), 0)
        masks[name] = m
        mask_pixels[name] = m.load()

    for py in range(H):
        if py % 200 == 0:
            print(f"  Row {py}/{H} ({100 * py // H}%)")
        for px in range(W):
            dx, dy, dz = direction_from_equirect(px, py)
            hit = ray_hit_room(dx, dy, dz)
            if hit:
                mask_pixels[hit][px, py] = 255

    # Save masks with slight blur for smooth edges
    for name in SURFACE_NAMES:
        mask = masks[name].filter(ImageFilter.GaussianBlur(radius=1.5))
        mask_path = os.path.join(OUT_DIR, f'mask_{name}.png')
        mask.save(mask_path)
        print(f"  Saved: {mask_path}")

    # Also save a debug composite showing all masks in different colors
    debug = Image.new('RGB', (W, H), (0, 0, 0))
    debug_px = debug.load()
    colors = {
        'floor': (200, 100, 50),
        'ceiling': (50, 100, 200),
        'wall_north': (50, 200, 50),
        'wall_south': (200, 200, 50),
        'wall_east': (200, 50, 200),
        'wall_west': (50, 200, 200),
    }
    for name in SURFACE_NAMES:
        mp = masks[name].load()
        c = colors[name]
        for py in range(H):
            for px in range(W):
                if mp[px, py] > 128:
                    debug_px[px, py] = c
    debug.save(os.path.join(OUT_DIR, 'debug_masks.jpg'), quality=85)
    print(f"  Saved debug overlay: {os.path.join(OUT_DIR, 'debug_masks.jpg')}")

    print("\nDone! Masks in:", OUT_DIR)


if __name__ == '__main__':
    generate()
