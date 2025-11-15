import asyncio
import json
import logging
from collections import defaultdict
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

'''
uvicorn app:app --host 0.0.0.0 --port 8000
'''

app = FastAPI()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

rooms: dict[str, list[WebSocket]] = defaultdict(list)

# -------------------------
# NEW HOME ROUTE
# -------------------------
@app.get("/")
async def root():
    return {"message": "Hello World — WebSocket Pong Server is running!"}


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    """
    Handles a new client connection for a specific room.
    """
    await websocket.accept()
    rooms[room_id].append(websocket)
    log.info(f"A player joined room '{room_id}'. Total: {len(rooms[room_id])}")

    try:
        while True:
            data_bytes = await websocket.receive_bytes()

            broadcast_tasks = []
            for client in rooms[room_id]:
                if client != websocket:
                    broadcast_tasks.append(client.send_bytes(data_bytes))

            if broadcast_tasks:
                await asyncio.gather(*broadcast_tasks)

    except WebSocketDisconnect:
        log.info(f"A player disconnected from room '{room_id}'.")
    finally:
        rooms[room_id].remove(websocket)
        if not rooms[room_id]:
            log.info(f"Room '{room_id}' is now empty and closed.")
            del rooms[room_id]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, http="h11")
