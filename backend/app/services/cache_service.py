"""
In-Memory Multi-Tenant Cache Service for HelloDine.
Provides ultra-fast (sub-millisecond) caching for menu items, categories,
restaurant metadata, and AI chat context to eliminate cross-continent DB latency.
"""
import time
from typing import Any, Optional


class MemoryCache:
    def __init__(self, default_ttl_seconds: int = 300):
        # Key -> (value, expires_at_timestamp)
        self._store: dict[str, tuple[Any, float]] = {}
        self._default_ttl = default_ttl_seconds

    def get(self, key: str) -> Optional[Any]:
        """Retrieve a cached value if present and not expired."""
        entry = self._store.get(key)
        if not entry:
            return None
        val, expires_at = entry
        if time.time() > expires_at:
            self._store.pop(key, None)
            return None
        return val

    def set(self, key: str, value: Any, ttl_seconds: Optional[int] = None) -> None:
        """Store a value in RAM with TTL (default 300s / 5 minutes)."""
        ttl = ttl_seconds if ttl_seconds is not None else self._default_ttl
        self._store[key] = (value, time.time() + ttl)

    def delete(self, key: str) -> None:
        """Remove a single key."""
        self._store.pop(key, None)

    def invalidate_prefix(self, prefix: str) -> int:
        """Invalidate all keys starting with a prefix (e.g. 'menu:branch_id')."""
        to_delete = [k for k in self._store if k.startswith(prefix)]
        for k in to_delete:
            self._store.pop(k, None)
        return len(to_delete)

    def clear(self) -> None:
        """Flush the entire cache."""
        self._store.clear()


# Global singleton instance
cache = MemoryCache(default_ttl_seconds=300)

