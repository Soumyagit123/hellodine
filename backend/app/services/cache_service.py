"""
Two-Tier Hybrid Multi-Tenant Cache Service for HelloDine (L1 RAM + L2 Upstash Redis).
Provides ultra-fast (sub-millisecond) L1 RAM caching backed by persistent L2 Upstash Redis
for menu items, categories, orders board, tables, staff, branches, restaurant metadata,
billing analytics, and AI chat context.
"""
import asyncio
import json
import logging
import time
from typing import Any, Optional
from fastapi.encoders import jsonable_encoder
from app.config import settings

logger = logging.getLogger(__name__)


class MemoryCache:
    def __init__(self, default_ttl_seconds: int = 300, max_entries: int = 5000):
        # L1 RAM Store: Key -> (value, expires_at_timestamp)
        self._store: dict[str, tuple[Any, float]] = {}
        self._default_ttl = default_ttl_seconds
        self._max_entries = max_entries
        self._write_counter = 0

        # L2 Redis Store (Upstash / Redis)
        self._redis_client = None
        self._redis_last_fail_ts: float = 0.0
        self._key_prefix = "hd:"

    def _schedule_bg(self, coro) -> None:
        """Schedule an async Redis operation in the background if an event loop is running."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(coro)
        except RuntimeError:
            try:
                coro.close()
            except Exception:
                pass

    async def _get_redis(self):
        """Lazy-initialize the shared async Redis client for L2 cache."""
        if self._redis_client is not None:
            return self._redis_client
        if not settings.REDIS_URL:
            return None
        now_ts = time.monotonic()
        if self._redis_last_fail_ts > 0 and (now_ts - self._redis_last_fail_ts) < 120.0:
            return None
        try:
            import redis.asyncio as aioredis
            client = aioredis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=2.5,
                health_check_interval=30,
            )
            await client.ping()
            self._redis_client = client
            self._redis_last_fail_ts = 0.0
            logger.info("L2 Hybrid Cache connected to Upstash/Redis.")
            return self._redis_client
        except Exception as e:
            if self._redis_last_fail_ts == 0.0:
                logger.warning(f"L2 Redis cache unavailable ({e}). Using L1 RAM cache.")
            self._redis_last_fail_ts = now_ts
            self._redis_client = None
            return None

    async def _redis_set_bg(self, key: str, value: Any, ttl: int) -> None:
        client = await self._get_redis()
        if not client:
            return
        try:
            # Skip non-JSON-serializable ORM tuples (e.g. internal ranked_items tuple)
            if isinstance(value, tuple):
                return
            encoded = jsonable_encoder(value)
            payload = json.dumps(encoded)
            await client.setex(f"{self._key_prefix}{key}", ttl, payload)
        except Exception:
            pass

    async def _redis_fetch_and_warm_bg(self, key: str) -> None:
        client = await self._get_redis()
        if not client:
            return
        try:
            rkey = f"{self._key_prefix}{key}"
            raw = await client.get(rkey)
            if raw is not None:
                ttl = await client.ttl(rkey)
                effective_ttl = ttl if (ttl and ttl > 0) else self._default_ttl
                val = json.loads(raw)
                # Populate L1 RAM if not already set
                if key not in self._store:
                    self._store[key] = (val, time.time() + effective_ttl)
        except Exception:
            pass

    async def _redis_delete_bg(self, key: str) -> None:
        client = await self._get_redis()
        if not client:
            return
        try:
            await client.delete(f"{self._key_prefix}{key}")
        except Exception:
            pass

    async def _redis_invalidate_prefix_bg(self, prefix: str, exact_keys: list[str]) -> None:
        client = await self._get_redis()
        if not client:
            return
        try:
            keys_to_del = [f"{self._key_prefix}{k}" for k in exact_keys]
            cursor = 0
            pattern = f"{self._key_prefix}{prefix}*"
            while True:
                cursor, found = await client.scan(cursor=cursor, match=pattern, count=100)
                if found:
                    keys_to_del.extend(found)
                if cursor == 0:
                    break
            if keys_to_del:
                await client.delete(*set(keys_to_del))
        except Exception:
            pass

    def get(self, key: str) -> Optional[Any]:
        """Retrieve a cached value from L1 RAM if present and not expired; warm from L2 Redis on miss."""
        entry = self._store.get(key)
        if not entry:
            self._schedule_bg(self._redis_fetch_and_warm_bg(key))
            return None
        val, expires_at = entry
        if time.time() > expires_at:
            self._store.pop(key, None)
            self._schedule_bg(self._redis_fetch_and_warm_bg(key))
            return None
        return val

    async def aget(self, key: str) -> Optional[Any]:
        """Retrieve from L1 RAM first; if expired/missing in L1, fetch directly from L2 Upstash Redis and warm L1."""
        entry = self._store.get(key)
        if entry:
            val, expires_at = entry
            if time.time() <= expires_at:
                return val
            self._store.pop(key, None)

        client = await self._get_redis()
        if not client:
            return None
        try:
            rkey = f"{self._key_prefix}{key}"
            raw = await client.get(rkey)
            if raw is not None:
                val = json.loads(raw)
                self._store[key] = (val, time.time() + self._default_ttl)
                return val
        except Exception:
            pass
        return None

    def _evict_expired_or_oldest(self) -> None:
        """Purge expired entries and cap total L1 RAM size at max_entries."""
        now = time.time()
        expired_keys = [k for k, (_, exp) in self._store.items() if now > exp]
        for k in expired_keys:
            self._store.pop(k, None)
        if len(self._store) >= self._max_entries:
            evict_count = max(1, self._max_entries // 10)
            oldest = sorted(self._store.items(), key=lambda kv: kv[1][1])[:evict_count]
            for k, _ in oldest:
                self._store.pop(k, None)

    def set(self, key: str, value: Any, ttl_seconds: Optional[int] = None) -> None:
        """Store a value in L1 RAM and asynchronously persist to L2 Upstash Redis with TTL."""
        self._write_counter += 1
        if self._write_counter >= 200 or len(self._store) >= self._max_entries:
            self._write_counter = 0
            self._evict_expired_or_oldest()
        ttl = ttl_seconds if ttl_seconds is not None else self._default_ttl
        self._store[key] = (value, time.time() + ttl)
        self._schedule_bg(self._redis_set_bg(key, value, ttl))

    def delete(self, key: str) -> None:
        """Remove a single key from L1 RAM and L2 Upstash Redis."""
        self._store.pop(key, None)
        self._schedule_bg(self._redis_delete_bg(key))

    def invalidate_prefix(self, prefix: str) -> int:
        """Invalidate all keys starting with a prefix in L1 RAM and L2 Upstash Redis."""
        to_delete = [k for k in self._store if k.startswith(prefix)]
        for k in to_delete:
            self._store.pop(k, None)
        self._schedule_bg(self._redis_invalidate_prefix_bg(prefix, to_delete))
        return len(to_delete)

    def clear(self) -> None:
        """Flush L1 RAM cache."""
        self._store.clear()


# Global singleton instance
cache = MemoryCache(default_ttl_seconds=300)
