"""Menu router — /api/menu"""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models.menu import MenuCategory, MenuItem, MenuItemVariant, MenuModifierGroup, MenuModifier, SpiceLevel
from app.services.cache_service import cache

router = APIRouter(prefix="/api/menu", tags=["menu"])


# ─── Schemas ─────────────────────────────────────────────────────────────────
class CategoryCreate(BaseModel):
    branch_id: uuid.UUID
    name: str
    sort_order: int = 0
    estimated_prep_minutes: Optional[int] = None


class ItemCreate(BaseModel):
    branch_id: uuid.UUID
    category_id: uuid.UUID
    name: str
    description: Optional[str] = None
    base_price: float
    gst_percent: int = 5
    hsn_code: Optional[str] = None
    is_veg: bool = True
    is_jain: bool = False
    is_bestseller: bool = False
    spice_level: Optional[SpiceLevel] = None
    allergens: Optional[list[str]] = None
    calories: Optional[int] = None


class VariantCreate(BaseModel):
    menu_item_id: uuid.UUID
    name: str
    price: float


class ModifierGroupCreate(BaseModel):
    menu_item_id: uuid.UUID
    name: str
    min_select: int = 0
    max_select: int = 1
    is_required: bool = False


class ModifierCreate(BaseModel):
    modifier_group_id: uuid.UUID
    name: str
    price_delta: float = 0


# ─── Categories ───────────────────────────────────────────────────────────────
@router.post("/categories")
async def create_category(data: CategoryCreate, db: AsyncSession = Depends(get_db)):
    cat = MenuCategory(**data.model_dump())
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    cache.invalidate_prefix(f"static_menu:{cat.branch_id}")
    cache.invalidate_prefix(f"ai_static_context:{cat.branch_id}")
    return cat


@router.get("/categories")
async def list_categories(branch_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MenuCategory).where(MenuCategory.branch_id == branch_id, MenuCategory.is_active == True).order_by(MenuCategory.sort_order)
    )
    return result.scalars().all()


@router.patch("/categories/{cat_id}")
async def update_category(cat_id: uuid.UUID, data: dict, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MenuCategory).where(MenuCategory.id == cat_id))
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(404, "Category not found")
    for k, v in data.items():
        if hasattr(cat, k):
            setattr(cat, k, v)
    await db.commit()
    cache.invalidate_prefix(f"static_menu:{cat.branch_id}")
    cache.invalidate_prefix(f"ai_static_context:{cat.branch_id}")
    return cat


# ─── Items ────────────────────────────────────────────────────────────────────
@router.post("/items")
async def create_item(data: ItemCreate, db: AsyncSession = Depends(get_db)):
    item = MenuItem(**data.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    try:
        from app.services.vector_service import embed_and_save_menu_item
        await embed_and_save_menu_item(item.id, db)
    except Exception:
        pass
    cache.invalidate_prefix(f"static_menu:{item.branch_id}")
    cache.invalidate_prefix(f"ai_static_context:{item.branch_id}")
    cache.invalidate_prefix(f"ranked_items:{item.branch_id}")
    return item


@router.get("/items")
async def list_items(branch_id: uuid.UUID, category_id: Optional[uuid.UUID] = None, db: AsyncSession = Depends(get_db)):
    q = select(MenuItem).where(MenuItem.branch_id == branch_id)
    if category_id:
        q = q.where(MenuItem.category_id == category_id)
    result = await db.execute(q.options(selectinload(MenuItem.variants), selectinload(MenuItem.modifier_groups)))
    return result.scalars().all()


@router.get("/items/{item_id}")
async def get_item(item_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MenuItem).where(MenuItem.id == item_id)
        .options(selectinload(MenuItem.variants), selectinload(MenuItem.modifier_groups).selectinload(MenuModifierGroup.modifiers))
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Item not found")
    return item


@router.patch("/items/{item_id}")
async def update_item(item_id: uuid.UUID, data: dict, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MenuItem).where(MenuItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Item not found")
    for k, v in data.items():
        if hasattr(item, k):
            setattr(item, k, v)
    await db.commit()
    try:
        from app.services.vector_service import embed_and_save_menu_item
        await embed_and_save_menu_item(item.id, db)
    except Exception:
        pass
    cache.invalidate_prefix(f"static_menu:{item.branch_id}")
    cache.invalidate_prefix(f"ai_static_context:{item.branch_id}")
    cache.invalidate_prefix(f"ranked_items:{item.branch_id}")
    return item


@router.delete("/items/{item_id}")
async def delete_item(item_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MenuItem).where(MenuItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Item not found")
    item.is_available = False
    await db.commit()
    cache.invalidate_prefix(f"static_menu:{item.branch_id}")
    cache.invalidate_prefix(f"ai_static_context:{item.branch_id}")
    cache.invalidate_prefix(f"ranked_items:{item.branch_id}")
    return {"ok": True}


# ─── Variants ─────────────────────────────────────────────────────────────────
@router.post("/variants")
async def create_variant(data: VariantCreate, db: AsyncSession = Depends(get_db)):
    v = MenuItemVariant(**data.model_dump())
    db.add(v)
    await db.commit()
    await db.refresh(v)
    return v


# ─── Modifier Groups & Modifiers ──────────────────────────────────────────────
@router.post("/modifier-groups")
async def create_modifier_group(data: ModifierGroupCreate, db: AsyncSession = Depends(get_db)):
    g = MenuModifierGroup(**data.model_dump())
    db.add(g)
    await db.commit()
    await db.refresh(g)
    return g


@router.post("/modifiers")
async def create_modifier(data: ModifierCreate, db: AsyncSession = Depends(get_db)):
    m = MenuModifier(**data.model_dump())
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m
