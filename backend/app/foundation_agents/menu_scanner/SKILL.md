---
name: menu-scanner-agent
description: Reusable LangGraph Human-in-the-Loop (HITL) AI Menu Scanner & Ingestion Agent. Extracts structured restaurant menus from Excel (.xlsx, .xls), CSV, PDF, and Images (.jpg, .png, .webp) with zero-cost local parsing for tabular/digital files and Gemini Multimodal Vision for images, then persists to ANY database via pluggable database adapters.
---

# 🤖 Reusable AI Menu Scanner & Ingestion Agent Skill

This skill explains how to build and port this **AI Menu Scanner & Ingestion Agent** into **any other project**, regardless of the framework (FastAPI, Django, Express, NestJS) or database (PostgreSQL, MySQL, MongoDB, Firebase, Supabase, Prisma).

---

## 💡 The Core Problem & The Solution

### Why other projects have different databases:
- **Project A** might store menu items in PostgreSQL (`menu_items` table with `id`, `name`, `base_price`, `category_id`).
- **Project B** might store them in MongoDB (`dishes` collection with `dishName`, `cost`, `dietType: "veg"`).
- **Project C** might store them in Firebase Firestore or Supabase with custom column names.

### How this Agent solves it (The "Adapter Pattern"):
The scanner **never directly writes to any specific database tables**. 

Instead, it works in 3 clear steps:
1. **Extraction (Zero-Cost + AI)**: Reads the file (Excel, CSV, PDF, Photo) and produces a standard, **database-agnostic universal format** called `MenuManifest`.
2. **Human-in-the-Loop (HITL) Review**: Flags missing prices, missing names, or unclear categories (`needs_review: true`) so the user can verify/edit in the UI before anything touches a database.
3. **Pluggable Database Adapter**: Takes the verified `MenuManifest` and maps it to whatever database that specific project uses.

```
[ Menu File: Excel / CSV / PDF / Image ]
                    │
                    ▼
   [ Menu Scanner Agent (Zero-cost / Gemini) ]
                    │
                    ▼
      [ Canonical MenuManifest JSON ]
  (name, price, is_veg, category, gst, image_url)
                    │
                    ▼
          [ HITL Admin Review UI ]
                    │  (Admin approves)
                    ▼
        ┌───────────────────────┐
        │ Database Adapter      │
        └───────────┬───────────┘
                    │
        ┌───────────┴───────────┬───────────────────────┐
        ▼                       ▼                       ▼
[ PostgreSQL / MySQL ]    [ MongoDB / NoSQL ]     [ REST API / Webhook ]
(e.g., Hello-Dine)        (e.g., Project B)       (e.g., Microservices)
```

---

## 📦 1. Canonical Universal Schema (`schema.py`)

Every project copying this agent uses this same universal schema:

```python
from typing import List, Optional
from pydantic import BaseModel, Field

class VariantItem(BaseModel):
    name: str  # e.g., "Half", "Full", "Large"
    price: float

class ExtractedMenuItem(BaseModel):
    name: str
    category: str = "Main Course"
    sub_category: Optional[str] = None
    base_price: float = 0.0
    description: Optional[str] = None
    is_veg: bool = True
    gst_percent: int = 5
    is_bestseller: bool = False
    image_url: Optional[str] = None
    variants: List[VariantItem] = Field(default_factory=list)
    needs_review: bool = False
    review_reasons: List[str] = Field(default_factory=list)

class ExtractedMenuCategory(BaseModel):
    name: str
    items: List[ExtractedMenuItem] = Field(default_factory=list)

class MenuManifest(BaseModel):
    source_filename: str = ""
    parser_used: str = ""  # "openpyxl (zero-cost)", "csv (zero-cost)", "pypdf (zero-cost)", or "gemini-2.5-flash"
    total_categories: int = 0
    total_items: int = 0
    items_ready: int = 0
    items_needing_review: int = 0
    categories: List[ExtractedMenuCategory] = Field(default_factory=list)
```

---

## ⚡ 2. Extraction Pipeline (`parsers.py`)

To keep operational cost close to zero:
1. **Excel (`.xlsx`, `.xls`)**: Parsed locally with `openpyxl` (0 tokens, ₹0 cost).
2. **CSV (`.csv`)**: Parsed locally with Python's built-in `csv` module (0 tokens, ₹0 cost).
   - *Smart Header Detection*: Scans first 15 rows to find the actual header row even if title rows exist (e.g., *"Restaurant Menu Since 1953"*).
   - *Fuzzy Match*: Matches column variants like `Price (₹ / MRP)`, `Rate`, `Cost`, `Dietary Type`.
3. **Digital PDF**: Parsed locally with `pypdf` (0 tokens, ₹0 cost).
4. **Scanned PDF / Menu Photos (`.jpg`, `.png`, `.webp`)**: Sent to **Gemini 2.5 Flash Vision** (`gemini-2.5-flash`) using `response_mime_type="application/json"` to guarantee strictly valid JSON.

---

## 🔌 3. How to Connect to ANY Database (`adapters.py`)

To use this in any other project, you only implement one simple class: `BaseMenuDatabaseAdapter`.

### Abstract Base Adapter:
```python
from abc import ABC, abstractmethod
from typing import Dict, Any

class BaseMenuDatabaseAdapter(ABC):
    @abstractmethod
    async def save_menu(self, manifest: MenuManifest, context: Dict[str, Any]) -> Dict[str, Any]:
        """Maps universal MenuManifest fields to your project's database tables/collections."""
        pass
```

