"""FastAPI router for the AI Menu Scanner & Ingestion Foundation Agent."""
import ipaddress
import socket
import uuid
from typing import Optional
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.tenancy import Branch
from app.models.auth import StaffUser, StaffRole
from app.services.auth_service import get_current_staff
from app.foundation_agents.menu_scanner.adapters import HelloDineAdapter, WebhookJsonAdapter
from app.foundation_agents.menu_scanner.agent import menu_scanner_graph
from app.foundation_agents.menu_scanner.schema import MenuManifest

router = APIRouter(prefix="/api/menu-agent", tags=["AI Menu Scanner Agent"])

ALLOWED_EXTENSIONS = {".xlsx", ".xls", ".csv", ".pdf", ".jpg", ".jpeg", ".png", ".webp"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB limit


def _validate_safe_webhook_url(url: str) -> None:
    """Prevent SSRF by rejecting non-HTTP(S) schemes and private/loopback/link-local IP addresses."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Invalid webhook_url: must be a valid http/https URL.")
    hostname = parsed.hostname.lower()
    if hostname in ("localhost", "127.0.0.1", "0.0.0.0", "::1") or hostname.endswith(".local") or hostname.endswith(".internal"):
        raise HTTPException(status_code=400, detail="SSRF Protection: private or loopback webhook hosts are forbidden.")
    try:
        addr_info = socket.getaddrinfo(hostname, None)
        for item in addr_info:
            ip_str = item[4][0]
            ip_obj = ipaddress.ip_address(ip_str)
            if (
                ip_obj.is_private
                or ip_obj.is_loopback
                or ip_obj.is_link_local
                or ip_obj.is_multicast
                or ip_obj.is_reserved
                or ip_obj.is_unspecified
            ):
                raise HTTPException(status_code=400, detail="SSRF Protection: webhook resolves to a restricted internal IP address.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Could not resolve webhook hostname.")


class CommitMenuRequest(BaseModel):
    branch_id: str
    manifest: MenuManifest
    webhook_url: Optional[str] = None


@router.post("/scan")
async def scan_menu_file(
    file: UploadFile = File(...),
    current_staff: StaffUser = Depends(get_current_staff),
):
    """Scan an uploaded menu file (Excel, CSV, PDF, or Image) and return structured items with HITL flags."""
    if current_staff.role not in (StaffRole.SYSTEM_ADMIN, StaffRole.SUPER_ADMIN, StaffRole.BRANCH_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can scan menu files.")

    filename = file.filename or "menu"
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    file_bytes = await file.read(MAX_UPLOAD_BYTES + 1)
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Uploaded file exceeds 10 MB limit.")

    result = await menu_scanner_graph.ainvoke(
        {
            "file_bytes": file_bytes,
            "filename": filename,
            "mime_type": file.content_type or "",
        }
    )

    if result.get("error"):
        raise HTTPException(status_code=422, detail=result["error"])

    manifest: MenuManifest = result["manifest"]
    return {
        "manifest": manifest.model_dump(),
        "requires_hitl": result.get("requires_hitl", False),
        "parser_used": result.get("parser_used", ""),
    }


@router.post("/commit")
async def commit_menu_manifest(
    payload: CommitMenuRequest,
    db: AsyncSession = Depends(get_db),
    current_staff: StaffUser = Depends(get_current_staff),
):
    """Persist the human-approved MenuManifest to Hello-Dine DB (or an external webhook)."""
    if current_staff.role not in (StaffRole.SYSTEM_ADMIN, StaffRole.SUPER_ADMIN, StaffRole.BRANCH_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can commit scanned menus.")

    try:
        branch_uuid = uuid.UUID(str(payload.branch_id))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid branch_id UUID.")

    res = await db.execute(select(Branch).where(Branch.id == branch_uuid))
    branch = res.scalar_one_or_none()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found.")

    if current_staff.role == StaffRole.SUPER_ADMIN and str(branch.restaurant_id) != str(current_staff.restaurant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied: branch belongs to another restaurant.")
    if current_staff.role == StaffRole.BRANCH_ADMIN and str(branch.id) != str(current_staff.branch_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied: you can only commit menus to your assigned branch.")

    if payload.webhook_url:
        _validate_safe_webhook_url(payload.webhook_url)
        adapter = WebhookJsonAdapter(target_url=payload.webhook_url)
        return await adapter.save_menu(payload.manifest, {"branch_id": payload.branch_id})

    adapter = HelloDineAdapter(db)
    return await adapter.save_menu(payload.manifest, {"branch_id": payload.branch_id})
