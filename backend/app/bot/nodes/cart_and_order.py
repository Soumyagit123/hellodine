"""Bot nodes — cart_executor + checkout_guard + kitchen_dispatch"""
import uuid
from app.bot.state import BotState
from app.database import AsyncSessionLocal
from app.models.menu import MenuItem
from app.models.cart import Cart, CartItem, CartStatus
from app.models.customers import TableSession
from app.services.cart_service import add_item_to_cart, remove_cart_item, get_or_create_cart
from app.services.order_service import create_order_from_cart, CheckoutError
from app.services.ws_manager import manager
from app.models.tenancy import Table
from sqlalchemy import select


async def cart_executor(state: BotState) -> BotState:
    """Handle ADD_ITEM / REMOVE_ITEM / UPDATE_QTY / CART_VIEW intents."""
    intent = state.get("intent")
    session_id = state.get("session_id")
    branch_id = state.get("branch_id")
    entities = state.get("entities", {})

    if not session_id:
        state["error"] = "no_session"
        return state

    async with AsyncSessionLocal() as db:
        cart = await get_or_create_cart(uuid.UUID(session_id), db)

        # ── UPDATE_QTY (from Buttons + / -) ──────────────────────────
        if intent == "UPDATE_QTY":
            item_id = entities.get("item_id")
            operation = entities.get("operation") # 'inc' or 'dec'
            
            # Find the cart item for this menu item
            ci_res = await db.execute(
                select(CartItem).where(CartItem.cart_id == cart.id, CartItem.menu_item_id == uuid.UUID(item_id))
            )
            cart_item = ci_res.scalar_one_or_none()
            
            if cart_item:
                delta = 1 if operation == "inc" else -1
                cart = await update_cart_item_quantity(cart_item.id, delta, db)
                # Fallthrough to ADD_ITEM style response to show updated qty
                intent = "ADD_ITEM" 
                entities["item_id"] = item_id
            else:
                state["intent"] = "BROWSE" # Fallback
                return state

        # ── CART_VIEW ────────────────────────────────────────────────
        if intent == "CART_VIEW":
            result = await db.execute(select(CartItem).where(CartItem.cart_id == cart.id))
            items = result.scalars().all()
            if not items:
                state["final_response"] = {"type": "text", "body": "🛒 Your cart is empty. Say *show menu* to browse."}
                return state

            lines = []
            for ci in items:
                item_r = await db.execute(select(MenuItem).where(MenuItem.id == ci.menu_item_id))
                mi = item_r.scalar_one_or_none()
                if not mi: continue
                lines.append(f"• {mi.name} ×{ci.quantity} — ₹{ci.line_total:.0f}" + (f"\n  📝 {ci.notes}" if ci.notes else ""))

            cart_text = "\n".join(lines)
            state["final_response"] = {
                "type": "text",
                "body": f"🛒 *Your Cart (Table)*\n\n{cart_text}\n\n💰 *Total: ₹{cart.total:.2f}*\n\nSay *confirm* to place order or keep adding items.",
            }
            return state

        # ── ADD_ITEM ─────────────────────────────────────────────────
        if intent == "ADD_ITEM":
            items_to_add = entities.get("items", []) # Multi-item NLP support
            
            # If not multi-item, wrap the single item entity
            if not items_to_add:
                item_id = entities.get("item_id")
                item_name = entities.get("item_name")
                if item_id or item_name:
                    items_to_add = [{"name": item_name, "item_id": item_id, "quantity": entities.get("quantity", 1)}]

            if not items_to_add:
                state["final_response"] = {"type": "text", "body": "What would you like to add? Say e.g. *add 2 burgers* or pick from the menu."}
                return state

            last_category_id = None
            added_names = []
            
            for entry in items_to_add:
                menu_item = None
                qty = int(entry.get("quantity") or 1)
                name_query = (entry.get("name") or "").lower().strip()
                
                if entry.get("item_id"):
                    res = await db.execute(select(MenuItem).where(MenuItem.id == uuid.UUID(entry["item_id"])))
                    menu_item = res.scalar_one_or_none()
                elif name_query:
                    items_res = await db.execute(select(MenuItem).where(MenuItem.branch_id == uuid.UUID(branch_id), MenuItem.is_available == True))
                    all_m = items_res.scalars().all()
                    
                    # 1. Direct match
                    match = [i for i in all_m if name_query in i.name.lower()]
                    if not match:
                        # 2. Keyword/token-based match (more resilient to "two" or typos)
                        tokens = [t for t in name_query.split() if len(t) > 2] # Avoid "of", "and"
                        if tokens:
                            match = [i for i in all_m if any(t in i.name.lower() for t in tokens)]
                    
                    if match:
                        menu_item = match[0]

                if menu_item:
                    cart = await add_item_to_cart(uuid.UUID(session_id), menu_item.id, qty, db)
                    last_category_id = menu_item.category_id
                    added_names.append(f"*{menu_item.name}* ×{qty}")

            if not added_names:
                state["final_response"] = {"type": "text", "body": "❌ Couldn't find those items. Please select from the menu or try typing the item name exactly."}
                return state

            # --- Simplified "Keep Picking" UX ---
            # If item was added via ID (from list), re-show the list for a "multi-select" feel
            if entities.get("item_id") and last_category_id:
                state["intent"] = "BROWSE"
                state["entities"] = {"category_id": str(last_category_id)}
                state["loop_prefix"] = f"✅ Added: {added_names[0]}"
                return state

            # If it was a text-based NLP order, show a summary with Confirm button
            state["final_response"] = {
                "type": "buttons",
                "body": f"✅ Added: {', '.join(added_names)}\n\n🛒 Cart Total: *₹{cart.total:.2f}*\n\nReady to order? Tap Confirm! 👇",
                "buttons": [
                    {"id": "confirm_order", "title": "✅ Confirm Order"},
                    {"id": "show_menu", "title": "Add More 📋"},
                    {"id": "view_cart", "title": "Review Cart 🛒"},
                ],
            }
            return state

        # ── REMOVE_ITEM ──────────────────────────────────────────────
        if intent == "REMOVE_ITEM":
            item_name = entities.get("item_name", "")
            items_result = await db.execute(select(CartItem).where(CartItem.cart_id == cart.id))
            cart_items = items_result.scalars().all()

            target = None
            for ci in cart_items:
                item_r = await db.execute(select(MenuItem).where(MenuItem.id == ci.menu_item_id))
                mi = item_r.scalar_one()
                if item_name.lower() in mi.name.lower():
                    target = ci
                    break

            if not target:
                state["final_response"] = {"type": "text", "body": f"❌ *{item_name}* not found in your cart."}
                return state

            cart = await remove_cart_item(target.id, db)
            state["final_response"] = {
                "type": "text",
                "body": f"✅ Removed *{item_name}* from cart.\n🛒 Cart total: *₹{cart.total:.2f}*",
            }
            return state

    return state


