"""LangGraph bot state definition."""
from typing import TypedDict, Optional, Any


class BotState(TypedDict, total=False):
    # Identity
    restaurant_id: str
    branch_id: str
    table_id: str
    session_id: str
    customer_id: str
    wa_user_id: str       # customer's WhatsApp phone number or kiosk device id
    wa_message_id: str    # incoming message ID (for dedup)
    preferred_language: str  # "en" | "hi" | "or"

    # Message context
    raw_message: dict     # full parsed WA payload
    message_text: str     # extracted text / button reply id
    message_type: str     # "text" | "interactive" | "kiosk"

    # Intent & action
    intent: str           # BROWSE / ADD_ITEM / REMOVE_ITEM / CONFIRM / BILL / ENTERTAIN_JOKE / ENTERTAIN_CARTOON / BIRTHDAY_WISH / OTHER / QR_SCAN
    entities: dict        # extracted entities (item_name, quantity, birthday_name, etc.)

    # Cart snapshot (returned from DB for formatting)
    cart_snapshot: Optional[dict]

    # Clarification
    pending_clarification: Optional[str]

    # UI Action for Tablet Kiosk (e.g., {"action": "SHOW_CARTOONS"} or {"action": "SHOW_BIRTHDAY", "name": "Rahul"})
    ui_action: Optional[dict]

    # Loop prefix when adding items
    loop_prefix: Optional[str]

    # Final response to send back to customer
    final_response: Optional[dict]  # {"type": "text|buttons|list", ...}

    # Error
    error: Optional[str]

