# bensUnityWebSocketServer

FastAPI app that serves a small **MQTT Arcade** dashboard plus static HTML clients for **co-op Tetris** and **two-seat Pong**. Games use the browser MQTT.js client against the public **Eclipse Mosquitto test broker** (`wss://test.mosquitto.org:8081`). There is **no Unity** and **no Python WebSocket game relay** anymore.

## Seats

| Game   | Man | Boy |
|--------|-----|-----|
| Tetris | `/tetris/man.html` (spawn right) | `/tetris/boy.html` (spawn left) |
| Pong   | `/pong/man.html` (host, left paddle) | `/pong/boy.html` (right paddle) |
| Emoji Lobber | `/lobber/man.html` (shoots first) | `/lobber/boy.html` |

**Emoji Lobber** — turn-based slingshot lobs (Angry Birds–style pull & release), emoji spins in flight; topics `lobber/bens_arcade/<Man|Boy>/{pick,shot,finish,status}`. Optional solo: **`?solo=1`** on `man.html` or `boy.html`.

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
