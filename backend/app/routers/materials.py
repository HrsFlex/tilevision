from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.config import TEXTURES_DIR
from app.models.schemas import MaterialInfo, MaterialListResponse

router = APIRouter()


def _mat_from_path(p: Path) -> MaterialInfo:
    name = p.stem.replace("_", " ").replace("-", " ").title()
    return MaterialInfo(
        id=p.stem,
        name=name,
        width_mm=300,
        height_mm=300,
        thumbnail_url=f"/static/textures/{p.name}",
        texture_url=f"/static/textures/{p.name}",
    )


@router.get("", response_model=MaterialListResponse)
async def list_materials():
    materials = []
    for p in sorted(TEXTURES_DIR.iterdir()):
        if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
            materials.append(_mat_from_path(p))
    return MaterialListResponse(materials=materials)


@router.post("/upload", response_model=MaterialInfo)
async def upload_material(file: UploadFile = File(...)):
    allowed = {"image/jpeg", "image/png", "image/webp"}
    if file.content_type not in allowed:
        raise HTTPException(400, f"Unsupported type: {file.content_type}. Use JPEG, PNG or WebP.")
    suffix_map = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
    suffix = suffix_map[file.content_type]
    stem = Path(file.filename or "tile").stem
    # sanitise filename
    safe_stem = "".join(c if c.isalnum() or c in "-_" else "_" for c in stem).strip("_") or "tile"
    dest = TEXTURES_DIR / f"{safe_stem}{suffix}"
    # avoid overwriting
    counter = 2
    while dest.exists():
        dest = TEXTURES_DIR / f"{safe_stem}_{counter}{suffix}"
        counter += 1
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    return _mat_from_path(dest)


@router.get("/{material_id}", response_model=MaterialInfo)
async def get_material(material_id: str):
    for p in TEXTURES_DIR.iterdir():
        if p.stem == material_id:
            return _mat_from_path(p)
    raise HTTPException(404, "Material not found")
