"""Billing router — /api/billing"""
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, cast, Date, or_, and_
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
import time

from app.database import get_db
from app.models.billing import Bill, Payment, BillStatus, PaymentMethod
from app.models.orders import Order, OrderItem, OrderStatus
from app.models.menu import MenuItem
from app.models.customers import Customer, TableSession, SessionStatus
from app.models.auth import StaffUser, StaffRole
from app.models.tenancy import Table
from app.services.auth_service import get_current_staff
from app.services.ws_manager import manager
from app.services.cache_service import cache


router = APIRouter(prefix="/api/billing", tags=["billing"])


from app.services.billing_service import sync_session_bill


class PayRequest(BaseModel):
    method: PaymentMethod
    amount: float
    upi_vpa: Optional[str] = None
    upi_reference_id: Optional[str] = None
    received_by_staff_user_id: Optional[uuid.UUID] = None


@router.post("/generate")
async def generate_bill(session_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Aggregate all non-cancelled orders for a session into a consolidated bill."""
    bill = await sync_session_bill(session_id, db)
    if not bill:
        raise HTTPException(400, "No open orders to bill for this table session")
    return bill


@router.post("/{bill_id}/pay")
async def pay_bill(bill_id: uuid.UUID, data: PayRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Bill).where(Bill.id == bill_id))
    bill = result.scalar_one_or_none()
    if not bill:
        raise HTTPException(404, "Bill not found")
    if bill.status == BillStatus.PAID:
        raise HTTPException(400, "Bill already paid")

    now = datetime.now(timezone.utc)
    payment = Payment(
        bill_id=bill_id,
        method=data.method,
        amount=data.amount,
        upi_vpa=data.upi_vpa,
        upi_reference_id=data.upi_reference_id,
        received_by_staff_user_id=data.received_by_staff_user_id,
    )
    db.add(payment)
    bill.status = BillStatus.PAID
    bill.closed_at = now

    # Close session
    sess_result = await db.execute(select(TableSession).where(TableSession.id == bill.session_id))
    sess = sess_result.scalar_one_or_none()
    if sess:
        sess.status = SessionStatus.CLOSED
        sess.closed_at = now

    # Also mark any other/duplicate unpaid bills for this session as PAID/CLOSED
    other_bills_res = await db.execute(
        select(Bill).where(Bill.session_id == bill.session_id, Bill.id != bill.id, Bill.status == BillStatus.UNPAID)
    )
    for ob in other_bills_res.scalars().all():
        ob.status = BillStatus.PAID
        ob.closed_at = now

    table_res = await db.execute(select(Table).where(Table.id == bill.table_id))
    tbl = table_res.scalar_one_or_none()
    table_num = tbl.table_number if tbl else None

    await db.commit()

    cache.invalidate_prefix(f"billing_tx:{bill.branch_id}")
    cache.invalidate_prefix(f"corp_dashboard:{bill.branch_id}")
    cache.invalidate_prefix(f"daily_report:{bill.branch_id}")

    # Notify branch (Cashier / Kitchen)
    try:
        await manager.broadcast_to_branch(str(bill.branch_id), {
            "event": "BILL_PAID",
            "bill_id": str(bill.id),
            "bill_number": bill.bill_number,
            "table_id": str(bill.table_id),
            "table_number": table_num,
            "amount": float(data.amount),
            "method": str(data.method.value if hasattr(data.method, "value") else data.method),
        })
    except Exception:
        pass

    # Notify Customer Table Tablet UI so it shows Goodbye message & expires session
    try:
        await manager.broadcast_to_table(str(bill.session_id), {
            "event": "SESSION_PAID_AND_EXPIRED",
            "bill_id": str(bill.id),
            "bill_number": bill.bill_number,
            "amount": float(data.amount),
            "method": str(data.method.value if hasattr(data.method, "value") else data.method),
            "message": "Thank you for dining with us! Your payment is complete and your table session has now closed. Have a wonderful day! 🙏✨",
        })
    except Exception:
        pass

    return {"ok": True, "bill_number": bill.bill_number, "amount_paid": data.amount}



@router.get("/table/{table_id}/open")
async def get_open_bill(table_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Bill).where(Bill.table_id == table_id, Bill.status == BillStatus.UNPAID)
        .order_by(Bill.created_at.desc())
    )
    bills = result.scalars().all()
    return bills


@router.get("/report/daily")
async def daily_report(branch_id: uuid.UUID, date: str, db: AsyncSession = Depends(get_db), current_staff: StaffUser = Depends(get_current_staff)):
    """Basic daily sales report for admin."""
    # Data isolation
    if current_staff.role == StaffRole.BRANCH_ADMIN:
        if str(branch_id) != str(current_staff.branch_id):
            raise HTTPException(403, "Access denied to this branch's reports")

    cache_key = f"daily_report:{branch_id}:{date}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # Parse the incoming "YYYY-MM-DD" string
    target_date = datetime.strptime(date, "%Y-%m-%d").date()
    
    start_of_day = datetime.combine(target_date, datetime.min.time()).astimezone(timezone.utc)
    end_of_day = datetime.combine(target_date, datetime.max.time()).astimezone(timezone.utc)
    
    result = await db.execute(
        select(
            func.count(Bill.id).label("total_bills"),
            func.sum(Bill.total).label("total_revenue"),
            func.sum(Bill.cgst_amount).label("total_cgst"),
            func.sum(Bill.sgst_amount).label("total_sgst"),
        ).where(
            Bill.branch_id == branch_id,
            Bill.status == BillStatus.PAID,
            Bill.created_at >= start_of_day,
            Bill.created_at <= end_of_day,
        )
    )
    row = result.one()
    out = {
        "date": date,
        "total_bills": row.total_bills or 0,
        "total_revenue": float(row.total_revenue or 0),
        "total_cgst": float(row.total_cgst or 0),
        "total_sgst": float(row.total_sgst or 0),
    }
    cache.set(cache_key, out, ttl_seconds=30)
    return out


@router.get("/report/dashboard")
async def corporate_dashboard(branch_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Comprehensive Corporate Analytics Dashboard API."""
    cache_key = f"corp_dashboard:{branch_id}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    from datetime import date as dt_date, datetime, timezone, timedelta
    
    today = dt_date.today()
    
    # 1. Define Time Ranges (UTC Aware)
    start_of_today = datetime.combine(today, datetime.min.time()).astimezone(timezone.utc)
    end_of_today = datetime.combine(today, datetime.max.time()).astimezone(timezone.utc)
    
    start_of_month = datetime.combine(today.replace(day=1), datetime.min.time()).astimezone(timezone.utc)
    
    # 2. Base Query helper
    async def get_metrics(start_time=None, end_time=None):
        q = select(
            func.count(Bill.id).label("total_bills"),
            func.sum(Bill.total).label("total_revenue"),
            func.sum(Bill.cgst_amount).label("total_cgst"),
            func.sum(Bill.sgst_amount).label("total_sgst"),
        ).where(Bill.branch_id == branch_id, Bill.status == BillStatus.PAID)
        
        if start_time: q = q.where(Bill.created_at >= start_time)
        if end_time: q = q.where(Bill.created_at <= end_time)
            
        res = await db.execute(q)
        row = res.one()
        return {
            "total_bills": row.total_bills or 0,
            "total_revenue": float(row.total_revenue or 0),
            "total_cgst": float(row.total_cgst or 0),
            "total_sgst": float(row.total_sgst or 0),
        }

    # 3. Fetch Aggregate Blocks
    today_stats = await get_metrics(start_of_today, end_of_today)
    mtd_stats = await get_metrics(start_of_month, end_of_today)
    all_time_stats = await get_metrics(None, None)

    # 4. Generate 7-Day Trend Array for Chart.js
    trend_data = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        st = datetime.combine(d, datetime.min.time()).astimezone(timezone.utc)
        et = datetime.combine(d, datetime.max.time()).astimezone(timezone.utc)
        
        # Single day fast query
        r = await db.execute(
            select(func.sum(Bill.total).label("rev"), func.count(Bill.id).label("cnt"))
            .where(Bill.branch_id == branch_id, Bill.status == BillStatus.PAID, Bill.created_at >= st, Bill.created_at <= et)
        )
        day_row = r.one()
        trend_data.append({
            "date": d.strftime("%b %d"),
            "revenue": float(day_row.rev or 0),
            "orders": day_row.cnt or 0
        })

    # 5. Generate 6-Month Revenue Trend (Monthly Trend)
    monthly_trend = []
    curr_year = today.year
    curr_month = today.month
    for m_offset in range(5, -1, -1):
        target_month = curr_month - m_offset
        target_year = curr_year
        while target_month <= 0:
            target_month += 12
            target_year -= 1

        import calendar
        _, last_day = calendar.monthrange(target_year, target_month)
        m_start = datetime(target_year, target_month, 1, 0, 0, 0).astimezone(timezone.utc)
        m_end = datetime(target_year, target_month, last_day, 23, 59, 59).astimezone(timezone.utc)

        m_res = await db.execute(
            select(func.sum(Bill.total).label("rev"), func.count(Bill.id).label("cnt"))
            .where(Bill.branch_id == branch_id, Bill.status == BillStatus.PAID, Bill.created_at >= m_start, Bill.created_at <= m_end)
        )
        m_row = m_res.one()
        monthly_trend.append({
            "month": m_start.strftime("%b %Y"),
            "revenue": float(m_row.rev or 0),
            "orders": m_row.cnt or 0
        })

    # 6. Top 5 Best Selling Food Items (Ranked by Quantity Sold, with Revenue)
    top_items_res = await db.execute(
        select(
            MenuItem.name.label("name"),
            func.sum(OrderItem.quantity).label("quantity_sold"),
            func.sum(OrderItem.line_total).label("revenue_generated")
        )
        .join(OrderItem, OrderItem.menu_item_id == MenuItem.id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            Order.branch_id == branch_id,
            Order.status != OrderStatus.CANCELLED
        )
        .group_by(MenuItem.id, MenuItem.name)
        .order_by(func.sum(OrderItem.quantity).desc(), func.sum(OrderItem.line_total).desc())
        .limit(5)
    )
    top_selling_items = [
        {
            "name": row.name,
            "quantity_sold": int(row.quantity_sold or 0),
            "revenue_generated": float(row.revenue_generated or 0)
        }
        for row in top_items_res.all()
    ]

    # 7. Payment Methods Breakdown (UPI, CASH, CARD)
    pm_res = await db.execute(
        select(Payment.method, func.sum(Payment.amount).label("amount"), func.count(Payment.id).label("count"))
        .join(Bill, Bill.id == Payment.bill_id)
        .where(Bill.branch_id == branch_id, Bill.status == BillStatus.PAID)
        .group_by(Payment.method)
    )
    payment_breakdown = [
        {"method": str(row.method.value if hasattr(row.method, 'value') else row.method), "amount": float(row.amount or 0), "count": int(row.count or 0)}
        for row in pm_res.all()
    ]

    # 8. Average Order Value (AOV)
    aov_today = round(today_stats["total_revenue"] / today_stats["total_bills"], 2) if today_stats["total_bills"] > 0 else 0
    aov_lifetime = round(all_time_stats["total_revenue"] / all_time_stats["total_bills"], 2) if all_time_stats["total_bills"] > 0 else 0

    dashboard_out = {
        "ok": True,
        "today": today_stats,
        "month": mtd_stats,
        "all_time": all_time_stats,
        "aov": {
            "today": aov_today,
            "lifetime": aov_lifetime
        },
        "trend_7d": trend_data,
        "monthly_trend": monthly_trend,
        "top_selling_items": top_selling_items,
        "payment_breakdown": payment_breakdown,
    }
    cache.set(cache_key, dashboard_out, ttl_seconds=60)
    return dashboard_out


@router.get("/history")
async def billing_history(branch_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_staff: StaffUser = Depends(get_current_staff)):
    """List paid bills for a branch."""
    # Data isolation
    if current_staff.role == StaffRole.BRANCH_ADMIN:
        if str(branch_id) != str(current_staff.branch_id):
            raise HTTPException(403, "Access denied to this branch's history")
            
    result = await db.execute(
        select(Bill).where(Bill.branch_id == branch_id, Bill.status == BillStatus.PAID)
        .order_by(Bill.closed_at.desc())
        .limit(100)
    )
    return result.scalars().all()


@router.get("/transactions")
async def transactions_by_date(
    branch_id: uuid.UUID, 
    date: Optional[str] = None, 
    db: AsyncSession = Depends(get_db)
):
    """Return ALL bills (paid + unpaid) for a specific date for this branch."""
    cache_key = f"billing_tx:{branch_id}:{date or 'today'}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    from app.models.tenancy import Table as TableModel
    from datetime import date as dt_date, datetime, timezone, timedelta
    from app.models.customers import Customer

    # Timezone-aware date window (IST UTC+05:30)
    tz_ist = timezone(timedelta(hours=5, minutes=30))
    if date:
        try:
            target_date = datetime.strptime(date, "%Y-%m-%d").date()
        except Exception:
            target_date = datetime.now(tz_ist).date()
    else:
        target_date = datetime.now(tz_ist).date()

    local_start = datetime.combine(target_date, datetime.min.time(), tzinfo=tz_ist)
    local_end = datetime.combine(target_date, datetime.max.time(), tzinfo=tz_ist)
    start_of_day = local_start.astimezone(timezone.utc)
    end_of_day = local_end.astimezone(timezone.utc)

    result = await db.execute(
        select(Bill, TableModel, Customer, TableSession)
        .outerjoin(TableModel, Bill.table_id == TableModel.id)
        .outerjoin(TableSession, Bill.session_id == TableSession.id)
        .outerjoin(Customer, TableSession.customer_id == Customer.id)
        .where(
            Bill.branch_id == branch_id,
            or_(
                # Paid bills matching this date (either closed_at or created_at)
                and_(
                    Bill.status == BillStatus.PAID,
                    or_(
                        and_(Bill.closed_at >= start_of_day, Bill.closed_at <= end_of_day),
                        and_(Bill.created_at >= start_of_day, Bill.created_at <= end_of_day),
                    ),
                ),
                # Pending unpaid bills: ONLY if status is UNPAID AND table session is currently ACTIVE
                and_(
                    Bill.status == BillStatus.UNPAID,
                    TableSession.status == SessionStatus.ACTIVE,
                ),
            ),
        )
        .order_by(Bill.created_at.desc())
    )
    rows = result.all()

    output = []
    for bill, tbl, cust, sess in rows:
        table_number = tbl.table_number if tbl else None
        customer_name = (cust.name if cust and cust.name else None) or f"Table {table_number or ''} Guest".strip()

        output.append({
            "id": str(bill.id),
            "bill_number": bill.bill_number,
            "table_id": str(bill.table_id),
            "table_number": table_number,
            "customer_name": customer_name,
            "subtotal": float(bill.subtotal),
            "cgst_amount": float(bill.cgst_amount),
            "sgst_amount": float(bill.sgst_amount),
            "total": float(bill.total),
            "status": str(bill.status.value if hasattr(bill.status, "value") else bill.status),
            "created_at": bill.created_at.isoformat() if bill.created_at else None,
            "closed_at": bill.closed_at.isoformat() if bill.closed_at else None,
        })

    cache.set(cache_key, output, ttl_seconds=15)
    return output
