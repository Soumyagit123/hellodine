"""Billing service — consolidated bill synchronization for active table sessions."""
import time
import uuid
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.billing import Bill, BillStatus
from app.models.orders import Order, OrderStatus
from app.models.customers import TableSession


async def sync_session_bill(
    session_id: uuid.UUID,
    db: AsyncSession,
    session: Optional[TableSession] = None,
    commit: bool = True,
) -> Optional[Bill]:
    """
    Ensure an accurate consolidated UNPAID Bill exists for the session whenever non-cancelled orders exist.
    Recalculates subtotal, CGST, SGST, and total across all placed orders.
    """
    if not session:
        sess_res = await db.execute(select(TableSession).where(TableSession.id == session_id))
        session = sess_res.scalar_one_or_none()
    if not session:
        return None

    orders_res = await db.execute(
        select(Order).where(
            Order.session_id == session_id,
            Order.status.notin_([OrderStatus.CANCELLED]),
        )
    )
    orders = orders_res.scalars().all()
    if not orders:
        return None

    subtotal = sum(float(o.subtotal) for o in orders)
    cgst = sum(float(o.cgst_amount) for o in orders)
    sgst = sum(float(o.sgst_amount) for o in orders)
    total = sum(float(o.total) for o in orders)

    bill_res = await db.execute(
        select(Bill).where(Bill.session_id == session_id, Bill.status == BillStatus.UNPAID)
    )
    bill = bill_res.scalar_one_or_none()

    if bill:
        bill.subtotal = subtotal
        bill.cgst_amount = cgst
        bill.sgst_amount = sgst
        bill.total = total
    else:
        bill_number = f"BILL-{int(time.time() * 1000) % 10_000_000}"
        bill = Bill(
            branch_id=session.branch_id,
            table_id=session.table_id,
            session_id=session_id,
            bill_number=bill_number,
            subtotal=subtotal,
            cgst_amount=cgst,
            sgst_amount=sgst,
            total=total,
            status=BillStatus.UNPAID,
        )
        db.add(bill)

    if commit:
        await db.commit()
        await db.refresh(bill)
    return bill

