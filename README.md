# bensUnityWebSocketServer

FastAPI app that serves a small **MQTT Arcade** dashboard plus static HTML clients for **co-op Tetris** and **two-seat Pong**. Games use the browser MQTT.js client against the public **Eclipse Mosquitto test broker** (`wss://test.mosquitto.org:8081`). There is **no Unity** and **no Python WebSocket game relay** anymore.

## Seats

| Game   | Dad (Player A)        | Adrien (Player B)        |
|--------|------------------------|---------------------------|
| Tetris | `/tetris/dad.html`     | `/tetris/adrien.html`     |
| Pong   | `/pong/dad.html`       | `/pong/adrien.html`       |

Dashboard: `/` · Topic roots: `tetris/bens_arcade/...`, `pong/bens_arcade/...`

## Local (Windows / macOS / Linux)

```powershell
cd bensUnityWebSocketServer
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000 --http h11
```

Open `http://127.0.0.1:8000/` and pick a game. Use two browser tabs (or machines) for Dad + Adrien.

## Render

```bash
uvicorn app:app --host 0.0.0.0 --port $PORT --http h11
```

Health check: `GET /health`

## Original Tetris lab

The Tetris client logic was ported from `webapp-pen-test-playground/mqtt_tetris` with the broker fixed to the public Mosquitto WebSocket endpoint for simple hosting without a local broker.
