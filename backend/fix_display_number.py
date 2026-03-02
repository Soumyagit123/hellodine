"""
Fix whatsapp_display_number for Big King.
The display number is used to build wa.me QR links,
so it MUST be the real WhatsApp business phone number (without +).
"""
import asyncio
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import text
from app.database import engine


async def fix_display_number():
    rest_id        = "8584d86d-b191-4a9c-9b7f-a54f17a7abc7"
    # Real WA business number — digits only, no + or spaces (wa.me format)
    display_number = "919090851660"

    async with engine.begin() as conn:
        result = await conn.execute(text("""
            UPDATE restaurants
            SET whatsapp_display_number = :display
            WHERE id = :rid
        """), {"display": display_number, "rid": rest_id})
        print(f"Rows updated: {result.rowcount}")

    # Verify
    async with engine.begin() as conn:
        row = await conn.execute(text("""
            SELECT name, whatsapp_display_number, whatsapp_phone_number_id
            FROM restaurants WHERE id = :rid
        """), {"rid": rest_id})
        r = row.fetchone()
        if r:
            print(f"\n✅ DB now contains:")
            print(f"  name                  : {r[0]}")
            print(f"  display_number (wa.me) : {r[1]}")
            print(f"  phone_number_id (API)  : {r[2]}")
            print(f"\n  QR link will be: https://wa.me/{r[1]}?text=HELLODINE_START...")
        else:
            print("❌ Restaurant not found!")


if __name__ == "__main__":
    asyncio.run(fix_display_number())
