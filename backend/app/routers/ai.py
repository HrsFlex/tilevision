from __future__ import annotations

import base64
import io
import json
import os
import uuid
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from PIL import Image, ImageDraw
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

from app.config import ROOMS_DIR, TEXTURES_DIR

router = APIRouter()


def _get_client():
    from openai import OpenAI
    key = os.getenv("OPENAI_API_KEY", "")
    if not key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")
    return OpenAI(api_key=key)


def _load_room_b64(room_id: str) -> tuple[str, int, int]:
    """Return (base64_jpeg_string, width, height)."""
    for p in ROOMS_DIR.iterdir():
        if p.stem == room_id and "_mask_" not in p.stem and "_rendered" not in p.stem:
            img = Image.open(p).convert("RGB")
            # Resize for API — keep under 1024px on longest side
            w, h = img.size
            if max(w, h) > 1024:
                scale = 1024 / max(w, h)
                img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            b64 = base64.b64encode(buf.getvalue()).decode()
            return b64, img.size[0], img.size[1]
    raise HTTPException(status_code=404, detail=f"Room not found: {room_id}")


def _load_room_path(room_id: str) -> Path:
    for p in ROOMS_DIR.iterdir():
        if p.stem == room_id and "_mask_" not in p.stem and "_rendered" not in p.stem:
            return p
    raise HTTPException(status_code=404, detail=f"Room not found: {room_id}")


ANALYZE_SYSTEM_PROMPT = """You are an expert room surface analysis system for a tile visualization tool used in tile shops.
Analyze the room image and identify all visible tileable surfaces: floor, walls, ceiling.

CRITICAL RULES FOR POLYGON TRACING:
1. Polygons must ONLY cover the actual surface (tiles go on the surface itself).
2. EXCLUDE any object footprints from polygons:
   - Floor polygon: exclude areas blocked by sofas, tables, chairs, beds, cabinets, rugs, etc. Trace around furniture legs/bases.
   - Wall polygons: exclude windows, doors, picture frames, shelving units, TVs mounted on wall. Only the bare wall surface.
   - Ceiling: exclude light fixtures, fans, beams.
3. Use 6-12 polygon points to accurately trace irregular shapes caused by furniture occlusion.
4. For perspective accuracy: walls typically converge toward vanishing points — trace the actual visible wall plane.
5. Floor is usually the bottom portion. For perspective views, floor polygon has a trapezoidal or complex shape.

Return ONLY valid JSON in this exact format:
{
  "surfaces": [
    {
      "name": "floor",
      "label": "Floor",
      "type": "floor",
      "polygon": [[0.05, 0.75], [0.35, 0.65], [0.65, 0.65], [0.95, 0.75], [1.0, 1.0], [0.0, 1.0]]
    },
    {
      "name": "wall_back",
      "label": "Back Wall",
      "type": "wall",
      "polygon": [[0.1, 0.1], [0.9, 0.1], [0.9, 0.65], [0.1, 0.65]]
    }
  ],
  "description": "A bright living room with marble floors and cream walls, sofa in center",
  "style": "modern",
  "tips": ["Large format tiles would suit this open floor space", "Use light grout to maintain the airy feel"]
}

Coordinate rules:
- Points are [x, y] normalized: x=0 left, x=1 right, y=0 top, y=1 bottom
- List polygon points in clockwise order
- Each surface needs at least 4 points, complex occlusion shapes need 6-12 points
- Surface types: "floor", "wall", "ceiling"
- Include all visible tileable surfaces

Return ONLY the JSON object, no markdown, no explanation."""

SUGGEST_SYSTEM_PROMPT = """You are a tile design consultant for a tile shop. Analyze the room photo and suggest 4-5 specific tile styles that would look great in this room.

Return ONLY valid JSON:
{
  "suggestions": [
    {
      "style": "Large format marble",
      "description": "60x60cm polished marble tiles in Carrara white",
      "reason": "Would complement the room's natural light and modern aesthetic",
      "grout": "Light grey",
      "layout": "grid"
    }
  ],
  "room_style": "modern minimalist",
  "color_palette": ["white", "beige", "warm grey"]
}

Return ONLY the JSON object, no markdown, no explanation."""


class AnalyzeRequest(BaseModel):
    room_id: str
    force: bool = False


class SuggestRequest(BaseModel):
    room_id: str
    style: str = "any"


