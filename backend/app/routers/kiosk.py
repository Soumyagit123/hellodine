"""Kiosk router — /api/kiosk (Smart Table Tablet UI, AI Chat/Voice, & Table QR Payment)"""
import uuid
import time
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.tenancy import Restaurant, Branch, Table, TableQRToken
from app.models.customers import Customer, TableSession, SessionStatus
from app.models.menu import MenuCategory, MenuItem
from app.models.cart import Cart, CartItem, CartStatus
from app.models.orders import Order, OrderItem, OrderStatus
from app.models.billing import Bill, Payment, BillStatus, PaymentMethod
from app.bot.graph import compiled_graph
from app.services.ws_manager import manager
from app.services.cache_service import cache
from app.config import settings


router = APIRouter(prefix="/api/kiosk", tags=["kiosk"])


class StartSessionRequest(BaseModel):
    token: Optional[str] = None
    table_id: Optional[uuid.UUID] = None
    customer_name: Optional[str] = None
    customer_dob: Optional[str] = None
    force_new: Optional[bool] = False


class CustomerCheckinRequest(BaseModel):
    customer_name: str
    customer_dob: Optional[str] = None
    is_birthday_today: Optional[bool] = False



class ChatMessageRequest(BaseModel):
    session_id: uuid.UUID
    message: str


class TableQRPayRequest(BaseModel):
    upi_reference_id: Optional[str] = None
    upi_vpa: Optional[str] = None


