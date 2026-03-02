"""
Update WhatsApp credentials for Big King restaurant in the DB.
Matches the values set in Render environment variables.
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import text
from app.database import engine


async def update_creds():
    rest_id = "8584d86d-b191-4a9c-9b7f-a54f17a7abc7"

    # ── Exact values from Render environment ──────────────────────────────────
    wa_phone_number_id = "1001763716355748"
    wa_display_number  = "1001763716355748"   # shown number; update if different
    wa_access_token    = (
        "EAANNT1FcZBDMBQ18YZATthwzNCbMfBUzzvthGpaegoR1Bem4qZCv5mWcRCdHBLqX0uwVZCv92"
        "EzLntK2W0scprGkd4qjjxVXhxJ11r0dNgZAOhhrzL4O9J9fJSF2hxxvT1UzKDJsfo5Wwnxzf4C"
        "Pujy1St9TQifZBOuGbA6CpZBp8BmZC9f0rmjDolNtH9GYhZAunIkbIKlphBWe9xn1HgHXasDgS5"
        "NAsWIlyVtxV7KDR"
    )
    wa_app_id          = "929427992934451"
    wa_app_secret      = "67a16d5ae79f444c918be1fb7d316ed6"
    wa_verify_token    = "hellodine_verify_token_123"

    print("=" * 60)
    print("Updating Big King WhatsApp credentials...")
    print(f"  Restaurant ID   : {rest_id}")
    print(f"  Phone Number ID : {wa_phone_number_id}")
    print(f"  App ID          : {wa_app_id}")
    print(f"  Verify Token    : {wa_verify_token}")
    print(f"  Token (first 20): {wa_access_token[:20]}...")
    print("=" * 60)

    async with engine.begin() as conn:
        result = await conn.execute(text("""
            UPDATE restaurants
            SET whatsapp_phone_number_id = :pid,
                whatsapp_display_number  = :display,
                whatsapp_access_token    = :token,
                whatsapp_verify_token    = :verify,
                whatsapp_app_id          = :app_id,
                whatsapp_app_secret      = :app_secret
            WHERE id = :rest_id
        """), {
            "pid":        wa_phone_number_id,
            "display":    wa_display_number,
            "token":      wa_access_token,
            "verify":     wa_verify_token,
            "app_id":     wa_app_id,
            "app_secret": wa_app_secret,
            "rest_id":    rest_id,
        })
        print(f"Rows updated: {result.rowcount}")

    # ── Verification: confirm what is now in the DB ───────────────────────────
    async with engine.begin() as conn:
        row = await conn.execute(text("""
            SELECT name,
                   whatsapp_phone_number_id,
                   whatsapp_display_number,
                   whatsapp_verify_token,
                   whatsapp_app_id,
                   whatsapp_app_secret,
                   LEFT(whatsapp_access_token, 30) AS token_preview
            FROM restaurants
            WHERE id = :rid
        """), {"rid": rest_id})
        r = row.fetchone()
        if r:
            print("\n✅ DB now contains:")
            print(f"  name              : {r[0]}")
            print(f"  phone_number_id   : {r[1]}")
            print(f"  display_number    : {r[2]}")
            print(f"  verify_token      : {r[3]}")
            print(f"  app_id            : {r[4]}")
            print(f"  app_secret        : {r[5]}")
            print(f"  access_token (30) : {r[6]}...")
        else:
            print("❌ Restaurant not found! Check the rest_id UUID.")


if __name__ == "__main__":
    asyncio.run(update_creds())
