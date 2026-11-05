"""
Generate a synthetic equirectangular panorama of an empty room, using the
EXACT same box geometry as generate_masks.py. This guarantees that the
geometric masks align perfectly with the panorama, so tiles render on the
correct surfaces.

Output: assets/panorama/room_panorama.jpg (4096 x 2048)
"""

import math
import os

from PIL import Image

# ── Must match generate_masks.py ──────────────────────────────────────────
W, H = 4096, 2048
ROOM_W = 4.5
ROOM_H = 2.8
ROOM_D = 5.0
ROTATION = 0.0

HALF_W = ROOM_W / 2
HALF_H = ROOM_H / 2
HALF_D = ROOM_D / 2

OUT_PATH = os.path.join(os.path.dirname(__file__), 'assets', 'panorama',
                        'room_panorama.jpg')

# ── Base surface colors (RGB, sRGB) ───────────────────────────────────────
COLORS = {
    'floor':      (170, 150, 130),   # light wood
    'ceiling':    (245, 245, 240),   # off-white
    'wall_north': (220, 215, 205),   # warm neutral
    'wall_south': (220, 215, 205),
    'wall_east':  (215, 210, 200),
    'wall_west':  (215, 210, 200),
}

# Accent baseboard & ceiling trim color
TRIM = (235, 230, 220)
TRIM_HEIGHT_M = 0.08  # 8 cm


def dir_from_equirect(px: int, py: int):
    theta = (px / W) * 2 * math.pi + ROTATION
    phi = (py / H) * math.pi
    dx = math.sin(phi) * math.sin(theta)
    dy = math.cos(phi)
    dz = math.sin(phi) * math.cos(theta)
    return dx, dy, dz


def ray_hit(dx, dy, dz):
    """Return (surface, hit_x, hit_y, hit_z, distance)."""
    best_t = float('inf')
    best = None

    if dy < -1e-9:
        t = -HALF_H / dy
        if abs(dx * t) <= HALF_W and abs(dz * t) <= HALF_D and t < best_t:
            best_t = t
            best = 'floor'
    if dy > 1e-9:
        t = HALF_H / dy
        if abs(dx * t) <= HALF_W and abs(dz * t) <= HALF_D and t < best_t:
            best_t = t
            best = 'ceiling'
    if dz < -1e-9:
        t = -HALF_D / dz
        if abs(dx * t) <= HALF_W and abs(dy * t) <= HALF_H and t < best_t:
            best_t = t
            best = 'wall_north'
    if dz > 1e-9:
        t = HALF_D / dz
        if abs(dx * t) <= HALF_W and abs(dy * t) <= HALF_H and t < best_t:
            best_t = t
            best = 'wall_south'
    if dx > 1e-9:
        t = HALF_W / dx
        if abs(dz * t) <= HALF_D and abs(dy * t) <= HALF_H and t < best_t:
            best_t = t
            best = 'wall_east'
    if dx < -1e-9:
        t = -HALF_W / dx
        if abs(dz * t) <= HALF_D and abs(dy * t) <= HALF_H and t < best_t:
            best_t = t
            best = 'wall_west'

    if best is None:
        return None

    hx, hy, hz = dx * best_t, dy * best_t, dz * best_t
    return best, hx, hy, hz, best_t


def shade(base_rgb, distance, hit_y, is_near_trim):
    """Simple distance falloff + slight ambient occlusion near edges."""
    # Soft distance falloff
    falloff = 1.0 / (1.0 + 0.04 * distance * distance)
    brightness = 0.55 + 0.45 * falloff

    # Slight darkening near floor corners (fake AO)
    if hit_y < -HALF_H + 0.4:
        brightness *= 0.88 + 0.12 * ((hit_y + HALF_H) / 0.4)

    r, g, b = base_rgb
    if is_near_trim:
        r, g, b = TRIM

    return (
        max(0, min(255, int(r * brightness))),
        max(0, min(255, int(g * brightness))),
        max(0, min(255, int(b * brightness))),
    )


def generate():
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    print(f"Rendering {W}×{H} synthetic room panorama...")
    print(f"Room: {ROOM_W}m × {ROOM_H}m × {ROOM_D}m")

    img = Image.new('RGB', (W, H), (0, 0, 0))
    px_buf = img.load()

    for py in range(H):
        if py % 200 == 0:
            print(f"  Row {py}/{H} ({100 * py // H}%)")
        for px in range(W):
            dx, dy, dz = dir_from_equirect(px, py)
            hit = ray_hit(dx, dy, dz)
            if hit is None:
                continue
            name, hx, hy, hz, t = hit

            # Detect closeness to wall/floor/ceiling trim line
            is_trim = False
            if name.startswith('wall_'):
                # bottom baseboard
                if hy < -HALF_H + TRIM_HEIGHT_M:
                    is_trim = True
                # ceiling crown
                elif hy > HALF_H - TRIM_HEIGHT_M:
                    is_trim = True

            px_buf[px, py] = shade(COLORS[name], t, hy, is_trim)

    img.save(OUT_PATH, quality=92)
    print(f"\nSaved: {OUT_PATH}")


if __name__ == '__main__':
    generate()