async def _serialize_session_state(session: TableSession, db: AsyncSession, include_static_menu: bool = True) -> dict:
    """Return table session state: restaurant, branch, table, cart, orders, and bill (optionally skipping static menu on chat/polling)."""
    meta = cache.get(f"session_meta:{session.id}")
    if not meta:
        table_res = await db.execute(select(Table).where(Table.id == session.table_id))
        table = table_res.scalar_one()
        cust_res = await db.execute(select(Customer).where(Customer.id == session.customer_id))
        customer = cust_res.scalar_one_or_none()
        meta = {
            "table_id": str(table.id),
            "table_number": table.table_number,
            "customer_id": str(customer.id) if customer else None,
            "customer_name": customer.name if customer else f"Table {table.table_number} Guest",
        }
        cache.set(f"session_meta:{session.id}", meta, ttl_seconds=600)

    cached_static = None
    if include_static_menu:
        cached_static = cache.get(f"static_menu:{session.branch_id}")
        if not cached_static:
            branch_res = await db.execute(select(Branch).where(Branch.id == session.branch_id))
            branch = branch_res.scalar_one()

            rest_res = await db.execute(select(Restaurant).where(Restaurant.id == session.restaurant_id))
            restaurant = rest_res.scalar_one()

            # Categories & Items
            cats_res = await db.execute(
                select(MenuCategory)
                .where(MenuCategory.branch_id == branch.id, MenuCategory.is_active == True)
                .order_by(MenuCategory.sort_order)
            )
            categories = cats_res.scalars().all()

            items_res = await db.execute(
                select(MenuItem)
                .where(MenuItem.branch_id == branch.id, MenuItem.is_available == True)
                .order_by(MenuItem.name)
            )
            menu_items = items_res.scalars().all()

            cached_static = {
                "restaurant": {
                    "id": str(restaurant.id),
                    "name": restaurant.name,
                    "gstin": restaurant.gstin or branch.gstin,
                    "fssai": restaurant.fssai_license_number,
                    "upi_id": restaurant.merchant_upi_id or settings.MERCHANT_UPI_ID,
                    "subscription_plan": getattr(restaurant, "subscription_plan", "STARTER") or "STARTER",
                    "subscription_status": getattr(restaurant, "subscription_status", "ACTIVE") or "ACTIVE",
                },
                "branch": {
                    "id": str(branch.id),
                    "name": branch.name,
                    "address": branch.address,
                    "city": branch.city,
                    "state": branch.state,
                    "gstin": branch.gstin or restaurant.gstin,
                },
                "categories": [
                    {
                        "id": str(c.id),
                        "name": c.name,
                        "sort_order": c.sort_order,
                        "estimated_prep_minutes": c.estimated_prep_minutes,
                    }
                    for c in categories
                ],
                "menu_items": [
                    {
                        "id": str(m.id),
                        "category_id": str(m.category_id),
                        "name": m.name,
                        "description": m.description,
                        "base_price": float(m.base_price),
                        "gst_percent": m.gst_percent,
                        "is_veg": m.is_veg,
                        "is_jain": m.is_jain,
                        "is_bestseller": getattr(m, "is_bestseller", False) or False,
                        "spice_level": str(m.spice_level.value if hasattr(m.spice_level, "value") else m.spice_level) if m.spice_level else None,
                    }
                    for m in menu_items
                ],
            }
            cache.set(f"static_menu:{session.branch_id}", cached_static, ttl_seconds=300)

    # Open Cart (single JOIN query so we never loop over MenuItem)
    cart_res = await db.execute(
        select(Cart).where(Cart.session_id == session.id, Cart.status == CartStatus.OPEN)
    )
    cart = cart_res.scalars().first()

    cart_items_out = []
    if cart:
        ci_rows_res = await db.execute(
            select(CartItem, MenuItem)
            .outerjoin(MenuItem, CartItem.menu_item_id == MenuItem.id)
            .where(CartItem.cart_id == cart.id)
        )
        for ci, mi in ci_rows_res.all():
            cart_items_out.append({
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

    # Placed Orders
    orders_res = await db.execute(
        select(Order)
        .where(Order.session_id == session.id)
        .options(selectinload(Order.items).selectinload(OrderItem.menu_item))
        .order_by(Order.created_at.desc())
    )
    orders = orders_res.scalars().all()
    orders_out = []
    for o in orders:
        o_items = []
        for oi in o.items:
            o_items.append({
                "id": str(oi.id),
                "menu_item_id": str(oi.menu_item_id),
                "name": oi.menu_item.name if oi.menu_item else "Item",
                "quantity": oi.quantity,
                "unit_price": float(oi.unit_price),
                "line_total": float(oi.line_total),
                "notes": oi.notes,
            })
        orders_out.append({
            "id": str(o.id),
            "order_number": o.order_number,
            "status": str(o.status.value if hasattr(o.status, "value") else o.status),
            "subtotal": float(o.subtotal),
            "cgst_amount": float(o.cgst_amount),
            "sgst_amount": float(o.sgst_amount),
            "total": float(o.total),
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "items": o_items,
        })

    # Bill (Unpaid or Paid for this session)
    bill_res = await db.execute(
        select(Bill).where(Bill.session_id == session.id).order_by(Bill.created_at.desc())
    )
    bill = bill_res.scalars().first()
    bill_out = None
    is_paid_or_closed = (session.status == SessionStatus.CLOSED)
    if bill:
        bill_status_str = str(bill.status.value if hasattr(bill.status, "value") else bill.status)
        if bill_status_str == "PAID":
            is_paid_or_closed = True
        bill_out = {
            "id": str(bill.id),
            "bill_number": bill.bill_number,
            "subtotal": float(bill.subtotal),
            "cgst_amount": float(bill.cgst_amount),
            "sgst_amount": float(bill.sgst_amount),
            "total": float(bill.total),
            "status": bill_status_str,
            "created_at": bill.created_at.isoformat() if bill.created_at else None,
            "closed_at": bill.closed_at.isoformat() if bill.closed_at else None,
        }

    # Never expose old orders or cart items if session is already PAID or CLOSED
    if is_paid_or_closed:
        orders_out = []
        cart_items_out = []
        cart = None

    payload_out: dict = {
        "session": {
            "id": str(session.id),
            "status": str(session.status.value if hasattr(session.status, "value") else session.status),
            "started_at": session.started_at.isoformat() if session.started_at else None,
        },
        "customer": {
            "id": meta["customer_id"],
            "name": meta["customer_name"],
        },
        "table": {
            "id": meta["table_id"],
            "table_number": meta["table_number"],
        },
        "cart": {
            "id": str(cart.id) if cart else None,
            "subtotal": float(cart.subtotal) if cart else 0.0,
            "cgst_amount": float(cart.cgst_amount) if cart else 0.0,
            "sgst_amount": float(cart.sgst_amount) if cart else 0.0,
            "total": float(cart.total) if cart else 0.0,
            "items": cart_items_out,
        },
        "orders": orders_out,
        "bill": bill_out,
    }

    if include_static_menu and cached_static:
        payload_out.update(cached_static)

    return payload_out


@router.get("/tables-list")
async def list_public_tables(db: AsyncSession = Depends(get_db)):
    """Return available branches and tables so a tablet can bind to a table easily."""
    rest_res = await db.execute(select(Restaurant).where(Restaurant.is_active == True).order_by(Restaurant.created_at.desc()))
    restaurants = rest_res.scalars().all()
    out = []
    for r in restaurants:
        br_res = await db.execute(select(Branch).where(Branch.restaurant_id == r.id))
        branches = br_res.scalars().all()
        for b in branches:
            t_res = await db.execute(select(Table).where(Table.branch_id == b.id, Table.is_active == True).order_by(Table.table_number))
            tables = t_res.scalars().all()
            out.append({
                "restaurant_id": str(r.id),
                "restaurant_name": r.name,
                "branch_id": str(b.id),
                "branch_name": b.name,
                "tables": [{"id": str(t.id), "table_number": t.table_number} for t in tables],
            })
    return out


@router.post("/session/start")
async def start_table_session(data: StartSessionRequest, db: AsyncSession = Depends(get_db)):
    """Start or resume an active TableSession for a Tablet Kiosk using token or table_id."""
    table = None
    if data.token:
        tok_res = await db.execute(
            select(TableQRToken).where(TableQRToken.token == data.token, TableQRToken.is_revoked == False)
        )
        tok = tok_res.scalar_one_or_none()
        if not tok:
            raise HTTPException(404, "Invalid or expired table token")
        t_res = await db.execute(select(Table).where(Table.id == tok.table_id, Table.is_active == True))
        table = t_res.scalar_one_or_none()
    elif data.table_id:
        t_res = await db.execute(select(Table).where(Table.id == data.table_id, Table.is_active == True))
        table = t_res.scalar_one_or_none()

    if not table:
        raise HTTPException(404, "Table not found or inactive")

    branch_res = await db.execute(select(Branch).where(Branch.id == table.branch_id))
    branch = branch_res.scalar_one()

    now = datetime.now(timezone.utc)

    # Check if there are ACTIVE sessions on this table
    existing_sess_res = await db.execute(
        select(TableSession)
        .where(TableSession.table_id == table.id, TableSession.status == SessionStatus.ACTIVE)
        .order_by(TableSession.started_at.desc())
    )
    active_sessions = existing_sess_res.scalars().all()

    # Reconcile any sessions in active_sessions that actually already have a PAID or CLOSED bill
    clean_active_sessions = []
    for s in active_sessions:
        paid_or_closed_res = await db.execute(
            select(Bill).where(
                Bill.session_id == s.id,
                Bill.status.in_([BillStatus.PAID, BillStatus.CLOSED])
            )
        )
        if paid_or_closed_res.scalars().first() is not None:
            s.status = SessionStatus.CLOSED
            s.closed_at = s.closed_at or now
            old_carts_res = await db.execute(select(Cart).where(Cart.session_id == s.id, Cart.status == CartStatus.OPEN))
            for oc in old_carts_res.scalars().all():
                await db.delete(oc)
        else:
            clean_active_sessions.append(s)

    should_start_new = bool(data.force_new or len(clean_active_sessions) == 0)

    if not should_start_new and clean_active_sessions:
        primary_session = clean_active_sessions[0]
        placed_orders_res = await db.execute(
            select(Order).where(Order.session_id == primary_session.id, Order.status.notin_([OrderStatus.CANCELLED]))
        )
        has_placed_orders = placed_orders_res.scalars().first() is not None

        delta = now - (primary_session.last_message_at or now)
        if (not has_placed_orders) or delta.total_seconds() > (2 * 3600):
            should_start_new = True

    if should_start_new:
        # Close ALL existing active sessions and their carts / pending bills on this table
        for s in active_sessions:
            s.status = SessionStatus.CLOSED
            s.closed_at = now
            old_carts_res = await db.execute(select(Cart).where(Cart.session_id == s.id, Cart.status == CartStatus.OPEN))
            for oc in old_carts_res.scalars().all():
                await db.delete(oc)
            unpaid_bills_res = await db.execute(select(Bill).where(Bill.session_id == s.id, Bill.status == BillStatus.UNPAID))
            for ub in unpaid_bills_res.scalars().all():
                ub.status = BillStatus.CLOSED
                ub.closed_at = now

        # Create a brand new dedicated Customer record for the new session
        customer = Customer(
            restaurant_id=branch.restaurant_id,
            wa_user_id=f"kiosk_sess_{uuid.uuid4()}",
            name=f"Table {table.table_number} Guest",
        )
        db.add(customer)
        await db.flush()

        session = TableSession(
            restaurant_id=branch.restaurant_id,
            branch_id=branch.id,
            table_id=table.id,
            customer_id=customer.id,
            status=SessionStatus.ACTIVE,
        )
        db.add(session)
        await db.commit()
        await db.refresh(session)
    else:
        session = clean_active_sessions[0]
        # Clean up any duplicate older active sessions on this table
        for extra_s in clean_active_sessions[1:]:
            extra_s.status = SessionStatus.CLOSED
            extra_s.closed_at = now
        if data.customer_name:
            cust_res = await db.execute(select(Customer).where(Customer.id == session.customer_id))
            customer = cust_res.scalar_one_or_none()
            if customer:
                customer.name = data.customer_name.strip()
        await db.commit()

    cache.invalidate_prefix(f"session_meta:{session.id}")
    cache.invalidate_prefix(f"billing_tx:{session.branch_id}")
    cache.invalidate_prefix(f"corp_dashboard:{session.branch_id}")
    cache.invalidate_prefix(f"daily_report:{session.branch_id}")
    cache.invalidate_prefix(f"orders_board:{session.branch_id}")

    return await _serialize_session_state(session, db)


@router.post("/session/{session_id}/checkin")
async def checkin_session_customer(
    session_id: uuid.UUID,
    data: CustomerCheckinRequest,
    db: AsyncSession = Depends(get_db),
):
    """Save the customer's name for the active table session and check if today is their birthday."""
    sess_res = await db.execute(select(TableSession).where(TableSession.id == session_id))
    session = sess_res.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    cust_res = await db.execute(select(Customer).where(Customer.id == session.customer_id))
    customer = cust_res.scalar_one_or_none()
    clean_name = data.customer_name.strip() or "Valued Guest"
    if customer:
        customer.name = clean_name
        await db.commit()

    cache.invalidate_prefix(f"session_meta:{session.id}")
    cache.invalidate_prefix(f"billing_tx:{session.branch_id}")
    cache.invalidate_prefix(f"corp_dashboard:{session.branch_id}")
    cache.invalidate_prefix(f"daily_report:{session.branch_id}")
    cache.invalidate_prefix(f"orders_board:{session.branch_id}")

    is_birthday = bool(data.is_birthday_today)
    if data.customer_dob and not is_birthday:
        try:
            parts = data.customer_dob.strip().split("-")
            if len(parts) == 3:
                dob_month = int(parts[1])
                dob_day = int(parts[2])
                today_local = datetime.now()
                if today_local.month == dob_month and today_local.day == dob_day:
                    is_birthday = True
        except Exception:
            pass

    state_snapshot = await _serialize_session_state(session, db)
    return {
        "ok": True,
        "customer_name": clean_name,
        "is_birthday_today": is_birthday,
        "state": state_snapshot,
    }


@router.get("/session/{session_id}")
async def get_session_state(
    session_id: uuid.UUID,
    light: bool = False,
    db: AsyncSession = Depends(get_db),
):
    sess_res = await db.execute(select(TableSession).where(TableSession.id == session_id))
    session = sess_res.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    # If this session is CLOSED, check if there is an active session on this table
    if session.status != SessionStatus.ACTIVE:
        newer_res = await db.execute(
            select(TableSession)
            .where(TableSession.table_id == session.table_id, TableSession.status == SessionStatus.ACTIVE)
            .order_by(TableSession.started_at.desc())
        )
        newer_session = newer_res.scalars().first()
        if newer_session:
            return await _serialize_session_state(newer_session, db, include_static_menu=not light)

    return await _serialize_session_state(session, db, include_static_menu=not light)


@router.post("/chat")
async def kiosk_chat(data: ChatMessageRequest, db: AsyncSession = Depends(get_db)):
    """Run customer chat/voice message through the LangGraph AI Bot and return reply + UI actions + updated state."""
    sess_res = await db.execute(select(TableSession).where(TableSession.id == data.session_id))
    session = sess_res.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Table session not found.")

    if session.status != SessionStatus.ACTIVE:
        # Check if table has a newer active session to seamlessly continue
        newer_res = await db.execute(
            select(TableSession)
            .where(TableSession.table_id == session.table_id, TableSession.status == SessionStatus.ACTIVE)
            .order_by(TableSession.started_at.desc())
        )
        newer_session = newer_res.scalars().first()
        if newer_session:
            session = newer_session
        else:
            raise HTTPException(400, "Table session has expired or is closed. Please start a new session.")

    raw_lower = data.message.lower().strip()

    # Fast path for Order Confirmation (bypasses opening a second SSL connection to Australia!)
    if raw_lower in ("do_confirm", "confirm_order", "confirm", "confirm order"):
        try:
            from app.services.order_service import create_order_from_cart, CheckoutError
            order = await create_order_from_cart(session.id, db)

            table_result = await db.execute(select(Table).where(Table.id == order.table_id))
            table = table_result.scalar_one_or_none()
            table_num = table.table_number if table else "?"

            try:
                from app.routers.orders import manager
                await manager.broadcast_to_branch(str(order.branch_id), {
                    "event": "NEW_ORDER",
                    "order_id": str(order.id),
                    "order_number": order.order_number,
                    "table_number": table_num,
                    "total": str(order.total),
                })
            except Exception as ws_err:
                print(f"Kitchen broadcast error: {ws_err}")

            state_snapshot = await _serialize_session_state(session, db, include_static_menu=False)
            return {
                "intent": "PLACE_ORDER",
                "reply": {
                    "type": "buttons",
                    "body": (
                        f"✅ *Order #{order.order_number} confirmed & sent to the kitchen!*\n\n"
                        f"🍽️ Table: {table_num}\n"
                        f"💵 Total (incl. GST): ₹{order.total:.2f}\n\n"
                        "While your food is being prepared, would you like a joke, kids cartoons, or a special birthday wish? 😊"
                    ),
                    "voice_text": f"Your order number {order.order_number} for Rupees {order.total:.0f} has been confirmed and sent to the kitchen!",
                    "buttons": [
                        {"id": "tell_joke", "title": "😂 Hear a Joke"},
                        {"id": "show_cartoons", "title": "🎬 Kids Cartoons"},
                        {"id": "show_menu", "title": "📋 Order More"},
                    ],
                },
                "ui_action": {
                    "action": "ORDER_PLACED",
                    "order_id": str(order.id),
                    "order_number": order.order_number,
                    "total": float(order.total),
                },
                "state": state_snapshot,
            }
        except CheckoutError as e:
            state_snapshot = await _serialize_session_state(session, db, include_static_menu=False)
            return {
                "intent": "PLACE_ORDER",
                "reply": {"type": "text", "body": f"⚠️ {e}"},
                "state": state_snapshot,
            }

    initial_state = {
        "restaurant_id": str(session.restaurant_id),
        "branch_id": str(session.branch_id),
        "table_id": str(session.table_id),
        "session_id": str(session.id),
        "customer_id": str(session.customer_id),
        "wa_user_id": f"kiosk_table_{session.table_id}",
        "message_text": data.message,
        "message_type": "kiosk",
    }

    result = await compiled_graph.ainvoke(initial_state)
    final_response = result.get("final_response") or {
        "type": "text",
        "body": "I'm here to help! Ask me for menu items, jokes, cartoons, birthday wishes, or your GST bill.",
    }
    ui_action = result.get("ui_action")

    # Refresh only dynamic state (cart, orders, bill, customer) after bot execution — skip re-fetching all menu items!
    state_snapshot = await _serialize_session_state(session, db, include_static_menu=False)

    return {
        "intent": result.get("intent"),
        "reply": final_response,
        "ui_action": ui_action,
        "state": state_snapshot,
    }


@router.post("/session/{session_id}/pay-qr")
async def pay_bill_via_table_qr(session_id: uuid.UUID, data: TableQRPayRequest, db: AsyncSession = Depends(get_db)):
    """
    Generate (if needed) and mark the table's consolidated GST bill as PAID via Table UPI QR code.
    1. Marks Bill = PAID & records Payment.
    2. Closes/Expires TableSession.
    3. Sends real-time WebSocket notification to Cashier dashboard.
    4. Returns Goodbye message & paid receipt.
    """
    sess_res = await db.execute(select(TableSession).where(TableSession.id == session_id))
    session = sess_res.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    # Find or generate unpaid bill
    bill_res = await db.execute(
        select(Bill).where(Bill.session_id == session_id, Bill.status == BillStatus.UNPAID).order_by(Bill.created_at.desc())
    )
    existing_unpaid_bills = bill_res.scalars().all()
    bill = existing_unpaid_bills[0] if existing_unpaid_bills else None

    if not bill:
        orders_res = await db.execute(
            select(Order).where(
                Order.session_id == session_id,
                Order.status.notin_([OrderStatus.CANCELLED]),
            )
        )
        orders = orders_res.scalars().all()
        if not orders:
            raise HTTPException(400, "No orders found to bill for this table")

        subtotal = sum(float(o.subtotal) for o in orders)
        cgst = sum(float(o.cgst_amount) for o in orders)
        sgst = sum(float(o.sgst_amount) for o in orders)
        total = sum(float(o.total) for o in orders)

        bill = Bill(
            branch_id=session.branch_id,
            table_id=session.table_id,
            session_id=session_id,
            bill_number=f"BILL-{int(time.time() * 1000) % 10_000_000}",
            subtotal=subtotal,
            cgst_amount=cgst,
            sgst_amount=sgst,
            total=total,
            status=BillStatus.UNPAID,
        )
        db.add(bill)
        await db.flush()
    else:
        # Always recalculate from all non-cancelled orders in case new items were ordered after bill was first viewed
        orders_res = await db.execute(
            select(Order).where(
                Order.session_id == session_id,
                Order.status.notin_([OrderStatus.CANCELLED]),
            )
        )
        orders = orders_res.scalars().all()
        if orders:
            bill.subtotal = sum(float(o.subtotal) for o in orders)
            bill.cgst_amount = sum(float(o.cgst_amount) for o in orders)
            bill.sgst_amount = sum(float(o.sgst_amount) for o in orders)
            bill.total = sum(float(o.total) for o in orders)
            await db.flush()

    now = datetime.now(timezone.utc)
    ref_id = data.upi_reference_id or f"UPI-QR-{int(time.time())}"

    payment = Payment(
        bill_id=bill.id,
        method=PaymentMethod.UPI,
        amount=bill.total,
        upi_vpa=data.upi_vpa or "table-qr@upi",
        upi_reference_id=ref_id,
    )
    db.add(payment)

    bill.status = BillStatus.PAID
    bill.closed_at = now

    # Mark ALL other unpaid bills for this session as PAID/CLOSED so none remain pending
    for ob in existing_unpaid_bills:
        if ob.id != bill.id:
            ob.status = BillStatus.PAID
            ob.closed_at = now

    # Also reconcile any lingering unpaid bills for this table
    tbl_unpaid_res = await db.execute(
        select(Bill).where(Bill.table_id == session.table_id, Bill.id != bill.id, Bill.status == BillStatus.UNPAID)
    )
    for tub in tbl_unpaid_res.scalars().all():
        tub.status = BillStatus.CLOSED
        tub.closed_at = now

    # Expire / Close ALL active sessions on this table
    all_sess = await db.execute(
        select(TableSession).where(TableSession.table_id == session.table_id, TableSession.status == SessionStatus.ACTIVE)
    )
    for s in all_sess.scalars().all():
        s.status = SessionStatus.CLOSED
        s.closed_at = now

    # Close any open cart
    cart_res = await db.execute(select(Cart).where(Cart.session_id == session_id, Cart.status == CartStatus.OPEN))
    for c in cart_res.scalars().all():
        c.status = CartStatus.CHECKED_OUT

    table_res = await db.execute(select(Table).where(Table.id == session.table_id))
    table = table_res.scalar_one_or_none()
    table_num = table.table_number if table else "—"

    rest_res = await db.execute(select(Restaurant).where(Restaurant.id == session.restaurant_id))
    restaurant = rest_res.scalar_one_or_none()
    rest_name = restaurant.name if restaurant else "HelloDine"

    await db.commit()

    cache.invalidate_prefix(f"session_meta:{session.id}")
    cache.invalidate_prefix(f"billing_tx:{session.branch_id}")
    cache.invalidate_prefix(f"corp_dashboard:{session.branch_id}")
    cache.invalidate_prefix(f"daily_report:{session.branch_id}")
    cache.invalidate_prefix(f"orders_board:{session.branch_id}")

    goodbye_msg = (
        f"Thank you for dining at {rest_name}! Your payment of ₹{float(bill.total):.2f} "
        f"(Bill #{bill.bill_number}) via Table QR is successful. Have a wonderful day and visit us again soon!"
    )

    # 1. Notify Cashier & Kitchen via Branch WebSocket
    try:
        await manager.broadcast_to_branch(str(session.branch_id), {
            "event": "TABLE_QR_BILL_PAID",
            "bill_id": str(bill.id),
            "bill_number": bill.bill_number,
            "table_id": str(session.table_id),
            "table_number": table_num,
            "subtotal": float(bill.subtotal),
            "cgst_amount": float(bill.cgst_amount),
            "sgst_amount": float(bill.sgst_amount),
            "amount": float(bill.total),
            "method": "UPI (Table QR)",
            "upi_reference_id": ref_id,
            "paid_at": now.isoformat(),
        })
    except Exception as e:
        print(f"Warning: Cashier WS broadcast error: {e}")

    # 2. Notify Table WebSocket
    try:
        await manager.broadcast_to_table(str(session_id), {
            "event": "SESSION_PAID_AND_EXPIRED",
            "bill_id": str(bill.id),
            "bill_number": bill.bill_number,
            "amount": float(bill.total),
            "method": "UPI (Table QR)",
            "message": goodbye_msg,
        })
    except Exception:
        pass

    return {
        "ok": True,
        "session_expired": True,
        "bill_number": bill.bill_number,
        "subtotal": float(bill.subtotal),
        "cgst_amount": float(bill.cgst_amount),
        "sgst_amount": float(bill.sgst_amount),
        "amount_paid": float(bill.total),
        "upi_reference_id": ref_id,
        "goodbye_message": goodbye_msg,
    }

