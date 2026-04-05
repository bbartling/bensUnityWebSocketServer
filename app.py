"""
FastAPI static host for MQTT arcade (Tetris + Pong) over the public Mosquitto test broker.

Render / local:
  uvicorn app:app --host 0.0.0.0 --port 8000 --http h11
  uvicorn app:app --host 0.0.0.0 --port $PORT --http h11
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INDEX_HTML = STATIC_DIR / "index.html"


app = FastAPI(title="MQTT Arcade", version="2.0.0")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
async def root_dashboard():
    """Always serve the arcade dashboard HTML (avoids stale JSON or mount quirks on some hosts)."""
    return FileResponse(INDEX_HTML, media_type="text/html")


@app.get("/dashboard", include_in_schema=False)
async def redirect_dashboard():
    return RedirectResponse(url="/", status_code=307)


@app.get("/home", include_in_schema=False)
async def redirect_home():
    return RedirectResponse(url="/", status_code=307)


@app.get("/tetris/dad.html", include_in_schema=False)
async def legacy_tetris_dad():
    return RedirectResponse(url="/tetris/man.html", status_code=307)


@app.get("/tetris/adrien.html", include_in_schema=False)
async def legacy_tetris_adrien():
    return RedirectResponse(url="/tetris/boy.html", status_code=307)


@app.get("/pong/dad.html", include_in_schema=False)
async def legacy_pong_dad():
    return RedirectResponse(url="/pong/man.html", status_code=307)


@app.get("/pong/adrien.html", include_in_schema=False)
async def legacy_pong_adrien():
    return RedirectResponse(url="/pong/boy.html", status_code=307)


app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
