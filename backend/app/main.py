from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import ROOMS_DIR, TEXTURES_DIR, PANORAMA_DIR
from app.routers import rooms, segments, materials, estimate, panorama, ai
from app.services.sam_service import sam_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load SAM model once at startup
    sam_service.load_model()
    yield


app = FastAPI(title="Tiles Visualizer API", version="0.1.0", lifespan=lifespan)

import os as _os

_default_origins = "http://localhost:5173,http://localhost:5175,http://127.0.0.1:5173,http://127.0.0.1:5175"
_allowed_origins = [o.strip() for o in _os.environ.get("ALLOWED_ORIGINS", _default_origins).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploaded rooms and textures as static files
app.mount("/static/rooms", StaticFiles(directory=str(ROOMS_DIR)), name="rooms")
app.mount("/static/textures", StaticFiles(directory=str(TEXTURES_DIR)), name="textures")
app.mount("/static/panorama", StaticFiles(directory=str(PANORAMA_DIR)), name="panorama")

# Register routers
app.include_router(rooms.router, prefix="/api/rooms", tags=["rooms"])
app.include_router(segments.router, prefix="/api/segments", tags=["segments"])
app.include_router(materials.router, prefix="/api/materials", tags=["materials"])
app.include_router(estimate.router, prefix="/api/estimate", tags=["estimate"])
app.include_router(panorama.router, prefix="/api/panorama", tags=["panorama"])
app.include_router(ai.router, prefix="/api/ai", tags=["ai"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "sam_loaded": sam_service.is_loaded()}
