"""Menu router — /api/menu"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, Field
from typing import Optional

from app.database import get_db
from app.models.menu import MenuCategory, MenuItem, MenuItemVariant, MenuModifierGroup, MenuModifier, SpiceLevel
from app.models.tenancy import Branch
from app.models.auth import StaffUser, StaffRole
from app.services.auth_service import get_current_staff
from app.services.cache_service import cache

router = APIRouter(prefix="/api/menu", tags=["menu"])


async def _verify_menu_admin_access(branch_id: uuid.UUID, current_staff: StaffUser, db: AsyncSession) -> Branch:
    """Ensure the authenticated staff user is an admin and owns the target branch."""
    if current_staff.role not in (StaffRole.SYSTEM_ADMIN, StaffRole.SUPER_ADMIN, StaffRole.BRANCH_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can modify menu items and categories")

    res = await db.execute(select(Branch).where(Branch.id == branch_id))
    branch = res.scalar_one_or_none()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    if current_staff.role == StaffRole.SUPER_ADMIN and str(branch.restaurant_id) != str(current_staff.restaurant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied: branch belongs to another restaurant")
    if current_staff.role == StaffRole.BRANCH_ADMIN and str(branch.id) != str(current_staff.branch_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied: you can only manage your assigned branch's menu")

    return branch


# ─── Schemas ─────────────────────────────────────────────────────────────────
class CategoryCreate(BaseModel):
    branch_id: uuid.UUID
    name: str = Field(..., min_length=1, max_length=120)
    sort_order: int = 0
    estimated_prep_minutes: Optional[int] = None


class ItemCreate(BaseModel):
    branch_id: uuid.UUID
    category_id: uuid.UUID
    name: str = Field(..., min_length=1, max_length=160)
    description: Optional[str] = None
    base_price: float = Field(..., gt=0)
    gst_percent: int = 5
    hsn_code: Optional[str] = None
    is_veg: bool = True
    is_jain: bool = False
    is_bestseller: bool = False
    spice_level: Optional[SpiceLevel] = None
    allergens: Optional[list[str]] = None
    calories: Optional[int] = None
    image_url: Optional[str] = None


class VariantCreate(BaseModel):
    menu_item_id: uuid.UUID
    name: str = Field(..., min_length=1, max_length=100)
    price: float = Field(..., ge=0)


class ModifierGroupCreate(BaseModel):
    menu_item_id: uuid.UUID
    name: str = Field(..., min_length=1, max_length=100)
    min_select: int = 0
    max_select: int = 1
    is_required: bool = False


class ModifierCreate(BaseModel):
    modifier_group_id: uuid.UUID
    name: str = Field(..., min_length=1, max_length=100)
    price_delta: float = Field(default=0, ge=0)


# Whitelisted fields to prevent mass assignment
_ALLOWED_CATEGORY_FIELDS = {"name", "sort_order", "estimated_prep_minutes", "is_active"}
_ALLOWED_ITEM_FIELDS = {
    "category_id", "name", "description", "base_price", "gst_percent",
    "hsn_code", "is_veg", "is_jain", "is_bestseller", "is_available",
    "spice_level", "allergens", "calories", "image_url",
}


# ─── Categories ───────────────────────────────────────────────────────────────
@router.post("/categories")
async def create_category(
    data: CategoryCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    await _verify_menu_admin_access(data.branch_id, current_staff, db)
    cat = MenuCategory(**data.model_dump())
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    cache.invalidate_prefix(f"menu_categories:{cat.branch_id}")
    cache.invalidate_prefix(f"static_menu:{cat.branch_id}")
    cache.invalidate_prefix(f"ai_static_context:{cat.branch_id}")
    return cat


@router.get("/categories")
async def list_categories(branch_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    cache_key = f"menu_categories:{branch_id}"
    cached = await cache.aget(cache_key)
    if cached is not None:
        return cached
    result = await db.execute(
        select(MenuCategory).where(MenuCategory.branch_id == branch_id, MenuCategory.is_active == True).order_by(MenuCategory.sort_order)
    )
    cats = result.scalars().all()
    cache.set(cache_key, cats, ttl_seconds=90)
    return cats


@router.patch("/categories/{cat_id}")
async def update_category(
    cat_id: uuid.UUID,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    result = await db.execute(select(MenuCategory).where(MenuCategory.id == cat_id))
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(404, "Category not found")
    await _verify_menu_admin_access(cat.branch_id, current_staff, db)
    for k, v in data.items():
        if k in _ALLOWED_CATEGORY_FIELDS and hasattr(cat, k):
            setattr(cat, k, v)
    await db.commit()
    cache.invalidate_prefix(f"menu_categories:{cat.branch_id}")
    cache.invalidate_prefix(f"static_menu:{cat.branch_id}")
    cache.invalidate_prefix(f"ai_static_context:{cat.branch_id}")
    return cat


@router.delete("/categories/{cat_id}")
async def delete_category(
    cat_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    result = await db.execute(select(MenuCategory).where(MenuCategory.id == cat_id))
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(404, "Category not found")
    await _verify_menu_admin_access(cat.branch_id, current_staff, db)
    cat.is_active = False
    await db.commit()
    cache.invalidate_prefix(f"menu_categories:{cat.branch_id}")
    cache.invalidate_prefix(f"static_menu:{cat.branch_id}")
    cache.invalidate_prefix(f"ai_static_context:{cat.branch_id}")
    return {"ok": True}


# ─── Items ────────────────────────────────────────────────────────────────────
@router.post("/items")
async def create_item(
    data: ItemCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    await _verify_menu_admin_access(data.branch_id, current_staff, db)
    item = MenuItem(**data.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    try:
        from app.services.vector_service import embed_and_save_menu_item
        await embed_and_save_menu_item(item.id, db)
    except Exception:
        pass
    cache.invalidate_prefix(f"menu_items:{item.branch_id}")
    cache.invalidate_prefix(f"static_menu:{item.branch_id}")
    cache.invalidate_prefix(f"ai_static_context:{item.branch_id}")
    cache.invalidate_prefix(f"ranked_items:{item.branch_id}")
    return item


@router.get("/items")
async def list_items(branch_id: uuid.UUID, category_id: Optional[uuid.UUID] = None, db: AsyncSession = Depends(get_db)):
    cache_key = f"menu_items:{branch_id}:{category_id or 'all'}"
    cached = await cache.aget(cache_key)
    if cached is not None:
        return cached
    q = select(MenuItem).where(MenuItem.branch_id == branch_id)
    if category_id:
        q = q.where(MenuItem.category_id == category_id)
    result = await db.execute(q.options(selectinload(MenuItem.variants), selectinload(MenuItem.modifier_groups)))
    items = result.scalars().all()
    cache.set(cache_key, items, ttl_seconds=90)
    return items


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
async def update_item(
    item_id: uuid.UUID,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    result = await db.execute(select(MenuItem).where(MenuItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Item not found")
    await _verify_menu_admin_access(item.branch_id, current_staff, db)
    for k, v in data.items():
        if k in _ALLOWED_ITEM_FIELDS and hasattr(item, k):
            if k == "base_price" and v is not None and float(v) <= 0:
                raise HTTPException(400, "base_price must be greater than 0")
            setattr(item, k, v)
    await db.commit()
    try:
        from app.services.vector_service import embed_and_save_menu_item
        await embed_and_save_menu_item(item.id, db)
    except Exception:
        pass
    cache.invalidate_prefix(f"menu_items:{item.branch_id}")
    cache.invalidate_prefix(f"static_menu:{item.branch_id}")
    cache.invalidate_prefix(f"ai_static_context:{item.branch_id}")
    cache.invalidate_prefix(f"ranked_items:{item.branch_id}")
    return item


@router.delete("/items/{item_id}")
async def delete_item(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    result = await db.execute(select(MenuItem).where(MenuItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Item not found")
    await _verify_menu_admin_access(item.branch_id, current_staff, db)
    item.is_available = False
    await db.commit()
    cache.invalidate_prefix(f"menu_items:{item.branch_id}")
    cache.invalidate_prefix(f"static_menu:{item.branch_id}")
    cache.invalidate_prefix(f"ai_static_context:{item.branch_id}")
    cache.invalidate_prefix(f"ranked_items:{item.branch_id}")
    return {"ok": True}


# ─── Variants ─────────────────────────────────────────────────────────────────
@router.post("/variants")
async def create_variant(
    data: VariantCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    item_res = await db.execute(select(MenuItem).where(MenuItem.id == data.menu_item_id))
    item = item_res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Menu item not found")
    await _verify_menu_admin_access(item.branch_id, current_staff, db)
    v = MenuItemVariant(**data.model_dump())
    db.add(v)
    await db.commit()
    await db.refresh(v)
    return v


# ─── Modifier Groups & Modifiers ──────────────────────────────────────────────
@router.post("/modifier-groups")
async def create_modifier_group(
    data: ModifierGroupCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    item_res = await db.execute(select(MenuItem).where(MenuItem.id == data.menu_item_id))
    item = item_res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Menu item not found")
    await _verify_menu_admin_access(item.branch_id, current_staff, db)
    g = MenuModifierGroup(**data.model_dump())
    db.add(g)
    await db.commit()
    await db.refresh(g)
    return g


@router.post("/modifiers")
async def create_modifier(
    data: ModifierCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    grp_res = await db.execute(select(MenuModifierGroup).where(MenuModifierGroup.id == data.modifier_group_id))
    grp = grp_res.scalar_one_or_none()
    if not grp:
        raise HTTPException(404, "Modifier group not found")
    item_res = await db.execute(select(MenuItem).where(MenuItem.id == grp.menu_item_id))
    item = item_res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Menu item not found")
    await _verify_menu_admin_access(item.branch_id, current_staff, db)
    m = MenuModifier(**data.model_dump())
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m
