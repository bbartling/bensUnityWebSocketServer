# bensUnityWebSocketServer

FastAPI app that serves a small **MQTT Arcade** dashboard plus static HTML clients for **co-op Tetris**, **two-seat Pong**, **two-seat Tic Tac Toe**, and **two-seat Mahjong Match**. Games use the browser MQTT.js client against the public **Eclipse Mosquitto test broker** (`wss://test.mosquitto.org:8081`). There is **no Unity** and **no Python WebSocket game relay** anymore.

## Seats

| Game   | Man | Boy |
|--------|-----|-----|
| Tetris | `/tetris/man.html` (spawn right) | `/tetris/boy.html` (spawn left) |
| Pong   | `/pong/man.html` (host, left paddle, opening-serve option) | `/pong/boy.html` (right paddle) |
| Tic Tac Toe | `/tictactoe/man.html` (host, X) | `/tictactoe/boy.html` (O) |
| Mahjong Match | `/mahjong/man.html` (host) | `/mahjong/boy.html` |
| Emoji Lobber | `/lobber/game.html` (single-player) | — |

**MQTT private rooms (Tetris, Pong, Tic Tac Toe, Mahjong Match)** — On each game’s **index** page (`/tetris/`, `/pong/`, `/tictactoe/`, `/mahjong/`), pick a silly two-word room (or type your own). Both seats open **Man** and **Boy** with the same `?room=slug` so you only match each other. Default room `bens_arcade` is used if you skip the picker. Room choice is stored in `sessionStorage` per game.

**Emoji Lobber** — Single-player Angry Birds–style pull & release, spinning projectile, destructible **wood** / **stone** + **villain emoji** targets, **lava** (shot ends on touch), **pyramid** layouts on harder stages, per-hero powers (human-face picker). **15 levels** (Easy → Impossible); pick any stage before locking in. No MQTT or network. Optional **`?debug=1`** for verbose console logs.

## Emoji Lobber Single-URL Note (Coolmath prep)

- Canonical Lobber URL is **only** `/lobber/game.html`.
- Lobber `man.html` and `boy.html` files/references are intentionally removed for single-player packaging.
- Keep `/lobber/index.html` as the landing/info page and `/lobber/game.html` as the playable build.
- Builder mode keeps every stamp as an individual grid tile (Mario Maker style).
- Play test compiles **only actually touching** same-kind tiles (tiny gap tolerance for grid snap) into merged collision pieces for that play session — wide gaps stay separate.
- Stopping play test restores the original unmerged edit layout, and JSON export saves the unmerged tiles.
- The level editor uses a **no-build** zone for the bottom-left corner plus a padded pocket around the slingshot so parts cannot sit on the launcher; Play test requires at least one villain and will show a browser alert if you try without one.
- **Metal** rails (solid, bouncy) are **indestructible** in play; wood, stone, and villains take damage from shots. Older saved levels may still list the same piece as `kind: "beam"`; the game treats that as metal.
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
python scripts/arcade_game_urls.py
python scripts/validate_mqtt_2player.py
python scripts/mqtt_wss_ping.py --both --room test-room
python scripts/check_served_html.py http://127.0.0.1:8000
python scripts/check_browser_console.py http://127.0.0.1:8000
```

`validate_mqtt_2player.py` checks broker WSS, lobby room list, and Man/Boy game topics for all five 2-player games (stops after 100 iterations or 300s).

What to look for:

- Pass condition: each script ends with `VERIFICATION: PASSED - no errors...`
- `arcade_game_urls.py` lists all smoke URLs plus required HTML snippets; run it alone for a quick URL-list self-check.
- `check_served_html.py` validates page HTML shell, `REQUIRED_HTML_SNIPPETS` (Lobber + MQTT room picker on index/seat pages), local asset URL resolution, and `/arcade-room-pick.{js,css}`.
- `check_browser_console.py` validates runtime console/page errors, Lobber functional smoke, and **ArcadeRoom** picker smoke on Pong/Tetris/Tic Tac Toe index pages (silly-room button → matching `?room=` on Man/Boy links + `slugify` contract).


