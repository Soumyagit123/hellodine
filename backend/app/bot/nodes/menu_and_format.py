"""Bot nodes — menu_retrieval + response_formatter"""
import uuid
from app.bot.state import BotState
from app.database import AsyncSessionLocal
from app.models.menu import MenuCategory, MenuItem
from app.models.cart import Cart, CartItem, CartStatus
from app.models.orders import OrderItem
from app.services.vector_service import pgvector_search_menu_items
from app.services.cache_service import cache
from sqlalchemy import select, func


VEG_EMOJI = {"veg": "🟢", "nonveg": "🔴", "jain": "🌿"}
SPICE_EMOJI = {"mild": "🌶", "medium": "🌶🌶", "hot": "🌶🌶🌶"}


async def get_ranked_menu_items(branch_id: str, db) -> tuple[list[MenuItem], dict[str, int]]:
    """
    Return all available MenuItems for a branch sorted by popularity & bestsellers.
    Cached in RAM for 120 seconds to eliminate repeated DB round-trips.
    """
    cached_ranked = cache.get(f"ranked_items:{branch_id}")
    if cached_ranked:
        return cached_ranked

    pop_res = await db.execute(
        select(OrderItem.menu_item_id, func.sum(OrderItem.quantity).label("total_ordered"))
        .group_by(OrderItem.menu_item_id)
    )
    popularity_map: dict[str, int] = {
        str(row.menu_item_id): int(row.total_ordered or 0) for row in pop_res.all()
    }

    items_res = await db.execute(
        select(MenuItem).where(
            MenuItem.branch_id == uuid.UUID(branch_id),
            MenuItem.is_available == True,
        )
    )
    items = list(items_res.scalars().all())
    items.sort(
        key=lambda i: (
            1 if getattr(i, "is_bestseller", False) else 0,
            popularity_map.get(str(i.id), 0),
            -float(i.base_price or 0),
        ),
        reverse=True,
    )
    result = (items, popularity_map)
    cache.set(f"ranked_items:{branch_id}", result, ttl_seconds=120)
    return result


