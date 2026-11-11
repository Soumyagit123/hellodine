import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select, update
from app.config import settings
from app.models.tenancy import Restaurant

NEW_TOKEN = "EAANNT1FcZBDMBQ6y0w8NVf2ZBOte4fZBdOrZCKj2ETZAIIYRZBWZBzwtq1vmeitgHMJsAnYyhYrYpOyelLH3THZCrUO1n09XFHqCShFtAfBsZCtDbJ8F0STbqOOczcXuAkMzaE8SVEvSYg1SvEyRVuqUAex0AZAFrefXN4ieFkesYBZAVVfZAdRmAtRN01FEJWgqYUwZBdBv2LtGTxX8N2NYsfP7NnuZBDJlmrxgBEj9f46AG1ZCbRr6lzDvFsVLgsHdZByL8HBqsV9s5RH6FM4lQbuw8xy3c1PswvjBdM4sVcnTVQZDZD"

async def update_token():
    engine = create_async_engine(settings.DATABASE_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as db:
        # Update all restaurants with the new token
        print("Updating WhatsApp tokens for all restaurants in database...")
        await db.execute(
            update(Restaurant)
            .values(whatsapp_access_token=NEW_TOKEN)
        )
        await db.commit()
        print("✅ Database WhatsApp tokens updated successfully!")

if __name__ == "__main__":
    asyncio.run(update_token())
