# bensUnityWebSocketServer

FastAPI app that serves a small **MQTT Arcade** dashboard plus static HTML clients for **co-op Tetris** and **two-seat Pong**. Games use the browser MQTT.js client against the public **Eclipse Mosquitto test broker** (`wss://test.mosquitto.org:8081`). There is **no Unity** and **no Python WebSocket game relay** anymore.

## Seats

| Game   | Man | Boy |
|--------|-----|-----|
| Tetris | `/tetris/man.html` (spawn right) | `/tetris/boy.html` (spawn left) |
| Pong   | `/pong/man.html` (host, left paddle) | `/pong/boy.html` (right paddle) |
| Emoji Lobber | `/lobber/game.html` (single-player) | — |

**Emoji Lobber** — Single-player Angry Birds–style pull & release, spinning projectile, destructible **wood** / **stone** + **villain emoji** targets, **lava** (shot ends on touch), **pyramid** layouts on harder stages, per-hero powers (human-face picker). **15 levels** (Easy → Impossible); pick any stage before locking in. No MQTT or network. Optional **`?debug=1`** for verbose console logs.

## Emoji Lobber Single-URL Note (Coolmath prep)

- Canonical Lobber URL is **only** `/lobber/game.html`.
- Lobber `man.html` and `boy.html` files/references are intentionally removed for single-player packaging.
- Keep `/lobber/index.html` as the landing/info page and `/lobber/game.html` as the playable build.
- Builder mode keeps every stamp as an individual grid tile (Mario Maker style).
- Play test compiles touching same-kind tiles into merged collision pieces only for that play session.
- Stopping play test restores the original unmerged edit layout, and JSON export saves the unmerged tiles.
- The level editor uses a **no-build** zone for the bottom-left corner plus a padded pocket around the slingshot so parts cannot sit on the launcher; Play test requires at least one villain and will show a browser alert if you try without one.
- Beams (solid bouncy rails) are **indestructible** in play; wood, stone, and villains take damage from shots.
- When preparing the Coolmath package, include the Lobber runtime files under `static/lobber/` (`game.html`, `index.html`, `lobber.js`, `lobber.css`) plus any assets they reference.

## Local install and run

### 1) Install Python deps

```bash
python -m pip install -r requirements.txt
```

If `requirements.txt` is not present, install the minimum manually:

```bash
python -m pip install fastapi uvicorn playwright
python -m playwright install chromium
```

### 2) Serve locally with FastAPI (`app.py`)

```bash
uvicorn app:app --host 127.0.0.1 --port 8000 --http h11
```

Open:

- Dashboard: `http://127.0.0.1:8000/`
- Emoji Lobber game: `http://127.0.0.1:8000/lobber/game.html`
- Emoji Lobber landing: `http://127.0.0.1:8000/lobber/index.html`

Health check:

- `http://127.0.0.1:8000/health` should return `{"status":"ok"}`

## Local verification scripts

Run both checks against your local server:

```bash
python scripts/check_served_html.py http://127.0.0.1:8000
python scripts/check_browser_console.py http://127.0.0.1:8000
```

What to look for:

- Pass condition: each script ends with `VERIFICATION: PASSED - no errors...`
- `check_served_html.py` validates page HTML shell + local asset URL resolution.
- `check_browser_console.py` validates runtime console/page errors and includes a Lobber functional smoke flow.
- Pong may show AudioContext autoplay warnings; those are reported as warnings-only and are non-fatal.


