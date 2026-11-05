"""
Generate placeholder tile texture images for the POC.
Run: python generate_assets.py
"""

from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("Pillow not installed. Run: pip install pillow")
    raise SystemExit(1)

TEXTURES_DIR = Path(__file__).parent / "assets" / "textures"
ROOMS_DIR = Path(__file__).parent / "assets" / "rooms"
TEXTURES_DIR.mkdir(parents=True, exist_ok=True)
ROOMS_DIR.mkdir(parents=True, exist_ok=True)


def make_tile(
    name: str,
    tile_color: tuple[int, int, int],
    grout_color: tuple[int, int, int] = (200, 200, 200),
    size: int = 512,
    tile_w: int = 240,
    tile_h: int = 240,
    grout: int = 8,
):
    """Generate a simple seamless tile texture."""
    img = Image.new("RGB", (size, size), grout_color)
    draw = ImageDraw.Draw(img)

    # Slight color variation for realism
    import random
    random.seed(hash(name))

    y = 0
    row = 0
    while y < size + tile_h:
        x = 0
        offset = (tile_w // 2) * (row % 2)  # brick offset
        x = -offset
        while x < size + tile_w:
            # Vary color slightly
            r = max(0, min(255, tile_color[0] + random.randint(-15, 15)))
            g = max(0, min(255, tile_color[1] + random.randint(-15, 15)))
            b = max(0, min(255, tile_color[2] + random.randint(-15, 15)))
            draw.rectangle(
                [x + grout, y + grout, x + tile_w - grout, y + tile_h - grout],
                fill=(r, g, b),
            )
            x += tile_w
        y += tile_h
        row += 1

    filepath = TEXTURES_DIR / f"{name}.jpg"
    img.save(filepath, quality=90)
    print(f"  Created: {filepath}")


def make_solid_tile(name: str, color: tuple[int, int, int], size: int = 512):
    """Generate a solid colored tile with subtle noise."""
    import random
    random.seed(hash(name))
    img = Image.new("RGB", (size, size), color)
    pixels = img.load()
    for y in range(size):
        for x in range(size):
            r, g, b = pixels[x, y]
            noise = random.randint(-8, 8)
            pixels[x, y] = (
                max(0, min(255, r + noise)),
                max(0, min(255, g + noise)),
                max(0, min(255, b + noise)),
            )
    filepath = TEXTURES_DIR / f"{name}.jpg"
    img.save(filepath, quality=90)
    print(f"  Created: {filepath}")


def make_demo_room(name: str, size: tuple[int, int] = (1200, 800)):
    """Generate a simple demo room image with floor, walls, and ceiling areas."""
    img = Image.new("RGB", size, (240, 235, 228))
    draw = ImageDraw.Draw(img)
    w, h = size

    # Ceiling
    draw.polygon([(0, 0), (w, 0), (int(w * 0.8), int(h * 0.25)), (int(w * 0.2), int(h * 0.25))], fill=(250, 248, 245))

    # Left wall
    draw.polygon([(0, 0), (int(w * 0.2), int(h * 0.25)), (int(w * 0.2), int(h * 0.75)), (0, h)], fill=(235, 230, 220))

    # Right wall
    draw.polygon([(w, 0), (int(w * 0.8), int(h * 0.25)), (int(w * 0.8), int(h * 0.75)), (w, h)], fill=(225, 220, 210))

    # Back wall
    draw.rectangle([int(w * 0.2), int(h * 0.25), int(w * 0.8), int(h * 0.75)], fill=(230, 225, 218))

    # Floor
    draw.polygon([(0, h), (int(w * 0.2), int(h * 0.75)), (int(w * 0.8), int(h * 0.75)), (w, h)], fill=(200, 190, 175))

    # Add some shadow gradients
    for i in range(20):
        alpha = int(255 * (1 - i / 20) * 0.1)
        y_pos = int(h * 0.75) + i * 2
        if y_pos < h:
            draw.line([(int(w * 0.2), y_pos), (int(w * 0.8), y_pos)], fill=(180, 170, 155), width=1)

    filepath = ROOMS_DIR / f"{name}.jpg"
    img.save(filepath, quality=92)
    print(f"  Created: {filepath}")


def main():
    print("Generating placeholder tile textures...")
    make_tile("white_marble", (235, 230, 225), grout_color=(210, 210, 210))
    make_tile("beige_ceramic", (215, 200, 175), grout_color=(190, 185, 175))
    make_tile("gray_stone", (160, 160, 165), grout_color=(130, 130, 130))
    make_tile("terracotta", (195, 120, 80), grout_color=(170, 160, 150))
    make_tile("dark_slate", (70, 75, 80), grout_color=(50, 50, 50))
    make_tile("blue_mosaic", (60, 120, 180), grout_color=(220, 220, 220), tile_w=120, tile_h=120)
    make_tile("green_subway", (120, 160, 130), grout_color=(230, 230, 225), tile_w=240, tile_h=120)
    make_tile("cream_large", (240, 230, 210), grout_color=(200, 195, 185), tile_w=480, tile_h=480, grout=12)
    make_solid_tile("pure_white", (245, 245, 245))
    make_solid_tile("warm_wood", (165, 120, 80))
    make_solid_tile("charcoal", (55, 55, 60))
    make_solid_tile("sand", (220, 205, 175))

    print("\nGenerating demo room images...")
    make_demo_room("demo_room_1")
    make_demo_room("demo_room_2", size=(1400, 900))
    make_demo_room("demo_room_3", size=(1000, 700))

    print("\nDone! Assets are in:")
    print(f"  Textures: {TEXTURES_DIR.resolve()}")
    print(f"  Rooms: {ROOMS_DIR.resolve()}")


if __name__ == "__main__":
    main()
