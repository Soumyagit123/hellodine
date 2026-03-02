"""Cart service — GST computation, add/remove/update items."""
import uuid
import hashlib
import json
from decimal import Decimal, ROUND_HALF_UP
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.cart import Cart, CartItem, CartItemModifier, CartStatus
from app.models.menu import MenuItem, MenuItemVariant, MenuModifier
from app.models.customers import TableSession


def _round2(val: Decimal) -> Decimal:
    return val.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def get_or_create_cart(session_id: uuid.UUID, db: AsyncSession) -> Cart:
    result = await db.execute(
        select(Cart).where(Cart.session_id == session_id, Cart.status == CartStatus.OPEN)
        .options(selectinload(Cart.items).selectinload(CartItem.modifiers))
    )
    cart = result.scalar_one_or_none()
    if not cart:
        cart = Cart(session_id=session_id)
        db.add(cart)
        await db.flush()
    return cart


async def recalculate_cart(cart: Cart, db: AsyncSession):
    """Recompute subtotal, CGST, SGST, total from cart items."""
    result = await db.execute(
        select(CartItem).where(CartItem.cart_id == cart.id)
        .options(selectinload(CartItem.modifiers))
    )
    items = result.scalars().all()

    subtotal = Decimal("0")
    cgst = Decimal("0")
    sgst = Decimal("0")

    for ci in items:
        # Get GST percent from menu_item
        item_result = await db.execute(select(MenuItem).where(MenuItem.id == ci.menu_item_id))
        menu_item = item_result.scalar_one_or_none()
        if not menu_item:
            print(f"WARNING: MenuItem {ci.menu_item_id} not found for cart item {ci.id}")
            continue
        gst_rate = Decimal(str(menu_item.gst_percent)) / 100

        modifier_total = sum(Decimal(str(m.price_delta_snapshot)) for m in ci.modifiers)
        unit = Decimal(str(ci.unit_price)) + modifier_total
        line = unit * ci.quantity
        ci.line_total = float(_round2(line))

        half_gst = gst_rate / 2
        cgst += line * half_gst
        sgst += line * half_gst
        subtotal += line

    round_off = _round2(-(subtotal + cgst + sgst) % Decimal("1")) if (subtotal + cgst + sgst) % 1 >= Decimal("0.5") else Decimal("0")

    cart.subtotal = float(_round2(subtotal))
    cart.cgst_amount = float(_round2(cgst))
    cart.sgst_amount = float(_round2(sgst))
    cart.total = float(_round2(subtotal + cgst + sgst + round_off + Decimal(str(cart.service_charge)) - Decimal(str(cart.discount))))
    cart.round_off = float(round_off)


async def add_item_to_cart(
    session_id: uuid.UUID,
    menu_item_id: uuid.UUID,
    quantity: int,
    db: AsyncSession,
    variant_id: uuid.UUID | None = None,
    modifier_ids: list[uuid.UUID] | None = None,
    notes: str | None = None,
) -> Cart:
    cart = await get_or_create_cart(session_id, db)

    item_result = await db.execute(select(MenuItem).where(MenuItem.id == menu_item_id))
    menu_item = item_result.scalar_one_or_none()
    if not menu_item or not menu_item.is_available:
        raise ValueError("Item not available")

    # Check if item already exists in cart with same variant and notes
    existing_result = await db.execute(
        select(CartItem).where(
            CartItem.cart_id == cart.id,
            CartItem.menu_item_id == menu_item_id,
            CartItem.variant_id == variant_id,
            CartItem.notes == notes
        )
    )
    cart_item = existing_result.scalar_one_or_none()

    if cart_item:
        cart_item.quantity += quantity
        cart_item.line_total = float(_round2(Decimal(str(cart_item.unit_price)) * cart_item.quantity))
    else:
        unit_price = menu_item.base_price
        if variant_id:
            v_result = await db.execute(select(MenuItemVariant).where(MenuItemVariant.id == variant_id))
            variant = v_result.scalar_one_or_none()
            if variant:
                unit_price = variant.price

        cart_item = CartItem(
            cart_id=cart.id,
            menu_item_id=menu_item_id,
            variant_id=variant_id,
            quantity=quantity,
            unit_price=unit_price,
            notes=notes,
            line_total=float(_round2(Decimal(str(unit_price)) * quantity)),
        )
        db.add(cart_item)
        await db.flush()

        if modifier_ids:
            for mod_id in modifier_ids:
                mod_result = await db.execute(select(MenuModifier).where(MenuModifier.id == mod_id))
                mod = mod_result.scalar_one_or_none()
                if mod:
                    cim = CartItemModifier(
                        cart_item_id=cart_item.id,
                        modifier_id=mod_id,
                        modifier_name_snapshot=mod.name,
                        price_delta_snapshot=mod.price_delta,
                    )
                    db.add(cim)

    await db.flush()
    await recalculate_cart(cart, db)
    await db.commit()
    return cart


async def update_cart_item_quantity(cart_item_id: uuid.UUID, delta: int, db: AsyncSession) -> Cart:
    """Increment (+1) or decrement (-1) quantity. Deletes if quantity reaches 0."""
    result = await db.execute(select(CartItem).where(CartItem.id == cart_item_id))
    ci = result.scalar_one_or_none()
    if not ci:
        raise ValueError("Item not in cart")
    
    ci.quantity += delta
    if ci.quantity <= 0:
        await db.delete(ci)
    else:
        ci.line_total = float(_round2(Decimal(str(ci.unit_price)) * ci.quantity))
    
    await db.flush()
    cart_result = await db.execute(select(Cart).where(Cart.id == ci.cart_id))
    cart = cart_result.scalar_one()
    
    await recalculate_cart(cart, db)
    await db.commit()
    return cart


async def remove_cart_item(cart_item_id: uuid.UUID, db: AsyncSession) -> Cart:
    result = await db.execute(select(CartItem).where(CartItem.id == cart_item_id))
    ci = result.scalar_one_or_none()
    if not ci:
        raise ValueError("Cart item not found")
    cart_result = await db.execute(select(Cart).where(Cart.id == ci.cart_id))
    cart = cart_result.scalar_one_or_none()
    if not cart:
        raise ValueError("Cart not found for item")
    await db.delete(ci)
    await db.flush()
    await recalculate_cart(cart, db)
    await db.commit()
    return cart


def compute_cart_hash(session_id: uuid.UUID, items: list[CartItem]) -> str:
    """Compute idempotency hash for checkout guard."""
    import time
    bucket = str(int(time.time()) // 30)
    payload = json.dumps(
        {
            "session_id": str(session_id),
            "bucket": bucket,
            "items": sorted([
                {"item": str(i.menu_item_id), "qty": i.quantity, "variant": str(i.variant_id)}
                for i in items
            ], key=lambda x: x["item"]),
        },
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()
