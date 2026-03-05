"""Bot nodes — menu_retrieval + response_formatter"""
import uuid
from app.bot.state import BotState
from app.database import AsyncSessionLocal
from app.models.menu import MenuCategory, MenuItem
from app.models.cart import Cart, CartItem, CartStatus
from sqlalchemy import select


VEG_EMOJI = {"veg": "🟢", "nonveg": "🔴", "jain": "🌿"}
SPICE_EMOJI = {"mild": "🌶", "medium": "🌶🌶", "hot": "🌶🌶🌶"}



async def menu_retrieval(state: BotState) -> BotState:
    """Fetch menu categories or items and prepare response payload with 10-row limit safety."""
    branch_id = state.get("branch_id")
    entities = state.get("entities", {})
    page = int(entities.get("page") or 0)
    PAGE_SIZE_ITEMS = 6
    PAGE_SIZE_CATS = 9

    if not branch_id:
        state["error"] = "no_branch_id"
        return state

    async with AsyncSessionLocal() as db:
        # 1. Show items for a specific category
        cat_id = entities.get("category_id")
        if cat_id:
            try:
                items_result = await db.execute(
                    select(MenuItem).where(
                        MenuItem.category_id == uuid.UUID(cat_id),
                        MenuItem.is_available == True
                    ).order_by(MenuItem.name)
                )
                all_items = items_result.scalars().all()
                if not all_items:
                    state["final_response"] = {"type": "text", "body": "No items found in this category. 📋"}
                    return state

                # Pagination
                start = page * PAGE_SIZE_ITEMS
                end = start + PAGE_SIZE_ITEMS
                items = all_items[start:end]
                has_next = len(all_items) > end
                has_prev = page > 0

                # Get cart info
                cart_total = 0
                try:
                    cart_res = await db.execute(select(Cart).where(Cart.session_id == uuid.UUID(state["session_id"]), Cart.status == CartStatus.OPEN))
                    cart = cart_res.scalar_one_or_none()
                    if cart: cart_total = float(cart.total)
                except: pass

                rows = []
                # Max 10 rows total
                rows.append({"id": "confirm_order", "title": "✅ Checkout & Place Order", "description": f"Total: ₹{cart_total:.0f}"})
                rows.append({"id": "view_cart", "title": "🛒 View Cart", "description": "Edit your items"})

                for item in items:
                    veg = VEG_EMOJI["veg"] if item.is_veg else VEG_EMOJI["nonveg"]
                    rows.append({
                        "id": f"item_add_{item.id}",
                        "title": f"{veg} {item.name}"[:24],
                        "description": f"₹{item.base_price:.0f}",
                    })
                
                # Navigation Rows (Row 10 or 9&10)
                if has_next:
                    rows.append({
                        "id": f"next_page_items_{cat_id}_{page+1}",
                        "title": "➡️ Next Page",
                        "description": f"See more ({len(all_items) - end} items left)"
                    })
                
                if has_prev:
                    rows.append({
                        "id": f"prev_page_items_{cat_id}_{page-1}",
                        "title": "⬅️ Previous Page",
                        "description": "Go back"
                    })

                rows.append({"id": "show_menu", "title": "🔙 All Categories", "description": "Browse sections"})

                state["final_response"] = {
                    "type": "list",
                    "body": f"Select items (Page {page+1}): 👇\n💡 Tip: Add multiple at once like *'2 burgers, 1 coke'*",
                    "button_label": "View Items",
                    "sections": [{"title": "Delicious Food", "rows": rows[:10]}], # Force 10 rows
                }
                return state
            except Exception as e:
                print(f"Error fetching category items: {e}")

        # 2. Veg / Non-Veg search filter (STRICT LIMIT)
        is_veg_filter = entities.get("is_veg")
        if is_veg_filter is not None:
            items_result = await db.execute(
                select(MenuItem).where(
                    MenuItem.branch_id == uuid.UUID(branch_id),
                    MenuItem.is_veg == is_veg_filter,
                    MenuItem.is_available == True
                ).limit(10)
            )
            items = items_result.scalars().all()
            if not items:
                state["final_response"] = {"type": "text", "body": f"No {'veg' if is_veg_filter else 'non-veg'} items found. 📋"}
                return state

            rows = []
            for item in items:
                veg = VEG_EMOJI["veg"] if item.is_veg else VEG_EMOJI["nonveg"]
                rows.append({"id": f"item_add_{item.id}", "title": f"{veg} {item.name}"[:24], "description": f"₹{item.base_price:.0f}"})
            
            state["final_response"] = {
                "type": "list",
                "body": f"Our {'Veg' if is_veg_filter else 'Non-Veg'} menu: 👇",
                "button_label": "View Items",
                "sections": [{"title": "Results", "rows": rows[:10]}],
            }
            return state

        # 3. Fuzzy search for item hint (STRICT LIMIT)
        item_name_hint = (entities.get("item_name") or "").lower()
        if item_name_hint:
            items_result = await db.execute(
                select(MenuItem).where(
                    MenuItem.branch_id == uuid.UUID(branch_id),
                    MenuItem.is_available == True,
                )
            )
            all_items = items_result.scalars().all()
            matched = [i for i in all_items if item_name_hint in i.name.lower()][:10]
            if not matched:
                state["final_response"] = {"type": "text", "body": "Sorry, item not available. 📋"}
                return state

            rows = []
            for item in matched:
                veg = VEG_EMOJI["veg"] if item.is_veg else VEG_EMOJI["nonveg"]
                rows.append({"id": f"item_add_{item.id}", "title": f"{veg} {item.name}"[:24], "description": f"₹{item.base_price:.0f}"})
            state["final_response"] = {
                "type": "list",
                "body": "Matching items found: 👇",
                "button_label": "View Items",
                "sections": [{"title": "Search", "rows": rows[:10]}],
            }
            return state

        # 4. Default: Show categories (PAGINATED)
        cats_result = await db.execute(
            select(MenuCategory).where(
                MenuCategory.branch_id == uuid.UUID(branch_id),
                MenuCategory.is_active == True,
            ).order_by(MenuCategory.sort_order)
        )
        all_cats = cats_result.scalars().all()
        if not all_cats:
            state["final_response"] = {"type": "text", "body": "Menu coming soon! 📋"}
            return state

        start_c = page * PAGE_SIZE_CATS
        end_c = start_c + PAGE_SIZE_CATS
        cats = all_cats[start_c:end_c]
        has_next_c = len(all_cats) > end_c

        rows_c = [{"id": f"cat_{c.id}", "title": c.name[:24], "description": "Browse section"} for c in cats]
        
        if has_next_c:
            rows_c = rows_c[:9] # Keep row 10 for Next
            rows_c.append({
                "id": f"next_page_cats_{page+1}",
                "title": "➡️ Next Categories",
                "description": f"More sections available"
            })
        elif page > 0:
            rows_c.append({"id": f"prev_page_cats_{page-1}", "title": "⬅️ Previous Page", "description": "Go back"})

        state["final_response"] = {
            "type": "list",
            "body": "📋 Browse Menu (Page {}):".format(page + 1),
            "button_label": "Choose Category",
            "sections": [{"title": "Categories", "rows": rows_c[:10]}],
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