class RenderRequest(BaseModel):
    room_id: str
    tile_id: str
    surface_name: str
    polygon: list[list[float]]


@router.post("/analyze")
async def analyze_room(req: AnalyzeRequest):
    # Check cache (skip if force=True)
    cache_path = ROOMS_DIR / f"{req.room_id}_analysis.json"
    if not req.force and cache_path.exists():
        try:
            return json.loads(cache_path.read_text())
        except Exception:
            pass

    b64, _w, _h = _load_room_b64(req.room_id)
    client = _get_client()

    response = client.chat.completions.create(
        model="gpt-4o",
        max_tokens=1500,
        messages=[
            {"role": "system", "content": ANALYZE_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                    },
                    {"type": "text", "text": "Analyze this room and return the surface polygons as JSON."},
                ],
            },
        ],
    )

    raw = response.choices[0].message.content or "{}"
    # Strip markdown fences if present
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail=f"GPT-4o returned invalid JSON: {raw[:200]}")

    # Cache result
    cache_path.write_text(json.dumps(result, indent=2))
    return result


@router.post("/suggest")
async def suggest_tiles(req: SuggestRequest):
    b64, _w, _h = _load_room_b64(req.room_id)
    client = _get_client()

    user_text = "Suggest tile styles for this room."
    if req.style and req.style != "any":
        user_text += f" The customer prefers a {req.style} style."

    response = client.chat.completions.create(
        model="gpt-4o",
        max_tokens=1000,
        messages=[
            {"role": "system", "content": SUGGEST_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                    },
                    {"type": "text", "text": user_text},
                ],
            },
        ],
    )

    raw = response.choices[0].message.content or "{}"
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail=f"GPT-4o returned invalid JSON: {raw[:200]}")


@router.post("/render")
async def render_tiles(req: RenderRequest):
    client = _get_client()

    # Load original room image
    room_path = _load_room_path(req.room_id)
    room_img = Image.open(room_path).convert("RGB")
    orig_w, orig_h = room_img.size

    # Resize for API — gpt-image-1 accepts up to 1024x1024
    max_dim = 1024
    scale = min(max_dim / orig_w, max_dim / orig_h, 1.0)
    api_w = int(orig_w * scale)
    api_h = int(orig_h * scale)
    room_resized = room_img.resize((api_w, api_h), Image.LANCZOS)

    # Convert room to PNG bytes (gpt-image-1 needs PNG for editing)
    room_buf = io.BytesIO()
    room_resized.save(room_buf, format="PNG")
    room_buf.seek(0)
    room_png_bytes = room_buf.read()

    # Create mask: white everywhere, transparent (alpha=0) in polygon area
    mask = Image.new("RGBA", (api_w, api_h), (255, 255, 255, 255))
    draw = ImageDraw.Draw(mask)
    # Scale polygon points to api dimensions
    pts = [(int(x * api_w), int(y * api_h)) for x, y in req.polygon]
    if len(pts) >= 3:
        draw.polygon(pts, fill=(0, 0, 0, 0))

    mask_buf = io.BytesIO()
    mask.save(mask_buf, format="PNG")
    mask_buf.seek(0)
    mask_png_bytes = mask_buf.read()

    # Get tile name for the prompt
    tile_name = req.tile_id.replace("_", " ").replace("-", " ").title()
    for p in TEXTURES_DIR.iterdir():
        if p.stem == req.tile_id:
            tile_name = p.stem.replace("_", " ").replace("-", " ").title()
            break

    prompt = (
        f"Replace the {req.surface_name} area with realistic {tile_name} tiles. "
        "Maintain exact room perspective, lighting, shadows, and all existing furniture and objects. "
        "The tiles should look photo-realistic and naturally integrated into the room."
    )

    try:
        response = client.images.edit(
            model="gpt-image-1",
            image=("room.png", room_png_bytes, "image/png"),
            mask=("mask.png", mask_png_bytes, "image/png"),
            prompt=prompt,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAI image edit failed: {e}")

    # Decode base64 response
    b64_data = response.data[0].b64_json
    if not b64_data:
        raise HTTPException(status_code=502, detail="No image data returned from OpenAI")

    img_bytes = base64.b64decode(b64_data)
    out_name = f"{req.room_id}_rendered_{uuid.uuid4().hex[:8]}.png"
    out_path = ROOMS_DIR / out_name
    out_path.write_bytes(img_bytes)

    return {"rendered_url": f"/static/rooms/{out_name}"}
