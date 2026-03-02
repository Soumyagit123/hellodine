"""Bot nodes — detect_language (lightweight) + intent_router (Gemini)"""
import json
from app.bot.state import BotState
from app.config import settings
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage

llm = ChatGoogleGenerativeAI(
    model="gemini-1.5-flash",
    google_api_key=settings.GEMINI_API_KEY,
    temperature=0,
)

INTENT_PROMPT = """You are a smart intent classifier for a restaurant WhatsApp ordering bot.

Classify the customer message and extract multiple items if present.
Intents:
- BROWSE: see menu/categories
- ADD_ITEM: add item(s) to cart (e.g., "2 burgers", "one coke and two fries")
- REMOVE_ITEM: remove from cart
- UPDATE_QTY: change quantity
- CONFIRM: place/confirm order
- BILL: request bill
- CART_VIEW: show current cart
- OTHER: greetings, help, etc.

Return ONLY JSON:
{
  "intent": "ADD_ITEM",
  "items": [
    {"name": "burger", "quantity": 2},
    {"name": "fries", "quantity": 2, "notes": "crispy"}
  ]
}

Customer message: "{message}"
"""


async def detect_language(state: BotState) -> BotState:
    """Lightweight: detect Hindi vs English from Unicode range."""
    text = state.get("message_text", "")
    hindi_chars = sum(1 for c in text if "\u0900" <= c <= "\u097F")
    if hindi_chars > 2:
        state["preferred_language"] = "hi"
    else:
        state["preferred_language"] = state.get("preferred_language", "en")
    return state


async def intent_router(state: BotState) -> BotState:
    """Use Gemini to classify intent + extract entities."""
    # If QR scan already detected, skip
    if state.get("intent") == "QR_SCAN":
        return state

    text = state.get("message_text", "")
    if not text:
        state["intent"] = "OTHER"
        return state

    # Quick rule-based shortcuts (avoid LLM for common patterns)
    lower = text.lower().strip()

    # 1. Interactive Button/List IDs (Priority)
    if lower == "do_confirm":
        state["intent"] = "PLACE_ORDER"
        return state
    if lower == "confirm_order":
        state["intent"] = "CONFIRM_SUMMARY"
        return state
    if lower == "view_cart" or lower == "edit_cart":
        state["intent"] = "CART_VIEW"
        return state
    if lower == "show_menu":
        state["intent"] = "BROWSE"
        return state

    # NEW: Immediate Add (1 portion)
    if lower.startswith("item_add_"):
        state["intent"] = "ADD_ITEM"
        state["entities"] = {"item_id": lower.replace("item_add_", ""), "quantity": 1}
        return state

    # NEW: Increment / Decrement
    if lower.startswith("qty_inc_") or lower.startswith("qty_dec_"):
        item_id = lower.replace("qty_inc_", "").replace("qty_dec_", "")
        state["intent"] = "UPDATE_QTY"
        state["entities"] = {
            "item_id": item_id,
            "operation": "inc" if "inc" in lower else "dec"
        }
        return state

    # Item selection from menu
    if lower.startswith("item_"):
        state["intent"] = "ITEM_INFO"
        state["entities"] = {"item_id": lower.replace("item_", "")}
        return state

    # Category selection
    if lower.startswith("cat_"):
        state["intent"] = "BROWSE"
        state["entities"] = {"category_id": lower.replace("cat_", "")}
        return state

    # 2. Text Shortcuts (Legacy/Fuzzy)
    if any(w in lower for w in ["confirm", "place order", "done", "order kar"]):
        state["intent"] = "CONFIRM_SUMMARY"
        return state
    if any(w in lower for w in ["bill", "check", "pay"]):
        state["intent"] = "BILL"
        return state
    if any(w in lower for w in ["cart", "my order", "show cart"]):
        state["intent"] = "CART_VIEW"
        return state
    if any(w in lower for w in ["menu", "list", "show", "browse"]):
        state["intent"] = "BROWSE"
        return state

    # LLM classification
    try:
        prompt = INTENT_PROMPT.format(message=text)
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        raw = response.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        parsed = json.loads(raw)
        
        state["intent"] = parsed.get("intent", "OTHER")
        # Support multi-item format
        if "items" in parsed:
             state["entities"] = {"items": parsed["items"]}
        else:
             # Fallback for single item
             state["entities"] = parsed.get("entities", {})
             
    except Exception:
        state["intent"] = "OTHER"
        state["entities"] = {}

    return state
