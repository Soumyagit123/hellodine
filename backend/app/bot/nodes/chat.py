"""Bot node — restaurant_chat for general Q&A using native Google AI."""
import asyncio
import uuid
from typing import Any
import google.generativeai as genai  # type: ignore
from app.bot.state import BotState
from app.database import AsyncSessionLocal
from app.models.tenancy import Restaurant, Branch
from sqlalchemy import select
from app.config import settings
from app.services.cache_service import cache

# Configure Google AI
_genai: Any = genai
_genai.configure(api_key=settings.GEMINI_API_KEY)
model: Any = _genai.GenerativeModel(
    "gemini-3.5-flash-lite",
    generation_config={"temperature": 0.3, "max_output_tokens": 160},
)
fallback_model: Any = _genai.GenerativeModel(
    "gemini-2.5-flash-lite",
    generation_config={"temperature": 0.3, "max_output_tokens": 160},
)

async def restaurant_chat(state: BotState) -> BotState:
    """Answers general questions about the restaurant using native Google AI library."""
    restaurant_id = state.get("restaurant_id")
    branch_id = state.get("branch_id")
    message = state.get("message_text", "")

    if not restaurant_id:
        return state

    cached_ctx = cache.get(f"ai_static_context:{branch_id}")
    restaurant_name = "our restaurant"
    branch_info = ""
    top_dishes_str = ""

    if cached_ctx:
        restaurant_name = cached_ctx.get("restaurant_name", "our restaurant")
        branch_info = cached_ctx.get("branch_info", "")
        top_dishes_str = cached_ctx.get("top_dishes_str", "")

    async with AsyncSessionLocal() as db:
        if not cached_ctx:
            # Fetch restaurant and branch info once for context
            res = await db.execute(select(Restaurant).where(Restaurant.id == uuid.UUID(restaurant_id)))
            restaurant = res.scalar_one_or_none()
            if restaurant:
                restaurant_name = restaurant.name

            if branch_id:
                br_res = await db.execute(select(Branch).where(Branch.id == uuid.UUID(branch_id)))
                branch = br_res.scalar_one_or_none()
                if branch:
                    branch_info = f"This branch is located at {branch.address}, {branch.city}, {branch.state} - {branch.pincode}."

            from app.bot.nodes.menu_and_format import get_ranked_menu_items
            if branch_id:
                try:
                    ranked, _ = await get_ranked_menu_items(branch_id, db)
                    if ranked:
                        dish_lines = [
                            f"- {m.name} ({'Veg' if m.is_veg else 'Non-Veg'}): ₹{float(m.base_price):.0f}"
                            for m in ranked[:8]
                        ]
                        top_dishes_str = "Top Menu Dishes:\n" + "\n".join(dish_lines)
                except Exception:
                    pass

            cache.set(f"ai_static_context:{branch_id}", {
                "restaurant_name": restaurant_name,
                "branch_info": branch_info,
                "top_dishes_str": top_dishes_str,
            }, ttl_seconds=300)

        # Dynamic table session context (cart / placed orders)
        from app.models.cart import Cart, CartStatus
        from app.models.orders import Order, OrderStatus
        session_context_str = ""
        session_id = state.get("session_id")
        if session_id:
            try:
                c_res = await db.execute(select(Cart).where(Cart.session_id == uuid.UUID(session_id), Cart.status == CartStatus.OPEN))
                c_obj = c_res.scalars().first()
                cart_Total = f"₹{float(c_obj.total):.0f}" if c_obj else "₹0"
                o_res = await db.execute(select(Order).where(Order.session_id == uuid.UUID(session_id), Order.status != OrderStatus.CANCELLED))
                o_list = o_res.scalars().all()
                ord_summary = ", ".join(f"#{o.order_number} ({o.status})" for o in o_list) if o_list else "None"
                session_context_str = f"Customer Cart Total: {cart_Total}. Active Kitchen Orders: {ord_summary}."
            except Exception:
                pass

        system_prompt = f"""You are a friendly AI Waiter for {restaurant_name}. {branch_info}
{top_dishes_str}
{session_context_str}
Reply in 1-2 short sentences with emojis. Mention real dish names/prices if asked."""

        try:
            # Non-blocking async thread call using gemini-3.5-flash-lite (with fallback to gemini-2.5-flash-lite)
            full_prompt = f"{system_prompt}\n\nUser: {message}"
            try:
                response = await asyncio.to_thread(model.generate_content, full_prompt)
            except Exception:
                response = await asyncio.to_thread(fallback_model.generate_content, full_prompt)
            state["final_response"] = {
                "type": "text",
                "body": response.text.strip()
            }
        except Exception as e:
            print(f"Chat node error: {e}")
            state["final_response"] = {
                "type": "text",
                "body": f"I'm here to help! Feel free to ask about {restaurant_name} or just say 'menu' to see our delicious food! 🥗"
            }

    return state
