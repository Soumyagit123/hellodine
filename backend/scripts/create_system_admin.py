"""CLI utility to safely create the SaaS SYSTEM_ADMIN account without hardcoded defaults."""
import asyncio
import getpass
import sys
import os

# Ensure backend directory is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.auth import StaffUser, StaffRole
from app.models.tenancy import Restaurant
from app.services.auth_service import hash_password

async def create_system_admin():
    print("=== HelloDine System Admin Provisioning ===")
    phone = input("Enter System Admin Phone (e.g. +91 9876543210): ").strip()
    if not phone:
        print("Error: Phone number is required.")
        return

    password = getpass.getpass("Enter System Admin Password (min 8 chars): ").strip()
    if len(password) < 8:
        print("Error: Password must be at least 8 characters long.")
        return

    confirm_password = getpass.getpass("Confirm Password: ").strip()
    if password != confirm_password:
        print("Error: Passwords do not match.")
        return

    name = input("Enter Admin Name [SaaS System Owner]: ").strip() or "SaaS System Owner"

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(StaffUser).where(StaffUser.phone == phone))
        existing = res.scalar_one_or_none()
        if existing:
            print(f"Error: A staff user with phone {phone} already exists (Role: {existing.role.value}).")
            return

        rest_res = await db.execute(select(Restaurant).order_by(Restaurant.created_at.asc()))
        first_rest = rest_res.scalars().first()
        if not first_rest:
            first_rest = Restaurant(
                name="HelloDine HQ",
                whatsapp_phone_number_id="kiosk_hq",
                whatsapp_display_number=phone,
                subscription_plan="PRO_AI",
                subscription_status="ACTIVE",
            )
            db.add(first_rest)
            await db.flush()

        admin = StaffUser(
            restaurant_id=first_rest.id,
            branch_id=None,
            role=StaffRole.SYSTEM_ADMIN,
            name=name,
            phone=phone,
            password_hash=hash_password(password),
            is_active=True,
        )
        db.add(admin)
        await db.commit()
        print(f"\n[SUCCESS] SYSTEM_ADMIN created: {phone} ({name})")

if __name__ == "__main__":
    asyncio.run(create_system_admin())
