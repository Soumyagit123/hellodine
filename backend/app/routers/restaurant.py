"""Restaurant, Branch, Table & QR token router — /api/admin"""
import uuid, secrets
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from datetime import datetime

from app.database import get_db
from app.models.tenancy import Restaurant, Branch, Table, TableQRToken
from app.models.auth import StaffUser, StaffRole
from app.services.auth_service import get_current_staff
from app.services.cache_service import cache

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ─── Schemas ────────────────────────────────────────────────────────────────
class RestaurantCreate(BaseModel):
    name: str
    gstin: str | None = None
    fssai_license_number: str | None = None
    whatsapp_phone_number_id: str | None = None
    whatsapp_display_number: str | None = None
    whatsapp_access_token: str | None = None
    whatsapp_verify_token: str = "hellodine"
    whatsapp_app_secret: str | None = None
    whatsapp_app_id: str | None = None
    merchant_upi_id: str | None = None
    subscription_plan: str = "STARTER"
    subscription_status: str = "ACTIVE"
    max_branches: int = 1

class RestaurantUpdate(BaseModel):
    name: str | None = None
    gstin: str | None = None
    fssai_license_number: str | None = None
    merchant_upi_id: str | None = None
    subscription_plan: str | None = None
    subscription_status: str | None = None
    subscription_expires_at: datetime | None = None
    max_branches: int | None = None
    is_active: bool | None = None
    whatsapp_phone_number_id: str | None = None
    whatsapp_display_number: str | None = None
    whatsapp_access_token: str | None = None
    whatsapp_verify_token: str | None = None
    whatsapp_app_secret: str | None = None
    whatsapp_app_id: str | None = None

class SubscriptionRenewalRequest(BaseModel):
    plan: str  # "STARTER" | "PRO_AI" | "ANNUAL_PRO"
    utr_reference: str
    amount: int

class SubscriptionApproveRequest(BaseModel):
    days: int = 30
    plan: str | None = None

class ResetPasswordRequest(BaseModel):
    new_password: str


class BranchCreate(BaseModel):
    restaurant_id: uuid.UUID
    name: str
    address: str
    city: str
    state: str
    pincode: str
    gstin: str | None = None


class TableCreate(BaseModel):
    branch_id: uuid.UUID
    table_number: int


class StaffCreate(BaseModel):
    restaurant_id: uuid.UUID
    branch_id: uuid.UUID | None = None
    role: StaffRole
    name: str
    phone: str
    password: str


class StaffOut(BaseModel):
    id: uuid.UUID
    name: str
    phone: str
    role: StaffRole
    branch_id: uuid.UUID | None
    is_active: bool
    model_config = {"from_attributes": True}


