"""Billing router — /api/billing"""
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, cast, Date
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
import time

from app.database import get_db
from app.models.billing import Bill, Payment, BillStatus, PaymentMethod
from app.models.orders import Order, OrderStatus
from app.models.customers import TableSession, SessionStatus
from app.models.auth import StaffUser, StaffRole
from app.services.auth_service import get_current_staff

router = APIRouter(prefix="/api/billing", tags=["billing"])


class PayRequest(BaseModel):
    method: PaymentMethod
    amount: float
    upi_vpa: Optional[str] = None
    upi_reference_id: Optional[str] = None
    received_by_staff_user_id: Optional[uuid.UUID] = None


@router.post("/generate")
async def generate_bill(session_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Aggregate all non-cancelled orders for a session into a consolidated bill."""
    # Check existing unpaid bill
    existing = await db.execute(
        select(Bill).where(Bill.session_id == session_id, Bill.status == BillStatus.UNPAID)
    )
    existing_bill = existing.scalar_one_or_none()
    if existing_bill:
        return existing_bill

    orders_result = await db.execute(
        select(Order).where(
            Order.session_id == session_id,
            Order.status.notin_([OrderStatus.CANCELLED]),
        )
    )
    orders = orders_result.scalars().all()
    if not orders:
        raise HTTPException(400, "No open orders to bill")

    sess_result = await db.execute(select(TableSession).where(TableSession.id == session_id))
    session = sess_result.scalar_one()

    subtotal = sum(o.subtotal for o in orders)
    cgst = sum(o.cgst_amount for o in orders)
    sgst = sum(o.sgst_amount for o in orders)
    total = sum(o.total for o in orders)
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
    await db.commit()
    await db.refresh(bill)
    return bill


@router.post("/{bill_id}/pay")
async def pay_bill(bill_id: uuid.UUID, data: PayRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Bill).where(Bill.id == bill_id))
    bill = result.scalar_one_or_none()
    if not bill:
        raise HTTPException(404, "Bill not found")
    if bill.status == BillStatus.PAID:
        raise HTTPException(400, "Bill already paid")

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
    bill.closed_at = datetime.now(timezone.utc)

    # Close session
    sess_result = await db.execute(select(TableSession).where(TableSession.id == bill.session_id))
    sess = sess_result.scalar_one()
    sess.status = SessionStatus.CLOSED
    sess.closed_at = datetime.now(timezone.utc)

    await db.commit()
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
    return {
        "date": date,
        "total_bills": row.total_bills or 0,
        "total_revenue": float(row.total_revenue or 0),
        "total_cgst": float(row.total_cgst or 0),
        "total_sgst": float(row.total_sgst or 0),
    }


@router.get("/report/dashboard")
async def corporate_dashboard(branch_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Comprehensive Corporate Analytics Dashboard API."""
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

    return {
        "ok": True,
        "today": today_stats,
        "month": mtd_stats,
        "all_time": all_time_stats,
        "trend_7d": trend_data
    }


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
    from app.models.tenancy import Table as TableModel
    from datetime import date as dt_date, datetime

    if date:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    else:
        target_date = dt_date.today()

    # Create a timezone-aware range for the whole target day
    start_of_day = datetime.combine(target_date, datetime.min.time()).astimezone(timezone.utc)
    end_of_day = datetime.combine(target_date, datetime.max.time()).astimezone(timezone.utc)

    result = await db.execute(
        select(Bill)
        .where(
            Bill.branch_id == branch_id,
            Bill.created_at >= start_of_day,
            Bill.created_at <= end_of_day,
        )
        .order_by(Bill.created_at.desc())
    )
    bills = result.scalars().all()

    # Enrich with table number
    output = []
    for bill in bills:
        table_number = None
        if bill.table_id:
            t_res = await db.execute(select(TableModel).where(TableModel.id == bill.table_id))
            t = t_res.scalar_one_or_none()
            table_number = t.table_number if t else None

        output.append({
            "id": str(bill.id),
            "bill_number": bill.bill_number,
            "table_id": str(bill.table_id),
            "table_number": table_number,
            "subtotal": float(bill.subtotal),
            "cgst_amount": float(bill.cgst_amount),
            "sgst_amount": float(bill.sgst_amount),
            "total": float(bill.total),
            "status": bill.status,
            "created_at": bill.created_at.isoformat() if bill.created_at else None,
            "closed_at": bill.closed_at.isoformat() if bill.closed_at else None,
        })

    return output
