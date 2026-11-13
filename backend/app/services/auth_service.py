"""JWT auth utilities for staff login."""
from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordBearer

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.config import settings
from app.database import get_db
from app.models.auth import StaffUser

import bcrypt

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode('utf-8'), hashed.encode('utf-8'))
    except Exception:
        return False

def hash_password(plain: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(plain.encode('utf-8'), salt).decode('utf-8')


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def extract_token_from_request(request: Request, header_token: str | None) -> str | None:
    """Extract token from Authorization header or fallback to HttpOnly cookie."""
    if header_token:
        return header_token
    # Check HttpOnly cookie
    cookie_token = request.cookies.get("hd_access_token")
    if cookie_token:
        return cookie_token
    return None


async def get_optional_staff(
    request: Request,
    token: str | None = Depends(oauth2_scheme_optional),
    db: AsyncSession = Depends(get_db),
) -> StaffUser | None:
    """Returns authenticated StaffUser if a valid Bearer token or HttpOnly cookie is provided, or None."""
    resolved_token = extract_token_from_request(request, token)
    if not resolved_token:
        return None
    try:
        payload = jwt.decode(resolved_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        staff_id: str = payload.get("sub")
        if not staff_id:
            return None
        res = await db.execute(select(StaffUser).where(StaffUser.id == staff_id, StaffUser.is_active == True))
        return res.scalar_one_or_none()
    except Exception:
        return None


async def get_current_staff(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> StaffUser:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    resolved_token = extract_token_from_request(request, token)
    if not resolved_token:
        raise credentials_exc

    try:
        payload = jwt.decode(resolved_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        staff_id: str = payload.get("sub")
        if staff_id is None:
            raise credentials_exc
    except JWTError:
        raise credentials_exc

    result = await db.execute(select(StaffUser).where(StaffUser.id == staff_id, StaffUser.is_active == True))
    staff = result.scalar_one_or_none()
    if staff is None:
        raise credentials_exc
    return staff
