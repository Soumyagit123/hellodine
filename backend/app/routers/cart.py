"""Cart router — /api/cart"""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models.cart import Cart, CartItem, CartStatus
from app.models.menu import MenuItem
from app.services.cart_service import add_item_to_cart, remove_cart_item, get_or_create_cart

router = APIRouter(prefix="/api/cart", tags=["cart"])


async def _serialize_cart_fast(cart: Cart, db: AsyncSession) -> dict:
    """Return full serialized cart payload in 1 query so frontend never needs a second GET /session call."""
    ci_res = await db.execute(
        select(CartItem, MenuItem)
        .outerjoin(MenuItem, CartItem.menu_item_id == MenuItem.id)
        .where(CartItem.cart_id == cart.id)
    )
    rows = ci_res.all()
    items_out = []
    for ci, mi in rows:
        items_out.append({
            "id": str(ci.id),
            "menu_item_id": str(ci.menu_item_id),
            "name": mi.name if mi else "Item",
            "is_veg": mi.is_veg if mi else True,
            "gst_percent": mi.gst_percent if mi else 5,
            "quantity": ci.quantity,
            "unit_price": float(ci.unit_price),
            "line_total": float(ci.line_total),
            "notes": ci.notes,
        })
    return {
        "id": str(cart.id),
        "subtotal": float(cart.subtotal),
        "cgst_amount": float(cart.cgst_amount),
        "sgst_amount": float(cart.sgst_amount),
        "total": float(cart.total),
        "items": items_out,
    }


class AddItemRequest(BaseModel):
    session_id: uuid.UUID
    menu_item_id: uuid.UUID
    quantity: int = 1
    variant_id: Optional[uuid.UUID] = None
    modifier_ids: Optional[list[uuid.UUID]] = None
    notes: Optional[str] = None


class UpdateQuantityRequest(BaseModel):
    quantity: int


@router.post("/add")
async def add_item(data: AddItemRequest, db: AsyncSession = Depends(get_db)):
    try:
        cart = await add_item_to_cart(
            session_id=data.session_id,
            menu_item_id=data.menu_item_id,
            quantity=data.quantity,
            db=db,
            variant_id=data.variant_id,
            modifier_ids=data.modifier_ids,
            notes=data.notes,
        )
        cart_payload = await _serialize_cart_fast(cart, db)
        return {"ok": True, "cart_id": cart.id, "total": cart.total, "cart": cart_payload}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/item/{cart_item_id}")
async def remove_item(cart_item_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    try:
        cart = await remove_cart_item(cart_item_id, db)
        cart_payload = await _serialize_cart_fast(cart, db)
        return {"ok": True, "total": cart.total, "cart": cart_payload}
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.patch("/item/{cart_item_id}/quantity")
async def update_quantity(cart_item_id: uuid.UUID, data: UpdateQuantityRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CartItem).where(CartItem.id == cart_item_id))
    ci = result.scalar_one_or_none()
    if not ci:
        raise HTTPException(404, "Cart item not found")
    if data.quantity <= 0:
        cart = await remove_cart_item(cart_item_id, db)
        cart_payload = await _serialize_cart_fast(cart, db)
        return {"ok": True, "total": cart.total, "cart": cart_payload}
    ci.quantity = data.quantity
    cart_result = await db.execute(
        select(Cart).where(Cart.id == ci.cart_id)
        .options(selectinload(Cart.items))
    )
    cart = cart_result.scalar_one()
    from app.services.cart_service import recalculate_cart
    await recalculate_cart(cart, db)
    await db.commit()
    cart_payload = await _serialize_cart_fast(cart, db)
    return {"ok": True, "total": cart.total, "cart": cart_payload}


@router.delete("/{session_id}/clear")
async def clear_entire_cart(session_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Clear all items in the session's open cart in a single atomic SQL DELETE."""
    result = await db.execute(
        select(Cart).where(Cart.session_id == session_id, Cart.status == CartStatus.OPEN)
    )
    cart = result.scalars().first()
    if not cart:
        return {
            "ok": True,
            "total": 0.0,
            "cart": {"id": None, "subtotal": 0.0, "cgst_amount": 0.0, "sgst_amount": 0.0, "total": 0.0, "items": []},
        }
    await db.execute(delete(CartItem).where(CartItem.cart_id == cart.id))
    cart.subtotal = 0
    cart.cgst_amount = 0
    cart.sgst_amount = 0
    cart.total = 0
    await db.commit()
    return {
        "ok": True,
        "total": 0.0,
        "cart": {
            "id": str(cart.id),
            "subtotal": 0.0,
            "cgst_amount": 0.0,
            "sgst_amount": 0.0,
            "total": 0.0,
            "items": [],
        },
    }


@router.get("/{session_id}")
async def get_cart(session_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Cart).where(Cart.session_id == session_id, Cart.status == CartStatus.OPEN)
        .options(selectinload(Cart.items).selectinload(CartItem.modifiers))
        .order_by(Cart.updated_at.desc())
    )
    carts = result.scalars().all()
    if not carts:
        return {"items": [], "total": 0}
    cart = next((c for c in carts if c.items), carts[0])
    return cart
