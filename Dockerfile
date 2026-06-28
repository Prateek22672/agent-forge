# ============================================================
#  AgentFury — single-image deployment.
#  Stage 1 builds the React frontend; stage 2 runs the FastAPI
#  backend which ALSO serves that built frontend. One container,
#  one port (8000), everything inside.
# ============================================================

# ---- Stage 1: build the frontend ----
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build          # -> /app/frontend/dist

# ---- Stage 2: backend runtime ----
FROM python:3.11-slim AS runtime
WORKDIR /app/backend

# System deps occasionally needed by native wheels (onnxruntime for Chroma).
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
# Bring in the built frontend and tell the app where it is.
COPY --from=frontend /app/frontend/dist /app/frontend/dist
ENV FRONTEND_DIST=/app/frontend/dist
ENV PYTHONUNBUFFERED=1

# Persist SQLite + Chroma + keychain-fallback across restarts via a volume.
VOLUME ["/app/backend/data"]

EXPOSE 8000
# Shell form so $PORT (set by Render) is honoured; falls back to 8000 locally.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
