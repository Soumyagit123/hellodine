"""Order service — checkout_guard + order creation + kitchen dispatch."""
import uuid
from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.cart import Cart, CartItem, CartItemModifier, CartStatus
from app.models.orders import Order, OrderItem, OrderItemModifier, OrderStatus
from app.models.menu import MenuItem
from app.models.customers import TableSession, SessionStatus
from app.services.cart_service import compute_cart_hash, recalculate_cart
from app.services.cache_service import cache


class CheckoutError(Exception):
    pass


async def checkout_guard(session_id: uuid.UUID, db: AsyncSession) -> tuple[Cart, list[CartItem], str, TableSession, dict[uuid.UUID, MenuItem]]:
    """Validate cart before creating an order. Raises CheckoutError on failure."""
    import time
    t0 = time.perf_counter()

    # 1. Session must be ACTIVE
    sess_result = await db.execute(
        select(TableSession).where(TableSession.id == session_id)
    )
    session = sess_result.scalar_one_or_none()
    if not session or session.status != SessionStatus.ACTIVE:
        raise CheckoutError("Session is not active")
    t1 = time.perf_counter()

    # 2. Cart must exist and be open
    cart_result = await db.execute(
        select(Cart).where(Cart.session_id == session_id, Cart.status == CartStatus.OPEN)
        .options(selectinload(Cart.items).selectinload(CartItem.modifiers))
        .order_by(Cart.updated_at.desc())
    )
    open_carts = cart_result.scalars().all()
    if not open_carts:
        raise CheckoutError("Cart is empty")
    t2 = time.perf_counter()

    # Pick the cart that has items (or the latest one)
    cart = next((c for c in open_carts if c.items), open_carts[0])
    if not cart or not cart.items:
        raise CheckoutError("Cart is empty")

    # Clean up any duplicate open carts so they never conflict
    for extra in open_carts:
        if extra.id != cart.id:
            extra.status = CartStatus.CHECKED_OUT

    items = cart.items

    # 3. All items must still be available — Check from RAM Static Menu cache if present, else batch DB query
    cached_static = cache.get(f"static_menu:{session.branch_id}")
    menu_items_map: dict[uuid.UUID, dict] = {}
    if cached_static and "menu_items" in cached_static:
        for mi in cached_static["menu_items"]:
            try:
                m_uid = uuid.UUID(mi["id"])
                menu_items_map[m_uid] = mi
            except Exception:
                pass

    missing_uids = [ci.menu_item_id for ci in items if ci.menu_item_id not in menu_items_map]
    if missing_uids:
        items_res = await db.execute(select(MenuItem).where(MenuItem.id.in_(missing_uids)))
        for m in items_res.scalars().all():
            menu_items_map[m.id] = {
                "id": str(m.id),
                "name": m.name,
                "is_available": m.is_available,
                "hsn_code": m.hsn_code,
            }
    t3 = time.perf_counter()

    for ci in items:
        menu_item = menu_items_map.get(ci.menu_item_id)
        if not menu_item:
            raise CheckoutError(f"Menu item {ci.menu_item_id} no longer exists")
        if not menu_item.get("is_available", True):
            raise CheckoutError(f"Item '{menu_item.get('name')}' is no longer available")

    # 4. Idempotency: in-memory cache check (0ms instead of cross-continent DB roundtrip)
    cart_hash = compute_cart_hash(session_id, items)
    if cache.get(f"order_hash:{session_id}:{cart_hash}"):
        raise CheckoutError("Duplicate order detected — please wait a moment before retrying")
    cache.set(f"order_hash:{session_id}:{cart_hash}", True, ttl_seconds=20)
    t4 = time.perf_counter()

    return cart, items, cart_hash, session, menu_items_map


async def create_order_from_cart(
    session_id: uuid.UUID,
    db: AsyncSession,
    parent_order_id: uuid.UUID | None = None,
) -> Order:
    import time
    t0 = time.perf_counter()
    cart, items, cart_hash, session, menu_items_map = await checkout_guard(session_id, db)
    t_guard = time.perf_counter()

    # Generate order number
    order_number = f"ORD-{int(time.time() * 1000) % 10_000_000}"

    order = Order(
        branch_id=session.branch_id,
        table_id=session.table_id,
        session_id=session_id,
        order_number=order_number,
        parent_order_id=parent_order_id,
        cart_hash=cart_hash,
        status=OrderStatus.NEW,
        subtotal=cart.subtotal,
        cgst_amount=cart.cgst_amount,
        sgst_amount=cart.sgst_amount,
        total=cart.total,
    )

    # Attach all items and modifiers using relationship cascade (ZERO extra flush round-trips!)
    order_items_list = []
    for ci in items:
        menu_item = menu_items_map.get(ci.menu_item_id) or {}
        oi = OrderItem(
            menu_item_id=ci.menu_item_id,
            variant_id=ci.variant_id,
            quantity=ci.quantity,
            unit_price=ci.unit_price,
            notes=ci.notes,
            line_total=ci.line_total,
            hsn_code_snapshot=menu_item.get("hsn_code"),
        )
        for cim in ci.modifiers:
            oim = OrderItemModifier(
                modifier_id=cim.modifier_id,
                modifier_name_snapshot=cim.modifier_name_snapshot,
                price_delta_snapshot=cim.price_delta_snapshot,
            )
            oi.modifiers.append(oim)
        order_items_list.append(oi)

    order.items = order_items_list
    db.add(order)

    # Mark cart as checked out
    cart.status = CartStatus.CHECKED_OUT
    t_prep = time.perf_counter()

    # Single atomic commit for Order + Items + Modifiers + Cart checkout!
    await db.commit()

    # Invalidate dashboard and billing caches so staff screens immediately reflect the new order
    cache.invalidate_prefix(f"orders_board:{order.branch_id}")
    cache.invalidate_prefix(f"billing_tx:{order.branch_id}")
    cache.invalidate_prefix(f"corp_dashboard:{order.branch_id}")
    cache.invalidate_prefix(f"daily_report:{order.branch_id}")

    # Synchronize the session's UNPAID Bill in the background (non-blocking) so customer order returns instantly
    import asyncio
    async def _sync_bill_bg(sess_id: uuid.UUID):
        try:
            from app.database import AsyncSessionLocal
            from app.services.billing_service import sync_session_bill
            async with AsyncSessionLocal() as bg_db:
                await sync_session_bill(sess_id, bg_db, commit=True)
        except Exception as b_err:
            print(f"Warning: background bill sync failed: {b_err}")

    asyncio.create_task(_sync_bill_bg(session.id))
    t_bill = time.perf_counter()

    return order
