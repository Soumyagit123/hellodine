"""LangGraph Human-in-the-Loop (HITL) Menu Scanner Foundation Agent.

Workflow:
1. `extract_node`: Zero-cost Python extraction for Excel/CSV/Digital PDF, or Gemini Vision for Images/Scanned PDFs.
2. `validate_node`: Normalizes categories & flags missing prices / ambiguous items for Human-in-the-Loop review.
3. `hitl_gate`: Returns structured draft manifest to caller so Admin can inspect & fix missing fields.
4. `persist_node`: Executes the configured Database Adapter (HelloDineAdapter, WebhookJsonAdapter, etc.) on approval.
"""
from typing import TypedDict, List, Dict, Any, Optional
from langgraph.graph import StateGraph, END

from .schema import ExtractedMenuItem, ExtractedMenuCategory, MenuManifest
from .parsers import (
    parse_csv_bytes,
    parse_excel_bytes,
    parse_pdf_text_local,
    map_tabular_rows_to_items,
    parse_unstructured_text_with_llm,
    parse_image_with_multimodal_vision,
)


class MenuScannerState(TypedDict, total=False):
    file_bytes: bytes
    filename: str
    mime_type: str
    raw_items: List[ExtractedMenuItem]
    manifest: Optional[MenuManifest]
    requires_hitl: bool
    error: Optional[str]


async def extract_node(state: MenuScannerState) -> MenuScannerState:
    """Node 1: Extract raw menu items using zero-cost local parsers first, falling back to Gemini Vision."""
    filename = (state.get("filename") or "").lower()
    mime_type = (state.get("mime_type") or "").lower()
    file_bytes = state.get("file_bytes") or b""

    if not file_bytes:
        state["error"] = "Empty file uploaded."
        return state

    try:
        items: List[ExtractedMenuItem] = []

        if filename.endswith(".csv") or "csv" in mime_type:
            rows = parse_csv_bytes(file_bytes)
            items = map_tabular_rows_to_items(rows)

        elif filename.endswith(".xlsx") or filename.endswith(".xls") or "spreadsheet" in mime_type or "excel" in mime_type:
            rows = parse_excel_bytes(file_bytes)
            items = map_tabular_rows_to_items(rows)

        elif filename.endswith(".pdf") or "pdf" in mime_type:
            text, is_digital = parse_pdf_text_local(file_bytes)
            if is_digital and text:
                items = await parse_unstructured_text_with_llm(text)
            else:
                # Scanned / image-based PDF
                items = await parse_image_with_multimodal_vision(file_bytes, mime_type="application/pdf")

        elif any(filename.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp")) or mime_type.startswith("image/"):
            actual_mime = mime_type if mime_type.startswith("image/") else "image/jpeg"
            items = await parse_image_with_multimodal_vision(file_bytes, mime_type=actual_mime)

        else:
            state["error"] = f"Unsupported file format: {filename}. Please upload JPG, PNG, PDF, Excel (.xlsx), or CSV."
            return state

        state["raw_items"] = items
    except Exception as exc:
        state["error"] = f"Extraction failed: {str(exc)}"

    return state


async def validate_node(state: MenuScannerState) -> MenuScannerState:
    """Node 2: Group by category, validate fields, and flag incomplete items for HITL review."""
    if state.get("error"):
        return state

    raw_items = state.get("raw_items") or []
    cat_map: Dict[str, List[ExtractedMenuItem]] = {}
    items_ready = 0
    items_needing_review = 0

    for item in raw_items:
        reasons: List[str] = []
        if not item.name or len(item.name.strip()) < 2:
            reasons.append("Missing or invalid dish name")
        if item.base_price is None or item.base_price <= 0:
            reasons.append("Missing or zero price")
        if not item.category or not item.category.strip():
            item.category = "Main Course"
            reasons.append("Defaulted category to Main Course")

        if reasons:
            item.needs_review = True
            item.review_reasons = reasons
            items_needing_review += 1
        else:
            item.needs_review = False
            item.review_reasons = []
            items_ready += 1

        cat_key = item.category.strip()
        if cat_key not in cat_map:
            cat_map[cat_key] = []
        cat_map[cat_key].append(item)

    categories = [
        ExtractedMenuCategory(name=cat_name, items=cat_items)
        for cat_name, cat_items in cat_map.items()
    ]

    manifest = MenuManifest(
        total_categories=len(categories),
        total_items=len(raw_items),
        items_ready=items_ready,
        items_needing_review=items_needing_review,
        categories=categories,
    )

    state["manifest"] = manifest
    state["requires_hitl"] = items_needing_review > 0 or len(raw_items) > 0
    return state


def build_menu_scanner_graph():
    """Builds and compiles the LangGraph workflow for Menu Scanning + HITL validation."""
    graph = StateGraph(MenuScannerState)
    graph.add_node("extract", extract_node)
    graph.add_node("validate", validate_node)

    graph.set_entry_point("extract")
    graph.add_edge("extract", "validate")
    graph.add_edge("validate", END)

    return graph.compile()


menu_scanner_graph = build_menu_scanner_graph()