async def menu_retrieval(state: BotState) -> BotState:
    """Fetch menu categories or Top-3 Bestseller recommendations, return chat results, and emit ui_action = FILTER_MENU."""
    branch_id = state.get("branch_id")
    intent = state.get("intent", "BROWSE")
    entities = state.get("entities", {}) or {}
    page = int(entities.get("page") or 0)
    PAGE_SIZE_CATS = 9

    if not branch_id:
        state["error"] = "no_branch_id"
        return state

    async with AsyncSessionLocal() as db:
        # Preload all active categories & popularity-ranked available items
        cats_result = await db.execute(
            select(MenuCategory).where(
                MenuCategory.branch_id == uuid.UUID(branch_id),
                MenuCategory.is_active == True,
            ).order_by(MenuCategory.sort_order)
        )
        all_cats = cats_result.scalars().all()
        cat_map = {str(c.id): c for c in all_cats}

        all_branch_items, popularity_map = await get_ranked_menu_items(branch_id, db)

        item_name_hint = (entities.get("item_name") or "").lower().strip()
        is_veg_filter = entities.get("is_veg")
        cat_id = entities.get("category_id")

        # ── 0. AI SMART RECOMMENDER ("RECOMMEND_BEST"): Top 3 in requested category OR Top 3 across categories ──
        if intent == "RECOMMEND_BEST":
            limit_val = int(entities.get("limit") or 3)
            candidates = list(all_branch_items)

            if is_veg_filter is not None:
                candidates = [i for i in candidates if i.is_veg == bool(is_veg_filter)]

            matched_cat_obj = None
            if cat_id and cat_map.get(str(cat_id)):
                matched_cat_obj = cat_map[str(cat_id)]
                candidates = [i for i in candidates if str(i.category_id) == str(cat_id)]
            elif item_name_hint:
                # Check if hint matches a category (e.g. "starter", "thali", "rice", "roti") or dish keyword
                matching_cats = [
                    c for c in all_cats
                    if item_name_hint in c.name.lower() or any(tok in c.name.lower() for tok in item_name_hint.split() if len(tok) >= 3)
                ]
                if matching_cats:
                    cat_ids_set = {str(c.id) for c in matching_cats}
                    if len(matching_cats) == 1:
                        matched_cat_obj = matching_cats[0]
                    cat_filtered = [i for i in candidates if str(i.category_id) in cat_ids_set]
                    if cat_filtered:
                        candidates = cat_filtered
                else:
                    kw_filtered = [i for i in candidates if item_name_hint in i.name.lower()]
                    if kw_filtered:
                        candidates = kw_filtered
                    else:
                        # Use Supabase pgvector semantic search for natural descriptions (e.g. "creamy", "spicy", "kids")
                        vec_matches = await pgvector_search_menu_items(
                            branch_id,
                            state.get("message_text") or item_name_hint,
                            db,
                            is_veg=is_veg_filter,
                            limit=max(limit_val, 3),
                        )
                        if vec_matches:
                            candidates = vec_matches

            # If no specific category was asked, pick the Top-ranked dishes across distinct categories so customer gets a balanced Top-3/Top-N
            if not matched_cat_obj and not item_name_hint:
                top_picks: list[MenuItem] = []
                seen_cats: set[str] = set()
                # Pass 1: #1 best item from each category
                for it in candidates:
                    cid = str(it.category_id)
                    if cid not in seen_cats:
                        top_picks.append(it)
                        seen_cats.add(cid)
                    if len(top_picks) >= max(limit_val, 3):
                        break
                # Pass 2: fill remaining slots if needed
                for it in candidates:
                    if it not in top_picks and len(top_picks) < max(limit_val, 3):
                        top_picks.append(it)
                recommended = top_picks[:max(limit_val, 3)]
            else:
                recommended = candidates[:max(limit_val, 3)]

            if not recommended:
                recommended = all_branch_items[:3]

            veg_filter_ui = "VEG" if is_veg_filter is True else ("NONVEG" if is_veg_filter is False else "ALL")
            state["ui_action"] = {
                "action": "FILTER_MENU",
                "category_id": str(matched_cat_obj.id) if matched_cat_obj else "ALL",
                "veg_filter": veg_filter_ui,
                "search_query": "",
                "matched_item_ids": [str(i.id) for i in recommended],
            }

            lines = []
            buttons = []
            for idx, item in enumerate(recommended, start=1):
                veg_icon = VEG_EMOJI["veg"] if item.is_veg else VEG_EMOJI["nonveg"]
                c_name = cat_map.get(str(item.category_id)).name if cat_map.get(str(item.category_id)) else "Chef Special"
                star_tag = "⭐ Bestseller" if (getattr(item, "is_bestseller", False) or popularity_map.get(str(item.id), 0) > 0) else f"🔥 Top in {c_name}"
                lines.append(f"{idx}. {veg_icon} *{item.name}* — ₹{float(item.base_price):.0f} _({star_tag})_")
                if len(buttons) < 4:
                    buttons.append({
                        "id": f"item_add_{item.id}",
                        "title": f"➕ {item.name[:18]}",
                    })

            scope_label = matched_cat_obj.name if matched_cat_obj else ("Pure Veg" if is_veg_filter is True else ("Non-Veg" if is_veg_filter is False else "Kitchen"))
            spoken_names = ", ".join(i.name for i in recommended[:3])

            state["final_response"] = {
                "type": "buttons",
                "body": (
                    f"👨‍🍳 *Chef's Top {len(recommended)} {scope_label} Recommendations:*\n"
                    f"_(Displayed on the left menu for you! 👈)_\n\n"
                    + "\n".join(lines)
                    + "\n\nTap *+ ADD* on the left cards or tap a dish button below to add it instantly:"
                ),
                "buttons": buttons,
                "voice_text": f"Our top {scope_label} recommendations are {spoken_names}. I have highlighted them on the left menu for you!",
            }
            return state

        # 1. Combined Search / Filter (Keyword / Category / Veg or Non-Veg / Limit)
        limit_val = int(entities.get("limit") or 10)
        if item_name_hint or (is_veg_filter is not None) or cat_id:
            matched_items = list(all_branch_items)
            matched_category_id = str(cat_id) if cat_id else "ALL"
            search_query_for_ui = ""

            # Filter by explicit category_id if clicked
            if cat_id:
                matched_items = [i for i in matched_items if str(i.category_id) == str(cat_id)]

            # Filter by Veg / Non-Veg if specified
            if is_veg_filter is not None:
                matched_items = [i for i in matched_items if i.is_veg == bool(is_veg_filter)]

            # Filter by keyword (check both Category Name and Item Name)
            if item_name_hint:
                # Check if keyword matches a Category name (e.g. "thali", "starter", "roti", "fish", "rice")
                matching_cats = [
                    c for c in all_cats
                    if item_name_hint in c.name.lower() or any(tok in c.name.lower() for tok in item_name_hint.split() if len(tok) >= 3)
                ]
                # If user also said veg/non-veg, prefer categories that match or filter items inside
                if matching_cats and len(matching_cats) == 1 and is_veg_filter is None:
                    matched_category_id = str(matching_cats[0].id)

                cat_ids_matching = {str(c.id) for c in matching_cats}
                keyword_tokens = [t for t in item_name_hint.split() if len(t) >= 3]

                filtered_by_kw = [
                    i for i in matched_items
                    if (
                        item_name_hint in i.name.lower()
                        or str(i.category_id) in cat_ids_matching
                        or (keyword_tokens and all(tok in i.name.lower() or tok in (cat_map.get(str(i.category_id)).name.lower() if cat_map.get(str(i.category_id)) else "") for tok in keyword_tokens))
                        or (keyword_tokens and any(tok in i.name.lower() for tok in keyword_tokens))
                    )
                ]
                matched_items = filtered_by_kw
                # If SQL substring match found nothing, run Supabase pgvector semantic search!
                if not matched_items:
                    vec_results = await pgvector_search_menu_items(
                        branch_id,
                        state.get("message_text") or item_name_hint,
                        db,
                        is_veg=is_veg_filter,
                        limit=limit_val,
                    )
                    if vec_results:
                        matched_items = vec_results
                # If not a single category match, pass search query to the left-side UI search box
                if matched_category_id == "ALL" and not matched_items:
                    search_query_for_ui = item_name_hint

            veg_filter_ui = "ALL"
            if is_veg_filter is True:
                veg_filter_ui = "VEG"
            elif is_veg_filter is False:
                veg_filter_ui = "NONVEG"

            # Emit UI Action so the Left-Side Visual Menu automatically filters & highlights these items!
            state["ui_action"] = {
                "action": "FILTER_MENU",
                "category_id": matched_category_id,
                "veg_filter": veg_filter_ui,
                "search_query": search_query_for_ui,
                "matched_item_ids": [str(i.id) for i in matched_items[:limit_val]],
            }

            if not matched_items:
                desc_parts = []
                if is_veg_filter is True:
                    desc_parts.append("Pure Veg")
                elif is_veg_filter is False:
                    desc_parts.append("Non-Veg")
                if item_name_hint:
                    desc_parts.append(f"'{item_name_hint}'")
                desc_str = " ".join(desc_parts) or "that filter"
                state["ui_action"] = {
                    "action": "FILTER_MENU",
                    "category_id": "ALL",
                    "veg_filter": veg_filter_ui,
                    "search_query": "",
                }
                state["final_response"] = {
                    "type": "text",
                    "body": f"We couldn't find any {desc_str} items right now, so I've shown our available {'Veg' if is_veg_filter is True else 'Non-Veg' if is_veg_filter is False else 'full'} menu on the left screen! 👈",
                    "voice_text": f"Here are our available menu options on the left screen.",
                }
                return state

            display_items = matched_items[:max(1, min(limit_val, 8))]
            lines = []
            buttons = []
            for idx, item in enumerate(display_items, start=1):
                veg_icon = VEG_EMOJI["veg"] if item.is_veg else VEG_EMOJI["nonveg"]
                lines.append(f"{idx}. {veg_icon} *{item.name}* — ₹{float(item.base_price):.0f}")
                if len(buttons) < 4:
                    buttons.append({
                        "id": f"item_add_{item.id}",
                        "title": f"➕ {item.name[:18]}",
                    })

            filter_title = []
            if is_veg_filter is True:
                filter_title.append("Pure Veg")
            elif is_veg_filter is False:
                filter_title.append("Non-Veg")
            if item_name_hint:
                filter_title.append(item_name_hint.title())
            elif cat_id and cat_map.get(str(cat_id)):
                filter_title.append(cat_map[str(cat_id)].name)

            heading = " ".join(filter_title) if filter_title else "Recommended"

            body = (
                f"👈 *I have displayed {len(matched_items)} {heading} dish(es) on the left menu!* Here are the top picks:\n\n"
                + "\n".join(lines)
                + "\n\nTap *+ ADD* on the left menu cards or tap a quick button below:"
            )
            state["final_response"] = {
                "type": "buttons",
                "body": body,
                "buttons": buttons,
                "voice_text": f"I have shown the {heading} items on the left menu for you.",
            }
            return state

        # 2. Default ("show menu" / "all menu"): Reset left-side filters to show full menu + list categories
        state["ui_action"] = {
            "action": "FILTER_MENU",
            "category_id": "ALL",
            "veg_filter": "ALL",
            "search_query": "",
        }

        if not all_cats:
            state["final_response"] = {"type": "text", "body": "Menu coming soon! 📋"}
            return state

        start_c = page * PAGE_SIZE_CATS
        end_c = start_c + PAGE_SIZE_CATS
        cats = all_cats[start_c:end_c]

        cat_buttons = [{"id": f"cat_{c.id}", "title": f"🍽️ {c.name[:18]}"} for c in cats[:4]]
        cat_names = ", ".join(c.name for c in all_cats)

        state["final_response"] = {
            "type": "buttons",
            "body": f"📋 *Full Menu is displayed on the left screen!*\n\nCategories available: {cat_names}.\n\nAsk me for anything like *'show non veg thali'*, *'find 5 best veg items'*, or tap a category below:",
            "buttons": cat_buttons,
            "voice_text": "I have shown our full menu on the left screen.",
        }
    return state


