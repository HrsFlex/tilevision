"""
Generate an equirectangular room panorama and per-surface masks.

Output:
  assets/panorama/room_panorama.jpg   – 4096×2048 equirectangular room image
  assets/panorama/mask_floor.png      – floor mask
  assets/panorama/mask_ceiling.png    – ceiling mask
  assets/panorama/mask_wall_N.png     – (north/south/east/west) wall masks

Each mask is a grayscale image: white = surface, black = not.
"""

import math
import os
import random

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    print("Pillow not installed. Run: pip install pillow")
    exit(1)

# Output size
W, H = 4096, 2048

# Room dimensions (meters) – viewer at center
ROOM_W = 6.0   # x-axis (left/right)
ROOM_H = 3.0   # y-axis (up/down)
ROOM_D = 5.0   # z-axis (front/back)

HALF_W = ROOM_W / 2
HALF_H = ROOM_H / 2
HALF_D = ROOM_D / 2

# Colors (R, G, B)
FLOOR_COLOR = (160, 135, 110)       # warm wood
FLOOR_COLOR2 = (145, 120, 98)       # wood variation
CEILING_COLOR = (245, 243, 240)     # off-white
WALL_COLOR = (215, 208, 198)        # light beige
WALL_COLOR_ALT = (210, 200, 188)    # slight variation for depth
BASEBOARD_COLOR = (180, 175, 168)   # baseboard strip
WINDOW_COLOR = (200, 220, 240)      # sky blue through window
WINDOW_BRIGHT = (240, 248, 255)     # bright window light

SURFACE_NAMES = ['floor', 'ceiling', 'wall_north', 'wall_south', 'wall_east', 'wall_west']

OUT_DIR = os.path.join(os.path.dirname(__file__), 'assets', 'panorama')


def direction_from_equirect(px: int, py: int):
    """Convert equirectangular pixel to 3D direction vector."""
    theta = (px / W) * 2 * math.pi       # longitude 0..2π
    phi = (py / H) * math.pi             # latitude 0..π  (top=0, bottom=π)

    # Spherical to cartesian (Y-up)
    dx = math.sin(phi) * math.sin(theta)
    dy = math.cos(phi)                    # +Y = up at phi=0
    dz = math.sin(phi) * math.cos(theta)

    return dx, dy, dz


def ray_hit_room(dx, dy, dz):
    """
    Ray from origin in direction (dx,dy,dz) – find which room surface it hits.
    Returns (surface_name, u, v, distance) where u,v ∈ [0,1] are surface coords.
    """
    best_t = float('inf')
    best = None

    # Floor: y = -HALF_H
    if dy < -1e-9:
        t = -HALF_H / dy
        hx = dx * t
        hz = dz * t
        if abs(hx) <= HALF_W and abs(hz) <= HALF_D and t < best_t:
            u = (hx + HALF_W) / ROOM_W
            v = (hz + HALF_D) / ROOM_D
            best_t = t
            best = ('floor', u, v, t)

    # Ceiling: y = +HALF_H
    if dy > 1e-9:
        t = HALF_H / dy
        hx = dx * t
        hz = dz * t
        if abs(hx) <= HALF_W and abs(hz) <= HALF_D and t < best_t:
            u = (hx + HALF_W) / ROOM_W
            v = (hz + HALF_D) / ROOM_D
            best_t = t
            best = ('ceiling', u, v, t)

    # Wall North: z = -HALF_D (back wall)
    if dz < -1e-9:
        t = -HALF_D / dz
        hx = dx * t
        hy = dy * t
        if abs(hx) <= HALF_W and abs(hy) <= HALF_H and t < best_t:
            u = (hx + HALF_W) / ROOM_W
            v = (hy + HALF_H) / ROOM_H
            best_t = t
            best = ('wall_north', u, v, t)

    # Wall South: z = +HALF_D (front wall)
    if dz > 1e-9:
        t = HALF_D / dz
        hx = dx * t
        hy = dy * t
        if abs(hx) <= HALF_W and abs(hy) <= HALF_H and t < best_t:
            u = 1.0 - (hx + HALF_W) / ROOM_W
            v = (hy + HALF_H) / ROOM_H
            best_t = t
            best = ('wall_south', u, v, t)

    # Wall East: x = +HALF_W (right wall)
    if dx > 1e-9:
        t = HALF_W / dx
        hz = dz * t
        hy = dy * t
        if abs(hz) <= HALF_D and abs(hy) <= HALF_H and t < best_t:
            u = 1.0 - (hz + HALF_D) / ROOM_D
            v = (hy + HALF_H) / ROOM_H
            best_t = t
            best = ('wall_east', u, v, t)

    # Wall West: x = -HALF_W (left wall)
    if dx < -1e-9:
        t = -HALF_W / dx
        hz = dz * t
        hy = dy * t
        if abs(hz) <= HALF_D and abs(hy) <= HALF_H and t < best_t:
            u = (hz + HALF_D) / ROOM_D
            v = (hy + HALF_H) / ROOM_H
            best_t = t
            best = ('wall_west', u, v, t)

    return best


