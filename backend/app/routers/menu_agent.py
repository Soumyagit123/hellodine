"""FastAPI router for the AI Menu Scanner & Ingestion Foundation Agent."""
from typing import Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.foundation_agents.menu_scanner.adapters import HelloDineAdapter, WebhookJsonAdapter
from app.foundation_agents.menu_scanner.agent import menu_scanner_graph
from app.foundation_agents.menu_scanner.schema import MenuManifest

router = APIRouter(prefix="/api/menu-agent", tags=["AI Menu Scanner Agent"])

ALLOWED_EXTENSIONS = {".xlsx", ".xls", ".csv", ".pdf", ".jpg", ".jpeg", ".png", ".webp"}


class CommitMenuRequest(BaseModel):
    branch_id: str
    manifest: MenuManifest
    webhook_url: Optional[str] = None


@router.post("/scan")
async def scan_menu_file(file: UploadFile = File(...)):
    """Scan an uploaded menu file (Excel, CSV, PDF, or Image) and return structured items with HITL flags."""
    filename = file.filename or "menu"
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

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
):
    """Persist the human-approved MenuManifest to Hello-Dine DB (or an external webhook)."""
    if payload.webhook_url:
        adapter = WebhookJsonAdapter(target_url=payload.webhook_url)
        return await adapter.save_menu(payload.manifest, {"branch_id": payload.branch_id})

    adapter = HelloDineAdapter(db)
    return await adapter.save_menu(payload.manifest, {"branch_id": payload.branch_id})
