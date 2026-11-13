# 🤖 Master Prompt: Implement AI Menu Scanner & Ingestion Agent

Use this prompt whenever you want an AI assistant (Claude, ChatGPT, Gemini, Cursor, Copilot) to implement the complete **Menu Scanner Agent** into ANY project with ANY database.

---

## 📋 Copy & Paste This Exact Prompt:

```markdown
You are an expert full-stack AI engineer. I want you to implement a standalone, production-ready **AI Menu Scanner & Ingestion Agent** into my project using the specifications from the provided `SKILL.md`.

### 🎯 Objective:
Enable restaurant admins to upload menu files (Excel `.xlsx`/`.xls`, `.csv`, `.pdf`, and Menu Card photos `.jpg`/`.png`/`.webp`). The system must extract categories, dish names, prices, veg/non-veg status, GST%, and image URLs, let the admin review/edit any flagged items via a Human-in-the-Loop (HITL) UI, and then save them to my project's database.

---

### 🛠️ My Tech Stack:
- **Backend**: [e.g. FastAPI / Express.js / Django / NestJS / Flask]
- **Frontend**: [e.g. React / Next.js / Vue / Vite]
- **Database**: [e.g. PostgreSQL with Prisma / MongoDB / MySQL with SQLAlchemy / Supabase / Firebase]
- **My Existing Menu Database Schema**:
```[sql / prisma / typescript / json]
[PASTE YOUR DATABASE TABLES OR MODELS HERE, e.g.:
- categories table (id, name, restaurant_id)
- items table (id, name, price, is_veg, image_url, category_id)
]
```

---

### 📦 Key Requirements to Implement:

1. **Zero-Cost Local Parsers First**:
   - For `.xlsx`/`.xls` and `.csv`, extract data deterministically using Python (`openpyxl`, `csv`) or Node.js (`xlsx`, `csv-parse`) with ₹0 LLM cost. Include multi-row header detection to skip top restaurant banners (e.g. "Paradise Since 1953").
   - For digital `.pdf`, extract text locally with zero model cost.
   - For scanned PDFs and menu card photos (`.jpg`, `.png`), use Gemini 2.5 Flash (`gemini-2.5-flash`) with `response_mime_type="application/json"` to ensure strict JSON output.

2. **Canonical Schema & HITL Validation**:
   - Map extracted data into the canonical `MenuManifest` schema (`name`, `category`, `base_price`, `is_veg`, `gst_percent`, `image_url`, `variants`, `needs_review`, `review_reasons`).
   - Automatically flag items with `needs_review = true` if `base_price <= 0` or dish name is missing.

3. **Pluggable Database Adapter**:
   - Create a dedicated Database Adapter implementing `save_menu(manifest, context)`.
   - Map the universal `MenuManifest` fields directly to MY database schema provided above.

4. **API Endpoints**:
   - `POST /api/menu-agent/scan`: Accepts uploaded file (`multipart/form-data`), runs extraction & validation, and returns the `manifest` + `requires_hitl` flag.
   - `POST /api/menu-agent/commit`: Accepts the human-reviewed/approved `manifest` and saves it via the database adapter.

5. **Frontend HITL Review UI Component**:
   - Build a clean modal with:
     - File upload dropzone supporting `.xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.webp`.
     - Loading/scanning indicator.
     - Review table where admins can edit dish names, prices, GST %, veg toggle, and paste/edit image URLs.
     - Warning badges for rows that need attention.
     - "Approve & Save" button disabled until flagged errors are resolved.

Please generate the modular backend files (`schema`, `parsers`, `adapter`, `agent`/`router`) and the frontend component.
```

---

## 💡 How to Use This Prompt:
1. Open your other project in your AI coding assistant (or ChatGPT / Claude / Gemini).
2. Copy the text block above.
3. Replace the `My Tech Stack` section with your actual stack and paste your database tables.
4. If you have the `SKILL.md` file, attach it or paste its contents along with this prompt.
5. Hit Send. The AI will generate the entire feature customized specifically to your project's database!

