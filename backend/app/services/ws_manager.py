"""
Hybrid Distributed / In-Memory WebSocket Manager for HelloDine.
Supports seamless Redis Pub/Sub multi-container horizontal scaling when REDIS_URL
is reachable, with automatic fallback to single-process in-memory broadcasting.
"""
from fastapi import WebSocket
from typing import Dict, List, Optional
import json
import asyncio
import logging
from app.config import settings

logger = logging.getLogger(__name__)


class KitchenConnectionManager:
    def __init__(self):
        # branch_id -> list of local WebSockets
        self.active: Dict[str, List[WebSocket]] = {}
        # session_id -> list of local WebSockets
        self.active_tables: Dict[str, List[WebSocket]] = {}
        self._redis_client = None
        self._pubsub_task: Optional[asyncio.Task] = None

    async def _init_redis(self):
        """Optionally connect to Redis Pub/Sub if REDIS_URL is configured."""
        if self._redis_client is not None or not settings.REDIS_URL:
            return
        try:
            import redis.asyncio as aioredis
            client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            await client.ping()
            self._redis_client = client
            self._pubsub_task = asyncio.create_task(self._listen_redis())
            logger.info("KitchenConnectionManager connected to Redis Pub/Sub.")
        except Exception as e:
            logger.warning(f"Redis not available for Pub/Sub ({e}). Falling back to local in-memory broadcasting.")
            self._redis_client = None

    async def _listen_redis(self):
        """Background listener subscribing to branch and table broadcast channels."""
        try:
            pubsub = self._redis_client.pubsub()
            await pubsub.psubscribe("branch:*", "table:*")
            async for raw in pubsub.listen():
                if raw["type"] == "pmessage":
                    channel = raw["channel"]
                    data = json.loads(raw["data"])
                    if channel.startswith("branch:"):
                        branch_id = channel.replace("branch:", "")
                        await self._local_broadcast_branch(branch_id, data)
                    elif channel.startswith("table:"):
                        session_id = channel.replace("table:", "")
                        await self._local_broadcast_table(session_id, data)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error in Redis Pub/Sub listener: {e}")

    async def connect(self, websocket: WebSocket, branch_id: str):
        await websocket.accept()
        if branch_id not in self.active:
            self.active[branch_id] = []
        self.active[branch_id].append(websocket)
        await self._init_redis()

    def disconnect(self, websocket: WebSocket, branch_id: str):
        if branch_id in self.active and websocket in self.active[branch_id]:
            self.active[branch_id].remove(websocket)

    async def _local_broadcast_branch(self, branch_id: str, message: dict):
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

    async def broadcast_to_branch(self, branch_id: str, message: dict):
        # If Redis is active, publish to channel so all workers receive it
        if self._redis_client:
            try:
                await self._redis_client.publish(f"branch:{branch_id}", json.dumps(message))
                return
            except Exception as e:
                logger.warning(f"Failed to publish to Redis branch channel ({e}), broadcasting locally")

        await self._local_broadcast_branch(branch_id, message)

    async def connect_table(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        if session_id not in self.active_tables:
            self.active_tables[session_id] = []
        self.active_tables[session_id].append(websocket)
        await self._init_redis()

    def disconnect_table(self, websocket: WebSocket, session_id: str):
        if session_id in self.active_tables and websocket in self.active_tables[session_id]:
            self.active_tables[session_id].remove(websocket)

    async def _local_broadcast_table(self, session_id: str, message: dict):
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

    async def broadcast_to_table(self, session_id: str, message: dict):
        if self._redis_client:
            try:
                await self._redis_client.publish(f"table:{session_id}", json.dumps(message))
                return
            except Exception as e:
                logger.warning(f"Failed to publish to Redis table channel ({e}), broadcasting locally")

        await self._local_broadcast_table(session_id, message)


manager = KitchenConnectionManager()
