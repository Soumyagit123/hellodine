"""Bot nodes — detect_language (lightweight) + intent_router (Zero-Token Fast Rules + Phonetic STT + Gemini NLU)"""
import asyncio
import json
import re
from typing import Any
import google.generativeai as genai  # type: ignore
from app.bot.state import BotState
from app.config import settings

# Configure Google AI
_genai: Any = genai
_genai.configure(api_key=settings.GEMINI_API_KEY)
# Use gemini-3.5-flash-lite (high RPM/TPM/RPD free tier) with automatic fallback to gemini-2.5-flash-lite / gemini-2.5-flash
model: Any = _genai.GenerativeModel(
    "gemini-3.5-flash-lite",
    generation_config={"temperature": 0.0, "max_output_tokens": 180},
)
fallback_model: Any = _genai.GenerativeModel(
    "gemini-2.5-flash-lite",
    generation_config={"temperature": 0.0, "max_output_tokens": 180},
)

# Compact, low-token prompt (~160 tokens) that understands speech-to-text typos & all Kiosk actions
INTENT_PROMPT = """Restaurant AI Waiter NLU. Input may have voice speech-to-text typos (e.g. "car"="cart", "had"="add", "conform"="confirm").
Classify into ONE intent & extract JSON:
- CART_VIEW: view/show/check cart, basket, bag, selected items ("show my car item", "what did I add")
- ORDER_STATUS: check/track order status, kitchen progress, where is my food, how long ("is my order ready")
- BROWSE: show menu, category, or search food ("show non veg thali", "paneer items", "something light")
- RECOMMEND_BEST: ask for best/top/popular/special dishes or recommendations ("what is best in starter")
- AI_PICK_AND_ADD: user is confused & asks AI to pick and add the best dish to cart ("add 1 best dish for me")
- ADD_ITEM: add specific dish(es) to cart ("add 2 butter naan and 1 paneer tikka", "1 mango lassi")
- UPDATE_QTY: change/set/reduce/increase quantity of an item in cart ("make butter naan 3", "reduce 1 roti")
- REMOVE_ITEM: remove/delete specific dish from cart ("remove butter naan")
- CLEAR_CART: empty/clear whole cart
- CANCEL_ORDER: cancel placed kitchen order
- PLACE_ORDER: confirm/place/send order to kitchen
- BILL: ask for bill, gst invoice, total amount, or qr payment
- ENTERTAIN_JOKE: ask for a joke/riddle
- ENTERTAIN_CARTOON: play kids cartoon/video
- BIRTHDAY_WISH: celebrate someone's birthday (extract "birthday_name")
- OTHER: general questions about restaurant, timings, spice customization, greetings

Return ONLY valid JSON:
{{"intent":"...","items":[{{"name":"...","quantity":1}}],"item_name":null,"is_veg":null,"limit":null,"quantity":1,"birthday_name":null}}

Message: "{message}"
"""


def _normalize_stt_typos(text: str) -> str:
    """Fix common Web Speech API (en-IN) phonetic mishearings in a noisy restaurant."""
    s = f" {text.lower().strip()} "
    replacements = [
        (" my car items ", " my cart items "),
        (" my car item ", " my cart item "),
        (" in my car ", " in my cart "),
        (" show my car ", " show my cart "),
        (" view my car ", " view my cart "),
        (" clear my car ", " clear my cart "),
        (" empty my car ", " empty my cart "),
        (" car items ", " cart items "),
        (" card items ", " cart items "),
        (" my card ", " my cart "),
        (" conform order ", " confirm order "),
        (" conform my order ", " confirm my order "),
        (" had one ", " add one "),
        (" had 1 ", " add 1 "),
        (" had two ", " add two "),
        (" had 2 ", " add 2 "),
        (" at one ", " add one "),
        (" at two ", " add two "),
    ]
    for wrong, right in replacements:
        s = s.replace(wrong, right)
    return s.strip()


async def detect_language(state: BotState) -> BotState:
    """Detect language: Odia (or), Hindi (hi), or English (en). Handles native script and phonetic keywords."""
    text = state.get("message_text", "")
    odia_chars = sum(1 for c in text if "\u0B00" <= c <= "\u0B7F")
    hindi_chars = sum(1 for c in text if "\u0900" <= c <= "\u097F")

    if odia_chars >= 2:
        state["preferred_language"] = "or"
        return state
    if hindi_chars >= 2:
        state["preferred_language"] = "hi"
        return state

    # Check for Romanized Hindi / Odia colloquial phrases
    lower = f" {text.lower().strip()} "
    odia_keywords = [" kete ", " kana ", " darkar ", " gochia ", " dita ", " biriayani ", " aau ", " kie "]
    hindi_keywords = [" kya ", " kitna ", " chahiye ", " ek ", " do ", " teen ", " char ", " paanch ", " lao ", " dedo ", " batao ", " khana ", " thali "]

    if any(k in lower for k in odia_keywords):
        state["preferred_language"] = "or"
    elif any(k in lower for k in hindi_keywords):
        state["preferred_language"] = "hi"
    else:
        state["preferred_language"] = state.get("preferred_language", "en")
    return state


