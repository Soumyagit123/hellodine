"""Bot nodes — detect_language (lightweight) + intent_router (Google AI)"""
import json
import google.generativeai as genai
from app.bot.state import BotState
from app.config import settings

# Configure Google AI
genai.configure(api_key=settings.GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-2.5-flash')

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
{{
  "intent": "ADD_ITEM",
  "items": [
    {{"name": "burger", "quantity": 2}},
    {{"name": "coke", "quantity": 1}}
  ]
}}

Examples:
- "i want 2 paneer tikka and 1 butter chicken" -> {{"intent": "ADD_ITEM", "items": [{{"name": "paneer tikka", "quantity": 2}}, {{"name": "butter chicken", "quantity": 1}}]}}
- "add three large pizzas" -> {{"intent": "ADD_ITEM", "items": [{{"name": "large pizzas", "quantity": 3}}]}}
- "Add two more panner butter masala. And one more garlic pepper mushroom" -> {{"intent": "ADD_ITEM", "items": [{{"name": "panner butter masala", "quantity": 2}}, {{"name": "garlic pepper mushroom", "quantity": 1}}]}}
- "show me the menu" -> {{"intent": "BROWSE", "items": []}}

Customer message: "{message}"
"""

async def detect_language(state: BotState) -> BotState:
    """Lightweight: detect Hindi vs English from Unicode range."""
    text = state.get("message_text", "")
    hindi_chars = sum(1 for c in text if "\u0900" <= c <= "\u097F")
    state["preferred_language"] = "hi" if hindi_chars > 2 else state.get("preferred_language", "en")
    return state


async def intent_router(state: BotState) -> BotState:
    """Use Gemini to classify intent + extract entities via native google-generativeai."""
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

    # Confirm / Place order keywords (must come BEFORE LLM to prevent misclassification)
    confirm_triggers = ["confirm", "place order", "yes", "haan", "haa", "order karo", "ok confirm", "place", "finalize", "checkout"]
    if any(lower == t or lower.startswith(t) for t in confirm_triggers):
        state["intent"] = "CONFIRM_SUMMARY"
        return state

    # Bill triggers
    if lower in ("bill", "bill do", "check", "pay", "payment"):
        state["intent"] = "BILL"
        return state

    if lower.startswith("item_add_"):
        state["intent"] = "ADD_ITEM"
        state["entities"] = {"item_id": lower.replace("item_add_", ""), "quantity": 1}
        return state

    if lower.startswith("cat_"):
        state["intent"] = "BROWSE"
        state["entities"] = {"category_id": lower.replace("cat_", ""), "page": 0}
        return state

    if lower.startswith("next_page_") or lower.startswith("prev_page_"):
        # Format: next_page_items_CATEGORYID_PAGE
        # or next_page_cats_PAGE
        parts = lower.split("_")
        state["intent"] = "BROWSE"
        if "items" in parts:
            state["entities"] = {
                "category_id": parts[3], 
                "page": int(parts[4])
            }
        else:
            state["entities"] = {
                "page": int(parts[3])
            }
        return state
        
    # 2. Hardcoded Order Keywords (Priority)
    order_triggers = ["add", "want", "give", "more", "plus", "+", "paisa", "order", "mangva", "karlo", "daalo", "chahiye"]
    is_likely_order = any(w in lower for w in order_triggers) and len(lower.split()) > 1
    
    # 3. Strict EXACT matches for Navigation
    if lower in ("menu", "khana", "dikhao", "list items", "categories"):
        state["intent"] = "BROWSE"
        return state

    # 4. LLM classification
    try:
        # Use a secondary check for models/ prefix if needed, or just use the discovery's best
        prompt = INTENT_PROMPT.format(message=text)
        
        # Native library call (async version not standard in gemini v1, using sync for reliability in node)
        # Note: In production, we'd use a thread pool or aioify, but here sync is fine for the webhook context
        response = model.generate_content(prompt)
        raw = response.text.strip()
        
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"): raw = raw[4:]
        
        parsed = json.loads(raw)
        state["intent"] = parsed.get("intent", "OTHER")
        
        # --- AGGRESSIVE OVERRIDE ---
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
            clean_text = text.lower().replace("add", "").replace("more", "").replace("give", "").strip()
            num_map = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5}
            qty = 1
            for word, val in num_map.items():
                if word in clean_text:
                    qty = val
                    clean_text = clean_text.replace(word, "").strip()
            state["entities"] = {"name": clean_text, "quantity": qty}
        else:
            state["intent"] = "OTHER"
            state["entities"] = {}

    return state
