from __future__ import annotations

import uuid
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, UploadFile, HTTPException
from fastapi.responses import JSONResponse

from app.config import ROOMS_DIR, MAX_IMAGE_DIMENSION, ALLOWED_IMAGE_TYPES
from app.models.schemas import RoomInfo, RoomListResponse

router = APIRouter()


@router.post("/upload", response_model=RoomInfo)
async def upload_room(file: UploadFile):
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, f"Unsupported image type: {file.content_type}")

    data = await file.read()
    if len(data) > 20 * 1024 * 1024:  # 20MB limit
        raise HTTPException(400, "Image too large (max 20MB)")

    # Decode image
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Could not decode image")

    # Resize if too large
    h, w = img.shape[:2]
    if max(h, w) > MAX_IMAGE_DIMENSION:
        scale = MAX_IMAGE_DIMENSION / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        h, w = img.shape[:2]

    # Save
    room_id = uuid.uuid4().hex[:12]
    ext = Path(file.filename or "room.jpg").suffix or ".jpg"
    filename = f"{room_id}{ext}"
    filepath = ROOMS_DIR / filename
    cv2.imwrite(str(filepath), img)

    return RoomInfo(id=room_id, filename=filename, width=w, height=h)


@router.get("", response_model=RoomListResponse)
async def list_rooms():
    rooms = []
    for p in sorted(ROOMS_DIR.iterdir()):
        if p.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue
        if "_mask_" in p.stem:  # skip surface mask files
            continue
        img = cv2.imread(str(p))
        if img is not None:
            h, w = img.shape[:2]
            room_id = p.stem
            rooms.append(RoomInfo(id=room_id, filename=p.name, width=w, height=h))
    return RoomListResponse(rooms=rooms)


@router.get("/{room_id}")
async def get_room_info(room_id: str):
    for p in ROOMS_DIR.iterdir():
        if p.stem == room_id:
            img = cv2.imread(str(p))
            if img is not None:
                h, w = img.shape[:2]
                return RoomInfo(id=room_id, filename=p.name, width=w, height=h)
    raise HTTPException(404, "Room not found")
