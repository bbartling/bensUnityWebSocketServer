# bensUnityWebSocketServer
Python Fast API server for hosting 2 Player games in Unity

Currently hosting:
* https://github.com/bbartling/pong


## Run Command
Pip install requirements text file for python packages.

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

## Render Hosting

```bash
uvicorn app:app --host 0.0.0.0 --port $PORT --http h11
```