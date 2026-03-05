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
    """Fetch menu categories or items and prepare response payload."""
    branch_id = state.get("branch_id")
    entities = state.get("entities", {})
    item_name_hint = (entities.get("item_name") or "").lower()

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
                    )
                )
                items = items_result.scalars().all()
                if not items:
                    state["final_response"] = {"type": "text", "body": "No items found in this category. 📋"}
                    return state

                # Get current cart count for friendly feedback
                cart_status = ""
                cart_total = 0
                try:
                    cart_res = await db.execute(select(Cart).where(Cart.session_id == uuid.UUID(state["session_id"]), Cart.status == CartStatus.OPEN))
                    cart = cart_res.scalar_one_or_none()
                    if cart and cart.total > 0:
                        item_count_res = await db.execute(select(CartItem).where(CartItem.cart_id == cart.id))
                        count = sum(ci.quantity for ci in item_count_res.scalars().all())
                        cart_status = f"🛒 In Cart: {count} items (₹{cart.total:.0f})\n"
                        cart_total = cart.total
                except Exception as e:
                    print(f"Cart status feedback error: {e}")

                rows = []
                # 0. Confirm & Checkout at the Top (most prominent action)
                rows.append({
                    "id": "confirm_order",
                    "title": "✅ Confirm & Place Order",
                    "description": f"Place your order now! ({cart_total:.0f} total)"
                })
                rows.append({
                    "id": "view_cart",
                    "title": "🛒 View Cart",
                    "description": "See items in your cart"
                })

                for item in items[:8]: # Show 8 items + Checkout + Back
                    veg = VEG_EMOJI["veg"] if item.is_veg else VEG_EMOJI["nonveg"]
                    title = f"{veg} {item.name}"[:24]
                    rows.append({
                        "id": f"item_add_{item.id}",
                        "title": title,
                        "description": f"₹{item.base_price:.0f}",
                    })
                
                # Navigation Link
                rows.append({
                    "id": "show_menu",
                    "title": "🔙 All Categories",
                    "description": "View other menu sections"
                })

                prefix = state.pop("loop_prefix", "")
                body = f"{cart_status}Select items to add: 👇\n\n💡 Tip: Just type *'2 burgers and 1 coke'* to add multiple items at once!"
                if prefix:
                    body = f"{prefix}\n\n{body}"

                state["final_response"] = {
                    "type": "list",
                    "body": body,
                    "button_label": "View Items",
                    "sections": [{"title": "Category Items", "rows": rows}],
                }
                return state
            except (ValueError, Exception) as e:
                print(f"Error fetching category items: {e}")

        # 2. Veg / Non-Veg search filter
        is_veg_filter = entities.get("is_veg")
        if is_veg_filter is not None:
            items_result = await db.execute(
                select(MenuItem).where(
                    MenuItem.branch_id == uuid.UUID(branch_id),
                    MenuItem.is_veg == is_veg_filter,
                    MenuItem.is_available == True
                )
            )
            items = items_result.scalars().all()
            if not items:
                state["final_response"] = {"type": "text", "body": f"Sorry, couldn't find any {'veg' if is_veg_filter else 'non-veg'} items content. 📋"}
                return state

            rows = []
            for item in items[:10]:
                veg = VEG_EMOJI["veg"] if item.is_veg else VEG_EMOJI["nonveg"]
                title = f"{veg} {item.name}"[:24]
                rows.append({"id": f"item_add_{item.id}", "title": title, "description": f"₹{item.base_price:.0f}"})
            
            state["final_response"] = {
                "type": "list",
                "body": f"Here are our {'Veg' if is_veg_filter else 'Non-Veg'} items: 👇",
                "button_label": "View Items",
                "sections": [{"title": "Filter Results", "rows": rows}],
            }
            return state

        # 3. Fuzzy search for item hint
        if item_name_hint:
            items_result = await db.execute(
                select(MenuItem).where(
                    MenuItem.branch_id == uuid.UUID(branch_id),
                    MenuItem.is_available == True,
                )
            )
            all_items = items_result.scalars().all()
            matched = [i for i in all_items if item_name_hint in i.name.lower()]
            if not matched:
                matched = all_items[:10]  # fallback: show first 10

            if not matched:
                state["final_response"] = {"type": "text", "body": "Sorry, no items are available at the moment. 📋"}
                return state

            rows = []
            for item in matched[:10]:
                veg = VEG_EMOJI["veg"] if item.is_veg else VEG_EMOJI["nonveg"]
                spice = SPICE_EMOJI.get(item.spice_level, "") if item.spice_level else ""
                title = f"{veg} {item.name}"[:24]
                rows.append({
                    "id": f"item_add_{item.id}",
                    "title": title,
                    "description": f"₹{item.base_price:.0f} {spice}",
                })
            state["final_response"] = {
                "type": "list",
                "body": "Here are the matching items 👇\nTap one to add it to cart:",
                "button_label": "View Items",
                "sections": [{"title": "Menu Items", "rows": rows}],
            }
        else:
            # 4. Default: Show categories
            cats_result = await db.execute(
                select(MenuCategory).where(
                    MenuCategory.branch_id == uuid.UUID(branch_id),
                    MenuCategory.is_active == True,
                ).order_by(MenuCategory.sort_order)
            )
            cats = cats_result.scalars().all()
            if not cats:
                state["final_response"] = {"type": "text", "body": "The menu is currently being updated. Please check back in a few minutes! 📋"}
                return state

            rows = [{"id": f"cat_{c.id}", "title": c.name[:24], "description": f"~{c.estimated_prep_minutes} min" if c.estimated_prep_minutes else ""} for c in cats[:10]]
            state["final_response"] = {
                "type": "list",
                "body": "📋 Our Menu Categories — tap to browse:",
                "button_label": "Browse Menu",
                "sections": [{"title": "Categories", "rows": rows}],
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
