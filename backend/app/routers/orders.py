"""Orders router — /api/orders  (kitchen board + WebSocket)"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models.orders import Order, OrderItem, OrderItemModifier, OrderStatus
from app.models.tenancy import Table
from app.services.order_service import create_order_from_cart, CheckoutError
from app.services.ws_manager import manager
from app.services.cache_service import cache

from app.bot.wa_sender import send_text
from app.models.tenancy import Restaurant, Branch
from app.models.customers import TableSession, Customer
from app.config import settings

router = APIRouter(prefix="/api/orders", tags=["orders"])


class PlaceOrderRequest(BaseModel):
    session_id: uuid.UUID
    parent_order_id: Optional[uuid.UUID] = None


class StatusUpdateRequest(BaseModel):
    status: OrderStatus


@router.post("/place")
async def place_order(data: PlaceOrderRequest, db: AsyncSession = Depends(get_db)):
    try:
        order = await create_order_from_cart(data.session_id, db, data.parent_order_id)
        # Broadcast to kitchen
        table_result = await db.execute(select(Table).where(Table.id == order.table_id))
        table = table_result.scalar_one()

        cache.invalidate_prefix(f"orders_board:{order.branch_id}")
        cache.invalidate_prefix(f"billing_tx:{order.branch_id}")
        cache.invalidate_prefix(f"corp_dashboard:{order.branch_id}")
        cache.invalidate_prefix(f"daily_report:{order.branch_id}")

        await manager.broadcast_to_branch(str(order.branch_id), {
            "event": "NEW_ORDER",
            "order_id": str(order.id),
            "order_number": order.order_number,
            "table_number": table.table_number,
            "total": str(order.total),
        })
        # Return updated state snapshot directly so frontend never needs to make a second GET request
        from app.routers.kiosk import _serialize_session_state
        from app.models.customers import TableSession
        sess_result = await db.execute(select(TableSession).where(TableSession.id == data.session_id))
        session = sess_result.scalar_one()
        state_snapshot = await _serialize_session_state(session, db, include_static_menu=False)

        return {
            "order_id": order.id,
            "order_number": order.order_number,
            "status": order.status,
            "state": state_snapshot,
        }
    except CheckoutError as e:
        raise HTTPException(400, str(e))


@router.get("")
async def list_orders(
    branch_id: uuid.UUID,
    status: Optional[OrderStatus] = None,
    db: AsyncSession = Depends(get_db),
):
    cache_key = f"orders_board:{branch_id}:{status.value if status else 'all'}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    q = select(Order).where(Order.branch_id == branch_id)
    if status:
        q = q.where(Order.status == status)
    q = q.options(
        selectinload(Order.table),
        selectinload(Order.items).selectinload(OrderItem.menu_item),
        selectinload(Order.items).selectinload(OrderItem.variant),
        selectinload(Order.items).selectinload(OrderItem.modifiers)
    ).order_by(Order.created_at.desc()).limit(60)
    result = await db.execute(q)
    orders = result.scalars().all()

    orders_out = []
    for o in orders:
        items_out = []
        for oi in o.items:
            items_out.append({
                "id": str(oi.id),
                "order_id": str(oi.order_id),
                "menu_item_id": str(oi.menu_item_id),
                "quantity": oi.quantity,
                "unit_price": float(oi.unit_price),
                "line_total": float(oi.line_total),
                "notes": oi.notes,
                "menu_item": {"id": str(oi.menu_item.id), "name": oi.menu_item.name} if oi.menu_item else None,
                "variant": {"id": str(oi.variant.id), "name": oi.variant.name} if oi.variant else None,
                "modifiers": [
                    {
                        "id": str(m.id),
                        "modifier_id": str(m.modifier_id),
                        "modifier_name_snapshot": m.modifier_name_snapshot,
                        "price_delta_snapshot": float(m.price_delta_snapshot),
                    }
                    for m in oi.modifiers
                ]
            })
        orders_out.append({
            "id": str(o.id),
            "branch_id": str(o.branch_id),
            "table_id": str(o.table_id),
            "table": {"id": str(o.table.id), "table_number": o.table.table_number} if o.table else None,
            "session_id": str(o.session_id),
            "order_number": o.order_number,
            "parent_order_id": str(o.parent_order_id) if o.parent_order_id else None,
            "cart_hash": o.cart_hash,
            "status": str(o.status.value if hasattr(o.status, "value") else o.status),
            "subtotal": float(o.subtotal),
            "cgst_amount": float(o.cgst_amount),
            "sgst_amount": float(o.sgst_amount),
            "total": float(o.total),
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "items": items_out,
        })

    cache.set(cache_key, orders_out, ttl_seconds=10)
    return orders_out


@router.get("/{order_id}")
async def get_order(order_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Order).where(Order.id == order_id)
        .options(
            selectinload(Order.table),
            selectinload(Order.items).selectinload(OrderItem.menu_item),
            selectinload(Order.items).selectinload(OrderItem.variant),
            selectinload(Order.items).selectinload(OrderItem.modifiers)
        )
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Order not found")
    return order


@router.patch("/{order_id}/status")
async def update_status(order_id: uuid.UUID, data: StatusUpdateRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Order)
        .where(Order.id == order_id)
        .options(selectinload(Order.session).selectinload(TableSession.customer))
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Order not found")

    old_status = order.status
    if old_status == data.status:
        return {"ok": True, "status": order.status}

    order.status = data.status
    await db.commit()

    cache.invalidate_prefix(f"orders_board:{order.branch_id}")
    cache.invalidate_prefix(f"billing_tx:{order.branch_id}")
    cache.invalidate_prefix(f"corp_dashboard:{order.branch_id}")
    cache.invalidate_prefix(f"daily_report:{order.branch_id}")

    # 1. Broadcast status update instantly to kitchen PWA & Cashier via WebSocket (0ms lag)
    status_str = str(order.status.value if hasattr(order.status, "value") else order.status)
    await manager.broadcast_to_branch(str(order.branch_id), {
        "event": "ORDER_STATUS_UPDATED",
        "order_id": str(order.id),
        "order_number": order.order_number,
        "status": status_str,
    })

    # 1b. Broadcast status update to Customer Table Tablet UI
    await manager.broadcast_to_table(str(order.session_id), {
        "event": "ORDER_STATUS_UPDATED",
        "order_id": str(order.id),
        "order_number": order.order_number,
        "status": status_str,
    })

    # Only recalculate session bill if an order was CANCELLED
    if data.status == OrderStatus.CANCELLED:
        try:
            from app.services.billing_service import sync_session_bill
            await sync_session_bill(order.session_id, db)
        except Exception as bill_err:
            print(f"Warning: bill sync on order cancellation failed: {bill_err}")

    # 2. WhatsApp Notification in Background (non-blocking, and skip tablet kiosk sessions)
    raw_phone = order.session.customer.wa_user_id if order.session and order.session.customer else None
    if raw_phone and not raw_phone.startswith("kiosk_") and data.status != old_status and data.status != OrderStatus.NEW:
        import asyncio
        async def _send_wa_background(phone_str: str, ord_num: str, new_st: OrderStatus, b_id: uuid.UUID):
            try:
                from app.database import AsyncSessionLocal
                async with AsyncSessionLocal() as bg_db:
                    branch_res = await bg_db.execute(select(Branch).where(Branch.id == b_id))
                    br = branch_res.scalar_one_or_none()
                    if br:
                        rest_res = await bg_db.execute(select(Restaurant).where(Restaurant.id == br.restaurant_id))
                        rst = rest_res.scalar_one_or_none()
                        wa_pid = (rst.whatsapp_phone_number_id if rst else None) or settings.WA_PHONE_NUMBER_ID
                        wa_tok = (rst.whatsapp_access_token if rst else None) or settings.WA_ACCESS_TOKEN
                        clean_num = "".join(filter(str.isdigit, phone_str))
                        if clean_num and wa_pid and wa_tok:
                            status_msgs = {
                                OrderStatus.ACCEPTED: f"✅ Your order *#{ord_num}* has been accepted by the kitchen!",
                                OrderStatus.PREPARING: f"👨‍🍳 We are now preparing your order *#{ord_num}*.",
                                OrderStatus.READY: f"🔔 Hot & Ready! Your order *#{ord_num}* is ready to be served.",
                                OrderStatus.SERVED: f"🍽️ Your order *#{ord_num}* has been served. Enjoy your meal!",
                                OrderStatus.CANCELLED: f"⚠️ Your order *#{ord_num}* has been cancelled.",
                            }
                            msg = status_msgs.get(new_st)
                            if msg:
                                await send_text(clean_num, msg, wa_pid, wa_tok)
            except Exception as e:
                print(f"Background WhatsApp notification skipped: {e}")

        asyncio.create_task(_send_wa_background(raw_phone, order.order_number, data.status, order.branch_id))

    return {"ok": True, "status": order.status}


@router.websocket("/ws/kitchen/{branch_id}")
async def kitchen_ws(websocket: WebSocket, branch_id: str):
    await manager.connect(websocket, branch_id)
    try:
        while True:
            await websocket.receive_text()  # heartbeat
    except WebSocketDisconnect:
        manager.disconnect(websocket, branch_id)


@router.websocket("/ws/table/{session_id}")
async def table_ws(websocket: WebSocket, session_id: str):
    await manager.connect_table(websocket, session_id)
    try:
        while True:
            await websocket.receive_text()  # heartbeat
    except WebSocketDisconnect:
        manager.disconnect_table(websocket, session_id)

