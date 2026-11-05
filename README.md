# Tiles Visualizer POC

A TilesView-like room visualization tool. Upload a room photo, detect surfaces (walls/floor/ceiling) with AI, then apply tile textures with perspective-correct rendering and shadow preservation.

## Quick Start

### Prerequisites
- Python 3.10+ 
- Node.js 18+
- pip and npm

### 1. Generate placeholder assets

```bash
pip install pillow
python generate_assets.py
```

### 2. Start the backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The backend starts in **mock mode** by default (rectangular masks instead of AI). This is fine for UI development and demo.

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**

### 4. (Optional) Enable real AI segmentation

```bash
# Install SAM 2.1
pip install git+https://github.com/facebookresearch/sam2.git

# Download the model (~150MB)
cd backend
python setup_models.py
```

Then restart the backend. It will automatically detect and load SAM.

## Usage

1. Upload a room photo or select a demo room
2. **Click** on surfaces (walls, floor, ceiling) to detect them with AI
3. Switch to the **Tiles** tab and click a tile texture to apply it
4. Adjust **Settings**: tile size, grout width/color, rotation, layout pattern
5. Use **Cost** tab to estimate material requirements
6. Use **Compare** tab for before/after slider view
7. Click **Export** to download the visualized image

## Architecture

```
├── backend/          Python FastAPI
│   ├── app/
│   │   ├── main.py           # App entry + CORS + lifespan
│   │   ├── config.py         # Settings
│   │   ├── routers/          # API endpoints
│   │   │   ├── rooms.py      # Upload, list, serve rooms
│   │   │   ├── segments.py   # SAM detection, lightmaps
│   │   │   ├── materials.py  # Tile texture catalog
│   │   │   └── estimate.py   # Cost calculation
│   │   ├── services/
│   │   │   ├── sam_service.py # SAM 2.1 wrapper (with mock fallback)
│   │   │   └── lighting.py   # Shadow/lightmap extraction
│   │   └── models/
│   │       └── schemas.py    # Pydantic models
│   └── requirements.txt
│
├── frontend/         React + Vite + TypeScript + Tailwind
│   └── src/
│       ├── App.tsx               # Main layout + state management
│       ├── components/
│       │   ├── RoomViewer.tsx    # Canvas viewer with zoom/pan
│       │   ├── SurfaceOverlay.tsx # Surface list + selection
│       │   ├── MaterialBrowser.tsx # Tile catalog grid
│       │   ├── TileControls.tsx  # Size, grout, rotation, layout
│       │   ├── CostEstimator.tsx # Cost calculation UI
│       │   └── CompareView.tsx   # Before/after slider
│       ├── lib/
│       │   ├── textureMapper.ts  # Homography + perspective warp
│       │   ├── canvasUtils.ts    # Compositing helpers
│       └── hooks/
│           ├── useApi.ts         # Backend API client
│           └── useRoomCanvas.ts  # Canvas zoom/pan state
│
├── assets/
│   ├── rooms/        Sample room images
│   └── textures/     Tile texture library
│
├── generate_assets.py   # Creates placeholder tiles + demo rooms
└── docker-compose.yml   # Docker setup (optional)
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/rooms/upload` | Upload a room image |
| GET | `/api/rooms` | List all rooms |
| GET | `/api/rooms/{id}` | Get room info |
| POST | `/api/segments/detect` | Detect surface (SAM) |
| GET | `/api/segments/mask/{id}` | Get mask image |
| POST | `/api/segments/lightmap` | Get shadow/light map |
| GET | `/api/materials` | List tile textures |
| POST | `/api/estimate/cost` | Calculate cost |
| GET | `/api/health` | Health check |

## Key Technical Decisions

- **Canvas 2D + homography** for texture projection (no Three.js dependency)
- **SAM 2.1 hiera-tiny** for segmentation (38.9M params, works on CPU)
- **Luminance multiplication** for shadow preservation
- **Mock mode** fallback when SAM is not installed
- **Vite proxy** for seamless frontend→backend API calls during development