# ─── Restaurants ─────────────────────────────────────────────────────────────
@router.post("/restaurants")
async def create_restaurant(
    data: RestaurantCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    if current_staff.role != StaffRole.SYSTEM_ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only SaaS System Admin can onboard new restaurants")

    payload = data.model_dump()
    if not payload.get("whatsapp_phone_number_id"):
        payload["whatsapp_phone_number_id"] = f"kiosk_{uuid.uuid4().hex[:12]}"
    if not payload.get("whatsapp_display_number"):
        payload["whatsapp_display_number"] = "+91 0000000000"

    r = Restaurant(**payload)
    db.add(r)
    await db.commit()
    await db.refresh(r)
    cache.invalidate_prefix("admin_all_restaurants")
    return r


@router.get("/restaurants")
async def list_restaurants(
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    if current_staff.role != StaffRole.SYSTEM_ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only SaaS System Admin can list all restaurants")
    cached = cache.get("admin_all_restaurants")
    if cached is not None:
        return cached
    result = await db.execute(select(Restaurant).order_by(Restaurant.created_at.desc()))
    restaurants = result.scalars().all()
    cache.set("admin_all_restaurants", restaurants, ttl_seconds=60)
    return restaurants


@router.get("/restaurants/{restaurant_id}")
async def get_restaurant(
    restaurant_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    if current_staff.role != StaffRole.SYSTEM_ADMIN and str(current_staff.restaurant_id) != str(restaurant_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to another restaurant's configuration")
    cache_key = f"restaurant_info:{restaurant_id}:{current_staff.role.value}"
    cached = await cache.aget(cache_key)
    if cached is not None:
        return cached
    result = await db.execute(select(Restaurant).where(Restaurant.id == restaurant_id))
    r = result.scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Restaurant not found")
    # Never expose sensitive WhatsApp tokens/secrets to non-System-Admin callers
    if current_staff.role != StaffRole.SYSTEM_ADMIN:
        out = {
            "id": r.id,
            "name": r.name,
            "gstin": r.gstin,
            "fssai_license_number": r.fssai_license_number,
            "whatsapp_phone_number_id": r.whatsapp_phone_number_id,
            "whatsapp_display_number": r.whatsapp_display_number,
            "merchant_upi_id": r.merchant_upi_id,
            "subscription_plan": r.subscription_plan,
            "subscription_status": r.subscription_status,
            "subscription_expires_at": r.subscription_expires_at,
            "pending_renewal_plan": r.pending_renewal_plan,
            "pending_renewal_utr": r.pending_renewal_utr,
            "pending_renewal_amount": r.pending_renewal_amount,
            "max_branches": r.max_branches,
            "is_active": r.is_active,
            "created_at": r.created_at,
        }
        cache.set(cache_key, out, ttl_seconds=86400)
        return out
    cache.set(cache_key, r, ttl_seconds=86400)
    return r


# Fields that ONLY SYSTEM_ADMIN is allowed to modify
_SYSTEM_ADMIN_ONLY_RESTAURANT_FIELDS = {
    "subscription_plan",
    "subscription_status",
    "subscription_expires_at",
    "max_branches",
    "is_active",
}


@router.patch("/restaurants/{restaurant_id}")
async def update_restaurant(
    restaurant_id: uuid.UUID,
    data: RestaurantUpdate,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    if current_staff.role not in (StaffRole.SYSTEM_ADMIN, StaffRole.SUPER_ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions to update restaurant settings")
    if current_staff.role == StaffRole.SUPER_ADMIN and str(current_staff.restaurant_id) != str(restaurant_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only update your own restaurant settings")

    result = await db.execute(select(Restaurant).where(Restaurant.id == restaurant_id))
    r = result.scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Restaurant not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key in _SYSTEM_ADMIN_ONLY_RESTAURANT_FIELDS and current_staff.role != StaffRole.SYSTEM_ADMIN:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Only SaaS System Admin can modify '{key}'",
            )
        setattr(r, key, value)

    await db.commit()
    await db.refresh(r)
    cache.invalidate_prefix("admin_all_restaurants")
    cache.invalidate_prefix(f"restaurant_info:{restaurant_id}")
    cache.invalidate_prefix("static_menu:")
    return r


@router.post("/restaurants/{restaurant_id}/reset-owner-password")
async def reset_owner_password(
    restaurant_id: uuid.UUID,
    data: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    """Allow System Admin to reset the password for a restaurant's owner (Super Admin)."""
    if current_staff.role != StaffRole.SYSTEM_ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only SaaS System Admin can reset owner passwords")
    from app.services.auth_service import hash_password
    # Find the Super Admin for this restaurant
    result = await db.execute(select(StaffUser).where(StaffUser.restaurant_id == restaurant_id, StaffUser.role == StaffRole.SUPER_ADMIN))
    owner = result.scalar_one_or_none()
    if not owner:
        raise HTTPException(404, "Owner account not found for this restaurant")
    
    owner.password_hash = hash_password(data.new_password)
    await db.commit()
    return {"ok": True}


# ─── SaaS Subscription & Plan Endpoints ─────────────────────────────────────
SAAS_PLANS = [
    {
        "id": "STARTER",
        "name": "Starter All-In-One Plan (Launch Offer)",
        "price_monthly": 1999,
        "duration_days": 30,
        "badge": "Current Launch Offer — All AI Features Included!",
        "features": [
            "Smart Table Kiosk UI with Visual Food Photos",
            "Full AI Voice & Chat Waiter (Mic + Speaker)",
            "AI Top-3 Bestseller Recommender & Auto-Pick Dish",
            "Kids Cartoon Video Theatre & Birthday Song Celebration",
            "Live Kitchen Kanban Board & Cashier GST Billing",
            "Direct Table UPI QR Code Payment to Your Bank",
        ],
    },
    {
        "id": "PRO_AI",
        "name": "Pro AI Multi-Table Plan",
        "price_monthly": 3499,
        "duration_days": 30,
        "badge": "Future Advanced AI Tier",
        "features": [
            "Everything in Starter Plan + Unlimited Tables",
            "Multi-Branch Chain Management & Analytics",
            "Future Advanced AI Voice Personalization & CRM",
            "Priority 24/7 Support & Custom Branding",
        ],
    },
    {
        "id": "ANNUAL_PRO",
        "name": "Annual All-Access Plan (Save 2 Months)",
        "price_monthly": 19990,
        "duration_days": 365,
        "badge": "Best Value — 12 Months",
        "features": [
            "Full Year Access to All Kiosk, Kitchen, Cashier & AI Waiter Features",
            "2 Months Free + Free Menu Onboarding",
        ],
    },
]


@router.get("/saas/plans")
async def get_saas_plans():
    """Return available SaaS subscription plans and the platform owner's UPI ID for direct 0%-fee QR payment."""
    from app.config import settings
    return {
        "owner_upi_id": settings.SAAS_OWNER_UPI_ID,
        "owner_name": settings.SAAS_OWNER_NAME,
        "plans": SAAS_PLANS,
    }


@router.post("/restaurants/{restaurant_id}/request-renewal")
async def request_subscription_renewal(
    restaurant_id: uuid.UUID,
    data: SubscriptionRenewalRequest,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    """Restaurant owner submits UPI UTR after scanning SaaS Owner's QR code."""
    if current_staff.role not in (StaffRole.SUPER_ADMIN, StaffRole.SYSTEM_ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only restaurant owners can request subscription renewal")
    if current_staff.role == StaffRole.SUPER_ADMIN and str(current_staff.restaurant_id) != str(restaurant_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied: cannot submit renewal for another restaurant")

    result = await db.execute(select(Restaurant).where(Restaurant.id == restaurant_id))
    r = result.scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Restaurant not found")

    r.pending_renewal_plan = data.plan
    r.pending_renewal_utr = data.utr_reference.strip()
    r.pending_renewal_amount = data.amount
    await db.commit()
    await db.refresh(r)
    cache.invalidate_prefix(f"restaurant_info:{restaurant_id}")
    return {"ok": True, "message": "Renewal payment submitted! Your plan will be updated shortly."}


@router.post("/restaurants/{restaurant_id}/approve-renewal")
async def approve_subscription_renewal(
    restaurant_id: uuid.UUID,
    data: SubscriptionApproveRequest,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    """System Admin approves a restaurant's subscription renewal in 1 click and extends expiry."""
    if current_staff.role != StaffRole.SYSTEM_ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only SaaS System Admin can approve subscription renewals")
    from datetime import timedelta, timezone
    result = await db.execute(select(Restaurant).where(Restaurant.id == restaurant_id))
    r = result.scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Restaurant not found")

    now = datetime.now(timezone.utc)
    base_time = r.subscription_expires_at if (r.subscription_expires_at and r.subscription_expires_at > now) else now
    r.subscription_expires_at = base_time + timedelta(days=data.days)
    r.subscription_plan = data.plan or r.pending_renewal_plan or r.subscription_plan or "STARTER"
    r.subscription_status = "ACTIVE"
    r.is_active = True
    r.pending_renewal_plan = None
    r.pending_renewal_utr = None
    r.pending_renewal_amount = None

    await db.commit()
    await db.refresh(r)
    cache.invalidate_prefix(f"restaurant_info:{restaurant_id}")
    cache.invalidate_prefix("admin_all_restaurants")
    return r


# ─── Branches ────────────────────────────────────────────────────────────────
@router.post("/branches")
async def create_branch(data: BranchCreate, db: AsyncSession = Depends(get_db), current_staff: StaffUser = Depends(get_current_staff)):
    if current_staff.role not in [StaffRole.SUPER_ADMIN, StaffRole.SYSTEM_ADMIN]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only owners or system admins can create branches")
    if current_staff.role == StaffRole.SUPER_ADMIN and str(data.restaurant_id) != str(current_staff.restaurant_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied: cannot create branches for another restaurant")
        
    # Check branch limit
    rest_result = await db.execute(select(Restaurant).where(Restaurant.id == data.restaurant_id))
    restaurant = rest_result.scalar_one_or_none()
    if not restaurant:
        raise HTTPException(404, "Restaurant not found")

    branch_count = await db.execute(select(func.count(Branch.id)).where(Branch.restaurant_id == data.restaurant_id))
    count = branch_count.scalar_one()

    if count >= restaurant.max_branches:
        raise HTTPException(400, f"Branch limit ({restaurant.max_branches}) reached for this restaurant. Please contact the provider to upgrade.")

    b = Branch(**data.model_dump())
    db.add(b)
    await db.commit()
    await db.refresh(b)
    cache.invalidate_prefix(f"branches:{data.restaurant_id}")
    return b


@router.get("/branches")
async def list_branches(restaurant_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_staff: StaffUser = Depends(get_current_staff)):
    if current_staff.role != StaffRole.SYSTEM_ADMIN and str(restaurant_id) != str(current_staff.restaurant_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to another restaurant's branches")

    cache_key = f"branches:{restaurant_id}:{current_staff.role.value}:{current_staff.branch_id or 'all'}"
    cached = await cache.aget(cache_key)
    if cached is not None:
        return cached

    if current_staff.role == StaffRole.BRANCH_ADMIN:
        # A branch admin should only see their own branch in listings
        result = await db.execute(select(Branch).where(Branch.id == current_staff.branch_id))
    else:
        result = await db.execute(select(Branch).where(Branch.restaurant_id == restaurant_id))
    branches = result.scalars().all()
    cache.set(cache_key, branches, ttl_seconds=86400)
    return branches


@router.patch("/branches/{branch_id}")
async def update_branch(branch_id: uuid.UUID, data: dict, db: AsyncSession = Depends(get_db), current_staff: StaffUser = Depends(get_current_staff)):
    result = await db.execute(select(Branch).where(Branch.id == branch_id))
    b = result.scalar_one_or_none()
    if not b:
        raise HTTPException(404, "Branch not found")

    if current_staff.role == StaffRole.SUPER_ADMIN and str(b.restaurant_id) != str(current_staff.restaurant_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to this branch")
    elif current_staff.role == StaffRole.BRANCH_ADMIN and str(b.id) != str(current_staff.branch_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to update another branch")
    elif current_staff.role not in [StaffRole.SUPER_ADMIN, StaffRole.SYSTEM_ADMIN, StaffRole.BRANCH_ADMIN]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")

    for field in ["name", "address", "city", "state", "pincode", "gstin"]:
        if field in data and data[field] is not None:
            setattr(b, field, str(data[field]).strip())

    await db.commit()
    await db.refresh(b)
    cache.invalidate_prefix(f"branches:{b.restaurant_id}")
    return b


@router.delete("/branches/{branch_id}")
async def delete_branch(branch_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_staff: StaffUser = Depends(get_current_staff)):
    if current_staff.role not in [StaffRole.SUPER_ADMIN, StaffRole.SYSTEM_ADMIN]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only restaurant owners or system admins can delete branches")

    result = await db.execute(select(Branch).where(Branch.id == branch_id))
    b = result.scalar_one_or_none()
    if not b:
        raise HTTPException(404, "Branch not found")

    if current_staff.role == StaffRole.SUPER_ADMIN and str(b.restaurant_id) != str(current_staff.restaurant_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to delete another restaurant's branch")

    await db.delete(b)
    await db.commit()
    cache.invalidate_prefix(f"branches:{b.restaurant_id}")
    return {"ok": True}


# ─── Tables ──────────────────────────────────────────────────────────────────
@router.post("/tables")
async def create_table(data: TableCreate, db: AsyncSession = Depends(get_db), current_staff: StaffUser = Depends(get_current_staff)):
    branch_res = await db.execute(select(Branch).where(Branch.id == data.branch_id))
    branch = branch_res.scalar_one_or_none()
    if not branch:
        raise HTTPException(404, "Branch not found")

    if current_staff.role == StaffRole.BRANCH_ADMIN:
        if str(data.branch_id) != str(current_staff.branch_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Branch admins can only create tables for their assigned branch")
    elif current_staff.role == StaffRole.SUPER_ADMIN:
        if str(branch.restaurant_id) != str(current_staff.restaurant_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to another restaurant's branch")
    elif current_staff.role != StaffRole.SYSTEM_ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")

    t = Table(**data.model_dump())
    db.add(t)
    await db.commit()
    await db.refresh(t)
    cache.invalidate_prefix(f"tables:{data.branch_id}")
    return t


@router.get("/tables")
async def list_tables(branch_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_staff: StaffUser = Depends(get_current_staff)):
    if current_staff.role == StaffRole.BRANCH_ADMIN and str(branch_id) != str(current_staff.branch_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to this branch's tables")

    cache_key = f"tables:{branch_id}:{current_staff.restaurant_id}"
    cached = await cache.aget(cache_key)
    if cached is not None:
        return cached

    branch_res = await db.execute(select(Branch).where(Branch.id == branch_id))
    branch = branch_res.scalar_one_or_none()
    if not branch:
        raise HTTPException(404, "Branch not found")

    if current_staff.role != StaffRole.SYSTEM_ADMIN:
        if str(branch.restaurant_id) != str(current_staff.restaurant_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to another restaurant's tables")

    result = await db.execute(select(Table).where(Table.branch_id == branch_id, Table.is_active == True))
    tables = result.scalars().all()
    cache.set(cache_key, tables, ttl_seconds=86400)
    return tables


@router.patch("/tables/{table_id}")
async def update_table(table_id: uuid.UUID, data: dict, db: AsyncSession = Depends(get_db), current_staff: StaffUser = Depends(get_current_staff)):
    result = await db.execute(select(Table).where(Table.id == table_id))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Table not found")
    branch_res = await db.execute(select(Branch).where(Branch.id == t.branch_id))
    branch = branch_res.scalar_one_or_none()
    if current_staff.role == StaffRole.BRANCH_ADMIN and str(t.branch_id) != str(current_staff.branch_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to this table")
    elif current_staff.role == StaffRole.SUPER_ADMIN and (not branch or str(branch.restaurant_id) != str(current_staff.restaurant_id)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to another restaurant's table")
    elif current_staff.role not in [StaffRole.SUPER_ADMIN, StaffRole.SYSTEM_ADMIN, StaffRole.BRANCH_ADMIN]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")

    if "table_number" in data:
        t.table_number = int(data["table_number"])
    if "is_active" in data:
        t.is_active = bool(data["is_active"])
    await db.commit()
    cache.invalidate_prefix(f"tables:{t.branch_id}")
    return t


@router.delete("/tables/{table_id}")
async def delete_table(table_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_staff: StaffUser = Depends(get_current_staff)):
    result = await db.execute(select(Table).where(Table.id == table_id))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Table not found")
    branch_res = await db.execute(select(Branch).where(Branch.id == t.branch_id))
    branch = branch_res.scalar_one_or_none()
    if current_staff.role == StaffRole.BRANCH_ADMIN and str(t.branch_id) != str(current_staff.branch_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to this table")
    elif current_staff.role == StaffRole.SUPER_ADMIN and (not branch or str(branch.restaurant_id) != str(current_staff.restaurant_id)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to another restaurant's table")
    elif current_staff.role not in [StaffRole.SUPER_ADMIN, StaffRole.SYSTEM_ADMIN, StaffRole.BRANCH_ADMIN]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")

    t.is_active = False
    await db.commit()
    cache.invalidate_prefix(f"tables:{t.branch_id}")
    return {"ok": True}


@router.post("/tables/{table_id}/qr")
async def generate_qr(
    table_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    """Generate a new secure QR token for a table."""
    if current_staff.role not in (StaffRole.SYSTEM_ADMIN, StaffRole.SUPER_ADMIN, StaffRole.BRANCH_ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can generate or rotate table QR tokens")

    table_result = await db.execute(select(Table).where(Table.id == table_id))
    table = table_result.scalar_one_or_none()
    if not table:
        raise HTTPException(404, "Table not found")

    branch_result = await db.execute(select(Branch).where(Branch.id == table.branch_id))
    branch = branch_result.scalar_one_or_none()
    if not branch:
        raise HTTPException(404, "Branch not found")

    if current_staff.role == StaffRole.BRANCH_ADMIN and str(table.branch_id) != str(current_staff.branch_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to this table")
    if current_staff.role == StaffRole.SUPER_ADMIN and str(branch.restaurant_id) != str(current_staff.restaurant_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to another restaurant's table")

    # Revoke previous tokens
    existing = await db.execute(
        select(TableQRToken).where(TableQRToken.table_id == table_id, TableQRToken.is_revoked == False)
    )
    for tok in existing.scalars().all():
        tok.is_revoked = True

    token_str = secrets.token_urlsafe(32)
    qr = TableQRToken(table_id=table_id, token=token_str)
    db.add(qr)
    await db.commit()
    await db.refresh(qr)

    rest_result = await db.execute(select(Restaurant).where(Restaurant.id == branch.restaurant_id))
    restaurant = rest_result.scalar_one()

    wa_message = (
        f"HELLODINE_START\n"
        f"branch={branch.id}\n"
        f"table={table.table_number}\n"
        f"token={token_str}"
    )
    wa_link = f"https://wa.me/{restaurant.whatsapp_display_number}?text={wa_message.replace(chr(10), '%0A')}"
    kiosk_path = f"/table/{token_str}"

    return {
        "token": token_str,
        "wa_link": wa_link,
        "kiosk_path": kiosk_path,
        "table_id": str(table.id),
        "table_number": table.table_number,
        "branch_id": str(branch.id),
    }


# ─── Staff ────────────────────────────────────────────────────────────────────
@router.post("/staff", response_model=StaffOut)
async def create_staff(data: StaffCreate, db: AsyncSession = Depends(get_db), current_staff: StaffUser = Depends(get_current_staff)):
    # Prevent privilege escalation to SYSTEM_ADMIN by non-System-Admin
    if data.role == StaffRole.SYSTEM_ADMIN and current_staff.role != StaffRole.SYSTEM_ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only SaaS System Admin can create SYSTEM_ADMIN accounts")

    if current_staff.role == StaffRole.BRANCH_ADMIN:
        if str(data.restaurant_id) != str(current_staff.restaurant_id) or str(data.branch_id) != str(current_staff.branch_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Branch admins can only manage staff for their assigned branch")
        if data.role in [StaffRole.SUPER_ADMIN, StaffRole.BRANCH_ADMIN, StaffRole.SYSTEM_ADMIN]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Branch admins cannot create other admins")
    elif current_staff.role == StaffRole.SUPER_ADMIN:
        if str(data.restaurant_id) != str(current_staff.restaurant_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot create staff for another restaurant")
    elif current_staff.role != StaffRole.SYSTEM_ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")

    from app.services.auth_service import hash_password
    s = StaffUser(
        restaurant_id=data.restaurant_id,
        branch_id=data.branch_id,
        role=data.role,
        name=data.name,
        phone=data.phone,
        password_hash=hash_password(data.password),
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    cache.invalidate_prefix(f"staff:{data.restaurant_id}")
    return s


@router.get("/staff", response_model=list[StaffOut])
async def list_staff(restaurant_id: uuid.UUID, branch_id: uuid.UUID | None = None, db: AsyncSession = Depends(get_db), current_staff: StaffUser = Depends(get_current_staff)):
    if current_staff.role not in (StaffRole.SYSTEM_ADMIN, StaffRole.SUPER_ADMIN, StaffRole.BRANCH_ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions to list staff")
    if current_staff.role != StaffRole.SYSTEM_ADMIN and str(restaurant_id) != str(current_staff.restaurant_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to another restaurant's staff")

    effective_branch = current_staff.branch_id if current_staff.role == StaffRole.BRANCH_ADMIN else branch_id
    cache_key = f"staff:{restaurant_id}:{effective_branch or 'all'}"
    cached = await cache.aget(cache_key)
    if cached is not None:
        return cached

    # Data isolation
    from app.models.tenancy import Branch
    query = select(StaffUser, Branch.name.label("branch_name")).outerjoin(Branch, StaffUser.branch_id == Branch.id).where(StaffUser.restaurant_id == restaurant_id)
    
    if current_staff.role == StaffRole.BRANCH_ADMIN:
        # Force filter by their branch
        query = query.where(StaffUser.branch_id == current_staff.branch_id)
    elif branch_id:
        query = query.where(StaffUser.branch_id == branch_id)
        
    result = await db.execute(query)
    rows = result.all()
    
    staff_list = []
    for staff, branch_name in rows:
        staff_list.append({
            "id": staff.id,
            "name": staff.name,
            "phone": staff.phone,
            "role": staff.role,
            "branch_id": staff.branch_id,
            "branch_name": branch_name,
            "is_active": staff.is_active,
        })
        
    cache.set(cache_key, staff_list, ttl_seconds=86400)
    return staff_list


@router.patch("/staff/{staff_id}")
async def update_staff(staff_id: uuid.UUID, data: dict, db: AsyncSession = Depends(get_db), current_staff: StaffUser = Depends(get_current_staff)):
    result = await db.execute(select(StaffUser).where(StaffUser.id == staff_id))
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Staff not found")

    if current_staff.role == StaffRole.BRANCH_ADMIN:
        if str(s.branch_id) != str(current_staff.branch_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to staff outside your branch")
        if s.role in (StaffRole.SUPER_ADMIN, StaffRole.SYSTEM_ADMIN, StaffRole.BRANCH_ADMIN) and str(s.id) != str(current_staff.id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Branch admins cannot modify other admin accounts")
    elif current_staff.role == StaffRole.SUPER_ADMIN:
        if str(s.restaurant_id) != str(current_staff.restaurant_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to staff in another restaurant")
    elif current_staff.role != StaffRole.SYSTEM_ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")

    if "role" in data and data["role"]:
        target_role = str(data["role"])
        if target_role == StaffRole.SYSTEM_ADMIN.value and current_staff.role != StaffRole.SYSTEM_ADMIN:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot escalate role to SYSTEM_ADMIN")
        if current_staff.role == StaffRole.BRANCH_ADMIN and target_role in (StaffRole.SUPER_ADMIN.value, StaffRole.BRANCH_ADMIN.value, StaffRole.SYSTEM_ADMIN.value):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Branch admins cannot assign admin roles")
        s.role = data["role"]

    if "name" in data and data["name"]:
        s.name = data["name"].strip()
    if "phone" in data and data["phone"]:
        s.phone = data["phone"].strip()
    if "branch_id" in data:
        if current_staff.role == StaffRole.BRANCH_ADMIN and str(data["branch_id"]) != str(current_staff.branch_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Branch admins cannot move staff to another branch")
        s.branch_id = uuid.UUID(data["branch_id"]) if data["branch_id"] else None
    if "is_active" in data:
        s.is_active = bool(data["is_active"])
    if "password" in data and data["password"]:
        from app.services.auth_service import hash_password
        s.password_hash = hash_password(data["password"])

    await db.commit()
    await db.refresh(s)
    cache.invalidate_prefix(f"staff:{s.restaurant_id}")
    cache.delete(f"auth_staff_obj:{s.id}")
    return {"ok": True, "id": str(s.id), "name": s.name}


@router.delete("/staff/{staff_id}")
async def delete_staff(staff_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_staff: StaffUser = Depends(get_current_staff)):
    result = await db.execute(select(StaffUser).where(StaffUser.id == staff_id))
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Staff not found")

    if current_staff.role == StaffRole.BRANCH_ADMIN and str(s.branch_id) != str(current_staff.branch_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to staff outside your branch")
    elif current_staff.role == StaffRole.SUPER_ADMIN and str(s.restaurant_id) != str(current_staff.restaurant_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to staff in another restaurant")
    elif current_staff.role not in [StaffRole.SUPER_ADMIN, StaffRole.SYSTEM_ADMIN, StaffRole.BRANCH_ADMIN]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")

    # Soft delete
    s.is_active = False
    await db.commit()
    cache.invalidate_prefix(f"staff:{s.restaurant_id}")
    cache.delete(f"auth_staff_obj:{s.id}")
    return {"ok": True}


@router.patch("/staff/{staff_id}/deactivate")
async def deactivate_staff(
    staff_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    result = await db.execute(select(StaffUser).where(StaffUser.id == staff_id))
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Staff not found")

    if current_staff.role == StaffRole.BRANCH_ADMIN and str(s.branch_id) != str(current_staff.branch_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to staff outside your branch")
    elif current_staff.role == StaffRole.SUPER_ADMIN and str(s.restaurant_id) != str(current_staff.restaurant_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to staff in another restaurant")
    elif current_staff.role not in [StaffRole.SUPER_ADMIN, StaffRole.SYSTEM_ADMIN, StaffRole.BRANCH_ADMIN]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")

    s.is_active = False
    await db.commit()
    cache.invalidate_prefix(f"staff:{s.restaurant_id}")
    cache.delete(f"auth_staff_obj:{s.id}")
    return {"ok": True}
