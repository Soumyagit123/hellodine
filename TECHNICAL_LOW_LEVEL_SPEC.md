# Hello Dine: Low-Level Technical Specification

This document provides a deep-dive into the implementation details of the Hello Dine WhatsApp Bot, covering the database schema, state management, and the LangGraph node logic.

---

## 1. Database Schema (PostgreSQL)

The system uses a highly relational schema to handle multi-tenancy (multiple restaurants/branches) and complex orders.

### Core Entities:
- **`Restaurant`**: Root entity containing WhatsApp credentials (Phone ID, Access Token).
- **`Branch`**: Physical location of a restaurant.
- **`Table`**: Individual tables within a branch, each linked to a `TableQRToken`.
- **`TableSession`**: Created when a customer scans a QR code. Represents an active "visit".
- **`MenuItem`**: Individual food items with `base_price`, `gst_percent` (0, 5, 12, 18), and `is_veg` flag.
- **`Cart` & `CartItem`**: Staging area for items before an order is placed.
- **`Order` & `OrderItem`**: Immutable records of finalized purchases.

### Key Relationship Logic:
- **Cascading Deletion**: When a `MenuItem` is deleted, the system automatically handles `CartItem` and `OrderItem` dependencies to prevent `IntegrityError`.
- **Eager Loading**: The API uses SQLAlchemy's `selectinload` to fetch `MenuItem` names and `Table` numbers in a single query for the Kitchen Board, preventing the "N+1 query" problem.

---

## 2. Bot State Management (`BotState`)

The bot is "stateful" but the state is ephemeral, existing only for the duration of a single message processing cycle.

```python
class BotState(TypedDict):
    restaurant_id: str
    branch_id: str
    session_id: str        # Links message to a TableSession
    wa_user_id: str        # Customer's phone number
    message_text: str      # Cleaned input text or button ID
    intent: str            # Classified by AI (BROWSE, ADD_ITEM, etc.)
    entities: dict         # Extracted data (e.g., {"item": "Pasta", "qty": 2})
    final_response: dict   # Meta-ready JSON payload
```

---

## 3. The LangGraph Pipeline (Logical Nodes)

### Node 1: `ingest_webhook`
- Extracts the sender's phone number and the message content from the nested Meta JSON.
- Handles both text messages and `interactive` replies (Button/List clicks).

### Node 2: `resolve_session`
- Performs a database lookup to find an **ACTIVE** `TableSession` for the given phone number.
- If no session exists, it marks an error and routes directly to the `response_formatter` to ask the user to scan a QR code.

### Node 3: `intent_router` (AI Layer)
- **Model**: Google Gemini 2.5 Flash.
- **Prompt Logic**: Uses a specific system instruction to classify text into one of 8 intents.
- **Entity Extraction**: If the intent is `ADD_ITEM`, it extracts the item names and quantities into a JSON array.

### Node 4: `menu_retrieval`
- **WhatsApp Row Safety**: Strictly enforces Meta's 10-row limit for Interactive Lists.
- **Pagination Logic**: Uses a `page` entity to offset results. Shows 6 items + navigation rows (Next/Back).
- **Visuals**: Prepends 🟢 (Veg) or 🔴 (Non-Veg) emojis to item names automatically.

### Node 5: `cart_executor`
- Performs ACID-compliant database transactions to add/remove items from the `Cart`.
- Automatically recalculates the `subtotal` and `GST` (CGST/SGST 2.5% each for 5% total).

### Node 6: `kitchen_dispatch`
- Finalizes the order and converts `Cart` records to `Order` records.
- **Real-time Webhook**: Sends a payload to the Frontend via WebSockets (`manager.broadcast_to_branch`) to update the Chef's board instantly.

---

## 4. Security & Validation

1. **X-Hub-Signature-256**: The webhook validates every incoming request from Meta using a `sha256` HMAC signature and the `WA_APP_SECRET`. 
2. **Checkout Guard**: Before placing an order, the system checks:
    - If the session is still active.
    - If items in the cart are still "Available" in the menu.
    - **Idempotency**: Prevents duplicate orders if the user taps "Confirm" twice within 30 seconds.

## 5. Deployment Architecture
- **Backend**: Python 3.12 (FastAPI) running on Render.com.
- **Database**: PostgreSQL (Supabase) with a connection pooler (`asyncpg`).
- **Communication**: Meta WhatsApp Cloud API (Graph API v22.0).

---
*Technical Spec Version 1.1 - Internal Developer Doc*
