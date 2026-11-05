FROM python:3.11-slim

WORKDIR /app

# System libs needed by opencv-headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libglib2.0-0 libsm6 libxext6 libxrender-dev libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps (prod-only, no torch/scipy)
COPY backend/requirements-prod.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ /app/

# Bundle pre-built panorama demo rooms into image
COPY assets/ /app/assets/

# Ensure writable upload dirs exist
RUN mkdir -p /app/assets/rooms /app/assets/textures

ENV ASSETS_DIR=/app/assets
ENV PORT=8000

EXPOSE 8000

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
