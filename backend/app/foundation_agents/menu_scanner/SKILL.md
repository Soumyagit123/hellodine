---
name: menu-scanner-agent
description: Reusable LangGraph Human-in-the-Loop (HITL) AI Menu Scanner & Ingestion Foundation Agent. Extracts structured restaurant menus from Excel, CSV, PDF, and Images with zero-cost local parsing for tabular/digital files and Gemini Vision for images, then persists to any database via pluggable adapters.
---

# Menu Scanner & Ingestion Foundation Agent

A standalone, database-agnostic LangGraph agent for scanning restaurant menu files (`.xlsx`, `.xls`, `.csv`, `.pdf`, `.jpg`, `.jpeg`, `.png`, `.webp`), flagging incomplete items for Human-in-the-Loop (HITL) review, and persisting approved menus to any backend database.

## Architecture

```
backend/app/foundation_agents/menu_scanner/
├── schema.py     # Canonical Pydantic models (MenuManifest, ExtractedMenuCategory, ExtractedMenuItem)
├── parsers.py    # Zero-cost local parsers (csv, openpyxl, pypdf) + Gemini 2.5 Flash fallback
├── adapters.py   # Pluggable DB adapters (BaseMenuDatabaseAdapter, HelloDineAdapter, WebhookJsonAdapter)
├── agent.py      # LangGraph StateGraph (extract_node -> validate_node -> END)
└── SKILL.md      # This documentation
```

## Key Design Principles

1. **Zero-Cost Local Parsing First**:
   - `.csv`, `.xlsx`, `.xls` are parsed deterministically with Python `csv` and `openpyxl` (zero LLM tokens).
   - Digital `.pdf` files are extracted locally with `pypdf`; only unstructured text or scanned/handheld menu images fall back to Gemini 2.5 Flash (`gemini-2.5-flash`).
2. **LangGraph Human-in-the-Loop (HITL)**:
   - `validate_node` inspects every extracted item and sets `needs_review = True` with `review_reasons` (e.g., missing price, missing dish name) and computes `requires_hitl`.
   - The UI/API pauses for the admin to edit or remove flagged items before calling `/commit`.
3. **Database-Agnostic Portability**:
   - The agent outputs a canonical `MenuManifest`.
   - To use in another project, either:
     - Pass `webhook_url` to `WebhookJsonAdapter` to POST the `MenuManifest` JSON to any external API, or
     - Subclass `BaseMenuDatabaseAdapter` and implement `save_menu(manifest, context)`.

## Usage Example

```python
from app.foundation_agents.menu_scanner.agent import menu_scanner_graph
from app.foundation_agents.menu_scanner.adapters import WebhookJsonAdapter

# 1. Scan file
result = await menu_scanner_graph.ainvoke({
    "file_bytes": file_bytes,
    "filename": "menu.xlsx",
    "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
})
manifest = result["manifest"]

# 2. If result["requires_hitl"] is True, present manifest to user for edits.

# 3. Persist to any external app via WebhookJsonAdapter
adapter = WebhookJsonAdapter(target_url="https://other-app.example.com/api/import-menu")
await adapter.save_menu(manifest, {"restaurant_id": "123"})
```
