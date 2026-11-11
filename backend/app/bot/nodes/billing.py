"""Bot nodes — bill_generator + receipt_sender"""
import uuid
from app.bot.state import BotState
from app.database import AsyncSessionLocal
from app.models.billing import Bill, BillStatus
from app.models.orders import Order, OrderItem, OrderStatus
from app.models.menu import MenuItem
from app.models.customers import TableSession
from app.models.tenancy import Table, Branch
from sqlalchemy import select
from sqlalchemy.orm import selectinload
import time


async def bill_generator(state: BotState) -> BotState:
    """Aggregate all open orders for the session into a consolidated bill."""
    session_id = state.get("session_id")
    if not session_id:
        state["error"] = "no_session"
        return state

    async with AsyncSessionLocal() as db:
        # Check if unpaid bill already exists
        exist = await db.execute(
            select(Bill).where(Bill.session_id == uuid.UUID(session_id), Bill.status == BillStatus.UNPAID)
        )
        bill = exist.scalar_one_or_none()

        if not bill:
            orders_result = await db.execute(
                select(Order).where(
                    Order.session_id == uuid.UUID(session_id),
                    Order.status.notin_([OrderStatus.CANCELLED]),
                )
            )
            orders = orders_result.scalars().all()
            if not orders:
                state["final_response"] = {"type": "text", "body": "No orders found for this table. Order something first! 😊"}
                return state

            sess_result = await db.execute(select(TableSession).where(TableSession.id == uuid.UUID(session_id)))
            session = sess_result.scalar_one()

            subtotal = sum(o.subtotal for o in orders)
            cgst = sum(o.cgst_amount for o in orders)
            sgst = sum(o.sgst_amount for o in orders)
            total = sum(o.total for o in orders)

            bill = Bill(
                branch_id=session.branch_id,
                table_id=session.table_id,
                session_id=uuid.UUID(session_id),
                bill_number=f"BILL-{int(time.time() * 1000) % 10_000_000}",
                subtotal=subtotal,
                cgst_amount=cgst,
                sgst_amount=sgst,
                total=total,
                status=BillStatus.UNPAID,
            )
            db.add(bill)
            await db.commit()
            await db.refresh(bill)

        else:
            # Always recalculate unpaid bill so newly placed orders are included
            orders_result = await db.execute(
                select(Order).where(
                    Order.session_id == uuid.UUID(session_id),
                    Order.status.notin_([OrderStatus.CANCELLED]),
                )
            )
            orders = orders_result.scalars().all()
            if orders:
                bill.subtotal = sum(float(o.subtotal) for o in orders)
                bill.cgst_amount = sum(float(o.cgst_amount) for o in orders)
                bill.sgst_amount = sum(float(o.sgst_amount) for o in orders)
                bill.total = sum(float(o.total) for o in orders)
                await db.commit()
                await db.refresh(bill)

        # Build bill summary lines from orders in 1 query with selectinload
        orders_result = await db.execute(
            select(Order)
            .where(Order.session_id == uuid.UUID(session_id), Order.status.notin_([OrderStatus.CANCELLED]))
            .options(selectinload(Order.items).selectinload(OrderItem.menu_item))
        )
        orders = orders_result.scalars().all()
        lines = []
        for order in orders:
            for oi in order.items:
                mi_name = oi.menu_item.name if oi.menu_item else "Item"
                lines.append(f"• {mi_name} ×{oi.quantity} — ₹{oi.line_total:.0f}")

        items_text = "\n".join(lines) if lines else "No items"

        state["ui_action"] = {
            "action": "SHOW_BILL",
            "bill": {
                "id": str(bill.id),
                "bill_number": bill.bill_number,
                "subtotal": float(bill.subtotal),
                "cgst_amount": float(bill.cgst_amount),
                "sgst_amount": float(bill.sgst_amount),
                "total": float(bill.total),
                "status": str(bill.status.value if hasattr(bill.status, "value") else bill.status),
                "items_text": items_text,
            }
        }

        state["final_response"] = {
            "type": "text",
            "body": (
                f"🧾 *Bill #{bill.bill_number}*\n\n"
                f"{items_text}\n\n"
                f"{'─'*28}\n"
                f"Subtotal : ₹{bill.subtotal:.2f}\n"
                f"CGST      : ₹{bill.cgst_amount:.2f}\n"
                f"SGST      : ₹{bill.sgst_amount:.2f}\n"
                f"{'─'*28}\n"
                f"*Total    : ₹{bill.total:.2f}*\n\n"
                "Scan the UPI QR code on your screen to pay instantly at the table, or pay at the cashier counter! 💳"
            ),
            "voice_text": f"Please review your GST invoice of Rupees {bill.total:.0f} on the screen and scan the QR code to complete your payment.",
        }

    return state



async def receipt_sender(state: BotState) -> BotState:
    """Send receipt after payment is confirmed (called from cashier marking paid)."""
    # This node is called externally after cashier marks paid.
    # In the bot graph it's a terminal node that just echoes the state.
    return state
