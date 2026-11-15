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
from app.models.tenancy import Table, Branch
from app.services.auth_service import get_current_staff
from app.services.ws_manager import manager
from app.services.cache_service import cache


router = APIRouter(prefix="/api/billing", tags=["billing"])


async def _verify_branch_billing_access(branch_id: uuid.UUID, current_staff: StaffUser, db: AsyncSession) -> None:
    """Enforce multi-tenant branch/restaurant ownership for billing and financial report endpoints."""
    role = current_staff.role.value if hasattr(current_staff.role, "value") else str(current_staff.role)
    if role == "SYSTEM_ADMIN":
        return
    if role not in ("SUPER_ADMIN", "BRANCH_ADMIN", "CASHIER"):
        raise HTTPException(403, "Not authorized to access billing data")
    if role in ("BRANCH_ADMIN", "CASHIER"):
        if str(current_staff.branch_id) != str(branch_id):
            raise HTTPException(403, "Access denied: branch belongs to a different restaurant/location")
        return
    # SUPER_ADMIN: verify branch belongs to their restaurant
    br_res = await db.execute(select(Branch).where(Branch.id == branch_id))
    br = br_res.scalar_one_or_none()
    if not br or str(br.restaurant_id) != str(current_staff.restaurant_id):
        raise HTTPException(403, "Access denied: branch belongs to a different restaurant")


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
async def pay_bill(
    bill_id: uuid.UUID,
    data: PayRequest,
    current_staff: StaffUser = Depends(get_current_staff),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Bill).where(Bill.id == bill_id))
    bill = result.scalar_one_or_none()
    if not bill:
        raise HTTPException(404, "Bill not found")

    # Multi-tenant authorization check
    await _verify_branch_billing_access(bill.branch_id, current_staff, db)

    if bill.status == BillStatus.PAID:
        raise HTTPException(400, "Bill already paid")

    # Payment amount validation against bill total (allow up to 0.50 rounding tolerance)
    if float(data.amount) <= 0:
        raise HTTPException(400, "Payment amount must be greater than zero")
    if float(data.amount) + 0.50 < float(bill.total):
        raise HTTPException(400, f"Payment amount (₹{float(data.amount):.2f}) cannot be less than the bill total (₹{float(bill.total):.2f})")

    now = datetime.now(timezone.utc)
    payment = Payment(
        bill_id=bill_id,
        method=data.method,
        amount=data.amount or float(bill.total),
        upi_vpa=data.upi_vpa,
        upi_reference_id=data.upi_reference_id,
        received_by_staff_user_id=current_staff.id if current_staff else data.received_by_staff_user_id,
    )
    db.add(payment)
    bill.status = BillStatus.PAID
    bill.closed_at = now

    # Close session & all active sessions on this table so the table kiosk resets cleanly for the next customer
    sess_result = await db.execute(select(TableSession).where(TableSession.id == bill.session_id))
    sess = sess_result.scalar_one_or_none()
    if sess:
        sess.status = SessionStatus.CLOSED
        sess.closed_at = now

    all_sess_res = await db.execute(
        select(TableSession).where(TableSession.table_id == bill.table_id, TableSession.status == SessionStatus.ACTIVE)
    )
    for s in all_sess_res.scalars().all():
        s.status = SessionStatus.CLOSED
        s.closed_at = now

    # Close any open cart for this session
    from app.models.cart import Cart, CartStatus
    cart_res = await db.execute(select(Cart).where(Cart.session_id == bill.session_id, Cart.status == CartStatus.OPEN))
    for c in cart_res.scalars().all():
        c.status = CartStatus.CHECKED_OUT

    # Also mark any other/duplicate unpaid bills for this session or table as PAID/CLOSED
    other_bills_res = await db.execute(
        select(Bill).where(
            or_(Bill.session_id == bill.session_id, Bill.table_id == bill.table_id),
            Bill.id != bill.id,
            Bill.status == BillStatus.UNPAID
        )
    )
    for ob in other_bills_res.scalars().all():
        ob.status = BillStatus.CLOSED
        ob.closed_at = now

    table_res = await db.execute(select(Table).where(Table.id == bill.table_id))
    tbl = table_res.scalar_one_or_none()
    table_num = tbl.table_number if tbl else None

    await db.commit()

    cache.invalidate_prefix(f"session_meta:{bill.session_id}")
    cache.invalidate_prefix(f"billing_tx:{bill.branch_id}")
    cache.invalidate_prefix(f"corp_dashboard:{bill.branch_id}")
    cache.invalidate_prefix(f"daily_report:{bill.branch_id}")
    cache.invalidate_prefix(f"orders_board:{bill.branch_id}")

    method_str = str(data.method.value if hasattr(data.method, "value") else data.method)

    # Notify branch (Cashier / Kitchen)
    try:
        await manager.broadcast_to_branch(str(bill.branch_id), {
            "event": "BILL_PAID",
            "bill_id": str(bill.id),
            "bill_number": bill.bill_number,
            "table_id": str(bill.table_id),
            "table_number": table_num,
            "subtotal": float(bill.subtotal),
            "cgst_amount": float(bill.cgst_amount),
            "sgst_amount": float(bill.sgst_amount),
            "amount": float(data.amount or bill.total),
            "method": method_str,
            "upi_reference_id": data.upi_reference_id,
        })
    except Exception:
        pass

    # Notify Customer Table Tablet UI so it shows Goodbye message & expires session
    try:
        await manager.broadcast_to_table(str(bill.session_id), {
            "event": "SESSION_PAID_AND_EXPIRED",
            "bill_id": str(bill.id),
            "bill_number": bill.bill_number,
            "subtotal": float(bill.subtotal),
            "cgst_amount": float(bill.cgst_amount),
            "sgst_amount": float(bill.sgst_amount),
            "amount": float(data.amount or bill.total),
            "method": method_str,
            "message": f"Thank you for dining with us! Your payment of ₹{float(data.amount or bill.total):.2f} ({method_str}) has been received by the cashier. Your table session is now closed. Have a wonderful day! 🙏✨",
        })
    except Exception:
        pass

    return {
        "ok": True,
        "bill_number": bill.bill_number,
        "amount_paid": float(data.amount or bill.total),
        "method": method_str,
    }



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
    await _verify_branch_billing_access(branch_id, current_staff, db)

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
async def corporate_dashboard(
    branch_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    """Comprehensive Corporate Analytics Dashboard API (Optimized batch queries)."""
    import calendar
    from datetime import datetime, timezone, timedelta

    tz_ist = timezone(timedelta(hours=5, minutes=30))
    today = datetime.now(tz_ist).date()

    cache_key = f"corp_dashboard:{branch_id}:{current_staff.restaurant_id}:{today.isoformat()}"
    cached = await cache.aget(cache_key)
    if cached is not None:
        return cached

    await _verify_branch_billing_access(branch_id, current_staff, db)

    # 1. Define Time Ranges (IST -> UTC Aware)
    start_of_today = datetime.combine(today, datetime.min.time(), tzinfo=tz_ist).astimezone(timezone.utc)
    end_of_today = datetime.combine(today, datetime.max.time(), tzinfo=tz_ist).astimezone(timezone.utc)
    start_of_month = datetime.combine(today.replace(day=1), datetime.min.time(), tzinfo=tz_ist).astimezone(timezone.utc)

    # Calculate 6-month window start
    curr_year, curr_month = today.year, today.month
    six_m_month = curr_month - 5
    six_m_year = curr_year
    while six_m_month <= 0:
        six_m_month += 12
        six_m_year -= 1
    six_month_start = datetime(six_m_year, six_m_month, 1, 0, 0, 0, tzinfo=tz_ist).astimezone(timezone.utc)

    # 2. All-Time Aggregate Metrics (2 queries total instead of 6)
    all_bills_res = await db.execute(
        select(
            func.count(Bill.id).label("total_bills"),
            func.sum(Bill.total).label("total_revenue"),
            func.sum(Bill.cgst_amount).label("total_cgst"),
            func.sum(Bill.sgst_amount).label("total_sgst"),
        ).where(Bill.branch_id == branch_id, Bill.status == BillStatus.PAID)
    )
    all_b_row = all_bills_res.one()

    all_orders_res = await db.execute(
        select(func.count(Order.id).label("total_orders")).where(
            Order.branch_id == branch_id,
            Order.status != OrderStatus.CANCELLED,
        )
    )
    all_o_row = all_orders_res.one()

    all_time_stats = {
        "total_bills": all_b_row.total_bills or 0,
        "total_orders": all_o_row.total_orders or 0,
        "total_revenue": float(all_b_row.total_revenue or 0),
        "total_cgst": float(all_b_row.total_cgst or 0),
        "total_sgst": float(all_b_row.total_sgst or 0),
    }

    # 3. Single Batch Fetch of 6-Month Window Bills & Orders (2 queries total instead of 30 loop queries!)
    recent_bills_res = await db.execute(
        select(Bill.created_at, Bill.total, Bill.cgst_amount, Bill.sgst_amount).where(
            Bill.branch_id == branch_id,
            Bill.status == BillStatus.PAID,
            Bill.created_at >= six_month_start,
            Bill.created_at <= end_of_today,
        )
    )
    recent_bills = recent_bills_res.all()

    recent_orders_res = await db.execute(
        select(Order.created_at).where(
            Order.branch_id == branch_id,
            Order.status != OrderStatus.CANCELLED,
            Order.created_at >= six_month_start,
            Order.created_at <= end_of_today,
        )
    )
    recent_orders = recent_orders_res.all()

    # Compute Today, MTD, 7-Day Trend, and 6-Month Trend in O(N) memory pass
    today_bills_cnt, today_rev, today_cgst, today_sgst = 0, 0.0, 0.0, 0.0
    mtd_bills_cnt, mtd_rev, mtd_cgst, mtd_sgst = 0, 0.0, 0.0, 0.0

    day_rev_map: dict[str, float] = {}
    day_bill_cnt_map: dict[str, int] = {}
    month_rev_map: dict[tuple[int, int], float] = {}
    month_bill_cnt_map: dict[tuple[int, int], int] = {}

    for b_created, b_total, b_cgst, b_sgst in recent_bills:
        if not b_created:
            continue
        b_utc = b_created if b_created.tzinfo else b_created.replace(tzinfo=timezone.utc)
        b_ist = b_utc.astimezone(tz_ist)
        val_total = float(b_total or 0)
        val_cgst = float(b_cgst or 0)
        val_sgst = float(b_sgst or 0)

        if start_of_today <= b_utc <= end_of_today:
            today_bills_cnt += 1
            today_rev += val_total
            today_cgst += val_cgst
            today_sgst += val_sgst

        if start_of_month <= b_utc <= end_of_today:
            mtd_bills_cnt += 1
            mtd_rev += val_total
            mtd_cgst += val_cgst
            mtd_sgst += val_sgst

        d_key = b_ist.date().isoformat()
        day_rev_map[d_key] = day_rev_map.get(d_key, 0.0) + val_total
        day_bill_cnt_map[d_key] = day_bill_cnt_map.get(d_key, 0) + 1

        m_key = (b_ist.year, b_ist.month)
        month_rev_map[m_key] = month_rev_map.get(m_key, 0.0) + val_total
        month_bill_cnt_map[m_key] = month_bill_cnt_map.get(m_key, 0) + 1

    today_orders_cnt = 0
    mtd_orders_cnt = 0
    day_order_cnt_map: dict[str, int] = {}
    month_order_cnt_map: dict[tuple[int, int], int] = {}

    for (o_created,) in recent_orders:
        if not o_created:
            continue
        o_utc = o_created if o_created.tzinfo else o_created.replace(tzinfo=timezone.utc)
        o_ist = o_utc.astimezone(tz_ist)

        if start_of_today <= o_utc <= end_of_today:
            today_orders_cnt += 1
        if start_of_month <= o_utc <= end_of_today:
            mtd_orders_cnt += 1

        d_key = o_ist.date().isoformat()
        day_order_cnt_map[d_key] = day_order_cnt_map.get(d_key, 0) + 1

        m_key = (o_ist.year, o_ist.month)
        month_order_cnt_map[m_key] = month_order_cnt_map.get(m_key, 0) + 1

    today_stats = {
        "total_bills": today_bills_cnt,
        "total_orders": today_orders_cnt,
        "total_revenue": round(today_rev, 2),
        "total_cgst": round(today_cgst, 2),
        "total_sgst": round(today_sgst, 2),
    }
    mtd_stats = {
        "total_bills": mtd_bills_cnt,
        "total_orders": mtd_orders_cnt,
        "total_revenue": round(mtd_rev, 2),
        "total_cgst": round(mtd_cgst, 2),
        "total_sgst": round(mtd_sgst, 2),
    }

    # 4. Generate 7-Day Trend Array
    trend_data = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        d_key = d.isoformat()
        ocnt = day_order_cnt_map.get(d_key, 0)
        bcnt = day_bill_cnt_map.get(d_key, 0)
        trend_data.append({
            "date": d.strftime("%b %d"),
            "revenue": round(day_rev_map.get(d_key, 0.0), 2),
            "orders": ocnt or bcnt or 0,
        })

    # 5. Generate 6-Month Revenue Trend
    monthly_trend = []
    for m_offset in range(5, -1, -1):
        target_month = curr_month - m_offset
        target_year = curr_year
        while target_month <= 0:
            target_month += 12
            target_year -= 1
        m_start = datetime(target_year, target_month, 1, 0, 0, 0, tzinfo=tz_ist)
        m_key = (target_year, target_month)
        ocnt = month_order_cnt_map.get(m_key, 0)
        bcnt = month_bill_cnt_map.get(m_key, 0)
        monthly_trend.append({
            "month": m_start.strftime("%b %Y"),
            "revenue": round(month_rev_map.get(m_key, 0.0), 2),
            "orders": ocnt or bcnt or 0,
        })

    # 6a. Today's Top 5 Best Selling Food Items (Ranked by Quantity Sold Today, with Revenue)
    today_top_items_res = await db.execute(
        select(
            MenuItem.name.label("name"),
            func.sum(OrderItem.quantity).label("quantity_sold"),
            func.sum(OrderItem.line_total).label("revenue_generated")
        )
        .join(OrderItem, OrderItem.menu_item_id == MenuItem.id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            Order.branch_id == branch_id,
            Order.status != OrderStatus.CANCELLED,
            Order.created_at >= start_of_today,
            Order.created_at <= end_of_today,
        )
        .group_by(MenuItem.id, MenuItem.name)
        .order_by(func.sum(OrderItem.quantity).desc(), func.sum(OrderItem.line_total).desc())
        .limit(5)
    )
    today_top_selling_items = [
        {
            "name": row.name,
            "quantity_sold": int(row.quantity_sold or 0),
            "revenue_generated": float(row.revenue_generated or 0)
        }
        for row in today_top_items_res.all()
    ]

    # 6b. All-Time Top 5 Best Selling Food Items (Ranked by Quantity Sold, with Revenue)
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
        "today_top_selling_items": today_top_selling_items,
        "top_selling_items": top_selling_items,
        "payment_breakdown": payment_breakdown,
    }
    cache.set(cache_key, dashboard_out, ttl_seconds=300)
    return dashboard_out


@router.get("/history")
async def billing_history(branch_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_staff: StaffUser = Depends(get_current_staff)):
    """List paid bills for a branch."""
    await _verify_branch_billing_access(branch_id, current_staff, db)
            
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
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    """Return ALL bills (paid + unpaid) for a specific date for this branch."""
    await _verify_branch_billing_access(branch_id, current_staff, db)
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
