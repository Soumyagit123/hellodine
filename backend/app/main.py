"""FastAPI application entrypoint."""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
import app.models  # ensure all models are registered before create_all

from app.routers import auth, restaurant, menu, cart, orders, billing, webhook, kiosk, menu_agent



import logging

# Configure logging to stdout
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    force=True
)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Application starting up...")
    try:
        from sqlalchemy import text
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            await conn.execute(text("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS merchant_upi_id TEXT"))
            await conn.execute(text("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'STARTER'"))
            await conn.execute(text("ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url TEXT"))
            await conn.execute(text("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'ACTIVE'"))
            await conn.execute(text("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ"))
            await conn.execute(text("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS pending_renewal_plan TEXT"))
            await conn.execute(text("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS pending_renewal_utr TEXT"))
            await conn.execute(text("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS pending_renewal_amount INTEGER"))
            await conn.execute(text("ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS is_bestseller BOOLEAN DEFAULT FALSE"))
            await conn.execute(text("ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS embedding vector(768)"))
            await conn.execute(text("ALTER TYPE staffrole ADD VALUE IF NOT EXISTS 'SYSTEM_ADMIN'"))
            await conn.execute(text("ALTER TYPE staffrole ADD VALUE IF NOT EXISTS 'BRANCH_ADMIN'"))
        logger.info("Database schema & Supabase pgvector(768) auto-verified.")

        # Auto-seed default SYSTEM_ADMIN account (SaaS Provider Owner) if not present
        from sqlalchemy import select
        from app.database import AsyncSessionLocal
        from app.models.auth import StaffUser, StaffRole
        from app.models.tenancy import Restaurant
        from app.services.auth_service import hash_password

        async with AsyncSessionLocal() as db:
            sys_res = await db.execute(select(StaffUser).where(StaffUser.role == StaffRole.SYSTEM_ADMIN))
            sys_admin = sys_res.scalars().first()
            if not sys_admin:
                rest_res = await db.execute(select(Restaurant).order_by(Restaurant.created_at.asc()))
                first_rest = rest_res.scalars().first()
                if not first_rest:
                    first_rest = Restaurant(
                        name="HelloDine HQ",
                        whatsapp_phone_number_id="kiosk_hq",
                        whatsapp_display_number="+91 9000000000",
                        subscription_plan="PRO_AI",
                        subscription_status="ACTIVE",
                    )
                    db.add(first_rest)
                    await db.flush()
                sys_admin = StaffUser(
                    restaurant_id=first_rest.id,
                    branch_id=None,
                    role=StaffRole.SYSTEM_ADMIN,
                    name="SaaS System Owner",
                    phone="+91 9000000000",
                    password_hash=hash_password("sysadmin123"),
                    is_active=True,
                )
                db.add(sys_admin)
                await db.commit()
                logger.info("Default SYSTEM_ADMIN created: +91 9000000000 / sysadmin123")
            else:
                logger.info(f"Existing SYSTEM_ADMIN found in DB: phone={sys_admin.phone}")
    except Exception as e:
        logger.warning(f"Schema auto-check warning: {e}")
    yield


app = FastAPI(
    title="HelloDine API",
    description="WhatsApp QR-based dine-in ordering system for Indian restaurants",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://hellodine.vercel.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include all routers
app.include_router(auth.router)
app.include_router(restaurant.router)
app.include_router(menu.router)
app.include_router(cart.router)
app.include_router(orders.router)
app.include_router(billing.router)
app.include_router(webhook.router)
app.include_router(kiosk.router)
app.include_router(menu_agent.router)



@app.get("/")
async def root():
    return {"service": "HelloDine API", "status": "running", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