def add_noise(base_color, amount=8):
    """Add subtle random noise to a color."""
    return tuple(max(0, min(255, c + random.randint(-amount, amount))) for c in base_color)


def surface_color(name, u, v, dist):
    """Determine pixel color for a surface at UV coordinates."""

    # Ambient occlusion: darken near edges
    edge_factor = 1.0
    edge_u = min(u, 1.0 - u) * 4  # 0 at edge, 1+ in middle
    edge_v = min(v, 1.0 - v) * 4
    edge_min = min(edge_u, edge_v)
    if edge_min < 1.0:
        edge_factor = 0.85 + 0.15 * edge_min

    # Distance attenuation (subtle)
    dist_factor = max(0.75, 1.0 - dist * 0.02)

    factor = edge_factor * dist_factor

    if name == 'floor':
        # Wood plank pattern
        plank_width = 0.08  # fraction of floor width
        plank_idx = int(u / plank_width)
        plank_frac = (u % plank_width) / plank_width
        # Grout line between planks
        if plank_frac < 0.02 or plank_frac > 0.98:
            base = (120, 100, 80)
        else:
            base = FLOOR_COLOR if plank_idx % 2 == 0 else FLOOR_COLOR2
            # Subtle grain along v
            grain = math.sin(v * 80 + plank_idx * 17) * 8
            base = tuple(int(c + grain) for c in base)
        r, g, b = add_noise(base, 5)

    elif name == 'ceiling':
        base = CEILING_COLOR
        # Subtle light fixture glow in center
        cx, cy = abs(u - 0.5), abs(v - 0.5)
        if cx < 0.05 and cy < 0.05:
            glow = max(0, 1.0 - math.sqrt(cx**2 + cy**2) / 0.05)
            base = tuple(min(255, int(c + glow * 30)) for c in base)
        r, g, b = add_noise(base, 3)

    elif name == 'wall_north':
        # Back wall – add a window
        base = WALL_COLOR
        # Window: centered, upper portion
        if 0.3 < u < 0.7 and 0.35 < v < 0.85:
            # Window frame
            fu = (u - 0.3) / 0.4
            fv = (v - 0.35) / 0.5
            if fu < 0.02 or fu > 0.98 or fv < 0.02 or fv > 0.98:
                base = (80, 75, 70)  # dark frame
            elif abs(fu - 0.5) < 0.01 or abs(fv - 0.5) < 0.015:
                base = (80, 75, 70)  # mullion
            else:
                # Sky gradient through window
                sky_t = fv
                base = (
                    int(WINDOW_COLOR[0] + (WINDOW_BRIGHT[0] - WINDOW_COLOR[0]) * sky_t),
                    int(WINDOW_COLOR[1] + (WINDOW_BRIGHT[1] - WINDOW_COLOR[1]) * sky_t),
                    int(WINDOW_COLOR[2] + (WINDOW_BRIGHT[2] - WINDOW_COLOR[2]) * sky_t),
                )
                factor = 1.0  # no AO on window
        # Baseboard
        if v < 0.08:
            base = BASEBOARD_COLOR
        r, g, b = add_noise(base, 4)

    elif name == 'wall_south':
        base = WALL_COLOR_ALT
        # Door on this wall
        if 0.35 < u < 0.65 and v < 0.88:
            du = (u - 0.35) / 0.3
            if du < 0.03 or du > 0.97:
                base = (90, 80, 70)  # door frame
            elif v < 0.03:
                base = (90, 80, 70)  # threshold
            else:
                base = (140, 115, 90)  # door panel
                # Door handle
                if 0.85 < du < 0.92 and 0.45 < v < 0.52:
                    base = (180, 175, 160)  # handle
        if v < 0.08:
            base = BASEBOARD_COLOR
        r, g, b = add_noise(base, 4)

    elif name == 'wall_east':
        base = WALL_COLOR
        # Picture frame
        if 0.35 < u < 0.65 and 0.4 < v < 0.75:
            pu = (u - 0.35) / 0.3
            pv = (v - 0.4) / 0.35
            if pu < 0.03 or pu > 0.97 or pv < 0.04 or pv > 0.96:
                base = (100, 90, 75)  # frame
            else:
                # Art: warm abstract gradient
                base = (
                    int(180 + 40 * math.sin(pu * 3)),
                    int(160 + 30 * math.cos(pv * 2.5)),
                    int(140 + 20 * math.sin(pu * 2 + pv * 3)),
                )
        if v < 0.08:
            base = BASEBOARD_COLOR
        r, g, b = add_noise(base, 4)

    elif name == 'wall_west':
        base = WALL_COLOR_ALT
        # Bookshelf
        if 0.15 < u < 0.85 and 0.05 < v < 0.78:
            su = (u - 0.15) / 0.7
            sv = (v - 0.05) / 0.73
            shelf_count = 4
            shelf_v = sv * shelf_count
            shelf_frac = shelf_v % 1.0
            if shelf_frac < 0.06 or shelf_frac > 0.94:
                base = (110, 90, 70)  # shelf board
            else:
                # Books
                book_idx = int(su * 20)
                book_frac = (su * 20) % 1.0
                if book_frac < 0.05:
                    base = (110, 90, 70)  # gap between books
                else:
                    random.seed(book_idx * 100 + int(shelf_v))
                    base = (
                        random.randint(80, 200),
                        random.randint(60, 180),
                        random.randint(60, 180),
                    )
        elif v < 0.08:
            base = BASEBOARD_COLOR
        r, g, b = add_noise(base, 4)
    else:
        r, g, b = 128, 128, 128

    r = max(0, min(255, int(r * factor)))
    g = max(0, min(255, int(g * factor)))
    b = max(0, min(255, int(b * factor)))
    return r, g, b


