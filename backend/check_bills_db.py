import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
from app.config import settings
from app.models.billing import Bill
from app.models.orders import Order

async def check_transactions():
    engine = create_async_engine(settings.DATABASE_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as db:
        # Check bills
        bills = (await db.execute(select(Bill))).scalars().all()
        print(f"Total Bills in DB: {len(bills)}")
        for b in bills:
            print(f"[{b.created_at}] Bill {b.bill_number}: {b.status} | Total: ₹{b.total} | Branch {b.branch_id}")
            
        print("\n" + "="*50 + "\n")
        
        # Check orders
        orders = (await db.execute(select(Order))).scalars().all()
        print(f"Total Orders in DB: {len(orders)}")
        
        from collections import defaultdict
        orders_by_date = defaultdict(int)
        for o in orders:
            if o.created_at:
                date_str = o.created_at.strftime("%Y-%m-%d")
                orders_by_date[date_str] += 1
                
        for d, count in orders_by_date.items():
            print(f"Date {d}: {count} orders")

asyncio.run(check_transactions())