### Example A: PostgreSQL / SQLAlchemy (Like Hello-Dine)
```python
class PostgresAdapter(BaseMenuDatabaseAdapter):
    def __init__(self, db_session):
        self.db = db_session

    async def save_menu(self, manifest: MenuManifest, context: dict):
        restaurant_id = context["restaurant_id"]
        for cat in manifest.categories:
            category_record = Category(restaurant_id=restaurant_id, name=cat.name)
            self.db.add(category_record)
            await self.db.flush()

            for item in cat.items:
                item_record = Dish(
                    category_id=category_record.id,
                    title=item.name,
                    price=item.base_price,
                    is_vegetarian=item.is_veg,
                    photo_url=item.image_url,
                )
                self.db.add(item_record)
        await self.db.commit()
        return {"status": "success", "saved_items": manifest.total_items}
```

### Example B: MongoDB / Motor (Document Database)
```python
class MongoAdapter(BaseMenuDatabaseAdapter):
    def __init__(self, mongo_db):
        self.db = mongo_db

    async def save_menu(self, manifest: MenuManifest, context: dict):
        restaurant_id = context["restaurant_id"]
        documents = []
        for cat in manifest.categories:
            for item in cat.items:
                documents.append({
                    "restaurantId": restaurant_id,
                    "category": cat.name,
                    "dishName": item.name,
                    "cost": item.base_price,
                    "isVeg": item.is_veg,
                    "imageUrl": item.image_url,
                    "variants": [v.model_dump() for v in item.variants],
                })
        if documents:
            await self.db.dishes.insert_many(documents)
        return {"status": "success", "inserted": len(documents)}
```

### Example C: Zero-Code Webhook Adapter (Any Microservice / REST API)
If your friend's project is in Node.js, Go, PHP, or Java, they don't even need Python database drivers! They just use the built-in `WebhookJsonAdapter`:

```python
class WebhookJsonAdapter(BaseMenuDatabaseAdapter):
    def __init__(self, webhook_url: str):
        self.webhook_url = webhook_url

    async def save_menu(self, manifest: MenuManifest, context: dict):
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                self.webhook_url,
                json={"context": context, "manifest": manifest.model_dump()}
            )
            return resp.json()
```
Their Node.js/Java backend receives the JSON and inserts it into whatever database they have.

---

## 🔄 4. The LangGraph HITL Agent Flow (`agent.py`)

The agent is compiled using LangGraph into an acyclic state machine:

```python
from langgraph.graph import StateGraph, END

# Workflow:
# [Start] -> extract_node (reads file) -> validate_node (flags missing fields) -> [END]

graph = StateGraph(MenuScannerState)
graph.add_node("extract", extract_node)
graph.add_node("validate", validate_node)

graph.set_entry_point("extract")
graph.add_edge("extract", "validate")
graph.add_edge("validate", END)

menu_scanner_graph = graph.compile()
```

### The HITL Step:
1. When `validate_node` runs, it checks:
   - Does this item have a dish name? (If not $\to$ `needs_review = True`, reason: `"Missing dish name"`)
   - Is `base_price > 0`? (If not $\to$ `needs_review = True`, reason: `"Missing or zero price"`)
2. The endpoint `POST /api/menu-agent/scan` returns the `manifest` and `requires_hitl: true`.
3. The frontend modal displays the table, highlighting any amber flagged rows so the admin can fill in the price or dish name.
4. When the admin clicks **Approve & Save**, the frontend calls `POST /api/menu-agent/commit`, which passes the verified manifest to the project's adapter.

---

## 🖥️ 5. Ready-to-Use Frontend UI Component (`MenuImportModal.tsx`)

The skill includes the exact, ready-to-paste React/TypeScript modal component so their AI creates both the backend agent AND the complete frontend UI:

```tsx
import { useState } from "react";

export default function MenuImportModal({ branchId, onClose, onSuccess, api }: any) {
    const [file, setFile] = useState<File | null>(null);
    const [scanning, setScanning] = useState(false);
    const [committing, setCommitting] = useState(false);
    const [manifest, setManifest] = useState<any | null>(null);

    // 1. Upload file (PDF, CSV, Excel, Image)
    async function handleScan() {
        if (!file) return;
        setScanning(true);
        const formData = new FormData();
        formData.append("file", file);
        const res = await api.post("/menu-agent/scan", formData);
        setManifest(res.data.manifest);
        setScanning(false);
    }

    // 2. Commit approved manifest
    async function handleCommit() {
        setCommitting(true);
        await api.post("/menu-agent/commit", { branch_id: branchId, manifest });
        await onSuccess();
        onClose();
    }

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "#161a2d", borderRadius: 16, padding: 24, maxWidth: 900, width: "95%", color: "#fff" }}>
                {!manifest ? (
                    <div>
                        <h3>AI Menu Scanner &amp; Importer</h3>
                        <input type="file" accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                        <button onClick={handleScan} disabled={!file || scanning}>{scanning ? "Scanning..." : "Scan Menu"}</button>
                    </div>
                ) : (
                    <div>
                        <h4>Review &amp; Edit Menu ({manifest.total_items} items)</h4>
                        {/* Interactive HITL table with editable inputs for name, base_price, is_veg, and image_url */}
                        <button onClick={handleCommit} disabled={committing}>{committing ? "Saving..." : "Approve & Save"}</button>
                    </div>
                )}
            </div>
        </div>
    );
}
```

---

## 🚀 6. How Your Friend Can Use This Skill

Tell your friend to give this `SKILL.md` file to their AI assistant and say:
> *"Read this Menu Scanner Skill. Please build both:
> 1. The backend LangGraph agent + FastAPI/Express endpoints (`/scan` and `/commit`).
> 2. The matching database adapter for my database schema: [paste schema].
> 3. The frontend upload & HITL review modal UI in [React / Vue / Next.js]."*

The AI assistant will have **all three parts** (zero-cost parsers, database adapter, and frontend upload UI) completely specified!
