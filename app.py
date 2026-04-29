"""
FastAPI static host for MQTT arcade (Tetris + Pong) over the public Mosquitto test broker.

Render / local:
  uvicorn app:app --host 0.0.0.0 --port 8000 --http h11
  uvicorn app:app --host 0.0.0.0 --port $PORT --http h11
"""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INDEX_HTML = STATIC_DIR / "index.html"


def resolve_stick_animator_dir() -> Path | None:
    """
    Resolve Stick Animator source directory in priority order:
    1) STICK_ANIMATOR_DIR env var (best for deployed/served environments)
    2) repo-local ./stick-animator-pro
    3) existing local absolute path used during development
    """
    candidates: list[Path] = []

    env_dir = os.getenv("STICK_ANIMATOR_DIR", "").strip()
    if env_dir:
        candidates.append(Path(env_dir))

    candidates.append(BASE_DIR / "stick-animator-pro")
    candidates.append(STATIC_DIR / "stick-animator-pro")
    candidates.append(Path(r"C:\Users\ben\Downloads\stick-animator-pro\stick-animator-pro"))

    for c in candidates:
        if c.is_dir() and (c / "index.html").is_file():
            return c
    return None


app = FastAPI(title="MQTT Arcade", version="2.0.0")
STICK_ANIMATOR_DIR = resolve_stick_animator_dir()


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


if STICK_ANIMATOR_DIR:
    app.mount("/stick-animator-pro", StaticFiles(directory=str(STICK_ANIMATOR_DIR), html=True), name="stick-animator-pro")

app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
