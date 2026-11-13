"""Pluggable Database Adapters for the Standalone Menu Scanner Agent.

This allows the same foundation agent to persist menus into:
1. HelloDine PostgreSQL database (`HelloDineAdapter`)
2. Generic external REST webhook / JSON schema (`WebhookJsonAdapter`)
3. Any custom SQL/NoSQL database by subclassing `BaseMenuDatabaseAdapter`.
"""
import uuid
from typing import Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import httpx

from .schema import MenuManifest


class BaseMenuDatabaseAdapter:
    """Abstract interface for saving a canonical MenuManifest to any target database."""

    async def save_menu(self, manifest: MenuManifest, target_context: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError("Subclasses must implement save_menu()")


class HelloDineAdapter(BaseMenuDatabaseAdapter):
    """Persists canonical MenuManifest into HelloDine's PostgreSQL tables (MenuCategory, MenuItem, MenuItemVariant)."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def save_menu(self, manifest: MenuManifest, target_context: Dict[str, Any]) -> Dict[str, Any]:
        from app.models.menu import MenuCategory, MenuItem, MenuItemVariant

        branch_id_str = target_context.get("branch_id")
        if not branch_id_str:
            raise ValueError("branch_id is required in target_context for HelloDineAdapter")
        branch_id = uuid.UUID(str(branch_id_str))

        # Fetch existing categories for this branch so we reuse them idempotently
        existing_cats_res = await self.db.execute(
            select(MenuCategory).where(MenuCategory.branch_id == branch_id)
        )
        existing_cats = {c.name.strip().lower(): c for c in existing_cats_res.scalars().all()}

        created_categories = 0
        created_items = 0
        created_variants = 0

        for cat_idx, cat_data in enumerate(manifest.categories):
            cat_name = cat_data.name.strip() or "Main Course"
            cat_key = cat_name.lower()

            if cat_key in existing_cats:
                cat_obj = existing_cats[cat_key]
            else:
                cat_obj = MenuCategory(
                    branch_id=branch_id,
                    name=cat_name,
                    sort_order=len(existing_cats) + cat_idx,
                    is_active=True,
                )
                self.db.add(cat_obj)
                await self.db.flush()
                existing_cats[cat_key] = cat_obj
                created_categories += 1

            for item_data in cat_data.items:
                if item_data.base_price < 0:
                    continue

                item_obj = MenuItem(
                    branch_id=branch_id,
                    category_id=cat_obj.id,
                    name=item_data.name.strip(),
                    description=item_data.description,
                    base_price=float(item_data.base_price),
                    gst_percent=int(item_data.gst_percent) if item_data.gst_percent in (0, 5, 12, 18) else 5,
                    is_veg=bool(item_data.is_veg),
                    is_bestseller=bool(item_data.is_bestseller),
                    image_url=item_data.image_url,
                    is_available=True,
                )
                self.db.add(item_obj)
                await self.db.flush()
                created_items += 1

                for var_data in item_data.variants:
                    var_obj = MenuItemVariant(
                        menu_item_id=item_obj.id,
                        name=var_data.name.strip(),
                        price=float(var_data.price),
                    )
                    self.db.add(var_obj)
                    created_variants += 1

        await self.db.commit()

        # Invalidate menu cache for this branch
        try:
            from app.services.cache_service import cache
            cache.invalidate_prefix(f"menu:{branch_id}")
        except Exception:
            pass

        return {
            "ok": True,
            "adapter": "HelloDineAdapter",
            "created_categories": created_categories,
            "created_items": created_items,
            "created_variants": created_variants,
        }


class WebhookJsonAdapter(BaseMenuDatabaseAdapter):
    """Portable adapter: forwards the validated MenuManifest JSON to any external app's API endpoint."""

    def __init__(self, target_url: str, headers: Dict[str, str] | None = None):
        self.target_url = target_url
        self.headers = headers or {"Content-Type": "application/json"}

    async def save_menu(self, manifest: MenuManifest, target_context: Dict[str, Any]) -> Dict[str, Any]:
        payload = {
            "target_context": target_context,
            "menu": manifest.model_dump(),
        }
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.post(self.target_url, json=payload, headers=self.headers)
            res.raise_for_status()
            return {
                "ok": True,
                "adapter": "WebhookJsonAdapter",
                "target_url": self.target_url,
                "remote_response": res.json() if res.content else {},
            }
