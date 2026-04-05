"""
FastAPI static host for MQTT arcade (Tetris + Pong) over the public Mosquitto test broker.

Render / local:
  uvicorn app:app --host 0.0.0.0 --port 8000 --http h11
  uvicorn app:app --host 0.0.0.0 --port $PORT --http h11
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="MQTT Arcade", version="2.0.0")


@app.get("/health")
async def health():
    return {"status": "ok"}


app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