async def item_info_node(state: BotState) -> BotState:
    """Show item details and ask for quantity using buttons."""
    entities = state.get("entities", {})
    item_id = entities.get("item_id")
    
    if not item_id:
        state["final_response"] = {"type": "text", "body": "Which item? Please select from the menu. 📋"}
        return state

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(MenuItem).where(MenuItem.id == uuid.UUID(item_id)))
        item = res.scalar_one_or_none()
        
        if not item:
            state["final_response"] = {"type": "text", "body": "Item not found. 📋"}
            return state

        veg = VEG_EMOJI["veg"] if item.is_veg else VEG_EMOJI["nonveg"]
        body = (
            f"*{veg} {item.name}*\n"
            f"💰 Price: ₹{item.base_price:.0f}\n\n"
            "How many portions would you like? 👇"
        )
        
        state["final_response"] = {
            "type": "buttons",
            "body": body,
            "buttons": [
                {"id": f"qty_1_{item.id}", "title": "1 Portion"},
                {"id": f"qty_2_{item.id}", "title": "2 Portions"},
                {"id": f"qty_3_{item.id}", "title": "3 Portions"},
            ]
        }
    return state


async def response_formatter(state: BotState) -> BotState:
    """Build WA-sendable payload from state.final_response."""
    # final_response is already set by other nodes; this node is a pass-through
    # to allow future enrichment (language, personalisation, etc.)
    lang = state.get("preferred_language", "en")

    if not state.get("final_response"):
        if state.get("error") == "no_session":
            state["final_response"] = {
                "type": "text",
                "body": "👋 Please scan the QR code on your table to start ordering.",
            }
        elif state.get("error") == "invalid_token":
            state["final_response"] = {
                "type": "text",
                "body": "❌ Invalid or expired QR code. Please ask staff for a new one.",
            }
        else:
            state["final_response"] = {
                "type": "text",
                "body": "I didn't understand that. Try: *show menu*, *add [item]*, *confirm*, or *bill please*.",
            }
    return state
