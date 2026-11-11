"""WebSocket connection manager for realtime kitchen and table kiosk updates."""
from fastapi import WebSocket
from typing import Dict
import json
import uuid


class KitchenConnectionManager:
    def __init__(self):
        # branch_id -> list of WebSocket connections
        self.active: Dict[str, list[WebSocket]] = {}
        # session_id -> list of WebSocket connections (for customer table tablets)
        self.active_tables: Dict[str, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, branch_id: str):
        await websocket.accept()
        if branch_id not in self.active:
            self.active[branch_id] = []
        self.active[branch_id].append(websocket)

    def disconnect(self, websocket: WebSocket, branch_id: str):
        if branch_id in self.active and websocket in self.active[branch_id]:
            self.active[branch_id].remove(websocket)

    async def broadcast_to_branch(self, branch_id: str, message: dict):
        if branch_id in self.active:
            dead = []
            for ws in self.active[branch_id]:
                try:
                    await ws.send_json(message)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                if ws in self.active[branch_id]:
                    self.active[branch_id].remove(ws)

    async def connect_table(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        if session_id not in self.active_tables:
            self.active_tables[session_id] = []
        self.active_tables[session_id].append(websocket)

    def disconnect_table(self, websocket: WebSocket, session_id: str):
        if session_id in self.active_tables and websocket in self.active_tables[session_id]:
            self.active_tables[session_id].remove(websocket)

    async def broadcast_to_table(self, session_id: str, message: dict):
        if session_id in self.active_tables:
            dead = []
            for ws in self.active_tables[session_id]:
                try:
                    await ws.send_json(message)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                if ws in self.active_tables[session_id]:
                    self.active_tables[session_id].remove(ws)


manager = KitchenConnectionManager()