async def checkout_guard_node(state: BotState) -> BotState:
    """Show order summary and ask for CONFIRM button."""
    session_id = state.get("session_id")
    if not session_id:
        state["error"] = "no_session"
        return state

    async with AsyncSessionLocal() as db:
        cart = await get_or_create_cart(uuid.UUID(session_id), db)
        result = await db.execute(select(CartItem).where(CartItem.cart_id == cart.id))
        items = result.scalars().all()

        if not items:
            state["final_response"] = {"type": "text", "body": "🛒 Your cart is empty! Say *show menu* to start ordering."}
            return state

        lines = []
        for ci in items:
            item_r = await db.execute(select(MenuItem).where(MenuItem.id == ci.menu_item_id))
            mi = item_r.scalar_one_or_none()
            if not mi: continue
            lines.append(f"• {mi.name} ×{ci.quantity} — ₹{ci.line_total:.0f}")

        summary = "\n".join(lines)
        state["final_response"] = {
            "type": "buttons",
            "body": (
                f"📋 *Order Summary*\n\n{summary}\n\n"
                f"💰 Subtotal: ₹{cart.subtotal:.2f}\n"
                f"📊 GST (CGST+SGST): ₹{cart.cgst_amount + cart.sgst_amount:.2f}\n"
                f"💵 *Total: ₹{cart.total:.2f}*\n\n"
                "Confirm to send to kitchen? 👇"
            ),
            "buttons": [
                {"id": "do_confirm", "title": "✅ Confirm Order"},
                {"id": "edit_cart", "title": "✏️ Edit Cart"},
            ],
        }
    return state


async def kitchen_dispatch(state: BotState) -> BotState:
    """Actually place the order — called when customer taps Confirm."""
    session_id = state.get("session_id")
    if not session_id:
        state["error"] = "no_session"
        return state

    async with AsyncSessionLocal() as db:
        try:
            order = await create_order_from_cart(uuid.UUID(session_id), db)
            # Broadcast realtime to kitchen PWA
            table_result = await db.execute(select(Table).where(Table.id == order.table_id))
            table = table_result.scalar_one_or_none()
            if not table:
                raise CheckoutError("Table associated with order not found")

            # Wrap broadcast in try-except to prevent order failure on WS error
            try:
                await manager.broadcast_to_branch(str(order.branch_id), {
                    "event": "NEW_ORDER",
                    "order_id": str(order.id),
                    "order_number": order.order_number,
                    "table_number": table.table_number,
                    "total": str(order.total),
                })
            except Exception as ws_err:
                print(f"WARNING: Kitchen broadcast failed: {ws_err}")
            state["final_response"] = {
                "type": "text",
                "body": (
                    f"✅ *Order #{order.order_number} sent to kitchen!*\n\n"
                    f"🍽️ Table: {table.table_number}\n"
                    f"💵 Total: ₹{order.total:.2f}\n\n"
                    "You can add more items anytime. Payment at billing time. 😊"
                ),
            }
        except CheckoutError as e:
            state["final_response"] = {"type": "text", "body": f"⚠️ {e}"}
    return state
