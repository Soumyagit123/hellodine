"""Seed demo data — run once after DB is up."""
import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from app.database import AsyncSessionLocal, engine, Base
from app.models import *
from app.services.auth_service import hash_password


async def seed():
    # Ensure tables exist
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        # ── Restaurant ─────────────────────────────────────────────────
        restaurant = Restaurant(
            name="Spice Garden",
            gstin="21AABCS1429B1Z1",
            fssai_license_number="12345678901234",
            whatsapp_phone_number_id="YOUR_PHONE_NUMBER_ID",
            whatsapp_display_number="+91 9876500000",
        )
        db.add(restaurant)
        await db.flush()

        # ── Branch ─────────────────────────────────────────────────────
        branch = Branch(
            restaurant_id=restaurant.id,
            name="KIIT Branch",
            address="Campus 11, Patia",
            city="Bhubaneswar",
            state="Odisha",
            pincode="751024",
            gstin="21AABCS1429B1Z1",
        )
        db.add(branch)
        await db.flush()

        # ── Tables ─────────────────────────────────────────────────────
        for num in range(1, 6):
            db.add(Table(branch_id=branch.id, table_number=num))

        # ── Staff ──────────────────────────────────────────────────────
        staff_data = [
            ("SaaS System Owner", "+91 9000000000", "sysadmin123", StaffRole.SYSTEM_ADMIN, None),
            ("Super Admin", "+91 9000000001", "admin123", StaffRole.SUPER_ADMIN, None),
            ("Kitchen Chef", "+91 9000000002", "kitchen123", StaffRole.KITCHEN, None),
            ("Cashier Ravi", "+91 9000000003", "cashier123", StaffRole.CASHIER, None),
        ]
        for name, phone, pwd, role, bid in staff_data:
            db.add(StaffUser(
                restaurant_id=restaurant.id,
                branch_id=branch.id if bid is None and role not in (StaffRole.SUPER_ADMIN, StaffRole.SYSTEM_ADMIN) else bid,
                role=role, name=name, phone=phone, password_hash=hash_password(pwd),
            ))

        # ── Menu Categories ────────────────────────────────────────────
        cat_starters = MenuCategory(branch_id=branch.id, name="Veg Starters", sort_order=1, estimated_prep_minutes=15)
        cat_main = MenuCategory(branch_id=branch.id, name="Main Course", sort_order=2, estimated_prep_minutes=20)
        cat_beverages = MenuCategory(branch_id=branch.id, name="Beverages", sort_order=3, estimated_prep_minutes=5)
        cat_desserts = MenuCategory(branch_id=branch.id, name="Desserts", sort_order=4, estimated_prep_minutes=10)
        for cat in [cat_starters, cat_main, cat_beverages, cat_desserts]:
            db.add(cat)
        await db.flush()

        # ── Menu Items ─────────────────────────────────────────────────
        items = [
            # Starters
            MenuItem(branch_id=branch.id, category_id=cat_starters.id, name="Paneer Tikka", base_price=220, gst_percent=5, is_veg=True, spice_level="medium", hsn_code="2106", description="Marinated paneer grilled in tandoor"),
            MenuItem(branch_id=branch.id, category_id=cat_starters.id, name="Gobi Manchurian", base_price=190, gst_percent=5, is_veg=True, spice_level="hot", description="Crispy cauliflower in manchurian sauce"),
            MenuItem(branch_id=branch.id, category_id=cat_starters.id, name="Crispy Corn", base_price=200, gst_percent=5, is_veg=True, spice_level="mild"),
            # Main Course
            MenuItem(branch_id=branch.id, category_id=cat_main.id, name="Dal Makhani", base_price=260, gst_percent=5, is_veg=True, is_jain=True, description="Classic creamy black lentils"),
            MenuItem(branch_id=branch.id, category_id=cat_main.id, name="Butter Chicken", base_price=320, gst_percent=5, is_veg=False, spice_level="medium", description="Tender chicken in rich tomato gravy"),
            MenuItem(branch_id=branch.id, category_id=cat_main.id, name="Butter Naan", base_price=50, gst_percent=5, is_veg=True),
            MenuItem(branch_id=branch.id, category_id=cat_main.id, name="Jeera Rice", base_price=120, gst_percent=5, is_veg=True),
            # Beverages
            MenuItem(branch_id=branch.id, category_id=cat_beverages.id, name="Lime Soda", base_price=80, gst_percent=12, is_veg=True),
            MenuItem(branch_id=branch.id, category_id=cat_beverages.id, name="Mango Lassi", base_price=120, gst_percent=12, is_veg=True),
            MenuItem(branch_id=branch.id, category_id=cat_beverages.id, name="Masala Chai", base_price=60, gst_percent=12, is_veg=True),
            # Desserts
            MenuItem(branch_id=branch.id, category_id=cat_desserts.id, name="Gulab Jamun", base_price=90, gst_percent=5, is_veg=True, is_jain=True),
            MenuItem(branch_id=branch.id, category_id=cat_desserts.id, name="Brownie with Ice Cream", base_price=150, gst_percent=18, is_veg=True),
        ]
        for item in items:
            db.add(item)

        await db.commit()
        print("✅ Seed complete!")
        print("\n─── Staff Credentials ───────────────────────────")
        print("Super Admin : +91 9000000001 / admin123")
        print("Kitchen     : +91 9000000002 / kitchen123")
        print("Cashier     : +91 9000000003 / cashier123")
        print("\n─── WhatsApp Config ─────────────────────────────")
        print("Update WA_PHONE_NUMBER_ID in .env with your Meta phone_number_id")
        print("Branch ID:", branch.id)
        print("Restaurant ID:", restaurant.id)


if __name__ == "__main__":
    asyncio.run(seed())
