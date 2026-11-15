"""Auth router — /api/auth"""
import time
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, func
from pydantic import BaseModel, Field
import uuid

from app.database import get_db
from app.config import settings
from app.models.auth import StaffUser, StaffRole
from app.services.auth_service import verify_password, create_access_token, get_current_staff

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Per-IP Brute-Force Rate Limiter (Max 10 failed attempts per 60s window)
_LOGIN_ATTEMPTS: dict[str, list[float]] = {}
_MAX_FAILED_ATTEMPTS = 10
_LOCKOUT_WINDOW_SECONDS = 60.0


def _check_rate_limit(client_ip: str) -> None:
    now = time.monotonic()
    attempts = [t for t in _LOGIN_ATTEMPTS.get(client_ip, []) if now - t < _LOCKOUT_WINDOW_SECONDS]
    _LOGIN_ATTEMPTS[client_ip] = attempts
    if len(attempts) >= _MAX_FAILED_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts. Please wait 1 minute before retrying.",
        )


def _record_failed_attempt(client_ip: str) -> None:
    now = time.monotonic()
    attempts = [t for t in _LOGIN_ATTEMPTS.get(client_ip, []) if now - t < _LOCKOUT_WINDOW_SECONDS]
    attempts.append(now)
    _LOGIN_ATTEMPTS[client_ip] = attempts


def _clear_failed_attempts(client_ip: str) -> None:
    _LOGIN_ATTEMPTS.pop(client_ip, None)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    role: str
    name: str
    restaurant_id: str
    restaurant_name: str
    branch_id: str | None


class StaffOut(BaseModel):
    id: uuid.UUID
    name: str
    phone: str
    role: StaffRole
    branch_id: uuid.UUID | None
    branch_name: str | None = None
    is_active: bool

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=6, max_length=128)

    model_config = {"from_attributes": True}


@router.post("/login", response_model=TokenResponse)
async def login(
    request: Request,
    response: Response,
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db)
):
    from app.models.tenancy import Restaurant

    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    raw_username = (form.username or "").strip()
    if not raw_username or not form.password:
        _record_failed_attempt(client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid phone or password")

    digits_only = "".join(ch for ch in raw_username if ch.isdigit())
    lower_input = raw_username.lower()

    # Targeted SQL query instead of loading all staff users into memory (PERF-01)
    conditions = [
        func.lower(StaffUser.phone) == lower_input,
        func.lower(StaffUser.name) == lower_input,
    ]
    if len(digits_only) >= 10:
        last_10 = digits_only[-10:]
        conditions.append(StaffUser.phone.ilike(f"%{last_10}"))
    if lower_input in ("sysadmin", "systemadmin", "admin@hellodine"):
        conditions.append(StaffUser.role == StaffRole.SYSTEM_ADMIN)

    result = await db.execute(
        select(StaffUser).where(
            StaffUser.is_active == True,
            or_(*conditions),
        )
    )
    candidates = result.scalars().all()

    staff = None
    for s in candidates:
        s_login = (s.phone or "").strip()
        s_name = (s.name or "").strip()
        s_digits = "".join(ch for ch in s_login if ch.isdigit())

        if (
            s_login.lower() == lower_input
            or s_name.lower() == lower_input
            or (len(digits_only) >= 10 and len(s_digits) >= 10 and digits_only[-10:] == s_digits[-10:])
            or (lower_input in ("sysadmin", "systemadmin", "admin@hellodine") and s.role == StaffRole.SYSTEM_ADMIN)
        ):
            if verify_password(form.password, s.password_hash):
                staff = s
                break

    if not staff:
        _record_failed_attempt(client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid phone or password")

    _clear_failed_attempts(client_ip)

    res_result = await db.execute(select(Restaurant).where(Restaurant.id == staff.restaurant_id))
    restaurant = res_result.scalar_one_or_none()
    rest_name = restaurant.name if restaurant else "HelloDine"
    role_str = str(staff.role.value if hasattr(staff.role, "value") else staff.role)

    token = create_access_token({"sub": str(staff.id), "role": role_str, "restaurant_id": str(staff.restaurant_id)})
    response.set_cookie(
        key="hd_access_token",
        value=token,
        httponly=True,
        secure=settings.ENVIRONMENT.lower() in ("production", "prod"),
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/api",
    )
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        role=role_str,
        name=staff.name,
        restaurant_id=str(staff.restaurant_id),
        restaurant_name=rest_name,
        branch_id=str(staff.branch_id) if staff.branch_id else None,
    )


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(key="hd_access_token", path="/api")
    return {"ok": True}


@router.get("/me", response_model=StaffOut)
async def me(staff: StaffUser = Depends(get_current_staff), db: AsyncSession = Depends(get_db)):
    if staff.branch_id:
        from app.models.tenancy import Branch
        b = await db.get(Branch, staff.branch_id)
        if b:
            setattr(staff, "branch_name", b.name)
    return staff


@router.post("/change-password")
async def change_password(data: ChangePasswordRequest, db: AsyncSession = Depends(get_db), staff: StaffUser = Depends(get_current_staff)):
    if not verify_password(data.current_password, staff.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect current password")
    
    from app.services.auth_service import hash_password
    staff.password_hash = hash_password(data.new_password)
    await db.commit()
    return {"ok": True}
