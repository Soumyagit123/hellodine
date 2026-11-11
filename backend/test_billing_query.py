import asyncio, uuid
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, selectinload
from sqlalchemy import select, func
from app.config import settings
from app.models.billing import Bill
from datetime import datetime, timezone

async def test_billing_query():
    engine = create_async_engine(settings.DATABASE_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    # Using the branch ID from the previous db test output:
    branch_id_str = "70d0ca23-a03a-4d7b-a262-f075593cdde7"
    branch_id = uuid.UUID(branch_id_str)
    
    date_str = "2026-03-05"
    target_date = datetime.strptime(date_str, "%Y-%m-%d").date()

    # Exact logic from billing.py
    start_of_day = datetime.combine(target_date, datetime.min.time()).astimezone(timezone.utc)
    end_of_day = datetime.combine(target_date, datetime.max.time()).astimezone(timezone.utc)
    
    print(f"Start of Day (UTC): {start_of_day}")
    print(f"End of Day (UTC): {end_of_day}")

    async with async_session() as db:
        # Let's see what ALL bills look like first
        all_bills = (await db.execute(select(Bill.id, Bill.created_at))).all()
        print("\nAll Bills in DB created_at:")
        for b in all_bills:
            print(f" - {b.id}: {b.created_at}")
        
        from app.models.tenancy import TableSession
        from sqlalchemy.orm import selectinload

        # Test Query
        q = (
            select(Bill)
            .where(
                Bill.branch_id == branch_id,
                Bill.created_at >= start_of_day,
                Bill.created_at <= end_of_day,
            )
            .options(selectinload(Bill.session).selectinload(TableSession.customer))
        )
        print("\nTesting transactions_by_date logic...")
        result = await db.execute(q)
        bills = result.scalars().all()
        print(f"Results Count: {len(bills)}")

asyncio.run(test_billing_query())
