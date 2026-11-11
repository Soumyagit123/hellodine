"""Bot nodes — cart_executor + checkout_guard + kitchen_dispatch"""
import uuid
from app.bot.state import BotState
from app.database import AsyncSessionLocal
from app.models.menu import MenuItem
from app.models.cart import Cart, CartItem, CartStatus
from app.models.orders import Order, OrderItem, OrderStatus
from app.models.customers import TableSession
from sqlalchemy.orm import selectinload

from app.services.cart_service import (
    add_item_to_cart,
    remove_cart_item,
    get_or_create_cart,
    update_cart_item_quantity,
)
from app.services.order_service import create_order_from_cart, CheckoutError
from app.services.ws_manager import manager
from app.models.tenancy import Table
from app.models.menu import MenuCategory
from app.bot.nodes.menu_and_format import get_ranked_menu_items
from app.services.vector_service import pgvector_search_menu_items
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

        # ── UPDATE_QTY (Buttons + / - OR Voice/Chat "make butter naan 3" / "reduce 1 roti") ──
        if intent == "UPDATE_QTY":
            item_id = entities.get("item_id")
            operation = entities.get("operation")  # 'inc' or 'dec'
            item_name = (entities.get("item_name") or "").strip().lower()
            if not item_name and entities.get("items"):
                item_name = (entities["items"][0].get("name") or "").strip().lower()
            target_qty = entities.get("quantity")
            delta_override = entities.get("delta")

            cart_item = None
            matched_menu_item = None

            if item_id:
                ci_res = await db.execute(
                    select(CartItem, MenuItem)
                    .outerjoin(MenuItem, CartItem.menu_item_id == MenuItem.id)
                    .where(CartItem.cart_id == cart.id, CartItem.menu_item_id == uuid.UUID(item_id))
                )
                row = ci_res.first()
                if row:
                    cart_item, matched_menu_item = row[0], row[1]
            elif item_name:
                ci_all_res = await db.execute(
                    select(CartItem, MenuItem)
                    .outerjoin(MenuItem, CartItem.menu_item_id == MenuItem.id)
                    .where(CartItem.cart_id == cart.id)
                )
                for ci, mi in ci_all_res.all():
                    if mi and (item_name in mi.name.lower() or mi.name.lower() in item_name):
                        cart_item = ci
                        matched_menu_item = mi
                        break

            if cart_item:
                if delta_override is not None:
                    delta = int(delta_override)
                elif operation in ("inc", "dec"):
                    delta = 1 if operation == "inc" else -1
                elif target_qty is not None:
                    delta = int(target_qty) - cart_item.quantity
                else:
                    delta = 1

                new_final_qty = cart_item.quantity + delta
                cart = await update_cart_item_quantity(cart_item.id, delta, db)
                if not matched_menu_item:
                    mi_res = await db.execute(select(MenuItem).where(MenuItem.id == cart_item.menu_item_id))
                    matched_menu_item = mi_res.scalar_one_or_none()
                dish_label = matched_menu_item.name if matched_menu_item else "Item"

                if new_final_qty <= 0:
                    state["final_response"] = {
                        "type": "buttons",
                        "body": f"🗑️ Removed *{dish_label}* from your cart.\n🛒 Updated Cart Total: *₹{cart.total:.2f}*",
                        "voice_text": f"Removed {dish_label} from your cart.",
                        "buttons": [
                            {"id": "view_cart", "title": "🛒 View Cart"},
                            {"id": "do_confirm", "title": "✅ Confirm Order"},
                        ],
                    }
                else:
                    state["final_response"] = {
                        "type": "buttons",
                        "body": f"✅ Updated *{dish_label}* quantity to *×{new_final_qty}*.\n🛒 Updated Cart Total: *₹{cart.total:.2f}*",
                        "voice_text": f"Updated {dish_label} quantity to {new_final_qty}.",
                        "buttons": [
                            {"id": "do_confirm", "title": "✅ Confirm Order"},
                            {"id": "view_cart", "title": "🛒 View Cart"},
                        ],
                    }
                return state
            elif item_name and target_qty and int(target_qty) > 0:
                # If item wasn't in cart yet, treat "make butter naan 2" as ADD_ITEM!
                intent = "ADD_ITEM"
                entities["items"] = [{"name": item_name, "quantity": int(target_qty)}]
            else:
                state["final_response"] = {
                    "type": "buttons",
                    "body": "🛒 That item isn't in your cart yet. Would you like to view your cart or browse the menu?",
                    "buttons": [
                        {"id": "view_cart", "title": "🛒 View Cart"},
                        {"id": "show_menu", "title": "📋 Browse Menu"},
                    ],
                }
                return state

        # ── CART_VIEW ────────────────────────────────────────────────
        if intent == "CART_VIEW":
            result = await db.execute(
                select(CartItem, MenuItem)
                .outerjoin(MenuItem, CartItem.menu_item_id == MenuItem.id)
                .where(CartItem.cart_id == cart.id)
            )
            rows = result.all()
            if not rows:
                state["final_response"] = {
                    "type": "buttons",
                    "body": "🛒 Your cart is currently empty. Tap items on the menu or tell me what you'd like to order!",
                    "buttons": [
                        {"id": "show_menu", "title": "📋 Browse Menu"},
                    ],
                }
                return state

            lines = []
            buttons = []
            for ci, mi in rows:
                if not mi:
                    continue
                lines.append(f"• {mi.name} ×{ci.quantity} — ₹{ci.line_total:.0f}" + (f"\n  📝 {ci.notes}" if ci.notes else ""))
                if len(buttons) < 2:
                    buttons.append({"id": f"remove_ci_{ci.id}", "title": f"❌ Remove {mi.name[:12]}"})

            buttons.append({"id": "clear_cart", "title": "🗑️ Clear All Cart"})
            buttons.append({"id": "do_confirm", "title": "✅ Confirm Order"})

            cart_text = "\n".join(lines)
            spoken_items = ", ".join(lines).replace("• ", "").replace("—", "for")
            state["final_response"] = {
                "type": "buttons",
                "body": f"🛒 *Your Cart*\n\n{cart_text}\n\n💰 *Total (incl. GST): ₹{cart.total:.2f}*\n\nTap a button below to remove an item, clear cart, or confirm order:",
                "voice_text": f"You have {len(lines)} item{'s' if len(lines) > 1 else ''} in your cart. {spoken_items}. Total with GST is Rupees {cart.total:.0f}.",
                "buttons": buttons,
            }
            return state

        # ── CLEAR_CART ───────────────────────────────────────────────
        if intent == "CLEAR_CART":
            result = await db.execute(select(CartItem).where(CartItem.cart_id == cart.id))
            items = result.scalars().all()
            for ci in items:
                await db.delete(ci)
            cart.subtotal = 0
            cart.cgst_amount = 0
            cart.sgst_amount = 0
            cart.total = 0
            await db.commit()
            state["final_response"] = {
                "type": "text",
                "body": "🗑️ Your cart has been cleared! Add fresh items anytime.",
            }
            return state

        # ── ORDER_STATUS ─────────────────────────────────────────────
        if intent == "ORDER_STATUS":
            orders_res = await db.execute(
                select(Order)
                .where(Order.session_id == uuid.UUID(session_id))
                .options(selectinload(Order.items).selectinload(OrderItem.menu_item))
                .order_by(Order.created_at.desc())
            )
            all_orders = orders_res.scalars().all()
            active_orders = [o for o in all_orders if o.status != OrderStatus.CANCELLED]

            if not active_orders:
                # Check if they have items sitting in cart not yet confirmed
                ci_res = await db.execute(select(CartItem).where(CartItem.cart_id == cart.id))
                cart_items = ci_res.scalars().all()
                if cart_items:
                    state["final_response"] = {
                        "type": "buttons",
                        "body": (
                            "🛒 You have items in your cart, but you haven't confirmed your order for the kitchen yet!\n\n"
                            "Tap *✅ Confirm Order* below to send it to the chef right away."
                        ),
                        "voice_text": "You have items in your cart, but your order is not confirmed yet. Tap Confirm Order to send it to the kitchen!",
                        "buttons": [
                            {"id": "do_confirm", "title": "✅ Confirm Order"},
                            {"id": "view_cart", "title": "🛒 View Cart"},
                        ],
                    }
                    return state

                state["final_response"] = {
                    "type": "buttons",
                    "body": "🍽️ You haven't placed any orders yet for this table session. Pick dishes from the menu or ask me for our ⭐ Top 3 Best Dishes!",
                    "voice_text": "You haven't placed any orders yet. Ask me for our best dishes or pick from the menu!",
                    "buttons": [
                        {"id": "recommend_best", "title": "⭐ Top 3 Best Dishes"},
                        {"id": "show_menu", "title": "📋 Browse Menu"},
                    ],
                }
                return state

            status_meta = {
                "NEW": ("🆕 Sent to Kitchen", "Your order has been sent to the kitchen and is waiting for the chef to accept it."),
                "ACCEPTED": ("✅ Accepted by Kitchen", "The kitchen has accepted your order and will begin preparing it shortly!"),
                "PREPARING": ("👨‍🍳 Chef is Preparing", "Our chef is freshly preparing your food right now in the kitchen!"),
                "READY": ("🔔 Hot & Ready!", "Your order is hot, fresh, and ready to be served to your table!"),
                "SERVED": ("🍽️ Served at Your Table", "Your order has been served. Enjoy your delicious meal!"),
            }

            lines = ["👨‍🍳 *Live Kitchen Order Status*\n"]
            voice_parts = []
            has_cancellable = False

            for ord_obj in active_orders:
                st_str = str(ord_obj.status.value if hasattr(ord_obj.status, "value") else ord_obj.status)
                if st_str in ("NEW", "ACCEPTED"):
                    has_cancellable = True
                badge, desc = status_meta.get(st_str, (st_str, f"Current status is {st_str}."))
                item_names = ", ".join(
                    f"{oi.menu_item.name if oi.menu_item else 'Item'} ×{oi.quantity}"
                    for oi in ord_obj.items
                )
                lines.append(f"• *Order #{ord_obj.order_number}*: {badge}\n  _{item_names}_\n  💬 {desc}\n")
                voice_parts.append(f"Order {ord_obj.order_number} is currently {st_str.lower()}. {desc}")

            btns = [
                {"id": "order_status", "title": "🔄 Refresh Status"},
                {"id": "tell_joke", "title": "😂 Hear a Joke"},
            ]
            if has_cancellable:
                btns.append({"id": "cancel_order", "title": "❌ Cancel Order"})

            state["final_response"] = {
                "type": "buttons",
                "body": "\n".join(lines).strip(),
                "voice_text": " ".join(voice_parts),
                "buttons": btns[:3],
            }
            return state

        # ── CANCEL_ORDER ─────────────────────────────────────────────
        if intent == "CANCEL_ORDER":
            # Only allow cancelling placed orders that are still NEW or ACCEPTED (NOT PREPARING, READY, or SERVED)
            orders_res = await db.execute(
                select(Order).where(
                    Order.session_id == uuid.UUID(session_id),
                    Order.status.in_([OrderStatus.NEW, OrderStatus.ACCEPTED]),
                ).order_by(Order.created_at.desc())
            )
            cancellable_orders = orders_res.scalars().all()

            if cancellable_orders:
                target_ord = cancellable_orders[0]
                target_ord.status = OrderStatus.CANCELLED
                await db.commit()
                try:
                    await manager.broadcast_to_branch(str(target_ord.branch_id), {
                        "event": "ORDER_STATUS_UPDATED",
                        "order_id": str(target_ord.id),
                        "order_number": target_ord.order_number,
                        "status": "CANCELLED",
                    })
                except Exception:
                    pass
                state["final_response"] = {
                    "type": "text",
                    "body": f"❌ *Order #{target_ord.order_number}* has been cancelled and the kitchen has been notified.",
                    "voice_text": f"Order {target_ord.order_number} has been cancelled.",
                }
                return state

            # Check if there is an order already PREPARING, READY, or SERVED
            active_orders_res = await db.execute(
                select(Order).where(
                    Order.session_id == uuid.UUID(session_id),
                    Order.status.in_([OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.SERVED]),
                ).order_by(Order.created_at.desc())
            )
            locked_order = active_orders_res.scalars().first()
            if locked_order:
                st_val = str(locked_order.status.value if hasattr(locked_order.status, "value") else locked_order.status)
                state["final_response"] = {
                    "type": "text",
                    "body": f"⚠️ *Order #{locked_order.order_number}* is already *{st_val}* and cannot be cancelled now.",
                    "voice_text": f"Sorry, your order is already {st_val.lower()} and cannot be cancelled.",
                }
                return state

            # Otherwise clear the open cart if items are in cart
            result = await db.execute(select(CartItem).where(CartItem.cart_id == cart.id))
            items = result.scalars().all()
            if items:
                for ci in items:
                    await db.delete(ci)
                cart.subtotal = 0
                cart.cgst_amount = 0
                cart.sgst_amount = 0
                cart.total = 0
                await db.commit()
                state["final_response"] = {
                    "type": "text",
                    "body": "🗑️ Cancelled and cleared all items from your current cart.",
                    "voice_text": "Cleared all items from your cart.",
                }
                return state

            state["final_response"] = {
                "type": "text",
                "body": "You don't have any cancellable order or cart items right now.",
            }
            return state

        # ── AI_PICK_AND_ADD (Confused customer asks AI to choose & add the best dish) ──
        if intent == "AI_PICK_AND_ADD":
            ranked_items, popularity_map = await get_ranked_menu_items(branch_id, db)
            is_veg_filter = entities.get("is_veg")
            item_name_hint = (entities.get("item_name") or "").lower().strip()
            qty = max(1, int(entities.get("quantity") or 1))

            candidates = list(ranked_items)
            if is_veg_filter is not None:
                candidates = [i for i in candidates if i.is_veg == bool(is_veg_filter)]

            if item_name_hint:
                cats_res = await db.execute(
                    select(MenuCategory).where(MenuCategory.branch_id == uuid.UUID(branch_id), MenuCategory.is_active == True)
                )
                all_cats = cats_res.scalars().all()
                matching_cat_ids = {
                    str(c.id) for c in all_cats
                    if item_name_hint in c.name.lower() or any(tok in c.name.lower() for tok in item_name_hint.split() if len(tok) >= 3)
                }
                filtered = [
                    i for i in candidates
                    if item_name_hint in i.name.lower() or str(i.category_id) in matching_cat_ids
                ]
                if filtered:
                    candidates = filtered
                else:
                    vec_candidates = await pgvector_search_menu_items(
                        branch_id,
                        state.get("message_text") or item_name_hint,
                        db,
                        is_veg=is_veg_filter,
                        limit=3,
                    )
                    if vec_candidates:
                        candidates = vec_candidates

            if not candidates:
                candidates = ranked_items

            if not candidates:
                state["final_response"] = {
                    "type": "text",
                    "body": "Our menu is currently being updated. Please check back in a moment!",
                }
                return state

            chosen_item = candidates[0]
            cart = await add_item_to_cart(uuid.UUID(session_id), chosen_item.id, qty, db)

            # Find CartItem ID for 1-tap Undo
            ci_lookup = await db.execute(
                select(CartItem).where(CartItem.cart_id == cart.id, CartItem.menu_item_id == chosen_item.id)
            )
            ci_obj = ci_lookup.scalars().first()
            undo_btn = (
                [{"id": f"remove_ci_{ci_obj.id}", "title": f"❌ Undo {chosen_item.name[:12]}"}]
                if ci_obj
                else []
            )

            # Also show the Top 3 recommendations on the left-side menu so they can see what was added + 2 alternatives
            top_3_for_ui = [str(i.id) for i in candidates[:3]]
            state["ui_action"] = {
                "action": "FILTER_MENU",
                "category_id": "ALL",
                "veg_filter": "VEG" if is_veg_filter is True else ("NONVEG" if is_veg_filter is False else "ALL"),
                "search_query": "",
                "matched_item_ids": top_3_for_ui,
            }

            veg_badge = "🟢 Veg" if chosen_item.is_veg else "🔴 Non-Veg"
            alt_text = ""
            if len(candidates) > 1:
                alt_names = ", ".join(f"*{c.name}* (₹{float(c.base_price):.0f})" for c in candidates[1:3])
                alt_text = f"\n\n💡 _Other top kitchen favorites shown on the left menu: {alt_names}_"

            state["final_response"] = {
                "type": "buttons",
                "body": (
                    f"👨‍🍳 *Chef's #1 Bestseller Selected & Added for You!*\n\n"
                    f"✅ Added: *{chosen_item.name}* ({veg_badge}) ×{qty} — ₹{float(chosen_item.base_price) * qty:.0f}\n"
                    f"🛒 Cart Total (incl. GST): *₹{cart.total:.2f}*"
                    f"{alt_text}\n\n"
                    f"Would you like to confirm and send this to the kitchen, or undo?"
                ),
                "voice_text": (
                    f"No problem at all! I have picked our kitchen's number one bestseller, {chosen_item.name}, "
                    f"and added {qty} portion to your cart. Say confirm order whenever you are ready!"
                ),
                "buttons": [
                    {"id": "do_confirm", "title": "✅ Confirm Order"},
                    *undo_btn,
                    {"id": "recommend_best", "title": "⭐ See Top 3 Dishes"},
                ],
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
            added_ci_buttons = []

            # Preload all available branch menu items ONCE instead of inside the loop
            items_res = await db.execute(
                select(MenuItem).where(MenuItem.branch_id == uuid.UUID(branch_id), MenuItem.is_available == True)
            )
            all_m = items_res.scalars().all()
            menu_by_id = {str(m.id): m for m in all_m}

            for entry in items_to_add:
                menu_item = None
                qty = int(entry.get("quantity") or 1)
                name_query = (entry.get("name") or "").lower().strip()

                if entry.get("item_id"):
                    menu_item = menu_by_id.get(str(entry["item_id"]))
                    if not menu_item:
                        res = await db.execute(select(MenuItem).where(MenuItem.id == uuid.UUID(entry["item_id"])))
                        menu_item = res.scalar_one_or_none()
                elif name_query and len(name_query) >= 2:
                    
                    # 1. Exact case-insensitive match
                    exact = [i for i in all_m if i.name.lower() == name_query]
                    if exact:
                        menu_item = exact[0]
                    else:
                        # 2. Substring match (query in item name or item name in query)
                        substr = [i for i in all_m if name_query in i.name.lower() or i.name.lower() in name_query]
                        if len(substr) == 1:
                            menu_item = substr[0]
                        elif len(substr) > 1:
                            # Pick the one with highest word overlap
                            q_words = set(name_query.split())
                            substr.sort(key=lambda x: len(q_words.intersection(set(x.name.lower().split()))), reverse=True)
                            menu_item = substr[0]
                        else:
                            # 3. Strict multi-character token match using SequenceMatcher similarity (>= 0.72)
                            import difflib
                            best_item = None
                            best_score = 0.0
                            for cand in all_m:
                                score = difflib.SequenceMatcher(None, name_query, cand.name.lower()).ratio()
                                # Also check individual significant words (>=4 chars)
                                q_tokens = [t for t in name_query.split() if len(t) >= 4]
                                c_tokens = [t for t in cand.name.lower().split() if len(t) >= 4]
                                if q_tokens and c_tokens:
                                    token_matches = sum(
                                        1 for qt in q_tokens if any(difflib.SequenceMatcher(None, qt, ct).ratio() >= 0.8 for ct in c_tokens)
                                    )
                                    token_ratio = token_matches / len(q_tokens)
                                    score = max(score, token_ratio * 0.85)
                                if score > best_score:
                                    best_score = score
                                    best_item = cand
                            # Only accept if similarity is strong (>= 0.65) so unclear speech never adds random items!
                            if best_item and best_score >= 0.65:
                                menu_item = best_item
                            else:
                                # 4. Try Supabase pgvector semantic match if user described a dish naturally
                                vec_found = await pgvector_search_menu_items(branch_id, name_query, db, limit=1)
                                if vec_found:
                                    menu_item = vec_found[0]

                if menu_item:
                    cart = await add_item_to_cart(uuid.UUID(session_id), menu_item.id, qty, db)
                    last_category_id = menu_item.category_id
                    added_names.append(f"*{menu_item.name}* ×{qty}")
                    # Look up the cart item id so we can offer a 1-tap Undo/Remove button
                    ci_lookup = await db.execute(
                        select(CartItem).where(CartItem.cart_id == cart.id, CartItem.menu_item_id == menu_item.id)
                    )
                    ci_obj = ci_lookup.scalars().first()
                    if ci_obj and len(added_ci_buttons) < 2:
                        added_ci_buttons.append({"id": f"remove_ci_{ci_obj.id}", "title": f"❌ Undo {menu_item.name[:12]}"})

            if not added_names:
                state["final_response"] = {
                    "type": "buttons",
                    "body": "🎤 I couldn't clearly hear or find that dish on the menu. Please try saying the dish name again or tap it on the menu!",
                    "buttons": [
                        {"id": "view_cart", "title": "🛒 View Cart"},
                        {"id": "show_menu", "title": "📋 Browse Menu"},
                    ],
                }
                return state

            # --- Simplified "Keep Picking" UX ---
            # If item was added via ID (from list), re-show the list for a "multi-select" feel
            if entities.get("item_id") and last_category_id:
                state["intent"] = "BROWSE"
                state["entities"] = {"category_id": str(last_category_id)}
                state["loop_prefix"] = f"✅ Added: {added_names[0]}"
                return state

            # If it was a text/voice NLP order, show a summary with Confirm AND Undo/Remove buttons
            action_buttons = [
                {"id": "do_confirm", "title": "✅ Confirm Order"},
                *added_ci_buttons,
                {"id": "view_cart", "title": "🛒 Review / Remove"},
            ]
            state["final_response"] = {
                "type": "buttons",
                "body": f"✅ Added: {', '.join(added_names)}\n\n🛒 Cart Total: *₹{cart.total:.2f}*\n\nReady to send to kitchen? Tap Confirm or Undo if added by mistake! 👇",
                "buttons": action_buttons[:4],
            }
            return state



        # ── REMOVE_ITEM ──────────────────────────────────────────────
        if intent == "REMOVE_ITEM":
            cart_item_id = entities.get("cart_item_id")
            item_name = (entities.get("item_name") or "").strip()
            if not item_name and entities.get("items"):
                item_name = (entities["items"][0].get("name") or "").strip()

            items_result = await db.execute(
                select(CartItem, MenuItem)
                .outerjoin(MenuItem, CartItem.menu_item_id == MenuItem.id)
                .where(CartItem.cart_id == cart.id)
            )
            cart_rows = items_result.all()

            if not cart_rows:
                state["final_response"] = {"type": "text", "body": "🛒 Your cart is already empty."}
                return state

            target = None
            removed_label = item_name

            if cart_item_id:
                for ci, mi in cart_rows:
                    if str(ci.id) == str(cart_item_id):
                        target = ci
                        if mi:
                            removed_label = mi.name
                        break
            elif item_name:
                for ci, mi in cart_rows:
                    if mi and (item_name.lower() in mi.name.lower() or mi.name.lower() in item_name.lower()):
                        target = ci
                        removed_label = mi.name
                        break

            if not target:
                # Show interactive remove buttons for each item currently in the cart
                buttons = []
                for ci, mi in cart_rows[:3]:
                    if mi:
                        buttons.append({"id": f"remove_ci_{ci.id}", "title": f"❌ Remove {mi.name[:12]}"})
                buttons.append({"id": "clear_cart", "title": "🗑️ Clear All Cart"})
                state["final_response"] = {
                    "type": "buttons",
                    "body": "Which item would you like to remove from your cart? Tap below:",
                    "buttons": buttons,
                }
                return state

            cart = await remove_cart_item(target.id, db)
            state["final_response"] = {
                "type": "buttons",
                "body": f"✅ Removed *{removed_label}* from your cart.\n🛒 Updated Cart Total: *₹{cart.total:.2f}*",
                "buttons": [
                    {"id": "view_cart", "title": "🛒 View Cart"},
                    {"id": "do_confirm", "title": "✅ Confirm Order"},
                ],
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
            state["ui_action"] = {
                "action": "ORDER_PLACED",
                "order_id": str(order.id),
                "order_number": order.order_number,
                "total": float(order.total),
            }
            state["final_response"] = {
                "type": "buttons",
                "body": (
                    f"✅ *Order #{order.order_number} confirmed & sent to the kitchen!*\n\n"
                    f"🍽️ Table: {table.table_number}\n"
                    f"💵 Total (incl. GST): ₹{order.total:.2f}\n\n"
                    "While your food is being prepared, would you like a joke, kids cartoons, or a special birthday wish? 😊"
                ),
                "voice_text": f"Your order number {order.order_number} for Rupees {order.total:.0f} has been confirmed and sent to the kitchen!",
                "buttons": [
                    {"id": "tell_joke", "title": "😂 Hear a Joke"},
                    {"id": "show_cartoons", "title": "🎬 Kids Cartoons"},
                    {"id": "show_menu", "title": "📋 Order More"},
                ],
            }


        except CheckoutError as e:
            state["final_response"] = {"type": "text", "body": f"⚠️ {e}"}
    return state