async def intent_router(state: BotState) -> BotState:
    """
    Hybrid Zero-Token + Gemini NLU Router:
    - 85% of routine Kiosk commands (Cart, Status, Bill, Confirm, Cancel, Clear, Remove, Update Qty, Browse, Bestsellers)
      are resolved in <1ms with ZERO LLM tokens.
    - Complex/conversational sentences fall back to the ultra-compact Gemini 2.5 Flash prompt.
    """
    if state.get("intent") == "QR_SCAN":
        return state

    text = state.get("message_text", "")
    if not text:
        state["intent"] = "BROWSE"
        return state

    raw_lower = text.lower().strip()
    lower = _normalize_stt_typos(raw_lower)

    # ═══════════════════════════════════════════════════════════════════════════
    # LAYER 1: EXACT UI BUTTON IDs (0ms, 0 Tokens)
    # ═══════════════════════════════════════════════════════════════════════════
    if raw_lower in ("do_confirm", "confirm_order"):
        state["intent"] = "PLACE_ORDER"
        return state
    if raw_lower in ("view_cart", "edit_cart"):
        state["intent"] = "CART_VIEW"
        return state
    if raw_lower == "clear_cart":
        state["intent"] = "CLEAR_CART"
        return state
    if raw_lower == "cancel_order":
        state["intent"] = "CANCEL_ORDER"
        return state
    if raw_lower == "order_status":
        state["intent"] = "ORDER_STATUS"
        return state
    if raw_lower.startswith("remove_ci_"):
        state["intent"] = "REMOVE_ITEM"
        state["entities"] = {"cart_item_id": raw_lower.replace("remove_ci_", "")}
        return state
    if raw_lower == "show_menu":
        state["intent"] = "BROWSE"
        return state
    if raw_lower == "recommend_best":
        state["intent"] = "RECOMMEND_BEST"
        state["entities"] = {"limit": 3}
        return state
    if raw_lower == "tell_joke":
        state["intent"] = "ENTERTAIN_JOKE"
        return state
    if raw_lower == "show_cartoons":
        state["intent"] = "ENTERTAIN_CARTOON"
        return state
    if raw_lower.startswith("birthday_"):
        b_name = text.split("_", 1)[1] if "_" in text else "Guest"
        state["intent"] = "BIRTHDAY_WISH"
        state["entities"] = {"birthday_name": b_name}
        return state
    if raw_lower.startswith("item_add_"):
        state["intent"] = "ADD_ITEM"
        state["entities"] = {"item_id": raw_lower.replace("item_add_", ""), "quantity": 1}
        return state
    if raw_lower.startswith("qty_"):
        # Format: qty_2_ITEMID
        parts = raw_lower.split("_", 2)
        if len(parts) == 3 and parts[1].isdigit():
            state["intent"] = "ADD_ITEM"
            state["entities"] = {"item_id": parts[2], "quantity": int(parts[1])}
            return state
    if raw_lower.startswith("cat_"):
        state["intent"] = "BROWSE"
        state["entities"] = {"category_id": raw_lower.replace("cat_", ""), "page": 0}
        return state
    if raw_lower.startswith("next_page_") or raw_lower.startswith("prev_page_"):
        parts = raw_lower.split("_")
        state["intent"] = "BROWSE"
        if "items" in parts:
            state["entities"] = {"category_id": parts[3], "page": int(parts[4])}
        else:
            state["entities"] = {"page": int(parts[3])}
        return state

    # ═══════════════════════════════════════════════════════════════════════════
    # LAYER 2: SYSTEM & SESSION COMMANDS (0ms, 0 Tokens — Checked BEFORE Food Search!)
    # ═══════════════════════════════════════════════════════════════════════════

    # 2.1 CLEAR CART (must come before CART_VIEW so "clear my cart" clears instead of viewing)
    if any(p in lower for p in [
        "clear cart", "clear my cart", "empty cart", "empty my cart",
        "remove all", "delete all", "cancel cart", "reset cart", "saara hatao"
    ]):
        state["intent"] = "CLEAR_CART"
        return state

    # 2.2 CART VIEW (catches "show me my cart items", "show me my car item", "what is in my cart", "my basket", etc.)
    cart_view_phrases = [
        "my cart", "in cart", "the cart", "cart item", "cart items", "view cart",
        "show cart", "check cart", "open cart", "see cart", "what is in my bag",
        "my basket", "my bag", "what did i add", "what have i added", "items in cart",
        "selected items", "mera cart", "cart dikhao"
    ]
    if lower in ("cart", "basket", "bag", "my items") or any(p in lower for p in cart_view_phrases):
        state["intent"] = "CART_VIEW"
        return state

    # 2.3 CANCEL ORDER (kitchen order cancellation)
    if any(p in lower for p in [
        "cancel order", "cancel my order", "order cancel", "cancel the order",
        "stop my order", "dont prepare", "don't prepare"
    ]):
        state["intent"] = "CANCEL_ORDER"
        return state

    # 2.4 ORDER STATUS (live kitchen tracking)
    status_phrases = [
        "order status", "status of my order", "status of order", "my order status",
        "check my order", "check order", "track order", "track my order",
        "where is my order", "where is my food", "is my order ready", "is my food ready",
        "how long for my order", "how much time", "kitna time", "kab aayega", "order kahan", "status"
    ]
    if any(p in lower for p in status_phrases):
        state["intent"] = "ORDER_STATUS"
        return state

    # 2.5 BILL & PAYMENT
    bill_phrases = [
        "bill", "bill do", "total bill", "invoice", "check please", "pay bill",
        "kitna hua", "gst bill", "how much is my", "qr code for payment", "want to pay"
    ]
    if lower in ("bill", "pay", "payment", "invoice") or any(p in lower for p in bill_phrases):
        state["intent"] = "BILL"
        return state

    # 2.6 CONFIRM / PLACE ORDER TO KITCHEN
    confirm_triggers = [
        "confirm", "confirm order", "place order", "place my order",
        "yes confirm", "ok confirm", "order karo", "finalize order",
        "checkout", "send to kitchen", "send order to kitchen", "book order"
    ]
    if lower in ("yes", "haan", "haa", "place", "finalize") or any(
        lower == t or lower.startswith(t) or t in lower for t in confirm_triggers
    ):
        state["intent"] = "PLACE_ORDER"
        return state

    # 2.7 VOICE QUANTITY CHANGE ("make butter naan 3", "change paneer tikka quantity to 2", "reduce 1 butter naan")
    num_words = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
    qty_change_match = re.search(
        r"^(?:make|change|set|update)\s+(.+?)\s+(?:quantity\s+|qty\s+)?(?:to\s+)?(\d+|one|two|three|four|five|six|ten)$",
        lower
    )
    if qty_change_match:
        dish_target = qty_change_match.group(1).replace("quantity", "").replace("qty", "").strip()
        raw_q = qty_change_match.group(2)
        new_q = num_words.get(raw_q, int(raw_q) if raw_q.isdigit() else 1)
        state["intent"] = "UPDATE_QTY"
        state["entities"] = {"item_name": dish_target, "quantity": new_q}
        return state

    reduce_match = re.search(
        r"^(?:reduce|decrease|minus|less)\s+(\d+|one|two|three)?\s*(.+?)(?:\s+from\s+cart)?$",
        lower
    )
    if reduce_match:
        raw_delta = reduce_match.group(1) or "1"
        delta_q = num_words.get(raw_delta, int(raw_delta) if raw_delta.isdigit() else 1)
        dish_target = reduce_match.group(2).strip()
        state["intent"] = "UPDATE_QTY"
        state["entities"] = {"item_name": dish_target, "delta": -delta_q}
        return state

    # 2.8 REMOVE SPECIFIC ITEM FROM CART ("remove butter naan", "delete paneer from cart")
    if any(lower.startswith(p) for p in ["remove ", "delete ", "cancel ", "hatao ", "nikalo ", "take out "]):
        cleaned_target = lower
        for prefix in ["remove ", "delete ", "cancel ", "hatao ", "nikalo ", "take out ", "from my cart", "from cart", "in cart"]:
            cleaned_target = cleaned_target.replace(prefix, "").strip()
        if cleaned_target:
            state["intent"] = "REMOVE_ITEM"
            state["entities"] = {"item_name": cleaned_target}
            return state

    # 2.9 ENTERTAINMENT & BIRTHDAY (0 Tokens for Cartoon & Birthday extraction)
    if any(k in lower for k in ["joke", "chutkula", "funny", "riddle", "trivia", "entertain"]):
        state["intent"] = "ENTERTAIN_JOKE"
        return state

    if any(k in lower for k in ["cartoon", "kids video", "children video", "animation", "chhota bheem", "tom and jerry"]):
        state["intent"] = "ENTERTAIN_CARTOON"
        return state

    if "birthday" in lower or "bday" in lower or "janamdin" in lower:
        state["intent"] = "BIRTHDAY_WISH"
        extracted_name = None
        m = re.search(r"(?:is|for|my\s+\w+)\s+([a-zA-Z]+?)(?:'s|\s+birthday|\s+bday|$)", text, re.IGNORECASE)
        if m:
            extracted_name = m.group(1)
        else:
            m2 = re.search(r"([a-zA-Z]+)'s\s+(?:birthday|bday)", text, re.IGNORECASE)
            if m2:
                extracted_name = m2.group(1)
        if extracted_name and extracted_name.lower() not in ("today", "my", "his", "her", "a", "the", "happy"):
            state["entities"] = {"birthday_name": extracted_name}
            return state

    # ═══════════════════════════════════════════════════════════════════════════
    # LAYER 3: FOOD / MENU / BESTSELLER / DIRECT ADD FAST PARSER (0 Tokens)
    # ═══════════════════════════════════════════════════════════════════════════
    is_non_veg_query = any(w in lower for w in ["non veg", "non-veg", "nonveg", "chicken", "mutton", "fish", "prawn", "egg"])
    is_pure_veg_query = (not is_non_veg_query) and any(w in lower for w in ["pure veg", "veg ", "vegetarian", " veg"])
    is_veg_val = False if any(w in lower for w in ["non veg", "non-veg", "nonveg"]) else (True if is_pure_veg_query else None)

    known_food_terms = {
        "thali", "starter", "starters", "roti", "naan", "kulcha", "paratha", "rice", "biryani", "pulao",
        "paneer", "chicken", "mutton", "fish", "prawn", "egg", "dal", "curry", "masala", "tandoor",
        "tandoori", "tikka", "kebab", "lollipop", "wings", "manchurian", "chilli", "noodles", "soup",
        "corn", "gobi", "mushroom", "soda", "lassi", "chai", "coffee", "drink", "beverages", "beverage",
        "sweet", "dessert", "desserts", "jamun", "brownie", "ice", "main", "course", "makhani", "jeera", "lime", "mango"
    }
    words_in_msg = set(re.sub(r"[^a-z0-9\s]", " ", lower).split())
    matched_food_terms = [w for w in words_in_msg if w in known_food_terms]
    extracted_food_hint = " ".join(matched_food_terms).strip()

    extracted_num = None
    for nw, nv in num_words.items():
        if re.search(rf"\b{nw}\b", lower):
            extracted_num = nv
            break
    if not extracted_num:
        m_num = re.search(r"\b(\d+)\b", lower)
        if m_num:
            extracted_num = int(m_num.group(1))

    confusion_or_best_cues = [
        "best", "special", "popular", "famous", "bestseller", "top",
        "no idea", "don't have any idea", "dont have any idea", "confused",
        "not sure", "your choice", "you choose", "surprise me", "recommend", "suggest"
    ]
    add_action_cues = ["add ", "had ", "give ", "order ", "put ", "select ", "pick ", "choose "]
    has_best_or_confused = any(c in lower for c in confusion_or_best_cues)
    has_add_cue = any(c in f" {lower} " for c in add_action_cues)
    mentions_generic_item = any(w in lower for w in ["one item", "1 item", "any item", "best item", "best dish", "something", "kitchen"])

    # 3A. Confused customer asking AI to pick & add the best dish to cart
    if has_best_or_confused and (has_add_cue or mentions_generic_item) and (
        "idea" in lower or "confused" in lower or "best" in lower or "special" in lower or "surprise" in lower
    ) and any(w in lower for w in ["add", "had", "order", "give", "just"]):
        state["intent"] = "AI_PICK_AND_ADD"
        state["entities"] = {
            "item_name": extracted_food_hint,
            "is_veg": is_veg_val,
            "quantity": extracted_num or 1,
        }
        return state

    # 3B. Customer asking for Best / Top / Recommended items (per category or across all categories)
    if has_best_or_confused and not has_add_cue:
        state["intent"] = "RECOMMEND_BEST"
        state["entities"] = {
            "item_name": extracted_food_hint,
            "is_veg": is_veg_val,
            "limit": extracted_num or 3,
        }
        return state

    # 3C. Zero-Token Direct Single & Multi-Item Add ("add 2 butter naan and 1 paneer tikka", "give me 1 paneer tikka", "2 mango lassi")
    if not has_best_or_confused:
        direct_add_match = re.search(
            r"^(?:please\s+)?(?:add|give(?:\s+me)?|i\s+want|order|get(?:\s+me)?)\s+(.+?)(?:\s+to\s+cart|\s+please)?$",
            lower,
        )
        if direct_add_match and extracted_food_hint:
            raw_items_body = direct_add_match.group(1).strip()
            parts = [p.strip() for p in re.split(r"\s+and\s+|\s*,\s*|\s+with\s+", raw_items_body) if p.strip()]
            parsed_items = []
            for part in parts:
                # Strip repeated leading verb if user said "add 2 naan and add 1 paneer"
                part_clean = re.sub(r"^(?:add|give(?:\s+me)?|order|get)\s+", "", part).strip()
                m_item = re.match(
                    r"^(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)?\s*(.+)$",
                    part_clean,
                )
                if m_item:
                    raw_q = (m_item.group(1) or "1").lower()
                    qty_val = (
                        1
                        if raw_q in ("a", "an")
                        else num_words.get(raw_q, int(raw_q) if raw_q.isdigit() else 1)
                    )
                    dish_str = m_item.group(2).strip()
                    for fw in ["more ", "plates of ", "plate of ", "portions of ", "portion of "]:
                        dish_str = dish_str.replace(fw, "").strip()
                    if dish_str and dish_str not in ("item", "items", "food", "dish", "something"):
                        parsed_items.append({"name": dish_str, "quantity": qty_val})
            if parsed_items:
                state["intent"] = "ADD_ITEM"
                state["entities"] = {
                    "items": parsed_items,
                    "item_name": parsed_items[0]["name"],
                    "quantity": parsed_items[0]["quantity"],
                }
                return state

    # 3D. Safe Fast Keyword Browse (ONLY triggers if query contains a known food term OR veg/non-veg filter OR exact menu command)
    if lower in ("menu", "show menu", "show me the menu", "show all menu", "full menu", "khana", "dikhao", "list items", "categories"):
        state["intent"] = "BROWSE"
        state["entities"] = {}
        return state

    browse_verbs = ["show", "find", "search", "list", "dikhao", "batao", "menu", "do you have", "any "]
    order_verbs = ["add ", "give ", "i want ", "order ", "plus ", "mangva", "chahiye"]
    is_explicit_add = any(lower.startswith(v) or f" {v}" in f" {lower}" for v in order_verbs)

    if not is_explicit_add and (any(v in lower for v in browse_verbs) or extracted_food_hint or (is_veg_val is not None)):
        # Strictly require either a known food term or explicit Veg/Non-Veg filter so non-food words ("my cart", "my car", "wifi") NEVER get hijacked!
        if extracted_food_hint or (is_veg_val is not None):
            state["intent"] = "BROWSE"
            state["entities"] = {
                "item_name": extracted_food_hint,
                "is_veg": is_veg_val,
                "limit": extracted_num,
            }
            return state

    # ═══════════════════════════════════════════════════════════════════════════
    # LAYER 4: COMPACT GEMINI 3.5 FLASH LITE NLU (Non-Blocking Async Thread)
    # ═══════════════════════════════════════════════════════════════════════════
    try:
        prompt = INTENT_PROMPT.format(message=lower)
        try:
            response = await asyncio.to_thread(model.generate_content, prompt)
        except Exception:
            response = await asyncio.to_thread(fallback_model.generate_content, prompt)
        raw = response.text.strip()

        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        parsed = json.loads(raw)
        state["intent"] = parsed.get("intent", "OTHER")

        if any(k in parsed for k in ("items", "birthday_name", "item_name", "is_veg", "limit", "quantity")):
            state["entities"] = {
                "items": parsed.get("items", []),
                "birthday_name": parsed.get("birthday_name"),
                "item_name": parsed.get("item_name"),
                "is_veg": parsed.get("is_veg"),
                "limit": parsed.get("limit"),
                "quantity": parsed.get("quantity", 1),
            }
        else:
            state["entities"] = parsed.get("entities", {})

    except Exception as e:
        print(f"Intent Parser Error: {e}")
        if extracted_food_hint:
            state["intent"] = "BROWSE"
            state["entities"] = {"item_name": extracted_food_hint, "is_veg": is_veg_val}
        else:
            state["intent"] = "OTHER"
            state["entities"] = {}

    return state
