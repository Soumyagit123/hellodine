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
If the user asks for multiple items (e.g., "2 burgers and a coke"), extract ALL of them into the "items" array.

Intents:
- BROWSE: user wants to see menu, categories, or items
- ADD_ITEM: user wants to add item(s) to cart (e.g., "add 2 burgers", "give me one coke and 2 fries", "add one more paneer")
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
    {"name": "coke", "quantity": 1}
  ]
}

Examples:
- "i want 2 paneer tikka and 1 butter chicken" -> {"intent": "ADD_ITEM", "items": [{"name": "paneer tikka", "quantity": 2}, {"name": "butter chicken", "quantity": 1}]}
- "add three large pizzas" -> {"intent": "ADD_ITEM", "items": [{"name": "large pizzas", "quantity": 3}]}
- "Add two more panner butter masala. And one more garlic pepper mushroom" -> {"intent": "ADD_ITEM", "items": [{"name": "panner butter masala", "quantity": 2}, {"name": "garlic pepper mushroom", "quantity": 1}]}
- "show me the menu" -> {"intent": "BROWSE", "items": []}

Customer message: "{message}"
"""

async def detect_language(state: BotState) -> BotState:
    """Lightweight: detect Hindi vs English from Unicode range."""
    text = state.get("message_text", "")
    hindi_chars = sum(1 for c in text if "\u0900" <= c <= "\u097F")
    state["preferred_language"] = "hi" if hindi_chars > 2 else state.get("preferred_language", "en")
    return state


async def intent_router(state: BotState) -> BotState:
    """Use Gemini to classify intent + extract entities."""
    if state.get("intent") == "QR_SCAN":
        return state

    text = state.get("message_text", "")
    if not text:
        state["intent"] = "BROWSE" # Default to browse if empty
        return state

    lower = text.lower().strip()

    # 1. Interactive IDs (Highest Priority)
    if lower == "do_confirm":
        state["intent"] = "PLACE_ORDER"
        return state
    if lower == "confirm_order":
        state["intent"] = "CONFIRM_SUMMARY"
        return state
    if lower in ("view_cart", "edit_cart"):
        state["intent"] = "CART_VIEW"
        return state
    if lower == "show_menu":
        state["intent"] = "BROWSE"
        return state

    if lower.startswith("item_add_"):
        state["intent"] = "ADD_ITEM"
        state["entities"] = {"item_id": lower.replace("item_add_", ""), "quantity": 1}
        return state

    if lower.startswith("cat_"):
        state["intent"] = "BROWSE"
        state["entities"] = {"category_id": lower.replace("cat_", "")}
        return state
        
    # 2. Hardcoded Order Keywords (Priority)
    order_triggers = ["add", "want", "give", "more", "plus", "+", "paisa", "order", "mangva", "karlo", "daalo", "chahiye"]
    is_likely_order = any(w in lower for w in order_triggers) and len(lower.split()) > 1
    
    browse_triggers = ["menu", "list", "food", "khana", "dikhao", "show"]
    if any(w in lower for w in browse_triggers):
        state["intent"] = "BROWSE"
        return state

    # 3. LLM classification
    try:
        prompt = INTENT_PROMPT.format(message=text)
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        raw = response.content.strip()
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"): raw = raw[4:]
        
        parsed = json.loads(raw)
        state["intent"] = parsed.get("intent", "OTHER")
        
        # --- AGGRESSIVE OVERRIDE ---
        # If user said "Add..." or "More..." but AI said OTHER, force ADD_ITEM
        if state["intent"] == "OTHER" and is_likely_order:
            state["intent"] = "ADD_ITEM"

        if "items" in parsed:
             state["entities"] = {"items": parsed["items"]}
        else:
             state["entities"] = parsed.get("entities", {})
             
    except Exception as e:
        print(f"Intent Parser Error: {e}")
        # FALLBACK: If AI fails but it looks like an order, guess ADD_ITEM
        if is_likely_order:
            state["intent"] = "ADD_ITEM"
            # We can't extract names perfectly without AI, but we can try basic split
            # Better to let card_executor handle "unknown item" than chat fallback
            state["entities"] = {"name": text.replace("add", "").replace("more", "").strip(), "quantity": 1}
        else:
            state["intent"] = "OTHER"
            state["entities"] = {}

    return state
