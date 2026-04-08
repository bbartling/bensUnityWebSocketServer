# bensUnityWebSocketServer

FastAPI app that serves a small **MQTT Arcade** dashboard plus static HTML clients for **co-op Tetris** and **two-seat Pong**. Games use the browser MQTT.js client against the public **Eclipse Mosquitto test broker** (`wss://test.mosquitto.org:8081`). There is **no Unity** and **no Python WebSocket game relay** anymore.

## Seats

| Game   | Man | Boy |
|--------|-----|-----|
| Tetris | `/tetris/man.html` (spawn right) | `/tetris/boy.html` (spawn left) |
| Pong   | `/pong/man.html` (host, left paddle) | `/pong/boy.html` (right paddle) |
| Emoji Lobber | `/lobber/man.html` (shoots first) | `/lobber/boy.html` |

**Emoji Lobber** — Angry Birds–style pull & release (speed scales with drag length), spinning projectile, destructible wood/stone + **villain emoji** targets, debris particles, per-hero powers (human-face picker only). **15 levels** (Easy / Medium / Hard / Impossible) with larger worlds on later stages; **lava** blocks instantly end a shot on contact; **wood**, **stone**, and **villain** targets as before, plus **pyramid** layouts on several stages. Any level is selectable before locking in (no unlock gate — for testing). In 2P, **Man’s** level is authoritative (`pick` carries `levelId`; `sync` includes `levelId` + `worldW`/`worldH`). **Man** is host: publishes `lobber/bens_arcade/Man/sync` for late join; **Boy** sends `Boy/join` to request sync. Use a **unique MQTT `clientId`** so two tabs don’t kick each other off the public broker. Topics: `pick`, `shot`, `finish`, `status`, `sync`, `join`. If no partner ~14s after you lock, **1-player** starts (or use **`?solo=1`**). For **verbose MQTT / 2P troubleshooting logs**, add **`?debug=1`** to the Lobber URL (otherwise you still get lightweight connect / pick / sync / 1P-fallback lines in the console).

MQTT player ids in topics are **`Man`** and **`Boy`**. Old URLs **`/tetris/dad.html`**, **`/tetris/adrien.html`**, **`/pong/dad.html`**, **`/pong/adrien.html`** redirect (307) to the new pages.

Dashboard: **`/`** (explicit HTML route so the root is never a JSON stub). Aliases: **`/dashboard`** and **`/home`** → redirect to **`/`**. Topic roots: `tetris/bens_arcade/...`, `pong/bens_arcade/...`

If you still see `{"message":"Hello World — WebSocket Pong Server is running!"}` on [Render](https://bensunitywebsocketserver.onrender.com/), the service is running an **older deploy** — push this repo and wait for the build to finish (or trigger a manual deploy).

## Local (Windows / macOS / Linux)

```powershell
cd bensUnityWebSocketServer
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000 --http h11
```

Open `http://127.0.0.1:8000/` and pick a game. Use two browser tabs (or machines) for Man + Boy.

## Render

```bash
uvicorn app:app --host 0.0.0.0 --port $PORT --http h11
```

Health check: `GET /health`

## Original Tetris lab

The Tetris client logic was ported from `webapp-pen-test-playground/mqtt_tetris` with the broker fixed to the public Mosquitto WebSocket endpoint for simple hosting without a local broker.
