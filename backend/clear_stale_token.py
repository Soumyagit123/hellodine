"""
Clear stale/expired access token from DB so the system 
falls back to the Render environment variable WA_ACCESS_TOKEN.
"""
import asyncio
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import text
from app.database import engine


async def clear_token():
    rest_id = "8584d86d-b191-4a9c-9b7f-a54f17a7abc7"

    async with engine.begin() as conn:
        result = await conn.execute(text("""
            UPDATE restaurants
            SET whatsapp_access_token = NULL,
                whatsapp_app_secret   = NULL
            WHERE id = :rid
        """), {"rid": rest_id})
        print(f"Rows updated: {result.rowcount}")

    # Verify
    async with engine.begin() as conn:
        row = await conn.execute(text("""
            SELECT name,
                   whatsapp_phone_number_id,
                   whatsapp_access_token,
                   whatsapp_verify_token
            FROM restaurants WHERE id = :rid
        """), {"rid": rest_id})
        r = row.fetchone()
        if r:
            print(f"\n✅ DB now contains:")
            print(f"  name              : {r[0]}")
            print(f"  phone_number_id   : {r[1]}  ← still set")
            print(f"  access_token      : {r[2]}  ← now NULL (will use Render env var)")
            print(f"  verify_token      : {r[3]}")
            print(f"\n  System will now use WA_ACCESS_TOKEN from Render env vars ✅")


if __name__ == "__main__":
    asyncio.run(clear_token())