def is_wall_surface(name, u, v):
    """Return True if (u,v) on this wall is actual tileable wall surface (not an object)."""
    if name == 'wall_north':
        # Window: centered, upper portion
        if 0.3 < u < 0.7 and 0.35 < v < 0.85:
            return False
        # Baseboard
        if v < 0.08:
            return False
    elif name == 'wall_south':
        # Door
        if 0.35 < u < 0.65 and v < 0.88:
            return False
        # Baseboard
        if v < 0.08:
            return False
    elif name == 'wall_east':
        # Picture frame
        if 0.35 < u < 0.65 and 0.4 < v < 0.75:
            return False
        # Baseboard
        if v < 0.08:
            return False
    elif name == 'wall_west':
        # Bookshelf
        if 0.15 < u < 0.85 and 0.05 < v < 0.78:
            return False
        # Baseboard
        if v < 0.08:
            return False
    return True


def generate():
    os.makedirs(OUT_DIR, exist_ok=True)

    print(f"Generating {W}×{H} equirectangular room panorama...")

    # Panorama image
    pano = Image.new('RGB', (W, H), (0, 0, 0))
    pano_pixels = pano.load()

    # Mask images (one per surface)
    masks = {}
    mask_pixels = {}
    for name in SURFACE_NAMES:
        m = Image.new('L', (W, H), 0)
        masks[name] = m
        mask_pixels[name] = m.load()

    for py in range(H):
        if py % 200 == 0:
            print(f"  Row {py}/{H} ({100*py//H}%)")
        for px in range(W):
            dx, dy, dz = direction_from_equirect(px, py)
            hit = ray_hit_room(dx, dy, dz)

            if hit is None:
                pano_pixels[px, py] = (20, 20, 25)
                continue

            name, u, v, dist = hit
            r, g, b = surface_color(name, u, v, dist)
            pano_pixels[px, py] = (r, g, b)
            # Only mark mask white for actual surface (exclude objects on walls)
            if name in ('floor', 'ceiling') or is_wall_surface(name, u, v):
                mask_pixels[name][px, py] = 255

    # Light bloom: subtle glow from window area
    # (skip for speed — the base rendering is sufficient for POC)

    # Apply slight blur for anti-aliasing
    pano = pano.filter(ImageFilter.SMOOTH)

    # Save panorama
    pano_path = os.path.join(OUT_DIR, 'room_panorama.jpg')
    pano.save(pano_path, quality=95)
    print(f"  Saved: {pano_path}")

    # Save masks
    for name in SURFACE_NAMES:
        # Slight blur on masks for smooth edges
        mask = masks[name].filter(ImageFilter.SMOOTH)
        mask_path = os.path.join(OUT_DIR, f'mask_{name}.png')
        mask.save(mask_path)
        print(f"  Saved: {mask_path}")

    print("\nDone! Panorama assets in:", OUT_DIR)


if __name__ == '__main__':
    generate()
