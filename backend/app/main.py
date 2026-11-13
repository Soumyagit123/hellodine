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
        logger.info("Database extensions verified.")
    except Exception as e:
        logger.warning(f"Database startup check warning: {e}")
    yield
    logger.info("Application shutdown.")


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
